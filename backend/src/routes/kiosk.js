/**
 * routes/kiosk.js — เครื่อง kiosk หน้าคลินิก (role KIOSK; ADMIN / DEV ใช้ทดสอบได้)
 *
 * เครื่อง kiosk ล็อกอินด้วยบัญชี KIOSK ครั้งเดียวตอนติดตั้ง แล้วเปิดหน้า /kiosk ค้างไว้
 * ผู้ป่วยใช้เองได้ 2 อย่าง:
 *   1) จองคิว walk-in เอง (ไม่ต้องมี LINE)
 *   2) เช็กอินด้วยรหัสจอง + เลข 4 ตัวท้ายเบอร์โทร (ยืนยันว่าเป็นเจ้าของคิวจริง)
 *
 * ข้อมูลที่ส่งกลับให้หน้าจอ kiosk ถูกปิดบังบางส่วน เพราะเป็นจอสาธารณะที่คนอื่นอาจเห็น
 *
 *   GET  /api/kiosk/config           ชื่อคลินิก / เบอร์เคาน์เตอร์ / เวลากลับหน้าแรก
 *   GET  /api/kiosk/availability     รอบว่าง (เริ่มวันนี้)
 *   POST /api/kiosk/patients/lookup  หาผู้รับบริการจากเบอร์โทร (ชื่อแบบปิดบัง + ต้องกรอกเลขบัตรไหม)
 *   POST /api/kiosk/bookings         จองคิว
 *   POST /api/kiosk/checkin          เช็กอินด้วยรหัสจอง
 */
import { Router } from 'express';
import { z } from 'zod';
import { query, withTx } from '../db.js';
import { ah, badRequest, conflict, notFound } from '../utils/errors.js';
import { requireRole } from '../middleware/auth.js';
import { getSettings } from '../services/settings.js';
import * as booking from '../services/booking.js';
import { findOrCreatePatient } from '../services/patients.js';
import { audit } from '../services/audit.js';
import { patientInput, codeParam, serviceTypeId, nationalIdInput } from './schemas.js';

export const kioskRouter = Router();
kioskRouter.use(requireRole('KIOSK'));

/** "สมศรี ใจดี" → "สมศรี ใ****" (ให้คนจำตัวเองได้ แต่คนข้าง ๆ ไม่เห็นนามสกุลเต็ม) */
const maskName = (first, last) => `${first} ${String(last).charAt(0)}${'*'.repeat(Math.max(2, Math.min(4, String(last).length - 1)))}`;

kioskRouter.get('/config', ah(async (_req, res) => {
  const s = await getSettings(['clinic_name', 'counter_phone', 'kiosk_idle_sec', 'checkin_early_min']);
  res.json({ ...s, service_types: await booking.listServiceTypes() });
}));

kioskRouter.get('/availability', ah(async (_req, res) => {
  res.json({ days: await booking.getPublicAvailability('KIOSK') });
}));

/** ค้นจากเบอร์โทร → ใช้ข้อมูลเดิม ไม่ต้องพิมพ์ชื่อใหม่ */
kioskRouter.post('/patients/lookup', ah(async (req, res) => {
  const phone = z.string().trim().regex(/^0\d{8,9}$/, 'เบอร์โทรไม่ถูกต้อง').parse(req.body?.phone_number);
  const rows = await query(
    `SELECT patient_id, first_name, last_name, hn IS NOT NULL AS has_hn,
            (national_id_hash IS NOT NULL OR no_national_id) AS has_identity
       FROM patients WHERE phone_number = ? AND is_deleted = FALSE
      ORDER BY updated_at DESC LIMIT 5`,
    [phone],
  );
  res.json({
    results: rows.map((p) => ({
      patient_id: p.patient_id, name: maskName(p.first_name, p.last_name), has_hn: !!p.has_hn,
      needs_national_id: !p.has_identity, // ยังไม่เคยกรอกเลขบัตร → หน้าจอขอเลขบัตรก่อนจอง
    })),
  });
}));

const kioskBookingBody = z.object({
  slot_id: z.coerce.number().int().positive(),
  // เลือกจากผลค้นเบอร์โทร (ต้องส่งเบอร์มาด้วยเพื่อยืนยันว่าเป็นคนเดียวกัน) หรือกรอกข้อมูลใหม่
  patient_id: z.coerce.number().int().positive().optional(),
  phone_number: z.string().trim().optional(),
  patient: patientInput.optional(),
  service_type_id: serviceTypeId,
  national_id: nationalIdInput,            // ผู้รับบริการเดิมที่ยังไม่มีเลขบัตร
  no_national_id: z.boolean().optional(),
  chief_complaint: z.string().trim().max(1000).optional().nullable(),
}).refine((b) => (b.patient_id && b.phone_number) || b.patient, { message: 'ต้องระบุผู้รับบริการ' });

kioskRouter.post('/bookings', ah(async (req, res) => {
  const b = kioskBookingBody.parse(req.body);
  let patientId = b.patient_id;
  if (patientId) {
    // กันการเดา patient_id: ต้องตรงกับเบอร์โทรที่กรอก
    const [ok] = await query('SELECT 1 AS x FROM patients WHERE patient_id = ? AND phone_number = ? AND is_deleted = FALSE', [patientId, b.phone_number]);
    if (!ok) throw badRequest('PATIENT_MISMATCH', 'ข้อมูลผู้รับบริการไม่ตรงกับเบอร์โทร');
  } else {
    patientId = await withTx((conn) => findOrCreatePatient(conn, b.patient));
  }
  const a = await booking.createBooking({
    patientId, slotId: b.slot_id, chiefComplaint: b.chief_complaint, channel: 'KIOSK', staffId: req.staff.user_id,
    serviceTypeId: b.service_type_id,
    identity: b.patient_id ? { national_id: b.national_id, no_national_id: b.no_national_id } : undefined,
  });
  await audit(req, 'KIOSK_BOOK', 'appointments', a.appointment_id, { code: a.booking_code });
  res.status(201).json(kioskTicket(a));
}));

const checkinBody = z.object({
  code: codeParam,
  phone_last4: z.string().trim().regex(/^\d{4}$/, 'กรอกเลข 4 ตัวท้ายของเบอร์โทร'),
});

kioskRouter.post('/checkin', ah(async (req, res) => {
  const b = checkinBody.parse(req.body);
  const a = await booking.getAppointmentByCode(b.code);
  // ข้อความเดียวกันทั้ง "ไม่พบรหัส" และ "เบอร์ไม่ตรง" → เดารหัสคนอื่นจากหน้าจอไม่ได้
  if (!a || !String(a.phone_number).endsWith(b.phone_last4)) throw notFound('รหัสจองหรือเบอร์โทรไม่ถูกต้อง');
  if (a.status === 'CHECKED_IN' || a.status === 'IN_SERVICE') throw conflict('ALREADY', 'คิวนี้เช็กอินแล้ว กรุณารอเรียกชื่อ');
  if (a.status !== 'BOOKED') throw conflict('INVALID_STATUS', 'คิวนี้เช็กอินไม่ได้ กรุณาติดต่อเคาน์เตอร์');
  try {
    // kiosk ไม่มีสิทธิ์ force — มาเร็ว/สายเกินกำหนดต้องไปเคาน์เตอร์
    await booking.checkIn(a, req.staff.user_id, false);
  } catch (err) {
    if (err.code === 'TOO_EARLY') {
      const { checkin_early_min: early } = await getSettings(['checkin_early_min']);
      throw conflict('TOO_EARLY', `ยังไม่ถึงเวลาเช็กอิน เช็กอินได้ตั้งแต่ ${early} นาทีก่อนเวลานัด (${a.start_time.slice(0, 5)} น.)`);
    }
    if (err.code === 'TOO_LATE') throw conflict('TOO_LATE', 'เลยเวลานัดแล้ว กรุณาติดต่อเจ้าหน้าที่ที่เคาน์เตอร์');
    if (err.code === 'NOT_TODAY') throw conflict('NOT_TODAY', `คิวนี้นัดวันที่ ${a.slot_date} ไม่ใช่วันนี้`);
    throw err;
  }
  await audit(req, 'KIOSK_CHECK_IN', 'appointments', a.appointment_id);
  res.json(kioskTicket(await booking.getAppointment(a.appointment_id)));
}));

/** ข้อมูลตั๋วสำหรับแสดงบน kiosk (ชื่อปิดบัง, ไม่มีเบอร์/HN) */
function kioskTicket(a) {
  return {
    booking_code: a.booking_code,
    status: a.status,
    slot_date: a.slot_date,
    start_time: a.start_time.slice(0, 5),
    end_time: a.end_time.slice(0, 5),
    name: maskName(a.first_name, a.last_name),
    service: a.service_name ? { name: a.service_name, price: a.service_price == null ? null : Number(a.service_price) } : null,
  };
}
