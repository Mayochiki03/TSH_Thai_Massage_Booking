/**
 * pages/admin/Dashboard.jsx — ภาพรวมสำหรับผู้ดูแล (GET /api/admin/dashboard)
 *
 *  - วันนี้      : จำนวนคิวแยกตามสถานะ
 *  - 7 วันข้างหน้า: แถบความแน่นของคิวรายวัน (ถูกจอง / รอบทั้งหมด) — สีเดียว + ตัวเลขกำกับทุกแถว
 *  - 30 วันที่ผ่านมา: อัตรามาตามนัด / ไม่มา / ยกเลิก + เวลานวดเฉลี่ย
 *  - ช่องทางการจอง: LINE / kiosk / เคาน์เตอร์ / จองแทน
 */
import { Link } from 'react-router';
import { CalendarOff, UserX, ArrowUpRight } from 'lucide-react';
import { staffApi } from '../../lib/api.js';
import { useLoad } from '../../lib/useLoad.js';
import { thaiDateLong, todayYmd, weekdayShort, dayNum, monthShort, relativeDay } from '../../lib/format.js';
import { Card, PageHeader, Spinner, cx } from '../../components/ui.jsx';

const CHANNEL_LABEL = { ONLINE: 'LINE', KIOSK: 'เครื่อง kiosk', WALK_IN: 'walk-in ที่เคาน์เตอร์', STAFF: 'เจ้าหน้าที่จองแทน' };
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

export function Dashboard() {
  const { data } = useLoad(() => staffApi('/admin/dashboard'), []);
  if (!data) return <Spinner />;
  const t = data.today;
  const l = data.last30;
  const channelTotal = data.channels.reduce((a, c) => a + c.n, 0);
  const finished = (l.completed ?? 0) + (l.no_show ?? 0);

  const tiles = [
    { label: 'รอบว่าง', value: t.available ?? 0 },
    { label: 'รอเช็กอิน', value: t.booked ?? 0 },
    { label: 'มาถึงแล้ว / กำลังนวด', value: (t.checked_in ?? 0) + (t.in_service ?? 0) },
    { label: 'นวดเสร็จ', value: t.completed ?? 0 },
    { label: 'ไม่มา / ยกเลิก', value: (t.no_show ?? 0) + (t.cancelled ?? 0), warm: true },
  ];

  return (
    <>
      <PageHeader title="ภาพรวม" description={thaiDateLong(todayYmd())} />

      {/* วันนี้ */}
      <section aria-label="คิววันนี้" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((x) => (
          <div key={x.label} className={cx('rounded-2xl border px-4 py-4', x.warm ? 'border-clay-soft bg-sand' : 'border-line bg-paper')}>
            <div className={cx('font-display text-[32px] font-semibold leading-none', x.warm && 'text-clay')}>{x.value}</div>
            <div className="mt-2 text-[14px] text-muted">{x.label}</div>
          </div>
        ))}
      </section>
      {!t.slots && <p className="mt-3 text-muted">วันนี้ไม่มีรอบบริการ (วันหยุดหรือเสาร์–อาทิตย์)</p>}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* 7 วันข้างหน้า */}
        <Card title="ความแน่นของคิว 7 วันข้างหน้า" description="จำนวนคิวที่ถูกจองเทียบกับรอบทั้งหมดของแต่ละวัน">
          {!data.next_days.length ? <p className="text-muted">ยังไม่มีรอบเวลาในช่วงนี้</p> : (
            <ul className="space-y-3">
              {data.next_days.map((d) => {
                const open = d.slots - (d.blocked ?? 0);
                const p = pct(d.booked, open);
                return (
                  <li key={d.date} className="grid grid-cols-[88px_1fr_64px] items-center gap-3 text-[15px]" title={`${d.booked} จาก ${open} รอบ`}>
                    <span>
                      <span className="font-medium">{relativeDay(d.date) ?? weekdayShort(d.date)}</span>{' '}
                      <span className="text-muted">{dayNum(d.date)} {monthShort(d.date)}</span>
                    </span>
                    {d.holiday ? (
                      <span className="text-clay">วันหยุด: {d.holiday}</span>
                    ) : (
                      <span className="h-3 overflow-hidden rounded-full bg-mist" role="img" aria-label={`จองแล้ว ${p}%`}>
                        <span className="block h-full rounded-full bg-herb" style={{ width: `${p}%` }} />
                      </span>
                    )}
                    <span className="text-right tabular-nums text-muted">{d.holiday ? '' : `${d.booked}/${open}`}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          {/* 30 วัน */}
          <Card title="30 วันที่ผ่านมา">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-[15px]">
              <div><dt className="text-muted">คิวทั้งหมด</dt><dd className="font-display text-[22px] font-semibold">{l.total ?? 0}</dd></div>
              <div><dt className="text-muted">มาตามนัด</dt><dd className="font-display text-[22px] font-semibold">{pct(l.completed, finished)}%</dd></div>
              <div><dt className="text-muted">ไม่มาตามนัด</dt><dd className="font-display text-[22px] font-semibold text-clay">{l.no_show ?? 0} คิว</dd></div>
              <div><dt className="text-muted">ยกเลิก</dt><dd className="font-display text-[22px] font-semibold">{l.cancelled ?? 0} คิว</dd></div>
              <div className="col-span-2"><dt className="text-muted">เวลานวดจริงเฉลี่ย</dt><dd className="font-display text-[22px] font-semibold">{l.avg_service_min ? `${l.avg_service_min} นาที` : 'ยังไม่มีข้อมูล'}</dd></div>
            </dl>
          </Card>

          {/* ช่องทาง */}
          <Card title="ช่องทางการจอง" description="30 วันก่อน ถึง 7 วันข้างหน้า">
            {!channelTotal ? <p className="text-muted">ยังไม่มีการจอง</p> : (
              <ul className="space-y-2.5 text-[15px]">
                {Object.keys(CHANNEL_LABEL).map((k) => {
                  const n = data.channels.find((c) => c.channel === k)?.n ?? 0;
                  return (
                    <li key={k} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                      <span>{CHANNEL_LABEL[k]}</span>
                      <span className="tabular-nums text-muted">{n} ({pct(n, channelTotal)}%)</span>
                      <span className="col-span-2 h-2 overflow-hidden rounded-full bg-mist">
                        <span className="block h-full rounded-full bg-herb" style={{ width: `${pct(n, channelTotal)}%` }} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {/* ทางลัด */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Link to="/admin/suspensions" className="flex items-center gap-3 rounded-2xl border border-line bg-paper px-5 py-4 hover:border-herb">
          <UserX className="size-6 text-clay" aria-hidden />
          <span className="flex-1">ถูกระงับสิทธิ์อยู่ <b className="font-display">{data.suspended_patients}</b> คน</span>
          <ArrowUpRight className="size-5 text-faint" aria-hidden />
        </Link>
        <Link to="/admin/holidays" className="flex items-center gap-3 rounded-2xl border border-line bg-paper px-5 py-4 hover:border-herb">
          <CalendarOff className="size-6 text-clay" aria-hidden />
          <span className="flex-1">ตั้งวันหยุด / ปิดรับทั้งวัน</span>
          <ArrowUpRight className="size-5 text-faint" aria-hidden />
        </Link>
      </div>
    </>
  );
}
