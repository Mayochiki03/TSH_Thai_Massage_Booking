/**
 * components/TimePicker.jsx — ตัวเลือกเวลาแบบ 24 ชั่วโมง (แทนช่อง type="time" ของ browser)
 *
 * ทำไมไม่ใช้ช่องเวลาของ browser: ช่องนั้นแสดง AM/PM ตามภาษาของเครื่อง (สั่งจากโค้ดไม่ได้)
 * และหน้าตา dropdown แต่งไม่ได้ — ตัวนี้แสดงแบบไทย "09:00 น." เสมอ และใช้ธีมเดียวกับทั้งระบบ
 *
 * การใช้งาน: กดปุ่ม → กล่องเลือกเด้งลงมา
 *   - ชั่วโมง : ตารางเฉพาะช่วงเวลาทำการ (ค่าเริ่มต้น 07–20)
 *   - นาที    : ปุ่มด่วน 00 / 15 / 30 / 45  และ "อื่น ๆ" เลือกทีละ 5 นาที
 *   - กด "ตกลง" เพื่อใช้ค่า / Esc หรือคลิกนอกกล่องเพื่อยกเลิก
 *
 * @example <TimePicker value="09:00" onChange={(v) => ...} label="เวลาเริ่ม" />
 */
import { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { cx } from './ui.jsx';

const pad = (n) => String(n).padStart(2, '0');
const QUICK_MINUTES = [0, 15, 30, 45];
const ALL_MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

/**
 * @param {object} props
 * @param {string} props.value         'HH:MM' (24 ชม.) หรือ '' ถ้ายังไม่เลือก
 * @param {(v: string) => void} props.onChange
 * @param {string} props.label         ชื่อช่อง (ใช้กับ screen reader และหัวกล่อง)
 * @param {number} [props.fromHour=7]  ชั่วโมงแรกที่ให้เลือก
 * @param {number} [props.toHour=20]   ชั่วโมงสุดท้ายที่ให้เลือก
 * @param {boolean} [props.invalid]    แสดงกรอบสีแดง (เช่น เวลาจบก่อนเวลาเริ่ม)
 */
export function TimePicker({ value, onChange, label, fromHour = 7, toHour = 20, invalid }) {
  const [open, setOpen] = useState(false);
  const [h, setH] = useState(null);
  const [m, setM] = useState(null);
  const [moreMinutes, setMoreMinutes] = useState(false);
  const boxRef = useRef(null);

  // เปิดกล่อง → ตั้งค่าเริ่มจากค่าปัจจุบัน
  const openPicker = () => {
    const [vh, vm] = (value || '').split(':').map(Number);
    setH(Number.isFinite(vh) ? vh : null);
    setM(Number.isFinite(vm) ? vm : null);
    setMoreMinutes(Number.isFinite(vm) && !QUICK_MINUTES.includes(vm));
    setOpen(true);
  };

  // ปิดเมื่อคลิกนอกกล่อง / กด Esc
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => !boxRef.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const confirm = () => {
    if (h == null || m == null) return;
    onChange(`${pad(h)}:${pad(m)}`);
    setOpen(false);
  };

  const hours = Array.from({ length: toHour - fromHour + 1 }, (_, i) => fromHour + i);
  // ค่าที่ไม่อยู่ในช่วง (เช่นข้อมูลเก่า 06:30) ยังต้องเลือกได้
  if (h != null && !hours.includes(h)) hours.unshift(h);
  const minutes = moreMinutes ? ALL_MINUTES : QUICK_MINUTES;

  const cell = (active) => cx(
    'grid h-10 place-items-center rounded-lg font-display text-[16px] tabular-nums transition-colors',
    active ? 'bg-herb font-semibold text-white' : 'text-ink hover:bg-leaf-soft',
  );

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPicker())}
        aria-label={`${label}: ${value ? `${value} น.` : 'ยังไม่เลือก'}`}
        aria-expanded={open}
        className={cx(
          'flex h-11 min-w-[7.5rem] items-center justify-between gap-2 rounded-xl border bg-paper px-3 font-display text-[17px] tabular-nums transition-colors',
          invalid ? 'border-rose-ink' : open ? 'border-herb ring-4 ring-leaf' : 'border-line hover:border-herb',
        )}
      >
        <span className={cx(!value && 'text-faint')}>{value ? `${value} น.` : '--:-- น.'}</span>
        <Clock className="size-[18px] text-muted" aria-hidden />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={label}
          className={cx(
            'anim-fade z-40 rounded-2xl border border-line bg-paper p-4 shadow-xl shadow-ink/10',
            // จอใหญ่: กล่องเด้งใต้ปุ่ม / มือถือ: ติดขอบล่างจอเต็มความกว้าง (ไม่ล้นจอ)
            'max-sm:fixed max-sm:inset-x-3 max-sm:bottom-3 sm:absolute sm:top-full sm:left-0 sm:mt-2 sm:w-[19rem]',
          )}
        >
          <div className="mb-1.5 text-[14px] text-muted">ชั่วโมง</div>
          <div className="grid grid-cols-7 gap-1">
            {hours.map((x) => (
              <button key={x} type="button" className={cell(h === x)} onClick={() => setH(x)} aria-pressed={h === x}>{pad(x)}</button>
            ))}
          </div>

          <div className="mt-3 mb-1.5 flex items-center justify-between text-[14px] text-muted">
            <span>นาที</span>
            <button type="button" className="text-herb hover:underline" onClick={() => setMoreMinutes((v) => !v)}>
              {moreMinutes ? 'แสดงแค่ 00 / 15 / 30 / 45' : 'อื่น ๆ'}
            </button>
          </div>
          <div className={cx('grid gap-1', moreMinutes ? 'grid-cols-6' : 'grid-cols-4')}>
            {minutes.map((x) => (
              <button key={x} type="button" className={cell(m === x)} onClick={() => setM(x)} aria-pressed={m === x}>{pad(x)}</button>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
            <span className="font-display text-[22px] font-semibold tabular-nums">
              {h != null ? pad(h) : '--'}:{m != null ? pad(m) : '--'} <span className="text-[15px] font-normal text-muted">น.</span>
            </span>
            <button
              type="button"
              onClick={confirm}
              disabled={h == null || m == null}
              className="h-10 rounded-xl bg-herb px-5 font-display font-medium text-white disabled:bg-line disabled:text-faint"
            >
              ตกลง
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
