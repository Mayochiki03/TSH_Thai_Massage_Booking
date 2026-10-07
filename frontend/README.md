# Frontend — ระบบจองคิวนวดแผนไทย

React 19 · Vite 6 · Tailwind CSS 4 · React Router 7 · lucide-react · LIFF SDK · ฟอนต์ Anuphan + Sarabun (ฝังในเว็บ)

## รัน (เปิด backend ก่อน)

```powershell
cd frontend
npm install
npm run dev
```

| แอป | URL | บัญชีทดสอบ (`admin1234`) |
|---|---|---|
| ผู้จอง | http://localhost:5173 | เลือกผู้ใช้จำลองจากเมนูนักพัฒนา |
| หน้างาน | http://localhost:5173/staff | `counter1`, `therapist1` |
| ผู้ดูแลระบบ | http://localhost:5173/admin | `admin`, `dev` |
| Kiosk | http://localhost:5173/kiosk | `kiosk1` (ออก: กดค้างโลโก้ 3 วิ แล้วใส่รหัส) |

Vite ส่งต่อ API: `/api/public/*` → :4000, `/api/*` → :4001
ลองบนมือถือ/แท็บเล็ตใน Wi-Fi เดียวกัน: `http://<IP เครื่อง>:5173` (ดู IP ด้วย `ipconfig`)

## โครงสร้าง

```
src/
  App.jsx                 เส้นทางของ 4 แอป (staff / admin / kiosk โหลดแยกไฟล์)
  index.css               design tokens (สี / ฟอนต์) + animation
  lib/
    api.js                เรียก API + ApiError
    session.jsx           SessionGate: เข้าสู่ระบบ / เปลี่ยนรหัส / ตรวจ role (ใช้ร่วม staff, admin, kiosk)
    liff.js               ยืนยันตัวตนผู้จอง (LIFF หรือผู้ใช้จำลอง) + ส่งตั๋วเข้าแชท
    useLoad.js            hook โหลดข้อมูลสำหรับหน้าแอดมิน
    format.js             วันที่/เวลาภาษาไทย, ชื่อสถานะ
  components/
    ui.jsx                ปุ่ม ฟอร์ม sheet toast การ์ด ฯลฯ
    ClosureSheet.jsx      ปิดรับ/วันหยุด + ยืนยันเมื่อมีคิว
    Logo.jsx              โลโก้ลูกประคบ
  pages/
    patient/              ผู้จอง: จอง, ตั๋ว, การจองของฉัน, รายชื่อ, PDPA
    staff/                เคาน์เตอร์ (QueuePage), ห้องนวด (RoomPage)
    admin/                Dashboard + เมนูผู้ดูแลทั้งหมด
    admin/dev/            เมนูนักพัฒนา: ระบบ, การเชื่อมต่อ LINE, ผู้ใช้จำลอง
    kiosk/                จอสัมผัสหน้าคลินิก
```

## Responsive

- **ผู้จอง:** มือถือคอลัมน์เดียว + ปุ่มจองติดขอบล่าง / จอกว้าง (≥1024px) 2 คอลัมน์ + กล่องสรุปการจองด้านขวา
- **หน้างาน / ผู้ดูแล:** จอกว้างมีแถบเมนูซ้าย / จอเล็กเป็นแถบบน (ผู้ดูแลมีลิ้นชักเมนู) ตารางเลื่อนแนวนอนได้
- **Kiosk:** ขนาดทุกอย่างใช้หน่วย `em` จาก font-size ฐาน `clamp(16px, 2.3vmin, 34px)` → ขยายตามจอเอง
  แนวนอนวางซ้าย-ขวา (`landscape:`) / แนวตั้งเรียงบน-ล่าง (`portrait:`)

## โหมดทดสอบ (LOCAL)

หน้าผู้จองไม่มีแถบทดสอบลอยอยู่ — ถ้ายังไม่ได้เลือกผู้ใช้จำลองจะแสดง "ระบบจองคิวออนไลน์ยังไม่เปิดใช้งาน"
นักพัฒนาเลือกผู้ใช้ได้ที่ **/admin › นักพัฒนา › ผู้ใช้จำลอง › เปิดหน้าผู้จอง** (เก็บใน browser เครื่องนั้นเท่านั้น)

## Build (ใช้งานจริง)

```powershell
npm run build   # → dist/  (+ dist/.vite/manifest.json ให้ backend ใช้แยกไฟล์ของหน้าผู้จอง)
```

ไม่ต้องเปิด Vite ตอนใช้งานจริง — backend ส่ง `dist/` เอง (ดู `backend/src/web.js`):
หน้าผู้จองที่ http://localhost:4000 และหน้าเจ้าหน้าที่ที่ http://localhost:4001/admin · `/staff` · `/kiosk`
แก้โค้ดหน้าเว็บแล้วต้อง `npm run build` ใหม่ทุกครั้ง (รีเฟรช browser ได้เลย ไม่ต้องรีสตาร์ต backend)
