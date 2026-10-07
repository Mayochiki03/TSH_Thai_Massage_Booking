/**
 * pages/admin/RulesPage.jsx — กฎการจอง / ระงับสิทธิ์ / ค่าทั่วไป (GET/PUT /api/admin/settings)
 *
 * ค่าทุกตัวมาจากตาราง settings — หน้านี้แค่เลือกช่องกรอกให้เหมาะกับชนิดค่า:
 *   INT → ช่องตัวเลข + หน่วย, BOOL → สวิตช์, open_weekdays → ปุ่มเลือกวัน, STRING → ช่องข้อความ
 * กด "บันทึก" ส่งเฉพาะค่าที่แก้ (backend ตรวจรูปแบบซ้ำอีกชั้น)
 * ค่าการเชื่อมต่อ LINE ไม่อยู่ที่นี่ — อยู่ในเมนูนักพัฒนา
 */
import { useEffect, useMemo, useState } from 'react';
import { Save, RotateCcw } from 'lucide-react';
import { staffApi } from '../../lib/api.js';
import { useLoad } from '../../lib/useLoad.js';
import { Button, Card, Input, PageHeader, Spinner, Switch, useToast, cx } from '../../components/ui.jsx';

/** หน่วย/คำอธิบายเพิ่มเติมของค่าตัวเลข (key → หน่วย) */
const UNIT = {
  max_per_day: 'คิว', max_per_week: 'คิว', advance_booking_days: 'วัน', booking_cutoff_min: 'นาที',
  patient_cancel_min: 'นาที', checkin_early_min: 'นาที', no_show_after_min: 'นาที', slot_generate_days: 'วัน',
  suspend_noshow_count: 'ครั้ง', suspend_window_days: 'วัน', suspend_days: 'วัน', remind_1d_hour: 'นาฬิกา', kiosk_idle_sec: 'วินาที',
};
const SECTIONS = [
  { category: 'BOOKING', title: 'กฎการจอง', description: 'ใช้กับการจองผ่าน LINE และ kiosk (เจ้าหน้าที่ยืนยันข้ามได้)' },
  { category: 'SUSPENSION', title: 'ระงับสิทธิ์เมื่อไม่มาตามนัด', description: 'เปิดอัตโนมัติแล้วระบบจะระงับสิทธิ์ให้เองเมื่อครบเกณฑ์' },
  { category: 'GENERAL', title: 'ทั่วไป', description: 'ชื่อที่แสดง เบอร์ติดต่อ และเวลาส่งข้อความ' },
];
const WEEKDAYS = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'];

export function RulesPage() {
  const { data, setData } = useLoad(() => staffApi('/admin/settings').then((d) => d.settings), []);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => { setDraft({}); }, [data]);
  const value = (s) => (s.key in draft ? draft[s.key] : s.value);
  const changed = useMemo(() => Object.keys(draft).filter((k) => draft[k] !== data?.find((s) => s.key === k)?.value), [draft, data]);

  const save = async () => {
    setSaving(true);
    try {
      const body = Object.fromEntries(changed.map((k) => [k, draft[k]]));
      const r = await staffApi('/admin/settings', { method: 'PUT', body });
      setData(r.settings);
      toast('บันทึกกฎแล้ว มีผลทันที');
    } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  if (!data) return <Spinner />;

  return (
    <>
      <PageHeader
        title="กฎการจอง"
        description="ปรับได้ตลอด มีผลกับการจองครั้งถัดไปทันที"
        actions={changed.length > 0 && (
          <>
            <Button variant="ghost" icon={RotateCcw} onClick={() => setDraft({})}>ยกเลิกการแก้</Button>
            <Button icon={Save} loading={saving} onClick={save}>บันทึก ({changed.length})</Button>
          </>
        )}
      />
      <div className="space-y-6">
        {SECTIONS.map((sec) => (
          <Card key={sec.category} title={sec.title} description={sec.description} bodyClassName="p-0">
            <ul className="divide-y divide-line">
              {data.filter((s) => s.category === sec.category).map((s) => (
                <li key={s.key} className={cx('px-5 py-4', s.key in draft && draft[s.key] !== s.value && 'bg-turmeric-soft/40')}>
                  <SettingInput s={s} value={value(s)} onChange={(v) => setDraft({ ...draft, [s.key]: v })} />
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}

/** ช่องกรอก 1 ค่า เลือกตามชนิด */
function SettingInput({ s, value, onChange }) {
  if (s.type === 'BOOL') return <Switch checked={value} onChange={onChange} label={s.label} />;

  if (s.key === 'open_weekdays') {
    const set = new Set(String(value).split(',').filter(Boolean).map(Number));
    const toggle = (d) => {
      const next = new Set(set);
      next.has(d) ? next.delete(d) : next.add(d);
      onChange([...next].sort().join(','));
    };
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-medium">วันที่เปิดให้จอง</span>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((label, i) => (
            <button
              key={label}
              type="button"
              aria-pressed={set.has(i + 1)}
              onClick={() => toggle(i + 1)}
              className={cx('h-10 min-w-11 rounded-xl border px-2 font-display text-[15px]', set.has(i + 1) ? 'border-herb bg-herb text-white' : 'border-line hover:border-herb')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <label className="flex flex-wrap items-center justify-between gap-3">
      <span className="min-w-0 font-medium">{s.label}</span>
      <span className={cx('flex items-center gap-2', s.type !== 'INT' && 'w-full sm:w-auto')}>
        <Input
          type={s.type === 'INT' ? 'number' : 'text'}
          min={s.type === 'INT' ? 0 : undefined}
          value={value}
          onChange={(e) => onChange(s.type === 'INT' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
          className={cx('h-11', s.type === 'INT' ? 'w-24 text-right font-display' : 'w-full sm:w-72')}
        />
        {UNIT[s.key] && <span className="w-14 text-muted">{UNIT[s.key]}</span>}
      </span>
    </label>
  );
}
