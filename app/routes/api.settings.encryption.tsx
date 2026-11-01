import type { Route } from "./+types/api.settings.encryption";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings, saveSettings } from "~/services/user-settings.server";
import { verifyPassword } from "~/services/crypto.server";
import { configureCommonPassword } from "~/services/api-key-password.server";
import { validateOrigin } from "~/utils/security";


// ---------------------------------------------------------------------------
// POST -- Encryption key management
// ---------------------------------------------------------------------------

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  validateOrigin(request);
  const tokens = await requireAuth(request);
  if (!tokens.accessToken || !tokens.rootFolderId || tokens.currentProjectId) return Response.json({ error: "Select My Drive." }, { status: 403 });
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const responseHeaders = setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined;

  const body = await request.json();
  const { action: encAction, password } = body as {
    action: "generate" | "verify";
    password?: string;
  };

  const settings = await getSettings(
    validTokens.accessToken,
    validTokens.rootFolderId
  );

  switch (encAction) {
    // ------------------------------------------------------------------
    // Generate: create key pair, encrypt private key with password
    // ------------------------------------------------------------------
    case "generate": {
      if (!password) {
        return Response.json(
          { error: "Password is required" },
          { status: 400, headers: responseHeaders }
        );
      }

      if (password.length < 8) {
        return Response.json(
          { error: "Password must be at least 8 characters" },
          { status: 400, headers: responseHeaders }
        );
      }

      try {
        // Reuse the existing RSA key and validate every provider key; never reset
        // file encryption or introduce a second API-key password here.
        const common = await configureCommonPassword(settings, password);
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, common.settings);
        return Response.json({ success: true, publicKey: common.settings.encryption.publicKey, encryptedPrivateKey: common.settings.encryption.encryptedPrivateKey, salt: common.settings.encryption.salt }, { headers: responseHeaders });
      } catch (error) {
        return Response.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Key generation failed",
          },
          { status: 500, headers: responseHeaders }
        );
      }
    }

    // ------------------------------------------------------------------
    // Verify: check if password can decrypt the private key
    // ------------------------------------------------------------------
    case "verify": {
      if (!password) {
        return Response.json(
          { error: "Password is required" },
          { status: 400, headers: responseHeaders }
        );
      }

      if (
        !settings.encryption.encryptedPrivateKey ||
        !settings.encryption.salt
      ) {
        return Response.json(
          { error: "No encryption keys configured" },
          { status: 400, headers: responseHeaders }
        );
      }

      try {
        const isValid = await verifyPassword(
          settings.encryption.encryptedPrivateKey,
          settings.encryption.salt,
          password
        );

        return Response.json({ success: true, valid: isValid }, { headers: responseHeaders });
      } catch {
        return Response.json({ success: true, valid: false }, { headers: responseHeaders });
      }
    }

    default:
      return Response.json(
        { error: `Unknown action: ${encAction}` },
        { status: 400, headers: responseHeaders }
      );
  }
}
