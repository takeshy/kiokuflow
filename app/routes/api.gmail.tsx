/** Retired integration: retained so old clients fail clearly without using Google APIs. */
import type { Route } from "./+types/api.gmail";

export function action(_args: Route.ActionArgs) {
  return Response.json({ error: "Google Calendar and Gmail features are no longer available in kiokuflow." }, { status: 410 });
}
