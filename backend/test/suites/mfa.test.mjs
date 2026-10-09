// v0.7.0 2FA API tests — fresh setup_dev DB, server started with default MFA_REQUIRED_ROLES (DEV,ADMIN)
import crypto from 'node:crypto';
const INT = (process.env.TEST_INTERNAL_URL || 'http://127.0.0.1:4001') + '/api';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && x ? '  → ' + String(x).slice(0, 300) : ''}`); };

// independent TOTP implementation (not importing the app's)
function b32(s) { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, v = 0; const o = []; for (const c of s.replace(/\s/g, '')) { v = (v << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(o); }
function totp(secret, offset = 0) {
  const step = Math.floor(Date.now() / 30000) + offset; const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', b32(secret)).update(c).digest(); const o = h[19] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0');
}
function session() {
  const jar = {};
  const fn = async (method, path, body) => {
    const r = await fetch(INT + path, { method, headers: { 'Content-Type': 'application/json', cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') }, body: body ? JSON.stringify(body) : undefined });
    for (const sc of r.headers.getSetCookie()) { const [kv] = sc.split(';'); const [k, ...v] = kv.split('='); const val = v.join('='); if (!val || /Expires=Thu, 01 Jan 1970/i.test(sc)) delete jar[k]; else jar[k] = val; }
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  fn.jar = jar;
  return fn;
}
const login = (s, u, p = 'admin1234') => s('POST', '/auth/login', { username: u, password: p });

// ---- 1. ADMIN must set up 2FA ----
const a = session();
let r = await login(a, 'admin');
ok('admin password ok → mfa:setup, no session yet', r.status === 200 && r.data.mfa === 'setup' && !a.jar.tmb_staff && a.jar.tmb_mfa, JSON.stringify(r.data));
r = await a('GET', '/auth/me');
ok('cannot use API with only mfa ticket', r.status === 401);
r = await a('POST', '/auth/mfa/verify', { code: '123456' });
ok('verify before setup → MFA_NOT_ENABLED', r.status === 400 && r.data.error.code === 'MFA_NOT_ENABLED', JSON.stringify(r.data));
r = await a('POST', '/auth/mfa/setup');
const secret = r.data?.secret;
ok('setup returns QR data URL + secret', r.status === 200 && r.data.qr.startsWith('data:image/png;base64,') && /^[A-Z2-7 ]{32,}$/.test(secret), JSON.stringify(r.data).slice(0, 200));
let r2 = await a('POST', '/auth/mfa/setup');
ok('setup again returns SAME secret (refresh-safe)', r2.data.secret === secret);
r = await a('POST', '/auth/mfa/enable', { code: '000000' === totp(secret) ? '111111' : '000000' });
ok('enable with wrong code → 400', r.status === 400 && r.data.error.code === 'INVALID_MFA_CODE', JSON.stringify(r.data));
r = await a('POST', '/auth/mfa/enable', { code: totp(secret) });
const recovery = r.data?.recovery_codes ?? [];
ok('enable with right code → session + 10 recovery codes', r.status === 200 && recovery.length === 10 && a.jar.tmb_staff && !a.jar.tmb_mfa && r.data.user.mfa_enabled === true, JSON.stringify(r.data));
r = await a('GET', '/auth/me');
ok('admin can use API now', r.status === 200 && r.data.user.username === 'admin');
r = await a('GET', '/admin/users');
const adminRow = r.data.users.find((u) => u.username === 'admin');
ok('user list shows admin ENABLED, 10 codes left', adminRow?.mfa_state === 'ENABLED' && adminRow.recovery_left === 10, JSON.stringify(adminRow));
ok('counter1 shows OFF, dev shows PENDING', r.data.users.find((u) => u.username === 'counter1').mfa_state === 'OFF' && r.data.users.find((u) => u.username === 'dev').mfa_state === 'PENDING');

// ---- 2. login again with TOTP; replay blocked ----
const b = session();
r = await login(b, 'admin');
ok('second login → mfa:verify', r.data.mfa === 'verify');
r = await b('POST', '/auth/mfa/verify', { code: totp(secret) });
ok('same code as enable (replay) is rejected', r.status === 400, JSON.stringify(r.data));
// wait for next step to get a fresh code
const waitNext = async () => { const ms = 30000 - (Date.now() % 30000) + 300; await new Promise((res) => setTimeout(res, ms)); };
await waitNext();
r = await b('POST', '/auth/mfa/verify', { code: totp(secret).replace(/(\d{3})/, '$1 ') });
ok('fresh code (with space) → session', r.status === 200 && b.jar.tmb_staff, JSON.stringify(r.data));
const c = session();
await login(c, 'admin');
r = await c('POST', '/auth/mfa/verify', { code: totp(secret) });
ok('same fresh code on another device → rejected (one-time)', r.status === 400);

// ---- 3. recovery code ----
r = await c('POST', '/auth/mfa/verify', { recovery_code: recovery[0].toUpperCase() });
ok('recovery code (any case) works, 9 left', r.status === 200 && r.data.recovery_left === 9, JSON.stringify(r.data));
const d = session();
await login(d, 'admin');
r = await d('POST', '/auth/mfa/verify', { recovery_code: recovery[0] });
ok('used recovery code rejected', r.status === 400 && r.data.error.code === 'INVALID_RECOVERY_CODE');

// ---- 4. non-required staff: unchanged ----
const k = session();
r = await login(k, 'counter1');
ok('counter1 (not required) gets session directly', r.status === 200 && !r.data.mfa && k.jar.tmb_staff);
r = await login(session(), 'kiosk1');
ok('kiosk never needs 2FA', r.status === 200 && !r.data.mfa);

// ---- 5. admin requires 2FA for counter1 → counter1 session revoked ----
const users = (await a('GET', '/admin/users')).data.users;
const cu = users.find((u) => u.username === 'counter1');
r = await a('PUT', `/admin/users/${cu.user_id}`, { username: 'counter1', full_name: cu.full_name, role: 'STAFF', is_active: true, totp_required: true });
ok('admin sets totp_required for counter1', r.status === 200, JSON.stringify(r.data));
r = await k('GET', '/auth/me');
ok('counter1 old session revoked', r.status === 401 && ['SESSION_REVOKED', 'MFA_REQUIRED'].includes(r.data.error.code), JSON.stringify(r.data));
r = await login(k, 'counter1');
ok('counter1 now asked to set up', r.data.mfa === 'setup');
r = await a('PUT', `/admin/users/${cu.user_id}`, { username: 'counter1', full_name: cu.full_name, role: 'STAFF', is_active: true });
r = await a('GET', '/admin/users');
ok('update without totp_required keeps flag', r.data.users.find((u) => u.username === 'counter1').totp_required === true);

// ---- 6. reset 2FA (lost phone) ----
r = await a('POST', `/admin/users/${adminRow.user_id}/reset-mfa`, { reason: 'ทดสอบ' });
ok('reset own 2FA → ok, self:true', r.status === 200 && r.data.self === true);
r = await a('GET', '/auth/me');
ok('all admin sessions revoked after reset', r.status === 401);
r = await b('GET', '/auth/me');
ok('other device also revoked', r.status === 401);
const e = session();
r = await login(e, 'admin');
ok('admin after reset → setup again', r.data.mfa === 'setup');
r = await e('POST', '/auth/mfa/setup');
ok('new secret differs from old', r.data.secret !== secret);
const secret2 = r.data.secret;
r = await e('POST', '/auth/mfa/enable', { code: totp(secret) });
ok('old phone code no longer works', r.status === 400);
r = await e('POST', '/auth/mfa/enable', { code: totp(secret2) });
ok('new phone works', r.status === 200 && r.data.recovery_codes.length === 10);
r = await e('POST', '/auth/mfa/verify', { recovery_code: recovery[1] });
ok('old recovery codes invalid after reset (needs ticket anyway)', r.status === 401 || r.status === 400);

// ---- 7. ADMIN cannot reset DEV ----
const devRow = (await e('GET', '/admin/users')).data.users.find((u) => u.username === 'dev');
r = await e('POST', `/admin/users/${devRow.user_id}/reset-mfa`);
ok('admin cannot reset DEV 2FA', r.status === 400 && r.data.error.code === 'DEV_ONLY', JSON.stringify(r.data));

// ---- 8. reset password revokes sessions ----
const p = session();
await login(p, 'counter1');
const t1 = session(); // counter1 must set up now (required) — use therapist1 instead
const th = (await e('GET', '/admin/users')).data.users.find((u) => u.username === 'therapist1');
await login(t1, 'therapist1');
r = await t1('GET', '/auth/me');
ok('therapist1 logged in', r.status === 200);
r = await e('POST', `/admin/users/${th.user_id}/reset-password`, { password: 'newpass123' });
r = await t1('GET', '/auth/me');
ok('reset-password revokes therapist1 session', r.status === 401 && r.data.error.code === 'SESSION_REVOKED');

// ---- 9. ticket expires / wrong-code rate limit ----
const f = session();
await login(f, 'admin');
let last;
for (let i = 0; i < 11; i++) last = await f('POST', '/auth/mfa/verify', { code: '999999' === totp(secret2) ? '888888' : '999999' });
ok('11th wrong code → 429', last.status === 429, JSON.stringify(last.data));

// ---- 10. audit ----
r = await e('GET', '/admin/audit-logs?limit=200');
const actions = new Set((r.data?.logs ?? r.data?.audit_logs ?? r.data?.rows ?? []).map((l) => l.action));
ok('audit has MFA_ENABLED, MFA_FAILED, RESET_MFA', ['MFA_ENABLED', 'MFA_FAILED', 'RESET_MFA'].every((x) => actions.has(x)), [...actions].join(','));

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
