/**
 * pages/staff/RoomPage.jsx — หน้าห้องนวด (/staff/room)
 *   ซ้าย: คิววันนี้ทุกเตียง / ขวา: คิวที่กำลังดูแล (ของฉันที่กำลังนวด → คนที่มาถึงแล้ว → ที่เลือก)
 *   รับคิว (บันทึกว่าใครนวด) → จับเวลา → กรอก VN / เปลี่ยนประเภทบริการ / บันทึกจุดที่นวด → จบการนวด + ดูประวัติครั้งก่อน
 *
 * หลายหมอนวด: ทุกคนเห็นคิวเดียวกัน ใครว่างก็กด "รับคิว" — ระบบบันทึกชื่อหมอนวดจากบัญชีที่ล็อกอิน
 * บัญชีแอดมิน/นักพัฒนา (ไม่ใช่หมอนวด) ต้องเลือกหมอนวดก่อนกดรับคิวแทน
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Play, Square, Save, ChevronRight, Clock, NotebookPen, UserRound, Hand } from 'lucide-react';
import { staffApi } from '../../lib/api.js';
import { thaiDateLong, timeOf, thaiDate, baht } from '../../lib/format.js';
import { Button, Spinner, StatusBadge, Field, Input, Select, Textarea, useToast, useConfirm, cx } from '../../components/ui.jsx';

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

  const appts = useMemo(() => (data?.slots ?? []).flatMap((s) => s.appointments.map((a) => ({ ...a, slot: s }))), [data]);
  const me = data?.me ?? null;                 // หมอนวดของบัญชีนี้ (null = แอดมิน)
  const [actAs, setActAs] = useState('');      // แอดมิน: รับคิวแทนหมอนวดคนไหน
  const myName = data?.practitioners.find((p) => p.practitioner_id === me)?.full_name;

  // คิวที่ควรโฟกัส: ที่เลือกไว้ → ของฉันที่กำลังนวด → คนที่มาถึงแล้ว (คิวถัดไป)
  const mine = appts.find((a) => a.status === 'IN_SERVICE' && me && a.practitioner?.practitioner_id === me);
  const nextUp = appts.find((a) => a.status === 'CHECKED_IN');
  const selected = appts.find((a) => a.appointment_id === selectedId) ?? mine ?? nextUp ?? null;

  if (!data) return <Spinner />;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold">ห้องนวด</h1>
          <p className="text-muted">{thaiDateLong(data.date)}</p>
        </div>
        {me ? (
          <span className="flex max-w-full items-center gap-2 rounded-2xl bg-leaf-soft px-4 py-2 text-[15px] text-herb"><Hand className="size-4 shrink-0" aria-hidden /><span className="shrink-0">หมอนวด:</span><b className="min-w-0">{myName}</b></span>
        ) : (
          <label className="flex items-center gap-2 text-[15px]">
            <span className="text-muted">รับคิวแทน</span>
            <Select value={actAs} onChange={(e) => setActAs(e.target.value)} className="h-11 w-56">
              <option value="">— เลือกหมอนวด —</option>
              {data.practitioners.map((p) => <option key={p.practitioner_id} value={p.practitioner_id}>{p.full_name}</option>)}
            </Select>
          </label>
        )}
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-[300px_1fr]">
        {/* รายการคิว */}
        <ol className="space-y-3" aria-label="คิววันนี้">
          {data.slots.map((s) => (
            <li key={s.slot_id}>
              <div className="mb-1 flex items-baseline gap-2 px-1">
                <span className={cx('font-display text-[17px] font-semibold', !s.appointments.length && 'text-faint')}>{s.start_time}</span>
                <span className="text-[13px] text-faint">
                  {s.state === 'HOLIDAY' ? 'วันหยุด' : s.state === 'BLOCKED' ? 'ปิดรับ' : s.capacity > 1 ? `${s.booked}/${s.capacity} เตียง` : !s.appointments.length ? 'ว่าง' : ''}
                </span>
              </div>
              <div className="space-y-1.5">
                {s.appointments.map((a) => {
                  const active = selected?.appointment_id === a.appointment_id;
                  return (
                    <button
                      key={a.appointment_id}
                      type="button"
                      onClick={() => setSelectedId(a.appointment_id)}
                      className={cx(
                        'flex w-full items-center gap-3 rounded-2xl border px-4 py-2.5 text-left transition-colors',
                        active ? 'border-herb bg-paper ring-2 ring-herb' : 'border-line bg-paper hover:border-herb',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{a.patient.first_name} {a.patient.last_name}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={a.status} className="text-[13px]" />
                          {a.practitioner && <span className="truncate text-[13px] text-muted">{a.practitioner.practitioner_id === me ? 'คุณ' : a.practitioner.full_name}</span>}
                        </span>
                      </span>
                      <ChevronRight className="size-5 shrink-0 text-faint" aria-hidden />
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ol>

        {/* รายละเอียด */}
        <section>
          {selected ? <Focus key={selected.appointment_id} a={selected} reload={load} me={me} actAs={actAs} services={data.service_types} />
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

function Focus({ a, reload, me, actAs, services }) {
  const [record, setRecord] = useState({
    treatment_details: a.treatment_details ?? '', post_treatment_note: a.post_treatment_note ?? '',
    vn: a.vn ?? '', service_type_id: a.service?.service_type_id ?? '',
  });
  const [history, setHistory] = useState(null);
  const [busy, setBusy] = useState(null);
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    staffApi(`/practitioner/patients/${a.patient.patient_id}/history`).then((d) => setHistory(d.history)).catch(() => setHistory([]));
  }, [a.patient.patient_id]);

  const body = () => ({
    treatment_details: record.treatment_details, post_treatment_note: record.post_treatment_note,
    vn: record.vn.trim() || null, ...(record.service_type_id && { service_type_id: Number(record.service_type_id) }),
  });

  const call = async (kind) => {
    if (kind === 'start' && !me && !actAs) return toast('เลือกหมอนวดที่มุมขวาบนก่อน', 'error');
    if (kind === 'complete') {
      const ok = await confirm({
        title: 'จบการนวดคิวนี้?',
        body: record.vn.trim()
          ? 'ระบบจะบันทึกเวลาจบ VN และผลการรักษาที่กรอกไว้'
          : 'ยังไม่ได้กรอก VN (ใช้ตอนเบิกจ่าย) — จบการนวดไปก่อนได้ แล้วให้เคาน์เตอร์กรอกทีหลัง',
        okText: 'จบการนวด',
      });
      if (!ok) return;
    }
    setBusy(kind);
    try {
      if (kind === 'start') await staffApi(`/practitioner/appointments/${a.appointment_id}/start`, { method: 'POST', body: me ? {} : { practitioner_id: Number(actAs) } });
      if (kind === 'complete') await staffApi(`/practitioner/appointments/${a.appointment_id}/complete`, { method: 'POST', body: body() });
      if (kind === 'save') await staffApi(`/practitioner/appointments/${a.appointment_id}/record`, { method: 'PUT', body: body() });
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
          <div className="text-muted">{a.patient.hn ? `HN ${a.patient.hn}` : 'บุคคลทั่วไป'}{a.patient.national_id_masked ? ` · บัตร ${a.patient.national_id_masked}` : ''}</div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <StatusBadge status={a.status} className="text-[15px]" />
          {a.practitioner && (
            <span className="flex items-center gap-1 text-[14px] text-muted"><Hand className="size-4 text-clay" aria-hidden />
              {a.practitioner.practitioner_id === me ? 'คุณเป็นผู้นวด' : a.practitioner.full_name}
            </span>
          )}
        </div>
      </div>
      {a.service && (
        <div className="mt-3 inline-flex rounded-full bg-leaf-soft px-3 py-1 text-[15px] font-medium text-herb">{a.service.name} · {baht(a.service.price)}</div>
      )}

      <div className="mt-5 rounded-2xl bg-mist px-5 py-4">
        <div className="text-[14px] text-muted">อาการที่แจ้งตอนจอง</div>
        <p className="mt-0.5 text-[17px]">{a.chief_complaint || 'ไม่ได้ระบุ'}</p>
      </div>

      {a.status === 'IN_SERVICE' && <Timer start={a.service_start} end={a.slot.end_time} />}

      {a.status === 'BOOKED' && <p className="mt-6 text-muted">ยังไม่ได้เช็กอินที่เคาน์เตอร์</p>}
      {a.status === 'CHECKED_IN' && (
        <Button size="lg" icon={Play} className="mt-6 w-full sm:w-auto" loading={busy === 'start'} onClick={() => call('start')}>
          รับคิวนี้และเริ่มนวด
        </Button>
      )}

      {canRecord && (
        <div className="mt-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="VN (Visit Number)" hint={a.vn ? 'เคาน์เตอร์กรอกไว้แล้ว แก้ได้' : 'ใช้ตอนเบิกจ่าย — ถ้ายังไม่มี เว้นไว้ได้'}>
              <Input value={record.vn} onChange={(e) => setRecord({ ...record, vn: e.target.value.toUpperCase() })} maxLength={20} inputMode="numeric" className="font-display tracking-wide" />
            </Field>
            <Field label="ประเภทบริการ" hint="เปลี่ยนได้ถ้าผู้รับบริการเปลี่ยนใจ (ราคาตามปัจจุบัน)">
              <Select value={record.service_type_id} onChange={(e) => setRecord({ ...record, service_type_id: e.target.value })}>
                {!services.some((x) => x.service_type_id === a.service?.service_type_id) && a.service && (
                  <option value={a.service.service_type_id}>{a.service.name} ({baht(a.service.price)})</option>
                )}
                {services.map((x) => <option key={x.service_type_id} value={x.service_type_id}>{x.name} ({baht(x.price)})</option>)}
              </Select>
            </Field>
          </div>
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
