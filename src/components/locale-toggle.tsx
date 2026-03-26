'use client';

import { Button } from '@/components/ui/button';
import { useI18n } from '@/components/locale-provider';
import { cn } from '@/lib/utils';

export default function LocaleToggle({ className }: { className?: string }) {
  const { locale, setLocale } = useI18n();

  return (
    <div className={cn('inline-flex items-center rounded-full border border-[var(--app-border-soft)] bg-[var(--app-raised)] p-1', className)}>
      {(['en', 'zh'] as const).map(option => (
        <Button
          key={option}
          variant="ghost"
          size="sm"
          className={cn(
            'h-8 rounded-full px-3 text-[11px] uppercase tracking-[0.18em]',
            locale === option
              ? 'bg-[var(--app-accent-soft)] text-[var(--app-text)]'
              : 'text-[var(--app-text-muted)] hover:bg-white/[0.04] hover:text-[var(--app-text)]'
          )}
          onClick={() => setLocale(option)}
          aria-label={option === 'en' ? 'Switch to English' : '切换到中文'}
        >
          {option}
        </Button>
      ))}
    </div>
  );
}
