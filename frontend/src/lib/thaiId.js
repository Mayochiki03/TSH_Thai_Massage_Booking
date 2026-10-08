/**
 * lib/thaiId.js — เลขบัตรประชาชนไทย 13 หลัก (ฝั่งหน้าเว็บ — backend ตรวจซ้ำอีกชั้นเสมอ)
 *   digitsOnly('1-2345-...')  → '12345...'
 *   formatThaiId(digits)      → '1-2345-67890-12-3' (จัดรูปแบบระหว่างพิมพ์ได้ แม้ยังไม่ครบ 13 หลัก)
 *   isValidThaiId(digits)     → ตรวจ 13 หลัก + เลขหลักสุดท้าย (mod 11)
 *   thaiIdError(digits)       → ข้อความ error ภาษาไทย หรือ null
 */
export const digitsOnly = (s) => String(s ?? '').replace(/\D/g, '').slice(0, 13);

/** จัดรูปแบบ 1-2345-67890-12-3 ระหว่างพิมพ์ */
export function formatThaiId(raw) {
  const d = digitsOnly(raw);
  const parts = [d.slice(0, 1), d.slice(1, 5), d.slice(5, 10), d.slice(10, 12), d.slice(12, 13)];
  return parts.filter(Boolean).join('-');
}

export function isValidThaiId(digits) {
  if (!/^\d{13}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(digits[12]);
}

export function thaiIdError(digits) {
  if (!digits) return 'กรุณากรอกเลขบัตรประชาชน';
  if (digits.length < 13) return `กรอกให้ครบ 13 หลัก (ตอนนี้ ${digits.length} หลัก)`;
  if (!isValidThaiId(digits)) return 'เลขบัตรประชาชนไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง';
  return null;
}
