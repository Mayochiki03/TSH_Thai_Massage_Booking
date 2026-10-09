const PUB = (process.env.TEST_PUBLIC_URL || 'http://127.0.0.1:4000') + '/api/public';
const INT = (process.env.TEST_INTERNAL_URL || 'http://127.0.0.1:4001') + '/api';

const TODAY = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
// next working day (Mon–Fri) after today, Bangkok time — matches @d1 in 04_dev_sample.sql
const TOMORROW = (() => { let t = Date.now() + 7 * 3600e3; do { t += 86400e3; } while ([0, 6].includes(new Date(t).getUTCDay())); return new Date(t).toISOString().slice(0, 10); })();
// ชุดทดสอบเดิมออกแบบสำหรับ 1 เตียง → ตั้ง bed_count = 1 ก่อน
{ let c = ''; const f = async (m, p, b) => { const r = await fetch((process.env.TEST_INTERNAL_URL || 'http://127.0.0.1:4001') + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json', cookie: c }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) c = sc.split(';')[0]; return r; };
  await f('POST', '/auth/login', { username: 'dev', password: 'admin1234' }); await f('PUT', '/admin/settings', { bed_count: 1 }); }
let pass = 0, fail = 0, skip = 0;
// เวลาปัจจุบัน (ไทย) 'HH:MM' — บาง test ใช้รอบเวลาของ "วันนี้" จากข้อมูลตัวอย่าง จึงขึ้นกับว่ารันตอนกี่โมง
const NOW_HM = new Date(Date.now() + 7 * 3600e3).toISOString().slice(11, 16);
const skipped = (name, why) => { skip++; console.log(`SKIP  ${name}  → ${why}`); };
// v0.6: บังคับประเภทบริการ + เลขบัตร → เติมให้อัตโนมัติ (ชุดทดสอบนี้ทดสอบกฎอื่น)
function v6(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const b = { ...body };
  if ('slot_id' in b && !('service_type_id' in b)) b.service_type_id = 1;
  if ('slot_id' in b && 'patient_id' in b && !('national_id' in b)) b.no_national_id = true;
  if ('first_name' in b && !('national_id' in b) && !('no_national_id' in b)) b.no_national_id = true;
  if (b.patient && typeof b.patient === 'object' && !('national_id' in b.patient)) b.patient = { ...b.patient, no_national_id: true };
  return b;
}

const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  → ' + extra : ''}`); };

async function pub(method, path, user, body) {
  const r = await fetch(PUB + path, { method, headers: { 'Content-Type': 'application/json', ...(user && { 'X-Dev-Line-User': user, 'X-Dev-Line-Name': encodeURIComponent('ทดสอบ') }) }, body: body ? JSON.stringify(v6(body)) : undefined });
  return { status: r.status, data: await r.json() };
}
function session() {
  let cookie = '';
  return async (method, path, body) => {
    const r = await fetch(INT + path, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(v6(body)) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, data: await r.json() };
  };
}

const W = 'Udev00000000000000000000000000002'; // Wichai (patient 3)
const S = 'Udev00000000000000000000000000001'; // Somsri (1, mother 2)
const N = 'Udev00000000000000000000000000009'; // new user

// ---------------- public ----------------
let r = await pub('GET', '/config');
ok('config', r.status === 200 && r.data.mode === 'LOCAL', JSON.stringify(r.data));
r = await pub('GET', '/me');
ok('me without LINE → 401', r.status === 401);
r = await pub('GET', '/me', W);
ok('me Wichai', r.status === 200 && r.data.patients.length === 1 && r.data.patients[0].is_self);
r = await pub('GET', '/availability', W);
ok('availability', r.status === 200 && r.data.days.length >= 1, r.data.days.map(d => `${d.date}:${d.slots.map(s => s.start_time + '=' + s.status[0]).join(',')}`).join(' | '));
const d1 = r.data.days.find(d => d.date === TOMORROW);
const freeD1 = d1.slots.filter(s => s.status === 'AVAILABLE');

r = await pub('POST', '/bookings', W, { patient_id: 3, slot_id: freeD1[0].slot_id, chief_complaint: 'ปวดหลัง' });
ok('Wichai books tomorrow', r.status === 201 && /^[A-Z0-9]{6}$/.test(r.data.booking_code), r.data.booking_code);
const wCode = r.data.booking_code;
r = await pub('POST', '/bookings', W, { patient_id: 3, slot_id: freeD1[1].slot_id });
ok('same day again → QUOTA_DAY', r.status === 409 && r.data.error.code === 'QUOTA_DAY', r.data.error?.message);
r = await pub('POST', '/bookings', W, { patient_id: 2, slot_id: freeD1[1].slot_id });
ok('book for unlinked patient → 403', r.status === 403);
r = await pub('POST', '/bookings', W, { patient_id: 3, slot_id: freeD1[0].slot_id });
ok('taken slot → error', r.status === 409, r.data.error?.code);

// new user flow
r = await pub('POST', '/bookings', N, { patient_id: 3, slot_id: freeD1[1].slot_id });
ok('no consent → CONSENT_REQUIRED', r.data.error?.code === 'CONSENT_REQUIRED');
r = await pub('POST', '/me/consent', N);
ok('consent', r.data.consented === true);
r = await pub('PUT', '/me/self', N, { first_name: 'ทดลอง', last_name: 'ระบบ', phone_number: '0899999999' });
ok('set self (general, no HN)', r.status === 200 && r.data.patients[0].patient_type === 'GENERAL' && r.data.patients[0].is_self);
r = await pub('PUT', '/me/self', N, { first_name: 'ทดลอง', last_name: 'ระบบ', phone_number: '089' });
ok('bad phone → VALIDATION', r.data.error?.code === 'VALIDATION', JSON.stringify(r.data.error?.fields));
r = await pub('POST', '/me/patients', N, { first_name: 'ผิด', last_name: 'ชื่อ', phone_number: '0822222222', hn: 'hn0067890', relation: 'มารดา' });
ok('HN exists, wrong name → HN_MISMATCH', r.data.error?.code === 'HN_MISMATCH');
r = await pub('POST', '/me/patients', N, { first_name: 'บุญมา', last_name: 'ใจดี', phone_number: '0822222222', hn: 'hn0067890', relation: 'มารดา' });
ok('HN exists, right name → linked', r.status === 201 && r.data.patients.some(p => p.patient_id === 2));
r = await pub('POST', '/bookings', N, { patient_id: 2, slot_id: freeD1[1].slot_id });
ok('mother already booked tomorrow → QUOTA_DAY', r.data.error?.code === 'QUOTA_DAY');
const selfId = (await pub('GET', '/me', N)).data.self_patient_id;

// race: 5 bookings same slot by different new patients
const raceSlot = freeD1[2].slot_id;
const racers = [];
for (let i = 0; i < 5; i++) {
  const u = `Urace0000000000000000000000000${i}`;
  await pub('POST', '/me/consent', u);
  const me = await pub('PUT', '/me/self', u, { first_name: `แข่ง${i}`, last_name: 'จอง', phone_number: `081000000${i}` });
  racers.push([u, me.data.self_patient_id]);
}
const res = await Promise.all(racers.map(([u, pid]) => pub('POST', '/bookings', u, { patient_id: pid, slot_id: raceSlot })));
ok('race 5 → exactly 1 wins', res.filter(x => x.status === 201).length === 1, res.map(x => x.status + (x.data.error ? ':' + x.data.error.code : '')).join(','));

r = await pub('GET', '/bookings', W);
ok('my bookings', r.data.bookings.some(b => b.booking_code === wCode), r.data.bookings.map(b => b.booking_code + ':' + b.status).join(','));
r = await pub('GET', `/bookings/${wCode}`, S);
ok('other user cannot see ticket → 404', r.status === 404);
r = await pub('GET', `/bookings/${wCode}`, W);
ok('ticket can_cancel', r.data.can_cancel === true && r.data.can_confirm === true);
r = await pub('POST', `/bookings/${wCode}/confirm`, W);
ok('confirm', r.data.confirmed === true);
r = await pub('POST', `/bookings/${wCode}/cancel`, W);
ok('cancel', r.data.status === 'CANCELLED');
r = await pub('POST', `/bookings/R6NC2V/cancel`, W); // today 11:15, < 120 min
ok('cancel <2h → CANCEL_TOO_LATE', r.data.error?.code === 'CANCEL_TOO_LATE', r.data.error?.message);

// ---------------- staff ----------------
const st = session();
r = await st('GET', '/staff/queue');
ok('queue needs login → 401', r.status === 401);
r = await st('POST', '/auth/login', { username: 'counter1', password: 'wrong' });
ok('wrong password → 401', r.status === 401);
r = await st('POST', '/auth/login', { username: 'counter1', password: 'admin1234' });
ok('login counter1', r.status === 200 && r.data.user.role === 'STAFF');
r = await st('GET', '/staff/queue');
ok('queue today', r.status === 200 && r.data.slots.length === 6, JSON.stringify(r.data.summary));
r = await st('GET', '/admin/settings');
ok('staff → admin forbidden', r.status === 403);
r = await st('GET', '/staff/appointments/code/r6nc2v');
ok('lookup by code', r.data.booking_code === 'R6NC2V');
const rid = r.data.appointment_id;
r = await st('POST', `/staff/appointments/${rid}/checkin`, {});
ok('checkin early/late → warning or ok', r.status === 200 || ['TOO_EARLY','TOO_LATE'].includes(r.data.error?.code), r.data.error?.message || r.data.status);
r = await st('POST', `/staff/appointments/${rid}/checkin`, { force: true });
ok('checkin force', r.data.status === 'CHECKED_IN' || r.data.error?.message === 'เช็กอินไปแล้ว');
r = await st('GET', '/staff/appointments/search?q=0833');
ok('search by phone', r.data.results.length >= 1);
const q = (await st('GET', '/staff/queue')).data;
const s1430 = q.slots.find(s => s.start_time === '14:30');
// walk-in ได้จนถึงก่อนรอบจบ (14:30–15:30) — รันหลัง 15:30 ข้าม (รอบวันนี้ในข้อมูลตัวอย่างหมดแล้ว)
if (NOW_HM < '15:30') {
  r = await st('POST', '/staff/appointments', { slot_id: s1430.slot_id, channel: 'WALK_IN', patient: { first_name: 'เดินเข้า', last_name: 'มาเลย', phone_number: '0866666666' }, chief_complaint: 'ปวดคอ' });
  ok('walk-in → CHECKED_IN', r.status === 201 && r.data.status === 'CHECKED_IN', r.data.error?.message);
} else {
  r = await st('POST', '/staff/appointments', { slot_id: s1430.slot_id, channel: 'WALK_IN', patient: { first_name: 'เดินเข้า', last_name: 'มาเลย', phone_number: '0866666666' }, chief_complaint: 'ปวดคอ' });
  ok('walk-in after slot ended → SLOT_PASSED', r.data.error?.code === 'SLOT_PASSED', r.data.error?.code);
  skipped('walk-in → CHECKED_IN', `รันตอน ${NOW_HM} รอบ 14:30 ของวันนี้จบแล้ว`);
}
const s1530 = q.slots.find(s => s.start_time === '15:30');
r = await st('POST', '/staff/appointments', { slot_id: s1530.slot_id, channel: 'STAFF', patient_id: 3 });
ok('staff book patient 3 (has today) → QUOTA_DAY can_force', r.data.error?.code === 'QUOTA_DAY' && r.data.error.can_force);
r = await st('POST', '/staff/appointments', { slot_id: s1530.slot_id, channel: 'STAFF', patient_id: 3, force: true });
ok('staff force book', r.status === 201);

// ---------------- practitioner ----------------
const pr = session();
await pr('POST', '/auth/login', { username: 'therapist1', password: 'admin1234' });
r = await pr('GET', '/practitioner/queue');
ok('practitioner queue', r.status === 200 && r.data.slots.length === 6);
r = await pr('POST', `/practitioner/appointments/${rid}/complete`, {});
ok('complete before start → INVALID_STATUS', r.data.error?.code === 'INVALID_STATUS');
r = await pr('POST', `/practitioner/appointments/${rid}/start`);
ok('start', r.data.ok);
r = await pr('POST', `/practitioner/appointments/${rid}/complete`, { treatment_details: 'นวดน่อง ประคบร้อน', post_treatment_note: 'ยืดเหยียดก่อนวิ่ง' });
ok('complete with record', r.data.ok);
r = await pr('GET', '/practitioner/patients/3/history');
ok('history', r.data.history.length >= 1);
r = await pr('GET', '/staff/queue');
ok('practitioner → staff forbidden', r.status === 403);

// ---------------- admin ----------------
const ad = session();
await ad('POST', '/auth/login', { username: 'admin', password: 'admin1234' });
r = await ad('GET', '/admin/settings');
ok('settings list (no CONNECTION)', r.data.settings.length === 21 && !r.data.settings.some(x => x.category === 'CONNECTION'), r.data.settings.length);
r = await ad('PUT', '/admin/settings', { open_weekdays: '1,2,9' });
ok('invalid open_weekdays rejected', r.status === 400, r.data.error?.message);
r = await ad('PUT', '/admin/settings', { line_channel_token: 'x' });
ok('admin cannot set connection', r.data.error?.code === 'DEV_ONLY');
r = await ad('PUT', '/admin/settings', { advance_booking_days: 3 });
ok('settings update', r.data.settings.find(s => s.key === 'advance_booking_days').value === 3);
r = await ad('GET', '/admin/dashboard');
ok('dashboard', r.status === 200 && r.data.next_days.length >= 3, JSON.stringify(r.data.today));
r = await ad('GET', '/dev/system');
ok('admin → dev forbidden', r.status === 403);
r = await ad('POST', '/admin/users', { username: 'dev2', full_name: 'x', role: 'DEV', password: 'longenough1' });
ok('admin cannot create DEV', r.data.error?.code === 'DEV_ONLY');
// ---- dev ----
const dv = session();
await dv('POST', '/auth/login', { username: 'dev', password: 'admin1234' });
r = await dv('GET', '/dev/system');
ok('dev system', r.status === 200 && r.data.mode === 'LOCAL', JSON.stringify(r.data.counts));
r = await dv('GET', '/dev/mock-users');
ok('mock users', r.data.users.length >= 3);
r = await dv('POST', '/dev/mock-users', { display_name: 'ทดสอบใหม่' });
ok('create mock user', /^Udev[0-9a-f]{29}$/.test(r.data.line_user_id), r.data.line_user_id);
const mu = r.data.line_user_id;
r = await pub('GET', '/me', mu);
ok('mock user works on public api', r.status === 200 && r.data.consented === false);
r = await dv('PUT', '/dev/connection', { mode: 'DEV_TUNNEL' });
ok('DEV_TUNNEL requires fields', r.data.error?.code === 'INCOMPLETE', r.data.error?.message);
r = await dv('PUT', '/dev/connection', { mode: 'LOCAL', line_channel_token: 'secret-token-xyz' });
ok('save connection', r.data.channel_token_set === true && r.data.mode === 'LOCAL');
r = await dv('POST', '/dev/jobs/generate-slots');
ok('run job', r.data.ok === true, JSON.stringify(r.data));
r = await dv('GET', '/admin/dashboard');
ok('dev can use admin', r.status === 200);
// ---- kiosk ----
const ks = session();
await ks('POST', '/auth/login', { username: 'kiosk1', password: 'admin1234' });
r = await ks('GET', '/staff/queue');
ok('kiosk → staff forbidden', r.status === 403);
r = await ks('GET', '/kiosk/config');
ok('kiosk config', r.data.kiosk_idle_sec === 60);
r = await ks('GET', '/kiosk/availability');
const kday = r.data.days[0];
ok('kiosk availability starts today', kday?.date === TODAY, r.data.days.map(d => d.date + ':' + d.slots.filter(s => s.status === 'AVAILABLE').length).join(' '));
r = await ks('POST', '/kiosk/patients/lookup', { phone_number: '0822222222' });
ok('kiosk lookup masked', r.data.results[0]?.name.includes('*'), JSON.stringify(r.data.results));
const freeK = r && (await ks('GET', '/kiosk/availability')).data.days.flatMap(d => d.slots.map(s => ({ ...s, date: d.date }))).filter(s => s.status === 'AVAILABLE');
r = await ks('POST', '/kiosk/bookings', { slot_id: freeK[0].slot_id, patient_id: 2, phone_number: '0899999999' });
ok('kiosk wrong phone for patient → mismatch', r.data.error?.code === 'PATIENT_MISMATCH');
r = await ks('POST', '/kiosk/bookings', { slot_id: freeK[freeK.length - 1].slot_id, patient: { first_name: 'ตู้', last_name: 'คีออส', phone_number: '0877777777' } });
ok('kiosk booking', r.status === 201 && r.data.name.includes('*'), JSON.stringify(r.data));
r = await ks('POST', '/kiosk/checkin', { code: 'D9AZ4E', phone_last4: '0000' });
ok('kiosk checkin wrong phone → 404', r.status === 404);
r = await ks('POST', '/kiosk/checkin', { code: 'D9AZ4E', phone_last4: '4444' });
// D9AZ4E = รอบ 13:15 วันนี้: ก่อนเวลานัด → TOO_EARLY หรือสำเร็จ (ถ้าอยู่ในช่วงเช็กอินล่วงหน้า)
//                            หลังเวลานัด → สำเร็จ หรือ TOO_LATE (ถ้าสายเกิน no_show_after_min)
{
  const code = r.status === 200 ? 'OK' : r.data.error?.code;
  const allowed = NOW_HM >= '13:15' ? ['OK', 'TOO_LATE'] : ['TOO_EARLY', 'OK'];
  ok(`kiosk checkin (เวลา ${NOW_HM}) → ${allowed.join(' / ')}`, allowed.includes(code), r.data.error?.message || r.data.status);
}
r = await ad('POST', '/admin/holidays', { date: TOMORROW, name: 'วันหยุดทดสอบ' });
ok('holiday with bookings → HAS_BOOKINGS', r.data.error?.code === 'HAS_BOOKINGS', `${r.data.error?.appointments?.length} appts`);
r = await ad('POST', '/admin/holidays', { date: TOMORROW, name: 'วันหยุดทดสอบ', confirm: true });
ok('holiday confirm → cancelled + notified', r.status === 201 && r.data.cancelled >= 1, `cancelled=${r.data.cancelled} need_call=${r.data.need_call?.length} notify=${r.data.notified?.map(n => n.status || n.reason).join(',')}`);
r = await pub('GET', '/availability', W);
ok('public sees holiday', r.data.days.find(d => d.date === TOMORROW)?.slots.every(s => s.status === 'HOLIDAY'));
r = await ad('DELETE', `/admin/holidays/${TOMORROW}`);
ok('delete holiday → slots unblocked', r.data.ok);
r = await ad('GET', '/admin/slot-templates');
ok('templates', r.data.templates.length === 6);
r = await ad('POST', '/admin/slot-templates', { start_time: '16:30', end_time: '16:00' });
ok('bad template time → 400', r.status === 400);
r = await ad('GET', '/admin/patients?q=ใจดี');
ok('patients search', r.data.patients.length === 2);
r = await ad('POST', '/admin/users', { username: 'nurse2', full_name: 'พยาบาล', role: 'STAFF', password: 'short' });
ok('weak password → 400', r.status === 400);
r = await ad('POST', '/admin/users', { username: 'nurse2', full_name: 'พยาบาล', role: 'STAFF', password: 'longenough1' });
ok('create user', r.status === 201);
const nu = session();
await nu('POST', '/auth/login', { username: 'nurse2', password: 'longenough1' });
r = await nu('GET', '/staff/queue');
ok('new user must change password', r.data.error?.code === 'MUST_CHANGE_PASSWORD');
r = await nu('POST', '/auth/change-password', { current_password: 'longenough1', new_password: 'newpassword9' });
r = await nu('GET', '/staff/queue');
ok('after change → ok', r.status === 200);
r = await ad('GET', '/admin/notification-logs');
ok('notification logs', r.data.logs.length >= 1, JSON.stringify(r.data.month));
r = await ad('GET', '/admin/audit-logs?limit=5');
ok('audit logs', r.data.logs.length === 5);

r = await dv('POST', '/dev/clear-test-data', { confirm_text: 'no' });
ok('clear test data needs confirm', r.status === 400);
console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
process.exitCode = fail ? 1 : 0;
