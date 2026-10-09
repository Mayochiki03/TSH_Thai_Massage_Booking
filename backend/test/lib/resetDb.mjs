/**
 * test/lib/resetDb.mjs — ล้างแล้วสร้างฐานข้อมูลทดสอบใหม่จากสคริปต์ใน database/ (01 → 04)
 *
 *  - ใช้ driver mysql2 ตรง ๆ (ไม่ต้องมีโปรแกรม mariadb/mysql ใน PATH → ใช้ได้ทั้ง Windows และ Linux)
 *  - แทนชื่อฐานข้อมูล thai_massage_booking ในสคริปต์ด้วยชื่อฐานข้อมูลทดสอบ
 *  - รองรับ DELIMITER $$ ... $$ ใน 02_procedures.sql
 *  - ไม่รัน 00_create_database.sql (สร้าง user ของแอปจริง ไม่เกี่ยวกับ test)
 */
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';

const SQL_FILES = ['01_schema.sql', '02_procedures.sql', '03_seed.sql', '04_dev_sample.sql'];

/** แยกสคริปต์เป็นชุดคำสั่งตาม DELIMITER — คืน [{ sql, multi }] */
function splitByDelimiter(text) {
  const out = [];
  let delim = ';';
  let buf = [];
  const flush = () => {
    const sql = buf.join('\n').trim();
    if (sql) out.push({ sql, multi: delim === ';' });
    buf = [];
  };
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (m) { flush(); delim = m[1]; continue; }
    if (delim !== ';' && line.trim().endsWith(delim)) {
      buf.push(line.trim().slice(0, -delim.length));
      flush();
      continue;
    }
    buf.push(line);
  }
  flush();
  return out;
}

/**
 * @param {{host:string, port:number, user:string, password:string, database:string}} db
 * @param {string} databaseDir โฟลเดอร์ database/ ของโปรเจกต์
 */
export async function resetDb(db, databaseDir) {
  if (!/_test$/.test(db.database)) {
    throw new Error(`ชื่อฐานข้อมูลทดสอบต้องลงท้ายด้วย _test (ได้ "${db.database}") — กันล้างฐานข้อมูลจริงโดยไม่ตั้งใจ`);
  }
  const conn = await mysql.createConnection({
    host: db.host, port: db.port, user: db.user, password: db.password,
    multipleStatements: true, charset: 'UTF8MB4_UNICODE_CI',
  });
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${db.database}\``);
    await conn.query(`CREATE DATABASE \`${db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    for (const file of SQL_FILES) {
      const raw = fs.readFileSync(path.join(databaseDir, file), 'utf8')
        .replace(/\bthai_massage_booking\b(?!_)/g, db.database);
      for (const { sql } of splitByDelimiter(raw)) {
        try {
          await conn.query(sql);
        } catch (err) {
          err.message = `[${file}] ${err.message}`;
          throw err;
        }
      }
    }
  } finally {
    await conn.end();
  }
}
