---
type: Guide
title: RAG (Retrieval-Augmented Generation)
description: Paid RAG using Gemini or OpenAI embedding models and Firestore vector search.
tags:
  - rag
---
# RAG (Retrieval-Augmented Generation)

RAG uses embedding models to index documents in Firestore and retrieve relevant
excerpts before a chat or workflow model answers. Gemini File Search is no longer
used. The embedding provider is selected per RAG setting, independently of the
chat model: an OpenAI chat can use a Gemini index and vice versa.

## Eligibility and setup

RAG requires an active paid GemiHub account (Lite, Pro, Business or Granted)
and configured Firestore. Canceled and disabled accounts cannot index or search.
This is separate from the Gemini API Free/Paid setting. Server APIs verify the
subscription; a stored plan or `ragAvailable` UI flag never authorizes access.
Organization RAG also checks project access and the organization's subscription.

1. Configure and unlock the API key for the embedding provider in Settings.
2. Enable RAG in Settings > General > Optional advanced features.
3. In Settings > RAG, add a setting and choose the embedding provider/model,
   target folders, exclude patterns and chunk size/overlap.
4. Save and Sync. Select that setting in chat or a workflow command node.

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
  rebuilds clean up retired Firestore indexes belonging to the same workspace.

The default `gemihub` setting supports automatic registration on Push. The server
checks the paid plan before registration or retrying pending files. Auto
registration also verifies that each Drive file ID matches its workspace path.

Chat and workflow retrieval uses `/api/rag/context` on My Drive. Search uses the
same scoped retrieval. Relevant excerpts and source paths are injected as
untrusted source data; no provider-native File Search tool is sent. Search returns
actual indexed passages rather than a model-generated description of matches.

## Jev relevance filtering and Top K

Configure Jev under Settings > AI providers > Jev, using an official API key from
the [TypeSafe console](https://console.typesafe.ai/) or the configured OpenRouter
key. Direct requests use `https://api.typesafe.ai/v1/systemone`, as documented in
the [official API reference](https://docs.typesafe.ai/api/system-one).
Manage encryption passwords and key unlocking under
General. Direct Jev keys are encrypted in settings and in the session; no key is
stored in a RAG chunk. This service receives the query and candidate excerpts
(or matched PDF/image content) and incurs separate API usage charges.

Each RAG setting has its own Top K (1–20, initially 5), Jev relevance toggle and
“Search until a match is found” checkbox. Existing global Top K values migrate
to each index. Search-only changes do not rebuild embeddings. Chat and workflow
retrieval use the selected index's persisted options; the content search panel
also allows choosing the index and temporarily changing the Jev/check-until-match
toggles.

With Jev enabled, Top K is the candidate batch size, not a guaranteed result
count. Without repeat, only one batch is judged. With repeat, subsequent batches
are judged until at least one confirmed match is found or candidates run out,
up to Firestore's 1,000 nearest-candidate limit. Query embedding and vector search
run once per index, and a candidate is never judged twice. If the limit is reached
without a match, the search panel asks the user to narrow the query.

Native PDF candidates use text from the matched pages, or JPEG page images for
scanned pages (up to 16 pages and 12 MiB of base64 image assets). Changed,
unavailable or unsupported media remains explicitly unchecked; it does not count
as a confirmed match for stopping repeat. Jev API errors and locked keys are
reported, rather than silently treating all candidates as matches. Unconfigured
Jev leaves ordinary embedding retrieval available. RAG still requires a paid plan.

## Storage and isolation

Personal indexes use the `ragChunks` collection. Each record is filtered by a
reserved personal scope, a SHA-256 Drive root identifier, and a setting/config
identifier. Provider, model and chunking changes produce a new identifier;
incompatible embedding spaces are never compared in the same index. Tenant
indexes retain their org/project boundaries.

Firestore stores 2048-dimensional vectors. Gemini and OpenAI large request 2048
values; OpenAI small requests its native 1536 values and appends zeros. Padding
preserves cosine similarity exactly. Documents retain source paths, chunk indexes,
checksums and provider/model metadata. No provider API keys are stored in chunks.

A composite vector index is required for `orgId`, `projectId`, `settingName`,
`__name__` and `embedding` (2048 dimensions, flat). Terraform defines it as
`google_firestore_index.rag_chunks` in `terraform/modules/gemihub/firestore.tf`,
gated by `manage_firestore_indexes`. Apply this infrastructure before enabling
production search. A missing index is reported as an error; search does not
silently fall back to another provider or ungrounded generation.

## Migration from File Search

Existing settings keep their target folders and exclusion rules. Choose an
embedding provider/model and Sync to build the new Firestore index. Legacy
`fileSearchStores/...` handles are rejected by retrieval until re-indexed.
External File Search store sharing is retired. Legacy remote stores are left
untouched; GemiHub no longer reads, uploads to or deletes those remote stores.
Re-indexing requires access to the original Drive documents.

The UI retains `storeId`/`storeName` as opaque index handles for compatibility
with chat, workflow and sync protocols. `isExternal` is normalized to false;
`storeIds` is cleared on save. `files` tracks registered/pending status and SHA-256
checksums. `retiredIndexes` records old local indexes until a successful rebuild.

## References

- [Gemini embedding API](https://ai.google.dev/gemini-api/docs/embeddings)
- [OpenAI embedding API](https://developers.openai.com/api/reference/resources/embeddings/methods/create)
- [Firestore vector search](https://firebase.google.com/docs/firestore/vector-search)
