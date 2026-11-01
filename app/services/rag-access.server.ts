import { isFirestoreAvailable } from "./firestore.server";
import { getAccountByRootFolderId, getAccountByOrganization } from "./hubwork-accounts.server";
import { isActivePremiumAccount } from "~/types/hubwork";

const accessDeps = { isFirestoreAvailable, getAccountByRootFolderId, getAccountByOrganization };
export async function assertRagAccess(rootFolderId: string, orgId?: string, deps = accessDeps): Promise<void> {
  if (!deps.isFirestoreAvailable()) throw new Response("RAG requires Firestore configuration.", { status: 503 });
  const account = orgId
    ? await deps.getAccountByOrganization(orgId, { bypassCache: true })
    : await deps.getAccountByRootFolderId(rootFolderId);
  if (!account || !isActivePremiumAccount(account)) throw new Response("RAG requires an active paid GemiHub plan.", { status: 403 });
}
export async function canUseRag(rootFolderId: string, orgId?: string): Promise<boolean> {
  try { await assertRagAccess(rootFolderId, orgId); return true; } catch { return false; }
}
