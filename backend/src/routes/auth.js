/**
 * routes/auth.js — เข้าสู่ระบบ / ออกจากระบบ / เปลี่ยนรหัสผ่าน / ยืนยันตัวตน 2 ชั้น (/api/auth/*)
 *   - ล็อกอินผิดเกิน 10 ครั้งใน 15 นาทีต่อ IP → ถูกพักชั่วคราว (รหัส 6 หลักผิดก็นับแยกอีกชุด)
 *   - ตอบข้อความเดียวกันทั้ง "ไม่มีผู้ใช้" และ "รหัสผิด" (เดาชื่อผู้ใช้ไม่ได้)
 *
 * ลำดับการล็อกอิน (บัญชีที่ต้องใช้ 2FA):
 *   POST /login {username, password}
 *     ├─ ยังไม่ผูกแอป → { mfa: 'setup' }  → POST /mfa/setup (ได้ QR) → POST /mfa/enable {code} → session + รหัสสำรอง
 *     └─ ผูกแล้ว      → { mfa: 'verify' } → POST /mfa/verify {code | recovery_code} → session
 *   ระหว่างนี้ถือ cookie tmb_mfa (10 นาที) ยังเรียก API อื่นไม่ได้
 *   บัญชีที่ไม่ต้องใช้ 2FA (และยังไม่ได้ผูก) → ได้ session ทันทีเหมือนเดิม
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { query, queryOne } from '../db.js';
import { ah, HttpError, badRequest } from '../utils/errors.js';
import {
  issueStaffSession, clearStaffSession, requireStaff, issueMfaTicket, clearMfaTicket, requireMfaTicket,
} from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { mfaRequired, mfaEnabled, startSetup, confirmSetup, verifyLogin } from '../services/mfa.js';

export const authRouter = Router();

// hash หลอกสำหรับกรณีไม่พบ username (ให้ใช้เวลาเท่ากับกรณีพบ)
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

// กันเดารหัสผ่าน: ล็อกอินผิดได้ 10 ครั้ง / 15 นาที / IP (ล็อกอินสำเร็จไม่นับ)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: { code: 'TOO_MANY_ATTEMPTS', message: 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอ 15 นาที' } },
});

// กันเดารหัส 6 หลัก: ผิดได้ 10 ครั้ง / 15 นาที / IP (แยกจากตัวนับรหัสผ่าน)
const mfaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: { code: 'TOO_MANY_ATTEMPTS', message: 'กรอกรหัสยืนยันผิดบ่อยเกินไป กรุณารอ 15 นาที' } },
});

const loginBody = z.object({ username: z.string().trim().min(1), password: z.string().min(1) });

authRouter.post('/login', loginLimiter, ah(async (req, res) => {
  const { username, password } = loginBody.parse(req.body);
  const user = await queryOne('SELECT * FROM staff_users WHERE username = ?', [username]);
  // เทียบ hash เสมอแม้ไม่พบ user → เวลาตอบเท่ากัน เดาไม่ได้ว่ามี username นี้ไหม
  const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok || !user.is_active) {
    await audit(req, 'LOGIN_FAILED', 'staff_users', user?.user_id ?? null, { username });
    throw new HttpError(401, 'INVALID_LOGIN', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }
  // ต้องใช้ 2FA (หรือผูกไว้แล้วโดยสมัครใจ) → ยังไม่ให้ session ส่งไปขั้นรหัส 6 หลักก่อน
  if (mfaRequired(user) || mfaEnabled(user)) {
    issueMfaTicket(res, user);
    req.staff = user;
    await audit(req, 'LOGIN_PASSWORD_OK', 'staff_users', user.user_id, { mfa: mfaEnabled(user) ? 'verify' : 'setup' });
    return res.json({ mfa: mfaEnabled(user) ? 'verify' : 'setup', user: { full_name: user.full_name, username: user.username } });
  }
  await completeLogin(req, res, user, { mfa: false });
  res.json({ user: publicUser(user) });
}));

/** ออก session จริง (หลังผ่านรหัสผ่าน และ 2FA ถ้ามี) */
async function completeLogin(req, res, user, { mfa, detail } = {}) {
  await query('UPDATE staff_users SET last_login_at = NOW() WHERE user_id = ?', [user.user_id]);
  if (req.cookies?.tmb_mfa) clearMfaTicket(res); // ล้างเฉพาะเมื่อมี (ไม่ส่ง Set-Cookie เกินจำเป็น)
  issueStaffSession(res, user, { mfa });
  req.staff = user;
  await audit(req, 'LOGIN', 'staff_users', user.user_id, detail);
}

const codeBody = z.object({
  code: z.string().trim().regex(/^\d{3}\s?\d{3}$/, 'กรอกรหัส 6 หลักจากแอป').optional(),
  recovery_code: z.string().trim().min(8).max(20).optional(),
}).refine((b) => b.code || b.recovery_code, { message: 'กรอกรหัส 6 หลัก หรือรหัสสำรอง', path: ['code'] });

/** ผูกแอปครั้งแรก: ได้ QR + secret (แสดงเฉพาะช่วงที่ถือ cookie ขั้น 2FA เท่านั้น) */
authRouter.post('/mfa/setup', requireMfaTicket, ah(async (req, res) => {
  res.json(await startSetup(req.mfaUser));
}));

/** ยืนยันรหัสแรก → เปิดใช้ 2FA + เข้าสู่ระบบ + ได้รหัสสำรอง 10 ชุด (แสดงครั้งเดียว) */
authRouter.post('/mfa/enable', mfaLimiter, requireMfaTicket, ah(async (req, res) => {
  const { code } = codeBody.parse(req.body);
  req.staff = req.mfaUser;
  let recoveryCodes;
  try {
    recoveryCodes = await confirmSetup(req.mfaUser, code);
  } catch (err) {
    await audit(req, 'MFA_FAILED', 'staff_users', req.mfaUser.user_id, { stage: 'setup' });
    throw err;
  }
  req.mfaUser.totp_enabled_at = new Date(); // แถวที่โหลดไว้ก่อนเปิดใช้ → อัปเดตให้ตรงกับฐานข้อมูล
  await audit(req, 'MFA_ENABLED', 'staff_users', req.mfaUser.user_id);
  await completeLogin(req, res, req.mfaUser, { mfa: true, detail: { method: 'TOTP_SETUP' } });
  res.json({ user: publicUser(req.mfaUser), recovery_codes: recoveryCodes });
}));

/** ล็อกอินด้วยรหัส 6 หลัก หรือรหัสสำรอง */
authRouter.post('/mfa/verify', mfaLimiter, requireMfaTicket, ah(async (req, res) => {
  const b = codeBody.parse(req.body);
  req.staff = req.mfaUser;
  if (!mfaEnabled(req.mfaUser)) throw badRequest('MFA_NOT_ENABLED', 'บัญชีนี้ยังไม่ได้ผูกแอปยืนยันตัวตน กรุณาเข้าสู่ระบบใหม่');
  let r;
  try {
    r = await verifyLogin(req.mfaUser, b.recovery_code ? { recovery_code: b.recovery_code } : { code: b.code });
  } catch (err) {
    await audit(req, 'MFA_FAILED', 'staff_users', req.mfaUser.user_id, { stage: 'login', recovery: !!b.recovery_code });
    throw err;
  }
  await completeLogin(req, res, req.mfaUser, { mfa: true, detail: { method: r.method } });
  res.json({ user: publicUser(req.mfaUser), ...(r.method === 'RECOVERY' && { recovery_left: r.recovery_left }) });
}));

authRouter.post('/logout', (_req, res) => {
  clearStaffSession(res);
  res.json({ ok: true });
});

authRouter.get('/me', requireStaff, (req, res) => res.json({ user: publicUser(req.staff) }));

const pwBody = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8, 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร').max(100),
});

authRouter.post('/change-password', requireStaff, ah(async (req, res) => {
  const { current_password, new_password } = pwBody.parse(req.body);
  const row = await queryOne('SELECT password_hash FROM staff_users WHERE user_id = ?', [req.staff.user_id]);
  if (!(await bcrypt.compare(current_password, row.password_hash))) throw badRequest('WRONG_PASSWORD', 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
  if (current_password === new_password) throw badRequest('SAME_PASSWORD', 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม');
  const hash = await bcrypt.hash(new_password, 10);
  await query('UPDATE staff_users SET password_hash = ?, must_change_password = FALSE WHERE user_id = ?', [hash, req.staff.user_id]);
  await audit(req, 'CHANGE_PASSWORD', 'staff_users', req.staff.user_id);
  res.json({ ok: true });
}));

/**
 * ยืนยันรหัสผ่านของบัญชีที่ล็อกอินอยู่ (ไม่เปลี่ยน session)
 * ใช้ตอนเจ้าหน้าที่จะออกจากหน้า kiosk — กันผู้ป่วยกดออกจากโหมด kiosk เอง
 * จำกัดจำนวนครั้งเหมือนการล็อกอิน (ผิดได้ 10 ครั้ง / 15 นาที)
 */
authRouter.post('/verify-password', loginLimiter, requireStaff, ah(async (req, res) => {
  const password = z.string().min(1).parse(req.body?.password);
  const row = await queryOne('SELECT password_hash FROM staff_users WHERE user_id = ?', [req.staff.user_id]);
  if (!(await bcrypt.compare(password, row.password_hash))) {
    await audit(req, 'VERIFY_PASSWORD_FAILED', 'staff_users', req.staff.user_id);
    throw badRequest('WRONG_PASSWORD', 'รหัสผ่านไม่ถูกต้อง');
  }
  res.json({ ok: true });
}));

function publicUser(u) {
  return {
    user_id: u.user_id, username: u.username, full_name: u.full_name, role: u.role,
    practitioner_id: u.practitioner_id, must_change_password: !!u.must_change_password,
    mfa_enabled: mfaEnabled(u),
  };
}
