---
layout: default
title: Documentation
nav_order: 1
permalink: /
---

# Documentation

AgentifUI is an enterprise-oriented Agent UI, not an agent-building or model-hosting
platform. Connect an existing Dify application or a compatible LangChain Agent
service; AgentifUI supplies the website, identity, application access, conversation
history and supported interactions.

Use the documentation bundled with the source tag or commit you install. Documents
on `main` can describe features and migrations newer than the latest release.
The guides describe implemented capabilities, not the full capabilities of every
upstream service or every event allowed by AG-UI.

New to self-hosting AgentifUI? Follow
[from installation to your first conversation](GETTING-STARTED.md) for the
complete path and core concepts. Use the detailed runbooks below for commands.

## Install And Operate Your Own Instance

1. Choose [Docker Compose](DOCKER.md) or [host/PM2 deployment](QUICK-DEPLOYMENT.md).
   These are alternative application installation paths, not sequential steps.
2. Set private environment values using the [configuration guide](CONFIGURATION.md)
   and the matching `.env*.example` template. Both paths need PostgreSQL, Redis,
   S3-compatible storage and access to the chosen Agent backend.
3. Complete account bootstrap and application setup in the
   [administrator guide](ADMIN-GUIDE.md).
4. Follow [operations and troubleshooting](OPERATIONS.md) for health checks,
   upgrades, backups, recovery and incident handoff.

Start with one Web and one API service. If usage requires more capacity, use
[manual Docker capacity](DOCKER-CAPACITY.md) for the optional host-network Docker
mode, or the [PM2 performance reference](SINGLE-HOST-HIGH-CONCURRENCY.md).
Neither is an automatic scaling system or a required first-install step.

## Compatibility, Security And Versions

- [Compatibility and capabilities](COMPATIBILITY.md): application paths,
  persistence owners, feature differences, service targets and version/upgrade
  navigation. A backend's native feature is not automatically a product feature.
- [Deployment security and data handling](SECURITY-PRIVACY.md): local/external
  data flow, secrets, public exposure, retention/deletion and current limits.
- [Security policy](https://github.com/iflabx/agentifui/blob/main/SECURITY.md): privately reporting a vulnerability and
  remediation/version-support boundaries.
- [GitHub Releases](https://github.com/iflabx/agentifui/releases): published change
  notes. Use the selected tag's docs rather than assuming `main` is a release.

## Manage Or Use An Instance

| Reader          | Start here                            | Covers                                                                           |
| --------------- | ------------------------------------- | -------------------------------------------------------------------------------- |
| Administrator   | [Administrator guide](ADMIN-GUIDE.md) | Providers, applications, credentials, users, groups, access and content          |
| End user        | [User guide](USER-GUIDE.md)           | Sign-in, choosing an application, chat, history, human confirmation and settings |
| Server operator | [Operations](OPERATIONS.md)           | Routine checks, failure diagnosis, deployment handoff and recovery               |

Administrators configure application records through the website; operators
configure server secrets, networking and deployment. The website is not a general
editor for server environment files.

## Current Feature Map

| Area                       | Current functionality                                                                                             | Guide                                                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Accounts                   | Email/password, configurable GitHub/SSO/phone OTP, verification and password-reset email                          | [User access](USER-GUIDE.md#1-sign-in-and-recover-access), [auth configuration](CONFIGURATION.md#better-auth-and-sso) |
| Application catalog        | Search, categories/tags, grid/list and favorites; permitted model/app entry points                                | [Choosing applications](USER-GUIDE.md#2-choose-a-model-or-an-application)                                             |
| Conversations              | Streaming messages, shared rich rendering, copy and path-specific edit/regeneration/feedback                      | [Conversation use](USER-GUIDE.md#3-start-and-continue-a-conversation)                                                 |
| History                    | Sidebar/history list, title/last-preview search, rename and deletion                                              | [History](USER-GUIDE.md#4-find-and-manage-history)                                                                    |
| Task interaction           | Supported tool summaries and opt-in LangChain approve/reject confirmation                                         | [Human input](USER-GUIDE.md#5-respond-to-human-confirmation)                                                          |
| Report delivery            | Opt-in frozen Markdown/CSV results, source excerpts, authorized preview/download and saved result history         | [Reports and data](USER-GUIDE.md#9-reports-data-and-sources)                                                          |
| Structured applications    | Dify workflows/text generation, supported forms, progress, result viewers and execution history                   | [Application capabilities](USER-GUIDE.md#6-files-stopping-and-other-capabilities)                                     |
| Personalization            | Editable profile/avatar, theme, display timezone and ten interface locales                                        | [Settings](USER-GUIDE.md#7-personal-settings-and-sign-out)                                                            |
| Application administration | Dify/LangChain providers, instances, encrypted keys, categories and supported protocol choices                    | [Application setup](ADMIN-GUIDE.md#3-configure-a-provider-and-application)                                            |
| Access management          | User roles/status, groups/membership and application visibility/group permissions                                 | [Groups/access](ADMIN-GUIDE.md#4-visibility-groups-and-allowance), [users](ADMIN-GUIDE.md#5-users-and-authentication) |
| Public pages               | Home/About structure, localized copy, images, responsive preview and explicit translation                         | [Content management](ADMIN-GUIDE.md#6-content-and-languages)                                                          |
| Operations                 | Docker/PM2, optional manual capacity changes, health/errors, persistent content, upgrade/backup/recovery guidance | [Operations](OPERATIONS.md)                                                                                           |

Availability depends on backend, application mode and deployment configuration.
General file-artifact lifecycle, arbitrary human-input forms, universal crash
recovery, A2UI/MCP Apps and new Agent backends are not implied by this table.

## Integration And Development References

- [Developer guide](DEVELOPMENT.md): local setup, source map, daily editing,
  debugging, validation and backend/AG-UI extension boundaries.
- [Contributing](https://github.com/iflabx/agentifui/blob/main/CONTRIBUTING.md): forks/branches, PRs, checks, hooks and safe publication.
- [Dify integration](DIFY-INTEGRATION.md): supported Service API modes and limits.
- [LangChain integration](LANGCHAIN-INTEGRATION.md): required service contract and
  optional native human-input profile; an arbitrary LangChain endpoint is not enough.
- [AG-UI integration](AGUI-INTEGRATION.md): shared product interaction and protocol boundaries.
- [Generation governance](AGENT-GOVERNANCE.md): authorization, moderation, admission,
  submission identity and quota behavior.
- [Architecture](architecture.md) and [database design](DATABASE-DESIGN.md): runtime
  boundaries, persistence, migrations and RLS.
- [Test environments](TEST-ENV.md): isolated data services, synthetic integration
  coverage and CI parity.
- [Publishing safely](PUBLICATION.md): public code versus private configuration.
- [Fonts](FONTS.md): frontend font configuration.
- [Documentation site](DOCUMENTATION-SITE.md): Jekyll content, navigation,
  GitHub Pages publishing and the custom domain.

## Documentation Boundaries

Examples use fictional domains, accounts and paths. Replace them privately; never
publish credentials, database exports, user conversations or deployment-specific
configuration in issues or pull requests. An enabled UI option is not proof of
upstream compatibility. Check the chosen backend's guide before advertising files,
human input, cancellation or recovery to users.
