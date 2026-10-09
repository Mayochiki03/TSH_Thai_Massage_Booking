# ระบบจองคิวนวดแผนไทย (Thai Massage Booking)

เว็บแอปจองคิวรับบริการนวดแผนไทยของโรงพยาบาล (หมอนวด 1 คน)
ผู้ป่วยจองเองผ่าน **LINE OA** หรือที่ **เครื่อง kiosk หน้าคลินิก** ได้ **e-ticket รหัสจอง 6 ตัว** ไว้เช็กอิน
เจ้าหน้าที่ดูคิวและเช็กอินที่เคาน์เตอร์ หมอนวดบันทึกผลการรักษา และผู้ดูแลตั้งค่าทุกอย่างได้จากหน้าเว็บ

> สถานะ: **v0.5.0 (กำลังพัฒนา)** ใช้งานได้ครบในโหมดทดสอบ (LOCAL) เหลือเชื่อม LINE จริงผ่าน Cloudflare Tunnel — ดู [CHANGELOG](CHANGELOG.md)

---

## แอปในระบบ

| แอป | URL | ใช้โดย | อุปกรณ์ |
|---|---|---|---|
| **ผู้จอง** | `/` | ผู้ป่วย / ญาติ (เปิดจาก LINE OA) | มือถือ แท็บเล็ต คอม |
| **หน้างาน** | `/staff` | เจ้าหน้าที่เคาน์เตอร์ (`/staff/queue`), หมอนวด (`/staff/room`) | คอม แท็บเล็ต |
| **ผู้ดูแลระบบ** | `/admin` | ผู้ดูแล (ADMIN) + เมนูนักพัฒนา (DEV) | คอม (ใช้บนมือถือได้) |
| **Kiosk** | `/kiosk` | ผู้ป่วย walk-in จองเอง / เช็กอินเอง | จอสัมผัสทุกขนาด แนวตั้ง-แนวนอน |

ทุกหน้าเป็น responsive — ทดสอบที่ 390, 820, 1024, 1440, 1920 px และ kiosk ทั้งแนวตั้ง/แนวนอน

### บทบาทผู้ใช้

| บทบาท | เข้าได้ |
|---|---|
| `DEV` นักพัฒนา | ทุกหน้า + **เมนูนักพัฒนา** (การเชื่อมต่อ LINE, ผู้ใช้จำลอง, เครื่องมือทดสอบ, ล้างข้อมูลทดสอบ) |
| `ADMIN` ผู้ดูแล | Dashboard, ตั้งค่าการจอง, ข้อมูลผู้รับบริการ, บัญชีผู้ใช้, หน้างาน, kiosk (จัดการบัญชี DEV ไม่ได้) |
| `STAFF` เจ้าหน้าที่ | คิววันนี้ / เช็กอิน / walk-in / จองแทน |
| `PRACTITIONER` หมอนวด | ห้องนวด |
| `KIOSK` เครื่อง kiosk | หน้า kiosk เท่านั้น (ล็อกอินครั้งเดียว อยู่ได้ 30 วัน) |

---

## ความสามารถ

**ผู้จอง (LINE)** จองล่วงหน้า 1–2 วัน · เลือกประเภทบริการ (ราคาต่างกัน) · กรอกเลขบัตรประชาชน 13 หลักของผู้รับบริการครั้งเดียว · จองให้ตัวเองหรือครอบครัว (บันทึก "ใครจอง ให้ใคร") · รองรับคนที่มี HN และบุคคลทั่วไป · e-ticket ส่งเข้าแชท LINE · ยืนยัน/ยกเลิกได้ถึง 2 ชม. ก่อนนัด · เตือนก่อนนัด 2 ชม.

**Kiosk** จองคิว walk-in ด้วยเบอร์โทร (+ เลขบัตรประชาชน, ประเภทบริการ) (ใช้ข้อมูลเดิมได้, ชื่อแสดงแบบปิดบัง) · เช็กอินด้วยรหัสจอง + เลข 4 ตัวท้ายเบอร์ · กลับหน้าแรกเองเมื่อไม่มีคนใช้

**เคาน์เตอร์** คิวรายวันแบบไทม์ไลน์ แสดงหลายเตียงต่อรอบ · กรอก VN ตอนเช็กอิน · เช็กอินด้วยรหัส/ชื่อ/เบอร์/HN · รับ walk-in · จองแทน · ยกเลิก · ไม่มาตามนัด

**หมอนวด** ล็อกอินบัญชีตัวเอง → "รับคิว" (ระบบบันทึกว่าใครนวด) → กรอก VN → จับเวลา → บันทึกจุดที่นวด/คำแนะนำ → จบการนวด · ดูประวัติครั้งก่อน

**ผู้ดูแล** เมนูจัดหมวด + ช่องค้นหาเมนู · Dashboard (รวมรายได้) · ประเภทบริการและราคา · รอบเวลาและจำนวนเตียง (แม่แบบ + ปรับเตียงรายรอบ + ปิด/เปิดรับ) · วันหยุด (เตือนถ้ามีคิว → ยกเลิก + แจ้ง LINE) · กฎการจอง · ข้อความแจ้งเตือน · ผู้รับบริการ · ระงับสิทธิ์ · บัญชีผู้ใช้/หมอนวด · การจองทั้งหมด · **รายงาน Excel** (สรุป / รายวัน / รายการจอง / ผู้รับบริการ, ปีงบประมาณ, เลือกหมอนวด, มีเลขบัตร + VN + ราคา) · ประวัติการใช้งาน

**นักพัฒนา** สลับโหมด LOCAL / DEV_TUNNEL / PRODUCTION · ตั้งค่า + ทดสอบ LINE · ผู้ใช้ LINE จำลอง · สั่งรันงานตั้งเวลา · ล้างข้อมูลทดสอบ · ข้อมูลระบบ

**ระบบ** หลายเตียงต่อรอบ (ล็อกแถวรอบก่อนนับ กันจองเกินเตียง) · เลขบัตรประชาชนเก็บแบบเข้ารหัส AES-256-GCM + HMAC สำหรับค้นหา · โควตา 1 คิว/วัน 2 คิว/สัปดาห์ · ตัดสิทธิ์อัตโนมัติเมื่อสาย · ระงับสิทธิ์อัตโนมัติ (ตั้งเกณฑ์ได้) · audit log (PDPA)

---

## สถาปัตยกรรม

```
              อินเทอร์เน็ต                                  │                LAN โรงพยาบาล
                                                            │
 LINE OA ─► LIFF (มือถือผู้ป่วย) ─► Cloudflare Tunnel ──────┼─► :4000  PUBLIC   หน้าผู้จอง + /api/public
                                                            │
       เคาน์เตอร์ / ห้องนวด / ผู้ดูแล / เครื่อง kiosk ───────┼─► :4001  INTERNAL ทุกหน้า + /api/staff, admin, dev, kiosk
                                                            │                │
                                                            │             MySQL 8
```

- Backend แยก 2 พอร์ต — หน้าเว็บและ API ฝั่งเจ้าหน้าที่ไม่มีอยู่บนพอร์ตที่ออกอินเทอร์เน็ต
- ตอนใช้งานจริง backend ส่งหน้าเว็บเอง (`frontend/dist`) ไม่ต้องเปิด Vite: พอร์ต 4000 ส่งเฉพาะหน้าผู้จอง (`/admin` `/staff` `/kiosk` → 404)
- Cloudflare Tunnel: ไม่ต้องเปิดพอร์ตไฟร์วอลล์ และไม่เปิดเผย public IP ของโรงพยาบาล

| ส่วน | ใช้ |
|---|---|
| Frontend | React 19, Vite 6, Tailwind CSS 4, React Router 7, lucide-react, LINE LIFF SDK (โหลดเฉพาะตอนใช้ LINE จริง), ฟอนต์ Anuphan + Sarabun ฝังในเว็บ |
| Backend | Node.js 20+, Express 4, mysql2, zod, bcryptjs, JWT (httpOnly cookie), node-cron |
| Database | MySQL 8.0 (utf8mb4) |

```
TSH_Thai_Massage_Booking/
├── database/      สคริปต์ MySQL + migrations
├── backend/       Express API (2 พอร์ต) + cron
├── frontend/      React: patient / staff / admin / kiosk
├── docs/          เอกสารสเปก
├── README.md
└── CHANGELOG.md
```

รายละเอียด: [database](database/README.md) · [backend](backend/README.md) · [frontend](frontend/README.md)

---

## เริ่มต้นใช้งาน (เครื่อง dev — Windows)

**ต้องมี:** Node.js 20+ · MySQL 8.0 · Git

```powershell
# 1) ฐานข้อมูล (ลบแล้วสร้างใหม่ + ข้อมูลตัวอย่าง — dev เท่านั้น)
cd database
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p -e "source setup_dev.sql"

# 2) Backend
cd ..\backend
npm install
Copy-Item .env.example .env
npm run dev

# 3) Frontend (หน้าต่างใหม่)
cd ..\frontend
npm install
npm run dev
```

### รันแบบใช้งานจริง (ไม่ใช้ Vite)

```powershell
cd frontend
npm run build      # สร้าง frontend/dist (ทำใหม่ทุกครั้งที่แก้โค้ดหน้าเว็บ)
cd ..\backend
npm start          # เปิด backend ตัวเดียว ส่งทั้ง API และหน้าเว็บ
```

| เปิดที่ | ได้อะไร |
|---|---|
| http://localhost:4000 | หน้าผู้จองเท่านั้น (พอร์ตนี้จะต่อกับ Cloudflare Tunnel) |
| http://localhost:4001/admin · `/staff` · `/kiosk` | หน้าเจ้าหน้าที่ (เครื่องอื่นใน LAN ใช้ `http://<IP เครื่อง server>:4001`) |

> ระหว่างเขียนโค้ดใช้ `npm run dev` + Vite :5173 ตามเดิม — ถ้ามี `frontend/dist` อยู่ backend ก็ส่งหน้าเว็บที่ :4000/:4001 ด้วย แต่เป็นเวอร์ชันตอน build ล่าสุด

> อัปเกรดโดยไม่ล้างข้อมูล (รันในโฟลเดอร์ database ตามลำดับที่ยังไม่เคยรัน):
> - v0.2 → v0.3: `mysql -u root -p -e "source migrations/001_roles_kiosk.sql"`
> - v0.5 → v0.6: `mysql -u root -p -e "source migrations/002_beds_services_nid.sql"` (หลายเตียง, ประเภทบริการ, เลขบัตร, หมอนวด, VN) — **สำรองฐานข้อมูลก่อน**
> - v0.6.0 → v0.6.1: `mysql -u root -p -e "source migrations/003_show_price.sql"` (สวิตช์แสดงราคา)
> - v0.6.x → v0.7.0: `mysql -u root -p -e "source migrations/004_mfa.sql"` (2FA) — แล้วเพิ่ม `MFA_REQUIRED_ROLES=DEV,ADMIN` ใน `.env` (ไม่ใส่ก็ได้ ค่าเริ่มต้นเท่านี้)
> - v0.7.1 → v0.7.2: `mysql -u root -p -e "source migrations/005_checkin_note.sql"` (คำแนะนำการมารับบริการ)
>
> ถ้าพิมพ์ `mysql` แล้วขึ้น "not recognized" ให้ใช้ที่อยู่เต็ม: `& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p ...`

### บัญชีทดสอบ (dev) — รหัสผ่าน `admin1234` ทุกบัญชี

> `dev` และ `admin` ต้องผูกแอป Authenticator ตอนล็อกอินครั้งแรก (เตรียมมือถือไว้) · บัญชีอื่นไม่ต้อง เว้นแต่แอดมินเปิดบังคับ

| username | บทบาท | เปิดที่ |
|---|---|---|
| `dev` | นักพัฒนา | http://localhost:5173/admin |
| `admin` | ผู้ดูแล | http://localhost:5173/admin |
| `counter1` | เจ้าหน้าที่เคาน์เตอร์ | http://localhost:5173/staff |
| `therapist1`, `therapist2` | หมอนวด (ผูกกับหมอนวด 1 / 2) | http://localhost:5173/staff |
| `kiosk1` | เครื่อง kiosk | http://localhost:5173/kiosk |

### ทดสอบหน้าผู้จองในโหมด LOCAL

หน้าผู้จองจะแสดง "ระบบจองคิวออนไลน์ยังไม่เปิดใช้งาน" จนกว่าจะเลือกผู้ใช้จำลอง:
ล็อกอิน `dev` → **นักพัฒนา › ผู้ใช้จำลอง** → กด **เปิดหน้าผู้จอง** ที่ผู้ใช้ที่ต้องการ

### ทดสอบกับ LINE จริง (โหมด DEV_TUNNEL + Quick Tunnel)

ตั้งค่าครั้งแรก: LINE OA เปิด Messaging API → LINE Login channel + LIFF (Size Full, scope `openid profile chat_message.write`, Add friend = Aggressive) ใน **Provider เดียวกัน** → กด **Publish** channel LINE Login (ถ้ายัง Developing จะใช้ได้แค่แอดมิน) → ปิด **Auto-response** ใน LINE OA Manager (ไม่อย่างนั้น OA จะตอบข้อความขอโทษใส่ตั๋ว) → ใส่ค่าทั้งหมดที่ `/admin › นักพัฒนา › การเชื่อมต่อ LINE`

**ทุกครั้งที่เปิดคอมใหม่** (ลิงก์ Quick Tunnel เปลี่ยนทุกครั้ง):

```powershell
# หน้าต่าง 1
cd backend
npm start
# หน้าต่าง 2
cloudflared tunnel --protocol http2 --url http://127.0.0.1:4000
```

แล้วเอาลิงก์ `https://….trycloudflare.com` ใหม่ไปแก้ **2 ที่**:
1. LINE Developers › channel LINE Login › LIFF › **Endpoint URL**
2. `/admin › นักพัฒนา › การเชื่อมต่อ LINE` › **Public URL** → บันทึก → กดทดสอบ

ลิงก์ที่ผู้ใช้กด (`https://liff.line.me/<LIFF ID>`) ไม่เปลี่ยน · `--protocol http2` กันสายหลุดบนเน็ตที่ตัด UDP (Error 1033) · ใช้จริงจะเปลี่ยนเป็น Named Tunnel (ลิงก์คงที่ ไม่ต้องแก้ทุกครั้ง)

---

## ความปลอดภัย

- รหัสผ่าน bcrypt · session JWT ใน httpOnly cookie · บังคับเปลี่ยนรหัสผ่านครั้งแรก · ล็อกอินผิดเกิน 10 ครั้ง/15 นาทีถูกพัก
- **ยืนยันตัวตน 2 ชั้น (แอป Authenticator)** บังคับสำหรับผู้ดูแล/นักพัฒนา เลือกบังคับรายคนได้ · รหัสสำรอง 10 ชุด · แอดมินรีเซ็ตได้เมื่อมือถือหาย · รีเซ็ตแล้ว session เดิมทุกเครื่องหลุด
- ผู้จองตรวจ LINE ID token ทุก request · kiosk ยืนยันเช็กอินด้วยเลขท้ายเบอร์โทร
- LINE token และเลขบัตรประชาชนเข้ารหัส AES-256-GCM (เปิดดูเลขเต็มที่หน้าผู้ดูแลถูกบันทึก audit log) · rate limit · helmet · parameterized query · MySQL user สิทธิ์จำกัด
- ⚠ **ห้ามเปลี่ยน `APP_SECRET_KEY` หลังมีข้อมูลจริง** — เลขบัตรประชาชนและ LINE token ที่เก็บไว้จะถอดรหัส/ค้นหาไม่ได้ (ตั้งค่าใหม่ก่อนเริ่มใช้งานจริงครั้งเดียว และเก็บสำรองไว้ที่ปลอดภัย)
- **ก่อนขึ้น production:** เปลี่ยน `JWT_SECRET`, `APP_SECRET_KEY`, รหัส DB, รหัสบัญชีตั้งต้น และ **ห้ามรัน** `04_dev_sample.sql`

---

## แผนงาน

- [x] ฐานข้อมูล + Backend API + cron
- [x] หน้าผู้จอง (responsive)
- [x] หน้าเคาน์เตอร์ + ห้องนวด
- [x] หน้าผู้ดูแล + Dashboard + เมนูนักพัฒนา
- [x] Kiosk walk-in / เช็กอินเอง
- [x] Backend ส่งหน้าเว็บเอง แยกพอร์ต public / LAN
- [ ] เชื่อม LINE จริง (LIFF + Messaging API) ผ่าน Cloudflare Tunnel
- [ ] ทดลองใช้กับหัวหน้า/เจ้าหน้าที่ + ปรับตาม feedback
- [ ] ติดตั้งบน server โรงพยาบาล + backup อัตโนมัติ
- [x] รายงาน Excel (สรุป / รายวัน / รายการจอง / ผู้รับบริการ)
