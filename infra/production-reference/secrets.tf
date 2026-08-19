# Mongo/Redis connection details live here instead of plaintext task-definition
# env vars — the same "no hardcoded secrets" rule from the root CLAUDE.md
# security checklist, just enforced by infra instead of .gitignore.

resource "random_password" "documentdb_master" {
  length  = 32
  special = false # DocumentDB's allowed special-character set is narrow; avoid the class of connection-string escaping bugs entirely
}

resource "aws_secretsmanager_secret" "documentdb_credentials" {
  name        = "${var.project_name}/documentdb/credentials"
  description = "DocumentDB master credentials for the flash sale API."
  tags        = local.common_tags
}

resource "aws_secretsmanager_secret_version" "documentdb_credentials" {
  secret_id = aws_secretsmanager_secret.documentdb_credentials.id
  secret_string = jsonencode({
    username = var.documentdb_master_username
    password = random_password.documentdb_master.result
    mongo_uri = format(
      "mongodb://%s:%s@%s:27017/flash-sale?ssl=true&replicaSet=rs0&retryWrites=false",
      var.documentdb_master_username,
      random_password.documentdb_master.result,
      aws_docdb_cluster.main.endpoint,
    )
  })
}

resource "aws_secretsmanager_secret" "redis_endpoint" {
  name        = "${var.project_name}/redis/endpoint"
  description = "ElastiCache primary endpoint for the flash sale API."
  tags        = local.common_tags
}

resource "aws_secretsmanager_secret_version" "redis_endpoint" {
  secret_id = aws_secretsmanager_secret.redis_endpoint.id
  secret_string = jsonencode({
    host = aws_elasticache_replication_group.redis.primary_endpoint_address
    port = "6379"
  })
}
