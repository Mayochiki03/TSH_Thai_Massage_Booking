import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { Ticket, Users, FlaskConical } from 'lucide-react';
import { initPatientAuth, patientApi, DEV_USERS, getDevUser, setDevUser } from '../../lib/liff.js';
import { CompressMark } from '../../components/Logo.jsx';
import { Spinner, Button, cx } from '../../components/ui.jsx';
import { Onboarding } from './Onboarding.jsx';

const PatientCtx = createContext(null);
export const usePatient = () => useContext(PatientCtx);

export function PatientApp() {
  const [config, setConfig] = useState(null);
  const [me, setMe] = useState(null);
  const [error, setError] = useState(null);
  const [devUser, setDevUserState] = useState(getDevUser());

  const refreshMe = useCallback(async () => {
    const data = await patientApi('/me');
    setMe(data);
    return data;
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cfg = await initPatientAuth();
        if (!alive) return;
        setConfig(cfg);
        setDevUserState(getDevUser());
        await refreshMe();
      } catch (err) {
        if (alive) setError(err.message);
      }
    })();
    return () => { alive = false; };
  }, [refreshMe]);

  const switchDevUser = async (id) => {
    setDevUser(id);
    setDevUserState(id);
    setMe(null);
    await refreshMe();
  };

  if (error) {
    return (
      <Shell>
        <div className="px-6 py-20 text-center">
          <p className="font-display text-lg font-medium">เปิดหน้าจองไม่สำเร็จ</p>
          <p className="mt-1 text-muted">{error}</p>
          <Button className="mt-6" onClick={() => window.location.reload()}>ลองอีกครั้ง</Button>
        </div>
      </Shell>
    );
  }
  if (!config || !me) return <Shell><Spinner /></Shell>;

  const needsOnboarding = !me.consented || !me.self_patient_id;

  return (
    <PatientCtx.Provider value={{ config, me, refreshMe }}>
      {config.mode === 'LOCAL' && <DevBar devUser={devUser} onChange={switchDevUser} />}
      <Shell clinic={config.clinic_name} showNav={!needsOnboarding}>
        {needsOnboarding ? <Onboarding /> : <Outlet />}
      </Shell>
    </PatientCtx.Provider>
  );
}

function Shell({ children, clinic, showNav }) {
  const { pathname } = useLocation();
  const navItem = (to, Icon, label) => (
    <Link
      to={to}
      aria-label={label}
      className={cx(
        'flex h-10 items-center gap-1.5 rounded-full px-3 text-[15px] font-medium transition-colors',
        pathname.startsWith(to) ? 'bg-leaf text-herb' : 'text-muted hover:bg-mist',
      )}
    >
      <Icon className="size-[18px]" aria-hidden />
      <span className="hidden min-[400px]:inline">{label}</span>
    </Link>
  );
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-paper">
      <header className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
        <Link to="/" className="flex min-w-0 items-center gap-2.5">
          <CompressMark className="size-10 shrink-0" />
          <span className="min-w-0">
            <span className="block truncate font-display text-[17px] font-semibold leading-tight">{clinic ?? 'คลินิกแพทย์แผนไทย'}</span>
            <span className="block text-[13px] leading-tight text-muted">จองคิวนวดแผนไทย</span>
          </span>
        </Link>
        {showNav && (
          <nav className="flex shrink-0 items-center gap-1">
            {navItem('/my', Ticket, 'การจอง')}
            {navItem('/people', Users, 'รายชื่อ')}
          </nav>
        )}
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}

function DevBar({ devUser, onChange }) {
  return (
    <div className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-turmeric-soft px-3 py-1.5 text-[13px] text-[#7a5e0e]">
      <FlaskConical className="size-4 shrink-0" aria-hidden />
      <span className="shrink-0">โหมดทดสอบ ผู้ใช้:</span>
      <select
        value={devUser}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 rounded-md border border-turmeric/40 bg-white/70 px-1.5 py-0.5"
      >
        {DEV_USERS.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
    </div>
  );
}
