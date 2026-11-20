---
layout: default
title: Credential Incidents
parent: Installation and Operations
nav_order: 7
---

# Credential Incidents

This is a manual operational procedure for an administrator's detection or a
report of suspected credential exposure. It is not an automatic scanner,
revocation service or authorization to modify a deployment. An authorized
operator must explicitly approve the affected scope and actions; record who
authorized them and when. Escalate immediately to that operator if the reporter
cannot authorize containment or upstream revocation.

Use the documentation for the installed version. Keep incident evidence and
completed [operations records](templates/operations-governance.md) private. For
project vulnerabilities, follow the
[private reporting policy](https://github.com/iflabx/agentifui/blob/main/SECURITY.md).
Never put a leaked value, reset link, complete environment file or raw private
response in an issue, chat, screenshot, audit summary or public log.

## Two Different Secrets

- An upstream service token authorizes calls to a configured Dify/LangChain
  service. Ordinary same-identity rotation replaces this token through existing
  administration controls, subject to unresolved-task protections.
- `API_ENCRYPTION_KEY` decrypts stored service credentials and encrypted
  Workflow archives. Replacing it does not re-encrypt old database values or
  objects. Ordinary service-token rotation does not require changing it.

This procedure adds no key ring, ciphertext format, migration tool or automatic
rotation. It does not change any actual key, configuration or task state.

## Authorized Service-Token Incident Response

1. Record discovery time, affected provider/application references, reporter,
   authorization and a restricted evidence reference. Identify unknown scope
   without copying the exposed token.
2. Use the existing provider enabled control in
   [API configuration](ADMIN-GUIDE.md#provider-and-instance-fields) to disable
   the affected provider and prevent new admission. Record that this can affect
   multiple applications. Existing
   [visibility and group controls](ADMIN-GUIDE.md#4-visibility-groups-and-allowance)
   can restrict application access, but Private visibility still permits
   administrators. Removing a default selection or turning off a profile feature
   is not a universal application kill switch.
3. **Revoke the exposed token upstream immediately once authorized.** Do not wait
   for local `unknown` tasks to disappear, a protected edit to become available,
   an audit feature to exist or a future reconciliation/cancellation tool.
   Upstream revocation is separate from disabling local access. Obtain and record
   the upstream confirmation; a failed or uncertain attempt is not success.
   Containment and revocation should proceed without making completion of a
   local control a prerequisite for upstream action. If needed, an explicitly
   authorized deployment maintainer can isolate affected entry points or
   upstream services and record the business impact.
4. Investigate accepted and unresolved work using existing trusted records and
   upstream evidence; follow
   [unknown-run guidance](OPERATIONS.md#4-unknown-runs-and-saving-failures).
   Preserve unknown outcomes when evidence is insufficient. Do not automatically
   resubmit work, delete task rows, reduce usage counters, disable triggers,
   bypass SQL protections or use a privileged database identity to force a key
   change. Keep the existing task, quota and credential protections intact.
5. When protections permit, save a replacement token for the intended service
   identity through the existing
   [provider/application editor](ADMIN-GUIDE.md#3-configure-a-provider-and-application).
   Do not silently repoint an old task to a different application or identity.
   Any temporary new application requires an explicit new configuration/session
   boundary. Never restore the exposed token as a rollback step.
6. Before restoring access, use the supported
   [configuration check](ADMIN-GUIDE.md#check-configuration-without-saving) and
   a minimal synthetic call, then verify the intended ordinary-user access.
   Record actual checks, remaining unknown work, impact and notification
   decisions. If management audit is implemented in the installed version,
   retain its operation references; otherwise retain the restricted incident
   record without delaying revocation.

Disabling a provider or permission blocks new authorized work; it does not
retract data already sent upstream or cancel accepted tool actions. **Already
accepted replies may continue, and authorized reads may remain available.**
Upstream revocation can nevertheless disrupt in-flight work. Neither outcome
proves cancellation, completion or erasure. See
[generation governance](AGENT-GOVERNANCE.md#storage-and-extension-boundary) for
the existing protection boundaries.

## Master-Key Custody And Exposure

Keep encryption keys only in restricted runtime configuration and restricted
backups, never Git, images, browser/public variables, command-line plaintext or
public logs. Record a backup location identifier and custodian, not the key.

Recovery coverage must include the database, encrypted archive objects,
persistent content and matching configuration/decryption keys. Database
credentials and Workflow archives use different storage formats; checking one
does not prove the other can be recovered. Record restoration as **Unverified**
until an isolated restore demonstrates the required data remains readable.
This guide does not assert that any deployment has completed those checks.

For suspected master-key exposure, obtain explicit incident authorization,
contain the exposure immediately and assess dependent service tokens, data and
backups. Do not leave an exposure open merely because migration tooling is
absent. Do not overwrite or discard the old key and expect old data to remain
readable. Preserve required historical keys under restricted custody; do not
reuse a compromised key for new writes.

Any master-key migration is a separate approved maintenance activity requiring
an inventory of readers and encrypted objects, compatible read/write behavior,
consistent backups, a recovery point and evidence that restored data can be
decrypted before service resumes. This document neither supplies that tool nor
performs the migration. See [backup guidance](OPERATIONS.md#6-backups-and-recovery)
and [security boundaries](SECURITY-PRIVACY.md#3-identity-secrets-and-access).
