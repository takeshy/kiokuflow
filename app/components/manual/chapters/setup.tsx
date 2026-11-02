import { SHOW_WEBPAGE_BUILDER } from "~/config/feature-visibility";
import type { Language } from "~/types/settings";
import { prose } from "../prose";

export function SetupChapter({ lang }: { lang: Language }) {
  if (lang === "ja") return <SetupJa />;
  return <SetupEn />;
}

function SetupEn() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">Initial Setup</h1>
      {SHOW_WEBPAGE_BUILDER && (<figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
        <img src="/images/setting_general_en.png" alt="Settings - General tab" className="w-full" loading="lazy" />
      </figure>)}
      <div className={prose}>
        <h2>1. Sign In</h2>
        <p>
          Visit the kiokuflow landing page and click <strong>&quot;Sign in with Google&quot;</strong>. kiokuflow will request permission to access your Google Drive.
        </p>
        <p>
          kiokuflow uses the <code>drive.file</code> scope, which means it can <strong>only access files it has created</strong> — not your entire Drive. Files you create outside of kiokuflow are not visible to the app. If you want to work with existing Drive files, you can import them into the <code>kiokuflow/</code> folder via kiokuflow&apos;s interface.
        </p>

        <h2>Moving from GemiHub</h2>
        <p>Existing registered GemiHub users are taken to <a href="/settings/migration">Settings &gt; Bring your existing workspace</a>. The service has moved to <strong>kiokuflow.net</strong>. Push all edits in the old environment, then start the copy. Notes, attachments, history, settings and encryption identity are copied to the new Drive folder while retaining the original notes and attachments. Only after verifying the destination, the old settings file is moved to Trash. Resume from the same screen after an interruption. Keep your existing decryption password; rebuild RAG indexes and check public links and external sync because file IDs change. The destination must be empty, and its settings will be replaced.</p>
        <h2>2. Create Encryption Keys</h2>
        <p>Open <strong>Settings &gt; General</strong> and create your encryption keys with one common password. This password unlocks the private key; API keys are saved using public-key encryption without another password entry.</p>
        <h2>3. Choose Your AI Provider</h2>
        <p>Open the leftmost <strong>AI providers</strong> tab. Choose Gemini, OpenAI, OpenRouter or OpenCode Go above the configuration tabs and register its API key. OpenAI, OpenRouter and OpenCode Go require a successful model fetch and at least one selected model before saving. The active provider determines which models appear in Chat. Gemini and OpenAI also support Live conversations.</p>
        <p>To get a Gemini API key:</p>
        <ol>
          <li>Go to <a href="https://aistudio.google.com/apikey" className="text-blue-600 hover:underline dark:text-blue-400" target="_blank" rel="noopener noreferrer">Google AI Studio</a>.</li>
          <li>Create a new API key or use an existing one.</li>
          <li>Copy the key and paste it into kiokuflow Settings.</li>
        </ol>

        <h2>4. Gemini API Plan</h2>
        <p>
          Select your API plan (<strong>Free</strong> or <strong>Paid</strong>). This determines which Gemini models are available. Paid plan users have access to more capable models.
        </p>

        <h2>5. Enable Optional Advanced Features</h2>
        <p>
          Dashboard, Workflow, and RAG are off by default to keep the workspace simple. Open <strong>Settings &gt; General &gt; Optional advanced features</strong> and enable only what you need. Do this before following the Dashboard, Workflow, or RAG chapters; their navigation and settings tabs stay hidden while disabled.
        </p>

        <h2>6. First Sync</h2>
        <p>
          After configuration, kiokuflow will automatically create the <code>kiokuflow/</code> folder on your Drive and save your settings. An accessible existing folder is reused; changing OAuth projects requires the migration above. Use <strong>Push to Drive</strong> to upload local changes and <strong>Pull to Local</strong> to download files from Drive.
        </p>

        <h2>7. Language &amp; Theme</h2>
        <p>
          In Settings &gt; General, you can change the interface language (English / Japanese) and the color theme (Light / Dark / System).
        </p>
      </div>
    </>
  );
}

function SetupJa() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">初期セットアップ</h1>
      {SHOW_WEBPAGE_BUILDER && (<figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
        <img src="/images/setting_general.png" alt="設定 - 一般タブ" className="w-full" loading="lazy" />
      </figure>)}
      <div className={prose}>
        <h2>1. サインイン</h2>
        <p>
          kiokuflowのランディングページにアクセスし、<strong>「Googleでサインイン」</strong>をクリックします。kiokuflowはGoogle Driveへのアクセス許可を要求します。
        </p>
        <p>
          kiokuflowは<code>drive.file</code>スコープを使用しており、<strong>kiokuflowが作成したファイルのみ</strong>にアクセスできます。Drive全体のファイルにはアクセスしません。kiokuflow外で作成した既存のDriveファイルはアプリから見えません。既存のDriveファイルを扱いたい場合は、kiokuflowのインターフェースから<code>kiokuflow/</code>フォルダにインポートしてください。
        </p>

        <h2>GemiHubから引き継ぐ場合</h2>
        <p>旧GemiHubの登録がある方は、ログイン後に<a href="/settings/migration">設定 &gt; 旧環境からの引き継ぎ</a>へ進みます。サービスのURLは<strong>kiokuflow.net</strong>へ変更しました。旧環境で全端末の編集をPushしてから引き継ぎを開始してください。ノート・添付・履歴・設定・暗号鍵を新しいDriveフォルダへコピーし、元のノート・添付は残し、コピーの検証後に旧設定だけをゴミ箱へ移します。中断後も同じ画面で再開できます。復号には元のパスワードを使います。ファイルIDが変わるため、RAGの再登録と公開リンク・外部同期の確認が必要です。引き継ぎ先は空にし、新環境の設定は旧環境の設定に置き換わります。</p>
        <h2>2. 暗号化用の鍵を作成</h2>
        <p><strong>設定 &gt; 一般</strong>で共通パスワードを設定し、暗号化用の鍵を作成します。パスワードは秘密鍵の解除に使います。APIキーは公開鍵で暗号化して保存するため、保存時のパスワード入力は不要です。</p>
        <h2>3. AIプロバイダーを選択</h2>
        <p>一番左の<strong>AIプロバイダー</strong>を開き、設定タブの上にある選択欄でGemini・OpenAI・OpenRouter・OpenCode Goから選び、APIキーを登録します。OpenAI・OpenRouter・OpenCode Goはモデル取得の成功と1つ以上のモデル選択が保存に必要です。Chatでは選んだプロバイダーのモデルが使えます。GeminiとOpenAIはLive会話にも対応しています。</p>
        <p>Gemini APIキーの取得方法：</p>
        <ol>
          <li><a href="https://aistudio.google.com/apikey" className="text-blue-600 hover:underline dark:text-blue-400" target="_blank" rel="noopener noreferrer">Google AI Studio</a>にアクセス。</li>
          <li>新しいAPIキーを作成するか、既存のキーを使用。</li>
          <li>キーをコピーしてkiokuflowの設定に貼り付け。</li>
        </ol>

        <h2>4. GeminiのAPIプラン</h2>
        <p>
          APIプラン（<strong>無料</strong>または<strong>有料</strong>）を選択します。利用可能なGeminiモデルが決まります。有料プランではより高性能なモデルが利用可能です。
        </p>

        <h2>5. 任意の上級機能を有効にする</h2>
        <p>
          初期画面をシンプルに保つため、ダッシュボード、ワークフロー、RAGは初期状態で無効です。<strong>設定 &gt; 一般 &gt; 任意の上級機能</strong>で、利用する機能だけを有効にしてください。ダッシュボード、ワークフロー、RAGの章へ進む前に有効化が必要です。無効な間は関連するナビゲーションや設定タブも表示されません。
        </p>

        <h2>6. 初回同期</h2>
        <p>
          設定後、kiokuflowは自動的にDriveに<code>kiokuflow/</code>フォルダを作成し、設定を保存します。アクセスできる既存フォルダは継続利用し、OAuthプロジェクトが変わる場合は上記の引き継ぎが必要です。<strong>ドライブ反映</strong>でローカルの変更をアップロードし、<strong>ローカル反映</strong>でDriveからファイルをダウンロードします。
        </p>

        <h2>7. 言語とテーマ</h2>
        <p>
          設定 &gt; 一般で、インターフェース言語（英語 / 日本語）とカラーテーマ（ライト / ダーク / システム）を変更できます。
        </p>
      </div>
    </>
  );
}
