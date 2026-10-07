# Database — ระบบจองคิวนวดแผนไทย

MySQL 8.0+ · utf8mb4 · ทดสอบกับ MySQL 8.0.46 แล้ว

## ไฟล์

| ไฟล์ | ทำอะไร | ใช้กับ |
|---|---|---|
| `00_create_database.sql` | สร้าง DB `thai_massage_booking` + user แอป `massage_app` | dev / prod |
| `01_schema.sql` | 15 ตาราง + 2 view | dev / prod |
| `02_procedures.sql` | `sp_generate_slots(days)` สร้าง slot ล่วงหน้า | dev / prod |
| `03_seed.sql` | ค่าตั้งต้น: แอดมิน, หมอนวด, รอบเวลา, วันหยุด, settings, ข้อความแจ้งเตือน + สร้าง slot 14 วัน | dev / prod |
| `04_dev_sample.sql` | ข้อมูลตัวอย่าง: ผู้รับบริการ 5 คน, LINE จำลอง 3 บัญชี, คิวครบทุกสถานะ | **dev เท่านั้น** |
| `setup_dev.sql` | ล้าง DB แล้วรัน 00 → 04 ทั้งหมด | **dev เท่านั้น** |

## ติดตั้ง (Windows)

เปิด PowerShell หรือ CMD ที่โฟลเดอร์ `database` แล้วรัน:

```powershell
mysql -u root -p -e "source setup_dev.sql"
```

> ถ้าขึ้น `mysql is not recognized` ให้ใช้ path เต็ม:
> `& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p -e "source setup_dev.sql"`
>
> PowerShell ใช้ `mysql ... < file.sql` ไม่ได้ ให้ใช้รูปแบบ `-e "source ..."` ตามด้านบน

ใช้ MySQL Workbench แทนก็ได้: เปิดไฟล์ 00 → 01 → 02 → 03 → 04 แล้วกด Execute ทีละไฟล์ตามลำดับ

**ผลที่ควรได้:** บรรทัดสุดท้ายขึ้น `dev sample loaded` พร้อมวันที่ตัวอย่าง

## บัญชีทดสอบ

| username | password | role |
|---|---|---|
| `admin` | `admin1234` | ADMIN |
| `counter1` | `admin1234` | STAFF (dev) |
| `therapist1` | `admin1234` | PRACTITIONER (dev) |

DB user ของแอป: `massage_app` / `ChangeMe_Dev_2026!` (มีสิทธิ์แค่ SELECT/INSERT/UPDATE/DELETE/EXECUTE ลบตารางไม่ได้)

> ⚠ ก่อนขึ้น production: เปลี่ยนรหัส `massage_app` ใน `00_create_database.sql` และไม่รัน `04_dev_sample.sql` บน production (ผู้ใช้ `admin` ใน `03_seed.sql` จะถูกบังคับเปลี่ยนรหัสผ่านตอนล็อกอินครั้งแรก)

## จุดสำคัญของ schema

**กันจองซ้อน (`active_slot_id`)**
`appointments.active_slot_id` เป็น generated column ที่เท่ากับ `slot_id` เมื่อคิวยัง active และเป็น `NULL` เมื่อ `CANCELLED` / `NO_SHOW` แล้วตั้ง UNIQUE ไว้ ผลคือ
- slot หนึ่งมีคิวที่ active ได้แค่ 1 คิว ถ้า INSERT ชนจะได้ error `1062` → backend ตอบ "รอบนี้เพิ่งถูกจอง"
- คิวที่ยกเลิกหรือ no-show จะปล่อย slot ให้จองใหม่หรือให้ walk-in ได้ทันที

**HN เป็น NULL ได้**
`patient_type = 'GENERAL'` ต้องไม่มี HN และ `'HN'` ต้องมี HN (มี CHECK constraint) บุคคลทั่วไปหลายคนมี HN เป็น NULL ได้โดยไม่ชน UNIQUE

**ผู้จอง ≠ ผู้รับบริการ**
- `line_users` = บัญชี LINE ของผู้จอง (`self_patient_id` = ข้อมูลตัวเอง)
- `booker_patients` = รายชื่อคนที่เคยจองให้ พร้อมความสัมพันธ์
- `appointments.patient_id` = ผู้รับบริการ, `booked_by_line_user_id` = ผู้จอง

**เวลา**
คอลัมน์ `TIMESTAMP` แปลงตาม session — backend ต้องตั้ง `time_zone = '+07:00'` ทุก connection

## View

- `v_slot_availability` — slot ทุกอันพร้อมสถานะ `AVAILABLE` / `TAKEN` / `BLOCKED` / `HOLIDAY`
- `v_appointment_details` — คิวพร้อมข้อมูลผู้รับบริการ ผู้จอง และเวลาบริการจริง

```sql
-- ตัวอย่าง: คิววันนี้
SELECT start_time, availability, status
FROM v_slot_availability
WHERE slot_date = CURDATE()
ORDER BY start_time;
```

## สร้าง slot เพิ่ม

```sql
CALL sp_generate_slots(14);   -- รันซ้ำได้ ไม่สร้างซ้ำ (ข้ามเสาร์-อาทิตย์และวันหยุด)
```
backend จะเรียกอัตโนมัติวันละครั้ง (cron)

## ผลทดสอบ

| ทดสอบ | ผล |
|---|---|
| จอง slot ที่มีคนจองแล้ว | ✅ ถูกปฏิเสธ (1062) |
| จอง slot ที่ถูกยกเลิก (walk-in) | ✅ จองได้ |
| ยิงจอง slot เดียวกันพร้อมกัน 5 request | ✅ สำเร็จ 1 ที่เหลือถูกปฏิเสธ |
| เปลี่ยนคิวที่ยกเลิกกลับเป็น BOOKED ทั้งที่ slot มีคนจองใหม่แล้ว | ✅ ถูกปฏิเสธ |
| `patient_type = 'HN'` แต่ไม่มี HN | ✅ ถูกปฏิเสธ (CHECK) |
| บุคคลทั่วไปหลายคน HN = NULL | ✅ ได้ |
| `sp_generate_slots` รันซ้ำ | ✅ ไม่สร้างซ้ำ, ข้ามวันหยุด 13 ต.ค. ถูกต้อง |
| user `massage_app` ลบตาราง | ✅ ถูกปฏิเสธ |
| ภาษาไทยเมื่อรันผ่าน CLI โดยไม่ระบุ charset | ✅ ถูกต้อง (มี `SET NAMES utf8mb4`) |
