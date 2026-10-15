import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </Svg>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.5-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 11 4a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.5l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 20 11a2 2 0 1 1 0 4Z" />
    </Svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function PinIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 4h6l-1 6 3 3v1H7v-1l3-3-1-6Z" />
      <path d="M12 14v6" />
    </Svg>
  );
}

export function TagIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20.6 13.6 13.6 20.6a2 2 0 0 1-2.8 0l-7.4-7.4A2 2 0 0 1 2.8 11.8V5a2 2 0 0 1 2-2h6.8a2 2 0 0 1 1.4.6l7.6 7.6a2 2 0 0 1 0 2.4Z" />
      <circle cx="7.5" cy="7.5" r="1.2" />
    </Svg>
  );
}

export function GridIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </Svg>
  );
}

export function ListIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 7h14M5 12h14M5 17h14" />
    </Svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m9 6 6 6-6 6" />
    </Svg>
  );
}

export function ArrowBackIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M19 12H5m0 0 6-6m-6 6 6 6" />
    </Svg>
  );
}

export function SaveIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 4h11l3 3v13H5V4Z" />
      <path d="M8 4v5h7V4M8 20v-6h8v6" />
    </Svg>
  );
}

export function EditIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 20h4L20 8l-4-4L4 16v4Z" />
      <path d="m14 6 4 4" />
    </Svg>
  );
}

export function DeleteIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
    </Svg>
  );
}

export function ShareIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3v12m0-12 4 4m-4-4-4 4" />
      <path d="M5 13v6h14v-6" />
    </Svg>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M4 9h16M8 3v4M16 3v4" />
    </Svg>
  );
}

export function RepeatIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M17 3 21 7l-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14M7 21l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </Svg>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </Svg>
  );
}

export function NoteIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 4h14v16H5z" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </Svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m5 12 5 5 9-10" />
    </Svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

export function DotsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" />
    </Svg>
  );
}

export function ArrowDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14m0 0 6-6m-6 6-6-6" />
    </Svg>
  );
}

export function ArrowUpIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 19V5m0 0 6 6m-6-6-6 6" />
    </Svg>
  );
}

export function CakeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 21h14v-6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6Z" />
      <path d="M12 13V9M8 13V9M16 13V9" />
      <path d="M12 5.5c.8-.9.8-2 0-2.5-.8.5-.8 1.6 0 2.5Z" />
    </Svg>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      <circle cx="12" cy="15" r="1.4" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function StorageIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
      <path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
    </Svg>
  );
}

export function CloudIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 18a4 4 0 0 1 0-8 5.5 5.5 0 0 1 10.6-1.3A3.8 3.8 0 0 1 18 18Z" />
    </Svg>
  );
}

export function ServerIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="16" height="7" rx="2" />
      <rect x="4" y="13" width="16" height="7" rx="2" />
      <path d="M8 7.5h.01M8 16.5h.01" />
    </Svg>
  );
}

export function CalculatorIcon(props: IconProps) {  return (
    <Svg {...props}>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M8 7h8" />
      <path d="M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h.01M16 19h.01" />
    </Svg>
  );
}

export function PaletteIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.7 1.6-1.5 0-.4-.2-.8-.5-1.1-.3-.3-.5-.6-.5-1 0-.8.6-1.4 1.4-1.4H15a6 6 0 0 0 6-6c0-3.9-4-7-9-7Z" />
      <circle cx="8" cy="11" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="16" cy="11" r="1.1" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function ContrastIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 0 0 17Z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function LightModeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.4M12 19.1v2.4M4.3 4.3l1.7 1.7M18 18l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.3 19.7 6 18M18 6l1.7-1.7" />
    </Svg>
  );
}

export function DarkModeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.5 8.5 0 1 0 10.2 10.2Z" />
    </Svg>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 11 12 4l8 7" />
      <path d="M6 10v9h12v-9" />
    </Svg>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m15 6-6 6 6 6" />
    </Svg>
  );
}

