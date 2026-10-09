-- =====================================================================
-- 00_create_database.sql
-- สร้างฐานข้อมูลและ user สำหรับแอป (รันด้วย root ครั้งเดียว)
-- =====================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;   -- สำคัญ: กันภาษาไทยเพี้ยนตอนรันผ่าน CLI บน Windows

CREATE DATABASE IF NOT EXISTS thai_massage_booking
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;   -- ใช้ได้ทั้ง MariaDB และ MySQL (0900_ai_ci มีแค่ MySQL 8)

-- user ของแอป: สิทธิ์เฉพาะอ่าน/เขียนข้อมูล + เรียก procedure (ไม่ใช้ root ในแอป)
-- ⚠ เปลี่ยนรหัสผ่านก่อนใช้งานจริง แล้วใส่ค่าเดียวกันใน backend/.env
-- สร้าง 2 แบบ: 'localhost' (ต่อผ่าน socket) และ '127.0.0.1' (ต่อผ่าน TCP ตาม DB_HOST=127.0.0.1)
-- MariaDB บางเครื่องตั้ง skip-name-resolve → TCP จาก 127.0.0.1 จะไม่นับเป็น 'localhost'
CREATE USER IF NOT EXISTS 'massage_app'@'localhost' IDENTIFIED BY 'ChangeMe_Dev_2026!';
CREATE USER IF NOT EXISTS 'massage_app'@'127.0.0.1' IDENTIFIED BY 'ChangeMe_Dev_2026!';
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE
  ON thai_massage_booking.* TO 'massage_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE
  ON thai_massage_booking.* TO 'massage_app'@'127.0.0.1';
FLUSH PRIVILEGES;
