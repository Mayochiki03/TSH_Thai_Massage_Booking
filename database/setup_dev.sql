-- =====================================================================
-- setup_dev.sql — ล้างแล้วสร้างฐานข้อมูล DEV ใหม่ทั้งหมด (รันด้วย mysql CLI)
--
--   cd database
--   mysql -u root -p < setup_dev.sql
--
-- ⚠ DROP DATABASE — ข้อมูลเดิมหายทั้งหมด ใช้กับเครื่อง dev เท่านั้น
-- =====================================================================

SET NAMES utf8mb4;   -- สำคัญ: กันภาษาไทยเพี้ยนตอนรันผ่าน CLI บน Windows

DROP DATABASE IF EXISTS thai_massage_booking;

SOURCE 00_create_database.sql;
SOURCE 01_schema.sql;
SOURCE 02_procedures.sql;
SOURCE 03_seed.sql;
SOURCE 04_dev_sample.sql;
