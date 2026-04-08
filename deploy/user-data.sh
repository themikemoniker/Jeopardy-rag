#!/bin/bash
set -euo pipefail
exec > /var/log/user-data.log 2>&1

echo "=== Jeopardy RAG bootstrap starting ==="

# --- Install Docker ---
dnf update -y
dnf install -y docker aws-cli jq
systemctl enable docker
systemctl start docker
usermod -aG docker ec2-user

# --- Mount EBS data volume ---
DATA_DEVICE="${data_device}"
DATA_DIR="/data"

mkdir -p "$DATA_DIR"

# Format only if not already formatted
if ! blkid "$DATA_DEVICE" | grep -q ext4; then
  echo "Formatting $DATA_DEVICE..."
  mkfs.ext4 "$DATA_DEVICE"
fi

mount "$DATA_DEVICE" "$DATA_DIR"

# Add to fstab for persistence across reboots
if ! grep -q "$DATA_DIR" /etc/fstab; then
  echo "$DATA_DEVICE $DATA_DIR ext4 defaults,nofail 0 2" >> /etc/fstab
fi

chown 1000:1000 "$DATA_DIR"

# --- Fetch API key from SSM (if available) ---
API_KEY=""
%{ if has_api_key }
API_KEY=$(aws ssm get-parameter \
  --name "/${project_name}/anthropic-api-key" \
  --with-decryption \
  --region "${aws_region}" \
  --query "Parameter.Value" \
  --output text 2>/dev/null || echo "")
%{ endif }

# --- Determine Docker image ---
DOCKER_IMAGE="${docker_image}"

if [ -z "$DOCKER_IMAGE" ]; then
  # No pre-built image — build from source
  echo "No docker_image specified, building from source..."
  dnf install -y git

  cd /opt
  git clone https://github.com/themikemoniker/Jeopardy-rag.git app
  cd app

  docker build -t jeopardy-rag:latest .
  DOCKER_IMAGE="jeopardy-rag:latest"
fi

# --- Run the container ---
docker run -d \
  --name jeopardy-rag \
  --restart unless-stopped \
  -p ${app_port}:3000 \
  -v /data:/data \
  -e DB_PATH=/data/jeopardy.db \
  -e PORT=3000 \
  -e LOG_LEVEL=info \
  -e ANTHROPIC_API_KEY="$API_KEY" \
  "$DOCKER_IMAGE"

# --- Create systemd service for auto-restart ---
cat > /etc/systemd/system/jeopardy-rag.service <<UNIT
[Unit]
Description=Jeopardy RAG Application
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/bin/docker start jeopardy-rag
ExecStop=/usr/bin/docker stop jeopardy-rag

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable jeopardy-rag

echo "=== Jeopardy RAG bootstrap complete ==="
echo "App accessible on port ${app_port}"
