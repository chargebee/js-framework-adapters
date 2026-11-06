locals {
  bench_name = "${var.name_prefix}-entitlements-bench"

  # Isolated database and owner on the existing RDS instance, created by the
  # db-setup task (see db.tf).
  bench_db_name = "entitlements_bench"
  bench_db_user = "entitlements_bench"

  redis_node = data.aws_elasticache_cluster.app.cache_nodes[0]

  chargebee_live        = var.chargebee_mode == "live"
  chargebee_secret_arns = local.chargebee_live ? [aws_secretsmanager_secret.bench_chargebee[0].arn] : []

  # Secrets are injected at task start, so they never enter the task definition.
  bench_env = [
    { name = "REDIS_URL", value = "redis://${local.redis_node.address}:${local.redis_node.port}/${var.redis_database}" },
  ]

  # Empty in mock mode: the bench goes live as soon as these are set. The
  # index is only evaluated when live, when the secret exists.
  chargebee_secrets = local.chargebee_live ? [
    {
      name      = "CHARGEBEE_SITE"
      valueFrom = "${aws_secretsmanager_secret.bench_chargebee[0].arn}:site::"
    },
    {
      name      = "CHARGEBEE_API_KEY"
      valueFrom = "${aws_secretsmanager_secret.bench_chargebee[0].arn}:api_key::"
    },
  ] : []

  bench_secrets = concat(
    [
      {
        name      = "POSTGRES_URL"
        valueFrom = "${aws_secretsmanager_secret.bench_db.arn}:database_url::"
      },
    ],
    local.chargebee_secrets,
  )
}
