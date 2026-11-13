import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Firestore } from "@google-cloud/firestore";
import { isLocalRuntime } from "./app-runtime.server";

let _firestore: Firestore | null = null;
let _available: boolean | null = null;

/**
 * Whether Google Cloud Application Default Credentials are plausibly
 * available in hosted mode. Local mode always returns false, even with ADC.
 * On Cloud Run (`K_SERVICE`) credentials come from the metadata
 * server; shared VM containers use an explicitly configured metadata broker
 * (`GCE_METADATA_HOST` / `GCE_METADATA_IP`). Other environments require
 * explicit hosted mode plus `GOOGLE_APPLICATION_CREDENTIALS` or a gcloud ADC
 * file. Without this guard, calls in credential-less hosted environments pay a failed
 * metadata-server lookup and surfaces a noisy NO_ADC_FOUND error, so
 * Hubwork features check this and disable themselves instead.
 */
export function isFirestoreAvailable(): boolean {
  if (isLocalRuntime()) return false;
  if (_available === null) {
    const gcloudConfigDir =
      process.env.CLOUDSDK_CONFIG ??
      (process.env.APPDATA
        ? join(process.env.APPDATA, "gcloud")
        : join(homedir(), ".config", "gcloud"));
    // Only actual credential sources count. Config-only vars like
    // FIRESTORE_DATABASE_ID / GOOGLE_CLOUD_PROJECT must NOT enable this:
    // they are often present in a local .env copied from production while
    // the machine still has no credentials, and constructing Firestore then
    // crashes the process (background NO_ADC_FOUND).
    _available = Boolean(
      process.env.K_SERVICE || // Cloud Run (metadata-server credentials)
        process.env.GCE_METADATA_HOST || // Shared VM metadata broker
        process.env.GCE_METADATA_IP || // Metadata endpoint override
        process.env.GOOGLE_APPLICATION_CREDENTIALS ||
        existsSync(join(gcloudConfigDir, "application_default_credentials.json")),
    );
  }
  return _available;
}

export function getFirestore(): Firestore {
  if (isLocalRuntime()) throw new Error("Firestore is disabled in local mode.");
  if (!_firestore) {
    if (!isFirestoreAvailable()) {
      throw new Error(
        "Firestore is not available: no Google Cloud credentials found (Hubwork features require a Google Cloud metadata endpoint or Application Default Credentials).",
      );
    }
    const projectId = process.env.GCP_PROJECT_ID;
    const databaseId = process.env.FIRESTORE_DATABASE_ID;
    _firestore = new Firestore({
      ...(projectId ? { projectId } : {}),
      ...(databaseId ? { databaseId } : {}),
    });
  }
  return _firestore;
}

// Collection names — Hubwork (publishing platform accounts)
export const HUBWORK_ACCOUNTS = "hubwork-accounts";
export const DRIVE_OAUTH_MIGRATIONS = "drive-oauth-migrations";
export const HUBWORK_MAGIC_TOKENS = "hubwork-magic-tokens";
export const HUBWORK_FORM_SUBMISSIONS = "hubwork-form-submissions";
export const HUBWORK_PENDING_REGISTRATIONS = "hubwork-pending-registrations";

// Collection names — organizations control plane (multi-tenant orgs/projects)
export const ORGANIZATIONS = "organizations";
/** Service-wide settings owned by the service administrator, not by any org. */
export const SERVICE_CONFIG = "service-config";
export const USERS = "users";
export const PROJECTS_SUBCOLLECTION = "projects";
export const MEMBERS_SUBCOLLECTION = "members";
