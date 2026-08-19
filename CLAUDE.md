# CLAUDE.md

This file gives Claude Code the operating context for this repository. Read this before writing any code. The full requirements live in `PRD.md` — read that too before starting Phase 0.

## What this project is

A high-throughput flash sale backend + minimal frontend that correctly enforces "one item per user" and "no overselling" under heavy concurrent load, with tests that prove it. See `PRD.md` for the full spec.

This is being built to hold up under senior-engineer-level scrutiny: system design clarity, code quality, correctness under concurrency, testing rigor, and pragmatism ("Explaining why you chose a particular approach is as important as the implementation itself"). Every non-trivial decision should be explainable, not just functional.

## Tech stack (decided — do not relitigate without asking)

- **Backend:** NestJS (TypeScript) on Node.js — chosen over plain Express for DI-driven testability, `ValidationPipe`/DTOs for input validation, and enforced module/controller/service structure.
- **Database:** MongoDB, via `@nestjs/mongoose`.
- **Hot-path concurrency control:** Redis, accessed via a single atomic Lua script (`EVAL`) — this is the single most important piece of code in the project. See "The concurrency mechanism" below.
- **Frontend:** React (Vite), minimal and functional, not styled beyond clarity.
- **Local infra:** Docker Compose for Mongo + Redis.
- **Testing:** Jest (Nest's default) for unit tests, `@nestjs/testing` + supertest for integration/e2e tests, a custom Node/autocannon-style script for the stress test, Playwright for UI-driving screenshots in CI.
- **CI:** GitHub Actions (lint + test on push; Playwright screenshot job on PR).
- **IaC (optional, Phase 7 only):** Terraform — a small applied module for a free-tier EC2 demo, and a separate never-applied reference module showing the production AWS architecture (ECS/ALB/autoscaling).

## The concurrency mechanism (do not deviate from this design)

Redis is the source of truth *during the sale* for "is there stock" and "has this user already bought." MongoDB is the durable ledger, written after a Redis-confirmed success, and is the reconciliation source if Redis restarts.

The atomic operation is one Lua script run via `EVAL` — a single round-trip, no interleaving possible:

```lua
-- KEYS[1] = stock counter key, KEYS[2] = purchased-users set key
-- ARGV[1] = userId
if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1 then
  return 'ALREADY_PURCHASED'
end
local stock = tonumber(redis.call('GET', KEYS[1]))
if stock <= 0 then
  return 'SOLD_OUT'
end
redis.call('DECR', KEYS[1])
redis.call('SADD', KEYS[2], ARGV[1])
return 'SUCCESS'
```

Never pass user input by string-interpolating it into the script text — always via `ARGV`. Never implement the stock check and decrement as two separate Redis calls from application code (that reintroduces the race condition this script exists to prevent).

## Build order — follow these phases in sequence, do not skip ahead

Principle: tackle irreversible uncertainty first, defer reversible polish. A concurrency bug found late can mean redesigning the purchase flow with no time left; a missing lint config found late is a five-minute fix. Full detail for each phase is in `PRD.md` — summary:

0. **Walking skeleton** — Nest scaffold, Docker Compose, one dummy endpoint proving Express→Mongo→Redis (well, Nest→Mongo→Redis) plumbing works. No real logic yet.
1. **Core concurrency logic** — the Lua script, `PurchaseService`, `SaleService`, Mongo schemas, unit tests written alongside. This is the hardest part and gets done first and gets the most care.
2. **Stress test** — prove Phase 1 holds under thousands of concurrent requests. Zero oversell, zero double-purchase, real throughput/latency numbers.
3. **Full API + integration tests** — the 3 required endpoints, DTOs + validation, rate limiting, error handling.
4. **Frontend** — status banner, buy form, feedback states, wired to the real API.
5. **System diagram + README** — this document carries most of the System Design / Pragmatism scoring. Treat it as a first-class deliverable.
6. **CI + tooling polish** — GitHub Actions, Playwright screenshots, `.no-mistakes.yaml` (see below).
7. **Optional, do only if everything above is solid** — no-cost AWS live demo via Terraform. See `PRD.md` Phase 7 for full detail. Never let this compete with time better spent on Phases 1–2.

Do not build the frontend before the concurrency logic is tested. Do not spend time on CI/tooling polish before Phase 1–3 are solid.

## API surface

- `GET /api/sale/status` → `{ status: 'upcoming'|'active'|'ended', startTime, endTime, stockRemaining }`
- `POST /api/purchase` `{ userId }` → `{ result: 'success'|'sold_out'|'already_purchased'|'not_active' }`
- `GET /api/purchase/:userId` → `{ hasPurchased: boolean }`

Sale window and total stock are seeded via a `SaleConfig` Mongo doc or env config, checked against server time on every request — never trust client-supplied time.

## Security & best-practices checklist (apply throughout, not as a final pass)

- No hardcoded secrets — `.env` for Mongo/Redis URIs, `.env.example` committed, `.env` gitignored.
- Validate all input server-side via Nest DTOs + `class-validator` — never trust the client.
- `helmet` for HTTP headers, explicit CORS config (no wildcard).
- Centralized exception filter — generic error messages to the client, full detail logged server-side only.
- `npm audit` clean, dependencies pinned.
- Don't log raw user identifiers at high volume.

## Repo structure

```
bookipi-flash-sale/
├── README.md
├── CLAUDE.md
├── PRD.md
├── docker-compose.yml
├── .github/workflows/ci.yml
├── diagrams/
├── infra/
│   ├── demo/                    # Phase 7a — applied
│   └── production-reference/    # Phase 7b — never applied, documentation only
├── server/                      # NestJS app
│   ├── src/
│   │   ├── purchase/            # PurchaseModule: controller, service, dto, purchase.lua
│   │   ├── sale/                # SaleModule: controller, service
│   │   ├── redis/                # Redis provider
│   │   └── mongo schemas
│   └── test/                    # unit + e2e + stress
└── client/                      # React app
```

## Tooling notes

- `.no-mistakes.yaml`, if added, must point `commands.test`/`commands.lint` at the exact same npm scripts CI uses — never duplicate the command string in two places.
- Playwright is for browser-level UI testing/screenshots against the running React app — unrelated to and unaffected by the backend framework.
- Nest's own e2e tests (`@nestjs/testing` + supertest) test controllers directly over HTTP, no browser — different from Playwright, both are needed.
- **Pre-commit convention:** Husky + lint-staged, configured at the repo root (`package.json`'s `lint-staged` key, hook script at `.husky/pre-commit`). On every commit it runs each workspace's own `lint` script — `npm run lint --prefix server` when staged files match `server/**/*.ts`, `npm run lint --prefix client` when staged files match `client/**/*.{ts,tsx}` — reusing the exact same lint scripts CI runs, same rule as `.no-mistakes.yaml` above: never duplicate the command string. It intentionally does not run the test suites or the stress test on every commit — those are slow and belong in CI, not blocking local commits.

## Things to explicitly avoid (over-engineering signals for this exercise)

- No Kubernetes manifests.
- No message queue implementation (mention as a stretch idea in README only).
- No live AWS deploy unless Phase 0–6 are already complete and solid.
- No multi-region anything.
- Don't let tooling/CI polish get more attention than the concurrency logic.

## Changelog

- **2026-08-18 — Phase 1 complete.** Added `purchase.lua` (the atomic EVAL script, matches the design above), `PurchaseService` + `PurchaseModule`, `SaleService` + `SaleModule`, Mongo schemas (`Purchase` with unique index on `userId`, `SaleConfig`), and unit tests for both services (21 tests, mocked Redis/Mongo via Nest DI). `nest-cli.json` now copies `**/*.lua` into `dist` as a build asset. Notable design decisions made during this phase:
  - **Redis restart recovery is real, not aspirational:** `PurchaseService.onModuleInit()` reconciles the Redis stock counter from Mongo on boot — `totalStock - actualPurchaseCount`, written via `SET ... NX` so a live counter from another already-running instance is never clobbered — and re-seeds the purchased-users set via `SADD` from Mongo's distinct `userId`s. This satisfies "MongoDB is the reconciliation source if Redis restarts" from the concurrency design, not just "Mongo is a durable log."
  - **Mongo write failure after a Redis SUCCESS does not fail the purchase.** By the time Mongo is written, Redis has already decremented stock and marked the user as purchased — that's what the response to the client is based on. If the Mongo insert fails (duplicate key from a prior reconciliation, or Mongo being briefly unreachable), the service logs it for investigation but still returns `success`, rather than telling the user `sold_out`/error after their unit was already committed in Redis. Duplicate-key errors are logged as drift warnings; other errors are logged as errors. This is a deliberate trade-off to write up in the README under Design Choices & Trade-offs — not an oversight.
  - No controllers/DTOs yet — those are Phase 3 per the build order. Phase 1 is service-layer + Lua + schemas + unit tests only, per `PRD.md` Phase 1.

- **2026-08-19 — Phase 1 design calls reviewed and confirmed, no code changes.** Re-examined both trade-offs above:
  - Restart reconciliation via `SET ... NX`: confirmed correct as implemented. Since `attemptPurchase` requires Redis, no purchase can succeed while Redis is down, so Mongo's purchase count is frozen during the outage and the recomputed stock at restart is exact, not racy. One theoretical edge (a request landing between Redis coming back and `onModuleInit` finishing seeding) is not reachable in practice because Nest doesn't call `app.listen()` until all `onModuleInit` hooks resolve.
  - Mongo-write-failure-after-Redis-success: confirmed **kept as-is** (log + swallow, still return `success`) rather than adding retries or failing the purchase. Decision: document the exact failure chain and its real-world fix (SQS write-behind outbox, per `PRD.md` section 9 stretch mention) in the README's Design Choices & Trade-offs section at Phase 5, rather than adding retry/outbox complexity now.

- **2026-08-19 — Phase 1 committed (`c456317`).** `feat: add Lua-based purchase concurrency logic` — all Phase 1 source (`purchase.lua`, `PurchaseService`/`PurchaseModule`, `SaleService`/`SaleModule`, `Purchase`/`SaleConfig` schemas, both `.spec.ts` suites) plus the `nest-cli.json`/`app.module.ts` wiring changes. Note: `CLAUDE.md` and `PRD.md` were not part of this commit — they remain untracked from the initial scaffold and should be included in a follow-up commit.

- **2026-08-19 — Phase 2 complete.** Added `server/test/stress/purchase-stress.ts` and a `test:stress` npm script. Deliberately hits `PurchaseService` directly through a Nest application context (`NestFactory.createApplicationContext`), not over HTTP — there's no HTTP layer yet (Phase 3), and the actual bottleneck under test is the Lua `EVAL` against shared Redis state, not a web server. Seeds stock=100 and fires 5,400 concurrent attempts (5,000 distinct users + 200 users each re-fired twice more, all shuffled together so duplicates race real traffic instead of running safely at the end) at concurrency=300. Real run on this machine:
  - Result breakdown: 100 success / 5,274 sold_out / 26 already_purchased / 0 not_active.
  - Throughput: ~1,184 req/s. Latency: p50 235ms, p95 352ms, p99 499ms (local Docker Desktop on Windows/WSL2 — the per-call round-trip overhead here is Docker networking, not the Lua script itself).
  - All 5 correctness assertions passed: exactly 100 successes, zero duplicate successes, Mongo ledger count === 100, Redis stock counter depleted to exactly 0 (never negative), Redis purchased-set size === 100.
  - These numbers are what go into the README's stress-test results section at Phase 5 — real output, not an assertion that "it works."

- **2026-08-19 — Phase 2 committed and pushed (`38f3805`).** `test: add concurrent stress test for purchase flow` — `test/stress/purchase-stress.ts` and the `test:stress` npm script. Note: `CLAUDE.md` and `PRD.md` are still untracked from the initial scaffold and still not part of any pushed commit.

- **2026-08-19 — Phase 3 complete, committed and pushed (`87c74f2`).** `feat: add purchase/sale API endpoints with validation, throttling, and global error handling`. Added:
  - The 3 required endpoints: `SaleController` (`GET /sale/status`), `PurchaseController` (`POST /purchase`, `GET /purchase/:userId`), matching `PRD.md` section 6 exactly. `POST /purchase` is forced to `@HttpCode(200)` — the outcome lives in the `result` field, not the status code, since `sold_out`/`already_purchased` don't fit a 201-Created default.
  - `PurchaseDto` (`class-validator`: `userId` required, non-empty, max 100 chars) plus a global `ValidationPipe` with `whitelist`/`forbidNonWhitelisted`/`transform` — unknown fields are rejected, not silently dropped.
  - `@nestjs/throttler` as a global `APP_GUARD` (30 req/60s per IP baseline) — a network-abuse concern, not a correctness one, so it's overridden to a no-op guard in e2e tests rather than tuned around test traffic.
  - `AllExceptionsFilter` (global): known `HttpException`s pass their message through as-is (already client-safe by construction — validation errors, `ServiceUnavailableException`, etc.); anything else logs full detail server-side and returns a bare `500 Internal server error` to the client, per the security checklist.
  - `SaleService.getStatus()`/`isActive()` now throw `ServiceUnavailableException` instead of a bare `Error` when no sale is configured, so the filter maps it to a proper `503`.
  - `test/purchase.e2e-spec.ts` — full request-lifecycle integration tests via `@nestjs/testing` + supertest against real Mongo/Redis: sale status, success/sold_out/already_purchased/not_active outcomes, `hasPurchased` checks, and DTO validation (missing/empty/extra-field rejection).
  - Installed `class-validator`, `class-transformer`, `@nestjs/throttler` (none were present before this phase).
  - Debugging note for later: mid-phase, `test:e2e` runs started hanging for minutes. Root cause was environmental, not code — Docker Desktop's containers had been wiped by an engine/VM restart (`docker ps -a` showed zero containers, not even stopped ones), while stale OS-level sockets and an orphaned Node process made it look like an intermittent app-level hang. Fixed by `docker compose up -d` to recreate the containers. If this recurs, check `docker compose ps` before suspecting the code.

- **2026-08-19 — Phase 4 complete.** Scaffolded `client/` with Vite + React + TypeScript (`npm create vite@latest client -- --template react-ts`), stripped the template boilerplate (counter demo, logos, hero image), and built the minimal frontend the PRD calls for:
  - `src/api.ts` — thin `fetch` wrapper for all 3 endpoints, `VITE_API_URL` env-configurable (defaults to `http://localhost:3000/api`), with a typed `ApiError` that surfaces the server's validation message instead of a generic failure.
  - `src/components/StatusBanner.tsx` — renders `upcoming`/`active`/`ended` with a colored badge, stock remaining, and start/end times.
  - `src/components/BuyForm.tsx` — userId input + Buy Now button; button is disabled while empty or submitting; renders one of the 4 outcome messages (`success`/`sold_out`/`already_purchased`/`not_active`) or a network-error message.
  - `src/App.tsx` — polls `GET /sale/status` every 5s (`useEffect` + `setInterval`), and also refreshes immediately right after a purchase attempt settles, so the stock count updates without waiting for the next poll tick.
  - `client/.env.example` added (`VITE_API_URL`); no changes needed to the root `.gitignore` — its bare `.env` pattern already covers `client/.env`, and `dist/`/`node_modules/` patterns already cover the new `client/dist` and `client/node_modules`.
  - **Verified live in a real browser** (not just build/lint), per the "start the dev server and use the feature" rule: seeded Mongo/Redis directly via `mongosh`/`redis-cli` for a small stock (3), ran both dev servers, and drove the actual UI — confirmed all 4 feedback states (`success`, `already_purchased`, `sold_out`, `not_active`), the stock count decrementing live, the button's disabled-when-empty state, and the 5s poll picking up a reseeded `upcoming` sale window without a page reload.

- **2026-08-19 — Phase 4 committed and pushed (`26ecfff`).** `feat: add React frontend for flash sale status and purchases` — all of `client/` (Vite + React + TypeScript app, `StatusBanner`, `BuyForm`, `api.ts`) plus `client/.env.example`. Note: `CLAUDE.md` and `PRD.md` are still untracked from the initial scaffold and still not part of any pushed commit — four phases in now.

- **2026-08-19 — Phase 5 complete.** Wrote the root `README.md` — the first-class deliverable per `PRD.md` section 8 that carries most of the System Design/Pragmatism scoring. Contents: a Mermaid architecture diagram (React SPA → NestJS API → Redis hot path / Mongo durable ledger, with the restart-reconciliation edge labeled), the `purchase.lua` script with the "why EVAL, not two calls" and "why Redis+Mongo, not just Mongo" reasoning inline, the two Phase 1 design-call writeups (restart reconciliation, and the accepted Mongo-write-failure drift gap with its named SQS fix), the full API surface table, build/run instructions (including the manual `SaleConfig` seed command used throughout this project for manual testing), test instructions, the real Phase 2 stress-test numbers in table form, the AWS mapping table (`PRD.md` section 9), and an explicit "what wasn't built, and why" section (message queue, live AWS deploy, k8s/multi-region/live autoscaling) per `PRD.md` section 12's pragmatism self-check. Left `server/README.md` and `client/README.md` as their framework-scaffold defaults — not the graded deliverable, not worth touching.

- **2026-08-19 — Phase 6 complete.** GitHub Actions CI, Playwright UI screenshots, and a security/dependency pass:
  - `server/scripts/seed-sale.ts` — a reusable Mongo+Redis seeding script (`npm run seed -- --state=upcoming|active|ended --stock=N`) built on the same schema/keys/env vars the app itself uses, so seeded state can never drift from what the API actually reads. Replaces the old hand-typed `mongosh`/`redis-cli` block in the README and backs both manual testing and the new Playwright fixtures.
  - `client/e2e/flash-sale.spec.ts` (Playwright) drives the real built frontend through all 4 outcome states — `upcoming` (purchase rejected), `active` (successful purchase), a repeat purchase by the same user (`already_purchased`), and a depleted-stock sale (`sold_out`) — each seeded via the script above, with a screenshot captured per state. Verified locally against the real dev servers, not just written and assumed to work: all 4 pass, screenshots land in `client/e2e/screenshots/`, and an HTML report generates under `client/playwright-report/`.
  - `.github/workflows/ci.yml` — a `server` job (lint, unit tests, integration tests, and a production build, all against real Mongo/Redis service containers — not mocks) and a `client` job (lint, build) run on every push and PR. A third `playwright` job, PR-only, builds and boots the real API (`start:prod`) and frontend (`vite preview`), runs the Playwright suite against them, and uploads the HTML report plus per-state screenshots as build artifacts.
  - **Found and fixed a real production-breaking bug while wiring the Playwright job's `npm run build && start:prod` path:** adding `server/scripts/seed-sale.ts` (which lives outside `src/`) shifted TypeScript's inferred `rootDir` for `nest build`, changing the compiled output layout from `dist/purchase/*.js` to `dist/src/purchase/*.js` — while Nest's separate asset-copy step still placed `purchase.lua` at the old `dist/purchase/purchase.lua`, so `PurchaseService`'s `readFileSync` couldn't find it and the app crashed on boot. Invisible to both `test` and `test:e2e` because both run through `ts-jest` directly against `src/`, never through the compiled `dist/` output. Fixed by excluding `scripts/` from `tsconfig.build.json` (same as `test/` already was) and confirmed with a real `npm run build && npm run start:prod` boot, not just a passing test suite. This is exactly the gap Phase 6's CI closes going forward — the Playwright job's build step means this class of bug fails CI immediately instead of surfacing only in a real deploy.
  - `.no-mistakes.yaml` was deliberately skipped — `PRD.md` marks it optional ("if added"), and inventing a config for a tool not otherwise present in this repo isn't worth the risk of it silently drifting from the real CI commands.
  - `npm audit` on both `server/` and `client/`: 0 vulnerabilities.

- **2026-08-19 — Pre-commit hook added.** Installed `husky` + `lint-staged` as root dev dependencies (`npm install -D husky lint-staged`, `npx husky init`). `.husky/pre-commit` runs `npx lint-staged`; the `lint-staged` key in the root `package.json` maps `server/**/*.ts` to `npm run lint --prefix server` and `client/**/*.{ts,tsx}` to `npm run lint --prefix client` — reusing each workspace's existing lint script rather than inventing a new command, so it can't drift from what CI runs. Deliberately scoped to lint only, not tests or the stress test — those stay in CI so commits stay fast locally.

- **2026-08-19 — Phase 6 committed and pushed (`e5ecc00`).** `feat: add CI pipeline with Playwright UI screenshots and sale-seed script` — `.github/workflows/ci.yml`, `server/scripts/seed-sale.ts`, `client/e2e/` (Playwright spec + seed helper + config), the `tsconfig.build.json`/`package.json` fixes, root `package.json`/`.husky/pre-commit` (dev orchestration + lint-staged), and the finished `README.md`. `CLAUDE.md` and `PRD.md` are still untracked from the initial scaffold and still not part of any pushed commit — six phases in now.

- **2026-08-19 — CI hang fixed.** The `Server lint & test` job's `Integration (e2e) tests` step was stuck running for ~2 hours in GitHub Actions even though Jest itself reported all 12 tests passing in under 3s — the log ended with `Jest did not exit one second after the test run has completed`, and the runner never got past that step to `Build`. Root cause: `test/app.e2e-spec.ts` (the default Nest-scaffolded spec, untouched since the walking-skeleton phase) builds a fresh `AppModule` — and thus a fresh `ioredis` connection via `RedisModule` — in `beforeEach`, but `afterEach` only called `app.close()`. `RedisModule`'s client has no Nest lifecycle hook wired up (same reason `purchase.e2e-spec.ts` already explicitly calls `redis.quit()` in its `afterAll`), so `app.close()` never closed it, leaving a dangling connection that kept the Jest worker process alive indefinitely. Fixed by grabbing the `REDIS_CLIENT` instance in `app.e2e-spec.ts`'s `beforeEach` and calling `redis.quit()` alongside `app.close()` in `afterEach`, mirroring the existing `purchase.e2e-spec.ts` pattern. Verified locally: `npm run test:e2e` now exits cleanly in ~7.8s with no hang warning, 12/12 tests still passing.

- **2026-08-19 — Phase 7b complete.** Built `infra/production-reference/` — the never-applied Terraform module modeling the root README's "In production on AWS" table as real, inspectable IaC. VPC (2 AZ, public/private subnets, single NAT), ECS Fargate service behind an ALB (health check on `/api/health/ping`, 30s deregistration delay so in-flight purchase requests aren't cut mid-`EVAL`), ElastiCache Redis (replication group, Multi-AZ automatic failover, encryption at rest/in transit), DocumentDB (credentials generated and stored in Secrets Manager, never literal HCL), S3+CloudFront frontend (OAC only, no public bucket), ECR with image scanning, and CloudWatch alarms. Notable decisions:
  - **Autoscaling is grounded in the real Phase 2 stress-test numbers, not a guess.** `aws_appautoscaling_policy` target-tracks `ALBRequestCountPerTarget` (not CPU — the Lua-EVAL hot path is Redis-round-trip-bound, not compute-bound, same reasoning as the stress test's own latency writeup) at 300 req/target, roughly a quarter of the ~1,184 req/s single-process ceiling the stress test measured, leaving headroom for bursts and rolling deploys. Documented in both `variables.tf` and the module's own README so the number's origin isn't lost.
  - **DocumentDB over Atlas, with the trade-off stated explicitly** rather than silently picked: same `hashicorp/aws` provider, IAM-integrated, but Mongo-*compatible* rather than true MongoDB — written up in `infra/production-reference/README.md`'s own section rather than left implicit.
  - **The stock-depletion CloudWatch alarm is honest about what it needs that doesn't exist yet:** there's no built-in AWS metric for "a sale sold out too fast," so it depends on a CloudWatch Logs metric filter matching a structured log line (`{"event":"sold_out",...}`) that `PurchaseService` doesn't currently emit. Left as an explicit `TODO(production)` comment in `observability.tf` rather than wiring the filter to a pattern that would silently never match — consistent with this module's "grounded in real numbers, not invented ones" standard.
  - **Verified as far as possible without real AWS credentials:** `terraform init`, `fmt -check`, and `validate` all pass; `terraform plan` with dummy vars resolves the full resource graph and only fails at the expected point (`STS GetCallerIdentity` — no real credentials). `.terraform/` and `terraform.tfvars` are gitignored; `.terraform.lock.hcl` and `terraform.tfvars.example` are committed.
  - Phase 7a (the applied EC2 demo, `infra/demo/`) is still open — it needs real AWS credentials and an explicit go-ahead for `terraform apply` before proceeding, unlike this half.
