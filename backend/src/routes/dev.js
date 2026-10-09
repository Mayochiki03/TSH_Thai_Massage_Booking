/**
 * routes/dev.js — เมนูนักพัฒนา (role DEV เท่านั้น)
 *
 * เครื่องมือที่ใช้ตอนพัฒนา/ทดสอบ/ดูแลระบบ แยกจากเมนูผู้ดูแลทั่วไป เพื่อไม่ให้ผู้ใช้งานปกติ
 * เปลี่ยนค่าที่กระทบการเชื่อมต่อทั้งระบบโดยไม่ตั้งใจ
 *
 *   GET  /api/dev/system                 ข้อมูลระบบ (เวอร์ชัน, โหมด, ฐานข้อมูล, cron)
 *   GET  /api/dev/connection             ค่าการเชื่อมต่อ LINE / Public URL (secret แสดงแค่ว่าตั้งแล้วหรือยัง)
 *   PUT  /api/dev/connection             บันทึกค่าการเชื่อมต่อ + สลับโหมด LOCAL / DEV_TUNNEL / PRODUCTION
 *   POST /api/dev/connection/test        ทดสอบ public URL / token / โควตา / ส่งข้อความทดสอบ
 *   GET  /api/dev/mock-users             ผู้ใช้ LINE จำลอง (ใช้ได้เฉพาะโหมด LOCAL)
 *   POST /api/dev/mock-users             สร้างผู้ใช้จำลองใหม่
 *   DELETE /api/dev/mock-users/:id       ลบผู้ใช้จำลอง (ถ้ายังไม่เคยจอง)
 *   POST /api/dev/jobs/:name             สั่งรันงาน cron ทันที (ไม่ต้องรอเวลา)
 *   POST /api/dev/clear-test-data        ล้างข้อมูลผู้ป่วย/การจองทั้งหมด (ก่อนขึ้นใช้งานจริง)
 */
import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { query, queryOne, withTx } from '../db.js';
import { config } from '../config.js';
import { ah, badRequest, conflict } from '../utils/errors.js';
import { requireRole } from '../middleware/auth.js';
import { updateSetting } from '../services/settings.js';
import { lineConfig, getBotInfo, getQuota, pushMessages } from '../services/line.js';
import { generateSlots, markNoShows, sendReminders2h, sendReminders1d } from '../jobs/cron.js';
import { audit } from '../services/audit.js';

export const devRouter = Router();
devRouter.use(requireRole('DEV'));

/** prefix ของ LINE user ID จำลอง — แยกออกจาก ID จริงของ LINE (ขึ้นต้นด้วย U + hex 32 ตัว) ได้ชัดเจน */
const MOCK_PREFIX = 'Udev';
const startedAt = Date.now();

// =====================================================================
// ข้อมูลระบบ
// =====================================================================
devRouter.get('/system', ah(async (_req, res) => {
  const [{ v: mysqlVersion }] = await query('SELECT VERSION() AS v');
  const [{ now: dbNow }] = await query('SELECT NOW() AS now');
  const counts = await queryOne(
    `SELECT (SELECT COUNT(*) FROM patients)      AS patients,
            (SELECT COUNT(*) FROM line_users)    AS line_users,
            (SELECT COUNT(*) FROM appointments)  AS appointments,
            (SELECT COUNT(*) FROM time_slots WHERE slot_date >= CURDATE()) AS future_slots,
            (SELECT MAX(slot_date) FROM time_slots) AS last_slot_date`,
  );
  const c = await lineConfig();
  res.json({
    node: process.version,
    mysql: mysqlVersion,
    env: config.env,
    db_time: dbNow,
    uptime_sec: Math.round((Date.now() - startedAt) / 1000),
    ports: { public: `${config.publicHost}:${config.publicPort}`, internal: `${config.internalHost}:${config.internalPort}` },
    cron_enabled: config.enableCron,
    mode: c.mode,
    counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, k === 'last_slot_date' ? v : Number(v)])),
  });
}));

// =====================================================================
// การเชื่อมต่อ (LINE / Public URL / โหมด)
// =====================================================================
async function connectionView() {
  const c = await lineConfig();
  return {
    mode: c.mode,
    public_base_url: c.publicBaseUrl,
    liff_id: c.liffId,
    line_login_channel_id: c.loginChannelId,
    channel_secret_set: !!c.channelSecret,
    channel_token_set: !!c.channelToken,
  };
}

devRouter.get('/connection', ah(async (_req, res) => res.json(await connectionView())));

const connectionBody = z.object({
  mode: z.enum(['LOCAL', 'DEV_TUNNEL', 'PRODUCTION']),
  public_base_url: z.string().trim().max(300).default(''),
  liff_id: z.string().trim().max(100).default(''),
  line_login_channel_id: z.string().trim().max(50).default(''),
  // ช่อง secret: ส่งค่าว่าง/ไม่ส่ง = ไม่เปลี่ยนค่าเดิม
  line_channel_secret: z.string().trim().max(200).optional(),
  line_channel_token: z.string().trim().max(500).optional(),
});

devRouter.put('/connection', ah(async (req, res) => {
  const b = connectionBody.parse(req.body);
  // โหมดที่ใช้ LINE จริงต้องมีค่าครบ ไม่งั้นผู้ป่วยจะเปิดหน้าจองไม่ได้
  if (b.mode !== 'LOCAL') {
    const cur = await lineConfig();
    const missing = [];
    if (!b.public_base_url) missing.push('Public URL');
    if (!b.liff_id) missing.push('LIFF ID');
    if (!b.line_login_channel_id) missing.push('LINE Login Channel ID');
    if (!(b.line_channel_token || cur.channelToken)) missing.push('Channel Access Token');
    if (missing.length) throw badRequest('INCOMPLETE', `โหมดนี้ต้องกรอก: ${missing.join(', ')}`);
  }
  await updateSetting('public_base_url', b.public_base_url);
  await updateSetting('liff_id', b.liff_id);
  await updateSetting('line_login_channel_id', b.line_login_channel_id);
  if (b.line_channel_secret) await updateSetting('line_channel_secret', b.line_channel_secret);
  if (b.line_channel_token) await updateSetting('line_channel_token', b.line_channel_token);
  await updateSetting('connection_mode', b.mode);
  await audit(req, 'UPDATE_CONNECTION', 'settings', null, { mode: b.mode });
  res.json(await connectionView());
}));

devRouter.post('/connection/test', ah(async (req, res) => {
  const what = z.enum(['public', 'token', 'quota', 'push']).parse(req.body?.what);
  const c = await lineConfig();

  if (what === 'public') {
    // เรียก /health ของพอร์ต public ผ่าน URL ภายนอก → ยืนยันว่า tunnel ทำงาน
    if (!c.publicBaseUrl) return res.json({ ok: false, error: 'ยังไม่ได้ตั้งค่า Public URL' });
    try {
      const r = await fetch(`${c.publicBaseUrl}/health`, { signal: AbortSignal.timeout(8000) });
      const data = await r.json().catch(() => null);
      return res.json({ ok: r.ok && data?.ok === true, status: r.status, error: r.ok ? null : `HTTP ${r.status}` });
    } catch (err) {
      // "fetch failed" ของ Node ไม่บอกสาเหตุ — สาเหตุจริงอยู่ใน err.cause.code
      const code = err.cause?.code ?? err.name;
      const hint = {
        ENOTFOUND: 'หาโดเมนไม่เจอ — Public URL อาจเป็น URL tunnel เก่าที่ปิดไปแล้ว',
        EAI_AGAIN: 'DNS ไม่ตอบ — เน็ตของเครื่องนี้หาชื่อโดเมนไม่ได้ชั่วคราว',
        ECONNREFUSED: 'ปลายทางปฏิเสธการเชื่อมต่อ',
        ECONNRESET: 'การเชื่อมต่อถูกตัดกลางทาง',
        UND_ERR_CONNECT_TIMEOUT: 'เชื่อมต่อไม่ทันเวลา — เน็ตช้าหรือถูก firewall บล็อก',
        TimeoutError: 'รอเกิน 8 วินาที — tunnel อาจหลุดอยู่',
      }[code];
      return res.json({ ok: false, error: `เปิดไม่ได้ (${code})${hint ? `: ${hint}` : `: ${err.message}`}`, url: c.publicBaseUrl });
    }
  }
  if (what === 'token') return res.json(await getBotInfo());
  if (what === 'quota') return res.json(await getQuota());

  // push: ส่งข้อความทดสอบไปที่ LINE user ID ที่ระบุ (เช่นของนักพัฒนาเอง)
  const to = z.string().regex(/^U[0-9a-f]{32}$/i, 'LINE user ID ไม่ถูกต้อง').parse(req.body?.line_user_id);
  const r = await pushMessages(to, [{ type: 'text', text: 'ทดสอบการเชื่อมต่อจากระบบจองคิวนวดแผนไทย' }]);
  res.json(r.ok ? { ok: true } : { ok: false, error: r.data?.message || `HTTP ${r.status}` });
}));

// =====================================================================
// ผู้ใช้ LINE จำลอง (โหมด LOCAL)
// =====================================================================
devRouter.get('/mock-users', ah(async (_req, res) => {
  const rows = await query(
    `SELECT lu.line_user_id, lu.display_name, lu.pdpa_consent_at, lu.last_seen_at,
            GROUP_CONCAT(CONCAT(p.first_name, ' ', p.last_name, ' (', bp.relation, ')') ORDER BY bp.created_at SEPARATOR ', ') AS patients,
            (SELECT COUNT(*) FROM appointments a WHERE a.booked_by_line_user_id = lu.line_user_id) AS bookings
       FROM line_users lu
       LEFT JOIN booker_patients bp ON bp.line_user_id = lu.line_user_id
       LEFT JOIN patients p ON p.patient_id = bp.patient_id
      WHERE lu.line_user_id LIKE ?
      GROUP BY lu.line_user_id
      ORDER BY lu.created_at`,
    [`${MOCK_PREFIX}%`],
  );
  res.json({ users: rows.map((r) => ({ ...r, bookings: Number(r.bookings) })) });
}));

devRouter.post('/mock-users', ah(async (req, res) => {
  const name = z.string().trim().min(1).max(100).parse(req.body?.display_name);
  // Udev + hex 29 ตัว = ยาว 33 ตัวเท่ากับ ID จริงของ LINE
  const id = `${MOCK_PREFIX}${crypto.randomBytes(15).toString('hex').slice(0, 29)}`;
  await query('INSERT INTO line_users (line_user_id, display_name) VALUES (?, ?)', [id, name]);
  await audit(req, 'CREATE_MOCK_USER', 'line_users', id);
  res.status(201).json({ line_user_id: id });
}));

devRouter.delete('/mock-users/:id', ah(async (req, res) => {
  const id = req.params.id;
  if (!id.startsWith(MOCK_PREFIX)) throw badRequest('NOT_MOCK', 'ลบได้เฉพาะผู้ใช้จำลอง');
  const used = await queryOne('SELECT COUNT(*) AS n FROM appointments WHERE booked_by_line_user_id = ?', [id]);
  if (Number(used.n)) throw conflict('HAS_BOOKINGS', 'ผู้ใช้นี้มีประวัติการจองแล้ว ใช้ "ล้างข้อมูลทดสอบ" แทน');
  await query('DELETE FROM line_users WHERE line_user_id = ?', [id]);
  res.json({ ok: true });
}));

// =====================================================================
// สั่งรันงานตั้งเวลาทันที
// =====================================================================
const JOBS = {
  'generate-slots': { label: 'สร้างรอบเวลาล่วงหน้า', run: () => generateSlots() },
  'no-show': { label: 'ตัดสิทธิ์คิวที่ไม่มาตามนัด', run: markNoShows },
  'remind-2h': { label: 'ส่งเตือนก่อนนัด 2 ชม.', run: sendReminders2h },
  'remind-1d': { label: 'ส่งเตือนล่วงหน้า 1 วัน', run: () => sendReminders1d({ ignoreHour: true }) },
};

devRouter.get('/jobs', (_req, res) => res.json({ jobs: Object.entries(JOBS).map(([name, j]) => ({ name, label: j.label })) }));

devRouter.post('/jobs/:name', ah(async (req, res) => {
  const job = JOBS[req.params.name];
  if (!job) throw badRequest('UNKNOWN_JOB', 'ไม่รู้จักงานนี้');
  const result = await job.run();
  await audit(req, 'RUN_JOB', 'system', req.params.name, { result });
  res.json({ ok: true, result });
}));

// =====================================================================
// ล้างข้อมูลทดสอบ — เก็บค่าตั้งค่า / ผู้ใช้ระบบ / รอบเวลา / วันหยุดไว้
// =====================================================================
devRouter.post('/clear-test-data', ah(async (req, res) => {
  if (req.body?.confirm_text !== 'ล้างข้อมูล') throw badRequest('CONFIRM', 'พิมพ์คำว่า "ล้างข้อมูล" เพื่อยืนยัน');
  const counts = await withTx(async (conn) => {
    const out = {};
    // ลบตามลำดับ foreign key (ลูกก่อนแม่)
    for (const t of ['notification_logs', 'service_records', 'appointments', 'patient_suspensions', 'booker_patients', 'line_users', 'patients']) {
      const [r] = await conn.query(`DELETE FROM ${t}`);
      out[t] = r.affectedRows;
    }
    return out;
  });
  await audit(req, 'CLEAR_TEST_DATA', 'system', null, counts);
  res.json({ ok: true, deleted: counts });
}));
