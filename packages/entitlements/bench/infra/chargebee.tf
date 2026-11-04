# Optional live Chargebee test site for the benchmark (chargebee_mode = "live").
#
# Created with placeholder values by Terraform. Real values are set out-of-band
# and Terraform ignores subsequent changes so `apply` never clobbers them:
#
#   aws --profile <profile> secretsmanager put-secret-value \
#     --secret-id <name_prefix>-entitlements-bench-chargebee \
#     --secret-string '{"site":"acme-test","api_key":"test_..."}'
#
# Use a test site: the bench creates `benchmark_*` fixtures on it.

resource "aws_secretsmanager_secret" "bench_chargebee" {
  count = local.chargebee_live ? 1 : 0

  name                    = "${local.bench_name}-chargebee"
  description             = "Chargebee test site credentials for the entitlements benchmark (managed out-of-band)."
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "bench_chargebee" {
  count = local.chargebee_live ? 1 : 0

  secret_id = aws_secretsmanager_secret.bench_chargebee[0].id
  secret_string = jsonencode({
    site    = "PLACEHOLDER"
    api_key = "PLACEHOLDER"
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}
