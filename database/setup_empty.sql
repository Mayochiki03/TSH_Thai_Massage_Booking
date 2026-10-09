-- =====================================================================
-- setup_empty.sql — สร้างฐานข้อมูลเปล่า (โครงสร้าง + procedure) ไม่มีข้อมูลตั้งต้น
--
-- ใช้ตอน "ย้ายข้อมูล" จากเครื่อง/ฐานข้อมูลเดิม (เช่น MySQL → MariaDB):
--   1) รันไฟล์นี้บนฐานข้อมูลใหม่
--   2) import ไฟล์ข้อมูลที่ dump มา (--no-create-info) ทับลงไป
-- ดูขั้นตอนเต็มใน docs/INSTALL.md หัวข้อ "ย้ายข้อมูลจาก MySQL"
--
-- ⚠ DROP DATABASE — ข้อมูลเดิมในฐานข้อมูลปลายทางหายทั้งหมด
-- =====================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

DROP DATABASE IF EXISTS thai_massage_booking;

SOURCE 00_create_database.sql;
SOURCE 01_schema.sql;
SOURCE 02_procedures.sql;

SELECT 'empty schema ready — import data next' AS status;
