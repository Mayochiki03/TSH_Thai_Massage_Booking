/**
 * routes/staff.js — API หน้างาน
 *   staffRouter        (/api/staff/*, STAFF)        คิวรายวัน · ค้นหา · เช็กอิน (+VN) · walk-in / จองแทน · ยกเลิก · no-show · แก้ VN
 *   practitionerRouter (/api/practitioner/*, หมอนวด) คิววันนี้ทุกเตียง · รับคิว/เริ่มนวด · จบบริการ · บันทึกผล + VN · ประวัติผู้รับบริการ
 *
 * หลายเตียง: แต่ละรอบมีได้หลายคิว (capacity) → คิวรายวันส่งเป็น slot + รายการคิวในรอบนั้น
 */
import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, withTx } from '../db.js';
import { ah, notFound, badRequest } from '../utils/errors.js';
import { requireRole } from '../middleware/auth.js';
import * as booking from '../services/booking.js';
import { findOrCreatePatient, applyNationalId } from '../services/patients.js';
import { audit } from '../services/audit.js';
import { hashThaiId, isValidThaiId, normalizeThaiId, maskThaiId } from '../utils/nationalId.js';
import { patientInput, idParam, dateStr, vnInput, serviceTypeId, nationalIdInput } from './schemas.js';

// =====================================================================
// เคาน์เตอร์ (STAFF + ADMIN)
// =====================================================================
export const staffRouter = Router();
staffRouter.use(requireRole('STAFF'));

/**
 * คิวรายวัน: ทุก slot ของวัน + คิวที่ยังกินที่ (appointments) + คิวที่ยกเลิก/no-show (history)
 *   state: HOLIDAY / BLOCKED / FULL (ครบจำนวนเตียง) / AVAILABLE
 */
export async function dayQueue(date) {
  const slots = await query(
    `SELECT s.slot_id, s.slot_date, s.start_time, s.end_time, s.capacity, s.is_blocked, s.block_reason,
            h.name AS holiday_name,
            TIMESTAMPDIFF(MINUTE, NOW(), TIMESTAMP(s.slot_date, s.start_time)) AS mins_until
       FROM time_slots s LEFT JOIN holidays h ON h.holiday_date = s.slot_date
      WHERE s.slot_date = ?
      ORDER BY s.start_time`,
    [date],
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
    const active = mine.filter((a) => a.active_slot_id != null);
    return {
      ...s,
      start_time: s.start_time.slice(0, 5),
      end_time: s.end_time.slice(0, 5),
      booked: active.length,
      remaining: Math.max(s.capacity - active.length, 0),
      state: s.holiday_name ? 'HOLIDAY' : s.is_blocked ? 'BLOCKED' : active.length >= s.capacity ? 'FULL' : 'AVAILABLE',
      appointments: active.map(apptView),
      history: mine.filter((a) => a.active_slot_id == null).map(apptView),
    };
  });
}

export function apptView(a) {
  return {
    appointment_id: a.appointment_id, booking_code: a.booking_code, status: a.status, booking_channel: a.booking_channel,
    patient: {
      patient_id: a.patient_id, patient_type: a.patient_type, hn: a.hn, first_name: a.first_name, last_name: a.last_name,
      phone_number: a.phone_number,
      has_national_id: !!a.has_national_id, no_national_id: !!a.no_national_id, national_id_masked: maskThaiId(a.national_id_last4),
    },
    booker: a.booked_by_line_user_id ? { line_name: a.booker_line_name, relation: a.booker_relation } : null,
    has_line: !!a.booked_by_line_user_id,
    chief_complaint: a.chief_complaint,
    service: a.service_type_id ? { service_type_id: a.service_type_id, name: a.service_name, price: a.service_price == null ? null : Number(a.service_price) } : null,
    practitioner: a.practitioner_id ? { practitioner_id: a.practitioner_id, full_name: a.practitioner_name } : null,
    vn: a.vn,
    confirmed_at: a.confirmed_at, checked_in_at: a.checked_in_at,
    cancelled_at: a.cancelled_at, cancelled_by: a.cancelled_by, cancel_reason: a.cancel_reason,
    service_start: a.service_start, service_end: a.service_end,
    treatment_details: a.treatment_details, post_treatment_note: a.post_treatment_note,
  };
}

/** ช่วยค้นหา: ถ้าพิมพ์เลขบัตร 13 หลักที่ถูกต้อง → ค้นด้วย hash (ไม่ต้องถอดรหัสทั้งตาราง) */
export function nidSearchHash(q) {
  const d = normalizeThaiId(q);
  return d.length === 13 && isValidThaiId(d) ? hashThaiId(d) : '';
}

staffRouter.get('/queue', ah(async (req, res) => {
  const date = req.query.date ? dateStr.parse(req.query.date) : (await queryOne('SELECT CURDATE() AS d')).d;
  const slots = await dayQueue(date);
  // สรุปเป็นจำนวน "คิว/ที่" ไม่ใช่จำนวนรอบ (1 รอบมีได้หลายเตียง)
  const summary = { AVAILABLE: 0, BOOKED: 0, CHECKED_IN: 0, IN_SERVICE: 0, COMPLETED: 0, capacity: 0 };
  for (const s of slots) {
    if (s.state === 'HOLIDAY' || s.state === 'BLOCKED') continue;
    summary.capacity += s.capacity;
    summary.AVAILABLE += s.remaining;
    for (const a of s.appointments) summary[a.status] = (summary[a.status] ?? 0) + 1;
  }
  res.json({ date, summary, slots });
}));

/** ประเภทบริการ (ฟอร์มรับ walk-in / จองแทน) */
staffRouter.get('/service-types', ah(async (_req, res) => {
  res.json({ service_types: await booking.listServiceTypes() });
}));

/** ค้นหาคิว: รหัสจอง / เบอร์ / HN / ชื่อ (เฉพาะวันนี้เป็นต้นไป + 7 วันย้อนหลัง) */
staffRouter.get('/appointments/search', ah(async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return res.json({ results: [] });
  const like = `%${q}%`;
  const rows = await query(
    `SELECT * FROM v_appointment_details
      WHERE slot_date >= CURDATE() - INTERVAL 7 DAY
        AND (booking_code = ? OR phone_number LIKE ? OR hn = ? OR vn = ? OR CONCAT(first_name, ' ', last_name) LIKE ?
             OR patient_id IN (SELECT patient_id FROM patients WHERE national_id_hash = ?))
      ORDER BY (slot_date = CURDATE()) DESC, slot_date, start_time
      LIMIT 30`,
    [q.toUpperCase(), like, q.toUpperCase(), q.toUpperCase(), like, nidSearchHash(q)],
  );
  res.json({ results: rows.map((r) => ({ ...apptView(r), slot_date: r.slot_date, start_time: r.start_time.slice(0, 5), end_time: r.end_time.slice(0, 5) })) });
}));

/** ค้นหาผู้รับบริการ (ใช้ตอนรับ walk-in / จองแทน) — ชื่อ / เบอร์ / HN / เลขบัตร 13 หลัก */
staffRouter.get('/patients/search', ah(async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return res.json({ results: [] });
  const like = `%${q}%`;
  const rows = await query(
    `SELECT patient_id, patient_type, hn, first_name, last_name, phone_number,
            national_id_last4, no_national_id, national_id_hash IS NOT NULL AS has_national_id
       FROM patients
      WHERE is_deleted = FALSE
        AND (hn = ? OR phone_number LIKE ? OR CONCAT(first_name, ' ', last_name) LIKE ? OR national_id_hash = ?)
      ORDER BY updated_at DESC LIMIT 20`,
    [q.toUpperCase(), like, like, nidSearchHash(q)],
  );
  res.json({
    results: rows.map(({ national_id_last4: l4, ...r }) => ({
      ...r, has_national_id: !!r.has_national_id, no_national_id: !!r.no_national_id, national_id_masked: maskThaiId(l4),
    })),
  });
}));

const staffBookingBody = z.object({
  slot_id: z.coerce.number().int().positive(),
  channel: z.enum(['WALK_IN', 'STAFF']),
  patient_id: z.coerce.number().int().positive().optional(),
  patient: patientInput.optional(),
  service_type_id: serviceTypeId,
  // ผู้รับบริการเดิมที่ยังไม่มีเลขบัตร → กรอกมาพร้อมการจอง
  national_id: nationalIdInput,
  no_national_id: z.boolean().optional(),
  chief_complaint: z.string().trim().max(1000).optional().nullable(),
  force: z.boolean().optional(),
}).refine((b) => b.patient_id || b.patient, { message: 'ต้องระบุผู้รับบริการ' });

/** walk-in (เช็กอินให้ทันที) หรือจองแทนทางโทรศัพท์ */
staffRouter.post('/appointments', ah(async (req, res) => {
  const body = staffBookingBody.parse(req.body);
  let patientId = body.patient_id;
  if (!patientId) patientId = await withTx((conn) => findOrCreatePatient(conn, body.patient));
  const appt = await booking.createBooking({
    patientId, slotId: body.slot_id, chiefComplaint: body.chief_complaint, serviceTypeId: body.service_type_id,
    identity: body.patient_id ? { national_id: body.national_id, no_national_id: body.no_national_id } : undefined,
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
  const vn = vnInput.parse(req.body?.vn);
  await booking.checkIn(appt, req.staff.user_id, req.body?.force === true, vn);
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

/** แก้ VN / ประเภทบริการของคิว / เติมเลขบัตรของผู้รับบริการ (เคาน์เตอร์ได้ VN จากระบบโรงพยาบาลทีหลัง) */
staffRouter.patch('/appointments/:id', ah(async (req, res) => {
  const appt = await loadAppt(req);
  const b = z.object({
    vn: vnInput,
    service_type_id: serviceTypeId.optional(),
    // ผู้รับบริการที่ยังไม่มีเลขบัตร (ข้อมูลเก่า) → เคาน์เตอร์กรอกให้ตอนเช็กอินได้
    national_id: nationalIdInput,
    no_national_id: z.boolean().optional(),
  }).parse(req.body ?? {});
  if (['CANCELLED', 'NO_SHOW'].includes(appt.status)) throw badRequest('INVALID_STATUS', 'คิวนี้ถูกยกเลิกแล้ว');
  await withTx(async (conn) => {
    await booking.updateVisitInfo(conn, appt.appointment_id, b);
    if (b.national_id || b.no_national_id) await applyNationalId(conn, appt.patient_id, b);
  });
  await audit(req, 'UPDATE_VISIT', 'appointments', appt.appointment_id, { vn: b.vn, service_type_id: b.service_type_id, national_id_set: !!b.national_id });
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

/**
 * คิววันนี้ของห้องนวด — ทุกเตียงเห็นคิวเดียวกัน (ใครว่างก็รับคิวที่มาถึงแล้ว)
 * me = หมอนวดของบัญชีนี้ (null = แอดมิน/นักพัฒนา ต้องเลือกหมอนวดตอนเริ่ม)
 */
practitionerRouter.get('/queue', ah(async (req, res) => {
  const date = req.query.date ? dateStr.parse(req.query.date) : (await queryOne('SELECT CURDATE() AS d')).d;
  const [slots, practitioners, serviceTypes] = await Promise.all([
    dayQueue(date),
    query('SELECT practitioner_id, full_name FROM practitioners WHERE is_active = TRUE ORDER BY practitioner_id'),
    booking.listServiceTypes(),
  ]);
  res.json({ date, me: req.staff.practitioner_id ?? null, practitioners, service_types: serviceTypes, slots });
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
  vn: vnInput,
  service_type_id: serviceTypeId.optional(),
});

/** รับคิว/เริ่มนวด — บัญชีหมอนวดบันทึกเป็นตัวเองเสมอ, แอดมินต้องระบุ practitioner_id */
practitionerRouter.post('/appointments/:id/start', ah(async (req, res) => {
  const appt = await loadAppt(req);
  const practitionerId = req.staff.role === 'PRACTITIONER'
    ? req.staff.practitioner_id
    : z.coerce.number().int().positive({ message: 'กรุณาเลือกหมอนวด' }).parse(req.body?.practitioner_id);
  if (!practitionerId) throw badRequest('NO_PRACTITIONER', 'บัญชีนี้ยังไม่ได้ผูกกับรายชื่อหมอนวด กรุณาแจ้งผู้ดูแลระบบ');
  await booking.startService(appt.appointment_id, req.staff.user_id, practitionerId);
  await audit(req, 'START', 'appointments', appt.appointment_id, { practitioner_id: practitionerId });
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
