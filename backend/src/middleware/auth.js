/**
 * middleware/auth.js — ยืนยันตัวตนและตรวจสิทธิ์
 *   บัญชีในระบบ (เจ้าหน้าที่/หมอนวด/แอดมิน/นักพัฒนา/kiosk): JWT ใน httpOnly cookie → requireStaff, requireRole
 *     - JWT มี sv (session_version) → รีเซ็ตรหัสผ่าน / รีเซ็ต 2FA แล้ว session เดิมทุกเครื่องใช้ไม่ได้ทันที
 *     - JWT มี mfa (ผ่าน 2FA แล้วหรือยัง) → บัญชีที่ต้องใช้ 2FA แต่ session ไม่ได้ผ่าน 2FA (เช่น session เก่า
 *       ก่อนเปิดใช้ หรือเพิ่งถูกเลื่อนเป็น ADMIN) ถูกบังคับล็อกอินใหม่
 *   ขั้นกลางของการล็อกอิน (รหัสผ่านถูก แต่ยังไม่ผ่าน 2FA): cookie แยก tmb_mfa อายุ 10 นาที → requireMfaTicket
 *   ผู้จอง (LINE): ID token จาก LIFF ตรวจกับ LINE ทุก request → requireLineUser, requireConsent
 */
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query, queryOne } from '../db.js';
import { HttpError, forbidden } from '../utils/errors.js';
import { mfaRequired } from '../services/mfa.js';
import { lineConfig, verifyIdToken } from '../services/line.js';

// =====================================================================
// เจ้าหน้าที่ / หมอนวด / แอดมิน — JWT ใน httpOnly cookie
// =====================================================================
export const STAFF_COOKIE = 'tmb_staff';

/**
 * อายุ session ตาม role (ชั่วโมง)
 * - KIOSK ล็อกอินครั้งเดียวตอนติดตั้งเครื่อง แล้วเปิดค้างไว้ → 30 วัน
 * - คนทั่วไป 12 ชม. (1 กะทำงาน)
 */
const sessionHours = (role) => (role === 'KIOSK' ? 24 * 30 : 12);

/** ออก JWT แล้วเก็บใน httpOnly cookie (JavaScript หน้าเว็บอ่านไม่ได้ → กัน XSS ขโมย session) */
export function issueStaffSession(res, user, { mfa = false } = {}) {
  const hours = sessionHours(user.role);
  const token = jwt.sign(
    { uid: user.user_id, role: user.role, sv: user.session_version ?? 0, mfa },
    config.jwtSecret,
    { expiresIn: `${hours}h` },
  );
  res.cookie(STAFF_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.isProd && process.env.INTERNAL_HTTPS === 'true',
    maxAge: hours * 3600 * 1000,
    path: '/',
  });
}

export function clearStaffSession(res) {
  res.clearCookie(STAFF_COOKIE, { path: '/' });
  res.clearCookie(MFA_COOKIE, { path: '/api/auth' });
}

// ---------------------------------------------------------------------
// ขั้นกลาง 2FA: รหัสผ่านถูกแล้ว รอรหัส 6 หลัก (ยังไม่ใช่ session ใช้งานได้)
// ---------------------------------------------------------------------
export const MFA_COOKIE = 'tmb_mfa';
const MFA_TICKET_MIN = 10;

export function issueMfaTicket(res, user) {
  const token = jwt.sign({ uid: user.user_id, sv: user.session_version ?? 0, purpose: 'mfa' }, config.jwtSecret, { expiresIn: `${MFA_TICKET_MIN}m` });
  res.cookie(MFA_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.isProd && process.env.INTERNAL_HTTPS === 'true',
    maxAge: MFA_TICKET_MIN * 60 * 1000,
    path: '/api/auth', // ส่งไปเฉพาะ route ล็อกอิน
  });
}

export const clearMfaTicket = (res) => res.clearCookie(MFA_COOKIE, { path: '/api/auth' });

/** ใช้กับ route ขั้น 2FA — req.mfaUser = แถว staff_users ทั้งแถว */
export async function requireMfaTicket(req, _res, next) {
  try {
    const token = req.cookies?.[MFA_COOKIE];
    let payload = null;
    try { payload = token && jwt.verify(token, config.jwtSecret); } catch { /* หมดอายุ */ }
    if (!payload || payload.purpose !== 'mfa') {
      throw new HttpError(401, 'MFA_TICKET_EXPIRED', 'หมดเวลายืนยันตัวตน กรุณาเข้าสู่ระบบใหม่');
    }
    const user = await queryOne('SELECT * FROM staff_users WHERE user_id = ?', [payload.uid]);
    if (!user || !user.is_active || user.session_version !== payload.sv) {
      throw new HttpError(401, 'MFA_TICKET_EXPIRED', 'กรุณาเข้าสู่ระบบใหม่');
    }
    req.mfaUser = user;
    next();
  } catch (err) { next(err); }
}

export async function requireStaff(req, _res, next) {
  try {
    const token = req.cookies?.[STAFF_COOKIE];
    if (!token) throw new HttpError(401, 'UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบ');
    let payload;
    try { payload = jwt.verify(token, config.jwtSecret); } catch {
      throw new HttpError(401, 'SESSION_EXPIRED', 'หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบใหม่');
    }
    // ตรวจกับ DB ทุกครั้ง → ปิดบัญชี/เปลี่ยน role มีผลทันที
    const user = await queryOne(
      `SELECT user_id, username, full_name, role, practitioner_id, must_change_password, is_active,
              totp_required, totp_enabled_at, session_version
         FROM staff_users WHERE user_id = ?`,
      [payload.uid],
    );
    if (!user || !user.is_active) throw new HttpError(401, 'UNAUTHENTICATED', 'บัญชีนี้ถูกปิดการใช้งาน');
    if (user.session_version !== (payload.sv ?? 0)) {
      throw new HttpError(401, 'SESSION_REVOKED', 'บัญชีนี้ถูกรีเซ็ตรหัสผ่านหรือการยืนยันตัวตน กรุณาเข้าสู่ระบบใหม่');
    }
    if (mfaRequired(user) && !payload.mfa) {
      throw new HttpError(401, 'MFA_REQUIRED', 'บัญชีนี้ต้องยืนยันตัวตน 2 ชั้น กรุณาเข้าสู่ระบบใหม่');
    }
    req.staff = user;
    next();
  } catch (err) { next(err); }
}

/**
 * จำกัดสิทธิ์ตาม role (ลำดับสิทธิ์: DEV ⊃ ADMIN ⊃ STAFF / PRACTITIONER / KIOSK)
 * - DEV   ผ่านได้ทุก route
 * - ADMIN ผ่านได้ทุก route ยกเว้น route ที่เป็นของ DEV อย่างเดียว (เมนูนักพัฒนา)
 * - role อื่นผ่านได้เฉพาะ route ที่ระบุ role นั้น
 *
 * @example router.use(requireRole('STAFF'))   // เคาน์เตอร์ + ADMIN + DEV
 * @example router.use(requireRole('DEV'))     // นักพัฒนาเท่านั้น
 */
export const requireRole = (...roles) => (req, _res, next) => {
  const role = req.staff.role;
  const devOnly = roles.length === 1 && roles[0] === 'DEV';
  if (role === 'DEV' || roles.includes(role) || (role === 'ADMIN' && !devOnly)) return next();
  next(forbidden());
};

/** บังคับเปลี่ยนรหัสผ่านก่อนใช้งานอื่น */
export function requirePasswordChanged(req, _res, next) {
  if (req.staff.must_change_password) {
    return next(new HttpError(403, 'MUST_CHANGE_PASSWORD', 'กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน'));
  }
  next();
}

// =====================================================================
// ผู้จอง (LINE)
//  - โหมด LOCAL: ใช้ header X-Dev-Line-User (ผู้ใช้จำลอง) — ใช้ได้เฉพาะโหมดนี้เท่านั้น
//    และต้องไม่ได้มาทาง Cloudflare Tunnel (มี header cf-ray) → คนนอกปลอมเป็นผู้ใช้คนอื่นไม่ได้
//    แม้จะลืมเปลี่ยนโหมดก่อนเปิด tunnel
//  - โหมดอื่น: Authorization: Bearer <liff.getIDToken()> → ตรวจกับ LINE
// =====================================================================
export async function requireLineUser(req, _res, next) {
  try {
    const cfg = await lineConfig();
    let profile = null;

    if (cfg.mode === 'LOCAL') {
      if (req.get('cf-ray') || req.get('cf-connecting-ip')) {
        throw new HttpError(403, 'LOCAL_ONLY', 'ระบบจองออนไลน์ยังไม่เปิดใช้งาน');
      }
      const devId = req.get('X-Dev-Line-User');
      if (devId && /^U[0-9a-zA-Z]{10,48}$/.test(devId)) {
        profile = { sub: devId, name: req.get('X-Dev-Line-Name') ? decodeURIComponent(req.get('X-Dev-Line-Name')) : 'ผู้ใช้ทดสอบ', picture: null };
      }
    } else {
      const auth = req.get('Authorization') || '';
      const idToken = auth.startsWith('Bearer ') ? auth.slice(7) : null;
      if (idToken) profile = await verifyIdToken(idToken);
    }
    if (!profile) throw new HttpError(401, 'LINE_AUTH', 'กรุณาเปิดจาก LINE อีกครั้ง');

    await query(
      `INSERT INTO line_users (line_user_id, display_name, picture_url, last_seen_at)
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE display_name = VALUES(display_name),
         picture_url = COALESCE(VALUES(picture_url), picture_url), last_seen_at = NOW()`,
      [profile.sub, profile.name?.slice(0, 200) ?? null, profile.picture ?? null],
    );
    const lu = await queryOne('SELECT * FROM line_users WHERE line_user_id = ?', [profile.sub]);
    if (lu.is_blocked) throw forbidden('บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อเคาน์เตอร์');
    req.lineUser = lu;
    next();
  } catch (err) { next(err); }
}

/** ต้องยอมรับ PDPA ก่อนทำรายการ */
export function requireConsent(req, _res, next) {
  if (!req.lineUser.pdpa_consent_at) return next(new HttpError(403, 'CONSENT_REQUIRED', 'กรุณายอมรับนโยบายข้อมูลส่วนบุคคลก่อน'));
  next();
}
