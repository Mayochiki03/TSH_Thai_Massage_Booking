-- =====================================================================
-- 02_procedures.sql
-- Stored procedures ที่ backend (cron) เรียกใช้
-- =====================================================================

SET NAMES utf8mb4;   -- สำคัญ: กันภาษาไทยเพี้ยนตอนรันผ่าน CLI บน Windows

USE thai_massage_booking;

DROP PROCEDURE IF EXISTS sp_generate_slots;

DELIMITER $$

-- สร้าง time_slots ล่วงหน้า p_days วัน (นับวันนี้เป็นวันที่ 0)
-- - สร้างเฉพาะวันที่อยู่ใน settings.open_weekdays (1=จ. ... 7=อา.)
-- - ข้ามวันที่อยู่ในตาราง holidays
-- - ใช้แม่แบบจาก slot_templates ที่ is_active = TRUE
-- - สร้างให้หมอนวดทุกคนที่ is_active = TRUE
-- - รันซ้ำได้ ไม่สร้างซ้ำ (INSERT IGNORE + uq_slot)
-- คืนค่า: จำนวน slot ที่สร้างใหม่
CREATE PROCEDURE sp_generate_slots(IN p_days INT)
BEGIN
  DECLARE v_open VARCHAR(50);
  DECLARE v_i    INT DEFAULT 0;
  DECLARE v_date DATE;
  DECLARE v_created INT DEFAULT 0;

  SELECT COALESCE(MAX(setting_value), '1,2,3,4,5') INTO v_open
    FROM settings WHERE setting_key = 'open_weekdays';
  SET v_open = REPLACE(v_open, ' ', '');

  WHILE v_i <= p_days DO
    SET v_date = DATE_ADD(CURDATE(), INTERVAL v_i DAY);

    IF FIND_IN_SET(WEEKDAY(v_date) + 1, v_open) > 0
       AND NOT EXISTS (SELECT 1 FROM holidays WHERE holiday_date = v_date) THEN

      INSERT IGNORE INTO time_slots (practitioner_id, slot_date, start_time, end_time)
      SELECT pr.practitioner_id, v_date, t.start_time, t.end_time
        FROM practitioners pr
        CROSS JOIN slot_templates t
       WHERE pr.is_active = TRUE AND t.is_active = TRUE;

      SET v_created = v_created + ROW_COUNT();
    END IF;

    SET v_i = v_i + 1;
  END WHILE;

  SELECT v_created AS slots_created;
END$$

DELIMITER ;
