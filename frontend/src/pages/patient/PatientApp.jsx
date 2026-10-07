/**
 * pages/patient/PatientApp.jsx — โครงหน้าฝั่งผู้จอง (เปิดจาก LINE OA / browser)
 *
 * หน้าที่:
 *  1. เริ่มต้นการยืนยันตัวตน (LIFF หรือผู้ใช้จำลองในโหมด LOCAL) แล้วโหลดข้อมูลผู้จอง (/me)
 *  2. ถ้ายังไม่ยินยอม PDPA / ยังไม่กรอกข้อมูลตัวเอง → แสดงหน้า Onboarding ก่อน
 *  3. วางโครงหน้า responsive: header เต็มความกว้าง + เนื้อหากว้างสุด 1120px
 *     (มือถือ = คอลัมน์เดียว, แท็บเล็ต/คอม = หน้าแต่ละหน้าจัดเป็นหลายคอลัมน์เอง)
 *
 * ข้อมูลที่แชร์ให้หน้าลูกผ่าน usePatient(): { config, me, refreshMe }
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { Ticket, Users, CalendarPlus, Unplug } from 'lucide-react';
import { initPatientAuth, patientApi, inLineApp } from '../../lib/liff.js';
import { CompressMark } from '../../components/Logo.jsx';
import { Spinner, Button, cx } from '../../components/ui.jsx';
import { Onboarding } from './Onboarding.jsx';

const PatientCtx = createContext(null);
/** ข้อมูลผู้จองที่ล็อกอินอยู่ { config, me, refreshMe } */
export const usePatient = () => useContext(PatientCtx);

export function PatientApp() {
  const [config, setConfig] = useState(null);
  const [me, setMe] = useState(null);
  const [error, setError] = useState(null);

  /** โหลดข้อมูลผู้จอง + รายชื่อผู้รับบริการใหม่ (เรียกหลังแก้ข้อมูล) */
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
        if (!cfg.needsMock) await refreshMe();
      } catch (err) {
        if (alive) setError(err.message);
      }
    })();
    return () => { alive = false; };
  }, [refreshMe]);

  if (error) {
    return (
      <Shell>
        <Notice title="เปิดหน้าจองไม่สำเร็จ" body={error} action={<Button onClick={() => window.location.reload()}>ลองอีกครั้ง</Button>} />
      </Shell>
    );
  }
  if (!config) return <Shell><Spinner /></Shell>;

  // โหมด LOCAL แต่ยังไม่มีการเลือกผู้ใช้จำลอง → ระบบยังไม่เปิดให้จองจริง
  if (config.needsMock) {
    return (
      <Shell clinic={config.clinic_name}>
        <Notice
          icon={Unplug}
          title="ระบบจองคิวออนไลน์ยังไม่เปิดใช้งาน"
          body={<>กรุณาจองคิวที่เคาน์เตอร์แพทย์แผนไทย{config.counter_phone && <> หรือโทร <a className="text-herb underline" href={`tel:${config.counter_phone}`}>{config.counter_phone}</a></>}</>}
        />
      </Shell>
    );
  }
  if (!me) return <Shell clinic={config.clinic_name}><Spinner /></Shell>;

  const needsOnboarding = !me.consented || !me.self_patient_id;

  return (
    <PatientCtx.Provider value={{ config, me, refreshMe }}>
      <Shell clinic={config.clinic_name} me={needsOnboarding ? null : me}>
        {needsOnboarding ? <Onboarding /> : <Outlet />}
      </Shell>
    </PatientCtx.Provider>
  );
}

/** โครงหน้า: header + เนื้อหา + footer */
function Shell({ children, clinic, me }) {
  const nav = [
    { to: '/', icon: CalendarPlus, label: 'จองคิว', end: true },
    { to: '/my', icon: Ticket, label: 'การจองของฉัน' },
    { to: '/people', icon: Users, label: 'รายชื่อ' },
  ];
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1120px] items-center justify-between gap-3 px-4 sm:h-[72px] sm:px-6">
          <Link to="/" className="flex min-w-0 items-center gap-2.5">
            <CompressMark className="size-10 shrink-0" />
            <span className="min-w-0">
              <span className="block truncate font-display text-[17px] font-semibold leading-tight">{clinic ?? 'คลินิกแพทย์แผนไทย'}</span>
              <span className="block text-[13px] leading-tight text-clay">จองคิวนวดแผนไทย</span>
            </span>
          </Link>
          {me && (
            <nav className="flex shrink-0 items-center gap-1" aria-label="เมนูหลัก">
              {nav.map(({ to, icon: Icon, label, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  aria-label={label}
                  className={({ isActive }) => cx(
                    'flex h-10 items-center gap-1.5 rounded-full px-3 text-[15px] font-medium transition-colors',
                    isActive ? 'bg-leaf text-herb' : 'text-muted hover:bg-sand hover:text-ink',
                    to === '/' && 'hidden md:flex', // มือถือ: โลโก้พากลับหน้าจองอยู่แล้ว
                  )}
                >
                  <Icon className="size-[18px]" aria-hidden />
                  <span className="hidden sm:inline">{label}</span>
                </NavLink>
              ))}
              {me.display_name && (
                <span className="ml-2 hidden border-l border-line pl-3 text-[14px] text-muted lg:inline">คุณ{me.display_name}</span>
              )}
            </nav>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1120px] flex-1 px-4 sm:px-6">{children}</main>

      <footer className="mx-auto w-full max-w-[1120px] px-4 pt-10 pb-6 text-[13px] text-faint sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
          <span>{clinic ?? 'คลินิกแพทย์แผนไทย'}</span>
          {/* ลิงก์เจ้าหน้าที่: ไม่แสดงในแอป LINE (ผู้ป่วยไม่ต้องเห็น) */}
          {!inLineApp() && <Link to="/staff" className="hover:text-herb">สำหรับเจ้าหน้าที่</Link>}
        </div>
      </footer>
    </div>
  );
}

/** กล่องข้อความกลางหน้า (ข้อผิดพลาด / ระบบยังไม่เปิด) */
function Notice({ icon: Icon, title, body, action }) {
  return (
    <div className="mx-auto max-w-lg py-20 text-center">
      {Icon && <span className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-sand text-clay"><Icon className="size-7" aria-hidden /></span>}
      <h1 className="text-[22px] font-semibold">{title}</h1>
      <p className="mt-2 text-muted">{body}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
