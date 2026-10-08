-- =====================================================================
-- migrations/003_show_price.sql — v0.6.0 → v0.6.1
--   เพิ่มค่าตั้ง show_price: แสดงราคาให้ผู้รับบริการเห็นหรือไม่ (ค่าเริ่มต้น = ไม่แสดง)
--   เจ้าหน้าที่ / ผู้ดูแล / รายงาน Excel เห็นราคาเสมอ
--
--   cd database
--   mysql -u root -p -e "source migrations/003_show_price.sql"
--
-- รันซ้ำได้ ไม่เสียหาย (INSERT IGNORE)
-- =====================================================================
SET NAMES utf8mb4;
USE thai_massage_booking;

INSERT IGNORE INTO settings (setting_key, setting_value, label, category, value_type, sort_order)
VALUES ('show_price', '0', 'แสดงราคาให้ผู้รับบริการเห็น (LINE / kiosk / ข้อความแจ้งเตือน)', 'BOOKING', 'BOOL', 0);

SELECT 'migration 003 done' AS status,
       (SELECT setting_value FROM settings WHERE setting_key = 'show_price') AS show_price;
