/**
 * lib/useLoad.js — hook โหลดข้อมูลจาก API แบบสั้น ๆ สำหรับหน้าแอดมิน
 *
 * @example
 *   const { data, loading, reload } = useLoad(() => staffApi('/admin/holidays'), []);
 *
 * - เรียก fn ตอนเข้า component และทุกครั้งที่ deps เปลี่ยน
 * - error แสดงเป็น toast อัตโนมัติ (data คงค่าเดิม)
 * - reload() ใช้เรียกซ้ำหลังบันทึก/ลบ
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '../components/ui.jsx';

export function useLoad(fn, deps) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fnRef.current();
      setData(d);
      return d;
    } catch (err) {
      toast(err.message, 'error');
      return null;
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { reload(); }, [reload]);
  return { data, setData, loading, reload };
}
