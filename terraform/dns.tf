# A record pointing the domain to the GCP static IP
resource "cloudflare_record" "dashboard_domain" {
  count           = var.domain_name != "" && var.cloudflare_zone_id != "" ? 1 : 0
  zone_id         = var.cloudflare_zone_id
  name            = var.domain_name
  content         = google_compute_address.static_ip.address
  type            = "A"
  proxied         = true
  allow_overwrite = true
}
