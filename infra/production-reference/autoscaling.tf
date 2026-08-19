resource "aws_appautoscaling_target" "api" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.api_min_capacity
  max_capacity       = var.api_max_capacity
}

# Target-tracking on requests-per-task, not CPU. This project's Lua-EVAL hot
# path is Redis-round-trip-bound, not CPU-bound (the same reasoning the
# concurrency-mechanism doc gives for why the stress test's latency numbers
# reflect network overhead, not compute) — so CPU utilization would be a
# lagging, unreliable scale-out signal. Request count per target is a direct
# proxy for the actual bottleneck, and the target value comes straight from
# the Phase 2 stress-test ceiling (see variables.tf's
# api_requests_per_target comment for the derivation).
resource "aws_appautoscaling_policy" "api_requests" {
  name               = "${var.project_name}-api-requests-per-target"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.api.service_namespace
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${aws_lb.api.arn_suffix}/${aws_lb_target_group.api.arn_suffix}"
    }
    target_value       = var.api_requests_per_target
    scale_in_cooldown  = 120 # slower scale-in than scale-out: cheap to over-provision briefly, expensive to undersell during a flash sale spike
    scale_out_cooldown = 30
  }
}
