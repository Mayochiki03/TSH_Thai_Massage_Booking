/**
 * pages/admin/dev/DevMockUsersPage.jsx — เมนูนักพัฒนา: ผู้ใช้ LINE จำลอง
 *
 * ใช้ทดสอบหน้าผู้จองในโหมด LOCAL โดยไม่ต้องมี LINE จริง:
 *   "เปิดหน้าผู้จอง" → เก็บผู้ใช้ที่เลือกไว้ใน browser เครื่องนี้ (localStorage) แล้วเปิดหน้า / ในแท็บใหม่
 *   "หยุดจำลอง"     → ล้างค่า หน้าผู้จองจะกลับไปแสดงว่า "ระบบจองออนไลน์ยังไม่เปิดใช้งาน"
 *
 * ผู้ใช้จำลองมี ID ขึ้นต้นด้วย Udev และ backend ยอมรับเฉพาะตอนโหมด LOCAL เท่านั้น
 */
import { useState } from 'react';
import { ExternalLink, UserPlus, Trash2, StopCircle, TriangleAlert } from 'lucide-react';
import { staffApi } from '../../../lib/api.js';
import { useLoad } from '../../../lib/useLoad.js';
import { getMockUser, setMockUser, clearMockUser } from '../../../lib/liff.js';
import { Button, Card, Input, PageHeader, Spinner, Empty, useToast, useConfirm, cx } from '../../../components/ui.jsx';

export function DevMockUsersPage() {
  const { data, reload } = useLoad(() => Promise.all([staffApi('/dev/mock-users'), staffApi('/dev/connection')]), []);
  const [active, setActive] = useState(getMockUser());
  const [name, setName] = useState('');
  const toast = useToast();
  const confirm = useConfirm();

  if (!data) return <Spinner />;
  const [{ users }, conn] = data;

  const use = (u) => {
    const m = { id: u.line_user_id, name: u.display_name ?? 'ผู้ใช้จำลอง' };
    setMockUser(m);
    setActive(m);
    window.open('/', '_blank', 'noopener');
  };
  const stop = () => { clearMockUser(); setActive(null); toast('หยุดจำลองแล้ว'); };

  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    try { await staffApi('/dev/mock-users', { method: 'POST', body: { display_name: name.trim() } }); setName(''); reload(); toast('สร้างผู้ใช้จำลองแล้ว'); }
    catch (err) { toast(err.message, 'error'); }
  };

  const remove = async (u) => {
    if (!(await confirm({ title: `ลบ ${u.display_name}?`, okText: 'ลบ', danger: true }))) return;
    try { await staffApi(`/dev/mock-users/${u.line_user_id}`, { method: 'DELETE' }); if (active?.id === u.line_user_id) stop(); reload(); }
    catch (err) { toast(err.message, 'error'); }
  };

  return (
    <>
      <PageHeader title="ผู้ใช้จำลอง" description="ทดสอบหน้าผู้จองโดยไม่ต้องใช้ LINE จริง (โหมด LOCAL)" />

      {conn.mode !== 'LOCAL' && (
        <p className="mb-6 flex gap-2 rounded-2xl bg-turmeric-soft px-5 py-4 text-[#6b520c]">
          <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
          ตอนนี้ระบบอยู่โหมด {conn.mode} หน้าผู้จองใช้ LINE จริง ผู้ใช้จำลองจะใช้ได้เมื่อเปลี่ยนกลับเป็นโหมด LOCAL
        </p>
      )}

      {active && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-herb bg-leaf-soft px-5 py-4">
          <span className="min-w-0 flex-1">browser นี้กำลังจำลองเป็น <b>{active.name}</b></span>
          <Button size="sm" variant="outline" icon={ExternalLink} onClick={() => window.open('/', '_blank', 'noopener')}>เปิดหน้าผู้จอง</Button>
          <Button size="sm" variant="ghost" icon={StopCircle} onClick={stop}>หยุดจำลอง</Button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
        <Card bodyClassName="p-0">
          {!users.length ? <Empty title="ยังไม่มีผู้ใช้จำลอง" /> : (
            <ul className="divide-y divide-line">
              {users.map((u) => (
                <li key={u.line_user_id} className={cx('flex flex-wrap items-center gap-3 px-5 py-4', active?.id === u.line_user_id && 'bg-leaf-soft/60')}>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{u.display_name}</div>
                    <div className="text-[14px] text-muted">
                      {u.patients ?? (u.pdpa_consent_at ? 'ยังไม่กรอกข้อมูล' : 'ผู้ใช้ใหม่ ยังไม่ยินยอม PDPA')}
                      {u.bookings > 0 && `, จองแล้ว ${u.bookings} ครั้ง`}
                    </div>
                  </div>
                  <Button size="sm" variant="soft" icon={ExternalLink} onClick={() => use(u)}>เปิดหน้าผู้จอง</Button>
                  {u.bookings === 0 && (
                    <button type="button" onClick={() => remove(u)} className="grid size-9 place-items-center rounded-lg text-muted hover:bg-rose-soft hover:text-rose-ink" aria-label={`ลบ ${u.display_name}`}>
                      <Trash2 className="size-[18px]" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="สร้างผู้ใช้จำลอง" description="เริ่มจากหน้ายินยอม PDPA เหมือนผู้ใช้ LINE ใหม่">
          <form onSubmit={create} className="space-y-3">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อที่แสดงใน LINE" maxLength={100} aria-label="ชื่อที่แสดง" />
            <Button type="submit" icon={UserPlus} className="w-full" disabled={!name.trim()}>สร้าง</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
