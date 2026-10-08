/**
 * routes/schemas.js — รูปแบบข้อมูลที่ใช้ตรวจ request (zod) ร่วมกันหลาย route
 */
import { z } from 'zod';
import { normalizeThaiId, isValidThaiId } from '../utils/nationalId.js';

const trimmed = (max) => z.string().trim().min(1, 'กรุณากรอกข้อมูล').max(max);

/**
 * เลขบัตรประชาชน 13 หลัก — รับได้ทั้งแบบมีขีด/ช่องว่าง, ตรวจเลขหลักสุดท้าย (checksum)
 * ว่าง/ไม่ส่ง = ไม่เปลี่ยนค่าเดิม (การบังคับกรอกตรวจที่ services/patients.js และตอนจอง)
 */
export const nationalIdInput = z.string().optional().nullable()
  .transform((v) => (v ? normalizeThaiId(v) : null))
  .refine((v) => v === null || isValidThaiId(v), 'เลขบัตรประชาชนไม่ถูกต้อง (13 หลัก)');

export const patientInput = z.object({
  first_name: trimmed(100),
  last_name: trimmed(100),
  phone_number: z.string().trim().regex(/^0\d{8,9}$/, 'เบอร์โทรไม่ถูกต้อง (0xxxxxxxxx)'),
  hn: z.string().trim().max(20).regex(/^[A-Za-z0-9/-]*$/, 'HN ไม่ถูกต้อง').optional().nullable()
    .transform((v) => (v ? v.toUpperCase() : null)),
  national_id: nationalIdInput,
  no_national_id: z.boolean().optional().default(false), // ไม่มีบัตรประชาชนไทย (เช่น ชาวต่างชาติ)
});

export const relationInput = z.string().trim().min(1).max(50);

export const idParam = z.coerce.number().int().positive();
export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ต้องเป็น YYYY-MM-DD');
export const timeStr = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'รูปแบบเวลาต้องเป็น HH:MM');
export const codeParam = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6}$/, 'รหัสจองไม่ถูกต้อง');

/** VN (Visit Number) ของโรงพยาบาล — ตัวเลข/ตัวอักษร ไม่เกิน 20 ตัว, ว่าง = ลบ */
export const vnInput = z.string().trim().max(20).regex(/^[A-Za-z0-9/-]*$/, 'VN ไม่ถูกต้อง').optional().nullable()
  .transform((v) => (v === undefined ? undefined : v ? v.toUpperCase() : null));

export const serviceTypeId = z.coerce.number().int().positive({ message: 'กรุณาเลือกประเภทบริการ' });
