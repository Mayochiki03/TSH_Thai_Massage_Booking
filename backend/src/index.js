/**
 * index.js — จุดเริ่มต้นของ backend
 *
 * เปิด 2 เซิร์ฟเวอร์แยกกัน:
 *   PUBLIC   (127.0.0.1:4000) — หน้าจอง + /api/public  → ส่งออกอินเทอร์เน็ตผ่าน Cloudflare Tunnel
 *   INTERNAL (0.0.0.0:4001)   — /api/auth /staff /practitioner /admin /dev /kiosk → ใช้ใน LAN เท่านั้น
 * API ของเจ้าหน้าที่/แอดมินจึงไม่มีอยู่บนพอร์ตที่ออกอินเทอร์เน็ตเลย
 * แล้วเริ่มงานตั้งเวลา (cron) ถ้า ENABLE_CRON=true
 */
import os from 'node:os';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { pool } from './db.js';
import { errorHandler } from './utils/errors.js';
import { requireStaff, requirePasswordChanged } from './middleware/auth.js';
import { publicRouter } from './routes/public.js';
import { authRouter } from './routes/auth.js';
import { staffRouter, practitionerRouter } from './routes/staff.js';
import { adminRouter } from './routes/admin.js';
import { devRouter } from './routes/dev.js';
import { kioskRouter } from './routes/kiosk.js';
import { startCron } from './jobs/cron.js';
import { mountPatientWeb, mountFullWeb } from './web.js';

function baseApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback'); // อยู่หลัง cloudflared / vite proxy บนเครื่องเดียวกัน
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));
  return app;
}

// =====================================================================
// PUBLIC — หน้าจอง + API ผู้จอง (ส่งออกอินเทอร์เน็ตผ่าน Cloudflare Tunnel)
// =====================================================================
/** จำกัดจำนวน request ต่อ IP (หลัง Cloudflare ใช้ IP จริงจาก header cf-connecting-ip) */
const publicApiLimiter = rateLimit({
  windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.headers['cf-connecting-ip'] || req.ip,
  message: { error: { code: 'RATE_LIMIT', message: 'ใช้งานถี่เกินไป กรุณารอสักครู่' } },
});
const apiNotFound = (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'ไม่พบ API' } });

const publicApp = baseApp();
// กันยิงถี่ทั้งพอร์ต (รวมไฟล์หน้าเว็บ) — เปิดหน้าหนึ่งครั้งโหลดไฟล์ราว 10 ไฟล์
publicApp.use(rateLimit({
  windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.headers['cf-connecting-ip'] || req.ip,
}));
publicApp.get('/health', (_req, res) => res.json({ ok: true, service: 'public' }));
publicApp.use('/api/public', publicApiLimiter, publicRouter);
publicApp.use('/api', apiNotFound);
const publicWeb = mountPatientWeb(publicApp); // หน้าผู้จองเท่านั้น (อย่างอื่น 404)
publicApp.use(errorHandler);

// =====================================================================
// INTERNAL — แอดมิน / เจ้าหน้าที่ / หมอนวด (ใช้ใน LAN เท่านั้น)
// =====================================================================
const internalApp = baseApp();
internalApp.use(cookieParser());
internalApp.get('/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, service: 'internal', db: 'ok' }); }
  catch { res.status(500).json({ ok: false, db: 'down' }); }
});
internalApp.use('/api/auth', authRouter);
internalApp.use('/api/staff', requireStaff, requirePasswordChanged, staffRouter);
internalApp.use('/api/practitioner', requireStaff, requirePasswordChanged, practitionerRouter);
internalApp.use('/api/admin', requireStaff, requirePasswordChanged, adminRouter);
internalApp.use('/api/dev', requireStaff, requirePasswordChanged, devRouter);
internalApp.use('/api/kiosk', requireStaff, requirePasswordChanged, kioskRouter);
// API ผู้จองบนพอร์ตนี้ด้วย → เปิดหน้าผู้จองใน LAN เพื่อทดสอบผู้ใช้จำลองได้ (origin เดียวกับหน้าแอดมิน)
internalApp.use('/api/public', (req, _res, next) => { req.viaInternal = true; next(); }, publicApiLimiter, publicRouter);
internalApp.use('/api', apiNotFound);
mountFullWeb(internalApp); // ทุกหน้า
internalApp.use(errorHandler);

// =====================================================================
async function main() {
  await pool.query('SELECT 1'); // เช็กว่าต่อ DB ได้ก่อนเปิดพอร์ต
  // ตัวเลข 0.0.0.0 / :: แปลว่า "รับทุกช่องทาง" เปิดใน browser ไม่ได้ → แสดง localhost + IP ในวง LAN แทน
  const shown = (host) => (host === '0.0.0.0' || host === '::' ? 'localhost' : host);
  const lanIps = Object.values(os.networkInterfaces()).flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);
  await Promise.all([
    new Promise((ok) => publicApp.listen(config.publicPort, config.publicHost, ok)),
    new Promise((ok) => internalApp.listen(config.internalPort, config.internalHost, ok)),
  ]);
  const pub = `http://${shown(config.publicHost)}:${config.publicPort}`;
  const int = `http://${shown(config.internalHost)}:${config.internalPort}`;
  console.log('');
  console.log('  หน้าผู้จอง (พอร์ตนี้ต่อ Cloudflare Tunnel)');
  console.log(`    ${pub}`);
  console.log('  หน้าเจ้าหน้าที่ (LAN เท่านั้น)');
  console.log(`    ผู้ดูแล/นักพัฒนา  ${int}/admin`);
  console.log(`    เคาน์เตอร์/หมอนวด ${int}/staff`);
  console.log(`    kiosk            ${int}/kiosk`);
  if (config.internalHost === '0.0.0.0' && lanIps.length) {
    console.log(`    เครื่องอื่นใน LAN  ${lanIps.map((ip) => `http://${ip}:${config.internalPort}`).join('  ')}`);
  }
  console.log('');
  if (publicWeb) console.log(`[web]  ส่งหน้าเว็บจาก ${config.frontendDist}`);
  else console.log('[web]  ยังไม่มี frontend/dist (ยังไม่ได้ build: npm run build:web) — ระหว่างพัฒนาใช้ Vite http://localhost:5173');
  if (config.enableCron) startCron();
  // ตัวรัน test (test/run.mjs) สั่งปิดผ่าน IPC → ปิดแบบปกติ ให้ Node เขียนผล coverage ได้ (Windows kill แล้วไม่เขียน)
  if (process.send) {
    process.on('message', (m) => { if (m === 'shutdown') process.exit(0); });
    process.send('ready');
  }
}

main().catch((err) => {
  console.error('เปิดเซิร์ฟเวอร์ไม่สำเร็จ:', err.code === 'ECONNREFUSED' ? `ต่อฐานข้อมูลไม่ได้ — MariaDB เปิดอยู่ไหม? พอร์ตตรงกับ DB_PORT=${process.env.DB_PORT || 3306} ใน .env ไหม?`
    : err.code === 'ER_ACCESS_DENIED_ERROR' ? 'DB_USER / DB_PASSWORD ใน .env ไม่ถูกต้อง' : err.message);
  process.exit(1);
});
