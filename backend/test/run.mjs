/**
 * test/run.mjs — รัน test ทั้งชุดของ backend (integration: ยิง API จริงกับฐานข้อมูลทดสอบ)
 *
 *   npm test                  รันทุกชุด
 *   npm run test:coverage     รันทุกชุด + วัด coverage → coverage/lcov.info (ส่งให้ SonarQube)
 *   node test/run.mjs mfa     รันเฉพาะชุดที่ชื่อมีคำว่า mfa
 *
 * ทุกชุด: ล้างฐานข้อมูลทดสอบ → สร้างใหม่จาก database/01–04 → เปิด backend (พอร์ตทดสอบ) → ยิง API → ปิด
 * ตั้งค่าการเชื่อมต่อใน backend/.env.test (ดูตัวอย่าง .env.test.example)
 * ⚠ ชื่อฐานข้อมูลต้องลงท้ายด้วย _test เท่านั้น — กันล้างฐานข้อมูลที่ใช้งานจริง
 */
import fs from 'node:fs';
import path from 'node:path';
import { fork, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { resetDb } from './lib/resetDb.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(here, '..');
const databaseDir = path.resolve(backendDir, '../database');
const logDir = path.join(here, '.logs');

const SUITES = [
  { name: 'booking', file: 'booking.test.mjs', mfaRoles: '' },        // จอง/ยกเลิก/เช็กอิน/kiosk/วันหยุด/ผู้ใช้
  { name: 'features', file: 'features.test.mjs', mfaRoles: '' },      // หลายเตียง/บริการ/เลขบัตร/หมอนวด/รายงาน
  { name: 'price', file: 'price.test.mjs', mfaRoles: '' },            // สวิตช์แสดงราคา
  { name: 'mfa', file: 'mfa.test.mjs', mfaRoles: 'DEV,ADMIN' },       // 2FA
];

// ---------------------------------------------------------------------
// ตั้งค่า
// ---------------------------------------------------------------------
function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}
const fileEnv = readEnvFile(path.join(backendDir, '.env.test'));
const env = (k, d) => process.env[k] ?? fileEnv[k] ?? d;

const db = {
  host: env('TEST_DB_HOST', '127.0.0.1'),
  port: Number(env('TEST_DB_PORT', '3306')),
  user: env('TEST_DB_USER', 'massage_test'),
  password: env('TEST_DB_PASSWORD', ''),
  database: env('TEST_DB_NAME', 'thai_massage_booking_test'),
};
const ports = { public: Number(env('TEST_PUBLIC_PORT', '4100')), internal: Number(env('TEST_INTERNAL_PORT', '4101')) };
const coverage = process.argv.includes('--coverage');
const filters = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const covTmp = path.join(backendDir, 'coverage', '.v8');

// ---------------------------------------------------------------------
// เปิด / ปิด backend
// ---------------------------------------------------------------------
function startServer(suite) {
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `server-${suite.name}.log`);
  const log = fs.openSync(logFile, 'w');
  const child = fork(path.join(backendDir, 'src/index.js'), [], {
    cwd: backendDir,
    stdio: ['ignore', log, log, 'ipc'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_HOST: db.host, DB_PORT: String(db.port), DB_USER: db.user, DB_PASSWORD: db.password, DB_NAME: db.database,
      PUBLIC_HOST: '127.0.0.1', PUBLIC_PORT: String(ports.public),
      INTERNAL_HOST: '127.0.0.1', INTERNAL_PORT: String(ports.internal),
      // ค่าลับสำหรับ test เท่านั้น (ไม่ใช้ค่าจาก .env ของเครื่อง)
      JWT_SECRET: 'test_only_jwt_secret_0123456789abcdef0123456789abcdef',
      APP_SECRET_KEY: '1111111111111111111111111111111111111111111111111111111111111111',
      MFA_REQUIRED_ROLES: suite.mfaRoles,
      ENABLE_CRON: 'false',
      ...(coverage && { NODE_V8_COVERAGE: covTmp }),
    },
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`backend ไม่ขึ้นภายใน 30 วินาที — ดู ${logFile}`)), 30_000);
    child.on('message', (m) => { if (m === 'ready') { clearTimeout(timer); resolve(child); } });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`backend ปิดตัว (code ${code}) — ดู ${logFile}`)); });
  }).finally(() => fs.closeSync(log));
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.removeAllListeners('exit');
    child.on('exit', () => resolve());
    child.send('shutdown');
    setTimeout(() => { child.kill(); resolve(); }, 10_000).unref();
  });
}

function runSuite(suite) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(here, 'suites', suite.file)], {
      cwd: backendDir,
      env: {
        ...process.env,
        TEST_PUBLIC_URL: `http://127.0.0.1:${ports.public}`,
        TEST_INTERNAL_URL: `http://127.0.0.1:${ports.internal}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const onData = (d) => {
      const s = d.toString();
      out += s;
      for (const line of s.split('\n')) if (/^(FAIL|SKIP)/.test(line)) console.log(`   ${line}`);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (d) => { out += d; process.stderr.write(d); });
    child.on('exit', (code) => {
      const m = out.match(/(\d+) passed, (\d+) failed(?:, (\d+) skipped)?/);
      resolve({ code, pass: m ? Number(m[1]) : 0, fail: m ? Number(m[2]) : 1, skip: m?.[3] ? Number(m[3]) : 0 });
    });
  });
}

/** ปรับฐานข้อมูลก่อนรัน: วันศุกร์ "วันทำการถัดไป" คือวันจันทร์ → ขยายช่วงจองล่วงหน้าให้ถึง */
async function prepare() {
  const conn = await mysql.createConnection({ ...db, charset: 'UTF8MB4_UNICODE_CI' });
  try {
    await conn.query("UPDATE settings SET setting_value = '4' WHERE setting_key = 'advance_booking_days'");
  } finally {
    await conn.end();
  }
}

// ---------------------------------------------------------------------
async function main() {
  const suites = SUITES.filter((s) => !filters.length || filters.some((f) => s.name.includes(f)));
  console.log(`ฐานข้อมูลทดสอบ: ${db.user}@${db.host}:${db.port}/${db.database} · พอร์ตทดสอบ ${ports.public}/${ports.internal}${coverage ? ' · วัด coverage' : ''}\n`);
  if (coverage) fs.rmSync(path.join(backendDir, 'coverage'), { recursive: true, force: true });

  const total = { pass: 0, fail: 0, skip: 0 };
  for (const suite of suites) {
    const t0 = Date.now();
    console.log(`▶ ${suite.name}`);
    await resetDb(db, databaseDir);
    await prepare();
    const server = await startServer(suite);
    let r;
    try {
      r = await runSuite(suite);
    } finally {
      await stopServer(server);
    }
    total.pass += r.pass; total.fail += r.fail; total.skip += r.skip;
    console.log(`  ${r.fail ? '✗' : '✓'} ${r.pass} ผ่าน, ${r.fail} ไม่ผ่าน${r.skip ? `, ${r.skip} ข้าม` : ''}  (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
  }

  console.log(`รวม: ${total.pass} ผ่าน, ${total.fail} ไม่ผ่าน${total.skip ? `, ${total.skip} ข้าม` : ''}`);
  if (total.fail) console.log(`log ของ backend: ${logDir}`);

  if (coverage) {
    const c8 = path.join(backendDir, 'node_modules', 'c8', 'bin', 'c8.js');
    await new Promise((resolve) => {
      spawn(process.execPath, [c8, 'report', '--temp-directory', covTmp, '--report-dir', 'coverage',
        '--reporter', 'lcov', '--reporter', 'text-summary', '--include', 'src/**', '--all', '--src', 'src'],
      { cwd: backendDir, stdio: 'inherit' }).on('exit', resolve);
    });
    // SonarQube สแกนจากโฟลเดอร์บนสุดของ repo → path ใน lcov ต้องเป็น backend/src/... (c8 เขียนเป็น src/...)
    const lcov = path.join(backendDir, 'coverage', 'lcov.info');
    if (fs.existsSync(lcov)) {
      fs.writeFileSync(lcov, fs.readFileSync(lcov, 'utf8').replace(/^SF:(?:\.[\\/])?src([\\/])/gm, 'SF:backend/src$1'));
      console.log('\nbackend/coverage/lcov.info พร้อมส่งให้ SonarQube');
    }
  }
  process.exitCode = total.fail ? 1 : 0;
}

main().catch((err) => {
  console.error(`\nรัน test ไม่สำเร็จ: ${err.message}`);
  if (err.code === 'ECONNREFUSED') console.error('→ ต่อฐานข้อมูลไม่ได้ ตรวจ TEST_DB_HOST / TEST_DB_PORT ใน backend/.env.test');
  if (err.code === 'ER_ACCESS_DENIED_ERROR' || err.code === 'ER_DBACCESS_DENIED_ERROR') {
    console.error('→ user ทดสอบไม่มีสิทธิ์ — สร้างด้วย database/setup_test_user.sql (ดู docs/INSTALL.md หัวข้อ จ.)');
  }
  process.exitCode = 1;
});
