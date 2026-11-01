output "load_balancer_ip" {
  description = "Global static IP address for DNS A record"
  value       = google_compute_global_address.default.address
}

output "cloud_run_url" {
  description = "Cloud Run service URL"
  value       = google_cloud_run_v2_service.app.uri
}

output "gemihub_okf_bucket" {
  description = "Private Cloud Storage bucket for managed kiokuflow OKF releases"
  value       = google_storage_bucket.gemihub_okf.name
}

output "tenant_data_bucket" {
  description = "Private Cloud Storage bucket for organization project data"
  value       = google_storage_bucket.tenant_data.name
}

output "nameservers" {
  description = "New-domain Cloud DNS nameservers, or empty when the new domain uses external DNS such as Cloudflare."
  value       = var.manage_dns ? (local.add_rebrand_domain ? (var.manage_rebrand_dns ? google_dns_managed_zone.kiokuflow[0].name_servers : []) : google_dns_managed_zone.primary[0].name_servers) : []
}

# Legacy domain nameservers (60-day 301 redirect window).

output "cloud_run_service_account_email" {
  description = "Cloud Run service account email"
  value       = google_service_account.cloud_run.email
}

output "legacy_nameservers" {
  description = "Nameservers of the retained original domain during migration."
  value       = var.manage_dns && local.add_rebrand_domain ? google_dns_managed_zone.primary[0].name_servers : []
}

output "rebrand_dns_authorization" {
  description = "Certificate Manager CNAME to publish at the authoritative DNS provider for the new domain; keep it for automatic certificate renewal."
  value       = local.add_rebrand_domain ? google_certificate_manager_dns_authorization.kiokuflow[0].dns_resource_record[0] : null
}
