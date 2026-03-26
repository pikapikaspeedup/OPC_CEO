'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { detectLocale } from '@/lib/i18n/formatting';
import { getMessage, interpolate, type Locale } from '@/lib/i18n';

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}

const STORAGE_KEY = 'antigravity_locale';

const I18nContext = createContext<I18nContextValue | null>(null);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
    const initial = detectLocale(stored || (typeof navigator !== 'undefined' ? navigator.language : 'en'));
    setLocaleState(initial);
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, locale);
    }
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale: (nextLocale) => setLocaleState(nextLocale),
    t: (key, values) => interpolate(getMessage(locale, key), values),
  }), [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within a LocaleProvider');
  }
  return context;
}
