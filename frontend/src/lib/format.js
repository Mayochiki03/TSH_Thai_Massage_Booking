/**
 * lib/format.js — จัดรูปแบบวันที่/เวลาภาษาไทย (พ.ศ., เวลาไทย) + ชื่อสถานะคิว + ตัวเลือกความสัมพันธ์
 */
import { serverNow } from './api.js';

const tz = 'Asia/Bangkok';
const toDate = (ymd) => new Date(`${String(ymd).slice(0, 10)}T00:00:00+07:00`);

/** 'พ. 7 ต.ค. 2569' */
export const thaiDate = (ymd) =>
  new Intl.DateTimeFormat('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: tz }).format(toDate(ymd));

/** 'วันพุธที่ 7 ตุลาคม 2569' */
export const thaiDateLong = (ymd) =>
  new Intl.DateTimeFormat('th-TH', { dateStyle: 'full', timeZone: tz }).format(toDate(ymd));

export const weekdayShort = (ymd) => new Intl.DateTimeFormat('th-TH', { weekday: 'short', timeZone: tz }).format(toDate(ymd));
export const dayNum = (ymd) => new Intl.DateTimeFormat('th-TH', { day: 'numeric', timeZone: tz }).format(toDate(ymd));
export const monthShort = (ymd) => new Intl.DateTimeFormat('th-TH', { month: 'short', timeZone: tz }).format(toDate(ymd));

/** วันนี้ตามเวลาไทย 'YYYY-MM-DD' (ตามนาฬิกาเซิร์ฟเวอร์ — กันเครื่องที่ตั้งวันที่ผิด) */
export function todayYmd() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(serverNow()));
}

export function addDays(ymd, n) {
  const d = toDate(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
}

/** 'วันนี้' / 'พรุ่งนี้' / 'มะรืนนี้' / null */
export function relativeDay(ymd) {
  const t = todayYmd();
  if (ymd === t) return 'วันนี้';
  if (ymd === addDays(t, 1)) return 'พรุ่งนี้';
  if (ymd === addDays(t, 2)) return 'มะรืนนี้';
  return null;
}

export const hhmm = (t) => (t ? String(t).slice(0, 5) : '');

/** '2026-10-07 10:37:11' → '10:37' */
export const timeOf = (ts) => (ts ? String(ts).slice(11, 16) : '');

export const STATUS = {
  AVAILABLE: { label: 'ว่าง', tone: 'leaf' },
  BOOKED: { label: 'จองแล้ว', tone: 'sky' },
  CHECKED_IN: { label: 'มาถึงแล้ว', tone: 'herb' },
  IN_SERVICE: { label: 'กำลังนวด', tone: 'turmeric' },
  COMPLETED: { label: 'เสร็จสิ้น', tone: 'stone' },
  NO_SHOW: { label: 'ไม่มาตามนัด', tone: 'rose' },
  CANCELLED: { label: 'ยกเลิกแล้ว', tone: 'stone' },
  BLOCKED: { label: 'ปิดรับ', tone: 'stone' },
  HOLIDAY: { label: 'วันหยุด', tone: 'stone' },
};

export const RELATIONS = ['มารดา', 'บิดา', 'คู่สมรส', 'บุตร', 'ญาติ', 'อื่น ๆ'];

/** 300 → '300 บาท' (ไม่มีทศนิยมถ้าเป็นจำนวนเต็ม) */
/**
 * "ชื่อบริการ · 200 บาท" — ถ้าไม่มีราคา (ผู้ดูแลปิด "แสดงราคาให้ผู้รับบริการเห็น" → backend ส่ง price = null)
 * คืนแค่ชื่อบริการ
 */
export const serviceLabel = (sv, sep = ' · ') => (sv ? (sv.price == null ? sv.name : `${sv.name}${sep}${baht(sv.price)}`) : '');

export const baht = (n) => (n == null ? '' : `${Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 })} บาท`);
