# Service identity. Infrastructure resource names and deployment identity remain
# stable so rebranding does not replace the existing VM, buckets or databases.
domain            = "kiokuflow.net"
legacy_app_domain = "gemihub.net"

# kiokuflow.net was purchased with Cloudflare Registrar: keep Cloudflare DNS.
# This setting does not disable the original gemihub.net Cloud DNS resources.
manage_rebrand_dns = false
