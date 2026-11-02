shared_vm_backends = {
  "gemihub" : "https://www.googleapis.com/compute/v1/projects/geminihub-486523/global/backendServices/shared-apps-gemihub",
  "kakeratta" : "https://www.googleapis.com/compute/v1/projects/geminihub-486523/global/backendServices/shared-apps-kakeratta",
  "geo" : "https://www.googleapis.com/compute/v1/projects/geminihub-486523/global/backendServices/shared-apps-geo",
  "gemihub-web" : "https://www.googleapis.com/compute/v1/projects/geminihub-486523/global/backendServices/shared-apps-gemihub-web"
}

shared_vm_hosts = {
  "gemihub-web" = ["gemihub.net", "*.shops.gemihub.net"]
}
