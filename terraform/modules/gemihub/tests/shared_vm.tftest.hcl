mock_provider "google" {}

variables {
  project_id     = "example-project"
  project_number = "123456789"
  domain         = "gemihub.example.com"
  shared_vm_backends = {
    gemihub   = "https://www.googleapis.com/compute/v1/projects/example-project/global/backendServices/shared-apps-gemihub"
    kakeratta = "https://www.googleapis.com/compute/v1/projects/example-project/global/backendServices/shared-apps-kakeratta"
    geo       = "https://www.googleapis.com/compute/v1/projects/example-project/global/backendServices/shared-apps-geo"
    omaiweb   = "https://www.googleapis.com/compute/v1/projects/example-project/global/backendServices/shared-apps-omaiweb"
  }
  shared_vm_hosts = { omaiweb = ["omaiweb.example.com", "*.shops.omaiweb.example.com"] }
}

run "explicit_additional_hosts" {
  command = plan
  assert {
    condition     = one([for rule in google_compute_url_map.https.host_rule : rule.hosts if rule.path_matcher == "shared-omaiweb"]) == toset(["omaiweb.example.com", "*.shops.omaiweb.example.com"])
    error_message = "Additional app routes must use their own hostnames."
  }
  assert {
    condition     = one([for rule in google_compute_url_map.https.host_rule : rule.hosts if rule.path_matcher == "shared-kakeratta"]) == toset(["kakeratta.net", "www.kakeratta.net"])
    error_message = "Existing Kakeratta routing must be retained."
  }
}

run "missing_hosts_are_rejected" {
  command = plan
  variables { shared_vm_hosts = {} }
  expect_failures = [google_compute_url_map.https]
}
