-- =====================================================================
-- migrations/004_mfa.sql — v0.6.x → v0.7.0
--   ยืนยันตัวตน 2 ชั้น (2FA) ด้วยแอป Authenticator สำหรับบัญชีเจ้าหน้าที่
--
--   cd database
--   mysql -u root -p -e "source migrations/004_mfa.sql"
--
-- หลังรัน: บัญชี ADMIN / DEV จะถูกขอให้สแกน QR ตอนล็อกอินครั้งถัดไป
-- =====================================================================
SET NAMES utf8mb4;
USE thai_massage_booking;

ALTER TABLE staff_users
  ADD COLUMN totp_secret_enc VARCHAR(255) NULL AFTER is_active,
  ADD COLUMN totp_enabled_at TIMESTAMP NULL AFTER totp_secret_enc,
  ADD COLUMN totp_required   BOOLEAN NOT NULL DEFAULT FALSE AFTER totp_enabled_at,
  ADD COLUMN totp_last_step  BIGINT NULL AFTER totp_required,
  ADD COLUMN session_version INT NOT NULL DEFAULT 0 AFTER totp_last_step;

CREATE TABLE IF NOT EXISTS staff_recovery_codes (
  code_id     INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT      NOT NULL,
  code_hash   CHAR(64) NOT NULL,
  used_at     TIMESTAMP NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_recovery (user_id, code_hash),
  CONSTRAINT fk_recovery_user FOREIGN KEY (user_id) REFERENCES staff_users(user_id) ON DELETE CASCADE
);

SELECT 'migration 004 done' AS status,
       (SELECT COUNT(*) FROM staff_users WHERE role IN ('ADMIN','DEV')) AS accounts_needing_2fa_setup;
