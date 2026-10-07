/**
 * App.jsx — เส้นทางของทั้งเว็บ แบ่งเป็น 4 แอปแยกกันชัดเจน
 *
 *  /            ผู้จอง (เปิดจาก LINE OA)            → pages/patient
 *  /staff/*     หน้างาน: เคาน์เตอร์ + ห้องนวด (LAN)   → pages/staff
 *  /admin/*     ผู้ดูแลระบบ + เมนูนักพัฒนา (LAN)    → pages/admin
 *  /kiosk       เครื่อง kiosk หน้าคลินิก (LAN)       → pages/kiosk
 *
 * ทุกแอปฝั่งเจ้าหน้าที่ล็อกอินผ่าน SessionGate (lib/session.jsx) และตรวจ role ของตัวเอง
 */
import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { ToastProvider, ConfirmProvider, Spinner } from './components/ui.jsx';
import { PatientApp } from './pages/patient/PatientApp.jsx';
import { BookPage } from './pages/patient/BookPage.jsx';
import { TicketPage } from './pages/patient/TicketPage.jsx';
import { MyBookingsPage } from './pages/patient/MyBookingsPage.jsx';
import { PeoplePage } from './pages/patient/PeoplePage.jsx';
import { StaffApp, RequireRole } from './pages/staff/StaffApp.jsx';

// แอปฝั่งเจ้าหน้าที่โหลดแยกไฟล์ (lazy) → ผู้จองบนมือถือไม่ต้องโหลดโค้ดหน้าแอดมิน/kiosk
const QueuePage = lazy(() => import('./pages/staff/QueuePage.jsx').then((m) => ({ default: m.QueuePage })));
const RoomPage = lazy(() => import('./pages/staff/RoomPage.jsx').then((m) => ({ default: m.RoomPage })));
const AdminApp = lazy(() => import('./pages/admin/AdminApp.jsx').then((m) => ({ default: m.AdminApp })));
const KioskApp = lazy(() => import('./pages/kiosk/KioskApp.jsx').then((m) => ({ default: m.KioskApp })));

export default function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <BrowserRouter>
          <Suspense fallback={<Spinner />}>
          <Routes>
            {/* ผู้จอง */}
            <Route element={<PatientApp />}>
              <Route index element={<BookPage />} />
              <Route path="ticket/:code" element={<TicketPage />} />
              <Route path="my" element={<MyBookingsPage />} />
              <Route path="people" element={<PeoplePage />} />
            </Route>

            {/* หน้างาน */}
            <Route path="staff" element={<StaffApp />}>
              <Route index element={null} />
              <Route path="queue" element={<RequireRole roles={['STAFF']}><QueuePage /></RequireRole>} />
              <Route path="room" element={<RequireRole roles={['PRACTITIONER']}><RoomPage /></RequireRole>} />
              <Route path="*" element={<Navigate to="/staff" replace />} />
            </Route>

            {/* ผู้ดูแลระบบ (มี Routes ย่อยของตัวเอง) */}
            <Route path="admin/*" element={<AdminApp />} />

            {/* kiosk */}
            <Route path="kiosk" element={<KioskApp />} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </BrowserRouter>
      </ConfirmProvider>
    </ToastProvider>
  );
}
