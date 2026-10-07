import { createContext, useContext, useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { CalendarClock, HandHeart, Settings, LogOut, KeyRound } from 'lucide-react';
import { staffApi, setUnauthorizedHandler } from '../../lib/api.js';
import { CompressMark } from '../../components/Logo.jsx';
import { Button, Field, Input, Spinner, useToast, cx } from '../../components/ui.jsx';

const StaffCtx = createContext(null);
export const useStaff = () => useContext(StaffCtx);

const ROLE_LABEL = { ADMIN: 'ผู้ดูแลระบบ', STAFF: 'เจ้าหน้าที่เคาน์เตอร์', PRACTITIONER: 'หมอนวด' };

export const homeFor = (role) => (role === 'PRACTITIONER' ? '/staff/room' : '/staff/queue');

export function StaffApp() {
  const [user, setUser] = useState(undefined); // undefined = กำลังเช็ก, null = ยังไม่ล็อกอิน
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    setUnauthorizedHandler(() => { setUser(null); });
    staffApi('/auth/me').then((d) => setUser(d.user)).catch(() => setUser(null));
  }, []);

  if (user === undefined) return <Spinner />;
  if (!user) return pathname === '/staff/login' ? <LoginPage onLogin={setUser} /> : <Navigate to="/staff/login" replace />;
  if (user.must_change_password) return <ChangePassword user={user} onDone={() => setUser({ ...user, must_change_password: false })} />;
  if (pathname === '/staff' || pathname === '/staff/' || pathname === '/staff/login') return <Navigate to={homeFor(user.role)} replace />;

  const logout = async () => {
    await staffApi('/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
    navigate('/staff/login', { replace: true });
  };

  const nav = [
    { to: '/staff/queue', icon: CalendarClock, label: 'คิววันนี้', roles: ['ADMIN', 'STAFF'] },
    { to: '/staff/room', icon: HandHeart, label: 'ห้องนวด', roles: ['ADMIN', 'PRACTITIONER'] },
    { to: '/staff/admin', icon: Settings, label: 'ตั้งค่าระบบ', roles: ['ADMIN'] },
  ].filter((n) => n.roles.includes(user.role));

  return (
    <StaffCtx.Provider value={{ user }}>
      <div className="min-h-dvh bg-mist lg:flex">
        <aside className="flex items-center gap-3 border-b border-line bg-paper px-4 py-3 lg:sticky lg:top-0 lg:h-dvh lg:w-60 lg:flex-col lg:items-stretch lg:border-r lg:border-b-0 lg:px-4 lg:py-6">
          <div className="flex items-center gap-2.5 lg:mb-8 lg:px-2">
            <CompressMark className="size-9 shrink-0" />
            <div className="hidden leading-tight sm:block">
              <div className="font-display font-semibold">แพทย์แผนไทย</div>
              <div className="text-[13px] text-muted">ระบบจองคิว</div>
            </div>
          </div>
          <nav className="flex flex-1 gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
            {nav.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => cx(
                  'flex h-11 shrink-0 items-center gap-2.5 rounded-xl px-3 font-display text-[15px] font-medium transition-colors',
                  isActive ? 'bg-leaf text-herb' : 'text-muted hover:bg-mist hover:text-ink',
                )}
              >
                <Icon className="size-5" aria-hidden />{label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2 lg:mt-auto lg:border-t lg:border-line lg:pt-4">
            <div className="hidden min-w-0 flex-1 leading-tight md:block lg:px-2">
              <div className="truncate text-[15px] font-medium">{user.full_name}</div>
              <div className="text-[13px] text-muted">{ROLE_LABEL[user.role]}</div>
            </div>
            <button type="button" onClick={logout} className="grid size-10 shrink-0 place-items-center rounded-xl text-muted hover:bg-mist hover:text-ink" aria-label="ออกจากระบบ" title="ออกจากระบบ">
              <LogOut className="size-5" />
            </button>
          </div>
        </aside>
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </StaffCtx.Provider>
  );
}

/** กันหน้าที่ role นี้ไม่มีสิทธิ์ */
export function RequireRole({ roles, children }) {
  const { user } = useStaff();
  if (user.role !== 'ADMIN' && !roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  return children;
}

function LoginPage({ onLogin }) {
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { user } = await staffApi('/auth/login', { method: 'POST', body: form });
      onLogin(user);
      navigate(homeFor(user.role), { replace: true });
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center bg-mist px-5">
      <form onSubmit={submit} className="anim-rise w-full max-w-sm rounded-3xl bg-paper p-8">
        <CompressMark className="size-12" />
        <h1 className="mt-4 text-[26px] font-semibold">เข้าสู่ระบบ</h1>
        <p className="mt-1 mb-6 text-muted">สำหรับเจ้าหน้าที่ หมอนวด และผู้ดูแลระบบ</p>
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
    </div>
  );
}

function ChangePassword({ user, onDone }) {
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const toast = useToast();

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
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="grid min-h-dvh place-items-center bg-mist px-5">
      <form onSubmit={submit} className="anim-rise w-full max-w-sm rounded-3xl bg-paper p-8">
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
    </div>
  );
}
