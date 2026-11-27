import React from 'react'

const shapes = {
  copy: <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4"/></>,
  download: <path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5"/>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
  identity: <><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3.5 9h17M3.5 15h17"/></>,
  independent: <><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/></>,
  operator: <><circle cx="12" cy="7.4" r="4.2"/><path d="M3.5 21a8.5 8.5 0 0 1 17 0"/></>,
  substance: <><path d="m12 2.5 9 5v9l-9 5-9-5v-9l9-5Zm-9 5 9 5 9-5m-9 5v9"/></>,
  link: <><path d="m10 14 4-4m-5 2-2 2a3.5 3.5 0 0 0 5 5l3-3m0-4 2-2a3.5 3.5 0 0 0-5-5L9 8"/></>,
  arrow: <path d="M4 12h15m-6-6 6 6-6 6"/>,
  external: <path d="M7 17 17 7M7 7h10v10"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  alert: <><circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 3v.2"/></>,
}
export function Icon({name}) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">{shapes[name]}</svg>
}
export function Brand() {
  return <span className="brand"><img src="/lens-mark.svg" alt="" />SaaSLens</span>
}
