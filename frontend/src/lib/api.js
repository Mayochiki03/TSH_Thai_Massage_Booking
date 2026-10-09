/**
 * lib/api.js — เรียก API แบบ JSON
 *   request()   fetch + แปลง error จาก backend เป็น ApiError (มี code / message / fields)
 *   staffApi()  เรียก /api/* ของบัญชีในระบบ (cookie session) — ตอบ 401 → เด้งไปหน้าเข้าสู่ระบบ
 *   serverNow() เวลาปัจจุบันตามนาฬิกาเซิร์ฟเวอร์ (ms) — ใช้แทน Date.now() เวลาคำนวณเทียบกับเวลาที่บันทึกในระบบ
 */

// ---------------------------------------------------------------------
// นาฬิกาเซิร์ฟเวอร์: เครื่องลูกบางเครื่องตั้งเวลาเพี้ยน (ช้า/เร็วหลายนาที) → ตัวจับเวลา/วันที่ "วันนี้" ผิด
// จึงอ่านเวลาจาก header "Date" ของทุก response มาหาค่าต่าง แล้วใช้ serverNow() แทน Date.now()
// header ละเอียดระดับวินาที → ต่างไม่เกิน 2 วินาทีถือว่าตรง (ไม่ปรับ ไม่ให้ตัวเลขกระตุก)
// ---------------------------------------------------------------------
let clockOffset = 0;
function syncClock(res, sentAt) {
  const server = Date.parse(res.headers.get('date') ?? '');
  if (Number.isNaN(server)) return;
  const offset = server + 500 - (sentAt + Date.now()) / 2; // +500: header ตัดเศษวินาทีทิ้ง
  const next = Math.abs(offset) < 2000 ? 0 : offset;
  if (Math.abs(next - clockOffset) > 1500) clockOffset = next;
}
export const serverNow = () => Date.now() + clockOffset;
export const clockOffsetMs = () => clockOffset;
export class ApiError extends Error {
  constructor(status, body) {
    const e = body?.error ?? {};
    super(e.message || 'เชื่อมต่อระบบไม่สำเร็จ กรุณาลองใหม่');
    this.status = status;
    this.code = e.code || 'NETWORK';
    this.extra = e;
    this.fields = e.fields;
  }
}

/**
 * fetch แบบ JSON — throw ApiError เมื่อไม่ใช่ 2xx
 * @param {string} url
 * @param {{method?: string, body?: any, headers?: Record<string,string>}} [opts]
 */
export async function request(url, { method = 'GET', body, headers = {} } = {}) {
  let res;
  const sentAt = Date.now();
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, { error: { code: 'NETWORK', message: 'เชื่อมต่ออินเทอร์เน็ตไม่ได้ กรุณาลองใหม่' } });
  }
  syncClock(res, sentAt);
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

// ---------------------------------------------------------------------
// เจ้าหน้าที่ / แอดมิน (cookie session)
// ---------------------------------------------------------------------
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export async function staffApi(path, opts) {
  try {
    return await request(`/api${path}`, opts);
  } catch (err) {
    if (err.status === 401 && !path.startsWith('/auth/login')) onUnauthorized(err);
    throw err;
  }
}
