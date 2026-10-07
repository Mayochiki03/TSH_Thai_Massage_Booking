/**
 * utils/crypto.js — เข้ารหัสค่าลับ (AES-256-GCM ด้วย APP_SECRET_KEY) + สุ่มรหัสจอง 6 ตัว
 */
import crypto from 'node:crypto';
import { config } from '../config.js';

const KEY = Buffer.from(config.appSecretKey, 'hex');

/** เข้ารหัส AES-256-GCM → "v1:<iv>:<tag>:<data>" (base64) */
export function encrypt(plain) {
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), data.toString('base64')].join(':');
}

export function decrypt(payload) {
  if (!payload) return '';
  const [v, iv, tag, data] = payload.split(':');
  if (v !== 'v1') return '';
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return ''; // key เปลี่ยน / ข้อมูลเสีย
  }
}

// รหัสจอง 6 ตัว ตัดตัวที่ดูคล้ายกัน (0/O, 1/I/L, 5/S, 8/B)
const CODE_ALPHABET = 'ACDEFGHJKMNPQRTUVWXYZ234679';
export function bookingCode(len = 6) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}
