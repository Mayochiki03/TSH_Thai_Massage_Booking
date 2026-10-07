-- =====================================================================
-- 00_create_database.sql
-- สร้างฐานข้อมูลและ user สำหรับแอป (รันด้วย root ครั้งเดียว)
-- =====================================================================

SET NAMES utf8mb4;   -- สำคัญ: กันภาษาไทยเพี้ยนตอนรันผ่าน CLI บน Windows

CREATE DATABASE IF NOT EXISTS thai_massage_booking
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

-- user ของแอป: สิทธิ์เฉพาะอ่าน/เขียนข้อมูล + เรียก procedure (ไม่ใช้ root ในแอป)
-- ⚠ เปลี่ยนรหัสผ่านก่อนใช้งานจริง แล้วใส่ค่าเดียวกันใน backend/.env
CREATE USER IF NOT EXISTS 'massage_app'@'localhost' IDENTIFIED BY 'ChangeMe_Dev_2026!';
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE
  ON thai_massage_booking.* TO 'massage_app'@'localhost';
FLUSH PRIVILEGES;
