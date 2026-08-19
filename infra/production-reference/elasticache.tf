resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.project_name}-redis"
  subnet_ids = aws_subnet.private[*].id
}

# Replication group (not a bare cache cluster) specifically for Multi-AZ
# automatic failover — the stock counter and purchased-user set are the
# single most important state in this system (see the root README's
# concurrency-mechanism writeup); losing Redis without failover would mean
# losing the ability to sell anything until it's manually recovered.
resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = "${var.project_name}-redis"
  description          = "Flash sale hot-path stock/purchased-set store — same Lua EVAL semantics as the local Redis container."

  engine         = "redis"
  engine_version = "7.1"
  node_type      = var.redis_node_type

  num_cache_clusters         = 2
  automatic_failover_enabled = true
  multi_az_enabled           = true

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.redis.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true

  tags = local.common_tags
}
