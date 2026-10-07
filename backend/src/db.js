/**
 * db.js — การเชื่อมต่อ MySQL (connection pool) + ตัวช่วย query / transaction
 *  - ทุก connection ตั้ง time_zone = +07:00 → NOW()/CURDATE() เป็นเวลาไทยเสมอ
 *  - dateStrings: วันที่/เวลาคืนเป็น string ('2026-10-07', '09:00:00') ไม่แปลงเป็น JS Date (กันเวลาเพี้ยน)
 */
import mysql from 'mysql2/promise';
import { config } from './config.js';

export const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  timezone: '+07:00',
  dateStrings: true, // DATE/TIME/TIMESTAMP คืนเป็น string ตามเวลาไทย (ไม่แปลงเป็น JS Date)
});

// ทุก connection ใช้เวลาไทย → NOW() / CURDATE() ตรงกับเวลาไทยเสมอ
pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+07:00'");
});

export async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

export async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] ?? null;
}

/** รันฟังก์ชันใน transaction — commit อัตโนมัติ, rollback เมื่อ throw */
export async function withTx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
