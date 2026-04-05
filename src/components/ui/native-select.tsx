'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * NativeSelect — styled native <select> for use inside Dialog modals.
 *
 * base-ui Select uses Portal rendering which conflicts with Radix Dialog
 * (click on portaled dropdown triggers Dialog dismiss). This component
 * uses the native <select> element which renders inline and avoids the issue.
 */

interface NativeSelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  /** Matching size prop for consistency with base-ui Select */
  size?: 'sm' | 'default';
}

const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(
  ({ className, size = 'default', children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'flex w-full items-center rounded-[14px] border border-input bg-transparent px-3 text-sm transition-colors outline-none',
        'focus:border-ring focus:ring-3 focus:ring-ring/50',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'dark:bg-input/30',
        size === 'default' ? 'h-10 py-2' : 'h-8 py-1 rounded-[12px]',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
NativeSelect.displayName = 'NativeSelect';

export { NativeSelect };
