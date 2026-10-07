const dateFmt = new Intl.DateTimeFormat('th-TH', {
  weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok',
});

/** '2026-10-07' → 'พ. 7 ต.ค. 2569' */
export function thaiDate(ymd) {
  if (!ymd) return '';
  return dateFmt.format(new Date(`${String(ymd).slice(0, 10)}T00:00:00+07:00`));
}

/** '09:00:00' → '09:00' */
export const hhmm = (t) => (t ? String(t).slice(0, 5) : '');

/** แทนค่า {key} ใน template */
export function fillTemplate(text, vars) {
  return String(text).replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
}
