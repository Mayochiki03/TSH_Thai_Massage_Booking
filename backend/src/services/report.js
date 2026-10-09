/**
 * services/report.js — สร้างไฟล์ Excel รายงานการจอง (ใช้ exceljs)
 *
 * buildBookingReport({ from, to, maskPhone, practitionerId, generatedBy }) → { workbook, filename, count }
 *
 * ไฟล์มี 4 แผ่นงาน:
 *   1) สรุป          การ์ดตัวเลข (คิว / เสร็จสิ้น / ไม่มา / ยกเลิก / อัตรามาตามนัด / อัตราการใช้รอบ / รอรับบริการ / เวลาเฉลี่ย / จำนวนคน)
 *                    ไม่มีการสรุปรายได้ (ตามที่หัวหน้ากำหนด) — ราคาแสดงเป็นรายคิวในแผ่น "รายการจอง" เท่านั้น
 *                    + ตารางแยกตามสถานะ / ช่องทาง / รอบเวลา / ประเภทบริการ / หมอนวด + คำอธิบาย
 *   2) รายวัน        ทีละวัน: จำนวนที่ (เตียง×รอบ) / ปิดรับ / จอง / เสร็จ / ไม่มา / ยกเลิก / อัตราการใช้รอบ
 *   3) รายการจอง     ทุกคิว: เลขบัตรประชาชน, ประเภทบริการ+ราคา, หมอนวด, VN ฯลฯ (กรอง/เรียงได้ สีตามสถานะ)
 *   4) ผู้รับบริการ   รายคน: เลขบัตร, จองกี่ครั้ง เสร็จ / ไม่มา / ยกเลิก / มาครั้งล่าสุด
 *
 * practitionerId → เฉพาะคิวที่หมอนวดคนนั้นนวด ("หมอนวดคนนี้นวดใครไปบ้าง")
 * maskPhone      → ปิดบังเบอร์โทรและเลขบัตรประชาชน (ไฟล์ที่จะส่งต่อ)
 *
 * ตัวเลขสรุปทุกช่องเป็น "สูตร Excel" ที่นับจากแผ่น "รายการจอง" (COUNTIFS)
 * → ถ้าเจ้าหน้าที่แก้/ลบแถวในไฟล์ ตัวเลขสรุปจะคำนวณใหม่เองใน Excel
 *
 * วันที่เก็บเป็นวันที่จริงของ Excel (เรียง/กรองได้) และแสดงแบบไทย พ.ศ. ด้วยรูปแบบ [$-107041E] (ภาษาไทย + ปฏิทินพุทธ)
 */
import ExcelJS from 'exceljs';
import { query, queryOne } from '../db.js';
import { getSetting } from './settings.js';
import { revealThaiId, formatThaiId, maskThaiId } from '../utils/nationalId.js';
import { embedFormulaResults } from '../utils/xlsxResults.js';

// ---------------------------------------------------------------------
// ค่าคงที่: ชื่อภาษาไทย / สี / รูปแบบตัวเลข
// ---------------------------------------------------------------------
export const STATUS_TH = {
  BOOKED: 'จองแล้ว', CHECKED_IN: 'มาถึงแล้ว', IN_SERVICE: 'กำลังนวด',
  COMPLETED: 'เสร็จสิ้น', NO_SHOW: 'ไม่มาตามนัด', CANCELLED: 'ยกเลิกแล้ว',
};
const STATUS_ORDER = ['COMPLETED', 'NO_SHOW', 'CANCELLED', 'BOOKED', 'CHECKED_IN', 'IN_SERVICE'];
export const CHANNEL_TH = { ONLINE: 'LINE', KIOSK: 'เครื่อง kiosk', WALK_IN: 'walk-in ที่เคาน์เตอร์', STAFF: 'เจ้าหน้าที่จองแทน' };
const PATIENT_TYPE_TH = { HN: 'ผู้ป่วย (มี HN)', GENERAL: 'บุคคลทั่วไป' };
const CANCELLED_BY_TH = { PATIENT: 'ผู้จอง', STAFF: 'เจ้าหน้าที่', SYSTEM: 'ระบบ' };

/** สีจากธีมของเว็บ (ARGB) */
const C = {
  herb: 'FF2F6B4F', herbDark: 'FF234F3B', leaf: 'FFDCEBE1', leafSoft: 'FFEDF5F0',
  sand: 'FFF4EDE1', ivory: 'FFFBF8F2', line: 'FFE3DDD2', clay: 'FF8C5E3C', claySoft: 'FFF3E6DA',
  ink: 'FF2A2620', muted: 'FF6B645A', faint: 'FF9B9387', white: 'FFFFFFFF',
  skySoft: 'FFE3EEF8', skyInk: 'FF2F5E8A', roseSoft: 'FFF8E4E1', roseInk: 'FF9A3B32',
  stoneSoft: 'FFEEEBE6', stoneInk: 'FF5F5A52', turmericSoft: 'FFF7EFD2', turmericInk: 'FF7A5F0E',
};
/** สีช่องสถานะในแผ่น "รายการจอง" */
const STATUS_STYLE = {
  BOOKED: [C.skySoft, C.skyInk], CHECKED_IN: [C.leaf, C.herbDark], IN_SERVICE: [C.turmericSoft, C.turmericInk],
  COMPLETED: [C.leafSoft, C.herb], NO_SHOW: [C.roseSoft, C.roseInk], CANCELLED: [C.stoneSoft, C.stoneInk],
};

/** Tahoma มีในทุกเครื่อง Windows และแสดงภาษาไทยชัด */
const FONT = 'Tahoma';
const FMT = {
  date: '[$-107041E]d mmm yyyy',          // 041E = ภาษาไทย, 07 = ปฏิทินพุทธ → 1 ก.ย. 2569
  dateZeroDash: '[$-107041E]d mmm yyyy;;"-"',
  dateTime: '[$-107041E]d mmm yyyy hh:mm',
  time: 'hh:mm',
  int: '#,##0;-#,##0;"-"',
  pct: '0.0%;-0.0%;"-"',
  min: '0" นาที";-0" นาที";"-"',
  baht: '#,##0" ฿";-#,##0" ฿";"-"',
};

const SHEET = { summary: 'สรุป', daily: 'รายวัน', list: 'รายการจอง', people: 'ผู้รับบริการ' };
const ref = (sheet, range) => `'${sheet}'!${range}`;

// ---------------------------------------------------------------------
// แปลงค่าจากฐานข้อมูล (dateStrings) → Date ของ Excel โดยไม่ให้ timezone เลื่อน
// ---------------------------------------------------------------------
/** '2026-10-07' หรือ '2026-10-07 09:15:00' → Date (UTC ตรงตามตัวเลข) */
function xlDate(s) {
  if (!s) return null;
  const [d, t = '00:00:00'] = String(s).split(' ');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi, se] = t.split(':').map(Number);
  return new Date(Date.UTC(y, mo - 1, da, h || 0, mi || 0, se || 0));
}
const hhmm = (t) => (t ? String(t).slice(0, 5) : '');
const thaiDateText = (ymd) => new Intl.DateTimeFormat('th-TH', { dateStyle: 'long', timeZone: 'UTC' }).format(xlDate(ymd));
const thaiWeekday = (ymd) => new Intl.DateTimeFormat('th-TH', { weekday: 'long', timeZone: 'UTC' }).format(xlDate(ymd));
/** 0812345678 → 081-xxx-5678 */
const maskPhone = (p) => (p && p.length >= 9 ? `${p.slice(0, 3)}-xxx-${p.slice(-4)}` : p);

// ---------------------------------------------------------------------
// ดึงข้อมูล
// ---------------------------------------------------------------------
async function loadData(from, to, practitionerId) {
  const bookings = await query(
    `SELECT d.*, su.full_name AS staff_name, p.national_id_enc
       FROM v_appointment_details d
       JOIN patients p ON p.patient_id = d.patient_id
       LEFT JOIN staff_users su ON su.user_id = d.booked_by_staff
      WHERE d.slot_date BETWEEN ? AND ? ${practitionerId ? 'AND d.practitioner_id = ?' : ''}
      ORDER BY d.slot_date, d.start_time, d.appointment_id`,
    practitionerId ? [from, to, practitionerId] : [from, to],
  );
  // จำนวน "ที่" ต่อวัน = Σ capacity ของทุกรอบ (เตียง × รอบ)
  const days = await query(
    `SELECT s.slot_date AS date, SUM(s.capacity) AS slots, SUM(IF(s.is_blocked, s.capacity, 0)) AS blocked, MAX(h.name) AS holiday
       FROM time_slots s LEFT JOIN holidays h ON h.holiday_date = s.slot_date
      WHERE s.slot_date BETWEEN ? AND ?
      GROUP BY s.slot_date ORDER BY s.slot_date`,
    [from, to],
  );
  return { bookings, days };
}

// ---------------------------------------------------------------------
// ตัวช่วยจัดรูปแบบ
// ---------------------------------------------------------------------
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const thin = (argb = C.line) => ({ style: 'thin', color: { argb } });
const allBorders = (argb) => ({ top: thin(argb), left: thin(argb), bottom: thin(argb), right: thin(argb) });

function baseSheet(wb, name, { landscape = false, tabColor } = {}) {
  const ws = wb.addWorksheet(name, {
    properties: { defaultRowHeight: 20, tabColor: tabColor ? { argb: tabColor } : undefined },
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9, orientation: landscape ? 'landscape' : 'portrait',
      fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  });
  ws.headerFooter.oddFooter = `&L&8${name}&R&8หน้า &P / &N`;
  return ws;
}

/** หัวรายงาน 3 บรรทัด (ชื่อรายงาน / คลินิก + ช่วงวันที่ / ออกรายงานเมื่อ) */
function titleBlock(ws, lastCol, { title, clinic, rangeText, generatedText }) {
  ws.mergeCells(1, 1, 1, lastCol);
  ws.mergeCells(2, 1, 2, lastCol);
  ws.mergeCells(3, 1, 3, lastCol);
  Object.assign(ws.getCell(1, 1), { value: title, font: { name: FONT, size: 16, bold: true, color: { argb: C.herbDark } } });
  Object.assign(ws.getCell(2, 1), { value: `${clinic}  ·  ${rangeText}`, font: { name: FONT, size: 11, color: { argb: C.clay } } });
  Object.assign(ws.getCell(3, 1), { value: generatedText, font: { name: FONT, size: 9, color: { argb: C.faint } } });
  ws.getRow(1).height = 28;
  ws.getRow(2).height = 20;
  ws.getRow(3).height = 18;
}

/** แถวหัวตาราง: พื้นเขียว ตัวขาว ตัดบรรทัดได้ */
function headerRow(ws, rowNo, headers) {
  const row = ws.getRow(rowNo);
  headers.forEach((h, i) => {
    const cell = row.getCell(i + 1);
    cell.value = h;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: C.white } };
    cell.fill = fill(C.herb);
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = allBorders(C.herbDark);
  });
  row.height = 30;
}

/** แถวข้อมูล: เส้นบาง สลับสีพื้นทุกแถวคู่ */
function bodyCell(cell, i, { align = 'left', numFmt, bold = false, color } = {}) {
  cell.font = { name: FONT, size: 10, bold, color: { argb: color ?? C.ink } };
  cell.alignment = { vertical: 'middle', horizontal: align, wrapText: align === 'left', indent: align === 'left' ? 1 : 0 };
  cell.border = allBorders();
  if (i % 2 === 1) cell.fill = fill(C.ivory);
  if (numFmt) cell.numFmt = numFmt;
}

/** แถวรวม: พื้นเขียวอ่อน ตัวหนา */
function totalCell(cell, { align = 'right', numFmt } = {}) {
  cell.font = { name: FONT, size: 10, bold: true, color: { argb: C.herbDark } };
  cell.fill = fill(C.leaf);
  cell.alignment = { vertical: 'middle', horizontal: align };
  cell.border = { top: { style: 'medium', color: { argb: C.herb } }, bottom: thin(C.herb), left: thin(), right: thin() };
  if (numFmt) cell.numFmt = numFmt;
}

// ---------------------------------------------------------------------
// แผ่น "รายการจอง" — คอลัมน์อ้างด้วย key (ตัวอักษรคอลัมน์คำนวณเอง → เพิ่ม/สลับคอลัมน์ได้ไม่ต้องแก้สูตร)
// ---------------------------------------------------------------------
const LIST_COLS = [
  { key: 'no', h: 'ลำดับ', w: 6, align: 'center' },
  { key: 'code', h: 'รหัสจอง', w: 10, align: 'center' },
  { key: 'date', h: 'วันที่', w: 13, align: 'center', fmt: FMT.date },
  { key: 'slot', h: 'รอบเวลา', w: 12, align: 'center' },
  { key: 'name', h: 'ผู้รับบริการ', w: 24 },
  { key: 'nid', h: 'เลขบัตรประชาชน', w: 19, align: 'center' },
  { key: 'hn', h: 'HN', w: 11, align: 'center' },
  { key: 'ptype', h: 'ประเภทผู้รับบริการ', w: 15, align: 'center' },
  { key: 'phone', h: 'เบอร์โทร', w: 13, align: 'center' },
  { key: 'service', h: 'ประเภทบริการ', w: 22 },
  { key: 'price', h: 'ราคา', w: 10, align: 'right', fmt: FMT.baht },
  { key: 'status', h: 'สถานะ', w: 13, align: 'center' },
  { key: 'pract', h: 'หมอนวด', w: 20 },
  { key: 'vn', h: 'VN', w: 14, align: 'center' },
  { key: 'channel', h: 'ช่องทาง', w: 17, align: 'center' },
  { key: 'booker', h: 'ผู้จอง', w: 20 },
  { key: 'relation', h: 'ความสัมพันธ์', w: 12, align: 'center' },
  { key: 'complaint', h: 'อาการ / เหตุที่มา', w: 28 },
  { key: 'checkin', h: 'เช็กอิน', w: 9, align: 'center', fmt: FMT.time },
  { key: 'start', h: 'เริ่มนวด', w: 9, align: 'center', fmt: FMT.time },
  { key: 'end', h: 'นวดเสร็จ', w: 9, align: 'center', fmt: FMT.time },
  { key: 'minutes', h: 'ใช้เวลา', w: 10, align: 'center', fmt: FMT.min },
  { key: 'cancelBy', h: 'ยกเลิกโดย', w: 11, align: 'center' },
  { key: 'cancelReason', h: 'เหตุผลการยกเลิก', w: 24 },
  { key: 'created', h: 'จองเมื่อ', w: 19, align: 'center', fmt: FMT.dateTime },
  { key: 'pid', h: 'patient_id', w: 8, hidden: true }, // ใช้นับในแผ่น "ผู้รับบริการ" (ซ่อนไว้)
];
const colLetter = (n) => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
/** ตัวอักษรคอลัมน์ของแผ่นรายการจองตาม key เช่น COL.status → 'L' */
const COL = Object.fromEntries(LIST_COLS.map((c, i) => [c.key, colLetter(i + 1)]));
const LIST_LAST_VISIBLE = LIST_COLS.filter((c) => !c.hidden).length;
const LIST_HEADER_ROW = 5;

/** เลขบัตรสำหรับไฟล์: เต็ม (1-2345-67890-12-3) หรือปิดบัง / ไม่มีบัตรไทย / ยังไม่กรอก */
function nidText(b, mask) {
  if (b.no_national_id && !b.has_national_id) return 'ไม่มีบัตรไทย';
  if (!b.has_national_id) return '-';
  if (mask) return maskThaiId(b.national_id_last4);
  return formatThaiId(revealThaiId(b.national_id_enc)) || maskThaiId(b.national_id_last4);
}

function buildListSheet(wb, bookings, opts, head) {
  const ws = baseSheet(wb, SHEET.list, { landscape: true, tabColor: C.herb });
  titleBlock(ws, LIST_LAST_VISIBLE, { ...head, title: 'รายการจองทั้งหมด' });
  LIST_COLS.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.w;
    if (c.hidden) col.hidden = true;
  });
  headerRow(ws, LIST_HEADER_ROW, LIST_COLS.map((c) => c.h));

  bookings.forEach((b, i) => {
    const r = LIST_HEADER_ROW + 1 + i;
    const booker = b.booked_by_line_user_id ? (b.booker_line_name || 'ผู้ใช้ LINE') : (b.staff_name ? `จนท. ${b.staff_name}` : '-');
    const v = {
      no: i + 1,
      code: b.booking_code,
      date: xlDate(b.slot_date),
      slot: `${hhmm(b.start_time)}–${hhmm(b.end_time)}`,
      name: `${b.first_name} ${b.last_name}`,
      nid: nidText(b, opts.maskPhone),
      hn: b.hn || '-',
      ptype: PATIENT_TYPE_TH[b.patient_type] ?? b.patient_type,
      phone: opts.maskPhone ? maskPhone(b.phone_number) : b.phone_number,
      service: b.service_name || '-',
      price: b.service_price == null ? null : Number(b.service_price),
      status: STATUS_TH[b.status] ?? b.status,
      pract: b.practitioner_name || '',
      vn: b.vn || '',
      channel: CHANNEL_TH[b.booking_channel] ?? b.booking_channel,
      booker,
      relation: b.booker_relation || (b.booked_by_line_user_id ? 'ตนเอง' : '-'),
      complaint: b.chief_complaint || '',
      checkin: xlDate(b.checked_in_at),
      start: xlDate(b.service_start),
      end: xlDate(b.service_end),
      // ใช้เวลา (นาที) = (นวดเสร็จ − เริ่มนวด) × 1440 → สูตร ถ้าแก้เวลาใน Excel จะคำนวณใหม่
      minutes: { formula: `IF(AND(ISNUMBER(${COL.start}${r}),ISNUMBER(${COL.end}${r})),ROUND((${COL.end}${r}-${COL.start}${r})*1440,0),"")` },
      cancelBy: b.cancelled_by ? CANCELLED_BY_TH[b.cancelled_by] : '',
      cancelReason: b.cancel_reason || '',
      created: xlDate(b.created_at),
      pid: Number(b.patient_id),
    };
    const row = ws.getRow(r);
    LIST_COLS.forEach((c, ci) => {
      const cell = row.getCell(ci + 1);
      cell.value = v[c.key];
      bodyCell(cell, i, { align: c.align, numFmt: c.fmt });
    });
    // ช่องสถานะ: สีตามสถานะ
    const [bg, fg] = STATUS_STYLE[b.status] ?? [C.stoneSoft, C.stoneInk];
    const st = ws.getCell(`${COL.status}${r}`);
    st.fill = fill(bg);
    st.font = { name: FONT, size: 10, bold: true, color: { argb: fg } };
    ws.getCell(`${COL.code}${r}`).font = { name: FONT, size: 10, bold: true, color: { argb: C.herbDark } };
    row.height = 22;
  });

  if (!bookings.length) {
    ws.mergeCells(LIST_HEADER_ROW + 1, 1, LIST_HEADER_ROW + 1, LIST_LAST_VISIBLE);
    Object.assign(ws.getCell(LIST_HEADER_ROW + 1, 1), {
      value: 'ไม่มีการจองในช่วงวันที่นี้',
      font: { name: FONT, size: 10, italic: true, color: { argb: C.faint } },
      alignment: { horizontal: 'center' },
    });
  }

  const lastRow = LIST_HEADER_ROW + Math.max(bookings.length, 1);
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: LIST_HEADER_ROW, showGridLines: false }];
  ws.autoFilter = { from: { row: LIST_HEADER_ROW, column: 1 }, to: { row: lastRow, column: LIST_LAST_VISIBLE } };
  ws.pageSetup.printTitlesRow = `${LIST_HEADER_ROW}:${LIST_HEADER_ROW}`;
  return { first: LIST_HEADER_ROW + 1, last: lastRow };
}

/** ช่วงคอลัมน์ในแผ่นรายการจองสำหรับใส่ในสูตร เช่น 'รายการจอง'!$L$6:$L$40 */
const listRange = (rows, key) => ref(SHEET.list, `$${COL[key]}$${rows.first}:$${COL[key]}$${rows.last}`);
const DONE = STATUS_TH.COMPLETED;

// ---------------------------------------------------------------------
// แผ่น "รายวัน"
// ---------------------------------------------------------------------
const DAILY_HEADER_ROW = 5;
function buildDailySheet(wb, days, rows, head, { filtered }) {
  const ws = baseSheet(wb, SHEET.daily, { tabColor: C.clay });
  const cols = [
    { h: 'วันที่', w: 14, align: 'center', fmt: FMT.date },
    { h: 'วัน', w: 11, align: 'center' },
    { h: 'จำนวนที่\n(เตียง×รอบ)', w: 11, align: 'center', fmt: FMT.int },
    { h: 'ปิดรับ', w: 8, align: 'center', fmt: FMT.int },
    { h: 'จอง', w: 8, align: 'center', fmt: FMT.int },
    { h: 'เสร็จสิ้น', w: 9, align: 'center', fmt: FMT.int },
    { h: 'ไม่มาตามนัด', w: 11, align: 'center', fmt: FMT.int },
    { h: 'ยกเลิก', w: 8, align: 'center', fmt: FMT.int },
    { h: 'อัตราการใช้รอบ', w: 13, align: 'center', fmt: FMT.pct },
    { h: 'หมายเหตุ', w: 22 },
  ];
  titleBlock(ws, cols.length, { ...head, title: 'สรุปรายวัน' });
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.w; });
  headerRow(ws, DAILY_HEADER_ROW, cols.map((c) => c.h));
  ws.getRow(DAILY_HEADER_ROW).height = 36;

  const dR = listRange(rows, 'date');
  const sR = listRange(rows, 'status');
  days.forEach((d, i) => {
    const r = DAILY_HEADER_ROW + 1 + i;
    const values = [
      xlDate(d.date),
      thaiWeekday(d.date),
      Number(d.slots),
      Number(d.blocked),
      { formula: `COUNTIFS(${dR},A${r})` },
      { formula: `COUNTIFS(${dR},A${r},${sR},"${DONE}")` },
      { formula: `COUNTIFS(${dR},A${r},${sR},"${STATUS_TH.NO_SHOW}")` },
      { formula: `COUNTIFS(${dR},A${r},${sR},"${STATUS_TH.CANCELLED}")` },
      // อัตราการใช้รอบ = (จอง − ยกเลิก) ÷ (ที่ทั้งหมด − ปิดรับ) — เมื่อกรองหมอนวด ตัวเลขนี้ไม่มีความหมาย จึงเว้นไว้
      filtered ? '' : { formula: `IF(C${r}-D${r}>0,(E${r}-H${r})/(C${r}-D${r}),"")` },
      d.holiday ? `วันหยุด: ${d.holiday}` : '',
    ];
    const row = ws.getRow(r);
    values.forEach((v, ci) => {
      const cell = row.getCell(ci + 1);
      cell.value = v;
      bodyCell(cell, i, { align: cols[ci].align, numFmt: cols[ci].fmt });
    });
    row.height = 21;
  });

  const first = DAILY_HEADER_ROW + 1;
  const last = DAILY_HEADER_ROW + Math.max(days.length, 1);
  const tr = last + 1;
  const total = ws.getRow(tr);
  total.getCell(1).value = 'รวม';
  total.getCell(2).value = days.length ? `${days.length} วัน` : '';
  ['C', 'D', 'E', 'F', 'G', 'H'].forEach((c) => { ws.getCell(`${c}${tr}`).value = { formula: `SUM(${c}${first}:${c}${last})` }; });
  ws.getCell(`I${tr}`).value = filtered ? '' : { formula: `IF(C${tr}-D${tr}>0,(E${tr}-H${tr})/(C${tr}-D${tr}),"")` };
  cols.forEach((c, i) => totalCell(total.getCell(i + 1), { align: c.align === 'right' ? 'right' : 'center', numFmt: c.fmt === FMT.date ? undefined : c.fmt }));
  total.height = 24;

  ws.views = [{ state: 'frozen', ySplit: DAILY_HEADER_ROW, showGridLines: false }];
  ws.pageSetup.printTitlesRow = `${DAILY_HEADER_ROW}:${DAILY_HEADER_ROW}`;
  return { totalRow: tr };
}

// ---------------------------------------------------------------------
// แผ่น "ผู้รับบริการ"
// ---------------------------------------------------------------------
const PEOPLE_HEADER_ROW = 5;
function buildPeopleSheet(wb, bookings, rows, opts, head) {
  const ws = baseSheet(wb, SHEET.people, { landscape: true, tabColor: C.turmericInk });
  const cols = [
    { h: 'ลำดับ', w: 6, align: 'center' },
    { h: 'ชื่อ-นามสกุล', w: 24 },
    { h: 'เลขบัตรประชาชน', w: 19, align: 'center' },
    { h: 'HN', w: 11, align: 'center' },
    { h: 'ประเภท', w: 14, align: 'center' },
    { h: 'เบอร์โทร', w: 13, align: 'center' },
    { h: 'จองทั้งหมด', w: 10, align: 'center', fmt: FMT.int },
    { h: 'เสร็จสิ้น', w: 9, align: 'center', fmt: FMT.int },
    { h: 'ไม่มาตามนัด', w: 11, align: 'center', fmt: FMT.int },
    { h: 'ยกเลิก', w: 8, align: 'center', fmt: FMT.int },
    { h: 'มาครั้งล่าสุด', w: 14, align: 'center', fmt: FMT.dateZeroDash },
    { h: 'patient_id', w: 8, hidden: true },
  ];
  const PID = colLetter(cols.length);
  titleBlock(ws, cols.length - 1, { ...head, title: opts.practitionerName ? `ผู้รับบริการของ ${opts.practitionerName}` : 'สรุปรายผู้รับบริการ' });
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.w;
    if (c.hidden) col.hidden = true;
  });
  headerRow(ws, PEOPLE_HEADER_ROW, cols.map((c) => c.h));
  ws.getRow(PEOPLE_HEADER_ROW).height = 36;

  // ผู้รับบริการไม่ซ้ำ เรียงจากจองมากไปน้อย แล้วตามชื่อ
  const byId = new Map();
  for (const b of bookings) {
    const p = byId.get(b.patient_id) ?? { ...b, n: 0 };
    p.n += 1;
    byId.set(b.patient_id, p);
  }
  const people = [...byId.values()].sort((a, b) => b.n - a.n || `${a.first_name}`.localeCompare(`${b.first_name}`, 'th'));

  const idR = listRange(rows, 'pid');
  const sR = listRange(rows, 'status');
  const dR = listRange(rows, 'date');
  people.forEach((p, i) => {
    const r = PEOPLE_HEADER_ROW + 1 + i;
    const k = `${PID}${r}`;
    const values = [
      i + 1,
      `${p.first_name} ${p.last_name}`,
      nidText(p, opts.maskPhone),
      p.hn || '-',
      PATIENT_TYPE_TH[p.patient_type] ?? p.patient_type,
      opts.maskPhone ? maskPhone(p.phone_number) : p.phone_number,
      { formula: `COUNTIFS(${idR},${k})` },
      { formula: `COUNTIFS(${idR},${k},${sR},"${DONE}")` },
      { formula: `COUNTIFS(${idR},${k},${sR},"${STATUS_TH.NO_SHOW}")` },
      { formula: `COUNTIFS(${idR},${k},${sR},"${STATUS_TH.CANCELLED}")` },
      { formula: `_xlfn.MAXIFS(${dR},${idR},${k},${sR},"${DONE}")` },
      Number(p.patient_id),
    ];
    const row = ws.getRow(r);
    values.forEach((v, ci) => {
      const cell = row.getCell(ci + 1);
      cell.value = v;
      bodyCell(cell, i, { align: cols[ci].align, numFmt: cols[ci].fmt });
    });
    row.getCell(9).font = { name: FONT, size: 10, bold: true, color: { argb: C.roseInk } }; // ไม่มาตามนัด = สีแดง
    row.height = 21;
  });
  if (!people.length) {
    ws.mergeCells(PEOPLE_HEADER_ROW + 1, 1, PEOPLE_HEADER_ROW + 1, cols.length - 1);
    Object.assign(ws.getCell(PEOPLE_HEADER_ROW + 1, 1), {
      value: 'ไม่มีข้อมูล', font: { name: FONT, size: 10, italic: true, color: { argb: C.faint } }, alignment: { horizontal: 'center' },
    });
  }
  const last = PEOPLE_HEADER_ROW + Math.max(people.length, 1);
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: PEOPLE_HEADER_ROW, showGridLines: false }];
  ws.autoFilter = { from: { row: PEOPLE_HEADER_ROW, column: 1 }, to: { row: last, column: cols.length - 1 } };
  return { first: PEOPLE_HEADER_ROW + 1, last, count: people.length };
}

// ---------------------------------------------------------------------
// แผ่น "สรุป" — 3 กลุ่มคอลัมน์ (A–C, E–G, I–K) คั่นด้วยคอลัมน์แคบ D, H
// ---------------------------------------------------------------------
const GROUPS = [1, 5, 9]; // คอลัมน์แรกของแต่ละกลุ่ม

function buildSummarySheet(ws, rows, daily, people, lists, head, { filtered }) {
  ws.pageSetup.fitToHeight = 1; // สรุปพิมพ์จบในหน้าเดียว
  [19, 11, 12, 3, 19, 11, 12, 3, 19, 11, 12].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  titleBlock(ws, 11, { ...head, title: head.reportTitle });

  const sR = listRange(rows, 'status');
  const codeR = listRange(rows, 'code');
  const cnt = (s) => `COUNTIF(${sR},"${STATUS_TH[s]}")`;
  const peopleRange = ref(SHEET.people, `$B$${people.first}:$B$${people.last}`);

  /** การ์ดตัวเลข 3 คอลัมน์: หัวข้อ / ตัวเลขใหญ่ / คำอธิบาย */
  const card = (row, col, label, formula, sub, { numFmt = FMT.int, accent = C.herb, bg = C.leafSoft } = {}) => {
    for (let r = row; r <= row + 2; r++) ws.mergeCells(r, col, r, col + 2);
    const box = [ws.getCell(row, col), ws.getCell(row + 1, col), ws.getCell(row + 2, col)];
    box[0].value = label;
    box[0].font = { name: FONT, size: 10, bold: true, color: { argb: C.muted } };
    box[1].value = formula === null ? '-' : { formula }; // null = ไม่คำนวณ (แสดงขีด)
    box[1].numFmt = numFmt;
    box[1].font = { name: FONT, size: 22, bold: true, color: { argb: accent } };
    box[2].value = sub;
    box[2].font = { name: FONT, size: 8.5, color: { argb: C.faint } };
    for (let r = row; r <= row + 2; r++) {
      for (let c = col; c <= col + 2; c++) {
        const cell = ws.getCell(r, c);
        cell.fill = fill(bg);
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
        cell.border = { left: c === col ? { style: 'thick', color: { argb: accent } } : undefined };
      }
    }
    ws.getRow(row).height = 22;
    ws.getRow(row + 1).height = 34;
    ws.getRow(row + 2).height = 18;
  };

  const rose = { accent: C.roseInk, bg: C.roseSoft };
  const clay = { accent: C.clay, bg: C.sand };
  const gold = { accent: C.turmericInk, bg: C.turmericSoft };
  const sky = { accent: C.skyInk, bg: C.skySoft };
  // แถว 1: จำนวน
  card(5, GROUPS[0], 'คิวทั้งหมด', `COUNTA(${codeR})`, 'ทุกสถานะในช่วงวันที่');
  card(5, GROUPS[1], 'เสร็จสิ้น', cnt('COMPLETED'), 'นวดเสร็จแล้ว');
  card(5, GROUPS[2], 'ไม่มาตามนัด', cnt('NO_SHOW'), 'ไม่มาและไม่ได้ยกเลิก', rose);
  // แถว 2: อัตรา
  card(9, GROUPS[0], 'ยกเลิก', cnt('CANCELLED'), 'ผู้จอง / เจ้าหน้าที่ / ระบบ', clay);
  card(9, GROUPS[1], 'อัตรามาตามนัด', `IFERROR(${cnt('COMPLETED')}/(${cnt('COMPLETED')}+${cnt('NO_SHOW')}),0)`, 'เสร็จสิ้น ÷ (เสร็จสิ้น + ไม่มา)', { numFmt: FMT.pct });
  card(9, GROUPS[2], 'อัตราการใช้รอบ',
    filtered ? null : `IF(ISNUMBER(${ref(SHEET.daily, `I${daily.totalRow}`)}),${ref(SHEET.daily, `I${daily.totalRow}`)},0)`,
    filtered ? 'ไม่คำนวณเมื่อกรองหมอนวด' : 'คิวที่ไม่ยกเลิก ÷ ที่ที่เปิดรับ', { numFmt: FMT.pct });
  // แถว 3: คิวค้าง / เวลา / คน
  card(13, GROUPS[0], 'รอรับบริการ', `${cnt('BOOKED')}+${cnt('CHECKED_IN')}+${cnt('IN_SERVICE')}`, 'จองไว้ / มาถึงแล้ว / กำลังนวด', gold);
  card(13, GROUPS[1], 'เวลานวดเฉลี่ย', `IFERROR(ROUND(AVERAGE(${listRange(rows, 'minutes')}),0),0)`, 'เฉพาะคิวที่บันทึกเวลาครบ', { numFmt: FMT.min, ...gold });
  card(13, GROUPS[2], 'ผู้รับบริการ', `COUNTA(${peopleRange})-COUNTIF(${peopleRange},"ไม่มีข้อมูล")`, 'จำนวนคน (ไม่นับซ้ำ)', sky);

  /** ตารางย่อย 3 คอลัมน์: รายการ / จำนวน / สัดส่วน — third = 'done' นับเฉพาะคิวที่นวดเสร็จ */
  const miniTable = (top, col, title, items, { key, third = 'pct' }) => {
    ws.mergeCells(top, col, top, col + 2);
    Object.assign(ws.getCell(top, col), { value: title, font: { name: FONT, size: 11, bold: true, color: { argb: C.herbDark } } });
    ws.getRow(top).height = 22;
    const hr = top + 1;
    ['รายการ', third === 'done' ? 'คิวเสร็จสิ้น' : 'จำนวน', 'สัดส่วน'].forEach((h, i) => {
      const cell = ws.getCell(hr, col + i);
      cell.value = h;
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: C.white } };
      cell.fill = fill(C.herb);
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = allBorders(C.herbDark);
    });
    const range = listRange(rows, key);
    const L2 = colLetter(col + 1);
    const tr = hr + 1 + items.length;
    items.forEach(([label, match], i) => {
      const r = hr + 1 + i;
      const [a, b, c] = [ws.getCell(r, col), ws.getCell(r, col + 1), ws.getCell(r, col + 2)];
      a.value = label;
      b.value = third === 'done'
        ? { formula: `COUNTIFS(${range},"${match}",${sR},"${DONE}")` }
        : { formula: `COUNTIF(${range},"${match}")` };
      c.value = { formula: `IFERROR(${L2}${r}/${L2}${tr},0)` };
      bodyCell(a, i);
      bodyCell(b, i, { align: 'center', numFmt: FMT.int });
      bodyCell(c, i, { align: 'center', numFmt: FMT.pct });
      ws.getRow(r).height = 21;
    });
    ws.getCell(tr, col).value = 'รวม';
    // ไม่มีรายการ (เช่น ช่วงวันที่ไม่มีการจอง) → ใส่ 0 ตรง ๆ ไม่งั้น SUM จะอ้างถึงตัวเอง (circular reference)
    ws.getCell(tr, col + 1).value = items.length ? { formula: `SUM(${L2}${hr + 1}:${L2}${tr - 1})` } : 0;
    ws.getCell(tr, col + 2).value = items.length ? { formula: `IF(${L2}${tr}>0,1,0)` } : 0;
    totalCell(ws.getCell(tr, col), { align: 'left' });
    totalCell(ws.getCell(tr, col + 1), { align: 'center', numFmt: FMT.int });
    totalCell(ws.getCell(tr, col + 2), { align: 'center', numFmt: FMT.pct });
    return tr;
  };

  let top = 17;
  const t1 = miniTable(top, GROUPS[0], 'แยกตามสถานะ', STATUS_ORDER.map((s) => [STATUS_TH[s], STATUS_TH[s]]), { key: 'status' });
  const t2 = miniTable(top, GROUPS[1], 'แยกตามช่องทางการจอง', Object.values(CHANNEL_TH).map((th) => [th, th]), { key: 'channel' });
  const t3 = lists.slots.length ? miniTable(top, GROUPS[2], 'แยกตามรอบเวลา', lists.slots.map((t) => [t, t]), { key: 'slot' }) : top;
  top = Math.max(t1, t2, t3) + 2;
  const t4 = miniTable(top, GROUPS[0], 'แยกตามประเภทบริการ', lists.services.map((n) => [n, n]), { key: 'service', third: 'done' });
  // หมอนวด: ช่องว่าง = คิวที่ยังไม่มีคนรับ / คิวเก่าก่อนมีระบบบันทึกหมอนวด
  const t5 = miniTable(top, GROUPS[1], 'แยกตามหมอนวด', lists.practitioners.map((n) => [n || '(ไม่ระบุ)', n || '']), { key: 'pract', third: 'done' });

  const nr = Math.max(t4, t5) + 2;
  ws.mergeCells(nr, 1, nr, 11);
  Object.assign(ws.getCell(nr, 1), { value: 'คำอธิบาย', font: { name: FONT, size: 10, bold: true, color: { argb: C.muted } } });
  [
    '• ตัวเลขทุกช่องในแผ่นนี้คำนวณด้วยสูตรจากแผ่น "รายการจอง" — ถ้าแก้ไขหรือกรองข้อมูลในแผ่นนั้น ตัวเลขจะเปลี่ยนตาม',
    '• อัตรามาตามนัด = เสร็จสิ้น ÷ (เสร็จสิ้น + ไม่มาตามนัด) ไม่นับคิวที่ยกเลิกล่วงหน้าและคิวที่ยังไม่ถึงเวลา',
    '• อัตราการใช้รอบ = คิวที่ไม่ได้ยกเลิก ÷ จำนวนที่ที่เปิดรับ (เตียง × รอบ ไม่นับที่ปิดรับ) ดูรายวันได้ในแผ่น "รายวัน"',
    '• ราคาในแผ่น "รายการจอง" คือราคาของประเภทบริการ ณ วันที่จอง (ไม่ใช่ยอดชำระจริง)',
    '• ไฟล์นี้มีข้อมูลส่วนบุคคล (รวมเลขบัตรประชาชน) ของผู้รับบริการ — ใช้ภายในหน่วยงานเท่านั้น ห้ามส่งต่อ (PDPA)',
  ].forEach((t, i) => {
    ws.mergeCells(nr + 1 + i, 1, nr + 1 + i, 11);
    Object.assign(ws.getCell(nr + 1 + i, 1), { value: t, font: { name: FONT, size: 9, color: { argb: C.muted } }, alignment: { wrapText: true, vertical: 'top' } });
    ws.getRow(nr + 1 + i).height = 18;
  });
}

// ---------------------------------------------------------------------
// สร้างไฟล์
// ---------------------------------------------------------------------
/**
 * @param {{from: string, to: string, maskPhone?: boolean, practitionerId?: number, generatedBy?: string}} opts วันที่ YYYY-MM-DD
 * @returns {Promise<{workbook: ExcelJS.Workbook, filename: string, count: number}>}
 */
export async function buildBookingReport({ from, to, maskPhone: mask = false, practitionerId = null, generatedBy = '' }) {
  const [{ bookings, days }, clinic, pr] = await Promise.all([
    loadData(from, to, practitionerId),
    getSetting('clinic_name'),
    practitionerId ? queryOne('SELECT full_name FROM practitioners WHERE practitioner_id = ?', [practitionerId]) : null,
  ]);
  const practitionerName = pr?.full_name ?? null;
  const now = new Date();
  const nowText = new Intl.DateTimeFormat('th-TH', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(now);
  const head = {
    clinic: clinic || 'คลินิกแพทย์แผนไทย',
    rangeText: `${from === to ? `วันที่ ${thaiDateText(from)}` : `${thaiDateText(from)} – ${thaiDateText(to)}`}${practitionerName ? `  ·  หมอนวด: ${practitionerName}` : ''}`,
    generatedText: `ออกรายงานเมื่อ ${nowText} น.${generatedBy ? `  โดย ${generatedBy}` : ''}${mask ? '  ·  ปิดบังเบอร์โทร/เลขบัตร' : ''}`,
    reportTitle: practitionerName ? `รายงานการนวดของ ${practitionerName}` : 'รายงานการจองคิวนวดแผนไทย',
  };

  const wb = new ExcelJS.Workbook();
  wb.creator = 'ระบบจองคิวนวดแผนไทย';
  wb.created = now;
  wb.calcProperties = { fullCalcOnLoad: true }; // ให้ Excel คำนวณสูตรใหม่ตอนเปิดแก้ไข (ผลที่ฝังไว้ใช้แสดงก่อนกด Enable Editing)

  // ลำดับแผ่น = ลำดับที่สร้าง: สรุป → รายวัน → รายการจอง → ผู้รับบริการ
  // สรุปสร้างก่อนแต่เติมทีหลัง เพราะสูตรต้องรู้แถวของแผ่นอื่น
  const summary = baseSheet(wb, SHEET.summary, { landscape: true, tabColor: C.herbDark });
  const opts = { maskPhone: mask, practitionerName };
  const filtered = !!practitionerId;
  // สูตรใน "รายวัน" อ้างแถวของ "รายการจอง" → คำนวณช่วงแถวไว้ก่อน (ต้องตรงกับที่ buildListSheet เขียนจริง)
  const rows = { first: LIST_HEADER_ROW + 1, last: LIST_HEADER_ROW + Math.max(bookings.length, 1) };
  const dailyInfo = buildDailySheet(wb, days, rows, head, { filtered });
  const listRows = buildListSheet(wb, bookings, opts, head);
  if (listRows.first !== rows.first || listRows.last !== rows.last) throw new Error('report: ช่วงแถวรายการจองไม่ตรงกัน');
  const people = buildPeopleSheet(wb, bookings, rows, opts, head);

  const uniq = (arr) => [...new Set(arr)];
  const lists = {
    slots: uniq(bookings.map((b) => `${hhmm(b.start_time)}–${hhmm(b.end_time)}`)).sort((a, b) => a.localeCompare(b)),
    services: uniq(bookings.map((b) => b.service_name || '-')),
    // คิวที่นวดเสร็จแต่ไม่มีชื่อหมอนวด → แถว "(ไม่ระบุ)"
    practitioners: uniq(bookings.filter((b) => b.status === 'COMPLETED' || b.practitioner_name).map((b) => b.practitioner_name || '')),
  };
  buildSummarySheet(summary, rows, dailyInfo, people, lists, head, { filtered });
  // ฝังผลลัพธ์ของสูตรไว้ในไฟล์ — เปิดใน Protected View / preview ก็เห็นตัวเลขทันที
  embedFormulaResults(wb);

  const filename = `${practitionerName ? `รายงานหมอนวด_${practitionerName.replace(/[\\/:*?"<>|\s]+/g, '-')}` : 'รายงานการจอง'}_${from}${from === to ? '' : `_ถึง_${to}`}.xlsx`;
  return { workbook: wb, filename, count: bookings.length };
}
