import { z } from 'zod';

const trimmed = (max) => z.string().trim().min(1, 'กรุณากรอกข้อมูล').max(max);

export const patientInput = z.object({
  first_name: trimmed(100),
  last_name: trimmed(100),
  phone_number: z.string().trim().regex(/^0\d{8,9}$/, 'เบอร์โทรไม่ถูกต้อง (0xxxxxxxxx)'),
  hn: z.string().trim().max(20).regex(/^[A-Za-z0-9/-]*$/, 'HN ไม่ถูกต้อง').optional().nullable()
    .transform((v) => (v ? v.toUpperCase() : null)),
});

export const relationInput = z.string().trim().min(1).max(50);

export const idParam = z.coerce.number().int().positive();
export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ต้องเป็น YYYY-MM-DD');
export const timeStr = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'รูปแบบเวลาต้องเป็น HH:MM');
export const codeParam = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6}$/, 'รหัสจองไม่ถูกต้อง');
