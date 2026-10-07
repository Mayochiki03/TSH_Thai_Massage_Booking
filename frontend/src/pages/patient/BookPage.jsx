import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Plus, UserRound, CalendarX2, Check } from 'lucide-react';
import { patientApi } from '../../lib/liff.js';
import { relativeDay, weekdayShort, dayNum, monthShort, thaiDateLong } from '../../lib/format.js';
import { Button, Sheet, Spinner, Textarea, Empty, useToast, cx } from '../../components/ui.jsx';
import { usePatient } from './PatientApp.jsx';
import { PersonSheet } from './PeoplePage.jsx';

const COMPLAINTS = ['ปวดคอ บ่า ไหล่', 'ปวดหลัง', 'ปวดเอว', 'ปวดเข่า', 'ตึงน่อง', 'ปวดศีรษะ', 'ชามือ ชาเท้า'];

export function BookPage() {
  const { me, config } = usePatient();
  const navigate = useNavigate();
  const toast = useToast();

  const [days, setDays] = useState(null);
  const [date, setDate] = useState(null);
  const [slotId, setSlotId] = useState(null);
  const [patientId, setPatientId] = useState(me.self_patient_id);
  const [complaint, setComplaint] = useState('');
  const [adding, setAdding] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const data = await patientApi('/availability');
    setDays(data.days);
    return data.days;
  }, []);

  useEffect(() => {
    load().then((d) => {
      const first = d.find((x) => x.slots.some((s) => s.status === 'AVAILABLE'));
      setDate((cur) => cur ?? first?.date ?? d[0]?.date ?? null);
    }).catch((err) => toast(err.message, 'error'));
  }, [load, toast]);

  const day = days?.find((d) => d.date === date);
  const slot = day?.slots.find((s) => s.slot_id === slotId);
  const person = me.patients.find((p) => p.patient_id === patientId);
  const ready = slot && person;

  const toggleComplaint = (c) => {
    setComplaint((cur) => {
      const parts = cur.split(/,\s*/).filter(Boolean);
      return parts.includes(c) ? parts.filter((x) => x !== c).join(', ') : [...parts, c].join(', ');
    });
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const t = await patientApi('/bookings', {
        method: 'POST',
        body: { patient_id: patientId, slot_id: slotId, chief_complaint: complaint.trim() || null },
      });
      navigate(`/ticket/${t.booking_code}?new=1`);
    } catch (err) {
      setSubmitting(false);
      setReviewing(false);
      toast(err.message, 'error');
      if (['SLOT_TAKEN', 'CUTOFF', 'SLOT_BLOCKED', 'HOLIDAY'].includes(err.code)) {
        setSlotId(null);
        load();
      }
    }
  };

  if (!days) return <Spinner label="กำลังโหลดรอบว่าง" />;
  if (!days.length) {
    return (
      <Empty icon={CalendarX2} title="ยังไม่มีรอบให้จอง">
        เปิดให้จองล่วงหน้า {config.advance_booking_days} วัน (จันทร์–ศุกร์) ลองกลับมาดูใหม่อีกครั้ง
      </Empty>
    );
  }

  return (
    <div className="pb-32">
      <section className="px-5 pt-4">
        <h1 className="text-[28px] font-semibold leading-tight">จองคิวนวด</h1>
        <p className="mt-1 text-muted">เลือกวัน รอบเวลา และผู้รับบริการ</p>
      </section>

      {/* วันที่ */}
      <section className="mt-6" aria-label="เลือกวัน">
        <div className="no-scrollbar flex gap-2.5 overflow-x-auto px-5 pb-1">
          {days.map((d) => {
            const free = d.slots.filter((s) => s.status === 'AVAILABLE').length;
            const holiday = d.slots.every((s) => s.status === 'HOLIDAY');
            const active = d.date === date;
            return (
              <button
                key={d.date}
                type="button"
                onClick={() => { setDate(d.date); setSlotId(null); }}
                aria-pressed={active}
                className={cx(
                  'flex w-[88px] shrink-0 flex-col items-center rounded-2xl border px-2 pt-2.5 pb-3 transition-colors',
                  active ? 'border-herb bg-herb text-white' : 'border-line bg-paper hover:border-herb',
                  !free && !active && 'opacity-60',
                )}
              >
                <span className={cx('text-[13px]', active ? 'text-leaf' : 'text-muted')}>{relativeDay(d.date) ?? weekdayShort(d.date)}</span>
                <span className="font-display text-[30px] font-semibold leading-none mt-1">{dayNum(d.date)}</span>
                <span className={cx('text-[13px] mt-1', active ? 'text-leaf' : 'text-muted')}>{weekdayShort(d.date)} {monthShort(d.date)}</span>
                <span className={cx('mt-2 rounded-full px-2 text-[12px] font-medium', active ? 'bg-white/15' : free ? 'bg-leaf text-herb' : 'bg-stone-soft text-stone-ink')}>
                  {holiday ? 'วันหยุด' : free ? `ว่าง ${free}` : 'เต็ม'}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* รอบเวลา */}
      {day && (
        <section className="mt-7 px-5" aria-label="เลือกรอบเวลา">
          <h2 className="mb-3 text-lg font-semibold">รอบเวลา</h2>
          <div className="grid grid-cols-2 gap-2.5">
            {day.slots.map((s) => {
              const ok = s.status === 'AVAILABLE';
              const active = s.slot_id === slotId;
              return (
                <button
                  key={s.slot_id}
                  type="button"
                  disabled={!ok}
                  onClick={() => setSlotId(s.slot_id)}
                  aria-pressed={active}
                  className={cx(
                    'relative flex h-[72px] flex-col items-start justify-center rounded-2xl border px-4 text-left transition-colors',
                    active ? 'border-herb bg-leaf-soft ring-2 ring-herb' : ok ? 'border-line hover:border-herb' : 'border-transparent bg-mist',
                  )}
                >
                  <span className={cx('font-display text-[22px] font-semibold leading-none', !ok && 'text-faint line-through decoration-1')}>{s.start_time}</span>
                  <span className={cx('mt-1 text-[14px]', ok ? 'text-muted' : 'text-faint')}>
                    {ok ? `ถึง ${s.end_time} น.` : s.status === 'HOLIDAY' ? 'วันหยุด' : 'ไม่ว่าง'}
                  </span>
                  {active && (
                    <span className="anim-pop absolute top-3 right-3 grid size-6 place-items-center rounded-full bg-herb text-white">
                      <Check className="size-4" strokeWidth={3} aria-hidden />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ผู้รับบริการ */}
      <section className="mt-8 px-5" aria-label="ผู้รับบริการ">
        <h2 className="mb-3 text-lg font-semibold">จองให้ใคร</h2>
        <div className="space-y-2">
          {me.patients.map((p) => {
            const active = p.patient_id === patientId;
            return (
              <button
                key={p.patient_id}
                type="button"
                onClick={() => setPatientId(p.patient_id)}
                aria-pressed={active}
                className={cx(
                  'flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors',
                  active ? 'border-herb bg-leaf-soft' : 'border-line hover:border-herb',
                )}
              >
                <span className={cx('grid size-10 shrink-0 place-items-center rounded-full', active ? 'bg-herb text-white' : 'bg-mist text-muted')}>
                  <UserRound className="size-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.first_name} {p.last_name}</span>
                  <span className="block text-[14px] text-muted">{p.is_self ? 'ตัวเอง' : p.relation}{p.hn ? ` / HN ${p.hn}` : ''}</span>
                </span>
                <span className={cx('size-5 shrink-0 rounded-full border-2', active ? 'border-herb bg-herb shadow-[inset_0_0_0_3px_white]' : 'border-line')} aria-hidden />
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-line px-4 py-3 text-herb hover:border-herb hover:bg-leaf-soft"
          >
            <span className="grid size-10 place-items-center rounded-full bg-leaf-soft"><Plus className="size-5" aria-hidden /></span>
            <span className="font-medium">จองให้คนอื่น</span>
          </button>
        </div>
      </section>

      {/* อาการ */}
      <section className="mt-8 px-5" aria-label="อาการเบื้องต้น">
        <h2 className="text-lg font-semibold">อาการเบื้องต้น</h2>
        <p className="mb-3 text-[15px] text-muted">ไม่บังคับ แตะเพื่อเลือก หรือพิมพ์เพิ่มเอง</p>
        <div className="mb-3 flex flex-wrap gap-2">
          {COMPLAINTS.map((c) => {
            const on = complaint.split(/,\s*/).includes(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggleComplaint(c)}
                aria-pressed={on}
                className={cx('h-9 rounded-full border px-3.5 text-[15px] transition-colors', on ? 'border-herb bg-leaf text-herb' : 'border-line text-ink hover:border-herb')}
              >
                {c}
              </button>
            );
          })}
        </div>
        <Textarea value={complaint} onChange={(e) => setComplaint(e.target.value)} placeholder="เช่น ปวดไหล่ขวามา 3 วัน" maxLength={1000} />
      </section>

      {/* แถบยืนยันด้านล่าง */}
      <div className="fixed inset-x-0 bottom-0 z-30">
        <div className="mx-auto max-w-md border-t border-line bg-paper/95 px-5 pt-3 pb-[max(0.9rem,env(safe-area-inset-bottom))] backdrop-blur">
          <div className="mb-2 min-h-6 text-[15px] text-muted">
            {slot ? <><span className="font-medium text-ink">{relativeDay(date) ?? weekdayShort(date)} {dayNum(date)} {monthShort(date)}</span>, {slot.start_time}–{slot.end_time} น.</> : 'ยังไม่ได้เลือกรอบเวลา'}
          </div>
          <Button size="lg" className="w-full" disabled={!ready} onClick={() => setReviewing(true)}>ตรวจสอบและจองคิว</Button>
        </div>
      </div>

      <Sheet
        open={reviewing}
        onClose={() => !submitting && setReviewing(false)}
        title="ยืนยันการจอง"
        footer={<Button size="lg" className="w-full" loading={submitting} onClick={submit}>ยืนยันการจอง</Button>}
      >
        {ready && (
          <dl className="divide-y divide-line rounded-2xl border border-line">
            <Row label="วันที่" value={thaiDateLong(date)} />
            <Row label="เวลา" value={`${slot.start_time}–${slot.end_time} น.`} />
            <Row label="ผู้รับบริการ" value={`${person.first_name} ${person.last_name}`} />
            {complaint.trim() && <Row label="อาการ" value={complaint.trim()} />}
          </dl>
        )}
        <p className="mt-4 text-[15px] text-muted">
          กรุณามาเช็กอินที่เคาน์เตอร์ก่อนเวลานัด 10–15 นาที ยกเลิกเองได้ถึง {Math.round(config.patient_cancel_min / 60)} ชั่วโมงก่อนนัด
        </p>
      </Sheet>

      <PersonSheet
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={(profile) => {
          const newest = profile.patients.filter((p) => !p.is_self).at(-1);
          if (newest) setPatientId(newest.patient_id);
        }}
      />
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex gap-4 px-4 py-3">
      <dt className="w-24 shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 font-medium">{value}</dd>
    </div>
  );
}
export { Row };
