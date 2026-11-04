#!/usr/bin/env bash
#
# Create the isolated benchmark database and owner on the existing RDS
# instance. Re-runnable; each run re-applies the password from Secrets Manager.
#
# Usage:
#   AWS_PROFILE=poc ./scripts/db-setup.sh
#
# Prerequisite: `terraform apply` has created the db-setup task definition.
# Run it from infra/, which is where the Terraform state is read from.

set -euo pipefail

source "$(dirname "$0")/lib.sh"

TASK_DEF="$(tf_output db_setup_task_family)"
LOG_GROUP="$(tf_output db_setup_log_group)"

run_task "$TASK_DEF" "$TASK_DEF" "$LOG_GROUP"
