import type { Language } from "~/types/settings";
import { prose } from "../prose";

export function RagChapter({ lang }: { lang: Language }) {
  const ja = lang === "ja";
  return <><h1 className="mb-6 text-3xl font-bold">RAG</h1><div className={prose}>
    <p>{ja ? "RAGはドキュメントを意味で検索し、見つかった内容を使ってAIが回答する機能です。GemiHubの有効な有料プランとFirestoreが必要です。Gemini APIの無料・有料設定とは別に判定します。" : "RAG searches your documents by meaning and gives the matching content to the AI. It requires an active paid GemiHub plan and Firestore, independently of the Gemini API Free/Paid setting."}</p>
    <h2>{ja ? "設定する" : "Setup"}</h2>
    <ol>
      <li>{ja ? "設定 → 一般で暗号化パスワードを設定・確認し、AIプロバイダーでembedding用のGeminiまたはOpenAIのAPIキーを設定します。" : "Set or verify the password in Settings > General, then configure your Gemini or OpenAI embedding key in Settings > AI providers."}</li>
      <li>{ja ? "追加機能のRAGを有効にします。" : "Enable RAG under Optional advanced features."}</li>
      <li>{ja ? "RAG設定を追加し、embeddingプロバイダー・モデル、対象フォルダ、除外パターン、チャンクサイズと重複量を選びます。" : "Add a RAG setting and select its embedding provider/model, target folders, exclusion patterns, chunk size and overlap."}</li>
      <li>{ja ? "保存して同期し、チャットやワークフローでRAG設定を選択します。" : "Save and Sync, then select the RAG setting in chat or a workflow."}</li>
    </ol>
    <figure className="my-4 overflow-hidden rounded-xl border shadow">{ja ? <img src="/images/setting_rag.png" alt="RAG設定" className="w-full" loading="lazy" /> : <img src="/images/setting_rag_en.png" alt="RAG settings" className="w-full" loading="lazy" />}</figure>
    <h2>{ja ? "対応モデルとファイル" : "Models and files"}</h2>
    <p>{ja ? "Gemini Embedding 2／001、OpenAI text-embedding-3-small／largeを選択できます。チャットのモデルとは独立した設定です。検索用データはFirestoreに保存します。" : "Personal indexes support Gemini Embedding 2/001 and OpenAI text-embedding-3-small/large, selected independently of the chat model. Search data is stored in Firestore."}</p>
    <p>{ja ? "テキスト・コード、文字を抽出できるPDF、DOCX・XLSX・PPTXに対応します。Gemini Embedding 2は画像とスキャンPDFにも対応します。旧形式のDOC・XLSは変換してください。API利用料は設定したプロバイダーのアカウントにかかります。" : "Text, code, text PDFs, DOCX, XLSX and PPTX are supported. Gemini Embedding 2 also supports images and scanned PDFs. Convert legacy DOC/XLS first. Embedding usage is billed to the configured provider account."}</p>
    <h2>{ja ? "Jevと検索件数" : "Jev and retrieval size"}</h2>
    <p>{ja ? "AIプロバイダー → Jevで直接APIキーを登録するか、登録済みOpenRouterキーの利用を選べます。「確認＆保存」で接続に成功したキー・方式だけを保存します。失敗時は保存済み設定を変更しません。暗号化パスワード・ロック解除は一般設定で管理します。検索クエリと候補の本文・画像をJevへ送信し、別途API利用料がかかります。" : "Configure a direct Jev key or reuse your OpenRouter key in AI providers > Jev. Verify & save stores the key and connection mode only after a successful connection check; a failed check leaves the saved configuration unchanged. Manage the password and unlock keys in General. Queries and candidate text/images are sent to Jev and incur separate API usage charges."}</p>
    <p>{ja ? "RAGごとにTop K（1～20）、Jevによる一致判定、「一致するまで検索」を保存できます。Jev利用時のTop Kは1回に判定する候補数です。継続検索を有効にすると、一致が見つかるか候補が尽きるまで最大1000候補を順に判定します。検索設定だけの変更では再同期は不要です。" : "Save Top K (1–20), relevance filtering and Search until a match is found per RAG. With Jev, Top K is the candidate batch size. Repeat checks subsequent batches until a match is found or candidates run out, up to 1,000 candidates. Search preference changes do not require re-indexing."}</p>
    <p>{ja ? "スキャンPDFは該当ページの画像で判定します。判定できないメディアは未判定として残し、継続検索を終了する一致としては扱いません。Jev未登録なら通常のembedding検索を利用します。" : "Scanned PDFs are judged using images of the matched pages. Unavailable media remains unchecked and does not stop repeat as a confirmed match. Without Jev, ordinary embedding retrieval remains available."}</p>
    <h2>{ja ? "更新と移行" : "Updates and migration"}</h2>
    <p>{ja ? "gemihub設定ではPush時の自動登録も利用できます。変更したファイルだけを再登録し、失敗したファイルは保留として表示します。モデルやチャンク設定を変更した場合は同期して再インデックスしてください。" : "The gemihub setting can register files automatically on Push. Changed files are re-indexed and failures remain pending. Sync to rebuild after changing the embedding model or chunking settings."}</p>
    <p>{ja ? "Gemini File Searchは使用しません。旧設定は元のDriveファイルから再インデックスしてください。外部File SearchストアIDの共有は終了しました。旧リモートストアは削除しません。" : "Gemini File Search is no longer used. Re-index legacy settings from the original Drive files. External File Search store sharing is retired; old remote stores are left untouched."}</p>
    <p>{ja ? "設定・認証データ、隠しパス、暗号化ファイル、指定したシークレットフォルダは登録対象から除外します。契約の解約・無効化後は登録と検索を利用できません。" : "Settings, authentication data, hidden paths, encrypted files and the configured Secrets folder are excluded. Indexing and search are unavailable after cancellation or account disablement."}</p>
    <h2>{ja ? "OKFナレッジバンドル" : "OKF knowledge bundles"}</h2>
    <p>{ja ? "OKFはembeddingを使わないMarkdownのナレッジ機能です。有料RAGとは独立して利用できます。設定 → 一般でOKFフォルダ（標準はKnowledge）を指定し、チャットの本のアイコンからバンドルを選択してください。目次をAIへ渡し、必要な本文だけを読み込みます。" : "OKF is a Markdown knowledge feature that does not use embeddings and remains available independently of paid RAG. Set the OKF folder (Knowledge by default) in Settings > General and select bundles using the book icon in chat. The AI receives the index and reads full documents on demand."}</p>
    <figure className="my-4 overflow-hidden rounded-xl border shadow"><img src="/images/okf_sample.png" alt={ja ? "OKFバンドルをチャットで利用" : "OKF bundles in chat"} className="w-full" loading="lazy" /></figure>
    <p>{ja ? "OKF Authoringスキルを使うと、ノートから目次とコンセプトファイルを作成できます。設定 → プラグイン → External skillsからインストールしてください。" : "Install the OKF Authoring skill from Settings > Plugins > External skills to create indexes and concept files from notes."}</p>
    <figure className="my-4 overflow-hidden rounded-xl border shadow"><img src="/images/okf_skill.png" alt={ja ? "AIによるOKF作成" : "Authoring OKF with AI"} className="w-full" loading="lazy" /></figure>
  </div></>;
}
