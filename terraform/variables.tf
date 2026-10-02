variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region"
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "GCP Zone"
  type        = string
  default     = "us-central1-a"
}

variable "instance_name" {
  description = "Name of the compute instance"
  type        = string
  default     = "n8n-agent-platform"
}

variable "machine_type" {
  description = "Machine type for the instance"
  type        = string
  default     = "e2-medium"
}

variable "github_username" {
  description = "GitHub username for cloning the repository"
  type        = string
}

variable "github_token" {
  description = "GitHub Personal Access Token (PAT)"
  type        = string
  sensitive   = true
}

variable "repo_url" {
  description = "URL of the N8N-Agent repository"
  type        = string
  default     = "https://github.com/Abhishek-Punhani/N8N-workflow-agent.git"
}

variable "branch_name" {
  description = "Branch to deploy"
  type        = string
  default     = "master"
}

variable "domain_name" {
  description = "Domain name for SSL configuration (e.g. platform.example.com). Leave empty to disable SSL."
  type        = string
  default     = ""
}

variable "admin_email" {
  description = "Email address for Let's Encrypt registration"
  type        = string
  default     = "admin@example.com"
}
