/**
 * jobs/cron.js — งานที่ระบบทำเองตามเวลา (และเรียกด้วยมือได้จากเมนูนักพัฒนา)
 *   generateSlots     สร้างรอบเวลาล่วงหน้า (ข้ามเสาร์-อาทิตย์/วันหยุด)      ทุกวัน 00:05 + ตอนเปิดเซิร์ฟเวอร์
 *   markNoShows       คิวที่เลยเวลานัดเกินกำหนด → NO_SHOW + ระงับสิทธิ์อัตโนมัติ  ทุก 1 นาที
 *   sendReminders2h   เตือนก่อนนัด 2 ชม. (ส่งครั้งเดียวต่อคิว)                 ทุก 5 นาที
 *   sendReminders1d   เตือนล่วงหน้า 1 วัน (ปิดไว้เป็นค่าเริ่มต้น)               ทุกต้นชั่วโมง
 */
import cron from 'node-cron';
import { pool, query } from '../db.js';
import { getSettings } from '../services/settings.js';
import { notifyAppointment, notifyLineUser } from '../services/notify.js';
import { thaiDate } from '../utils/format.js';

const TZ = 'Asia/Bangkok';

// ---------------------------------------------------------------------
// 1) สร้าง slot ล่วงหน้า
// ---------------------------------------------------------------------
export async function generateSlots(days) {
  const d = days ?? (await getSettings(['slot_generate_days'])).slot_generate_days ?? 14;
  const [results] = await pool.query('CALL sp_generate_slots(?)', [d]);
  return Number(results?.[0]?.[0]?.slots_created ?? 0);
}

// ---------------------------------------------------------------------
// 2) ตัด no-show + ระงับสิทธิ์อัตโนมัติ
// ---------------------------------------------------------------------
export async function markNoShows() {
  const s = await getSettings(['no_show_after_min', 'suspend_auto', 'suspend_noshow_count', 'suspend_window_days', 'suspend_days']);
  const late = await query(
    `SELECT a.appointment_id, a.patient_id
       FROM appointments a JOIN time_slots t ON t.slot_id = a.slot_id
      WHERE a.status = 'BOOKED'
        AND TIMESTAMP(t.slot_date, t.start_time) + INTERVAL ? MINUTE < NOW()`,
    [s.no_show_after_min],
  );
  let marked = 0;
  for (const a of late) {
    const r = await query("UPDATE appointments SET status = 'NO_SHOW' WHERE appointment_id = ? AND status = 'BOOKED'", [a.appointment_id]);
    if (!r.affectedRows) continue;
    marked++;
    if (s.suspend_auto) await maybeSuspend(a.patient_id, a.appointment_id, s);
  }
  return marked;
}

async function maybeSuspend(patientId, appointmentId, s) {
  const [{ n }] = await query(
    `SELECT COUNT(*) AS n FROM appointments a JOIN time_slots t ON t.slot_id = a.slot_id
      WHERE a.patient_id = ? AND a.status = 'NO_SHOW' AND t.slot_date >= CURDATE() - INTERVAL ? DAY`,
    [patientId, s.suspend_window_days],
  );
  if (Number(n) < s.suspend_noshow_count) return;
  const [active] = await query(
    `SELECT suspension_id FROM patient_suspensions
      WHERE patient_id = ? AND lifted_at IS NULL AND end_date >= CURDATE() LIMIT 1`,
    [patientId],
  );
  if (active) return;

  await query(
    `INSERT INTO patient_suspensions (patient_id, start_date, end_date, reason, source)
     VALUES (?, CURDATE(), CURDATE() + INTERVAL ? DAY, ?, 'AUTO')`,
    [patientId, s.suspend_days, `ไม่มาตามนัด ${n} ครั้งใน ${s.suspend_window_days} วัน`],
  );
  const [info] = await query(
    `SELECT p.first_name, p.last_name, a.booked_by_line_user_id, CURDATE() + INTERVAL ? DAY AS end_date
       FROM appointments a JOIN patients p ON p.patient_id = a.patient_id WHERE a.appointment_id = ?`,
    [s.suspend_days, appointmentId],
  );
  if (info?.booked_by_line_user_id) {
    await notifyLineUser('SUSPENDED', info.booked_by_line_user_id, {
      patient_name: `${info.first_name} ${info.last_name}`, end_date: thaiDate(info.end_date),
    });
  }
}

// ---------------------------------------------------------------------
// 3) เตือนก่อนนัด 2 ชม. (เฉพาะคิวที่จองไว้ก่อนช่วง 2 ชม.)
// ---------------------------------------------------------------------
export async function sendReminders2h() {
  const rows = await query(
    `SELECT a.appointment_id
       FROM appointments a JOIN time_slots t ON t.slot_id = a.slot_id
       LEFT JOIN notification_logs nl ON nl.appointment_id = a.appointment_id AND nl.type = 'REMIND_2H'
      WHERE a.status = 'BOOKED' AND a.booked_by_line_user_id IS NOT NULL AND nl.log_id IS NULL
        AND TIMESTAMP(t.slot_date, t.start_time) BETWEEN NOW() AND NOW() + INTERVAL 120 MINUTE
        AND a.created_at < TIMESTAMP(t.slot_date, t.start_time) - INTERVAL 120 MINUTE`,
  );
  for (const r of rows) await notifyAppointment('REMIND_2H', r.appointment_id);
  return rows.length;
}

// ---------------------------------------------------------------------
// 4) เตือนล่วงหน้า 1 วัน (ปิดไว้เป็นค่าเริ่มต้น — เปิดที่ template REMIND_1D)
// ---------------------------------------------------------------------
/**
 * @param {{ignoreHour?: boolean}} [opts] ignoreHour = ส่งทันทีไม่ต้องรอชั่วโมงที่ตั้งไว้ (ใช้จากเมนูนักพัฒนา)
 * @returns {Promise<number>} จำนวนคิวที่ส่งเตือน
 */
export async function sendReminders1d({ ignoreHour = false } = {}) {
  const [tpl] = await query("SELECT is_enabled FROM notification_templates WHERE type = 'REMIND_1D'");
  if (!tpl?.is_enabled) return 0;
  const { remind_1d_hour: hour } = await getSettings(['remind_1d_hour']);
  const [{ h }] = await query('SELECT HOUR(NOW()) AS h');
  if (!ignoreHour && Number(h) !== hour) return 0;
  const rows = await query(
    `SELECT a.appointment_id
       FROM appointments a JOIN time_slots t ON t.slot_id = a.slot_id
       LEFT JOIN notification_logs nl ON nl.appointment_id = a.appointment_id AND nl.type = 'REMIND_1D'
      WHERE a.status = 'BOOKED' AND a.booked_by_line_user_id IS NOT NULL AND nl.log_id IS NULL
        AND t.slot_date = CURDATE() + INTERVAL 1 DAY
        AND a.created_at < TIMESTAMP(t.slot_date, t.start_time) - INTERVAL 24 HOUR`,
  );
  for (const r of rows) await notifyAppointment('REMIND_1D', r.appointment_id);
  return rows.length;
}

// ---------------------------------------------------------------------
// ตั้งเวลา
// ---------------------------------------------------------------------
function safe(name, fn) {
  let running = false;
  return async () => {
    if (running) return; // กันรันซ้อนถ้ารอบก่อนยังไม่จบ
    running = true;
    try {
      const n = await fn();
      if (n) console.log(`[cron] ${name}: ${n}`);
    } catch (err) {
      console.error(`[cron] ${name} failed:`, err.message);
    } finally {
      running = false;
    }
  };
}

export function startCron() {
  const genSlots = safe('generate slots', () => generateSlots());
  cron.schedule('5 0 * * *', genSlots, { timezone: TZ });                        // ทุกวัน 00:05
  cron.schedule('* * * * *', safe('no-show', markNoShows), { timezone: TZ });     // ทุกนาที
  cron.schedule('*/5 * * * *', safe('remind 2h', sendReminders2h), { timezone: TZ }); // ทุก 5 นาที
  cron.schedule('0 * * * *', safe('remind 1d', () => sendReminders1d()), { timezone: TZ });   // ทุกต้นชั่วโมง
  genSlots(); // รันทันทีตอนเปิดเซิร์ฟเวอร์
  console.log('[cron] started');
}
