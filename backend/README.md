# Backend — ระบบจองคิวนวดแผนไทย

Node.js 20+ · Express · MySQL 8 · ไม่ใช้ Docker

รัน 2 พอร์ตแยกกัน:

| พอร์ต | ใช้กับ | เปิดให้ใคร |
|---|---|---|
| **4000** public | หน้าผู้จอง + `/api/public/*` | อินเทอร์เน็ต (ผ่าน Cloudflare Tunnel) — ฟังแค่ `127.0.0.1` |
| **4001** internal | ทุกหน้า (`/admin` `/staff` `/kiosk` + หน้าผู้จองสำหรับทดสอบ) + `/api/auth` `/api/staff` `/api/practitioner` `/api/admin` `/api/dev` `/api/kiosk` `/api/public` | LAN เท่านั้น |

หน้าเว็บและ API ของแอดมิน/เจ้าหน้าที่ **ไม่มีอยู่บนพอร์ต public เลย** ต่อให้คนนอกเข้าเว็บจองได้ ก็เปิดหน้าแอดมินหรือเรียก API แอดมินไม่ได้

## ส่งหน้าเว็บ (`src/web.js`)

ถ้ามี `frontend/dist` (ได้จาก `npm run build` ในโฟลเดอร์ frontend หรือ `npm run build:web` ในโฟลเดอร์นี้) backend จะส่งหน้าเว็บเอง ไม่ต้องเปิด Vite

| พอร์ต | URL ที่ส่ง | ไฟล์ JS ที่ส่ง |
|---|---|---|
| 4000 | `/` `/ticket/:code` `/my` `/people` เท่านั้น อย่างอื่น 404 | เฉพาะไฟล์ของหน้าผู้จอง (คำนวณจาก `dist/.vite/manifest.json`) — ไฟล์โค้ดหน้าแอดมิน/kiosk ขอไม่ได้ |
| 4001 | ทุกหน้า | ทุกไฟล์ |

- ไฟล์ใน `/assets` มี hash ในชื่อ → cache 1 ปี, `index.html` → `no-cache` (build ใหม่แล้วเห็นผลทันที)
- CSP: โหลด script/style/font จากเครื่องตัวเองเท่านั้น, อนุญาตเชื่อมต่อ `*.line.me` และรูปจาก `*.line-scdn.net` (LIFF)
- ใช้โฟลเดอร์อื่นได้ด้วย `FRONTEND_DIST` ใน `.env`
- ไม่มี `dist` → ข้ามไป (console บอก) ใช้ Vite :5173 ระหว่างพัฒนาได้ตามเดิม

## ติดตั้ง (Windows / PowerShell)

```powershell
cd backend
npm install
Copy-Item .env.example .env
npm run dev
```

ควรเห็น:
```
[web]      ส่งหน้าเว็บจาก ...\frontend\dist   (หรือ "ยังไม่มี frontend/dist" ถ้ายังไม่ได้ build)
[cron] started
[public]   http://127.0.0.1:4000  (หน้าจอง — ออกเน็ตผ่าน tunnel)
[internal] http://0.0.0.0:4001  (แอดมิน/เจ้าหน้าที่ — LAN เท่านั้น)
```

เปิด http://localhost:4001/health ต้องได้ `{"ok":true,...,"db":"ok"}`

> **ต้องรัน `database/setup_dev.sql` ใหม่หนึ่งครั้ง** — schema มีแก้เล็กน้อย (`notification_logs.status` เพิ่ม `SKIPPED`)

### ค่าใน `.env`
- ค่าตัวอย่างใช้ dev ได้เลย
- ก่อนขึ้นจริง: รัน `npm run gen-key` 2 ครั้ง เอาไปใส่ `JWT_SECRET` และ `APP_SECRET_KEY` (ถ้า `NODE_ENV=production` แล้วยังใช้ค่าตัวอย่าง เซิร์ฟเวอร์จะไม่ยอมเปิด)
- ⚠ อย่าเปลี่ยน `APP_SECRET_KEY` หลังตั้ง LINE token แล้ว — token ที่เข้ารหัสไว้จะถอดไม่ได้ ต้องกรอกใหม่

## ทดสอบ API

เปิด `api.http` ใน VS Code (ติดตั้ง extension **REST Client**) แล้วกด **Send Request** ทีละอัน

**โหมด LOCAL:** ฝั่งผู้จองไม่ต้องใช้ LINE จริง ส่ง header `X-Dev-Line-User: Udev000...0001` แทน (header นี้ถูกปิดทันทีเมื่อเปลี่ยนเป็นโหมดอื่น)

## โครงสร้าง

```
src/
  index.js              เปิด 2 พอร์ต + cron
  web.js                ส่งหน้าเว็บ (frontend/dist) แยกตามพอร์ต
  config.js  db.js      env / MySQL pool (time_zone +07:00)
  middleware/auth.js    ล็อกอินเจ้าหน้าที่ (JWT httpOnly cookie) / LINE ID token / ผู้ใช้จำลอง
  routes/
    public.js           ผู้จอง
    auth.js             login / logout / change-password
    staff.js            เคาน์เตอร์ + หมอนวด
    admin.js            ผู้ดูแล: dashboard + CRUD ทั้งหมด
    dev.js              นักพัฒนา: การเชื่อมต่อ LINE, ผู้ใช้จำลอง, รันงานตั้งเวลา, ล้างข้อมูลทดสอบ
    kiosk.js            เครื่อง kiosk: รอบว่าง, ค้นจากเบอร์, จอง, เช็กอินด้วยรหัส
  services/
    booking.js          กฎการจอง, transaction กันจองซ้อน, เช็กอิน, เริ่ม/จบบริการ, ปิดรอบ
    notify.js line.js   แจ้งเตือน LINE (Flex message) / LINE API
    settings.js         อ่าน-เขียน settings (cache 30 วิ, SECRET เข้ารหัส AES-256-GCM)
    patients.js audit.js
  jobs/cron.js          สร้าง slot / ตัด no-show + ระงับสิทธิ์ / เตือน 2 ชม. / เตือน 1 วัน
```

## Cron

| งาน | เวลา |
|---|---|
| สร้าง slot ล่วงหน้า | ตอนเปิดเซิร์ฟเวอร์ + ทุกวัน 00:05 |
| ตัด no-show (+ ระงับสิทธิ์อัตโนมัติถ้าเปิด) | ทุกนาที |
| เตือนก่อนนัด 2 ชม. | ทุก 5 นาที |
| เตือนล่วงหน้า 1 วัน (ปิดไว้เป็นค่าเริ่มต้น) | ทุกต้นชั่วโมง (ส่งเฉพาะชั่วโมงที่ตั้งไว้) |

โหมด LOCAL: แจ้งเตือนไม่ส่งจริง แต่พิมพ์ข้อความลง console และบันทึก log เป็น `SKIPPED`

## API

### ผู้จอง — `:4000/api/public`
| Method | Path | |
|---|---|---|
| GET | `/config` | ชื่อคลินิก, โหมด, LIFF ID (ไม่ต้องล็อกอิน) |
| GET | `/me` | ข้อมูลผู้จอง + รายชื่อผู้รับบริการ |
| POST | `/me/consent` | ยอมรับ PDPA |
| PUT | `/me/self` | ข้อมูลตัวเอง ("จองให้ตัวเอง") |
| POST / PUT / DELETE | `/me/patients[/:id]` | เพิ่ม/แก้/เอาออก ผู้รับบริการคนอื่น (+ relation) |
| GET | `/availability` | รอบว่างในช่วงที่จองได้ |
| POST | `/bookings` | จอง `{patient_id, slot_id, chief_complaint}` |
| GET | `/bookings?scope=upcoming\|past` | การจองของฉัน |
| GET | `/bookings/:code` | ตั๋ว (+ `can_cancel`, `can_confirm`) |
| POST | `/bookings/:code/cancel` · `/confirm` | ยกเลิก / ยืนยันมาตามนัด |
| POST | `/bookings/:code/liff-sent` · `/push-ticket` | บันทึกว่าส่งตั๋วเข้าแชทแล้ว / ให้ backend push แทน |

### เจ้าหน้าที่ — `:4001/api`
| Method | Path | |
|---|---|---|
| POST | `/auth/login` · `/auth/logout` · `/auth/change-password` · `/auth/verify-password` | verify-password = ยืนยันรหัสก่อนออกจาก kiosk |
| GET | `/auth/me` | |
| GET | `/staff/queue?date=` | คิวรายวัน (ทุกรอบ + ประวัติ) |
| GET | `/staff/appointments/code/:code` | หาจากรหัสจอง |
| GET | `/staff/appointments/search?q=` · `/staff/patients/search?q=` | |
| POST | `/staff/appointments` | walk-in / จองแทน `{slot_id, channel, patient_id \| patient, force}` |
| POST | `/staff/appointments/:id/checkin` · `/cancel` · `/no-show` | |
| GET | `/practitioner/queue` · `/practitioner/patients/:id/history` | |
| POST | `/practitioner/appointments/:id/start` · `/complete` | |
| PUT | `/practitioner/appointments/:id/record` | |

### ผู้ดูแล — `:4001/api/admin` (ADMIN, DEV)
`dashboard` · `settings` (ยกเว้นหมวดการเชื่อมต่อ) · `slot-templates` (+ `/apply`) · `slots` (+ `/generate` `/block` `/unblock`) · `holidays` (+ `/preview`) · `practitioners` · `users` (+ `/reset-password`) · `patients` · `line-users` · `appointments` · `suspensions` (+ `/lift`) · `notification-templates` · `notification-logs` · `audit-logs`

### นักพัฒนา — `:4001/api/dev` (DEV เท่านั้น)
| Method | Path | |
|---|---|---|
| GET | `/system` | ข้อมูลระบบ |
| GET / PUT | `/connection` | โหมด + ค่า LINE (secret เว้นว่าง = คงค่าเดิม) |
| POST | `/connection/test` | `{what: public \| token \| quota \| push}` |
| GET / POST / DELETE | `/mock-users[/:id]` | ผู้ใช้ LINE จำลอง (โหมด LOCAL) |
| GET / POST | `/jobs`, `/jobs/:name` | `generate-slots` `no-show` `remind-2h` `remind-1d` |
| POST | `/clear-test-data` | `{confirm_text: "ล้างข้อมูล"}` |

### Kiosk — `:4001/api/kiosk` (KIOSK, ADMIN, DEV)
| Method | Path | |
|---|---|---|
| GET | `/config` · `/availability` | |
| POST | `/patients/lookup` | `{phone_number}` → ชื่อแบบปิดบัง |
| POST | `/bookings` | `{slot_id, patient_id + phone_number \| patient}` (ใกล้เวลานัดเช็กอินให้อัตโนมัติ) |
| POST | `/checkin` | `{code, phone_last4}` |

### สิทธิ์
`DEV` ⊃ `ADMIN` ⊃ (`STAFF`, `PRACTITIONER`, `KIOSK`) — `requireRole('DEV')` = นักพัฒนาเท่านั้น, role อื่นผ่านได้เฉพาะ route ที่ระบุ

### รูปแบบ error
```json
{ "error": { "code": "QUOTA_DAY", "message": "จองได้ไม่เกิน 1 คิวต่อวัน", "can_force": true } }
```
`can_force: true` = เจ้าหน้าที่ส่งซ้ำพร้อม `force: true` เพื่อยืนยันได้ · `HAS_BOOKINGS` (ตั้งวันหยุด/บล็อกรอบ) = ส่งซ้ำพร้อม `confirm: true`

## ผลทดสอบ (MySQL 8.0.46, Node 22)

end-to-end 77 กรณีผ่านทั้งหมด (รวมสิทธิ์ DEV/ADMIN/KIOSK, kiosk จอง/เช็กอิน, dashboard) เช่น จองซ้อนพร้อมกัน 5 request สำเร็จ 1 · โควตาวัน/สัปดาห์ · HN ซ้ำแต่ชื่อไม่ตรงถูกปฏิเสธ · ยกเลิกน้อยกว่า 2 ชม. ถูกปฏิเสธ · เช็กอินเร็ว/สายมีคำเตือน · walk-in เช็กอินอัตโนมัติ · หมอนวดต้องเริ่มก่อนจบ · ตั้งวันหยุดที่มีคิว → เตือน → ยกเลิก + แจ้ง · สิทธิ์ตาม role · บังคับเปลี่ยนรหัสผ่าน · ตัด no-show + ระงับสิทธิ์อัตโนมัติ · เตือน 2 ชม. ไม่ส่งซ้ำ
