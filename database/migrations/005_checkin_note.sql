-- =====================================================================
-- migrations/005_checkin_note.sql — v0.7.1 → v0.7.2
--   คำแนะนำการมารับบริการ (นำบัตรประชาชนไปห้องเวชระเบียนก่อน) — ค่าเดียว ใช้ทุกที่
--   แก้ข้อความได้ที่หน้า "กฎการจอง" (หมวดทั่วไป)
--
--   cd database
--   mysql -u root -p -e "source migrations/005_checkin_note.sql"
--
-- รันซ้ำได้ · แม่แบบข้อความ LINE: แทนเฉพาะบรรทัดเดิมที่ยังไม่เคยแก้ (ถ้าแอดมินแก้เองแล้วจะไม่แตะ)
-- =====================================================================
SET NAMES utf8mb4;
USE thai_massage_booking;

INSERT IGNORE INTO settings (setting_key, setting_value, label, category, value_type, sort_order)
VALUES ('checkin_note', 'กรุณานำบัตรประชาชนไปติดต่อห้องเวชระเบียนก่อน แล้วจึงมาที่ห้องนวดแผนไทยก่อนเวลานัด 15–20 นาที', 'คำแนะนำการมารับบริการ (แสดงบนหน้าจอง ตั๋ว kiosk และข้อความ LINE)', 'GENERAL', 'STRING', 0);

-- จองสำเร็จ: บรรทัดเช็กอินเดิม → {checkin_note}
UPDATE notification_templates
   SET body = REPLACE(body, 'กรุณามาเช็กอินที่เคาน์เตอร์ก่อนเวลานัด 10–15 นาที', '{checkin_note}')
 WHERE type = 'BOOKED' AND body NOT LIKE '%{checkin_note}%';

-- เตือนพรุ่งนี้ / เตือน 2 ชม.: เพิ่ม {checkin_note} ถ้ายังไม่มี (เป็นเวลาที่คนไข้กำลังเตรียมตัวออกจากบ้าน)
UPDATE notification_templates SET body = CONCAT(body, '\n\n{checkin_note}')
 WHERE type = 'REMIND_1D' AND body NOT LIKE '%{checkin_note}%';
UPDATE notification_templates
   SET body = REPLACE(body, '\nกรุณากด "ยืนยัน"', '\n{checkin_note}\nกรุณากด "ยืนยัน"')
 WHERE type = 'REMIND_2H' AND body NOT LIKE '%{checkin_note}%';

SELECT 'migration 005 done' AS status,
       (SELECT setting_value FROM settings WHERE setting_key = 'checkin_note') AS checkin_note,
       (SELECT COUNT(*) FROM notification_templates WHERE body LIKE '%{checkin_note}%') AS templates_using_note;
