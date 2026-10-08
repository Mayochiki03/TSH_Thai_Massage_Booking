/**
 * pages/staff/QueuePage.jsx — หน้าคิววันนี้ของเคาน์เตอร์ (/staff/queue)
 *   - ช่องเช็กอิน: พิมพ์รหัสจอง (6 ตัว) หรือค้นจากชื่อ/เบอร์/HN/เลขบัตร/VN → หน้าต่างเช็กอิน (+ กรอก VN, เตือนถ้ามาเร็ว/สาย)
 *   - ไทม์ไลน์ทุกรอบของวัน: 1 รอบมีได้หลายคิว (ตามจำนวนเตียง) แต่ละคิวแสดงสถานะ บริการ หมอนวด VN ผู้จอง อาการ
 *   - ที่ว่างในรอบ: รับ walk-in (เช็กอินให้ทันที) หรือจองแทนทางโทรศัพท์ (เลือกประเภทบริการ)
 *   - อัปเดตเองทุก 20 วินาที
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Search, UserPlus, PhoneCall, MoreHorizontal, RefreshCw,
  MessageCircle, CircleDashed, Ban, CalendarOff, TriangleAlert, History, BedDouble, FileDigit, Hand,
} from 'lucide-react';
import { staffApi } from '../../lib/api.js';
import { thaiDateLong, todayYmd, addDays, relativeDay, timeOf, thaiDate, baht } from '../../lib/format.js';
import { thaiIdError } from '../../lib/thaiId.js';
import { Button, Sheet, Spinner, StatusBadge, Input, Field, Textarea, useToast, useConfirm, cx } from '../../components/ui.jsx';
import { NationalIdField } from '../../components/NationalIdField.jsx';
import { PersonForm, emptyPerson, validatePerson, fieldErrors, toPayload } from '../patient/PersonForm.jsx';

const DOT = { AVAILABLE: 'bg-paper border-2 border-herb', FULL: 'bg-herb', BLOCKED: 'bg-line', HOLIDAY: 'bg-line' };

export function QueuePage() {
  const [date, setDate] = useState(todayYmd());
  const [data, setData] = useState(null);
  const [lookup, setLookup] = useState('');
  const [checkIn, setCheckIn] = useState(null);    // appointment (+ slot info)
  const [results, setResults] = useState(null);    // ผลค้นหา
  const [booking, setBooking] = useState(null);    // { slot, channel }
  const [searching, setSearching] = useState(false);
  const [vnFor, setVnFor] = useState(null);         // appointment ที่จะแก้ VN
  const [services, setServices] = useState([]);
  const toast = useToast();
  const isToday = date === todayYmd();

  useEffect(() => { staffApi('/staff/service-types').then((d) => setServices(d.service_types)).catch(() => {}); }, []);

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
  const maxBeds = Math.max(1, ...(data?.slots ?? []).map((s) => s.capacity));

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
          <span className="sr-only">รหัสจอง ชื่อ เบอร์โทร HN หรือเลขบัตรประชาชน</span>
          <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-faint" aria-hidden />
          <input
            value={lookup}
            onChange={(e) => setLookup(e.target.value)}
            placeholder="รหัสจอง ชื่อ เบอร์ HN หรือเลขบัตร"
            className="h-14 w-full rounded-xl bg-paper pr-4 pl-12 font-display text-[19px] tracking-wide placeholder:font-sans placeholder:text-[16px] placeholder:tracking-normal placeholder:text-faint focus:outline-none focus:ring-4 focus:ring-leaf"
            autoComplete="off"
          />
        </label>
        <Button type="submit" size="lg" variant="soft" loading={searching} className="bg-leaf hover:bg-white">เช็กอิน</Button>
      </form>

      {/* สรุป */}
      {data && (
        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[15px] text-muted">
          {maxBeds > 1 && <span className="flex items-center gap-1.5"><BedDouble className="size-4" aria-hidden />{maxBeds} เตียง</span>}
          <span>ที่ว่าง <b className="font-display text-ink">{summary.AVAILABLE ?? 0}</b></span>
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
              onEditVn={setVnFor}
              reload={load}
            />
          ))}
        </ol>
      )}

      <CheckInSheet appt={checkIn} onClose={() => setCheckIn(null)} onDone={load} />
      <SearchResults results={results} onClose={() => setResults(null)} onPick={(a) => { setResults(null); setCheckIn(a); }} />
      <BookForSheet ctx={booking} services={services} onClose={() => setBooking(null)} onDone={load} />
      <VnSheet appt={vnFor} onClose={() => setVnFor(null)} onDone={load} />
    </div>
  );
}

// ---------------------------------------------------------------------
/** 1 รอบเวลา = เวลา + รายการคิวในรอบ (ตามจำนวนเตียง) + ที่ว่าง + ประวัติยกเลิก/ไม่มา */
function SlotRow({ slot: s, isPast, onCheckIn, onBook, onEditVn, reload }) {
  const [showHistory, setShowHistory] = useState(false);
  const closed = s.state === 'HOLIDAY' || s.state === 'BLOCKED';
  const canBook = !closed && s.remaining > 0 && s.mins_until > -55;

  return (
    <li className="relative flex gap-4 py-2 sm:gap-6">
      <div className="w-[64px] shrink-0 pt-4 text-right sm:w-[76px]">
        <div className={cx('font-display text-[22px] font-semibold leading-none', isPast && !s.appointments.length && 'text-faint')}>{s.start_time}</div>
        <div className="mt-1 text-[13px] text-muted">ถึง {s.end_time}</div>
        {s.capacity > 1 && !closed && (
          <div className={cx('mt-1.5 inline-flex items-center gap-1 rounded-full px-1.5 text-[12px] font-medium', s.remaining ? 'bg-leaf text-herb' : 'bg-stone-soft text-stone-ink')}>
            <BedDouble className="size-3.5" aria-hidden />{s.booked}/{s.capacity}
          </div>
        )}
      </div>
      <span className={cx('relative z-10 mt-5 size-3.5 shrink-0 rounded-full ring-4 ring-ivory', DOT[s.state] ?? 'bg-line')} aria-hidden />

      <div className="min-w-0 flex-1 space-y-2">
        {s.appointments.map((a) => (
          <ApptCard key={a.appointment_id} a={a} onCheckIn={onCheckIn} onEditVn={onEditVn} reload={reload} />
        ))}

        {closed ? (
          <div className="rounded-2xl border border-dashed border-line bg-paper px-4 py-3.5 text-muted sm:px-5">
            {s.state === 'HOLIDAY' ? `วันหยุด: ${s.holiday_name}` : `ปิดรับ${s.block_reason ? `: ${s.block_reason}` : ''}`}
          </div>
        ) : s.remaining > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-line bg-paper px-4 py-3 sm:px-5">
            <span className={cx('font-display font-medium', isPast ? 'text-faint' : 'text-herb')}>
              {isPast ? 'ผ่านไปแล้ว' : s.capacity > 1 ? `ว่าง ${s.remaining} เตียง` : 'ว่าง'}
            </span>
            {canBook && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="soft" icon={UserPlus} onClick={() => onBook('WALK_IN')}>รับ walk-in</Button>
                <Button size="sm" variant="outline" icon={PhoneCall} onClick={() => onBook('STAFF')}>จองแทน</Button>
              </div>
            )}
          </div>
        ) : null}

        {s.history.length > 0 && (
          <div className="px-1">
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

/** การ์ดคิว 1 คิว (เช็กอิน / ไม่มา / ยกเลิก / แก้ VN) */
function ApptCard({ a, onCheckIn, onEditVn, reload }) {
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
      ? { title: `ยกเลิกคิวของ ${name}?`, body: 'ที่ในรอบนี้จะว่างให้รับ walk-in หรือจองใหม่ได้', okText: 'ยกเลิกคิว', danger: true }
      : { title: `บันทึกว่า ${name} ไม่มาตามนัด?`, body: 'ใช้นับเกณฑ์ระงับสิทธิ์การจอง และปล่อยที่ให้ walk-in', okText: 'ไม่มาตามนัด', danger: true });
    if (!ok) return;
    try {
      await staffApi(`/staff/appointments/${a.appointment_id}/${kind === 'cancel' ? 'cancel' : 'no-show'}`, { method: 'POST', body: {} });
      toast(kind === 'cancel' ? 'ยกเลิกคิวแล้ว' : 'บันทึกไม่มาตามนัดแล้ว');
      reload();
    } catch (err) { toast(err.message, 'error'); }
  };

  const noId = !a.patient.has_national_id && !a.patient.no_national_id;

  return (
    <div className="rounded-2xl border border-line bg-paper px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-[240px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-[18px] font-semibold">{a.patient.first_name} {a.patient.last_name}</span>
            <StatusBadge status={a.status} />
            {a.status === 'BOOKED' && !a.confirmed_at && a.has_line && (
              <span className="rounded-full bg-turmeric-soft px-2.5 py-0.5 text-sm text-[#7a5e0e]">ยังไม่ยืนยัน</span>
            )}
            {noId && <span className="rounded-full bg-clay-soft px-2.5 py-0.5 text-sm text-clay">ยังไม่มีเลขบัตร</span>}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[15px] text-muted">
            <span>{a.patient.hn ? `HN ${a.patient.hn}` : 'บุคคลทั่วไป'}</span>
            <a href={`tel:${a.patient.phone_number}`} className="hover:text-herb">{a.patient.phone_number}</a>
            <span className="font-display tracking-wider">{a.booking_code}</span>
            {a.booker ? (
              <span className="flex items-center gap-1"><MessageCircle className="size-4" aria-hidden />
                {a.booker.relation && a.booker.relation !== 'ตนเอง' ? `${a.booker.line_name} จองให้ (${a.booker.relation})` : 'จองผ่าน LINE'}
              </span>
            ) : <span>{a.booking_channel === 'WALK_IN' ? 'walk-in' : a.booking_channel === 'KIOSK' ? 'kiosk' : 'เจ้าหน้าที่จองแทน'}</span>}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[15px]">
            {a.service && <span className="font-medium text-herb">{a.service.name} · {baht(a.service.price)}</span>}
            {a.practitioner && <span className="flex items-center gap-1 text-ink"><Hand className="size-4 text-clay" aria-hidden />{a.practitioner.full_name}</span>}
            {a.vn && <span className="text-muted">VN {a.vn}</span>}
          </div>
          {a.chief_complaint && <p className="mt-2 text-[15px]">{a.chief_complaint}</p>}
          {a.status === 'IN_SERVICE' && <p className="mt-2 text-[15px] text-[#7a5e0e]">เริ่มนวด {timeOf(a.service_start)} น.</p>}
          {a.status === 'CHECKED_IN' && <p className="mt-2 text-[15px] text-herb">มาถึง {timeOf(a.checked_in_at)} น. รอหมอนวดเรียก</p>}
          {a.status === 'COMPLETED' && a.service_end && <p className="mt-2 text-[15px] text-muted">นวดเสร็จ {timeOf(a.service_end)} น.</p>}
        </div>
        <div className="flex items-center gap-1.5">
          {a.status === 'BOOKED' && <Button size="sm" onClick={() => onCheckIn(a)}>เช็กอิน</Button>}
          <div className="relative" ref={menuRef}>
            <button type="button" onClick={() => setMenu((m) => !m)} className="grid size-9 place-items-center rounded-lg text-muted hover:bg-sand" aria-label="ตัวเลือกเพิ่มเติม" aria-expanded={menu}>
              <MoreHorizontal className="size-5" />
            </button>
            {menu && (
              <div className="anim-fade absolute top-10 right-0 z-20 w-52 overflow-hidden rounded-xl border border-line bg-paper py-1 shadow-lg shadow-ink/10">
                <button type="button" onClick={() => { setMenu(false); onEditVn(a); }} className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-sand">
                  <FileDigit className="size-4" aria-hidden />{a.vn ? 'แก้ VN' : 'กรอก VN'}{noId ? ' / เลขบัตร' : ''}
                </button>
                {a.status === 'BOOKED' && (
                  <>
                    <button type="button" onClick={() => act('noshow')} className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-sand"><CircleDashed className="size-4" aria-hidden />ไม่มาตามนัด</button>
                    <button type="button" onClick={() => act('cancel')} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-rose-ink hover:bg-rose-soft"><Ban className="size-4" aria-hidden />ยกเลิกคิว</button>
                  </>
                )}
                {a.status === 'CHECKED_IN' && (
                  <button type="button" onClick={() => act('cancel')} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-rose-ink hover:bg-rose-soft"><Ban className="size-4" aria-hidden />ยกเลิกคิว</button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** แก้ VN (และเติมเลขบัตรของผู้รับบริการที่ยังไม่มี) */
function VnSheet({ appt, onClose, onDone }) {
  const [vn, setVn] = useState('');
  const [identity, setIdentity] = useState({ national_id: '', no_national_id: false });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const toast = useToast();
  useEffect(() => { if (appt) { setVn(appt.vn ?? ''); setIdentity({ national_id: '', no_national_id: false }); setErrors({}); } }, [appt]);
  if (!appt) return null;
  const noId = !appt.patient.has_national_id && !appt.patient.no_national_id;

  const save = async () => {
    const body = { vn: vn.trim() || null };
    if (noId && (identity.national_id || identity.no_national_id)) {
      const e = identity.no_national_id ? null : thaiIdError(identity.national_id);
      if (e) return setErrors({ national_id: e });
      Object.assign(body, { national_id: identity.national_id || null, no_national_id: identity.no_national_id });
    }
    setLoading(true);
    try {
      await staffApi(`/staff/appointments/${appt.appointment_id}`, { method: 'PATCH', body });
      toast('บันทึกแล้ว');
      onDone(); onClose();
    } catch (err) { setErrors(fieldErrors(err)); toast(err.message, 'error'); }
    finally { setLoading(false); }
  };

  return (
    <Sheet open onClose={onClose} title={`${appt.patient.first_name} ${appt.patient.last_name}`}
      footer={<Button size="lg" className="w-full" loading={loading} onClick={save}>บันทึก</Button>}>
      <Field label="VN (Visit Number)" hint="เลขที่รับบริการจากระบบโรงพยาบาล ใช้ตอนเบิกจ่าย" error={errors.vn}>
        <Input value={vn} onChange={(e) => setVn(e.target.value.toUpperCase())} maxLength={20} inputMode="numeric" autoFocus className="font-display tracking-wide" />
      </Field>
      {noId && (
        <div className="mt-5">
          <NationalIdField value={identity} onChange={setIdentity} error={errors.national_id} label="เลขบัตรประชาชนของผู้รับบริการ" hint="ยังไม่เคยบันทึก — กรอกได้เลย" />
        </div>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------------
function CheckInSheet({ appt, onClose, onDone }) {
  const [warn, setWarn] = useState(null);
  const [vn, setVn] = useState('');
  const [identity, setIdentity] = useState({ national_id: '', no_national_id: false });
  const [idError, setIdError] = useState(null);
  const [loading, setLoading] = useState(false);
  const toast = useToast();
  useEffect(() => { setWarn(null); setVn(''); setIdentity({ national_id: '', no_national_id: false }); setIdError(null); }, [appt]);
  if (!appt) return null;

  const isToday = appt.slot_date === todayYmd();
  const canCheckIn = appt.status === 'BOOKED' && isToday;
  const noId = !appt.patient.has_national_id && !appt.patient.no_national_id;

  const submit = async () => {
    // ผู้รับบริการเก่าที่ยังไม่มีเลขบัตร: กรอกได้ตรงนี้ (ไม่บังคับตอนเช็กอิน — กรอกทีหลังได้ที่ "กรอก VN / เลขบัตร")
    if (noId && identity.national_id) {
      const e = thaiIdError(identity.national_id);
      if (e) return setIdError(e);
    }
    setLoading(true);
    try {
      if (noId && (identity.national_id || identity.no_national_id)) {
        await staffApi(`/staff/appointments/${appt.appointment_id}`, { method: 'PATCH', body: { national_id: identity.national_id || null, no_national_id: identity.no_national_id } });
      }
      await staffApi(`/staff/appointments/${appt.appointment_id}/checkin`, { method: 'POST', body: { force: !!warn, vn: vn.trim() || null } });
      toast(`เช็กอิน ${appt.patient.first_name} แล้ว`);
      onDone(); onClose();
    } catch (err) {
      if (err.extra?.can_force) setWarn(err.message);
      else { if (err.fields?.national_id) setIdError(err.fields.national_id[0]); toast(err.message, 'error'); }
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
          {appt.service && <div className="flex gap-3"><dt className="w-24 shrink-0 text-muted">บริการ</dt><dd>{appt.service.name} · {baht(appt.service.price)}</dd></div>}
          <div className="flex gap-3"><dt className="w-24 shrink-0 text-muted">เลขบัตร</dt><dd className="tabular-nums">{appt.patient.national_id_masked ?? (appt.patient.no_national_id ? 'ไม่มีบัตรประชาชนไทย' : <span className="text-clay">ยังไม่ได้บันทึก</span>)}</dd></div>
          {appt.chief_complaint && <div className="flex gap-3"><dt className="w-24 shrink-0 text-muted">อาการ</dt><dd>{appt.chief_complaint}</dd></div>}
        </dl>
      </div>
      {canCheckIn && (
        <div className="mt-5 space-y-4">
          <Field label="VN (ถ้ามี)" hint="เลขที่รับบริการจากระบบโรงพยาบาล — กรอกทีหลังได้ / หมอนวดกรอกได้">
            <Input value={vn} onChange={(e) => setVn(e.target.value.toUpperCase())} maxLength={20} inputMode="numeric" className="font-display tracking-wide" />
          </Field>
          {noId && (
            <NationalIdField value={identity} onChange={(v) => { setIdentity(v); setIdError(null); }} error={idError}
              label="เลขบัตรประชาชนของผู้รับบริการ" hint="ยังไม่เคยบันทึก — ขอดูบัตรแล้วกรอกได้เลย (ไม่บังคับตอนเช็กอิน)" />
          )}
        </div>
      )}
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
function BookForSheet({ ctx, services, onClose, onDone }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  const [picked, setPicked] = useState(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState({ ...emptyPerson, relation: undefined });
  const [errors, setErrors] = useState({});
  const [complaint, setComplaint] = useState('');
  const [serviceId, setServiceId] = useState(null);
  const [identity, setIdentity] = useState({ national_id: '', no_national_id: false }); // คนเดิมที่ยังไม่มีเลขบัตร
  const [warn, setWarn] = useState(null);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!ctx) return;
    setQ(''); setFound([]); setPicked(null); setIsNew(false); setErrors({}); setComplaint(''); setWarn(null);
    setForm({ ...emptyPerson, relation: undefined });
    setIdentity({ national_id: '', no_national_id: false });
    setServiceId((cur) => cur ?? services[0]?.service_type_id ?? null);
  }, [ctx, services]);

  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(() => {
      staffApi(`/staff/patients/search?q=${encodeURIComponent(q.trim())}`).then((d) => setFound(d.results)).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  if (!ctx) return null;
  const walkIn = ctx.channel === 'WALK_IN';

  const pickedNoId = picked && !picked.has_national_id && !picked.no_national_id;

  const submit = async () => {
    if (!serviceId) return toast('เลือกประเภทบริการก่อน', 'error');
    let body = { slot_id: ctx.slot.slot_id, channel: ctx.channel, service_type_id: serviceId, chief_complaint: complaint.trim() || null, force: !!warn };
    if (isNew) {
      const v = validatePerson(form, false);
      setErrors(v);
      if (Object.keys(v).length) return;
      const { relation, ...p } = toPayload(form);
      body.patient = p;
    } else if (picked) {
      body.patient_id = picked.patient_id;
      if (pickedNoId) {
        const e = identity.no_national_id ? null : thaiIdError(identity.national_id);
        if (e) return setErrors({ national_id: e });
        Object.assign(body, { national_id: identity.national_id || null, no_national_id: identity.no_national_id });
      }
    } else return toast('เลือกหรือเพิ่มผู้รับบริการก่อน', 'error');

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
      {services.length > 0 && (
        <div className="mb-5">
          <span className="mb-2 block text-[15px] font-medium">ประเภทบริการ</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {services.map((sv) => (
              <button key={sv.service_type_id} type="button" onClick={() => setServiceId(sv.service_type_id)} aria-pressed={serviceId === sv.service_type_id}
                className={cx('flex items-center justify-between gap-2 rounded-xl border px-4 py-2.5 text-left', serviceId === sv.service_type_id ? 'border-herb bg-leaf-soft ring-2 ring-herb' : 'border-line hover:border-herb')}>
                <span className="font-medium">{sv.name}</span>
                <span className="shrink-0 font-display font-semibold text-herb">{baht(sv.price)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {!isNew ? (
        <>
          <Field label="ค้นหาผู้รับบริการ" hint="ชื่อ เบอร์โทร HN หรือเลขบัตรประชาชน 13 หลัก">
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
                  <div className="text-[13px] tabular-nums">
                    {p.has_national_id ? <span className="text-faint">บัตร {p.national_id_masked}</span>
                      : p.no_national_id ? <span className="text-faint">ไม่มีบัตรไทย</span> : <span className="text-clay">ยังไม่มีเลขบัตร</span>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {pickedNoId && (
            <div className="anim-rise mt-3 rounded-xl bg-clay-soft/50 p-4">
              <NationalIdField value={identity} onChange={(v) => { setIdentity(v); setErrors({}); }} error={errors.national_id}
                label={`เลขบัตรประชาชนของ ${picked.first_name}`} hint="ยังไม่เคยบันทึก ต้องกรอกก่อนจอง (ขอดูบัตร)" />
            </div>
          )}
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
