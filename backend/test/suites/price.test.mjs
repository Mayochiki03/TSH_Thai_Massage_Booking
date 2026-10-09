// v0.6.1: show_price switch
const PUB = (process.env.TEST_PUBLIC_URL || 'http://127.0.0.1:4000') + '/api/public';
const INT = (process.env.TEST_INTERNAL_URL || 'http://127.0.0.1:4001') + '/api';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && x ? '  → ' + x : ''}`); };
let cookie = '';
const api = async (m, p, b) => { const r = await fetch(INT + p, { method: m, headers: { 'Content-Type': 'application/json', cookie }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return { status: r.status, data: await r.json().catch(() => null) }; };
const pub = async (p, u = 'Udev00000000000000000000000000001') => (await fetch(PUB + p, { headers: { 'X-Dev-Line-User': u } })).json();
await api('POST', '/auth/login', { username: 'admin', password: 'admin1234' });
let s = await api('GET', '/admin/settings');
ok('show_price setting exists, default false', s.data.settings.find((x) => x.key === 'show_price')?.value === false);
let c = await pub('/config');
ok('public config: prices null', c.service_types.every((t) => t.price === null));
let my = await pub('/bookings?scope=upcoming');
ok('my bookings: no price', my.bookings?.length > 0 && my.bookings.every((b) => !b.service || b.service.price === null), JSON.stringify(my).slice(0, 200));
const st = await api('GET', '/staff/service-types');
ok('staff still sees prices', st.data.service_types?.every((t) => typeof t.price === 'number'), JSON.stringify(st.data).slice(0, 200));
const ad = await api('GET', '/admin/service-types');
ok('admin still sees prices', ad.data.service_types.every((t) => typeof t.price === 'number'));
// turn on
let r = await api('PUT', '/admin/settings', { show_price: true });
ok('turn on → 200', r.status === 200);
c = await pub('/config');
ok('public config: prices shown', c.show_price === true && c.service_types.every((t) => typeof t.price === 'number'), JSON.stringify(c.service_types));
my = await pub('/bookings?scope=upcoming');
ok('my bookings: price shown', my.bookings.some((b) => typeof b.service?.price === 'number'));
await api('PUT', '/admin/settings', { show_price: false });
c = await pub('/config');
ok('turn off again → hidden immediately', c.service_types.every((t) => t.price === null));
// template cleanup regex (same as notify.js)
const clean = (t) => t.replace(/[ \t]*\(\s*\)/g, '');
ok('template "บริการ: X ()" → "บริการ: X"', clean('บริการ: นวดแผนไทย ()\nวันที่: 1') === 'บริการ: นวดแผนไทย\nวันที่: 1');
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
