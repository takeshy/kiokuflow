# Firestore collection-group indexes required by the organization (Business)
# features. Each of these queries reaches across every parent document, and
# Firestore rejects such a query with FAILED_PRECONDITION unless the field
# carries an explicit COLLECTION_GROUP index.
#
#   members.uid    listOrganizationsForUser / listProjectsForUser — "which
#                  workspaces does this user belong to?" (org member docs live
#                  at organizations/{org}/members/{uid}, project member docs at
#                  organizations/{org}/projects/{project}/members/{uid}).
#   invites.token  findInviteByToken — /invite/:token resolves a token without
#                  knowing the parent organization.
#   projects.id    findOrgIdForProject — the fallback scan used when the
#                  session carries no current org.
#
# The database itself is NOT managed here: self-hosted installs may run without
# Firestore at all, and existing deployments already own their database.
locals {
  firestore_collection_group_fields = {
    members_uid   = { collection = "members", field = "uid" }
    invites_token = { collection = "invites", field = "token" }
    projects_id   = { collection = "projects", field = "id" }
  }
}

resource "google_firestore_field" "collection_group" {
  for_each = var.manage_firestore_indexes ? local.firestore_collection_group_fields : {}

  project    = var.project_id
  database   = var.firestore_database_id
  collection = each.value.collection
  field      = each.value.field

  # Both scopes: COLLECTION keeps the ordinary single-field index that
  # Firestore creates by default, COLLECTION_GROUP is what these queries need.
  index_config {
    indexes {
      order       = "ASCENDING"
      query_scope = "COLLECTION"
    }
    indexes {
      order       = "ASCENDING"
      query_scope = "COLLECTION_GROUP"
    }
  }

  depends_on = [google_project_service.apis]
}

# Shared index for paid personal RAG and tenant RAG. Provider/model/chunking
# configurations are isolated by settingName; projectId isolates workspaces.
resource "google_firestore_index" "rag_chunks" {
  count       = var.manage_firestore_indexes ? 1 : 0
  project     = var.project_id
  database    = var.firestore_database_id
  collection  = "ragChunks"
  query_scope = "COLLECTION"

  fields {
    field_path = "orgId"
    order      = "ASCENDING"
  }
  fields {
    field_path = "projectId"
    order      = "ASCENDING"
  }
  fields {
    field_path = "settingName"
    order      = "ASCENDING"
  }
  fields {
    field_path = "__name__"
    order      = "ASCENDING"
  }
  fields {
    field_path = "embedding"
    vector_config {
      dimension = 2048
      flat {}
    }
  }

  depends_on = [google_project_service.apis]
}
