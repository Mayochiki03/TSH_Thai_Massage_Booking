/**
 * db.js — การเชื่อมต่อ MariaDB / MySQL (connection pool — ใช้ driver mysql2 ได้ทั้งคู่) + ตัวช่วย query / transaction
 *  - ทุก connection ตั้ง time_zone = +07:00 → NOW()/CURDATE() เป็นเวลาไทยเสมอ
 *  - dateStrings: วันที่/เวลาคืนเป็น string ('2026-10-07', '09:00:00') ไม่แปลงเป็น JS Date (กันเวลาเพี้ยน)
 */
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import { config } from './config.js';

export const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
  // ต้องตรงกับ collation ของฐานข้อมูล (00_create_database.sql) — ไม่งั้นเทียบข้อความกับ view จะ error "Illegal mix of collations"
  // utf8mb4_unicode_ci มีทั้งใน MariaDB และ MySQL (utf8mb4_0900_ai_ci มีแค่ MySQL 8)
  charset: 'UTF8MB4_UNICODE_CI',
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
export async function withTx(fn, { retries = 3 } = {}) {
  for (let attempt = 1; ; attempt++) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback().catch(() => {});
      // deadlock: ฐานข้อมูลยกเลิก transaction หนึ่งเมื่อมีหลาย request ล็อกชนกัน (เช่น ลงทะเบียนคนใหม่พร้อมกัน)
      // → ทำทั้ง transaction ใหม่ (ทุกอย่างใน fn อยู่ใน DB จึงทำซ้ำได้ปลอดภัย)
      if (err?.code === 'ER_LOCK_DEADLOCK' && attempt < retries) {
        await new Promise((r) => setTimeout(r, 20 + crypto.randomInt(60) * attempt));
        continue;
      }
      throw err;
    } finally {
      conn.release();
    }
  }
}
