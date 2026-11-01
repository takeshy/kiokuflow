import { embeddingConfig } from "~/services/rag-config";
import type { WorkflowNode, ExecutionContext, ServiceContext } from "../types";
import { replaceVariables } from "./utils";
import * as driveService from "~/services/google-drive.server";
import { uploadDriveFile, getOrCreateStore } from "~/services/rag-index.server";
import { DEFAULT_RAG_SETTING } from "~/types/settings";
import { saveSettings } from "~/services/user-settings.server";

// Handle rag-sync node - sync a Drive file to a RAG store
export async function handleRagSyncNode(
  node: WorkflowNode,
  context: ExecutionContext,
  serviceContext: ServiceContext
): Promise<void> {
  const path = replaceVariables(node.properties["path"] || "", context);
  const ragSettingName = replaceVariables(node.properties["ragSetting"] || "", context);
  const saveTo = node.properties["saveTo"];

  if (!path) throw new Error("rag-sync node missing 'path' property");
  if (!ragSettingName) throw new Error("rag-sync node missing 'ragSetting' property");

  const setting = serviceContext.settings?.ragSettings[ragSettingName];
  const config = embeddingConfig(setting || {});
  const apiKey = config.provider === "openai" ? serviceContext.openaiApiKey : serviceContext.geminiApiKey;
  if (!apiKey) throw new Error(`Unlock the ${config.provider} API key to index this file.`);

  const accessToken = serviceContext.driveAccessToken;
  const folderId = serviceContext.driveRootFolderId;

  // Find the file on Drive
  const files = await driveService.searchFiles(accessToken, folderId, path, false, {
    signal: serviceContext.abortSignal,
  });
  let file = files.find(f => f.name === path || f.name === `${path}.md`);
  if (!file) {
    file = await driveService.findFileByExactName(accessToken, path, folderId, {
      signal: serviceContext.abortSignal,
    }) ?? undefined;
    if (!file && !path.endsWith(".md")) {
      file = await driveService.findFileByExactName(accessToken, `${path}.md`, folderId, {
        signal: serviceContext.abortSignal,
      }) ?? undefined;
    }
  }
  if (!file) throw new Error(`File not found on Drive: ${path}`);

  // Get or create the RAG store
  const storeName = await getOrCreateStore(apiKey, ragSettingName, {
    signal: serviceContext.abortSignal, rootFolderId: folderId, setting,
  });

  // Update in-memory settings so subsequent command nodes can find the store ID
  if (serviceContext.settings) {
    if (!serviceContext.settings.ragSettings) {
      serviceContext.settings.ragSettings = {};
    }
    if (!serviceContext.settings.ragSettings[ragSettingName]) {
      serviceContext.settings.ragSettings[ragSettingName] = { ...DEFAULT_RAG_SETTING };
    }
    const rs = serviceContext.settings.ragSettings[ragSettingName];
    // Same switch-over as settings/push: retire the old index so its chunks are
    // cleaned up on the next full sync, and drop checksums that belong to it.
    if (rs.storeName !== storeName) {
      if (rs.storeName?.startsWith("ragv1:")) rs.retiredIndexes = [...new Set([...(rs.retiredIndexes || []), rs.storeName])];
      rs.storeName = storeName;
      rs.storeId = storeName;
      rs.embeddingModel = config.model;
      rs.embeddingProvider = config.provider;
      rs.files = {};
      await saveSettings(accessToken, folderId, serviceContext.settings);
    }
  }

  // Upload the file to the RAG store
  const fileId = await uploadDriveFile(
    apiKey,
    accessToken,
    file.id,
    file.name,
    storeName,
    { signal: serviceContext.abortSignal, rootFolderId: folderId, secretManagerFolder: serviceContext.settings?.secretManagerFolder }
  );

  const result = {
    path,
    ragSetting: ragSettingName,
    fileId: fileId || file.id,
    storeName,
    mode: "upload",
    syncedAt: new Date().toISOString(),
  };

  if (saveTo) {
    context.variables.set(saveTo, JSON.stringify(result));
  }
}
