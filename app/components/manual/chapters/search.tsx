import type { Language } from "~/types/settings";
import { prose } from "../prose";

export function SearchChapter({ lang }: { lang: Language }) {
  const ja = lang === "ja";
  return <>
    <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">{ja ? "検索" : "Search"}</h1>
    <figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
      {ja ? <img src="/images/rag_search.png" alt="検索パネル" className="w-full" loading="lazy" /> : <img src="/images/rag_search_en.png" alt="Search panel" className="w-full" loading="lazy" />}
    </figure>
    <div className={prose}>
      <h2>{ja ? "検索対象を選ぶ" : "Choose what to search"}</h2>
      <p>{ja ? "ファイルツリーの検索アイコンをクリックするか、Ctrl+Shift+F / Cmd+Shift+Fを押し、ファイル検索を開始します。内容検索へはタブで切り替えられます。Enterで検索、Shift+Enterで改行できます。" : "Click Search in the file tree or press Ctrl+Shift+F / Cmd+Shift+F, to start a file search. Switch to Content search using the tab. Enter runs the search; Shift+Enter adds a line."}</p>
      <h2>{ja ? "ファイル検索" : "File search"}</h2>
      <p>{ja ? "現在のファイルツリーのファイル名とパスを検索します。本文が端末に保存されていないファイルも対象です。" : "Search names and paths in the current file tree, including files whose content has not been saved on this device."}</p>
      <h2>{ja ? "内容検索" : "Content search"}</h2>
      <p>{ja ? "通常検索では端末に保存済みの本文を検索します。ファイル名の一致は含みません。複数の単語はすべてを含むファイルに一致します。大文字小文字、全角半角、ひらがな・カタカナの違いを吸収します。暗号化ファイル・バイナリファイルは対象外です。" : "Keyword search uses text saved on this device. File-name matches are excluded. All query words must match. Case, character width, and hiragana/katakana are normalized. Encrypted and binary files are excluded."}</p>
      <h2>{ja ? "文章はRAG、単語は通常検索" : "RAG for sentences, keyword search for words"}</h2>
      <p>{ja ? "質問や文章は、サーバーに同期済みのRAGインデックスだけを検索します。端末内の未同期内容は含まれません。RAGには設定・同期済みのインデックスが必要です。ローカルでは契約不要、ホスティング版では有料kiokuflowプランが必要です。チャットのモデルとは独立して、インデックスに設定されたGeminiまたはOpenAIのembeddingモデルを使います。通常の単語検索ではAIを呼び出しません。" : "Questions and sentences search only the synchronized server RAG index. Unsynced local content is excluded. RAG requires a configured, synchronized index. Local mode needs no subscription; the hosted service requires a paid kiokuflow plan. It uses the index’s Gemini or OpenAI embedding model, independently of the chat model. Ordinary keyword search makes no AI request."}</p>
      <p>{ja ? "RAGを利用できない場合は理由を表示し、端末内の検索結果を表示します。" : "If RAG is unavailable, the panel explains why and shows local matches."}</p>
      <p>{ja ? "内容検索ではRAG、Top K、hybrid検索、リランキング（OFF／Jev／Gemini Decisions API）を選べます。未選択はOFFです。点数は0〜3で表示します。「一致するまで検索」は40候補ずつ最大1,000候補を調べ、2/3点以上で停止します。採点失敗時は警告付きで元の結果を返し、採点できないメディアの順位を保持します。" : "Content search lets you select a RAG, Top K, hybrid search and reranking (OFF / Jev / Gemini Decisions API). No selection means OFF. Relevance scores are 0–3. Search until a match checks groups of 40 for a score ≥2/3, up to 1,000 candidates. Scoring failures return original results with a warning; unscorable media retains its rank."}</p>
      <p>{ja ? "「検索設定」を開くと、その検索だけのTop K・ハイブリッド検索・リランキングを変更できます。「既定のTop Kに戻す」で保存済みの件数へ戻せます。接続状態がロック中なら一般設定、未設定ならAIプロバイダーへのリンクから設定できます。「接続確認」には少量のAPI利用料がかかります。" : "Expand Search settings to change Top K, hybrid search and reranking for this search only. Reset Top K to default restores the saved limit. Connection status links to General for locked keys or AI providers for missing keys. Verify connection incurs a small API charge."}</p>
      <h2>{ja ? "結果から検索範囲を広げる" : "Expand from the results"}</h2>
      <p>{ja ? "通常検索の結果にある「あいまい検索もする」で、タイプミスや似た表記も検索できます。0件の場合も利用できます。ローカルまたは有料ホスティング版の内容検索ではRAGの結果も追加します。「単語だけで検索」で通常検索に戻せます。結果にはファイルパスと本文の抜粋が表示され、クリックするとファイルを開きます。" : "Choose “Also search similar matches” after a keyword search to include typos and similar spellings, even when there are no results. Local mode and paid hosted content searches also add RAG matches. “Search keywords only” returns to ordinary search. Results show paths and excerpts; click a result to open the file."}</p>
      <h2>Quick Open</h2>
      <p>{ja ? "Ctrl+P / Cmd+PではQuick Openを開き、ファイル名・パスを入力して絞り込み、矢印キーとEnterで開けます。" : "Ctrl+P / Cmd+P opens Quick Open. Filter by file name or path, navigate with arrow keys, and press Enter to open."}</p>
    </div>
  </>;
}
