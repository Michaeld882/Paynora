/** Paynora mark: a rounded "P" whose bowl is an open payment arc, with a single ember dot in motion. */
export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="10" className="fill-ink dark:fill-[#D6E4FA]" />
      <path
        d="M11 23V9h6a5 5 0 0 1 0 10h-6"
        className="stroke-white dark:stroke-[#090F1A]"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="22" cy="23" r="2.4" className="fill-ember" />
    </svg>
  )
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark />
      <span className="font-display text-[22px] font-bold leading-none tracking-[-0.04em] text-ink">
        paynora<span className="text-ember">.</span>
      </span>
    </span>
  )
}
