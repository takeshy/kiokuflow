import type { Route } from "./+types/api.settings.migration";
import { getTokens } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { driveMigrationSummary, runDriveMigration } from "~/services/drive-migration.server";
import { validateOrigin } from "~/utils/security";

// A resource route keeps plain fetch() responses as JSON, without page rendering.
export async function action({ request }: Route.ActionArgs) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405, headers });
  }
  try {
    validateOrigin(request);
    const sessionTokens = await getTokens(request);
    if (!sessionTokens) return Response.json({ error: "Session expired" }, { status: 401, headers });
    const { tokens, setCookieHeader } = await getValidTokens(request, sessionTokens);
    if (setCookieHeader) headers.set("Set-Cookie", setCookieHeader);
    const intent = (await request.formData()).get("intent");
    if (typeof intent !== "string" || !["prepare", "step", "finish"].includes(intent)) throw new Error("Invalid migration action");
    await runDriveMigration(tokens, intent);
    return Response.json({ summary: await driveMigrationSummary(tokens) }, { headers });
  } catch (error) {
    if (error instanceof Response) {
      error.headers.set("Cache-Control", "no-store");
      return error;
    }
    return Response.json({ error: error instanceof Error ? error.message : "引き継ぎに失敗しました。" }, { status: 400, headers });
  }
}
