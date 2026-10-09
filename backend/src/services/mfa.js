/**
 * services/mfa.js — นโยบายและข้อมูล 2FA ของบัญชีเจ้าหน้าที่
 *
 *   mfaRequired(user)       บัญชีนี้ต้องใช้ 2FA ไหม (role บังคับ หรือแอดมินติ๊กบังคับรายคน, KIOSK ไม่ใช้เสมอ)
 *   mfaEnabled(user)        ผูกแอปเสร็จแล้วหรือยัง
 *   startSetup(user)        สร้าง/ใช้ secret ที่รอยืนยันอยู่ → QR (data URL) + secret ไว้พิมพ์เอง
 *   confirmSetup(user,code) ยืนยันรหัสแรก → เปิดใช้ + ออกรหัสสำรอง 10 ชุด
 *   verifyLogin(user, {code | recovery_code})  ตรวจตอนล็อกอิน
 *   resetMfa(userId)        ล้าง 2FA (มือถือหาย / เปลี่ยนเครื่อง) + ตัด session ทุกเครื่อง
 */
import QRCode from 'qrcode';
import { config } from '../config.js';
import { query, queryOne, withTx } from '../db.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { badRequest, conflict } from '../utils/errors.js';
import { getSetting } from './settings.js';
import {
  generateSecret, verifyTotp, otpauthUrl, formatSecret, generateRecoveryCodes, hashRecoveryCode,
} from '../utils/totp.js';

export const mfaRequired = (u) => u.role !== 'KIOSK' && (config.mfaRequiredRoles.includes(u.role) || !!u.totp_required);
export const mfaEnabled = (u) => !!u.totp_enabled_at;

const INVALID_CODE = 'รหัสไม่ถูกต้อง หรือหมดเวลาแล้ว กรุณาใช้รหัสล่าสุดจากแอป';

/** เริ่มผูกแอป: ถ้ามี secret ที่สแกนค้างไว้ (ยังไม่ยืนยัน) ใช้ตัวเดิม → กดรีเฟรชแล้ว QR ไม่เปลี่ยน รายการในแอปไม่ซ้ำ */
export async function startSetup(user) {
  if (mfaEnabled(user)) throw conflict('MFA_ALREADY_ENABLED', 'บัญชีนี้ผูกแอปยืนยันตัวตนแล้ว');
  let secret = user.totp_secret_enc ? decrypt(user.totp_secret_enc) : '';
  if (!secret) {
    secret = generateSecret();
    await query('UPDATE staff_users SET totp_secret_enc = ? WHERE user_id = ? AND totp_enabled_at IS NULL', [encrypt(secret), user.user_id]);
  }
  // ชื่อที่แสดงในแอป: "<ชื่อคลินิก> (username)" — ตัด ":" ออก (เป็นตัวคั่นในมาตรฐาน otpauth)
  const issuer = String((await getSetting('clinic_name')) || 'ระบบจองคิวนวด').replace(/:/g, ' ').slice(0, 60);
  const url = otpauthUrl({ issuer, account: user.username, secret });
  const qr = await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 1, width: 240 });
  // url = ลิงก์ otpauth:// ให้กดเปิดแอปได้เลย กรณีตั้งค่าจากมือถือเครื่องเดียวกับแอป (สแกนจอตัวเองไม่ได้)
  return { qr, url, secret: formatSecret(secret), issuer, account: user.username };
}

/** ยืนยันรหัสแรกจากแอป → เปิดใช้ 2FA + ออกรหัสสำรอง (แสดงครั้งเดียว) */
export async function confirmSetup(user, code) {
  return withTx(async (conn) => {
    const [[row]] = await conn.query('SELECT totp_secret_enc, totp_enabled_at FROM staff_users WHERE user_id = ? FOR UPDATE', [user.user_id]);
    if (row.totp_enabled_at) throw conflict('MFA_ALREADY_ENABLED', 'บัญชีนี้ผูกแอปยืนยันตัวตนแล้ว');
    const secret = decrypt(row.totp_secret_enc);
    if (!secret) throw badRequest('MFA_NOT_STARTED', 'กรุณาสแกน QR ใหม่อีกครั้ง');
    const step = verifyTotp(secret, code);
    if (step == null) throw badRequest('INVALID_MFA_CODE', INVALID_CODE);
    await conn.query('UPDATE staff_users SET totp_enabled_at = NOW(), totp_last_step = ? WHERE user_id = ?', [step, user.user_id]);
    return issueRecoveryCodes(conn, user.user_id);
  });
}

async function issueRecoveryCodes(conn, userId) {
  const codes = generateRecoveryCodes();
  await conn.query('DELETE FROM staff_recovery_codes WHERE user_id = ?', [userId]);
  await conn.query('INSERT INTO staff_recovery_codes (user_id, code_hash) VALUES ?', [codes.map((c) => [userId, hashRecoveryCode(c)])]);
  return codes;
}

/**
 * ตรวจตอนล็อกอิน (ล็อกแถวผู้ใช้ไว้ → ส่งรหัสเดียวกันพร้อมกัน 2 ครั้ง ผ่านได้ครั้งเดียว)
 * @returns {{ method: 'TOTP'|'RECOVERY', recovery_left?: number }}
 */
export async function verifyLogin(user, { code, recovery_code }) {
  return withTx(async (conn) => {
    const [[row]] = await conn.query('SELECT totp_secret_enc, totp_last_step FROM staff_users WHERE user_id = ? FOR UPDATE', [user.user_id]);
    if (recovery_code) {
      const [r] = await conn.query(
        'UPDATE staff_recovery_codes SET used_at = NOW() WHERE user_id = ? AND code_hash = ? AND used_at IS NULL',
        [user.user_id, hashRecoveryCode(recovery_code)],
      );
      if (!r.affectedRows) throw badRequest('INVALID_RECOVERY_CODE', 'รหัสสำรองไม่ถูกต้อง หรือถูกใช้ไปแล้ว');
      const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM staff_recovery_codes WHERE user_id = ? AND used_at IS NULL', [user.user_id]);
      return { method: 'RECOVERY', recovery_left: Number(n) };
    }
    const step = verifyTotp(decrypt(row.totp_secret_enc), code, { afterStep: row.totp_last_step == null ? null : Number(row.totp_last_step) });
    if (step == null) throw badRequest('INVALID_MFA_CODE', INVALID_CODE);
    await conn.query('UPDATE staff_users SET totp_last_step = ? WHERE user_id = ?', [step, user.user_id]);
    return { method: 'TOTP' };
  });
}

/** ล้าง 2FA ของบัญชี + ตัด session ทุกเครื่อง (ล็อกอินครั้งถัดไปจะได้ QR ใหม่ ถ้ายังถูกบังคับใช้) */
export async function resetMfa(userId) {
  await withTx(async (conn) => {
    await conn.query(
      `UPDATE staff_users SET totp_secret_enc = NULL, totp_enabled_at = NULL, totp_last_step = NULL,
              session_version = session_version + 1 WHERE user_id = ?`,
      [userId],
    );
    await conn.query('DELETE FROM staff_recovery_codes WHERE user_id = ?', [userId]);
  });
}

export async function recoveryCodesLeft(userId) {
  const r = await queryOne('SELECT COUNT(*) AS n FROM staff_recovery_codes WHERE user_id = ? AND used_at IS NULL', [userId]);
  return Number(r.n);
}
