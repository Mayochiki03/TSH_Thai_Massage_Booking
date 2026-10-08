/**
 * components/NationalIdField.jsx — ช่องกรอกเลขบัตรประชาชน 13 หลัก ของ "ผู้รับบริการ"
 *
 *  - จัดรูปแบบ 1-2345-67890-12-3 ให้ระหว่างพิมพ์ (แป้นตัวเลขบนมือถือ)
 *  - ติ๊ก "ไม่มีบัตรประชาชนไทย" ได้ (เช่น ชาวต่างชาติ) → ไม่ต้องกรอก
 *  - savedMasked: ถ้าเคยบันทึกแล้ว แสดงแบบปิดบัง และไม่บังคับกรอกซ้ำ (เว้นว่าง = ใช้เลขเดิม)
 *
 * value: { national_id: 'ตัวเลขล้วน', no_national_id: boolean }
 */
import { IdCard } from 'lucide-react';
import { Field, cx } from './ui.jsx';
import { digitsOnly, formatThaiId } from '../lib/thaiId.js';

export function NationalIdField({ value, onChange, error, savedMasked, label = 'เลขบัตรประชาชน (13 หลัก)', hint, allowNone = true, autoFocus }) {
  const digits = value.national_id ?? '';
  const none = !!value.no_national_id;
  const set = (patch) => onChange({ ...value, ...patch });

  return (
    <div>
      <Field
        label={label}
        error={error}
        hint={hint ?? (savedMasked ? `บันทึกไว้แล้ว ${savedMasked} — เว้นว่างเพื่อใช้เลขเดิม` : 'ของผู้รับบริการ (คนที่มานวด) ใช้ยืนยันตัวตนกับโรงพยาบาล')}
      >
        <div className="relative">
          <IdCard className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-faint" aria-hidden />
          <input
            value={formatThaiId(digits)}
            onChange={(e) => set({ national_id: digitsOnly(e.target.value), no_national_id: false })}
            disabled={none}
            inputMode="numeric"
            autoComplete="off"
            autoFocus={autoFocus}
            placeholder={savedMasked ?? 'x-xxxx-xxxxx-xx-x'}
            maxLength={17}
            className={cx(
              'h-12 w-full rounded-xl border bg-paper pr-4 pl-12 font-display text-[18px] tracking-wide tabular-nums placeholder:font-sans placeholder:text-[16px] placeholder:tracking-normal placeholder:text-faint',
              'focus:border-herb focus:outline-none focus:ring-4 focus:ring-leaf disabled:bg-sand disabled:text-faint',
              error ? 'border-rose-ink' : 'border-line',
            )}
            aria-invalid={!!error}
          />
        </div>
      </Field>
      {allowNone && !savedMasked && (
        <label className="mt-2 flex w-fit cursor-pointer items-center gap-2 text-[15px] text-muted">
          <input
            type="checkbox"
            checked={none}
            onChange={(e) => set({ no_national_id: e.target.checked, national_id: e.target.checked ? '' : digits })}
            className="size-5 accent-herb"
          />
          ไม่มีบัตรประชาชนไทย (เช่น ชาวต่างชาติ)
        </label>
      )}
    </div>
  );
}
