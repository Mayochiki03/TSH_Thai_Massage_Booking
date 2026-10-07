/**
 * pages/kiosk/KioskApp.jsx — หน้าจอ kiosk หน้าคลินิก (/kiosk)
 *
 * ผู้ป่วย walk-in ใช้เองบนจอสัมผัส ไม่ต้องมี LINE:
 *   จองคิว   : เลือกรอบ → ใส่เบอร์โทร (ค้นข้อมูลเดิม หรือกรอกชื่อใหม่) → ยืนยัน → ได้รหัสจอง
 *   เช็กอิน   : ใส่รหัสจอง 6 ตัว → ใส่เลข 4 ตัวท้ายเบอร์โทร → เช็กอินเรียบร้อย
 *
 * รองรับทุกขนาดจอ (ไม่รู้ขนาดเครื่องจริง):
 *   - ขนาดทุกอย่างอ้างอิงหน่วย em จาก font-size ฐาน = clamp(16px, 2.3vmin, 34px)
 *     → จอใหญ่/เล็ก ตัวอักษรและปุ่มขยาย/ย่อตามสัดส่วนจอเอง
 *   - แนวนอน (landscape) วางซ้าย-ขวา / แนวตั้ง (portrait) เรียงบน-ล่าง
 *
 * ความเป็นส่วนตัว (จอสาธารณะ):
 *   - ชื่อที่แสดงถูกปิดบังนามสกุล, ไม่แสดงเบอร์เต็ม / HN
 *   - ไม่มีคนใช้งานเกิน kiosk_idle_sec วินาที → ถามว่ายังใช้อยู่ไหม แล้วกลับหน้าแรกเอง
 *
 * ต้องล็อกอินด้วยบัญชี KIOSK ครั้งเดียวตอนติดตั้งเครื่อง (session 30 วัน)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarPlus, ScanLine, ChevronLeft, Delete, Check, Hand, CircleAlert, Home } from 'lucide-react';
import { staffApi } from '../../lib/api.js';
import { SessionGate } from '../../lib/session.jsx';
import { relativeDay, weekdayShort, dayNum, monthShort, thaiDateLong, todayYmd } from '../../lib/format.js';
import { CompressMark } from '../../components/Logo.jsx';
import { cx } from '../../components/ui.jsx';

export function KioskApp() {
  return (
    <SessionGate roles={['KIOSK', 'ADMIN']} appName="เครื่อง kiosk หน้าคลินิก">
      <Kiosk />
    </SessionGate>
  );
}

/** ตัวอักษรที่ใช้ในรหัสจอง (ต้องตรงกับ backend utils/crypto.js) */
const CODE_KEYS = 'ACDEFGHJKMNPQRTUVWXYZ234679'.split('');
const COMPLAINTS = ['ปวดคอ บ่า ไหล่', 'ปวดหลัง', 'ปวดเอว', 'ปวดเข่า', 'ตึงน่อง', 'ปวดศีรษะ'];

// =====================================================================
// ตัวควบคุมหลัก: หน้าปัจจุบัน + ตัวจับเวลาไม่มีคนใช้
// =====================================================================
function Kiosk() {
  const [config, setConfig] = useState(null);
  const [screen, setScreen] = useState('home'); // home | book | checkin
  const [resetKey, setResetKey] = useState(0);  // เปลี่ยนค่า = ล้าง state ของ flow ทั้งหมด
  const [idleWarn, setIdleWarn] = useState(false);
  const lastTouch = useRef(Date.now());

  useEffect(() => { staffApi('/kiosk/config').then(setConfig).catch(() => setConfig({ kiosk_idle_sec: 60 })); }, []);

  const goHome = useCallback(() => { setScreen('home'); setIdleWarn(false); setResetKey((k) => k + 1); }, []);

  // จับเวลาไม่มีคนใช้: แตะ/พิมพ์ = รีเซ็ต, เกินเวลา → เตือน 10 วิ → กลับหน้าแรก
  useEffect(() => {
    const touch = () => { lastTouch.current = Date.now(); setIdleWarn(false); };
    window.addEventListener('pointerdown', touch);
    window.addEventListener('keydown', touch);
    const t = setInterval(() => {
      if (screen === 'home') return;
      const idle = (Date.now() - lastTouch.current) / 1000;
      const limit = config?.kiosk_idle_sec ?? 60;
      if (idle > limit + 10) goHome();
      else if (idle > limit) setIdleWarn(true);
    }, 1000);
    return () => { window.removeEventListener('pointerdown', touch); window.removeEventListener('keydown', touch); clearInterval(t); };
  }, [screen, config, goHome]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-ivory text-ink select-none" style={{ fontSize: 'clamp(16px, 2.3vmin, 34px)' }}>
      <TopBar clinic={config?.clinic_name} />
      <main className="min-h-0 flex-1 overflow-y-auto px-[1.5em] py-[1em]">
        {screen === 'home' && <HomeScreen onBook={() => setScreen('book')} onCheckIn={() => setScreen('checkin')} />}
        {screen === 'book' && <BookFlow key={`b${resetKey}`} onHome={goHome} />}
        {screen === 'checkin' && <CheckInFlow key={`c${resetKey}`} onHome={goHome} />}
      </main>
      <footer className="flex items-center justify-between gap-[1em] border-t border-line bg-paper px-[1.5em] py-[0.6em] text-[0.85em] text-muted">
        <span>ต้องการความช่วยเหลือ ติดต่อเจ้าหน้าที่ที่เคาน์เตอร์{config?.counter_phone ? ` โทร ${config.counter_phone}` : ''}</span>
        {screen !== 'home' && (
          <button type="button" onClick={goHome} className="flex items-center gap-[0.4em] rounded-[0.6em] px-[0.8em] py-[0.4em] text-ink hover:bg-sand">
            <Home className="size-[1.2em]" aria-hidden />หน้าแรก
          </button>
        )}
      </footer>

      {idleWarn && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-[1.5em]" role="alertdialog" aria-label="ยังใช้งานอยู่ไหม">
          <div className="anim-rise w-full max-w-[22em] rounded-[1.2em] bg-paper p-[1.5em] text-center">
            <Hand className="mx-auto size-[2.4em] text-clay" aria-hidden />
            <p className="mt-[0.5em] font-display text-[1.4em] font-semibold">ยังใช้งานอยู่ไหม</p>
            <p className="mt-[0.3em] text-muted">ไม่มีการแตะหน้าจอสักพัก จะกลับหน้าแรกใน 10 วินาที</p>
            <button type="button" onClick={() => { lastTouch.current = Date.now(); setIdleWarn(false); }} className="mt-[1.2em] h-[3em] w-full rounded-[0.8em] bg-herb font-display text-[1.1em] font-medium text-white">
              ใช้งานต่อ
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** แถบบน: ชื่อคลินิก + นาฬิกา */
function TopBar({ clinic }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15_000); return () => clearInterval(t); }, []);
  const time = new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }).format(now);
  return (
    <header className="flex items-center justify-between gap-[1em] border-b border-line bg-paper px-[1.5em] py-[0.7em]">
      <div className="flex min-w-0 items-center gap-[0.6em]">
        <CompressMark className="size-[2.4em] shrink-0" />
        <div className="min-w-0 leading-tight">
          <div className="truncate font-display text-[1.15em] font-semibold">{clinic ?? 'คลินิกแพทย์แผนไทย'}</div>
          <div className="text-[0.8em] text-clay">จุดบริการตนเอง</div>
        </div>
      </div>
      <div className="text-right leading-tight">
        <div className="font-display text-[1.6em] font-semibold tabular-nums">{time}</div>
        <div className="text-[0.8em] text-muted">{thaiDateLong(todayYmd())}</div>
      </div>
    </header>
  );
}

// =====================================================================
// หน้าแรก
// =====================================================================
function HomeScreen({ onBook, onCheckIn }) {
  const card = 'flex flex-col items-start justify-end rounded-[1.2em] p-[1.4em] text-left transition-transform active:scale-[0.99]';
  return (
    <div className="mx-auto flex h-full max-w-[56em] flex-col">
      <h1 className="mt-[0.4em] font-display text-[2em] font-semibold leading-tight">สวัสดีค่ะ ต้องการทำอะไร</h1>
      <p className="mt-[0.2em] text-[1.05em] text-muted">แตะเลือกที่หน้าจอ</p>
      <div className="mt-[1.2em] grid min-h-0 flex-1 gap-[1em] landscape:grid-cols-2 portrait:grid-rows-2">
        <button type="button" onClick={onBook} className={cx(card, 'bg-herb text-white')}>
          <CalendarPlus className="mb-auto size-[3em] text-leaf" strokeWidth={1.5} aria-hidden />
          <span className="font-display text-[1.9em] font-semibold">จองคิวนวด</span>
          <span className="mt-[0.2em] text-[1em] text-leaf">ยังไม่ได้จอง ต้องการรับบริการวันนี้หรือวันถัดไป</span>
        </button>
        <button type="button" onClick={onCheckIn} className={cx(card, 'border-2 border-clay-soft bg-paper')}>
          <ScanLine className="mb-auto size-[3em] text-clay" strokeWidth={1.5} aria-hidden />
          <span className="font-display text-[1.9em] font-semibold">เช็กอิน</span>
          <span className="mt-[0.2em] text-[1em] text-muted">จองไว้แล้ว มีรหัสจอง 6 ตัว</span>
        </button>
      </div>
    </div>
  );
}

// =====================================================================
// ชิ้นส่วนที่ใช้ร่วมกัน
// =====================================================================
/** ตัวบอกขั้นตอน (เป็นลำดับจริง จึงใช้ตัวเลข) */
function Steps({ steps, current }) {
  return (
    <ol className="mb-[1em] flex flex-wrap gap-[0.5em] text-[0.9em]" aria-label="ขั้นตอน">
      {steps.map((s, i) => (
        <li key={s} className={cx('flex items-center gap-[0.4em] rounded-full px-[0.8em] py-[0.25em]',
          i === current ? 'bg-herb text-white' : i < current ? 'bg-leaf text-herb' : 'bg-sand text-muted')}
          aria-current={i === current ? 'step' : undefined}>
          <span className="font-display font-semibold">{i + 1}</span>{s}
        </li>
      ))}
    </ol>
  );
}

function BackButton({ onClick, label = 'ย้อนกลับ' }) {
  return (
    <button type="button" onClick={onClick} className="mb-[0.6em] flex items-center gap-[0.3em] rounded-[0.6em] py-[0.3em] pr-[0.6em] text-muted hover:text-ink">
      <ChevronLeft className="size-[1.3em]" aria-hidden />{label}
    </button>
  );
}

function BigButton({ children, onClick, disabled, variant = 'primary', className }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx('flex h-[3.2em] items-center justify-center gap-[0.4em] rounded-[0.9em] px-[1.4em] font-display text-[1.15em] font-medium transition-colors',
        variant === 'primary' ? 'bg-herb text-white disabled:bg-line disabled:text-faint' : 'border-2 border-line bg-paper text-ink',
        className)}
    >
      {children}
    </button>
  );
}

/** แป้นตัวเลขบนจอ (เบอร์โทร / 4 ตัวท้าย) */
function NumPad({ onKey, onDelete, onClear }) {
  const key = 'grid h-[2.9em] place-items-center rounded-[0.8em] border border-line bg-paper font-display text-[1.5em] font-semibold active:bg-leaf';
  return (
    <div className="grid grid-cols-3 gap-[0.5em]">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} type="button" className={key} onClick={() => onKey(d)}>{d}</button>)}
      <button type="button" className={cx(key, 'text-muted')} onClick={onClear}><span className="text-[0.65em]">ล้าง</span></button>
      <button type="button" className={key} onClick={() => onKey('0')}>0</button>
      <button type="button" className={cx(key, 'text-muted')} onClick={onDelete} aria-label="ลบ"><Delete className="size-[1em]" /></button>
    </div>
  );
}

/** ช่องแสดงค่าที่กดจากแป้น */
function Display({ label, value, placeholder, mono }) {
  return (
    <div>
      <div className="mb-[0.3em] text-muted">{label}</div>
      <div className={cx('flex h-[2.6em] items-center rounded-[0.8em] border-2 border-herb bg-paper px-[0.8em] font-display text-[1.6em] font-semibold', mono && 'tracking-[0.18em]', !value && 'text-faint')}>
        {value || placeholder}
      </div>
    </div>
  );
}

function ErrorBox({ children }) {
  return children ? (
    <p className="anim-rise mt-[0.8em] flex gap-[0.5em] rounded-[0.8em] bg-rose-soft px-[1em] py-[0.7em] text-rose-ink" role="alert">
      <CircleAlert className="mt-[0.15em] size-[1.2em] shrink-0" aria-hidden />{children}
    </p>
  ) : null;
}

/** "0812345678" → "081-234-5678" */
const fmtPhone = (p) => p.replace(/^(\d{3})(\d{0,3})(\d{0,4}).*/, (_, a, b, c) => [a, b, c].filter(Boolean).join('-'));

/** หน้าผลลัพธ์ (จองสำเร็จ / เช็กอินสำเร็จ) — กลับหน้าแรกเองใน 30 วินาที */
function Done({ ticket, title, message, onHome }) {
  const [left, setLeft] = useState(30);
  useEffect(() => {
    const t = setInterval(() => setLeft((s) => { if (s <= 1) { onHome(); return 0; } return s - 1; }), 1000);
    return () => clearInterval(t);
  }, [onHome]);
  return (
    <div className="mx-auto flex max-w-[40em] flex-col items-center py-[1em] text-center">
      <svg viewBox="0 0 40 40" className="anim-pop size-[4em]" aria-hidden>
        <circle cx="20" cy="20" r="20" fill="#2F6B4F" />
        <path d="M12 20.5l5.5 5.5L28.5 15" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" className="check-draw" />
      </svg>
      <h1 className="mt-[0.5em] font-display text-[1.9em] font-semibold">{title}</h1>
      <div className="mt-[1em] w-full rounded-[1.2em] border border-line bg-paper p-[1.2em]">
        <div className="text-muted">รหัสจอง</div>
        <div className="font-display text-[3em] font-semibold leading-none tracking-[0.16em] text-herb">{ticket.booking_code}</div>
        <div className="mt-[0.8em] text-[1.15em]">{ticket.name}</div>
        <div className="font-display text-[1.25em] font-semibold">
          {relativeDay(ticket.slot_date) ?? thaiDateLong(ticket.slot_date)} {ticket.start_time}–{ticket.end_time} น.
        </div>
      </div>
      <p className="mt-[1em] rounded-[0.8em] bg-sand px-[1em] py-[0.7em] text-[1.05em] text-clay">{message}</p>
      <BigButton className="mt-[1.2em] w-full max-w-[16em]" onClick={onHome}>เสร็จสิ้น ({left})</BigButton>
    </div>
  );
}

// =====================================================================
// จองคิว walk-in
// =====================================================================
function BookFlow({ onHome }) {
  const [step, setStep] = useState(0);            // 0 รอบเวลา, 1 ผู้รับบริการ, 2 ยืนยัน
  const [days, setDays] = useState(null);
  const [date, setDate] = useState(null);
  const [slot, setSlot] = useState(null);
  const [phone, setPhone] = useState('');
  const [found, setFound] = useState(null);       // ผลค้นจากเบอร์ (null = ยังไม่ค้น)
  const [person, setPerson] = useState(null);     // { patient_id, name } | { new: true, first_name, last_name, hn }
  const [complaint, setComplaint] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ticket, setTicket] = useState(null);

  const loadDays = useCallback(async () => {
    const d = await staffApi('/kiosk/availability');
    setDays(d.days);
    setDate((cur) => cur ?? (d.days.find((x) => x.slots.some((s) => s.status === 'AVAILABLE'))?.date ?? d.days[0]?.date));
  }, []);
  useEffect(() => { loadDays().catch((e) => setError(e.message)); }, [loadDays]);

  const lookup = async () => {
    setError(''); setBusy(true);
    try { const r = await staffApi('/kiosk/patients/lookup', { method: 'POST', body: { phone_number: phone } }); setFound(r.results); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const submit = async () => {
    setError(''); setBusy(true);
    try {
      const body = {
        slot_id: slot.slot_id,
        chief_complaint: complaint.join(', ') || null,
        ...(person.new
          ? { patient: { first_name: person.first_name.trim(), last_name: person.last_name.trim(), phone_number: phone, hn: person.hn?.trim() || null } }
          : { patient_id: person.patient_id, phone_number: phone }),
      };
      setTicket(await staffApi('/kiosk/bookings', { method: 'POST', body }));
    } catch (e) {
      setError(e.message);
      if (['SLOT_TAKEN', 'SLOT_PASSED'].includes(e.code)) { setSlot(null); setStep(0); loadDays(); }
    } finally { setBusy(false); }
  };

  if (ticket) {
    const inNow = ticket.status === 'CHECKED_IN';
    return <Done ticket={ticket} title={inNow ? 'จองและเช็กอินเรียบร้อย' : 'จองคิวสำเร็จ'} onHome={onHome}
      message={inNow ? 'กรุณานั่งรอเรียกชื่อบริเวณหน้าห้องนวด' : 'ถ่ายรูปหน้าจอนี้เก็บไว้ แล้วมาเช็กอินที่เครื่องนี้ก่อนเวลานัด 10–15 นาที'} />;
  }

  const day = days?.find((d) => d.date === date);

  return (
    <div className="mx-auto max-w-[60em]">
      <Steps steps={['เลือกรอบเวลา', 'ผู้รับบริการ', 'ยืนยัน']} current={step} />

      {/* ---------- 0) เลือกรอบ ---------- */}
      {step === 0 && (
        <>
          <h1 className="font-display text-[1.6em] font-semibold">เลือกวันและรอบเวลา</h1>
          {!days ? <p className="mt-[1em] text-muted">กำลังโหลด</p> : !days.length ? <p className="mt-[1em] text-muted">ไม่มีรอบเปิดให้จอง กรุณาติดต่อเคาน์เตอร์</p> : (
            <>
              <div className="mt-[0.8em] flex flex-wrap gap-[0.5em]">
                {days.map((d) => {
                  const free = d.slots.filter((s) => s.status === 'AVAILABLE').length;
                  return (
                    <button key={d.date} type="button" onClick={() => { setDate(d.date); setSlot(null); }}
                      className={cx('rounded-[0.8em] border-2 px-[1em] py-[0.5em] text-left', d.date === date ? 'border-herb bg-herb text-white' : 'border-line bg-paper')}>
                      <span className="block font-display text-[1.1em] font-semibold">{relativeDay(d.date) ?? weekdayShort(d.date)} {dayNum(d.date)} {monthShort(d.date)}</span>
                      <span className={cx('text-[0.85em]', d.date === date ? 'text-leaf' : 'text-muted')}>{free ? `ว่าง ${free} รอบ` : 'เต็ม'}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-[1em] grid grid-cols-2 gap-[0.6em] landscape:grid-cols-3">
                {day?.slots.map((s) => {
                  const ok = s.status === 'AVAILABLE';
                  return (
                    <button key={s.slot_id} type="button" disabled={!ok} onClick={() => { setSlot(s); setStep(1); setError(''); }}
                      className={cx('flex h-[4.2em] flex-col items-start justify-center rounded-[0.9em] border-2 px-[1em] text-left',
                        ok ? 'border-line bg-paper active:border-herb active:bg-leaf-soft' : 'border-transparent bg-sand/70 text-faint')}>
                      <span className={cx('font-display text-[1.6em] font-semibold leading-none', !ok && 'line-through')}>{s.start_time}</span>
                      <span className="mt-[0.2em] text-[0.9em]">{ok ? `ถึง ${s.end_time} น.` : 'ไม่ว่าง'}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* ---------- 1) ผู้รับบริการ ---------- */}
      {step === 1 && (
        <>
          <BackButton onClick={() => { setStep(0); setFound(null); setPerson(null); }} />
          <div className="grid gap-[1.5em] landscape:grid-cols-[1fr_minmax(0,0.9fr)]">
            <div>
              <h1 className="font-display text-[1.6em] font-semibold">เบอร์โทรศัพท์ผู้รับบริการ</h1>
              <div className="mt-[0.8em]"><Display label="เบอร์โทร" value={fmtPhone(phone)} placeholder="0xx-xxx-xxxx" /></div>

              {found && !person?.new && (
                <div className="mt-[1em]">
                  {found.length > 0 ? (
                    <>
                      <p className="mb-[0.4em] text-muted">แตะชื่อของคุณ</p>
                      <div className="space-y-[0.5em]">
                        {found.map((p) => (
                          <button key={p.patient_id} type="button" onClick={() => { setPerson(p); setStep(2); }}
                            className="flex w-full items-center justify-between rounded-[0.8em] border-2 border-line bg-paper px-[1em] py-[0.7em] text-left active:border-herb">
                            <span className="font-display text-[1.2em] font-semibold">{p.name}</span>
                            <span className="text-[0.85em] text-muted">{p.has_hn ? 'มี HN' : 'บุคคลทั่วไป'}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  ) : <p className="text-muted">ยังไม่มีข้อมูลเบอร์นี้ในระบบ กรุณากรอกชื่อ</p>}
                  <button type="button" onClick={() => setPerson({ new: true, first_name: '', last_name: '', hn: '' })} className="mt-[0.8em] text-herb underline">
                    {found.length ? 'ไม่ใช่ชื่อนี้ ลงทะเบียนใหม่' : 'กรอกชื่อ-นามสกุล'}
                  </button>
                </div>
              )}

              {person?.new && (
                <div className="mt-[1em] space-y-[0.6em]">
                  {[['first_name', 'ชื่อ'], ['last_name', 'นามสกุล'], ['hn', 'เลข HN (ถ้ามี)']].map(([k, label]) => (
                    <label key={k} className="block">
                      <span className="mb-[0.2em] block text-muted">{label}</span>
                      <input value={person[k]} onChange={(e) => setPerson({ ...person, [k]: e.target.value })} maxLength={k === 'hn' ? 20 : 100}
                        className="h-[2.6em] w-full rounded-[0.8em] border-2 border-line bg-paper px-[0.8em] text-[1.15em] focus:border-herb focus:outline-none" />
                    </label>
                  ))}
                  <BigButton className="w-full" disabled={!person.first_name.trim() || !person.last_name.trim()} onClick={() => setStep(2)}>ถัดไป</BigButton>
                </div>
              )}
              <ErrorBox>{error}</ErrorBox>
            </div>

            {!person?.new && (
              <div>
                <NumPad
                  onKey={(d) => { setFound(null); setPhone((p) => (p.length < 10 ? p + d : p)); }}
                  onDelete={() => { setFound(null); setPhone((p) => p.slice(0, -1)); }}
                  onClear={() => { setFound(null); setPhone(''); }}
                />
                <BigButton className="mt-[0.7em] w-full" disabled={!/^0\d{8,9}$/.test(phone) || busy} onClick={lookup}>ค้นหาข้อมูล</BigButton>
              </div>
            )}
          </div>
        </>
      )}

      {/* ---------- 2) ยืนยัน ---------- */}
      {step === 2 && (
        <>
          <BackButton onClick={() => setStep(1)} />
          <h1 className="font-display text-[1.6em] font-semibold">ตรวจสอบและยืนยัน</h1>
          <div className="mt-[0.8em] grid gap-[1.2em] landscape:grid-cols-2">
            <dl className="space-y-[0.6em] rounded-[1em] border border-line bg-paper p-[1.1em]">
              <div><dt className="text-muted">วันและเวลา</dt><dd className="font-display text-[1.3em] font-semibold">{relativeDay(date) ?? thaiDateLong(date)} {slot.start_time}–{slot.end_time} น.</dd></div>
              <div><dt className="text-muted">ผู้รับบริการ</dt><dd className="font-display text-[1.3em] font-semibold">{person.new ? `${person.first_name} ${person.last_name}` : person.name}</dd></div>
              <div><dt className="text-muted">เบอร์โทร</dt><dd className="text-[1.1em]">{fmtPhone(phone)}</dd></div>
            </dl>
            <div>
              <p className="mb-[0.4em] text-muted">อาการเบื้องต้น (แตะเลือกได้ ไม่บังคับ)</p>
              <div className="flex flex-wrap gap-[0.5em]">
                {COMPLAINTS.map((c) => {
                  const on = complaint.includes(c);
                  return (
                    <button key={c} type="button" aria-pressed={on} onClick={() => setComplaint(on ? complaint.filter((x) => x !== c) : [...complaint, c])}
                      className={cx('rounded-full border-2 px-[0.9em] py-[0.35em]', on ? 'border-herb bg-leaf text-herb' : 'border-line bg-paper')}>
                      {on && <Check className="mr-[0.2em] inline size-[0.9em]" aria-hidden />}{c}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <ErrorBox>{error}</ErrorBox>
          <BigButton className="mt-[1.2em] w-full landscape:w-auto landscape:min-w-[14em]" disabled={busy} onClick={submit}>{busy ? 'กำลังจอง' : 'ยืนยันการจอง'}</BigButton>
        </>
      )}
    </div>
  );
}

// =====================================================================
// เช็กอินด้วยรหัสจอง
// =====================================================================
function CheckInFlow({ onHome }) {
  const [step, setStep] = useState(0); // 0 รหัสจอง, 1 เบอร์ 4 ตัวท้าย
  const [code, setCode] = useState('');
  const [last4, setLast4] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ticket, setTicket] = useState(null);

  const submit = async () => {
    setError(''); setBusy(true);
    try { setTicket(await staffApi('/kiosk/checkin', { method: 'POST', body: { code, phone_last4: last4 } })); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  if (ticket) return <Done ticket={ticket} title="เช็กอินเรียบร้อย" message="กรุณานั่งรอเรียกชื่อบริเวณหน้าห้องนวด" onHome={onHome} />;

  return (
    <div className="mx-auto max-w-[60em]">
      <Steps steps={['รหัสจอง', 'ยืนยันเบอร์โทร']} current={step} />

      {step === 0 && (
        <div className="grid gap-[1.5em] landscape:grid-cols-[minmax(0,0.8fr)_1fr]">
          <div>
            <h1 className="font-display text-[1.6em] font-semibold">ใส่รหัสจอง 6 ตัว</h1>
            <p className="mt-[0.2em] text-muted">ดูได้จากตั๋วในแชท LINE หรือที่ถ่ายรูปไว้</p>
            <div className="mt-[0.8em] grid grid-cols-6 gap-[0.4em]" aria-label={`รหัสจอง ${code}`}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className={cx('grid aspect-[4/5] place-items-center rounded-[0.6em] border-2 bg-paper font-display text-[1.8em] font-semibold',
                  i === code.length ? 'border-herb' : 'border-line')}>{code[i] ?? ''}</div>
              ))}
            </div>
            <BigButton className="mt-[1em] w-full" disabled={code.length !== 6} onClick={() => { setError(''); setStep(1); }}>ถัดไป</BigButton>
          </div>
          <div>
            <div className="grid grid-cols-7 gap-[0.4em] portrait:grid-cols-7">
              {CODE_KEYS.map((k) => (
                <button key={k} type="button" onClick={() => setCode((c) => (c.length < 6 ? c + k : c))}
                  className="grid h-[2.6em] place-items-center rounded-[0.6em] border border-line bg-paper font-display text-[1.25em] font-semibold active:bg-leaf">{k}</button>
              ))}
              <button type="button" onClick={() => setCode((c) => c.slice(0, -1))} className="col-span-2 grid h-[2.6em] place-items-center rounded-[0.6em] border border-line bg-paper text-muted active:bg-sand" aria-label="ลบ">
                <Delete className="size-[1.3em]" />
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 1 && (
        <>
          <BackButton onClick={() => { setStep(0); setLast4(''); setError(''); }} />
          <div className="grid gap-[1.5em] landscape:grid-cols-2">
            <div>
              <h1 className="font-display text-[1.6em] font-semibold">เลข 4 ตัวท้ายของเบอร์โทร</h1>
              <p className="mt-[0.2em] text-muted">เบอร์ที่ใช้ตอนจอง รหัส {code}</p>
              <div className="mt-[0.8em]"><Display label="4 ตัวท้าย" value={last4} placeholder="xxxx" mono /></div>
              <ErrorBox>{error}</ErrorBox>
              <BigButton className="mt-[1em] w-full" disabled={last4.length !== 4 || busy} onClick={submit}>{busy ? 'กำลังเช็กอิน' : 'เช็กอิน'}</BigButton>
            </div>
            <NumPad onKey={(d) => setLast4((p) => (p.length < 4 ? p + d : p))} onDelete={() => setLast4((p) => p.slice(0, -1))} onClear={() => setLast4('')} />
          </div>
        </>
      )}
    </div>
  );
}
