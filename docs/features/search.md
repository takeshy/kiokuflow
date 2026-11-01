---
type: Guide
title: Search
description: "File-name and content search, automatic paid RAG for sentences, optional fuzzy expansion, and Quick Open."
tags:
  - search
---
# Search

Click the search icon in the file tree, or press Ctrl+Shift+F / Cmd+Shift+F,
**File search** opens immediately. Switch to **Content search** using the tab. Enter searches;
Shift+Enter inserts a line break. The arrow returns to the file tree.

## File search

Searches names and paths from the current tree. It includes files whose
content has never been cached and does not read file bodies or make AI calls.

## Content search

Keyword search uses locally saved text from the current workspace. File-name matches
are excluded. Query terms use AND matching after NFKC, case, and kana
normalization. Only file IDs present in the current tree participate, excluding
stale/deleted cache records. Binary and encrypted contents are excluded.
The mount-aware cache dispatcher keeps project and Drive data separate.
Sync/open files first to make their text available locally.

Short words and phrases initially use keyword matching. Questions, sentence
punctuation, Japanese request/grammar cues, five or more whitespace-separated
words, or Japanese text longer than 20 characters select RAG automatically.
These intent rules follow kakeratta's `search-intent.js` and require no LLM call.

RAG requires an active paid **kiokuflow subscription**, independently of the
Gemini API's Free/Paid setting, and a configured/synchronized index. It uses
the index's embedding provider. Automatic sentence searches return only server-index
results and do not require a local content cache. Unsynced local changes are
excluded; uploading a file alone does not update its index until RAG synchronization.
Personal Drive searches use `/api/search`;
project searches use `/api/rag/search` with project ACL and organization-plan
checks. File paths and retrieved excerpts are displayed without generating
an additional AI answer. Duplicate basenames are never guessed for navigation.

When RAG is unavailable or fails, the panel explains the reason and returns
local matches. It does not silently claim that lexical results are semantic.

## Expand the results

**Also search similar matches** is available after keyword searches, including
zero-hit searches. It adds substring edit-distance matching locally. Very short
terms are not expanded into arbitrary approximate matches. File search stays
local; paid content search additionally includes semantic RAG matches. Exact
keyword results are retained and duplicate files are removed. **Search keywords
only** overrides automatic intent selection and returns to lexical matching.

Query/target/workspace changes abort outstanding searches and invalidate their
results. Late responses cannot overwrite a newer search. Auto-search previews
run once rather than repeating embedding requests after every render.

## APIs

`POST /api/search` remains available for personal Drive:

```ts
{
  query: string; // trimmed, 1–16000 characters
  mode: "rag" | "drive";
  ragStoreIds?: string[]; // required for RAG, at most 10 indexes
  topK?: number; // integer 1–20; default: selected index's saved Top K
  jevFilter?: boolean; // override the selected index's Jev toggle
  searchUntilMatch?: boolean; // override its repeat-until-match option
}
```

RAG results contain `{ title, snippet, jevVerified? }` per source, and the legacy `aiText`
field contains retrieved text for older callers. Subscription and index ownership
are checked by `retrievePersonalRag`. Drive mode retains the legacy Drive API
search for callers; the panel uses the current tree and cached text instead.
The API validates same-origin requests and rejects organization mounts, which
must use the project endpoint. Responses are not cached.

The content panel displays the selected RAG's Top K and, when Jev is configured,
checkboxes for relevance filtering and searching until a match is found. Repeat
checks successive Top K-sized batches until a confirmed match is found or the
candidates run out (up to 1,000). Unchecked media and candidate-limit warnings are
shown explicitly. These temporary panel choices do not change saved settings.
Responses include `jevFiltered`, `judgedCount`, `uncheckedCount` and
`candidateLimitReached`. See [RAG setup](../integrations/rag.md).

## Quick Open

Ctrl+P / Cmd+P opens Quick Open. Type a name/path, use the arrow keys to select,
and press Enter. It also supports the editor's image-picker mode.

## Source

- `app/components/ide/SearchPanel.tsx`: target choice, intent routing, requests,
  expansion, and stale-response handling.
- `app/services/file-search.ts`: intent rules, lexical/fuzzy matching, previews,
  current-tree restriction, and result merging.
- `app/routes/api.search.tsx`: personal search API.
- `app/routes/api.rag.search.tsx`: organization/project RAG API.
- `app/services/rag-index.server.ts`: paid personal embedding retrieval.
- `app/services/indexeddb-cache.ts`: mount-aware local data source.
