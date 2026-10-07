/**
 * config.js — อ่านค่าจาก .env แล้วรวมเป็น object เดียว + ตรวจค่าที่จำเป็น
 * ถ้าขาดค่าหรือใช้ค่าตัวอย่างบน production เซิร์ฟเวอร์จะไม่ยอมเปิด (กันลืมเปลี่ยน secret)
 */
import 'dotenv/config';

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name} (ดู .env.example)`);
  return v;
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: required('DB_USER'),
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'thai_massage_booking',
  },
  publicHost: process.env.PUBLIC_HOST || '127.0.0.1',
  publicPort: Number(process.env.PUBLIC_PORT || 4000),
  internalHost: process.env.INTERNAL_HOST || '0.0.0.0',
  internalPort: Number(process.env.INTERNAL_PORT || 4001),
  jwtSecret: required('JWT_SECRET'),
  appSecretKey: required('APP_SECRET_KEY'),
  enableCron: (process.env.ENABLE_CRON ?? 'true') === 'true',
};

if (!/^[0-9a-f]{64}$/i.test(config.appSecretKey)) {
  throw new Error('APP_SECRET_KEY ต้องเป็น hex 64 ตัว (สร้างด้วย npm run gen-key)');
}
if (config.isProd && (config.jwtSecret.startsWith('dev_only') || /^0+$/.test(config.appSecretKey))) {
  throw new Error('ห้ามใช้ JWT_SECRET / APP_SECRET_KEY ค่าตัวอย่างบน production');
}
