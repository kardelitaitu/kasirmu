import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function icon(children: JSX.Element, { size = 20, ...props }: IconProps = {}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function StoreIcon(props: IconProps) {
  return icon(<><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></>, props);
}

export function PosIcon(props: IconProps) {
  return icon(<><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /><rect x="6" y="7" width="12" height="6" rx="1" /></>, props);
}

export function WarehouseIcon(props: IconProps) {
  return icon(<><path d="M21 8v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8" /><path d="M3 4h18v4H3z" /><line x1="12" y1="12" x2="12" y2="16" /><line x1="10" y1="14" x2="14" y2="14" /></>, props);
}

export function PrinterIcon(props: IconProps) {
  return icon(<><rect x="3" y="6" width="18" height="10" rx="2" /><path d="M6 16v4h12v-4" /><rect x="7" y="9" width="10" height="3" rx="1" /><circle cx="17" cy="12" r="1" fill="currentColor" /></>, props);
}

export function FlaskIcon(props: IconProps) {
  return icon(<><path d="M9 3h6v7l5 9a2 2 0 0 1-1.73 3H5.73A2 2 0 0 1 4 19l5-9V3" /><line x1="9" y1="3" x2="15" y2="3" /><line x1="5" y1="17" x2="19" y2="17" /></>, props);
}

export function StopIcon(props: IconProps) {
  return icon(<rect x="6" y="6" width="12" height="12" rx="2" />, props);
}

export function CartIcon(props: IconProps) {
  return icon(<><circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" /><path d="M3 4h2l1 3h14l-2 8H7L5 7" /><line x1="7" y1="11" x2="19" y2="11" /></>, props);
}

export function UtensilsIcon(props: IconProps) {
  return icon(<><path d="M6 2v4a4 4 0 0 1-4 4" /><path d="M10 2v18" /><line x1="6" y1="2" x2="6" y2="6" /><path d="M18 2v18" /><path d="M14 2h4a4 4 0 0 1 4 4v2" /></>, props);
}

export function CheckIcon(props: IconProps) {
  return icon(<polyline points="20 6 9 17 4 12" />, props);
}

export function TrashIcon(props: IconProps) {
  return icon(<><line x1="4" y1="7" x2="20" y2="7" /><path d="M6 7v13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" /></>, props);
}

export function CloseIcon(props: IconProps) {
  return icon(<><line x1="17" y1="7" x2="7" y2="17" /><line x1="7" y1="7" x2="17" y2="17" /></>, props);
}

export function LockIcon(props: IconProps) {
  return icon(<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /><circle cx="12" cy="16" r="1" fill="currentColor" /></>, props);
}

export function NodesIcon(props: IconProps) {
  return icon(<><circle cx="6" cy="6" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="12" cy="18" r="3" /><line x1="8.5" y1="7.5" x2="10.5" y2="16.5" /><line x1="15.5" y1="7.5" x2="13.5" y2="16.5" /></>, props);
}

export function PlusIcon(props: IconProps) {
  return icon(<><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>, props);
}

export function MinusIcon(props: IconProps) {
  return icon(<line x1="5" y1="12" x2="19" y2="12" />, props);
}

export function ChevronDownIcon(props: IconProps) {
  return icon(<polyline points="6 9 12 15 18 9" />, props);
}

export function WarningIcon(props: IconProps) {
  return icon(<><path d="M12 3 2.5 20h19L12 3z" /><line x1="12" y1="10" x2="12" y2="14" /><circle cx="12" cy="17" r="0.6" fill="currentColor" /></>, props);
}
