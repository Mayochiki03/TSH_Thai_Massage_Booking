/**
 * pages/admin/dev/DevConnectionPage.jsx — เมนูนักพัฒนา: การเชื่อมต่อ LINE / อินเทอร์เน็ต
 *
 *  โหมด:
 *   LOCAL      — ยังไม่ต่อ LINE, หน้าผู้จองใช้ผ่าน "ผู้ใช้จำลอง" เท่านั้น
 *   DEV_TUNNEL — LINE OA ทดสอบของนักพัฒนา + Cloudflare Quick Tunnel (URL เปลี่ยนทุกครั้งที่รัน)
 *   PRODUCTION — LINE OA ของโรงพยาบาล + Cloudflare Tunnel ถาวร
 *
 *  บันทึก: PUT /api/dev/connection (ช่อง secret เว้นว่าง = ใช้ค่าเดิม)
 *  ทดสอบ: POST /api/dev/connection/test { what: public | token | quota | push }
 */
import { useEffect, useState } from 'react';
import { Save, Globe, KeyRound, Gauge, Send, CircleCheck, CircleX } from 'lucide-react';
import { staffApi } from '../../../lib/api.js';
import { useLoad } from '../../../lib/useLoad.js';
import { Button, Card, Field, Input, PageHeader, Spinner, useToast, cx } from '../../../components/ui.jsx';

const MODES = [
  { value: 'LOCAL', label: 'LOCAL', desc: 'พัฒนาบนเครื่อง ยังไม่ต่อ LINE ทดสอบหน้าผู้จองผ่านเมนูผู้ใช้จำลอง' },
  { value: 'DEV_TUNNEL', label: 'DEV_TUNNEL', desc: 'ทดสอบบนมือถือจริงกับ LINE OA ทดสอบ ผ่าน Cloudflare Quick Tunnel' },
  { value: 'PRODUCTION', label: 'PRODUCTION', desc: 'ใช้งานจริงกับ LINE OA ของโรงพยาบาล ผ่าน Cloudflare Tunnel ถาวร' },
];

export function DevConnectionPage() {
  const { data, setData } = useLoad(() => staffApi('/dev/connection'), []);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [tests, setTests] = useState({});
  const [pushTo, setPushTo] = useState('');
  const toast = useToast();

  useEffect(() => {
    if (data) setForm({ mode: data.mode, public_base_url: data.public_base_url, liff_id: data.liff_id, line_login_channel_id: data.line_login_channel_id, line_channel_secret: '', line_channel_token: '' });
  }, [data]);
  if (!form) return <Spinner />;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    setSaving(true);
    try { const r = await staffApi('/dev/connection', { method: 'PUT', body: form }); setData(r); toast(`บันทึกแล้ว โหมด ${r.mode}`); }
    catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  const test = async (what) => {
    setTests({ ...tests, [what]: { loading: true } });
    try {
      const r = await staffApi('/dev/connection/test', { method: 'POST', body: { what, ...(what === 'push' && { line_user_id: pushTo.trim() }) } });
      setTests((t) => ({ ...t, [what]: r }));
    } catch (err) { setTests((t) => ({ ...t, [what]: { ok: false, error: err.message } })); }
  };

  const testRow = (what, Icon, label, detail) => {
    const r = tests[what];
    return (
      <li className="flex flex-wrap items-center gap-3 rounded-xl border border-line px-4 py-3">
        <Icon className="size-5 text-muted" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block">{label}</span>
          {r && !r.loading && (
            <span className={cx('flex items-center gap-1.5 text-[14px]', r.ok ? 'text-herb' : 'text-rose-ink')}>
              {r.ok ? <CircleCheck className="size-4" aria-hidden /> : <CircleX className="size-4" aria-hidden />}
              {r.ok ? detail(r) : r.error}
            </span>
          )}
        </span>
        <Button size="sm" variant="outline" loading={r?.loading} onClick={() => test(what)} disabled={what === 'push' && !pushTo.trim()}>ทดสอบ</Button>
      </li>
    );
  };

  return (
    <>
      <PageHeader title="การเชื่อมต่อ LINE" description="สลับโหมดและตั้งค่า LINE OA / Public URL"
        actions={<Button icon={Save} loading={saving} onClick={save}>บันทึก</Button>} />

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          <Card title="โหมดการทำงาน">
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="โหมด">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={form.mode === m.value}
                  onClick={() => setForm({ ...form, mode: m.value })}
                  className={cx('rounded-xl border px-4 py-3 text-left transition-colors', form.mode === m.value ? 'border-herb bg-leaf-soft ring-2 ring-herb' : 'border-line hover:border-herb')}
                >
                  <span className="block font-display font-semibold">{m.label}</span>
                  <span className="mt-1 block text-[14px] text-muted">{m.desc}</span>
                </button>
              ))}
            </div>
            {data.mode !== form.mode && <p className="mt-3 text-[14px] text-clay">ยังไม่ได้บันทึก — โหมดปัจจุบันคือ {data.mode}</p>}
          </Card>

          <Card title="ค่าการเชื่อมต่อ" description="จาก LINE Developers (Provider เดียวกับ LINE OA)">
            <div className="space-y-4">
              <Field label="Public URL" hint="https://… ของ Cloudflare Tunnel ที่ชี้ไปพอร์ต public (4000) หรือหน้าเว็บ"><Input value={form.public_base_url} onChange={set('public_base_url')} placeholder="https://booking.example.com" /></Field>
              <Field label="LIFF ID"><Input value={form.liff_id} onChange={set('liff_id')} placeholder="1234567890-AbCdEfGh" /></Field>
              <Field label="LINE Login Channel ID"><Input value={form.line_login_channel_id} onChange={set('line_login_channel_id')} inputMode="numeric" /></Field>
              <Field label="Messaging API Channel Secret" hint={data.channel_secret_set ? 'ตั้งไว้แล้ว เว้นว่าง = ใช้ค่าเดิม' : 'ยังไม่ได้ตั้ง'}>
                <Input type="password" value={form.line_channel_secret} onChange={set('line_channel_secret')} autoComplete="off" placeholder={data.channel_secret_set ? '••••••••' : ''} />
              </Field>
              <Field label="Messaging API Channel Access Token" hint={data.channel_token_set ? 'ตั้งไว้แล้ว เว้นว่าง = ใช้ค่าเดิม (เก็บแบบเข้ารหัส)' : 'ยังไม่ได้ตั้ง'}>
                <Input type="password" value={form.line_channel_token} onChange={set('line_channel_token')} autoComplete="off" placeholder={data.channel_token_set ? '••••••••' : ''} />
              </Field>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="ทดสอบการเชื่อมต่อ" description="ใช้ค่าที่บันทึกแล้ว">
            <ul className="space-y-2">
              {testRow('public', Globe, 'เปิดเว็บจากอินเทอร์เน็ตได้', () => 'Public URL ตอบกลับปกติ')}
              {testRow('token', KeyRound, 'Channel Access Token ใช้ได้', (r) => `บัญชี ${r.displayName ?? ''} ${r.basicId ?? ''}`)}
              {testRow('quota', Gauge, 'โควตาข้อความเดือนนี้', (r) => `ใช้ไป ${r.used} จาก ${r.limit ?? 'ไม่จำกัด'} ข้อความ`)}
            </ul>
            <div className="mt-4 rounded-xl bg-sand p-4">
              <Field label="ส่งข้อความทดสอบไปที่ LINE user ID" hint="หา user ID ของตัวเองได้ที่ LINE Developers > Basic settings > Your user ID">
                <Input value={pushTo} onChange={(e) => setPushTo(e.target.value)} placeholder="U0123456789abcdef…" />
              </Field>
              <ul className="mt-3">{testRow('push', Send, 'ส่งข้อความทดสอบ', () => 'ส่งแล้ว ตรวจใน LINE')}</ul>
            </div>
          </Card>

          <Card title="ขั้นตอนตั้งค่า LINE">
            <ol className="list-decimal space-y-2 pl-5 text-[15px]">
              <li>LINE Developers สร้าง Provider (ใช้ Provider เดียวกับ LINE OA)</li>
              <li>สร้าง Messaging API channel แล้วออก Channel Access Token (long-lived)</li>
              <li>สร้าง LINE Login channel ใต้ Provider เดียวกัน แล้วตั้ง Linked OA</li>
              <li>เพิ่ม LIFF app ขนาด Full, scope: profile, openid, chat_message.write และใส่ Endpoint URL = Public URL</li>
              <li>กรอกค่าในหน้านี้ เลือกโหมด แล้วกดทดสอบทีละข้อ</li>
              <li>ก่อนเปลี่ยนจาก OA ทดสอบเป็น OA จริง ใช้ "ล้างข้อมูลทดสอบ" ในหน้าระบบและเครื่องมือ</li>
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
