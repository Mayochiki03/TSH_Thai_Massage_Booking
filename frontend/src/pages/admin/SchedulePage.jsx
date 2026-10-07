/**
 * pages/admin/SchedulePage.jsx — รอบเวลาและตาราง
 *
 *  1) แม่แบบรอบเวลา (CRUD /api/admin/slot-templates) — เลือกเวลาด้วย TimePicker (24 ชม. ไม่มี AM/PM)
 *     แก้เวลาแล้วกด "ใช้กับวันถัดไป" → ระบบลบรอบที่ยังไม่มีใครจองตั้งแต่พรุ่งนี้ แล้วสร้างใหม่ตามแม่แบบ
 *  2) ตารางรายวัน (GET /api/admin/slots) — ดูสถานะทุกรอบของวันที่เลือก, ปิด/เปิดรับรายรอบหรือทั้งวัน
 */
import { useState } from 'react';
import { Plus, Trash2, Save, ChevronLeft, ChevronRight, Lock, LockOpen, RefreshCw, CalendarCog } from 'lucide-react';
import { staffApi } from '../../lib/api.js';
import { useLoad } from '../../lib/useLoad.js';
import { thaiDateLong, todayYmd, addDays, hhmm } from '../../lib/format.js';
import { Button, Card, PageHeader, Spinner, StatusBadge, useToast, useConfirm, cx } from '../../components/ui.jsx';
import { ClosureSheet } from '../../components/ClosureSheet.jsx';
import { TimePicker } from '../../components/TimePicker.jsx';

export function SchedulePage() {
  return (
    <>
      <PageHeader title="รอบเวลาและตาราง" description="กำหนดรอบเวลามาตรฐาน และปิด/เปิดรับรายวัน" />
      <div className="space-y-6">
        <Templates />
        <DaySlots />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------
// แม่แบบรอบเวลา
// ---------------------------------------------------------------------
function Templates() {
  const { data, setData, reload } = useLoad(() => staffApi('/admin/slot-templates').then((d) => d.templates), []);
  const [busy, setBusy] = useState(null);
  const toast = useToast();
  const confirm = useConfirm();

  /** แก้ค่าในแถว (ยังไม่บันทึก) */
  const edit = (i, patch) => setData(data.map((t, j) => (j === i ? { ...t, ...patch, _dirty: true } : t)));

  const save = async (t, i) => {
    setBusy(`save-${i}`);
    try {
      const body = { start_time: hhmm(t.start_time), end_time: hhmm(t.end_time), sort_order: i + 1, is_active: !!t.is_active };
      if (t.template_id) await staffApi(`/admin/slot-templates/${t.template_id}`, { method: 'PUT', body });
      else await staffApi('/admin/slot-templates', { method: 'POST', body });
      toast('บันทึกรอบเวลาแล้ว');
      reload();
    } catch (err) { toast(err.fields ? Object.values(err.fields)[0][0] : err.message, 'error'); }
    finally { setBusy(null); }
  };

  const remove = async (t, i) => {
    if (!t.template_id) return setData(data.filter((_, j) => j !== i));
    if (!(await confirm({ title: `ลบรอบ ${hhmm(t.start_time)}?`, body: 'รอบที่สร้างไว้แล้วในตารางจะยังอยู่ จนกว่าจะกด "ใช้กับวันถัดไป"', okText: 'ลบ', danger: true }))) return;
    try { await staffApi(`/admin/slot-templates/${t.template_id}`, { method: 'DELETE' }); reload(); }
    catch (err) { toast(err.message, 'error'); }
  };

  const apply = async () => {
    const ok = await confirm({
      title: 'ใช้แม่แบบกับวันถัดไป?',
      body: 'ระบบจะลบรอบตั้งแต่พรุ่งนี้ที่ยังไม่มีใครจอง แล้วสร้างใหม่ตามแม่แบบ รอบที่มีคนจองแล้วจะไม่ถูกแตะ',
      okText: 'ใช้แม่แบบ',
    });
    if (!ok) return;
    setBusy('apply');
    try {
      const r = await staffApi('/admin/slot-templates/apply', { method: 'POST' });
      toast(`สร้างรอบใหม่ ${r.created} รอบ${r.kept_with_bookings ? ` (คงรอบที่มีคนจองไว้ ${r.kept_with_bookings} รอบ)` : ''}`);
    } catch (err) { toast(err.message, 'error'); }
    finally { setBusy(null); }
  };

  const dirty = data?.some((t) => t._dirty);

  return (
    <Card
      title="แม่แบบรอบเวลา"
      description="รอบมาตรฐานของแต่ละวันทำการ"
      actions={<Button size="sm" variant="outline" icon={CalendarCog} loading={busy === 'apply'} disabled={dirty} onClick={apply}>ใช้กับวันถัดไป</Button>}
    >
      {!data ? <Spinner /> : (
        <>
          <ul className="divide-y divide-line">
            {data.map((t, i) => (
              <li key={t.template_id ?? `new-${i}`} className="flex flex-wrap items-center gap-3 py-3">
                <span className="w-8 font-display text-faint">{i + 1}</span>
                <TimePicker label={`รอบ ${i + 1} เวลาเริ่ม`} value={hhmm(t.start_time)} onChange={(v) => edit(i, { start_time: v })} />
                <span className="text-muted">ถึง</span>
                <TimePicker
                  label={`รอบ ${i + 1} เวลาสิ้นสุด`}
                  value={hhmm(t.end_time)}
                  onChange={(v) => edit(i, { end_time: v })}
                  invalid={hhmm(t.end_time) <= hhmm(t.start_time)}
                />
                <label className="flex items-center gap-2 text-[15px]">
                  <input type="checkbox" checked={!!t.is_active} onChange={(e) => edit(i, { is_active: e.target.checked })} className="size-5 accent-herb" />
                  เปิดใช้
                </label>
                <div className="ml-auto flex gap-1.5">
                  {(t._dirty || !t.template_id) && <Button size="sm" icon={Save} loading={busy === `save-${i}`} onClick={() => save(t, i)}>บันทึก</Button>}
                  <button type="button" onClick={() => remove(t, i)} className="grid size-9 place-items-center rounded-lg text-muted hover:bg-rose-soft hover:text-rose-ink" aria-label={`ลบรอบ ${hhmm(t.start_time)}`}>
                    <Trash2 className="size-[18px]" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="soft" icon={Plus} className="mt-3" onClick={() => setData([...data, { start_time: '16:30', end_time: '17:30', is_active: 1, _dirty: true }])}>
            เพิ่มรอบ
          </Button>
          {dirty && <p className="mt-3 text-[14px] text-clay">มีรอบที่ยังไม่บันทึก กดบันทึกให้ครบก่อนใช้กับวันถัดไป</p>}
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------
// ตารางรายวัน
// ---------------------------------------------------------------------
function DaySlots() {
  const [date, setDate] = useState(todayYmd());
  const [closure, setClosure] = useState(null);
  const toast = useToast();
  const { data, reload, loading } = useLoad(() => staffApi(`/admin/slots?from=${date}`).then((d) => d.slots), [date]);

  const unblock = async (slotIds) => {
    try { await staffApi('/admin/slots/unblock', { method: 'POST', body: { date, slot_ids: slotIds } }); toast('เปิดรับแล้ว'); reload(); }
    catch (err) { toast(err.message, 'error'); }
  };
  const generate = async () => {
    try { const r = await staffApi('/admin/slots/generate', { method: 'POST', body: {} }); toast(`สร้างรอบเพิ่ม ${r.created} รอบ`); reload(); }
    catch (err) { toast(err.message, 'error'); }
  };

  const anyBlocked = data?.some((s) => s.is_blocked);

  return (
    <Card
      title="ตารางรายวัน"
      description={thaiDateLong(date)}
      actions={
        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-line p-1">
          <button type="button" onClick={() => setDate(addDays(date, -1))} className="grid size-9 place-items-center rounded-lg text-muted hover:bg-sand" aria-label="วันก่อนหน้า"><ChevronLeft className="size-5" /></button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-9 rounded-lg px-2 text-[15px]" aria-label="เลือกวันที่" />
          <button type="button" onClick={() => setDate(addDays(date, 1))} className="grid size-9 place-items-center rounded-lg text-muted hover:bg-sand" aria-label="วันถัดไป"><ChevronRight className="size-5" /></button>
        </div>
      }
    >
      {loading && !data ? <Spinner /> : !data?.length ? (
        <div className="py-6 text-center">
          <p className="text-muted">วันนี้ยังไม่มีรอบเวลา (เสาร์–อาทิตย์ / วันหยุด / ยังไม่ได้สร้าง)</p>
          <Button size="sm" variant="soft" icon={RefreshCw} className="mt-3" onClick={generate}>สร้างรอบตามแม่แบบ</Button>
        </div>
      ) : (
        <>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {data.map((s) => (
              <li key={s.slot_id} className={cx('flex items-center gap-3 rounded-xl border px-4 py-3', s.is_blocked ? 'border-transparent bg-sand' : 'border-line')}>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[18px] font-semibold">{hhmm(s.start_time)}–{hhmm(s.end_time)}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[14px] text-muted">
                    {s.availability === 'TAKEN' ? <><StatusBadge status={s.status} className="text-[13px]" />{s.first_name} {s.last_name}</>
                      : s.availability === 'BLOCKED' ? <span className="text-clay">ปิดรับ{s.block_reason ? `: ${s.block_reason}` : ''}</span>
                        : s.availability === 'HOLIDAY' ? <span className="text-clay">วันหยุด</span>
                          : <StatusBadge status="AVAILABLE" className="text-[13px]" />}
                  </div>
                </div>
                {s.is_blocked ? (
                  <button type="button" onClick={() => unblock([s.slot_id])} className="grid size-10 place-items-center rounded-lg text-clay hover:bg-paper" aria-label={`เปิดรับรอบ ${hhmm(s.start_time)}`} title="เปิดรับรอบนี้">
                    <LockOpen className="size-5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setClosure({ title: `ปิดรับรอบ ${hhmm(s.start_time)}`, endpoint: '/admin/slots/block', body: { date, slot_ids: [s.slot_id] }, askReason: true })}
                    className="grid size-10 place-items-center rounded-lg text-muted hover:bg-sand hover:text-ink"
                    aria-label={`ปิดรับรอบ ${hhmm(s.start_time)}`}
                    title="ปิดรับรอบนี้"
                  >
                    <Lock className="size-5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" icon={Lock} onClick={() => setClosure({ title: 'ปิดรับทั้งวัน', endpoint: '/admin/slots/block', body: { date }, askReason: true, reasonLabel: 'เหตุผล (เช่น หมอนวดลาป่วย)' })}>
              ปิดรับทั้งวัน
            </Button>
            {anyBlocked && <Button size="sm" variant="ghost" icon={LockOpen} onClick={() => unblock(undefined)}>เปิดรับทั้งวัน</Button>}
          </div>
        </>
      )}
      <ClosureSheet request={closure} onClose={() => setClosure(null)} onDone={reload} />
    </Card>
  );
}
