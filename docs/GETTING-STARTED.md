---
layout: default
title: Getting Started
nav_order: 2
has_children: true
---

# From Installation To Your First Conversation

This guide connects the installation, administrator and user instructions into
one path. It does not replace their detailed commands. If you only want to use
an existing installation, ask its operator for the URL and start at
[sign-in](USER-GUIDE.md#1-sign-in-and-recover-access). If you want to change the
source code, use the [developer guide](DEVELOPMENT.md).

AgentifUI is the website in front of existing Agent services. It does not ship
a model account, Dify application, LangChain Agent implementation or default
administrator password.

## 1. Understand The Main Concepts

| Concept                        | What it means here                                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Website account                | The identity that signs in to AgentifUI; owns local conversations and receives application access                                  |
| Login provider                 | Email/password, GitHub or an organizational identity service; not the Agent service answering questions                            |
| Agent provider                 | An administrator-managed Dify/LangChain endpoint and metadata                                                                      |
| Service instance / application | One configured application, backend profile and encrypted service key that users can access                                        |
| Model entry                    | A configured Dify entry in regular chat's model selector; not every marketplace application appears there                          |
| Conversation                   | Local history associated with its owner and application, with native backend bindings when needed                                  |
| Run / task                     | An execution attempt or task tracked separately from the connection and whether its result was saved                               |
| Human confirmation             | An explicitly enabled LangChain approve/reject interaction, not a generic form or a feature of every Agent                         |
| Operator / administrator       | The operator controls services and server settings; the website administrator manages application records, users, groups and pages |

```text
Operator installs Web/API + isolated data services
  -> Website account and first administrator
  -> Administrator configures an Agent provider/application
  -> Administrator grants intended user access
  -> User opens the correct chat/application entry
  -> Answer completes and history is saved
```

## 2. Choose A Version And Installation Method

For an installed service, choose a confirmed release from
[GitHub Releases](https://github.com/iflabx/agentifui/releases), inspect its notes
and use the documentation from that tag. A page on `main` can describe newer
unreleased work. Do not use an old tag's configuration with a newer branch's
installer and assume all files or migrations are equivalent.

| Method             | Choose it when                                                               | Follow                                                                   |
| ------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Docker Compose     | You want application containers and optional bundled data-service containers | [Docker installation](DOCKER.md)                                         |
| Host/PM2           | You manage Node, application processes and dependencies on the host          | [Host deployment](QUICK-DEPLOYMENT.md)                                   |
| Source development | You are editing the product and need development feedback                    | [Developer setup](DEVELOPMENT.md#2-prepare-a-local-development-instance) |

Docker and PM2 are alternatives, not consecutive setup steps. Begin with one Web
and one API service; manual multi-replica capacity is an optional later step, not
a prerequisite for your first conversation.

You need PostgreSQL, Redis, S3-compatible storage and a reachable, published Agent
application. A Dify app needs its application-scoped Service API key and enabled
model. A LangChain service must implement the specific
[AgentifUI service contract](LANGCHAIN-INTEGRATION.md#required-service-contract);
an arbitrary LangChain library installation or generic HTTP endpoint is not enough.

## 3. Configure And Initialize The Installation

Use the chosen runbook's private configuration template and initialization steps.
Before starting, decide:

- The real browser-facing origin, such as `https://agents.example.com`, including
  any nonstandard port; align auth callbacks, proxy forwarding and allowed origins.
- Separate application and migration-owner database credentials, a Redis namespace
  and storage bucket for this installation. Never use production data for tests.
- Private authentication and encryption keys and an external, persistent runtime
  content location. Preserve the same encryption key when reusing stored tokens.
- A usable login method. Public email signup/reset needs real SMTP unless those
  email flows are deliberately disabled; development token logging is not public
  mail delivery. GitHub and SSO require their own configured credentials/callbacks.
- A browser-reachable storage-signing endpoint when it differs from the server's
  internal storage address.

Complete the runbook's schema, runtime-role grants, storage/content initialization,
build and startup steps. A process/container being healthy is only the startup
checkpoint; it does not create an Agent application or prove login and history.
Use the [key configuration reference](CONFIGURATION.md#key-settings-reference)
and [security checklist](SECURITY-PRIVACY.md#4-before-exposing-an-installation)
when checking these choices.

## 4. Create The First Administrator

1. Open your installation's normal address. Keep initial setup restricted to the
   intended operator while preparing the administrator account.
2. Create/sign in to that account using an intentionally enabled login method.
   For email registration, complete verification. The first registered account
   is **not** automatically an administrator.
3. Have the database operator promote the intended account using the reviewed
   [bootstrap procedure](ADMIN-GUIDE.md#1-bootstrap-the-first-administrator).
   Confirm its actual identity before changing the role.
4. Sign out/in and open `/admin`. There is no default account to discover or
   password to reuse from an online tutorial.

Later user-role changes use the supported administrator UI. Do not grant every
registrant administrator access to avoid configuring application permissions.

## 5. Connect One Application And Grant Access

Open `/admin/api-config` and follow the appropriate procedure:

- **Dify:** [provider/application setup](ADMIN-GUIDE.md#dify). Use the published
  app's Service API address, commonly ending in `/v1`, and its application key,
  not the Dify console URL/login. Select model versus marketplace category and
  the actual chatbot/chatflow/workflow/text-generation subtype.
- **LangChain:** [provider/application setup](ADMIN-GUIDE.md#langchain). Configure
  the reachable service URL, supported assistant identifier and encrypted service
  token. Use the marketplace entry rather than trying to add it to the Dify model
  selector. Begin with ordinary text chat unless you specifically need and have
  implemented the native human-input profile.

Save and enable the provider/instance. In `/admin/permissions`, choose the
intended visibility. **Public** means active signed-in users, not anonymous
internet access; **Group only** needs both membership and enabled group access;
**Private** is administrator-only. See [access setup](ADMIN-GUIDE.md#4-visibility-groups-and-allowance).
Users do not paste upstream service keys into their browsers.

Consult the [compatibility matrix](COMPATIBILITY.md) before enabling attachments,
shared AG-UI or human input. A backend advertising a feature does not mean this
particular AgentifUI path exposes it.

## 6. Have Your First Conversation

Use an intended ordinary account, not only the bootstrap administrator:

1. For a **model entry**, open regular chat and choose its configured Dify model.
   For a **marketplace application**, open `/apps` and select its card; LangChain
   applications are found here.
2. Send a short, non-sensitive question once. Wait for the response and any saving
   indicator to settle. Follow-up questions use the same ordinary conversation.
3. For an ordinary conversational app, send a second question, then refresh and
   reopen the conversation through the sidebar or `/chat/history`.
4. Sign out/in with the same identity and reopen the saved conversation. Logout
   should not delete saved history.

For a workflow or text-generation app, complete its form and use its separate
execution-history/result view instead of assuming it behaves like regular chat.
For an explicitly enabled human-input app, follow its confirmation/result flow
and start a new conversation for another task; it is a single-task profile.
See the [user guide](USER-GUIDE.md) for these controls and message actions.

These steps describe how an installer checks their service; this document is not
evidence that any particular installation, release, email or SSO flow has passed.

## 7. If You Get Stuck

| Checkpoint                                          | Most useful next check                                                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Cannot open the site                                | Actual listener/proxy, HTTPS, startup errors and selected installation runbook                                       |
| Cannot register or log in                           | Enabled login method, origin/callback, auth migrations and operator's private settings                               |
| No models available                                 | Model versus `/apps` entry point, backend/category and enabled instance; LangChain is not a model-selector entry     |
| Administrator sees an app but users do not          | User status, visibility, group membership and enabled application permission                                         |
| App opens but no response                           | Backend reachability/key, assistant/app identity, published version and enabled upstream model                       |
| Answer appears but history is missing               | Same identity, saving/run status and database errors; do not regenerate merely to repair saving                      |
| Email response is successful but no message arrives | SMTP delivery errors, authorized sender, recipient throttling and actual inbox; HTTP success does not prove delivery |

Use [operations and diagnosis](OPERATIONS.md#3-diagnose-in-request-order) rather
than repeatedly reinstalling or clearing data. For support, share sanitized
version, time, request ID and reproduction steps, never credentials or real
conversation exports. Next read the [administrator guide](ADMIN-GUIDE.md),
[user guide](USER-GUIDE.md) and [operations guide](OPERATIONS.md) for your role.
