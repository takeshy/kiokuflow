import { ArrowLeft, ArrowRight, CheckCircle2, FolderSync } from "lucide-react";
import type { DriveMigrationSummary } from "~/services/drive-migration";
import type { Language } from "~/types/settings";

export interface DriveMigrationScreenProps {
  language: Language;
  email?: string;
  summary: DriveMigrationSummary | null;
  running: boolean;
  error: string | null;
  onStart: () => void;
  onPause: () => void;
}

export function DriveMigrationScreen({ language, email, summary, running, error, onStart, onPause }: DriveMigrationScreenProps) {
  const ja = language === "ja";
  const complete = summary?.status === "complete";
  const percent = summary?.total ? Math.floor(summary.copied / summary.total * 100) : 0;
  return <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
    <header className="border-b border-gray-200 bg-white px-4 py-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="mx-auto flex max-w-2xl items-center gap-3">
        <a href="/settings" aria-label={ja ? "設定に戻る" : "Back to settings"} className="rounded p-2"><ArrowLeft size={20} /></a>
        <span className="text-lg font-bold">{ja ? "設定" : "Settings"}</span>
      </div>
    </header>
    <main className="mx-auto max-w-2xl px-4 py-6 sm:py-10">
      <div className="mb-5 flex items-center gap-3"><FolderSync className="shrink-0 text-blue-600" size={28} /><h1 className="text-xl font-bold sm:text-2xl">{ja ? "旧環境からの引き継ぎ" : "Bring your existing workspace"}</h1></div>
      {email && <p className="mb-4 break-all text-sm text-gray-600 dark:text-gray-300">{ja ? "Googleアカウント: " : "Google account: "}{email}</p>}
      <section className="space-y-5 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900 sm:p-7">
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">{ja ? "GemiHubはkiokuflowへ変わりました" : "GemiHub is now kiokuflow"}</h2>
          <p className="break-words text-sm leading-7">{ja ? "新しいサービスのURLは " : "The new service is at "}<a className="font-semibold text-blue-600 underline dark:text-blue-400" href="https://kiokuflow.net">kiokuflow.net</a>{ja ? " です。これまで使っていたGoogleアカウントで、そのままご利用いただけます。" : ". Continue using your existing Google account."}</p>
        </div>
        {summary ? <>
          <p className="text-sm leading-7">{ja ? "旧GemiHubのワークスペースが見つかりました。ノート・添付ファイル・履歴・設定・暗号鍵を、新しいkiokuflowのDriveフォルダへコピーします。コピーの検証後に旧設定だけをゴミ箱へ移し、元のノートや添付ファイルは残します。" : "We found your existing GemiHub workspace. Copy your notes, attachments, history, settings and encryption identity to the new kiokuflow Drive folder. After verifying the copy, only the old settings file is moved to Trash. Original notes and attachments remain."}</p>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-gray-600 dark:text-gray-300">
            <li>{ja ? "始める前に、旧環境で全端末の編集内容をPushし、コピー中は旧・新環境での編集を止めてください。" : "Push edits from all devices before starting. Pause editing in both workspaces during the copy."}</li>
            <li>{ja ? "引き継ぎ先の同名ファイルと設定は旧環境の内容で上書きします。同名フォルダは再利用し、旧環境にないファイルは残します。復号にはこれまでのパスワードを使います。" : "Files with matching names and your settings will be overwritten with the old workspace's contents. Matching folders are reused and other destination files are kept. Keep using your existing decryption password."}</li>
            <li>{ja ? "ファイルIDが変わるため、RAG索引は再登録が必要です。公開リンク・履歴内の旧ファイル参照・外部同期の接続先も確認してください。" : "File IDs change. Rebuild your RAG indexes and check public links, older file references in history, and external sync connections."}</li>
            <li>{ja ? "中断しても、同じアカウントでこの画面を開けば続きから再開できます。大きなファイルは分割してコピーします。" : "Return to this page with the same account to resume. Large files are copied in chunks."}</li>
          </ul>
          {summary.prepared && !complete && <div className="space-y-2" aria-live="polite">
            <div className="flex justify-between text-sm"><span>{ja ? "コピー済み" : "Copied"}</span><span>{summary.copied} / {summary.total}</span></div>
            <progress className="h-2 w-full" value={summary.copied} max={Math.max(summary.total, 1)} aria-label={ja ? "移行の進捗" : "Migration progress"} />
            <p className="break-all text-xs text-gray-500">{summary.currentFile ?? (ja ? "設定と同期情報を確認しています" : "Verifying settings and sync metadata")} ({percent}%)</p>
          </div>}
          {complete ? <div className="space-y-4" role="status">
            <p className="flex items-center gap-2 font-semibold text-green-700 dark:text-green-400"><CheckCircle2 size={20} />{ja ? "引き継ぎが完了しました" : "Your workspace has been copied"}</p>
            <p className="text-sm leading-6">{ja ? "kiokuflowでPullし、ノートと暗号化済み履歴を確認してください。RAGは設定から再登録してください。旧設定はゴミ箱へ移しました。GemiHubに戻り「移行完了を確認する」を選ぶと、お店の機能を利用できます。" : "Pull in kiokuflow, check your notes and encrypted history, then rebuild RAG indexes in Settings. The old settings file is now in Trash. Return to GemiHub and choose Check migration completion to use its shop features."}</p>
            <a href="/" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">{ja ? "kiokuflowを開く" : "Open kiokuflow"}<ArrowRight size={16} /></a>
          </div> : <button type="button" onClick={running ? onPause : onStart} className="min-h-11 w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 sm:w-auto">
            {running ? (ja ? "このファイルの処理後に中断" : "Pause after this request") : summary.prepared ? (ja ? "引き継ぎを再開する" : "Resume copy") : (ja ? "データの引き継ぎを開始する" : "Start copying my workspace")}
          </button>}
        </> : <p className="text-sm leading-7">{ja ? "このGoogleアカウントには引き継ぎ対象の旧環境が登録されていません。旧GemiHubと同じGoogleアカウントでログインしてください。新規の方はそのままkiokuflowをご利用いただけます。" : "No existing workspace is registered for this Google account. Sign in with the account you used for GemiHub, or continue to kiokuflow as a new user."}</p>}
        {error && <p role="alert" className="break-words rounded-lg bg-red-50 p-3 text-sm leading-6 text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
      </section>
    </main>
  </div>;
}
