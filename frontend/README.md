# Frontend — ระบบจองคิวนวดแผนไทย

React 19 · Vite · Tailwind CSS 4 · lucide-react · LIFF SDK · ฟอนต์ Anuphan + Sarabun (ฝังในเว็บ ไม่พึ่ง Google Fonts)

## รัน (ต้องเปิด backend ก่อน)

```powershell
cd frontend
npm install
npm run dev
```

| หน้า | URL |
|---|---|
| ผู้จอง (มือถือ) | http://localhost:5173 |
| เจ้าหน้าที่ / หมอนวด | http://localhost:5173/staff |

Vite ส่งต่อ API ให้เอง: `/api/public/*` → :4000 และ `/api/*` → :4001

**ลองบนมือถือจริง (Wi-Fi เดียวกัน):** เปิด `http://<IP เครื่อง>:5173` (ดู IP ด้วย `ipconfig`)

## โหมดทดสอบ (LOCAL)

แถบสีเหลืองด้านบนหน้าผู้จอง ใช้สลับผู้ใช้ LINE จำลองได้:
- **Somsri**: มีแม่ (บุญมา) ในรายชื่อ, มีคิวพรุ่งนี้ให้แม่
- **Wichai**: บุคคลทั่วไป ไม่มี HN
- **Prasert**: เคยไม่มาตามนัด
- **ผู้ใช้ใหม่**: เริ่มจากหน้ายินยอม PDPA → กรอกข้อมูลตัวเอง

เมื่อเปลี่ยนโหมดเป็น DEV_TUNNEL / PRODUCTION แถบนี้จะหายไป และเว็บจะใช้ LINE login จริง

## หน้าจอ

**ผู้จอง** `/` จองคิว · `/ticket/:code` e-ticket (รองรับ `?action=confirm|cancel` จากลิงก์เตือนใน LINE) · `/my` การจองของฉัน · `/people` รายชื่อผู้รับบริการ

**เจ้าหน้าที่** `/staff/queue` คิวรายวัน + ช่องเช็กอิน + walk-in / จองแทน (อัปเดตทุก 20 วิ) · `/staff/room` ห้องนวด (เริ่ม/จบ + จับเวลา + บันทึกผล + ประวัติครั้งก่อน) · `/staff/admin` (วันที่ 3)

## Build

```powershell
npm run build   # → dist/
```
