import type { Language } from "~/types/settings";
import { prose } from "../prose";

export function LayoutChapter({ lang }: { lang: Language }) {
  if (lang === "ja") return <LayoutJa />;
  return <LayoutEn />;
}

function LayoutEn() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">Screen Layout</h1>
      <figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
        <img src="/images/cap.png" alt="kiokuflow IDE layout" className="w-full" loading="lazy" />
      </figure>
      <div className={prose}>
        <p>
          kiokuflow uses an IDE-style layout with four main areas: the Header, the Left Sidebar, the Main Viewer, and the Right Sidebar.
        </p>

        <h2>Header</h2>
        <p>The top bar contains:</p>
        <ul>
          <li><strong>kiokuflow logo</strong> — Links to the landing page.</li>
          <li><strong>Sync status</strong> — Shows Push to Drive / Pull to Local badges with pending change counts. Click to view change details or initiate sync.</li>
          <li><strong>Quick Open</strong> — Click the search icon or press <kbd>Ctrl+P</kbd> / <kbd>Cmd+P</kbd> to quickly navigate to any file.</li>
          <li><strong>Panel tabs</strong> — Toggle between Chat, Workflow, and Plugin panels on the right.</li>
          <li><strong>Settings</strong> — Opens the Settings page.</li>
          <li><strong>Manual</strong> — Opens this user manual in a new tab.</li>
          <li><strong>Logout</strong> — Signs out of kiokuflow.</li>
        </ul>

        <h2>Left Sidebar</h2>
        <p>The left sidebar shows the file tree from your Google Drive <code>kiokuflow/</code> folder. You can:</p>
        <ul>
          <li>Click a file to open it in the Main Viewer.</li>
          <li>Right-click for context menu actions (rename, download, delete, publish, encrypt, etc.).</li>
          <li>Create new files or folders using the toolbar buttons at the top.</li>
          <li>Switch to the Search panel with <kbd>Ctrl+Shift+F</kbd> / <kbd>Cmd+Shift+F</kbd>.</li>
        </ul>

        <h2>Main Viewer</h2>
        <p>The central area displays the currently selected file. Content adapts based on file type:</p>
        <ul>
          <li><strong>Markdown (.md)</strong> — Preview, WYSIWYG, and Raw editing modes with a mode switcher.</li>
          <li><strong>Workflow (.yaml)</strong> — Visual Mermaid diagram in Preview mode, YAML editor in Raw mode.</li>
          <li><strong>Images</strong> — Image viewer with zoom.</li>
          <li><strong>PDF</strong> — Embedded PDF viewer.</li>
          <li><strong>Audio / Video</strong> — Media player.</li>
          <li><strong>Encrypted (.encrypted)</strong> — Password prompt, then decrypted content editor.</li>
        </ul>
        <p>The Diff mode lets you compare the current file side-by-side with any other file.</p>

        <h2>Right Sidebar</h2>
        <p>Toggle between panels using the header tabs:</p>
        <ul>
          <li><strong>Chat</strong> — AI chat panel with conversation history, model selection, and tool settings.</li>
          <li><strong>Workflow</strong> — Workflow properties editor and execution panel (when a YAML file is selected).</li>
          <li><strong>Plugins</strong> — Custom sidebar views provided by installed plugins.</li>
        </ul>

        <h2>Mobile Layout</h2>
        <p>On small screens, the layout adapts: the left sidebar becomes a bottom-sheet or a toggleable drawer, and the right panel tabs appear in a bottom navigation bar.</p>
      </div>
    </>
  );
}

function LayoutJa() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">画面構成</h1>
      <figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
        <img src="/images/cap.png" alt="kiokuflow IDE画面構成" className="w-full" loading="lazy" />
      </figure>
      <div className={prose}>
        <p>
          kiokuflowはIDE風のレイアウトで、ヘッダー、左サイドバー、メインビューア、右サイドバーの4つのエリアで構成されています。
        </p>

        <h2>ヘッダー</h2>
        <p>上部バーには以下が含まれます：</p>
        <ul>
          <li><strong>kiokuflowロゴ</strong> — ランディングページへのリンク。</li>
          <li><strong>同期ステータス</strong> — ドライブ反映 / ローカル反映のバッジで保留中の変更数を表示。クリックで変更の詳細表示や同期を実行。</li>
          <li><strong>Quick Open</strong> — 検索アイコンをクリックするか<kbd>Ctrl+P</kbd> / <kbd>Cmd+P</kbd>で任意のファイルにすばやく移動。</li>
          <li><strong>パネルタブ</strong> — 右側のチャット、ワークフロー、プラグインパネルを切り替え。</li>
          <li><strong>設定</strong> — 設定ページを開く。</li>
          <li><strong>マニュアル</strong> — このユーザーマニュアルを新しいタブで開く。</li>
          <li><strong>ログアウト</strong> — kiokuflowからサインアウト。</li>
        </ul>

        <h2>左サイドバー</h2>
        <p>左サイドバーには、Google Drive <code>kiokuflow/</code>フォルダのファイルツリーが表示されます：</p>
        <ul>
          <li>ファイルをクリックしてメインビューアで開く。</li>
          <li>右クリックでコンテキストメニュー（名前変更、ダウンロード、削除、公開、暗号化など）。</li>
          <li>上部のツールバーボタンで新しいファイルやフォルダを作成。</li>
          <li><kbd>Ctrl+Shift+F</kbd> / <kbd>Cmd+Shift+F</kbd>で検索パネルに切り替え。</li>
        </ul>

        <h2>メインビューア</h2>
        <p>中央エリアには選択中のファイルが表示されます。ファイルタイプに応じて表示が変わります：</p>
        <ul>
          <li><strong>Markdown (.md)</strong> — プレビュー、WYSIWYG、Raw編集モードとモード切り替え。</li>
          <li><strong>ワークフロー (.yaml)</strong> — プレビューモードでMermaidダイアグラム、RawモードでYAMLエディタ。</li>
          <li><strong>画像</strong> — ズーム機能付き画像ビューア。</li>
          <li><strong>PDF</strong> — 埋め込みPDFビューア。</li>
          <li><strong>音声 / 動画</strong> — メディアプレーヤー。</li>
          <li><strong>暗号化ファイル (.encrypted)</strong> — パスワード入力後、復号されたコンテンツのエディタ。</li>
        </ul>
        <p>比較モードでは、現在のファイルと他のファイルをサイドバイサイドで比較できます。</p>

        <h2>右サイドバー</h2>
        <p>ヘッダーのタブでパネルを切り替えます：</p>
        <ul>
          <li><strong>チャット</strong> — 会話履歴、モデル選択、ツール設定を備えたAIチャットパネル。</li>
          <li><strong>ワークフロー</strong> — ワークフロープロパティエディタと実行パネル（YAMLファイル選択時）。</li>
          <li><strong>プラグイン</strong> — インストール済みプラグインが提供するカスタムサイドバービュー。</li>
        </ul>

        <h2>モバイルレイアウト</h2>
        <p>小さな画面では、レイアウトが適応されます：左サイドバーはボトムシートまたはトグル可能なドロワーになり、右パネルタブはボトムナビゲーションバーに表示されます。</p>
      </div>
    </>
  );
}
