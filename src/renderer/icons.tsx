const paths = {
  note: 'M4 1.75h5.25L12.5 5v9.25H4z M9.25 1.75V5h3.25 M6 8h4.5 M6 10.5h4.5',
  folder: 'M1.75 4.25h4.5l1.5 1.5h6.5v7.5H1.75z',
  folderOpen: 'M1.75 4.25h4.5l1.5 1.5h5v1.5 M1.75 4.25v9h10.5l2-6h-10.5l-2 6',
  canvas: 'M1.75 2.75h5v3.5h-5z M9.25 9.75h5v3.5h-5z M6.75 4.5h2.5v7h0',
  graph: 'M4 4.5a1.75 1.75 0 1 0 0-.01z M12 3.5a1.75 1.75 0 1 0 0-.01z M8 12.5a1.75 1.75 0 1 0 0-.01z M5.5 5.6l1.6 5 M10.4 4.6l-1.6 6 M5.7 4.2l4.6-.5',
  plus: 'M8 3v10 M3 8h10',
  newFolder: 'M1.75 4.25h4.5l1.5 1.5h6.5v7.5H1.75z M8 7.5v4 M6 9.5h4',
  vault: 'M2.5 2.5h11v11h-11z M5 2.5v11 M7.5 6h3.5 M7.5 8.5h3.5',
  plug: 'M6 1.75v3 M10 1.75v3 M4 4.75h8v2.5a4 4 0 0 1-8 0z M8 11.25v3',
  command: 'M5.5 2.5a1.75 1.75 0 1 0 0 3.5h5a1.75 1.75 0 1 0-1.75-1.75v7.5a1.75 1.75 0 1 0 1.75-1.75h-5a1.75 1.75 0 1 0 1.75 1.75v-7.5',
  pencil: 'M10.5 2.5l3 3-8 8H2.5v-3z',
  trash: 'M2.75 4.5h10.5 M6 4.5V2.75h4V4.5 M4.25 4.5l.75 9h6l.75-9',
  close: 'M4 4l8 8 M12 4l-8 8',
  chevron: 'M6 3.5L10.5 8 6 12.5',
  file: 'M4 1.75h5.25L12.5 5v9.25H4z M9.25 1.75V5h3.25',
  image: 'M2.25 3h11.5v10H2.25z M2.25 11l3.5-3.5 3 3 2-2 3 3 M10.5 6.25a.9.9 0 1 0 0-.01z',
  pdf: 'M4 1.75h5.25L12.5 5v9.25H4z M9.25 1.75V5h3.25 M5.75 11.5h4.5 M5.75 9h4.5',
  slides: 'M2 2.75h12v8.5H2z M8 11.25v2.5 M5.5 13.75h5 M4.5 5.5h7 M4.5 8h4.5',
  check: 'M3 8.5l3 3 7-7',
  sidebar: 'M2 2.75h12v10.5H2z M6 2.75v10.5',
  link: 'M6.5 9.5l3-3 M7 4.5l1.2-1.2a2.5 2.5 0 0 1 3.5 3.5L10.5 8 M5.5 8L4.3 9.2a2.5 2.5 0 0 0 3.5 3.5L9 11.5',
  review: 'M3 3.5h10 M3 7h10 M3 10.5h5 M10 11.25l1.5 1.5 2.75-2.75',
  comment: 'M2.5 3h11v7.5H7l-3 2.5v-2.5H2.5z',
  gauge: 'M2.5 11.5a5.5 5.5 0 1 1 11 0 M8 11.5l2.75-3.75',
  terminal: 'M1.75 3h12.5v10H1.75z M4.5 6.5l2 1.75-2 1.75 M8 10.5h3.5',
  sparkle: 'M8 2l1.3 3.7L13 7l-3.7 1.3L8 12l-1.3-3.7L3 7l3.7-1.3z',
  bulb: 'M6 12.5h4 M6.5 14.25h3 M8 1.75a4 4 0 0 0-2.5 7.1V11h5V8.85A4 4 0 0 0 8 1.75z'
}

export type IconName = keyof typeof paths

/** 16px line icons drawn for this app. */
export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  )
}
