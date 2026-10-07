import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { CalendarHeart, ChevronRight } from 'lucide-react';
import { patientApi } from '../../lib/liff.js';
import { dayNum, monthShort, weekdayShort, relativeDay } from '../../lib/format.js';
import { Spinner, StatusBadge, Empty, Button, useToast, cx } from '../../components/ui.jsx';

export function MyBookingsPage() {
  const [scope, setScope] = useState('upcoming');
  const [list, setList] = useState(null);
  const toast = useToast();

  useEffect(() => {
    setList(null);
    patientApi(`/bookings?scope=${scope}`).then((d) => setList(d.bookings)).catch((err) => toast(err.message, 'error'));
  }, [scope, toast]);

  const tab = (key, label) => (
    <button
      type="button"
      role="tab"
      aria-selected={scope === key}
      onClick={() => setScope(key)}
      className={cx('h-10 flex-1 rounded-full text-[15px] font-medium transition-colors', scope === key ? 'bg-paper text-herb shadow-sm' : 'text-muted')}
    >
      {label}
    </button>
  );

  return (
    <div className="px-5 pt-4 pb-10">
      <h1 className="text-[26px] font-semibold">การจองของฉัน</h1>
      <div className="mt-4 flex gap-1 rounded-full bg-mist p-1" role="tablist">
        {tab('upcoming', 'กำลังจะถึง')}
        {tab('past', 'ที่ผ่านมา')}
      </div>

      {!list ? <Spinner /> : !list.length ? (
        <Empty
          icon={CalendarHeart}
          title={scope === 'upcoming' ? 'ยังไม่มีนัดที่กำลังจะถึง' : 'ยังไม่มีประวัติการจอง'}
          action={scope === 'upcoming' && <Link to="/"><Button>จองคิวนวด</Button></Link>}
        />
      ) : (
        <ul className="mt-5 space-y-3">
          {list.map((b) => {
            const off = ['CANCELLED', 'NO_SHOW'].includes(b.status);
            return (
              <li key={b.booking_code}>
                <Link to={`/ticket/${b.booking_code}`} className="flex items-stretch overflow-hidden rounded-2xl border border-line hover:border-herb">
                  <div className={cx('flex w-[76px] shrink-0 flex-col items-center justify-center py-3', off ? 'bg-mist text-faint' : 'bg-leaf-soft text-herb')}>
                    <span className="text-[13px]">{relativeDay(b.slot_date) ?? weekdayShort(b.slot_date)}</span>
                    <span className="font-display text-[28px] font-semibold leading-none">{dayNum(b.slot_date)}</span>
                    <span className="text-[13px]">{monthShort(b.slot_date)}</span>
                  </div>
                  <div className="min-w-0 flex-1 border-l-2 border-dashed border-line px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className={cx('font-display text-[19px] font-semibold', off && 'text-faint')}>{b.start_time}–{b.end_time}</span>
                      <StatusBadge status={b.status} />
                    </div>
                    <div className="truncate text-[15px] text-muted">
                      {b.patient.first_name} {b.patient.last_name}{b.relation && b.relation !== 'ตนเอง' ? ` (${b.relation})` : ''}
                    </div>
                    <div className="mt-0.5 font-display text-[14px] tracking-[0.1em] text-faint">{b.booking_code}</div>
                  </div>
                  <ChevronRight className="mr-3 size-5 self-center text-faint" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
