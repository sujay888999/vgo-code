'use client';

import { Languages } from 'lucide-react';
import { useEffect } from 'react';
import { useLanguageStore } from '@/lib/store';

export default function LanguageToggle() {
  const { language, hydrated, setLanguage, hydrateLanguage } = useLanguageStore();

  useEffect(() => {
    hydrateLanguage();
  }, [hydrateLanguage]);

  if (!hydrated) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed right-2 top-2 z-[120] md:right-4 md:top-4">
      <div className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/88 px-1.5 py-1.5 shadow-[0_8px_24px_rgba(15,23,42,0.1)] backdrop-blur">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-white">
          <Languages className="h-3.5 w-3.5" />
        </span>
        <div className="inline-flex rounded-full bg-slate-100 p-0.5">
          <button
            onClick={() => setLanguage('zh')}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium leading-none transition ${
              language === 'zh' ? 'bg-slate-900 text-white' : 'text-slate-600'
            }`}
          >
            中文
          </button>
          <button
            onClick={() => setLanguage('en')}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium leading-none transition ${
              language === 'en' ? 'bg-slate-900 text-white' : 'text-slate-600'
            }`}
          >
            EN
          </button>
        </div>
      </div>
    </div>
  );
}
