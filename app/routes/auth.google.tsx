import { redirect } from "react-router";
import type { Route } from "./+types/auth.google";
import { getAuthUrl } from "~/services/google-auth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const reqUrl = new URL(request.url);
  // Legacy re-consent links use the same Drive-only permissions.
  const hubworkEntry = reqUrl.searchParams.get("hubwork") === "1";
  const returnTo = reqUrl.searchParams.get("returnTo") || (hubworkEntry ? "/settings" : undefined);
  const { url, setCookieHeader } = await getAuthUrl(request, {
    returnTo,
  });
  return redirect(url, {
    headers: { "Set-Cookie": setCookieHeader },
  });
}
