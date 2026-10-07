import { query } from '../db.js';

/** บันทึก audit log (ไม่ throw — log พังต้องไม่ทำให้งานหลักพัง) */
export async function audit(req, action, entity, entityId, detail = null, executor = null) {
  try {
    let actorType = 'SYSTEM';
    let actorId = null;
    if (req?.staff) { actorType = 'STAFF'; actorId = String(req.staff.user_id); }
    else if (req?.lineUser) { actorType = 'LINE'; actorId = req.lineUser.line_user_id; }
    const sql = `INSERT INTO audit_logs (actor_type, actor_id, action, entity, entity_id, detail, ip_address)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`;
    const params = [actorType, actorId, action, entity, entityId == null ? null : String(entityId),
      detail ? JSON.stringify(detail) : null, req ? clientIp(req) : null];
    if (executor) await executor.query(sql, params);
    else await query(sql, params);
  } catch (err) {
    console.error('[audit] failed', err.message);
  }
}

export function clientIp(req) {
  return req.headers['cf-connecting-ip'] || req.ip || null;
}
