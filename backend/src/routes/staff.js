import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, withTx } from '../db.js';
import { ah, notFound, badRequest } from '../utils/errors.js';
import { requireRole } from '../middleware/auth.js';
import * as booking from '../services/booking.js';
import { findOrCreatePatient } from '../services/patients.js';
import { audit } from '../services/audit.js';
import { patientInput, idParam, dateStr } from './schemas.js';

// =====================================================================
// เคาน์เตอร์ (STAFF + ADMIN)
// =====================================================================
export const staffRouter = Router();
staffRouter.use(requireRole('STAFF'));

/** คิวรายวัน: ทุก slot + คิวที่ active + ประวัติคิวที่ยกเลิก/no-show ใน slot นั้น */
export async function dayQueue(date, practitionerId = null) {
  const slots = await query(
    `SELECT s.slot_id, s.practitioner_id, s.slot_date, s.start_time, s.end_time, s.is_blocked, s.block_reason,
            h.name AS holiday_name,
            TIMESTAMPDIFF(MINUTE, NOW(), TIMESTAMP(s.slot_date, s.start_time)) AS mins_until
       FROM time_slots s LEFT JOIN holidays h ON h.holiday_date = s.slot_date
      WHERE s.slot_date = ? ${practitionerId ? 'AND s.practitioner_id = ?' : ''}
      ORDER BY s.start_time, s.practitioner_id`,
    practitionerId ? [date, practitionerId] : [date],
  );
  const appts = await query(
    `SELECT v.*, a.active_slot_id, sr.treatment_details, sr.post_treatment_note
       FROM v_appointment_details v
       JOIN appointments a ON a.appointment_id = v.appointment_id
       LEFT JOIN service_records sr ON sr.appointment_id = v.appointment_id
      WHERE v.slot_date = ?
      ORDER BY v.created_at`,
    [date],
  );
  return slots.map((s) => {
    const mine = appts.filter((a) => a.slot_id === s.slot_id);
    const active = mine.find((a) => a.active_slot_id != null) ?? null;
    return {
      ...s,
      start_time: s.start_time.slice(0, 5),
      end_time: s.end_time.slice(0, 5),
      state: s.holiday_name ? 'HOLIDAY' : s.is_blocked ? 'BLOCKED' : active ? active.status : 'AVAILABLE',
      appointment: active ? apptView(active) : null,
      history: mine.filter((a) => a.active_slot_id == null).map(apptView),
    };
  });
}

function apptView(a) {
  return {
    appointment_id: a.appointment_id, booking_code: a.booking_code, status: a.status, booking_channel: a.booking_channel,
    patient: { patient_id: a.patient_id, patient_type: a.patient_type, hn: a.hn, first_name: a.first_name, last_name: a.last_name, phone_number: a.phone_number },
    booker: a.booked_by_line_user_id ? { line_name: a.booker_line_name, relation: a.booker_relation } : null,
    has_line: !!a.booked_by_line_user_id,
    chief_complaint: a.chief_complaint,
    confirmed_at: a.confirmed_at, checked_in_at: a.checked_in_at,
    cancelled_at: a.cancelled_at, cancelled_by: a.cancelled_by, cancel_reason: a.cancel_reason,
    service_start: a.service_start, service_end: a.service_end,
    treatment_details: a.treatment_details, post_treatment_note: a.post_treatment_note,
  };
}

staffRouter.get('/queue', ah(async (req, res) => {
  const date = req.query.date ? dateStr.parse(req.query.date) : (await queryOne('SELECT CURDATE() AS d')).d;
  const slots = await dayQueue(date);
  const summary = {};
  for (const s of slots) summary[s.state] = (summary[s.state] ?? 0) + 1;
  res.json({ date, summary, slots });
}));

/** ค้นหาคิว: รหัสจอง / เบอร์ / HN / ชื่อ (เฉพาะวันนี้เป็นต้นไป + 7 วันย้อนหลัง) */
staffRouter.get('/appointments/search', ah(async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return res.json({ results: [] });
  const like = `%${q}%`;
  const rows = await query(
    `SELECT * FROM v_appointment_details
      WHERE slot_date >= CURDATE() - INTERVAL 7 DAY
        AND (booking_code = ? OR phone_number LIKE ? OR hn = ? OR CONCAT(first_name, ' ', last_name) LIKE ?)
      ORDER BY (slot_date = CURDATE()) DESC, slot_date, start_time
      LIMIT 30`,
    [q.toUpperCase(), like, q.toUpperCase(), like],
  );
  res.json({ results: rows.map((r) => ({ ...apptView(r), slot_date: r.slot_date, start_time: r.start_time.slice(0, 5), end_time: r.end_time.slice(0, 5) })) });
}));

/** ค้นหาผู้รับบริการ (ใช้ตอนรับ walk-in / จองแทน) */
staffRouter.get('/patients/search', ah(async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return res.json({ results: [] });
  const like = `%${q}%`;
  const rows = await query(
    `SELECT patient_id, patient_type, hn, first_name, last_name, phone_number
       FROM patients
      WHERE is_deleted = FALSE AND (hn = ? OR phone_number LIKE ? OR CONCAT(first_name, ' ', last_name) LIKE ?)
      ORDER BY updated_at DESC LIMIT 20`,
    [q.toUpperCase(), like, like],
  );
  res.json({ results: rows });
}));

const staffBookingBody = z.object({
  slot_id: z.coerce.number().int().positive(),
  channel: z.enum(['WALK_IN', 'STAFF']),
  patient_id: z.coerce.number().int().positive().optional(),
  patient: patientInput.optional(),
  chief_complaint: z.string().trim().max(1000).optional().nullable(),
  force: z.boolean().optional(),
}).refine((b) => b.patient_id || b.patient, { message: 'ต้องระบุผู้รับบริการ' });

/** walk-in (เช็กอินให้ทันที) หรือจองแทนทางโทรศัพท์ */
staffRouter.post('/appointments', ah(async (req, res) => {
  const body = staffBookingBody.parse(req.body);
  let patientId = body.patient_id;
  if (!patientId) patientId = await withTx((conn) => findOrCreatePatient(conn, body.patient));
  const appt = await booking.createBooking({
    patientId, slotId: body.slot_id, chiefComplaint: body.chief_complaint,
    channel: body.channel, staffId: req.staff.user_id, force: body.force,
  });
  await audit(req, body.channel, 'appointments', appt.appointment_id, { code: appt.booking_code, force: !!body.force });
  res.status(201).json(apptView(appt));
}));

async function loadAppt(req) {
  const id = idParam.parse(req.params.id);
  const appt = await booking.getAppointment(id);
  if (!appt) throw notFound('ไม่พบคิวนี้');
  return appt;
}

/** หา คิวจากรหัสจอง (หน้าจอเช็กอิน) */
staffRouter.get('/appointments/code/:code', ah(async (req, res) => {
  const appt = await booking.getAppointmentByCode(String(req.params.code).trim());
  if (!appt) throw notFound('ไม่พบรหัสจองนี้');
  res.json({ ...apptView(appt), slot_date: appt.slot_date, start_time: appt.start_time.slice(0, 5), end_time: appt.end_time.slice(0, 5) });
}));

staffRouter.post('/appointments/:id/checkin', ah(async (req, res) => {
  const appt = await loadAppt(req);
  await booking.checkIn(appt, req.staff.user_id, req.body?.force === true);
  await audit(req, 'CHECK_IN', 'appointments', appt.appointment_id, { force: req.body?.force === true });
  res.json(apptView(await booking.getAppointment(appt.appointment_id)));
}));

staffRouter.post('/appointments/:id/cancel', ah(async (req, res) => {
  const appt = await loadAppt(req);
  const reason = z.string().trim().max(255).optional().parse(req.body?.reason);
  await booking.cancelByStaff(appt.appointment_id, req.staff.user_id, reason);
  await audit(req, 'CANCEL', 'appointments', appt.appointment_id, { reason });
  res.json(apptView(await booking.getAppointment(appt.appointment_id)));
}));

/** ตั้ง no-show เอง (ไม่ต้องรอ cron) */
staffRouter.post('/appointments/:id/no-show', ah(async (req, res) => {
  const appt = await loadAppt(req);
  if (appt.status !== 'BOOKED') throw badRequest('INVALID_STATUS', 'ตั้ง no-show ได้เฉพาะคิวที่ยังไม่เช็กอิน');
  await query("UPDATE appointments SET status = 'NO_SHOW' WHERE appointment_id = ? AND status = 'BOOKED'", [appt.appointment_id]);
  await audit(req, 'NO_SHOW', 'appointments', appt.appointment_id);
  res.json(apptView(await booking.getAppointment(appt.appointment_id)));
}));

// =====================================================================
// หมอนวด (PRACTITIONER + ADMIN)
// =====================================================================
export const practitionerRouter = Router();
practitionerRouter.use(requireRole('PRACTITIONER'));

practitionerRouter.get('/queue', ah(async (req, res) => {
  const date = req.query.date ? dateStr.parse(req.query.date) : (await queryOne('SELECT CURDATE() AS d')).d;
  // หมอนวดเห็นเฉพาะคิวตัวเอง, แอดมินเห็นทั้งหมด
  const pid = req.staff.role === 'PRACTITIONER' ? req.staff.practitioner_id : null;
  res.json({ date, slots: await dayQueue(date, pid) });
}));

/** ประวัติการรับบริการของผู้รับบริการ (ช่วยหมอนวดดูอาการครั้งก่อน) */
practitionerRouter.get('/patients/:id/history', ah(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const rows = await query(
    `SELECT v.slot_date, v.start_time, v.chief_complaint, sr.treatment_details, sr.post_treatment_note
       FROM v_appointment_details v JOIN service_records sr ON sr.appointment_id = v.appointment_id
      WHERE v.patient_id = ? AND v.status = 'COMPLETED'
      ORDER BY v.slot_date DESC LIMIT 20`,
    [id],
  );
  res.json({ history: rows });
}));

const recordBody = z.object({
  treatment_details: z.string().trim().max(5000).optional().nullable(),
  post_treatment_note: z.string().trim().max(5000).optional().nullable(),
});

practitionerRouter.post('/appointments/:id/start', ah(async (req, res) => {
  const appt = await loadAppt(req);
  await booking.startService(appt.appointment_id, req.staff.user_id);
  await audit(req, 'START', 'appointments', appt.appointment_id);
  res.json({ ok: true });
}));

practitionerRouter.post('/appointments/:id/complete', ah(async (req, res) => {
  const appt = await loadAppt(req);
  await booking.completeService(appt.appointment_id, req.staff.user_id, recordBody.parse(req.body ?? {}));
  await audit(req, 'COMPLETE', 'appointments', appt.appointment_id);
  res.json({ ok: true });
}));

practitionerRouter.put('/appointments/:id/record', ah(async (req, res) => {
  const appt = await loadAppt(req);
  await booking.saveServiceRecord(appt.appointment_id, req.staff.user_id, recordBody.parse(req.body ?? {}));
  await audit(req, 'SAVE_RECORD', 'service_records', appt.appointment_id);
  res.json({ ok: true });
}));
