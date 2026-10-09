-- =====================================================================
-- 04_dev_sample.sql — ข้อมูลตัวอย่างสำหรับ DEV เท่านั้น (ห้ามรันบน production)
-- วันที่อ้างอิงจากวันที่รัน: @d0 = วันทำการวันนี้ (ถ้าเสาร์/อาทิตย์ → จันทร์ถัดไป), @d1 = วันทำการถัดไป
-- =====================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;   -- สำคัญ: กันภาษาไทยเพี้ยนตอนรันผ่าน CLI บน Windows

USE thai_massage_booking;
SET time_zone = '+07:00';

SET @d0 = CASE WEEKDAY(CURDATE())
            WHEN 5 THEN CURDATE() + INTERVAL 2 DAY
            WHEN 6 THEN CURDATE() + INTERVAL 1 DAY
            ELSE CURDATE() END;
SET @d1 = CASE WEEKDAY(@d0) WHEN 4 THEN @d0 + INTERVAL 3 DAY ELSE @d0 + INTERVAL 1 DAY END;
SET @past = @d0 - INTERVAL 7 DAY;   -- วันในอดีต (สำหรับประวัติ no-show)

-- dev: สาธิตหลายเตียง — 2 เตียง / หมอนวด 2 คน
UPDATE settings SET setting_value = '2' WHERE setting_key = 'bed_count';
UPDATE time_slots SET capacity = 2;
INSERT INTO practitioners (practitioner_id, full_name, license_no) VALUES (2, 'หมอนวด 2 (ทดสอบ)', NULL);

-- ให้แน่ใจว่ามี slot ของวันตัวอย่าง (แม้จะตรงวันหยุดก็ตาม — dev เท่านั้น)
INSERT IGNORE INTO time_slots (slot_date, start_time, end_time, capacity)
SELECT d.dt, t.start_time, t.end_time, 2
  FROM slot_templates t
  CROSS JOIN (SELECT @d0 AS dt UNION SELECT @d1 UNION SELECT @past) d
 WHERE t.is_active = TRUE;

-- ---------------------------------------------------------------------
-- ผู้ใช้ระบบตัวอย่าง (รหัสผ่านทุกคน: admin1234)
-- ---------------------------------------------------------------------
INSERT INTO staff_users (username, password_hash, full_name, role, practitioner_id, must_change_password) VALUES
  ('counter1', '$2b$10$xMyz7DWrIDeu5usbw56VTexzNxP3gTpImGD6nsmOLjKYHMkA7KbKG', 'เจ้าหน้าที่เคาน์เตอร์ (ทดสอบ)', 'STAFF',        NULL, FALSE),
  ('therapist1','$2b$10$xMyz7DWrIDeu5usbw56VTexzNxP3gTpImGD6nsmOLjKYHMkA7KbKG', 'หมอนวด (ทดสอบ)',              'PRACTITIONER', 1,    FALSE),
  ('therapist2','$2b$10$xMyz7DWrIDeu5usbw56VTexzNxP3gTpImGD6nsmOLjKYHMkA7KbKG', 'หมอนวด 2 (ทดสอบ)',            'PRACTITIONER', 2,    FALSE),
  ('kiosk1',    '$2b$10$xMyz7DWrIDeu5usbw56VTexzNxP3gTpImGD6nsmOLjKYHMkA7KbKG', 'เครื่อง kiosk หน้าคลินิก',     'KIOSK',        NULL, FALSE);
-- dev: ไม่ต้องเปลี่ยนรหัสผ่านตอนทดสอบ
UPDATE staff_users SET must_change_password = FALSE WHERE username IN ('admin', 'dev');

UPDATE settings SET setting_value = '02-000-0000' WHERE setting_key = 'counter_phone';

-- ---------------------------------------------------------------------
-- ผู้รับบริการตัวอย่าง
-- ---------------------------------------------------------------------
INSERT INTO patients (patient_id, patient_type, hn, first_name, last_name, phone_number) VALUES
  (1, 'HN',      'HN0012345', 'สมศรี',   'ใจดี',      '0811111111'),   -- ผู้จองเอง (มี HN)
  (2, 'HN',      'HN0067890', 'บุญมา',   'ใจดี',      '0822222222'),   -- แม่ของสมศรี
  (3, 'GENERAL', NULL,        'วิชัย',   'รักสุขภาพ', '0833333333'),   -- บุคคลทั่วไป
  (4, 'GENERAL', NULL,        'มานี',    'มีสุข',     '0844444444'),   -- walk-in
  (5, 'HN',      'HN0099999', 'ประเสริฐ', 'ขาดนัด',    '0855555555');   -- เคย no-show

-- บัญชี LINE จำลอง (ใช้กับโหมด LOCAL)
INSERT INTO line_users (line_user_id, display_name, self_patient_id, pdpa_consent_at, last_seen_at) VALUES
  ('Udev00000000000000000000000000001', 'Somsri', 1, NOW(), NOW()),
  ('Udev00000000000000000000000000002', 'Wichai',    3, NOW(), NOW()),
  ('Udev00000000000000000000000000003', 'Prasert',   5, NOW(), NOW());

INSERT INTO booker_patients (line_user_id, patient_id, relation) VALUES
  ('Udev00000000000000000000000000001', 1, 'ตนเอง'),
  ('Udev00000000000000000000000000001', 2, 'มารดา'),
  ('Udev00000000000000000000000000002', 3, 'ตนเอง'),
  ('Udev00000000000000000000000000003', 5, 'ตนเอง');

-- ---------------------------------------------------------------------
-- คิวตัวอย่าง (ครบทุกสถานะ)
-- ---------------------------------------------------------------------
-- helper: slot_id ของวัน/เวลา
SET @s = NULL;

-- @d0 09:00 — เสร็จแล้ว (มีบันทึกการรักษา)
INSERT INTO appointments (booking_code, patient_id, booked_by_line_user_id, booker_relation, slot_id, booking_channel,
                          chief_complaint, status, confirmed_at, checked_in_at, checked_in_by)
SELECT 'K7M4QX', 1, 'Udev00000000000000000000000000001', 'ตนเอง', slot_id, 'ONLINE',
       'ปวดคอบ่าไหล่ จากการนั่งทำงานนาน', 'COMPLETED', NOW(), NOW(), 2
  FROM time_slots WHERE slot_date = @d0 AND start_time = '09:00:00';
INSERT INTO service_records (appointment_id, treatment_details, post_treatment_note, service_start, service_end, recorded_by)
VALUES (LAST_INSERT_ID(), 'นวดคอ บ่า ไหล่ สะบัก ประคบสมุนไพร', 'ยืดเหยียดคอทุก 1 ชม. งดยกของหนัก 3 วัน',
        TIMESTAMP(@d0, '09:02:00'), TIMESTAMP(@d0, '09:58:00'), 3);

-- @d0 10:15 — เช็กอินแล้ว (แม่ ที่ลูกจองให้)
INSERT INTO appointments (booking_code, patient_id, booked_by_line_user_id, booker_relation, slot_id, booking_channel,
                          chief_complaint, status, confirmed_at, checked_in_at, checked_in_by)
SELECT 'P3HW9T', 2, 'Udev00000000000000000000000000001', 'มารดา', slot_id, 'ONLINE',
       'ปวดหลังส่วนล่าง ปวดเข่า', 'CHECKED_IN', NOW(), NOW(), 2
  FROM time_slots WHERE slot_date = @d0 AND start_time = '10:15:00';

-- @d0 11:15 — จองแล้ว ยืนยันแล้ว (บุคคลทั่วไป)
INSERT INTO appointments (booking_code, patient_id, booked_by_line_user_id, booker_relation, slot_id, booking_channel,
                          chief_complaint, status, confirmed_at)
SELECT 'R6NC2V', 3, 'Udev00000000000000000000000000002', 'ตนเอง', slot_id, 'ONLINE',
       'ตึงน่อง หลังวิ่ง', 'BOOKED', NOW()
  FROM time_slots WHERE slot_date = @d0 AND start_time = '11:15:00';

-- @d0 13:15 — จองแล้ว ยังไม่ยืนยัน (เจ้าหน้าที่จองแทนทางโทรศัพท์)
INSERT INTO appointments (booking_code, patient_id, booked_by_staff, slot_id, booking_channel, chief_complaint, status)
SELECT 'D9AZ4E', 4, 2, slot_id, 'STAFF', 'ปวดไหล่ขวา', 'BOOKED'
  FROM time_slots WHERE slot_date = @d0 AND start_time = '13:15:00';

-- @d0 15:30 — ยกเลิกแล้ว (slot ว่างให้จองใหม่ได้)
INSERT INTO appointments (booking_code, patient_id, booked_by_line_user_id, booker_relation, slot_id, booking_channel,
                          status, cancelled_at, cancelled_by, cancel_reason)
SELECT 'W2FJ8U', 3, 'Udev00000000000000000000000000002', 'ตนเอง', slot_id, 'ONLINE',
       'CANCELLED', NOW(), 'PATIENT', 'ติดธุระ'
  FROM time_slots WHERE slot_date = @d0 AND start_time = '15:30:00';

-- @d1 09:00 — คิวพรุ่งนี้
INSERT INTO appointments (booking_code, patient_id, booked_by_line_user_id, booker_relation, slot_id, booking_channel,
                          chief_complaint, status)
SELECT 'H4TY7G', 2, 'Udev00000000000000000000000000001', 'มารดา', slot_id, 'ONLINE', 'ปวดเข่า (นัดต่อเนื่อง)', 'BOOKED'
  FROM time_slots WHERE slot_date = @d1 AND start_time = '09:00:00';

-- @past 14:30 — no-show ในอดีต แล้วมี walk-in มาใช้ slot เดียวกัน (สาธิต active_slot_id)
INSERT INTO appointments (booking_code, patient_id, booked_by_line_user_id, booker_relation, slot_id, booking_channel, status)
SELECT 'X8QM3N', 5, 'Udev00000000000000000000000000003', 'ตนเอง', slot_id, 'ONLINE', 'NO_SHOW'
  FROM time_slots WHERE slot_date = @past AND start_time = '14:30:00';
INSERT INTO appointments (booking_code, patient_id, booked_by_staff, slot_id, booking_channel, chief_complaint, status,
                          checked_in_at, checked_in_by)
SELECT 'J5VK6P', 4, 2, slot_id, 'WALK_IN', 'ปวดหลัง', 'COMPLETED', TIMESTAMP(@past, '14:45:00'), 2
  FROM time_slots WHERE slot_date = @past AND start_time = '14:30:00';

-- ประเภทบริการ / ราคา / หมอนวดที่นวด / VN ของคิวตัวอย่าง
UPDATE appointments a JOIN service_types st ON st.service_type_id = 1
   SET a.service_type_id = st.service_type_id, a.service_price = st.price WHERE a.service_type_id IS NULL;
UPDATE appointments a JOIN service_types st ON st.service_type_id = 2
   SET a.service_type_id = st.service_type_id, a.service_price = st.price WHERE a.booking_code IN ('K7M4QX', 'R6NC2V');
UPDATE appointments SET practitioner_id = 1, vn = '690101093015' WHERE booking_code = 'K7M4QX';
UPDATE appointments SET practitioner_id = 2, vn = '690101144520' WHERE booking_code = 'J5VK6P';

SELECT 'dev sample loaded' AS status, @d0 AS today_sample, @d1 AS next_day_sample;
