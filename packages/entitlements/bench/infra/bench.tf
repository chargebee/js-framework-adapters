# One-off entitlements benchmark task, run in an existing ECS cluster.
#
# Run with:
#   ./scripts/bench.sh
# or via the AWS console: ECS -> <cluster> -> Tasks -> Run new task.
#
# The task runs against the existing ElastiCache Redis and RDS Postgres. It
# borrows the network config of an existing ECS service at run time (see
# scripts/lib.sh), which must already be allowed to reach both.
#
#   bench task ──► Redis     (database var.redis_database)
#              └─► Postgres  (isolated entitlements_bench database, see db.tf)

data "aws_ecs_cluster" "app" {
  cluster_name = var.cluster_name
}

# Fails the plan early if the service the tasks borrow their network from is gone.
data "aws_ecs_service" "network" {
  cluster_arn  = data.aws_ecs_cluster.app.arn
  service_name = var.service_name
}

data "aws_elasticache_cluster" "app" {
  cluster_id = var.redis_cluster_id
}

resource "aws_cloudwatch_log_group" "bench" {
  name              = "/ecs/${local.bench_name}"
  retention_in_days = 14
}

resource "aws_ecs_task_definition" "bench" {
  family                   = local.bench_name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.bench_cpu)
  memory                   = tostring(var.bench_memory)
  execution_role_arn       = aws_iam_role.execution.arn

  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    {
      name      = local.bench_name
      image     = "${aws_ecr_repository.bench.repository_url}:${var.bench_image_tag}"
      essential = true

      environment = local.bench_env
      secrets     = local.bench_secrets

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.bench.name
          awslogs-region        = var.region
          awslogs-stream-prefix = "ecs"
        }
      }
    }
  ])
}
