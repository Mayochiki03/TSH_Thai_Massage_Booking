/**
 * utils/totp.js — รหัสยืนยันตัวตน 2 ชั้น (2FA) แบบ TOTP (RFC 6238) ใช้กับแอป Google / Microsoft Authenticator
 *
 * หลักการ: ระบบกับแอปในมือถือถือ "กุญแจลับ" (secret) ตัวเดียวกัน ได้มาจากการสแกน QR ครั้งแรก
 *          ต่างฝ่ายต่างคำนวณ HMAC-SHA1(secret, เวลาปัจจุบัน ÷ 30 วินาที) → เลข 6 หลักตรงกัน
 *          ไม่ต้องเชื่อมต่อกัน ไม่ต้องใช้อินเทอร์เน็ต (แต่นาฬิกามือถือต้องตรง)
 *
 *   generateSecret()                 สุ่ม secret 160 bit → base32 (รูปแบบที่แอป Authenticator ใช้)
 *   totpAt(secret, step)             เลข 6 หลักของช่วงเวลา step
 *   verifyTotp(secret, code, opts)   ตรวจรหัส (ยอมให้นาฬิกาคลาดได้ ±1 ช่วง = ±30 วินาที) → step ที่ตรง หรือ null
 *   otpauthUrl(...)                  ข้อความที่อยู่ใน QR code
 *   generateRecoveryCodes() / hashRecoveryCode()   รหัสสำรอง 10 ชุด (ใช้ได้ชุดละครั้ง) เก็บเป็น hash เท่านั้น
 *
 * เขียนเองด้วย node:crypto (ไม่พึ่ง library) — ทดสอบกับ test vector ใน RFC 6238 แล้ว
 */
import crypto from 'node:crypto';
import { config } from '../config.js';

export const STEP_SECONDS = 30;
const DIGITS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error('base32: ตัวอักษรไม่ถูกต้อง');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** secret 20 byte (160 bit ตามที่ RFC 4226 แนะนำ) */
export const generateSecret = () => base32Encode(crypto.randomBytes(20));

/** ช่วงเวลาปัจจุบัน (นับทุก 30 วินาทีตั้งแต่ 1970) */
export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

/** HOTP (RFC 4226) — ใช้ counter = step */
export function totpAt(secret, step, digits = DIGITS) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/**
 * ตรวจรหัส 6 หลัก
 * @param {object} [opts]
 * @param {number} [opts.window=1]      ยอมให้นาฬิกาคลาด ± กี่ช่วง (1 = ±30 วินาที)
 * @param {number|null} [opts.afterStep] step ที่ใช้ไปแล้ว — กันการนำรหัสเดิมมาใช้ซ้ำ (replay)
 * @returns {number|null} step ที่ตรง หรือ null ถ้าไม่ผ่าน
 */
export function verifyTotp(secret, code, { window = 1, afterStep = null, now = Date.now() } = {}) {
  const digits = String(code ?? '').replace(/\D/g, '');
  if (digits.length !== DIGITS) return null;
  const step = currentStep(now);
  for (let i = -window; i <= window; i++) {
    const s = step + i;
    if (afterStep != null && s <= afterStep) continue;
    // เทียบแบบเวลาคงที่ กันเดารหัสจากเวลาตอบกลับ
    if (crypto.timingSafeEqual(Buffer.from(totpAt(secret, s)), Buffer.from(digits))) return s;
  }
  return null;
}

/** ข้อความใน QR code — แอปจะแสดงเป็น "issuer (account)" */
export function otpauthUrl({ issuer, account, secret }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params}`;
}

/** แสดง secret ให้พิมพ์เองง่ายขึ้น (กรณีสแกน QR ไม่ได้): ABCD EFGH IJKL ... */
export const formatSecret = (secret) => secret.replace(/(.{4})/g, '$1 ').trim();

// ---------------------------------------------------------------------
// รหัสสำรอง (กรณีมือถือหาย) — 10 ชุด ชุดละ 8 ตัว รูปแบบ xxxx-xxxx ใช้ได้ชุดละครั้ง
// เก็บในฐานข้อมูลเป็น HMAC เท่านั้น (เห็นตัวจริงครั้งเดียวตอนสร้าง)
// ---------------------------------------------------------------------
const RC_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // ตัด 0/o, 1/l/i ที่ดูคล้ายกัน
const RC_KEY = crypto.createHmac('sha256', Buffer.from(config.appSecretKey, 'hex')).update('staff-recovery-code-v1').digest();

export function generateRecoveryCodes(n = 10) {
  return Array.from({ length: n }, () => {
    const bytes = crypto.randomBytes(8);
    const s = Array.from(bytes, (b) => RC_ALPHABET[b % RC_ALPHABET.length]).join('');
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}

/** normalize (ตัวเล็ก ตัดขีด/ช่องว่าง) แล้ว HMAC */
export const hashRecoveryCode = (code) =>
  crypto.createHmac('sha256', RC_KEY).update(String(code).toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');
