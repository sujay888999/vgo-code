'use client';

import Image from 'next/image';
import clsx from 'clsx';

type SiteLogoProps = {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  priority?: boolean;
};

const SIZE_STYLES: Record<NonNullable<SiteLogoProps['size']>, string> = {
  sm: 'h-10 w-10 rounded-2xl',
  md: 'h-11 w-11 rounded-2xl',
  lg: 'h-14 w-14 rounded-[20px]',
};

export default function SiteLogo({ size = 'md', className, priority = false }: SiteLogoProps) {
  return (
    <div
      className={clsx(
        'relative overflow-hidden border border-white/10 bg-[#07131b] shadow-[0_10px_28px_rgba(15,23,42,0.16)]',
        SIZE_STYLES[size],
        className,
      )}
    >
      <Image
        src="/brand-logo.png"
        alt="VGO AI"
        fill
        sizes={size === 'lg' ? '56px' : size === 'md' ? '44px' : '40px'}
        priority={priority}
        className="object-cover"
      />
    </div>
  );
}
