---
layout: default
title: Administrator Guide
nav_order: 5
---

# Administrator Guide

This guide covers website administration after installation. Server installation,
environment files and service management belong to the operator; see
[Docker installation](DOCKER.md), [host/PM2 deployment](QUICK-DEPLOYMENT.md) and
[runtime configuration](CONFIGURATION.md). UI labels can vary by language.
For a first installation, follow [the complete setup path](GETTING-STARTED.md).
Use [compatibility](COMPATIBILITY.md) when choosing backend capabilities and
[security/data handling](SECURITY-PRIVACY.md) when granting access or enabling
external services.

## 1. Bootstrap The First Administrator

There is no shipped default administrator account or password, and the first
registrant is not automatically an administrator.

1. Keep the new installation behind a restricted proxy or SSH tunnel while
   creating the operator's account. For email registration, configure real SMTP
   and leave `AUTH_EMAIL_DISABLED` unset or `0`; do not use `dev-log` on a public
   service. Otherwise use an intentionally configured external sign-in method.
2. Sign in so the corresponding business profile exists. For an email account,
   complete verification before promotion.
3. Ask the database operator to promote only the intended, verified account using
   the reviewed SQL in [Docker account bootstrap](DOCKER.md#3-https-and-browser-storage).
   The SQL is also usable for a host installation through its migration-owner
   database connection; Docker is not required for that query. For an external
   identity, first verify the actual account identity and profile association.
4. Log out and in again, then open `/admin`. Do not grant all new users an admin
   role to make the first login work.

The website does not replace the initial database-owner step. Once bootstrapped,
use the user-management UI for supported role and status changes. Keep a tested
operator access method before changing SSO or local-login policy.

## 2. Administration Areas

| Page                   | Responsibility                                                              |
| ---------------------- | --------------------------------------------------------------------------- |
| `/admin/api-config`    | Providers, application/service instances and encrypted upstream credentials |
| `/admin/users`         | User records, role and account-status management                            |
| `/admin/groups`        | Groups and membership                                                       |
| `/admin/permissions`   | Application visibility and group access                                     |
| `/admin/sso-providers` | Supported organizational sign-in provider records                           |
| `/admin/content`       | Home/About page content and supported translations                          |
| `/admin/errors`        | Application error investigation                                             |

The data model includes `admin`, `manager` and `user` roles. Do not assume that
`manager` grants every administrator action; protected operations still enforce
their server-side role requirements. Validate access with an ordinary user,
not only the administrator account.

## 3. Configure A Provider And Application

A **provider** supplies a base URL and provider metadata. A **service instance**
is the product application users open; it holds backend-specific configuration
and its encrypted service credential. Neither is a website login provider.

New-provider choices are Dify and LangChain. An older provider can retain a legacy
type in its editor for compatibility; that does not establish an implemented
Agent backend for that type. Authentication-type metadata is not a promise that
every arbitrary upstream authentication mechanism is implemented.

### Provider And Instance Fields

| Field or control                     | How to use it                                                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider name/type                   | Give the upstream a recognizable name and select Dify or LangChain for new records                                                                                        |
| Provider base URL                    | Use the backend API base reachable by the server, including `/v1` for a Dify Service API where appropriate; not its console page                                          |
| Provider enabled/default             | Control provider availability/default metadata; neither assigns application permissions nor configures a login provider                                                   |
| Instance identifier                  | A stable identifier for this configured application; the create form offers UUID generation and the editor locks the identifier after creation                            |
| Display name/description/tags        | Help users find the application in lists/search; these are public display data, not secret storage                                                                        |
| Backend                              | Select Dify or LangChain independently of display labels; verify it matches the actual upstream contract                                                                  |
| API URL                              | The form displays the selected provider's bound URL rather than accepting an unrelated endpoint in that field                                                             |
| API key/service token                | Store the application-scoped credential in the encrypted instance-key field; while editing, a blank key can retain the existing credential when one is already configured |
| Product category and Dify subtype    | For Dify, choose model versus marketplace and its real app mode; LangChain stays in marketplace                                                                           |
| Enabled/default application controls | Enable an intended app and, for an appropriate Dify entry, choose a default; a default selection does not turn LangChain into a model or bypass access checks             |

Keep website account IDs, product instance identifiers, the service-instance UUID,
native Dify conversation IDs and LangChain thread/run IDs distinct. Users should
follow product links rather than construct URLs from upstream identifiers.

### Conversation Turns

**Conversation turns** is optional in the create and edit forms. Single turn
allows one submission per conversation; another task starts a new conversation.
After the turn ends, the composer is replaced by **Start new task**. The
existing conversation and its results stay readable.
Multi-turn allows follow-up in the same upstream conversation. Select it only
when the application is designed to use earlier context.

- **Dify:** Sync reads the app mode from `/info`. It prefills a recognized
  subtype for new applications and reports a mismatch without changing an
  existing subtype. Chatbot and Agent get a multi-turn default when no choice
  is set. Chatflow mode does not reveal whether the app uses prior context;
  select its turn policy manually. An unset Chatflow keeps its single-turn behavior.
- **LangChain:** Set the turn policy manually. Leaving it unset keeps the
  existing behavior. Agents that use the human-confirmation profile remain
  single-task per conversation.
- **Workflow and text generation:** These use independent runs, not
  conversational turns. They can run several times in one window without
  carrying context forward.

### Check Configuration Without Saving

The application create/edit form's top action row includes **Check configuration**,
alongside the default-application and parameter actions where applicable. Results
appear as dismissible notifications, like configuration-sync feedback, rather
than a separate panel at the bottom of the form. The notification includes the
checked capabilities and relevant limitations; editing the checked settings or
leaving the form dismisses the old result. Select an
enabled provider, choose the backend and fill in its required connection fields.
For LangChain, include the assistant ID. New applications need an API key;
existing applications can reuse their saved credential when the key field is
empty. A draft key overrides the saved key for this check only. It is neither
saved nor returned in the result.

The server uses the selected provider's saved base URL, not an arbitrary URL
submitted by the browser. When reusing an existing credential, its application
must still belong to that provider and backend. Check a changed backend with an
appropriate new credential rather than forwarding an old credential elsewhere.

Checks are read-only: Dify reads `/parameters`; LangChain reads `/capabilities`
and validates the selected assistant against the configured ordinary, human-input
or report/CSV integration. No generation, thread creation, approval, resume or
configuration save is performed. The bounded check can report authentication
failure, timeout, unavailable service, incompatible response or an unsupported
read-only interface. Unsupported does not prove the service itself is offline.

Changing connection or capability settings invalidates the displayed result;
check again even if you restore the old values. The result is temporary, tied to
the current form, and is not persisted as a permanent health certificate. A
successful check confirms only the relevant read interface and declared contract,
not that a model is enabled or that a complete conversation will succeed. Use
real functional acceptance separately. A paused new-task setting is distinguished
from missing upstream result support; existing history remains subject to the
normal read authorization rules.

Application cards reuse the existing description (including existing display
fallbacks) and let users expand the full text. Fill in the description with the
application's purpose and business restrictions; no AI-generated description or
additional purpose field is introduced. Entry-mode labels describe the configured
interaction, not model quality or an online availability guarantee. Provider
addresses, credentials and raw diagnostic responses are not added to cards.

### Dify

1. Publish the application in Dify and obtain its application-scoped Service API
   key. A GitHub token or Dify console credential is not a substitute.
2. Open API configuration and provider management. Add an enabled Dify provider
   with its Service API base URL, for example `https://dify.example.com/v1`.
   This address must be reachable from the API service, not just your browser.
3. Create a service instance, select that provider and the **Dify** backend,
   and enter its instance identifier, display name and application API key.
   The API URL shown by the form follows the selected provider.
4. Use the supported Dify synchronization controls to load application settings
   where appropriate. Confirm the actual upstream mode instead of relying only
   on the display name. Select the intended product category: a model entry for
   regular chat, or an application-marketplace entry with the matching Dify type.
5. Save and enable the instance. Configure visibility as described below, then
   test with an ordinary account. An enabled instance can still fail when the
   upstream application's model is disabled or its key cannot call that app.

For an application-marketplace **chatbot**, the form offers an opt-in shared
AG-UI interaction. It controls new conversations. Existing conversations keep
their original persistence path. Enable it for compatible chatbots and verify
the configured input fields and file limits with an ordinary user. Workflows,
Chatflows and model-selector entries keep their native interaction modes.

[Dify integration](DIFY-INTEGRATION.md) documents compatibility and current
administrator-only restrictions on workflow follow-up and file-preview routes.
Dify human-input submission is not implemented by the shared interaction.

### LangChain

1. Have the service owner implement and verify the
   [required LangChain contract](LANGCHAIN-INTEGRATION.md#required-service-contract).
   Installing the LangChain library or exposing an arbitrary LangGraph URL alone
   does not satisfy this contract.
2. Create an enabled LangChain provider with the service base URL reachable by
   every API replica. Use HTTPS outside a trusted network and no credentials in
   the URL.
3. Create a service instance with the **LangChain** backend, a unique instance
   identifier, display name, the service's **assistant identifier**, and the
   service token in the existing API-key field.
4. Save the application. LangChain uses the application marketplace, not the Dify
   model selector, and has no Dify configuration-sync operation.
5. Grant access, open `/apps` as an ordinary user and check two-turn text chat,
   refresh, history and logout/login persistence.

The server must have a stable `API_ENCRYPTION_KEY` to encrypt/decrypt stored
credentials. Keep service tokens out of chat messages, screenshots, exported
configuration and source control. Replacing this encryption key arbitrarily
breaks access to existing encrypted values.

### Optional LangChain File Input

Configure the assistant ID of a supported input-file profile. After applying
the Agent input file migration, verify that the application exposes its declared
attachment limits and that an ordinary user can send and reopen a sample file.
The upstream assistant controls file retention and supported formats.

### Optional LangChain Human Input

Use a separate application and the
[native human-input profile](LANGCHAIN-INTEGRATION.md#optional-native-human-input).
It requires the corresponding SQL migrations, upstream capabilities and
`config.langchain.human_input: true`. The current ordinary instance form exposes
the assistant ID but not a dedicated human-input switch; have the deployment
maintainer apply the reviewed advanced instance configuration using the existing
administrative configuration path. Do not invent a UI toggle or enable this
merely because an upstream service advertises a generic resume endpoint.

The profile supports a single approve/reject interruption and one task per
conversation, with an optional bounded comment. It does not provide arbitrary
forms, Dify human input, or automatic continuation after process loss. Test both
decisions, refresh while waiting and reopening the saved result before offering
it to users. Refresh/history must not themselves submit a decision.

### Task Chat Input Mapping

For native Dify Workflow and text-generation instances, use **Task text input**
in the existing instance configuration. **Automatic** maps the composer only when
there is exactly one free-text field. Choose an exact upstream variable to
override it, or **Parameters only** to keep all input in the parameter area.
The resolved mapping is displayed alongside the selection; syncing Dify parameters
does not discard an explicit choice. If a selected variable is removed upstream,
correct the mapping before accepting new tasks.

Several possible free-text fields are intentionally not guessed: users can fill
the separate parameters instead. Required files, counts and types still come from
the authorized live application capabilities. This UI does not give Workflow
conversational memory or migrate it to another execution protocol.

## 4. Visibility, Groups And Allowance

### Create A Group And Assign Access

1. Open `/admin/groups`, create a group with a name and optional description,
   and save. The form accepts a 2-50 character name and a description up to
   200 characters.
2. Open its member-management dialog. Add the intended existing website users;
   adding a group member does not create an account in the external Agent service.
   Use member search/removal when adjusting membership.
3. Open `/admin/permissions`, search/filter for the application and select it.
4. Set **Group only**, then enable the relevant group in its permission list.
   Membership without an enabled application permission is not sufficient.
5. When removing access, disable that permission or remove the membership as
   appropriate. Deleting a group is broader than removing one user's membership;
   protected pending quota can prevent deletion until work is reconciled.

In **Groups**, create a group and add the intended users. In **Permissions**,
select an application and set its visibility:

| Visibility | Meaning                                                            |
| ---------- | ------------------------------------------------------------------ |
| Public     | Available to active signed-in users; not anonymous internet access |
| Group only | Requires enabled access for a group the user belongs to            |
| Private    | Administrator-only access; not a per-user personal application     |

For group-only applications, enable each intended group's access and verify both
an allowed and a disallowed ordinary account. Switching away from group-only
visibility retains group grants, quotas and usage. Those grants apply only in
group-only mode and apply again when switching back. Access toggles preserve
existing quotas and usage; they do not reset or remove a limit.

For a long group list, search by group name or description and filter by
**All groups**, **Authorized** or **Not authorized**. The toolbar shows total,
authorized and matching group counts. Rows show the group name, member count
and a shortened description; hover over truncated text to read it in full.
Each access toggle saves immediately. While saving and refreshing that change,
the list keeps its confirmed values and marks the affected row as saving;
other access toggles are temporarily disabled. A failed write or refresh shows
an error with a retry action rather than treating unknown access as disabled.

Disabling an application/provider prevents new use, but
does not promise cancellation of a task already dispatched to the backend.

Group allowance, when configured, and concurrent-run admission are different
limits. The current group-permission list exposes access toggles, not a complete
quota-management console. Do not assume a visible toggle creates a finite quota
or resets usage. Server admission settings and quota semantics are documented in
[generation governance](AGENT-GOVERNANCE.md). Unknown or pending work can retain
capacity and prevent protected edits; do not reset counters or delete task rows
to bypass it.

## 5. Users And Authentication

### Find, Edit And Restrict Users

The user list offers search, role/status/auth-source filters, sorting and selection
for supported batch operations. Filter labels describe stored metadata; the
presence of an old provider name in a filter is not proof its login integration
is enabled on this installation.

1. Locate the account by its known identity and inspect its role, status and
   external attributes before changing it.
2. Open the edit dialog. Enabled fields can include display name, username,
   phone and avatar URL according to the source and returned editable-field list.
   Organizational/SSO identity fields may be locked. Do not remove those locks by
   changing the account's auth-source label.
3. Make a supported role/status change and confirm it. Roles are `admin`, `manager`
   and `user`; statuses are `active`, `suspended` and `pending`. `pending` here is
   an account status, not an Agent's waiting-for-confirmation state.
4. For batch changes or deletion, inspect the selection and confirmation before
   proceeding. User deletion is not the same as suspension and is not a promise
   to erase upstream data or backups.

Authentication email is read-only in user management; changing login identity
requires an appropriate verified authentication flow. Local profile edits,
including the avatar, remain in place after signing in again. External identity
fields continue to follow their provider's synchronization rules.

Administrators cannot change their own role or deactivate themselves, or
downgrade/delete another administrator. These rules apply to edit dialogs,
individual actions and batch requests. Unchanged roles do not block ordinary
profile edits. User and member selection is limited to the current page and
clears when changing pages or filters; review the selection before confirming.

Use **Users** to inspect accounts and make supported role/status changes. Suspend
or restrict an account according to your organization's policy; do not publish
user data when investigating an issue. App access is still subject to its own
visibility and group configuration.

Organizational provider records can be managed in **SSO Providers**. Server-level
auth configuration remains the operator's responsibility:

- GitHub OAuth App client ID/secret, the public button flag and callback origin
  are configured in the private environment, not a repository-access token and
  not the Agent-provider form.
- SMTP delivery, email disablement and phone OTP controls are server settings.
- A saved SSO record or visible button is not proof that the identity provider
  authorizes the deployment's callback URL. Test the real sign-in round trip.
- There is no universal admin panel that safely edits all environment variables
  or implements every legacy `auth_settings` database field as an active policy.
  Use the documented current controls, not raw-table field names as guarantees.

See [authentication configuration](CONFIGURATION.md#better-auth-and-sso).
Change one authentication mechanism at a time and preserve a verified recovery
method to avoid locking out administrators.

### Revoke All Login Sessions

An active administrator can select **Revoke all login sessions** in a user's
row menu and confirm. The result reports the number actually deleted and whether
targeted cache cleanup completed or remains pending. This also permits revoking
your own sessions, which sends you back to sign-in. It does not delete history.

Suspension preserves sessions: restoring an account can make its unexpired
sessions usable again. Revocation permanently deletes the sessions visible to
that operation; the user can sign in again and concurrent new sign-ins are not
part of that snapshot. For an emergency lockout, suspend first, then revoke.
Already accepted Agent replies may continue; revocation is not upstream cancel.

PostgreSQL session existence is authoritative, including Redis cache hits in
Web authentication. Ordinary API identity reads have a cache lifetime capped at
one second from lookup start and at session expiry; new Agent requests and
management authorization bypass that cache. In-flight requests already checked
can finish. Cache cleanup pending does not restore a deleted database session.

The administrator action is `users.revokeAllSessions` with `{userId}` through
the existing session-authenticated `POST /api/internal/data`. Never send a
browser-supplied actor or token list. A result-unknown response requires audit
lookup by `operationId` before a manual retry.

### Configure An Organizational Sign-In Record

1. Open `/admin/sso-providers` and create or edit the provider record. Set its
   name, protocol, enabled state, display order and button text/domain matching
   where appropriate to the form and deployment.
2. In protocol settings, enter the real identity-provider base URL and required
   endpoints. Configure attribute mappings against actual returned attributes,
   not merely the example mapping keys.
3. Review the security and UI tabs, including redirect-host settings and the
   desired icon/description. Use the raw-JSON editor only when the settings are
   understood; a saved setting is not evidence that every security field is
   enforced on every auth flow.
4. Have the operator align the public origin and the identity provider's callback
   authorization. A new domain/port can require both application rebuilding and
   identity-provider registration, not just a changed button URL.

The database-managed login conversion currently handles enabled **CAS** records.
Although the editor lists CAS, SAML, OAuth2 and OIDC, selecting another type there
does not automatically configure its runtime login. OIDC and generic OAuth runtime
providers use the separate Better Auth private server configuration described in
[configuration](CONFIGURATION.md#better-auth-and-sso). Do not advertise SAML or
arbitrary OAuth compatibility based solely on a database record or form choice.
GitHub uses its dedicated server-side social-provider setup, not this CAS record.

## 6. Content And Languages

For an enabled application's purpose, owner, permitted inputs and external data
destinations, complete the private
[application governance record](templates/application-governance.md). Put only
approved user-facing notices and a contact route in existing descriptions or
Home/About pages. They are not private incident storage.

In **Content**, choose Home or About and the language you want to edit. Save the
current edits before invoking translation. Translation is an explicit action
using the currently selected source language, not automatic synchronization on
every edit or user language change. Translate-all uses overwrite mode for other
supported languages: review the confirmation, results per language and important
copy afterwards. Partial failures do not mean every target language was updated.

### Edit Structure, Copy And Images

1. Choose Home or About, then select the language to edit. The canonical page
   structure is maintained in **English (`en-US`)**. Other languages edit localized
   content against that shared structure; their structural controls are locked.
2. In the source-language editor, use the available sections/components, ordering
   and property controls to compose the page. This is the built-in Home/About
   editor, not a general router or arbitrary executable HTML/application editor.
3. Edit localized text in each target language without inventing a different
   structural layout. Use the image upload/property controls when a component
   accepts an image, and provide appropriate descriptive text for images/links.
4. Use desktop/tablet/mobile preview and fullscreen preview to inspect the copy
   and layout. Previewing does not save or publish unsaved changes.
5. Save. If another change advanced the structure version, reload the latest
   content and reapply the intended edits; do not force an outdated page snapshot
   over someone else's structure. Preserve useful unsaved copy before reloading.
6. To populate other languages, save the chosen source language and invoke
   translate-all explicitly. Review per-language results and manually correct
   important content; selecting a different source language can overwrite the
   translations of other languages, including English text.

The current automatic translator uses the external MyMemory translation API,
not the configured Dify/LangChain application; review data handling before sending
private copy. Brand terms/placeholders have special
handling, but translation still needs editorial review. Do not put credentials
or confidential operational notes in public page content.

Runtime Home/About pages and compiled interface translations have different
delivery behavior. Saving general UI translations does not update an already
built Web application; the operator must prepare and rebuild it as described in
[editable content storage](CONFIGURATION.md#editable-content-storage). Operational
content lives outside the source checkout and must survive upgrades.

## 7. Configuration Changes And Troubleshooting

- For a different backend/service identity, create a separate application rather
  than repointing existing history. Backend changes with existing conversations
  are protected, and endpoint/assistant changes can invalidate trusted bindings.
- Rotating a credential for the same service identity can preserve history, but
  unresolved work may temporarily block it. Reconcile the upstream state before
  changing protected configuration. Disabling access and revoking a compromised
  upstream key remain incident actions; do not wait to contain a known exposure.
- Use **Errors** and the operator's logs to investigate failures. Record the time,
  application and sanitized error/request identifier; do not export session
  cookies, keys, personal conversations or raw provider responses into issues.
- A successful health check or admin configuration save does not establish that
  users can generate and retain results. Check the actual user path.

### Error And Realtime Views

Open `/admin/errors` for the last-24-hour summary and recent error list. The
current page requests 50 recent records and shows severity, error/source metadata,
occurrences and timestamps as available; use **Refresh** after investigating a
reproduction. It is an operational error view, not a searchable audit archive,
an alert-resolution system or a complete view of upstream execution.

The diagnostic page `/admin/realtime` shows current subscription/broker statistics
and publication failures with a refresh control. It can help distinguish a
stale list/update notification from a failed database save. It is not a substitute
for verifying the saved conversation and is not a user-facing chat room or a
general monitoring/queue-management console. Navigation exposure can differ from
the main admin dashboard; direct server-side authorization still applies.

### Restricted Management Audit

After applying `20261119100000_add_admin_audit_events.sql`, the first audit scope
covers user profile/role/status/create/delete and session revocation, group
membership/application grants and group deletion, API-key changes, application
visibility, and application/provider deletion that can remove grants or keys.
Ordinary provider configuration and SSO changes are not yet included. There is
no complete audit dashboard or claim of database-administrator tamper resistance.

Covered business writes and their safe before/after summaries share one
transaction. Audit failure rolls back those writes. Summaries contain IDs,
permissions and non-secret credential versions, not raw keys or request bodies.
Denied/failed writes attempt a separate safe record, which can itself fail.
The append-only runtime interface has no edit/delete action; user deletion does
not cascade-delete audit history. Batches/snapshots over 100 entries are rejected
rather than silently truncated; split large operational changes deliberately.

Current administrators can query the existing session-authenticated internal-data
interface, not a public or anonymous endpoint:

```json
{ "action": "audit.getRecent", "payload": { "limit": 25 } }
```

Optional filters are `operationId` and `action`; the next cursor is
`{"createdAt":"<exact created_at from last row>","id":"<last row id>"}`.
Preserve the returned PostgreSQL timestamp precision. Maximum page size is 100.
Copy only safe IDs into private support records. Do not blindly retry a management
write after `ADMIN_COMMIT_UNKNOWN`; look up its operation ID first. A missing
record without confirmed rollback still does not prove the operation failed.

## 8. Minimal Application Acceptance

Before announcing an application, verify:

1. An allowed ordinary account can find and open it; a disallowed account cannot.
2. Chat completes and saves; ordinary chat supports a second turn and survives
   refresh and logout/login. The single-task human-input profile instead starts
   a new conversation for another task.
3. Any promised attachments, confirmation or other special capability works on
   that specific backend/path, not only in upstream documentation.
4. A configuration or capacity failure produces a useful error rather than a
   duplicate task or a false saved result.

Give users the [user guide](USER-GUIDE.md). For unresolved runs, upgrades, backup
or recovery, involve the operator using [operations](OPERATIONS.md).

## 9. Enable Report And CSV Delivery

Use a separate LangChain marketplace instance for the supported frozen-result
profile. Select the assistant advertised by your service (`deep-agent` is an
example, not a required name), keep the provider URL at the service root and
enable the instance's result-artifact switch. Both the new and edit
forms preserve this setting. Leave it off for ordinary Agents, Dify and older
applications; the switch does not implement file uploads or cancellation. Ordinary
instances leave this optional setting absent. Once selected, disabling it saves
an explicit `false` to pause profile tasks without removing their result access.

The backend must implement the explicit
[result contract](LANGCHAIN-INTEGRATION.md#optional-frozen-result-profile).
The switch is configuration intent, not proof of connectivity: actual capability
compatibility is checked at dispatch and discovery. Test a real task, report/CSV
preview and download, refresh/history and a second ordinary user's access boundary
before offering the application. The result profile supports one batch per
conversation and is not a human-confirmation profile.

Turning the switch off pauses new tasks and continuation without rerouting to a
different Agent. Existing accepted work and authorized reads remain supported.
Changing the provider root or assistant invalidates the old binding; create a
separate application rather than reusing old conversations with another backend.
For unresolved execution or missing files, follow
[result troubleshooting](OPERATIONS.md#8-result-artifact-troubleshooting);
do not manually mark tasks successful merely because a file was found.
