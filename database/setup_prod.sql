-- =====================================================================
-- setup_prod.sql — สร้างฐานข้อมูลสำหรับเครื่องใช้งานจริง (ครั้งแรกครั้งเดียว)
--   โครงสร้าง + procedure + ค่าตั้งต้น (ไม่มีข้อมูลตัวอย่าง / บัญชีทดสอบ)
--
--   Ubuntu:  cd database && sudo mariadb < setup_prod.sql
--
-- หลังรันเสร็จ ต้องเปลี่ยนรหัสผ่าน massage_app ทันที (ดู docs/INSTALL.md)
-- ⚠ ไม่มี DROP DATABASE — ถ้ามีฐานข้อมูลชื่อนี้อยู่แล้ว ตาราง/ค่าตั้งต้นจะ error ให้หยุดแล้วตรวจก่อน
-- =====================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SOURCE 00_create_database.sql;
SOURCE 01_schema.sql;
SOURCE 02_procedures.sql;
SOURCE 03_seed.sql;

SELECT 'production schema + seed ready — change massage_app password now' AS status;
