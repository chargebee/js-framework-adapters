# Dedicated ECS execution roles, so nothing here touches existing roles.
#
#   bench execution role     ──► reads the bench db secret only
#   db-setup execution role  ──► reads the bench db secret + master DB secret
#
# The master credentials are reachable only by the db-setup task, never by the
# benchmark.

data "aws_iam_policy_document" "ecs_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# --- Benchmark task ---------------------------------------------------------

resource "aws_iam_role" "execution" {
  name               = "${local.bench_name}-ecs-execution-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = concat([aws_secretsmanager_secret.bench_db.arn], local.chargebee_secret_arns)
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "${local.bench_name}-ecs-execution-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

# --- db-setup task ----------------------------------------------------------

resource "aws_iam_role" "db_setup_execution" {
  name               = "${local.bench_name}-db-setup-ecs-execution-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
}

resource "aws_iam_role_policy_attachment" "db_setup_execution_managed" {
  role       = aws_iam_role.db_setup_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "db_setup_execution_secrets" {
  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      aws_secretsmanager_secret.bench_db.arn,
      data.aws_secretsmanager_secret.db.arn,
    ]
  }
}

resource "aws_iam_role_policy" "db_setup_execution_secrets" {
  name   = "${local.bench_name}-db-setup-ecs-execution-secrets"
  role   = aws_iam_role.db_setup_execution.id
  policy = data.aws_iam_policy_document.db_setup_execution_secrets.json
}
