/**
 * pages/admin/PatientsPage.jsx — ข้อมูลผู้รับบริการ (CRUD /api/admin/patients)
 *
 *  - ค้นหาด้วยชื่อ / เบอร์ / HN / เลขบัตรประชาชน 13 หลัก (ค้นด้วย hash — ไม่ต้องถอดรหัสทั้งตาราง), แบ่งหน้า 30 รายการ
 *  - ตารางแสดงเลขบัตรแบบปิดบัง (x-xxxx-xxxx9-87-6) · หน้ารายละเอียดเห็นเลขเต็มเพื่อแก้ไข (ทุกครั้งที่เปิดดูถูกบันทึก audit log)
 *  - เลขบัตรไม่ได้แก้ → ไม่ส่งไป backend (log จะได้บอกถูกว่าใครเปลี่ยนเลขบัตรจริง)
 *  - กดแถว → หน้าต่างรายละเอียด: แก้ข้อมูล, ประวัติการจอง, ผู้จองที่ผูกไว้ (LINE), ประวัติระงับสิทธิ์,
 *    ระงับสิทธิ์ด้วยมือ, ลบ (soft delete — ประวัติยังอยู่)
 */
import { useEffect, useState } from 'react';
import { Search, UserPlus, ChevronLeft, ChevronRight, Ban, Trash2, Save } from 'lucide-react';
import { staffApi } from '../../lib/api.js';
import { useLoad } from '../../lib/useLoad.js';
import { thaiDate, hhmm } from '../../lib/format.js';
import { Button, Card, Field, Input, PageHeader, Sheet, Spinner, StatusBadge, Empty, useToast, useConfirm } from '../../components/ui.jsx';
import { PersonForm, emptyPerson, validatePerson, fieldErrors, toPayload } from '../patient/PersonForm.jsx';

const PAGE = 30;

export function PatientsPage() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState(null); // patient_id ที่เปิดดู หรือ 'new'
  const { data, reload } = useLoad(
    () => staffApi(`/admin/patients?limit=${PAGE}&offset=${offset}&q=${encodeURIComponent(query)}`),
    [offset, query],
  );

  // พิมพ์ค้นหา → รอ 300ms ค่อยค้น
  useEffect(() => { const t = setTimeout(() => { setOffset(0); setQuery(q.trim()); }, 300); return () => clearTimeout(t); }, [q]);

  return (
    <>
      <PageHeader title="ผู้รับบริการ" description="ทั้งผู้ป่วยที่มี HN และบุคคลทั่วไป" actions={<Button icon={UserPlus} onClick={() => setOpenId('new')}>เพิ่มผู้รับบริการ</Button>} />
      <label className="relative mb-4 block max-w-md">
        <span className="sr-only">ค้นหา</span>
        <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-faint" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อ เบอร์โทร HN หรือเลขบัตร 13 หลัก" className="pl-12" />
      </label>

      <Card bodyClassName="p-0">
        {!data ? <Spinner /> : !data.patients.length ? <Empty title="ไม่พบผู้รับบริการ" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-[15px]">
              <thead className="border-b border-line text-[14px] text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">ชื่อ-นามสกุล</th><th className="px-3 py-3 font-medium">เลขบัตรประชาชน</th><th className="px-3 py-3 font-medium">HN</th><th className="px-3 py-3 font-medium">เบอร์โทร</th>
                  <th className="px-3 py-3 text-right font-medium">จองทั้งหมด</th><th className="px-3 py-3 text-right font-medium">ไม่มา</th><th className="px-5 py-3 font-medium">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.patients.map((p) => (
                  <tr key={p.patient_id} onClick={() => setOpenId(p.patient_id)} className="cursor-pointer hover:bg-ivory">
                    <td className="px-5 py-3 font-medium"><button type="button" className="text-left hover:text-herb">{p.first_name} {p.last_name}</button></td>
                    <td className="px-3 py-3 tabular-nums">
                      {p.national_id_masked ?? (p.no_national_id ? <span className="text-faint">ไม่มีบัตรไทย</span> : <span className="text-clay">ยังไม่กรอก</span>)}
                    </td>
                    <td className="px-3 py-3">{p.hn ?? <span className="text-faint">บุคคลทั่วไป</span>}</td>
                    <td className="px-3 py-3 tabular-nums">{p.phone_number}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{p.total_bookings}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{p.no_shows > 0 ? <span className="text-clay">{p.no_shows}</span> : 0}</td>
                    <td className="px-5 py-3">{p.suspended_until ? <span className="text-clay">ระงับถึง {thaiDate(p.suspended_until)}</span> : <span className="text-muted">ปกติ</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {data && data.total > PAGE && (
        <div className="mt-4 flex items-center justify-end gap-2 text-[15px] text-muted">
          <span>{offset + 1}–{Math.min(offset + PAGE, data.total)} จาก {data.total}</span>
          <Button size="sm" variant="outline" icon={ChevronLeft} disabled={offset === 0} onClick={() => setOffset(offset - PAGE)} aria-label="หน้าก่อน" />
          <Button size="sm" variant="outline" icon={ChevronRight} disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)} aria-label="หน้าถัดไป" />
        </div>
      )}
      <PatientSheet id={openId} onClose={() => setOpenId(null)} onChanged={reload} />
    </>
  );
}

function PatientSheet({ id, onClose, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState({ ...emptyPerson, relation: undefined, note: '' });
  const [errors, setErrors] = useState({});
  const [susp, setSusp] = useState({ days: '', reason: '' });
  const [busy, setBusy] = useState(null);
  const toast = useToast();
  const confirm = useConfirm();
  const isNew = id === 'new';

  const load = async () => {
    const d = await staffApi(`/admin/patients/${id}`);
    setDetail(d);
    setForm({
      first_name: d.patient.first_name, last_name: d.patient.last_name, phone_number: d.patient.phone_number, hn: d.patient.hn ?? '',
      note: d.patient.note ?? '', relation: undefined,
      national_id: d.patient.national_id ?? '', no_national_id: !!d.patient.no_national_id,
    });
  };

  useEffect(() => {
    setErrors({}); setSusp({ days: '', reason: '' }); setDetail(null);
    if (!id) return;
    if (isNew) setForm({ ...emptyPerson, relation: undefined, note: '' });
    else load().catch((err) => toast(err.message, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!id) return null;

  const save = async () => {
    const v = validatePerson(form, false);
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy('save');
    try {
      const { relation, ...p } = toPayload(form);
      const body = { ...p, note: form.note?.trim() || null };
      // เลขบัตรเดิมไม่ได้แก้ → ไม่ส่ง (ยกเว้นติ๊ก "ไม่มีบัตรไทย" ซึ่งต้องส่งเพื่อลบเลขเดิม)
      if (!isNew && detail?.patient.national_id && form.national_id === detail.patient.national_id) delete body.national_id;
      if (isNew) await staffApi('/admin/patients', { method: 'POST', body });
      else await staffApi(`/admin/patients/${id}`, { method: 'PUT', body });
      toast('บันทึกแล้ว');
      onChanged();
      if (isNew) onClose(); else load();
    } catch (err) { setErrors(fieldErrors(err)); toast(err.message, 'error'); }
    finally { setBusy(null); }
  };

  const suspend = async () => {
    if (!susp.reason.trim()) return toast('ระบุเหตุผลการระงับ', 'error');
    setBusy('suspend');
    try {
      await staffApi('/admin/suspensions', { method: 'POST', body: { patient_id: id, reason: susp.reason.trim(), ...(susp.days && { days: Number(susp.days) }) } });
      toast('ระงับสิทธิ์แล้ว'); setSusp({ days: '', reason: '' }); load(); onChanged();
    } catch (err) { toast(err.message, 'error'); }
    finally { setBusy(null); }
  };

  const remove = async () => {
    if (!(await confirm({ title: 'ลบผู้รับบริการนี้?', body: 'ข้อมูลจะถูกซ่อนจากการค้นหา ประวัติการจองเดิมยังเก็บไว้', okText: 'ลบ', danger: true }))) return;
    try { await staffApi(`/admin/patients/${id}`, { method: 'DELETE' }); toast('ลบแล้ว'); onChanged(); onClose(); }
    catch (err) { toast(err.message, 'error'); }
  };

  return (
    <Sheet open wide onClose={onClose} title={isNew ? 'เพิ่มผู้รับบริการ' : 'ข้อมูลผู้รับบริการ'}
      footer={
        <div className="flex flex-wrap gap-3">
          {!isNew && <Button variant="danger" icon={Trash2} onClick={remove}>ลบ</Button>}
          <Button icon={Save} className="ml-auto" loading={busy === 'save'} onClick={save}>บันทึก</Button>
        </div>
      }
    >
      {!isNew && !detail ? <Spinner /> : (
        <div className="space-y-6">
          <div>
            <PersonForm value={form} onChange={setForm} errors={errors} />
            <Field label="หมายเหตุ (เห็นเฉพาะเจ้าหน้าที่)" className="mt-4">
              <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={255} />
            </Field>
          </div>

          {detail && (
            <>
              {detail.bookers.length > 0 && (
                <section>
                  <h3 className="mb-2 font-semibold">ผู้จองที่ผูกไว้ (LINE)</h3>
                  <ul className="space-y-1 text-[15px]">
                    {detail.bookers.map((b) => <li key={b.line_user_id}>{b.display_name ?? 'ไม่ทราบชื่อ'} <span className="text-muted">({b.relation})</span></li>)}
                  </ul>
                </section>
              )}

              <section>
                <h3 className="mb-2 font-semibold">ประวัติการจอง ({detail.appointments.length})</h3>
                {!detail.appointments.length ? <p className="text-muted">ยังไม่เคยจอง</p> : (
                  <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-xl border border-line">
                    {detail.appointments.map((a) => (
                      <li key={a.appointment_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[15px]">
                        <span className="tabular-nums">{thaiDate(a.slot_date)} {hhmm(a.start_time)}</span>
                        <StatusBadge status={a.status} className="text-[13px]" />
                        <span className="font-display tracking-wider text-muted">{a.booking_code}</span>
                        {a.chief_complaint && <span className="w-full text-muted">{a.chief_complaint}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="rounded-2xl bg-sand p-4">
                <h3 className="mb-1 flex items-center gap-2 font-semibold text-clay"><Ban className="size-5" aria-hidden />ระงับสิทธิ์การจอง</h3>
                {detail.suspensions.length > 0 && (
                  <ul className="mb-3 space-y-1 text-[14px] text-muted">
                    {detail.suspensions.map((s) => (
                      <li key={s.suspension_id}>{thaiDate(s.start_date)} – {thaiDate(s.end_date)}: {s.reason} {s.lifted_at && '(ปลดแล้ว)'}</li>
                    ))}
                  </ul>
                )}
                <div className="grid gap-3 sm:grid-cols-[1fr_120px_auto] sm:items-end">
                  <Field label="เหตุผล"><Input value={susp.reason} onChange={(e) => setSusp({ ...susp, reason: e.target.value })} placeholder="เช่น ไม่มาตามนัดบ่อย" /></Field>
                  <Field label="จำนวนวัน"><Input type="number" min={1} max={365} value={susp.days} onChange={(e) => setSusp({ ...susp, days: e.target.value })} placeholder="ตามกฎ" /></Field>
                  <Button variant="outline" loading={busy === 'suspend'} onClick={suspend}>ระงับสิทธิ์</Button>
                </div>
              </section>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}

