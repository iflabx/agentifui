---
layout: default
title: Operations and Troubleshooting
parent: Installation and Operations
nav_order: 4
---

# Operations And Troubleshooting

This guide is for the operator of a self-hosted AgentifUI instance. Use the
installation method's runbook as the command authority:

- [Docker Compose](DOCKER.md) for bridge-network Web/API and optional data services.
- [Manual Docker capacity](DOCKER-CAPACITY.md) for the optional generated
  host-network replica deployment.
- [Host/PM2](QUICK-DEPLOYMENT.md) for application processes on the server.

Do not apply commands from one topology to a different running installation.
Use the documentation and scripts from the installed/target version, not a moving
`main` checkout. Keep actual domains, configuration, backups and incident records
in deployment-owned private storage, outside public source.
See [deployment security and data handling](SECURITY-PRIVACY.md) for external
transfers and retention boundaries; report vulnerabilities through
[the security policy](https://github.com/iflabx/agentifui/blob/main/SECURITY.md).

## 1. Record The Installation Once

Maintain a short private record, not a new automation platform:

- Confirmed release/tag, full source commit, image identity or PM2 release directory.
- Public HTTPS origin, reverse-proxy routing and expected Web/API ports.
- Private environment path and which values were compiled at build time.
- Database migration state, migration-owner/runtime roles, Redis namespace and
  object-storage bucket/identity. Note any external or pooled dependencies.
- Runtime content/snapshot location, data volumes, backup destination and recovery owner.
- For manual Docker capacity: private capacity configuration and persistent
  `stateDir`, selected replica counts and gateway files. Preserve this state across updates.
- Auxiliary jobs, startup services and their version-dependent paths.

Keep an off-host restricted backup of configuration and keys, including
`API_ENCRYPTION_KEY`; losing it prevents decryption of existing service tokens.
Do not paste an environment dump or resolved Compose configuration into a ticket.

## 2. Routine Checks

### Know Which Component Owns The Problem

| Component              | Responsibility                                                                                   | What must survive an application replacement                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| HTTPS gateway          | Public origin, TLS, routing and streaming forwarding                                             | Proxy configuration and certificates; this is deployment-owned, not user history storage                       |
| Web                    | Website, server-rendered pages and Next-owned authentication routes                              | Private configuration and the release's compiled public settings; the process/container itself is replaceable  |
| API                    | Business APIs, backend forwarding, generation governance and supported persistence/realtime work | Matching private configuration and access to shared dependencies; replacing it can interrupt active work       |
| PostgreSQL             | Accounts, application/access records, conversations, messages and persisted task/decision state  | Database data, schema/migration state, roles and grants                                                        |
| Redis                  | Shared cache/realtime coordination, configured admission state and recipient email limits        | The deployment's Redis data/persistence policy and isolated namespace; not a substitute for PostgreSQL history |
| S3-compatible storage  | Uploaded objects such as avatars and page assets                                                 | Objects, bucket/access configuration and the stable browser-facing URL scheme                                  |
| Runtime content        | Home/About content, interface translation inputs and upgrade snapshots                           | The configured external `AGENTIF_RUNTIME_DIR` and its content, not just repository defaults                    |
| External Agent service | Dify/LangChain execution and any backend-owned state                                             | Backend-specific data and credentials under its own operator's procedures                                      |

The ordinary Compose installation runs Web and API from the same image as
separate services. The optional `data` profile provides PostgreSQL, Redis and
MinIO containers; externally managed equivalents can be used instead. Named
volumes retain `postgres`, `redis`, `objects`, `content` and `logs` data for that
Compose project. Changing the project name or attaching different volumes can
look like a fresh installation even when the old data still exists.

Host/PM2 runs the application as host processes rather than Web/API containers.
It still requires the same dependency responsibilities and private runtime
content; its database/storage may themselves be containers or external services.
The optional capacity topology adds its own gateway, connection-pool and replica
management described in [manual capacity](DOCKER-CAPACITY.md). Do not infer its
service/volume layout from the simpler bridge Compose example.

### Inspect The Current Runtime

For the regular bridge Compose installation, run from its source directory with
the same private configuration/project name used at deployment:

```bash
docker compose --env-file /private/application.env ps
docker compose --env-file /private/application.env logs --tail 100 web api
```

For a capacity-managed deployment, inspect containers by its actual Compose
project label (replace `agentifui` with the configured project name):

```bash
docker ps --filter label=com.docker.compose.project=agentifui
```

Compare these with the generated topology and saved selections in the private
capacity state directory. The capacity command has no read-only status subcommand;
running it without counts can still reconcile/start services and reload routing.
Do not use a scale invocation as a routine read-only health check.

For the default host/PM2 topology:

```bash
pm2 status AgentifUI-Prod AgentifUI-API-Prod
pm2 logs AgentifUI-Prod --lines 100 --nostream
pm2 logs AgentifUI-API-Prod --lines 100 --nostream
```

Check the API health endpoint from the server using the configured API port
(`3010` is the host/PM2 default). Bridge Compose does not publish the API to the
host; do not open its port just to run a host curl command. Process/container
health is not a complete dependency or business acceptance result.

Also check free disk space, memory, restart counts, database connections, Redis
availability and storage errors using your existing host/service tools. Increase
monitoring only as actual usage requires it; there is no requirement to install
a monitoring stack for a small deployment. Authentication delivery failures and
unknown/persistence-failed tasks deserve investigation even when health is green.

## 3. Diagnose In Request Order

Follow browser -> HTTPS gateway -> Web/auth or API -> database/cache/storage ->
Agent backend. Narrow the failing boundary before restarting anything.

| Symptom                                        | Check first                                                                                                                                  |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Login/callback fails or loops                  | Public origin including port, forwarded scheme/host, `BETTER_AUTH_URL`, cookie behavior and identity-provider callback authorization         |
| GitHub button missing or returns an auth error | Private OAuth App credentials, public button build flag and `/api/auth/better/callback/github`; repository tokens are unrelated              |
| Streaming arrives in one batch or breaks       | Gateway buffering, timeouts, SSE forwarding and upstream reachability; never add automatic generation POST retries                           |
| API 503 or missing relations after upgrade     | API reachability, all pending SQL, runtime grants/RLS and browser/API version coordination                                                   |
| No models/application or access denied         | Product entry point, active provider/instance, backend/category, ordinary-user status and visibility/group access                            |
| Answer visible but history incomplete          | Same-account history, execution versus persistence state, exact run/save error and database availability; do not regenerate to repair saving |
| Upload/preview/download fails                  | Browser-reachable signing origin, matching host, bucket policy/CORS, proxy size limits and path-specific permissions                         |
| Registration/reset says success but no email   | SMTP settings and auth delivery errors, sender authorization, recipient throttling and actual inbox receipt                                  |
| Busy configuration/quota edit                  | Existing admitted, running, waiting or unknown work; consult the backend before changing protected state                                     |
| Human confirmation cannot continue             | Profile/capabilities, current permissions, expiration, stored decision and native run status; do not replay an uncertain resume              |

See [configuration](CONFIGURATION.md), [LangChain operational boundaries](LANGCHAIN-INTEGRATION.md#failure-and-operational-boundaries)
and [generation governance](AGENT-GOVERNANCE.md) for exact behavior.

## 4. Unknown Runs And Saving Failures

Execution, connection and persistence are separate. A browser disconnect is not
cancellation; a successful native run does not prove its messages were saved.
The live API can finish consuming and saving work after the browser leaves, but
API process loss does not provide general durable stream or crash recovery.

First identify the authorized local conversation/run and inspect the corresponding
upstream status through the supported application path. If an exact saved-result
snapshot exists, the run-query/save recovery path can persist that snapshot without
calling the model again. If it does not, an upstream success alone is insufficient
to invent a missing message or mark it saved.

Unknown dispatch or resume outcomes must be checked, not blindly retried. Preserve
the relevant identifiers and private diagnostic evidence, and involve a maintainer
when existing reconciliation cannot resolve it. There is no general admin
"force complete/release" console. Do not delete task rows, reduce usage counters,
clear Redis or mark an unknown task failed merely to remove an alert. Pending
human decisions can also constrain credential changes and code rollback.

## 5. Upgrades And Capacity Changes

Use the [version and upgrade navigation](COMPATIBILITY.md#5-choose-documentation-and-plan-an-upgrade)
to select the installed/target documentation and backend requirements. Published
change notes live in GitHub Releases; this runbook supplies the operational steps.

1. Receive a confirmed tag/full commit and acceptance summary. Identify any new
   SQL, configuration, content or upstream contract requirements since the
   installed version, not just since the previous commit.
2. Back up and retain a usable restore path. Prepare a separate source/release
   directory, preserve private configuration/content and keep the previous image
   or built PM2 release. Do not share active build outputs with the new build.
3. Follow the selected runbook's migration, content preparation, build and cutover
   sequence. Use the migration owner, apply only reviewed pending SQL once and
   verify runtime grants. Application startup does not automatically migrate data.
4. Validate the new runtime before retiring the old one. Record its actual
   running image/directory, source identity and results; update auxiliary jobs
   and the host startup mechanism as needed.

For Docker details, use [upgrade and rollback](DOCKER.md#5-upgrade-and-rollback);
for PM2, use [deployment](QUICK-DEPLOYMENT.md#6-deploy) and its recovery steps.
Never replay fresh `db-init`/storage initialization on an existing deployment or
run `down -v` during an update.

Capacity changes are separate from version updates. The
[capacity tool](DOCKER-CAPACITY.md) manually changes Web/API counts on a compatible
host-network installation; it does not build images, apply SQL or upgrade data
services. Check host resources, database pool totals, upstream concurrency and
stream draining before increasing or decreasing size. Do not expect ordinary
Compose `--scale` to replace this topology-specific procedure.

## 6. Backups And Recovery

Use the [Docker backup examples](DOCKER.md#6-diagnosis-and-backups) or the equivalent
tools for your existing external dependencies. Include:

| Data                                      | Recovery requirement                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| PostgreSQL database and roles             | Consistent logical or database-aware backup, migration state and runtime grants           |
| S3-compatible objects                     | Object data plus bucket/access configuration using the storage provider's supported tools |
| Runtime pages, translations and snapshots | Persistent runtime content, not only tracked source defaults                              |
| Private configuration and keys            | Restricted backup; required encryption/auth identities and callback configuration         |
| Runtime/deployment state                  | Old source/image/builds, Compose or PM2 config, capacity state and auxiliary jobs         |

Choose frequency and retention according to acceptable data loss, usage and
organizational policy. Separate live exports are not automatically an atomic
cross-service snapshot. If a consistent recovery point requires stopping writers,
schedule a maintenance window. A raw copy of live PostgreSQL files is not a safe
substitute for a consistent database backup.

Rehearse restore into isolated dependencies with test outbound email/auth/backend
settings so verification cannot affect real users. Validate readable history,
decryptable provider credentials, objects and runtime content. Record the steps
and observed recovery point before relying on the backup.

Application rollback and data restore are different operations. Reuse the previous
image/build only with compatible schema, content and pending interactions. If
incompatible, choose a forward fix or an explicitly planned restore with a known
data-loss window. Do not attempt destructive schema downgrades as an automatic
response to an application failure.

## 7. Minimal Post-Change Acceptance

After an application deployment, check health/static assets, ordinary-user login,
one complete conversation (two turns for ordinary chat), refresh/history and
logout/login. A single-task human-input application uses its decision/result
flow instead of a second question in the same conversation.

Add only affected checks: real email and both links when mail changes; authorized
SSO round trips when authentication changes; file operations when storage changes;
human confirmation when that profile changes; and persistence/draining across
replicas when capacity or shutdown changes. Container health or SMTP acceptance
alone does not prove those workflows succeeded.

For incidents and handoff, retain the version, time, application, sanitized error
code/request identifier, impact, action taken and recovery outcome. Review logs
before sharing: no session tokens, reset links, service keys, raw user content or
private backups in public reports. Give administrators the
[management guide](ADMIN-GUIDE.md) and users the [user guide](USER-GUIDE.md).
