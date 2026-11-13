// The Safe Zone logo: a blue-to-purple hexagon with a location pin ("a safe place to meet").
// One component, used everywhere the logo appears (sidebar, mobile header, landing page, login pages).
// The word "Zone" uses the .sz-brand-zone gradient defined in index.css.
import { useId } from 'react';

export const LogoMark = ({ size = 32 }: { size?: number }) => {
  const gradientId = useId(); // unique per instance, so several logos on one page do not clash
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#60a5fa" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      <path d="M24 3 42 13.5v21L24 45 6 34.5v-21Z" fill={`url(#${gradientId})`} />
      <path d="M24 13c-4.4 0-8 3.2-8 7.6 0 6.4 8 12.4 8 12.4s8-6 8-12.4C32 16.2 28.4 13 24 13Zm0 10.6a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z" fill="#0b1026" opacity=".85" />
    </svg>
  );
};

/** Logo mark plus the name. The text takes its size and colour from the parent. */
const BrandLogo = ({ size = 32 }: { size?: number }) => (
  <>
    <LogoMark size={size} />
    <span>Safe <b className="sz-brand-zone">Zone</b></span>
  </>
);

export default BrandLogo;
