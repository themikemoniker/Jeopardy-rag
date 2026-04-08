variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Name prefix for all resources"
  type        = string
  default     = "jeopardy-rag"
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t3.small"
}

variable "data_volume_size" {
  description = "Size in GB for the EBS data volume (SQLite DB)"
  type        = number
  default     = 20
}

variable "app_port" {
  description = "Port the application listens on"
  type        = number
  default     = 3000
}

variable "ssh_allowed_cidr" {
  description = "CIDR block allowed to SSH (set to your IP/32 for security)"
  type        = string
  default     = "0.0.0.0/0"
}

variable "anthropic_api_key" {
  description = "Anthropic API key (stored in SSM Parameter Store)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "ssh_public_key" {
  description = "SSH public key for EC2 access"
  type        = string
}

variable "docker_image" {
  description = "Docker image to deploy (e.g. ghcr.io/user/jeopardy-rag:latest or built locally)"
  type        = string
  default     = ""
}

variable "domain_name" {
  description = "Optional domain name for the ALB (leave empty to skip)"
  type        = string
  default     = ""
}
