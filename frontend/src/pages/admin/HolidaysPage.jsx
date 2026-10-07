/**
 * pages/admin/HolidaysPage.jsx — วันหยุดราชการ / วันหยุดพิเศษ (CRUD /api/admin/holidays)
 *
 * เพิ่มวันหยุด: ถ้าวันนั้นมีคนจองไว้แล้ว ClosureSheet จะแสดงรายชื่อให้ยืนยัน
 * แล้วระบบยกเลิกคิว + ส่ง LINE แจ้งให้จองใหม่ (คนไม่มี LINE แสดงเบอร์ให้โทรแจ้ง)
 * ลบวันหยุด: เปิดรับรอบของวันนั้นกลับมา (คิวที่ยกเลิกไปแล้วจะไม่กลับมา)
 */
import { useState } from 'react';
import { CalendarPlus, Pencil, Trash2, Check, X } from 'lucide-react';
import { staffApi } from '../../lib/api.js';
import { useLoad } from '../../lib/useLoad.js';
import { thaiDateLong, todayYmd } from '../../lib/format.js';
import { Button, Card, Field, Input, PageHeader, Select, Spinner, Empty, useToast, useConfirm, cx } from '../../components/ui.jsx';
import { ClosureSheet } from '../../components/ClosureSheet.jsx';

export function HolidaysPage() {
  const thisYear = Number(todayYmd().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [form, setForm] = useState({ date: '', name: '' });
  const [closure, setClosure] = useState(null);
  const [editing, setEditing] = useState(null); // { date, name }
  const toast = useToast();
  const confirm = useConfirm();
  const { data, reload } = useLoad(() => staffApi(`/admin/holidays?year=${year}`).then((d) => d.holidays), [year]);

  const add = (e) => {
    e.preventDefault();
    if (!form.date || !form.name.trim()) return toast('กรอกวันที่และชื่อวันหยุด', 'error');
    setClosure({ title: `ตั้งวันหยุด: ${form.name.trim()}`, endpoint: '/admin/holidays', body: { date: form.date, name: form.name.trim() }, submitLabel: 'ตั้งเป็นวันหยุด' });
  };

  const saveName = async () => {
    try { await staffApi(`/admin/holidays/${editing.date}`, { method: 'PUT', body: { name: editing.name } }); setEditing(null); reload(); toast('บันทึกแล้ว'); }
    catch (err) { toast(err.message, 'error'); }
  };

  const remove = async (h) => {
    const ok = await confirm({ title: `ลบวันหยุด ${h.name}?`, body: 'วันนั้นจะกลับมาเปิดรับจอง (คิวที่ยกเลิกไปแล้วจะไม่กลับมา)', okText: 'ลบวันหยุด', danger: true });
    if (!ok) return;
    try { await staffApi(`/admin/holidays/${h.holiday_date}`, { method: 'DELETE' }); toast('ลบวันหยุดแล้ว'); reload(); }
    catch (err) { toast(err.message, 'error'); }
  };

  const today = todayYmd();

  return (
    <>
      <PageHeader title="วันหยุด" description="วันที่ปิดรับจอง นอกเหนือจากเสาร์–อาทิตย์" />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px] lg:items-start">
        <Card
          title={`วันหยุดปี ${year + 543}`}
          actions={
            <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="h-10 w-32" aria-label="เลือกปี">
              {[thisYear - 1, thisYear, thisYear + 1].map((y) => <option key={y} value={y}>{y + 543}</option>)}
            </Select>
          }
          bodyClassName="p-0"
        >
          {!data ? <Spinner /> : !data.length ? <Empty title="ยังไม่มีวันหยุดในปีนี้">เพิ่มจากฟอร์มด้านขวา</Empty> : (
            <ul className="divide-y divide-line">
              {data.map((h) => {
                const past = h.holiday_date < today;
                const isEditing = editing?.date === h.holiday_date;
                return (
                  <li key={h.holiday_date} className={cx('flex flex-wrap items-center gap-3 px-5 py-3', past && 'opacity-60')}>
                    <span className="w-full font-display font-medium sm:w-56">{thaiDateLong(h.holiday_date)}</span>
                    {isEditing ? (
                      <>
                        <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="h-10 min-w-0 flex-1" autoFocus aria-label="ชื่อวันหยุด" />
                        <button type="button" onClick={saveName} className="grid size-9 place-items-center rounded-lg text-herb hover:bg-leaf-soft" aria-label="บันทึก"><Check className="size-5" /></button>
                        <button type="button" onClick={() => setEditing(null)} className="grid size-9 place-items-center rounded-lg text-muted hover:bg-sand" aria-label="ยกเลิก"><X className="size-5" /></button>
                      </>
                    ) : (
                      <>
                        <span className="min-w-0 flex-1">{h.name}</span>
                        <button type="button" onClick={() => setEditing({ date: h.holiday_date, name: h.name })} className="grid size-9 place-items-center rounded-lg text-muted hover:bg-sand" aria-label={`แก้ชื่อ ${h.name}`}><Pencil className="size-[18px]" /></button>
                        <button type="button" onClick={() => remove(h)} className="grid size-9 place-items-center rounded-lg text-muted hover:bg-rose-soft hover:text-rose-ink" aria-label={`ลบ ${h.name}`}><Trash2 className="size-[18px]" /></button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="เพิ่มวันหยุด" className="lg:sticky lg:top-6">
          <form onSubmit={add} className="space-y-4">
            <Field label="วันที่">
              <Input type="date" value={form.date} min={today} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
            <Field label="ชื่อวันหยุด" hint="ผู้จองจะเห็นชื่อนี้ในข้อความแจ้งยกเลิก">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="เช่น วันหยุดชดเชยวันพ่อ" maxLength={200} />
            </Field>
            <Button type="submit" icon={CalendarPlus} className="w-full">เพิ่มวันหยุด</Button>
          </form>
        </Card>
      </div>
      <ClosureSheet request={closure} onClose={() => setClosure(null)} onDone={() => { setForm({ date: '', name: '' }); reload(); }} />
    </>
  );
}
