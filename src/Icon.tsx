import type { CSSProperties } from 'react'

const paths = {
  settings: <><circle cx="12" cy="12" r="3" /><path d="M9.53 4.39 9.92 2.22 14.08 2.22 14.47 4.39 17.35 6.05 19.43 5.31 21.51 8.91 19.83 10.34 19.83 13.66 21.51 15.09 19.43 18.69 17.35 17.95 14.47 19.61 14.08 21.78 9.92 21.78 9.53 19.61 6.65 17.95 4.57 18.69 2.49 15.09 4.17 13.66 4.17 10.34 2.49 8.91 4.57 5.31 6.65 6.05Z" /></>,
  moon: <path d="M20 15A9 9 0 0 1 9 4 9 9 0 1 0 20 15Z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2" /></>,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
  frame: <><rect x="3" y="3" width="18" height="18" rx="1" /><path d="M3 9h18M9 9v12" /></>,
  layers: <path d="m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5" />,
  box: <><path d="m12 2 9 5v10l-9 5-9-5V7Zm0 10 9-5M12 12 3 7m9 5v10" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10h.01" /></>,
  trash: <><path d="M3 6h18M9 6V3h6v3m-10 0 1 15h12l1-15M10 10v7m4-7v7" /></>,
  ruler: <><path d="m3 16 13-13 5 5L8 21Zm5-5 2 2m2-6 2 2m2-6 2 2" /></>,
  reset: <><path d="M3 11a9 9 0 1 1 3 8M3 4v7h7" /></>,
  maximize: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />,
  plus: <path d="M12 4v16M4 12h16" />,
  close: <path d="m5 5 14 14M5 19 19 5" />,
  chevron: <path d="m6 15 6-6 6 6" />,
  folder: <><path d="M3 7V5h6l3 3h9v12H3Z" /><path d="M3 10h18" /></>,
  save: <><path d="M4 3h13l3 3v15H4Z" /><path d="M8 3v6h8V3M8 21v-8h8v8" /></>,
  share: <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m9 11 6-4M9 14l6 4" /></>,
  download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />,
  eye: <><path d="M2 12c5-10 15-10 20 0-5 10-15 10-20 0Z" /><circle cx="12" cy="12" r="3" /></>,
  explode: <path d="M3 8V3h5m8 0h5v5M3 16v5h5m8 0h5v-5M3 3l6 6m6 6 6 6M21 3l-6 6m-6 6-6 6" />,
  archive: <path d="M3 4h18v4H3ZM5 8v12h14V8m-9 4h4" />,
  scale: <><path d="M12 3v18m-6 0h12M4 7h16M5 7l-4 8h8ZM19 7l-4 8h8Z" /></>,
  cart: <><path d="M2 3h3l3 12h11l3-9H6" /><circle cx="9" cy="20" r="1" /><circle cx="18" cy="20" r="1" /></>,
  instagram: <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r=".6" /></>,
  tiktok: <path d="M15 3v12a5 5 0 1 1-4-5m4-7c0 4 3 6 6 6" />,
  youtube: <><rect x="2" y="5" width="20" height="14" rx="4" /><path d="m10 9 5 3-5 3Z" /></>,
  pinterest: <><circle cx="12" cy="12" r="9" /><path d="m8 20 4-13m-1 8c7 4 9-10 1-10-6 0-7 8-3 9" /></>,
  reddit: <><ellipse cx="12" cy="14" rx="8" ry="6" /><circle cx="9" cy="13" r=".6" /><circle cx="15" cy="13" r=".6" /><path d="M9 17c2 1 4 1 6 0M12 8l2-5 5 1M4 10C0 7 0 14 4 14m16-4c4-3 4 4 0 4" /><circle cx="20" cy="4" r="2" /></>,
}
export type IconName = keyof typeof paths
export function Icon({ name, size = 16, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>{paths[name]}</svg>
}
