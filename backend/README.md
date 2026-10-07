# Backend — ระบบจองคิวนวดแผนไทย

Node.js 20+ · Express · MySQL 8 · ไม่ใช้ Docker

รัน 2 พอร์ตแยกกัน:

| พอร์ต | ใช้กับ | เปิดให้ใคร |
|---|---|---|
| **4000** public | หน้าจอง + `/api/public/*` | อินเทอร์เน็ต (ผ่าน Cloudflare Tunnel) — ฟังแค่ `127.0.0.1` |
| **4001** internal | `/api/auth` `/api/staff` `/api/practitioner` `/api/admin` | LAN เท่านั้น |

API ของแอดมิน/เจ้าหน้าที่ **ไม่มีอยู่บนพอร์ต public เลย** ต่อให้คนนอกเข้าเว็บจองได้ ก็เรียก API แอดมินไม่ได้

## ติดตั้ง (Windows / PowerShell)

```powershell
cd backend
npm install
Copy-Item .env.example .env
npm run dev
```

ควรเห็น:
```
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
  config.js  db.js      env / MySQL pool (time_zone +07:00)
  middleware/auth.js    ล็อกอินเจ้าหน้าที่ (JWT httpOnly cookie) / LINE ID token / ผู้ใช้จำลอง
  routes/
    public.js           ผู้จอง
    auth.js             login / logout / change-password
    staff.js            เคาน์เตอร์ + หมอนวด
    admin.js            แอดมิน (CRUD ทั้งหมด)
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
| POST | `/auth/login` · `/auth/logout` · `/auth/change-password` | |
| GET | `/auth/me` | |
| GET | `/staff/queue?date=` | คิวรายวัน (ทุกรอบ + ประวัติ) |
| GET | `/staff/appointments/code/:code` | หาจากรหัสจอง |
| GET | `/staff/appointments/search?q=` · `/staff/patients/search?q=` | |
| POST | `/staff/appointments` | walk-in / จองแทน `{slot_id, channel, patient_id \| patient, force}` |
| POST | `/staff/appointments/:id/checkin` · `/cancel` · `/no-show` | |
| GET | `/practitioner/queue` · `/practitioner/patients/:id/history` | |
| POST | `/practitioner/appointments/:id/start` · `/complete` | |
| PUT | `/practitioner/appointments/:id/record` | |

### แอดมิน — `:4001/api/admin`
`stats` · `settings` · `slot-templates` (+ `/apply`) · `slots` (+ `/generate` `/block` `/unblock`) · `holidays` (+ `/preview`) · `practitioners` · `users` (+ `/reset-password`) · `patients` · `line-users` · `appointments` · `suspensions` (+ `/lift`) · `notification-templates` · `notification-logs` · `connection` (+ `/test` `/clear-test-data`) · `audit-logs`

### รูปแบบ error
```json
{ "error": { "code": "QUOTA_DAY", "message": "จองได้ไม่เกิน 1 คิวต่อวัน", "can_force": true } }
```
`can_force: true` = เจ้าหน้าที่ส่งซ้ำพร้อม `force: true` เพื่อยืนยันได้ · `HAS_BOOKINGS` (ตั้งวันหยุด/บล็อกรอบ) = ส่งซ้ำพร้อม `confirm: true`

## ผลทดสอบ (MySQL 8.0.46, Node 22)

end-to-end 59 กรณีผ่านทั้งหมด เช่น จองซ้อนพร้อมกัน 5 request สำเร็จ 1 · โควตาวัน/สัปดาห์ · HN ซ้ำแต่ชื่อไม่ตรงถูกปฏิเสธ · ยกเลิกน้อยกว่า 2 ชม. ถูกปฏิเสธ · เช็กอินเร็ว/สายมีคำเตือน · walk-in เช็กอินอัตโนมัติ · หมอนวดต้องเริ่มก่อนจบ · ตั้งวันหยุดที่มีคิว → เตือน → ยกเลิก + แจ้ง · สิทธิ์ตาม role · บังคับเปลี่ยนรหัสผ่าน · ตัด no-show + ระงับสิทธิ์อัตโนมัติ · เตือน 2 ชม. ไม่ส่งซ้ำ
