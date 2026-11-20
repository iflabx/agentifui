---
layout: default
title: Security and Privacy
nav_order: 8
---

# Deployment Security And Data Handling

This describes current boundaries for self-hosted operators and administrators.
It is not a legal privacy policy, compliance certification, complete threat
model or guarantee that no vulnerabilities exist. The operator must decide what
data may be processed and explain their own deployment's providers and retention
to users. For reporting a project vulnerability, use [SECURITY.md](https://github.com/iflabx/agentifui/blob/main/SECURITY.md),
not a public bug report containing exploit details or private data.

## 1. Where Data Goes

```text
Browser -> HTTPS gateway -> Web/auth and API
                              |-> PostgreSQL: identity, access, history, runs
                              |-> Redis: coordination, cache, limits, realtime
                              |-> S3 storage: uploaded objects
                              |-> Persistent runtime content and operational logs
                              |-> Configured external Agent/model service
                              |-> Enabled identity / SMTP / translation services
```

| Data                                       | Normal location or recipient                                                                                              | Operator consideration                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Authentication and business identity       | Better Auth tables, business profiles/identity mappings, browser session cookies and enabled identity provider            | Authentication records and website permissions are distinct; restrict database/backup access                           |
| Application configuration and service keys | Server environment and application database records; encrypted instance keys are decrypted server-side for upstream calls | Encryption of a service-key field does not encrypt the entire database or create end-to-end encrypted chat             |
| Questions, answers and task state          | Local conversation/message/run records and the selected external Agent service                                            | The backend may forward content to its configured model/tools; self-hosting the UI does not imply local-only inference |
| Uploaded files and images                  | S3-compatible storage and, for supported Agent uploads, the relevant backend                                              | Browser-signed uploads can go directly to storage; backend file handling has a separate lifecycle                      |
| Browser preferences                        | Local storage/cookies for supported settings, favorites and client state                                                  | Shared-device/site-data handling matters; not every preference is server-synchronized                                  |
| Public page copy and translations          | Persistent runtime content; public pages and assets are browser-visible                                                   | Home/About content is not private operational-note storage                                                             |
| Logs, errors and backups                   | Deployment log files, persisted error records and chosen backup destinations                                              | Restrict access and retention; older records or captured responses can contain sensitive material                      |

The ordinary LangChain service contract sends the new user input and trusted
native identifiers; the service owns its execution memory. Product display
history is not automatically resent as full model context. Existing Dify paths
have their own request/history behavior, and supported paths can add trusted
identity/input fields. Inspect the actual app and backend contract before sending
regulated data; neither statement guarantees that the backend never retains it.

## 2. Optional External Transfers

| Feature                          | Transfer boundary                                                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Dify/LangChain execution         | Prompts, configured inputs and supported files/identity context go to the selected Agent service, which can call further model/tool providers  |
| GitHub/organizational sign-in    | The browser and server complete the configured identity flow and receive permitted identity attributes/tokens                                  |
| Authentication email             | The SMTP provider receives the recipient address and verification/reset message, including its action link                                     |
| Phone OTP                        | A configured real delivery provider receives the phone/delivery request; development logging is not delivery                                   |
| Home/About automatic translation | An administrator's explicit translation action sends selected public-copy strings to the external MyMemory API, not the configured Agent model |
| Remote avatars/page images       | Loading an externally hosted image can contact that host from the browser; uploaded S3 objects follow the deployment's storage configuration   |

Do not describe the application as offline merely because its Web/API processes
run on your server. Network access, gateway logs, external backend tools and the
deployment's selected providers also affect the data flow. The guide does not
assert that this table enumerates every network request in every optional setup.

## 3. Identity, Secrets And Access

- Use the current Better Auth configuration and intended login methods. A hidden
  button or obscure URL is not authorization. Preserve a usable administrator
  recovery method when changing authentication policy.
- **Public** application visibility still requires an active signed-in account;
  **Group only** requires enabled group permission and membership; **Private** is
  administrator-only. Test the ordinary-user path rather than assuming an admin
  success establishes access control.
- Keep migration-owner and runtime database roles separate. Use the reviewed
  schema/grants and RLS-aware request context; a superuser or `BYPASSRLS` role
  undermines the runtime isolation the application expects.
- Keep service tokens server-side. Do not put secrets in `NEXT_PUBLIC_*`, image
  build arguments, public pages, screenshots or browser requests to the backend.
  Public build inputs are readable by users.
- Preserve and restrict `API_ENCRYPTION_KEY` and authentication keys with the
  private configuration backup. Replacing the encryption key is not an ordinary
  service-token rotation and can make stored tokens unreadable.
- Backend IDs and native service tokens are not website-user authorization.
  Existing trusted conversation/run bindings and actor checks must remain intact.

For Agent requests, the API rechecks the session, account status, application
visibility, provider status and group permission at the start of each new
request. Revoking access therefore blocks the next request in the same browser
session; it does not cancel a response that was already accepted and is still
being delivered. Realtime subscriptions apply the same checks when they are
opened or replayed, but an existing connection is not promised to disconnect
immediately after a permission change.

Conversation-message subscriptions remain owner-only, including for administrators;
management access does not grant access to another user's message body. Resource
authorization SQL uses a five-second transaction-local statement timeout, alongside
the connection-pool timeout. A timeout rejects the check rather than reusing stale
permission. This is a per-statement bound, not a five-second whole-request SLA.

For suspected credential exposure, restrict access and revoke/rotate the affected
upstream credential. Preserve private evidence and coordinate protected local
configuration changes; do not clear unresolved run/quota state just to bypass a
busy guard. See [administrator troubleshooting](ADMIN-GUIDE.md#7-configuration-changes-and-troubleshooting).
Use [credential incident handling](CREDENTIAL-INCIDENTS.md) for the authorized
manual steps. No automatic exposure detector or automatic revocation is implied.

## 4. Before Exposing An Installation

1. Use HTTPS for the browser-facing site and storage URLs. Align origin, callback,
   proxy host/scheme, cookie behavior and storage CORS; do not disable TLS
   verification to make an identity/storage integration appear to work.
2. Restrict database, Redis, storage administration, debugger and direct internal
   listeners to the intended network. Publish only the required ingress routes;
   retain the Web-owned auth routes when routing API traffic to Fastify.
3. Review who can register/sign in and which applications they can use before
   enabling shared paid backend credentials. Disabling one signup method does
   not prove every other identity source is closed.
4. Configure real SMTP when enabling public verification/reset flows; never use
   `dev-log` on a public deployment. Verification/reset links in logs are secrets.
   Apply the same principle to development phone codes and inspector exposure.
5. Review storage bucket policy, signed URL lifetime, proxy behavior and upload
   limits. A signed URL is temporary access to an object, not content inspection,
   a single-use guarantee or a complete retention/quota policy.
6. Back up database data, objects, private keys/configuration and runtime content.
   Restrict backup access and keep application upgrades separate from data restores.
7. Review dependency/service security notices and use a confirmed source version.
   A pinned image/source commit, passing scanner or healthy process is not proof
   that a deployment is vulnerability-free.

These are deployment checks, not a new validation performed by publishing this
document. Use [configuration](CONFIGURATION.md) and [operations](OPERATIONS.md)
for the actual setup and response procedures.

## 5. Retention, Deletion And Backups

Signing out does not delete conversations. Local conversation/user deletion is
not proof of erasure from the external Agent service, model/provider logs, object
storage or backups. Do not assume every uploaded object is removed when the
related message or profile changes. Plan cleanup using actual object references
and the storage provider's controls rather than expiring every active prefix.

There is no universal operator-configurable retention engine that guarantees
coordinated deletion across all these systems. The operator should define:

- Who can access conversations, identity data, error logs and backup exports.
- The retention/cleanup procedure for database records, unreferenced objects,
  runtime snapshots, application/proxy logs and backups.
- The external Agent/model/identity/mail providers' retention and deletion terms.
- How a user requests an authorized review/export/deletion and how that request
  is handled when the product does not expose a complete self-service flow.

Database/object backups and old releases can retain data after a UI deletion.
The database is not encrypted end-to-end by the chat UI. Deployment-specific
at-rest encryption and key management remain operator responsibilities.

After `20261119110000_add_dify_upload_access.sql`, Dify uploaded-file proxy reads
require a trusted per-owner/application upload registration and a non-deleted
conversation or Workflow execution reference, or a newly staged upload not yet
bound to saved history. The migration does not promote browser-writable history
into ownership. For legacy files, the preview handler first checks the current
actor's application access and non-deleted reference, then verifies the scoped
encrypted archive or current-user upstream history before registering ownership
and rechecking access. Unverifiable files remain unavailable; their bytes and
history are not deleted. Copying a file ID into a new message does not grant
access to another user's upload.

Current-actor application/reference checks precede encrypted archive/cache
reads; registration and final access checks precede serving content. Deleting a
reference removes that reference's authority; a different valid reference can
still authorize the same file. Explicit deleted conversation/execution context
cannot borrow another resource's access. Bytes are not physically erased.
Already issued upstream signed links, downloaded copies and restored backups
remain outside this immediate access-control guarantee. Generic storage-signed
uploads and upstream data lifecycles retain their separate documented boundaries.

Use the [application](templates/application-governance.md) and
[operations](templates/operations-governance.md) templates to declare actual
retention, data destinations and verified manual request handling. Unfilled
templates are not site policies; no uniform automatic retention period, full
personal-data export or cross-provider deletion tool is introduced.

## 6. What Existing Governance Does Not Promise

The application implements the documented user/application access, task
admission, idempotency/quota checks, trusted run bindings and bounded event
projection. It does not establish a complete immutable audit system, arbitrary
enterprise approval engine, certified tenant isolation, legal compliance or
exactly-once external side effects. The admin error page is not an audit archive.

Human confirmation is a controlled native LangChain profile. Approval is not
proof an external action is safe, and rejection does not guarantee undoing every
upstream side effect. Stream disconnects and unknown outcomes require careful
status reconciliation, not blind generation/resume retries.

Describe only the capabilities in the [compatibility reference](COMPATIBILITY.md)
and [generation governance](AGENT-GOVERNANCE.md). Future enterprise features
must be implemented and verified before being advertised as controls.

## 7. Share Diagnostics Safely

For ordinary support, provide the source version, approximate time, affected app
type, sanitized request/error identifier and synthetic reproduction. Remove
cookies, auth headers, action links, service keys, personal conversation text,
real identity exports and private configuration from screenshots and logs.

Browser error reports omit full URL queries/fragments and unapproved business
context. Shared bounded cleaning runs before new error persistence, mirror writes
and correlation fingerprints, including direct client submissions. It masks known
authentication URL paths and recognizable credential/header text; it is not a
universal DLP system. Historical records are not rewritten or erased by this
change. Review old logs privately before sharing or scheduling any cleanup.

For a suspected vulnerability, use the private reporting instructions in
[SECURITY.md](https://github.com/iflabx/agentifui/blob/main/SECURITY.md). For secret publication, also follow
[publishing code safely](PUBLICATION.md); deleting a later source line does not
erase the earlier Git object or revoke the leaked credential.

## 8. Result Artifact Data

The optional frozen-result profile stores validated metadata/source excerpts in
PostgreSQL and keeps file bytes at the configured Agent service. Preview/download
use same-origin session-authenticated APIs; the browser does not receive a service
token or upstream thread/run identity. Every read checks current account/app
access and conversation/run ownership. An administrator role is not an exception
to the ordinary owner-only result API.

The initial renderer accepts Markdown and CSV only, rejects byte-integrity
mismatches and does not execute HTML, scripts or spreadsheet formulas in the web
page. External report images are disabled. A matching hash proves consistency
with a frozen manifest, not correctness or safety of generated conclusions.
Downloaded CSV may execute spreadsheet formulas in an external spreadsheet;
inspect generated files before opening or redistributing them.

Deleting a conversation prevents new platform reads. It does not guarantee
physical removal from upstream storage, backups or recipients' downloads. Operators
must document retention and backup rules for both PostgreSQL and the Agent service.
There is no platform-owned S3 replica or offline-download guarantee for this profile.
