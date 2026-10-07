import liff from '@line/liff';
import { request, ApiError } from './api.js';
import { thaiDate } from './format.js';

/**
 * การยืนยันตัวตนฝั่งผู้จอง
 *  - โหมด LOCAL: ใช้ผู้ใช้จำลอง (เลือกได้จากแถบทดสอบด้านบน)
 *  - โหมดอื่น:   LIFF → ส่ง ID token ให้ backend ตรวจกับ LINE
 */
export const DEV_USERS = [
  { id: 'Udev00000000000000000000000000001', name: 'Somsri (มีแม่ในรายชื่อ)' },
  { id: 'Udev00000000000000000000000000002', name: 'Wichai (บุคคลทั่วไป)' },
  { id: 'Udev00000000000000000000000000003', name: 'Prasert (เคยไม่มาตามนัด)' },
  { id: 'Udev00000000000000000000000000004', name: 'ผู้ใช้ใหม่ (ยังไม่ลงทะเบียน)' },
];
const DEV_KEY = 'tmb_dev_user';

const state = { mode: 'LOCAL', config: null, devUser: DEV_USERS[0].id };

export function getDevUser() { return state.devUser; }
export function setDevUser(id) {
  state.devUser = id;
  try { localStorage.setItem(DEV_KEY, id); } catch { /* private mode */ }
}

export async function initPatientAuth() {
  const config = await request('/api/public/config');
  state.config = config;
  state.mode = config.mode;

  if (config.mode === 'LOCAL') {
    try { state.devUser = localStorage.getItem(DEV_KEY) || DEV_USERS[0].id; } catch { /* ignore */ }
    return config;
  }
  if (!config.liff_id) throw new Error('ยังไม่ได้ตั้งค่า LIFF ID ในเมนูการเชื่อมต่อระบบ');
  await liff.init({ liffId: config.liff_id });
  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: window.location.href });
    return new Promise(() => {}); // กำลัง redirect ไป LINE
  }
  return config;
}

function authHeaders() {
  if (state.mode === 'LOCAL') {
    const u = DEV_USERS.find((x) => x.id === state.devUser);
    return { 'X-Dev-Line-User': state.devUser, 'X-Dev-Line-Name': encodeURIComponent(u?.name.split(' ')[0] ?? 'ผู้ใช้ทดสอบ') };
  }
  const token = liff.getIDToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

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

export const isLocalMode = () => state.mode === 'LOCAL';

export function closeOrBack(navigate) {
  if (state.mode !== 'LOCAL' && liff.isInClient()) liff.closeWindow();
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
          { type: 'text', text: 'แสดงรหัสนี้ที่เคาน์เตอร์ก่อนเวลานัด 10–15 นาที', size: 'xs', color: '#8A9A91', wrap: true, margin: 'md' },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '12px',
        contents: [{ type: 'button', style: 'primary', color: '#2F6B4F', height: 'sm', action: { type: 'uri', label: 'ดูตั๋ว', uri: url } }],
      },
    },
  };
}
