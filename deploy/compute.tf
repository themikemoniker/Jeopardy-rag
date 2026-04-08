# --- SSM Parameter for API key ---
resource "aws_ssm_parameter" "anthropic_api_key" {
  count = var.anthropic_api_key != "" ? 1 : 0

  name  = "/${var.project_name}/anthropic-api-key"
  type  = "SecureString"
  value = var.anthropic_api_key

  tags = { Name = "${var.project_name}-api-key" }
}

# --- IAM Role for EC2 ---
resource "aws_iam_role" "ec2" {
  name_prefix = "${var.project_name}-ec2-"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "ec2_ssm" {
  name_prefix = "${var.project_name}-ssm-"
  role        = aws_iam_role.ec2.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
        ]
        Resource = "arn:aws:ssm:${var.aws_region}:*:parameter/${var.project_name}/*"
      },
      {
        # Allow SSM Session Manager access (optional, for debugging)
        Effect = "Allow"
        Action = [
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel",
          "ssm:UpdateInstanceInformation",
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_instance_profile" "ec2" {
  name_prefix = "${var.project_name}-"
  role        = aws_iam_role.ec2.name
}

# --- SSH Key Pair ---
resource "aws_key_pair" "deploy" {
  key_name_prefix = "${var.project_name}-"
  public_key      = var.ssh_public_key
}

# --- EBS Volume for persistent SQLite data ---
resource "aws_ebs_volume" "data" {
  availability_zone = local.az
  size              = var.data_volume_size
  type              = "gp3"
  encrypted         = true

  tags = { Name = "${var.project_name}-data" }
}

# --- EC2 Instance ---
resource "aws_instance" "app" {
  ami                    = data.aws_ami.amazon_linux.id
  instance_type          = var.instance_type
  key_name               = aws_key_pair.deploy.key_name
  subnet_id              = aws_subnet.public_a.id
  vpc_security_group_ids = [aws_security_group.ec2.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name
  availability_zone      = local.az

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
    encrypted   = true
  }

  user_data = base64encode(templatefile("${path.module}/user-data.sh", {
    project_name      = var.project_name
    aws_region        = var.aws_region
    app_port          = var.app_port
    docker_image      = var.docker_image
    data_device       = "/dev/xvdf"
    has_api_key       = var.anthropic_api_key != ""
  }))

  tags = { Name = "${var.project_name}-app" }

  lifecycle {
    ignore_changes = [ami, user_data]
  }
}

resource "aws_volume_attachment" "data" {
  device_name = "/dev/xvdf"
  volume_id   = aws_ebs_volume.data.id
  instance_id = aws_instance.app.id
}

# --- Application Load Balancer ---
resource "aws_lb" "main" {
  name_prefix        = "jep-"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = [aws_subnet.public_a.id, aws_subnet.public_b.id]

  tags = { Name = "${var.project_name}-alb" }
}

resource "aws_lb_target_group" "app" {
  name_prefix = "jep-"
  port        = var.app_port
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "instance"

  health_check {
    path                = "/stats"
    port                = tostring(var.app_port)
    protocol            = "HTTP"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    matcher             = "200"
  }

  tags = { Name = "${var.project_name}-tg" }
}

resource "aws_lb_target_group_attachment" "app" {
  target_group_arn = aws_lb_target_group.app.arn
  target_id        = aws_instance.app.id
  port             = var.app_port
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}
