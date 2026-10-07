/**
 * pages/patient/PeoplePage.jsx — รายชื่อผู้รับบริการที่ผู้จองคนนี้จองให้ได้ (ตัวเอง + ครอบครัว)
 * PersonSheet: หน้าต่างเพิ่ม/แก้ไขผู้รับบริการ ใช้ร่วมกับหน้าจอง
 */
import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2, UserRound } from 'lucide-react';
import { patientApi } from '../../lib/liff.js';
import { Button, Sheet, useToast, useConfirm } from '../../components/ui.jsx';
import { usePatient } from './PatientApp.jsx';
import { PersonForm, emptyPerson, validatePerson, fieldErrors, toPayload } from './PersonForm.jsx';

export function PeoplePage() {
  const { me, refreshMe } = usePatient();
  const [editing, setEditing] = useState(null); // null | 'new' | patient
  const toast = useToast();
  const confirm = useConfirm();

  const remove = async (p) => {
    const ok = await confirm({
      title: `เอา ${p.first_name} ออกจากรายชื่อ?`,
      body: 'ประวัติการจองเดิมยังอยู่ จองให้คนนี้อีกครั้งได้โดยเพิ่มชื่อใหม่',
      okText: 'เอาออก', danger: true,
    });
    if (!ok) return;
    try { await patientApi(`/me/patients/${p.patient_id}`, { method: 'DELETE' }); await refreshMe(); toast('เอาออกจากรายชื่อแล้ว'); }
    catch (err) { toast(err.message, 'error'); }
  };

  return (
    <div className="pt-6 pb-10 lg:pt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold">รายชื่อผู้รับบริการ</h1>
          <p className="mt-1 text-muted">คนที่คุณจองคิวให้ได้</p>
        </div>
        <Button variant="soft" icon={Plus} className="hidden sm:inline-flex" onClick={() => setEditing('new')}>เพิ่มคนที่จะจองให้</Button>
      </div>
      <ul className="mt-6 grid gap-3 md:grid-cols-2">
        {me.patients.map((p) => (
          <li key={p.patient_id} className="flex items-center gap-3 rounded-2xl border border-line bg-paper px-4 py-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sand text-clay"><UserRound className="size-5" aria-hidden /></span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{p.first_name} {p.last_name}</div>
              <div className="text-[14px] text-muted">{p.is_self ? 'ตัวเอง' : p.relation} / {p.phone_number}{p.hn ? ` / HN ${p.hn}` : ''}</div>
            </div>
            <button type="button" onClick={() => setEditing(p)} className="grid size-10 place-items-center rounded-full text-muted hover:bg-mist" aria-label={`แก้ไข ${p.first_name}`}>
              <Pencil className="size-[18px]" />
            </button>
            {!p.is_self && (
              <button type="button" onClick={() => remove(p)} className="grid size-10 place-items-center rounded-full text-muted hover:bg-rose-soft hover:text-rose-ink" aria-label={`เอา ${p.first_name} ออก`}>
                <Trash2 className="size-[18px]" />
              </button>
            )}
          </li>
        ))}
      </ul>
      <Button variant="soft" icon={Plus} className="mt-4 w-full sm:hidden" onClick={() => setEditing('new')}>เพิ่มคนที่จะจองให้</Button>

      <PersonSheet open={!!editing} person={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
    </div>
  );
}

/** Sheet เพิ่ม/แก้ผู้รับบริการ (ใช้ทั้งหน้ารายชื่อและหน้าจอง) */
export function PersonSheet({ open, person, onClose, onSaved }) {
  const { refreshMe } = usePatient();
  const toast = useToast();
  const isSelf = person?.is_self;
  const [form, setForm] = useState(emptyPerson);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(person ? { ...emptyPerson, ...person, hn: person.hn ?? '', relation: isSelf ? undefined : person.relation } : { ...emptyPerson });
  }, [open, person, isSelf]);

  const save = async () => {
    const v = validatePerson(form, !isSelf);
    setErrors(v);
    if (Object.keys(v).length) return;
    setLoading(true);
    try {
      const body = toPayload(form);
      const profile = isSelf
        ? await patientApi('/me/self', { method: 'PUT', body: { ...body, relation: undefined } })
        : person
          ? await patientApi(`/me/patients/${person.patient_id}`, { method: 'PUT', body })
          : await patientApi('/me/patients', { method: 'POST', body });
      await refreshMe();
      toast(person ? 'บันทึกการแก้ไขแล้ว' : `เพิ่ม ${form.first_name} แล้ว`);
      onSaved?.(profile);
      onClose();
    } catch (err) {
      setErrors(fieldErrors(err));
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={person ? 'แก้ไขข้อมูล' : 'จองให้คนอื่น'}
      footer={<Button size="lg" className="w-full" loading={loading} onClick={save}>{person ? 'บันทึก' : 'เพิ่มรายชื่อ'}</Button>}
    >
      <PersonForm key={`${open}-${person?.patient_id ?? 'new'}`} value={form} onChange={setForm} errors={errors} withRelation={!isSelf} />
    </Sheet>
  );
}
