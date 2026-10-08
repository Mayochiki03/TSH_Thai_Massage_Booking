/**
 * pages/admin/ReportsPage.jsx — ส่งออกรายงานการจองเป็นไฟล์ Excel
 *
 * เลือกช่วงวันที่ (ปุ่มลัด: เดือนนี้ / เดือนที่แล้ว / 30 วัน / ปีงบประมาณ) → กดดาวน์โหลด
 * เลือกหมอนวดได้ (เว้นว่าง = ทุกคน) → ไฟล์มีเฉพาะคิวที่หมอนวดคนนั้นนวด (ใช้ทำยอดรายคน)
 * เรียก GET /api/admin/reports/bookings.xlsx?from&to&mask_phone&practitioner_id (ไฟล์สร้างที่ backend: services/report.js)
 *
 * ใช้ fetch + blob แทนลิงก์ตรง ๆ เพื่อแสดงข้อความ error ภาษาไทยได้ (เช่น ช่วงวันที่ยาวเกิน 1 ปี)
 * ไฟล์มีข้อมูลส่วนบุคคล → backend บันทึก audit log ทุกครั้งที่ดาวน์โหลด
 */
import { useMemo, useState } from 'react';
import { Download, FileSpreadsheet, LayoutDashboard, CalendarDays, ListChecks, Users, ShieldCheck } from 'lucide-react';
import { thaiDate, todayYmd, addDays } from '../../lib/format.js';
import { Button, Card, Field, Input, PageHeader, Segmented, Select, Switch, useToast } from '../../components/ui.jsx';
import { staffApi } from '../../lib/api.js';
import { useLoad } from '../../lib/useLoad.js';

// ---------------------------------------------------------------------
// ช่วงวันที่สำเร็จรูป
// ---------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const lastDayOf = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m = 1..12

/** คืน { from, to } ของปุ่มลัดแต่ละแบบ (อิงวันนี้ตามเวลาไทย) */
function presetRange(key, today = todayYmd()) {
  const [y, m] = today.split('-').map(Number);
  switch (key) {
    case 'this-month':
      return { from: ymd(y, m, 1), to: ymd(y, m, lastDayOf(y, m)) };
    case 'last-month': {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return { from: ymd(py, pm, 1), to: ymd(py, pm, lastDayOf(py, pm)) };
    }
    case 'last-30':
      return { from: addDays(today, -29), to: today };
    case 'fiscal': {
      // ปีงบประมาณราชการ: 1 ต.ค. – 30 ก.ย.
      const start = m >= 10 ? y : y - 1;
      return { from: ymd(start, 10, 1), to: ymd(start + 1, 9, 30) };
    }
    case 'last-fiscal': {
      const start = (m >= 10 ? y : y - 1) - 1;
      return { from: ymd(start, 10, 1), to: ymd(start + 1, 9, 30) };
    }
    default:
      return null;
  }
}

/** ปีงบประมาณ (พ.ศ.) ของวันที่ — ต.ค. ขึ้นปีงบใหม่ */
const fiscalYearBE = (date) => {
  const [y, m] = date.split('-').map(Number);
  return (m >= 10 ? y + 1 : y) + 543;
};

const PRESETS = [
  { value: 'this-month', label: 'เดือนนี้' },
  { value: 'last-month', label: 'เดือนที่แล้ว' },
  { value: 'last-30', label: '30 วันล่าสุด' },
  { value: 'fiscal', label: 'ปีงบนี้' },
  { value: 'last-fiscal', label: 'ปีงบที่แล้ว' },
  { value: 'custom', label: 'กำหนดเอง' },
];

/** สิ่งที่อยู่ในไฟล์ (แสดงให้รู้ก่อนดาวน์โหลด) */
const SHEETS = [
  { icon: LayoutDashboard, name: 'สรุป', body: 'ตัวเลขสำคัญ: คิวทั้งหมด เสร็จสิ้น ไม่มา ยกเลิก อัตรามาตามนัด อัตราการใช้เตียง รายได้ เวลานวดเฉลี่ย และแยกตามสถานะ / ช่องทาง / รอบเวลา / ประเภทบริการ / หมอนวด' },
  { icon: CalendarDays, name: 'รายวัน', body: 'ทีละวัน: จำนวนที่ (เตียง×รอบ) จอง เสร็จ ไม่มา ยกเลิก อัตราการใช้ และรายได้ พร้อมแถวรวม' },
  { icon: ListChecks, name: 'รายการจอง', body: 'ทุกคิว: รหัสจอง ผู้รับบริการ เลขบัตรประชาชน บริการ ราคา หมอนวด VN สถานะ ช่องทาง เวลาเช็กอิน/เริ่ม/เสร็จ — กรองและเรียงได้' },
  { icon: Users, name: 'ผู้รับบริการ', body: 'รายคน: เลขบัตร จองกี่ครั้ง เสร็จ ไม่มา ยกเลิก ยอดเงิน และมาครั้งล่าสุด' },
];

/** อ่านชื่อไฟล์จาก Content-Disposition (รองรับชื่อภาษาไทยใน filename*) */
function filenameFrom(res, fallback) {
  const cd = res.headers.get('Content-Disposition') || '';
  const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) return decodeURIComponent(star[1]);
  const plain = cd.match(/filename="([^"]+)"/i);
  return plain ? plain[1] : fallback;
}

export function ReportsPage() {
  const [preset, setPreset] = useState('this-month');
  const [range, setRange] = useState(() => presetRange('this-month'));
  const [maskPhone, setMaskPhone] = useState(false);
  const [practitionerId, setPractitionerId] = useState('');
  const { data: practitioners } = useLoad(() => staffApi('/admin/practitioners').then((d) => d.practitioners), []);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const choosePreset = (key) => {
    setPreset(key);
    const r = presetRange(key);
    if (r) setRange(r);
  };
  const setDate = (k) => (e) => {
    if (!e.target.value) return;
    setPreset('custom');
    setRange((r) => ({ ...r, [k]: e.target.value }));
  };

  const invalid = range.from > range.to;
  const days = useMemo(() => Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86_400_000) + 1, [range]);
  const tooLong = days > 367;

  /** ดาวน์โหลดไฟล์: fetch → blob → คลิกลิงก์ชั่วคราว */
  const download = async () => {
    setBusy(true);
    try {
      const qs = new URLSearchParams({ from: range.from, to: range.to, mask_phone: maskPhone ? '1' : '0', ...(practitionerId && { practitioner_id: practitionerId }) });
      const res = await fetch(`/api/admin/reports/bookings.xlsx?${qs}`, { credentials: 'same-origin' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message || 'ดาวน์โหลดไม่สำเร็จ กรุณาลองใหม่');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: filenameFrom(res, 'booking-report.xlsx') });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast('ดาวน์โหลดรายงานแล้ว');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="รายงาน (Excel)" description="ดาวน์โหลดสรุปการจองเป็นไฟล์ Excel เปิดได้ทั้ง Excel และ Google Sheets" />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        {/* เลือกช่วงวันที่ */}
        <Card title="ช่วงวันที่" description={`ปีงบประมาณ ${fiscalYearBE(todayYmd())} เริ่ม 1 ต.ค.`}>
          <Segmented value={preset} onChange={choosePreset} options={PRESETS} />

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="ตั้งแต่วันที่" hint={thaiDate(range.from)}>
              <Input type="date" value={range.from} onChange={setDate('from')} max={range.to} />
            </Field>
            <Field label="ถึงวันที่" hint={thaiDate(range.to)} error={invalid ? 'ต้องไม่ก่อนวันที่เริ่ม' : tooLong ? 'เลือกได้ไม่เกิน 1 ปี' : undefined}>
              <Input type="date" value={range.to} onChange={setDate('to')} min={range.from} />
            </Field>
          </div>

          <div className="mt-5 rounded-xl bg-sand px-4 py-3 text-[15px]">
            <span className="text-muted">ช่วงที่เลือก </span>
            <span className="font-medium">{thaiDate(range.from)} – {thaiDate(range.to)}</span>
            {!invalid && <span className="text-muted"> ({days.toLocaleString('th-TH')} วัน)</span>}
          </div>

          <Field label="หมอนวด" className="mt-5" hint={practitionerId ? 'เฉพาะคิวที่หมอนวดคนนี้นวด (ใช้ทำยอดรายคน)' : 'ทุกคิวในช่วงวันที่ รวมคิวที่ยังไม่ได้นวด'}>
            <Select value={practitionerId} onChange={(e) => setPractitionerId(e.target.value)}>
              <option value="">ทุกคน</option>
              {practitioners?.map((p) => <option key={p.practitioner_id} value={p.practitioner_id}>{p.full_name}{p.is_active ? '' : ' (ปิดใช้งาน)'}</option>)}
            </Select>
          </Field>

          <div className="mt-5 border-t border-line pt-5">
            <Switch
              checked={maskPhone}
              onChange={setMaskPhone}
              label="ปิดบังเบอร์โทรและเลขบัตรประชาชน"
              description="แสดงเป็น 081-xxx-5678 / x-xxxx-xxxx9-87-6 เหมาะกับไฟล์ที่จะส่งต่อหรือนำเสนอ"
            />
          </div>

          <Button icon={Download} size="lg" className="mt-6 w-full sm:w-auto" loading={busy} disabled={invalid || tooLong} onClick={download}>
            ดาวน์โหลด Excel
          </Button>
        </Card>

        {/* ในไฟล์มีอะไร */}
        <Card title="ในไฟล์มีอะไร" description="4 แผ่นงาน ตัวเลขสรุปเป็นสูตร Excel คำนวณจากรายการจอง">
          <ul className="space-y-4">
            {SHEETS.map(({ icon: Icon, name, body }) => (
              <li key={name} className="flex gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-leaf-soft text-herb"><Icon className="size-5" aria-hidden /></span>
                <span className="min-w-0">
                  <span className="block font-medium">{name}</span>
                  <span className="block text-[14px] leading-relaxed text-muted">{body}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-5 flex gap-2 rounded-xl bg-clay-soft px-4 py-3 text-[14px] leading-relaxed text-clay">
            <ShieldCheck className="mt-0.5 size-[18px] shrink-0" aria-hidden />
            ไฟล์มีข้อมูลส่วนบุคคลของผู้รับบริการ ใช้ภายในหน่วยงานเท่านั้น ระบบบันทึกทุกครั้งที่มีการดาวน์โหลด
          </p>
        </Card>
      </div>

      <p className="mt-6 flex items-center gap-2 text-[14px] text-faint">
        <FileSpreadsheet className="size-4" aria-hidden /> วันที่ในไฟล์แสดงแบบไทย (พ.ศ.) แต่ยังเรียงและกรองตามวันที่ได้
      </p>
    </>
  );
}
