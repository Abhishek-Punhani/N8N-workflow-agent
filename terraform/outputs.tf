output "instance_ip" {
  description = "The public IP address of the deployed instance"
  value       = google_compute_address.static_ip.address
}

output "instance_name" {
  description = "The name of the deployed instance"
  value       = google_compute_instance.app_instance.name
}

output "app_url" {
  description = "The URL to access the deployed application"
  value       = var.domain_name != "" ? "https://${var.domain_name}" : "http://${google_compute_address.static_ip.address}:8080"
}
