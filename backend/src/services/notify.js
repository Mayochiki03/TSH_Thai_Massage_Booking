/**
 * services/notify.js — ส่งแจ้งเตือนทาง LINE ตาม template ใน notification_templates
 *   - ส่งไปที่ LINE ของ "ผู้จอง" (ไม่ใช่ผู้รับบริการ) / คิวที่ไม่มี LINE จะไม่ส่ง
 *   - ส่งครั้งเดียวต่อ (คิว, ชนิด) — กันส่งซ้ำด้วย notification_logs
 *   - โหมด LOCAL ไม่ส่งจริง พิมพ์ข้อความลง console และบันทึกเป็น SKIPPED
 */
import { query, queryOne } from '../db.js';
import { lineConfig, pushMessages, patientUrl } from './line.js';
import { thaiDate, hhmm, fillTemplate } from '../utils/format.js';

/**
 * ส่งแจ้งเตือน 1 ครั้งต่อ (คิว, ชนิด) ไปที่ LINE ของผู้จอง
 * - คิวที่ไม่มี LINE (เจ้าหน้าที่จองแทน / walk-in) → ไม่ส่ง คืน { sent: false, reason: 'NO_LINE' }
 * - โหมด LOCAL หรือยังไม่ตั้ง token → บันทึกเป็น SKIPPED และพิมพ์ข้อความลง console
 */
export async function notifyAppointment(type, appointmentId, extraVars = {}) {
  const tpl = await queryOne('SELECT * FROM notification_templates WHERE type = ?', [type]);
  if (!tpl || !tpl.is_enabled) return { sent: false, reason: 'DISABLED' };

  const a = await queryOne('SELECT * FROM v_appointment_details WHERE appointment_id = ?', [appointmentId]);
  if (!a) return { sent: false, reason: 'NOT_FOUND' };
  if (!a.booked_by_line_user_id) return { sent: false, reason: 'NO_LINE' };

  const already = await queryOne('SELECT log_id FROM notification_logs WHERE appointment_id = ? AND type = ?', [appointmentId, type]);
  if (already) return { sent: false, reason: 'ALREADY_SENT' };

  const vars = {
    patient_name: `${a.first_name} ${a.last_name}`,
    date: thaiDate(a.slot_date),
    time: `${hhmm(a.start_time)}–${hhmm(a.end_time)} น.`,
    code: a.booking_code,
    service: a.service_name ?? '',
    price: a.service_price == null ? '' : `${Number(a.service_price).toLocaleString('th-TH')} บาท`,
    rebook_url: await patientUrl('/'),
    ...extraVars,
  };
  const message = await buildMessage(type, tpl, vars, a.booking_code);
  return deliver(a.booked_by_line_user_id, message, { appointmentId, type });
}

/** แจ้งเตือนที่ไม่ผูกกับคิว (เช่น ระงับสิทธิ์) */
export async function notifyLineUser(type, lineUserId, vars) {
  const tpl = await queryOne('SELECT * FROM notification_templates WHERE type = ?', [type]);
  if (!tpl || !tpl.is_enabled || !lineUserId) return { sent: false, reason: 'DISABLED' };
  const message = await buildMessage(type, tpl, { rebook_url: await patientUrl('/'), ...vars }, null);
  return deliver(lineUserId, message, { appointmentId: null, type });
}

async function deliver(lineUserId, message, { appointmentId, type }) {
  const cfg = await lineConfig();
  let status = 'SENT';
  let error = null;

  if (cfg.mode === 'LOCAL' || !cfg.channelToken) {
    status = 'SKIPPED';
    error = cfg.mode === 'LOCAL' ? 'โหมด LOCAL (ไม่ได้ส่งจริง)' : 'ยังไม่ได้ตั้งค่า LINE';
    console.log(`[notify:${status}] ${type} → ${lineUserId}\n${message.altText}\n${message._plain}\n`);
  } else {
    const { _plain, ...lineMessage } = message;
    const r = await pushMessages(lineUserId, [lineMessage]);
    if (!r.ok) { status = 'FAILED'; error = (r.data?.message || `HTTP ${r.status}`).slice(0, 500); }
  }

  await query(
    `INSERT IGNORE INTO notification_logs (appointment_id, line_user_id, type, channel, status, error_message)
     VALUES (?, ?, ?, 'PUSH', ?, ?)`,
    [appointmentId, lineUserId, type, status, error],
  );
  return { sent: status === 'SENT', status, error };
}

/** สร้าง Flex message: ข้อความจาก template + ปุ่มตามชนิด */
async function buildMessage(type, tpl, vars, code) {
  const text = fillTemplate(tpl.body, vars);
  const buttons = [];
  if (type === 'REMIND_2H' && code) {
    buttons.push(button('ยืนยันมาตามนัด', await patientUrl(`/ticket/${code}?action=confirm`), 'primary'));
    buttons.push(button('ยกเลิกคิว', await patientUrl(`/ticket/${code}?action=cancel`), 'secondary'));
  } else if (type === 'HOLIDAY_CANCELLED' || type === 'CANCELLED') {
    buttons.push(button('จองคิวใหม่', await patientUrl('/'), 'primary'));
  } else if (code) {
    buttons.push(button('ดูตั๋ว', await patientUrl(`/ticket/${code}`), 'primary'));
  }

  return {
    type: 'flex',
    altText: tpl.title,
    _plain: text, // ใช้ log ในโหมด LOCAL (ไม่ส่งให้ LINE)
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#2F6B4F', paddingAll: '16px',
        contents: [{ type: 'text', text: tpl.title, color: '#FFFFFF', weight: 'bold', size: 'md', wrap: true }],
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: '16px',
        contents: [{ type: 'text', text, wrap: true, size: 'sm', color: '#1F2A24' }],
      },
      ...(buttons.length && {
        footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px', contents: buttons },
      }),
    },
  };
}

function button(label, uri, style) {
  return {
    type: 'button', style, height: 'sm',
    color: style === 'primary' ? '#2F6B4F' : undefined,
    action: { type: 'uri', label, uri },
  };
}
