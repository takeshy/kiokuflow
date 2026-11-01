/**
 * POST /api/members/invite
 *
 * Body: { orgId, email, role: "admin"|"member", expiryDays? }
 *
 * Authorization: organization administrators only. The legacy "owner" role
 * is accepted for callers as an administrator during data migration.
 *
 * Side effect: persists a pending invite to organizations/{orgId}/invites/
 * and returns a shareable invitation URL. No mail is sent.
 *
 * Response: { invite: OrgInvite, inviteUrl }
 */

import type { Route } from "./+types/api.members.invite";
import {
  ProjectAccessError,
  requireOrgAccess,
} from "~/services/project-acl.server";
import { createInvite } from "~/services/invites.server";
import { inviteUrlFor } from "~/services/notify.server";
import type { OrgRole } from "~/types/enterprise";

const ORG_ROLES: ReadonlySet<string> = new Set(["admin", "member"]);

interface InviteBody {
  orgId?: unknown;
  email?: unknown;
  role?: unknown;
  expiryDays?: unknown;
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const body = (await request.json().catch(() => null)) as InviteBody | null;
  if (
    !body ||
    typeof body.orgId !== "string" ||
    typeof body.email !== "string" ||
    typeof body.role !== "string" ||
    !ORG_ROLES.has(body.role)
  ) {
    return Response.json(
      { error: "missing or invalid orgId / email / role" },
      { status: 400 },
    );
  }

  let access;
  try {
    access = await requireOrgAccess(request, body.orgId);
  } catch (err) {
    if (err instanceof ProjectAccessError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
  if (access.role !== "owner" && access.role !== "admin") {
    return Response.json(
      { error: "only organization administrators can invite members" },
      { status: 403 },
    );
  }
  const expiryDays =
    typeof body.expiryDays === "number" && body.expiryDays > 0
      ? Math.min(90, Math.floor(body.expiryDays))
      : undefined;

  const invite = await createInvite({
    orgId: body.orgId,
    email: body.email,
    role: body.role as OrgRole,
    invitedByUid: access.uid,
    invitedByEmail: access.email,
    expiryDays,
  });

  const inviteUrl = inviteUrlFor(request, invite.token);
  return Response.json({ invite, inviteUrl, emailSent: false });
}
