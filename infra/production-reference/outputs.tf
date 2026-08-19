output "alb_dns_name" {
  description = "Public DNS name of the API load balancer."
  value       = aws_lb.api.dns_name
}

output "cloudfront_domain_name" {
  description = "Public domain the frontend is served from."
  value       = aws_cloudfront_distribution.frontend.domain_name
}

output "ecr_repository_url" {
  description = "Push API images here; CI would build/tag/push then update the ECS service."
  value       = aws_ecr_repository.api.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "documentdb_endpoint" {
  description = "Cluster endpoint. Credentials are in Secrets Manager, not here."
  value       = aws_docdb_cluster.main.endpoint
}

output "redis_primary_endpoint" {
  value = aws_elasticache_replication_group.redis.primary_endpoint_address
}
