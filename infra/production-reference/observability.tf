resource "aws_sns_topic" "alarms" {
  name = "${var.project_name}-alarms"
  tags = local.common_tags
}

# --- 5xx rate ---
# ALB target-level 5xx count, not ALB-level, so this fires specifically on
# the API misbehaving (AllExceptionsFilter's generic 500 path from the root
# CLAUDE.md security checklist) rather than on ALB-side issues.
resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${var.project_name}-api-5xx-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  period              = 60
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  statistic           = "Sum"
  threshold           = 10 # tune against real traffic once this is applied for real; a placeholder judgment call, not a measured number like the autoscaling threshold
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = aws_lb.api.arn_suffix
    TargetGroup  = aws_lb_target_group.api.arn_suffix
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]
  tags          = local.common_tags
}

# --- Stock-depletion rate ---
# There's no built-in AWS metric for "a flash sale sold out too fast" — this
# is a business event, not an infra one, so it has to come from the app's
# own logs via a CloudWatch Logs metric filter. This filter (and the
# corresponding log line in PurchaseService) is not implemented in the
# application code yet — it's a small, explicit addition a real production
# build-out would make: log a structured line (e.g.
# `{"event":"sold_out","stockRemaining":0}`) at the moment SaleService/
# PurchaseService observes the Lua script returning SOLD_OUT, so this filter
# has something real to count. Left honestly as TODO rather than wired to a
# log line that doesn't exist, per this module's own "grounded in real
# numbers, not invented ones" standard.
resource "aws_cloudwatch_log_metric_filter" "sold_out_events" {
  name           = "${var.project_name}-sold-out-events"
  log_group_name = aws_cloudwatch_log_group.api.name
  # TODO(production): emit this event from PurchaseService before wiring the filter for real.
  pattern = "{ $.event = \"sold_out\" }"

  metric_transformation {
    name      = "SoldOutEvents"
    namespace = "${var.project_name}/business"
    value     = "1"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_metric_alarm" "stock_depletion_rate" {
  alarm_name          = "${var.project_name}-stock-depletion-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  period              = 60
  namespace           = aws_cloudwatch_log_metric_filter.sold_out_events.metric_transformation[0].namespace
  metric_name         = aws_cloudwatch_log_metric_filter.sold_out_events.metric_transformation[0].name
  statistic           = "Sum"
  threshold           = 50 # fires if sold-out responses spike faster than expected — a signal stock was undersized for demand, worth a human look
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alarms.arn]
  tags          = local.common_tags
}
