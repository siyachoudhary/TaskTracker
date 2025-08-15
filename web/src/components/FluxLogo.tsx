// src/components/FluxLogo.tsx
import * as React from "react";

/** Gradient mark (icon) */
export function FluxMark({
  size = 28,
  className = "",
  monochrome = false,
}: {
  size?: number;
  className?: string;
  monochrome?: boolean;
}) {
  const gid = React.useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className={className} role="img">
      <defs>
        <linearGradient id={`${gid}-flux`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366F1" />
          <stop offset="1" stopColor="#06B6D4" />
        </linearGradient>
      </defs>
      <path d="M12 46c0-14 10-22 24-22h2c8 0 14-6 14-14" fill="none"
        stroke={monochrome ? "currentColor" : `url(#${gid}-flux)`} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M52 18c0 14-10 22-24 22h-2c-8 0-14 6-14 14" fill="none"
        stroke={monochrome ? "currentColor" : `url(#${gid}-flux)`} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" opacity="0.92" />
    </svg>
  );
}

/** Wordmark lockup */
export function FluxLogo({
  size = 24,
  className = "",
  monochrome = false,
}: {
  size?: number;
  className?: string;
  monochrome?: boolean;
}) {
  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <FluxMark size={size} monochrome={monochrome} />
      <span
        className={`font-semibold tracking-tight leading-none ${
          monochrome ? "" : "bg-gradient-to-r from-indigo-600 to-cyan-500 text-transparent bg-clip-text"
        }`}
        style={{ fontFeatureSettings: '"ss01","ss02","cv01","cv02"' }}
      >
        Flux
      </span>
    </div>
  );
}

/** Reusable decorative waves (for Auth/Orgs/Admin pages) */
export function FluxWaves({
  className = "",
  height = 520,
  opacity = 0.6,
}: {
  className?: string;
  height?: number;
  opacity?: number;
}) {
  return (
    <svg
      className={className}
      style={{ height }}
      viewBox="0 0 1440 560"
      aria-hidden
    >
      <defs>
        <linearGradient id="flux-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366F1" />
          <stop offset="1" stopColor="#06B6D4" />
        </linearGradient>
        <linearGradient id="flux-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="white" stopOpacity="0.6" />
          <stop offset="1" stopColor="white" stopOpacity="1" />
        </linearGradient>
        <mask id="flux-mask">
          <rect width="100%" height="100%" fill="url(#flux-fade)" />
        </mask>
      </defs>
      <g mask="url(#flux-mask)" fill="none" stroke="url(#flux-grad)" strokeWidth="2" opacity={opacity}>
        <path d="M-20 120 C200 40, 380 200, 620 120 S1100 40, 1460 160" />
        <path d="M-20 220 C220 140, 420 260, 640 180 S1120 100, 1460 240" />
        <path d="M-20 320 C240 240, 460 320, 680 260 S1140 180, 1460 320" />
      </g>
    </svg>
  );
}

/** Compact lockup used in page headers: mark + tiny waves */
export function FluxMarkWithWaves({
  size = 18,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span className={`relative inline-flex items-center ${className}`}>
      <FluxMark size={size} />
      <span className="absolute -z-10 inset-0 translate-y-[8px] scale-125 opacity-40">
        <FluxWaves height={40} opacity={0.35} />
      </span>
    </span>
  );
}