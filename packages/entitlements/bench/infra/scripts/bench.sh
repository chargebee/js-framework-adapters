#!/usr/bin/env bash
#
# Run the entitlements benchmark as a one-off Fargate task, print its output,
# and exit with the benchmark's status.
#
# Usage:
#   AWS_PROFILE=poc [CHARGEBEE_DELAY_MS=250] ./scripts/bench.sh
#
# Prerequisites:
#   - `terraform apply` has created the benchmark task definition.
#   - ./scripts/db-setup.sh has created the benchmark database.
#   - The benchmark image has been pushed to the ECR repository
#     (`terraform output ecr_repository_url`; see the Dockerfile header for
#     the build command).
#
# Run it from infra/, which is where the Terraform state is read from.

set -euo pipefail

source "$(dirname "$0")/lib.sh"

TASK_DEF="$(tf_output bench_task_family)"
LOG_GROUP="$(tf_output bench_log_group)"

# Per-run knobs, forwarded to the bench container when set. Redis and Postgres
# delays are absent: the task talks to them directly, without Toxiproxy.
FORWARDED_VARS=(CHARGEBEE_DELAY_MS)

# Builds {"containerOverrides":[{"name":...,"environment":[...]}]} from the
# forwarded variables that are set.
build_overrides() {
  local env_json="[]"
  local name
  for name in "${FORWARDED_VARS[@]}"; do
    [[ -n "${!name:-}" ]] || continue
    env_json="$(jq -c --arg n "$name" --arg v "${!name}" '. + [{name: $n, value: $v}]' <<<"$env_json")"
  done

  jq -cn --arg c "$TASK_DEF" --argjson e "$env_json" \
    '{containerOverrides: [{name: $c, environment: $e}]}'
}

run_task "$TASK_DEF" "$TASK_DEF" "$LOG_GROUP" "$(build_overrides)"
