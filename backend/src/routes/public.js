/**
 * routes/public.js — API ผู้จองผ่าน LINE (/api/public/*, พอร์ต public)
 *   config (ไม่ต้องล็อกอิน) · me / consent / self / patients (ข้อมูลผู้จอง + รายชื่อคนที่จองให้)
 *   availability · bookings (จอง / ดูตั๋ว / ยืนยัน / ยกเลิก / ส่งตั๋วเข้าแชท)
 * ผู้จองเห็นและแก้ได้เฉพาะคิวที่ตัวเองจอง และผู้รับบริการที่อยู่ในรายชื่อของตัวเองเท่านั้น
 *
 * เลขบัตรประชาชน: เป็นของ "ผู้รับบริการ" (ลูกจองให้แม่ → กรอกเลขบัตรของแม่)
 *   หน้าเว็บได้เห็นแค่แบบปิดบัง (x-xxxx-xxxx9-87-6) ไม่ส่งเลขเต็มกลับไปที่มือถือ
 */
import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, withTx } from '../db.js';
import { ah, forbidden, notFound, conflict } from '../utils/errors.js';
import { requireLineUser, requireConsent } from '../middleware/auth.js';
import { getSettings, getSetting } from '../services/settings.js';
import { lineConfig } from '../services/line.js';
import { findOrCreatePatient, applyNationalId } from '../services/patients.js';
import { hashThaiId, maskThaiId } from '../utils/nationalId.js';
import * as booking from '../services/booking.js';
import { notifyAppointment } from '../services/notify.js';
import { audit } from '../services/audit.js';
import { patientInput, relationInput, idParam, codeParam, serviceTypeId, nationalIdInput } from './schemas.js';

export const publicRouter = Router();

// ---------------------------------------------------------------------
// ค่าที่หน้าเว็บต้องใช้ก่อนล็อกอิน
// ---------------------------------------------------------------------
publicRouter.get('/config', ah(async (req, res) => {
  const s = await getSettings(['clinic_name', 'counter_phone', 'advance_booking_days', 'patient_cancel_min', 'allow_same_day', 'show_price']);
  const [c, serviceTypes] = await Promise.all([lineConfig(), booking.listServiceTypes()]);
  res.json({
    clinic_name: s.clinic_name,
    counter_phone: s.counter_phone,
    advance_booking_days: s.advance_booking_days,
    allow_same_day: s.allow_same_day,
    patient_cancel_min: s.patient_cancel_min,
    // ปิด "แสดงราคา" → ตัดราคาออกตั้งแต่ backend (หน้าเว็บไม่ได้รับราคาเลย ไม่ใช่แค่ซ่อน)
    show_price: s.show_price,
    service_types: booking.publicServiceTypes(serviceTypes, s.show_price),
    mode: c.mode,
    liff_id: c.liffId,
    // แสดงลิงก์ "สำหรับเจ้าหน้าที่" เฉพาะเมื่อเปิดจากพอร์ต LAN (คนนอกที่เข้าผ่าน tunnel ไม่เห็น)
    staff_link: !!req.viaInternal,
  });
}));

// ทุก route ด้านล่างต้องมาจาก LINE (หรือผู้ใช้จำลองในโหมด LOCAL)
publicRouter.use(requireLineUser);

// ---------------------------------------------------------------------
// ข้อมูลผู้จอง + รายชื่อผู้รับบริการ
// ---------------------------------------------------------------------
async function myProfile(lineUserId) {
  const lu = await queryOne('SELECT * FROM line_users WHERE line_user_id = ?', [lineUserId]);
  const patients = await query(
    `SELECT p.patient_id, p.patient_type, p.hn, p.first_name, p.last_name, p.phone_number, bp.relation,
            p.national_id_last4, p.no_national_id, p.national_id_hash IS NOT NULL AS has_national_id,
            p.patient_id = ? AS is_self
       FROM booker_patients bp JOIN patients p ON p.patient_id = bp.patient_id
      WHERE bp.line_user_id = ? AND p.is_deleted = FALSE
      ORDER BY is_self DESC, bp.created_at`,
    [lu.self_patient_id ?? 0, lineUserId],
  );
  return {
    line_user_id: lu.line_user_id,
    display_name: lu.display_name,
    picture_url: lu.picture_url,
    consented: !!lu.pdpa_consent_at,
    self_patient_id: lu.self_patient_id,
    patients: patients.map(({ national_id_last4: l4, ...p }) => ({
      ...p, is_self: !!p.is_self, has_national_id: !!p.has_national_id, no_national_id: !!p.no_national_id,
      national_id_masked: maskThaiId(l4),
    })),
  };
}

publicRouter.get('/me', ah(async (req, res) => {
  res.json(await myProfile(req.lineUser.line_user_id));
}));

publicRouter.post('/me/consent', ah(async (req, res) => {
  await query('UPDATE line_users SET pdpa_consent_at = COALESCE(pdpa_consent_at, NOW()) WHERE line_user_id = ?', [req.lineUser.line_user_id]);
  await audit(req, 'CONSENT', 'line_users', req.lineUser.line_user_id);
  res.json(await myProfile(req.lineUser.line_user_id));
}));

/** ข้อมูลของตัวผู้จองเอง ("จองให้ตัวเอง") */
publicRouter.put('/me/self', requireConsent, ah(async (req, res) => {
  const input = patientInput.parse(req.body);
  const uid = req.lineUser.line_user_id;
  await withTx(async (conn) => {
    const patientId = await updateOrLink(conn, req.lineUser.self_patient_id, input, uid);
    await conn.query('UPDATE line_users SET self_patient_id = ? WHERE line_user_id = ?', [patientId, uid]);
    await conn.query(
      `INSERT INTO booker_patients (line_user_id, patient_id, relation) VALUES (?, ?, 'ตนเอง')
       ON DUPLICATE KEY UPDATE relation = 'ตนเอง'`, [uid, patientId],
    );
  });
  await audit(req, 'UPDATE_SELF', 'patients', null);
  res.json(await myProfile(uid));
}));

/** เพิ่มผู้รับบริการคนอื่น (เช่น มารดา) */
publicRouter.post('/me/patients', requireConsent, ah(async (req, res) => {
  const input = patientInput.parse(req.body);
  const relation = relationInput.parse(req.body.relation);
  const uid = req.lineUser.line_user_id;
  const patientId = await withTx(async (conn) => {
    const pid = await findOrCreatePatient(conn, input);
    await conn.query(
      `INSERT INTO booker_patients (line_user_id, patient_id, relation) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE relation = VALUES(relation)`, [uid, pid, relation],
    );
    return pid;
  });
  await audit(req, 'LINK_PATIENT', 'patients', patientId, { relation });
  res.status(201).json(await myProfile(uid));
}));

publicRouter.put('/me/patients/:id', requireConsent, ah(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const input = patientInput.parse(req.body);
  const relation = relationInput.parse(req.body.relation);
  const uid = req.lineUser.line_user_id;
  await assertLinked(uid, id);
  await withTx(async (conn) => {
    const pid = await updateOrLink(conn, id, input, uid);
    if (pid !== id) await conn.query('DELETE FROM booker_patients WHERE line_user_id = ? AND patient_id = ?', [uid, id]);
    await conn.query(
      `INSERT INTO booker_patients (line_user_id, patient_id, relation) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE relation = VALUES(relation)`, [uid, pid, relation],
    );
  });
  await audit(req, 'UPDATE_PATIENT', 'patients', id);
  res.json(await myProfile(uid));
}));

publicRouter.delete('/me/patients/:id', requireConsent, ah(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const uid = req.lineUser.line_user_id;
  if (req.lineUser.self_patient_id === id) throw conflict('IS_SELF', 'ลบข้อมูลของตัวเองไม่ได้');
  await query('DELETE FROM booker_patients WHERE line_user_id = ? AND patient_id = ?', [uid, id]);
  res.json(await myProfile(uid));
}));

async function assertLinked(uid, patientId) {
  const link = await queryOne('SELECT relation FROM booker_patients WHERE line_user_id = ? AND patient_id = ?', [uid, patientId]);
  if (!link) throw forbidden('ไม่พบผู้รับบริการนี้ในรายชื่อของคุณ');
  return link;
}

/**
 * แก้ข้อมูลผู้รับบริการ: ถ้า record นี้มีผู้จองคนอื่นผูกอยู่ด้วย หรือเปลี่ยน HN
 * → ไม่แก้ทับ แต่หา/สร้าง record ที่ตรงแทน (กันแก้ข้อมูลคนอื่น)
 * ถ้ากรอกเลขบัตรที่มีอยู่แล้วใน record อื่น (เช่น แม่เคยลงทะเบียนที่ kiosk) → ผูกกับ record นั้นแทน
 */
async function updateOrLink(conn, currentId, input, uid) {
  if (currentId && input.national_id) {
    const [[other]] = await conn.query(
      'SELECT patient_id FROM patients WHERE national_id_hash = ? AND patient_id <> ?', [hashThaiId(input.national_id), currentId],
    );
    if (other) return findOrCreatePatient(conn, input); // ตรวจชื่อให้ตรงก่อนผูก
  }
  if (currentId) {
    const [[cur]] = await conn.query('SELECT * FROM patients WHERE patient_id = ? FOR UPDATE', [currentId]);
    const [[{ others }]] = await conn.query(
      'SELECT COUNT(*) AS others FROM booker_patients WHERE patient_id = ? AND line_user_id <> ?', [currentId, uid],
    );
    if (cur && Number(others) === 0 && (cur.hn ?? null) === (input.hn ?? null)) {
      await conn.query(
        'UPDATE patients SET first_name = ?, last_name = ?, phone_number = ? WHERE patient_id = ?',
        [input.first_name, input.last_name, input.phone_number, currentId],
      );
      await applyNationalId(conn, currentId, input);
      return currentId;
    }
  }
  return findOrCreatePatient(conn, input);
}

// ---------------------------------------------------------------------
// รอบว่าง + จอง
// ---------------------------------------------------------------------
publicRouter.get('/availability', ah(async (_req, res) => {
  res.json({ days: await booking.getPublicAvailability() });
}));

const bookingBody = z.object({
  patient_id: z.coerce.number().int().positive(),
  slot_id: z.coerce.number().int().positive(),
  service_type_id: serviceTypeId,
  // ผู้รับบริการที่ยังไม่เคยกรอกเลขบัตร (เช่น ข้อมูลจาก v0.5) → กรอกมาพร้อมการจอง
  national_id: nationalIdInput,
  no_national_id: z.boolean().optional(),
  chief_complaint: z.string().trim().max(1000).optional().nullable(),
});

publicRouter.post('/bookings', requireConsent, ah(async (req, res) => {
  const body = bookingBody.parse(req.body);
  const uid = req.lineUser.line_user_id;
  const link = await assertLinked(uid, body.patient_id);
  const appt = await booking.createBooking({
    patientId: body.patient_id, slotId: body.slot_id, chiefComplaint: body.chief_complaint,
    serviceTypeId: body.service_type_id, identity: { national_id: body.national_id, no_national_id: body.no_national_id },
    channel: 'ONLINE', lineUserId: uid, relation: link.relation,
  });
  await audit(req, 'BOOK', 'appointments', appt.appointment_id, { code: appt.booking_code });
  res.status(201).json(toTicket(appt, await getSetting('show_price')));
}));

publicRouter.get('/bookings', ah(async (req, res) => {
  const scope = req.query.scope === 'past' ? 'past' : 'upcoming';
  const rows = await query(
    `SELECT * FROM v_appointment_details
      WHERE booked_by_line_user_id = ?
        AND ${scope === 'upcoming'
          ? "status IN ('BOOKED','CHECKED_IN','IN_SERVICE') AND slot_date >= CURDATE()"
          : "(status IN ('COMPLETED','NO_SHOW','CANCELLED') OR slot_date < CURDATE())"}
      ORDER BY slot_date ${scope === 'upcoming' ? 'ASC' : 'DESC'}, start_time
      LIMIT 50`,
    [req.lineUser.line_user_id],
  );
  const showPrice = await getSetting('show_price');
  res.json({ bookings: rows.map((r) => toTicket(r, showPrice)) });
}));

async function myAppointment(req) {
  const code = codeParam.parse(req.params.code);
  const appt = await booking.getAppointmentByCode(code);
  if (!appt || appt.booked_by_line_user_id !== req.lineUser.line_user_id) throw notFound('ไม่พบการจองนี้');
  return appt;
}

publicRouter.get('/bookings/:code', ah(async (req, res) => {
  const appt = await myAppointment(req);
  const r = await booking.bookingRules();
  const t = await booking.timing(appt.appointment_id);
  res.json({
    ...toTicket(appt, await getSetting('show_price')),
    can_cancel: appt.status === 'BOOKED' && t.mins_until >= r.patient_cancel_min,
    can_confirm: appt.status === 'BOOKED' && !appt.confirmed_at && t.mins_until > 0,
  });
}));

publicRouter.post('/bookings/:code/cancel', ah(async (req, res) => {
  const appt = await myAppointment(req);
  await booking.cancelByPatient(appt, req.lineUser.line_user_id);
  await audit(req, 'CANCEL', 'appointments', appt.appointment_id);
  res.json(toTicket(await booking.getAppointment(appt.appointment_id), await getSetting('show_price')));
}));

publicRouter.post('/bookings/:code/confirm', ah(async (req, res) => {
  const appt = await myAppointment(req);
  await booking.confirmByPatient(appt, req.lineUser.line_user_id);
  res.json(toTicket(await booking.getAppointment(appt.appointment_id), await getSetting('show_price')));
}));

/** หน้าเว็บส่งตั๋วเข้าแชทด้วย liff.sendMessages() สำเร็จ → บันทึกไว้ (ไม่กินโควตา push) */
publicRouter.post('/bookings/:code/liff-sent', ah(async (req, res) => {
  const appt = await myAppointment(req);
  await query(
    `INSERT IGNORE INTO notification_logs (appointment_id, line_user_id, type, channel, status)
     VALUES (?, ?, 'BOOKED', 'LIFF', 'SENT')`,
    [appt.appointment_id, req.lineUser.line_user_id],
  );
  res.json({ ok: true });
}));

/** fallback: ถ้า liff.sendMessages ใช้ไม่ได้ (เช่นเปิดนอกแชท) ให้ backend push แทน */
publicRouter.post('/bookings/:code/push-ticket', ah(async (req, res) => {
  const appt = await myAppointment(req);
  res.json(await notifyAppointment('BOOKED', appt.appointment_id));
}));

/** ข้อมูลตั๋วของผู้จอง — showPrice = false → ไม่ส่งราคา */
function toTicket(a, showPrice) {
  return {
    booking_code: a.booking_code,
    status: a.status,
    slot_date: a.slot_date,
    start_time: a.start_time?.slice(0, 5),
    end_time: a.end_time?.slice(0, 5),
    patient: { patient_id: a.patient_id, first_name: a.first_name, last_name: a.last_name, hn: a.hn },
    relation: a.booker_relation,
    chief_complaint: a.chief_complaint,
    service: a.service_type_id ? { name: a.service_name, price: showPrice && a.service_price != null ? Number(a.service_price) : null } : null,
    confirmed: !!a.confirmed_at,
    cancel_reason: a.cancel_reason,
    created_at: a.created_at,
  };
}
