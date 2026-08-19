resource "aws_ecs_cluster" "main" {
  name = "${var.project_name}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = local.common_tags
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${var.project_name}-api"
  retention_in_days = 30
  tags              = local.common_tags
}

# --- IAM ---

data "aws_iam_policy_document" "ecs_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Execution role: what ECS itself needs (pull from ECR, write logs, read
# secrets to inject as env vars at container start).
resource "aws_iam_role" "execution" {
  name               = "${var.project_name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
  tags               = local.common_tags
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      aws_secretsmanager_secret.documentdb_credentials.arn,
      aws_secretsmanager_secret.redis_endpoint.arn,
    ]
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "${var.project_name}-execution-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

# Task role: what the running application itself is allowed to call. Empty
# for now — this API doesn't call any other AWS service at runtime — kept as
# a distinct role from the execution role rather than reusing it, so a future
# runtime permission (e.g. an SQS write-behind outbox, per the root README's
# "what wasn't built" section) is additive instead of widening an
# already-broad role.
resource "aws_iam_role" "task" {
  name               = "${var.project_name}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
  tags               = local.common_tags
}

# --- Task definition + service ---

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.project_name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.api_task_cpu
  memory                   = var.api_task_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = "api"
      image     = var.api_container_image
      essential = true
      portMappings = [{
        containerPort = var.api_container_port
        protocol      = "tcp"
      }]
      environment = [
        { name = "PORT", value = tostring(var.api_container_port) },
        { name = "NODE_ENV", value = var.environment },
      ]
      # MONGO_URI and REDIS_HOST/PORT are secrets, not plaintext env vars —
      # ECS resolves these from Secrets Manager at container start and the
      # app reads them the same way it reads local .env values, per the
      # server's existing ConfigModule setup.
      secrets = [
        { name = "MONGO_URI", valueFrom = "${aws_secretsmanager_secret.documentdb_credentials.arn}:mongo_uri::" },
        { name = "REDIS_HOST", valueFrom = "${aws_secretsmanager_secret.redis_endpoint.arn}:host::" },
        { name = "REDIS_PORT", valueFrom = "${aws_secretsmanager_secret.redis_endpoint.arn}:port::" },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "api"
        }
      }
    }
  ])

  tags = local.common_tags
}

resource "aws_ecs_service" "api" {
  name            = "${var.project_name}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.api_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.ecs_tasks.id]
    # No public IP — tasks live in private subnets and reach the internet
    # (for ECR pulls, Secrets Manager, CloudWatch) via the NAT gateway.
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = var.api_container_port
  }

  # Wait for containers to pass the ALB health check before the deploy is
  # considered stable, and keep at least half of desired_count healthy
  # throughout a rolling deploy.
  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200

  depends_on = [aws_lb_listener.http]

  lifecycle {
    ignore_changes = [desired_count] # autoscaling.tf owns this after the initial apply
  }

  tags = local.common_tags
}
