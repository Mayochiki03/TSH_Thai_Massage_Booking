/** ลูกประคบสมุนไพร — เครื่องหมายของคลินิก (เส้นบาง) */
export function CompressMark({ className = 'size-9', tone = 'herb' }) {
  const stroke = tone === 'light' ? '#FFFFFF' : '#2F6B4F';
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden>
      <path d="M12.5 14.5c2.2 1.6 4.7 2.4 7.5 2.4s5.3-.8 7.5-2.4" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M20 16.9c-6.2 0-10 3.7-10 8.4 0 4.6 4.2 7.7 10 7.7s10-3.1 10-7.7c0-4.7-3.8-8.4-10-8.4Z" stroke={stroke} strokeWidth="1.8" />
      <path d="M15.5 26c1.2 1.3 2.7 2 4.5 2s3.3-.7 4.5-2" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" opacity=".55" />
      <path d="M17 13.8 15 7M20 13.6V6M23 13.8 25 7" stroke="#C9A227" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
