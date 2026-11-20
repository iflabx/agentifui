---
layout: default
title: Application Governance Template
parent: Installation and Operations
nav_order: 8
---

# Application Governance Template

This is an unfilled template, not an adopted policy or evidence of deployment
readiness. Complete it for each enabled application. Mark unconfirmed facts
**Unknown - pending confirmation**; do not infer that data is never retained or
used for training. Review the record when the application or its recipients change.

Publish only approved user-facing information in the application's description
or the existing Home/About content editor. Descriptions are visible to users who
can access the application; Home/About content is public. Keep completed private
records outside public source control. Never include credentials, internal URLs,
private contact details, raw conversations or incident evidence in public copy.

## Application Record

| Field                                                        | Entry |
| ------------------------------------------------------------ | ----- |
| Application display name                                     |       |
| Record owner and reviewer, private reference only            |       |
| Review date and next review                                  |       |
| Enablement date and configuration/version reference          |       |
| Private application identifier                               |       |
| Intended audience and business purpose                       |       |
| Supported tasks                                              |       |
| Prohibited uses and situations requiring human review        |       |
| Supported files, outputs and human-confirmation capabilities |       |
| Current limits and unsupported features                      |       |
| Acceptance evidence reference and unresolved limitations     |       |

## Data Destinations And Permitted Inputs

Use service names or categories in public copy. Keep the full recipient chain,
deployment regions, contract references and internal identifiers in the private
record. Include downstream model/tool recipients, not only the first Agent API.

| Processing boundary                                       | Recipient/category | Data sent | Region and contractual evidence, private reference | Confirmation status |
| --------------------------------------------------------- | ------------------ | --------- | -------------------------------------------------- | ------------------- |
| Local application, database, storage and operational logs |                    |           |                                                    |                     |
| Agent service                                             |                    |           |                                                    |                     |
| Downstream models and tools                               |                    |           |                                                    |                     |
| Other enabled identity, email or translation services     |                    |           |                                                    |                     |

| Input rule                             | Entry |
| -------------------------------------- | ----- |
| Allowed data types and classifications |       |
| Prohibited or restricted data          |       |
| File and attachment restrictions       |       |
| Exception approval/contact route       |       |
| Basis and owner confirming these rules |       |

Self-hosting the UI does not imply local-only inference. Describe only transfers
and capabilities verified for this application and backend.

## Retention, Deletion And Training

Document local and upstream behavior separately. A local deletion is not proof
of removal from upstream systems, backups, downloaded files or other recipients.

| Boundary                                         | Retention and purpose | Export/deletion request route and limits | Evidence reference and confirmation status |
| ------------------------------------------------ | --------------------- | ---------------------------------------- | ------------------------------------------ |
| Local conversations, tasks and identity records  |                       |                                          |                                            |
| Uploaded objects and encrypted Workflow archives |                       |                                          |                                            |
| Logs, temporary exports and runtime content      |                       |                                          |                                            |
| Backups and retained copies                      |                       |                                          |                                            |
| Agent service                                    |                       |                                          |                                            |
| Downstream models/tools and other recipients     |                       |                                          |                                            |

| Upstream use question                                                     | Confirmed answer, or Unknown - pending confirmation | Evidence reference and review date |
| ------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------- |
| Does the Agent service retain inputs or outputs?                          |                                                     |                                    |
| Can inputs, outputs or files be used for training or service improvement? |                                                     |                                    |
| Do downstream providers have different retention or training terms?       |                                                     |                                    |
| What deletion or opt-out mechanism is actually available?                 |                                                     |                                    |

## User Contact And Notice

| Field                                                                                 | Entry |
| ------------------------------------------------------------------------------------- | ----- |
| Approved public contact or form entry                                                 |       |
| Supported request categories: problem report, output dispute, access, export/deletion |       |
| Safe diagnostic information to provide                                                |       |
| Privately assigned responder and escalation owner                                     |       |
| Response expectations approved by the operator, if any                                |       |
| Published notice location and last verification                                       |       |

Ask for a request/error identifier, approximate time and a non-sensitive problem
description. Do not request passwords, tokens, reset links or complete sessions.
Likes/dislikes are product feedback, not a formal complaint or data-request
channel. Do not invent a response-time guarantee.

Replace every placeholder before publishing this optional notice outline:

```text
Purpose: [Supported purpose and intended audience]
Limits: [Unsupported uses and when a person must verify the output]
Data destinations: [Agent service and relevant downstream recipients]
Allowed input: [Permitted types and explicit prohibited data]
Retention and deletion: [Separate local/upstream rules, unknowns and limits]
Upstream training use: [Confirmed terms, or Unknown - pending confirmation]
Contact: [Approved public entry for problems, access and data requests]
```

Use the [administrator guide](../ADMIN-GUIDE.md#3-configure-a-provider-and-application)
for existing configuration controls and its
[content guidance](../ADMIN-GUIDE.md#6-content-and-languages) for Home/About copy.
See [data-handling boundaries](../SECURITY-PRIVACY.md) and the
[operations record template](operations-governance.md) for private follow-up.
