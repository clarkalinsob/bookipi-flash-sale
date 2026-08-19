# PRD — High-Throughput Flash Sale System

This document is the full spec; `CLAUDE.md` is the condensed operating context for the coding agent.

## 1. Objective

Build a backend + minimal frontend for a single-product, limited-stock flash sale that stays correct under thousands of concurrent purchase attempts: no overselling, no user buying more than once, graceful behavior outside the sale window.

## 2. Why this project is being built the way it is

This is evaluated on System Design, Code Quality, Correctness, Testing, and Pragmatism, for a Senior Full-Stack + Architecture + AWS + DevOps scope, not a junior coding test. The README is a proxy for how this person thinks about production systems, even though nothing is required to actually deploy. "Excellence is having more impact by doing less" is treated as a literal design constraint: build the correct, well-reasoned core, document how it maps to real production infrastructure, and avoid gold-plating.

## 3. Functional requirements

- Flash sale has a configurable start/end time; purchases only allowed within that window.
- Single product, predefined limited stock.
- One item per user, enforced server-side.
- API endpoints: sale status, attempt purchase, check purchase status.
- Simple React frontend: view status, enter a user identifier, click Buy Now, see success/already-purchased/sold-out/not-active feedback.
- A system architecture diagram, with the reasoning behind component choices documented.

## 4. Non-functional requirements

- High throughput, many concurrent requests, designed with scaling in mind.
- Robust and fault-tolerant under heavy load and partial failures.
- Concurrency control that provably prevents overselling and race conditions.

## 5. Architecture

```
React SPA
   |
   v
NestJS API (stateless, horizontally scalable)
   |            \
   v             v
Redis           MongoDB
(atomic stock   (durable purchases,
 counter +       users, sale config,
 purchased set)  audit log)
```

**Why Redis + Mongo, not just Mongo:** MongoDB alone can be made atomic per-document (`findOneAndUpdate` with a `stock > 0` filter, plus a unique index on `userId`) — that's correct and is the simplest viable approach, worth naming in the README. But a flash sale is a short, extreme burst against a single hot document (the stock counter) and a single hot index (userId uniqueness) — exactly Redis's strength (in-memory, single-threaded, atomic ops). Redis is the source of truth during the sale; Mongo is the durable ledger, reconciled from on Redis restart.

**The atomic operation** is a single Lua script executed via Redis `EVAL` — one round-trip, no interleaving window between the stock check and the decrement, no locks needed. Full script in `CLAUDE.md`.

**Why NestJS:** DI makes Redis/Mongo providers swappable for mocks in tests; `ValidationPipe` + DTOs give input validation largely for free; the module/controller/service structure is enforced architectural discipline, which matters for a project this focused on "architecture" and "best practices." It's an allowed option under the stated technical guidelines. Framework choice does not affect the concurrency logic's correctness — that risk is identical under Express or Nest.

**Why stateless API:** enables horizontal scaling behind a load balancer — the scaling story, even if only one instance runs locally.

## 6. API surface

| Method | Path | Response |
|---|---|---|
| GET | `/api/sale/status` | `{ status: upcoming\|active\|ended, startTime, endTime, stockRemaining }` |
| POST | `/api/purchase` `{ userId }` | `{ result: success\|sold_out\|already_purchased\|not_active }` |
| GET | `/api/purchase/:userId` | `{ hasPurchased: boolean }` |

Sale window and stock are seeded via a `SaleConfig` Mongo document or env config, checked against **server** time on every request.

## 7. Testing requirements

- **Unit tests (Jest):** `PurchaseService` and `SaleService` in isolation — sold out, duplicate user, success, sale-not-active — Redis/Mongo providers mocked via Nest's DI.
- **Integration/e2e tests (`@nestjs/testing` + supertest):** full request lifecycle against real (or in-memory/test) Mongo + Redis.
- **Stress test:** a script firing thousands of concurrent purchase requests at a small stock number (e.g. stock=100, 5,000+ simulated distinct users). Must assert programmatically: exactly N successes, zero oversell, no user succeeds twice even under duplicate/racing requests. Capture and report real throughput (req/s) and p95 latency numbers.

## 8. Deliverables

1. Git repository link.
2. `README.md` containing: design choices & trade-offs; the "in production on AWS" subsection (Section 9 below); the system diagram; build/run instructions; test and stress-test instructions with a summary of actual results obtained.

## 9. AWS mapping (documentation only — no live deploy required)

| Concern | Local (this repo) | AWS in production |
|---|---|---|
| Compute | Docker Compose, single NestJS process | ECS Fargate, stateless tasks behind an ALB |
| Hot-path cache | Self-hosted Redis container | ElastiCache for Redis (same Lua `EVAL` semantics, Multi-AZ failover) |
| Durable store | Self-hosted MongoDB container | DocumentDB (AWS-native/IAM-integrated) or MongoDB Atlas (truer Mongo compatibility, multi-cloud) — pick one, justify |
| Frontend | Served locally / bundled | S3 + CloudFront |
| Secrets | `.env` | Secrets Manager / SSM Parameter Store |
| Observability | Console logs | CloudWatch metrics + alarms on stock-depletion rate and 5xx error rate specifically |
| CI/CD | GitHub Actions running tests | Same GitHub Actions, extended to push images to ECR and deploy to the ECS service |
| Scale-out (optional stretch mention) | N/A | SQS-based write-behind decoupling the Redis-confirmed response from the Mongo write, for even higher throughput |

## 10. Build order (phased, sequenced by risk — see `CLAUDE.md` for the condensed version)

Principle: tackle irreversible uncertainty first, defer reversible polish.

**Phase 0 — Walking skeleton (~30–45 min).** Nest scaffold, Docker Compose (Mongo+Redis, healthchecks), one dummy endpoint round-tripping through both. Goal: eliminate plumbing unknowns before real logic is written.

**Phase 1 — Core concurrency logic.** The Lua script, `PurchaseModule` (`PurchaseService`, `SaleService`), Mongo schemas (`Purchase` with unique index on `userId`, `SaleConfig`), unit tests written alongside. Goal: the hardest, most-graded part done first, with full attention.

**Phase 2 — Stress test / proof.** Thousands of concurrent requests against limited stock; assert zero oversell, capture real throughput/latency numbers. Goal: empirical proof while the logic is fresh and cheap to fix.

**Phase 3 — Full API + integration tests.** All 3 endpoints, DTOs + `ValidationPipe`, `@nestjs/throttler` rate limiting, global exception filter. Goal: backend-complete.

**Phase 4 — Frontend (React).** Status banner, buy form, feedback states, live status polling.

**Phase 5 — System diagram + README.** Diagram, AWS mapping (Section 9), design trade-offs, build/run/test instructions, stress test results. Treat as a first-class deliverable — this carries most of the System Design/Pragmatism scoring.

**Phase 6 — CI + tooling polish.** GitHub Actions (lint + test on push; Playwright job on PR driving the app through its states, screenshots as artifacts); optional `.no-mistakes.yaml` mirroring the same npm scripts CI uses; final `npm audit`/security pass.

**Phase 7 — Optional, no-cost AWS live demo, Terraform-provisioned. Do only if 0–6 are solid; skip without hesitation otherwise.**
- *7a (applied):* `infra/demo/` — one free-tier EC2 instance running the same `docker-compose.yml` via `user_data`, locked-down security group, optional Elastic IP. `terraform destroy` when no longer needed.
- *7b (never applied):* `infra/production-reference/` — a Terraform module (explicitly marked reference-only) modeling the Section 9 architecture: ECS Fargate, ALB, `aws_appautoscaling_policy` with target-tracking thresholds grounded in the actual Phase 2 stress-test numbers, ElastiCache, DocumentDB. This is how autoscaling is demonstrated — as real, inspectable IaC, not a live and costly scaling event.

## 11. Explicitly out of scope

Kubernetes, message queue implementation (mention only), live AWS deploy beyond the optional Phase 7 demo, multi-region infrastructure, a live-triggered autoscaling demo.

## 12. Scoring alignment (self-check before submitting)

- **System Design:** README explicit about *why* Redis-for-hot-path + Mongo-for-durability and *why* NestJS — not just what was used.
- **Correctness:** the Lua script is well-tested and well-commented; it is the single most important piece of code in the repo.
- **Testing:** stress test results are real numbers, not an assertion that "it works."
- **Pragmatism:** README explicitly states what was *not* built and why — a message queue, multi-region, live autoscaling — and what the right call is for this scope vs. production.
