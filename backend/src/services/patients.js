import { conflict } from '../utils/errors.js';

/**
 * หา/สร้างผู้รับบริการจากข้อมูลที่กรอก (ใช้ใน transaction)
 * - มี HN: ถ้า HN มีอยู่แล้วต้องชื่อ-สกุลตรงกัน → ใช้ record เดิม (กันคนอื่นพิมพ์ HN มั่ว)
 * - ไม่มี HN: ชื่อ-สกุล + เบอร์ตรงกัน → ใช้ record เดิม, ไม่ตรง → สร้างใหม่
 */
export async function findOrCreatePatient(conn, input) {
  const { first_name, last_name, phone_number, hn } = input;

  if (hn) {
    const [[byHn]] = await conn.query('SELECT * FROM patients WHERE hn = ? FOR UPDATE', [hn]);
    if (byHn) {
      if (norm(byHn.first_name) !== norm(first_name) || norm(byHn.last_name) !== norm(last_name)) {
        throw conflict('HN_MISMATCH', 'HN นี้มีในระบบแล้ว แต่ชื่อ-นามสกุลไม่ตรงกัน กรุณาตรวจสอบหรือติดต่อเคาน์เตอร์');
      }
      if (byHn.is_deleted) await conn.query('UPDATE patients SET is_deleted = FALSE WHERE patient_id = ?', [byHn.patient_id]);
      if (byHn.phone_number !== phone_number) {
        await conn.query('UPDATE patients SET phone_number = ? WHERE patient_id = ?', [phone_number, byHn.patient_id]);
      }
      return byHn.patient_id;
    }
    const [res] = await conn.query(
      `INSERT INTO patients (patient_type, hn, first_name, last_name, phone_number) VALUES ('HN', ?, ?, ?, ?)`,
      [hn, first_name, last_name, phone_number],
    );
    return res.insertId;
  }

  const [[same]] = await conn.query(
    `SELECT patient_id FROM patients
      WHERE patient_type = 'GENERAL' AND is_deleted = FALSE AND phone_number = ? AND first_name = ? AND last_name = ?
      LIMIT 1`,
    [phone_number, first_name, last_name],
  );
  if (same) return same.patient_id;
  const [res] = await conn.query(
    `INSERT INTO patients (patient_type, hn, first_name, last_name, phone_number) VALUES ('GENERAL', NULL, ?, ?, ?)`,
    [first_name, last_name, phone_number],
  );
  return res.insertId;
}

const norm = (s) => String(s).replace(/\s+/g, '').toLowerCase();
