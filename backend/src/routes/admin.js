/**
 * routes/admin.js — API ผู้ดูแลระบบ (/api/admin/*, role ADMIN และ DEV)
 *   dashboard · settings (ยกเว้นหมวดการเชื่อมต่อ) · slot-templates · slots (ปิด/เปิดรับ)
 *   holidays · practitioners · users · patients · line-users · appointments · suspensions
 *   notification-templates · notification-logs · audit-logs · reports (ส่งออก Excel)
 *   service-types (ประเภทบริการ + ราคา) · bed_count / slots/:id/capacity (จำนวนเตียง)
 * ทุกการแก้ไขบันทึก audit log
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query, queryOne, withTx } from '../db.js';
import { ah, badRequest, conflict, notFound } from '../utils/errors.js';
import { requireRole } from '../middleware/auth.js';
import { listSettingsForAdmin, updateSetting, getSetting } from '../services/settings.js';
import { affectedAppointments, closeSlotsAndCancel, updateVisitInfo } from '../services/booking.js';
import { notifyAppointment } from '../services/notify.js';
import { generateSlots } from '../jobs/cron.js';
import { audit } from '../services/audit.js';
import { buildBookingReport } from '../services/report.js';
import { patientInput, idParam, dateStr, timeStr, vnInput, nationalIdInput } from './schemas.js';
import { setNationalId } from '../services/patients.js';
import { revealThaiId, maskThaiId } from '../utils/nationalId.js';
import { nidSearchHash } from './staff.js';
import { resetMfa } from '../services/mfa.js';
import { config } from '../config.js';

export const adminRouter = Router();
adminRouter.use(requireRole('ADMIN'));

const page = (req) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  return { limit, offset };
};

// =====================================================================
// Dashboard
// =====================================================================
/**
 * ข้อมูลหน้า Dashboard ของผู้ดูแล
 *  - today      : สรุปคิววันนี้ตามสถานะ + จำนวนรอบว่าง
 *  - next_days  : 7 วันข้างหน้า จำนวนรอบทั้งหมด / ถูกจอง (ดูว่าคิวแน่นแค่ไหน)
 *  - last30     : 30 วันที่ผ่านมา อัตรามาตามนัด / ไม่มา / ยกเลิก + เวลานวดเฉลี่ย
 *  - channels   : 30 วัน แยกตามช่องทางการจอง (LINE / kiosk / เคาน์เตอร์)
 *  - suspended_patients : จำนวนคนที่ถูกระงับสิทธิ์อยู่ตอนนี้
 */
adminRouter.get('/dashboard', ah(async (_req, res) => {
  const toNum = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v == null ? null : Number(v)]));

  // นับเป็น "ที่" (เตียง × รอบ) ไม่ใช่จำนวนรอบ
  const todaySlots = await queryOne(
    `SELECT COALESCE(SUM(capacity), 0) AS slots,
            COALESCE(SUM(IF(availability IN ('AVAILABLE','FULL'), remaining, 0)), 0) AS available
       FROM v_slot_availability WHERE slot_date = CURDATE()`,
  );
  const todayActive = await queryOne(
    `SELECT SUM(a.status = 'BOOKED')     AS booked,
            SUM(a.status = 'CHECKED_IN') AS checked_in,
            SUM(a.status = 'IN_SERVICE') AS in_service,
            SUM(a.status = 'COMPLETED')  AS completed
       FROM appointments a JOIN time_slots s ON s.slot_id = a.slot_id
      WHERE s.slot_date = CURDATE() AND a.active_slot_id IS NOT NULL`,
  );
  const today = { ...todaySlots, ...todayActive };
  const todayInactive = await queryOne(
    `SELECT SUM(a.status = 'NO_SHOW') AS no_show, SUM(a.status = 'CANCELLED') AS cancelled
       FROM appointments a JOIN time_slots s ON s.slot_id = a.slot_id WHERE s.slot_date = CURDATE()`,
  );
  const nextDays = await query(
    `SELECT v.slot_date AS date, SUM(v.capacity) AS slots,
            SUM(v.booked_count) AS booked,
            SUM(IF(v.is_blocked, v.capacity, 0)) AS blocked,
            MAX(h.name) AS holiday
       FROM v_slot_availability v
       LEFT JOIN holidays h ON h.holiday_date = v.slot_date
      WHERE v.slot_date BETWEEN CURDATE() AND CURDATE() + INTERVAL 6 DAY
      GROUP BY v.slot_date ORDER BY v.slot_date`,
  );
  const last30 = await queryOne(
    `SELECT COUNT(*) AS total,
            SUM(a.status = 'COMPLETED') AS completed,
            SUM(a.status = 'NO_SHOW')   AS no_show,
            SUM(a.status = 'CANCELLED') AS cancelled,
            ROUND(AVG(TIMESTAMPDIFF(MINUTE, sr.service_start, sr.service_end)), 0) AS avg_service_min,
            SUM(IF(a.status = 'COMPLETED', a.service_price, 0)) AS revenue
       FROM appointments a JOIN time_slots s ON s.slot_id = a.slot_id
       LEFT JOIN service_records sr ON sr.appointment_id = a.appointment_id
      WHERE s.slot_date BETWEEN CURDATE() - INTERVAL 30 DAY AND CURDATE() - INTERVAL 1 DAY`,
  );
  const channels = await query(
    `SELECT a.booking_channel AS channel, COUNT(*) AS n
       FROM appointments a JOIN time_slots s ON s.slot_id = a.slot_id
      WHERE s.slot_date BETWEEN CURDATE() - INTERVAL 30 DAY AND CURDATE() + INTERVAL 7 DAY
      GROUP BY a.booking_channel`,
  );
  const suspended = await queryOne(
    `SELECT COUNT(DISTINCT patient_id) AS n FROM patient_suspensions
      WHERE lifted_at IS NULL AND CURDATE() BETWEEN start_date AND end_date`,
  );
  res.json({
    today: { ...toNum(today), ...toNum(todayInactive) },
    next_days: nextDays.map(toNum).map((d, i) => ({ ...d, date: nextDays[i].date, holiday: nextDays[i].holiday })),
    last30: toNum(last30),
    channels: channels.map((c) => ({ channel: c.channel, n: Number(c.n) })),
    suspended_patients: Number(suspended.n),
  });
}));

// =====================================================================
// ตั้งค่าระบบ (กฎการจอง / ระงับสิทธิ์ / ทั่วไป)
// หมวด CONNECTION (LINE, โหมด) อยู่ที่เมนูนักพัฒนา /api/dev/connection เท่านั้น
// =====================================================================
adminRouter.get('/settings', ah(async (_req, res) => {
  const all = await listSettingsForAdmin();
  res.json({ settings: all.filter((s) => s.category !== 'CONNECTION') });
}));

adminRouter.put('/settings', ah(async (req, res) => {
  const body = z.record(z.string(), z.any()).parse(req.body);
  const current = await listSettingsForAdmin();
  if (body.bed_count !== undefined) {
    body.bed_count = z.coerce.number().int().min(1, 'อย่างน้อย 1 เตียง').max(50, 'ไม่เกิน 50 เตียง').parse(body.bed_count);
  }
  for (const [key, value] of Object.entries(body)) {
    const row = current.find((s) => s.key === key);
    if (!row) throw badRequest('UNKNOWN_SETTING', `ไม่รู้จักค่าตั้งค่า ${key}`);
    if (row.category === 'CONNECTION') throw badRequest('DEV_ONLY', 'ค่าการเชื่อมต่อแก้ได้ที่เมนูนักพัฒนา');
    await updateSetting(key, value);
  }
  let slotsUpdated;
  if (body.bed_count !== undefined) slotsUpdated = await applyBedCount(body.bed_count);
  await audit(req, 'UPDATE', 'settings', null, { keys: Object.keys(body), slots_updated: slotsUpdated });
  const all = await listSettingsForAdmin();
  res.json({ settings: all.filter((s) => s.category !== 'CONNECTION') });
}));

/**
 * เปลี่ยนจำนวนเตียง → ปรับทุกรอบตั้งแต่วันนี้เป็นต้นไป
 * รอบที่มีคิวมากกว่าจำนวนใหม่ จะคง capacity = จำนวนคิวที่มี (ไม่ยกเลิกคิวใคร)
 */
async function applyBedCount(beds) {
  const r = await query(
    `UPDATE time_slots s
       LEFT JOIN (SELECT active_slot_id AS sid, COUNT(*) AS n FROM appointments
                   WHERE active_slot_id IS NOT NULL GROUP BY active_slot_id) a ON a.sid = s.slot_id
        SET s.capacity = LEAST(50, GREATEST(?, COALESCE(a.n, 0)))
      WHERE s.slot_date >= CURDATE()`,
    [beds],
  );
  return r.affectedRows;
}

// =====================================================================
// ประเภทบริการ (นวดแผนไทย / นวดประคบ ...) + ราคา
// =====================================================================
const serviceTypeBody = z.object({
  name: z.string().trim().min(1, 'กรุณากรอกชื่อ').max(100),
  description: z.string().trim().max(255).optional().nullable(),
  price: z.coerce.number().min(0, 'ราคาต้องไม่ติดลบ').max(100000),
  sort_order: z.coerce.number().int().default(0),
  is_active: z.boolean().default(true),
});

adminRouter.get('/service-types', ah(async (_req, res) => {
  const rows = await query(
    `SELECT st.*, (SELECT COUNT(*) FROM appointments a WHERE a.service_type_id = st.service_type_id) AS used
       FROM service_types st ORDER BY st.sort_order, st.service_type_id`,
  );
  res.json({ service_types: rows.map((r) => ({ ...r, price: Number(r.price), used: Number(r.used), is_active: !!r.is_active })) });
}));

adminRouter.post('/service-types', ah(async (req, res) => {
  const b = serviceTypeBody.parse(req.body);
  const r = await query('INSERT INTO service_types (name, description, price, sort_order, is_active) VALUES (?, ?, ?, ?, ?)',
    [b.name, b.description ?? null, b.price, b.sort_order, b.is_active]);
  await audit(req, 'CREATE', 'service_types', r.insertId, b);
  res.status(201).json({ service_type_id: r.insertId });
}));

/** แก้ราคา → มีผลกับการจองใหม่เท่านั้น (คิวเดิมเก็บราคาตอนจองไว้แล้ว) */
adminRouter.put('/service-types/:id', ah(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const b = serviceTypeBody.parse(req.body);
  if (!b.is_active) {
    const others = await queryOne('SELECT COUNT(*) AS n FROM service_types WHERE is_active = TRUE AND service_type_id <> ?', [id]);
    if (!Number(others.n)) throw conflict('LAST_ACTIVE', 'ต้องเปิดใช้งานอย่างน้อย 1 ประเภท');
  }
  const r = await query('UPDATE service_types SET name = ?, description = ?, price = ?, sort_order = ?, is_active = ? WHERE service_type_id = ?',
    [b.name, b.description ?? null, b.price, b.sort_order, b.is_active, id]);
  if (!r.affectedRows) throw notFound();
  await audit(req, 'UPDATE', 'service_types', id, b);
  res.json({ ok: true });
}));

/** ลบได้เฉพาะประเภทที่ยังไม่เคยถูกจอง (ที่เคยใช้แล้ว → ปิดการใช้งานแทน เพื่อให้รายงานย้อนหลังยังมีชื่อ) */
adminRouter.delete('/service-types/:id', ah(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const used = await queryOne('SELECT COUNT(*) AS n FROM appointments WHERE service_type_id = ?', [id]);
  if (Number(used.n)) throw conflict('IN_USE', 'ประเภทนี้เคยถูกจองแล้ว ลบไม่ได้ ให้ปิดการใช้งานแทน');
  const others = await queryOne('SELECT COUNT(*) AS n FROM service_types WHERE is_active = TRUE AND service_type_id <> ?', [id]);
  if (!Number(others.n)) throw conflict('LAST_ACTIVE', 'ต้องเหลือประเภทที่เปิดใช้งานอย่างน้อย 1 ประเภท');
  await query('DELETE FROM service_types WHERE service_type_id = ?', [id]);
  await audit(req, 'DELETE', 'service_types', id);
  res.json({ ok: true });
}));

// =====================================================================
// แม่แบบรอบเวลา + slot
// =====================================================================
const templateBody = z.object({
  start_time: timeStr, end_time: timeStr,
  sort_order: z.coerce.number().int().default(0),
  is_active: z.boolean().default(true),
}).refine((b) => b.end_time > b.start_time, { message: 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม', path: ['end_time'] });

adminRouter.get('/slot-templates', ah(async (_req, res) => {
  res.json({ templates: await query('SELECT * FROM slot_templates ORDER BY sort_order, start_time') });
}));

adminRouter.post('/slot-templates', ah(async (req, res) => {
  const b = templateBody.parse(req.body);
  const r = await query('INSERT INTO slot_templates (start_time, end_time, sort_order, is_active) VALUES (?, ?, ?, ?)',
    [b.start_time, b.end_time, b.sort_order, b.is_active]);
  await audit(req, 'CREATE', 'slot_templates', r.insertId, b);
  res.status(201).json({ template_id: r.insertId });
}));

adminRouter.put('/slot-templates/:id', ah(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const b = templateBody.parse(req.body);
  const r = await query('UPDATE slot_templates SET start_time = ?, end_time = ?, sort_order = ?, is_active = ? WHERE template_id = ?',
    [b.start_time, b.end_time, b.sort_order, b.is_active, id]);
  if (!r.affectedRows) throw notFound();
  await audit(req, 'UPDATE', 'slot_templates', id, b);
  res.json({ ok: true });
}));

adminRouter.delete('/slot-templates/:id', ah(async (req, res) => {
  const id = idParam.parse(req.params.id);
  await query('DELETE FROM slot_templates WHERE template_id = ?', [id]);
  await audit(req, 'DELETE', 'slot_templates', id);
  res.json({ ok: true });
}));

/**
 * ใช้แม่แบบใหม่กับ slot ในอนาคต: ลบ slot ตั้งแต่พรุ่งนี้ที่ "ไม่เคยมีคิว" แล้วสร้างใหม่
 * slot ที่มีคิวอยู่แล้วจะไม่ถูกแตะ (แจ้งจำนวนกลับไป)
 */
adminRouter.post('/slot-templates/apply', ah(async (req, res) => {
  const result = await withTx(async (conn) => {
    const [del] = await conn.query(
      `DELETE s FROM time_slots s LEFT JOIN appointments a ON a.slot_id = s.slot_id
        WHERE s.slot_date > CURDATE() AND a.appointment_id IS NULL AND s.is_blocked = FALSE`,
    );
    const [[kept]] = await conn.query(
      'SELECT COUNT(DISTINCT s.slot_id) AS n FROM time_slots s JOIN appointments a ON a.slot_id = s.slot_id WHERE s.slot_date > CURDATE()',
    );
    return { removed: del.affectedRows, kept_with_bookings: Number(kept.n) };
  });
  const created = await generateSlots();
  await audit(req, 'APPLY_TEMPLATES', 'time_slots', null, { ...result, created });
  res.json({ ...result, created });
}));

adminRouter.post('/slots/generate', ah(async (req, res) => {
  const days = req.body?.days ? z.coerce.number().int().min(1).max(90).parse(req.body.days) : undefined;
  res.json({ created: await generateSlots(days) });
}));

adminRouter.get('/slots', ah(async (req, res) => {
  const from = dateStr.parse(req.query.from);
  const to = dateStr.parse(req.query.to ?? req.query.from);
  const rows = await query(
    'SELECT * FROM v_slot_availability WHERE slot_date BETWEEN ? AND ? ORDER BY slot_date, start_time',
    [from, to],
  );
  const appts = await query(
    `SELECT appointment_id, slot_id, booking_code, status, first_name, last_name, service_name
       FROM v_appointment_details
      WHERE slot_date BETWEEN ? AND ? AND status NOT IN ('CANCELLED','NO_SHOW')
      ORDER BY created_at`,
    [from, to],
  );
  res.json({
    slots: rows.map((r) => ({
      ...r, booked_count: Number(r.booked_count), remaining: Number(r.remaining),
      appointments: appts.filter((a) => a.slot_id === r.slot_id),
    })),
  });
}));

/** ปรับจำนวนเตียงของรอบเดียว (เช่น วันนี้หมอนวดลา 1 คน) — ต่ำกว่าจำนวนคิวที่จองแล้วไม่ได้ */
adminRouter.put('/slots/:id/capacity', ah(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const capacity = z.coerce.number().int().min(1, 'อย่างน้อย 1 เตียง').max(50).parse(req.body?.capacity);
  await withTx(async (conn) => {
    const [[slot]] = await conn.query('SELECT slot_id FROM time_slots WHERE slot_id = ? FOR UPDATE', [id]);
    if (!slot) throw notFound();
    const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM appointments WHERE active_slot_id = ?', [id]);
    if (capacity < Number(n)) throw conflict('BELOW_BOOKED', `รอบนี้มีคิวแล้ว ${n} คิว ลดจำนวนเตียงให้ต่ำกว่านี้ไม่ได้ (ยกเลิกคิวก่อน)`);
    await conn.query('UPDATE time_slots SET capacity = ? WHERE slot_id = ?', [capacity, id]);
  });
  await audit(req, 'SET_CAPACITY', 'time_slots', id, { capacity });
  res.json({ ok: true });
}));

/**
 * ปิดรอบ/ปิดทั้งวัน + ยกเลิกคิวพร้อมแจ้ง LINE
 * ครั้งแรกส่งโดยไม่มี confirm → ถ้ามีคิวจะได้ 409 HAS_BOOKINGS พร้อมรายชื่อ ให้ UI ถามยืนยัน
 */
async function closeWithNotify(req, { date, slotIds, blockReason, cancelReason, confirm, beforeClose }) {
  const affected = await affectedAppointments({ date, slotIds });
  if (affected.length && !confirm) {
    throw conflict('HAS_BOOKINGS', `มีผู้จองไว้แล้ว ${affected.length} คิว`, { appointments: affected });
  }
  const cancelledIds = await withTx(async (conn) => {
    if (beforeClose) await beforeClose(conn);
    return closeSlotsAndCancel(conn, { date, slotIds, blockReason, cancelReason });
  });
  const notified = [];
  for (const id of cancelledIds) {
    const r = await notifyAppointment('HOLIDAY_CANCELLED', id, { reason: cancelReason });
    notified.push({ appointment_id: id, ...r });
  }
  const needCall = affected.filter((a) => !a.has_line || notified.find((n) => n.appointment_id === a.appointment_id && n.status === 'FAILED'));
  await audit(req, 'CLOSE_SLOTS', 'time_slots', date ?? null, { slotIds, blockReason, cancelled: cancelledIds.length });
  return { cancelled: cancelledIds.length, notified, need_call: needCall };
}

const blockBody = z.object({
  date: dateStr,
  slot_ids: z.array(z.coerce.number().int().positive()).optional(),
  reason: z.string().trim().min(1).max(200),
  confirm: z.boolean().optional(),
});

adminRouter.post('/slots/block', ah(async (req, res) => {
  const b = blockBody.parse(req.body);
  res.json(await closeWithNotify(req, {
    date: b.date, slotIds: b.slot_ids, blockReason: b.reason, cancelReason: b.reason, confirm: b.confirm,
  }));
}));

adminRouter.post('/slots/unblock', ah(async (req, res) => {
  const b = z.object({ date: dateStr, slot_ids: z.array(z.coerce.number().int().positive()).optional() }).parse(req.body);
  const r = b.slot_ids?.length
    ? await query(`UPDATE time_slots SET is_blocked = FALSE, block_reason = NULL WHERE slot_id IN (${b.slot_ids.map(() => '?').join(',')})`, b.slot_ids)
    : await query('UPDATE time_slots SET is_blocked = FALSE, block_reason = NULL WHERE slot_date = ?', [b.date]);
  await audit(req, 'UNBLOCK', 'time_slots', b.date, b);
  res.json({ unblocked: r.affectedRows });
}));

// =====================================================================
// วันหยุด
// =====================================================================
adminRouter.get('/holidays', ah(async (req, res) => {
  const year = Number(req.query.year) || null;
  const rows = await query(
    `SELECT h.*, u.full_name AS created_by_name FROM holidays h LEFT JOIN staff_users u ON u.user_id = h.created_by
      ${year ? 'WHERE YEAR(h.holiday_date) = ?' : 'WHERE h.holiday_date >= CURDATE() - INTERVAL 30 DAY'}
      ORDER BY h.holiday_date`,
    year ? [year] : [],
  );
  res.json({ holidays: rows });
}));

/** ดูก่อนว่าวันนั้นมีคิวไหม (UI ใช้แสดงหน้าต่างเตือน) */
adminRouter.get('/holidays/preview', ah(async (req, res) => {
  const date = dateStr.parse(req.query.date);
  res.json({ appointments: await affectedAppointments({ date }) });
}));

const holidayBody = z.object({ date: dateStr, name: z.string().trim().min(1).max(200), confirm: z.boolean().optional() });

adminRouter.post('/holidays', ah(async (req, res) => {
  const b = holidayBody.parse(req.body);
  const exists = await queryOne('SELECT 1 FROM holidays WHERE holiday_date = ?', [b.date]);
  if (exists) throw conflict('DUPLICATE', 'วันนี้ถูกตั้งเป็นวันหยุดอยู่แล้ว');
  const result = await closeWithNotify(req, {
    date: b.date,
    blockReason: `วันหยุด: ${b.name}`,
    cancelReason: `ตรงกับวันหยุด (${b.name})`,
    confirm: b.confirm,
    beforeClose: (conn) => conn.query('INSERT INTO holidays (holiday_date, name, created_by) VALUES (?, ?, ?)', [b.date, b.name, req.staff.user_id]),
  });
  await audit(req, 'CREATE', 'holidays', b.date, b);
  res.status(201).json(result);
}));

adminRouter.put('/holidays/:date', ah(async (req, res) => {
  const date = dateStr.parse(req.params.date);
  const name = z.string().trim().min(1).max(200).parse(req.body?.name);
  const r = await query('UPDATE holidays SET name = ? WHERE holiday_date = ?', [name, date]);
  if (!r.affectedRows) throw notFound();
  await query("UPDATE time_slots SET block_reason = ? WHERE slot_date = ? AND block_reason LIKE 'วันหยุด:%'", [`วันหยุด: ${name}`, date]);
  await audit(req, 'UPDATE', 'holidays', date, { name });
  res.json({ ok: true });
}));

/** ลบวันหยุด → ปลดบล็อก slot ที่ถูกบล็อกเพราะวันหยุด + สร้าง slot ถ้ายังไม่มี (คิวที่ยกเลิกไปแล้วจะไม่กลับมา) */
adminRouter.delete('/holidays/:date', ah(async (req, res) => {
  const date = dateStr.parse(req.params.date);
  const r = await query('DELETE FROM holidays WHERE holiday_date = ?', [date]);
  if (!r.affectedRows) throw notFound();
  await query("UPDATE time_slots SET is_blocked = FALSE, block_reason = NULL WHERE slot_date = ? AND block_reason LIKE 'วันหยุด:%'", [date]);
  const created = await generateSlots();
  await audit(req, 'DELETE', 'holidays', date);
  res.json({ ok: true, slots_created: created });
}));

// =====================================================================
// หมอนวด
// =====================================================================
const practitionerBody = z.object({
  full_name: z.string().trim().min(1).max(200),
  license_no: z.string().trim().max(50).optional().nullable(),
  is_active: z.boolean().default(true),
});

adminRouter.get('/practitioners', ah(async (_req, res) => {
  res.json({ practitioners: await query('SELECT * FROM practitioners ORDER BY practitioner_id') });
}));
adminRouter.post('/practitioners', ah(async (req, res) => {
  const b = practitionerBody.parse(req.body);
  const r = await query('INSERT INTO practitioners (full_name, license_no, is_active) VALUES (?, ?, ?)', [b.full_name, b.license_no ?? null, b.is_active]);
  await audit(req, 'CREATE', 'practitioners', r.insertId, b);
  res.status(201).json({ practitioner_id: r.insertId });
}));
adminRouter.put('/practitioners/:id', ah(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const b = practitionerBody.parse(req.body);
  await query('UPDATE practitioners SET full_name = ?, license_no = ?, is_active = ? WHERE practitioner_id = ?', [b.full_name, b.license_no ?? null, b.is_active, id]);
  await audit(req, 'UPDATE', 'practitioners', id, b);
  res.json({ ok: true });
}));
adminRouter.delete('/practitioners/:id', ah(async (req, res) => {
  const id = idParam.parse(req.params.id);
  await query('DELETE FROM practitioners WHERE practitioner_id = ?', [id]); // มี slot แล้วจะลบไม่ได้ → ใช้ปิดการใช้งานแทน
  await audit(req, 'DELETE', 'practitioners', id);
  res.json({ ok: true });
}));

// =====================================================================
// ผู้ใช้ระบบ
// =====================================================================
const userBody = z.object({
  username: z.string().trim().min(3).max(50).regex(/^[a-zA-Z0-9._-]+$/, 'ใช้ได้เฉพาะ a-z 0-9 . _ -'),
  full_name: z.string().trim().min(1).max(200),
  role: z.enum(['DEV', 'ADMIN', 'STAFF', 'PRACTITIONER', 'KIOSK']),
  practitioner_id: z.coerce.number().int().positive().optional().nullable(),
  is_active: z.boolean().default(true),
  // บังคับ 2FA รายคน (STAFF / PRACTITIONER) — ADMIN/DEV บังคับตาม MFA_REQUIRED_ROLES อยู่แล้ว, KIOSK ไม่ใช้
  totp_required: z.boolean().optional(), // ไม่ส่งมา = ไม่เปลี่ยน
}).refine((b) => b.role !== 'PRACTITIONER' || b.practitioner_id, { message: 'บัญชีหมอนวดต้องเลือกหมอนวด', path: ['practitioner_id'] });

/**
 * ADMIN จัดการบัญชี DEV ไม่ได้ (สร้าง / แก้ / ตั้ง role เป็น DEV / รีเซ็ตรหัส) — เฉพาะ DEV ด้วยกันเท่านั้น
 * @param {import('express').Request} req
 * @param {string|null} newRole  role ที่จะตั้ง (null = ไม่เปลี่ยน role เช่นรีเซ็ตรหัส)
 * @param {number|null} targetId บัญชีเป้าหมาย (null = สร้างใหม่)
 */
async function guardDevAccounts(req, newRole, targetId) {
  if (req.staff.role === 'DEV') return;
  const target = targetId ? await queryOne('SELECT role FROM staff_users WHERE user_id = ?', [targetId]) : null;
  if (newRole === 'DEV' || target?.role === 'DEV') throw badRequest('DEV_ONLY', 'บัญชีนักพัฒนาจัดการได้โดยนักพัฒนาเท่านั้น');
}

/**
 * รายชื่อบัญชี + สถานะ 2FA
 *   mfa_state: ENABLED = ผูกแอปแล้ว · PENDING = ต้องใช้แต่ยังไม่ผูก (จะได้ QR ตอนล็อกอินครั้งถัดไป) · OFF = ไม่ใช้
 */
adminRouter.get('/users', ah(async (_req, res) => {
  const rows = await query(
    `SELECT u.user_id, u.username, u.full_name, u.role, u.practitioner_id, u.is_active, u.must_change_password,
            u.last_login_at, u.created_at, u.totp_required, u.totp_enabled_at,
            (SELECT COUNT(*) FROM staff_recovery_codes rc WHERE rc.user_id = u.user_id AND rc.used_at IS NULL) AS recovery_left
       FROM staff_users u ORDER BY u.role, u.username`,
  );
  const roles = config.mfaRequiredRoles;
  res.json({
    mfa_required_roles: roles,
    users: rows.map(({ totp_enabled_at: enabledAt, ...u }) => {
      const requiredByRole = u.role !== 'KIOSK' && roles.includes(u.role);
      const required = u.role !== 'KIOSK' && (requiredByRole || !!u.totp_required);
      return {
        ...u,
        totp_required: !!u.totp_required,
        mfa_required_by_role: requiredByRole,
        mfa_enabled_at: enabledAt,
        mfa_state: enabledAt ? 'ENABLED' : required ? 'PENDING' : 'OFF',
        recovery_left: Number(u.recovery_left),
      };
    }),
  });
}));

adminRouter.post('/users', ah(async (req, res) => {
  const b = userBody.parse(req.body);
  const password = z.string().min(8, 'รหัสผ่านอย่างน้อย 8 ตัวอักษร').parse(req.body.password);
  await guardDevAccounts(req, b.role, null);
  const r = await query(
    `INSERT INTO staff_users (username, password_hash, full_name, role, practitioner_id, is_active, must_change_password, totp_required)
     VALUES (?, ?, ?, ?, ?, ?, TRUE, ?)`,
    [b.username, await bcrypt.hash(password, 10), b.full_name, b.role, b.role === 'PRACTITIONER' ? b.practitioner_id : null, b.is_active,
      b.role !== 'KIOSK' && !!b.totp_required],
  );
  await audit(req, 'CREATE', 'staff_users', r.insertId, { username: b.username, role: b.role });
  res.status(201).json({ user_id: r.insertId });
}));

adminRouter.put('/users/:id', ah(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const b = userBody.parse(req.body);
  await guardDevAccounts(req, b.role, id);
  // กันล็อกตัวเองออกจากระบบ: ห้ามปิดบัญชีตัวเอง / ห้ามเปลี่ยน role ตัวเอง
  if (id === req.staff.user_id && (!b.is_active || b.role !== req.staff.role)) {
    throw badRequest('SELF_LOCKOUT', 'ปิดใช้งานหรือเปลี่ยนสิทธิ์บัญชีตัวเองไม่ได้');
  }
  const before = await queryOne('SELECT totp_required FROM staff_users WHERE user_id = ?', [id]);
  if (!before) throw notFound();
  const totpRequired = b.role !== 'KIOSK' && (b.totp_required ?? !!before.totp_required);
  // เพิ่งเปิด "บังคับ 2FA" → ตัด session ปัจจุบัน ให้ไปผูกแอปตอนล็อกอินใหม่ทันที (ไม่ต้องรอ session หมดอายุ)
  const bump = totpRequired && !before.totp_required && id !== req.staff.user_id;
  await query(
    `UPDATE staff_users SET username = ?, full_name = ?, role = ?, practitioner_id = ?, is_active = ?, totp_required = ?,
            session_version = session_version + ? WHERE user_id = ?`,
    [b.username, b.full_name, b.role, b.role === 'PRACTITIONER' ? b.practitioner_id : null, b.is_active, totpRequired, bump ? 1 : 0, id],
  );
  await audit(req, 'UPDATE', 'staff_users', id, { role: b.role, is_active: b.is_active, totp_required: totpRequired });
  res.json({ ok: true });
}));

adminRouter.post('/users/:id/reset-password', ah(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const password = z.string().min(8, 'รหัสผ่านอย่างน้อย 8 ตัวอักษร').parse(req.body?.password);
  await guardDevAccounts(req, null, id);
  // ตัด session เดิมทุกเครื่องด้วย (กรณีรหัสหลุด)
  await query('UPDATE staff_users SET password_hash = ?, must_change_password = TRUE, session_version = session_version + 1 WHERE user_id = ?',
    [await bcrypt.hash(password, 10), id]);
  await audit(req, 'RESET_PASSWORD', 'staff_users', id);
  res.json({ ok: true });
}));

/**
 * รีเซ็ต 2FA (มือถือหาย / เปลี่ยนเครื่อง / ลบแอปไปแล้ว)
 *   ล้างกุญแจเดิม + รหัสสำรอง → แอปในมือถือเครื่องเก่าใช้ไม่ได้ทันที
 *   ตัด session ทุกเครื่องของบัญชีนั้น → ล็อกอินครั้งถัดไปจะได้ QR ใหม่ (ถ้ายังถูกบังคับใช้ 2FA)
 */
adminRouter.post('/users/:id/reset-mfa', ah(async (req, res) => {
  const id = idParam.parse(req.params.id);
  await guardDevAccounts(req, null, id);
  const target = await queryOne('SELECT username FROM staff_users WHERE user_id = ?', [id]);
  if (!target) throw notFound();
  await resetMfa(id);
  await audit(req, 'RESET_MFA', 'staff_users', id, { username: target.username, reason: z.string().trim().max(200).optional().parse(req.body?.reason) });
  res.json({ ok: true, self: id === req.staff.user_id });
}));

// =====================================================================
// ผู้รับบริการ
// =====================================================================
adminRouter.get('/patients', ah(async (req, res) => {
  const { limit, offset } = page(req);
  const q = String(req.query.q ?? '').trim();
  const like = `%${q}%`;
  const where = q ? "AND (p.hn = ? OR p.phone_number LIKE ? OR CONCAT(p.first_name, ' ', p.last_name) LIKE ? OR p.national_id_hash = ?)" : '';
  const params = q ? [q.toUpperCase(), like, like, nidSearchHash(q)] : [];
  const rows = await query(
    `SELECT p.*,
            (SELECT COUNT(*) FROM appointments a WHERE a.patient_id = p.patient_id) AS total_bookings,
            (SELECT COUNT(*) FROM appointments a WHERE a.patient_id = p.patient_id AND a.status = 'NO_SHOW') AS no_shows,
            (SELECT MAX(end_date) FROM patient_suspensions ps
              WHERE ps.patient_id = p.patient_id AND ps.lifted_at IS NULL AND CURDATE() BETWEEN ps.start_date AND ps.end_date) AS suspended_until
       FROM patients p
      WHERE p.is_deleted = FALSE ${where}
      ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const total = await queryOne(`SELECT COUNT(*) AS n FROM patients p WHERE p.is_deleted = FALSE ${where}`, params);
  res.json({ patients: rows.map(safePatient), total: Number(total.n) });
}));

adminRouter.get('/patients/:id', ah(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const row = await queryOne('SELECT * FROM patients WHERE patient_id = ?', [id]);
  if (!row) throw notFound();
  // หน้ารายละเอียด/แก้ไขของแอดมินเห็นเลขบัตรเต็ม → บันทึกทุกครั้งที่เปิดดู (PDPA)
  const patient = { ...safePatient(row), national_id: revealThaiId(row.national_id_enc) };
  if (patient.national_id) await audit(req, 'VIEW_NATIONAL_ID', 'patients', id);
  const [appointments, bookers, suspensions] = await Promise.all([
    query('SELECT * FROM v_appointment_details WHERE patient_id = ? ORDER BY slot_date DESC, start_time DESC LIMIT 100', [id]),
    query(`SELECT bp.relation, lu.line_user_id, lu.display_name FROM booker_patients bp
             JOIN line_users lu ON lu.line_user_id = bp.line_user_id WHERE bp.patient_id = ?`, [id]),
    query('SELECT * FROM patient_suspensions WHERE patient_id = ? ORDER BY created_at DESC', [id]),
  ]);
  res.json({ patient, appointments, bookers, suspensions });
}));

/** ไม่ส่งค่าที่เข้ารหัส/hash ออกไป — ส่งแค่ว่ามีไหม + แบบปิดบัง */
function safePatient({ national_id_enc: _e, national_id_hash: hash, national_id_last4: l4, ...p }) {
  return { ...p, has_national_id: !!hash, no_national_id: !!p.no_national_id, national_id_masked: maskThaiId(l4) };
}

const adminPatientBody = patientInput.extend({ note: z.string().trim().max(255).optional().nullable() });

/** เลขบัตร: กรอก = ตั้ง/เปลี่ยน, ติ๊ก "ไม่มีบัตรไทย" = ลบเลขเดิม, ว่าง = ไม่แตะ */
async function saveAdminIdentity(conn, id, b) {
  if (b.no_national_id && !b.national_id) {
    await setNationalId(conn, id, null);
    await conn.query('UPDATE patients SET no_national_id = TRUE WHERE patient_id = ?', [id]);
  } else if (b.national_id) {
    await setNationalId(conn, id, b.national_id);
  }
}

adminRouter.post('/patients', ah(async (req, res) => {
  const b = adminPatientBody.parse(req.body);
  if (!b.national_id && !b.no_national_id) {
    throw badRequest('NID_REQUIRED', 'กรุณากรอกเลขบัตรประชาชน หรือเลือก "ไม่มีบัตรประชาชนไทย"', { fields: { national_id: ['กรุณากรอกเลขบัตรประชาชน'] } });
  }
  const patientId = await withTx(async (conn) => {
    const [r] = await conn.query(
      'INSERT INTO patients (patient_type, hn, first_name, last_name, phone_number, note) VALUES (?, ?, ?, ?, ?, ?)',
      [b.hn ? 'HN' : 'GENERAL', b.hn, b.first_name, b.last_name, b.phone_number, b.note ?? null],
    );
    await saveAdminIdentity(conn, r.insertId, b);
    return r.insertId;
  });
  await audit(req, 'CREATE', 'patients', patientId);
  res.status(201).json({ patient_id: patientId });
}));

adminRouter.put('/patients/:id', ah(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const b = adminPatientBody.parse(req.body);
  await withTx(async (conn) => {
    await conn.query(
      'UPDATE patients SET patient_type = ?, hn = ?, first_name = ?, last_name = ?, phone_number = ?, note = ? WHERE patient_id = ?',
      [b.hn ? 'HN' : 'GENERAL', b.hn, b.first_name, b.last_name, b.phone_number, b.note ?? null, id],
    );
    await saveAdminIdentity(conn, id, b);
  });
  await audit(req, 'UPDATE', 'patients', id, { national_id_changed: !!b.national_id });
  res.json({ ok: true });
}));

/** soft delete — ประวัติการจองยังอยู่ */
adminRouter.delete('/patients/:id', ah(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const active = await queryOne(
    "SELECT COUNT(*) AS n FROM appointments WHERE patient_id = ? AND status IN ('BOOKED','CHECKED_IN','IN_SERVICE')", [id],
  );
  if (Number(active.n)) throw conflict('HAS_ACTIVE', 'ผู้รับบริการนี้ยังมีคิวที่ยังไม่เสร็จ');
  await query('UPDATE patients SET is_deleted = TRUE WHERE patient_id = ?', [id]);
  await audit(req, 'DELETE', 'patients', id);
  res.json({ ok: true });
}));

// =====================================================================
// ผู้จอง (บัญชี LINE)
// =====================================================================
adminRouter.get('/line-users', ah(async (req, res) => {
  const { limit, offset } = page(req);
  const rows = await query(
    `SELECT lu.*, COUNT(bp.patient_id) AS linked_patients,
            GROUP_CONCAT(CONCAT(p.first_name, ' ', p.last_name, ' (', bp.relation, ')') SEPARATOR ', ') AS patients
       FROM line_users lu
       LEFT JOIN booker_patients bp ON bp.line_user_id = lu.line_user_id
       LEFT JOIN patients p ON p.patient_id = bp.patient_id
      GROUP BY lu.line_user_id ORDER BY lu.last_seen_at DESC LIMIT ? OFFSET ?`,
    [limit, offset],
  );
  res.json({ line_users: rows });
}));

adminRouter.put('/line-users/:id/block', ah(async (req, res) => {
  const blocked = z.boolean().parse(req.body?.blocked);
  await query('UPDATE line_users SET is_blocked = ? WHERE line_user_id = ?', [blocked, req.params.id]);
  await audit(req, blocked ? 'BLOCK' : 'UNBLOCK', 'line_users', req.params.id);
  res.json({ ok: true });
}));

adminRouter.delete('/line-users/:id/patients/:pid', ah(async (req, res) => {
  const pid = idParam.parse(req.params.pid);
  await query('DELETE FROM booker_patients WHERE line_user_id = ? AND patient_id = ?', [req.params.id, pid]);
  await query('UPDATE line_users SET self_patient_id = NULL WHERE line_user_id = ? AND self_patient_id = ?', [req.params.id, pid]);
  await audit(req, 'UNLINK', 'booker_patients', req.params.id, { patient_id: pid });
  res.json({ ok: true });
}));

// =====================================================================
// การจอง (ดู/แก้สถานะด้วยมือ)
// =====================================================================
adminRouter.get('/appointments', ah(async (req, res) => {
  const { limit, offset } = page(req);
  const conds = [];
  const params = [];
  if (req.query.from) { conds.push('slot_date >= ?'); params.push(dateStr.parse(req.query.from)); }
  if (req.query.to) { conds.push('slot_date <= ?'); params.push(dateStr.parse(req.query.to)); }
  if (req.query.status) { conds.push('status = ?'); params.push(String(req.query.status)); }
  if (req.query.practitioner_id) { conds.push('practitioner_id = ?'); params.push(idParam.parse(req.query.practitioner_id)); }
  if (req.query.q) {
    const q = String(req.query.q).trim();
    conds.push("(booking_code = ? OR hn = ? OR vn = ? OR phone_number LIKE ? OR CONCAT(first_name, ' ', last_name) LIKE ? OR patient_id IN (SELECT patient_id FROM patients WHERE national_id_hash = ?))");
    params.push(q.toUpperCase(), q.toUpperCase(), q.toUpperCase(), `%${q}%`, `%${q}%`, nidSearchHash(q));
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = await query(`SELECT * FROM v_appointment_details ${where} ORDER BY slot_date DESC, start_time LIMIT ? OFFSET ?`, [...params, limit, offset]);
  const total = await queryOne(`SELECT COUNT(*) AS n FROM v_appointment_details ${where}`, params);
  res.json({ appointments: rows, total: Number(total.n) });
}));

const STATUSES = ['BOOKED', 'CHECKED_IN', 'IN_SERVICE', 'COMPLETED', 'NO_SHOW', 'CANCELLED'];

adminRouter.patch('/appointments/:id', ah(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const b = z.object({
    status: z.enum(STATUSES).optional(),
    chief_complaint: z.string().trim().max(1000).optional().nullable(),
    cancel_reason: z.string().trim().max(255).optional().nullable(),
    vn: vnInput,
    practitioner_id: z.coerce.number().int().positive().optional().nullable(),
    service_type_id: z.coerce.number().int().positive().optional(),
  }).parse(req.body);
  const sets = [];
  const params = [];
  if (b.vn !== undefined) { sets.push('vn = ?'); params.push(b.vn); }
  if (b.practitioner_id !== undefined) { sets.push('practitioner_id = ?'); params.push(b.practitioner_id); }
  if (b.status) {
    sets.push('status = ?'); params.push(b.status);
    if (b.status === 'CANCELLED') { sets.push("cancelled_at = COALESCE(cancelled_at, NOW()), cancelled_by = 'STAFF', cancel_reason = ?"); params.push(b.cancel_reason ?? 'แอดมินแก้สถานะ'); }
  }
  if (b.chief_complaint !== undefined) { sets.push('chief_complaint = ?'); params.push(b.chief_complaint); }
  if (!sets.length && !b.service_type_id) throw badRequest('NOTHING', 'ไม่มีข้อมูลที่จะแก้');
  await withTx(async (conn) => {
    const [[cur]] = await conn.query('SELECT slot_id, status FROM appointments WHERE appointment_id = ?', [id]);
    if (!cur) throw notFound();
    // คิวที่ยกเลิก/ไม่มา กลับมา active → ต้องมีที่ว่างในรอบนั้น (ล็อกแถว slot ก่อนนับ)
    const reviving = b.status && !['CANCELLED', 'NO_SHOW'].includes(b.status) && ['CANCELLED', 'NO_SHOW'].includes(cur.status);
    if (reviving) {
      const [[slot]] = await conn.query('SELECT capacity FROM time_slots WHERE slot_id = ? FOR UPDATE', [cur.slot_id]);
      const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM appointments WHERE active_slot_id = ?', [cur.slot_id]);
      if (Number(n) >= slot.capacity) throw conflict('SLOT_TAKEN', 'เปลี่ยนสถานะไม่ได้ เพราะรอบนี้เต็มแล้ว');
    }
    if (sets.length) await conn.query(`UPDATE appointments SET ${sets.join(', ')} WHERE appointment_id = ?`, [...params, id]);
    if (b.service_type_id) await updateVisitInfo(conn, id, { service_type_id: b.service_type_id });
  });
  await audit(req, 'UPDATE', 'appointments', id, b);
  res.json({ ok: true });
}));

// =====================================================================
// ระงับสิทธิ์
// =====================================================================
adminRouter.get('/suspensions', ah(async (req, res) => {
  const activeOnly = req.query.all !== '1';
  const rows = await query(
    `SELECT ps.*, p.first_name, p.last_name, p.hn, p.phone_number,
            (lifted_at IS NULL AND CURDATE() BETWEEN start_date AND end_date) AS is_active
       FROM patient_suspensions ps JOIN patients p ON p.patient_id = ps.patient_id
      ${activeOnly ? 'WHERE ps.lifted_at IS NULL AND ps.end_date >= CURDATE()' : ''}
      ORDER BY ps.created_at DESC LIMIT 200`,
  );
  res.json({ suspensions: rows });
}));

adminRouter.post('/suspensions', ah(async (req, res) => {
  const b = z.object({
    patient_id: z.coerce.number().int().positive(),
    days: z.coerce.number().int().min(1).max(365).optional(),
    reason: z.string().trim().min(1).max(255),
  }).parse(req.body);
  const days = b.days ?? (await getSetting('suspend_days'));
  const r = await query(
    `INSERT INTO patient_suspensions (patient_id, start_date, end_date, reason, source, created_by)
     VALUES (?, CURDATE(), CURDATE() + INTERVAL ? DAY, ?, 'MANUAL', ?)`,
    [b.patient_id, days, b.reason, req.staff.user_id],
  );
  await audit(req, 'SUSPEND', 'patients', b.patient_id, { days, reason: b.reason });
  res.status(201).json({ suspension_id: r.insertId });
}));

adminRouter.post('/suspensions/:id/lift', ah(async (req, res) => {
  const id = idParam.parse(req.params.id);
  await query('UPDATE patient_suspensions SET lifted_at = NOW(), lifted_by = ? WHERE suspension_id = ? AND lifted_at IS NULL', [req.staff.user_id, id]);
  await audit(req, 'LIFT_SUSPENSION', 'patient_suspensions', id);
  res.json({ ok: true });
}));

// =====================================================================
// ข้อความแจ้งเตือน + log
// =====================================================================
adminRouter.get('/notification-templates', ah(async (_req, res) => {
  res.json({ templates: await query("SELECT * FROM notification_templates ORDER BY FIELD(type, 'BOOKED','REMIND_1D','REMIND_2H','CANCELLED','HOLIDAY_CANCELLED','SUSPENDED')") });
}));

adminRouter.put('/notification-templates/:type', ah(async (req, res) => {
  const b = z.object({
    title: z.string().trim().min(1).max(100),
    body: z.string().trim().min(1).max(2000),
    is_enabled: z.boolean(),
  }).parse(req.body);
  const r = await query('UPDATE notification_templates SET title = ?, body = ?, is_enabled = ? WHERE type = ?', [b.title, b.body, b.is_enabled, req.params.type]);
  if (!r.affectedRows) throw notFound();
  await audit(req, 'UPDATE', 'notification_templates', req.params.type, { is_enabled: b.is_enabled });
  res.json({ ok: true });
}));

adminRouter.get('/notification-logs', ah(async (req, res) => {
  const { limit, offset } = page(req);
  const rows = await query(
    `SELECT nl.*, a.booking_code FROM notification_logs nl
       LEFT JOIN appointments a ON a.appointment_id = nl.appointment_id
      ORDER BY nl.sent_at DESC LIMIT ? OFFSET ?`,
    [limit, offset],
  );
  const month = await queryOne(
    `SELECT SUM(channel = 'PUSH' AND status = 'SENT') AS push_sent, SUM(channel = 'LIFF') AS liff_sent,
            SUM(status = 'FAILED') AS failed, SUM(status = 'SKIPPED') AS skipped
       FROM notification_logs WHERE sent_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`,
  );
  res.json({ logs: rows, month: Object.fromEntries(Object.entries(month).map(([k, v]) => [k, Number(v ?? 0)])) });
}));

// =====================================================================
// Audit log
// =====================================================================
adminRouter.get('/audit-logs', ah(async (req, res) => {
  const { limit, offset } = page(req);
  res.json({ logs: await query('SELECT * FROM audit_logs ORDER BY audit_id DESC LIMIT ? OFFSET ?', [limit, offset]) });
}));

// =====================================================================
// รายงาน (ส่งออก Excel)
// =====================================================================
/**
 * GET /api/admin/reports/bookings.xlsx?from=YYYY-MM-DD&to=YYYY-MM-DD&mask_phone=1&practitioner_id=2
 * ดาวน์โหลดไฟล์ Excel รายงานการจอง (สรุป / รายวัน / รายการจอง / ผู้รับบริการ) — ดู services/report.js
 *  - ช่วงวันที่ไม่เกิน 366 วัน
 *  - mask_phone=1 → ปิดบังเบอร์โทร (081-xxx-5678) และเลขบัตรประชาชน
 *  - practitioner_id → เฉพาะคิวที่หมอนวดคนนั้นนวด
 *  - ไฟล์มีข้อมูลส่วนบุคคล → บันทึก audit log ทุกครั้งที่ดาวน์โหลด (PDPA)
 */
adminRouter.get('/reports/bookings.xlsx', ah(async (req, res) => {
  const q = z.object({
    from: dateStr,
    to: dateStr,
    mask_phone: z.enum(['0', '1']).optional(),
    practitioner_id: z.coerce.number().int().positive().optional(),
  }).parse(req.query);
  if (q.from > q.to) throw badRequest('BAD_RANGE', 'วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด');
  const days = (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000;
  if (days > 366) throw badRequest('RANGE_TOO_LONG', 'เลือกช่วงวันที่ได้ไม่เกิน 1 ปี');

  const { workbook, filename, count } = await buildBookingReport({
    from: q.from, to: q.to, maskPhone: q.mask_phone === '1', practitionerId: q.practitioner_id ?? null, generatedBy: req.staff.full_name,
  });
  await audit(req, 'EXPORT_REPORT', 'appointments', null, {
    from: q.from, to: q.to, rows: count, mask_phone: q.mask_phone === '1', practitioner_id: q.practitioner_id ?? null,
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  // ชื่อไฟล์ภาษาไทย: ใช้ filename* (RFC 5987) + ชื่อสำรองภาษาอังกฤษ
  res.setHeader('Content-Disposition',
    `attachment; filename="booking-report_${q.from}_${q.to}.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.setHeader('Cache-Control', 'no-store');
  await workbook.xlsx.write(res);
  res.end();
}));
