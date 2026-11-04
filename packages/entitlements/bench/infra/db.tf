# Isolated benchmark database on the existing RDS instance.
#
# RDS is private, so Terraform can't create the database itself. Instead it
# provisions the credentials and a one-off task that creates the database and
# its owner using the instance's master credentials:
#
#   ./scripts/db-setup.sh      (re-runnable; also rotates the password)
#
#   db-setup task ──► RDS: CREATE ROLE + CREATE DATABASE entitlements_bench
#   bench task ─────► RDS: entitlements_bench, as entitlements_bench only

data "aws_db_instance" "app" {
  db_instance_identifier = var.db_instance_identifier
}

data "aws_secretsmanager_secret" "db" {
  name = var.db_secret_name
}

resource "random_password" "bench_db" {
  length = 32
  # Alphanumeric keeps the generated connection URL free of escaping issues.
  special = false
}

resource "aws_secretsmanager_secret" "bench_db" {
  name                    = "${local.bench_name}-db-credentials"
  description             = "Credentials for the isolated entitlements benchmark database"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "bench_db" {
  secret_id = aws_secretsmanager_secret.bench_db.id
  secret_string = jsonencode({
    username     = local.bench_db_user
    password     = random_password.bench_db.result
    host         = data.aws_db_instance.app.address
    port         = data.aws_db_instance.app.port
    dbname       = local.bench_db_name
    database_url = "postgresql://${local.bench_db_user}:${random_password.bench_db.result}@${data.aws_db_instance.app.address}:${data.aws_db_instance.app.port}/${local.bench_db_name}?uselibpqcompat=true&sslmode=require"
  })
}

resource "aws_cloudwatch_log_group" "db_setup" {
  name              = "/ecs/${local.bench_name}-db-setup"
  retention_in_days = 14
}

resource "aws_ecs_task_definition" "db_setup" {
  family                   = "${local.bench_name}-db-setup"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.db_setup_execution.arn

  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    {
      name      = "${local.bench_name}-db-setup"
      image     = "postgres:17-alpine"
      essential = true

      # The SQL travels in an env var, so the task needs no custom image.
      command = [
        "sh", "-c",
        "printf '%s' \"$SETUP_SQL\" | psql -v ON_ERROR_STOP=1 -v user=\"$BENCH_DB_USER\" -v db=\"$BENCH_DB_NAME\" -v pw=\"$BENCH_DB_PASSWORD\"",
      ]

      environment = [
        { name = "SETUP_SQL", value = file("${path.module}/scripts/db-setup.sql") },
        { name = "BENCH_DB_USER", value = local.bench_db_user },
        { name = "BENCH_DB_NAME", value = local.bench_db_name },
        { name = "PGSSLMODE", value = "require" },
      ]

      # libpq reads the master connection from the PG* variables.
      secrets = [
        { name = "PGHOST", valueFrom = "${data.aws_secretsmanager_secret.db.arn}:host::" },
        { name = "PGPORT", valueFrom = "${data.aws_secretsmanager_secret.db.arn}:port::" },
        { name = "PGUSER", valueFrom = "${data.aws_secretsmanager_secret.db.arn}:username::" },
        { name = "PGPASSWORD", valueFrom = "${data.aws_secretsmanager_secret.db.arn}:password::" },
        { name = "PGDATABASE", valueFrom = "${data.aws_secretsmanager_secret.db.arn}:dbname::" },
        { name = "BENCH_DB_PASSWORD", valueFrom = "${aws_secretsmanager_secret.bench_db.arn}:password::" },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.db_setup.name
          awslogs-region        = var.region
          awslogs-stream-prefix = "ecs"
        }
      }
    }
  ])
}
