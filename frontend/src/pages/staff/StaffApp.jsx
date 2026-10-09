/**
 * pages/staff/StaffApp.jsx — แอปหน้างาน (/staff) สำหรับเจ้าหน้าที่เคาน์เตอร์และหมอนวด
 *
 *  /staff/queue  คิววันนี้ + เช็กอิน + walk-in (STAFF)
 *  /staff/room   ห้องนวด (PRACTITIONER)
 *  ADMIN / DEV เข้าได้ทั้งสองหน้า และมีลิงก์ไปหน้าผู้ดูแลระบบ (/admin)
 *
 * Responsive: จอกว้างใช้แถบเมนูด้านซ้าย / จอเล็กใช้แถบเมนูด้านบน
 */
import { Navigate, NavLink, Outlet, useLocation } from 'react-router';
import { CalendarClock, HandHeart, LayoutDashboard, LogOut } from 'lucide-react';
import { SessionGate, useSession, homeFor, ROLE_LABEL } from '../../lib/session.jsx';
import { CompressMark } from '../../components/Logo.jsx';
import { cx } from '../../components/ui.jsx';

export function StaffApp() {
  return (
    <SessionGate roles={['ADMIN', 'STAFF', 'PRACTITIONER']} appName="หน้างานเจ้าหน้าที่และหมอนวด">
      <StaffLayout />
    </SessionGate>
  );
}

function StaffLayout() {
  const { user, confirmLogout } = useSession();
  const { pathname } = useLocation();

  // /staff เฉย ๆ → ไปหน้าหลักของ role
  if (pathname === '/staff' || pathname === '/staff/') {
    const home = homeFor(user.role);
    return <Navigate to={home.startsWith('/staff') ? home : '/staff/queue'} replace />;
  }

  const isManager = user.role === 'ADMIN' || user.role === 'DEV';
  const nav = [
    { to: '/staff/queue', icon: CalendarClock, label: 'คิววันนี้', show: user.role === 'STAFF' || isManager },
    { to: '/staff/room', icon: HandHeart, label: 'ห้องนวด', show: user.role === 'PRACTITIONER' || isManager },
    { to: '/admin', icon: LayoutDashboard, label: 'ผู้ดูแลระบบ', show: isManager },
  ].filter((n) => n.show);

  return (
    <div className="min-h-dvh lg:flex">
      <aside className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-paper px-4 py-2.5 lg:h-dvh lg:w-60 lg:shrink-0 lg:flex-col lg:items-stretch lg:border-r lg:border-b-0 lg:px-4 lg:py-6">
        <div className="flex items-center gap-2.5 lg:mb-8 lg:px-2">
          <CompressMark className="size-9 shrink-0" />
          <div className="hidden leading-tight sm:block">
            <div className="font-display font-semibold">แพทย์แผนไทย</div>
            <div className="text-[13px] text-clay">หน้างาน</div>
          </div>
        </div>
        <nav className="no-scrollbar flex flex-1 gap-1 overflow-x-auto lg:flex-col lg:overflow-visible" aria-label="เมนู">
          {nav.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => cx(
                'flex h-11 shrink-0 items-center gap-2.5 rounded-xl px-3 font-display text-[15px] font-medium transition-colors',
                isActive ? 'bg-leaf text-herb' : 'text-muted hover:bg-sand hover:text-ink',
              )}
            >
              <Icon className="size-5" aria-hidden /><span className="hidden min-[420px]:inline">{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-2 lg:mt-auto lg:border-t lg:border-line lg:pt-4">
          <div className="hidden min-w-0 flex-1 leading-tight md:block lg:px-2">
            <div className="truncate text-[15px] font-medium">{user.full_name}</div>
            <div className="text-[13px] text-muted">{ROLE_LABEL[user.role]}</div>
          </div>
          <button type="button" onClick={confirmLogout} className="grid size-10 shrink-0 place-items-center rounded-xl text-muted hover:bg-sand hover:text-ink" aria-label="ออกจากระบบ" title="ออกจากระบบ">
            <LogOut className="size-5" />
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}

/** กันหน้าที่ role นี้ไม่ได้ใช้ (ADMIN / DEV ผ่านได้ทุกหน้า) */
export function RequireRole({ roles, children }) {
  const { user } = useSession();
  if (user.role !== 'ADMIN' && user.role !== 'DEV' && !roles.includes(user.role)) {
    return <Navigate to={homeFor(user.role)} replace />;
  }
  return children;
}
