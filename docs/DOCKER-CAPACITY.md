# Manual Docker Capacity

## Scope

This optional Linux host-network path uses the same application image and
configuration as [Docker installation](DOCKER.md). Start with one Web and one
API, select a larger size on the first deployment, or change the size later.
There is no autoscaler. Scaling does not build/pull images, initialize data,
apply migrations, or replace the database/Redis/object store.

This mode is useful when reusing host-loopback dependencies and an existing host
Nginx. Host networking has less network isolation than bridge networking; all
application listeners bind explicitly to loopback. The regular bridge installer
remains available and does not require host Node. The capacity command requires
host Node 22+ and Docker Compose V2; the image retains its pinned Node runtime.

## 1. Prepare One Deployment

Use a confirmed release and a dedicated Compose project. Do not point this tool
at running bridge applications or PM2 listeners. A migration from an older
installation still needs backups, reviewed pending SQL and a maintenance window.
Do not run a trial candidate or a load test against live production data.

Create one private configuration file from
[docker-capacity.example.json](docker-capacity.example.json), outside the source
tree. Replace the example paths, allocate unused loopback ports, and configure
Nginx test/reload argument arrays for your host. These are trusted operator
commands, executed without shell evaluation; protect the configuration from
untrusted modification. Prepare `stateDir` with mode 700. Do not delete or move
it during normal operation: it contains the generated runtime Compose, capacity
token, selected size and operation records. All these files are private.

The port arrays are available slots, not containers started in advance. Extend
them when needed, after checking host/DB/upstream capacity. Web and API counts
are independent. At least one of each remains; the first API (`api`) is the
fixed content writer and is never removed by ordinary scaling.

In the same private application environment used by Compose, configure:

```dotenv
COMPOSE_PROJECT_NAME=agentifui
AGENTIF_IMAGE=agentifui:<verified-release>
FASTIFY_PROXY_BASE_URL=http://127.0.0.1:13010
NEXT_UPSTREAM_BASE_URL=http://127.0.0.1:13000
PG_POOL_MAX=5
REDIS_PREFIX=agentifui-production
```

Set real runtime database/Redis/S3/SMTP/auth configuration as described in the
installation manual. Every replica uses the same keys, data endpoints and
public origin. These secrets are never passed to the image build. Namespace
cache keys, invalidation channels, realtime channel and stream consistently;
the default Compose values derive from `REDIS_PREFIX`. Redis Pub/Sub is not
isolated by Redis database number alone.

Build once with the host gateway rewrite target. The image records this public
target in a label; the script refuses a bridge-targeted image. If exporting
custom translations, use the installation manual's content build context and
pass the same `FASTIFY_PROXY_BASE_URL` argument to `docker build`.

```bash
docker compose --env-file /private/application.env build web
```

Use already-initialized external dependencies and initialized persistent runtime
content. For a new installation, perform the explicit initialization steps
before scaling; container-loopback one-shot jobs require an explicitly reviewed
host-network invocation to reach host-only dependencies. Never replay `db-init`
or `storage-init` on existing data. The capacity script deliberately does none
of these operations. It retains the base Compose content/log volume identities.

Web does not run the LISTEN-based outbox dispatcher through a transaction pool;
API runs the polling dispatcher. An authorized realtime subscription starts the
API pump lazily. Verify event propagation, cross-replica login/logout and normal
database-role permissions, not just process health.

## 2. Connect The Existing Nginx

The script owns exactly one generated HTTP-context fragment at `upstreamFile`.
It contains Web/API/writer upstreams, an ownership-based routing map and two
loopback gateway servers. Include it from the host's `http` context, using an
optional glob before the file exists, for example:

```nginx
include /srv/agentifui/private/capacity/nginx*.conf;
```

Nginx must already be running and able to read the restricted directory. Its
configuration check and reload commands must include this fragment; do not use
commands that only test a different configuration. The script's user needs write
access to the fragment and permission to test/reload Nginx, not permission to
rewrite the whole host configuration. Never store credentials in this fragment.

After the first successful capacity command, connect the existing public TLS
virtual host to the generated routing map. With the example `upstreamPrefix`:

```nginx
location ^~ /__agentifui/ { return 404; }
location / {
    proxy_pass http://$agentifui_capacity_backend;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_buffering off;
    proxy_next_upstream off;
    proxy_read_timeout 3600s;
}
```

Integrate this with existing static-resource, TLS, security-header, body-size
and trusted-proxy rules; it is not a replacement virtual host. Overlapping old
locations can bypass the new routing map and writer: review them before switching
traffic. Do not expose the capacity control path, trust arbitrary client
forwarding headers, cache user responses, or retry non-idempotent generation.
Preserve the exact Host/port for signed storage traffic in its existing proxy.

Content and translation editing routes always use the first API, including the
internal gateway. All replicas share content, but file locks remain process-local;
only one editor should save at a time. Translation edits still require a common
new build. Failed writer access must not silently fail over to another writer.

## 3. Select Or Change Size

Run the same command for initial application startup and later scaling:

```bash
node scripts/docker-scale.mjs --config /private/capacity.json --web 1 --api 1
node scripts/docker-scale.mjs --config /private/capacity.json --web 2 --api 3
```

Counts are target totals, not increments. With no explicit counts, the command
uses saved selections, or 1/1 for a new deployment. A partial selection preserves
the other count. Existing healthy, matching instances are not recreated. The
script serializes operations; do not run a version deployment concurrently.

On expansion, it checks available application ports, starts only missing slots
from the selected local image ID, checks them, and tests/reloads Nginx before
admitting traffic. It does not pull the tag again. Runtime credential/port/image
changes to existing slots are rejected instead of being disguised as scaling.

On contraction, it removes unwanted instances from routing first. API receives
an authenticated, loopback-only drain command: existing normal/model requests
remain counted until their response finishes or disconnects, new work is refused,
and long-lived realtime subscriptions close so clients can reconnect. It pauses
new outbox claims and waits for an already-claimed event batch to finish
publication/requeue before stopping the API. This controlled drain does not make
the existing outbox crash-safe against forced kills or failed requeues. Web waits
for established inbound loopback TCP connections to disappear. Idle keepalive,
slow requests or remaining old Nginx workers can delay this conservative Web
check; timeout leaves the container running rather than force-stopping it.

The token-protected control endpoint is absent unless explicitly enabled by the
capacity renderer; it must never be routed from the public proxy. Its token is
separate from authentication/encryption keys and never reaches Web/browser code.

API drain does not migrate an in-progress model task to another instance.
Timeout reports an incomplete operation; already-drained containers may remain
running outside the upstream. Retry the same target after work finishes, or
select the old counts to resume them. Inspect private state and actual containers
after a crash; do not delete the state directory as a shortcut. A stale lock
after an unclean process exit must be removed only after confirming no operator
is still running the command.

Configuration-check/reload failures restore the prior fragment; newly started
idle containers may remain for diagnosis/retry. An externally edited fragment is
not overwritten. JSON success output and `operations.jsonl` contain counts and
image identity, not the private runtime environment. Health is not a full business
acceptance test: verify two-turn chat/history, attachments, cross-replica auth and
event delivery before opening significant traffic.

## 4. Version Updates And Capacity Limits

Scaling and releasing a new version are separate actions. Use the saved counts
when preparing a new release; do not reset to 1/1. The capacity command refuses
mixed images/configuration in existing managed slots, rather than recreating
all active applications as a hidden rolling release. Plan version replacement
and compatible rollback separately, retain the old image/config/content, and
pause content editing during a release. Do not run the bridge manual's plain
`up web api` against a host-capacity project.

Replica count is not a promise of supported users or generations. Budget every
Web/auth/API pool, transient old/new instances, PgBouncer server pools and PG's
connection limit. Measure model/Dify quotas, memory, event lag and latency.
Test scale-up, idempotence, scale-down with an active stream, refusal on unsafe
configuration, and data preservation in isolation before production rollout.
No production migration, automatic failover or autoscaling is provided by this
command.

## 5. Maintenance-Window Version Replacement

Use this procedure for an existing host-capacity installation, not for a fresh
database. It intentionally uses a short maintenance window, not mixed-version
rolling updates. Rehearse the intended image/schema/content combination in an
isolated project first. Do not perform a rehearsal against production data.

1. Record the current source and local patches, exact image ID, selected counts,
   private environment, capacity configuration, entire state directory and
   active Nginx configuration. Keep the old source available: its operational
   wrapper may still invoke the old capacity script. Back up data/content/keys
   and review pending migrations and rollback compatibility using
   [DOCKER.md](DOCKER.md#5-upgrade-and-rollback). Do not replay initialization.
2. Build and verify the candidate from confirmed source in a separate directory.
   Keep the public origin, compiled API gateway, authentication/encryption keys,
   Redis namespace and data endpoints consistent. Preserve reviewed deployment
   choices such as `AUTH_EMAIL_DISABLED`; do not silently drop local patches.
   Test the actual artifact, not just the source or a differently configured
   image. Retain the old image for rollback.
3. Prepare a private candidate base Compose file and capacity JSON with a **new
   project and empty state directory**, the new image, and the recorded counts.
   Preserve the exact existing data/log mount sources and named-volume `name`
   values explicitly: changing a project name must not select empty volumes.
   Keep resolved configuration private with mode 600. Use the same application
   ports/gateways for this maintenance-window method; do not start the candidate
   while the old containers still own those ports. The new capacity token is
   generated normally; retain the old state/token unchanged for rollback.
4. Freeze content editing, pause new generations at the trusted entry and wait
   for current generation requests. Close the public application entry with a
   temporary maintenance response; also close any other writer entry points.
   Keep that maintenance configuration and its recovery commands available until
   acceptance finishes. At each **active old API port**, issue a direct loopback
   `POST /__agentifui/capacity` with `Authorization: Bearer <old-state-token>`
   and `{"draining":true}`. Read the token locally from old `state.json`; do not
   expose it through the public proxy, shell tracing or logs. This closes realtime
   subscriptions and prevents new work. Poll the same authenticated endpoint
   until `activeRequests` and `backgroundTasks` are zero, and wait for established
   Web connections to clear. Apply a bounded timeout; abort and resume the old
   deployment on timeout rather than killing busy requests.
5. Stop only the old managed applications, retaining their containers and state:

   ```bash
   docker compose -p <old-project> -f /private/old-state/compose.json stop
   ```

   Remove the old generated fragment from the **loaded include set**, preserving
   its original bytes privately. While maintenance stays active, arrange that
   the Nginx HTTP include loads only the candidate fragment, using an optional
   glob while it does not yet exist. Avoid duplicate upstream names or gateway
   listeners. Nginx check/reload must use this real configuration. Apply only
   reviewed pending SQL/content upgrades, if any, at the planned point with all
   relevant writers stopped. Never restore old data merely to change topology.

6. Start the candidate at the recorded size; for example, if the old size was 2/3:

   ```bash
   node /releases/candidate/scripts/docker-scale.mjs \
     --config /private/candidate-capacity.json --web 2 --api 3
   ```

   The new project has no old managed slots, so the tool can create correct
   image/configuration labels and state without editing hashes or bypassing its
   refusal checks. Verify every intended replica's exact image, mounts, keys,
   readiness and the gateway before removing maintenance. Check retained session
   cookies, cross-replica login/logout, two-turn chat/history, realtime and signed
   files, plus affected SSO/email policy. Readiness alone is not acceptance.

7. On success, point the installation's normal capacity command/configuration at
   the candidate source/project/state, restore the public entry and observe
   errors/restarts/event backlog. A repeated target must preserve container IDs.
   Leave old image/source/state and maintenance recovery material for the agreed
   rollback window; do not run the old Compose or scale wrapper accidentally.

For a compatible code/topology rollback, keep maintenance active, drain and stop
the candidate, remove its fragment from the loaded include set, and restore the
old fragment/configuration. Run the **old source's** capacity command with its
unchanged old state and counts to resume the retained old containers. Validate
Nginx and business behavior before reopening. Keep all new user data: do not
restore PostgreSQL, Redis or objects for a code-only rollback. If the schema or
content is no longer old-code-compatible, retain maintenance and follow the
preplanned forward-fix/recovery procedure instead of attempting this rollback.
