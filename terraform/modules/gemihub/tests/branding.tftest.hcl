mock_provider "google" {}

variables {
  project_id            = "test-project"
  project_number        = "123456789"
  domain                = "kiokuflow.net"
  legacy_app_domain     = "gemihub.net"
  manage_bigquery_views = false
  shared_vm_backends    = { gemihub = "https://example.invalid/backend/gemihub", kakeratta = "https://example.invalid/backend/kakeratta" }
}

run "add_domain_without_replacing_legacy_identity" {
  command = plan
  assert {
    condition     = google_dns_managed_zone.primary[0].dns_name == "gemihub.net." && google_dns_managed_zone.kiokuflow[0].dns_name == "kiokuflow.net."
    error_message = "Keep the original zone and add the new brand zone."
  }
  assert {
    condition     = google_certificate_manager_certificate_map_entry.primary_main.hostname == "gemihub.net" && google_certificate_manager_certificate_map_entry.primary_wildcard.hostname == "*.gemihub.net"
    error_message = "Existing certificates must keep their original hosts."
  }
  assert {
    condition     = google_certificate_manager_certificate_map_entry.kiokuflow["main"].hostname == "kiokuflow.net" && google_certificate_manager_certificate_map_entry.kiokuflow["wildcard"].hostname == "*.kiokuflow.net"
    error_message = "Add both new apex and hosted-site certificates."
  }
  assert {
    condition     = google_dns_record_set.kiokuflow_a["kiokuflow.net"].name == "kiokuflow.net." && google_dns_record_set.kiokuflow_a["*.kiokuflow.net"].name == "*.kiokuflow.net."
    error_message = "Add apex and wildcard DNS records."
  }
  assert {
    condition     = google_compute_url_map.https.default_service == "https://example.invalid/backend/gemihub" && length(google_compute_url_map.https.host_rule) == 1
    error_message = "Preserve shared-VM routing and other applications."
  }
}

run "fresh_install_uses_primary_domain_only" {
  command = plan
  variables { legacy_app_domain = null }
  assert {
    condition     = google_dns_managed_zone.primary[0].dns_name == "kiokuflow.net." && length(google_dns_managed_zone.kiokuflow) == 0 && length(google_certificate_manager_certificate.kiokuflow) == 0
    error_message = "Fresh installations must not require an old-domain zone."
  }
}

run "cloudflare_keeps_legacy_dns_and_adds_certificates_only" {
  command = plan
  variables { manage_rebrand_dns = false }
  assert {
    condition     = google_dns_managed_zone.primary[0].dns_name == "gemihub.net." && length(google_dns_managed_zone.kiokuflow) == 0 && length(google_dns_record_set.kiokuflow_a) == 0 && length(google_dns_record_set.kiokuflow_cert_validation) == 0
    error_message = "External new-domain DNS must preserve the old Cloud DNS zone without creating a non-authoritative new zone or records."
  }
  assert {
    condition     = length(google_certificate_manager_certificate.kiokuflow) == 2 && length(google_certificate_manager_certificate_map_entry.kiokuflow) == 2 && length(google_certificate_manager_dns_authorization.kiokuflow) == 1
    error_message = "Cloudflare DNS must still receive both apex/wildcard certificates and their DNS authorization."
  }
  assert {
    condition     = length(output.nameservers) == 0 && google_certificate_manager_certificate_map_entry.primary_main.hostname == "gemihub.net"
    error_message = "Do not instruct Cloudflare Registrar users to change nameservers or replace old certificates."
  }
}
