import { useCallback, useEffect, useMemo, useState } from 'react';
import { Play, Square, Save, ChevronRight, Clock, NotebookPen, UserRound } from 'lucide-react';
import { staffApi } from '../../lib/api.js';
import { thaiDateLong, timeOf, thaiDate } from '../../lib/format.js';
import { Button, Spinner, StatusBadge, Field, Textarea, useToast, useConfirm, cx } from '../../components/ui.jsx';

const parseTs = (s) => (s ? new Date(`${s.replace(' ', 'T')}+07:00`) : null);

/** หน้าจอหมอนวด: รายการคิววันนี้ + คิวที่กำลังดูแล */
export function RoomPage() {
  const [data, setData] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try { setData(await staffApi('/practitioner/queue')); }
    catch (err) { toast(err.message, 'error'); }
  }, [toast]);

  useEffect(() => { load(); const t = setInterval(load, 20_000); return () => clearInterval(t); }, [load]);

  const appts = useMemo(() => (data?.slots ?? []).filter((s) => s.appointment).map((s) => ({ ...s.appointment, slot: s })), [data]);

  // คิวที่ควรโฟกัส: กำลังนวด → มาถึงแล้ว (คิวถัดไป) → ที่เลือกไว้
  const current = appts.find((a) => a.status === 'IN_SERVICE');
  const nextUp = appts.find((a) => a.status === 'CHECKED_IN');
  const selected = appts.find((a) => a.appointment_id === selectedId) ?? current ?? nextUp ?? null;

  if (!data) return <Spinner />;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
      <h1 className="text-[28px] font-semibold">ห้องนวด</h1>
      <p className="text-muted">{thaiDateLong(data.date)}</p>

      <div className="mt-6 grid gap-6 md:grid-cols-[300px_1fr]">
        {/* รายการคิว */}
        <ol className="space-y-2" aria-label="คิววันนี้">
          {data.slots.map((s) => {
            const a = s.appointment;
            const active = a && selected?.appointment_id === a.appointment_id;
            return (
              <li key={s.slot_id}>
                <button
                  type="button"
                  disabled={!a}
                  onClick={() => setSelectedId(a.appointment_id)}
                  className={cx(
                    'flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors',
                    active ? 'border-herb bg-paper ring-2 ring-herb' : a ? 'border-line bg-paper hover:border-herb' : 'border-dashed border-line',
                  )}
                >
                  <span className={cx('w-14 font-display text-[19px] font-semibold', !a && 'text-faint')}>{s.start_time}</span>
                  <span className="min-w-0 flex-1">
                    {a ? (
                      <>
                        <span className="block truncate font-medium">{a.patient.first_name} {a.patient.last_name}</span>
                        <StatusBadge status={a.status} className="mt-0.5 text-[13px]" />
                      </>
                    ) : <span className="text-faint">{s.state === 'AVAILABLE' ? 'ว่าง' : s.state === 'HOLIDAY' ? 'วันหยุด' : 'ปิดรับ'}</span>}
                  </span>
                  {a && <ChevronRight className="size-5 text-faint" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ol>

        {/* รายละเอียด */}
        <section>
          {selected ? <Focus key={selected.appointment_id} a={selected} reload={load} />
            : (
              <div className="rounded-3xl bg-paper px-6 py-16 text-center">
                <UserRound className="mx-auto mb-3 size-10 text-faint" strokeWidth={1.5} aria-hidden />
                <p className="font-display text-lg font-medium">ยังไม่มีผู้รับบริการมาถึง</p>
                <p className="text-muted">เมื่อเคาน์เตอร์เช็กอินแล้ว ชื่อจะขึ้นที่นี่</p>
              </div>
            )}
        </section>
      </div>
    </div>
  );
}

function Focus({ a, reload }) {
  const [record, setRecord] = useState({ treatment_details: a.treatment_details ?? '', post_treatment_note: a.post_treatment_note ?? '' });
  const [history, setHistory] = useState(null);
  const [busy, setBusy] = useState(null);
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    staffApi(`/practitioner/patients/${a.patient.patient_id}/history`).then((d) => setHistory(d.history)).catch(() => setHistory([]));
  }, [a.patient.patient_id]);

  const call = async (kind) => {
    if (kind === 'complete') {
      const ok = await confirm({ title: 'จบการนวดคิวนี้?', body: 'ระบบจะบันทึกเวลาจบและผลการรักษาที่กรอกไว้', okText: 'จบการนวด' });
      if (!ok) return;
    }
    setBusy(kind);
    try {
      if (kind === 'start') await staffApi(`/practitioner/appointments/${a.appointment_id}/start`, { method: 'POST' });
      if (kind === 'complete') await staffApi(`/practitioner/appointments/${a.appointment_id}/complete`, { method: 'POST', body: record });
      if (kind === 'save') await staffApi(`/practitioner/appointments/${a.appointment_id}/record`, { method: 'PUT', body: record });
      toast(kind === 'start' ? 'เริ่มนวดแล้ว' : kind === 'complete' ? 'จบการนวดแล้ว' : 'บันทึกแล้ว');
      reload();
    } catch (err) { toast(err.message, 'error'); }
    finally { setBusy(null); }
  };

  const canRecord = ['IN_SERVICE', 'COMPLETED'].includes(a.status);

  return (
    <div className="anim-rise rounded-3xl bg-paper p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[15px] text-muted">รอบ {a.slot.start_time}–{a.slot.end_time} น.</div>
          <h2 className="mt-0.5 text-[26px] font-semibold">{a.patient.first_name} {a.patient.last_name}</h2>
          <div className="text-muted">{a.patient.hn ? `HN ${a.patient.hn}` : 'บุคคลทั่วไป'}</div>
        </div>
        <StatusBadge status={a.status} className="text-[15px]" />
      </div>

      <div className="mt-5 rounded-2xl bg-mist px-5 py-4">
        <div className="text-[14px] text-muted">อาการที่แจ้งตอนจอง</div>
        <p className="mt-0.5 text-[17px]">{a.chief_complaint || 'ไม่ได้ระบุ'}</p>
      </div>

      {a.status === 'IN_SERVICE' && <Timer start={a.service_start} end={a.slot.end_time} />}

      {a.status === 'BOOKED' && <p className="mt-6 text-muted">ยังไม่ได้เช็กอินที่เคาน์เตอร์</p>}
      {a.status === 'CHECKED_IN' && (
        <Button size="lg" icon={Play} className="mt-6 w-full sm:w-auto" loading={busy === 'start'} onClick={() => call('start')}>
          เรียกเข้ารับบริการและเริ่มนวด
        </Button>
      )}

      {canRecord && (
        <div className="mt-6 space-y-4">
          <Field label="รายละเอียดการรักษา / จุดที่นวด">
            <Textarea value={record.treatment_details} onChange={(e) => setRecord({ ...record, treatment_details: e.target.value })} placeholder="เช่น นวดคอ บ่า ไหล่ ประคบสมุนไพร" maxLength={5000} />
          </Field>
          <Field label="คำแนะนำหลังนวด / นัดติดตาม">
            <Textarea value={record.post_treatment_note} onChange={(e) => setRecord({ ...record, post_treatment_note: e.target.value })} placeholder="เช่น งดยกของหนัก 3 วัน" maxLength={5000} />
          </Field>
          <div className="flex flex-wrap gap-3">
            {a.status === 'IN_SERVICE' && (
              <Button size="lg" icon={Square} loading={busy === 'complete'} onClick={() => call('complete')}>จบการนวด</Button>
            )}
            <Button size="lg" variant={a.status === 'COMPLETED' ? 'primary' : 'outline'} icon={Save} loading={busy === 'save'} onClick={() => call('save')}>
              บันทึก{a.status === 'IN_SERVICE' ? 'ระหว่างนวด' : 'การแก้ไข'}
            </Button>
          </div>
          {a.status === 'COMPLETED' && a.service_start && (
            <p className="text-[15px] text-muted">นวด {timeOf(a.service_start)}–{timeOf(a.service_end)} น.</p>
          )}
        </div>
      )}

      <div className="mt-8 border-t border-line pt-5">
        <h3 className="flex items-center gap-2 font-semibold"><NotebookPen className="size-5 text-herb" aria-hidden />ประวัติการนวดครั้งก่อน</h3>
        {!history ? <p className="mt-2 text-muted">กำลังโหลด</p> : !history.filter((h) => h.slot_date !== a.slot.slot_date).length ? (
          <p className="mt-2 text-muted">ยังไม่มีประวัติ (มาครั้งแรก)</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {history.filter((h) => h.slot_date !== a.slot.slot_date).slice(0, 5).map((h, i) => (
              <li key={i} className="rounded-xl border border-line px-4 py-3">
                <div className="text-[14px] text-muted">{thaiDate(h.slot_date)}</div>
                {h.treatment_details && <p className="mt-1">{h.treatment_details}</p>}
                {h.post_treatment_note && <p className="mt-1 text-[15px] text-muted">แนะนำ: {h.post_treatment_note}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Timer({ start, end }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = parseTs(start);
  if (!s) return null;
  const sec = Math.max(0, Math.floor((now - s.getTime()) / 1000));
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return (
    <div className="mt-5 flex items-center gap-4 rounded-2xl bg-turmeric-soft px-5 py-4">
      <Clock className="size-6 text-[#7a5e0e]" aria-hidden />
      <div>
        <div className="font-display text-[34px] font-semibold leading-none tabular-nums text-[#5c460a]" aria-live="off">{mm}:{ss}</div>
        <div className="text-[14px] text-[#7a5e0e]">เริ่ม {timeOf(start)} น. / หมดรอบ {end} น.</div>
      </div>
    </div>
  );
}
