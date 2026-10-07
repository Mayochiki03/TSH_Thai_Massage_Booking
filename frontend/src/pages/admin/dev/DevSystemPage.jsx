/**
 * pages/admin/dev/DevSystemPage.jsx — เมนูนักพัฒนา: ระบบและเครื่องมือ
 *
 *  - ข้อมูลระบบ        : เวอร์ชัน Node/MySQL, โหมด, พอร์ต, เวลาฐานข้อมูล, จำนวนข้อมูล (GET /api/dev/system)
 *  - สั่งรันงานตั้งเวลา : สร้างรอบ / ตัด no-show / ส่งเตือน — ไม่ต้องรอเวลา cron (POST /api/dev/jobs/:name)
 *  - ล้างข้อมูลทดสอบ    : ลบผู้รับบริการ/การจอง/บัญชี LINE ทั้งหมด ก่อนขึ้นใช้งานจริง (POST /api/dev/clear-test-data)
 */
import { useState } from 'react';
import { Play, Trash2, RefreshCw } from 'lucide-react';
import { staffApi } from '../../../lib/api.js';
import { useLoad } from '../../../lib/useLoad.js';
import { Button, Card, Field, Input, PageHeader, Spinner, useToast } from '../../../components/ui.jsx';

const MODE_LABEL = { LOCAL: 'LOCAL (ยังไม่ต่อ LINE)', DEV_TUNNEL: 'DEV_TUNNEL (LINE OA ทดสอบ)', PRODUCTION: 'PRODUCTION (ใช้งานจริง)' };
const COUNT_LABEL = { patients: 'ผู้รับบริการ', line_users: 'บัญชี LINE', appointments: 'การจอง', future_slots: 'รอบที่สร้างล่วงหน้า', last_slot_date: 'สร้างรอบถึงวันที่' };

export function DevSystemPage() {
  const { data, reload } = useLoad(() => Promise.all([staffApi('/dev/system'), staffApi('/dev/jobs')]), []);
  const [running, setRunning] = useState(null);
  const [results, setResults] = useState({});
  const [confirmText, setConfirmText] = useState('');
  const [clearing, setClearing] = useState(false);
  const toast = useToast();

  if (!data) return <Spinner />;
  const [sys, { jobs }] = data;

  const run = async (name) => {
    setRunning(name);
    try { const r = await staffApi(`/dev/jobs/${name}`, { method: 'POST' }); setResults({ ...results, [name]: r.result }); reload(); }
    catch (err) { toast(err.message, 'error'); }
    finally { setRunning(null); }
  };

  const clear = async () => {
    setClearing(true);
    try {
      const r = await staffApi('/dev/clear-test-data', { method: 'POST', body: { confirm_text: confirmText } });
      toast(`ล้างแล้ว: การจอง ${r.deleted.appointments}, ผู้รับบริการ ${r.deleted.patients}, บัญชี LINE ${r.deleted.line_users}`);
      setConfirmText(''); reload();
    } catch (err) { toast(err.message, 'error'); }
    finally { setClearing(false); }
  };

  const info = [
    ['โหมดการเชื่อมต่อ', MODE_LABEL[sys.mode]],
    ['สภาพแวดล้อม', sys.env],
    ['Node.js', sys.node],
    ['MySQL', sys.mysql],
    ['เวลาในฐานข้อมูล', sys.db_time],
    ['เปิดเซิร์ฟเวอร์มาแล้ว', `${Math.floor(sys.uptime_sec / 3600)} ชม. ${Math.floor((sys.uptime_sec % 3600) / 60)} นาที`],
    ['พอร์ต public / internal', `${sys.ports.public} / ${sys.ports.internal}`],
    ['งานตั้งเวลา (cron)', sys.cron_enabled ? 'เปิด' : 'ปิด (ENABLE_CRON=false)'],
  ];

  return (
    <>
      <PageHeader title="ระบบและเครื่องมือ" description="สำหรับนักพัฒนา: ตรวจสถานะ ทดสอบงานอัตโนมัติ และล้างข้อมูลทดสอบ"
        actions={<Button variant="outline" icon={RefreshCw} onClick={reload}>รีเฟรช</Button>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="ข้อมูลระบบ">
          <dl className="divide-y divide-line text-[15px]">
            {info.map(([k, v]) => (
              <div key={k} className="flex flex-wrap justify-between gap-2 py-2"><dt className="text-muted">{k}</dt><dd className="font-medium">{v}</dd></div>
            ))}
            {Object.entries(sys.counts).map(([k, v]) => (
              <div key={k} className="flex flex-wrap justify-between gap-2 py-2"><dt className="text-muted">{COUNT_LABEL[k] ?? k}</dt><dd className="font-medium tabular-nums">{v ?? '-'}</dd></div>
            ))}
          </dl>
        </Card>

        <div className="space-y-6">
          <Card title="สั่งรันงานตั้งเวลา" description="ใช้ตอนทดสอบ ปกติระบบรันเองตามเวลา">
            <ul className="space-y-2">
              {jobs.map((j) => (
                <li key={j.name} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-4 py-2.5">
                  <span>{j.label}{j.name in results && <span className="text-muted"> ผลล่าสุด: {results[j.name]}</span>}</span>
                  <Button size="sm" variant="soft" icon={Play} loading={running === j.name} onClick={() => run(j.name)}>รัน</Button>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="ล้างข้อมูลทดสอบ" description="ลบผู้รับบริการ การจอง บัญชี LINE และ log แจ้งเตือนทั้งหมด (ค่าตั้งค่า บัญชีผู้ใช้ รอบเวลา วันหยุด ยังอยู่)">
            <p className="mb-3 rounded-xl bg-rose-soft px-4 py-3 text-[15px] text-rose-ink">ใช้ก่อนเปลี่ยนไปใช้ LINE OA จริง เพราะ LINE user ID ของ OA ทดสอบใช้กับ OA จริงไม่ได้ ข้อมูลที่ลบกู้คืนไม่ได้</p>
            <Field label='พิมพ์คำว่า "ล้างข้อมูล" เพื่อยืนยัน'>
              <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
            </Field>
            <Button variant="danger" icon={Trash2} className="mt-3" disabled={confirmText !== 'ล้างข้อมูล'} loading={clearing} onClick={clear}>ล้างข้อมูลทดสอบ</Button>
          </Card>
        </div>
      </div>
    </>
  );
}
