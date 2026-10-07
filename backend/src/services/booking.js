import { query, queryOne, withTx } from '../db.js';
import { getSettings } from './settings.js';
import { bookingCode } from '../utils/crypto.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';

const BOOKING_KEYS = [
  'max_per_day', 'max_per_week', 'advance_booking_days', 'allow_same_day', 'booking_cutoff_min',
  'patient_cancel_min', 'checkin_early_min', 'no_show_after_min', 'open_weekdays',
];

export const bookingRules = () => getSettings(BOOKING_KEYS);

// ---------------------------------------------------------------------
// ช่วงวันที่จองได้ + รอบว่าง (ฝั่งผู้จอง)
// ---------------------------------------------------------------------
export async function getPublicAvailability() {
  const r = await bookingRules();
  const minDay = r.allow_same_day ? 0 : 1;
  const rows = await query(
    `SELECT v.slot_id, v.slot_date, v.start_time, v.end_time, v.availability,
            TIMESTAMPDIFF(MINUTE, NOW(), TIMESTAMP(v.slot_date, v.start_time)) AS mins_until
       FROM v_slot_availability v
       JOIN practitioners pr ON pr.practitioner_id = v.practitioner_id AND pr.is_active = TRUE
      WHERE v.slot_date BETWEEN CURDATE() + INTERVAL ? DAY AND CURDATE() + INTERVAL ? DAY
      ORDER BY v.slot_date, v.start_time`,
    [minDay, r.advance_booking_days],
  );
  const open = new Set(String(r.open_weekdays).split(',').map((x) => Number(x.trim())));
  const days = new Map();
  for (const s of rows) {
    const wd = isoWeekday(s.slot_date);
    if (!open.has(wd)) continue;
    let status = s.availability; // AVAILABLE / TAKEN / BLOCKED / HOLIDAY
    if (status === 'AVAILABLE' && s.mins_until < r.booking_cutoff_min) status = 'CLOSED';
    if (!days.has(s.slot_date)) days.set(s.slot_date, []);
    days.get(s.slot_date).push({
      slot_id: s.slot_id, start_time: s.start_time.slice(0, 5), end_time: s.end_time.slice(0, 5),
      // ฝั่งผู้จองเห็นแค่ว่าง / ไม่ว่าง (ไม่บอกว่าใครจอง)
      status: status === 'AVAILABLE' ? 'AVAILABLE' : status === 'HOLIDAY' ? 'HOLIDAY' : 'UNAVAILABLE',
    });
  }
  return [...days.entries()].map(([date, slots]) => ({ date, slots }));
}

function isoWeekday(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`).getUTCDay(); // 0=อา.
  return d === 0 ? 7 : d;
}

// ---------------------------------------------------------------------
// สร้างการจอง (transaction)
// ---------------------------------------------------------------------
/**
 * @param {object} p
 * @param {number} p.patientId
 * @param {number} p.slotId
 * @param {string} [p.chiefComplaint]
 * @param {'ONLINE'|'WALK_IN'|'STAFF'} p.channel
 * @param {string} [p.lineUserId]      ผู้จอง (ONLINE)
 * @param {string} [p.relation]
 * @param {number} [p.staffId]         เจ้าหน้าที่ (WALK_IN / STAFF)
 * @param {boolean} [p.force]          เจ้าหน้าที่ยืนยันข้ามโควตา/ระงับสิทธิ์
 */
export async function createBooking(p) {
  const r = await bookingRules();
  const isStaff = p.channel !== 'ONLINE';

  const appointmentId = await withTx(async (conn) => {
    // 1) ล็อก slot แถวนี้ — request ที่จอง slot เดียวกันจะต่อคิวกัน
    const [[slot]] = await conn.query(
      `SELECT s.*, pr.is_active AS practitioner_active, h.name AS holiday_name,
              TIMESTAMPDIFF(MINUTE, NOW(), TIMESTAMP(s.slot_date, s.start_time)) AS mins_until,
              TIMESTAMPDIFF(MINUTE, NOW(), TIMESTAMP(s.slot_date, s.end_time))   AS mins_until_end,
              DATEDIFF(s.slot_date, CURDATE()) AS days_ahead,
              WEEKDAY(s.slot_date) + 1 AS wd
         FROM time_slots s
         JOIN practitioners pr ON pr.practitioner_id = s.practitioner_id
         LEFT JOIN holidays h  ON h.holiday_date = s.slot_date
        WHERE s.slot_id = ?
        FOR UPDATE OF s`,
      [p.slotId],
    );
    if (!slot) throw notFound('ไม่พบรอบเวลานี้');
    if (!slot.practitioner_active) throw conflict('SLOT_UNAVAILABLE', 'รอบนี้ไม่เปิดให้บริการ');
    if (slot.holiday_name) throw conflict('HOLIDAY', `วันนี้เป็นวันหยุด (${slot.holiday_name})`);
    if (slot.is_blocked) throw conflict('SLOT_BLOCKED', `รอบนี้ปิดรับ${slot.block_reason ? ` (${slot.block_reason})` : ''}`);

    if (isStaff) {
      // เจ้าหน้าที่: จองได้ตั้งแต่วันนี้ จนถึงก่อนรอบจบ (รองรับ walk-in ในรอบที่เริ่มไปแล้ว)
      if (slot.days_ahead < 0 || slot.mins_until_end <= 0) throw conflict('SLOT_PASSED', 'รอบนี้ผ่านไปแล้ว');
    } else {
      const open = String(r.open_weekdays).split(',').map((x) => Number(x.trim()));
      if (!open.includes(slot.wd)) throw conflict('CLOSED_DAY', 'วันนี้ไม่เปิดให้จอง');
      const minDay = r.allow_same_day ? 0 : 1;
      if (slot.days_ahead < minDay) throw conflict('TOO_SOON', r.allow_same_day ? 'รอบนี้ผ่านไปแล้ว' : 'ไม่สามารถจองวันเดียวกันได้');
      if (slot.days_ahead > r.advance_booking_days) throw conflict('TOO_FAR', `จองล่วงหน้าได้ไม่เกิน ${r.advance_booking_days} วัน`);
      if (slot.mins_until < r.booking_cutoff_min) throw conflict('CUTOFF', `ปิดรับจองก่อนเวลานัด ${r.booking_cutoff_min} นาที`);
    }

    // 1.1) slot มีคนจองอยู่แล้ว → แจ้งทันที (ก่อนเช็กโควตา ให้ข้อความตรงกับสาเหตุจริง)
    const [[taken]] = await conn.query('SELECT 1 AS x FROM appointments WHERE active_slot_id = ?', [p.slotId]);
    if (taken) throw conflict('SLOT_TAKEN', 'รอบนี้มีผู้จองแล้ว กรุณาเลือกรอบอื่น');

    // 2) ล็อกผู้รับบริการ — กันกดจองซ้ำพร้อมกันจนเกินโควตา
    const [[patient]] = await conn.query(
      'SELECT patient_id, is_deleted FROM patients WHERE patient_id = ? FOR UPDATE', [p.patientId],
    );
    if (!patient || patient.is_deleted) throw notFound('ไม่พบข้อมูลผู้รับบริการ');

    // 3) ระงับสิทธิ์
    const [[susp]] = await conn.query(
      `SELECT end_date FROM patient_suspensions
        WHERE patient_id = ? AND lifted_at IS NULL AND CURDATE() BETWEEN start_date AND end_date
        ORDER BY end_date DESC LIMIT 1`,
      [p.patientId],
    );
    if (susp && !(isStaff && p.force)) {
      throw conflict('SUSPENDED', `ผู้รับบริการถูกระงับสิทธิ์การจองถึงวันที่ ${susp.end_date}`, { end_date: susp.end_date, can_force: isStaff });
    }

    // 4) โควตา (นับทุกสถานะ ยกเว้น CANCELLED)
    const [[q]] = await conn.query(
      `SELECT COALESCE(SUM(s.slot_date = ?), 0) AS day_count, COUNT(*) AS week_count
         FROM appointments a JOIN time_slots s ON s.slot_id = a.slot_id
        WHERE a.patient_id = ? AND a.status <> 'CANCELLED'
          AND YEARWEEK(s.slot_date, 3) = YEARWEEK(?, 3)`,
      [slot.slot_date, p.patientId, slot.slot_date],
    );
    if (!(isStaff && p.force)) {
      if (Number(q.day_count) >= r.max_per_day) {
        throw conflict('QUOTA_DAY', `จองได้ไม่เกิน ${r.max_per_day} คิวต่อวัน`, { can_force: isStaff });
      }
      if (Number(q.week_count) >= r.max_per_week) {
        throw conflict('QUOTA_WEEK', `จองได้ไม่เกิน ${r.max_per_week} คิวต่อสัปดาห์`, { can_force: isStaff });
      }
    }

    // 5) INSERT — uq_active_slot กันจองซ้อนอีกชั้น / สุ่มรหัสใหม่ถ้ารหัสชน
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const [res] = await conn.query(
          `INSERT INTO appointments
             (booking_code, patient_id, booked_by_line_user_id, booked_by_staff, booker_relation,
              slot_id, booking_channel, chief_complaint, status, checked_in_at, checked_in_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            bookingCode(), p.patientId, p.lineUserId ?? null, p.staffId ?? null, p.relation ?? null,
            p.slotId, p.channel, p.chiefComplaint || null,
            // walk-in มาถึงแล้ว → เช็กอินให้เลย
            p.channel === 'WALK_IN' ? 'CHECKED_IN' : 'BOOKED',
            p.channel === 'WALK_IN' ? new Date() : null,
            p.channel === 'WALK_IN' ? p.staffId : null,
          ],
        );
        return res.insertId;
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY' && err.message.includes('uq_active_slot')) {
          throw conflict('SLOT_TAKEN', 'รอบนี้เพิ่งถูกจองไป กรุณาเลือกรอบอื่น');
        }
        if (err.code === 'ER_DUP_ENTRY' && err.message.includes('uq_booking_code')) continue;
        throw err;
      }
    }
    throw new Error('สุ่มรหัสจองไม่สำเร็จ');
  });

  return getAppointment(appointmentId);
}

// ---------------------------------------------------------------------
// อ่านข้อมูลคิว
// ---------------------------------------------------------------------
export function getAppointment(id) {
  return queryOne('SELECT * FROM v_appointment_details WHERE appointment_id = ?', [id]);
}

export function getAppointmentByCode(code) {
  return queryOne('SELECT * FROM v_appointment_details WHERE booking_code = ?', [String(code).toUpperCase()]);
}

/** ข้อมูลเวลาเทียบกับตอนนี้ (นาที) */
export async function timing(appointmentId) {
  return queryOne(
    `SELECT TIMESTAMPDIFF(MINUTE, NOW(), TIMESTAMP(s.slot_date, s.start_time)) AS mins_until,
            DATEDIFF(s.slot_date, CURDATE()) AS days_ahead
       FROM appointments a JOIN time_slots s ON s.slot_id = a.slot_id
      WHERE a.appointment_id = ?`,
    [appointmentId],
  );
}

// ---------------------------------------------------------------------
// เปลี่ยนสถานะ
// ---------------------------------------------------------------------
/** อัปเดตสถานะแบบมีเงื่อนไข (กันกดซ้ำ / race) */
async function transition(appointmentId, fromStatuses, setSql, params, errMsg) {
  const res = await query(
    `UPDATE appointments SET ${setSql} WHERE appointment_id = ? AND status IN (${fromStatuses.map(() => '?').join(',')})`,
    [...params, appointmentId, ...fromStatuses],
  );
  if (res.affectedRows === 0) throw conflict('INVALID_STATUS', errMsg);
}

export async function cancelByPatient(appt, lineUserId) {
  if (appt.booked_by_line_user_id !== lineUserId) throw forbidden();
  if (appt.status !== 'BOOKED') throw conflict('INVALID_STATUS', 'คิวนี้ยกเลิกไม่ได้แล้ว');
  const r = await bookingRules();
  const t = await timing(appt.appointment_id);
  if (t.mins_until < r.patient_cancel_min) {
    throw conflict('CANCEL_TOO_LATE', `ยกเลิกออนไลน์ได้ถึง ${r.patient_cancel_min / 60} ชม. ก่อนเวลานัด กรุณาโทรแจ้งเคาน์เตอร์`);
  }
  await transition(appt.appointment_id, ['BOOKED'],
    "status = 'CANCELLED', cancelled_at = NOW(), cancelled_by = 'PATIENT', cancel_reason = ?",
    ['ผู้จองยกเลิกเอง'], 'คิวนี้ยกเลิกไม่ได้แล้ว');
}

export async function confirmByPatient(appt, lineUserId) {
  if (appt.booked_by_line_user_id !== lineUserId) throw forbidden();
  if (appt.status !== 'BOOKED') throw conflict('INVALID_STATUS', 'คิวนี้ไม่อยู่ในสถานะรอยืนยัน');
  await query('UPDATE appointments SET confirmed_at = COALESCE(confirmed_at, NOW()) WHERE appointment_id = ?', [appt.appointment_id]);
}

export async function cancelByStaff(appointmentId, staffId, reason) {
  await transition(appointmentId, ['BOOKED', 'CHECKED_IN'],
    "status = 'CANCELLED', cancelled_at = NOW(), cancelled_by = 'STAFF', cancel_reason = ?",
    [reason || 'เจ้าหน้าที่ยกเลิก'], 'คิวนี้ยกเลิกไม่ได้แล้ว');
}

/**
 * เช็กอิน — คืน warning ถ้ามาเร็ว/สายเกินกำหนด (เจ้าหน้าที่กด force เพื่อยืนยันได้)
 */
export async function checkIn(appt, staffId, force = false) {
  if (appt.status !== 'BOOKED') {
    throw conflict('INVALID_STATUS', appt.status === 'CHECKED_IN' ? 'เช็กอินไปแล้ว' : 'คิวนี้เช็กอินไม่ได้');
  }
  const r = await bookingRules();
  const t = await timing(appt.appointment_id);
  if (t.days_ahead !== 0) throw conflict('NOT_TODAY', 'คิวนี้ไม่ใช่ของวันนี้');
  if (!force) {
    if (t.mins_until > r.checkin_early_min) {
      throw conflict('TOO_EARLY', `มาก่อนเวลานัด ${t.mins_until} นาที (กำหนดเช็กอินได้ก่อน ${r.checkin_early_min} นาที)`, { can_force: true });
    }
    if (-t.mins_until > r.no_show_after_min) {
      throw conflict('TOO_LATE', `มาสาย ${-t.mins_until} นาที (เกินกำหนด ${r.no_show_after_min} นาที)`, { can_force: true });
    }
  }
  await transition(appt.appointment_id, ['BOOKED'],
    "status = 'CHECKED_IN', checked_in_at = NOW(), checked_in_by = ?", [staffId], 'เช็กอินไม่สำเร็จ');
}

export async function startService(appointmentId, staffId) {
  await withTx(async (conn) => {
    const [res] = await conn.query(
      "UPDATE appointments SET status = 'IN_SERVICE' WHERE appointment_id = ? AND status = 'CHECKED_IN'", [appointmentId],
    );
    if (res.affectedRows === 0) throw conflict('INVALID_STATUS', 'ต้องเช็กอินก่อนจึงเริ่มบริการได้');
    await conn.query(
      `INSERT INTO service_records (appointment_id, service_start, recorded_by) VALUES (?, NOW(), ?)
       ON DUPLICATE KEY UPDATE service_start = NOW(), recorded_by = VALUES(recorded_by)`,
      [appointmentId, staffId],
    );
  });
}

export async function completeService(appointmentId, staffId, record = {}) {
  await withTx(async (conn) => {
    const [res] = await conn.query(
      "UPDATE appointments SET status = 'COMPLETED' WHERE appointment_id = ? AND status = 'IN_SERVICE'", [appointmentId],
    );
    if (res.affectedRows === 0) throw conflict('INVALID_STATUS', 'คิวนี้ยังไม่ได้เริ่มบริการ');
    await conn.query(
      `INSERT INTO service_records (appointment_id, service_end, treatment_details, post_treatment_note, recorded_by)
       VALUES (?, NOW(), ?, ?, ?)
       ON DUPLICATE KEY UPDATE service_end = NOW(),
         treatment_details   = COALESCE(VALUES(treatment_details), treatment_details),
         post_treatment_note = COALESCE(VALUES(post_treatment_note), post_treatment_note),
         recorded_by = VALUES(recorded_by)`,
      [appointmentId, record.treatment_details ?? null, record.post_treatment_note ?? null, staffId],
    );
  });
}

export async function saveServiceRecord(appointmentId, staffId, record) {
  const appt = await queryOne('SELECT status FROM appointments WHERE appointment_id = ?', [appointmentId]);
  if (!appt) throw notFound();
  if (!['IN_SERVICE', 'COMPLETED'].includes(appt.status)) throw badRequest('INVALID_STATUS', 'บันทึกผลได้หลังเริ่มบริการแล้ว');
  await query(
    `INSERT INTO service_records (appointment_id, treatment_details, post_treatment_note, recorded_by)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE treatment_details = VALUES(treatment_details),
       post_treatment_note = VALUES(post_treatment_note), recorded_by = VALUES(recorded_by)`,
    [appointmentId, record.treatment_details ?? null, record.post_treatment_note ?? null, staffId],
  );
}

// ---------------------------------------------------------------------
// ปิดรอบ / ปิดทั้งวัน (บล็อก slot, วันหยุด) — ยกเลิกคิวที่จองไว้
// ---------------------------------------------------------------------
/** คิวที่ active ใน slot ที่จะปิด (ใช้แสดงหน้าต่างเตือนก่อนยืนยัน) */
export function affectedAppointments({ date, slotIds }) {
  const where = slotIds?.length ? `a.slot_id IN (${slotIds.map(() => '?').join(',')})` : 's.slot_date = ?';
  return query(
    `SELECT a.appointment_id, a.booking_code, a.status, s.slot_date, s.start_time,
            p.first_name, p.last_name, p.phone_number,
            a.booked_by_line_user_id IS NOT NULL AS has_line
       FROM appointments a
       JOIN time_slots s ON s.slot_id = a.slot_id
       JOIN patients p   ON p.patient_id = a.patient_id
      WHERE ${where} AND a.status IN ('BOOKED','CHECKED_IN')
      ORDER BY s.start_time`,
    slotIds?.length ? slotIds : [date],
  );
}

/** บล็อก slot แล้วยกเลิกคิวที่ active ทั้งหมด (คืนรายการคิวที่ถูกยกเลิก) */
export async function closeSlotsAndCancel(conn, { date, slotIds, blockReason, cancelReason }) {
  const where = slotIds?.length ? `slot_id IN (${slotIds.map(() => '?').join(',')})` : 'slot_date = ?';
  const params = slotIds?.length ? slotIds : [date];
  await conn.query(`UPDATE time_slots SET is_blocked = TRUE, block_reason = ? WHERE ${where}`, [blockReason, ...params]);

  const [cancelled] = await conn.query(
    `SELECT a.appointment_id FROM appointments a JOIN time_slots s ON s.slot_id = a.slot_id
      WHERE s.${where} AND a.status IN ('BOOKED','CHECKED_IN') FOR UPDATE`,
    params,
  );
  if (cancelled.length) {
    await conn.query(
      `UPDATE appointments SET status = 'CANCELLED', cancelled_at = NOW(), cancelled_by = 'SYSTEM', cancel_reason = ?
        WHERE appointment_id IN (${cancelled.map(() => '?').join(',')})`,
      [cancelReason, ...cancelled.map((c) => c.appointment_id)],
    );
  }
  return cancelled.map((c) => c.appointment_id);
}
