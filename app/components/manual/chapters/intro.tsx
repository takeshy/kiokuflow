import type { Language } from "~/types/settings";
import { prose } from "../prose";

export function IntroChapter({ lang }: { lang: Language }) {
  if (lang === "ja") return <IntroJa />;
  return <IntroEn />;
}

function IntroEn() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">What is kiokuflow?</h1>
      <figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
        <img src="/images/cap.png" alt="kiokuflow main screen" className="w-full" loading="lazy" />
      </figure>
      <div className={prose}>
        <p>
          kiokuflow is an AI-powered workspace that connects your chosen AI provider with Google Drive. It combines an AI chat assistant, a file editor, visual workflow automation, and meaning-based search (RAG) — all in a single browser-based IDE.
        </p>

        <h2>Key Features</h2>
        <ul>
          <li><strong>AI Chat</strong> — Choose Gemini, OpenAI, OpenRouter or OpenCode Go for file-aware chat and model-dependent tools. Gemini and OpenAI also support Live conversations; Gemini supports image generation.</li>
          <li><strong>File Editor</strong> — Edit Markdown files with WYSIWYG, Preview, and Raw modes. Built-in diff view and edit history.</li>
          <li><strong>Visual Workflows</strong> — Build automation with a drag-and-drop editor. 26 base node types including AI prompts, AI decisions, Drive operations, HTTP requests, and interactive prompts.</li>
          <li><strong>Smart Search</strong> — Search your files by keyword (Local/Drive) or by meaning (RAG).</li>
          <li><strong>Offline-First</strong> — All files are cached in your browser. Edit offline, then sync changes to Drive when ready.</li>
          <li><strong>Encryption</strong> — Optional client-side RSA+AES encryption for sensitive files, chat history, and workflow logs.</li>
          <li><strong>Plugin System</strong> — Extend the app with plugins installed from GitHub.</li>
          <li><strong>MCP Integration</strong> — Connect external tools via the Model Context Protocol.</li>
          <li><strong>Self-Hostable</strong> — Personal source files stay in your Google Drive. Paid RAG uses Firestore; organization projects use managed cloud storage.</li>
        </ul>

        <h2>Architecture</h2>
        <p>
          kiokuflow is a web application built with React and React Router (SSR). Personal files, chat history, workflows and settings use a dedicated <code>kiokuflow/</code> folder on your Google Drive. Existing workspaces keep their original folder. Paid RAG stores a rebuildable search index in Firestore; organization projects use managed cloud storage.
        </p>
        <p>
          The browser uses IndexedDB for local caching. You can work entirely offline and sync changes to Drive with a manual Push to Drive / Pull to Local mechanism.
        </p>

        <h2>Technology Stack</h2>
        <ul>
          <li><strong>AI</strong> — Gemini, OpenAI, OpenRouter and OpenCode Go for chat; Gemini/OpenAI embeddings for paid RAG; Gemini/OpenAI Live conversations</li>
          <li><strong>Storage</strong> — Google Drive for personal files, Cloud Storage for organization projects, Firestore for accounts and paid RAG</li>
          <li><strong>Frontend</strong> — React 19, React Router 7, Tailwind CSS v4</li>
          <li><strong>Hosting</strong> — Google Cloud shared VM / Cloud Run, or self-hosted</li>
        </ul>
      </div>
    </>
  );
}

function IntroJa() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">kiokuflowとは</h1>
      <figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
        <img src="/images/cap.png" alt="kiokuflow メイン画面" className="w-full" loading="lazy" />
      </figure>
      <div className={prose}>
        <p>
          kiokuflowは、選択したAIプロバイダとGoogle DriveをつなぐAIワークスペースです。AIチャット、ファイルエディタ、ビジュアルワークフロー自動化、意味検索(RAG)を、ひとつのブラウザベースIDEに統合しています。
        </p>

        <h2>主な機能</h2>
        <ul>
          <li><strong>AIチャット</strong> — Gemini・OpenAI・OpenRouter・OpenCode Goを選べる、ファイルやツールを使った対話。GeminiとOpenAIのLive会話にも対応し、Geminiでは画像生成も使えます。</li>
          <li><strong>ファイルエディタ</strong> — WYSIWYG、プレビュー、Rawモードでのマークダウン編集。差分表示と編集履歴も内蔵。</li>
          <li><strong>ビジュアルワークフロー</strong> — ドラッグ＆ドロップで自動化を構築。AIプロンプト、AI判定、Drive操作、HTTPリクエスト、対話型プロンプトなど26種の基本ノード。</li>
          <li><strong>スマート検索</strong> — キーワード検索（ローカル/Drive）と意味検索(RAG)。</li>
          <li><strong>オフラインファースト</strong> — すべてのファイルがブラウザにキャッシュ。オフラインで編集し、準備ができたらドライブ反映。</li>
          <li><strong>暗号化</strong> — クライアントサイドのRSA+AES暗号化で、ファイル、チャット履歴、ワークフローログを保護。</li>
          <li><strong>プラグインシステム</strong> — GitHubからインストール可能なプラグインでアプリを拡張。</li>
          <li><strong>MCP連携</strong> — Model Context Protocol経由で外部ツールを接続。</li>
          <li><strong>セルフホスト対応</strong> — 個人の元ファイルは自分のGoogle Driveに保存。有料RAGはFirestore、組織プロジェクトはマネージドクラウドストレージを利用します。</li>
        </ul>

        <h2>アーキテクチャ</h2>
        <p>
          kiokuflowは、ReactとReact Router（SSR）で構築されたWebアプリケーションです。個人のファイル・チャット履歴・ワークフロー・設定は、自分のGoogle Drive内の<code>kiokuflow/</code>フォルダに保存します。既存ワークスペースは元のフォルダを引き継ぎます。有料RAGの検索用インデックスはFirestore、組織プロジェクトはマネージドクラウドストレージを利用します。
        </p>
        <p>
          ブラウザはIndexedDBをローカルキャッシュとして使用します。完全にオフラインで作業し、手動のドライブ反映 / ローカル反映でDriveと変更を同期できます。
        </p>

        <h2>技術スタック</h2>
        <ul>
          <li><strong>AI</strong> — Gemini・OpenAI・OpenRouter・OpenCode Go、有料RAGのGemini／OpenAI embedding、Gemini／OpenAI Live会話</li>
          <li><strong>ストレージ</strong> — 個人のGoogle Drive、組織のCloud Storage、アカウント・有料RAGのFirestore</li>
          <li><strong>フロントエンド</strong> — React 19、React Router 7、Tailwind CSS v4</li>
          <li><strong>ホスティング</strong> — Google Cloudの共有VM／Cloud Run、またはセルフホスト</li>
        </ul>
      </div>
    </>
  );
}
