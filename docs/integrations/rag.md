---
type: Guide
title: RAG (Retrieval-Augmented Generation)
description: RAG using Gemini or OpenAI embeddings with local disk or hosted Firestore storage.
tags:
  - rag
---
# RAG (Retrieval-Augmented Generation)

RAG uses embedding models to index documents and retrieve relevant
excerpts before a chat or workflow model answers. Gemini File Search is no longer
used. The embedding provider is selected per RAG setting, independently of the
chat model: an OpenAI chat can use a Gemini index and vice versa.

## Eligibility and setup

Local mode includes personal RAG without a kiokuflow subscription or Firestore.
It stores JSON metadata and Float32 binary vectors under `LOCAL_RAG_DIR`
(default `data/rag`), following Obsidian Local LLM Hub's storage approach.
Cosine and BM25 retrieval run on the server, with reusable revision-scoped caches.
Embedding and optional reranking still use the configured provider APIs.

On the hosted service, RAG requires an active paid kiokuflow account (Lite, Pro, Business or Granted)
and configured Firestore. Canceled and disabled accounts cannot index or search.
This is separate from the Gemini API Free/Paid setting. Server APIs verify the
subscription; a stored plan or `ragAvailable` UI flag never authorizes access.
Organization RAG also checks project access and the organization's subscription.

1. Configure and unlock the API key for the embedding provider in Settings.
2. Enable RAG in Settings > General > Optional advanced features.
3. Settings > RAG shows **Vector indexes** and **OKF** as separate sections.
   Vector indexes lists target folders, embedding
   models, registered/pending file counts and last sync times. Choose an index
   to edit it, or use **Add**. **Back to indexes** returns to the list and keeps
   unsaved edits. The OKF card appears only on the index list, with its folder
   settings and Save visible without expanding it.
   The detail view shows search options, **Files and embedding model**, and
   **Text chunking** directly, without collapsed sections.
   **Choose folders** opens a searchable folder tree with multiple selection.
   Selected folders include their subfolders; paths can also be entered directly.
4. Each index has one **Save** at the bottom of its detail view. It saves only
   that index, including a new index or a renamed one. Other indexes' drafts
   stay unsaved. **Delete** removes only that index; an unsaved new index is
   discarded locally. The OKF section on the list has its own **Save**, which
   updates only the knowledge folder.
5. Press **Sync index** to index files using the saved settings. Sync is disabled
   while that index has unsaved edits, and Save never starts a sync. Drafts in
   other indexes or OKF do not block syncing a saved index. Search option changes
   do not require reindexing. Select the index in chat or a workflow command node.

Personal indexes support `gemini-embedding-2`, `gemini-embedding-001`,
`text-embedding-3-small`, and `text-embedding-3-large`. Organization projects
retain their existing Vertex embedding connection. Embedding API usage is billed
to the configured provider account. Interactive OpenAI indexing/search uses the
unlocked session key; no additional plaintext key is stored in Firestore.

## Documents and search

- Text, Markdown and code are split into overlapping chunks.
- DOCX, XLSX and PPTX text is extracted from the document package. Legacy DOC/XLS
  must first be converted to a supported format.
- Text PDFs use their extracted page text. Gemini Embedding 2 can also embed
  scanned PDFs (in excerpts of at most six pages) and PNG/JPEG images. Models
  that accept text only return an explicit error for image-only documents.
- System settings, sync metadata, encrypted authentication data, hidden paths,
  encrypted files and the configured Secrets folder are excluded.
- Files are limited to 20 MB and 400 chunks. Empty or unsupported documents and
  embedding failures are reported as pending/errors, rather than marked indexed.
- Changed documents are replaced atomically after all embeddings succeed. A
  failed embedding request leaves the previous chunks intact.
- Full sync removes indexed documents that were deleted or excluded. Successful
  rebuilds clean up retired indexes in the current storage backend and workspace.

The default `gemihub` setting supports automatic registration on Push. The server
checks local mode or the hosted paid plan before registration or retrying pending files. Auto
registration also verifies that each Drive file ID matches its workspace path.

Chat and workflow retrieval uses `/api/rag/context` on My Drive. Search uses the
same scoped retrieval. Relevant excerpts and source paths are injected as
untrusted source data; no provider-native File Search tool is sent. Search returns
actual indexed passages rather than a model-generated description of matches.

## Hybrid search, reranking and Top K

Hybrid search is enabled by default. It combines cosine vector retrieval with
BM25 keyword retrieval across the same index using reciprocal rank fusion (RRF).
BM25 also finds identifiers such as `E02` and Japanese terms outside the vector
candidate pool. Turn Hybrid search off for vector-only retrieval. The lexical
branch reads indexed text without vectors, scoped to the current owner or
org/project/index; private paths are removed before keyword ranking. Each server
reuses a scoped lexical cache and token frequencies. Queries read one small
revision document to detect changes; chunk updates and deletions change that
revision in the same Firestore batch, invalidating caches across servers. The
cache retains at most eight indexes and evicts entries after ten idle minutes.
Locally, the JSON manifest supplies the revision and document updates commit by
atomically replacing it after both metadata and binary vectors have been written.

Each RAG has a single **Reranking** selector: **OFF**, **Jev**, or **Gemini Decisions
API**. Missing or unrecognized selections mean OFF, including existing settings;
storing an API key does not enable reranking. Search preferences do not require
re-indexing. Chat/workflows use saved options; the search panel can override them
for the current search.

In the search panel, expand **Search settings** to change Top K, hybrid search,
or reranking for the current search. **Reset Top K to default** restores the saved
index limit. These controls do not save changes to the index's defaults.
The reranking selector shows whether the selected key is missing, locked, or
available, with links to the exact provider or General settings. **Verify
connection** tests that selected scoring endpoint and incurs a small API charge;
changing the provider or key invalidates its result.

In RAG settings, **Fetch / refresh models** loads embedding models from the
configured Gemini or OpenAI connection without enabling chat models. The saved
model remains visible if absent from the catalogue; models the current vector
pipeline does not support are listed as unavailable for selection. Provider
keys, enabled models and the Jev connection mode are saved together with the
single **Save** button at the bottom of AI provider settings. Chat models are
optional, so an OpenAI key can be saved for embedding without enabling chat.
Connection verification and model discovery do not save settings. Edits survive
provider-tab changes, and failed validation leaves all provider settings unchanged.

Gemini uses `gemini-decision-1` at
`https://generativelanguage.googleapis.com/v1beta/decisions`, with the unlocked
Gemini API key configured in AI providers. Jev uses a direct key configured under
**AI providers > Jev**, or explicitly uses the configured OpenRouter key. Direct
requests use `https://api.typesafe.ai/v1/systemone` and `jev-latest`; OpenRouter
uses `https://openrouter.ai/api/alpha/decisions` and `~typesafe/jev-latest`.
Create direct Jev keys in the [TypeSafe console](https://console.typesafe.ai/).
**Verify connection** tests the current Jev connection; the shared **Save**
button validates it again before applying its key/mode.
Manage the common password and unlock keys in General. Only the selected
provider receives the query and candidate evidence, with separate API charges;
there is no automatic provider or credential fallback.

Reranking assigns relevance scores from 0 to 3, separately from retrieval scores.
Top K (1–20, initially 5) limits final results. The initial pool contains at least
40 candidates. Without repeat, one batch is scored and sorted; low scores are
still shown. **Search until a match is found** scores successive groups of 40,
returning scores of at least 2/3 from the first matching group, up to 1,000
candidates. Query embedding and retrieval run once per index. Exhausting the
candidates returns no matches; reaching the cap also produces a warning.

Each group has a 20-second scoring deadline, including retries. A missing or
locked selected key, invalid/incomplete score, or API failure returns the original
retrieval results with a warning. Available PDF page text or bounded scanned
page images can be scored. Unavailable/unsupported media stays at its original
retrieval position with an unchecked label. Repeat stops with a warning and
returns original results when evidence cannot be scored; missing evidence is
never treated as low relevance. Workflow execution logs include retrieval
warnings even when the AI response does not mention them.

## Storage and isolation

Hosted personal indexes use the `ragChunks` collection. Each record is filtered by a
reserved personal scope, a SHA-256 Drive root identifier, and a setting/config
identifier. Provider, model and chunking changes produce a new identifier;
incompatible embedding spaces are never compared in the same index. Tenant
indexes retain their org/project boundaries.

Firestore stores 2048-dimensional vectors. Gemini and OpenAI large request 2048
values; OpenAI small requests its native 1536 values and appends zeros. Padding
preserves cosine similarity exactly. Documents retain source paths, chunk indexes,
checksums and provider/model metadata. No provider API keys are stored in chunks.

A hosted composite vector index is required for `orgId`, `projectId`, `settingName`,
`__name__` and `embedding` (2048 dimensions, flat). Terraform defines it as
`google_firestore_index.rag_chunks` in `terraform/modules/gemihub/firestore.tf`,
gated by `manage_firestore_indexes`. Apply this infrastructure before enabling
production search. A missing index is reported as an error; search does not
silently fall back to another provider or ungrounded generation.

Local indexes use hashed workspace/config directories, per-document JSON and
binary files, and a manifest. Searches reuse loaded vectors and norms; updates
and deletions invalidate the cache. No Firestore queries or vector-index setup
are needed. Keep the local data directory persistent across server restarts.
Switching between hosted and local storage requires one sync per index. A new
local server also checks the actual local document checksums, so Drive's saved
registration status cannot cause it to skip rebuilding missing local data.
Cleanup only affects the active backend; local sync never deletes hosted data.

## Migration from File Search

Existing settings keep their target folders and exclusion rules. Choose an
embedding provider/model and Sync to build the new index in the active backend. Legacy
`fileSearchStores/...` handles are rejected by retrieval until re-indexed.
External File Search store sharing is retired. Legacy remote stores are left
untouched; kiokuflow no longer reads, uploads to or deletes those remote stores.
Re-indexing requires access to the original Drive documents.

The UI retains `storeId`/`storeName` as opaque index handles for compatibility
with chat, workflow and sync protocols. `isExternal` is normalized to false;
`storeIds` is cleared on save. `files` tracks registered/pending status and SHA-256
checksums. `retiredIndexes` records old local indexes until a successful rebuild.

## References

- [Gemini embedding API](https://ai.google.dev/gemini-api/docs/embeddings)
- [OpenAI embedding API](https://developers.openai.com/api/reference/resources/embeddings/methods/create)
- [Firestore vector search](https://firebase.google.com/docs/firestore/vector-search)
