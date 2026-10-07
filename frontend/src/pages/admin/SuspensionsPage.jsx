/**
 * pages/admin/SuspensionsPage.jsx — รายชื่อผู้ถูกระงับสิทธิ์การจอง
 * ดูรายการที่ยังมีผล / ทั้งหมด และปลดระงับก่อนกำหนด (POST /api/admin/suspensions/:id/lift)
 * การระงับด้วยมือทำได้ที่หน้ารายละเอียดผู้รับบริการ
 */
import { useState } from 'react';
import { Link } from 'react-router';
import { staffApi } from '../../lib/api.js';
import { useLoad } from '../../lib/useLoad.js';
import { thaiDate } from '../../lib/format.js';
import { Button, Card, PageHeader, Segmented, Spinner, Empty, useToast, useConfirm } from '../../components/ui.jsx';

export function SuspensionsPage() {
  const [scope, setScope] = useState('active');
  const toast = useToast();
  const confirm = useConfirm();
  const { data, reload } = useLoad(() => staffApi(`/admin/suspensions${scope === 'all' ? '?all=1' : ''}`).then((d) => d.suspensions), [scope]);

  const lift = async (s) => {
    if (!(await confirm({ title: `ปลดระงับ ${s.first_name} ${s.last_name}?`, body: 'จองผ่าน LINE / kiosk ได้ทันที', okText: 'ปลดระงับ' }))) return;
    try { await staffApi(`/admin/suspensions/${s.suspension_id}/lift`, { method: 'POST' }); toast('ปลดระงับแล้ว'); reload(); }
    catch (err) { toast(err.message, 'error'); }
  };

  return (
    <>
      <PageHeader title="ระงับสิทธิ์" description={<>ตั้งเกณฑ์ระงับอัตโนมัติได้ที่ <Link to="/admin/rules" className="text-herb underline">กฎการจอง</Link></>} />
      <Segmented className="mb-4" value={scope} onChange={setScope} options={[{ value: 'active', label: 'ยังมีผล' }, { value: 'all', label: 'ทั้งหมด' }]} />
      <Card bodyClassName="p-0">
        {!data ? <Spinner /> : !data.length ? <Empty title="ไม่มีผู้ถูกระงับสิทธิ์" /> : (
          <ul className="divide-y divide-line">
            {data.map((s) => (
              <li key={s.suspension_id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{s.first_name} {s.last_name} <span className="font-normal text-muted">{s.hn ?? 'บุคคลทั่วไป'} / {s.phone_number}</span></div>
                  <div className="text-[15px] text-muted">
                    {thaiDate(s.start_date)} – {thaiDate(s.end_date)}, {s.reason} ({s.source === 'AUTO' ? 'ระงับอัตโนมัติ' : 'ระงับโดยเจ้าหน้าที่'})
                    {s.lifted_at && ', ปลดแล้ว'}
                  </div>
                </div>
                {!!s.is_active && <Button size="sm" variant="outline" onClick={() => lift(s)}>ปลดระงับ</Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
