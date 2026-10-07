/**
 * pages/patient/TicketPage.jsx — e-ticket ของการจอง 1 คิว (/ticket/:code)
 *
 *  - จองเสร็จใหม่ (?new=1)    : แสดง "จองสำเร็จ" + ส่งตั๋วเข้าแชท LINE อัตโนมัติ 1 ครั้ง
 *  - ลิงก์จากข้อความเตือน LINE : ?action=confirm → ยืนยันมาตามนัด, ?action=cancel → ถามยืนยันการยกเลิก
 *  - ยกเลิกได้ถึง patient_cancel_min นาทีก่อนนัด หลังจากนั้นแสดงเบอร์โทรเคาน์เตอร์แทน
 *
 * Responsive: มือถือเรียงบนลงล่าง / จอกว้างวางตั๋วซ้าย + ปุ่มและคำแนะนำขวา
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Phone, CalendarPlus, ListOrdered, CircleCheck, XCircle } from 'lucide-react';
import { patientApi, sendTicketToChat, isLocalMode } from '../../lib/liff.js';
import { thaiDateLong, relativeDay } from '../../lib/format.js';
import { Button, Spinner, StatusBadge, Empty, useToast, useConfirm, cx } from '../../components/ui.jsx';
import { usePatient } from './PatientApp.jsx';

export function TicketPage() {
  const { code } = useParams();
  const [params, setParams] = useSearchParams();
  const { config } = usePatient();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [t, setT] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(null);
  const isNew = params.get('new') === '1';
  const handledAction = useRef(false);

  const load = useCallback(async () => {
    try { setT(await patientApi(`/bookings/${code}`)); }
    catch (err) { if (err.status === 404) setNotFound(true); else toast(err.message, 'error'); }
  }, [code, toast]);

  useEffect(() => { load(); }, [load]);

  // จองเสร็จใหม่ → ส่งตั๋วเข้าแชท LINE (ครั้งเดียว)
  useEffect(() => {
    if (!t || !isNew) return;
    const key = `tmb_sent_${t.booking_code}`;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch { /* ignore */ }
    sendTicketToChat(t);
  }, [t, isNew]);

  const doConfirm = useCallback(async () => {
    setBusy('confirm');
    try { setT({ ...(await patientApi(`/bookings/${code}/confirm`, { method: 'POST' })), can_cancel: t?.can_cancel, can_confirm: false }); toast('ยืนยันแล้ว แล้วพบกันตามนัด'); }
    catch (err) { toast(err.message, 'error'); }
    finally { setBusy(null); }
  }, [code, t?.can_cancel, toast]);

  const doCancel = useCallback(async () => {
    const ok = await confirm({
      title: 'ยกเลิกคิวนี้?', body: 'รอบเวลานี้จะเปิดให้คนอื่นจองแทน ถ้าต้องการมาใหม่ต้องจองอีกครั้ง',
      okText: 'ยกเลิกคิว', cancelText: 'ไม่ยกเลิก', danger: true,
    });
    if (!ok) return;
    setBusy('cancel');
    try { await patientApi(`/bookings/${code}/cancel`, { method: 'POST' }); await load(); toast('ยกเลิกคิวแล้ว'); }
    catch (err) { toast(err.message, 'error'); }
    finally { setBusy(null); }
  }, [code, confirm, load, toast]);

  // ลิงก์จากข้อความเตือน LINE: ?action=confirm / ?action=cancel
  useEffect(() => {
    if (!t || handledAction.current) return;
    const action = params.get('action');
    if (!action) return;
    handledAction.current = true;
    setParams({}, { replace: true });
    if (action === 'confirm' && t.can_confirm) doConfirm();
    else if (action === 'cancel' && t.can_cancel) doCancel();
    else if (action === 'cancel' && t.status === 'BOOKED') toast('เลยเวลายกเลิกออนไลน์แล้ว กรุณาโทรแจ้งเคาน์เตอร์', 'info');
  }, [t, params, setParams, doConfirm, doCancel, toast]);

  if (notFound) {
    return (
      <Empty icon={XCircle} title="ไม่พบตั๋วนี้" action={<Button onClick={() => navigate('/my')}>ดูการจองของฉัน</Button>}>
        รหัส {code} อาจไม่ถูกต้อง หรือไม่ได้จองจากบัญชี LINE นี้
      </Empty>
    );
  }
  if (!t) return <Spinner />;

  const inactive = ['CANCELLED', 'NO_SHOW'].includes(t.status);
  const rel = relativeDay(t.slot_date);

  return (
    <div className="mx-auto max-w-4xl pt-6 pb-10 lg:pt-10">
      {isNew && t.status === 'BOOKED' && (
        <div className="mb-6 flex items-center gap-3">
          <svg viewBox="0 0 40 40" className="anim-pop size-12 shrink-0" aria-hidden>
            <circle cx="20" cy="20" r="20" fill="#2F6B4F" />
            <path d="M12 20.5l5.5 5.5L28.5 15" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" className="check-draw" />
          </svg>
          <div>
            <h1 className="text-[24px] font-semibold leading-tight">จองสำเร็จ</h1>
            <p className="text-[15px] text-muted">{isLocalMode() ? 'เก็บรหัสนี้ไว้แสดงที่เคาน์เตอร์' : 'ส่งตั๋วเข้าแชท LINE ให้แล้ว'}</p>
          </div>
        </div>
      )}

      <div className="grid gap-8 md:grid-cols-[minmax(0,420px)_1fr] md:items-start">
      {/* ตั๋ว */}
      <article
        className={cx('anim-rise overflow-hidden rounded-[22px] border border-line bg-paper', inactive && 'opacity-75')}
        style={{ '--notch-bg': 'var(--color-paper)' }}
        aria-label={`ตั๋วรหัส ${t.booking_code}`}
      >
        <div className={cx('px-6 pt-5 pb-6', inactive ? 'bg-stone-soft' : 'bg-herb')}>
          <div className="flex items-center justify-between">
            <span className={cx('text-[14px]', inactive ? 'text-stone-ink' : 'text-leaf')}>รหัสจอง</span>
            <StatusBadge status={t.status} className={inactive ? '' : 'bg-white/15 text-white'} />
          </div>
          <div
            className={cx('mt-1 font-display text-[44px] font-semibold leading-none tracking-[0.14em]', inactive ? 'text-stone-ink line-through decoration-2' : 'text-white')}
            aria-label={t.booking_code.split('').join(' ')}
          >
            {t.booking_code.slice(0, 3)}<span className="inline-block w-2" />{t.booking_code.slice(3)}
          </div>
        </div>

        <div className="ticket-notch border-t-2 border-dashed border-line" />

        <dl className="space-y-4 px-6 pt-5 pb-6">
          <div>
            <dt className="text-[14px] text-muted">วันที่{rel ? ` (${rel})` : ''}</dt>
            <dd className="font-display text-[19px] font-semibold">{thaiDateLong(t.slot_date)}</dd>
          </div>
          <div>
            <dt className="text-[14px] text-muted">เวลา</dt>
            <dd className="font-display text-[19px] font-semibold">{t.start_time}–{t.end_time} น.</dd>
          </div>
          <div>
            <dt className="text-[14px] text-muted">ผู้รับบริการ</dt>
            <dd className="text-[17px] font-medium">
              {t.patient.first_name} {t.patient.last_name}
              {t.relation && t.relation !== 'ตนเอง' && <span className="font-normal text-muted"> ({t.relation}ของคุณ)</span>}
            </dd>
          </div>
          {t.chief_complaint && (
            <div>
              <dt className="text-[14px] text-muted">อาการ</dt>
              <dd>{t.chief_complaint}</dd>
            </div>
          )}
          {t.status === 'CANCELLED' && t.cancel_reason && (
            <div>
              <dt className="text-[14px] text-muted">เหตุผลที่ยกเลิก</dt>
              <dd>{t.cancel_reason}</dd>
            </div>
          )}
        </dl>

        {t.status === 'BOOKED' && (
          <div className="mx-6 mb-6 rounded-xl bg-turmeric-soft px-4 py-3 text-[15px] text-[#6b520c] md:hidden">
            แสดงรหัสนี้ที่เคาน์เตอร์แพทย์แผนไทย ก่อนเวลานัด 10–15 นาที
          </div>
        )}
      </article>

      {/* การกระทำ + คำแนะนำ */}
      <div className="space-y-3">
        <div className="hidden rounded-2xl bg-sand px-5 py-4 text-[15px] text-clay md:block">
          <p className="font-display font-medium">วันนัดหมาย</p>
          <p className="mt-1">มาถึงก่อนเวลานัด 10–15 นาที แจ้งรหัสจองที่เคาน์เตอร์แพทย์แผนไทย ถ้ามาสายเกิน 10 นาทีคิวจะถูกยกเลิก</p>
        </div>
        {t.can_confirm && (
          <Button size="lg" icon={CircleCheck} className="w-full" loading={busy === 'confirm'} onClick={doConfirm}>ยืนยันว่ามาตามนัด</Button>
        )}
        {t.status === 'BOOKED' && t.confirmed && (
          <p className="flex items-center justify-center gap-2 text-herb"><CircleCheck className="size-5" aria-hidden />ยืนยันมาตามนัดแล้ว</p>
        )}
        {t.can_cancel && (
          <Button variant="outline" size="lg" className="w-full" loading={busy === 'cancel'} onClick={doCancel}>ยกเลิกคิว</Button>
        )}
        {t.status === 'BOOKED' && !t.can_cancel && config.counter_phone && (
          <a href={`tel:${config.counter_phone}`} className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl border border-line font-display font-medium hover:border-herb">
            <Phone className="size-5" aria-hidden />ยกเลิกหรือเลื่อนนัด โทร {config.counter_phone}
          </a>
        )}
        {inactive && (
          <Button size="lg" icon={CalendarPlus} className="w-full" onClick={() => navigate('/')}>จองคิวใหม่</Button>
        )}
        <Link to="/my" className="flex h-12 items-center justify-center gap-2 text-[15px] text-muted hover:text-herb">
          <ListOrdered className="size-[18px]" aria-hidden />ดูการจองทั้งหมด
        </Link>
      </div>
      </div>
    </div>
  );
}
