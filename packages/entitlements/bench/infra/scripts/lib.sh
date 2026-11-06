# Shared by bench.sh and db-setup.sh. Source it, don't run it.

# Names come from the Terraform outputs, so the scripts must run in infra/.
tf_output() {
  terraform output -raw "$1"
}

CLUSTER="$(tf_output cluster_name)"
SERVICE="$(tf_output network_service_name)"

export AWS_REGION="${AWS_REGION:-$(tf_output region)}"
export AWS_PAGER=""

aws_cli() {
  docker run --rm -i -v ~/.aws:/root/.aws -v "$(pwd)":/aws --env-file <(env | grep ^AWS_) amazon/aws-cli "$@"
}

# run_task TASK_DEF CONTAINER LOG_GROUP [OVERRIDES_JSON]
#
# Runs a one-off Fargate task on the network config borrowed from the live
# network service, waits for it to stop, prints the container's logs and
# returns 1 unless the container exited 0.
run_task() {
  local task_def="$1"
  local container="$2"
  local log_group="$3"
  local overrides="${4:-{\}}"

  echo ">> borrowing network config from service $SERVICE"
  local network_config
  network_config="$(aws_cli ecs describe-services \
    --cluster "$CLUSTER" \
    --services "$SERVICE" \
    --query 'services[0].networkConfiguration' \
    --output json)"

  if [[ "$network_config" == "null" ]]; then
    echo "error: could not read networkConfiguration from $SERVICE" >&2
    return 1
  fi

  echo ">> starting task ($task_def)"
  local task_arn
  task_arn="$(aws_cli ecs run-task \
    --cluster "$CLUSTER" \
    --task-definition "$task_def" \
    --launch-type FARGATE \
    --network-configuration "$network_config" \
    --overrides "$overrides" \
    --started-by "$(basename "$0")" \
    --query 'tasks[0].taskArn' \
    --output text)"

  echo ">> task ARN: $task_arn"
  echo ">> waiting for task to stop..."
  aws_cli ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$task_arn"

  local describe
  describe="$(aws_cli ecs describe-tasks \
    --cluster "$CLUSTER" \
    --tasks "$task_arn" \
    --output json)"

  local exit_code stopped_reason
  exit_code="$(jq -r --arg c "$container" \
    '.tasks[0].containers[] | select(.name == $c) | .exitCode // "null"' <<<"$describe")"
  stopped_reason="$(jq -r '.tasks[0].stoppedReason // ""' <<<"$describe")"

  echo ">> task output"
  aws_cli logs tail "$log_group" \
    --log-stream-name-prefix "ecs/$container/${task_arn##*/}" \
    --since 1h \
    --format short

  echo ">> container exit code: $exit_code"
  [[ -z "$stopped_reason" ]] || echo ">> stopped reason: $stopped_reason"

  [[ "$exit_code" == "0" ]]
}
