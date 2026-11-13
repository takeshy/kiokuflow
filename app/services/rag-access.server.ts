import { isFirestoreAvailable } from "./firestore.server";
import { getAccountByRootFolderId, getAccountByOrganization } from "./hubwork-accounts.server";
import { isActivePremiumAccount } from "~/types/hubwork";
import { isLocalRuntime } from "./app-runtime.server";

const accessDeps = { isFirestoreAvailable, getAccountByRootFolderId, getAccountByOrganization, isLocalRuntime };
export async function assertRagAccess(rootFolderId: string, orgId?: string, deps: Omit<typeof accessDeps, "isLocalRuntime"> & { isLocalRuntime?: () => boolean } = accessDeps): Promise<void> {
  if (deps.isLocalRuntime?.()) {
    if (orgId) throw new Response("Organization RAG is unavailable in local mode.", { status: 503 });
    if (!rootFolderId) throw new Response("A personal Drive workspace is required for RAG.", { status: 400 });
    return;
  }
  if (!deps.isFirestoreAvailable()) throw new Response("RAG requires Firestore configuration.", { status: 503 });
  const account = orgId
    ? await deps.getAccountByOrganization(orgId, { bypassCache: true })
    : await deps.getAccountByRootFolderId(rootFolderId);
  if (!account || !isActivePremiumAccount(account)) throw new Response("RAG requires an active paid kiokuflow plan.", { status: 403 });
}
export async function canUseRag(rootFolderId: string, orgId?: string): Promise<boolean> {
  try { await assertRagAccess(rootFolderId, orgId); return true; } catch { return false; }
}
