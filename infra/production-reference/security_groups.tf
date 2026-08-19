resource "aws_security_group" "alb" {
  name        = "${var.project_name}-alb"
  description = "Public HTTP(S) ingress to the ALB only."
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, { Name = "${var.project_name}-alb-sg" })
}

resource "aws_security_group" "ecs_tasks" {
  name        = "${var.project_name}-ecs-tasks"
  description = "API tasks accept traffic from the ALB only, never directly from the internet."
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "API port from ALB"
    from_port       = var.api_container_port
    to_port         = var.api_container_port
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, { Name = "${var.project_name}-ecs-tasks-sg" })
}

resource "aws_security_group" "redis" {
  name        = "${var.project_name}-redis"
  description = "Redis accepts traffic from API tasks only."
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Redis from ECS tasks"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  tags = merge(local.common_tags, { Name = "${var.project_name}-redis-sg" })
}

resource "aws_security_group" "documentdb" {
  name        = "${var.project_name}-documentdb"
  description = "DocumentDB accepts traffic from API tasks only."
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Mongo wire protocol from ECS tasks"
    from_port       = 27017
    to_port         = 27017
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  tags = merge(local.common_tags, { Name = "${var.project_name}-documentdb-sg" })
}
