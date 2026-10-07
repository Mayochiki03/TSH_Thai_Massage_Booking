/**
 * routes/auth.js — เข้าสู่ระบบ / ออกจากระบบ / เปลี่ยนรหัสผ่าน (/api/auth/*)
 *   - ล็อกอินผิดเกิน 10 ครั้งใน 15 นาทีต่อ IP → ถูกพักชั่วคราว
 *   - ตอบข้อความเดียวกันทั้ง "ไม่มีผู้ใช้" และ "รหัสผิด" (เดาชื่อผู้ใช้ไม่ได้)
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { query, queryOne } from '../db.js';
import { ah, HttpError, badRequest } from '../utils/errors.js';
import { issueStaffSession, clearStaffSession, requireStaff } from '../middleware/auth.js';
import { audit } from '../services/audit.js';

export const authRouter = Router();

// hash หลอกสำหรับกรณีไม่พบ username (ให้ใช้เวลาเท่ากับกรณีพบ)
const DUMMY_HASH = bcrypt.hashSync(`dummy-${Math.random()}`, 10);

// กันเดารหัสผ่าน: ล็อกอินผิดได้ 10 ครั้ง / 15 นาที / IP (ล็อกอินสำเร็จไม่นับ)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: { code: 'TOO_MANY_ATTEMPTS', message: 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอ 15 นาที' } },
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
  await query('UPDATE staff_users SET last_login_at = NOW() WHERE user_id = ?', [user.user_id]);
  issueStaffSession(res, user);
  req.staff = user;
  await audit(req, 'LOGIN', 'staff_users', user.user_id);
  res.json({ user: publicUser(user) });
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
  };
}
