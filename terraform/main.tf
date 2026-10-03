
resource "google_compute_network" "vpc_network" {
  name = "n8n-agent-network"
}

resource "google_compute_firewall" "allow_web" {
  name    = "n8n-agent-allow-web"
  network = google_compute_network.vpc_network.name

  allow {
    protocol = "tcp"
    ports    = ["80", "443", "8080"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["web-server"]
}

resource "google_compute_firewall" "allow_ssh" {
  name    = "n8n-agent-allow-ssh"
  network = google_compute_network.vpc_network.name

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["web-server"]
}

resource "google_compute_address" "static_ip" {
  name = "n8n-agent-static-ip"
}

resource "google_compute_instance" "app_instance" {
  name         = var.instance_name
  machine_type = var.machine_type
  zone         = var.zone

  tags = ["web-server"]

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = 30 # GB
      type  = "pd-ssd"
    }
  }

  network_interface {
    network = google_compute_network.vpc_network.name
    access_config {
      nat_ip = google_compute_address.static_ip.address
    }
  }

  metadata_startup_script = templatefile("${path.module}/startup.sh", {
    repo_url        = var.repo_url
    branch_name     = var.branch_name
    github_username = var.github_username
    github_token    = var.github_token
    domain_name     = var.domain_name
    admin_email     = var.admin_email
    # Note: For production, you should use Secret Manager for .env, 
    # but we are using file interpolation here to match the Technex setup.
    env_content     = fileexists("${path.module}/.env.production") ? file("${path.module}/.env.production") : ""
  })

  service_account {
    scopes = ["cloud-platform"]
  }
}
