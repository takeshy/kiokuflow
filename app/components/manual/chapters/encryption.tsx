import { SHOW_WEBPAGE_BUILDER } from "~/config/feature-visibility";
import type { Language } from "~/types/settings";
import { prose } from "../prose";

export function EncryptionChapter({ lang }: { lang: Language }) {
  if (lang === "ja") return <EncryptionJa />;
  return <EncryptionEn />;
}

function EncryptionEn() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">Encryption</h1>
      <figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
        <img src="/images/workflow_execute_log_encrypted.png" alt="Encrypted execution log" className="w-full" loading="lazy" />
      </figure>
      <div className={prose}>
        <p>
          GemiHub supports client-side encryption using a hybrid RSA+AES scheme. File encryption and decryption happen in your browser. API keys are saved using public-key encryption without a password. Private-key setup, unlock and password changes are handled by the server; passwords are not persisted.
        </p>

        <h2>Setting Up Encryption</h2>
        {SHOW_WEBPAGE_BUILDER && (<figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/setting_general_en.png" alt="General settings with encryption" className="w-full" loading="lazy" />
        </figure>)}
        <ol>
          <li>Go to <strong>Settings &gt; General</strong>.</li>
          <li>In the <strong>Encryption</strong> section, set a password (minimum 8 characters).</li>
          <li>The password is used to derive encryption keys on the client side.</li>
        </ol>

        <h2>Encrypting Files</h2>
        <ol>
          <li>Right-click a file in the file tree.</li>
          <li>Select <strong>Encrypt</strong>.</li>
          <li>The file will be encrypted and renamed with an <code>.encrypted</code> extension.</li>
        </ol>
        <p>
          To open an encrypted file, click on it and enter your password when prompted. The decrypted content is displayed in the editor.
        </p>

        <h2>Decrypting Files</h2>
        <p>
          Right-click an encrypted file and select <strong>Decrypt</strong> to permanently remove encryption. The <code>.encrypted</code> extension is removed.
        </p>

        <h2>Chat History Encryption</h2>
        <p>
          Enable <strong>Encrypt Chat History</strong> in Settings &gt; General to automatically encrypt all chat conversations when saved to Drive.
        </p>

        <h2>Workflow History Encryption</h2>
        <p>
          Enable <strong>Encrypt Workflow History</strong> to encrypt workflow execution logs saved to Drive.
        </p>

        <h2>API Key Protection</h2>
        <p>
          Gemini, OpenAI, OpenRouter, OpenCode Go and direct Jev keys are saved encrypted on Drive. Create encryption keys once in Settings &gt; General. Saving or replacing API keys uses the public key and needs no password. Enter the common password there to unlock the private key and saved credentials. Change the private-key password there; enter API keys in AI providers. The unlocked server session also encrypts keys. The entered common password is retained only in settings-screen memory and discarded when you leave.
        </p>

        <h2>Important Notes</h2>
        <div className="rounded-lg border-2 border-red-300 bg-red-50 p-4 dark:border-red-700 dark:bg-red-950/30 mb-4">
          <p className="font-bold text-red-700 dark:text-red-400 !mt-0">
            Warning: If you lose your password, there is no way to recover encrypted data.
          </p>
          <p className="!mb-0">
            File encryption happens in the browser. Private-key setup, unlock and password changes send the password to the server, which does not persist it. Saving API keys uses only the public key. GemiHub cannot reset or recover your password. Encrypted files, chat history, workflow history, and your API key will all become permanently inaccessible. Always keep your password in a safe place.
          </p>
        </div>
        <ul>
          <li>Encrypted files are stored on Drive in encrypted form — even Google cannot read them.</li>
          <li>The common password entered in Settings is cleared when the settings screen closes. Unlocked API keys remain available until locked or the session ends.</li>
          <li>Resetting encryption keys will make all previously encrypted data unreadable.</li>
        </ul>
      </div>
    </>
  );
}

function EncryptionJa() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">暗号化</h1>
      <figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
        <img src="/images/workflow_execute_log_encrypted.png" alt="暗号化された実行ログ" className="w-full" loading="lazy" />
      </figure>
      <div className={prose}>
        <p>
          GemiHubは、ハイブリッドRSA+AES方式によるクライアントサイド暗号化をサポートしています。ファイルの暗号化・復号はブラウザ内で行います。APIキーの保存は公開鍵で行い、パスワードは不要です。秘密鍵の設定・解除・パスワード変更はサーバーで処理しますが、パスワードは永続保存しません。
        </p>

        <h2>暗号化のセットアップ</h2>
        {SHOW_WEBPAGE_BUILDER && (<figure className="my-4 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
          <img src="/images/setting_general.png" alt="一般設定（暗号化）" className="w-full" loading="lazy" />
        </figure>)}
        <ol>
          <li><strong>設定 &gt; 一般</strong>に移動。</li>
          <li><strong>暗号化</strong>セクションでパスワードを設定（8文字以上）。</li>
          <li>パスワードはクライアントサイドで暗号化キーの生成に使用されます。</li>
        </ol>

        <h2>ファイルの暗号化</h2>
        <ol>
          <li>ファイルツリーでファイルを右クリック。</li>
          <li><strong>暗号化</strong>を選択。</li>
          <li>ファイルが暗号化され、<code>.encrypted</code>拡張子でリネームされます。</li>
        </ol>
        <p>
          暗号化ファイルを開くには、クリックしてパスワードプロンプトにパスワードを入力します。復号された内容がエディタに表示されます。
        </p>

        <h2>ファイルの暗号化解除</h2>
        <p>
          暗号化ファイルを右クリックして<strong>暗号化解除</strong>を選択すると、暗号化を永続的に解除します。<code>.encrypted</code>拡張子が除去されます。
        </p>

        <h2>チャット履歴の暗号化</h2>
        <p>
          設定 &gt; 一般で<strong>チャット履歴を暗号化</strong>を有効にすると、Driveに保存されるすべてのチャット会話が自動的に暗号化されます。
        </p>

        <h2>ワークフロー履歴の暗号化</h2>
        <p>
          <strong>ワークフロー履歴を暗号化</strong>を有効にすると、Driveに保存されるワークフロー実行ログが暗号化されます。
        </p>

        <h2>APIキーの保護</h2>
        <p>
          Gemini・OpenAI・OpenRouter・OpenCode Go・Jev直接接続のキーは暗号化してDriveに保存します。APIキーとファイル暗号化のパスワードは共通の1つです。設定 → 一般で最初に鍵を作成した後は、公開鍵でAPIキーを暗号化して保存でき、保存時のパスワード入力は不要です。パスワードは秘密鍵の解除・復号時に入力します。変更・ロックも全キーに適用します。APIキーの入力はAIプロバイダーで行います。解除したサーバーセッション内のキーも暗号化します。入力した共通パスワードは設定画面のメモリ内だけに保持し、画面を離れると破棄します。
        </p>

        <h2>重要な注意事項</h2>
        <div className="rounded-lg border-2 border-red-300 bg-red-50 p-4 dark:border-red-700 dark:bg-red-950/30 mb-4">
          <p className="font-bold text-red-700 dark:text-red-400 !mt-0">
            警告：パスワードを紛失すると、暗号化されたデータを復元する方法はありません。
          </p>
          <p className="!mb-0">
            ファイルの暗号化はブラウザ内で行います。秘密鍵の設定・解除・パスワード変更ではパスワードをサーバーへ送信しますが、永続保存しません。APIキーの保存は公開鍵で行うためパスワードを送信しません。GemiHubがパスワードをリセットしたり復元することはできません。暗号化されたファイル、チャット履歴、ワークフロー履歴、APIキーのすべてが永久にアクセス不能になります。パスワードは必ず安全な場所に保管してください。
          </p>
        </div>
        <ul>
          <li>暗号化ファイルは暗号化された状態でDriveに保存されます。Googleでさえ読み取れません。</li>
          <li>設定で入力した共通パスワードは、設定画面を閉じると破棄します。解除済みのAPIキーは、ロックまたはセッション終了まで利用できます。</li>
          <li>暗号化キーをリセットすると、以前に暗号化されたすべてのデータが読み取れなくなります。</li>
        </ul>
      </div>
    </>
  );
}
