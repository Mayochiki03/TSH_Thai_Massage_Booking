-- =====================================================================
-- migrations/002_beds_services_nid.sql  (v0.5 → v0.6)
-- ใช้กับฐานข้อมูลที่มีข้อมูลอยู่แล้ว โดยไม่ต้องล้างข้อมูล (ค่าการเชื่อมต่อ LINE ยังอยู่)
--
--   cd database
--   mysql -u root -p -e "source migrations/002_beds_services_nid.sql"
--
-- (ถ้ารัน setup_dev.sql ใหม่ทั้งหมด ไม่ต้องรันไฟล์นี้)
--
-- เปลี่ยนอะไรบ้าง
--   1) ประเภทบริการ + ราคา (service_types) และบันทึกประเภท/ราคาในแต่ละคิว
--   2) หลายเตียง: 1 รอบเวลา รับได้หลายคิว (time_slots.capacity) — slot ไม่ผูกกับหมอนวดแล้ว
--      ถ้าเดิมมีหมอนวดหลายคน (slot ซ้ำเวลาเดียวกัน) จะรวมเป็น slot เดียว capacity = จำนวนเดิม
--   3) บันทึกหมอนวดที่นวดจริง (appointments.practitioner_id) และ VN
--   4) เลขบัตรประชาชน 13 หลักของผู้รับบริการ (เข้ารหัส) — ผู้รับบริการเดิมจะถูกขอให้กรอกตอนจองครั้งถัดไป
-- =====================================================================
SET NAMES utf8mb4;
USE thai_massage_booking;
SET time_zone = '+07:00';

-- ---------------------------------------------------------------------
-- 1) ประเภทบริการ
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_types (
  service_type_id INT AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(100)  NOT NULL,
  description     VARCHAR(255)  NULL,
  price           DECIMAL(10,2) NOT NULL DEFAULT 0,
  sort_order      INT NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_service_name (name),
  CONSTRAINT chk_service_price CHECK (price >= 0)
);
-- ⚠ ราคาเป็นค่าตัวอย่าง แก้ที่เมนู "ประเภทบริการและราคา"
INSERT IGNORE INTO service_types (name, description, price, sort_order) VALUES
  ('นวดแผนไทย',              'นวดไทยแบบทั่วไป',                    200.00, 1),
  ('นวดแผนไทย + ประคบสมุนไพร', 'นวดไทยร่วมกับลูกประคบสมุนไพรร้อน', 300.00, 2);

-- ---------------------------------------------------------------------
-- 2) appointments: ประเภท/ราคา, หมอนวด, VN และเลิก "1 slot = 1 คิว"
-- ---------------------------------------------------------------------
ALTER TABLE appointments
  ADD COLUMN service_type_id INT NULL           AFTER chief_complaint,
  ADD COLUMN service_price   DECIMAL(10,2) NULL AFTER service_type_id,
  ADD COLUMN practitioner_id INT NULL           AFTER service_price,
  ADD COLUMN vn              VARCHAR(20) NULL   AFTER practitioner_id,
  DROP INDEX uq_active_slot,
  ADD INDEX idx_active_slot (active_slot_id),
  ADD INDEX idx_practitioner (practitioner_id),
  ADD INDEX idx_vn (vn),
  ADD CONSTRAINT fk_appt_service      FOREIGN KEY (service_type_id) REFERENCES service_types(service_type_id),
  ADD CONSTRAINT fk_appt_practitioner FOREIGN KEY (practitioner_id) REFERENCES practitioners(practitioner_id);

-- คิวเดิมทั้งหมด = นวดแผนไทย (ราคาปัจจุบัน)
UPDATE appointments a
  JOIN (SELECT service_type_id, price FROM service_types ORDER BY sort_order, service_type_id LIMIT 1) st
   SET a.service_type_id = st.service_type_id, a.service_price = st.price
 WHERE a.service_type_id IS NULL;

-- หมอนวดของคิวที่เริ่ม/นวดเสร็จแล้ว: เดาจากบัญชีหมอนวดที่บันทึกผล
UPDATE appointments a
  JOIN service_records sr ON sr.appointment_id = a.appointment_id
  JOIN staff_users u      ON u.user_id = sr.recorded_by
   SET a.practitioner_id = u.practitioner_id
 WHERE a.practitioner_id IS NULL AND u.practitioner_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 3) time_slots: รวม slot ซ้ำเวลา (เดิมแยกตามหมอนวด) → slot เดียว + capacity
-- ---------------------------------------------------------------------
ALTER TABLE time_slots ADD COLUMN capacity TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER end_time;

DROP TEMPORARY TABLE IF EXISTS tmp_slot_keep;
CREATE TEMPORARY TABLE tmp_slot_keep AS
  SELECT slot_date, start_time, MIN(slot_id) AS keep_id, COUNT(*) AS n, MIN(is_blocked) AS all_blocked
    FROM time_slots GROUP BY slot_date, start_time;

-- คิวที่อยู่ใน slot ซ้ำ → ย้ายไป slot ที่เก็บไว้
UPDATE appointments a
  JOIN time_slots s     ON s.slot_id = a.slot_id
  JOIN tmp_slot_keep k  ON k.slot_date = s.slot_date AND k.start_time = s.start_time
   SET a.slot_id = k.keep_id
 WHERE a.slot_id <> k.keep_id;

UPDATE time_slots s
  JOIN tmp_slot_keep k ON k.keep_id = s.slot_id
   SET s.capacity = LEAST(k.n, 50), s.is_blocked = k.all_blocked;

DELETE s FROM time_slots s
  JOIN tmp_slot_keep k ON k.slot_date = s.slot_date AND k.start_time = s.start_time
 WHERE s.slot_id <> k.keep_id;

DROP TEMPORARY TABLE tmp_slot_keep;

ALTER TABLE time_slots
  DROP FOREIGN KEY fk_slot_practitioner,
  DROP INDEX uq_slot,
  DROP COLUMN practitioner_id,
  ADD UNIQUE KEY uq_slot (slot_date, start_time),
  ADD CONSTRAINT chk_slot_capacity CHECK (capacity BETWEEN 1 AND 50);

-- จำนวนเตียงตั้งต้น = จำนวนหมอนวดที่เปิดใช้งาน (เหมือนพฤติกรรมเดิม)
INSERT IGNORE INTO settings (setting_key, setting_value, label, category, value_type, sort_order)
SELECT 'bed_count', CAST(GREATEST(COUNT(*), 1) AS CHAR), 'จำนวนเตียงนวด (รับได้กี่คนต่อรอบ)', 'BOOKING', 'INT', 0
  FROM practitioners WHERE is_active = TRUE;

-- ---------------------------------------------------------------------
-- 4) patients: เลขบัตรประชาชน (เข้ารหัส)
-- ---------------------------------------------------------------------
ALTER TABLE patients
  ADD COLUMN national_id_enc   VARCHAR(255) NULL AFTER phone_number,
  ADD COLUMN national_id_hash  CHAR(64)     NULL AFTER national_id_enc,
  ADD COLUMN national_id_last4 CHAR(4)      NULL AFTER national_id_hash,
  ADD COLUMN no_national_id    BOOLEAN NOT NULL DEFAULT FALSE AFTER national_id_last4,
  ADD UNIQUE KEY uq_national_id (national_id_hash);

-- ---------------------------------------------------------------------
-- 5) view + procedure (ต้องตรงกับ 01_schema.sql / 02_procedures.sql)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_appointment_details AS
SELECT
  a.appointment_id, a.booking_code, a.status, a.booking_channel,
  s.slot_id, s.slot_date, s.start_time, s.end_time,
  p.patient_id, p.patient_type, p.hn, p.first_name, p.last_name, p.phone_number,
  p.national_id_last4, p.no_national_id, (p.national_id_hash IS NOT NULL) AS has_national_id,
  a.booked_by_line_user_id, lu.display_name AS booker_line_name, a.booker_relation,
  a.booked_by_staff, a.chief_complaint,
  a.service_type_id, st.name AS service_name, a.service_price,
  a.practitioner_id, pr.full_name AS practitioner_name, a.vn,
  a.confirmed_at, a.checked_in_at, a.cancelled_at, a.cancelled_by, a.cancel_reason,
  sr.service_start, sr.service_end, a.created_at
FROM appointments a
JOIN time_slots s       ON s.slot_id = a.slot_id
JOIN patients p         ON p.patient_id = a.patient_id
LEFT JOIN line_users lu ON lu.line_user_id = a.booked_by_line_user_id
LEFT JOIN service_types st ON st.service_type_id = a.service_type_id
LEFT JOIN practitioners pr ON pr.practitioner_id = a.practitioner_id
LEFT JOIN service_records sr ON sr.appointment_id = a.appointment_id;

CREATE OR REPLACE VIEW v_slot_availability AS
SELECT
  s.slot_id, s.slot_date, s.start_time, s.end_time, s.capacity,
  s.is_blocked, s.block_reason,
  COUNT(a.appointment_id) AS booked_count,
  GREATEST(s.capacity - COUNT(a.appointment_id), 0) AS remaining,
  CASE
    WHEN MAX(h.holiday_date) IS NOT NULL       THEN 'HOLIDAY'
    WHEN s.is_blocked                          THEN 'BLOCKED'
    WHEN COUNT(a.appointment_id) >= s.capacity THEN 'FULL'
    ELSE 'AVAILABLE'
  END AS availability
FROM time_slots s
LEFT JOIN appointments a ON a.active_slot_id = s.slot_id
LEFT JOIN holidays h     ON h.holiday_date = s.slot_date
GROUP BY s.slot_id;

SOURCE 02_procedures.sql;

SELECT 'migration 002 done' AS status,
       (SELECT setting_value FROM settings WHERE setting_key = 'bed_count') AS bed_count,
       (SELECT COUNT(*) FROM service_types) AS service_types;
