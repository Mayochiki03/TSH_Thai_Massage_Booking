/**
 * components/ClosureSheet.jsx — หน้าต่าง "ปิดรับคิว" ใช้ร่วมกันระหว่าง
 *   - ตั้งวันหยุด          (POST /api/admin/holidays)
 *   - ปิดรอบ / ปิดทั้งวัน   (POST /api/admin/slots/block)
 *
 * ขั้นตอน:
 *   1. ส่งคำขอโดยไม่มี confirm
 *   2. ถ้า backend ตอบ 409 HAS_BOOKINGS → แสดงรายชื่อคิวที่จะถูกยกเลิก ให้ผู้ดูแลกดยืนยัน
 *   3. ส่งซ้ำพร้อม confirm: true → ระบบยกเลิกคิว + แจ้ง LINE
 *   4. แสดงผล: คิวที่ไม่มี LINE (ต้องโทรแจ้งเอง) พร้อมเบอร์โทร
 */
import { useEffect, useState } from 'react';
import { TriangleAlert, PhoneCall, CircleCheck } from 'lucide-react';
import { staffApi } from '../lib/api.js';
import { thaiDate } from '../lib/format.js';
import { Button, Field, Input, Sheet, useToast } from './ui.jsx';

/**
 * @param {object} props
 * @param {null | {title: string, endpoint: string, body: object, askReason?: boolean, reasonLabel?: string, submitLabel?: string}} props.request
 * @param {() => void} props.onClose
 * @param {() => void} props.onDone  เรียกหลังปิดรับสำเร็จ (ให้หน้าแม่โหลดข้อมูลใหม่)
 */
export function ClosureSheet({ request, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [affected, setAffected] = useState(null); // รายการคิวที่จะถูกยกเลิก (หลังได้ 409)
  const [result, setResult] = useState(null);     // ผลหลังปิดรับสำเร็จ
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  useEffect(() => { setReason(''); setAffected(null); setResult(null); }, [request]);
  if (!request) return null;

  const send = async (confirm) => {
    if (request.askReason && !reason.trim()) return toast('กรุณาระบุเหตุผล', 'error');
    setLoading(true);
    try {
      const body = { ...request.body, ...(request.askReason && { reason: reason.trim() }), confirm };
      const r = await staffApi(request.endpoint, { method: 'POST', body });
      setResult(r);
      onDone?.();
    } catch (err) {
      if (err.code === 'HAS_BOOKINGS') setAffected(err.extra.appointments);
      else toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // ---------- ผลลัพธ์ ----------
  if (result) {
    return (
      <Sheet open onClose={onClose} title="ปิดรับเรียบร้อย" footer={<Button size="lg" className="w-full" onClick={onClose}>เสร็จสิ้น</Button>}>
        <p className="flex items-center gap-2 text-herb"><CircleCheck className="size-5" aria-hidden />
          {result.cancelled ? `ยกเลิก ${result.cancelled} คิว และส่งแจ้งเตือนทาง LINE แล้ว` : 'ไม่มีคิวที่ต้องยกเลิก'}
        </p>
        {result.need_call?.length > 0 && (
          <div className="mt-4 rounded-2xl bg-sand p-4">
            <p className="flex items-center gap-2 font-medium text-clay"><PhoneCall className="size-5" aria-hidden />ต้องโทรแจ้งเอง ({result.need_call.length} คน — ไม่มี LINE)</p>
            <ul className="mt-2 space-y-1 text-[15px]">
              {result.need_call.map((a) => (
                <li key={a.appointment_id}>{a.first_name} {a.last_name} — <a href={`tel:${a.phone_number}`} className="text-herb underline">{a.phone_number}</a> ({a.start_time.slice(0, 5)} น.)</li>
              ))}
            </ul>
          </div>
        )}
      </Sheet>
    );
  }

  // ---------- ขั้นยืนยันเมื่อมีคิว ----------
  if (affected) {
    return (
      <Sheet
        open
        onClose={onClose}
        title={`มีผู้จองไว้แล้ว ${affected.length} คิว`}
        footer={
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={onClose}>ไม่ปิดรับ</Button>
            <Button variant="danger" className="flex-1" loading={loading} onClick={() => send(true)}>ยกเลิกคิวและแจ้งผู้จอง</Button>
          </div>
        }
      >
        <p className="flex gap-2 text-[15px] text-clay"><TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
          คิวด้านล่างจะถูกยกเลิก ระบบจะส่ง LINE แจ้งให้จองใหม่ ส่วนคนที่ไม่มี LINE ต้องโทรแจ้งเอง
        </p>
        <ul className="mt-4 divide-y divide-line rounded-2xl border border-line">
          {affected.map((a) => (
            <li key={a.appointment_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[15px]">
              <span><b className="font-display">{a.start_time.slice(0, 5)}</b> {a.first_name} {a.last_name}</span>
              <span className="text-muted">{a.has_line ? 'แจ้งทาง LINE' : `โทร ${a.phone_number}`}</span>
            </li>
          ))}
        </ul>
      </Sheet>
    );
  }

  // ---------- ขั้นแรก ----------
  return (
    <Sheet
      open
      onClose={onClose}
      title={request.title}
      footer={<Button size="lg" className="w-full" loading={loading} onClick={() => send(false)}>{request.submitLabel ?? 'ปิดรับ'}</Button>}
    >
      {request.body?.date && <p className="mb-4 text-muted">{thaiDate(request.body.date)}</p>}
      {request.askReason && (
        <Field label={request.reasonLabel ?? 'เหตุผล'} hint="แสดงให้ผู้จองเห็นในข้อความแจ้งยกเลิก">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น หมอนวดติดอบรม" maxLength={200} autoFocus />
        </Field>
      )}
      {!request.askReason && <p>วันนี้จะปิดรับจองทั้งวัน ถ้ามีคิวที่จองไว้แล้ว ระบบจะแสดงรายชื่อให้ยืนยันก่อน</p>}
    </Sheet>
  );
}
