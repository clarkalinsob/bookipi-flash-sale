# Production-reference infrastructure — reference only, never applied

This module is **documentation, not a deployment**. It exists to show, as real
inspectable Terraform rather than prose, how the architecture in the root
`README.md`'s "In production on AWS" table would actually be built. Nobody
has run `terraform apply` against this module and nobody should — see
[Why this is never applied](#why-this-is-never-applied) below.

For the small, no-cost demo that *is* actually deployed, see
[`../demo/`](../demo/) — a single free-tier EC2 instance running the same
`docker-compose.yml` used locally. This module is the other half of Phase 7:
what the *production* version looks like, sized and configured against real
numbers from this project's own stress test rather than guessed at.

## Architecture

![Production-reference architecture: browser traffic splits between CloudFront/S3 for the frontend and an ALB into ECS Fargate tasks for the API; those tasks call ElastiCache Redis for the atomic stock check and DocumentDB for the durable purchase record, ECR/Secrets Manager/CloudWatch sit outside the VPC as regional services, and Application Auto Scaling closes the loop from ALB request counts back to ECS task count.](architecture-diagram.svg)

Every box is tagged with the `.tf` file that defines it. Orange marks the hot
path (the Lua `EVAL` stock check) and the autoscaling control loop; dashed
gray edges are deploy-time/bootstrap-only (image pulls, secret injection) —
solid gray is the request path that runs on every purchase. The dashed VPC
and subnet boundaries are drawn to scale with reality: ECR, Secrets Manager,
and CloudWatch sit **outside** the VPC on purpose, because they're regional
AWS services, not VPC resources — a detail easy to get wrong in a hand-drawn
diagram and worth getting right in this one.

## What's here

| File | Maps to |
|---|---|
| `vpc.tf` | Two-AZ VPC, public subnets (ALB) + private subnets (ECS tasks, ElastiCache, DocumentDB) |
| `ecs.tf` | ECS Fargate cluster, task definition, service — the NestJS API as stateless tasks |
| `alb.tf` | Application Load Balancer, target group, HTTP listener, health check on `/api/health/ping` |
| `autoscaling.tf` | `aws_appautoscaling_policy` — target-tracking, thresholds derived from the Phase 2 stress-test results (see below) |
| `elasticache.tf` | ElastiCache for Redis — same Lua `EVAL` semantics as the local container, Multi-AZ with automatic failover |
| `documentdb.tf` | DocumentDB cluster — the durable purchase ledger |
| `frontend.tf` | S3 (private, OAC-only) + CloudFront — the React build |
| `secrets.tf` | Secrets Manager — Mongo/Redis connection strings, referenced by the task definition instead of plaintext env vars |
| `observability.tf` | CloudWatch alarms on 5xx rate and on stock-depletion rate specifically (a sale selling out is a business event worth alerting on, not just an error condition) |
| `variables.tf` / `outputs.tf` / `versions.tf` | Standard scaffolding |

## Why this is never applied

- **No backend block.** State isn't configured to persist anywhere, on purpose — there's nothing to accidentally re-apply against.
- **No CI wiring.** `.github/workflows/ci.yml` never references this directory. Applying it would need to be a deliberate, separate, manual action.
- **Real AWS spend.** ECS Fargate, an ALB, ElastiCache, and DocumentDB are not free-tier — this is sized for a production workload, not a demo.

Treat it the way you'd treat a system-design doc that happens to be syntax-checkable: `terraform validate` is expected to pass (proving the resource graph is internally consistent), but `terraform plan`/`apply` were never run and would need real variable values, a real VPC decision, and a real budget conversation first.

## Autoscaling, grounded in real numbers

`server/test/stress/purchase-stress.ts` measured a single Node process against
local Redis/Mongo: **~1,184 req/s throughput, p99 499ms, at concurrency 300**
(see the root README's stress-test table). That run saturated one process on
one machine — it's the ceiling for *a single task*, not a target to run tasks
at continuously in production.

`autoscaling.tf` uses the ALB's `ALBRequestCountPerTarget` predefined metric
with a target-tracking policy set well under that ceiling (see the comment
there for the exact number and margin reasoning), so ECS scales tasks out
before any individual task approaches the point where the stress test showed
latency starting to climb — headroom for traffic bursts and rolling
deployments, not just steady-state average load.

## DocumentDB vs. MongoDB Atlas

The root README's AWS-mapping table lists both as options and says "pick one,
justify." This module picks **DocumentDB**: it's provisionable with the same
`hashicorp/aws` provider already used for everything else here (no second
provider, no second cloud account to manage access for), and it's
IAM-integrated for auth. The trade-off is real: DocumentDB is
MongoDB-*compatible*, not MongoDB itself, so some driver features (this
project's Mongoose usage is simple CRUD + one unique index, which DocumentDB
supports fine) or newer MongoDB versions may not be available. Atlas would be
the better choice if true MongoDB compatibility or multi-cloud portability
mattered more than single-provider simplicity — a reasonable call to revisit
if this were an actual production build-out rather than a reference.
