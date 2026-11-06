output "region" {
  description = "AWS region of the stack (read by scripts/lib.sh)."
  value       = var.region
}

output "cluster_name" {
  description = "ECS cluster the one-off tasks run in (read by scripts/lib.sh)."
  value       = var.cluster_name
}

output "network_service_name" {
  description = "ECS service whose network configuration the one-off tasks borrow (read by scripts/lib.sh)."
  value       = data.aws_ecs_service.network.service_name
}

output "ecr_repository_url" {
  description = "ECR repository URL to push the benchmark image to (tag :latest)."
  value       = aws_ecr_repository.bench.repository_url
}

output "bench_task_family" {
  description = "ECS task definition family run as a one-off task (see scripts/bench.sh)."
  value       = aws_ecs_task_definition.bench.family
}

output "db_setup_task_family" {
  description = "ECS task definition family that creates the benchmark database (see scripts/db-setup.sh)."
  value       = aws_ecs_task_definition.db_setup.family
}

output "bench_db_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the benchmark database credentials."
  value       = aws_secretsmanager_secret.bench_db.arn
}

output "bench_log_group" {
  description = "CloudWatch log group receiving the benchmark output."
  value       = aws_cloudwatch_log_group.bench.name
}

output "db_setup_log_group" {
  description = "CloudWatch log group receiving the db-setup output."
  value       = aws_cloudwatch_log_group.db_setup.name
}
