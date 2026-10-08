/**
 * services/patients.js — หา/สร้างผู้รับบริการ โดยไม่สร้างซ้ำ และกันการอ้างตัวตนของคนอื่น
 *
 * ลำดับการจับคู่ (ใช้ตัวที่น่าเชื่อถือที่สุดก่อน):
 *   1. เลขบัตรประชาชน  → มีแล้ว: ชื่อ-สกุลต้องตรง → ใช้ record เดิม (เช่น ลูกเพิ่มแม่ที่เคยลงทะเบียนที่ kiosk)
 *   2. HN              → มีแล้ว: ชื่อ-สกุลต้องตรง → ใช้ record เดิม (+ เติมเลขบัตรถ้ายังไม่มี)
 *   3. ชื่อ-สกุล + เบอร์ (บุคคลทั่วไป) → ใช้ record เดิมถ้าเลขบัตรไม่ขัดกัน
 *   4. ไม่ตรงอะไรเลย  → สร้างใหม่ (ต้องมีเลขบัตร หรือระบุว่าไม่มีบัตรไทย)
 *
 * เลขบัตรเป็นของ "ผู้รับบริการ" เสมอ (ลูกจองให้แม่ → เก็บเลขบัตรของแม่ใน record ของแม่)
 */
import { conflict, badRequest } from '../utils/errors.js';
import { protectThaiId, hashThaiId } from '../utils/nationalId.js';

const NID_REQUIRED_MSG = 'กรุณากรอกเลขบัตรประชาชน 13 หลักของผู้รับบริการ (หรือเลือก "ไม่มีบัตรประชาชนไทย")';
const norm = (s) => String(s).replace(/\s+/g, '').toLowerCase();
/** error 409 ที่ชี้ช่องที่ผิด (หน้าเว็บใช้ fields แสดงข้อความใต้ช่อง) */
const fieldConflict = (code, msg, field) => conflict(code, msg, { fields: { [field]: [msg] } });
const sameName = (row, input) => norm(row.first_name) === norm(input.first_name) && norm(row.last_name) === norm(input.last_name);

/**
 * หา/สร้างผู้รับบริการจากข้อมูลที่กรอก (ต้องเรียกใน transaction)
 * @param {import('mysql2/promise').PoolConnection} conn
 * @param {{first_name, last_name, phone_number, hn?, national_id?, no_national_id?}} input  (ผ่าน patientInput แล้ว)
 * @returns {Promise<number>} patient_id
 */
export async function findOrCreatePatient(conn, input) {
  const { first_name, last_name, phone_number, hn, national_id: nid } = input;

  // 1) เลขบัตรประชาชน
  if (nid) {
    const [[byNid]] = await conn.query('SELECT * FROM patients WHERE national_id_hash = ? FOR UPDATE', [hashThaiId(nid)]);
    if (byNid) {
      if (!sameName(byNid, input)) {
        throw fieldConflict('NID_MISMATCH', 'เลขบัตรประชาชนนี้มีในระบบแล้ว แต่ชื่อ-นามสกุลไม่ตรงกัน กรุณาตรวจสอบหรือติดต่อเคาน์เตอร์', 'national_id');
      }
      if (hn && byNid.hn && byNid.hn !== hn) {
        throw fieldConflict('HN_MISMATCH', 'HN ไม่ตรงกับข้อมูลเดิมของเลขบัตรนี้ กรุณาติดต่อเคาน์เตอร์', 'hn');
      }
      await conn.query(
        `UPDATE patients SET phone_number = ?, is_deleted = FALSE,
                hn = COALESCE(hn, ?), patient_type = IF(COALESCE(hn, ?) IS NULL, 'GENERAL', 'HN')
          WHERE patient_id = ?`,
        [phone_number, hn ?? null, hn ?? null, byNid.patient_id],
      );
      return byNid.patient_id;
    }
  }

  // 2) HN
  if (hn) {
    const [[byHn]] = await conn.query('SELECT * FROM patients WHERE hn = ? FOR UPDATE', [hn]);
    if (byHn) {
      if (!sameName(byHn, input)) {
        throw fieldConflict('HN_MISMATCH', 'HN นี้มีในระบบแล้ว แต่ชื่อ-นามสกุลไม่ตรงกัน กรุณาตรวจสอบหรือติดต่อเคาน์เตอร์', 'hn');
      }
      if (nid && byHn.national_id_hash && byHn.national_id_hash !== hashThaiId(nid)) {
        throw fieldConflict('NID_MISMATCH', 'เลขบัตรประชาชนไม่ตรงกับข้อมูลเดิมของ HN นี้ กรุณาติดต่อเคาน์เตอร์', 'national_id');
      }
      await conn.query('UPDATE patients SET phone_number = ?, is_deleted = FALSE WHERE patient_id = ?', [phone_number, byHn.patient_id]);
      await applyNationalId(conn, byHn.patient_id, input);
      return byHn.patient_id;
    }
  } else {
    // 3) บุคคลทั่วไป: ชื่อ-สกุล + เบอร์ตรง และเลขบัตรไม่ขัดกัน
    const [rows] = await conn.query(
      `SELECT * FROM patients
        WHERE patient_type = 'GENERAL' AND is_deleted = FALSE AND phone_number = ? AND first_name = ? AND last_name = ?
        ORDER BY national_id_hash IS NULL LIMIT 5 FOR UPDATE`,
      [phone_number, first_name, last_name],
    );
    const match = rows.find((r) => !nid || !r.national_id_hash || r.national_id_hash === hashThaiId(nid));
    if (match) {
      await applyNationalId(conn, match.patient_id, input);
      return match.patient_id;
    }
  }

  // 4) สร้างใหม่ — บังคับเลขบัตร
  if (!nid && !input.no_national_id) throw badRequest('NID_REQUIRED', NID_REQUIRED_MSG, { fields: { national_id: [NID_REQUIRED_MSG] } });
  const p = nid ? protectThaiId(nid) : { enc: null, hash: null, last4: null };
  const [res] = await conn.query(
    `INSERT INTO patients (patient_type, hn, first_name, last_name, phone_number,
                           national_id_enc, national_id_hash, national_id_last4, no_national_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [hn ? 'HN' : 'GENERAL', hn ?? null, first_name, last_name, phone_number, p.enc, p.hash, p.last4, !nid && !!input.no_national_id],
  );
  return res.insertId;
}

/**
 * ตั้ง/เติมเลขบัตรให้ผู้รับบริการที่มีอยู่แล้ว (ใช้ตอนจองให้คนเดิมที่ยังไม่เคยกรอก)
 *  - ส่งเลขบัตรมา: ถ้ายังไม่มี → บันทึก, ถ้ามีแล้วต้องตรงกัน (ไม่ให้เขียนทับ — แก้ได้ที่หน้าแอดมิน)
 *  - ส่ง no_national_id: บันทึกว่าไม่มีบัตรไทย (เฉพาะคนที่ยังไม่มีเลขบัตร)
 *  - เลขบัตรซ้ำกับคนอื่น → NID_TAKEN
 */
export async function applyNationalId(conn, patientId, { national_id: nid, no_national_id: none } = {}) {
  if (!nid && !none) return;
  const [[cur]] = await conn.query('SELECT national_id_hash FROM patients WHERE patient_id = ? FOR UPDATE', [patientId]);
  if (!cur) return;
  if (!nid) {
    if (!cur.national_id_hash) await conn.query('UPDATE patients SET no_national_id = TRUE WHERE patient_id = ?', [patientId]);
    return;
  }
  const p = protectThaiId(nid);
  if (cur.national_id_hash) {
    if (cur.national_id_hash !== p.hash) {
      throw fieldConflict('NID_MISMATCH', 'เลขบัตรประชาชนไม่ตรงกับที่เคยบันทึกไว้ กรุณาติดต่อเคาน์เตอร์', 'national_id');
    }
    return;
  }
  await setNationalId(conn, patientId, nid);
}

/** เขียนเลขบัตรลง record (เขียนทับได้ — ใช้โดยแอดมิน/applyNationalId) */
export async function setNationalId(conn, patientId, nid) {
  if (!nid) {
    await conn.query('UPDATE patients SET national_id_enc = NULL, national_id_hash = NULL, national_id_last4 = NULL WHERE patient_id = ?', [patientId]);
    return;
  }
  const p = protectThaiId(nid);
  try {
    await conn.query(
      'UPDATE patients SET national_id_enc = ?, national_id_hash = ?, national_id_last4 = ?, no_national_id = FALSE WHERE patient_id = ?',
      [p.enc, p.hash, p.last4, patientId],
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      throw fieldConflict('NID_TAKEN', 'เลขบัตรประชาชนนี้ลงทะเบียนกับผู้รับบริการคนอื่นแล้ว กรุณาติดต่อเคาน์เตอร์', 'national_id');
    }
    throw err;
  }
}

/** ผู้รับบริการคนนี้ผ่านเงื่อนไขเลขบัตรหรือยัง (มีเลขบัตร หรือระบุว่าไม่มีบัตรไทย) */
export const hasIdentity = (row) => !!(row?.national_id_hash || row?.has_national_id || row?.no_national_id);
export { NID_REQUIRED_MSG };
