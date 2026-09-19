import type { SVGProps } from 'react';

/**
 * A handful of 16px line icons, drawn inline so the page loads nothing from
 * elsewhere. Decorative by default: every icon sits next to a word that says
 * the same thing, so screen readers skip the icon.
 */
function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const RefreshIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
    <path d="M13.5 2.5v3h-3" />
  </Icon>
);

export const CheckIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="6.25" />
    <path d="M5.5 8.2l1.7 1.7 3.3-3.6" />
  </Icon>
);

export const WarningIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M8 2.2l6.2 11H1.8z" />
    <path d="M8 6.5v3" />
    <path d="M8 11.4v.1" />
  </Icon>
);

export const ErrorIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="6.25" />
    <path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" />
  </Icon>
);

export const InfoIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="6.25" />
    <path d="M8 7.2v3.6" />
    <path d="M8 5.1v.1" />
  </Icon>
);

export const SignOutIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M6.5 2.5h-3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3" />
    <path d="M10 5l3 3-3 3" />
    <path d="M13 8H6" />
  </Icon>
);

export const TableIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <rect x="2" y="3" width="12" height="10" rx="1" />
    <path d="M2 6.5h12M2 9.8h12M6.5 3v10" />
  </Icon>
);

export const ChartIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M2.5 13.5h11" />
    <path d="M3.5 11l3-3.5 2.5 2 3.5-5" />
  </Icon>
);

/** The Solar Grid mark: a hexagonal cell inside a hexagonal grid boundary. */
export function GridMark({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" focusable="false">
      <path
        d="M16 4l10.4 6v12L16 28 5.6 22V10z"
        fill="none"
        stroke="var(--color-production)"
        strokeWidth="1.75"
      />
      <path d="M16 10.5l4.8 2.75v5.5L16 21.5l-4.8-2.75v-5.5z" fill="var(--color-production)" />
    </svg>
  );
}
