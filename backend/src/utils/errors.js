import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(status, code, message, extra = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const badRequest = (code, msg, extra) => new HttpError(400, code, msg, extra);
export const forbidden = (msg = 'ไม่มีสิทธิ์ทำรายการนี้') => new HttpError(403, 'FORBIDDEN', msg);
export const notFound = (msg = 'ไม่พบข้อมูล') => new HttpError(404, 'NOT_FOUND', msg);
export const conflict = (code, msg, extra) => new HttpError(409, code, msg, extra);

/** ห่อ async route handler ให้ส่ง error เข้า errorHandler */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: { code: 'VALIDATION', message: 'ข้อมูลไม่ถูกต้อง', fields: err.flatten().fieldErrors },
    });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.extra ?? {}) } });
  }
  if (err?.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: { code: 'DUPLICATE', message: 'ข้อมูลซ้ำกับที่มีอยู่แล้ว' } });
  }
  if (err?.code === 'ER_ROW_IS_REFERENCED_2') {
    return res.status(409).json({ error: { code: 'IN_USE', message: 'ลบไม่ได้ เพราะข้อมูลนี้ถูกใช้งานอยู่' } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'รูปแบบข้อมูลไม่ถูกต้อง' } });
  }
  console.error('[error]', req.method, req.originalUrl, err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'เกิดข้อผิดพลาดในระบบ' } });
}
