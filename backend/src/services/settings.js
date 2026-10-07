/**
 * services/settings.js — อ่าน/เขียนตาราง settings (ค่าที่แอดมินปรับได้)
 *   - cache ในหน่วยความจำ 30 วินาที (ลดการ query) และล้าง cache ทันทีเมื่อแก้ค่า
 *   - แปลงชนิดค่าให้อัตโนมัติ (INT / BOOL / STRING) และเข้ารหัส/ถอดรหัสค่า SECRET
 */
import { query } from '../db.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { badRequest, notFound } from '../utils/errors.js';

let cache = null;
let loadedAt = 0;
const TTL_MS = 30_000;

async function load() {
  const rows = await query('SELECT * FROM settings ORDER BY category, sort_order');
  cache = new Map(rows.map((r) => [r.setting_key, r]));
  loadedAt = Date.now();
}

async function ensure() {
  if (!cache || Date.now() - loadedAt > TTL_MS) await load();
}

export function invalidateSettings() {
  cache = null;
}

/** ค่าที่แปลงชนิดแล้ว (SECRET จะถูกถอดรหัส) */
export async function getSetting(key) {
  await ensure();
  const row = cache.get(key);
  if (!row) return undefined;
  return cast(row);
}

export async function getSettings(keys) {
  await ensure();
  const out = {};
  for (const k of keys) out[k] = cache.has(k) ? cast(cache.get(k)) : undefined;
  return out;
}

function cast(row) {
  const v = row.setting_value;
  switch (row.value_type) {
    case 'INT': return Number.parseInt(v, 10) || 0;
    case 'BOOL': return v === '1' || v === 'true';
    case 'SECRET': return decrypt(v);
    default: return v;
  }
}

/** รายการสำหรับหน้าแอดมิน — SECRET แสดงแบบปิดบัง */
export async function listSettingsForAdmin() {
  await load();
  return [...cache.values()].map((r) => ({
    key: r.setting_key,
    label: r.label,
    category: r.category,
    type: r.value_type,
    value: r.value_type === 'SECRET' ? (r.setting_value ? '••••••••' : '') : cast(r),
    is_set: r.setting_value !== '',
    updated_at: r.updated_at,
  }));
}

const VALIDATORS = {
  open_weekdays: (v) => /^[1-7](,[1-7])*$/.test(v.replace(/\s/g, '')),
  connection_mode: (v) => ['LOCAL', 'DEV_TUNNEL', 'PRODUCTION'].includes(v),
  public_base_url: (v) => v === '' || /^https:\/\/[^\s/]+/.test(v),
  remind_1d_hour: (v) => Number(v) >= 0 && Number(v) <= 23,
};

export async function updateSetting(key, rawValue) {
  await load();
  const row = cache.get(key);
  if (!row) throw notFound('ไม่พบค่าตั้งค่านี้');
  let value = rawValue;

  if (row.value_type === 'INT') {
    if (!Number.isInteger(Number(value)) || Number(value) < 0) throw badRequest('INVALID', `${row.label}: ต้องเป็นจำนวนเต็ม ≥ 0`);
    value = String(Number(value));
  } else if (row.value_type === 'BOOL') {
    value = value === true || value === '1' || value === 'true' ? '1' : '0';
  } else {
    value = String(value ?? '').trim();
  }
  if (VALIDATORS[key] && !VALIDATORS[key](value)) throw badRequest('INVALID', `${row.label}: รูปแบบไม่ถูกต้อง`);
  if (row.value_type === 'SECRET') value = encrypt(value);

  await query('UPDATE settings SET setting_value = ? WHERE setting_key = ?', [value, key]);
  invalidateSettings();
}
