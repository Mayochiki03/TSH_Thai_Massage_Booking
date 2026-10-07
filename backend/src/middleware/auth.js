/**
 * middleware/auth.js — ยืนยันตัวตนและตรวจสิทธิ์
 *   บัญชีในระบบ (เจ้าหน้าที่/หมอนวด/แอดมิน/นักพัฒนา/kiosk): JWT ใน httpOnly cookie → requireStaff, requireRole
 *   ผู้จอง (LINE): ID token จาก LIFF ตรวจกับ LINE ทุก request → requireLineUser, requireConsent
 */
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query, queryOne } from '../db.js';
import { HttpError, forbidden } from '../utils/errors.js';
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
export function issueStaffSession(res, user) {
  const hours = sessionHours(user.role);
  const token = jwt.sign({ uid: user.user_id, role: user.role }, config.jwtSecret, { expiresIn: `${hours}h` });
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
      `SELECT user_id, username, full_name, role, practitioner_id, must_change_password, is_active
         FROM staff_users WHERE user_id = ?`,
      [payload.uid],
    );
    if (!user || !user.is_active) throw new HttpError(401, 'UNAUTHENTICATED', 'บัญชีนี้ถูกปิดการใช้งาน');
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
//  - โหมดอื่น: Authorization: Bearer <liff.getIDToken()> → ตรวจกับ LINE
// =====================================================================
export async function requireLineUser(req, _res, next) {
  try {
    const cfg = await lineConfig();
    let profile = null;

    if (cfg.mode === 'LOCAL') {
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
