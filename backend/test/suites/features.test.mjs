// API tests for v0.6 (beds, service types, national ID, practitioner, VN). Run against a fresh setup_dev DB.
const PUB = (process.env.TEST_PUBLIC_URL || 'http://127.0.0.1:4000') + '/api/public';
const INT = (process.env.TEST_INTERNAL_URL || 'http://127.0.0.1:4001') + '/api';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  → ' + extra : ''}`); };
const J = (x) => JSON.stringify(x).slice(0, 300);

/** valid Thai ID from 12-digit prefix */
function tid(prefix12) {
  let sum = 0; for (let i = 0; i < 12; i++) sum += Number(prefix12[i]) * (13 - i);
  return prefix12 + ((11 - (sum % 11)) % 10);
}
let seq = 100000000;
const newTid = () => tid(`1${String(seq++).padStart(11, '0')}`);

async function pub(method, path, user, body) {
  const r = await fetch(PUB + path, { method, headers: { 'Content-Type': 'application/json', ...(user && { 'X-Dev-Line-User': user }) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}
function session() {
  let cookie = '';
  const fn = async (method, path, body) => {
    const r = await fetch(INT + path, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, data: ct.includes('json') ? await r.json() : await r.arrayBuffer() };
  };
  fn.login = (u) => fn('POST', '/auth/login', { username: u, password: 'admin1234' });
  return fn;
}
const U1 = 'Udev00000000000000000000000000001';
const U2 = 'Udev00000000000000000000000000002';

// ---------------------------------------------------------------- setup
const admin = session(); await admin.login('dev');
const staff = session(); await staff.login('counter1');
const t1 = session(); await t1.login('therapist1');
const t2 = session(); await t2.login('therapist2');
const kiosk = session(); await kiosk.login('kiosk1');

// mother (patient 2) already has a booking tomorrow (H4TY7G) → cancel so the quota doesn't interfere
{ const h = (await staff('GET', '/staff/appointments/code/H4TY7G')).data; await staff('POST', `/staff/appointments/${h.appointment_id}/cancel`, { reason: 'test setup' }); }
let r = await pub('GET', '/config');
const services = r.data.service_types;
ok('config lists 2 service types, price hidden by default', services?.length === 2 && services[1].price === null && r.data.show_price === false, J(r.data));
const S1 = services[0].service_type_id, S2 = services[1].service_type_id;

r = await pub('GET', '/availability', U1);
const days = r.data.days;
const tomorrow = days.find((d, i) => i > 0 && d.slots.some((s) => s.status === 'AVAILABLE')) ?? days[days.length - 1];
const freeSlots = tomorrow.slots.filter((s) => s.status === 'AVAILABLE' && s.remaining === 2);
ok('availability has capacity/remaining (2 beds)', tomorrow.slots.every((s) => s.capacity === 2) && freeSlots.length >= 3, J(tomorrow.slots));

// ---------------------------------------------------------------- national ID (LINE)
r = await pub('GET', '/me', U1);
const self1 = r.data.patients.find((p) => p.is_self);
const mom = r.data.patients.find((p) => !p.is_self);
ok('/me exposes masked-ID fields only', self1 && 'has_national_id' in self1 && !('national_id_enc' in self1) && !('national_id_hash' in self1), J(self1));

r = await pub('POST', '/bookings', U1, { patient_id: self1.patient_id, slot_id: freeSlots[0].slot_id, service_type_id: S1 });
ok('booking patient without ID → NID_REQUIRED', r.status === 409 && r.data.error.code === 'NID_REQUIRED', J(r.data));

r = await pub('POST', '/bookings', U1, { patient_id: self1.patient_id, slot_id: freeSlots[0].slot_id, service_type_id: S1, national_id: '1234567890123' });
ok('invalid checksum → 400 field national_id', r.status === 400 && r.data.error.fields?.national_id, J(r.data));

r = await pub('POST', '/bookings', U1, { patient_id: self1.patient_id, slot_id: freeSlots[0].slot_id });
ok('missing service type → 400', r.status === 400, J(r.data));

const selfId = newTid();
r = await pub('POST', '/bookings', U1, { patient_id: self1.patient_id, slot_id: freeSlots[0].slot_id, service_type_id: S2, national_id: selfId.replace(/(\d)(\d{4})(\d{5})(\d{2})(\d)/, '$1-$2-$3-$4-$5') });
ok('booking with formatted ID + service → 201 + service in ticket (no price)', r.status === 201 && r.data.service?.name && r.data.service.price === null, J(r.data));
const codeA = r.data.booking_code;

r = await pub('GET', '/me', U1);
ok('ID saved on patient (masked)', r.data.patients.find((p) => p.is_self).national_id_masked === `x-xxxx-xxxx${selfId.slice(9, 10)}-${selfId.slice(10, 12)}-${selfId[12]}`, J(r.data.patients[0]));

// mother: booked by son, ID belongs to mother record
const momId = newTid();
r = await pub('POST', '/bookings', U1, { patient_id: mom.patient_id, slot_id: freeSlots[0].slot_id, service_type_id: S1, national_id: momId });
ok('son books mother in same slot (2nd bed) with MOTHER ID', r.status === 201, J(r.data));

r = await pub('POST', '/bookings', U2, { patient_id: (await pub('GET', '/me', U2)).data.patients[0].patient_id, slot_id: freeSlots[0].slot_id, service_type_id: S1, national_id: newTid() });
ok('3rd booking in 2-bed slot → SLOT_TAKEN (เต็ม)', r.status === 409 && r.data.error.code === 'SLOT_TAKEN', J(r.data));

r = await pub('POST', '/me/patients', U2, { first_name: 'คนใหม่', last_name: 'ไม่มีบัตร', phone_number: '0811112222', relation: 'บิดา' });
ok('add new person without ID → NID_REQUIRED', r.status === 400 && r.data.error.code === 'NID_REQUIRED', J(r.data));
r = await pub('POST', '/me/patients', U2, { first_name: 'คนอื่น', last_name: 'ชื่อไม่ตรง', phone_number: '0811112222', relation: 'บิดา', national_id: momId });
ok('someone else\'s ID with different name → NID_MISMATCH', r.status === 409 && r.data.error.code === 'NID_MISMATCH', J(r.data));
r = await pub('POST', '/me/patients', U2, { first_name: 'John', last_name: 'Smith', phone_number: '0811113333', relation: 'ญาติ', no_national_id: true });
ok('foreigner: no_national_id → ok', r.status === 201, J(r.data));
const momRow = (await pub('GET', '/me', U1)).data.patients.find((p) => !p.is_self);
r = await pub('POST', '/me/patients', U2, { first_name: momRow.first_name, last_name: momRow.last_name, phone_number: momRow.phone_number, relation: 'มารดา', national_id: momId });
const u2pats = (await pub('GET', '/me', U2)).data.patients;
ok('another booker adds same mother by ID → linked to SAME record', r.status === 201 && u2pats.some((p) => p.patient_id === mom.patient_id), J(u2pats));

// ---------------------------------------------------------------- concurrency (capacity 2)
const conSlot = freeSlots[1].slot_id;
const reqs = Array.from({ length: 6 }, (_, i) => staff('POST', '/staff/appointments', {
  slot_id: conSlot, channel: 'STAFF', service_type_id: S1, force: true,
  patient: { first_name: `พร้อม${i}`, last_name: 'กัน', phone_number: `08900000${10 + i}`, national_id: newTid() },
}));
const res = await Promise.all(reqs);
ok('6 parallel bookings into 2-bed slot → exactly 2 succeed', res.filter((x) => x.status === 201).length === 2 && res.filter((x) => x.data?.error?.code === 'SLOT_TAKEN').length === 4, J(res.map((x) => x.status)));

// same patient same slot (3rd slot)
const p3 = (await staff('GET', `/staff/patients/search?q=${encodeURIComponent('พร้อม0')}`)).data.results[0];
r = await staff('POST', '/staff/appointments', { slot_id: freeSlots[2].slot_id, channel: 'STAFF', service_type_id: S1, patient_id: p3.patient_id, force: true });
const r2 = await staff('POST', '/staff/appointments', { slot_id: freeSlots[2].slot_id, channel: 'STAFF', service_type_id: S1, patient_id: p3.patient_id, force: true });
ok('same patient twice in one slot → DUPLICATE', r.status === 201 && r2.data?.error?.code === 'DUPLICATE', J([r.status, r2.data]));

// ---------------------------------------------------------------- search by national ID
r = await staff('GET', `/staff/patients/search?q=${momId}`);
ok('counter search by 13-digit ID finds mother', r.data.results.length === 1 && r.data.results[0].patient_id === mom.patient_id && r.data.results[0].national_id_masked, J(r.data));
r = await staff('GET', `/staff/appointments/search?q=${momId}`);
ok('appointment search by ID', r.data.results.length >= 1, J(r.data));

// existing patient without ID at counter → must give ID with booking
const noId = (await admin('GET', '/admin/patients?limit=200')).data.patients.find((p) => !p.has_national_id && !p.no_national_id);
r = await staff('POST', '/staff/appointments', { slot_id: freeSlots[3].slot_id, channel: 'STAFF', service_type_id: S1, patient_id: noId.patient_id, force: true });
ok('counter: existing patient w/o ID → NID_REQUIRED', r.data?.error?.code === 'NID_REQUIRED', J(r.data));
r = await staff('POST', '/staff/appointments', { slot_id: freeSlots[3].slot_id, channel: 'STAFF', service_type_id: S2, patient_id: noId.patient_id, national_id: newTid(), force: true });
ok('counter: same with ID → 201', r.status === 201 && r.data.service?.price === 300, J(r.data));

// ---------------------------------------------------------------- check-in VN, practitioner start, complete
r = await staff('GET', '/staff/queue');
const q = r.data;
ok('queue: slots have capacity/remaining/appointments[]', q.slots.every((s) => Array.isArray(s.appointments) && 'remaining' in s) && 'capacity' in q.summary, J(q.summary));
const booked = q.slots.flatMap((s) => s.appointments).find((a) => a.status === 'BOOKED');
r = await staff('POST', `/staff/appointments/${booked.appointment_id}/checkin`, { force: true, vn: '690108101530' });
ok('check-in with VN', r.status === 200 && r.data.vn === '690108101530' && r.data.status === 'CHECKED_IN', J(r.data));
r = await staff('PATCH', `/staff/appointments/${booked.appointment_id}`, { vn: '690108101531' });
ok('counter edits VN', r.data.vn === '690108101531', J(r.data));
r = await staff('PATCH', `/staff/appointments/${booked.appointment_id}`, { vn: 'bad vn!' });
ok('bad VN → 400', r.status === 400, J(r.data));

r = await t1('GET', '/practitioner/queue');
ok('therapist queue: me + practitioners + service types', r.data.me === 1 && r.data.practitioners.length === 2 && r.data.service_types.length === 2, J({ me: r.data.me }));
const checkedIn = r.data.slots.flatMap((s) => s.appointments).filter((a) => a.status === 'CHECKED_IN');
r = await admin('POST', `/practitioner/appointments/${checkedIn[0].appointment_id}/start`, {});
ok('admin start without practitioner → 400', r.status === 400, J(r.data));
r = await t2('POST', `/practitioner/appointments/${checkedIn[0].appointment_id}/start`, { practitioner_id: 1 });
const a1 = (await t2('GET', '/practitioner/queue')).data.slots.flatMap((s) => s.appointments).find((a) => a.appointment_id === checkedIn[0].appointment_id);
ok('therapist2 starts → recorded as therapist2 (ignores body)', r.status === 200 && a1.practitioner?.practitioner_id === 2 && a1.status === 'IN_SERVICE', J(a1?.practitioner));
r = await t2('POST', `/practitioner/appointments/${checkedIn[0].appointment_id}/complete`, { treatment_details: 'นวดหลัง', vn: '690108999999', service_type_id: S2 });
const a2 = (await admin('GET', `/admin/appointments?q=${a1.booking_code}`)).data.appointments[0];
ok('complete with VN + change to ประคบ → price 300', r.status === 200 && a2.vn === '690108999999' && Number(a2.service_price) === 300 && a2.practitioner_name, J(a2));
r = await admin('POST', `/practitioner/appointments/${checkedIn[1].appointment_id}/start`, { practitioner_id: 1 });
const a3 = (await admin('GET', `/admin/appointments?practitioner_id=1`)).data.appointments;
ok('admin starts for therapist1 + filter by practitioner', r.status === 200 && a3.some((x) => x.appointment_id === checkedIn[1].appointment_id), J(a3.map((x) => x.booking_code)));

// ---------------------------------------------------------------- admin: service types
r = await admin('POST', '/admin/service-types', { name: 'นวดเท้า', price: 250, description: 'ทดสอบ' });
const S3 = r.data.service_type_id;
ok('create service type', r.status === 201, J(r.data));
r = await admin('PUT', `/admin/service-types/${S1}`, { name: services[0].name, price: 220, is_active: true });
const oldPrice = (await admin('GET', `/admin/appointments?q=${codeA}`)).data.appointments[0].service_price;
ok('change price: old booking keeps its price', r.status === 200 && Number(oldPrice) === 300, J(oldPrice));
r = await admin('DELETE', `/admin/service-types/${S1}`);
ok('delete used type → IN_USE', r.status === 409 && r.data.error.code === 'IN_USE', J(r.data));
r = await admin('DELETE', `/admin/service-types/${S3}`);
ok('delete unused type → ok', r.status === 200, J(r.data));
await admin('PUT', `/admin/service-types/${S2}`, { name: services[1].name, price: 300, is_active: false });
r = await admin('PUT', `/admin/service-types/${S1}`, { name: services[0].name, price: 220, is_active: false });
ok('deactivate last active type → LAST_ACTIVE', r.status === 409 && r.data.error.code === 'LAST_ACTIVE', J(r.data));
await admin('PUT', `/admin/service-types/${S2}`, { name: services[1].name, price: 300, is_active: true });
r = await pub('POST', '/bookings', U1, { patient_id: self1.patient_id, slot_id: freeSlots[4]?.slot_id ?? freeSlots[3].slot_id, service_type_id: S3 });
ok('booking deleted/unknown type → 400', r.status === 400 || r.status === 409, J(r.data));

// ---------------------------------------------------------------- admin: beds
r = await admin('PUT', '/admin/settings', { bed_count: 3 });
const avail3 = (await pub('GET', '/availability', U1)).data.days.flatMap((d) => d.slots);
ok('bed_count=3 → future slots capacity 3', r.status === 200 && avail3.every((s) => s.capacity >= 3), J(avail3.map((s) => s.capacity)));
r = await admin('PUT', '/admin/settings', { bed_count: 0 });
ok('bed_count=0 → 400', r.status === 400, J(r.data));
r = await admin('PUT', `/admin/slots/${conSlot}/capacity`, { capacity: 1 });
ok('slot capacity below booked → BELOW_BOOKED', r.status === 409 && r.data.error.code === 'BELOW_BOOKED', J(r.data));
r = await admin('PUT', `/admin/slots/${conSlot}/capacity`, { capacity: 2 });
ok('slot capacity = booked → ok', r.status === 200, J(r.data));
r = await admin('GET', `/admin/slots?from=${tomorrow.date}`);
const sl = r.data.slots.find((s) => s.slot_id === conSlot);
ok('admin slots list: booked_count + appointments names', sl.booked_count === 2 && sl.appointments.length === 2 && sl.availability === 'FULL', J(sl));

// revive cancelled when full
const cancelTarget = sl.appointments[0];
await staff('POST', `/staff/appointments/${cancelTarget.appointment_id}/cancel`, { reason: 'ทดสอบ' });
await staff('POST', '/staff/appointments', { slot_id: conSlot, channel: 'STAFF', service_type_id: S1, force: true, patient: { first_name: 'แทน', last_name: 'ที่', phone_number: '0890000099', national_id: newTid() } });
r = await admin('PATCH', `/admin/appointments/${cancelTarget.appointment_id}`, { status: 'BOOKED' });
ok('revive cancelled into full slot → SLOT_TAKEN', r.status === 409 && r.data.error.code === 'SLOT_TAKEN', J(r.data));
r = await admin('PATCH', `/admin/appointments/${cancelTarget.appointment_id}`, { vn: 'VN-1', practitioner_id: 2 });
ok('admin edits VN + practitioner', r.status === 200, J(r.data));

// ---------------------------------------------------------------- admin: patients ID
r = await admin('GET', `/admin/patients?q=${momId}`);
ok('admin patient search by ID, masked in list', r.data.patients.length === 1 && !r.data.patients[0].national_id && !r.data.patients[0].national_id_enc && r.data.patients[0].national_id_masked, J(r.data.patients[0]));
r = await admin('GET', `/admin/patients/${mom.patient_id}`);
ok('admin patient detail shows full ID', r.data.patient.national_id === momId, J(r.data.patient));
r = await admin('POST', '/admin/patients', { first_name: 'แอด', last_name: 'มิน', phone_number: '0899999999' });
ok('admin create without ID → NID_REQUIRED', r.status === 400 && r.data.error.code === 'NID_REQUIRED', J(r.data));
r = await admin('PUT', `/admin/patients/${self1.patient_id}`, { first_name: self1.first_name, last_name: self1.last_name, phone_number: self1.phone_number, national_id: momId });
ok('admin set ID taken by another → NID_TAKEN', r.status === 409 && r.data.error.code === 'NID_TAKEN', J(r.data));

// ---------------------------------------------------------------- kiosk
r = await kiosk('GET', '/kiosk/config');
ok('kiosk config has service types', r.data.service_types?.length >= 2, J(r.data));
r = await kiosk('POST', '/kiosk/patients/lookup', { phone_number: '0855555555' });
const kp = r.data.results?.[0];
ok('kiosk lookup flags needs_national_id', kp && typeof kp.needs_national_id === 'boolean', J(r.data));
const kAvail = (await kiosk('GET', '/kiosk/availability')).data.days.flatMap((d) => d.slots.map((s) => ({ ...s, date: d.date }))).filter((s) => s.status === 'AVAILABLE' && s.date === tomorrow.date);
if (kp?.needs_national_id) {
  r = await kiosk('POST', '/kiosk/bookings', { slot_id: kAvail[kAvail.length - 1].slot_id, patient_id: kp.patient_id, phone_number: '0855555555', service_type_id: S1 });
  ok('kiosk booking w/o ID → NID_REQUIRED', r.data?.error?.code === 'NID_REQUIRED', J(r.data));
}
r = await kiosk('POST', '/kiosk/bookings', { slot_id: kAvail[kAvail.length - 1].slot_id, patient_id: kp.patient_id, phone_number: '0855555555', service_type_id: S2, national_id: newTid() });
ok('kiosk booking with ID → 201 + service', r.status === 201 && r.data.service?.name, J(r.data));

// ---------------------------------------------------------------- dashboard / report
r = await admin('GET', '/admin/dashboard');
ok('dashboard counts beds, NO revenue', r.status === 200 && r.data.today.slots >= 6 && !('revenue' in r.data.last30), J(r.data.today));
r = await admin('GET', `/admin/reports/bookings.xlsx?from=${days[0].date}&to=${tomorrow.date}&practitioner_id=2`);
ok('report with practitioner filter → xlsx', r.status === 200 && r.data.byteLength > 5000, J(r.status));

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
