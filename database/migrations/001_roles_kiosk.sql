-- =====================================================================
-- migrations/001_roles_kiosk.sql  (v0.3.0)
-- ใช้กับฐานข้อมูลที่สร้างจาก v0.1–0.2 แล้ว โดยไม่ต้องล้างข้อมูล
--   mysql -u root -p -e "source migrations/001_roles_kiosk.sql"
-- (ถ้ารัน setup_dev.sql ใหม่ทั้งหมด ไม่ต้องรันไฟล์นี้)
-- =====================================================================
SET NAMES utf8mb4;
USE thai_massage_booking;

-- เพิ่ม role นักพัฒนา (DEV) และบัญชีเครื่อง kiosk (KIOSK)
ALTER TABLE staff_users
  MODIFY role ENUM('DEV','ADMIN','STAFF','PRACTITIONER','KIOSK') NOT NULL;

-- เพิ่มช่องทางการจองจาก kiosk
ALTER TABLE appointments
  MODIFY booking_channel ENUM('ONLINE','WALK_IN','STAFF','KIOSK') NOT NULL DEFAULT 'ONLINE';

-- บัญชีนักพัฒนา dev / admin1234 (บังคับเปลี่ยนรหัสผ่านครั้งแรก)
INSERT IGNORE INTO staff_users (username, password_hash, full_name, role, must_change_password)
VALUES ('dev', '$2b$10$xMyz7DWrIDeu5usbw56VTexzNxP3gTpImGD6nsmOLjKYHMkA7KbKG', 'นักพัฒนาระบบ', 'DEV', TRUE);

-- ตั้งค่าเวลาที่ kiosk กลับหน้าแรกเอง
INSERT IGNORE INTO settings (setting_key, setting_value, label, category, value_type, sort_order)
VALUES ('kiosk_idle_sec', '60', 'kiosk กลับหน้าแรกเองเมื่อไม่มีคนใช้ (วินาที)', 'GENERAL', 'INT', 4);

SELECT 'migration 001 done' AS status;
