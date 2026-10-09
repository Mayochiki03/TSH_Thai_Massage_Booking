/**
 * utils/xlsxResults.js — คำนวณผลของสูตรทุกช่องแล้วฝังไว้ในไฟล์ Excel ล่วงหน้า
 *
 * ทำไม: ไฟล์ที่ดาวน์โหลดจากเว็บ Excel เปิดใน "Protected View" ซึ่งไม่คำนวณสูตร
 *       (รวมถึง preview ในแอป LINE / มือถือ / อีเมล) → ถ้าไม่มีผลลัพธ์ฝังไว้ ช่องสูตรจะว่างหรือเป็น 0
 * วิธี: ส่งค่าทุกช่องของทุกแผ่นให้ HyperFormula คำนวณ แล้วเขียนกลับเป็น { formula, result }
 *       สูตรยังอยู่ครบ — กด Enable Editing แล้วแก้ข้อมูล ตัวเลขยังคำนวณใหม่ตามปกติ
 *
 * HyperFormula ใช้สัญญาอนุญาต GPLv3 (licenseKey 'gpl-v3') — ใช้ภายในหน่วยงานได้
 */
import { HyperFormula } from 'hyperformula';

const DAY_MS = 86_400_000;
const EXCEL_EPOCH_OFFSET = 25569; // จำนวนวันจาก 1899-12-30 ถึง 1970-01-01

/** Date (เก็บแบบ UTC ตาม xlDate) → เลขวันที่ของ Excel */
const toSerial = (d) => d.getTime() / DAY_MS + EXCEL_EPOCH_OFFSET;

const isMergedSlave = (cell) => cell.isMerged && cell.master && cell.master.address !== cell.address;

/** ค่าในช่อง exceljs → ค่าที่ HyperFormula เข้าใจ */
function toEngineValue(v) {
  if (v == null) return null;
  if (v instanceof Date) return toSerial(v);
  if (typeof v === 'object') {
    if ('formula' in v) return `=${String(v.formula).replace(/_xlfn\./g, '')}`;
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return v.text;
    if ('result' in v) return v.result ?? null;
    return null;
  }
  return v;
}

/**
 * @param {import('exceljs').Workbook} wb
 * @returns {number} จำนวนช่องสูตรที่ฝังผลแล้ว
 */
export function embedFormulaResults(wb) {
  const sheets = {};
  const formulaCells = [];

  wb.eachSheet((ws) => {
    const rows = [];
    ws.eachRow({ includeEmpty: true }, (row, r) => {
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        if (isMergedSlave(cell)) return; // ช่องที่ถูก merge ให้ช่องหลักเก็บค่าแทน
        const v = cell.value;
        (rows[r - 1] ??= [])[c - 1] = toEngineValue(v);
        if (v && typeof v === 'object' && 'formula' in v) formulaCells.push({ ws, cell, r, c });
      });
    });
    // HyperFormula ต้องการ array เต็ม (ไม่มีช่องโหว่)
    // (rows อาจมีช่องโหว่ — Array.from เติมเป็น undefined ก่อน ไม่งั้น map ข้ามแล้ว Math.max ได้ NaN)
    const width = Math.max(0, ...Array.from(rows, (x) => x?.length ?? 0));
    sheets[ws.name] = Array.from({ length: rows.length }, (_, i) =>
      Array.from({ length: width }, (_, j) => rows[i]?.[j] ?? null));
  });

  if (!formulaCells.length) return 0;
  const hf = HyperFormula.buildFromSheets(sheets, { licenseKey: 'gpl-v3' });
  try {
    for (const { ws, cell, r, c } of formulaCells) {
      const value = hf.getCellValue({ sheet: hf.getSheetId(ws.name), row: r - 1, col: c - 1 });
      // error (#DIV/0! ฯลฯ) → ไม่ใส่ผล ให้ Excel คำนวณเองตอนเปิดแก้ไข
      if (value != null && typeof value === 'object') continue;
      cell.value = { formula: cell.value.formula, result: value ?? '' };
    }
  } finally {
    hf.destroy();
  }
  return formulaCells.length;
}
