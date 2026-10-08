/**
 * pages/admin/AppointmentsPage.jsx — การจองทั้งหมด (GET /api/admin/appointments)
 *
 * กรองตามช่วงวัน / สถานะ / หมอนวด / คำค้น (รหัสจอง ชื่อ เบอร์ HN VN เลขบัตร 13 หลัก)
 * แต่ละแถวแสดง บริการ+ราคา, หมอนวดที่นวดจริง, VN
 * กดแถว (หรือปุ่มดินสอ) → แก้ VN / หมอนวด / ประเภทบริการ / สถานะ ย้อนหลังได้ (PATCH, บันทึกใน audit log)
 *  - เปลี่ยนสถานะคิวที่ยกเลิก/ไม่มา กลับมา → ถ้ารอบนั้นเต็มแล้ว ระบบไม่ยอม
 *  - เปลี่ยนประเภทบริการ → ราคาเปลี่ยนเป็นราคาปัจจุบันของประเภทใหม่
 */
import { useEffect, useState } from 'react';
import { Search, Pencil } from 'lucide-react';
import { staffApi } from '../../lib/api.js';
import { useLoad } from '../../lib/useLoad.js';
import { thaiDate, thaiDateLong, hhmm, todayYmd, addDays, STATUS, baht } from '../../lib/format.js';
import { Card, Field, Input, PageHeader, Select, Sheet, Spinner, Empty, Button, StatusBadge, useToast, useConfirm } from '../../components/ui.jsx';

const CHANNEL = { ONLINE: 'LINE', KIOSK: 'kiosk', WALK_IN: 'walk-in', STAFF: 'จองแทน' };
const STATUSES = ['BOOKED', 'CHECKED_IN', 'IN_SERVICE', 'COMPLETED', 'NO_SHOW', 'CANCELLED'];

export function AppointmentsPage() {
  const [f, setF] = useState({ from: addDays(todayYmd(), -7), to: addDays(todayYmd(), 7), status: '', practitioner_id: '', q: '' });
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState(null);

  // รายชื่อหมอนวด + ประเภทบริการ (ใช้ทั้งตัวกรองและหน้าแก้ไข)
  const { data: lookups } = useLoad(() => Promise.all([
    staffApi('/admin/practitioners').then((d) => d.practitioners),
    staffApi('/admin/service-types').then((d) => d.service_types),
  ]).then(([practitioners, services]) => ({ practitioners, services })), []);

  useEffect(() => { const t = setTimeout(() => { setOffset(0); setF((x) => ({ ...x, q: q.trim() })); }, 300); return () => clearTimeout(t); }, [q]);

  const set = (patch) => { setOffset(0); setF({ ...f, ...patch }); };
  const qs = new URLSearchParams({
    limit: 50, offset,
    ...(f.from && { from: f.from }), ...(f.to && { to: f.to }), ...(f.status && { status: f.status }),
    ...(f.practitioner_id && { practitioner_id: f.practitioner_id }), ...(f.q && { q: f.q }),
  });
  const { data, reload } = useLoad(() => staffApi(`/admin/appointments?${qs}`), [qs.toString()]);

  return (
    <>
      <PageHeader title="การจองทั้งหมด" description="ค้นหา แก้สถานะ / VN / หมอนวด / ประเภทบริการย้อนหลัง" />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_180px_180px]">
        <label className="relative sm:col-span-2 lg:col-span-1">
          <span className="sr-only">ค้นหา</span>
          <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-faint" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="รหัสจอง ชื่อ เบอร์ HN VN หรือเลขบัตร" className="pl-12" />
        </label>
        <Input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} aria-label="ตั้งแต่วันที่" />
        <Input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} aria-label="ถึงวันที่" />
        <Select value={f.status} onChange={(e) => set({ status: e.target.value })} aria-label="สถานะ">
          <option value="">ทุกสถานะ</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
        </Select>
        <Select value={f.practitioner_id} onChange={(e) => set({ practitioner_id: e.target.value })} aria-label="หมอนวด">
          <option value="">หมอนวดทุกคน</option>
          {lookups?.practitioners.map((p) => <option key={p.practitioner_id} value={p.practitioner_id}>{p.full_name}</option>)}
        </Select>
      </div>

      <Card bodyClassName="p-0">
        {!data ? <Spinner /> : !data.appointments.length ? <Empty title="ไม่พบการจองตามเงื่อนไข" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-[15px]">
              <thead className="border-b border-line text-[14px] text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">วัน-เวลา</th>
                  <th className="px-3 py-3 font-medium">รหัส</th>
                  <th className="px-3 py-3 font-medium">ผู้รับบริการ</th>
                  <th className="px-3 py-3 font-medium">บริการ</th>
                  <th className="px-3 py-3 font-medium">หมอนวด / VN</th>
                  <th className="px-3 py-3 font-medium">ช่องทาง</th>
                  <th className="px-3 py-3 font-medium">สถานะ</th>
                  <th className="w-12 px-3 py-3"><span className="sr-only">แก้ไข</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.appointments.map((a) => (
                  <tr key={a.appointment_id} className="cursor-pointer hover:bg-ivory" onClick={() => setEditing(a)}>
                    <td className="px-5 py-2.5 whitespace-nowrap">{thaiDate(a.slot_date)} <span className="tabular-nums">{hhmm(a.start_time)}</span></td>
                    <td className="px-3 py-2.5 font-display tracking-wider">{a.booking_code}</td>
                    <td className="px-3 py-2.5">
                      {a.first_name} {a.last_name}
                      <div className="text-[13px] text-muted">
                        {a.hn ?? 'บุคคลทั่วไป'} / {a.phone_number}
                        {!a.has_national_id && !a.no_national_id && <span className="ml-1 text-clay">· ยังไม่มีเลขบัตร</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">{a.service_name ?? '-'}<div className="text-[13px] text-muted tabular-nums">{baht(a.service_price)}</div></td>
                    <td className="px-3 py-2.5">
                      {a.practitioner_name ?? <span className="text-faint">-</span>}
                      <div className="text-[13px] tabular-nums text-muted">{a.vn ? `VN ${a.vn}` : a.status === 'COMPLETED' ? <span className="text-clay">ยังไม่มี VN</span> : ''}</div>
                    </td>
                    <td className="px-3 py-2.5">{CHANNEL[a.booking_channel]}{a.booker_relation && a.booker_relation !== 'ตนเอง' ? <div className="text-[13px] text-muted">{a.booker_line_name} ({a.booker_relation})</div> : null}</td>
                    <td className="px-3 py-2.5"><StatusBadge status={a.status} /></td>
                    <td className="px-3 py-2.5">
                      <button type="button" className="grid size-9 place-items-center rounded-lg text-muted hover:bg-sand" aria-label={`แก้ไข ${a.booking_code}`}><Pencil className="size-[18px]" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {data && data.total > 50 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-[15px] text-muted">
          <span>{offset + 1}–{Math.min(offset + 50, data.total)} จาก {data.total}</span>
          <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(offset - 50)}>ก่อนหน้า</Button>
          <Button size="sm" variant="outline" disabled={offset + 50 >= data.total} onClick={() => setOffset(offset + 50)}>ถัดไป</Button>
        </div>
      )}

      <EditSheet appt={editing} lookups={lookups} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
    </>
  );
}

/** แก้ไขคิวย้อนหลัง: ส่งเฉพาะช่องที่เปลี่ยน */
function EditSheet({ appt, lookups, onClose, onSaved }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    if (appt) setForm({ status: appt.status, vn: appt.vn ?? '', practitioner_id: appt.practitioner_id ?? '', service_type_id: appt.service_type_id ?? '' });
  }, [appt]);

  if (!appt || !form) return null;

  const body = {};
  if (form.status !== appt.status) body.status = form.status;
  if ((form.vn.trim().toUpperCase() || null) !== (appt.vn ?? null)) body.vn = form.vn.trim() || null;
  if (String(form.practitioner_id) !== String(appt.practitioner_id ?? '')) body.practitioner_id = form.practitioner_id ? Number(form.practitioner_id) : null;
  if (form.service_type_id && String(form.service_type_id) !== String(appt.service_type_id ?? '')) body.service_type_id = Number(form.service_type_id);
  const changed = Object.keys(body).length > 0;

  const newService = lookups?.services.find((s) => String(s.service_type_id) === String(form.service_type_id));

  const save = async () => {
    if (body.status) {
      const ok = await confirm({ title: `เปลี่ยนสถานะ ${appt.booking_code}?`, body: `${STATUS[appt.status].label} → ${STATUS[body.status].label} (บันทึกในประวัติการใช้งาน)`, okText: 'เปลี่ยนสถานะ' });
      if (!ok) return;
    }
    setSaving(true);
    try {
      await staffApi(`/admin/appointments/${appt.appointment_id}`, { method: 'PATCH', body });
      toast('บันทึกแล้ว');
      onSaved();
    } catch (err) {
      toast(err.fields ? Object.values(err.fields)[0][0] : err.message, 'error');
    } finally { setSaving(false); }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={`แก้ไขคิว ${appt.booking_code}`}
      footer={<Button className="w-full" disabled={!changed} loading={saving} onClick={save}>บันทึก</Button>}
    >
      <div className="mb-4 rounded-2xl bg-ivory p-4 text-[15px]">
        <div className="font-medium">{appt.first_name} {appt.last_name}</div>
        <div className="text-muted">{thaiDateLong(appt.slot_date)} · {hhmm(appt.start_time)}–{hhmm(appt.end_time)}</div>
      </div>
      <div className="space-y-4">
        <Field label="สถานะ">
          <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
          </Select>
        </Field>
        <Field label="VN (เลขที่รับบริการ)" hint="ใช้เบิกจ่าย · ตัวอักษร ตัวเลข / และ - ไม่เกิน 20 ตัว">
          <Input value={form.vn} onChange={(e) => setForm({ ...form, vn: e.target.value.toUpperCase() })} maxLength={20} autoComplete="off" className="font-display tracking-wide" />
        </Field>
        <Field label="หมอนวด">
          <Select value={form.practitioner_id} onChange={(e) => setForm({ ...form, practitioner_id: e.target.value })}>
            <option value="">— ยังไม่ระบุ —</option>
            {lookups?.practitioners.map((p) => (
              <option key={p.practitioner_id} value={p.practitioner_id}>{p.full_name}{p.is_active ? '' : ' (ปิดใช้งาน)'}</option>
            ))}
          </Select>
        </Field>
        <Field
          label="ประเภทบริการ"
          hint={body.service_type_id && newService ? `ราคาจะเปลี่ยนเป็น ${baht(newService.price)} (ราคาปัจจุบัน)` : `ราคาที่บันทึกไว้ ${baht(appt.service_price)}`}
        >
          <Select value={form.service_type_id} onChange={(e) => setForm({ ...form, service_type_id: e.target.value })}>
            {!appt.service_type_id && <option value="">— ไม่ระบุ —</option>}
            {lookups?.services.map((s) => (
              <option key={s.service_type_id} value={s.service_type_id}>{s.name} · {baht(s.price)}{s.is_active ? '' : ' (ปิดใช้งาน)'}</option>
            ))}
          </Select>
        </Field>
      </div>
    </Sheet>
  );
}
