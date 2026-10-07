/**
 * web.js — ส่งหน้าเว็บ (frontend/dist ที่ได้จาก `npm run build`) จาก backend เอง
 *
 * ทำไมต้องมี: ตอนพัฒนาใช้ Vite (:5173) ส่งหน้าเว็บ แต่ตอนใช้งานจริงไม่ควรเปิด Vite
 * จึงให้ backend ส่งไฟล์หน้าเว็บสำเร็จรูปเอง โดยแยกตามพอร์ต:
 *
 *   PUBLIC (:4000, ออกเน็ตผ่าน tunnel) → mountPatientWeb()
 *     - ส่งเฉพาะหน้าผู้จอง: /  /ticket/:code  /my  /people
 *     - /admin /staff /kiosk และ URL อื่น → 404
 *     - ส่งเฉพาะไฟล์ JS ที่หน้าผู้จองใช้ (คำนวณจาก dist/.vite/manifest.json)
 *       ไฟล์โค้ดของหน้าแอดมิน / หน้างาน / kiosk ขอทางพอร์ตนี้ไม่ได้
 *
 *   INTERNAL (:4001, LAN เท่านั้น) → mountFullWeb()
 *     - ส่งทุกหน้า (/admin /staff /kiosk และหน้าผู้จองสำหรับทดสอบผู้ใช้จำลอง)
 *
 * ถ้ายังไม่ได้ build (ไม่มี dist/index.html) จะข้ามไปเฉย ๆ พร้อมแจ้งใน console
 * → ระหว่างพัฒนายังใช้ Vite :5173 ได้ตามเดิม
 */
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';

const DIST = config.frontendDist;
const INDEX = path.join(DIST, 'index.html');

/** source ของแอปฝั่งเจ้าหน้าที่ใน manifest — ห้ามส่งทางพอร์ต public */
const STAFF_SOURCES = /^src\/pages\/(admin|staff|kiosk)\//;

/** URL ของหน้าผู้จอง (ต้องตรงกับ route ใน frontend/src/App.jsx) */
const PATIENT_ROUTES = /^\/(?:ticket\/[A-Za-z0-9]{1,12}|my|people)?\/?$/;

/** มี dist ให้ส่งไหม */
export const hasWebBuild = () => fs.existsSync(INDEX);

/**
 * Content-Security-Policy ของหน้าเว็บ
 *  - script/style/font จากเครื่องเราเท่านั้น (ฟอนต์ฝังในเว็บแล้ว ไม่ใช้ Google Fonts)
 *  - เชื่อมต่อ/รูปจาก LINE ได้ (LIFF SDK เรียก api.line.me, รูปโปรไฟล์อยู่บน line-scdn.net)
 *  - ปิด upgrade-insecure-requests: พอร์ต internal เป็น http ใน LAN ถ้าเปิดไว้ browser จะเปลี่ยนเป็น https แล้วโหลดไม่ขึ้น
 */
const webHelmet = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'connect-src': ["'self'", 'https://*.line.me', 'https://*.line-scdn.net'],
      'img-src': ["'self'", 'data:', 'https://*.line-scdn.net'],
      'upgrade-insecure-requests': null,
    },
  },
});

/** ไฟล์ใน dist/assets ที่หน้าผู้จองใช้ (ไล่จาก index.html ตาม import โดยข้ามแอปฝั่งเจ้าหน้าที่) */
function patientAssetSet() {
  const manifestPath = path.join(DIST, '.vite', 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('ไม่พบ frontend/dist/.vite/manifest.json — build frontend ใหม่ด้วย npm run build');
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const allowed = new Set();
  const seen = new Set();
  const walk = (key) => {
    if (seen.has(key) || STAFF_SOURCES.test(key)) return;
    seen.add(key);
    const chunk = manifest[key];
    if (!chunk) return;
    [chunk.file, ...(chunk.css ?? []), ...(chunk.assets ?? [])].forEach((f) => allowed.add('/' + f));
    [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])].forEach(walk);
  };
  walk('index.html');
  return allowed;
}

/** ส่งไฟล์ใน dist: ไฟล์ใน /assets มี hash ในชื่อ → cache ได้ 1 ปี, ไฟล์อื่นให้ตรวจใหม่ทุกครั้ง */
const serveDist = express.static(DIST, {
  index: false,
  dotfiles: 'ignore', // ไม่ส่ง .vite/manifest.json
  setHeaders(res, filePath) {
    res.setHeader('Cache-Control', filePath.includes(`${path.sep}assets${path.sep}`)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache');
  },
});

/** ส่ง index.html (React จะเลือกหน้าเองตาม URL) */
function sendIndex(_req, res) {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(INDEX);
}

/**
 * พอร์ต PUBLIC — หน้าผู้จองเท่านั้น
 * @param {import('express').Express} app
 * @returns {boolean} ส่งหน้าเว็บได้ไหม (false = ยังไม่ได้ build)
 */
export function mountPatientWeb(app) {
  if (!hasWebBuild()) return false;
  const allowed = patientAssetSet();
  const notFound = (_req, res) => res.status(404).type('text').send('Not found');

  app.use(webHelmet);
  // ไฟล์ JS/CSS/ฟอนต์: เฉพาะที่หน้าผู้จองใช้
  app.use((req, res, next) => {
    if (!req.path.startsWith('/assets/')) return next();
    return allowed.has(req.path) ? serveDist(req, res, () => notFound(req, res)) : notFound(req, res);
  });
  app.get('/favicon.svg', serveDist);
  // หน้าผู้จอง
  app.get(PATIENT_ROUTES, sendIndex);
  // อย่างอื่นทั้งหมด (รวม /admin /staff /kiosk) → 404
  app.use(notFound);
  return true;
}

/**
 * พอร์ต INTERNAL — ทุกหน้า
 * @param {import('express').Express} app
 * @returns {boolean} ส่งหน้าเว็บได้ไหม (false = ยังไม่ได้ build)
 */
export function mountFullWeb(app) {
  if (!hasWebBuild()) return false;
  app.use(webHelmet);
  app.use(serveDist);
  app.get('*', sendIndex);
  return true;
}
