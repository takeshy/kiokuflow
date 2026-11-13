import { SHOW_ADVANCED_PLANS, SHOW_WEBPAGE_BUILDER } from "~/config/feature-visibility";
import { PUBLIC_ORIGIN, SERVICE_NAME } from "~/config/branding";
import type { MetaFunction } from "react-router";
import { LogIn, MessageSquare, MessagesSquare, Search, Puzzle, GitBranch, Shield, User, HardDrive, Lock, ServerCog, Github, Globe, Zap, BookOpen, RefreshCw, CreditCard, FileSpreadsheet, Server, Upload, FileText, PenTool, Check, X, Calculator, Music, LayoutDashboard, GitCompare, Highlighter, KeyRound, Building2, UserCog, Sparkles, Database, Copy, Clock } from "lucide-react";
import type { ComponentType } from "react";
import { useEffect } from "react";
import { useLocation } from "react-router";
import type { Language } from "~/types/settings";
import { LanguageSwitcher } from "~/components/LanguageSwitcher";

export function headers() {
  return {
    "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400, max-age=3600",
  };
}

export const meta: MetaFunction = ({ location }) => {
  const strings = location.pathname.endsWith("/ja") ? ja : en;
  const url = `${PUBLIC_ORIGIN}/lp${location.pathname.endsWith("/ja") ? "/ja" : ""}`;
  return [
    { title: `${SERVICE_NAME} — ${strings.tagline}` },
    { name: "application-name", content: SERVICE_NAME },
    { name: "description", content: strings.description },
    { property: "og:site_name", content: SERVICE_NAME },
    { property: "og:title", content: `${SERVICE_NAME} — ${strings.tagline}` },
    { property: "og:description", content: strings.description },
    { property: "og:url", content: url },
    { tagName: "link", rel: "canonical", href: url },
  ];
};

interface Feature {
  icon: ComponentType<{ size?: number; className?: string }>;
  title: string;
  description: string;
}

interface Screenshot {
  src: string;
  alt: string;
  description: string;
}

interface DataCard {
  icon: ComponentType<{ size?: number; className?: string }>;
  title: string;
  description: string;
}

interface PluginShowcase {
  icon: ComponentType<{ size?: number; className?: string }>;
  name: string;
  repo: string;
  description: string;
  image?: string;
}

interface LpStrings {
  tagline: string;
  description: string;
  signIn: string;
  features: Feature[];
  screenshotsTitle: string;
  screenshots: Screenshot[];
  dataUsageTitle: string;
  dataUsageIntro: string;
  dataCards: DataCard[];
  pluginShowcaseTitle: string;
  pluginShowcases: PluginShowcase[];
  pluginShowcaseInstall: string;
  pluginShowcaseLink: string;
  dataUsageOrgNote: string;
  dataUsageLearnMore: string;
  privacyPolicy: string;
  heroManual: string;
  ctaReady: string;
  footerTerms: string;
  footerPolicy: string;
  footerTokushoho: string;
  footerManual: string;
  footerContact: string;
  premiumTitle: string;
  premiumIntro: string;
  premiumFree: string;
  premiumLite: string;
  premiumPro: string;
  premiumBusiness: string;
  premiumLitePrice: string;
  premiumProPrice: string;
  premiumBusinessPrice: string;
  premiumFreeTag: string;
  premiumFeatureUpload: string;
  premiumFeatureUploadFree: string;
  premiumFeatureUploadPaid: string;
  premiumFeatureRag: string;
  premiumFeatureInteractions: string;
  premiumFeatureInteractionsDesc: string;
  premiumFeaturePdf: string;
  premiumFeaturePdfDesc: string;
  premiumFeatureObsidianToken: string;
  premiumFeatureObsidianTokenDesc: string;
  premiumFeatureTempUrl: string;
  premiumFeatureTempUrlDesc: string;
  premiumFeatureSheets: string;
  premiumFeatureSheetsDesc: string;
  premiumFeatureHosting: string;
  premiumFeatureHostingDesc: string;
  premiumFeatureHostingProDesc: string;
  premiumFeatureAiBillingSchedule: string;
  premiumFeatureAiBillingScheduleDesc: string;
  premiumFeatureDomain: string;
  premiumFeatureDomainDesc: string;
  premiumFeatureSchedule: string;
  premiumFeatureScheduleDesc: string;
  premiumFeatureServerExec: string;
  premiumFeatureServerExecDesc: string;
  premiumFeatureWebBuilder: string;
  premiumFeatureWebBuilderDesc: string;
  premiumFeatureOrg: string;
  premiumFeatureVertex: string;
  premiumFeatureAiBudget: string;
  premiumFeatureAiBudgetValue: string;
  premiumFeatureStorage: string;
  premiumFeatureStorageValue: string;
  premiumIncluded: string;
  premiumNotIncluded: string;
  teamTitle: string;
  teamBadge: string;
  teamIntro: string;
  teamCards: DataCard[];
}

const en: LpStrings = {
  tagline: "AI That Acts, Not Just Answers",
  description: "kiokuflow is an AI workspace for Gemini, OpenAI, OpenRouter, and OpenCode Go that reads your files, finds what you need, and gets things done. Read PDFs, EPUBs, and notes with quote-anchored memos, connect external tools, search across your documents by meaning, and automate repetitive tasks — with personal source files kept in your own Google Drive.",
  signIn: "Sign in with Google",
  features: [
    { icon: Highlighter, title: "Read & Memo", description: "Open PDFs, EPUBs, Markdown, and images, select a passage, and attach a memo right where you read. Quotes are highlighted and jump both ways. Notes are saved as plain Markdown in your Drive." },
    { icon: LayoutDashboard, title: "Personal Dashboards", description: "Build a home screen from file viewers (Markdown, PDF, EPUB, images), memo lists, cards, editable tables, kanban boards, workflow output, and web embeds." },
    { icon: MessageSquare, title: "AI Chat", description: "Choose Gemini, OpenAI, OpenRouter, or OpenCode Go to work with your files and tools. Fetch and enable multiple models for OpenAI, OpenRouter, or OpenCode Go. Gemini and OpenAI Live let you talk naturally about your files, with read-only file search and paid RAG, interruption, and mute." },
    { icon: Search, title: "Ask Your Files", description: "Switch between file-name and content search. Search words locally, or ask questions against synced server indexes with paid RAG. Expand results with fuzzy matching." },
    { icon: BookOpen, title: "Notes & Editor", description: "Jot down notes in Markdown. Save ideas and meeting notes straight to Drive." },
    { icon: GitBranch, title: "Workflows", description: "Just describe what you want and AI builds an automation workflow. Works with Drive, the web, and external services." },
    { icon: GitCompare, title: "Obsidian-Friendly", description: "Use Obsidian-compatible Canvas files and sync notes with the GemiHub Drive Sync plugin through the same Drive metadata." },
    { icon: Puzzle, title: "Plugins", description: "Add new features from GitHub. Plugins can use AI and Drive, so you can build custom tools and advanced automation." },
    { icon: Globe, title: "One-Click Publishing", description: "Turn Drive files into public pages and share them by URL." },
    { icon: Zap, title: "Works Offline", description: "All files cached in your browser for instant access — even without internet. Edit offline, then push changes to Drive with one click. Conflicts are detected automatically." },
    { icon: KeyRound, title: "Encrypted Secrets", description: "Store API tokens, passwords, and other secrets as RSA + AES encrypted files in your Drive, organized into folders and searchable by name or description — without ever exposing the value." },
    { icon: Shield, title: "Your Data, Your Control", description: "Keep personal source files in Google Drive. Paid RAG stores excerpts and embeddings in Firestore. Encryption and self-hosting are supported." },
  ],
  screenshotsTitle: "See It in Action",
  screenshots: [
    { src: "/images/cap.png", alt: "AI Chat & File Management", description: "Write notes in a rich editor and let AI proofread or summarize them. Choose Gemini, OpenAI, OpenRouter, or OpenCode Go for chat, with model-dependent tools, attachments and web search. Gemini also supports image generation." },
    { src: "/images/dashboard.png", alt: "Personal Dashboard", description: "Create a home screen with file viewers (Markdown, PDF, EPUB, images) with per-document memos, memo lists, cards, tables, kanban boards, workflow output, and web embeds. Dashboards are saved as plain .dashboard files in Drive." },
    { src: "/images/organization_general.png", alt: "Organization Projects", description: "Switch between My Drive and shared organization projects while keeping the active workspace visible." },
    { src: "/images/organization_settings.png", alt: "Organization Management", description: "Manage members, roles, per-member AI budgets, projects, and storage from one settings screen." },
    { src: "/images/organization_sync.png", alt: "Organization Project Sync", description: "Sync project files through managed Cloud Storage with project-aware status and controls." },
    { src: "/images/organization_dashboard.png", alt: "Shared Project Dashboard", description: "Use dashboards inside a shared project with the active organization and project always in view." },
    { src: "/images/organization_workflow.png", alt: "Organization Workflows", description: "Build and run workflows scoped to the active project with organization-managed Vertex AI." },
    { src: "/images/external_skills.png", alt: "External Skills", description: "Install Agent Skills from the official catalog with one click — like OKF Authoring, which teaches the AI to turn your notes into knowledge bundles." },
    { src: "/images/visual_workflow.png", alt: "Workflow Builder", description: "Build automation with a drag-and-drop editor. Connect AI prompts, Drive operations, and web requests into a single flow." },
    { src: "/images/rag_search.png", alt: "Smart File Search", description: "Paid RAG indexes synced documents in Firestore using Gemini or OpenAI embeddings. Set Top K per index and optionally use Jev, directly or via OpenRouter, to check candidates until a match is found." },
    { src: "/images/pull_diff_en.png", alt: "Push/Pull Sync", description: "Personal source files live in your Google Drive. Push and pull changes with automatic conflict handling and diff previews." },
  ],
  dataUsageTitle: "How We Handle Your Data",
  dataUsageIntro: "kiokuflow uses your Google account to sign in. Here's what we access and why:",
  dataCards: [
    { icon: User, title: "Google Account", description: "Your Google account identifies you for sign-in, subscription access, and organization membership." },
    { icon: HardDrive, title: "Google Drive", description: "Chat history, workflows, and settings are stored in a dedicated \"kiokuflow\" folder on your Drive. Files outside the app are never accessed." },
    { icon: Lock, title: "AI Connections You Choose", description: "Queries and relevant content are sent to your chosen AI and embedding providers. Optional Jev filtering sends candidate excerpts or images to Jev or OpenRouter." },
    { icon: ServerCog, title: "Fully Portable", description: "Personal source files remain in Drive. Self-host kiokuflow and rebuild RAG indexes from those files when needed." },
  ],
  pluginShowcaseTitle: "Plugin Showcase",
  pluginShowcases: [
    {
      icon: MessagesSquare,
      name: "Ronginus",
      repo: "takeshy/hub-ronginus",
      description: "A debate plugin where multiple AIs discuss a topic from different perspectives. You can also join as a debater.",
      image: "/images/ronginus.png",
    },
    {
      icon: Calculator,
      name: "Accounting",
      repo: "takeshy/hub-accounting",
      description: "Beancount-format double-entry bookkeeping. Manage accounts, record transactions, and generate balance sheets and income statements — all in plain text on Drive.",
      image: "/images/accounting.png",
    },
    {
      icon: Music,
      name: "Audio Score",
      repo: "takeshy/hub-audio-score",
      description: "Convert audio files into sheet music with ML-based pitch detection. Source separation, MIDI export, score playback, and AI chord analysis.",
    },
  ],
  pluginShowcaseInstall: "Install from Settings > Plugins with:",
  pluginShowcaseLink: "View on GitHub",
  dataUsageOrgNote: "Business shared project files live in managed Cloud Storage with Firestore metadata. Paid RAG also stores searchable excerpts and embeddings in Firestore, including for personal Drive files. Source files remain in the selected workspace.",
  dataUsageLearnMore: "Learn more in our",
  privacyPolicy: "Privacy Policy",
  heroManual: "Read the Manual",
  ctaReady: "Ready to get started?",
  footerTerms: "Terms of Service",
  footerPolicy: "Privacy Policy",
  footerTokushoho: "Commercial Disclosure",
  footerManual: "Manual",
  footerContact: "Contact",
  premiumTitle: "Premium Plans",
  premiumIntro: "kiokuflow is useful on the free plan by default. Premium adds features that need heavier server-side processing, such as embedding RAG, streaming files over 20 MB, temporary upload/edit URLs. AI, embedding and reranking API usage is billed separately by the selected provider.",
  premiumFree: "Free",
  premiumLite: "Lite",
  premiumPro: "Pro",
  premiumBusiness: "Business",
  premiumLitePrice: "$2/mo",
  premiumProPrice: "$20/mo",
  premiumBusinessPrice: "$50/mo per org (incl. $30 Vertex AI budget)",
  premiumFreeTag: "$0",
  premiumFeatureUpload: "Max File Size",
  premiumFeatureUploadFree: "20 MB",
  premiumFeatureUploadPaid: "5 GB",
  premiumFeatureRag: "Firestore hybrid RAG + optional Jev/Gemini reranking",
  premiumFeatureInteractions: "Interactions API Chat",
  premiumFeatureInteractionsDesc: "Multi-round AI chat with server-side proxy — supports function calling, RAG, and web search simultaneously in a single conversation.",
  premiumFeaturePdf: "PDF Generation",
  premiumFeaturePdfDesc: "Generate PDF files from Markdown or HTML within workflows. Perfect for invoices, reports, and certificates.",
  premiumFeatureObsidianToken: "Obsidian Sync Token",
  premiumFeatureObsidianTokenDesc: "Issue an external sync token to sync your kiokuflow files with Obsidian. Edit in either app — changes sync both ways through Google Drive.",
  premiumFeatureTempUrl: "Temporary Upload URL",
  premiumFeatureTempUrlDesc: "Generate a temporary URL to upload or edit files from any external editor or tool. Work in your favorite environment and push changes back.",
  premiumFeatureSheets: "Google Sheets CRUD",
  premiumFeatureSheetsDesc: "Read, write, append, and query Google Sheets directly from workflows. Build data-driven automations with your spreadsheets.",
  premiumFeatureHosting: "Static Page Hosting",
  premiumFeatureHostingDesc: "Publish HTML pages from your Drive with global CDN delivery. Build websites, landing pages, and web apps — all served from your files.",
  premiumFeatureHostingProDesc: "Publish HTML pages straight from your own Drive with a built-in subdomain — no organization or CDN setup needed.",
  premiumFeatureAiBillingSchedule: "AI Billing for Scheduled Runs",
  premiumFeatureAiBillingScheduleDesc: "Scheduled Gemini steps use your registered key or prepaid personal Vertex AI balance. Interactive chats and workflows can also use OpenAI, OpenRouter, or OpenCode Go.",
  premiumFeatureDomain: "Custom Domains & Auto SSL",
  premiumFeatureDomainDesc: "Use your own domain with automatic SSL certificate provisioning. Every account also gets a built-in subdomain (yourname.kiokuflow.net).",
  premiumFeatureSchedule: "Scheduled Workflows",
  premiumFeatureScheduleDesc: "Run workflows on a cron schedule — daily reports, periodic syncs, automated data processing. Supports retry, timeout, and concurrency control.",
  premiumFeatureServerExec: "Server-Side Execution",
  premiumFeatureServerExecDesc: "Execute workflow script nodes in a secure isolated VM on the server. Run complex logic without browser limitations.",
  premiumFeatureWebBuilder: "AI Web Builder Skill",
  premiumFeatureWebBuilderDesc: "An AI agent that helps you build and deploy web pages and APIs. Describe what you want, and it creates the pages, workflows, and configurations for you.",
  premiumFeatureOrg: "Organization & Shared Projects",
  premiumFeatureVertex: "Vertex AI Included (no API key)",
  premiumFeatureAiBudget: "Monthly Vertex AI Budget",
  premiumFeatureAiBudgetValue: "$30 included",
  premiumFeatureStorage: "Shared Project Storage",
  premiumFeatureStorageValue: "100 GB (+500 GB)",
  premiumIncluded: "Included",
  premiumNotIncluded: "Not included",
  teamTitle: "Built for Teams",
  teamBadge: "Business",
  teamIntro: "A Business subscription provisions an organization with a shared project. The organization is the billing unit — add as many members as you need without a per-seat charge — and everyone works on the same files, with their own Drive still one drag away.",
  teamCards: [
    { icon: Building2, title: "Shared Project Workspace", description: "The whole team opens the same file tree. Push and pull work exactly as they do on your own Drive, and every write is revision-checked so concurrent edits can't quietly overwrite each other." },
    { icon: UserCog, title: "Roles & External Collaborators", description: "Organization roles (owner / admin / member) plus per-project roles (admin / editor / viewer). Invite someone outside the organization into a single project as an external collaborator." },
    { icon: Sparkles, title: "Vertex AI, No API Keys", description: "Inside a project, chat, RAG, and workflow AI run on the organization's Vertex AI. Members need no individual API key. A $30 monthly budget is included, with per-member caps and top-ups when you need more." },
    { icon: Database, title: "Search Across Shared Docs", description: "Project files get their own vector search, so the AI answers from the team's documents — not just what each person happens to have on their Drive." },
    { icon: HardDrive, title: "Project Storage", description: "100 GB of shared storage per organization, expandable by 500 GB. Usage and remaining space are shown in Settings > Organization." },
    { icon: Copy, title: "My Drive Stays Yours", description: "Your personal Drive sits above the project tree as the My Drive shelf. Drag either way to copy files between your Drive and the shared project — a drag always copies, so nothing disappears from under the team." },
  ],
};

const ja: LpStrings = {
  tagline: "答えるだけじゃない、動く AI",
  description: "kiokuflowは、Gemini・OpenAI・OpenRouter・OpenCode Goを選んで使えるAIワークスペースです。ファイルを読み、必要な情報を探し、作業までこなします。PDF や EPUB を読みながら引用付きメモを残し、外部ツールとの連携、ドキュメント横断の意味検索、繰り返し作業の自動化まで。個人の元ファイルは、あなたのGoogle Driveに保存します。",
  signIn: "Googleでサインイン",
  features: [
    { icon: Highlighter, title: "読んで、線を引いて、メモ", description: "PDF・EPUB・Markdown・画像を開いて文章を選択するだけで、その場に引用付きメモを添付。引用はハイライトされ、本文⇄メモを双方向ジャンプ。メモはプレーンな Markdown として Drive に保存されます。" },
    { icon: LayoutDashboard, title: "パーソナルダッシュボード", description: "ファイルビューア（Markdown・PDF・EPUB・画像）、メモ一覧、カード、編集可能テーブル、カンバン、ワークフロー出力、Web埋め込みをホーム画面に配置できます。" },
    { icon: MessageSquare, title: "AIチャット", description: "Gemini・OpenAI・OpenRouter・OpenCode Goを選び、ファイルやツールと連携。OpenAI・OpenRouter・OpenCode Goは取得したモデルから複数選択できます。GeminiとOpenAIのLiveではファイルを参照・検索しながら自然に会話できます。有料RAG検索・割り込み・ミュートにも対応。" },
    { icon: Search, title: "ファイルに質問", description: "ファイル名と内容をタブで切り替え。単語は端末内で検索し、文章は有料RAGでサーバー同期済みの資料を検索。結果にあいまい検索も追加できます。" },
    { icon: BookOpen, title: "メモ・エディタ", description: "Markdownでさっとメモ。アイデアや議事録をそのままDriveに保存できます。" },
    { icon: GitBranch, title: "ワークフロー", description: "やりたいことを言葉で伝えるだけでAIが自動化ワークフローを作成。Drive や Web、外部サービスとも連携。" },
    { icon: GitCompare, title: "Obsidianと相性抜群", description: "Obsidian互換Canvasを扱え、GemiHub Drive Syncプラグインとは同じDriveメタデータで双方向同期できます。" },
    { icon: Puzzle, title: "プラグイン", description: "GitHubから機能を追加。AI や Drive と連携できるので、自分だけのツールや高度な自動化も構築できます。" },
    { icon: Globe, title: "ワンクリック公開", description: "Driveファイルを公開ページにして、URLで共有できます。" },
    { icon: Zap, title: "オフラインでも快適", description: "すべてのファイルがブラウザにキャッシュされ、ネットがなくても即座にアクセス。オフラインで編集して、ワンクリックでDriveに同期。コンフリクトも自動検出。" },
    { icon: KeyRound, title: "暗号化シークレット", description: "APIトークンやパスワードなどをRSA + AESで暗号化してDriveに保存。フォルダで整理でき、名前や説明で検索可能。値そのものが公開されることはありません。" },
    { icon: Shield, title: "データは自分の手に", description: "個人の元ファイルはGoogle Driveに保存。有料RAGの抜粋とembeddingはFirestoreに保存します。暗号化とセルフホストにも対応。" },
  ],
  screenshotsTitle: "動作イメージ",
  screenshots: [
    { src: "/images/cap.png", alt: "AIチャット＆ファイル管理", description: "エディターでメモを書いて、AI に校正や要約をおまかせ。チャットはGemini・OpenAI・OpenRouter・OpenCode Goを選択でき、モデルに応じてWeb検索や外部ツールと連携。Geminiの画像生成にも対応します。" },
    { src: "/images/dashboard.png", alt: "パーソナルダッシュボード", description: "ファイルビューア（Markdown・PDF・EPUB・画像、ドキュメントメモ付き）、メモ一覧、カード、テーブル、カンバン、ワークフロー出力、Web埋め込みを組み合わせたホーム画面を作成できます。" },
    { src: "/images/organization_general.png", alt: "組織プロジェクト", description: "My Drive と共有の組織プロジェクトを切り替え、現在のワークスペースを常に確認できます。" },
    { src: "/images/organization_settings.png", alt: "組織管理", description: "メンバー、権限、メンバーごとの AI 予算、プロジェクト、ストレージをひとつの設定画面で管理できます。" },
    { src: "/images/organization_sync.png", alt: "組織プロジェクトの同期", description: "プロジェクトに対応した状態表示と操作で、Cloud Storage 上の共有ファイルを同期できます。" },
    { src: "/images/organization_dashboard.png", alt: "共有プロジェクトのダッシュボード", description: "利用中の組織とプロジェクトを確認しながら、共有プロジェクト内でダッシュボードを使えます。" },
    { src: "/images/organization_workflow.png", alt: "組織のワークフロー", description: "組織管理の Vertex AI を使い、現在のプロジェクトに属するワークフローを作成・実行できます。" },
    { src: "/images/external_skills.png", alt: "External Skills", description: "公式カタログから Agent Skills をワンクリックでインストール。ノートをナレッジバンドルに変換する OKF Authoring などが使えます。" },
    { src: "/images/visual_workflow.png", alt: "ワークフロービルダー", description: "ドラッグ＆ドロップで自動化を構築。AI への指示、Drive 操作、Web リクエストをひとつの流れに。" },
    { src: "/images/rag_search.png", alt: "かしこいファイル検索", description: "有料RAGはGemini／OpenAIのembeddingで同期済み資料をFirestoreに登録。RAGごとのTop Kと、Jevによる「一致するまで検索」に対応します。Jevは直接キーまたはOpenRouterで利用できます。" },
    { src: "/images/pull_diff.png", alt: "Push/Pull同期", description: "個人の元ファイルはGoogle Driveに保存。変更の同期も、差分確認やコンフリクト解決もかんたん。" },
  ],
  dataUsageTitle: "データの取り扱いについて",
  dataUsageIntro: "kiokuflowはGoogleアカウントでサインインします。アクセスするデータとその理由は以下のとおりです：",
  dataCards: [
    { icon: User, title: "Googleアカウント", description: "Googleアカウントはサインイン、契約プランの確認、組織へのアクセスに利用します。" },
    { icon: HardDrive, title: "Google Drive", description: "チャット履歴・ワークフロー・設定はDrive内の専用フォルダ「kiokuflow」に保存。アプリ外のファイルにはアクセスできません。" },
    { icon: Lock, title: "選択したAIと連携", description: "質問と必要な内容を選択したAI・embeddingプロバイダーへ送信します。Jev判定を有効にすると、候補の本文・画像をJevまたはOpenRouterへ送信します。" },
    { icon: ServerCog, title: "完全なポータビリティ", description: "個人の元ファイルはDriveに残ります。セルフホストして利用でき、RAGインデックスは元ファイルから再構築できます。" },
  ],
  pluginShowcaseTitle: "プラグイン紹介",
  pluginShowcases: [
    {
      icon: MessagesSquare,
      name: "Ronginus",
      repo: "takeshy/hub-ronginus",
      description: "複数のAIがテーマについてそれぞれの視点で議論するディベートプラグイン。ユーザーも参加できます。",
      image: "/images/ronginus.png",
    },
    {
      icon: Calculator,
      name: "Accounting",
      repo: "takeshy/hub-accounting",
      description: "Beancount形式の複式簿記プラグイン。勘定科目の管理、仕訳の記録、貸借対照表・損益計算書の生成までプレーンテキストでDriveに保存。",
      image: "/images/accounting.png",
    },
    {
      icon: Music,
      name: "Audio Score",
      repo: "takeshy/hub-audio-score",
      description: "音声ファイルをML音程検出で楽譜化。ソース分離、MIDI書き出し、スコア再生、AIによる自動コード解析に対応。",
    },
  ],
  pluginShowcaseInstall: "Settings > Plugins からインストール:",
  pluginShowcaseLink: "GitHubで見る",
  dataUsageOrgNote: "Businessの共有プロジェクトはCloud Storageにファイル、Firestoreにメタデータを保存します。有料RAGは個人Driveの資料も含め、検索用の抜粋とembeddingをFirestoreに保存します。元ファイルは選択したワークスペースに残ります。",
  dataUsageLearnMore: "詳しくは",
  privacyPolicy: "プライバシーポリシー",
  heroManual: "マニュアルを読む",
  ctaReady: "さあ、始めましょう",
  footerTerms: "利用規約",
  footerPolicy: "プライバシーポリシー",
  footerTokushoho: "特定商取引法に基づく表記",
  footerManual: "マニュアル",
  footerContact: "お問い合わせ",
  premiumTitle: "有料プラン",
  premiumIntro: "kiokuflow は基本的に無料プランで便利に使えます。プレミアムプランでは、embeddingによるRAG検索、1ファイルが20MBを超えるストリーミング、一時アップロード URL など、サーバー側の処理負担がかかる機能を利用できます。AI・embedding・リランキングのAPI利用料は、選択したプロバイダーで別途かかります。",
  premiumFree: "Free",
  premiumLite: "Lite",
  premiumPro: "Pro",
  premiumBusiness: "Business",
  premiumLitePrice: "¥300/月（税込）",
  premiumProPrice: "¥3,000/月（税込）",
  premiumBusinessPrice: "¥7,500/月（税込・組織単位・Vertex AI利用枠 $30分込み）",
  premiumFreeTag: "¥0",
  premiumFeatureUpload: "1ファイル最大サイズ",
  premiumFeatureUploadFree: "20 MB",
  premiumFeatureUploadPaid: "5 GB",
  premiumFeatureRag: "Firestore hybrid RAG・任意のJev／Geminiリランキング",
  premiumFeatureInteractions: "Interactions API チャット",
  premiumFeatureInteractionsDesc: "サーバー経由のマルチラウンド AI チャット。ファンクションコール・RAG・Web検索を1つの会話で同時に利用可能。",
  premiumFeaturePdf: "PDF 生成",
  premiumFeaturePdfDesc: "Markdown や HTML からワークフロー内で PDF を生成。請求書、レポート、証明書の作成に最適。",
  premiumFeatureObsidianToken: "Obsidian 連携トークン",
  premiumFeatureObsidianTokenDesc: "連携トークンを発行して kiokuflow のファイルを Obsidian と同期。どちらで編集しても Google Drive 経由で双方向同期。",
  premiumFeatureTempUrl: "一時アップロード URL",
  premiumFeatureTempUrlDesc: "一時的な URL を発行して、外部エディタやツールからファイルをアップロード・編集。お気に入りの環境で作業して変更を反映。",
  premiumFeatureSheets: "Google Sheets CRUD",
  premiumFeatureSheetsDesc: "ワークフローから Google Sheets の読み書き・追記・クエリが可能。スプレッドシートを使ったデータ駆動の自動化を構築。",
  premiumFeatureHosting: "静的ページホスティング",
  premiumFeatureHostingDesc: "Drive の HTML ページをグローバル CDN で配信。Webサイト、LP、Webアプリをファイルから直接公開。",
  premiumFeatureHostingProDesc: "自分のDriveからHTMLページを直接公開。ビルトインサブドメイン付きで、組織もCDN設定も不要。",
  premiumFeatureAiBillingSchedule: "スケジュール実行のAI課金",
  premiumFeatureAiBillingScheduleDesc: "スケジュール実行のGemini処理は、登録済みキーまたは個人のVertex AI残高で動作。画面から実行するチャット・ワークフローはOpenAI・OpenRouter・OpenCode Goも利用できます。",
  premiumFeatureDomain: "カスタムドメイン & 自動SSL",
  premiumFeatureDomainDesc: "独自ドメインを自動 SSL 証明書付きで利用可能。全アカウントにビルトインサブドメイン（yourname.kiokuflow.net）も付属。",
  premiumFeatureSchedule: "スケジュール実行",
  premiumFeatureScheduleDesc: "ワークフローを cron スケジュールで自動実行。日次レポート、定期同期、データ処理の自動化。リトライ・タイムアウト・同時実行制御に対応。",
  premiumFeatureServerExec: "サーバーサイド実行",
  premiumFeatureServerExecDesc: "ワークフローのスクリプトノードをサーバー上の安全な隔離 VM で実行。ブラウザの制約なく複雑なロジックを処理。",
  premiumFeatureWebBuilder: "AI Web Builder スキル",
  premiumFeatureWebBuilderDesc: "Webページと API の構築・デプロイを支援する AI エージェント。やりたいことを伝えるだけで、ページ・ワークフロー・設定を自動作成。",
  premiumFeatureOrg: "組織・共有プロジェクト",
  premiumFeatureVertex: "Vertex AI 込み（APIキー不要）",
  premiumFeatureAiBudget: "Vertex AI 月間利用枠",
  premiumFeatureAiBudgetValue: "$30分込み",
  premiumFeatureStorage: "共有プロジェクトのストレージ",
  premiumFeatureStorageValue: "100 GB（+500 GB）",
  premiumIncluded: "対応",
  premiumNotIncluded: "非対応",
  teamTitle: "チームで使う",
  teamBadge: "Business",
  teamIntro: "Business プランを契約すると、組織と共有プロジェクトが自動で作成されます。課金は組織単位なので、メンバーを何人追加しても追加料金はかかりません。チーム全員が同じファイルを扱いながら、自分の Drive もドラッグひとつで行き来できます。",
  teamCards: [
    { icon: Building2, title: "共有プロジェクト", description: "チーム全員が同じファイルツリーを開けます。Push / Pull は自分の Drive と同じ操作感。書き込みはリビジョンで検証されるため、同時編集で相手の変更を上書きしてしまうことがありません。" },
    { icon: UserCog, title: "権限と外部コラボレーター", description: "組織ロール（owner / admin / member）とプロジェクトロール（admin / editor / viewer）を設定可能。組織外のメンバーを特定のプロジェクトだけに外部コラボレーターとして招待できます。" },
    { icon: Sparkles, title: "Vertex AI 込み・APIキー不要", description: "プロジェクト内のチャット・RAG・ワークフローの AI は組織の Vertex AI で動作。メンバー個人でAPIキーを用意する必要はありません。月 $30 の利用枠が付属し、メンバーごとの上限設定や追加購入にも対応します。" },
    { icon: Database, title: "共有ドキュメントを横断検索", description: "プロジェクトのファイル専用のベクトル検索を備え、AI が個人の Drive ではなくチームの資料をもとに回答します。" },
    { icon: HardDrive, title: "プロジェクトストレージ", description: "組織ごとに 100 GB の共有ストレージ。500 GB 単位で追加でき、使用量と残量は設定 > 組織 で確認できます。" },
    { icon: Copy, title: "個人の Drive はそのまま", description: "プロジェクトのファイルツリーの上に「My Drive」シェルフとして自分の Drive が並びます。ドラッグでどちらの方向にもコピーでき（移動ではなくコピーなので）、チームのファイルが消えることはありません。" },
  ],
};

export default function LandingPage() {
  const { pathname } = useLocation();
  const lang: Language = pathname.endsWith("/ja") ? "ja" : "en";
  const s = lang === "ja" ? ja : en;
  const jaPrefix = lang === "ja" ? "/ja" : "";

  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains("dark");
    const previousColorScheme = root.style.colorScheme;
    root.classList.remove("dark");
    root.style.colorScheme = "light";

    return () => {
      root.classList.toggle("dark", hadDark);
      root.style.colorScheme = previousColorScheme;
    };
  }, []);

  const screenshots = s.screenshots.filter(({ src }) => SHOW_ADVANCED_PLANS || !src.includes("/organization_"));

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      {/* Language switcher */}
      <div className="absolute right-4 top-4 z-10">
        <LanguageSwitcher lang={lang} basePath="/lp" />
      </div>

      {/* Hero */}
      <section className="bg-white px-4 pb-8 pt-20 text-center dark:bg-gray-950 sm:pt-28">
        <div>
          <img
            src="/icons/icon-192x192.png"
            alt="kiokuflow"
            width={80}
            height={80}
            className="mx-auto mb-6 rounded-2xl shadow-lg ring-1 ring-white/50 dark:ring-gray-800"
          />
          <h1 className="mb-4 text-4xl font-bold tracking-tight text-gray-900 dark:text-gray-50 sm:text-5xl">
            kiokuflow
          </h1>
          <p className="mx-auto mb-3 max-w-2xl text-xl font-bold text-purple-700 dark:text-purple-400 sm:text-2xl">
            {s.tagline}
          </p>
          <p className="mx-auto mb-0 max-w-2xl text-sm leading-relaxed text-gray-500 dark:text-gray-400 sm:text-base">
            {s.description}
          </p>
        </div>
      </section>

      {/* Hero CTAs */}
      <section className="mx-auto max-w-5xl px-4 pb-20 pt-4">
        <div className="flex flex-col items-center gap-4">
          <a
            href="/auth/google"
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-8 py-3.5 text-lg font-semibold text-white shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:bg-blue-700 hover:shadow-lg"
          >
            <LogIn size={22} />
            {s.signIn}
          </a>
          <a
            href={`/manual${jaPrefix}`}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-6 py-2.5 text-base font-semibold text-gray-700 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-gray-50 hover:shadow-md dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <BookOpen size={18} />
            {s.heroManual}
          </a>
        </div>
      </section>

      {/* Features */}
      <section className="bg-gray-50/30 px-4 py-20 dark:bg-gray-900/20">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {s.features.map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="rounded-xl border border-gray-200 bg-white p-6 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md dark:border-gray-800 dark:bg-gray-900"
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/40">
                  <Icon size={22} className="text-blue-600 dark:text-blue-400" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {title}
                </h3>
                <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                  {description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Screenshots */}
      <section className="mx-auto max-w-5xl px-4 py-20">
        <h2 className="mb-10 text-center text-2xl font-bold text-gray-900 dark:text-gray-50 sm:text-3xl">
          {s.screenshotsTitle}
        </h2>
        {/* Hero screenshot */}
        {screenshots.length > 0 && (
          <figure className="mb-6 overflow-hidden rounded-2xl border border-gray-200 shadow-xl dark:border-gray-800">
            <img
              src={screenshots[0].src}
              alt={screenshots[0].alt}
              className="w-full"
              loading="lazy"
            />
            <figcaption className="bg-gray-50 px-5 py-4 dark:bg-gray-900">
              <p className="text-center text-sm font-semibold text-gray-900 dark:text-gray-100">{screenshots[0].alt}</p>
              <p className="mt-1 text-center text-sm leading-relaxed text-gray-600 dark:text-gray-400">{screenshots[0].description}</p>
            </figcaption>
          </figure>
        )}
        {/* Rest in grid */}
        <div className="grid gap-6 sm:grid-cols-2">
          {screenshots.slice(1).map(({ src, alt, description }) => (
            <figure key={src} className="overflow-hidden rounded-2xl border border-gray-200 shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl dark:border-gray-800">
              <img
                src={src}
                alt={alt}
                className="w-full"
                loading="lazy"
              />
              <figcaption className="bg-gray-50 px-4 py-3 dark:bg-gray-900">
                <p className="text-center text-sm font-semibold text-gray-900 dark:text-gray-100">{alt}</p>
                <p className="mt-1 text-center text-sm leading-relaxed text-gray-600 dark:text-gray-400">{description}</p>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* Premium Plans */}
      <section className="bg-gray-50/30 px-4 py-20 dark:bg-gray-900/20">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-4 text-center text-2xl font-bold text-gray-900 dark:text-gray-50 sm:text-3xl">
            <CreditCard size={28} className="mb-1 mr-2 inline text-emerald-600 dark:text-emerald-400" />
            {s.premiumTitle}
          </h2>
          <p className="mx-auto mb-10 max-w-2xl text-center text-sm text-gray-500 dark:text-gray-400 sm:text-base">
            {s.premiumIntro}
          </p>

          {/* Plan headers */}
          <div className={`mb-6 grid ${SHOW_ADVANCED_PLANS ? "grid-cols-5" : "grid-cols-3"} gap-3 text-center`}>
            <div />
            <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{s.premiumFree}</h3>
              <p className="mt-1 text-xl font-bold text-gray-500 dark:text-gray-400">{s.premiumFreeTag}</p>
            </div>
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-700 dark:bg-emerald-950/40">
              <h3 className="text-lg font-bold text-emerald-700 dark:text-emerald-300">{s.premiumLite}</h3>
              <p className="mt-1 text-xl font-bold text-emerald-600 dark:text-emerald-400">{s.premiumLitePrice}</p>
            </div>
            {SHOW_ADVANCED_PLANS && <>
            <div className="rounded-xl border border-sky-300 bg-sky-50 p-4 dark:border-sky-700 dark:bg-sky-950/40">
              <h3 className="text-lg font-bold text-sky-700 dark:text-sky-300">{s.premiumPro}</h3>
              <p className="mt-1 text-xl font-bold text-sky-600 dark:text-sky-400">{s.premiumProPrice}</p>
            </div>
            <div className="rounded-xl border border-purple-300 bg-purple-50 p-4 ring-2 ring-purple-400 dark:border-purple-700 dark:bg-purple-950/40 dark:ring-purple-500">
              <h3 className="text-lg font-bold text-purple-700 dark:text-purple-300">{s.premiumBusiness}</h3>
              <p className="mt-1 text-xl font-bold text-purple-600 dark:text-purple-400">{s.premiumBusinessPrice}</p>
            </div>
            </>}
          </div>

          {/* Feature comparison */}
          {(() => {
            const features: { label: string; free: boolean | string; lite: boolean | string; pro: boolean | string; business: boolean | string }[] = [
              { label: s.premiumFeatureUpload, free: s.premiumFeatureUploadFree, lite: s.premiumFeatureUploadPaid, pro: s.premiumFeatureUploadPaid, business: s.premiumFeatureUploadPaid },
              { label: s.premiumFeatureRag, free: false, lite: true, pro: true, business: true },
              { label: s.premiumFeatureInteractions, free: false, lite: true, pro: true, business: true },
              { label: s.premiumFeaturePdf, free: false, lite: true, pro: true, business: true },
              { label: s.premiumFeatureObsidianToken, free: false, lite: true, pro: true, business: true },
              { label: s.premiumFeatureTempUrl, free: false, lite: true, pro: true, business: true },
              { label: s.premiumFeatureSchedule, free: false, lite: false, pro: true, business: true },
              { label: s.premiumFeatureHosting, free: false, lite: false, pro: true, business: true },
              { label: s.premiumFeatureSheets, free: false, lite: false, pro: false, business: true },
              { label: s.premiumFeatureDomain, free: false, lite: false, pro: false, business: true },
              { label: s.premiumFeatureServerExec, free: false, lite: false, pro: false, business: true },
              { label: s.premiumFeatureWebBuilder, free: false, lite: false, pro: false, business: true },
              { label: s.premiumFeatureOrg, free: false, lite: false, pro: false, business: true },
              { label: s.premiumFeatureVertex, free: false, lite: false, pro: false, business: true },
              { label: s.premiumFeatureAiBudget, free: false, lite: false, pro: false, business: s.premiumFeatureAiBudgetValue },
              { label: s.premiumFeatureStorage, free: false, lite: false, pro: false, business: s.premiumFeatureStorageValue },
            ];
            const renderCell = (val: boolean | string) => {
              if (typeof val === "string") return <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{val}</span>;
              return val
                ? <Check size={18} className="mx-auto text-emerald-600 dark:text-emerald-400" aria-label={s.premiumIncluded} />
                : <X size={18} className="mx-auto text-gray-300 dark:text-gray-600" aria-label={s.premiumNotIncluded} />;
            };
            return (
              <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
                {features.filter(({ lite }) => SHOW_ADVANCED_PLANS || lite !== false).filter(({ label }) => SHOW_WEBPAGE_BUILDER || label !== s.premiumFeatureWebBuilder).map(({ label, free, lite, pro, business }, i) => (
                  <div key={label} className={`grid ${SHOW_ADVANCED_PLANS ? "grid-cols-5" : "grid-cols-3"} gap-3 px-4 py-3 ${i % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-gray-50 dark:bg-gray-900/60"}`}>
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</div>
                    <div className="text-center">{renderCell(free)}</div>
                    <div className="text-center">{renderCell(lite)}</div>
                    {SHOW_ADVANCED_PLANS && <>
                    <div className="text-center">{renderCell(pro)}</div>
                    <div className="text-center">{renderCell(business)}</div>
                    </>}
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Lite feature highlights */}
          <h3 className="mb-6 mt-12 text-center text-xl font-bold text-gray-900 dark:text-gray-100">
            Lite
          </h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: MessageSquare, title: s.premiumFeatureInteractions, desc: s.premiumFeatureInteractionsDesc },
              { icon: FileText, title: s.premiumFeaturePdf, desc: s.premiumFeaturePdfDesc },
              { icon: RefreshCw, title: s.premiumFeatureObsidianToken, desc: s.premiumFeatureObsidianTokenDesc },
              { icon: Upload, title: s.premiumFeatureTempUrl, desc: s.premiumFeatureTempUrlDesc },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="rounded-xl border border-gray-200 bg-white p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md dark:border-gray-800 dark:bg-gray-900">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/40">
                  <Icon size={22} className="text-sky-600 dark:text-sky-400" />
                </div>
                <h4 className="mb-1.5 text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h4>
                <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">{desc}</p>
              </div>
            ))}
          </div>

          {SHOW_ADVANCED_PLANS && <>
          {/* Pro feature highlights */}
          <h3 className="mb-6 mt-12 text-center text-xl font-bold text-gray-900 dark:text-gray-100">
            Pro
          </h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: Clock, title: s.premiumFeatureSchedule, desc: s.premiumFeatureScheduleDesc },
              { icon: Globe, title: s.premiumFeatureHosting, desc: s.premiumFeatureHostingProDesc },
              { icon: KeyRound, title: s.premiumFeatureAiBillingSchedule, desc: s.premiumFeatureAiBillingScheduleDesc },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="rounded-xl border border-gray-200 bg-white p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md dark:border-gray-800 dark:bg-gray-900">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/40">
                  <Icon size={22} className="text-sky-600 dark:text-sky-400" />
                </div>
                <h4 className="mb-1.5 text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h4>
                <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">{desc}</p>
              </div>
            ))}
          </div>

          {/* Business feature highlights */}
          <h3 className="mb-6 mt-12 text-center text-xl font-bold text-gray-900 dark:text-gray-100">
            Business
          </h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: FileSpreadsheet, title: s.premiumFeatureSheets, desc: s.premiumFeatureSheetsDesc },
              { icon: Lock, title: s.premiumFeatureDomain, desc: s.premiumFeatureDomainDesc },
              { icon: Server, title: s.premiumFeatureServerExec, desc: s.premiumFeatureServerExecDesc },
              { icon: PenTool, title: s.premiumFeatureWebBuilder, desc: s.premiumFeatureWebBuilderDesc },
            ].filter(({ title }) => SHOW_WEBPAGE_BUILDER || title !== s.premiumFeatureWebBuilder).map(({ icon: Icon, title, desc }) => (
              <div key={title} className="rounded-xl border border-gray-200 bg-white p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md dark:border-gray-800 dark:bg-gray-900">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/40">
                  <Icon size={22} className="text-emerald-600 dark:text-emerald-400" />
                </div>
                <h4 className="mb-1.5 text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h4>
                <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">{desc}</p>
              </div>
            ))}
          </div>
          </>}
        </div>
      </section>

      {SHOW_ADVANCED_PLANS && <>
      {/* Teams / Organizations */}
      <section className="px-4 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="mb-4 flex flex-col items-center gap-2">
            <span className="rounded-full bg-purple-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
              {s.teamBadge}
            </span>
            <h2 className="text-center text-2xl font-bold text-gray-900 dark:text-gray-50 sm:text-3xl">
              <Building2 size={28} className="mb-1 mr-2 inline text-purple-600 dark:text-purple-400" />
              {s.teamTitle}
            </h2>
          </div>
          <p className="mx-auto mb-10 max-w-2xl text-center text-sm text-gray-500 dark:text-gray-400 sm:text-base">
            {s.teamIntro}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {s.teamCards.map(({ icon: Icon, title, description }) => (
              <div key={title} className="rounded-xl border border-gray-200 bg-white p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md dark:border-gray-800 dark:bg-gray-900">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/40">
                  <Icon size={22} className="text-purple-600 dark:text-purple-400" />
                </div>
                <h3 className="mb-1.5 text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
                <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      </>}

      {/* Plugin Showcase */}
      <section className="bg-gray-50/30 px-4 py-20 dark:bg-gray-900/20">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-8 text-center text-2xl font-bold text-gray-900 dark:text-gray-50 sm:text-3xl">
            {s.pluginShowcaseTitle}
          </h2>
          <div className="grid gap-6 sm:grid-cols-2">
            {s.pluginShowcases.map(({ icon: Icon, name, repo, description, image }) => (
              <div
                key={repo}
                className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl dark:border-gray-800 dark:bg-gray-900"
              >
                {image && <img
                  src={image}
                  alt={name}
                  className="aspect-video w-full object-cover"
                  loading="lazy"
                />}
                <div className="flex flex-1 flex-col p-6">
                  <div className="mb-3 flex items-center gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-purple-100 dark:bg-purple-900/40">
                      <Icon size={24} className="text-purple-600 dark:text-purple-400" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {name}
                    </h3>
                  </div>
                  <p className="mb-3 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                    {description}
                  </p>
                  <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
                    {s.pluginShowcaseInstall}{" "}
                    <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono text-gray-800 dark:bg-gray-700 dark:text-gray-200">
                      {repo}
                    </code>
                  </p>
                  <a
                    href={`https://github.com/${repo}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-auto inline-flex items-center gap-1.5 text-sm font-medium text-purple-600 transition-colors hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300"
                  >
                    <Github size={16} />
                    {s.pluginShowcaseLink}
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Data Usage */}
      <section className="mx-auto max-w-4xl px-4 py-20">
        <h2 className="mb-4 text-center text-2xl font-bold text-gray-900 dark:text-gray-50 sm:text-3xl">
          {s.dataUsageTitle}
        </h2>
        <p className="mb-8 text-center text-sm text-gray-600 dark:text-gray-400">
          {s.dataUsageIntro}
        </p>
        <div className="grid gap-6 sm:grid-cols-2">
          {s.dataCards.map(({ icon: Icon, title, description }) => (
            <div key={title} className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/40">
                <Icon size={22} className="text-green-600 dark:text-green-400" />
              </div>
              <h3 className="mb-1.5 text-base font-semibold text-gray-900 dark:text-gray-100">
                {title}
              </h3>
              <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                {description}
              </p>
            </div>
          ))}
        </div>
        {SHOW_ADVANCED_PLANS && <p className="mx-auto mt-6 max-w-3xl text-center text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          {s.dataUsageOrgNote}
        </p>}
        <p className="mt-4 text-center text-sm text-gray-500 dark:text-gray-400">
          {s.dataUsageLearnMore}{" "}
          <a href={`/policy${jaPrefix}`} className="text-blue-600 underline hover:text-blue-700 dark:text-blue-400">
            {s.privacyPolicy}
          </a>
        </p>
      </section>

      {/* Footer CTA */}
      <section className="border-t border-gray-100 bg-white px-4 py-20 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex flex-col items-center">
          <h2 className="mb-6 text-2xl font-bold text-gray-900 dark:text-gray-50">
            {s.ctaReady}
          </h2>
          <a
            href="/auth/google"
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-8 py-3.5 text-lg font-semibold text-white shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:bg-blue-700 hover:shadow-lg"
          >
            <LogIn size={22} />
            {s.signIn}
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-gray-50 px-4 py-8 dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2">
            <a href={`/terms${jaPrefix}`} className="transition-colors hover:text-gray-700 hover:underline dark:hover:text-gray-200">
              {s.footerTerms}
            </a>
            <a href={`/policy${jaPrefix}`} className="transition-colors hover:text-gray-700 hover:underline dark:hover:text-gray-200">
              {s.footerPolicy}
            </a>
            <a href={`/tokushoho${jaPrefix}`} className="transition-colors hover:text-gray-700 hover:underline dark:hover:text-gray-200">
              {s.footerTokushoho}
            </a>
            <a href="https://github.com/takeshy/kiokuflow" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 transition-colors hover:text-gray-700 hover:underline dark:hover:text-gray-200">
              <Github size={14} />
              GitHub
            </a>
            <a href="https://github.com/takeshy/obsidian-gemihub" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 transition-colors hover:text-gray-700 hover:underline dark:hover:text-gray-200">
              <RefreshCw size={14} />
              Obsidian Plugin
            </a>
            <a href={`https://github.com/takeshy/kiokuflow/blob/main/${lang === "ja" ? "README_ja.md" : "README.md"}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 transition-colors hover:text-gray-700 hover:underline dark:hover:text-gray-200">
              <BookOpen size={14} />
              README
            </a>
            <a href={`/manual${jaPrefix}`} className="inline-flex items-center gap-1 transition-colors hover:text-gray-700 hover:underline dark:hover:text-gray-200">
              <BookOpen size={14} />
              {s.footerManual}
            </a>
            <a href="mailto:takeshy.work@gmail.com" className="transition-colors hover:text-gray-700 hover:underline dark:hover:text-gray-200">
              {s.footerContact}
            </a>
          </div>
          <p>&copy; {new Date().getFullYear()} <a href="https://takeshy.work" className="transition-colors hover:text-gray-700 hover:underline dark:hover:text-gray-200">takeshy.work</a></p>
        </div>
      </footer>
    </div>
  );
}
