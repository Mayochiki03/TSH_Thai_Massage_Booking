-- =====================================================================
-- 01_schema.sql — ระบบจองคิวนวดแผนไทย (สเปก v3 + ปรับ v0.6: หลายเตียง / ประเภทบริการ / เลขบัตร / VN)
-- MySQL 8.0+ · utf8mb4
--
-- หมายเหตุเรื่องเวลา: คอลัมน์ TIMESTAMP เก็บเป็น UTC และแปลงตาม time_zone ของ session
-- backend ต้องตั้ง time_zone = '+07:00' ทุก connection เพื่อให้ NOW()/CURDATE() เป็นเวลาไทย
-- =====================================================================

SET NAMES utf8mb4;   -- สำคัญ: กันภาษาไทยเพี้ยนตอนรันผ่าน CLI บน Windows

USE thai_massage_booking;
SET time_zone = '+07:00';

-- ---------------------------------------------------------------------
-- ผู้รับบริการ (มี HN หรือเป็นบุคคลทั่วไป)
-- ---------------------------------------------------------------------
CREATE TABLE patients (
  patient_id      BIGINT AUTO_INCREMENT PRIMARY KEY,
  patient_type    ENUM('HN','GENERAL') NOT NULL DEFAULT 'GENERAL',
  hn              VARCHAR(20)  NULL,
  first_name      VARCHAR(100) NOT NULL,
  last_name       VARCHAR(100) NOT NULL,
  phone_number    VARCHAR(15)  NOT NULL,
  -- เลขบัตรประชาชน 13 หลัก (ข้อมูลส่วนบุคคล → ไม่เก็บแบบอ่านได้)
  --   national_id_enc   เข้ารหัส AES-256-GCM ด้วย APP_SECRET_KEY (ถอดได้เฉพาะ backend: ใช้ตอนแก้ไข/ส่งออก Excel)
  --   national_id_hash  HMAC-SHA256 ของเลข 13 หลัก → ใช้ค้นหา/กันลงทะเบียนซ้ำ โดยไม่ต้องถอดรหัส
  --   national_id_last4 4 ตัวท้าย → แสดงแบบปิดบัง x-xxxx-xxxx9-87-6
  --   no_national_id    ไม่มีบัตรประชาชนไทย (เช่น ชาวต่างชาติ) → ไม่บังคับกรอก
  national_id_enc   VARCHAR(255) NULL,
  national_id_hash  CHAR(64)     NULL,
  national_id_last4 CHAR(4)      NULL,
  no_national_id    BOOLEAN NOT NULL DEFAULT FALSE,
  note            VARCHAR(255) NULL,
  is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,          -- soft delete
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_hn (hn),                                    -- NULL ซ้ำกันได้ (บุคคลทั่วไป)
  UNIQUE KEY uq_national_id (national_id_hash),             -- 1 เลขบัตร = 1 คน
  INDEX idx_phone (phone_number),
  INDEX idx_name (first_name, last_name),
  CONSTRAINT chk_hn_type CHECK (
    (patient_type = 'HN' AND hn IS NOT NULL) OR (patient_type = 'GENERAL' AND hn IS NULL)
  )
);

-- ---------------------------------------------------------------------
-- ผู้จอง (บัญชี LINE)
-- ---------------------------------------------------------------------
CREATE TABLE line_users (
  line_user_id     VARCHAR(50) PRIMARY KEY,
  display_name     VARCHAR(200) NULL,
  picture_url      VARCHAR(500) NULL,
  self_patient_id  BIGINT NULL,                             -- ข้อมูลของตัวผู้จองเอง ("จองให้ตัวเอง")
  pdpa_consent_at  TIMESTAMP NULL,
  is_blocked       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at     TIMESTAMP NULL,
  CONSTRAINT fk_lineuser_self FOREIGN KEY (self_patient_id) REFERENCES patients(patient_id)
);

-- รายชื่อผู้รับบริการที่ผู้จองเคยจองให้ (ครั้งหน้ากดเลือกได้เลย)
CREATE TABLE booker_patients (
  line_user_id  VARCHAR(50) NOT NULL,
  patient_id    BIGINT NOT NULL,
  relation      VARCHAR(50) NOT NULL DEFAULT 'ตนเอง',        -- ตนเอง / มารดา / บิดา / ...
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (line_user_id, patient_id),
  INDEX idx_bp_patient (patient_id),
  CONSTRAINT fk_bp_lineuser FOREIGN KEY (line_user_id) REFERENCES line_users(line_user_id) ON DELETE CASCADE,
  CONSTRAINT fk_bp_patient  FOREIGN KEY (patient_id)   REFERENCES patients(patient_id)
);

-- ---------------------------------------------------------------------
-- หมอนวด / ผู้ใช้ระบบ
-- ---------------------------------------------------------------------
CREATE TABLE practitioners (
  practitioner_id INT AUTO_INCREMENT PRIMARY KEY,
  full_name       VARCHAR(200) NOT NULL,
  license_no      VARCHAR(50)  NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE staff_users (
  user_id              INT AUTO_INCREMENT PRIMARY KEY,
  username             VARCHAR(50)  NOT NULL UNIQUE,
  password_hash        VARCHAR(255) NOT NULL,              -- bcrypt
  full_name            VARCHAR(200) NOT NULL,
  -- DEV          = นักพัฒนา: ทุกเมนู + เมนูนักพัฒนา (การเชื่อมต่อ / ผู้ใช้จำลอง / เครื่องมือทดสอบ)
  -- ADMIN        = ผู้ดูแลระบบ: dashboard + ตั้งค่าทั้งหมด (ยกเว้นเมนูนักพัฒนา)
  -- STAFF        = เจ้าหน้าที่เคาน์เตอร์
  -- PRACTITIONER = หมอนวด
  -- KIOSK        = บัญชีของเครื่อง kiosk (จอง walk-in / เช็กอินด้วยตัวเอง) ใช้ได้แค่หน้า kiosk
  role                 ENUM('DEV','ADMIN','STAFF','PRACTITIONER','KIOSK') NOT NULL,
  practitioner_id      INT NULL,                           -- ใช้เมื่อ role = PRACTITIONER
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  -- ยืนยันตัวตน 2 ชั้น (TOTP / แอป Authenticator) — ดู backend/src/utils/totp.js
  --   totp_secret_enc  กุญแจลับ (เข้ารหัส AES-256-GCM)  · มีค่าแต่ totp_enabled_at ว่าง = สแกน QR แล้วแต่ยังไม่ยืนยัน
  --   totp_required    แอดมินบังคับให้บัญชีนี้ใช้ 2FA (ADMIN / DEV บังคับเสมอตาม MFA_REQUIRED_ROLES ใน .env)
  --   totp_last_step   ช่วงเวลาของรหัสล่าสุดที่ใช้ — กันนำรหัสเดิมมาใช้ซ้ำ
  totp_secret_enc      VARCHAR(255) NULL,
  totp_enabled_at      TIMESTAMP NULL,
  totp_required        BOOLEAN NOT NULL DEFAULT FALSE,
  totp_last_step       BIGINT NULL,
  -- เพิ่มค่าทุกครั้งที่รีเซ็ตรหัสผ่าน / รีเซ็ต 2FA → session เดิมทุกเครื่องใช้ไม่ได้ทันที
  session_version      INT NOT NULL DEFAULT 0,
  last_login_at        TIMESTAMP NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_staff_practitioner FOREIGN KEY (practitioner_id) REFERENCES practitioners(practitioner_id)
);

-- รหัสสำรอง 2FA (กรณีมือถือหาย) — เก็บเป็น HMAC เท่านั้น ใช้ได้ชุดละครั้ง
CREATE TABLE staff_recovery_codes (
  code_id     INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT      NOT NULL,
  code_hash   CHAR(64) NOT NULL,
  used_at     TIMESTAMP NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_recovery (user_id, code_hash),
  CONSTRAINT fk_recovery_user FOREIGN KEY (user_id) REFERENCES staff_users(user_id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------
-- ประเภทบริการ (นวดแผนไทย / นวดประคบ ...) — ใช้เวลารอบเท่ากัน ต่างกันที่ราคา
-- ---------------------------------------------------------------------
CREATE TABLE service_types (
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

-- ---------------------------------------------------------------------
-- รอบเวลา / วันหยุด / slot
-- ---------------------------------------------------------------------
-- แม่แบบรอบเวลา (CRUD ในหน้าแอดมิน) — cron ใช้สร้าง time_slots
CREATE TABLE slot_templates (
  template_id INT AUTO_INCREMENT PRIMARY KEY,
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL,
  sort_order  INT  NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uq_template_start (start_time),
  CONSTRAINT chk_template_time CHECK (end_time > start_time)
);

CREATE TABLE holidays (
  holiday_date DATE PRIMARY KEY,
  name         VARCHAR(200) NOT NULL,
  created_by   INT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_holiday_creator FOREIGN KEY (created_by) REFERENCES staff_users(user_id)
);

-- 1 แถว = 1 รอบเวลาของคลินิก รับได้ capacity คิวพร้อมกัน (= จำนวนเตียง / หมอนวดที่ว่างในรอบนั้น)
-- ไม่ผูกกับหมอนวด: หมอนวดคนไหนว่างก็กด "เริ่มนวด" รับคิว แล้วระบบบันทึกไว้ที่ appointments.practitioner_id
CREATE TABLE time_slots (
  slot_id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  slot_date       DATE NOT NULL,
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL,
  capacity        TINYINT UNSIGNED NOT NULL DEFAULT 1,     -- รับได้กี่คิว (เตียง) ในรอบนี้
  is_blocked      BOOLEAN NOT NULL DEFAULT FALSE,
  block_reason    VARCHAR(255) NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_slot (slot_date, start_time),                   -- กัน cron สร้างซ้ำ
  INDEX idx_slot_date (slot_date),
  CONSTRAINT chk_slot_time CHECK (end_time > start_time),
  CONSTRAINT chk_slot_capacity CHECK (capacity BETWEEN 1 AND 50)
);

-- ---------------------------------------------------------------------
-- การจอง
-- ---------------------------------------------------------------------
CREATE TABLE appointments (
  appointment_id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  booking_code           CHAR(6) NOT NULL,
  patient_id             BIGINT  NOT NULL,                 -- ผู้รับบริการ
  booked_by_line_user_id VARCHAR(50) NULL,                 -- ผู้จอง (NULL = เจ้าหน้าที่จองแทน / walk-in)
  booked_by_staff        INT NULL,                         -- เจ้าหน้าที่ที่ทำรายการ
  booker_relation        VARCHAR(50) NULL,                 -- ความสัมพันธ์ผู้จอง → ผู้รับบริการ
  slot_id                BIGINT  NOT NULL,
  -- ONLINE = ผ่าน LINE, WALK_IN = เจ้าหน้าที่รับหน้าเคาน์เตอร์, STAFF = เจ้าหน้าที่จองแทน (โทรศัพท์), KIOSK = จองเองที่เครื่อง kiosk
  booking_channel        ENUM('ONLINE','WALK_IN','STAFF','KIOSK') NOT NULL DEFAULT 'ONLINE',
  chief_complaint        TEXT NULL,
  service_type_id        INT NULL,                         -- ประเภทบริการที่เลือกตอนจอง
  service_price          DECIMAL(10,2) NULL,               -- ราคา ณ ตอนจอง (แก้ราคาภายหลังไม่กระทบคิวเก่า)
  practitioner_id        INT NULL,                         -- หมอนวดที่นวดจริง (บันทึกตอนกดเริ่มนวด)
  vn                     VARCHAR(20) NULL,                 -- Visit Number ของโรงพยาบาล (ใช้ตอนเบิกจ่าย)
  status                 ENUM('BOOKED','CHECKED_IN','IN_SERVICE','COMPLETED','NO_SHOW','CANCELLED')
                         NOT NULL DEFAULT 'BOOKED',
  -- slot ของคิวที่ "ยังกินที่" (CANCELLED / NO_SHOW = NULL → คืนที่ให้ walk-in)
  -- ใช้นับว่ารอบนั้นเต็มหรือยัง (เทียบกับ time_slots.capacity) — การกันจองเกินทำใน transaction ที่ล็อกแถว slot
  active_slot_id         BIGINT GENERATED ALWAYS AS
                         (IF(status IN ('CANCELLED','NO_SHOW'), NULL, slot_id)) STORED,
  confirmed_at           TIMESTAMP NULL,                   -- กดยืนยันตอนเตือน 2 ชม.
  checked_in_at          TIMESTAMP NULL,
  checked_in_by          INT NULL,
  cancelled_at           TIMESTAMP NULL,
  cancelled_by           ENUM('PATIENT','STAFF','SYSTEM') NULL,
  cancel_reason          VARCHAR(255) NULL,
  created_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_booking_code (booking_code),
  INDEX idx_active_slot (active_slot_id),
  INDEX idx_practitioner (practitioner_id),
  INDEX idx_vn (vn),
  INDEX idx_patient_status (patient_id, status),
  INDEX idx_booker (booked_by_line_user_id),
  INDEX idx_slot (slot_id),
  INDEX idx_status (status),
  CONSTRAINT fk_appt_patient   FOREIGN KEY (patient_id)             REFERENCES patients(patient_id),
  CONSTRAINT fk_appt_booker    FOREIGN KEY (booked_by_line_user_id) REFERENCES line_users(line_user_id),
  CONSTRAINT fk_appt_staff     FOREIGN KEY (booked_by_staff)        REFERENCES staff_users(user_id),
  CONSTRAINT fk_appt_slot      FOREIGN KEY (slot_id)                REFERENCES time_slots(slot_id),
  CONSTRAINT fk_appt_checkinby FOREIGN KEY (checked_in_by)          REFERENCES staff_users(user_id),
  CONSTRAINT fk_appt_service   FOREIGN KEY (service_type_id)        REFERENCES service_types(service_type_id),
  CONSTRAINT fk_appt_practitioner FOREIGN KEY (practitioner_id)     REFERENCES practitioners(practitioner_id)
);

-- บันทึกการให้บริการ (ลงเวชระเบียน)
CREATE TABLE service_records (
  record_id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  appointment_id      BIGINT NOT NULL UNIQUE,
  treatment_details   TEXT NULL,
  post_treatment_note TEXT NULL,
  service_start       TIMESTAMP NULL,
  service_end         TIMESTAMP NULL,
  recorded_by         INT NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_sr_appt  FOREIGN KEY (appointment_id) REFERENCES appointments(appointment_id),
  CONSTRAINT fk_sr_staff FOREIGN KEY (recorded_by)    REFERENCES staff_users(user_id)
);

-- ---------------------------------------------------------------------
-- ระงับสิทธิ์ (no-show)
-- ---------------------------------------------------------------------
CREATE TABLE patient_suspensions (
  suspension_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  patient_id    BIGINT NOT NULL,
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  reason        VARCHAR(255) NOT NULL,
  source        ENUM('AUTO','MANUAL') NOT NULL,
  created_by    INT NULL,
  lifted_at     TIMESTAMP NULL,                            -- ปลดก่อนกำหนด
  lifted_by     INT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_susp_patient (patient_id, end_date),
  CONSTRAINT fk_susp_patient FOREIGN KEY (patient_id) REFERENCES patients(patient_id),
  CONSTRAINT fk_susp_creator FOREIGN KEY (created_by) REFERENCES staff_users(user_id),
  CONSTRAINT fk_susp_lifter  FOREIGN KEY (lifted_by)  REFERENCES staff_users(user_id),
  CONSTRAINT chk_susp_dates CHECK (end_date >= start_date)
);

-- ---------------------------------------------------------------------
-- การแจ้งเตือน
-- ---------------------------------------------------------------------
CREATE TABLE notification_templates (
  type        ENUM('BOOKED','REMIND_1D','REMIND_2H','CANCELLED','HOLIDAY_CANCELLED','SUSPENDED') PRIMARY KEY,
  title       VARCHAR(100) NOT NULL,
  body        TEXT NOT NULL,     -- ตัวแปร: {patient_name} {date} {time} {code} {reason} {end_date} {rebook_url}
  is_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE notification_logs (
  log_id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  appointment_id BIGINT NULL,
  line_user_id   VARCHAR(50) NOT NULL,
  type           VARCHAR(30) NOT NULL,
  channel        ENUM('PUSH','LIFF') NOT NULL DEFAULT 'PUSH',   -- LIFF = liff.sendMessages (ไม่กินโควตา)
  status         ENUM('SENT','FAILED','SKIPPED') NOT NULL,     -- SKIPPED = โหมด LOCAL / ยังไม่ตั้งค่า LINE
  error_message  VARCHAR(500) NULL,
  sent_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_once (appointment_id, type),               -- กันส่งซ้ำต่อคิว
  INDEX idx_sent_at (sent_at),
  CONSTRAINT fk_nl_appt FOREIGN KEY (appointment_id) REFERENCES appointments(appointment_id)
);

-- ---------------------------------------------------------------------
-- ตั้งค่าระบบ (CRUD ในหน้าแอดมิน)
-- ---------------------------------------------------------------------
CREATE TABLE settings (
  setting_key   VARCHAR(50) PRIMARY KEY,
  setting_value VARCHAR(1000) NOT NULL DEFAULT '',
  label         VARCHAR(255) NOT NULL,
  category      ENUM('BOOKING','SUSPENSION','GENERAL','CONNECTION') NOT NULL,
  value_type    ENUM('INT','BOOL','STRING','SECRET') NOT NULL DEFAULT 'INT',  -- SECRET = เข้ารหัสโดย backend
  sort_order    INT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------
-- Audit log (PDPA: ใครแก้อะไร เมื่อไร)
-- ---------------------------------------------------------------------
CREATE TABLE audit_logs (
  audit_id    BIGINT AUTO_INCREMENT PRIMARY KEY,
  actor_type  ENUM('STAFF','LINE','SYSTEM') NOT NULL,
  actor_id    VARCHAR(50) NULL,
  action      VARCHAR(50) NOT NULL,                        -- CREATE / UPDATE / DELETE / CHECK_IN / CANCEL ...
  entity      VARCHAR(50) NOT NULL,                        -- appointments / patients / settings ...
  entity_id   VARCHAR(50) NULL,
  detail      JSON NULL,
  ip_address  VARCHAR(45) NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_entity (entity, entity_id),
  INDEX idx_audit_created (created_at)
);

-- ---------------------------------------------------------------------
-- View: รายละเอียดคิว (ใช้กับหน้าคิววันนี้ / ค้นหา / รายงาน)
-- ---------------------------------------------------------------------
CREATE VIEW v_appointment_details AS
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

-- View: แต่ละรอบรับได้กี่คิว / จองไปแล้วกี่คิว / เหลือกี่ที่
--   availability: HOLIDAY / BLOCKED / FULL (ครบ capacity) / AVAILABLE
CREATE VIEW v_slot_availability AS
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
