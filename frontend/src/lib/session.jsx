/**
 * lib/session.jsx — การล็อกอินของบัญชีในระบบ (เจ้าหน้าที่ / หมอนวด / แอดมิน / นักพัฒนา / เครื่อง kiosk)
 *
 * ทั้ง 3 แอป (/staff, /admin, /kiosk) ใช้ <SessionGate> ตัวเดียวกัน:
 *   ยังไม่ล็อกอิน         → หน้าเข้าสู่ระบบ
 *   ต้องเปลี่ยนรหัสผ่าน    → หน้าตั้งรหัสผ่านใหม่
 *   role ไม่มีสิทธิ์แอปนี้ → หน้าแจ้ง + ปุ่มไปแอปที่ role นั้นใช้ได้
 *   ผ่านทั้งหมด            → แสดง children และแชร์ { user, logout } ผ่าน useSession()
 *
 * session จริงเก็บเป็น httpOnly cookie ฝั่ง backend — หน้าเว็บไม่ได้ถือ token เอง
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { KeyRound, ShieldAlert } from 'lucide-react';
import { staffApi, setUnauthorizedHandler } from './api.js';
import { CompressMark } from '../components/Logo.jsx';
import { Button, Field, Input, Spinner, useToast } from '../components/ui.jsx';

export const ROLE_LABEL = {
  DEV: 'นักพัฒนาระบบ',
  ADMIN: 'ผู้ดูแลระบบ',
  STAFF: 'เจ้าหน้าที่เคาน์เตอร์',
  PRACTITIONER: 'หมอนวด',
  KIOSK: 'เครื่อง kiosk',
};

/** หน้าแรกของแต่ละ role หลังล็อกอิน */
export function homeFor(role) {
  if (role === 'DEV' || role === 'ADMIN') return '/admin';
  if (role === 'PRACTITIONER') return '/staff/room';
  if (role === 'KIOSK') return '/kiosk';
  return '/staff/queue';
}

const SessionCtx = createContext(null);
/** { user, logout } ของบัญชีที่ล็อกอินอยู่ */
export const useSession = () => useContext(SessionCtx);

/**
 * @param {object} props
 * @param {string[]} props.roles   role ที่เข้าแอปนี้ได้ (DEV เข้าได้ทุกแอปเสมอ)
 * @param {string}   props.appName ชื่อแอปที่แสดงบนหน้าเข้าสู่ระบบ
 */
export function SessionGate({ roles, appName, children }) {
  const [user, setUser] = useState(undefined); // undefined = กำลังตรวจ, null = ยังไม่ล็อกอิน
  const navigate = useNavigate();

  useEffect(() => {
    // API ตอบ 401 (session หมดอายุ) ที่ไหนก็ตาม → กลับหน้าเข้าสู่ระบบ
    setUnauthorizedHandler(() => setUser(null));
    staffApi('/auth/me').then((d) => setUser(d.user)).catch(() => setUser(null));
  }, []);

  const logout = useCallback(async () => {
    await staffApi('/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
  }, []);

  if (user === undefined) return <div className="min-h-dvh"><Spinner /></div>;
  if (!user) return <LoginScreen appName={appName} onLogin={setUser} />;
  if (user.must_change_password) {
    return <ChangePassword user={user} onDone={() => setUser({ ...user, must_change_password: false })} />;
  }
  if (user.role !== 'DEV' && !roles.includes(user.role)) {
    return <NoAccess user={user} onGo={() => navigate(homeFor(user.role))} onLogout={logout} />;
  }
  return <SessionCtx.Provider value={{ user, logout }}>{children}</SessionCtx.Provider>;
}

/** กรอบหน้าเข้าสู่ระบบ / เปลี่ยนรหัส (ใช้ร่วมกัน) */
function AuthFrame({ children }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-ivory px-5 py-10">
      <div className="anim-rise w-full max-w-sm rounded-3xl border border-line bg-paper p-8">{children}</div>
    </div>
  );
}

function LoginScreen({ appName, onLogin }) {
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { user } = await staffApi('/auth/login', { method: 'POST', body: form });
      onLogin(user);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <AuthFrame>
      <form onSubmit={submit}>
        <CompressMark className="size-12" />
        <h1 className="mt-4 text-[26px] font-semibold">เข้าสู่ระบบ</h1>
        <p className="mt-1 mb-6 text-muted">{appName}</p>
        <div className="space-y-4">
          <Field label="ชื่อผู้ใช้">
            <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="username" autoFocus required />
          </Field>
          <Field label="รหัสผ่าน">
            <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="current-password" required />
          </Field>
        </div>
        {error && <p className="mt-4 rounded-xl bg-rose-soft px-4 py-3 text-[15px] text-rose-ink" role="alert">{error}</p>}
        <Button type="submit" size="lg" className="mt-6 w-full" loading={loading}>เข้าสู่ระบบ</Button>
      </form>
    </AuthFrame>
  );
}

function ChangePassword({ user, onDone }) {
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const toast = useToast();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (form.new_password !== form.confirm) return setError('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน');
    setLoading(true);
    setError('');
    try {
      await staffApi('/auth/change-password', { method: 'POST', body: { current_password: form.current_password, new_password: form.new_password } });
      toast('เปลี่ยนรหัสผ่านแล้ว');
      onDone();
    } catch (err) {
      setError(err.fields ? Object.values(err.fields)[0][0] : err.message);
      setLoading(false);
    }
  };

  return (
    <AuthFrame>
      <form onSubmit={submit}>
        <span className="grid size-12 place-items-center rounded-2xl bg-turmeric-soft text-[#7a5e0e]"><KeyRound className="size-6" aria-hidden /></span>
        <h1 className="mt-4 text-[24px] font-semibold">ตั้งรหัสผ่านใหม่</h1>
        <p className="mt-1 mb-6 text-muted">คุณ{user.full_name} กรุณาเปลี่ยนรหัสผ่านก่อนเริ่มใช้งาน</p>
        <div className="space-y-4">
          <Field label="รหัสผ่านปัจจุบัน"><Input type="password" value={form.current_password} onChange={set('current_password')} autoComplete="current-password" required /></Field>
          <Field label="รหัสผ่านใหม่" hint="อย่างน้อย 8 ตัวอักษร"><Input type="password" value={form.new_password} onChange={set('new_password')} autoComplete="new-password" minLength={8} required /></Field>
          <Field label="ยืนยันรหัสผ่านใหม่"><Input type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" required /></Field>
        </div>
        {error && <p className="mt-4 rounded-xl bg-rose-soft px-4 py-3 text-[15px] text-rose-ink" role="alert">{error}</p>}
        <Button type="submit" size="lg" className="mt-6 w-full" loading={loading}>บันทึกรหัสผ่านใหม่</Button>
      </form>
    </AuthFrame>
  );
}

function NoAccess({ user, onGo, onLogout }) {
  return (
    <AuthFrame>
      <span className="grid size-12 place-items-center rounded-2xl bg-sand text-clay"><ShieldAlert className="size-6" aria-hidden /></span>
      <h1 className="mt-4 text-[22px] font-semibold">บัญชีนี้เข้าหน้านี้ไม่ได้</h1>
      <p className="mt-1 text-muted">คุณล็อกอินเป็น{ROLE_LABEL[user.role]} ({user.username})</p>
      <div className="mt-6 space-y-2">
        <Button size="lg" className="w-full" onClick={onGo}>ไปหน้าของ{ROLE_LABEL[user.role]}</Button>
        <Button size="lg" variant="outline" className="w-full" onClick={onLogout}>ออกจากระบบ / เปลี่ยนบัญชี</Button>
      </div>
    </AuthFrame>
  );
}
