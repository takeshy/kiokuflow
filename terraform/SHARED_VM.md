# Additional applications on the shared VM

The existing production Terraform state owns the shared URL map and HTTPS frontend. Application states must not import or recreate those resources.

`shared_vm_hosts` maps an additional backend name to its explicit hostnames, including wildcard storefront domains. Merge the new backend URL into `shared_vm_backends` and its hostnames into `shared_vm_hosts` in the existing production variables. Keep all existing GemiHub/Kakeratta/Geo entries. For example:

```hcl
# Merge these entries into the existing maps, rather than replacing the maps.
shared_vm_backends = {
  # ...existing entries...
  omaiweb = "https://www.googleapis.com/compute/v1/projects/geminihub-486523/global/backendServices/shared-apps-omaiweb"
}
shared_vm_hosts = {
  omaiweb = ["omaiweb.example.com", "*.shops.omaiweb.example.com"]
}
```

The module rejects additional backends without an explicit host mapping. Kakeratta and Geo retain their existing default hosts; GemiHub remains the default service for custom domains. The new application manages its DNS and certificates in its own state, and Kakeratta's shared VM module manages the instance group and additional backend. Verify the runtime/backend and certificate before applying the URL map update. This change defines routing capability; no additional production application is enabled by default.

Validation uses the existing private production variables and state for plan, and `terraform -chdir=terraform/modules/gemihub test` for mock host-routing tests. Mock tests do not deploy or verify public traffic.
