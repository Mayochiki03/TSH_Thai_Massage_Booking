import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { patientApi } from '../../lib/liff.js';
import { Button, useToast } from '../../components/ui.jsx';
import { usePatient } from './PatientApp.jsx';
import { PersonForm, emptyPerson, validatePerson, fieldErrors, toPayload } from './PersonForm.jsx';

export function Onboarding() {
  const { me } = usePatient();
  return !me.consented ? <Consent /> : <SelfInfo />;
}

function Consent() {
  const { refreshMe } = usePatient();
  const [agree, setAgree] = useState(false);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const submit = async () => {
    setLoading(true);
    try { await patientApi('/me/consent', { method: 'POST' }); await refreshMe(); }
    catch (err) { toast(err.message, 'error'); setLoading(false); }
  };

  return (
    <div className="anim-rise px-5 pt-6 pb-10">
      <h1 className="text-[26px] font-semibold">ก่อนเริ่มจองคิว</h1>
      <p className="mt-2 text-muted">ระบบจะเก็บข้อมูลเท่าที่จำเป็นสำหรับการนัดหมายเท่านั้น</p>

      <div className="mt-6 rounded-2xl bg-mist p-5">
        <div className="mb-3 flex items-center gap-2 font-display font-medium text-herb">
          <ShieldCheck className="size-5" aria-hidden />
          ข้อมูลที่เราเก็บ
        </div>
        <ul className="space-y-2.5 text-[16px]">
          <li>ชื่อ-นามสกุล เบอร์โทร และเลข HN (ถ้ามี) ของผู้จองและผู้รับบริการ</li>
          <li>อาการเบื้องต้นและบันทึกการนวด เพื่อใช้ประกอบเวชระเบียนของโรงพยาบาล</li>
          <li>บัญชี LINE ของคุณ เพื่อส่งตั๋วและแจ้งเตือนนัดหมาย</li>
        </ul>
        <p className="mt-4 text-[15px] text-muted">ข้อมูลใช้ภายในโรงพยาบาลเท่านั้น ไม่เปิดเผยต่อบุคคลภายนอก ขอลบข้อมูลได้ที่เคาน์เตอร์</p>
      </div>

      <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-2xl border border-line p-4 has-[:checked]:border-herb has-[:checked]:bg-leaf-soft">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 size-5 accent-herb" />
        <span>ฉันยินยอมให้โรงพยาบาลเก็บและใช้ข้อมูลข้างต้นเพื่อการนัดหมายและการรักษา</span>
      </label>

      <Button size="lg" className="mt-6 w-full" disabled={!agree} loading={loading} onClick={submit}>
        ยินยอมและเริ่มใช้งาน
      </Button>
    </div>
  );
}

function SelfInfo() {
  const { refreshMe, me } = usePatient();
  const [form, setForm] = useState(() => ({ ...emptyPerson, relation: undefined }));
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const submit = async (e) => {
    e.preventDefault();
    const v = validatePerson(form, false);
    setErrors(v);
    if (Object.keys(v).length) return;
    setLoading(true);
    try {
      const { relation, ...payload } = toPayload(form);
      await patientApi('/me/self', { method: 'PUT', body: payload });
      await refreshMe();
      toast('บันทึกข้อมูลแล้ว');
    } catch (err) {
      setErrors(fieldErrors(err));
      toast(err.message, 'error');
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="anim-rise px-5 pt-6 pb-10">
      <h1 className="text-[26px] font-semibold">ข้อมูลของคุณ</h1>
      <p className="mt-2 mb-6 text-muted">
        {me.display_name ? `สวัสดีคุณ ${me.display_name} ` : ''}กรอกครั้งเดียว ครั้งต่อไปกดจองได้เลย
      </p>
      <PersonForm value={form} onChange={setForm} errors={errors} />
      <Button type="submit" size="lg" className="mt-8 w-full" loading={loading}>บันทึกข้อมูล</Button>
    </form>
  );
}
