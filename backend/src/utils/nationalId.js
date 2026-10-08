/**
 * utils/nationalId.js — เลขบัตรประชาชนไทย 13 หลัก
 *
 *   isValidThaiId(digits)  ตรวจรูปแบบ + เลขตรวจสอบหลักที่ 13 (mod 11)
 *   normalizeThaiId(str)   ตัดขีด/ช่องว่าง → ตัวเลข 13 หลัก
 *   protectThaiId(digits)  → { enc, hash, last4 } สำหรับเก็บลงฐานข้อมูล
 *   revealThaiId(enc)      ถอดรหัสกลับเป็น 13 หลัก (ใช้เฉพาะตอนแก้ไข/ส่งออก)
 *   hashThaiId(digits)     HMAC สำหรับค้นหา (WHERE national_id_hash = ?)
 *   maskThaiId(last4)      x-xxxx-xxxx9-87-6
 *   formatThaiId(digits)   1-2345-67890-12-3
 *
 * ทำไมเก็บ 3 คอลัมน์: เลขบัตรเป็นข้อมูลส่วนบุคคล จึงไม่เก็บแบบอ่านได้
 *   - enc   เข้ารหัส AES-256-GCM (ถอดได้ด้วย APP_SECRET_KEY เท่านั้น)
 *   - hash  HMAC-SHA256 ด้วยกุญแจที่แยกจาก key เข้ารหัส → ค้นหา/กันซ้ำได้โดยไม่ต้องถอดรหัส
 *           (ใช้ HMAC ไม่ใช่ SHA256 เฉย ๆ เพราะเลขบัตรมีแค่ 13 หลัก ถ้าไม่มีกุญแจจะไล่เดาได้)
 *   - last4 แสดงบนหน้าจอแบบปิดบัง
 *
 * ⚠ ห้ามเปลี่ยน APP_SECRET_KEY หลังมีข้อมูลแล้ว — เลขบัตรเดิมจะถอด/ค้นหาไม่ได้
 */
import crypto from 'node:crypto';
import { config } from '../config.js';
import { encrypt, decrypt } from './crypto.js';

// กุญแจสำหรับ HMAC แยกจากกุญแจเข้ารหัส (derive จาก APP_SECRET_KEY)
const HMAC_KEY = crypto.createHmac('sha256', Buffer.from(config.appSecretKey, 'hex')).update('national-id-lookup-v1').digest();

export const normalizeThaiId = (s) => String(s ?? '').replace(/\D/g, '');

/** เลขตรวจสอบ: หลักที่ 13 = (11 − (Σ หลักที่ i × (14 − i)) mod 11) mod 10 */
export function isValidThaiId(digits) {
  if (!/^\d{13}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(digits[12]);
}

export const hashThaiId = (digits) => crypto.createHmac('sha256', HMAC_KEY).update(digits).digest('hex');

export function protectThaiId(digits) {
  // ด่านสุดท้ายก่อนเก็บ: ทุก route ตรวจด้วย zod แล้ว แต่กันโค้ดภายในส่งค่าผิดมาด้วย
  if (!isValidThaiId(digits)) throw new Error('protectThaiId: เลขบัตรประชาชนไม่ถูกต้อง');
  return { enc: encrypt(digits), hash: hashThaiId(digits), last4: digits.slice(-4) };
}

export const revealThaiId = (enc) => (enc ? decrypt(enc) || null : null);

export const formatThaiId = (d) => (d && d.length === 13 ? `${d[0]}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d[12]}` : d ?? '');

/** '9876' → 'x-xxxx-xxxx9-87-6' (ตำแหน่งตรงกับ formatThaiId) */
export const maskThaiId = (last4) => (last4 ? `x-xxxx-xxxx${last4[0]}-${last4.slice(1, 3)}-${last4[3]}` : null);
