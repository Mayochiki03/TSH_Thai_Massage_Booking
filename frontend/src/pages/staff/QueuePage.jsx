/**
 * pages/staff/QueuePage.jsx — หน้าคิววันนี้ของเคาน์เตอร์ (/staff/queue)
 *   - ช่องเช็กอิน: พิมพ์รหัสจอง (6 ตัว) หรือค้นจากชื่อ/เบอร์/HN → หน้าต่างเช็กอิน (เตือนถ้ามาเร็ว/สาย)
 *   - ไทม์ไลน์ทุกรอบของวัน: สถานะ, ผู้จอง (LINE / ลูกจองให้แม่ / walk-in), อาการ
 *   - รอบว่าง: รับ walk-in (เช็กอินให้ทันที) หรือจองแทนทางโทรศัพท์
 *   - อัปเดตเองทุก 20 วินาที
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Search, UserPlus, PhoneCall, MoreHorizontal, RefreshCw,
  MessageCircle, CircleDashed, Ban, CalendarOff, TriangleAlert, History,
} from 'lucide-react';
import { staffApi } from '../../lib/api.js';
import { thaiDateLong, todayYmd, addDays, relativeDay, timeOf, thaiDate } from '../../lib/format.js';
import { Button, Sheet, Spinner, StatusBadge, Input, Field, Textarea, useToast, useConfirm, cx } from '../../components/ui.jsx';
import { PersonForm, emptyPerson, validatePerson, fieldErrors, toPayload } from '../patient/PersonForm.jsx';

const DOT = {
  AVAILABLE: 'bg-paper border-2 border-herb', BOOKED: 'bg-sky-ink', CHECKED_IN: 'bg-herb', IN_SERVICE: 'bg-turmeric',
  COMPLETED: 'bg-faint', BLOCKED: 'bg-line', HOLIDAY: 'bg-line',
};

export function QueuePage() {
  const [date, setDate] = useState(todayYmd());
  const [data, setData] = useState(null);
  const [lookup, setLookup] = useState('');
  const [checkIn, setCheckIn] = useState(null);    // appointment (+ slot info)
  const [results, setResults] = useState(null);    // ผลค้นหา
  const [booking, setBooking] = useState(null);    // { slot, channel }
  const [searching, setSearching] = useState(false);
  const toast = useToast();
  const isToday = date === todayYmd();

  const load = useCallback(async () => {
    try { setData(await staffApi(`/staff/queue?date=${date}`)); }
    catch (err) { toast(err.message, 'error'); }
  }, [date, toast]);

  useEffect(() => { setData(null); load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 20_000); // หน้าจอเคาน์เตอร์อัปเดตเอง
    return () => clearInterval(t);
  }, [load]);

  const doLookup = async (e) => {
    e.preventDefault();
    const q = lookup.trim();
    if (q.length < 2) return;
    setSearching(true);
    try {
      if (/^[A-Za-z0-9]{6}$/.test(q)) {
        try {
          const a = await staffApi(`/staff/appointments/code/${q.toUpperCase()}`);
          setCheckIn(a); setLookup(''); return;
        } catch (err) { if (err.status !== 404) throw err; }
      }
      const r = await staffApi(`/staff/appointments/search?q=${encodeURIComponent(q)}`);
      if (r.results.length === 1) { setCheckIn(r.results[0]); setLookup(''); }
      else setResults({ q, list: r.results });
    } catch (err) { toast(err.message, 'error'); }
    finally { setSearching(false); }
  };

  const summary = data?.summary ?? {};
  const waiting = (summary.BOOKED ?? 0);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
      {/* หัว + เลือกวัน */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold">{isToday ? 'คิววันนี้' : relativeDay(date) ? `คิว${relativeDay(date)}` : 'คิวรายวัน'}</h1>
          <p className="text-muted">{thaiDateLong(date)}</p>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-line bg-paper p-1">
          <button type="button" onClick={() => setDate(addDays(date, -1))} className="grid size-10 place-items-center rounded-lg text-muted hover:bg-sand" aria-label="วันก่อนหน้า"><ChevronLeft className="size-5" /></button>
          <button type="button" onClick={() => setDate(todayYmd())} disabled={isToday} className="h-10 rounded-lg px-3 font-display text-[15px] font-medium disabled:text-faint hover:bg-sand">วันนี้</button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-10 rounded-lg px-2 text-[15px] hover:bg-sand" aria-label="เลือกวันที่" />
          <button type="button" onClick={() => setDate(addDays(date, 1))} className="grid size-10 place-items-center rounded-lg text-muted hover:bg-sand" aria-label="วันถัดไป"><ChevronRight className="size-5" /></button>
        </div>
      </div>

      {/* ช่องเช็กอิน */}
      <form onSubmit={doLookup} className="mt-6 flex gap-2 rounded-2xl bg-herb p-2 sm:p-3">
        <label className="relative flex-1">
          <span className="sr-only">รหัสจอง ชื่อ เบอร์โทร หรือ HN</span>
          <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-faint" aria-hidden />
          <input
            value={lookup}
            onChange={(e) => setLookup(e.target.value)}
            placeholder="พิมพ์รหัสจอง ชื่อ เบอร์โทร หรือ HN"
            className="h-14 w-full rounded-xl bg-paper pr-4 pl-12 font-display text-[19px] tracking-wide placeholder:font-sans placeholder:text-[16px] placeholder:tracking-normal placeholder:text-faint focus:outline-none focus:ring-4 focus:ring-leaf"
            autoComplete="off"
          />
        </label>
        <Button type="submit" size="lg" variant="soft" loading={searching} className="bg-leaf hover:bg-white">เช็กอิน</Button>
      </form>

      {/* สรุป */}
      {data && (
        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[15px] text-muted">
          <span>ว่าง <b className="font-display text-ink">{summary.AVAILABLE ?? 0}</b></span>
          <span>รอเช็กอิน <b className="font-display text-ink">{waiting}</b></span>
          <span>มาถึงแล้ว <b className="font-display text-ink">{(summary.CHECKED_IN ?? 0) + (summary.IN_SERVICE ?? 0)}</b></span>
          <span>เสร็จ <b className="font-display text-ink">{summary.COMPLETED ?? 0}</b></span>
          <button type="button" onClick={load} className="ml-auto flex items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-paper hover:text-ink" aria-label="รีเฟรช">
            <RefreshCw className="size-4" aria-hidden />อัปเดตอัตโนมัติ
          </button>
        </div>
      )}

      {/* ไทม์ไลน์ */}
      {!data ? <Spinner /> : !data.slots.length ? (
        <div className="mt-6 rounded-2xl bg-paper px-6 py-14 text-center">
          <CalendarOff className="mx-auto mb-3 size-10 text-faint" strokeWidth={1.5} aria-hidden />
          <p className="font-display text-lg font-medium">วันนี้ไม่มีรอบบริการ</p>
          <p className="text-muted">วันเสาร์–อาทิตย์ วันหยุด หรือยังไม่ได้สร้างรอบ</p>
        </div>
      ) : (
        <ol className="relative mt-4">
          <span className="absolute top-6 bottom-6 left-[84px] w-px bg-line sm:left-[100px]" aria-hidden />
          {data.slots.map((s) => (
            <SlotRow
              key={s.slot_id}
              slot={s}
              isPast={s.mins_until < -60}
              onCheckIn={(a) => setCheckIn({ ...a, slot_date: s.slot_date, start_time: s.start_time, end_time: s.end_time })}
              onBook={(channel) => setBooking({ slot: s, channel })}
              reload={load}
            />
          ))}
        </ol>
      )}

      <CheckInSheet appt={checkIn} onClose={() => setCheckIn(null)} onDone={load} />
      <SearchResults results={results} onClose={() => setResults(null)} onPick={(a) => { setResults(null); setCheckIn(a); }} />
      <BookForSheet ctx={booking} onClose={() => setBooking(null)} onDone={load} />
    </div>
  );
}

// ---------------------------------------------------------------------
function SlotRow({ slot: s, isPast, onCheckIn, onBook, reload }) {
  const a = s.appointment;
  const [showHistory, setShowHistory] = useState(false);
  const [menu, setMenu] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e) => !menuRef.current?.contains(e.target) && setMenu(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);

  const act = async (kind) => {
    setMenu(false);
    const name = `${a.patient.first_name} ${a.patient.last_name}`;
    const ok = await confirm(kind === 'cancel'
      ? { title: `ยกเลิกคิวของ ${name}?`, body: 'รอบนี้จะว่างให้รับ walk-in หรือจองใหม่ได้', okText: 'ยกเลิกคิว', danger: true }
      : { title: `บันทึกว่า ${name} ไม่มาตามนัด?`, body: 'ใช้นับเกณฑ์ระงับสิทธิ์การจอง และปล่อยรอบให้ walk-in', okText: 'ไม่มาตามนัด', danger: true });
    if (!ok) return;
    try {
      await staffApi(`/staff/appointments/${a.appointment_id}/${kind === 'cancel' ? 'cancel' : 'no-show'}`, { method: 'POST', body: {} });
      toast(kind === 'cancel' ? 'ยกเลิกคิวแล้ว' : 'บันทึกไม่มาตามนัดแล้ว');
      reload();
    } catch (err) { toast(err.message, 'error'); }
  };

  return (
    <li className="relative flex gap-4 py-2 sm:gap-6">
      <div className="w-[64px] shrink-0 pt-4 text-right sm:w-[76px]">
        <div className={cx('font-display text-[22px] font-semibold leading-none', isPast && !a && 'text-faint')}>{s.start_time}</div>
        <div className="mt-1 text-[13px] text-muted">ถึง {s.end_time}</div>
      </div>
      <span className={cx('relative z-10 mt-5 size-3.5 shrink-0 rounded-full ring-4 ring-ivory', DOT[s.state] ?? 'bg-line')} aria-hidden />

      <div className={cx('min-w-0 flex-1 rounded-2xl border bg-paper px-4 py-3.5 sm:px-5', a ? 'border-line' : 'border-dashed border-line')}>
        {a ? (
          <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
            <div className="min-w-0 flex-1 basis-[240px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-[18px] font-semibold">{a.patient.first_name} {a.patient.last_name}</span>
                <StatusBadge status={a.status} />
                {a.status === 'BOOKED' && !a.confirmed_at && a.has_line && (
                  <span className="rounded-full bg-turmeric-soft px-2.5 py-0.5 text-sm text-[#7a5e0e]">ยังไม่ยืนยัน</span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[15px] text-muted">
                <span>{a.patient.hn ? `HN ${a.patient.hn}` : 'บุคคลทั่วไป'}</span>
                <a href={`tel:${a.patient.phone_number}`} className="hover:text-herb">{a.patient.phone_number}</a>
                <span className="font-display tracking-wider">{a.booking_code}</span>
                {a.booker ? (
                  <span className="flex items-center gap-1"><MessageCircle className="size-4" aria-hidden />
                    {a.booker.relation && a.booker.relation !== 'ตนเอง' ? `${a.booker.line_name} จองให้ (${a.booker.relation})` : 'จองผ่าน LINE'}
                  </span>
                ) : <span>{a.booking_channel === 'WALK_IN' ? 'walk-in' : 'เจ้าหน้าที่จองแทน'}</span>}
              </div>
              {a.chief_complaint && <p className="mt-2 text-[15px]">{a.chief_complaint}</p>}
              {a.status === 'IN_SERVICE' && <p className="mt-2 text-[15px] text-[#7a5e0e]">เริ่มนวด {timeOf(a.service_start)} น.</p>}
              {a.status === 'CHECKED_IN' && <p className="mt-2 text-[15px] text-herb">มาถึง {timeOf(a.checked_in_at)} น. รอหมอนวดเรียก</p>}
              {a.status === 'COMPLETED' && a.service_end && <p className="mt-2 text-[15px] text-muted">นวดเสร็จ {timeOf(a.service_end)} น.</p>}
            </div>
            {a.status === 'BOOKED' && (
              <div className="flex items-center gap-1.5">
                <Button size="sm" onClick={() => onCheckIn(a)}>เช็กอิน</Button>
                <div className="relative" ref={menuRef}>
                  <button type="button" onClick={() => setMenu((m) => !m)} className="grid size-9 place-items-center rounded-lg text-muted hover:bg-sand" aria-label="ตัวเลือกเพิ่มเติม" aria-expanded={menu}>
                    <MoreHorizontal className="size-5" />
                  </button>
                  {menu && (
                    <div className="anim-fade absolute top-10 right-0 z-20 w-48 overflow-hidden rounded-xl border border-line bg-paper py-1 shadow-lg shadow-ink/10">
                      <button type="button" onClick={() => act('noshow')} className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-sand"><CircleDashed className="size-4" aria-hidden />ไม่มาตามนัด</button>
                      <button type="button" onClick={() => act('cancel')} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-rose-ink hover:bg-rose-soft"><Ban className="size-4" aria-hidden />ยกเลิกคิว</button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : s.state === 'AVAILABLE' ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className={cx('font-display font-medium', isPast ? 'text-faint' : 'text-herb')}>{isPast ? 'ผ่านไปแล้ว' : 'ว่าง'}</span>
            {s.mins_until > -55 && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="soft" icon={UserPlus} onClick={() => onBook('WALK_IN')}>รับ walk-in</Button>
                <Button size="sm" variant="outline" icon={PhoneCall} onClick={() => onBook('STAFF')}>จองแทน</Button>
              </div>
            )}
          </div>
        ) : (
          <span className="text-muted">{s.state === 'HOLIDAY' ? `วันหยุด: ${s.holiday_name}` : `ปิดรับ${s.block_reason ? `: ${s.block_reason}` : ''}`}</span>
        )}

        {s.history.length > 0 && (
          <div className="mt-3 border-t border-line pt-2">
            <button type="button" onClick={() => setShowHistory((v) => !v)} className="flex items-center gap-1.5 text-[14px] text-muted hover:text-ink" aria-expanded={showHistory}>
              <History className="size-4" aria-hidden />
              {s.history.map((h) => (h.status === 'NO_SHOW' ? 'ไม่มา' : 'ยกเลิก')).join(', ')} {s.history.length} รายการ
            </button>
            {showHistory && (
              <ul className="mt-2 space-y-1 text-[14px] text-muted">
                {s.history.map((h) => (
                  <li key={h.appointment_id}>
                    {h.patient.first_name} {h.patient.last_name} ({h.booking_code}) <StatusBadge status={h.status} className="ml-1 text-[12px]" />
                    {h.cancel_reason && <span> {h.cancel_reason}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------
function CheckInSheet({ appt, onClose, onDone }) {
  const [warn, setWarn] = useState(null);
  const [loading, setLoading] = useState(false);
  const toast = useToast();
  useEffect(() => { setWarn(null); }, [appt]);
  if (!appt) return null;

  const isToday = appt.slot_date === todayYmd();
  const canCheckIn = appt.status === 'BOOKED' && isToday;

  const submit = async () => {
    setLoading(true);
    try {
      await staffApi(`/staff/appointments/${appt.appointment_id}/checkin`, { method: 'POST', body: { force: !!warn } });
      toast(`เช็กอิน ${appt.patient.first_name} แล้ว`);
      onDone(); onClose();
    } catch (err) {
      if (err.extra?.can_force) setWarn(err.message);
      else toast(err.message, 'error');
    } finally { setLoading(false); }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="เช็กอิน"
      footer={canCheckIn ? (
        <Button size="lg" className="w-full" loading={loading} onClick={submit}>{warn ? 'ยืนยันเช็กอิน' : 'เช็กอิน'}</Button>
      ) : <Button variant="outline" size="lg" className="w-full" onClick={onClose}>ปิด</Button>}
    >
      <div className="rounded-2xl border border-line">
        <div className="flex items-center justify-between border-b-2 border-dashed border-line px-5 py-4">
          <span className="font-display text-[30px] font-semibold tracking-[0.14em] text-herb">{appt.booking_code}</span>
          <StatusBadge status={appt.status} />
        </div>
        <dl className="space-y-2 px-5 py-4 text-[16px]">
          <div className="flex gap-3"><dt className="w-24 shrink-0 text-muted">ผู้รับบริการ</dt><dd className="font-medium">{appt.patient.first_name} {appt.patient.last_name}</dd></div>
          <div className="flex gap-3"><dt className="w-24 shrink-0 text-muted">HN / เบอร์</dt><dd>{appt.patient.hn ?? 'ไม่มี HN'} / {appt.patient.phone_number}</dd></div>
          <div className="flex gap-3"><dt className="w-24 shrink-0 text-muted">นัด</dt><dd>{thaiDate(appt.slot_date)} {appt.start_time}–{appt.end_time} น.</dd></div>
          {appt.chief_complaint && <div className="flex gap-3"><dt className="w-24 shrink-0 text-muted">อาการ</dt><dd>{appt.chief_complaint}</dd></div>}
        </dl>
      </div>
      <p className="mt-4 text-[15px] text-muted">ตรวจชื่อ-นามสกุลกับผู้มารับบริการก่อนกดเช็กอิน</p>
      {!isToday && appt.status === 'BOOKED' && <Notice>คิวนี้ไม่ใช่ของวันนี้</Notice>}
      {warn && <Notice>{warn}</Notice>}
    </Sheet>
  );
}

function Notice({ children }) {
  return (
    <p className="anim-rise mt-4 flex gap-2 rounded-xl bg-turmeric-soft px-4 py-3 text-[15px] text-[#6b520c]" role="alert">
      <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />{children}
    </p>
  );
}

function SearchResults({ results, onClose, onPick }) {
  if (!results) return null;
  return (
    <Sheet open onClose={onClose} title={`ผลการค้นหา "${results.q}"`}>
      {!results.list.length ? <p className="py-8 text-center text-muted">ไม่พบคิวที่ตรงกัน ลองค้นด้วยรหัสจอง เบอร์โทร หรือ HN</p> : (
        <ul className="divide-y divide-line">
          {results.list.map((a) => (
            <li key={a.appointment_id}>
              <button type="button" onClick={() => onPick(a)} className="flex w-full items-center gap-3 py-3 text-left hover:bg-sand">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{a.patient.first_name} {a.patient.last_name}</div>
                  <div className="text-[14px] text-muted">{relativeDay(a.slot_date) ?? thaiDate(a.slot_date)} {a.start_time} น. / {a.booking_code}</div>
                </div>
                <StatusBadge status={a.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------------
// walk-in / จองแทน
// ---------------------------------------------------------------------
function BookForSheet({ ctx, onClose, onDone }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  const [picked, setPicked] = useState(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState({ ...emptyPerson, relation: undefined });
  const [errors, setErrors] = useState({});
  const [complaint, setComplaint] = useState('');
  const [warn, setWarn] = useState(null);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!ctx) return;
    setQ(''); setFound([]); setPicked(null); setIsNew(false); setErrors({}); setComplaint(''); setWarn(null);
    setForm({ ...emptyPerson, relation: undefined });
  }, [ctx]);

  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(() => {
      staffApi(`/staff/patients/search?q=${encodeURIComponent(q.trim())}`).then((d) => setFound(d.results)).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  if (!ctx) return null;
  const walkIn = ctx.channel === 'WALK_IN';

  const submit = async () => {
    let body = { slot_id: ctx.slot.slot_id, channel: ctx.channel, chief_complaint: complaint.trim() || null, force: !!warn };
    if (isNew) {
      const v = validatePerson(form, false);
      setErrors(v);
      if (Object.keys(v).length) return;
      const { relation, ...p } = toPayload(form);
      body.patient = p;
    } else if (picked) body.patient_id = picked.patient_id;
    else return toast('เลือกหรือเพิ่มผู้รับบริการก่อน', 'error');

    setLoading(true);
    try {
      const a = await staffApi('/staff/appointments', { method: 'POST', body });
      toast(walkIn ? `รับ walk-in ${a.patient.first_name} แล้ว` : `จองแทนแล้ว รหัส ${a.booking_code}`);
      onDone(); onClose();
    } catch (err) {
      if (err.extra?.can_force) setWarn(err.message);
      else { setErrors(fieldErrors(err)); toast(err.message, 'error'); }
    } finally { setLoading(false); }
  };

  return (
    <Sheet
      open
      wide
      onClose={onClose}
      title={`${walkIn ? 'รับ walk-in' : 'จองแทน'} รอบ ${ctx.slot.start_time}–${ctx.slot.end_time} น.`}
      footer={<Button size="lg" className="w-full" loading={loading} onClick={submit}>
        {warn ? 'ยืนยันข้ามเงื่อนไข' : walkIn ? 'รับ walk-in และเช็กอิน' : 'จองคิว'}
      </Button>}
    >
      {!isNew ? (
        <>
          <Field label="ค้นหาผู้รับบริการ" hint="ชื่อ เบอร์โทร หรือ HN">
            <Input value={q} onChange={(e) => { setQ(e.target.value); setPicked(null); }} placeholder="เช่น 0812345678" autoFocus />
          </Field>
          <ul className="mt-3 space-y-2">
            {found.map((p) => (
              <li key={p.patient_id}>
                <button
                  type="button"
                  onClick={() => setPicked(p)}
                  aria-pressed={picked?.patient_id === p.patient_id}
                  className={cx('w-full rounded-xl border px-4 py-2.5 text-left', picked?.patient_id === p.patient_id ? 'border-herb bg-leaf-soft' : 'border-line hover:border-herb')}
                >
                  <div className="font-medium">{p.first_name} {p.last_name}</div>
                  <div className="text-[14px] text-muted">{p.hn ? `HN ${p.hn}` : 'บุคคลทั่วไป'} / {p.phone_number}</div>
                </button>
              </li>
            ))}
          </ul>
          <Button variant="soft" icon={UserPlus} className="mt-3 w-full" onClick={() => setIsNew(true)}>ผู้รับบริการใหม่</Button>
        </>
      ) : (
        <>
          <PersonForm value={form} onChange={setForm} errors={errors} />
          <button type="button" onClick={() => setIsNew(false)} className="mt-3 text-[15px] text-herb hover:underline">ค้นหาจากรายชื่อเดิมแทน</button>
        </>
      )}
      <Field label="อาการเบื้องต้น" className="mt-5">
        <Textarea value={complaint} onChange={(e) => setComplaint(e.target.value)} maxLength={1000} />
      </Field>
      {warn && <Notice>{warn} ต้องการจองต่อหรือไม่</Notice>}
    </Sheet>
  );
}
