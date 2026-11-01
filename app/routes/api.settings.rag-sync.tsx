import type { Route } from "./+types/api.settings.rag-sync";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings, saveSettings } from "~/services/user-settings.server";
import { smartSync, getOrCreateStore, isCurrentRagIndex } from "~/services/rag-index.server";

// ---------------------------------------------------------------------------
// POST -- RAG sync with SSE progress
// ---------------------------------------------------------------------------

export async function action({ request }: Route.ActionArgs) {
  {
    const peek = (await request.clone().json().catch(() => null)) as { projectId?: unknown } | null;
    if (peek && typeof peek.projectId === "string" && peek.projectId) {
      const { tenantAction } = await import("~/services/ai/tenant-rag-sync-route.server");
      return tenantAction(request);
    }
  }
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const responseHeaders = setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined;

  let ragSettingName: string | undefined;
  try {
    const body = await request.json();
    ragSettingName = (body as { ragSettingName?: string }).ragSettingName;
  } catch {
    // body may be empty when called without JSON payload
  }

  const settings = await getSettings(
    validTokens.accessToken,
    validTokens.rootFolderId
  );

  const settingName = ragSettingName || settings.selectedRagSetting;
  if (!settingName || !settings.ragSettings[settingName]) {
    return Response.json(
      { error: "RAG setting not found" },
      { status: 400, headers: responseHeaders }
    );
  }

  const ragSetting = settings.ragSettings[settingName];
  const { embeddingConfig } = await import("~/services/rag-config");
  const config = embeddingConfig(ragSetting);
  const apiKey = config.provider === "openai" ? validTokens.openaiApiKey : validTokens.geminiApiKey;
  if (!apiKey) return Response.json({ error: `Unlock the ${config.provider} API key first.` }, { status: 400, headers: responseHeaders });
  const { assertRagAccess } = await import("~/services/rag-access.server");
  await assertRagAccess(validTokens.rootFolderId);

  // Create SSE stream for progress reporting
  const abortSignal = request.signal;
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let aborted = false;

      abortSignal.addEventListener("abort", () => {
        aborted = true;
        try { controller.close(); } catch { /* already closed */ }
      });

      const sendEvent = (
        type: string,
        data: Record<string, unknown>
      ) => {
        if (aborted) return;
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type, ...data })}\n\n`
            )
          );
        } catch {
          aborted = true;
        }
      };

      try {
        // Ensure store exists. If this setting predates multimodal File Search,
        // create a gemini-embedding-2 store and let the sync re-index files.
        if (!isCurrentRagIndex(ragSetting, validTokens.rootFolderId, settingName)) {
          sendEvent("progress", {
            message: "Preparing Firestore vector index...",
            current: 0,
            total: 0,
          });
          const storeName = await getOrCreateStore(apiKey, settingName, { rootFolderId: validTokens.rootFolderId, setting: ragSetting });
          if (ragSetting.storeName?.startsWith("ragv1:")) ragSetting.retiredIndexes = [...new Set([...(ragSetting.retiredIndexes || []), ragSetting.storeName])];
          ragSetting.storeName = storeName;
          ragSetting.storeId = storeName;
          ragSetting.embeddingModel = config.model;
          ragSetting.embeddingProvider = config.provider;
          ragSetting.isExternal = false;
          ragSetting.files = {};

          // Persist the new store before uploading. If a long sync is interrupted,
          // the next run must reuse this store instead of orphaning it.
          settings.ragSettings[settingName] = { ...ragSetting };
          await saveSettings(
            validTokens.accessToken,
            validTokens.rootFolderId,
            settings
          );
        }

        sendEvent("progress", {
          message: "Starting sync...",
          current: 0,
          total: 0,
        });

        const result = await smartSync(
          apiKey,
          validTokens.accessToken,
          ragSetting,
          validTokens.rootFolderId,
          (current, total, fileName, action) => {
            sendEvent("progress", {
              current,
              total,
              fileName,
              action,
              message: `${action === "upload" ? "Uploading" : action === "skip" ? "Skipping" : "Deleting"}: ${fileName}`,
            });
          },
          { signal: abortSignal }
        );

        // Update settings with sync results
        const hasRegistered = Object.values(result.newFiles).some((f) => f.status === "registered");
        if (hasRegistered) {
          if (!settings.selectedRagSetting) {
            settings.selectedRagSetting = settingName;
          }
        }
        settings.ragSettings[settingName] = {
          ...ragSetting,
          files: result.newFiles,
          lastFullSync: result.lastFullSync,
          storeId: ragSetting.storeId || ragSetting.storeName,
        };

        await saveSettings(
          validTokens.accessToken,
          validTokens.rootFolderId,
          settings
        );

        const errorDetails = result.errors.length > 0
          ? "\n" + result.errors.map((e) => `  - ${e.path}: ${e.error}`).join("\n")
          : "";
        sendEvent("complete", {
          message: `Sync complete. Uploaded: ${result.uploaded.length}, Skipped: ${result.skipped.length}, Deleted: ${result.deleted.length}, Errors: ${result.errors.length}${errorDetails}`,
          uploaded: result.uploaded.length,
          skipped: result.skipped.length,
          deleted: result.deleted.length,
          errors: result.errors.length,
          errorDetails: result.errors,
          ragSetting: settings.ragSettings[settingName],
        });
      } catch (error) {
        sendEvent("error", {
          message:
            error instanceof Error ? error.message : "Sync failed",
        });
      } finally {
        try { controller.close(); } catch { /* already closed by abort */ }
      }
    },
  });

  const headers = new Headers({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  if (setCookieHeader) headers.set("Set-Cookie", setCookieHeader);

  return new Response(stream, { status: 200, headers });
}
