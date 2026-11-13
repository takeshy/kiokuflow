---
type: Architecture
title: Self-Hosting
description: "Self-hosting setup: Google Cloud project and OAuth client, the drive.file scope, Gemini API key, environment variables, dev server, and Docker/production builds."
tags:
  - self-hosting
  - setup
  - oauth
---
# Self-Hosting

kiokuflow runs on your own infrastructure with a Node.js server, your Google Cloud OAuth client, and your chosen AI provider's API key. Documents and settings live in the user's Google Drive. Local RAG indexes use JSON metadata and Float32 binary vectors on the server's disk; no Firestore database is required.

For the managed Cloud Run / Terraform deployment used by kiokuflow.net, see [Infrastructure](infrastructure.md).

## Prerequisites

- Node.js 24+
- A Google Cloud project (setup below)
- A Gemini API key

## 1. Google Cloud setup

Open the [Google Cloud Console](https://console.cloud.google.com/) and do the following.

### Create a project

1. Click "Select a project" at the top left → "New Project" → name it and create.

### Enable the Google Drive API

1. Go to "APIs & Services" → "Library".
2. Search for "Google Drive API" and click "Enable".

### Configure the OAuth consent screen

1. Go to "APIs & Services" → "OAuth consent screen".
2. User Type: **External**.
3. Fill in the app name (e.g. kiokuflow), support email, and developer contact.
4. Add the scope `https://www.googleapis.com/auth/drive.file`.
5. Add your Gmail address as a test user — before publishing, only test users can sign in.

> **Important: what `drive.file` can see**
>
> The `drive.file` scope grants access **only to files the app itself created**. Files you upload to the `kiokuflow/` folder through the Google Drive web UI or another app are **invisible** to kiokuflow. Add files with the in-app upload feature or create them through AI chat.

### Create OAuth credentials

1. Go to "APIs & Services" → "Credentials" → "+ Create Credentials" → "OAuth client ID".
2. Application type: **Web application**.
3. Name: anything (e.g. kiokuflow Local).
4. Add an **Authorized redirect URI**: `http://localhost:8132/auth/google/callback`.
5. Copy the **Client ID** and **Client Secret**.

## 2. Get a Gemini API key

1. Go to [Google AI Studio](https://aistudio.google.com/).
2. Left menu → "API keys" → "Create API key".
3. Copy the key — you enter it later on the app's Settings page, not in `.env`.

> **Free vs. paid API:** the free Gemini API tier has strict rate limits and restricted model access — enough for a quick test, not for regular use. For the full experience you need a paid plan. [Google AI Pro](https://one.google.com/about/ai-premium) ($19.99/month) is a good option: it includes $10/month of Google Cloud credits that cover substantial Gemini API usage, plus 2 TB of Google One storage and Gemini Code Assist. See [Gemini API pricing](https://ai.google.dev/pricing).

## 3. Clone and install

```bash
git clone https://github.com/takeshy/kiokuflow.git
cd kiokuflow
npm install
```

## 4. Configure the environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-client-secret
GOOGLE_PICKER_API_KEY=your-browser-api-key
GOOGLE_REDIRECT_URI=http://localhost:8132/auth/google/callback
SESSION_SECRET=<random string>
# Optional; standalone servers use local mode by default, even with ADC installed.
KIOKUFLOW_RUNTIME=local
LOCAL_RAG_DIR=data/rag
# Optional: managed kiokuflow OKF distribution in private Cloud Storage
KIOKUFLOW_OKF_BUCKET=<bucket-name>
KIOKUFLOW_OKF_PREFIX=gemihub-okf
```

Generate `SESSION_SECRET` with:

```bash
openssl rand -hex 32
```

## 5. Start the dev server

```bash
npm run dev
```

The dev server port is `8132`, configured in `vite.config.ts`. To change it, update the config, the redirect URI in `.env`, and the authorized redirect URI in the Google Cloud Console.

## 6. First-time setup in the app

1. Open `http://localhost:8132`.
2. Click "Sign in with Google" and authorize your account.
3. Click the gear icon (Settings) in the top right.
4. In the **General** tab, enter your Gemini API key and save.

Chat, workflows, and file editing are ready.

Local mode includes Premium personal features without a kiokuflow subscription:
RAG, PDF export, edit URLs, external sync token export, larger uploads and manual
Google Sheets/Gmail/Calendar workflow nodes. Provider API usage is billed to your
own provider account. In **Settings > RAG**, create and save a vector index, then
sync its target folders. Embedding and reranking use the selected provider APIs;
vector and keyword retrieval run locally.

Keep `LOCAL_RAG_DIR` on persistent storage (the default is `data/rag`). When
switching from hosted Firestore RAG or moving to another server, sync each index
once to rebuild it locally. This does not delete the hosted index.

## Production

### Build and run

```bash
npm run build
npm run start
```

`npm run start` serves the production build via `server.js` on port 8080.

### Docker

```bash
docker build -t gemihub .
docker run -p 8080:8080 \
  -v kiokuflow-data:/app/data \
  -e KIOKUFLOW_RUNTIME=local \
  -e GOOGLE_CLIENT_ID=... \
  -e GOOGLE_CLIENT_SECRET=... \
  -e GOOGLE_PICKER_API_KEY=... \
  -e GOOGLE_REDIRECT_URI=https://your-domain/auth/google/callback \
  -e SESSION_SECRET=... \
  gemihub
```

Remember to add the production redirect URI to the OAuth client in the Google Cloud Console, and to publish the OAuth consent screen if users other than your test accounts will sign in.

## Hosted-only features

Public sites and custom domains, scheduled workflows, organization projects,
Vertex AI and Kakeratta Timeline synchronization are unavailable in local mode.
Local mode never connects to Firestore, even if the developer has Application
Default Credentials or Firestore project variables configured.

Cloud Run (`K_SERVICE`) and servers with `GCE_METADATA_HOST` or `GCE_METADATA_IP`
use hosted mode by default. Other managed deployments must explicitly set
`KIOKUFLOW_RUNTIME=hosted`; hosted features then require the credentials and
infrastructure described in [Premium Plan](premium.md) and
[Storage Mounts & AI Providers](mounts.md). Runtime mode is server configuration;
request hostnames and saved settings cannot grant local Premium access.
