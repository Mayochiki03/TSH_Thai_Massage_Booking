/**
 * pages/admin/AuditPage.jsx — ประวัติการใช้งาน (audit log) สำหรับตรวจสอบตาม PDPA
 * ใคร (เจ้าหน้าที่ / ผู้จอง LINE / ระบบ) ทำอะไร กับข้อมูลไหน เมื่อไร (GET /api/admin/audit-logs)
 */
import { useState } from 'react';
import { staffApi } from '../../lib/api.js';
import { useLoad } from '../../lib/useLoad.js';
import { Button, Card, PageHeader, Spinner, Empty } from '../../components/ui.jsx';

const ACTOR = { STAFF: 'เจ้าหน้าที่', LINE: 'ผู้จอง (LINE)', SYSTEM: 'ระบบ' };

export function AuditPage() {
  const [offset, setOffset] = useState(0);
  const { data } = useLoad(() => staffApi(`/admin/audit-logs?limit=50&offset=${offset}`).then((d) => d.logs), [offset]);

  return (
    <>
      <PageHeader title="ประวัติการใช้งาน" description="บันทึกทุกการเพิ่ม แก้ไข ลบ เช็กอิน และการเข้าสู่ระบบ" />
      <Card bodyClassName="p-0">
        {!data ? <Spinner /> : !data.length ? <Empty title="ยังไม่มีประวัติ" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[15px]">
              <thead className="border-b border-line text-[14px] text-muted">
                <tr><th className="px-5 py-3 font-medium">เวลา</th><th className="px-3 py-3 font-medium">ผู้ทำรายการ</th><th className="px-3 py-3 font-medium">การกระทำ</th><th className="px-3 py-3 font-medium">ข้อมูล</th><th className="px-5 py-3 font-medium">IP</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.map((l) => (
                  <tr key={l.audit_id}>
                    <td className="px-5 py-2.5 whitespace-nowrap tabular-nums">{l.created_at.slice(0, 19)}</td>
                    <td className="px-3 py-2.5">{ACTOR[l.actor_type]} <span className="text-muted">{l.actor_id ? `#${String(l.actor_id).slice(0, 12)}` : ''}</span></td>
                    <td className="px-3 py-2.5 font-medium">{l.action}</td>
                    <td className="px-3 py-2.5">{l.entity}{l.entity_id ? ` #${l.entity_id}` : ''}</td>
                    <td className="px-5 py-2.5 text-muted">{l.ip_address ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="mt-4 flex justify-end gap-2">
        <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>ใหม่กว่า</Button>
        <Button size="sm" variant="outline" disabled={!data || data.length < 50} onClick={() => setOffset(offset + 50)}>เก่ากว่า</Button>
      </div>
    </>
  );
}
