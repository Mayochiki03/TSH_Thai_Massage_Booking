/**
 * pages/admin/ServiceTypesPage.jsx — ประเภทบริการและราคา (CRUD /api/admin/service-types)
 *
 *  - ผู้รับบริการเลือกประเภทตอนจอง (LINE / kiosk / เคาน์เตอร์) เวลานวดเท่ากัน ต่างแค่ราคา
 *  - แก้ราคา → มีผลกับ "การจองใหม่" เท่านั้น คิวเดิมเก็บราคาตอนจองไว้แล้ว (รายงานย้อนหลังไม่เพี้ยน)
 *  - ประเภทที่เคยถูกจองแล้วลบไม่ได้ → ปิดการใช้งานแทน (ชื่อยังอยู่ในรายงานเก่า)
 *  - ต้องเปิดใช้งานอย่างน้อย 1 ประเภทเสมอ
 *  - ลำดับ (sort_order) น้อย = แสดงก่อน
 *  - สวิตช์ "แสดงราคาให้ผู้รับบริการเห็น" (setting show_price, ค่าเริ่มต้น = ปิด)
 *      ปิด → หน้าจอง LINE / kiosk / ตั๋ว / ข้อความ LINE ไม่มีราคา (backend ไม่ส่งราคาออกไปเลย)
 *      เจ้าหน้าที่ / ผู้ดูแล / รายงาน Excel (รายคิว) ยังเห็นราคาเสมอ — ระบบไม่สรุปรายได้
 */
import { useState } from 'react';
import { Plus, Pencil, Trash2, Tags, Info } from 'lucide-react';
import { staffApi } from '../../lib/api.js';
import { useLoad } from '../../lib/useLoad.js';
import { baht } from '../../lib/format.js';
import { Button, Card, Field, Input, PageHeader, Sheet, Spinner, Empty, Switch, useToast, useConfirm, cx } from '../../components/ui.jsx';

const blank = { name: '', description: '', price: '', sort_order: 0, is_active: true };

export function ServiceTypesPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, reload } = useLoad(() => staffApi('/admin/service-types').then((d) => d.service_types), []);
  const [edit, setEdit] = useState(null); // { id?, ...form }
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const { data: showPrice, setData: setShowPrice } = useLoad(
    () => staffApi('/admin/settings').then((d) => !!d.settings.find((s) => s.key === 'show_price')?.value),
    [],
  );

  const toggleShowPrice = async (v) => {
    setShowPrice(v);
    try {
      await staffApi('/admin/settings', { method: 'PUT', body: { show_price: v } });
      toast(v ? 'ผู้รับบริการจะเห็นราคาตอนจอง' : 'ซ่อนราคาจากผู้รับบริการแล้ว');
    } catch (err) {
      setShowPrice(!v);
      toast(err.message, 'error');
    }
  };

  const open = (st) => {
    setErrors({});
    setEdit(st
      ? { id: st.service_type_id, name: st.name, description: st.description ?? '', price: String(st.price), sort_order: st.sort_order, is_active: st.is_active, used: st.used }
      : { ...blank, sort_order: (data?.length ?? 0) + 1 });
  };

  const save = async (e) => {
    e?.preventDefault();
    const errs = {};
    if (!edit.name.trim()) errs.name = 'กรุณากรอกชื่อบริการ';
    const price = Number(edit.price);
    if (edit.price === '' || !Number.isFinite(price) || price < 0) errs.price = 'กรอกราคาเป็นตัวเลข (0 ขึ้นไป)';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const body = { name: edit.name.trim(), description: edit.description.trim() || null, price, sort_order: Number(edit.sort_order) || 0, is_active: edit.is_active };
      if (edit.id) await staffApi(`/admin/service-types/${edit.id}`, { method: 'PUT', body });
      else await staffApi('/admin/service-types', { method: 'POST', body });
      toast(edit.id ? 'บันทึกแล้ว — ราคาใหม่มีผลกับการจองใหม่' : 'เพิ่มบริการแล้ว');
      setEdit(null);
      reload();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (st) => {
    const ok = await confirm({ title: `ลบ "${st.name}"?`, body: 'ลบได้เฉพาะบริการที่ยังไม่เคยมีใครจอง', okText: 'ลบ', danger: true });
    if (!ok) return;
    try { await staffApi(`/admin/service-types/${st.service_type_id}`, { method: 'DELETE' }); toast('ลบแล้ว'); reload(); }
    catch (err) { toast(err.message, 'error'); }
  };

  return (
    <>
      <PageHeader
        title="ประเภทบริการและราคา"
        description="ตัวเลือกที่ผู้รับบริการเห็นตอนจอง"
        actions={<Button icon={Plus} onClick={() => open(null)}>เพิ่มบริการ</Button>}
      />

      <Card className="mb-4">
        {showPrice == null ? <Spinner /> : (
          <Switch
            checked={showPrice}
            onChange={toggleShowPrice}
            label="แสดงราคาให้ผู้รับบริการเห็น"
            description={showPrice
              ? 'เปิดอยู่ — หน้าจอง LINE, kiosk, ตั๋ว และข้อความ LINE แสดงราคา'
              : 'ปิดอยู่ — ผู้รับบริการเห็นแค่ชื่อบริการ (เจ้าหน้าที่และรายงาน Excel ยังเห็นราคา)'}
          />
        )}
      </Card>

      <div className="mb-4 flex gap-3 rounded-2xl bg-turmeric-soft/60 p-4 text-[15px] text-ink">
        <Info className="mt-0.5 size-5 shrink-0 text-clay" aria-hidden />
        <p>แก้ราคาแล้ว <b>มีผลกับการจองใหม่เท่านั้น</b> — คิวที่จองไว้แล้วใช้ราคาตอนจอง (รายงานย้อนหลังจึงไม่เปลี่ยน)
          ถ้าบริการไหนเลิกให้บริการ ให้ <b>ปิดการใช้งาน</b> แทนการลบ</p>
      </div>

      <Card bodyClassName="p-0">
        {!data ? <Spinner /> : !data.length ? (
          <Empty icon={Tags} title="ยังไม่มีประเภทบริการ" action={<Button icon={Plus} onClick={() => open(null)}>เพิ่มบริการ</Button>} />
        ) : (
          <ul className="divide-y divide-line">
            {data.map((st) => (
              <li key={st.service_type_id} className={cx('flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4', !st.is_active && 'opacity-60')}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{st.name}</span>
                    {!st.is_active && <span className="rounded-full bg-sand px-2 py-0.5 text-[13px] text-muted">ปิดใช้งาน</span>}
                  </div>
                  {st.description && <p className="text-[15px] text-muted">{st.description}</p>}
                  <p className="text-[13px] text-faint">ลำดับ {st.sort_order} · ถูกจองแล้ว {st.used.toLocaleString('th-TH')} ครั้ง</p>
                </div>
                <span className="font-display text-lg font-semibold text-herb tabular-nums">{baht(st.price)}</span>
                <div className="flex gap-1">
                  <button type="button" onClick={() => open(st)} className="grid size-9 place-items-center rounded-lg text-muted hover:bg-sand" aria-label={`แก้ไข ${st.name}`}><Pencil className="size-[18px]" /></button>
                  {st.used === 0 && (
                    <button type="button" onClick={() => remove(st)} className="grid size-9 place-items-center rounded-lg text-muted hover:bg-rose-soft hover:text-rose-ink" aria-label={`ลบ ${st.name}`}><Trash2 className="size-[18px]" /></button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Sheet
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? 'แก้ไขบริการ' : 'เพิ่มบริการ'}
        footer={<Button className="w-full" loading={saving} onClick={save}>บันทึก</Button>}
      >
        {edit && (
          <form onSubmit={save} className="space-y-4">
            <Field label="ชื่อบริการ" error={errors.name}>
              <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={100} placeholder="เช่น นวดแผนไทย + ประคบสมุนไพร" />
            </Field>
            <Field label="คำอธิบาย (ไม่บังคับ)" hint="แสดงใต้ชื่อตอนเลือกบริการ">
              <Input value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} maxLength={255} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="ราคา (บาท)" error={errors.price}>
                <Input type="number" inputMode="decimal" min={0} step="1" value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} />
              </Field>
              <Field label="ลำดับแสดง">
                <Input type="number" inputMode="numeric" value={edit.sort_order} onChange={(e) => setEdit({ ...edit, sort_order: e.target.value })} />
              </Field>
            </div>
            <Switch
              checked={edit.is_active}
              onChange={(v) => setEdit({ ...edit, is_active: v })}
              label="เปิดให้จอง"
              description={edit.used ? `เคยถูกจองแล้ว ${edit.used} ครั้ง — ปิดได้ แต่ลบไม่ได้` : 'ปิดไว้ = ไม่แสดงตอนจอง'}
            />
            <button type="submit" hidden />
          </form>
        )}
      </Sheet>
    </>
  );
}
