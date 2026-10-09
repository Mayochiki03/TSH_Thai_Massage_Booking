import { request, ApiError } from './api.js';
import { thaiDate } from './format.js';

/**
 * lib/liff.js — การยืนยันตัวตนฝั่งผู้จอง + การส่งตั๋วเข้าแชท LINE
 *
 * โหมดการเชื่อมต่อ (ตั้งที่เมนูนักพัฒนา):
 *  - LOCAL      : ยังไม่ต่อ LINE จริง หน้าผู้จองใช้ได้เฉพาะเมื่อนักพัฒนาเลือก "ผู้ใช้จำลอง"
 *                 จากเมนูนักพัฒนา (เก็บไว้ใน localStorage ของ browser เครื่องนั้นเท่านั้น)
 *  - DEV_TUNNEL / PRODUCTION : ใช้ LIFF ล็อกอิน LINE จริง แล้วส่ง ID token ให้ backend ตรวจ
 */

/** key ใน localStorage ที่เมนูนักพัฒนาใช้เก็บผู้ใช้จำลองที่เลือกไว้ */
const MOCK_KEY = 'tmb_mock_user';

const state = { mode: 'LOCAL', config: null, mock: null };

/** LIFF SDK โหลดเฉพาะตอนใช้ LINE จริง (โหมด LOCAL ไม่ต้องโหลด → หน้าเว็บเบาลง) */
let liff = null;

/** ผู้ใช้จำลองที่เลือกไว้ { id, name } หรือ null */
export function getMockUser() {
  try { return JSON.parse(localStorage.getItem(MOCK_KEY)); } catch { return null; }
}
/** เลือกผู้ใช้จำลอง (เรียกจากเมนูนักพัฒนา) */
export function setMockUser(user) {
  try { localStorage.setItem(MOCK_KEY, JSON.stringify(user)); } catch { /* private mode */ }
}
/** หยุดจำลอง */
export function clearMockUser() {
  try { localStorage.removeItem(MOCK_KEY); } catch { /* ignore */ }
}

/**
 * เริ่มต้นหน้าผู้จอง: โหลด config แล้ว
 *  - LOCAL + ยังไม่เลือกผู้ใช้จำลอง → คืน { ...config, needsMock: true } ให้หน้าเว็บแสดงหน้าแจ้ง
 *  - โหมด LINE → init LIFF และ redirect ไปล็อกอิน LINE ถ้ายังไม่ล็อกอิน
 */
export async function initPatientAuth() {
  const config = await request('/api/public/config');
  state.config = config;
  state.mode = config.mode;

  if (config.mode === 'LOCAL') {
    state.mock = getMockUser();
    return { ...config, needsMock: !state.mock };
  }
  if (!config.liff_id) throw new Error('ยังไม่ได้ตั้งค่า LIFF ID ในเมนูการเชื่อมต่อระบบ');
  liff = (await import('@line/liff')).default;
  await liff.init({ liffId: config.liff_id });
  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: window.location.href });
    return new Promise(() => {}); // กำลัง redirect ไป LINE
  }
  return config;
}

/** header ยืนยันตัวตนที่แนบไปทุก request ของผู้จอง */
function authHeaders() {
  if (state.mode === 'LOCAL') {
    if (!state.mock) return {};
    // backend รับ header นี้เฉพาะตอนโหมด LOCAL เท่านั้น
    return { 'X-Dev-Line-User': state.mock.id, 'X-Dev-Line-Name': encodeURIComponent(state.mock.name ?? '') };
  }
  const token = liff.getIDToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** เรียก API ฝั่งผู้จอง (/api/public/*) พร้อมแนบการยืนยันตัวตน */
export async function patientApi(path, opts = {}) {
  try {
    return await request(`/api/public${path}`, { ...opts, headers: { ...authHeaders(), ...(opts.headers ?? {}) } });
  } catch (err) {
    // ID token หมดอายุ → ล็อกอิน LINE ใหม่
    if (err instanceof ApiError && err.code === 'LINE_AUTH' && state.mode !== 'LOCAL') {
      liff.logout();
      liff.login({ redirectUri: window.location.href });
    }
    throw err;
  }
}

/** true = โหมด LOCAL (ไม่ได้ต่อ LINE จริง) */
export const isLocalMode = () => state.mode === 'LOCAL';

/** true = เปิดอยู่ในแอป LINE (ไม่ใช่ browser ทั่วไป) */
export const inLineApp = () => state.mode !== 'LOCAL' && !!liff?.isInClient();

export function closeOrBack(navigate) {
  if (inLineApp()) liff.closeWindow();
  else navigate('/');
}

/**
 * ส่งตั๋วเข้าแชท LINE
 *  1) liff.sendMessages (ไม่กินโควตา) — ใช้ได้เมื่อเปิดจากห้องแชท OA
 *  2) ไม่ได้ → ให้ backend push แทน
 * โหมด LOCAL ไม่ส่งอะไร
 */
export async function sendTicketToChat(ticket) {
  if (state.mode === 'LOCAL') return 'skipped';
  try {
    const ctx = liff.getContext();
    if (liff.isInClient() && ctx && ['utou', 'room', 'group'].includes(ctx.type)) {
      await liff.sendMessages([ticketFlex(ticket)]);
      await patientApi(`/bookings/${ticket.booking_code}/liff-sent`, { method: 'POST' });
      return 'liff';
    }
  } catch { /* เปิดนอกห้องแชท / ไม่มีสิทธิ์ chat_message.write */ }
  try {
    await patientApi(`/bookings/${ticket.booking_code}/push-ticket`, { method: 'POST' });
    return 'push';
  } catch {
    return 'failed';
  }
}

function ticketFlex(t) {
  const url = `https://liff.line.me/${state.config.liff_id}/ticket/${t.booking_code}`;
  const row = (label, value) => ({
    type: 'box', layout: 'baseline', spacing: 'md',
    contents: [
      { type: 'text', text: label, size: 'sm', color: '#5F6F66', flex: 2 },
      { type: 'text', text: value, size: 'sm', color: '#1F2A24', flex: 5, wrap: true },
    ],
  });
  return {
    type: 'flex',
    altText: `จองคิวนวดสำเร็จ รหัส ${t.booking_code}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#2F6B4F', paddingAll: '16px',
        contents: [
          { type: 'text', text: 'ตั๋วคิวนวดแผนไทย', color: '#DCEBE1', size: 'xs' },
          { type: 'text', text: t.booking_code, color: '#FFFFFF', size: '3xl', weight: 'bold' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
        contents: [
          row('ผู้รับบริการ', `${t.patient.first_name} ${t.patient.last_name}`),
          row('วันที่', thaiDate(t.slot_date)),
          row('เวลา', `${t.start_time}–${t.end_time} น.`),
          ...(t.service ? [row('บริการ', t.service.price == null ? t.service.name : `${t.service.name} (${Number(t.service.price).toLocaleString('th-TH')} บาท)`)] : []),
          // คำแนะนำการมารับบริการ (ค่าเดียวกับหน้าเว็บ / ข้อความ LINE — ตั้งได้ที่หน้า "กฎการจอง")
          ...(state.config?.checkin_note ? [{ type: 'text', text: state.config.checkin_note, size: 'sm', color: '#8C5E3C', weight: 'bold', wrap: true, margin: 'lg' }] : []),
          { type: 'text', text: 'แจ้งรหัสจองนี้ที่ห้องนวดแผนไทย', size: 'xs', color: '#8A9A91', wrap: true, margin: 'sm' },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '12px',
        contents: [{ type: 'button', style: 'primary', color: '#2F6B4F', height: 'sm', action: { type: 'uri', label: 'ดูตั๋ว', uri: url } }],
      },
    },
  };
}
