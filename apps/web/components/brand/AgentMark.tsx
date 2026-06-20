"use client";

import { useId } from "react";

export function AgentMark({ className = "h-7 w-7" }: { className?: string }) {
  const uid = useId().replace(/:/g, "");

  return (
    <svg viewBox="0 0 32 32" fill="none" className={`rounded-full ${className}`} aria-hidden>
      <defs>
        <linearGradient id={`${uid}-bg`} x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="rgba(0, 119, 238, 0.18)" />
          <stop offset="1" stopColor="rgba(0, 221, 187, 0.12)" />
        </linearGradient>
        <linearGradient id={`${uid}-stroke`} x1="8" y1="6" x2="24" y2="26" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0077EE" />
          <stop offset="1" stopColor="#00DDBB" />
        </linearGradient>
        <radialGradient
          id={`${uid}-core`}
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(16 15) rotate(90) scale(6)"
        >
          <stop stopColor="#7C5CFC" stopOpacity="0.9" />
          <stop offset="1" stopColor="#0077EE" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="16" fill={`url(#${uid}-bg)`} />
      <path
        d="M16 4 26 10v12L16 28 6 22V10L16 4Z"
        stroke={`url(#${uid}-stroke)`}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="15" r="3.25" fill={`url(#${uid}-core)`} />
      <circle cx="16" cy="8.5" r="1.4" fill="#00DDBB" />
      <circle cx="22.5" cy="18" r="1.4" fill="#0077EE" />
      <circle cx="9.5" cy="18" r="1.4" fill="#0077EE" />
      <path
        d="M16 11.75v3.5M13.25 15h5.5"
        stroke="#fff"
        strokeWidth="1.25"
        strokeLinecap="round"
        opacity="0.9"
      />
    </svg>
  );
}
