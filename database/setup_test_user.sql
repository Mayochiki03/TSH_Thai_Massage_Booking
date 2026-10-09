-- =====================================================================
-- setup_test_user.sql — user สำหรับรัน test อัตโนมัติ (npm test) — รันครั้งเดียวต่อเครื่อง
--
--   Windows: & "C:\Program Files\MariaDB 10.11\bin\mariadb.exe" -u root -p -P 3307 -e "source setup_test_user.sql"
--   Ubuntu : sudo mariadb < setup_test_user.sql
--
-- สิทธิ์ทำได้ทุกอย่าง "เฉพาะ" ฐานข้อมูล thai_massage_booking_test (test ล้างแล้วสร้างใหม่ทุกครั้ง)
-- แตะฐานข้อมูลจริง thai_massage_booking ไม่ได้เลย
-- ⚠ ใช้บนเครื่อง dev / เครื่อง CI เท่านั้น ไม่ต้องสร้างบน server ใช้งานจริง
-- =====================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'massage_test'@'localhost' IDENTIFIED BY 'Test_Only_2026!';
CREATE USER IF NOT EXISTS 'massage_test'@'127.0.0.1' IDENTIFIED BY 'Test_Only_2026!';
GRANT ALL PRIVILEGES ON `thai_massage_booking_test`.* TO 'massage_test'@'localhost';
GRANT ALL PRIVILEGES ON `thai_massage_booking_test`.* TO 'massage_test'@'127.0.0.1';
FLUSH PRIVILEGES;

SELECT 'test user ready: massage_test (เฉพาะ thai_massage_booking_test)' AS status;
