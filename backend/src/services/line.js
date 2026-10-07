/**
 * services/line.js — ติดต่อ LINE Platform
 *   lineConfig      อ่านค่าการเชื่อมต่อจาก settings (token ถอดรหัสแล้ว)
 *   patientUrl      สร้างลิงก์เปิดหน้าผู้จอง (ผ่าน LIFF ถ้ามี)
 *   verifyIdToken   ตรวจ ID token จาก liff.getIDToken() กับ LINE
 *   pushMessages / getQuota / getBotInfo   Messaging API
 */
import { getSettings } from './settings.js';

const API = 'https://api.line.me';

export async function lineConfig() {
  const s = await getSettings([
    'connection_mode', 'public_base_url', 'liff_id', 'line_login_channel_id',
    'line_channel_secret', 'line_channel_token',
  ]);
  return {
    mode: s.connection_mode || 'LOCAL',
    publicBaseUrl: (s.public_base_url || '').replace(/\/+$/, ''),
    liffId: s.liff_id || '',
    loginChannelId: s.line_login_channel_id || '',
    channelSecret: s.line_channel_secret || '',
    channelToken: s.line_channel_token || '',
  };
}

/** URL สำหรับเปิดหน้าในเว็บผู้จอง (ผ่าน LIFF ถ้ามี) */
export async function patientUrl(path = '/') {
  const c = await lineConfig();
  const p = path.startsWith('/') ? path : `/${path}`;
  if (c.liffId) return `https://liff.line.me/${c.liffId}${p}`;
  if (c.publicBaseUrl) return `${c.publicBaseUrl}${p}`;
  return `http://localhost:5173${p}`;
}

// ---------------------------------------------------------------------
// ตรวจ ID token จาก liff.getIDToken() กับ LINE (cache จนหมดอายุ)
// ---------------------------------------------------------------------
const tokenCache = new Map();

export async function verifyIdToken(idToken) {
  const cached = tokenCache.get(idToken);
  if (cached && cached.exp * 1000 > Date.now()) return cached;

  const { loginChannelId } = await lineConfig();
  if (!loginChannelId) throw new Error('ยังไม่ได้ตั้งค่า LINE Login Channel ID');

  const res = await fetch(`${API}/oauth2/v2.1/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: loginChannelId }),
  });
  if (!res.ok) return null;
  const data = await res.json(); // { sub, name, picture, exp, ... }
  if (!data.sub) return null;
  if (tokenCache.size > 5000) tokenCache.clear();
  tokenCache.set(idToken, data);
  return data;
}

// ---------------------------------------------------------------------
// Messaging API
// ---------------------------------------------------------------------
async function lineFetch(path, { method = 'GET', body } = {}) {
  const { channelToken } = await lineConfig();
  if (!channelToken) return { ok: false, status: 0, data: { message: 'ยังไม่ได้ตั้งค่า Channel Access Token' } };
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${channelToken}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  return { ok: res.ok, status: res.status, data };
}

export async function pushMessages(to, messages) {
  return lineFetch('/v2/bot/message/push', { method: 'POST', body: { to, messages } });
}

/** โควตาข้อความเดือนนี้ { limit, used } */
export async function getQuota() {
  const [q, c] = await Promise.all([lineFetch('/v2/bot/message/quota'), lineFetch('/v2/bot/message/quota/consumption')]);
  if (!q.ok || !c.ok) return { ok: false, error: q.data?.message || c.data?.message || 'เรียก LINE API ไม่สำเร็จ' };
  return { ok: true, type: q.data.type, limit: q.data.value ?? null, used: c.data.totalUsage ?? 0 };
}

/** ทดสอบ token — คืนข้อมูลบัญชี OA */
export async function getBotInfo() {
  const r = await lineFetch('/v2/bot/info');
  return r.ok ? { ok: true, ...r.data } : { ok: false, error: r.data?.message || `HTTP ${r.status}` };
}
