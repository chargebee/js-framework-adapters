variable "aws_profile" {
  description = "Named AWS profile (from ~/.aws/credentials or ~/.aws/config) to authenticate with."
  type        = string
}

variable "region" {
  description = "AWS region of the existing infrastructure."
  type        = string
  default     = "us-east-1"
}

variable "bench_image_tag" {
  description = "ECR tag of the benchmark image."
  type        = string
  default     = "latest"
}

variable "name_prefix" {
  description = "Prefix for the resources this stack creates, e.g. \"acme\" gives \"acme-entitlements-bench\"."
  type        = string
}

# --- Existing infrastructure the benchmark runs against ----------------------

variable "cluster_name" {
  description = "Name of the existing ECS cluster the one-off tasks run in."
  type        = string
}

variable "service_name" {
  description = "Existing ECS service in the cluster whose network configuration (subnets, security groups, public IP) the one-off tasks borrow. Its security group must be allowed to reach Redis and Postgres."
  type        = string
}

variable "redis_cluster_id" {
  description = "ID of the existing single-node ElastiCache Redis cluster to benchmark."
  type        = string
}

variable "redis_database" {
  description = "Redis database index the benchmark uses. The run flushes it, so it must not hold data you care about; most apps use 0."
  type        = number
  default     = 1
}

variable "db_instance_identifier" {
  description = "Identifier of the existing RDS Postgres instance. The benchmark gets its own database and user on it."
  type        = string
}

variable "db_secret_name" {
  description = "Name of the Secrets Manager secret holding the instance's master credentials as JSON with the keys host, port, username, password and dbname. Only the db-setup task reads it."
  type        = string
}

# --- Benchmark ---------------------------------------------------------------

variable "chargebee_mode" {
  description = "Chargebee backend for the benchmark: the built-in mock, or a live test site whose credentials live in the <name_prefix>-entitlements-bench-chargebee secret."
  type        = string
  default     = "mock"

  validation {
    condition     = contains(["mock", "live"], var.chargebee_mode)
    error_message = "chargebee_mode must be either \"mock\" or \"live\"."
  }
}

variable "bench_cpu" {
  description = "Fargate CPU units for the benchmark task."
  type        = number
  default     = 1024
}

variable "bench_memory" {
  description = "Fargate memory (MiB) for the benchmark task."
  type        = number
  default     = 2048
}
