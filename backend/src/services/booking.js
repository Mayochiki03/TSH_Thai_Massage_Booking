/**
 * services/booking.js — กฎการจองทั้งหมดของระบบ (ใช้ร่วมกันทุกช่องทาง: LINE / kiosk / เคาน์เตอร์)
 *   getPublicAvailability   รอบว่างสำหรับผู้จองและ kiosk (บอกจำนวนที่เหลือ)
 *   listServiceTypes        ประเภทบริการที่เปิดให้เลือก + ราคา
 *   createBooking           จองใน transaction (ล็อก slot → นับคิวเทียบจำนวนเตียง + ตรวจโควตา/ระงับสิทธิ์/เลขบัตร)
 *   cancel / confirm / checkIn / startService / completeService / saveServiceRecord   เปลี่ยนสถานะคิว
 *   affectedAppointments / closeSlotsAndCancel   ปิดรอบ/วันหยุด แล้วยกเลิกคิวที่จองไว้
 *
 * หลายเตียง: 1 รอบ (time_slots) รับได้ capacity คิว — ไม่ผูกกับหมอนวด
 *   หมอนวดคนไหนว่างก็กด "เริ่มนวด" รับคิว → บันทึก appointments.practitioner_id ตอนนั้น
 */
import { query, queryOne, withTx } from '../db.js';
import { getSettings } from './settings.js';
import { bookingCode } from '../utils/crypto.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { applyNationalId, NID_REQUIRED_MSG } from './patients.js';

const BOOKING_KEYS = [
  'max_per_day', 'max_per_week', 'advance_booking_days', 'allow_same_day', 'booking_cutoff_min',
  'patient_cancel_min', 'checkin_early_min', 'no_show_after_min', 'open_weekdays',
];

export const bookingRules = () => getSettings(BOOKING_KEYS);

/**
 * ประเภทบริการสำหรับหน้าผู้รับบริการ (LINE / kiosk)
 * ปิด "แสดงราคา" (setting show_price) → ส่ง price = null ไปเลย หน้าเว็บจะไม่แสดงราคา
 */
export const publicServiceTypes = (list, showPrice) => (showPrice ? list : list.map((t) => ({ ...t, price: null })));

/** ประเภทบริการที่เปิดให้เลือก (ทุกช่องทางใช้รายการเดียวกัน) */
export function listServiceTypes() {
  return query(
    'SELECT service_type_id, name, description, price FROM service_types WHERE is_active = TRUE ORDER BY sort_order, service_type_id',
  ).then((rows) => rows.map((r) => ({ ...r, price: Number(r.price) })));
}

// ---------------------------------------------------------------------
// ช่วงวันที่จองได้ + รอบว่าง (ฝั่งผู้จอง LINE และเครื่อง kiosk)
// ---------------------------------------------------------------------
/**
 * รายการวันที่จองได้ พร้อมสถานะแต่ละรอบ (ไม่เปิดเผยว่าใครจอง)
 *
 * @param {'ONLINE'|'KIOSK'} [channel='ONLINE']
 *   ONLINE: เริ่มวันนี้ (ถ้า allow_same_day) หรือพรุ่งนี้, รอบที่เหลือเวลาน้อยกว่า booking_cutoff_min = ปิดรับ
 *   KIOSK : เริ่มวันนี้เสมอ, รอบที่เริ่มไปแล้วไม่เกิน no_show_after_min นาทียังรับได้ (คนมายืนอยู่หน้าคลินิกแล้ว)
 * @returns {Promise<Array<{date: string, slots: Array<{slot_id:number,start_time:string,end_time:string,status:'AVAILABLE'|'UNAVAILABLE'|'HOLIDAY',remaining:number,capacity:number}>}>>}
 */
export async function getPublicAvailability(channel = 'ONLINE') {
  const r = await bookingRules();
  const kiosk = channel === 'KIOSK';
  const minDay = kiosk || r.allow_same_day ? 0 : 1;
  const rows = await query(
    `SELECT v.slot_id, v.slot_date, v.start_time, v.end_time, v.availability, v.capacity, v.remaining,
            TIMESTAMPDIFF(MINUTE, NOW(), TIMESTAMP(v.slot_date, v.start_time)) AS mins_until
       FROM v_slot_availability v
      WHERE v.slot_date BETWEEN CURDATE() + INTERVAL ? DAY AND CURDATE() + INTERVAL ? DAY
      ORDER BY v.slot_date, v.start_time`,
    [minDay, r.advance_booking_days],
  );
  const open = new Set(String(r.open_weekdays).split(',').map((x) => Number(x.trim())));
  const days = new Map();
  for (const s of rows) {
    if (!open.has(isoWeekday(s.slot_date))) continue;
    let status = s.availability; // AVAILABLE / FULL / BLOCKED / HOLIDAY
    const tooLate = kiosk ? s.mins_until < -r.no_show_after_min : s.mins_until < r.booking_cutoff_min;
    if (status === 'AVAILABLE' && tooLate) status = 'CLOSED';
    if (!days.has(s.slot_date)) days.set(s.slot_date, []);
    days.get(s.slot_date).push({
      slot_id: s.slot_id, start_time: s.start_time.slice(0, 5), end_time: s.end_time.slice(0, 5),
      // ผู้จองเห็นแค่ ว่าง (เหลือกี่ที่) / ไม่ว่าง / วันหยุด (ไม่บอกว่าใครจอง)
      status: status === 'AVAILABLE' ? 'AVAILABLE' : status === 'HOLIDAY' ? 'HOLIDAY' : 'UNAVAILABLE',
      remaining: status === 'AVAILABLE' ? Number(s.remaining) : 0,
      capacity: Number(s.capacity),
    });
  }
  return [...days.entries()].map(([date, slots]) => ({ date, slots }));
}

/** 'YYYY-MM-DD' → 1 (จันทร์) … 7 (อาทิตย์) ตามรูปแบบ ISO เดียวกับ settings.open_weekdays */
function isoWeekday(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`).getUTCDay(); // 0=อา.
  return d === 0 ? 7 : d;
}

// ---------------------------------------------------------------------
// สร้างการจอง (transaction)
// ---------------------------------------------------------------------
/**
 * สร้างการจอง 1 คิว ภายใน transaction เดียว
 *
 * ลำดับการตรวจ (ล้มข้อไหน throw HttpError ทันที → rollback ทั้งหมด):
 *   1. ล็อกแถว slot (FOR UPDATE) → ตรวจวันหยุด / บล็อก / ช่วงเวลาที่จองได้ตามช่องทาง
 *   2. นับคิวที่ยังกินที่ในรอบนี้ เทียบ capacity (SLOT_TAKEN = เต็ม)
 *      request อื่นที่จองรอบเดียวกันต้องรอ lock ข้อ 1 → นับแล้วจองทีละคน ไม่มีทางเกินจำนวนเตียง
 *   3. ประเภทบริการต้องเปิดใช้งาน → เก็บราคา ณ ตอนจอง
 *   4. ล็อกแถวผู้รับบริการ → เลขบัตร (NID_REQUIRED) / จองรอบเดียวกันซ้ำ / ระงับสิทธิ์ (SUSPENDED)
 *   5. ตรวจโควตาวัน/สัปดาห์ (QUOTA_DAY / QUOTA_WEEK)
 *   6. INSERT
 *
 * กฎตามช่องทาง:
 *   ONLINE  (LINE)          : วันเปิดทำการ, ช่วงจองล่วงหน้า, ปิดรับก่อนนัด booking_cutoff_min
 *   KIOSK   (เครื่องหน้าคลินิก): วันนี้ถึงช่วงจองล่วงหน้า, รอบที่เริ่มแล้วไม่เกิน no_show_after_min นาทียังจองได้
 *                            มาถึงแล้ว → ถ้าใกล้เวลานัด (≤ checkin_early_min) เช็กอินให้อัตโนมัติ
 *   WALK_IN / STAFF (เจ้าหน้าที่): วันนี้ขึ้นไป ก่อนรอบจบ, ข้ามโควตา/ระงับสิทธิ์ได้ด้วย force
 *
 * @param {object} p
 * @param {number} p.patientId         ผู้รับบริการ
 * @param {number} p.slotId            รอบเวลา
 * @param {number} p.serviceTypeId     ประเภทบริการ
 * @param {{national_id?: string, no_national_id?: boolean}} [p.identity]  เลขบัตร (ถ้าผู้รับบริการเดิมยังไม่เคยกรอก)
 * @param {string} [p.chiefComplaint]  อาการเบื้องต้น
 * @param {'ONLINE'|'WALK_IN'|'STAFF'|'KIOSK'} p.channel
 * @param {string} [p.lineUserId]      ผู้จอง (ONLINE)
 * @param {string} [p.relation]        ความสัมพันธ์ผู้จอง → ผู้รับบริการ (ONLINE)
 * @param {number} [p.staffId]         บัญชีที่ทำรายการ (WALK_IN / STAFF / KIOSK)
 * @param {boolean} [p.force]          เจ้าหน้าที่ยืนยันข้ามโควตา/ระงับสิทธิ์ (KIOSK/ONLINE ใช้ไม่ได้)
 * @returns {Promise<object>} แถวจาก v_appointment_details ของคิวที่สร้าง
 */
export async function createBooking(p) {
  const r = await bookingRules();
  // เฉพาะเจ้าหน้าที่ (WALK_IN / STAFF) ที่ข้ามโควตา/ระงับสิทธิ์ได้
  const isStaff = p.channel === 'WALK_IN' || p.channel === 'STAFF';
  const isKiosk = p.channel === 'KIOSK';

  const appointmentId = await withTx(async (conn) => {
    // 1) ล็อก slot แถวนี้ — request ที่จอง slot เดียวกันจะต่อคิวกัน
    const [[slot]] = await conn.query(
      `SELECT s.*, h.name AS holiday_name,
              TIMESTAMPDIFF(MINUTE, NOW(), TIMESTAMP(s.slot_date, s.start_time)) AS mins_until,
              TIMESTAMPDIFF(MINUTE, NOW(), TIMESTAMP(s.slot_date, s.end_time))   AS mins_until_end,
              DATEDIFF(s.slot_date, CURDATE()) AS days_ahead,
              WEEKDAY(s.slot_date) + 1 AS wd
         FROM time_slots s
         LEFT JOIN holidays h  ON h.holiday_date = s.slot_date
        WHERE s.slot_id = ?
        FOR UPDATE OF s`,
      [p.slotId],
    );
    if (!slot) throw notFound('ไม่พบรอบเวลานี้');
    if (slot.holiday_name) throw conflict('HOLIDAY', `วันนี้เป็นวันหยุด (${slot.holiday_name})`);
    if (slot.is_blocked) throw conflict('SLOT_BLOCKED', `รอบนี้ปิดรับ${slot.block_reason ? ` (${slot.block_reason})` : ''}`);

    if (isStaff) {
      // เจ้าหน้าที่: จองได้ตั้งแต่วันนี้ จนถึงก่อนรอบจบ (รองรับ walk-in ในรอบที่เริ่มไปแล้ว)
      if (slot.days_ahead < 0 || slot.mins_until_end <= 0) throw conflict('SLOT_PASSED', 'รอบนี้ผ่านไปแล้ว');
    } else if (isKiosk) {
      // kiosk: ผู้ป่วยอยู่หน้าคลินิกแล้ว → จองรอบวันนี้ได้จนเลยเวลาเริ่มไม่เกิน no_show_after_min
      if (slot.days_ahead < 0 || slot.mins_until < -r.no_show_after_min) throw conflict('SLOT_PASSED', 'รอบนี้ผ่านไปแล้ว');
      if (slot.days_ahead > r.advance_booking_days) throw conflict('TOO_FAR', `จองล่วงหน้าได้ไม่เกิน ${r.advance_booking_days} วัน`);
    } else {
      const open = String(r.open_weekdays).split(',').map((x) => Number(x.trim()));
      if (!open.includes(slot.wd)) throw conflict('CLOSED_DAY', 'วันนี้ไม่เปิดให้จอง');
      const minDay = r.allow_same_day ? 0 : 1;
      if (slot.days_ahead < minDay) throw conflict('TOO_SOON', r.allow_same_day ? 'รอบนี้ผ่านไปแล้ว' : 'ไม่สามารถจองวันเดียวกันได้');
      if (slot.days_ahead > r.advance_booking_days) throw conflict('TOO_FAR', `จองล่วงหน้าได้ไม่เกิน ${r.advance_booking_days} วัน`);
      if (slot.mins_until < r.booking_cutoff_min) throw conflict('CUTOFF', `ปิดรับจองก่อนเวลานัด ${r.booking_cutoff_min} นาที`);
    }

    // 2) รอบเต็มหรือยัง (นับภายใต้ lock ของ slot → ไม่มีทางจองเกินจำนวนเตียง)
    const [[{ used }]] = await conn.query('SELECT COUNT(*) AS used FROM appointments WHERE active_slot_id = ?', [p.slotId]);
    if (Number(used) >= slot.capacity) {
      throw conflict('SLOT_TAKEN', slot.capacity > 1 ? 'รอบนี้เต็มแล้ว กรุณาเลือกรอบอื่น' : 'รอบนี้มีผู้จองแล้ว กรุณาเลือกรอบอื่น');
    }

    // 3) ประเภทบริการ → เก็บราคา ณ ตอนจอง
    const [[service]] = await conn.query('SELECT service_type_id, price FROM service_types WHERE service_type_id = ? AND is_active = TRUE', [p.serviceTypeId]);
    if (!service) throw badRequest('SERVICE_TYPE', 'กรุณาเลือกประเภทบริการ', { fields: { service_type_id: ['กรุณาเลือกประเภทบริการ'] } });

    // 4) ล็อกผู้รับบริการ — กันกดจองซ้ำพร้อมกันจนเกินโควตา
    if (p.identity) await applyNationalId(conn, p.patientId, p.identity);
    const [[patient]] = await conn.query(
      'SELECT patient_id, is_deleted, national_id_hash, no_national_id FROM patients WHERE patient_id = ? FOR UPDATE', [p.patientId],
    );
    if (!patient || patient.is_deleted) throw notFound('ไม่พบข้อมูลผู้รับบริการ');
    // เลขบัตรประชาชนของผู้รับบริการ (บังคับ) — ใส่มาพร้อมการจองได้ถ้ายังไม่เคยกรอก
    if (!patient.national_id_hash && !patient.no_national_id) {
      throw conflict('NID_REQUIRED', NID_REQUIRED_MSG, { patient_id: p.patientId, fields: { national_id: [NID_REQUIRED_MSG] } });
    }
    // คนเดียวกันจองรอบเดียวกันซ้ำ (มีหลายเตียงจึงต้องตรวจเอง)
    const [[dup]] = await conn.query('SELECT 1 AS x FROM appointments WHERE active_slot_id = ? AND patient_id = ?', [p.slotId, p.patientId]);
    if (dup) throw conflict('DUPLICATE', 'ผู้รับบริการคนนี้จองรอบนี้ไว้แล้ว');

    // ระงับสิทธิ์
    const [[susp]] = await conn.query(
      `SELECT end_date FROM patient_suspensions
        WHERE patient_id = ? AND lifted_at IS NULL AND CURDATE() BETWEEN start_date AND end_date
        ORDER BY end_date DESC LIMIT 1`,
      [p.patientId],
    );
    if (susp && !(isStaff && p.force)) {
      throw conflict('SUSPENDED', `ผู้รับบริการถูกระงับสิทธิ์การจองถึงวันที่ ${susp.end_date}`, { end_date: susp.end_date, can_force: isStaff });
    }

    // 5) โควตา (นับทุกสถานะ ยกเว้น CANCELLED)
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

    // 6) INSERT — สุ่มรหัสใหม่ถ้ารหัสชน
    const autoCheckIn = p.channel === 'WALK_IN' || (isKiosk && slot.mins_until <= r.checkin_early_min);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const [res] = await conn.query(
          `INSERT INTO appointments
             (booking_code, patient_id, booked_by_line_user_id, booked_by_staff, booker_relation,
              slot_id, booking_channel, chief_complaint, service_type_id, service_price, status, checked_in_at, checked_in_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            bookingCode(), p.patientId, p.lineUserId ?? null, p.staffId ?? null, p.relation ?? null,
            p.slotId, p.channel, p.chiefComplaint || null, service.service_type_id, service.price,
            // walk-in มาถึงแล้ว → เช็กอินให้เลย / kiosk เช็กอินให้ถ้าใกล้เวลานัด
            autoCheckIn ? 'CHECKED_IN' : 'BOOKED',
            autoCheckIn ? new Date() : null,
            autoCheckIn ? p.staffId : null,
          ],
        );
        return res.insertId;
      } catch (err) {
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
 * @param {string|null} [vn] VN ที่เคาน์เตอร์ได้จากระบบโรงพยาบาล (ไม่บังคับ — หมอนวดกรอกทีหลังได้)
 */
export async function checkIn(appt, staffId, force = false, vn = undefined) {
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
    "status = 'CHECKED_IN', checked_in_at = NOW(), checked_in_by = ?, vn = COALESCE(?, vn)", [staffId, vn ?? null], 'เช็กอินไม่สำเร็จ');
}

/**
 * เริ่มนวด — บันทึกว่าหมอนวดคนไหนรับคิวนี้
 * @param {number} practitionerId หมอนวด (บัญชีหมอนวด = ตัวเอง, แอดมินเลือกให้)
 */
export async function startService(appointmentId, staffId, practitionerId) {
  if (!practitionerId) throw badRequest('PRACTITIONER_REQUIRED', 'กรุณาเลือกหมอนวด');
  const pr = await queryOne('SELECT practitioner_id FROM practitioners WHERE practitioner_id = ? AND is_active = TRUE', [practitionerId]);
  if (!pr) throw badRequest('PRACTITIONER_REQUIRED', 'ไม่พบหมอนวดนี้ หรือถูกปิดการใช้งาน');
  await withTx(async (conn) => {
    const [res] = await conn.query(
      "UPDATE appointments SET status = 'IN_SERVICE', practitioner_id = ? WHERE appointment_id = ? AND status = 'CHECKED_IN'",
      [practitionerId, appointmentId],
    );
    if (res.affectedRows === 0) throw conflict('INVALID_STATUS', 'ต้องเช็กอินก่อนจึงเริ่มบริการได้');
    await conn.query(
      `INSERT INTO service_records (appointment_id, service_start, recorded_by) VALUES (?, NOW(), ?)
       ON DUPLICATE KEY UPDATE service_start = NOW(), recorded_by = VALUES(recorded_by)`,
      [appointmentId, staffId],
    );
  });
}

/**
 * ข้อมูลประกอบคิวที่หมอนวด/เคาน์เตอร์แก้ได้ระหว่างให้บริการ: VN และประเภทบริการ (เปลี่ยนประเภท → ราคาตามปัจจุบัน)
 * ส่งเฉพาะค่าที่ต้องการแก้ (undefined = ไม่แตะ)
 */
export async function updateVisitInfo(conn, appointmentId, { vn, service_type_id: serviceTypeId } = {}) {
  if (vn !== undefined) await conn.query('UPDATE appointments SET vn = ? WHERE appointment_id = ?', [vn, appointmentId]);
  if (serviceTypeId) {
    const [[st]] = await conn.query('SELECT price FROM service_types WHERE service_type_id = ? AND is_active = TRUE', [serviceTypeId]);
    if (!st) throw badRequest('SERVICE_TYPE', 'ไม่พบประเภทบริการนี้');
    await conn.query(
      // MySQL ประเมิน SET จากซ้ายไปขวา → ต้องคำนวณราคาก่อนเปลี่ยน service_type_id (ประเภทเดิม = คงราคาเดิม)
      'UPDATE appointments SET service_price = IF(service_type_id <=> ?, service_price, ?), service_type_id = ? WHERE appointment_id = ?',
      [serviceTypeId, st.price, serviceTypeId, appointmentId],
    );
  }
}

export async function completeService(appointmentId, staffId, record = {}) {
  await withTx(async (conn) => {
    const [res] = await conn.query(
      "UPDATE appointments SET status = 'COMPLETED' WHERE appointment_id = ? AND status = 'IN_SERVICE'", [appointmentId],
    );
    if (res.affectedRows === 0) throw conflict('INVALID_STATUS', 'คิวนี้ยังไม่ได้เริ่มบริการ');
    await updateVisitInfo(conn, appointmentId, record);
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
  await withTx((conn) => updateVisitInfo(conn, appointmentId, record));
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
