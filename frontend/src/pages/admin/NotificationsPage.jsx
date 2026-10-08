/**
 * pages/admin/NotificationsPage.jsx — ข้อความแจ้งเตือน LINE
 *
 *  แท็บ "ข้อความ"      : แก้หัวข้อ/เนื้อความ + เปิด/ปิดทีละชนิด (PUT /api/admin/notification-templates/:type)
 *                        มีตัวอย่างข้อความจริงที่แทนตัวแปรแล้ว
 *  แท็บ "ประวัติการส่ง" : log การส่ง (GET /api/admin/notification-logs) + สรุปเดือนนี้
 */
import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { staffApi } from '../../lib/api.js';
import { useLoad } from '../../lib/useLoad.js';
import { Button, Card, Field, Input, PageHeader, Segmented, Spinner, Switch, Textarea, Empty, useToast, cx } from '../../components/ui.jsx';

const TYPE_INFO = {
  BOOKED: 'ส่งเมื่อจองสำเร็จ (ผ่านแชท LINE ของผู้จอง ไม่กินโควตา)',
  REMIND_1D: 'ส่งเย็นวันก่อนนัด — ปิดไว้เพื่อประหยัดโควตา LINE ฟรี',
  REMIND_2H: 'ส่งก่อนเวลานัด 2 ชั่วโมง พร้อมปุ่มยืนยัน/ยกเลิก',
  CANCELLED: 'ส่งเมื่อคิวถูกยกเลิก',
  HOLIDAY_CANCELLED: 'ส่งเมื่อปิดรับ/ตั้งวันหยุดในวันที่มีคนจองแล้ว',
  SUSPENDED: 'ส่งเมื่อถูกระงับสิทธิ์จากการไม่มาตามนัด',
};
/** ค่าตัวอย่างสำหรับดูตัวอย่างข้อความ */
const SAMPLE = {
  patient_name: 'สมศรี ใจดี', date: 'พฤ. 8 ต.ค. 2569', time: '10:15–11:15 น.', code: 'K7M4QX', service: 'นวดแผนไทย', price: '200 บาท',
  reason: 'หมอนวดติดอบรม', end_date: 'ศ. 6 พ.ย. 2569', rebook_url: 'https://liff.line.me/…',
};
const fill = (t) => String(t).replace(/\{(\w+)\}/g, (m, k) => SAMPLE[k] ?? m);
const STATUS_LABEL = { SENT: 'ส่งแล้ว', FAILED: 'ส่งไม่สำเร็จ', SKIPPED: 'ไม่ได้ส่ง (โหมดทดสอบ)' };

export function NotificationsPage() {
  const [tab, setTab] = useState('templates');
  return (
    <>
      <PageHeader title="ข้อความแจ้งเตือน" description="ข้อความที่ระบบส่งหาผู้จองทาง LINE" />
      <Segmented className="mb-6" value={tab} onChange={setTab} options={[{ value: 'templates', label: 'ข้อความ' }, { value: 'logs', label: 'ประวัติการส่ง' }]} />
      {tab === 'templates' ? <Templates /> : <Logs />}
    </>
  );
}

function Templates() {
  const { data, reload } = useLoad(() => staffApi('/admin/notification-templates').then((d) => d.templates), []);
  if (!data) return <Spinner />;
  return <div className="grid gap-6 xl:grid-cols-2">{data.map((t) => <TemplateCard key={t.type} t={t} onSaved={reload} />)}</div>;
}

function TemplateCard({ t, onSaved }) {
  const [form, setForm] = useState({ title: t.title, body: t.body, is_enabled: !!t.is_enabled });
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  useEffect(() => { setForm({ title: t.title, body: t.body, is_enabled: !!t.is_enabled }); }, [t]);
  const dirty = form.title !== t.title || form.body !== t.body || form.is_enabled !== !!t.is_enabled;

  const save = async () => {
    setSaving(true);
    try { await staffApi(`/admin/notification-templates/${t.type}`, { method: 'PUT', body: form }); toast('บันทึกข้อความแล้ว'); onSaved(); }
    catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  return (
    <Card className={cx(!form.is_enabled && 'opacity-80')}>
      <Switch checked={form.is_enabled} onChange={(v) => setForm({ ...form, is_enabled: v })} label={t.title} description={TYPE_INFO[t.type]} />
      <div className="mt-4 space-y-3">
        <Field label="หัวข้อ"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={100} /></Field>
        <Field label="ข้อความ" hint="ตัวแปร: {patient_name} {service} {price} {date} {time} {code} {reason} {end_date} {rebook_url}">
          <Textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={5} maxLength={2000} />
        </Field>
        <div className="rounded-xl bg-sand px-4 py-3">
          <div className="text-[13px] text-clay">ตัวอย่างที่ผู้จองจะเห็น</div>
          <div className="mt-1 font-display font-medium">{form.title}</div>
          <p className="mt-1 text-[15px] whitespace-pre-line">{fill(form.body)}</p>
        </div>
      </div>
      {dirty && <Button size="sm" icon={Save} className="mt-4" loading={saving} onClick={save}>บันทึก</Button>}
    </Card>
  );
}

function Logs() {
  const { data } = useLoad(() => staffApi('/admin/notification-logs?limit=100'), []);
  if (!data) return <Spinner />;
  const m = data.month;
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-[15px] text-muted">
        <span>เดือนนี้ push <b className="font-display text-ink">{m.push_sent}</b> ข้อความ (นับโควตา)</span>
        <span>ส่งผ่านแชท <b className="font-display text-ink">{m.liff_sent}</b> (ไม่นับโควตา)</span>
        <span>ไม่สำเร็จ <b className="font-display text-ink">{m.failed}</b></span>
        <span>โหมดทดสอบ <b className="font-display text-ink">{m.skipped}</b></span>
      </div>
      <Card bodyClassName="p-0">
        {!data.logs.length ? <Empty title="ยังไม่มีการส่งแจ้งเตือน" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[15px]">
              <thead className="border-b border-line text-[14px] text-muted">
                <tr><th className="px-5 py-3 font-medium">เวลา</th><th className="px-3 py-3 font-medium">ชนิด</th><th className="px-3 py-3 font-medium">รหัสจอง</th><th className="px-3 py-3 font-medium">ผล</th><th className="px-5 py-3 font-medium">หมายเหตุ</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.logs.map((l) => (
                  <tr key={l.log_id}>
                    <td className="px-5 py-2.5 whitespace-nowrap tabular-nums">{l.sent_at.slice(0, 16)}</td>
                    <td className="px-3 py-2.5">{l.type}{l.channel === 'LIFF' && <span className="text-muted"> (แชท)</span>}</td>
                    <td className="px-3 py-2.5 font-display tracking-wider">{l.booking_code ?? '-'}</td>
                    <td className={cx('px-3 py-2.5', l.status === 'FAILED' && 'text-rose-ink')}>{STATUS_LABEL[l.status]}</td>
                    <td className="px-5 py-2.5 text-muted">{l.error_message ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
