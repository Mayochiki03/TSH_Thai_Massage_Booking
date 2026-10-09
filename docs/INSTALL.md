# คู่มือติดตั้ง — ระบบจองคิวนวดแผนไทย

ฐานข้อมูลใช้ **MariaDB** (ทดสอบกับ MariaDB 10.11 LTS แล้ว — test ทั้งชุดผ่าน รวมการจองพร้อมกันหลายคน)
โค้ดยังใช้กับ MySQL 8 ได้ แต่เครื่องใหม่ทุกเครื่องให้ใช้ MariaDB

| หัวข้อ | ใช้เมื่อ |
|---|---|
| [ก. เครื่อง dev (Windows)](#ก-เครื่อง-dev-windows) | ติดตั้งเครื่องพัฒนาเครื่องใหม่ |
| [ข. ย้ายข้อมูลจาก MySQL → MariaDB](#ข-ย้ายข้อมูลจาก-mysql--mariadb-เครื่อง-dev-เดิม) | เครื่อง dev เดิมที่ใช้ MySQL อยู่ |
| [ค. เครื่องใช้งานจริง (Ubuntu Server)](#ค-เครื่องใช้งานจริง-ubuntu-server) | ขึ้นระบบบน server โรงพยาบาล |
| [ง. ย้ายจาก Windows ไป Ubuntu ต้องแก้อะไร](#ง-ย้ายจาก-windows-ไป-ubuntu-ต้องแก้อะไร) | สรุปสิ่งที่ต่างกัน |
| [จ. รัน test อัตโนมัติ + สแกน SonarQube](#จ-รัน-test-อัตโนมัติ--สแกน-sonarqube) | ก่อน commit / ก่อนสแกนโค้ด |

> ⚠ **APP_SECRET_KEY** ใน `backend/.env` ใช้เข้ารหัสเลขบัตรประชาชน, token LINE และ 2FA
> ถ้าย้ายข้อมูลไปเครื่องใหม่ **ต้องใช้ค่าเดิม** — ค่าไม่ตรง = ข้อมูลที่เข้ารหัสไว้อ่านไม่ได้ทั้งหมด
> ถ้าเริ่มฐานข้อมูลใหม่ (ไม่ย้ายข้อมูล) ให้สร้างค่าใหม่ได้

---

## ก. เครื่อง dev (Windows)

### 1) โปรแกรมที่ต้องติดตั้ง

| โปรแกรม | เวอร์ชัน | หมายเหตุ |
|---|---|---|
| Node.js | 22 LTS | https://nodejs.org → เลือก LTS |
| Git | ล่าสุด | https://git-scm.com |
| MariaDB Server | 10.11 (LTS) | https://mariadb.org/download → MariaDB Server · 10.11 · Windows · MSI |
| cloudflared | ล่าสุด | เฉพาะตอนทดสอบกับ LINE จริง (`winget install Cloudflare.cloudflared`) |
| VS Code | — | แนะนำส่วนเสริม SonarQube for IDE |

### 2) ติดตั้ง MariaDB (หน้าจอ MSI installer)

1. **Custom Setup** — ค่าเริ่มต้นได้เลย
2. **User settings**
   - ตั้ง **New root password** (จดไว้ ห้ามใส่ในไฟล์ที่ขึ้น GitHub)
   - ✅ **Use UTF8 as default server's character set**
3. **Default instance properties**
   - Service Name: `MariaDB`
   - ✅ Enable networking · **TCP port: `3307`** (ถ้าเครื่องมี MySQL ใช้ 3306 อยู่ — เครื่องใหม่ที่ไม่มี MySQL ใช้ 3306 ได้)
4. Install → Finish

ตรวจว่าใช้ได้ (PowerShell):
```powershell
& "C:\Program Files\MariaDB 10.11\bin\mariadb.exe" -u root -p -P 3307 -e "SELECT VERSION();"
```
ควรได้ `10.11.x-MariaDB`

> ทุกคำสั่งในคู่มือนี้ใช้ **path เต็ม** ของ MariaDB — ถ้าเครื่องมี MySQL ด้วย คำว่า `mysql` เฉย ๆ อาจไปเรียกตัวของ MySQL
> PowerShell ต้องมี `&` นำหน้า path · cmd ไม่ต้องมี `&` แต่ต้องครอบ path ด้วย `" "`

### 3) โหลดโค้ด

```powershell
cd E:\
git clone https://github.com/Mayochiki03/TSH_Thai_Massage_Booking.git
cd TSH_Thai_Massage_Booking
```

### 4) สร้างฐานข้อมูล (ข้อมูลตัวอย่าง dev)

```powershell
cd E:\TSH_Thai_Massage_Booking\database
& "C:\Program Files\MariaDB 10.11\bin\mariadb.exe" -u root -p -P 3307 -e "source setup_dev.sql"
```
บรรทัดสุดท้ายต้องขึ้น `dev sample loaded`

### 5) ตั้งค่า backend

```powershell
cd E:\TSH_Thai_Massage_Booking\backend
npm install
Copy-Item .env.example .env
notepad .env
```
แก้ใน `.env`:
```ini
DB_PORT=3307                 # ตรงกับพอร์ตที่ตั้งตอนติดตั้ง MariaDB
JWT_SECRET=<ผลจาก npm run gen-key>
APP_SECRET_KEY=<ผลจาก npm run gen-key อีกครั้ง — ใช้คนละค่ากับ JWT_SECRET>
```
สร้างค่าลับ: `npm run gen-key` (รัน 2 ครั้ง ได้ 2 ค่า)

### 6) Frontend + เปิดระบบ

```powershell
cd E:\TSH_Thai_Massage_Booking\frontend
npm install
npm run build
cd ..\backend
npm start
```
เปิด http://localhost:4001/admin → ล็อกอิน `dev` / `admin1234` → ผูกแอป Authenticator

ระหว่างเขียนโค้ด: `npm run dev` ใน backend + `npm run dev` ใน frontend (เปิด http://localhost:5173)

---

## ข. ย้ายข้อมูลจาก MySQL → MariaDB (เครื่อง dev เดิม)

ทำครั้งเดียว ตอนเปลี่ยนจาก MySQL มา MariaDB บนเครื่องเดิม — **MySQL ยังเปิดอยู่ได้ตลอด** (คนละพอร์ต) ถ้ามีปัญหากลับไปใช้ได้ทันที

> ข้อมูลในเครื่อง dev เป็นข้อมูลทดสอบ ถ้าไม่ต้องการเก็บ ข้ามไปทำ **ก.4** (setup_dev) แทนได้เลย
> ที่ควรย้ายเพราะ: ค่าที่ตั้งไว้ในหน้า "การเชื่อมต่อระบบ" (LIFF ID, Channel ID, token LINE), 2FA ที่ผูกไว้, ข้อความแจ้งเตือนที่แก้

### 1) ติดตั้ง MariaDB พอร์ต 3307 — ตาม ก.2

### 2) ปิด backend แล้ว export ข้อมูลจาก MySQL

```powershell
cd E:\TSH_Thai_Massage_Booking
mkdir backups -Force

# ข้อมูลอย่างเดียว (ไว้ใส่ MariaDB)
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe" -u root -p --set-gtid-purged=OFF --no-create-info --skip-triggers --complete-insert --default-character-set=utf8mb4 --result-file=backups\data_for_mariadb.sql thai_massage_booking

# สำรองทั้งหมดอีกชุด (เผื่อต้องกลับไป MySQL)
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe" -u root -p --set-gtid-purged=OFF --routines --default-character-set=utf8mb4 --result-file=backups\mysql_full_backup.sql thai_massage_booking
```
> ต้องใช้ `--result-file=` ห้ามใช้ `> ไฟล์` ใน PowerShell (จะได้ไฟล์ UTF-16 ภาษาไทยพัง)
> โฟลเดอร์ `backups/` อยู่ใน `.gitignore` แล้ว ไม่ขึ้น GitHub

### 3) สร้างโครงสร้างเปล่าใน MariaDB แล้ว import

```powershell
cd E:\TSH_Thai_Massage_Booking\database
& "C:\Program Files\MariaDB 10.11\bin\mariadb.exe" -u root -p -P 3307 -e "source setup_empty.sql"
& "C:\Program Files\MariaDB 10.11\bin\mariadb.exe" -u root -p -P 3307 --default-character-set=utf8mb4 thai_massage_booking -e "source ../backups/data_for_mariadb.sql"
```

ตรวจ:
```powershell
& "C:\Program Files\MariaDB 10.11\bin\mariadb.exe" -u root -p -P 3307 --default-character-set=utf8mb4 -e "SELECT COUNT(*) AS appointments FROM thai_massage_booking.appointments; SELECT setting_value FROM thai_massage_booking.settings WHERE setting_key='clinic_name';"
```
> ภาษาไทยใน cmd/PowerShell อาจแสดงเป็น `???` — เป็นแค่การแสดงผล (พิมพ์ `chcp 65001` ก่อนจะแสดงถูก)

### 4) ชี้ backend ไป MariaDB

แก้ `backend\.env` บรรทัดเดียว: `DB_PORT=3307` (**APP_SECRET_KEY ห้ามเปลี่ยน**) แล้ว `npm start`

ทดสอบ: ล็อกอิน (2FA เดิมต้องใช้ได้) · เปิดคิววันนี้ · ดูเลขบัตรประชาชนของผู้รับบริการ · ออกรายงาน Excel · จองผ่าน LINE 1 คิว

### 5) ปิด MySQL (หลังใช้ MariaDB ได้สักพักแล้ว)

Services (`services.msc`) → **MySQL80** → Stop → Startup type: **Manual**
ยังไม่ต้อง uninstall — เก็บไว้จนแน่ใจ แล้วค่อยถอนทีหลัง

---

## ค. เครื่องใช้งานจริง (Ubuntu Server)

ทดสอบกับ Ubuntu 22.04 / 24.04 · ตัวอย่างใช้ผู้ใช้ระบบชื่อ `massage` และโฟลเดอร์ `/opt/thai-massage-booking`

### 1) เวลาเครื่อง + โปรแกรม

```bash
sudo timedatectl set-timezone Asia/Bangkok
sudo timedatectl set-ntp true          # นาฬิกาต้องตรง — ใช้กับ 2FA และเวลาคิว
sudo apt update && sudo apt upgrade -y
sudo apt install -y mariadb-server git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v          # v22.x
mariadb --version
```

### 2) MariaDB

```bash
sudo mariadb-secure-installation
#   Switch to unix_socket authentication → Y (root เข้าได้ด้วย sudo เท่านั้น)
#   Remove anonymous users / Disallow root login remotely / Remove test database → Y ทั้งหมด
```
MariaDB บน Ubuntu ฟังแค่ `127.0.0.1:3306` อยู่แล้ว (ไม่ต้องเปิดพอร์ตฐานข้อมูลออกเครือข่าย)

### 3) โหลดโค้ด

```bash
sudo useradd -r -m -d /opt/thai-massage-booking -s /usr/sbin/nologin massage
sudo -u massage git clone https://github.com/Mayochiki03/TSH_Thai_Massage_Booking.git /opt/thai-massage-booking/app
```
repo เป็น Private → ใช้ **Deploy key** (GitHub → repo → Settings → Deploy keys, สิทธิ์อ่านอย่างเดียว) หรือ Fine-grained token ที่อ่านได้ repo เดียว

### 4) สร้างฐานข้อมูล (ไม่มีข้อมูลตัวอย่าง)

```bash
cd /opt/thai-massage-booking/app/database
sudo mariadb < setup_prod.sql
```
เปลี่ยนรหัส user ของแอปทันที (ตั้งรหัสยาว ๆ ใช้ค่าเดียวกันทั้ง 2 บรรทัด):
```bash
sudo mariadb -e "ALTER USER 'massage_app'@'localhost' IDENTIFIED BY 'รหัสใหม่'; ALTER USER 'massage_app'@'127.0.0.1' IDENTIFIED BY 'รหัสใหม่';"
```
บัญชี `admin` / `dev` ใน seed ถูกบังคับเปลี่ยนรหัสผ่าน + ผูก 2FA ตอนล็อกอินครั้งแรก

### 5) Backend + หน้าเว็บ

```bash
cd /opt/thai-massage-booking/app
sudo -u massage npm --prefix frontend ci
sudo -u massage npm --prefix frontend run build
sudo -u massage npm --prefix backend ci --omit=dev
sudo -u massage cp backend/.env.example backend/.env
sudo -u massage npm --prefix backend run gen-key     # รัน 2 ครั้ง
sudo -u massage nano backend/.env
sudo chmod 600 backend/.env
```
ค่าใน `.env` ที่ต้องแก้:
```ini
DB_PORT=3306
DB_PASSWORD=<รหัส massage_app ที่ตั้งในข้อ 4>
JWT_SECRET=<gen-key ค่าที่ 1>
APP_SECRET_KEY=<gen-key ค่าที่ 2>   # ถ้าย้ายข้อมูลมาจากเครื่องอื่น ใช้ค่าของเครื่องเดิม
MFA_REQUIRED_ROLES=DEV,ADMIN
NODE_ENV=production
ENABLE_CRON=true
```
> ถ้า production ใช้ค่าตัวอย่าง หรือ MFA_REQUIRED_ROLES ไม่มี ADMIN ระบบจะไม่ยอมเปิด (ตั้งใจไว้)

### 6) ให้ระบบเปิดเองตอนเครื่องบูต (systemd)

`sudo nano /etc/systemd/system/thai-massage.service`
```ini
[Unit]
Description=Thai Massage Booking
After=network-online.target mariadb.service
Wants=network-online.target

[Service]
User=massage
WorkingDirectory=/opt/thai-massage-booking/app/backend
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now thai-massage
sudo systemctl status thai-massage       # ต้องเป็น active (running)
journalctl -u thai-massage -f            # ดู log
```

### 7) ไฟร์วอลล์

```bash
sudo ufw allow OpenSSH
sudo ufw allow from 192.168.0.0/16 to any port 4001 proto tcp   # หน้าเจ้าหน้าที่ — เปลี่ยนเป็นวง LAN จริงของโรงพยาบาล
sudo ufw enable
```
พอร์ต 4000 (หน้าผู้จอง) **ไม่ต้องเปิด** — ฟังแค่ 127.0.0.1 และออกอินเทอร์เน็ตผ่าน Cloudflare Tunnel เท่านั้น

### 8) Cloudflare Tunnel แบบถาวร (ต้องมีโดเมนที่อยู่ใน Cloudflare)

```bash
# ติดตั้งตาม https://pkg.cloudflare.com (เลือก Ubuntu) แล้ว:
cloudflared tunnel login
cloudflared tunnel create thai-massage
cloudflared tunnel route dns thai-massage booking.<โดเมนโรงพยาบาล>
```
`/etc/cloudflared/config.yml`
```yaml
tunnel: thai-massage
credentials-file: /etc/cloudflared/<tunnel-id>.json
ingress:
  - hostname: booking.<โดเมนโรงพยาบาล>
    service: http://127.0.0.1:4000
  - service: http_status:404
```
```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```
จากนั้นตั้ง **LIFF Endpoint URL** (LINE Developers) และ **Public URL** (หน้า "การเชื่อมต่อระบบ") เป็น `https://booking.<โดเมน>` — ครั้งเดียวจบ ไม่เปลี่ยนอีก

### 9) สำรองข้อมูลอัตโนมัติ (ทุกคืน เก็บ 14 วัน)

```bash
sudo mkdir -p /var/backups/thai-massage && sudo chmod 700 /var/backups/thai-massage
sudo nano /etc/cron.d/thai-massage-backup
```
```cron
30 2 * * * root mariadb-dump --single-transaction --routines thai_massage_booking | gzip > /var/backups/thai-massage/db_$(date +\%F).sql.gz && find /var/backups/thai-massage -name 'db_*.sql.gz' -mtime +14 -delete
```
- คัดลอกไฟล์ backup ออกไปเก็บเครื่องอื่นด้วย (เช่น NAS) — backup ที่อยู่เครื่องเดียวกับระบบ เครื่องเสียก็หายพร้อมกัน
- เก็บ `backend/.env` (โดยเฉพาะ APP_SECRET_KEY) แยกไว้ที่ปลอดภัย — ไม่มีค่านี้ backup ใช้กู้เลขบัตร/token ไม่ได้
- ทดลองกู้ backup จริงอย่างน้อยครั้งหนึ่งก่อนเปิดใช้

### 10) อัปเดตเวอร์ชันภายหลัง

```bash
sudo mariadb-dump --single-transaction --routines thai_massage_booking > ~/before_update.sql
cd /opt/thai-massage-booking/app && sudo -u massage git pull
# ถ้า CHANGELOG ของเวอร์ชันนั้นมี migration: cd database && sudo mariadb < migrations/00X_....sql
sudo -u massage npm --prefix backend ci --omit=dev
sudo -u massage npm --prefix frontend ci && sudo -u massage npm --prefix frontend run build
sudo systemctl restart thai-massage
```

---

## ง. ย้ายจาก Windows ไป Ubuntu ต้องแก้อะไร

**โค้ด: ไม่ต้องแก้อะไรเลย** — ต่างกันแค่การตั้งค่า

| เรื่อง | Windows dev | Ubuntu server |
|---|---|---|
| พอร์ต MariaDB (`DB_PORT`) | 3307 | 3306 (ค่าเริ่มต้น) |
| รหัส `massage_app` (`DB_PASSWORD`) | ค่า dev | ตั้งใหม่ (ค. ข้อ 4) |
| root ของ MariaDB | รหัสผ่าน | `sudo mariadb` (unix_socket ไม่มีรหัส) |
| `NODE_ENV` | development | production |
| `JWT_SECRET` / `APP_SECRET_KEY` | ค่า dev | สร้างใหม่ (หรือใช้ค่าเดิมถ้าย้ายข้อมูล) |
| สคริปต์ฐานข้อมูล | `setup_dev.sql` (มีข้อมูลตัวอย่าง) | `setup_prod.sql` (ไม่มี) |
| เปิดระบบ | `npm start` เอง | systemd เปิดให้อัตโนมัติ |
| Tunnel | Quick Tunnel (URL เปลี่ยนทุกครั้ง) | Named Tunnel + โดเมน (ถาวร) |
| path ในคำสั่ง | `C:\Program Files\MariaDB 10.11\bin\mariadb.exe` | `mariadb` |

**แนะนำ: production เริ่มฐานข้อมูลใหม่** (setup_prod) ไม่ย้ายข้อมูลทดสอบจากเครื่อง dev ไป
แล้วตั้งค่า LINE / รอบเวลา / ประเภทบริการ / บัญชีเจ้าหน้าที่ ใหม่ผ่านหน้าแอดมิน

---

## จ. รัน test อัตโนมัติ + สแกน SonarQube

test เป็นแบบ integration: เปิด backend จริง (พอร์ต 4100/4101) แล้วยิง API กับ**ฐานข้อมูลทดสอบแยก** `thai_massage_booking_test`
ทุกชุดล้างฐานข้อมูลทดสอบแล้วสร้างใหม่จาก `database/01–04` — **ไม่แตะฐานข้อมูลที่ใช้งาน** (ชื่อไม่ลงท้าย `_test` ระบบไม่ยอมรัน)
เปิดระบบจริง (4000/4001) ทิ้งไว้ระหว่างรัน test ได้

### ตั้งค่าครั้งแรก (ครั้งเดียวต่อเครื่อง)

```powershell
# 1) user ทดสอบ (มีสิทธิ์เฉพาะฐานข้อมูล _test)
cd E:\TSH_Thai_Massage_Booking\database
& "C:\Program Files\MariaDB 10.11\bin\mariadb.exe" -u root -p -P 3307 -e "source setup_test_user.sql"

# 2) ไฟล์ตั้งค่า test
cd ..\backend
Copy-Item .env.test.example .env.test
npm install
```
`.env.test` ตั้งพอร์ต 3307 ไว้แล้ว — เครื่องที่ใช้ MariaDB พอร์ต 3306 (เช่น Ubuntu / Jenkins) แก้ `TEST_DB_PORT=3306`

### รัน

```powershell
cd E:\TSH_Thai_Massage_Booking\backend
npm test                    # รันทุกชุด (~30 วินาที — ชุด 2FA ต้องรอรหัสเปลี่ยนรอบ 30 วินาที)
npm run test:coverage       # รัน + วัด coverage → backend\coverage\lcov.info
node test/run.mjs booking   # รันเฉพาะชุด (booking / features / price / mfa)
```
ผลที่ควรได้: `รวม: 174 ผ่าน, 0 ไม่ผ่าน` (ถ้ารันหลัง 15:30 จะมี `1 ข้าม` — test walk-in ใช้รอบ 14:30 ของวันนี้ในข้อมูลตัวอย่าง)
ถ้ามีข้อไม่ผ่าน log ของ backend อยู่ที่ `backend\test\.logs\`

### สแกน SonarQube (ต้องรัน test:coverage ก่อนทุกครั้ง)

```powershell
cd E:\TSH_Thai_Massage_Booking\backend
npm run test:coverage
cd ..
npx sonarqube-scanner "-Dsonar.host.url=http://192.168.56.128:9000" "-Dsonar.login=TOKEN"
```
- coverage วัดเฉพาะ **backend** (`frontend/**` ไม่นับ coverage — หน้าจอทดสอบด้วยเบราว์เซอร์ · Bug/ช่องโหว่ของ frontend ยังสแกนตามปกติ) ตั้งไว้ใน `sonar-project.properties`
- ไม่รัน test:coverage ก่อนสแกน = coverage เป็น 0% → Quality Gate ไม่ผ่าน

