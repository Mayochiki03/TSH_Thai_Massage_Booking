/**
 * pages/admin/AdminApp.jsx — แอปผู้ดูแลระบบ (/admin) แยกจากหน้างานเจ้าหน้าที่
 *
 * แบ่ง 2 ส่วน:
 *  - เมนูผู้ดูแล (ADMIN + DEV) : Dashboard, การจอง, ตั้งค่าการจอง, ข้อมูลผู้รับบริการ, บัญชีผู้ใช้, log
 *  - เมนูนักพัฒนา (DEV เท่านั้น): ระบบและเครื่องมือทดสอบ, การเชื่อมต่อ LINE, ผู้ใช้จำลอง
 *
 * Responsive:
 *  - จอกว้าง (lg) : แถบเมนูด้านซ้ายติดอยู่ตลอด
 *  - จอเล็ก       : แถบบน + ปุ่มเมนูเปิดลิ้นชักจากด้านซ้าย
 */
import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, Navigate, useLocation, Link } from 'react-router';
import {
  LayoutDashboard, CalendarClock, ListChecks, CalendarRange, CalendarOff, SlidersHorizontal, BellRing,
  Users, UserX, UserCog, ScrollText, Cpu, Plug, FlaskConical, LogOut, Menu, X, MonitorSmartphone,
} from 'lucide-react';
import { SessionGate, useSession, ROLE_LABEL } from '../../lib/session.jsx';
import { CompressMark } from '../../components/Logo.jsx';
import { cx } from '../../components/ui.jsx';
import { Dashboard } from './Dashboard.jsx';
import { SchedulePage } from './SchedulePage.jsx';
import { HolidaysPage } from './HolidaysPage.jsx';
import { RulesPage } from './RulesPage.jsx';
import { NotificationsPage } from './NotificationsPage.jsx';
import { PatientsPage } from './PatientsPage.jsx';
import { SuspensionsPage } from './SuspensionsPage.jsx';
import { UsersPage } from './UsersPage.jsx';
import { AppointmentsPage } from './AppointmentsPage.jsx';
import { AuditPage } from './AuditPage.jsx';
import { DevSystemPage } from './dev/DevSystemPage.jsx';
import { DevConnectionPage } from './dev/DevConnectionPage.jsx';
import { DevMockUsersPage } from './dev/DevMockUsersPage.jsx';

export function AdminApp() {
  return (
    <SessionGate roles={['ADMIN']} appName="ผู้ดูแลระบบ">
      <AdminLayout />
    </SessionGate>
  );
}

/** โครงเมนู: กลุ่ม → รายการ (external = ลิงก์ไปแอปอื่น) */
const MENU = [
  { group: null, items: [{ to: '/admin', icon: LayoutDashboard, label: 'ภาพรวม', end: true }] },
  {
    group: 'งานบริการ',
    items: [
      { to: '/staff/queue', icon: CalendarClock, label: 'คิววันนี้ (หน้าเคาน์เตอร์)', external: true },
      { to: '/kiosk', icon: MonitorSmartphone, label: 'หน้าจอ kiosk', external: true },
      { to: '/admin/appointments', icon: ListChecks, label: 'การจองทั้งหมด' },
    ],
  },
  {
    group: 'ตั้งค่าการจอง',
    items: [
      { to: '/admin/schedule', icon: CalendarRange, label: 'รอบเวลาและตาราง' },
      { to: '/admin/holidays', icon: CalendarOff, label: 'วันหยุด' },
      { to: '/admin/rules', icon: SlidersHorizontal, label: 'กฎการจอง' },
      { to: '/admin/notifications', icon: BellRing, label: 'ข้อความแจ้งเตือน' },
    ],
  },
  {
    group: 'ข้อมูลและผู้ใช้',
    items: [
      { to: '/admin/patients', icon: Users, label: 'ผู้รับบริการ' },
      { to: '/admin/suspensions', icon: UserX, label: 'ระงับสิทธิ์' },
      { to: '/admin/users', icon: UserCog, label: 'บัญชีผู้ใช้ระบบ' },
      { to: '/admin/audit', icon: ScrollText, label: 'ประวัติการใช้งาน' },
    ],
  },
  {
    group: 'นักพัฒนา',
    devOnly: true,
    items: [
      { to: '/admin/dev', icon: Cpu, label: 'ระบบและเครื่องมือ', end: true },
      { to: '/admin/dev/connection', icon: Plug, label: 'การเชื่อมต่อ LINE' },
      { to: '/admin/dev/mock-users', icon: FlaskConical, label: 'ผู้ใช้จำลอง' },
    ],
  },
];

function AdminLayout() {
  const { user, logout } = useSession();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const isDev = user.role === 'DEV';

  useEffect(() => { setOpen(false); }, [pathname]); // เปลี่ยนหน้า → ปิดลิ้นชัก (จอเล็ก)

  const sidebar = (
    <nav className="flex h-full flex-col" aria-label="เมนูผู้ดูแลระบบ">
      <div className="flex items-center gap-2.5 px-2 pb-5">
        <CompressMark className="size-9 shrink-0" />
        <div className="leading-tight">
          <div className="font-display font-semibold">แพทย์แผนไทย</div>
          <div className="text-[13px] text-clay">ผู้ดูแลระบบ</div>
        </div>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto">
        {MENU.filter((g) => !g.devOnly || isDev).map((g) => (
          <div key={g.group ?? 'top'}>
            {g.group && (
              <div className={cx('mb-1.5 px-3 text-[13px] font-medium', g.devOnly ? 'text-clay' : 'text-faint')}>{g.group}</div>
            )}
            <ul className="space-y-0.5">
              {g.items.map(({ to, icon: Icon, label, end, external }) => (
                <li key={to}>
                  {external ? (
                    <Link to={to} className="flex h-9 items-center gap-2.5 rounded-xl px-3 text-[15px] text-muted hover:bg-sand hover:text-ink">
                      <Icon className="size-[18px] shrink-0" aria-hidden />{label}
                    </Link>
                  ) : (
                    <NavLink
                      to={to}
                      end={end}
                      className={({ isActive }) => cx(
                        'flex h-9 items-center gap-2.5 rounded-xl px-3 text-[15px] transition-colors',
                        isActive ? 'bg-leaf font-medium text-herb' : 'text-muted hover:bg-sand hover:text-ink',
                      )}
                    >
                      <Icon className="size-[18px] shrink-0" aria-hidden />{label}
                    </NavLink>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2 border-t border-line pt-4">
        <div className="min-w-0 flex-1 px-2 leading-tight">
          <div className="truncate text-[15px] font-medium">{user.full_name}</div>
          <div className="text-[13px] text-muted">{ROLE_LABEL[user.role]}</div>
        </div>
        <button type="button" onClick={logout} className="grid size-10 shrink-0 place-items-center rounded-xl text-muted hover:bg-sand hover:text-ink" aria-label="ออกจากระบบ" title="ออกจากระบบ">
          <LogOut className="size-5" />
        </button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh lg:flex">
      {/* จอกว้าง: แถบซ้าย */}
      <aside className="hidden border-r border-line bg-paper px-3 py-5 lg:sticky lg:top-0 lg:block lg:h-dvh lg:w-64 lg:shrink-0">{sidebar}</aside>

      {/* จอเล็ก: แถบบน + ลิ้นชัก */}
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-paper px-3 lg:hidden">
        <button type="button" onClick={() => setOpen(true)} className="grid size-10 place-items-center rounded-xl hover:bg-sand" aria-label="เปิดเมนู">
          <Menu className="size-5" />
        </button>
        <span className="font-display font-semibold">ผู้ดูแลระบบ</span>
        <CompressMark className="size-8" />
      </div>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="เมนู">
          <div className="anim-fade absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[82%] max-w-72 bg-paper px-3 py-5 shadow-xl">
            <button type="button" onClick={() => setOpen(false)} className="absolute top-4 right-3 grid size-9 place-items-center rounded-lg text-muted hover:bg-sand" aria-label="ปิดเมนู">
              <X className="size-5" />
            </button>
            {sidebar}
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="appointments" element={<AppointmentsPage />} />
            <Route path="schedule" element={<SchedulePage />} />
            <Route path="holidays" element={<HolidaysPage />} />
            <Route path="rules" element={<RulesPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="patients" element={<PatientsPage />} />
            <Route path="suspensions" element={<SuspensionsPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="audit" element={<AuditPage />} />
            {isDev && (
              <>
                <Route path="dev" element={<DevSystemPage />} />
                <Route path="dev/connection" element={<DevConnectionPage />} />
                <Route path="dev/mock-users" element={<DevMockUsersPage />} />
              </>
            )}
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
