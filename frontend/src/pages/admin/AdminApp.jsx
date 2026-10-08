/**
 * pages/admin/AdminApp.jsx — แอปผู้ดูแลระบบ (/admin) แยกจากหน้างานเจ้าหน้าที่
 *
 * เมนูจัดตามงานที่ทำ (ใช้บ่อยอยู่บน):
 *  ภาพรวม · งานประจำวัน · รายงาน · ผู้รับบริการ · ตั้งค่าบริการ · บุคลากรและระบบ · นักพัฒนา (DEV เท่านั้น แยกกรอบล่างสุด)
 *  - ช่อง "ค้นหาเมนู" บนสุด: พิมพ์บางคำ เช่น "ราคา" "เตียง" "excel" "line" แล้วกด Enter ไปหน้านั้นได้เลย
 *  - เมนูที่เปิดอีกแอป (หน้าเคาน์เตอร์ / ห้องนวด / kiosk) มีลูกศร ↗ กำกับ
 *
 * Responsive:
 *  - จอกว้าง (lg) : แถบเมนูด้านซ้ายติดอยู่ตลอด
 *  - จอเล็ก       : แถบบน + ปุ่มเมนูเปิดลิ้นชักจากด้านซ้าย
 */
import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, Navigate, useLocation, useNavigate, Link } from 'react-router';
import {
  LayoutDashboard, CalendarClock, ListChecks, CalendarRange, CalendarOff, SlidersHorizontal, BellRing,
  Users, UserX, UserCog, ScrollText, Cpu, Plug, FlaskConical, LogOut, Menu, X, MonitorSmartphone, FileSpreadsheet,
  BedDouble, Tags, Search, ArrowUpRight,
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
import { ReportsPage } from './ReportsPage.jsx';
import { ServiceTypesPage } from './ServiceTypesPage.jsx';
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

/**
 * โครงเมนู: กลุ่ม → รายการ
 *   external = ลิงก์ไปแอปอื่น (แสดง ↗) · keywords = คำค้นเพิ่มเติมสำหรับช่องค้นหาเมนู
 */
const MENU = [
  { group: null, items: [{ to: '/admin', icon: LayoutDashboard, label: 'ภาพรวม', end: true, keywords: 'dashboard สรุป' }] },
  {
    group: 'งานประจำวัน',
    items: [
      { to: '/staff/queue', icon: CalendarClock, label: 'คิววันนี้ (เคาน์เตอร์)', external: true, keywords: 'เช็กอิน walk-in vn' },
      { to: '/staff/room', icon: BedDouble, label: 'ห้องนวด (หมอนวด)', external: true, keywords: 'เริ่มนวด บันทึก vn' },
      { to: '/kiosk', icon: MonitorSmartphone, label: 'หน้าจอ kiosk', external: true, keywords: 'ตู้' },
      { to: '/admin/appointments', icon: ListChecks, label: 'การจองทั้งหมด', keywords: 'คิว ค้นหา แก้สถานะ vn หมอนวด' },
    ],
  },
  {
    group: 'รายงาน',
    items: [{ to: '/admin/reports', icon: FileSpreadsheet, label: 'รายงาน Excel', keywords: 'export ส่งออก ดาวน์โหลด สรุป รายได้' }],
  },
  {
    group: 'ผู้รับบริการ',
    items: [
      { to: '/admin/patients', icon: Users, label: 'ข้อมูลผู้รับบริการ', keywords: 'คนไข้ ผู้ป่วย เลขบัตร hn' },
      { to: '/admin/suspensions', icon: UserX, label: 'ระงับสิทธิ์', keywords: 'no-show ไม่มา แบน' },
    ],
  },
  {
    group: 'ตั้งค่าบริการ',
    items: [
      { to: '/admin/services', icon: Tags, label: 'ประเภทบริการและราคา', keywords: 'ราคา ประคบ นวด' },
      { to: '/admin/schedule', icon: CalendarRange, label: 'รอบเวลาและเตียง', keywords: 'ตาราง เตียง ปิดรับ slot' },
      { to: '/admin/holidays', icon: CalendarOff, label: 'วันหยุด' },
      { to: '/admin/rules', icon: SlidersHorizontal, label: 'กฎการจอง', keywords: 'โควตา ยกเลิก ล่วงหน้า' },
      { to: '/admin/notifications', icon: BellRing, label: 'ข้อความแจ้งเตือน', keywords: 'line ข้อความ' },
    ],
  },
  {
    group: 'บุคลากรและระบบ',
    items: [
      { to: '/admin/users', icon: UserCog, label: 'หมอนวดและบัญชีผู้ใช้', keywords: 'รหัสผ่าน login ผู้ใช้ หมอ' },
      { to: '/admin/audit', icon: ScrollText, label: 'ประวัติการใช้งาน', keywords: 'log pdpa' },
    ],
  },
  {
    group: 'นักพัฒนา',
    devOnly: true,
    items: [
      { to: '/admin/dev', icon: Cpu, label: 'ระบบและเครื่องมือ', end: true, keywords: 'cron ล้างข้อมูล' },
      { to: '/admin/dev/connection', icon: Plug, label: 'การเชื่อมต่อ LINE', keywords: 'liff token tunnel โหมด' },
      { to: '/admin/dev/mock-users', icon: FlaskConical, label: 'ผู้ใช้จำลอง', keywords: 'ทดสอบ' },
    ],
  },
];

function AdminLayout() {
  const { user, logout } = useSession();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const isDev = user.role === 'DEV';
  const [q, setQ] = useState('');

  useEffect(() => { setOpen(false); setQ(''); }, [pathname]); // เปลี่ยนหน้า → ปิดลิ้นชัก (จอเล็ก) + ล้างคำค้น

  // กรองเมนูตามคำค้น (ชื่อเมนู + keywords + ชื่อกลุ่ม)
  const needle = q.trim().toLowerCase();
  const groups = MENU.filter((g) => !g.devOnly || isDev)
    .map((g) => ({
      ...g,
      items: needle ? g.items.filter((it) => `${it.label} ${it.keywords ?? ''} ${g.group ?? ''}`.toLowerCase().includes(needle)) : g.items,
    }))
    .filter((g) => g.items.length);
  const firstMatch = needle ? groups[0]?.items[0] : null;

  const item = ({ to, icon: Icon, label, end, external }) => (
    <li key={to}>
      {external ? (
        <Link to={to} className="group flex h-9 items-center gap-2.5 rounded-xl px-3 text-[15px] text-muted hover:bg-sand hover:text-ink">
          <Icon className="size-[18px] shrink-0" aria-hidden /><span className="min-w-0 flex-1 truncate">{label}</span>
          <ArrowUpRight className="size-4 shrink-0 text-faint group-hover:text-ink" aria-label="เปิดอีกหน้าจอ" />
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
          <Icon className="size-[18px] shrink-0" aria-hidden /><span className="min-w-0 truncate">{label}</span>
        </NavLink>
      )}
    </li>
  );

  const sidebar = (
    <nav className="flex h-full flex-col" aria-label="เมนูผู้ดูแลระบบ">
      <div className="flex items-center gap-2.5 px-2 pb-5">
        <CompressMark className="size-9 shrink-0" />
        <div className="leading-tight">
          <div className="font-display font-semibold">แพทย์แผนไทย</div>
          <div className="text-[13px] text-clay">ผู้ดูแลระบบ</div>
        </div>
      </div>
      <form
        className="relative mb-4"
        role="search"
        onSubmit={(e) => { e.preventDefault(); if (firstMatch) navigate(firstMatch.to); }}
      >
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQ('')}
          placeholder="ค้นหาเมนู เช่น ราคา, เตียง"
          aria-label="ค้นหาเมนู"
          className="h-10 w-full rounded-xl border border-line bg-ivory pr-3 pl-9 text-[15px] placeholder:text-faint focus:border-herb focus:bg-paper focus:outline-none focus:ring-4 focus:ring-leaf"
        />
      </form>
      <div className="-mx-1 flex-1 space-y-3 overflow-y-auto px-1 pb-2">
        {groups.filter((g) => !g.devOnly).map((g) => (
          <div key={g.group ?? 'top'}>
            {g.group && <div className="mb-1 px-3 text-[12px] font-semibold tracking-wide text-faint">{g.group}</div>}
            <ul className="space-y-0.5">{g.items.map(item)}</ul>
          </div>
        ))}
        {/* เมนูนักพัฒนา: แยกกรอบสีอุ่น ไม่ปนกับเมนูงานประจำ */}
        {groups.filter((g) => g.devOnly).map((g) => (
          <div key={g.group} className="rounded-2xl border border-clay/25 bg-clay-soft/40 p-1.5">
            <div className="mb-1 flex items-center gap-1.5 px-2 pt-1 text-[12px] font-semibold tracking-wide text-clay"><Cpu className="size-3.5" aria-hidden />{g.group}</div>
            <ul className="space-y-0.5">{g.items.map(item)}</ul>
          </div>
        ))}
        {needle && !groups.length && <p className="px-3 text-[14px] text-muted">ไม่พบเมนู "{q}"</p>}
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
            <Route path="services" element={<ServiceTypesPage />} />
            <Route path="reports" element={<ReportsPage />} />
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
