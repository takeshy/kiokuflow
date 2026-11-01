locals {
  original_app_domain = coalesce(var.legacy_app_domain, var.domain)
  add_rebrand_domain  = var.legacy_app_domain != null && local.original_app_domain != var.domain
  manage_rebrand_dns  = var.manage_dns && var.manage_rebrand_dns && local.add_rebrand_domain
}

# New resources: retain the original primary_* zone/certs and add kiokuflow.
resource "google_dns_managed_zone" "kiokuflow" {
  count       = local.manage_rebrand_dns ? 1 : 0
  name        = "${replace(var.domain, ".", "-")}-app"
  dns_name    = "${var.domain}."
  description = "kiokuflow primary domain"
  depends_on  = [google_project_service.apis]
}

resource "google_dns_record_set" "kiokuflow_a" {
  for_each     = local.manage_rebrand_dns ? toset([var.domain, "*.${var.domain}"]) : toset([])
  name         = "${each.value}."
  type         = "A"
  ttl          = 300
  managed_zone = google_dns_managed_zone.kiokuflow[0].name
  rrdatas      = [google_compute_global_address.default.address]
}

resource "google_certificate_manager_dns_authorization" "kiokuflow" {
  count      = local.add_rebrand_domain ? 1 : 0
  name       = "${replace(var.domain, ".", "-")}-dns-auth"
  domain     = var.domain
  depends_on = [google_project_service.apis]
}

resource "google_dns_record_set" "kiokuflow_cert_validation" {
  count        = local.manage_rebrand_dns ? 1 : 0
  name         = google_certificate_manager_dns_authorization.kiokuflow[0].dns_resource_record[0].name
  type         = google_certificate_manager_dns_authorization.kiokuflow[0].dns_resource_record[0].type
  ttl          = 300
  managed_zone = google_dns_managed_zone.kiokuflow[0].name
  rrdatas      = [google_certificate_manager_dns_authorization.kiokuflow[0].dns_resource_record[0].data]
}

resource "google_certificate_manager_certificate" "kiokuflow" {
  for_each = local.add_rebrand_domain ? { main = var.domain, wildcard = "*.${var.domain}" } : {}
  name     = "${replace(var.domain, ".", "-")}-${each.key}-cert"
  managed {
    domains            = [each.value]
    dns_authorizations = [google_certificate_manager_dns_authorization.kiokuflow[0].id]
  }
  lifecycle {
    create_before_destroy = true
  }
  depends_on = [google_project_service.apis]
}

resource "google_certificate_manager_certificate_map_entry" "kiokuflow" {
  for_each     = google_certificate_manager_certificate.kiokuflow
  name         = "${replace(var.domain, ".", "-")}-${each.key}-entry"
  map          = google_certificate_manager_certificate_map.default.name
  hostname     = each.key == "main" ? var.domain : "*.${var.domain}"
  certificates = [each.value.id]
}

resource "google_dns_record_set" "kiokuflow_txt_verification" {
  count        = local.manage_rebrand_dns && var.rebrand_site_verification_token != "" ? 1 : 0
  name         = "${var.domain}."
  type         = "TXT"
  ttl          = 300
  managed_zone = google_dns_managed_zone.kiokuflow[0].name
  rrdatas      = ["\"google-site-verification=${var.rebrand_site_verification_token}\""]
}
