/**
 * lib/api.js — เรียก API แบบ JSON
 *   request()   fetch + แปลง error จาก backend เป็น ApiError (มี code / message / fields)
 *   staffApi()  เรียก /api/* ของบัญชีในระบบ (cookie session) — ตอบ 401 → เด้งไปหน้าเข้าสู่ระบบ
 */
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
