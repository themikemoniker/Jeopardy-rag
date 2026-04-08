#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

command -v tofu >/dev/null 2>&1 || { echo "Error: OpenTofu (tofu) not found. Install from https://opentofu.org/docs/intro/install/"; exit 1; }

ACTION="${1:-plan}"

case "$ACTION" in
  init)
    echo "Initializing OpenTofu..."
    tofu init
    ;;
  plan)
    echo "Planning infrastructure..."
    tofu plan -out=tfplan
    ;;
  apply)
    if [ -f tfplan ]; then
      echo "Applying saved plan..."
      tofu apply tfplan
      rm -f tfplan
    else
      echo "No saved plan found. Running plan + apply..."
      tofu apply
    fi
    ;;
  destroy)
    echo "WARNING: This will destroy all infrastructure!"
    read -p "Type 'yes' to confirm: " confirm
    if [ "$confirm" = "yes" ]; then
      tofu destroy
    else
      echo "Aborted."
    fi
    ;;
  output)
    tofu output
    ;;
  ssh)
    IP=$(tofu output -raw instance_public_ip)
    echo "Connecting to $IP..."
    ssh ec2-user@"$IP"
    ;;
  ingest)
    FILE="${2:?Usage: deploy.sh ingest <local-file>}"
    IP=$(tofu output -raw instance_public_ip)
    echo "Uploading $FILE to EC2..."
    scp "$FILE" ec2-user@"$IP":/tmp/ingest-data
    echo "Running ingest..."
    ssh ec2-user@"$IP" "docker exec jeopardy-rag node dist/index.js ingest /tmp/ingest-data"
    ;;
  logs)
    IP=$(tofu output -raw instance_public_ip)
    ssh ec2-user@"$IP" "docker logs --tail 100 -f jeopardy-rag"
    ;;
  status)
    IP=$(tofu output -raw instance_public_ip)
    ALB=$(tofu output -raw alb_dns_name)
    echo "Instance IP: $IP"
    echo "ALB URL:     $ALB"
    echo ""
    echo "Health check:"
    curl -sf "$ALB/stats" | python3 -m json.tool 2>/dev/null || echo "  (not reachable yet)"
    ;;
  *)
    echo "Usage: deploy.sh {init|plan|apply|destroy|output|ssh|ingest|logs|status}"
    echo ""
    echo "Commands:"
    echo "  init      Initialize OpenTofu providers"
    echo "  plan      Preview infrastructure changes"
    echo "  apply     Apply infrastructure changes"
    echo "  destroy   Tear down all infrastructure"
    echo "  output    Show deployment outputs (URLs, IPs)"
    echo "  ssh       SSH into the EC2 instance"
    echo "  ingest    Upload and ingest a data file"
    echo "  logs      Tail application logs"
    echo "  status    Show deployment status and health"
    exit 1
    ;;
esac
