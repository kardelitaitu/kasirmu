import type { HTMLAttributes, CSSProperties } from 'react';

export type SkeletonVariant = 'text' | 'circle' | 'block';

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** Shape variant. @default 'text' */
  variant?: SkeletonVariant;
  /** Explicit width (e.g. '100%', '200px'). */
  width?: string;
  /** Explicit height (e.g. '1em', '200px'). */
  height?: string;
}

export function Skeleton({
  variant = 'text',
  width,
  height,
  className,
  style,
  ...rest
}: SkeletonProps) {
  const classNames = [
    'skeleton',
    `skeleton--${variant}`,
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const resolvedStyle: CSSProperties = {
    ...style,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  };

  return (
    <div
      className={classNames}
      aria-hidden="true"
      style={resolvedStyle}
      {...rest}
    />
  );
}
