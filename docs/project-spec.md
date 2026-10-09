# ระบบจองคิวนวดแผนไทย (โรงพยาบาล, หมอนวด 1 คน)

> สเปกงาน **v3 (ฉบับสรุปก่อนเริ่มพัฒนา)** — อัปเดต 7 ต.ค. 2569
> Dev: ทำคนเดียว · Tester: หัวหน้า / เจ้าหน้าที่ · กำหนด: ภายใน 3 วันต้องมีเวอร์ชันที่ใช้งานได้ระดับหนึ่ง

### สิ่งที่เปลี่ยนใน v3
- **ออกอินเทอร์เน็ตผ่าน Cloudflare Tunnel ได้แล้ว** หัวหน้าอนุญาต โดยมีเงื่อนไขว่า public IP ของ รพ. ต้องไม่หลุดและต้องปลอดภัยที่สุด (ดูหมวด 5)
- เพิ่มเมนู **"การเชื่อมต่อระบบ"** สลับได้ 3 โหมด คือ Local (จำลอง LINE), Dev Tunnel และ Production
- ช่วง dev ใช้ **LINE OA ของตัวเอง** ส่วนตอนขึ้นจริง **หัวหน้าเป็นแอดมิน LINE Developers ของ OA รพ.** และจะเป็นคนสร้าง channel ให้
- แยกส่วนสาธารณะ (หน้าจอง) ออกจากส่วนภายใน (แอดมิน เจ้าหน้าที่ หมอนวด) ซึ่งใช้ได้เฉพาะใน LAN
- เครื่อง dev เป็น Windows และไม่ใช้ Docker

### สิ่งที่เปลี่ยนใน v2
- HN **เป็นค่าว่างได้** เพราะต้องรองรับบุคคลทั่วไปที่ไม่มี HN
- แยก **ผู้จอง** กับ **ผู้รับบริการ** ออกจากกัน (เช่นลูกจองให้แม่) โดยมีปุ่ม "จองให้ตัวเอง" ที่เติมข้อมูลให้อัตโนมัติ
- จองล่วงหน้าได้ **สูงสุด 2 วัน** (ปรับได้ในหน้าตั้งค่า)
- ยกเลิกเองได้ถึง **2 ชม.** ก่อนเวลานัด
- **ไม่เปิดเสาร์อาทิตย์** ส่วนวันหยุดราชการให้แอดมินตั้งเอง และถ้าวันนั้นมีคนจองไว้แล้ว ระบบจะเตือนแอดมินและแจ้งผู้รับบริการให้จองใหม่
- **No-show เป็นปัญหาหลัก** (คนไม่ค่อยยกเลิก แต่ไม่มาเลย) เลยเพิ่มเมนูแอดมินสำหรับตั้งกฎระงับสิทธิ์
- **CRUD เกือบทุกเมนู** ทั้งรอบเวลา กฎ ข้อความแจ้งเตือน และวันหยุด แก้ได้จากหน้า UI ทั้งหมด
- แจ้งเตือนทาง **LINE อย่างเดียว** ด้วย OA แพ็กเกจฟรี ไม่ใช้ SMS
- Server: **local** (ดูข้อจำกัดเรื่อง LINE ในหมวด 5)
- เช็กอินด้วย **รหัสจอง 6 หลักแบบ e-ticket** ไม่ใช้ QR

---

## 1. ภาพรวม

**เป้าหมาย:** ลดความแออัดหน้าเคาน์เตอร์ กันคิวซ้อน ลด no-show และช่วยให้หมอนวดคนเดียวทำงานได้ลื่นขึ้น

**วิธีเข้าใช้:** กดลิงก์จาก LINE OA ของโรงพยาบาล แล้วเว็บจะเปิดขึ้นใน LINE (ทำด้วย LIFF) ระบบจำผู้จองจาก LINE ได้ ทำให้จองได้เร็ว

**Stack:**
- Frontend: React (Vite) + Tailwind CSS + LIFF SDK
- Backend: Node.js / Express (REST API + cron)
- DB: MariaDB 10.11 (เดิม MySQL 8 — เปลี่ยนใน v0.8.0 ตามมาตรฐานโรงพยาบาล)
- Deploy: server local ของ รพ. ออกอินเทอร์เน็ตผ่าน Cloudflare Tunnel (เฉพาะหน้าจอง)

| ผู้ใช้ | ทำอะไรได้ |
|---|---|
| ผู้จอง / ผู้รับบริการ | จองให้ตัวเองหรือคนอื่น ดู e-ticket ยกเลิกคิว รับแจ้งเตือน |
| เจ้าหน้าที่เคาน์เตอร์ | ดูคิววันนี้ เช็กอินด้วยรหัสจอง รับ walk-in จองแทนทางโทรศัพท์ |
| หมอนวด | ดูคิว กด Start/Complete บันทึกผลการให้บริการ |
| แอดมิน | ตั้งค่าทุกอย่าง (CRUD) วันหยุด กฎ ระงับสิทธิ์ ข้อความแจ้งเตือน และรายงาน |

---

## 2. ฟังก์ชันระบบ

### Module 1 – ฝั่งผู้จอง (เปิดผ่าน LINE)

**ผู้จองกับผู้รับบริการ**
- ครั้งแรกที่เปิดเว็บ ผู้จองยอมรับ PDPA แล้วกรอกข้อมูลตัวเอง (ชื่อ-สกุล, เบอร์ และ HN ถ้ามี) ระบบผูกข้อมูลกับ LINE userId
- ทุกครั้งที่จอง ให้เลือกว่าจองให้ใคร
  - **"จองให้ตัวเอง"** ระบบเติมข้อมูลให้อัตโนมัติ
  - **"จองให้ผู้อื่น"** กรอกชื่อ-สกุล เบอร์ และ HN (ถ้ามี) ของผู้รับบริการ พร้อมระบุความสัมพันธ์ เช่น แม่ หรือพ่อ ระบบจำรายชื่อนี้ไว้ ครั้งหน้ากดเลือกได้เลย
- ทุกคิวบันทึกว่า **ใครจอง** และ **จองให้ใคร**

**การจอง**
- เลือกวันได้ไม่เกิน 2 วันล่วงหน้า และเลือก slot ว่างแบบเรียลไทม์ (ค่าเริ่มต้น 6 รอบต่อวัน ซึ่งแก้ได้)
- กรอกอาการเบื้องต้น
- โควตานับ **ต่อผู้รับบริการ** คือวันละไม่เกิน 1 คิว และสัปดาห์ละไม่เกิน 2 คิว
- ถ้าผู้รับบริการถูกระงับสิทธิ์อยู่ ระบบจะจองให้ไม่ได้และแจ้งว่าระงับถึงวันไหน

**e-ticket**
- หน้าตั๋วแสดงรหัสจอง 6 หลักตัวใหญ่ ชื่อผู้รับบริการ วันเวลา และสถานะ
- หน้า "การจองของฉัน" รวมคิวทั้งหมดที่ผู้จองจองไว้ ทั้งของตัวเองและที่จองให้คนอื่น
- ยกเลิกเองได้ถึง 2 ชม. ก่อนเวลานัด หลังจากนั้นปุ่มยกเลิกจะซ่อน และขึ้นเบอร์โทรเคาน์เตอร์แทน

### Module 2 – การแจ้งเตือน (LINE)

| ชนิด | เมื่อไร | ค่าเริ่มต้น |
|---|---|---|
| ยืนยันการจอง | ทันทีที่จองสำเร็จ | เปิด (ใช้วิธีประหยัดโควตา ดูหมวด 5) |
| เตือนล่วงหน้า 1 วัน | เย็นวันก่อนนัด เฉพาะคิวที่จองไว้เกิน 24 ชม. | **ปิด** (จองล่วงหน้าแค่ 2 วัน เลยแทบไม่จำเป็น) |
| เตือนก่อนนัด 2 ชม. | พร้อมปุ่ม "ยืนยันมาแน่นอน" และ "ยกเลิก" | เปิด (ตัวหลักที่ช่วยลด no-show) |
| ยกเลิกเพราะวันหยุดหรือหมอลา | เมื่อแอดมินตั้งวันหยุด หรือบล็อกวันหรือรอบที่มีคนจองแล้ว | เปิด |
| แจ้งระงับสิทธิ์ | เมื่อ no-show ครบตามกฎ | เปิด |

- ข้อความทุกชนิด **แก้ไขได้ในหน้าแอดมิน** (มี template พร้อมตัวแปรอย่าง `{name}`, `{date}`, `{time}`, `{code}`) และเปิดหรือปิดแยกทีละชนิดได้
- ระบบส่งข้อความไปที่ LINE ของ **ผู้จอง** ส่วนคิวที่เจ้าหน้าที่จองแทนหรือ walk-in ที่ไม่มี LINE จะไม่มีการแจ้งเตือน

### Module 3 – เจ้าหน้าที่เคาน์เตอร์
- **หน้าคิววันนี้:** การ์ด 6 รอบ แต่ละใบแสดงสถานะเป็นสี (ว่าง / จองแล้ว / ยืนยันแล้ว / เช็กอิน / กำลังบริการ / เสร็จ / no-show / ยกเลิก) และอัปเดตเองอัตโนมัติ
- **เช็กอิน:** พิมพ์รหัสจอง หรือค้นจากชื่อ เบอร์ หรือ HN หรือกดจากการ์ดได้เลย ระบบแสดงข้อมูลให้เทียบกับตัวผู้รับบริการแล้วกด "เช็กอิน" ถ้ามาเร็วหรือสายเกินกำหนดจะขึ้นคำเตือน แต่เจ้าหน้าที่เลือกรับได้
- **Walk-in / จองแทน:** เลือก slot ที่ว่าง no-show หรือถูกยกเลิก แล้วค้นหาหรือสร้างข้อมูลผู้รับบริการ
- **คิวที่ยังไม่ยืนยัน:** ไฮไลต์คิวที่ยังไม่กดยืนยันหลังเตือน 2 ชม. ให้เจ้าหน้าที่โทรเช็กได้

### Module 4 – หมอนวด
- รายการคิววันนี้ เรียงตามเวลา
- กด **Start** และ **Complete** เพื่อบันทึกเวลาจริง
- ฟอร์มบันทึกผล ได้แก่ จุดที่นวด อาการหลังนวด และคำแนะนำ (แก้ไขย้อนหลังได้)

### Module 5 – แอดมิน (CRUD เกือบทุกอย่าง)

| เมนู | ทำอะไรได้ |
|---|---|
| ผู้รับบริการ | ค้นหา เพิ่ม แก้ไข ลบ (soft delete) รวมรายการซ้ำ ดูประวัติการจองและ no-show |
| ผู้จอง (บัญชี LINE) | ดูว่าใครจองให้ใครบ้าง ยกเลิกการผูกบัญชี |
| หมอนวด | CRUD และเปิด/ปิดการปฏิบัติงาน |
| ผู้ใช้ระบบ | CRUD บัญชีเจ้าหน้าที่ หมอนวด และแอดมิน รีเซ็ตรหัสผ่าน |
| รอบเวลา (แม่แบบ) | CRUD เวลาเริ่มและเวลาสิ้นสุดของแต่ละรอบ (แก้ไว้รองรับกรณีพิมพ์เวลาผิด) |
| ตาราง slot | ดูรายวัน บล็อกหรือปลดบล็อกรายรอบหรือทั้งวัน สร้าง slot ใหม่ตามแม่แบบ |
| วันหยุด | CRUD วันหยุด ถ้าวันนั้นมีคนจองแล้ว ระบบเตือนและให้ยืนยันก่อนยกเลิกพร้อมแจ้ง (ดูหมวด 3) |
| การจอง | ดู ค้นหา แก้ไข ยกเลิก เปลี่ยนสถานะด้วยมือ |
| บันทึกการให้บริการ | ดู แก้ไข export |
| กฎการจอง | โควตา จำนวนวันที่จองล่วงหน้าได้ เวลาปิดรับจอง เวลายกเลิก ช่วงเช็กอิน เวลาตัด no-show |
| กฎระงับสิทธิ์ | เปิด/ปิดอัตโนมัติ, no-show กี่ครั้งภายในกี่วัน และระงับกี่วัน |
| รายชื่อผู้ถูกระงับ | ดู เพิ่มเอง ปลดระงับก่อนกำหนด |
| ข้อความแจ้งเตือน | แก้ template และเปิด/ปิดทีละชนิด |
| Log การแจ้งเตือน | ส่งสำเร็จหรือไม่ และ **โควตา LINE ที่ใช้ไปเดือนนี้** |
| การเชื่อมต่อระบบ | สลับโหมด Local / Dev Tunnel / Production, ตั้งค่า LINE, ปุ่มทดสอบ, ล้างข้อมูลทดสอบ (ดูหมวด 5) |
| รายงาน (เฟส 2) | ยอดจองต่อเดือน อัตรา no-show และเวลาบริการเฉลี่ย |

---

## 3. Flow สำคัญ

### 3.1 สถานะคิว
```
BOOKED ──(เจ้าหน้าที่เช็กอิน)──▶ CHECKED_IN ──(Start)──▶ IN_SERVICE ──(Complete)──▶ COMPLETED
  │
  ├──(เลยเวลานัด X นาที, cron)──▶ NO_SHOW    → slot ว่างให้ walk-in, นับเข้ากฎระงับสิทธิ์
  └──(ผู้จอง / เจ้าหน้าที่ / ระบบ ยกเลิก)──▶ CANCELLED → slot ว่าง
```
- `confirmed_at` คือเวลาที่กดยืนยันตอนเตือน 2 ชม. ใช้แค่ไฮไลต์ในแดชบอร์ด ไม่เปลี่ยนสถานะ

### 3.2 แอดมินเพิ่มวันหยุด หรือปิดทั้งวันเพราะหมอลา
1. แอดมินเลือกวันที่และใส่ชื่อวันหยุด
2. ระบบตรวจว่าวันนั้นมีคิว BOOKED อยู่ไหม
   - **ไม่มี:** บันทึก แล้วบล็อก slot ของวันนั้นทั้งหมด
   - **มี:** ขึ้นหน้าต่างเตือนว่า "มี 3 คิวในวันนี้" พร้อมรายชื่อ แล้วถามว่าจะยกเลิกและแจ้งผู้รับบริการไหม
3. ถ้ายืนยัน ระบบยกเลิกคิวทั้งหมด (`cancelled_by = SYSTEM`, เหตุผล "ตรงกับวันหยุด") และส่ง LINE ถึงผู้จองพร้อมปุ่ม **"จองใหม่"**
4. คิวที่ไม่มี LINE (จองแทนหรือ walk-in) จะขึ้นเป็นรายการ "ต้องโทรแจ้ง" ให้เจ้าหน้าที่

การบล็อกรอบเดียวที่มีคนจองแล้วใช้ flow เดียวกันนี้

### 3.3 ระงับสิทธิ์ (no-show)
- ทุกครั้งที่ cron เปลี่ยนคิวเป็น NO_SHOW ระบบนับ no-show ของผู้รับบริการคนนั้นในช่วง N วันย้อนหลัง
- ถ้าครบตามกฎ (ค่าเริ่มต้น 2 ครั้งใน 30 วัน) ระบบสร้างรายการระงับสิทธิ์ 30 วันและแจ้งผู้จอง
- ค่าเริ่มต้นของการระงับอัตโนมัติคือ **ปิด** ไว้ก่อน จนกว่าหัวหน้าจะตัดสินใจ ระหว่างนี้แอดมินดูสถิติแล้วระงับเองได้

### 3.4 จอง (transaction กันจองซ้อน)
```
BEGIN;
  ล็อกผู้รับบริการ (SELECT ... FOR UPDATE)
  ตรวจ: slot ไม่ถูกบล็อก, ไม่ใช่วันหยุดหรือเสาร์อาทิตย์, อยู่ในช่วงที่จองล่วงหน้าได้, ยังไม่เลยเวลาปิดรับ
  ตรวจ: ไม่ได้ถูกระงับสิทธิ์, โควตาต่อวันและต่อสัปดาห์ยังไม่เต็ม
  INSERT appointments   → ถ้าชน uq_active_slot แปลว่ามีคนจองไปก่อน ให้ตอบ "รอบนี้เพิ่งถูกจอง กรุณาเลือกรอบอื่น"
COMMIT;
```

---

## 4. Database Schema (v2, MySQL 8)

**เปลี่ยนจากเอกสารต้นฉบับ**
- `patients.hn` เป็น NULL ได้ (UNIQUE ยังใช้ได้ เพราะ MySQL ยอมให้มี NULL ซ้ำกันได้) และเพิ่ม `patient_type`
- ตัด `patients.line_id` ออก แล้วเพิ่มตาราง `line_users` (ผู้จอง) กับ `booker_patients` (รายชื่อคนที่ผู้จองเคยจองให้)
- เปลี่ยน `appointments.slot_id UNIQUE` เป็น generated column `active_slot_id` เพื่อให้เอา slot ที่ถูกยกเลิกหรือ no-show ไปจองใหม่ได้
- เพิ่มตาราง: `staff_users`, `slot_templates`, `holidays`, `settings`, `patient_suspensions`, `notification_templates`, `notification_logs`

```sql
-- ผู้รับบริการ (มี HN หรือเป็นบุคคลทั่วไป)
CREATE TABLE patients (
  patient_id      BIGINT AUTO_INCREMENT PRIMARY KEY,
  patient_type    ENUM('HN','GENERAL') NOT NULL DEFAULT 'GENERAL',
  hn              VARCHAR(20) NULL UNIQUE,
  first_name      VARCHAR(100) NOT NULL,
  last_name       VARCHAR(100) NOT NULL,
  phone_number    VARCHAR(15)  NOT NULL,
  note            VARCHAR(255) NULL,
  is_deleted      BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_phone (phone_number),
  INDEX idx_name (first_name, last_name)
);

-- ผู้จอง (บัญชี LINE)
CREATE TABLE line_users (
  line_user_id     VARCHAR(50) PRIMARY KEY,
  display_name     VARCHAR(200),
  picture_url      VARCHAR(500),
  self_patient_id  BIGINT NULL,               -- ข้อมูลของตัวผู้จองเอง (ใช้กับปุ่ม "จองให้ตัวเอง")
  pdpa_consent_at  TIMESTAMP NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_seen_at     TIMESTAMP NULL,
  FOREIGN KEY (self_patient_id) REFERENCES patients(patient_id)
);

-- รายชื่อคนที่ผู้จองเคยจองให้ ครั้งหน้ากดเลือกได้เลย
CREATE TABLE booker_patients (
  line_user_id  VARCHAR(50) NOT NULL,
  patient_id    BIGINT NOT NULL,
  relation      VARCHAR(50) NOT NULL DEFAULT 'ตนเอง',   -- ตนเอง / มารดา / บิดา / ...
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (line_user_id, patient_id),
  FOREIGN KEY (line_user_id) REFERENCES line_users(line_user_id),
  FOREIGN KEY (patient_id)   REFERENCES patients(patient_id)
);

CREATE TABLE practitioners (
  practitioner_id INT AUTO_INCREMENT PRIMARY KEY,
  full_name       VARCHAR(200) NOT NULL,
  license_no      VARCHAR(50),
  is_active       BOOLEAN DEFAULT TRUE
);

CREATE TABLE staff_users (
  user_id         INT AUTO_INCREMENT PRIMARY KEY,
  username        VARCHAR(50)  NOT NULL UNIQUE,
  password_hash   VARCHAR(255) NOT NULL,
  full_name       VARCHAR(200) NOT NULL,
  role            ENUM('ADMIN','STAFF','PRACTITIONER') NOT NULL,
  practitioner_id INT NULL,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (practitioner_id) REFERENCES practitioners(practitioner_id)
);

-- แม่แบบรอบเวลา (CRUD ในหน้าแอดมิน)
CREATE TABLE slot_templates (
  template_id INT AUTO_INCREMENT PRIMARY KEY,
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL,
  sort_order  INT DEFAULT 0,
  is_active   BOOLEAN DEFAULT TRUE
);
INSERT INTO slot_templates (start_time, end_time, sort_order) VALUES
 ('09:00','10:00',1), ('10:15','11:15',2), ('11:15','12:15',3),
 ('13:15','14:15',4), ('14:30','15:30',5), ('15:30','16:30',6);   -- ค่าตั้งต้น แก้ได้

CREATE TABLE holidays (
  holiday_date DATE PRIMARY KEY,
  name         VARCHAR(200) NOT NULL,
  created_by   INT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES staff_users(user_id)
);

CREATE TABLE time_slots (
  slot_id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  practitioner_id INT  NOT NULL,
  slot_date       DATE NOT NULL,
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL,
  is_blocked      BOOLEAN DEFAULT FALSE,
  block_reason    VARCHAR(255),
  FOREIGN KEY (practitioner_id) REFERENCES practitioners(practitioner_id),
  UNIQUE KEY uq_slot (practitioner_id, slot_date, start_time),
  INDEX idx_slot_date (slot_date)
);

CREATE TABLE appointments (
  appointment_id   BIGINT AUTO_INCREMENT PRIMARY KEY,
  booking_code     CHAR(6) NOT NULL UNIQUE,
  patient_id       BIGINT  NOT NULL,              -- ผู้รับบริการ
  booked_by_line_user_id VARCHAR(50) NULL,        -- ผู้จอง (NULL = เจ้าหน้าที่จองแทน/walk-in)
  booked_by_staff  INT NULL,                      -- เจ้าหน้าที่ที่ทำรายการ (กรณีจองแทน)
  booker_relation  VARCHAR(50) NULL,              -- ความสัมพันธ์ผู้จอง → ผู้รับบริการ
  slot_id          BIGINT  NOT NULL,
  booking_channel  ENUM('ONLINE','WALK_IN','STAFF') DEFAULT 'ONLINE',
  chief_complaint  TEXT,
  status           ENUM('BOOKED','CHECKED_IN','IN_SERVICE','COMPLETED','NO_SHOW','CANCELLED')
                   DEFAULT 'BOOKED',
  active_slot_id   BIGINT GENERATED ALWAYS AS
                   (IF(status IN ('CANCELLED','NO_SHOW'), NULL, slot_id)) STORED,
  confirmed_at     TIMESTAMP NULL,
  checked_in_at    TIMESTAMP NULL,
  checked_in_by    INT NULL,
  cancelled_at     TIMESTAMP NULL,
  cancelled_by     ENUM('PATIENT','STAFF','SYSTEM') NULL,
  cancel_reason    VARCHAR(255) NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id)    REFERENCES patients(patient_id),
  FOREIGN KEY (booked_by_line_user_id) REFERENCES line_users(line_user_id),
  FOREIGN KEY (booked_by_staff) REFERENCES staff_users(user_id),
  FOREIGN KEY (slot_id)       REFERENCES time_slots(slot_id),
  FOREIGN KEY (checked_in_by) REFERENCES staff_users(user_id),
  UNIQUE KEY uq_active_slot (active_slot_id),
  INDEX idx_patient_status (patient_id, status),
  INDEX idx_booker (booked_by_line_user_id),
  INDEX idx_slot (slot_id)
);

CREATE TABLE service_records (
  record_id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  appointment_id      BIGINT NOT NULL UNIQUE,
  treatment_details   TEXT,
  post_treatment_note TEXT,
  service_start       TIMESTAMP NULL,
  service_end         TIMESTAMP NULL,
  recorded_by         INT NULL,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (appointment_id) REFERENCES appointments(appointment_id),
  FOREIGN KEY (recorded_by)    REFERENCES staff_users(user_id)
);

CREATE TABLE patient_suspensions (
  suspension_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  patient_id    BIGINT NOT NULL,
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  reason        VARCHAR(255) NOT NULL,
  source        ENUM('AUTO','MANUAL') NOT NULL,
  created_by    INT NULL,
  lifted_at     TIMESTAMP NULL,              -- ปลดก่อนกำหนด
  lifted_by     INT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(patient_id),
  FOREIGN KEY (created_by) REFERENCES staff_users(user_id),
  FOREIGN KEY (lifted_by)  REFERENCES staff_users(user_id),
  INDEX idx_patient_active (patient_id, end_date)
);

CREATE TABLE notification_templates (
  type        ENUM('BOOKED','REMIND_1D','REMIND_2H','CANCELLED','HOLIDAY_CANCELLED','SUSPENDED') PRIMARY KEY,
  title       VARCHAR(100) NOT NULL,
  body        TEXT NOT NULL,                 -- รองรับ {name} {date} {time} {code} {reason}
  is_enabled  BOOLEAN DEFAULT TRUE
);

CREATE TABLE notification_logs (
  log_id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  appointment_id BIGINT NULL,
  line_user_id   VARCHAR(50) NOT NULL,
  type           VARCHAR(30) NOT NULL,
  status         ENUM('SENT','FAILED') NOT NULL,
  error_message  VARCHAR(500) NULL,
  sent_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (appointment_id) REFERENCES appointments(appointment_id),
  UNIQUE KEY uq_once (appointment_id, type)          -- กันส่งซ้ำ
);

CREATE TABLE settings (
  setting_key   VARCHAR(50) PRIMARY KEY,
  setting_value VARCHAR(255) NOT NULL,
  label         VARCHAR(255) NOT NULL,
  value_type    ENUM('INT','BOOL','STRING') DEFAULT 'INT'
);
INSERT INTO settings VALUES
 ('max_per_day',            '1',          'จองได้สูงสุดต่อผู้รับบริการต่อวัน', 'INT'),
 ('max_per_week',           '2',          'จองได้สูงสุดต่อผู้รับบริการต่อสัปดาห์ (จ.-อา.)', 'INT'),
 ('advance_booking_days',   '2',          'จองล่วงหน้าได้สูงสุด (วัน)', 'INT'),
 ('allow_same_day',         '1',          'อนุญาตจองวันเดียวกัน', 'BOOL'),
 ('booking_cutoff_min',     '60',         'ปิดรับจองก่อนเวลานัด (นาที)', 'INT'),
 ('patient_cancel_min',     '120',        'ผู้จองยกเลิกเองได้ถึงก่อนนัด (นาที)', 'INT'),
 ('checkin_early_min',      '30',         'เช็กอินได้เร็วสุดก่อนนัด (นาที)', 'INT'),
 ('no_show_after_min',      '10',         'ตัด no-show เมื่อสายเกิน (นาที)', 'INT'),
 ('open_weekdays',          '1,2,3,4,5',  'วันที่เปิดให้จอง (1=จ. ... 7=อา.)', 'STRING'),
 ('suspend_auto',           '0',          'ระงับสิทธิ์อัตโนมัติ', 'BOOL'),
 ('suspend_noshow_count',   '2',          'no-show กี่ครั้ง จึงระงับ', 'INT'),
 ('suspend_window_days',    '30',         'นับ no-show ย้อนหลังกี่วัน', 'INT'),
 ('suspend_days',           '30',         'ระงับสิทธิ์กี่วัน', 'INT'),
 ('counter_phone',          '',           'เบอร์โทรเคาน์เตอร์ (แสดงในหน้าตั๋ว)', 'STRING');
```

> ⚠ DDL นี้ยังไม่ได้รันทดสอบกับ MySQL จริง

---

## 5. การเชื่อมต่อ LINE, อินเทอร์เน็ต และความปลอดภัย

### 5.1 ข้อมูลจาก LINE
- LIFF ให้ `userId`, ชื่อที่แสดงใน LINE และรูปโปรไฟล์ **ไม่ได้** ให้ชื่อจริง เบอร์โทร หรือ HN จึงต้องกรอกเองครั้งแรก
- backend ต้องตรวจ `liff.getIDToken()` กับ LINE ทุกครั้ง ห้ามเชื่อ userId ที่ส่งมาจาก frontend ตรง ๆ
- LINE Login channel (LIFF) กับ Messaging API channel ต้องอยู่ใต้ **Provider เดียวกัน**

### 5.2 โควตาข้อความของแพ็กเกจฟรี
แพ็กเกจฟรีส่ง push message ได้ประมาณ **300 ข้อความต่อเดือน** (ต้องเช็กตัวเลขจริงใน LINE OA Manager)
ประเมินคร่าว ๆ: 6 รอบ × ~22 วันทำการ = ~130 คิวต่อเดือน
- ถ้าส่งครบ 3 ข้อความต่อคิว จะใช้ ~390 ข้อความ ซึ่ง **เกินโควตา**
- ถ้าส่งแค่เตือน 2 ชม. อย่างเดียว จะใช้ ~130 ข้อความ ซึ่ง **พอ**

**วิธีที่ใช้:**
- **ยืนยันการจอง:** ใช้ `liff.sendMessages()` ส่งการ์ด e-ticket เข้าห้องแชทในนามผู้ใช้ วิธีนี้ **ไม่กินโควตา**
- **เตือน 1 วัน:** ปิดเป็นค่าเริ่มต้น
- **เตือน 2 ชม. และแจ้งยกเลิก:** ใช้ push
- หน้าแอดมินแสดงโควตาที่ใช้ไปเดือนนี้ และระบบเตือนเมื่อใกล้เต็ม

### 5.3 เมนู "การเชื่อมต่อระบบ" (แอดมิน)

| โหมด | ใช้ตอนไหน | LINE | URL |
|---|---|---|---|
| **Local (จำลอง LINE)** | เขียนและทดสอบหน้าจอใน browser ปกติ | ไม่ต่อ LINE จริง ใช้ผู้ใช้ปลอมที่เลือกได้ | `http://localhost` |
| **Dev Tunnel** | ลองบนมือถือจริง | LINE OA ทดสอบของ dev เอง | Cloudflare Quick Tunnel `xxx.trycloudflare.com` (เปลี่ยนทุกครั้งที่รันใหม่ ต้องอัปเดต LIFF Endpoint) |
| **Production** | ใช้งานจริง | LINE OA ของ รพ. | Cloudflare Tunnel ผูกกับ subdomain ถาวร |

**ในเมนูมี:**
- ช่องกรอก Public URL, LIFF ID, LINE Login Channel ID, Messaging API Channel Secret และ Access Token (เก็บแบบเข้ารหัส แสดงแบบปิดบัง `••••`)
- ปุ่มทดสอบ: ① เปิดเว็บจากภายนอกได้ไหม (เรียก `/health` ผ่าน Public URL) ② token ของ LINE ใช้ได้ไหม ③ ส่งข้อความทดสอบเข้า LINE แอดมิน
- สถานะ tunnel ว่าออกอินเทอร์เน็ตได้หรือไม่
- ปุ่ม **"ล้างข้อมูลทดสอบ"** ต้องกดก่อนเปลี่ยนเป็น Production เพราะ LINE userId เปลี่ยนตาม Provider บัญชีที่ผูกไว้ตอนทดสอบจึงใช้กับ OA จริงไม่ได้

> ตัว cloudflared รันเป็น service บนเครื่อง server ไม่ได้สั่งเปิดปิดจากหน้าเว็บ หน้าเว็บแค่แสดงสถานะและทดสอบ

### 5.4 ขั้นตอนตั้งค่า LINE

**ช่วง Dev (OA ของตัวเอง)**
1. LINE Developers → สร้าง Provider ของตัวเอง
2. สร้าง Messaging API channel (ได้ OA ทดสอบ) → ออก Channel Access Token
3. ใต้ Provider เดียวกัน สร้าง LINE Login channel → เพิ่ม LIFF app (ขนาด Full, scope `profile` `openid` `chat_message.write`) → ใส่ Endpoint URL ของ tunnel
4. ตั้ง Linked OA ของ LINE Login channel ให้เป็น OA ทดสอบ
5. กรอกค่าทั้งหมดในเมนูการเชื่อมต่อ แล้วกดปุ่มทดสอบ

**ช่วง Production (หัวหน้าเป็นแอดมิน LINE Developers ของ OA รพ.)**
- หัวหน้าทำข้อ 3–4 ใต้ Provider ของ OA รพ. แล้วออก Channel Access Token ให้
- เพิ่มลิงก์ LIFF ใน Rich Menu ของ OA รพ.

### 5.5 ความปลอดภัย (เงื่อนไขของหัวหน้า: public IP ของ รพ. ต้องไม่หลุด)

**ทำไม IP ไม่หลุด**
- cloudflared เป็นฝ่ายต่อ **ขาออก** ไปหา Cloudflare เอง จึงไม่ต้องเปิดพอร์ตขาเข้าบนไฟร์วอลล์ รพ.
- DNS เป็น CNAME ชี้ไปที่ tunnel คนนอกเห็นแค่ IP ของ Cloudflare
- ไฟร์วอลล์ รพ. แค่อนุญาตให้ server ต่อขาออกไปที่พอร์ต **7844 (TCP/UDP)** กับ 443

**จุดที่ต้องระวังไม่ให้ IP หลุด**
- โดเมนเดียวกันต้องไม่มี DNS record อื่นชี้ไปที่ IP รพ. ตรง ๆ
- ระบบไม่ส่งอีเมลออกจาก server ตรง ๆ (IP จะติดไปใน header)
- ไม่มี feature ที่ให้ server ไปเรียก URL ที่ผู้ใช้ส่งมา (กัน SSRF)

**ชั้นความปลอดภัยของระบบ**

| ชั้น | สิ่งที่ทำ |
|---|---|
| แยกเครือข่าย | backend รัน 2 พอร์ต: **พอร์ตสาธารณะ** (หน้าจองและ API ผู้จอง) ส่งออก tunnel ส่วน **พอร์ตภายใน** (แอดมิน เจ้าหน้าที่ หมอนวด) ใช้ได้เฉพาะ LAN ถ้าวันหน้าต้องเข้าจากข้างนอกค่อยเปิดผ่าน Cloudflare Access |
| ยืนยันตัวตน | ผู้จองต้องผ่านการตรวจ LINE ID token ทุก request เจ้าหน้าที่ใช้รหัสผ่านแบบ bcrypt และ session ที่มีวันหมดอายุ แยกสิทธิ์ตาม role |
| กันการยิงถล่ม | จำกัดจำนวน request ต่อนาที และเปิด WAF/Bot protection ของ Cloudflare (แพ็กเกจฟรี) |
| ฐานข้อมูล | MySQL ฟังแค่ `127.0.0.1` แอปใช้ user สิทธิ์จำกัด ไม่ใช้ root |
| ตัวแอป | ตรวจ input ทุกช่อง ใช้ parameterized query, ใส่ helmet (security headers), ตั้ง CORS เฉพาะโดเมนที่ใช้, รหัสจองแบบสุ่ม |
| ข้อมูลลับ | token และรหัสผ่านเก็บแบบเข้ารหัสหรือใน `.env` ไม่ส่งไปฝั่ง frontend |
| PDPA | หน้าขอความยินยอม เก็บข้อมูลเท่าที่จำเป็น และเก็บ log ว่าใครแก้ข้อมูลอะไร |
| สำรองข้อมูล | backup DB อัตโนมัติทุกวัน |

---

## 6. Design

- **โทน:** พื้นขาว สะอาด ใช้ **เขียวสมุนไพร** เป็นสีหลัก ตัดด้วยทองหรือขมิ้นอ่อน ๆ เป็นสีรอง ให้ความรู้สึกสปาแผนไทยที่ดูทันสมัย ไม่ใช่โรงพยาบาลแบบแข็ง ๆ
  - สีหลัก `#2F6B4F` · สีหลักอ่อน `#E8F1EC` · สีรอง `#C9A227` · ตัวอักษร `#1F2A24` · พื้น `#FFFFFF` / `#F7F9F7`
- **ฟอนต์:** Anuphan (หัวข้อ) + Sarabun (เนื้อความ) จาก Google Fonts
- **ลวดลาย:** ใช้ลายไทยหรือใบไม้แบบเส้นบาง ๆ เฉพาะ header และหน้าตั๋ว ไม่ใส่เต็มจอ
- **ลูกเล่น:** เลือก slot แล้วมี animation, หน้า e-ticket เป็นการ์ดตั๋วมีรอยปรุ, สถานะคิวเป็น chip สี, skeleton ตอนโหลด, toast แจ้งผล, หน้าจองสำเร็จมี animation ติ๊กถูก
- **Mobile-first:** หน้าฝั่งผู้จองออกแบบสำหรับมือถือก่อน หน้าเจ้าหน้าที่และแอดมินใช้ได้ทั้ง tablet และ desktop
- **ผู้สูงอายุ:** ตัวอักษรเนื้อความ ≥ 16px ปุ่มสูง ≥ 48px คอนทราสต์ผ่าน WCAG AA และไม่บังคับให้พิมพ์อะไรเยอะ

---

## 7. แผน 3 วัน (MVP)

**สภาพแวดล้อม dev:** Windows, Node.js LTS, MySQL 8 ติดตั้งตรงบนเครื่อง (ไม่ใช้ Docker) และ cloudflared.exe สำหรับ Quick Tunnel

| วัน | งาน | ผลลัพธ์ที่ดูได้ |
|---|---|---|
| **1** | โครงโปรเจกต์ (frontend + backend 2 พอร์ต), DB + seed, API หลัก (slots, booking + transaction, auth เจ้าหน้าที่), cron สร้าง slot และตัด no-show | API ใช้ได้ มีข้อมูลตัวอย่าง |
| **2** | หน้าผู้จองในโหมดจำลอง LINE (เลือกวัน → รอบ → ผู้รับบริการ → ยืนยัน → e-ticket → การจองของฉัน), หน้าเคาน์เตอร์ (คิววันนี้ + เช็กอิน + walk-in), หน้าหมอนวด | **จองแล้วเช็กอินแล้วให้บริการได้ครบ loop** |
| **3** | หน้าแอดมิน CRUD (รอบเวลา, วันหยุด + flow ยกเลิก, กฎ, ผู้ใช้, ผู้รับบริการ), เมนูการเชื่อมต่อ, เชื่อม LIFF + push 2 ชม. กับ OA ทดสอบผ่าน Quick Tunnel, ขัด UI | เดโมให้หัวหน้าลองได้จริงบนมือถือ |

**ทำหลัง MVP:**
- กฎระงับสิทธิ์อัตโนมัติ
- แก้ template ข้อความแจ้งเตือน
- หน้าดูโควตา LINE
- รายงาน และ export บันทึกบริการ
- ขึ้น Production: ติดตั้งบน server รพ., Cloudflare Tunnel แบบถาวรพร้อม subdomain, ย้ายไปใช้ OA รพ., backup อัตโนมัติ

---

## 8. สถานะคำถาม

### ✅ ได้คำตอบแล้ว
| เรื่อง | คำตอบ |
|---|---|
| HN | เว้นว่างได้ (รองรับบุคคลทั่วไป) |
| จองให้ผู้อื่น | ได้ แยกผู้จองกับผู้รับบริการ |
| ยกเลิกล่วงหน้า | 2 ชม. |
| เสาร์อาทิตย์ | ไม่เปิดจอง |
| วันหยุดราชการ | แอดมินตั้งเอง ถ้ามีคนจองแล้วให้ยกเลิกพร้อมแจ้งให้จองใหม่ |
| จองล่วงหน้า | 1–2 วัน (ปรับได้ในหน้าตั้งค่า) |
| รอบเวลา | อาจพิมพ์ผิด ให้ CRUD ได้ |
| กฎระงับสิทธิ์ | ยังไม่สรุป ให้ทำเมนูแอดมินไว้ตั้งค่าเอง |
| LINE OA | แพ็กเกจฟรี หัวหน้าเป็นแอดมิน LINE Developers ช่วง dev ใช้ OA ของตัวเองได้ |
| ออกอินเทอร์เน็ต | อนุญาต ถ้า public IP ไม่หลุดและปลอดภัยที่สุด จึงใช้ Cloudflare Tunnel |
| Server | local ของ รพ. |
| ทีมและกำหนดส่ง | ทำคนเดียว, tester คือหัวหน้าหรือเจ้าหน้าที่, ภายใน 3 วันต้องมีงานให้ดู |

### ⏳ ไม่บล็อกงาน (ใช้ค่าเริ่มต้นไปก่อน ถามเพิ่มตอนเดโมได้)
1. **โดเมนสำหรับ Production:** ใช้ subdomain จากโดเมนที่อยู่บน Cloudflare (เช่นของโปรเจกต์อื่น) หรือโดเมนของ รพ. ต้องรู้ตอนขึ้นจริงเท่านั้น
2. **OS ของ server รพ.** (Windows หรือ Linux) มีผลแค่ขั้นตอนติดตั้ง cloudflared และ service ตอนขึ้นจริง
3. **จองวันเดียวกันได้ไหม** ตอนนี้ตั้งให้ได้ ปิดรับ 1 ชม. ก่อนนัด
4. **ข้อมูลบุคคลทั่วไป** ตอนนี้เก็บแค่ชื่อ-สกุลกับเบอร์
5. **ค่ากฎระงับสิทธิ์** ตอนนี้ตั้ง 2 ครั้ง / 30 วัน / ระงับ 30 วัน และปิดอัตโนมัติไว้
6. **เวลารอบที่ถูกต้อง** แก้ในหน้าแอดมินได้
