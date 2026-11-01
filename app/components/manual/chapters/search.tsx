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
      <p>{ja ? "質問や文章は、サーバーに同期済みのRAGインデックスだけを検索します。端末内の未同期内容は含まれません。RAGには有料GemiHubプランと設定・同期済みのインデックスが必要です。チャットのモデルとは独立して、インデックスに設定されたGeminiまたはOpenAIのembeddingモデルを使います。通常の単語検索ではAIを呼び出しません。" : "Questions and sentences search only the synchronized server RAG index. Unsynced local content is excluded. RAG requires a paid GemiHub plan and a configured, synchronized index. It uses the index’s Gemini or OpenAI embedding model, independently of the chat model. Ordinary keyword search makes no AI request."}</p>
      <p>{ja ? "RAGを利用できない場合は理由を表示し、端末内の検索結果を表示します。" : "If RAG is unavailable, the panel explains why and shows local matches."}</p>
      <p>{ja ? "内容検索ではRAGを選び、そのRAGに保存したTop Kを確認できます。Jev登録後は「Jevで一致を判定する」と「一致するまで検索」をその検索だけ切り替えられます。継続検索は一致が見つかるか候補が尽きるまでTop K件ずつ判定します（最大1000候補）。判定できないメディアは未判定として表示します。" : "In content search, select a RAG and view its saved Top K. After configuring Jev, toggle relevance filtering and Search until a match is found for the current search. Repeat judges Top K batches until a match is found or candidates run out (up to 1,000). Media that cannot be judged is labeled unchecked."}</p>
      <h2>{ja ? "結果から検索範囲を広げる" : "Expand from the results"}</h2>
      <p>{ja ? "通常検索の結果にある「あいまい検索もする」で、タイプミスや似た表記も検索できます。0件の場合も利用できます。有料ユーザーの内容検索ではRAGの結果も追加します。「単語だけで検索」で通常検索に戻せます。結果にはファイルパスと本文の抜粋が表示され、クリックするとファイルを開きます。" : "Choose “Also search similar matches” after a keyword search to include typos and similar spellings, even when there are no results. Paid content searches also add RAG matches. “Search keywords only” returns to ordinary search. Results show paths and excerpts; click a result to open the file."}</p>
      <h2>Quick Open</h2>
      <p>{ja ? "Ctrl+P / Cmd+PではQuick Openを開き、ファイル名・パスを入力して絞り込み、矢印キーとEnterで開けます。" : "Ctrl+P / Cmd+P opens Quick Open. Filter by file name or path, navigate with arrow keys, and press Enter to open."}</p>
    </div>
  </>;
}
