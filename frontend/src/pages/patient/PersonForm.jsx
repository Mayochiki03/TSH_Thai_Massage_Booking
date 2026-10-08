/**
 * pages/patient/PersonForm.jsx — ฟอร์มข้อมูลผู้รับบริการ (ชื่อ / นามสกุล / เลขบัตรประชาชน / เบอร์ / HN / ความสัมพันธ์)
 * ใช้ร่วมกัน: หน้าผู้จอง, หน้าเคาน์เตอร์ (walk-in), หน้าแอดมิน
 *
 * เลขบัตรประชาชนเป็นของ "ผู้รับบริการ" (ลูกจองให้แม่ → กรอกเลขบัตรของแม่) — บังคับ เว้นแต่ติ๊ก "ไม่มีบัตรไทย"
 * แก้ไขคนที่เคยบันทึกเลขแล้ว (savedMasked) → เว้นว่าง = ใช้เลขเดิม
 */
import { useState } from 'react';
import { Field, Input, cx } from '../../components/ui.jsx';
import { NationalIdField } from '../../components/NationalIdField.jsx';
import { RELATIONS } from '../../lib/format.js';
import { thaiIdError } from '../../lib/thaiId.js';

export const emptyPerson = { first_name: '', last_name: '', phone_number: '', hn: '', relation: '', national_id: '', no_national_id: false };

/**
 * ฟอร์มข้อมูลผู้รับบริการ
 * @param withRelation  แสดงช่องความสัมพันธ์ (จองให้คนอื่น)
 * @param savedMasked   เลขบัตรที่บันทึกไว้แล้ว (แบบปิดบัง) — แสดงเป็น hint
 */
export function PersonForm({ value, onChange, errors = {}, withRelation, savedMasked }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  const [customRel, setCustomRel] = useState(value.relation && !RELATIONS.includes(value.relation));

  return (
    <div className="space-y-4">
      {withRelation && (
        <div>
          <span className="mb-2 block text-[15px] font-medium">เป็นอะไรกับคุณ</span>
          <div className="flex flex-wrap gap-2">
            {RELATIONS.map((r) => {
              const active = r === 'อื่น ๆ' ? customRel : value.relation === r && !customRel;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    if (r === 'อื่น ๆ') { setCustomRel(true); onChange({ ...value, relation: '' }); }
                    else { setCustomRel(false); onChange({ ...value, relation: r }); }
                  }}
                  className={cx(
                    'h-10 rounded-full border px-4 text-[15px] transition-colors',
                    active ? 'border-herb bg-herb text-white' : 'border-line hover:border-herb',
                  )}
                  aria-pressed={active}
                >
                  {r}
                </button>
              );
            })}
          </div>
          {customRel && (
            <Input className="mt-2" placeholder="ระบุ เช่น ป้า, เพื่อน" value={value.relation} onChange={set('relation')} maxLength={50} />
          )}
          {errors.relation && <span className="mt-1 block text-sm text-rose-ink">{errors.relation}</span>}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="ชื่อ" error={errors.first_name}>
          <Input value={value.first_name} onChange={set('first_name')} autoComplete="given-name" maxLength={100} />
        </Field>
        <Field label="นามสกุล" error={errors.last_name}>
          <Input value={value.last_name} onChange={set('last_name')} autoComplete="family-name" maxLength={100} />
        </Field>
      </div>
      <NationalIdField
        value={{ national_id: value.national_id ?? '', no_national_id: !!value.no_national_id }}
        onChange={(v) => onChange({ ...value, ...v })}
        error={errors.national_id}
        savedMasked={savedMasked}
        label={withRelation ? 'เลขบัตรประชาชนของผู้รับบริการ' : 'เลขบัตรประชาชน (13 หลัก)'}
      />
      <Field label="เบอร์โทรศัพท์" error={errors.phone_number}>
        <Input value={value.phone_number} onChange={set('phone_number')} inputMode="tel" autoComplete="tel" placeholder="08xxxxxxxx" maxLength={10} />
      </Field>
      <Field label="เลข HN (ถ้ามี)" hint="ไม่มีหรือจำไม่ได้ เว้นว่างไว้ได้" error={errors.hn}>
        <Input value={value.hn ?? ''} onChange={set('hn')} autoCapitalize="characters" maxLength={20} />
      </Field>
    </div>
  );
}

/**
 * ตรวจเบื้องต้นฝั่งหน้าเว็บ (backend ตรวจซ้ำอีกชั้น)
 * @param {{ hasSavedId?: boolean }} [opts] hasSavedId = เคยบันทึกเลขบัตรแล้ว (ไม่บังคับกรอกซ้ำ)
 */
export function validatePerson(p, withRelation, { hasSavedId = false } = {}) {
  const e = {};
  const nid = p.national_id ?? '';
  if (nid) {
    const msg = thaiIdError(nid);
    if (msg) e.national_id = msg;
  } else if (!p.no_national_id && !hasSavedId) {
    e.national_id = 'กรุณากรอกเลขบัตรประชาชน หรือเลือก "ไม่มีบัตรประชาชนไทย"';
  }
  if (!p.first_name.trim()) e.first_name = 'กรุณากรอกชื่อ';
  if (!p.last_name.trim()) e.last_name = 'กรุณากรอกนามสกุล';
  if (!/^0\d{8,9}$/.test(p.phone_number.trim())) e.phone_number = 'เบอร์โทร 9–10 หลัก ขึ้นต้นด้วย 0';
  if (withRelation && !p.relation?.trim()) e.relation = 'กรุณาเลือกความสัมพันธ์';
  return e;
}

/** แปลง error.fields จาก backend เป็นข้อความแรกของแต่ละช่อง */
export const fieldErrors = (err) => Object.fromEntries(Object.entries(err?.fields ?? {}).map(([k, v]) => [k, v[0]]));

export const toPayload = (p) => ({
  first_name: p.first_name.trim(),
  last_name: p.last_name.trim(),
  phone_number: p.phone_number.trim(),
  hn: p.hn?.trim() || null,
  national_id: p.national_id || null,
  no_national_id: !p.national_id && !!p.no_national_id,
  ...(p.relation !== undefined && { relation: p.relation.trim() }),
});
