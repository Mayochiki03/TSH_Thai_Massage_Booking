/**
 * pages/admin/UsersPage.jsx — บัญชีผู้ใช้ระบบ + รายชื่อหมอนวด
 *
 *  แท็บ "บัญชีผู้ใช้" : CRUD /api/admin/users, รีเซ็ตรหัสผ่าน (ผู้ใช้ต้องเปลี่ยนเองตอนล็อกอินครั้งถัดไป)
 *                      ผู้ดูแล (ADMIN) จัดการบัญชีนักพัฒนา (DEV) ไม่ได้ — backend บังคับอีกชั้น
 *  แท็บ "หมอนวด"     : CRUD /api/admin/practitioners — รายชื่อคนที่ "นวด" (ใช้บันทึกว่าใครนวดคิวไหน + กรองรายงาน)
 *                      ปิด "ปฏิบัติงาน" = ไม่โผล่ให้เลือกตอนเริ่มนวด (ประวัติเดิมยังอยู่)
 *
 *  หมอนวดจะล็อกอินเองได้ ต้องมี 2 อย่าง: (1) ชื่อในแท็บหมอนวด (2) บัญชีบทบาท "หมอนวด" ที่ผูกกับชื่อนั้น
 *  → ล็อกอินที่ /staff แล้วเข้าหน้าห้องนวดทันที กด "รับคิวนี้และเริ่มนวด" ระบบบันทึกชื่อเขาให้เอง
 *  จำนวนหมอนวดไม่ได้กำหนดจำนวนเตียง — ตั้งเตียงที่เมนู "รอบเวลาและเตียง"
 */
import { useEffect, useState } from 'react';
import { UserPlus, KeyRound, Pencil, Plus, Save } from 'lucide-react';
import { staffApi } from '../../lib/api.js';
import { useLoad } from '../../lib/useLoad.js';
import { useSession, ROLE_LABEL } from '../../lib/session.jsx';
import { Button, Card, Field, Input, PageHeader, Segmented, Select, Sheet, Spinner, Switch, useToast, cx } from '../../components/ui.jsx';

export function UsersPage() {
  const [tab, setTab] = useState('users');
  return (
    <>
      <PageHeader title="บัญชีผู้ใช้ระบบ" description="เจ้าหน้าที่ หมอนวด ผู้ดูแล และเครื่อง kiosk" />
      <Segmented className="mb-6" value={tab} onChange={setTab} options={[{ value: 'users', label: 'บัญชีผู้ใช้' }, { value: 'practitioners', label: 'หมอนวด' }]} />
      {tab === 'users' ? <Users /> : <Practitioners />}
    </>
  );
}

// ---------------------------------------------------------------------
function Users() {
  const { user: me } = useSession();
  const { data, reload } = useLoad(() => Promise.all([staffApi('/admin/users'), staffApi('/admin/practitioners')]), []);
  const [edit, setEdit] = useState(null); // null | 'new' | user

  if (!data) return <Spinner />;
  const [{ users }, { practitioners }] = data;
  const canManage = (u) => me.role === 'DEV' || u.role !== 'DEV';

  return (
    <>
      <div className="mb-4 flex justify-end"><Button icon={UserPlus} onClick={() => setEdit('new')}>เพิ่มบัญชี</Button></div>
      <Card bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-[15px]">
            <thead className="border-b border-line text-[14px] text-muted">
              <tr><th className="px-5 py-3 font-medium">ชื่อ</th><th className="px-3 py-3 font-medium">ชื่อผู้ใช้</th><th className="px-3 py-3 font-medium">บทบาท</th><th className="px-3 py-3 font-medium">เข้าระบบล่าสุด</th><th className="px-5 py-3" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {users.map((u) => (
                <tr key={u.user_id} className={cx(!u.is_active && 'text-faint')}>
                  <td className="px-5 py-3 font-medium">{u.full_name}{!u.is_active && ' (ปิดใช้งาน)'}{u.user_id === me.user_id && <span className="text-muted"> (คุณ)</span>}</td>
                  <td className="px-3 py-3">{u.username}</td>
                  <td className="px-3 py-3">{ROLE_LABEL[u.role]}{u.must_change_password ? <span className="text-clay"> รอเปลี่ยนรหัส</span> : ''}</td>
                  <td className="px-3 py-3 tabular-nums text-muted">{u.last_login_at?.slice(0, 16) ?? '-'}</td>
                  <td className="px-5 py-3 text-right">
                    {canManage(u) && (
                      <button type="button" onClick={() => setEdit(u)} className="grid size-9 place-items-center rounded-lg text-muted hover:bg-sand" aria-label={`แก้ไข ${u.username}`}>
                        <Pencil className="size-[18px]" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <UserSheet user={edit} practitioners={practitioners} isDev={me.role === 'DEV'} onClose={() => setEdit(null)} onSaved={reload} />
    </>
  );
}

function UserSheet({ user, practitioners, isDev, onClose, onSaved }) {
  const isNew = user === 'new';
  const [form, setForm] = useState({});
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(null);
  const toast = useToast();

  useEffect(() => {
    if (!user) return;
    setPw('');
    setForm(isNew
      ? { username: '', full_name: '', role: 'STAFF', practitioner_id: practitioners[0]?.practitioner_id ?? null, is_active: true }
      : { username: user.username, full_name: user.full_name, role: user.role, practitioner_id: user.practitioner_id, is_active: !!user.is_active });
  }, [user, isNew, practitioners]);
  if (!user) return null;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const roles = ['STAFF', 'PRACTITIONER', 'KIOSK', 'ADMIN', ...(isDev ? ['DEV'] : [])];

  const save = async () => {
    setBusy('save');
    try {
      const body = { ...form, practitioner_id: form.role === 'PRACTITIONER' ? Number(form.practitioner_id) : null };
      if (isNew) await staffApi('/admin/users', { method: 'POST', body: { ...body, password: pw } });
      else await staffApi(`/admin/users/${user.user_id}`, { method: 'PUT', body });
      toast(isNew ? 'สร้างบัญชีแล้ว ผู้ใช้ต้องเปลี่ยนรหัสตอนเข้าครั้งแรก' : 'บันทึกแล้ว');
      onSaved(); onClose();
    } catch (err) { toast(err.fields ? Object.values(err.fields)[0][0] : err.message, 'error'); }
    finally { setBusy(null); }
  };

  const resetPw = async () => {
    setBusy('reset');
    try { await staffApi(`/admin/users/${user.user_id}/reset-password`, { method: 'POST', body: { password: pw } }); toast('ตั้งรหัสผ่านชั่วคราวแล้ว'); setPw(''); onSaved(); }
    catch (err) { toast(err.fields ? Object.values(err.fields)[0][0] : err.message, 'error'); }
    finally { setBusy(null); }
  };

  return (
    <Sheet open onClose={onClose} title={isNew ? 'เพิ่มบัญชีผู้ใช้' : `แก้ไข ${user.username}`}
      footer={<Button size="lg" icon={Save} className="w-full" loading={busy === 'save'} onClick={save}>บันทึก</Button>}>
      <div className="space-y-4">
        <Field label="ชื่อที่แสดง"><Input value={form.full_name ?? ''} onChange={set('full_name')} maxLength={200} /></Field>
        <Field label="ชื่อผู้ใช้ (ใช้ล็อกอิน)" hint="a-z 0-9 . _ - อย่างน้อย 3 ตัว"><Input value={form.username ?? ''} onChange={set('username')} autoCapitalize="none" maxLength={50} /></Field>
        <Field label="บทบาท">
          <Select value={form.role} onChange={set('role')}>
            {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </Select>
        </Field>
        {form.role === 'PRACTITIONER' && (
          <Field label="ผูกกับหมอนวด" hint="กดเริ่มนวดจากบัญชีนี้ ระบบบันทึกเป็นชื่อหมอนวดคนนี้ (ไม่มีชื่อ → เพิ่มที่แท็บ หมอนวด ก่อน)">
            <Select value={form.practitioner_id ?? ''} onChange={set('practitioner_id')}>
              {practitioners.map((p) => <option key={p.practitioner_id} value={p.practitioner_id}>{p.full_name}</option>)}
            </Select>
          </Field>
        )}
        <Switch checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} label="เปิดใช้งาน" description="ปิดแล้วบัญชีนี้ล็อกอินไม่ได้ทันที" />
        <div className="rounded-2xl bg-sand p-4">
          <Field label={isNew ? 'รหัสผ่านเริ่มต้น' : 'ตั้งรหัสผ่านชั่วคราวใหม่'} hint="อย่างน้อย 8 ตัวอักษร ผู้ใช้ต้องเปลี่ยนเองตอนล็อกอินครั้งถัดไป">
            <Input type="text" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
          </Field>
          {!isNew && <Button size="sm" variant="outline" icon={KeyRound} className="mt-3" disabled={pw.length < 8} loading={busy === 'reset'} onClick={resetPw}>รีเซ็ตรหัสผ่าน</Button>}
        </div>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------
function Practitioners() {
  const { data, setData, reload } = useLoad(() => staffApi('/admin/practitioners').then((d) => d.practitioners), []);
  const toast = useToast();
  if (!data) return <Spinner />;

  const edit = (i, patch) => setData(data.map((p, j) => (j === i ? { ...p, ...patch, _dirty: true } : p)));
  const save = async (p) => {
    try {
      const body = { full_name: p.full_name, license_no: p.license_no || null, is_active: !!p.is_active };
      if (p.practitioner_id) await staffApi(`/admin/practitioners/${p.practitioner_id}`, { method: 'PUT', body });
      else await staffApi('/admin/practitioners', { method: 'POST', body });
      toast('บันทึกแล้ว'); reload();
    } catch (err) { toast(err.message, 'error'); }
  };

  return (
    <Card bodyClassName="p-0">
      <p className="border-b border-line bg-ivory px-5 py-3 text-[14px] text-muted">
        ให้หมอนวดล็อกอินเองได้: เพิ่มชื่อที่นี่ แล้วไปแท็บ <b>บัญชีผู้ใช้</b> → เพิ่มบัญชีบทบาท <b>หมอนวด</b> และผูกกับชื่อนี้
      </p>
      <ul className="divide-y divide-line">
        {data.map((p, i) => (
          <li key={p.practitioner_id ?? `new-${i}`} className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_200px_auto_auto] sm:items-center">
            <Input value={p.full_name} onChange={(e) => edit(i, { full_name: e.target.value })} aria-label="ชื่อหมอนวด" placeholder="ชื่อ-นามสกุล" />
            <Input value={p.license_no ?? ''} onChange={(e) => edit(i, { license_no: e.target.value })} aria-label="เลขใบอนุญาต" placeholder="เลขใบอนุญาต" />
            <label className="flex items-center gap-2 text-[15px]"><input type="checkbox" className="size-5 accent-herb" checked={!!p.is_active} onChange={(e) => edit(i, { is_active: e.target.checked })} />ปฏิบัติงาน</label>
            <Button size="sm" icon={Save} disabled={!p._dirty} onClick={() => save(p)}>บันทึก</Button>
          </li>
        ))}
      </ul>
      <div className="border-t border-line px-5 py-3">
        <Button size="sm" variant="soft" icon={Plus} onClick={() => setData([...data, { full_name: '', license_no: '', is_active: 1, _dirty: true }])}>เพิ่มหมอนวด</Button>
      </div>
    </Card>
  );
}
