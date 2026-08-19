variable "aws_region" {
  description = "AWS region for all resources."
  type        = string
  default     = "ap-southeast-2"
}

variable "project_name" {
  description = "Short name used to prefix/tag all resources."
  type        = string
  default     = "flash-sale"
}

variable "environment" {
  description = "Deployment environment name, used in tags and resource names."
  type        = string
  default     = "production"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "availability_zone_count" {
  description = "Number of AZs to spread public/private subnets across."
  type        = number
  default     = 2
}

variable "api_container_image" {
  description = "ECR image URI:tag for the NestJS API. No default — a real deploy must pick a real, scanned image; there is no meaningful placeholder to default to."
  type        = string
}

variable "api_container_port" {
  description = "Port the NestJS API listens on inside the container."
  type        = number
  default     = 3000
}

variable "api_task_cpu" {
  description = "Fargate task vCPU units (256 = 0.25 vCPU)."
  type        = number
  default     = 512
}

variable "api_task_memory" {
  description = "Fargate task memory, MiB."
  type        = number
  default     = 1024
}

variable "api_desired_count" {
  description = "Baseline (pre-autoscaling) task count. 2+ for zero-downtime rolling deploys and AZ failure tolerance."
  type        = number
  default     = 2
}

variable "api_min_capacity" {
  description = "Autoscaling floor."
  type        = number
  default     = 2
}

variable "api_max_capacity" {
  description = "Autoscaling ceiling."
  type        = number
  default     = 10
}

# --- Autoscaling threshold, derived from the Phase 2 stress-test numbers ---
# server/test/stress/purchase-stress.ts measured ~1,184 req/s and p99 499ms
# for a single process at concurrency 300 against local Redis/Mongo — the
# ceiling for one task, under conditions harder than steady-state production
# traffic (thousands of requests racing on purpose). ALBRequestCountPerTarget
# is set to roughly a quarter of that measured ceiling, so ECS scales out
# well before any task approaches the point where the stress test showed
# latency climbing, leaving headroom for bursts and rolling deploys.
variable "api_requests_per_target" {
  description = "Target ALBRequestCountPerTarget for the API service's target-tracking autoscaling policy."
  type        = number
  default     = 300
}

variable "redis_node_type" {
  description = "ElastiCache node type."
  type        = string
  default     = "cache.t4g.small"
}

variable "documentdb_instance_class" {
  description = "DocumentDB instance class."
  type        = string
  default     = "db.t4g.medium"
}

variable "documentdb_instance_count" {
  description = "Number of DocumentDB instances (1 primary + replicas)."
  type        = number
  default     = 2
}

variable "documentdb_master_username" {
  description = "DocumentDB master username. The password is generated and stored in Secrets Manager, never set here."
  type        = string
  default     = "flashsale_admin"
}
