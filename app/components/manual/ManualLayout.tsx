import { useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Menu, X, Globe } from "lucide-react";
import type { Language } from "~/types/settings";

export interface ChapterInfo {
  slug: string;
  num: number;
  titleEn: string;
  titleJa: string;
  descEn: string;
  descJa: string;
}

interface ManualLayoutProps {
  lang: Language;
  chapters: ChapterInfo[];
  currentSlug?: string;
  children: React.ReactNode;
}

export function ManualLayout({ lang, chapters, currentSlug, children }: ManualLayoutProps) {
  const [tocOpen, setTocOpen] = useState(false);

  const prefix = lang === "ja" ? "/manual/ja" : "/manual";
  const lpHref = lang === "ja" ? "/lp/ja" : "/lp";
  const currentIndex = currentSlug ? chapters.findIndex((c) => c.slug === currentSlug) : -1;
  const prev = currentIndex > 0 ? chapters[currentIndex - 1] : null;
  const next = currentIndex >= 0 && currentIndex < chapters.length - 1 ? chapters[currentIndex + 1] : null;

  const switchLang = lang === "ja" ? "en" : "ja";
  const switchPrefix = switchLang === "ja" ? "/manual/ja" : "/manual";
  const switchHref = currentSlug ? `${switchPrefix}/${currentSlug}` : switchPrefix;

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      {/* Header */}
      <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-gray-200 bg-white/95 px-4 backdrop-blur dark:border-gray-800 dark:bg-gray-950/95">
        <div className="flex items-center gap-3">
          {/* Mobile TOC toggle */}
          <button
            onClick={() => setTocOpen((v) => !v)}
            className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 lg:hidden"
          >
            {tocOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <a
            href={lpHref}
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <ArrowLeft size={16} />
            <span className="hidden sm:inline">kiokuflow</span>
          </a>
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {lang === "ja" ? "マニュアル" : "Manual"}
          </span>
        </div>

        {/* Language switcher */}
        <div className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white/80 px-2.5 py-1 text-sm shadow-sm backdrop-blur dark:border-gray-700 dark:bg-gray-900/80">
          <Globe size={14} className="text-gray-500 dark:text-gray-400" />
          {lang === "en" ? (
            <>
              <span className="font-semibold text-gray-900 dark:text-gray-100">EN</span>
              <span className="text-gray-300 dark:text-gray-600">/</span>
              <a href={switchHref} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">JA</a>
            </>
          ) : (
            <>
              <a href={switchHref} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">EN</a>
              <span className="text-gray-300 dark:text-gray-600">/</span>
              <span className="font-semibold text-gray-900 dark:text-gray-100">JA</span>
            </>
          )}
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl">
        {/* TOC Sidebar */}
        <aside
          className={`${
            tocOpen ? "translate-x-0" : "-translate-x-full"
          } fixed inset-y-0 left-0 top-12 z-20 w-64 overflow-y-auto border-r border-gray-200 bg-white p-4 transition-transform dark:border-gray-800 dark:bg-gray-950 lg:static lg:block lg:translate-x-0`}
        >
          <nav className="space-y-1">
            <a
              href={prefix}
              className={`block rounded px-3 py-1.5 text-sm ${
                !currentSlug
                  ? "bg-blue-50 font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                  : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              }`}
            >
              {lang === "ja" ? "目次" : "Contents"}
            </a>
            {chapters.map((ch) => (
              <a
                key={ch.slug}
                href={`${prefix}/${ch.slug}`}
                onClick={() => setTocOpen(false)}
                className={`block rounded px-3 py-1.5 text-sm ${
                  currentSlug === ch.slug
                    ? "bg-blue-50 font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                    : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                }`}
              >
                <span className="mr-1.5 text-xs text-gray-400 dark:text-gray-500">{ch.num}.</span>
                {lang === "ja" ? ch.titleJa : ch.titleEn}
              </a>
            ))}
          </nav>
        </aside>

        {/* Overlay for mobile TOC */}
        {tocOpen && (
          <div
            className="fixed inset-0 top-12 z-10 bg-black/20 lg:hidden"
            onClick={() => setTocOpen(false)}
          />
        )}

        {/* Main content */}
        <main className="min-w-0 flex-1 px-4 py-8 sm:px-8 lg:px-12">
          <div className="mx-auto max-w-3xl">
            {children}

            {/* Prev / Next navigation */}
            {currentSlug && (
              <div className="mt-12 flex items-center justify-between border-t border-gray-200 pt-6 dark:border-gray-800">
                {prev ? (
                  <a
                    href={`${prefix}/${prev.slug}`}
                    className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    <ChevronLeft size={16} />
                    {lang === "ja" ? prev.titleJa : prev.titleEn}
                  </a>
                ) : (
                  <span />
                )}
                {next ? (
                  <a
                    href={`${prefix}/${next.slug}`}
                    className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    {lang === "ja" ? next.titleJa : next.titleEn}
                    <ChevronRight size={16} />
                  </a>
                ) : (
                  <span />
                )}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
