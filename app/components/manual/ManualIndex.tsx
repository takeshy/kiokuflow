import type { Language } from "~/types/settings";
import type { ChapterInfo } from "./ManualLayout";

interface ManualIndexProps {
  lang: Language;
  chapters: ChapterInfo[];
}

export function ManualIndex({ lang, chapters }: ManualIndexProps) {
  const prefix = lang === "ja" ? "/manual/ja" : "/manual";

  return (
    <>
      <h1 className="mb-3 text-3xl font-bold text-gray-900 dark:text-gray-50">
        {lang === "ja" ? "kiokuflow ユーザーマニュアル" : "kiokuflow User Manual"}
      </h1>
      <p className="mb-10 text-sm text-gray-500 dark:text-gray-400">
        {lang === "ja"
          ? "kiokuflow の使い方を章ごとに説明します。各章のリンクをクリックして詳細を確認してください。"
          : "A comprehensive guide to using kiokuflow. Click on a chapter to learn more."}
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {chapters.map((ch) => (
          <a
            key={ch.slug}
            href={`${prefix}/${ch.slug}`}
            className="group rounded-xl border border-gray-200 p-5 transition-colors hover:border-blue-300 hover:bg-blue-50/50 dark:border-gray-800 dark:hover:border-blue-800 dark:hover:bg-blue-950/20"
          >
            <div className="mb-1 flex items-baseline gap-2">
              <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                {String(ch.num).padStart(2, "0")}
              </span>
              <h2 className="text-base font-semibold text-gray-900 group-hover:text-blue-700 dark:text-gray-100 dark:group-hover:text-blue-300">
                {lang === "ja" ? ch.titleJa : ch.titleEn}
              </h2>
            </div>
            <p className="text-sm leading-relaxed text-gray-500 dark:text-gray-400">
              {lang === "ja" ? ch.descJa : ch.descEn}
            </p>
          </a>
        ))}
      </div>
    </>
  );
}
