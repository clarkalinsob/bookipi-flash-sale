resource "aws_docdb_subnet_group" "main" {
  name       = "${var.project_name}-docdb"
  subnet_ids = aws_subnet.private[*].id
  tags       = local.common_tags
}

# Credentials come from `random_password.documentdb_master` (secrets.tf) so
# the master password is never a literal in this file or in state as
# plaintext HCL — Terraform state itself still needs protecting (see the
# backend note in versions.tf), but at minimum it isn't in version control.
resource "aws_docdb_cluster" "main" {
  cluster_identifier        = "${var.project_name}-docdb"
  engine                    = "docdb"
  master_username           = var.documentdb_master_username
  master_password           = random_password.documentdb_master.result
  db_subnet_group_name      = aws_docdb_subnet_group.main.name
  vpc_security_group_ids    = [aws_security_group.documentdb.id]
  storage_encrypted         = true
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.project_name}-docdb-final"

  tags = local.common_tags
}

resource "aws_docdb_cluster_instance" "main" {
  count              = var.documentdb_instance_count
  identifier         = "${var.project_name}-docdb-${count.index}"
  cluster_identifier = aws_docdb_cluster.main.id
  instance_class     = var.documentdb_instance_class

  tags = local.common_tags
}
