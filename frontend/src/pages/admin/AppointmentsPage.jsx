/**
 * pages/admin/AppointmentsPage.jsx — การจองทั้งหมด (GET /api/admin/appointments)
 *
 * กรองตามช่วงวัน / สถานะ / คำค้น (รหัสจอง ชื่อ เบอร์ HN)
 * แก้สถานะด้วยมือได้ (PATCH) สำหรับกรณีกดผิดหน้างาน — ถ้ารอบนั้นมีคิวอื่นแทนแล้วระบบจะไม่ยอม
 */
import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { staffApi } from '../../lib/api.js';
import { useLoad } from '../../lib/useLoad.js';
import { thaiDate, hhmm, todayYmd, addDays, STATUS } from '../../lib/format.js';
import { Card, Input, PageHeader, Select, Spinner, Empty, Button, useToast, useConfirm } from '../../components/ui.jsx';

const CHANNEL = { ONLINE: 'LINE', KIOSK: 'kiosk', WALK_IN: 'walk-in', STAFF: 'จองแทน' };
const STATUSES = ['BOOKED', 'CHECKED_IN', 'IN_SERVICE', 'COMPLETED', 'NO_SHOW', 'CANCELLED'];

export function AppointmentsPage() {
  const [f, setF] = useState({ from: addDays(todayYmd(), -7), to: addDays(todayYmd(), 7), status: '', q: '' });
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => { const t = setTimeout(() => { setOffset(0); setF((x) => ({ ...x, q: q.trim() })); }, 300); return () => clearTimeout(t); }, [q]);

  const qs = new URLSearchParams({ limit: 50, offset, ...(f.from && { from: f.from }), ...(f.to && { to: f.to }), ...(f.status && { status: f.status }), ...(f.q && { q: f.q }) });
  const { data, reload } = useLoad(() => staffApi(`/admin/appointments?${qs}`), [qs.toString()]);

  const changeStatus = async (a, status) => {
    if (status === a.status) return;
    const ok = await confirm({ title: `เปลี่ยนสถานะ ${a.booking_code}?`, body: `${STATUS[a.status].label} → ${STATUS[status].label} (บันทึกในประวัติการใช้งาน)`, okText: 'เปลี่ยนสถานะ' });
    if (!ok) return reload();
    try { await staffApi(`/admin/appointments/${a.appointment_id}`, { method: 'PATCH', body: { status } }); toast('เปลี่ยนสถานะแล้ว'); }
    catch (err) { toast(err.message, 'error'); }
    reload();
  };

  return (
    <>
      <PageHeader title="การจองทั้งหมด" description="ค้นหาและแก้สถานะคิวย้อนหลัง" />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_200px]">
        <label className="relative">
          <span className="sr-only">ค้นหา</span>
          <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-faint" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="รหัสจอง ชื่อ เบอร์ หรือ HN" className="pl-12" />
        </label>
        <Input type="date" value={f.from} onChange={(e) => { setOffset(0); setF({ ...f, from: e.target.value }); }} aria-label="ตั้งแต่วันที่" />
        <Input type="date" value={f.to} onChange={(e) => { setOffset(0); setF({ ...f, to: e.target.value }); }} aria-label="ถึงวันที่" />
        <Select value={f.status} onChange={(e) => { setOffset(0); setF({ ...f, status: e.target.value }); }} aria-label="สถานะ">
          <option value="">ทุกสถานะ</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
        </Select>
      </div>

      <Card bodyClassName="p-0">
        {!data ? <Spinner /> : !data.appointments.length ? <Empty title="ไม่พบการจองตามเงื่อนไข" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-[15px]">
              <thead className="border-b border-line text-[14px] text-muted">
                <tr><th className="px-5 py-3 font-medium">วัน-เวลา</th><th className="px-3 py-3 font-medium">รหัส</th><th className="px-3 py-3 font-medium">ผู้รับบริการ</th><th className="px-3 py-3 font-medium">ช่องทาง</th><th className="px-5 py-3 font-medium">สถานะ</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.appointments.map((a) => (
                  <tr key={a.appointment_id}>
                    <td className="px-5 py-2.5 whitespace-nowrap">{thaiDate(a.slot_date)} <span className="tabular-nums">{hhmm(a.start_time)}</span></td>
                    <td className="px-3 py-2.5 font-display tracking-wider">{a.booking_code}</td>
                    <td className="px-3 py-2.5">{a.first_name} {a.last_name}<div className="text-[13px] text-muted">{a.hn ?? 'บุคคลทั่วไป'} / {a.phone_number}</div></td>
                    <td className="px-3 py-2.5">{CHANNEL[a.booking_channel]}{a.booker_relation && a.booker_relation !== 'ตนเอง' ? <div className="text-[13px] text-muted">{a.booker_line_name} ({a.booker_relation})</div> : null}</td>
                    <td className="px-5 py-2.5">
                      <Select value={a.status} onChange={(e) => changeStatus(a, e.target.value)} className="h-10 w-40 text-[15px]" aria-label={`สถานะ ${a.booking_code}`}>
                        {STATUSES.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
                      </Select>
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
    </>
  );
}
