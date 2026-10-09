/**
 * lib/session.jsx — การล็อกอินของบัญชีในระบบ (เจ้าหน้าที่ / หมอนวด / แอดมิน / นักพัฒนา / เครื่อง kiosk)
 *
 * ทั้ง 3 แอป (/staff, /admin, /kiosk) ใช้ <SessionGate> ตัวเดียวกัน:
 *   ยังไม่ล็อกอิน         → หน้าเข้าสู่ระบบ
 *   รหัสผ่านถูก + ต้องใช้ 2FA:
 *     ยังไม่ผูกแอป → หน้าผูกแอป Authenticator (สแกน QR → กรอกรหัสแรก → แสดงรหัสสำรอง 10 ชุด)
 *     ผูกแล้ว      → หน้ากรอกรหัส 6 หลัก (หรือรหัสสำรอง)
 *   ต้องเปลี่ยนรหัสผ่าน    → หน้าตั้งรหัสผ่านใหม่
 *   role ไม่มีสิทธิ์แอปนี้ → หน้าแจ้ง + ปุ่มไปแอปที่ role นั้นใช้ได้
 *   ผ่านทั้งหมด            → แสดง children และแชร์ { user, logout, confirmLogout } ผ่าน useSession()
 *     confirmLogout = ถามยืนยันก่อน (ใช้กับปุ่มออกจากระบบ) · logout = ออกทันที (ใช้หลังยืนยันรหัสผ่าน kiosk / รีเซ็ต 2FA ตัวเอง)
 *
 * session จริงเก็บเป็น httpOnly cookie ฝั่ง backend — หน้าเว็บไม่ได้ถือ token เอง
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { KeyRound, ShieldAlert, ShieldCheck, Smartphone, Copy, Download, ArrowLeft, LifeBuoy } from 'lucide-react';
import { staffApi, setUnauthorizedHandler } from './api.js';
import { CompressMark } from '../components/Logo.jsx';
import { Button, Field, Input, Spinner, useToast, useConfirm, cx } from '../components/ui.jsx';

export const ROLE_LABEL = {
  DEV: 'นักพัฒนาระบบ',
  ADMIN: 'ผู้ดูแลระบบ',
  STAFF: 'เจ้าหน้าที่เคาน์เตอร์',
  PRACTITIONER: 'หมอนวด',
  KIOSK: 'เครื่อง kiosk',
};

/** หน้าแรกของแต่ละ role หลังล็อกอิน */
export function homeFor(role) {
  if (role === 'DEV' || role === 'ADMIN') return '/admin';
  if (role === 'PRACTITIONER') return '/staff/room';
  if (role === 'KIOSK') return '/kiosk';
  return '/staff/queue';
}

const SessionCtx = createContext(null);
/** { user, logout, confirmLogout } ของบัญชีที่ล็อกอินอยู่ */
export const useSession = () => useContext(SessionCtx);

/**
 * @param {object} props
 * @param {string[]} props.roles   role ที่เข้าแอปนี้ได้ (DEV เข้าได้ทุกแอปเสมอ)
 * @param {string}   props.appName ชื่อแอปที่แสดงบนหน้าเข้าสู่ระบบ
 */
export function SessionGate({ roles, appName, children }) {
  const [user, setUser] = useState(undefined); // undefined = กำลังตรวจ, null = ยังไม่ล็อกอิน
  const [pending, setPending] = useState(null); // ขั้น 2FA: { stage: 'setup'|'verify', who: {full_name, username} }
  const navigate = useNavigate();
  const confirm = useConfirm();

  useEffect(() => {
    // API ตอบ 401 (session หมดอายุ) ที่ไหนก็ตาม → กลับหน้าเข้าสู่ระบบ
    setUnauthorizedHandler(() => { setUser(null); setPending(null); });
    staffApi('/auth/me').then((d) => setUser(d.user)).catch(() => setUser(null));
  }, []);

  const logout = useCallback(async () => {
    await staffApi('/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
    setPending(null);
  }, []);

  /** ปุ่มออกจากระบบ: ถามก่อน กันกดพลาด (ต้องล็อกอินใหม่ + รหัสจากแอปถ้าใช้ 2FA) */
  const confirmLogout = useCallback(async () => {
    const ok = await confirm({
      title: 'ออกจากระบบ?',
      body: `คุณ${user?.full_name ?? ''} (${user?.username ?? ''})\nครั้งถัดไปต้องเข้าสู่ระบบด้วยรหัสผ่าน${user?.mfa_enabled ? ' และรหัสจากแอป Authenticator' : ''} อีกครั้ง`,
      okText: 'ออกจากระบบ',
      cancelText: 'ยกเลิก',
    });
    if (ok) await logout();
  }, [confirm, logout, user]);

  /** ผลจาก /auth/login: ได้ user เลย หรือต้องผ่านขั้น 2FA ก่อน */
  const onPassword = (data) => {
    if (data.mfa) setPending({ stage: data.mfa, who: data.user });
    else setUser(data.user);
  };
  const done2fa = (u) => { setPending(null); setUser(u); };

  if (user === undefined) return <div className="min-h-dvh"><Spinner /></div>;
  if (!user && pending?.stage === 'verify') return <MfaVerify who={pending.who} onDone={done2fa} onCancel={logout} />;
  if (!user && pending?.stage === 'setup') return <MfaSetup who={pending.who} onDone={done2fa} onCancel={logout} />;
  if (!user) return <LoginScreen appName={appName} onLogin={onPassword} />;
  if (user.must_change_password) {
    return <ChangePassword user={user} onDone={() => setUser({ ...user, must_change_password: false })} />;
  }
  if (user.role !== 'DEV' && !roles.includes(user.role)) {
    return <NoAccess user={user} onGo={() => navigate(homeFor(user.role))} onLogout={logout} />;
  }
  return <SessionCtx.Provider value={{ user, logout, confirmLogout }}>{children}</SessionCtx.Provider>;
}

/** กรอบหน้าเข้าสู่ระบบ / เปลี่ยนรหัส (ใช้ร่วมกัน) */
/** size: sm = ฟอร์มเล็ก (ค่าเริ่มต้น) · md = รหัสสำรอง · lg = หน้าผูกแอป (จอกว้างแบ่ง 2 คอลัมน์) */
function AuthFrame({ children, size = 'sm' }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-ivory px-4 py-8 sm:py-12">
      <div className={cx(
        'anim-rise w-full rounded-3xl border border-line bg-paper p-6 sm:p-8',
        { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-md md:max-w-3xl md:p-10' }[size],
      )}>
        {children}
      </div>
    </div>
  );
}

function LoginScreen({ appName, onLogin }) {
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      onLogin(await staffApi('/auth/login', { method: 'POST', body: form }));
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <AuthFrame>
      <form onSubmit={submit}>
        <CompressMark className="size-12" />
        <h1 className="mt-4 text-[26px] font-semibold">เข้าสู่ระบบ</h1>
        <p className="mt-1 mb-6 text-muted">{appName}</p>
        <div className="space-y-4">
          <Field label="ชื่อผู้ใช้">
            <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="username" autoFocus required />
          </Field>
          <Field label="รหัสผ่าน">
            <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="current-password" required />
          </Field>
        </div>
        {error && <p className="mt-4 rounded-xl bg-rose-soft px-4 py-3 text-[15px] text-rose-ink" role="alert">{error}</p>}
        <Button type="submit" size="lg" className="mt-6 w-full" loading={loading}>เข้าสู่ระบบ</Button>
      </form>
    </AuthFrame>
  );
}

// =====================================================================
// ยืนยันตัวตน 2 ชั้น (แอป Authenticator)
// =====================================================================

/** ช่องกรอกรหัส 6 หลัก: ตัวใหญ่ แป้นตัวเลข มือถือเติมจาก SMS/แอปได้ (one-time-code) ครบ 6 ตัวส่งเอง */
function CodeInput({ value, onChange, onComplete, disabled }) {
  return (
    <input
      value={value}
      onChange={(e) => {
        const v = e.target.value.replace(/\D/g, '').slice(0, 6);
        onChange(v);
        if (v.length === 6) onComplete?.(v);
      }}
      inputMode="numeric"
      autoComplete="one-time-code"
      autoFocus
      disabled={disabled}
      placeholder="000000"
      aria-label="รหัส 6 หลักจากแอป"
      className="h-16 w-full rounded-2xl border border-line bg-paper text-center font-display text-[34px] tracking-[0.4em] tabular-nums placeholder:text-line focus:border-herb focus:outline-none focus:ring-4 focus:ring-leaf disabled:opacity-60"
    />
  );
}

const errText = (err) => (err.fields ? Object.values(err.fields)[0][0] : err.message);

/** ล็อกอินด้วยรหัส 6 หลัก (หรือรหัสสำรองเมื่อไม่มีมือถือ) */
function MfaVerify({ who, onDone, onCancel }) {
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const submit = async (value = code) => {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const body = useRecovery ? { recovery_code: value.trim() } : { code: value };
      const r = await staffApi('/auth/mfa/verify', { method: 'POST', body });
      if (r.recovery_left != null) {
        toast(r.recovery_left <= 3
          ? `ใช้รหัสสำรองแล้ว เหลือ ${r.recovery_left} ชุด — แจ้งผู้ดูแลให้รีเซ็ต 2FA เพื่อผูกมือถือใหม่`
          : `ใช้รหัสสำรองแล้ว เหลือ ${r.recovery_left} ชุด`, r.recovery_left <= 3 ? 'error' : undefined);
      }
      onDone(r.user);
    } catch (err) {
      setError(errText(err));
      setCode('');
      setLoading(false);
    }
  };

  return (
    <AuthFrame>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <span className="grid size-12 place-items-center rounded-2xl bg-leaf-soft text-herb"><ShieldCheck className="size-6" aria-hidden /></span>
        <h1 className="mt-4 text-[24px] font-semibold">ยืนยันตัวตน</h1>
        <p className="mt-1 mb-6 text-muted">
          คุณ{who.full_name} ({who.username})<br />
          {useRecovery ? 'กรอกรหัสสำรองชุดใดชุดหนึ่ง (ใช้ได้ชุดละครั้ง)' : 'เปิดแอป Authenticator ในมือถือ แล้วกรอกรหัส 6 หลัก'}
        </p>
        {useRecovery ? (
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="xxxx-xxxx" autoFocus autoComplete="off" autoCapitalize="none" className="text-center font-display text-[22px] tracking-widest" aria-label="รหัสสำรอง" />
        ) : (
          <CodeInput value={code} onChange={setCode} onComplete={submit} disabled={loading} />
        )}
        {error && <p className="mt-4 rounded-xl bg-rose-soft px-4 py-3 text-[15px] text-rose-ink" role="alert">{error}</p>}
        <Button type="submit" size="lg" className="mt-6 w-full" loading={loading} disabled={useRecovery ? code.trim().length < 8 : code.length !== 6}>ยืนยัน</Button>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[15px]">
          <button type="button" onClick={onCancel} className="inline-flex items-center gap-1 text-muted hover:text-ink"><ArrowLeft className="size-4" aria-hidden />เปลี่ยนบัญชี</button>
          <button type="button" onClick={() => { setUseRecovery(!useRecovery); setCode(''); setError(''); }} className="inline-flex items-center gap-1 text-herb hover:underline">
            <LifeBuoy className="size-4" aria-hidden />{useRecovery ? 'ใช้รหัสจากแอปแทน' : 'ไม่มีมือถือ? ใช้รหัสสำรอง'}
          </button>
        </div>
        {useRecovery && <p className="mt-4 text-[14px] text-faint">ไม่มีทั้งมือถือและรหัสสำรอง → ติดต่อผู้ดูแลระบบให้กด "รีเซ็ต 2FA"</p>}
      </form>
    </AuthFrame>
  );
}

/** ผูกแอปครั้งแรก: 1) ติดตั้งแอป 2) สแกน QR 3) กรอกรหัสแรก → แสดงรหัสสำรอง */
function MfaSetup({ who, onDone, onCancel }) {
  const [info, setInfo] = useState(null); // { qr, secret, issuer, account }
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // { user, recovery_codes }

  useEffect(() => {
    staffApi('/auth/mfa/setup', { method: 'POST' }).then(setInfo).catch((err) => setError(errText(err)));
  }, []);

  const submit = async (value = code) => {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      setResult(await staffApi('/auth/mfa/enable', { method: 'POST', body: { code: value } }));
    } catch (err) {
      setError(errText(err));
      setCode('');
      setLoading(false);
    }
  };

  if (result) return <RecoveryCodes codes={result.recovery_codes} who={who} onContinue={() => onDone(result.user)} />;

  /** กล่อง QR — จอกว้างอยู่คอลัมน์ขวา (ใหญ่) · มือถืออยู่ในขั้นที่ 2 */
  const qrPanel = (big) => (
    <>
      {!info && !error && <Spinner />}
      {info && (
        <div className={cx('flex flex-col items-center', big && 'rounded-3xl bg-ivory p-6')}>
          <img
            src={info.qr}
            alt="QR code สำหรับแอป Authenticator"
            width={big ? 240 : 200}
            height={big ? 240 : 200}
            className={cx('rounded-2xl border border-line bg-white p-2', big ? 'size-[240px]' : 'size-[200px]')}
          />
          {big && <p className="mt-3 text-center text-[14px] text-muted">สแกนด้วยแอป Authenticator<br />ในมือถือของคุณ</p>}
        </div>
      )}
    </>
  );

  return (
    <AuthFrame size="lg">
      <div className="flex items-start gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-leaf-soft text-herb"><Smartphone className="size-6" aria-hidden /></span>
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold leading-tight md:text-[26px]">ตั้งค่ายืนยันตัวตน 2 ชั้น</h1>
          <p className="mt-1 text-muted">คุณ{who.full_name} ({who.username}) — ทำครั้งเดียว ใช้เวลาประมาณ 1 นาที</p>
        </div>
      </div>

      <div className="mt-7 md:grid md:grid-cols-[minmax(0,1fr)_288px] md:gap-10">
        <ol className="space-y-6">
          <li className="flex gap-3">
            <Step n={1} />
            <div className="min-w-0 text-[15px]">
              <div className="font-medium">ติดตั้งแอปในมือถือของคุณเอง</div>
              <div className="text-muted">Google Authenticator หรือ Microsoft Authenticator — ฟรี มีทั้ง iPhone และ Android</div>
            </div>
          </li>
          <li className="flex gap-3">
            <Step n={2} />
            <div className="min-w-0 flex-1 text-[15px]">
              <div className="font-medium">เปิดแอป กด <b>+</b> แล้วสแกน QR<span className="hidden md:inline"> ทางขวา</span></div>
              <div className="mt-3 md:hidden">{qrPanel(false)}</div>
              {info && (
                <>
                  {/* ตั้งค่าจากมือถือเครื่องเดียวกับแอป → สแกนจอตัวเองไม่ได้ กดลิงก์นี้เปิดแอปแทน */}
                  <a href={info.url} className="mt-3 inline-flex items-center gap-1 rounded-lg bg-leaf-soft px-3 py-2 text-[14px] font-medium text-herb md:hidden">
                    <Smartphone className="size-4" aria-hidden />ใช้มือถือเครื่องนี้? กดเพื่อเพิ่มในแอป
                  </a>
                  <details className="mt-3 text-[14px]">
                    <summary className="cursor-pointer text-herb">สแกนไม่ได้? พิมพ์รหัสเอง</summary>
                    <p className="mt-2 text-muted">ในแอปเลือก "ป้อนคีย์การตั้งค่า" · ชื่อบัญชี: {info.account} · ประเภท: ตามเวลา</p>
                    <code className="mt-1 block rounded-lg bg-sand px-3 py-2 font-mono text-[15px] break-all select-all">{info.secret}</code>
                  </details>
                </>
              )}
            </div>
          </li>
          <li className="flex gap-3">
            <Step n={3} />
            <form className="min-w-0 flex-1 text-[15px]" onSubmit={(e) => { e.preventDefault(); submit(); }}>
              <div className="mb-2 font-medium">กรอกรหัส 6 หลักที่แอปแสดง</div>
              <CodeInput value={code} onChange={setCode} onComplete={submit} disabled={loading || !info} />
              {error && <p className="mt-3 rounded-xl bg-rose-soft px-4 py-3 text-[15px] text-rose-ink" role="alert">{error}</p>}
              <Button type="submit" size="lg" className="mt-4 w-full" loading={loading} disabled={code.length !== 6 || !info}>ยืนยันและเปิดใช้</Button>
            </form>
          </li>
        </ol>

        <aside className="hidden md:block">
          {qrPanel(true)}
          <p className="mt-4 text-[13px] leading-relaxed text-faint">อย่าถ่ายรูปหรือส่ง QR นี้ให้คนอื่น — ใครมี QR นี้จะสร้างรหัสของคุณได้</p>
        </aside>
      </div>
      <p className="mt-4 text-[13px] text-faint md:hidden">อย่าถ่ายรูปหรือส่ง QR นี้ให้คนอื่น — ใครมี QR นี้จะสร้างรหัสของคุณได้</p>

      <button type="button" onClick={onCancel} className="mt-6 inline-flex items-center gap-1 text-[15px] text-muted hover:text-ink"><ArrowLeft className="size-4" aria-hidden />ยกเลิก / เปลี่ยนบัญชี</button>
    </AuthFrame>
  );
}

const Step = ({ n }) => (
  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-herb font-display text-[15px] font-semibold text-white" aria-hidden>{n}</span>
);

/** แสดงรหัสสำรองครั้งเดียว — ต้องติ๊กว่าเก็บแล้วก่อนไปต่อ */
function RecoveryCodes({ codes, who, onContinue }) {
  const [saved, setSaved] = useState(false);
  const toast = useToast();
  const text = `รหัสสำรองยืนยันตัวตน — ${who.full_name} (${who.username})\nใช้แทนรหัสจากแอปได้ชุดละ 1 ครั้ง เมื่อไม่มีมือถือ\n\n${codes.join('\n')}\n`;

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast('คัดลอกแล้ว'); } catch { toast('คัดลอกไม่ได้ กรุณาจดด้วยมือ', 'error'); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `รหัสสำรอง-${who.username}.txt` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <AuthFrame size="md">
      <span className="grid size-12 place-items-center rounded-2xl bg-leaf-soft text-herb"><ShieldCheck className="size-6" aria-hidden /></span>
      <h1 className="mt-4 text-[24px] font-semibold">เปิดใช้แล้ว — เก็บรหัสสำรองไว้</h1>
      <p className="mt-1 text-muted">ถ้ามือถือหายหรือลืมเอามา ใช้รหัสเหล่านี้เข้าระบบแทนได้ <b className="text-ink">ชุดละ 1 ครั้ง</b> ระบบจะแสดงให้ดูแค่ครั้งนี้</p>
      <ul className="mt-5 grid grid-cols-2 gap-x-4 gap-y-2 rounded-2xl bg-sand p-4 font-mono text-[17px] tabular-nums sm:p-5">
        {codes.map((c) => <li key={c} className="text-center select-all">{c}</li>)}
      </ul>
      <div className="mt-3 flex gap-2">
        <Button variant="outline" icon={Copy} className="flex-1" onClick={copy}>คัดลอก</Button>
        <Button variant="outline" icon={Download} className="flex-1" onClick={download}>ดาวน์โหลด</Button>
      </div>
      <p className="mt-3 text-[14px] text-faint">เก็บไว้ในที่ปลอดภัย เช่น จดใส่กระดาษเก็บในลิ้นชักที่ล็อกได้ — อย่าเก็บไว้ในมือถือเครื่องเดียวกับแอป</p>
      <label className="mt-5 flex cursor-pointer items-center gap-2 text-[15px]">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="size-5 accent-herb" />
        ฉันเก็บรหัสสำรองไว้แล้ว
      </label>
      <Button size="lg" className="mt-4 w-full" disabled={!saved} onClick={onContinue}>เริ่มใช้งาน</Button>
    </AuthFrame>
  );
}

function ChangePassword({ user, onDone }) {
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const toast = useToast();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (form.new_password !== form.confirm) return setError('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน');
    setLoading(true);
    setError('');
    try {
      await staffApi('/auth/change-password', { method: 'POST', body: { current_password: form.current_password, new_password: form.new_password } });
      toast('เปลี่ยนรหัสผ่านแล้ว');
      onDone();
    } catch (err) {
      setError(err.fields ? Object.values(err.fields)[0][0] : err.message);
      setLoading(false);
    }
  };

  return (
    <AuthFrame>
      <form onSubmit={submit}>
        <span className="grid size-12 place-items-center rounded-2xl bg-turmeric-soft text-[#7a5e0e]"><KeyRound className="size-6" aria-hidden /></span>
        <h1 className="mt-4 text-[24px] font-semibold">ตั้งรหัสผ่านใหม่</h1>
        <p className="mt-1 mb-6 text-muted">คุณ{user.full_name} กรุณาเปลี่ยนรหัสผ่านก่อนเริ่มใช้งาน</p>
        <div className="space-y-4">
          <Field label="รหัสผ่านปัจจุบัน"><Input type="password" value={form.current_password} onChange={set('current_password')} autoComplete="current-password" required /></Field>
          <Field label="รหัสผ่านใหม่" hint="อย่างน้อย 8 ตัวอักษร"><Input type="password" value={form.new_password} onChange={set('new_password')} autoComplete="new-password" minLength={8} required /></Field>
          <Field label="ยืนยันรหัสผ่านใหม่"><Input type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" required /></Field>
        </div>
        {error && <p className="mt-4 rounded-xl bg-rose-soft px-4 py-3 text-[15px] text-rose-ink" role="alert">{error}</p>}
        <Button type="submit" size="lg" className="mt-6 w-full" loading={loading}>บันทึกรหัสผ่านใหม่</Button>
      </form>
    </AuthFrame>
  );
}

function NoAccess({ user, onGo, onLogout }) {
  return (
    <AuthFrame>
      <span className="grid size-12 place-items-center rounded-2xl bg-sand text-clay"><ShieldAlert className="size-6" aria-hidden /></span>
      <h1 className="mt-4 text-[22px] font-semibold">บัญชีนี้เข้าหน้านี้ไม่ได้</h1>
      <p className="mt-1 text-muted">คุณล็อกอินเป็น{ROLE_LABEL[user.role]} ({user.username})</p>
      <div className="mt-6 space-y-2">
        <Button size="lg" className="w-full" onClick={onGo}>ไปหน้าของ{ROLE_LABEL[user.role]}</Button>
        <Button size="lg" variant="outline" className="w-full" onClick={onLogout}>ออกจากระบบ / เปลี่ยนบัญชี</Button>
      </div>
    </AuthFrame>
  );
}
