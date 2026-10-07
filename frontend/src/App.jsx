import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { Settings } from 'lucide-react';
import { ToastProvider, ConfirmProvider, Empty } from './components/ui.jsx';
import { PatientApp } from './pages/patient/PatientApp.jsx';
import { BookPage } from './pages/patient/BookPage.jsx';
import { TicketPage } from './pages/patient/TicketPage.jsx';
import { MyBookingsPage } from './pages/patient/MyBookingsPage.jsx';
import { PeoplePage } from './pages/patient/PeoplePage.jsx';
import { StaffApp, RequireRole } from './pages/staff/StaffApp.jsx';
import { QueuePage } from './pages/staff/QueuePage.jsx';
import { RoomPage } from './pages/staff/RoomPage.jsx';

export default function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <BrowserRouter>
          <Routes>
            {/* ผู้จอง (เปิดจาก LINE) */}
            <Route element={<PatientApp />}>
              <Route index element={<BookPage />} />
              <Route path="ticket/:code" element={<TicketPage />} />
              <Route path="my" element={<MyBookingsPage />} />
              <Route path="people" element={<PeoplePage />} />
            </Route>

            {/* เจ้าหน้าที่ / หมอนวด / แอดมิน (LAN) */}
            <Route path="staff" element={<StaffApp />}>
              <Route index element={null} />
              <Route path="login" element={null} />
              <Route path="queue" element={<RequireRole roles={['STAFF']}><QueuePage /></RequireRole>} />
              <Route path="room" element={<RequireRole roles={['PRACTITIONER']}><RoomPage /></RequireRole>} />
              <Route path="admin/*" element={
                <RequireRole roles={[]}>
                  <Empty icon={Settings} title="หน้าตั้งค่าระบบ">กำลังพัฒนา (วันที่ 3)</Empty>
                </RequireRole>
              } />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ConfirmProvider>
    </ToastProvider>
  );
}
