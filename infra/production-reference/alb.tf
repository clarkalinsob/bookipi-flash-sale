resource "aws_lb" "api" {
  name               = "${var.project_name}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  tags = local.common_tags
}

resource "aws_lb_target_group" "api" {
  name        = "${var.project_name}-api-tg"
  port        = var.api_container_port
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip" # required for Fargate awsvpc networking

  health_check {
    path                = "/api/health/ping"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 15
    matcher             = "200"
  }

  # Give in-flight purchase requests time to complete before a task is
  # deregistered during a rolling deploy or scale-in — losing a request
  # mid-EVAL is exactly the kind of edge case this project's stress test
  # exists to rule out; the infra shouldn't reintroduce it.
  deregistration_delay = 30

  tags = local.common_tags
}

# HTTP only — a production build-out would add a 443 listener with an ACM
# cert (e.g. behind a real domain via Route 53) and redirect 80 -> 443. Left
# as plain HTTP here since this module has no domain/ACM cert to attach to.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.api.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}
