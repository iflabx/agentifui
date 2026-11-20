---
layout: default
title: Operations Governance Template
parent: Installation and Operations
nav_order: 9
---

# Operations Governance Template

This is an unfilled worksheet, not proof that requests, backups or recovery have
been handled. Keep completed deployment records private and access-controlled;
reuse one private operations record with the
[application register](application-governance.md). Store evidence by restricted
reference, not by copying credentials or user content into this template.

Use **Unknown - pending confirmation** for unconfirmed facts and **Unverified**
for restoration without actual evidence. Product development acceptance does not
establish deployment recovery readiness. This template authorizes no changes,
restore drill, export, deletion or incident action.

## Record Ownership

| Field                                               | Entry |
| --------------------------------------------------- | ----- |
| Private installation/version reference              |       |
| Accountable operator and alternate                  |       |
| Approved public request contact                     |       |
| Private security and upstream escalation references |       |
| Review date and unresolved items with owners        |       |

## Request Intake And Identity Check

Repeat this section per request. Support problem reports, output disputes,
access issues and personal-data export/deletion requests. Do not assume that a
request to change an account proves control of that account.

| Field                                                             | Entry |
| ----------------------------------------------------------------- | ----- |
| Request identifier and category                                   |       |
| Received date, assigned responder and safe reply channel          |       |
| Target account/application, minimal private reference             |       |
| Trusted identity-check method, result, verifier and date          |       |
| Authority/consent to act for the target account                   |       |
| Requested scope and safe diagnostic identifiers                   |       |
| Approved action, authorizing operator and authorization reference |       |
| Current status, next step and responsible owner                   |       |
| Operator-defined response target, if agreed                       |       |

Verify identity through a trusted account or an operator-approved process before
disclosing or changing personal data. Do not ask users to email passwords,
tokens, reset links, full conversations or identity documents unnecessarily.
Keep verification evidence minimal and restricted. Feedback reactions are not
a formal request-intake system. Report product vulnerabilities through the
[private security policy](https://github.com/iflabx/agentifui/blob/main/SECURITY.md),
not a public issue containing private details.

## Handling And Reply

Use only capabilities verified for the installed version. There is no implied
universal export/deletion, unknown-task reconciliation or cross-provider erasure
tool. Escalate missing capabilities rather than marking the request complete.

| Scope boundary                                        | Requested handling | Actual action, date and evidence reference | Result | Unhandled scope/reason, next owner and step |
| ----------------------------------------------------- | ------------------ | ------------------------------------------ | ------ | ------------------------------------------- |
| Local account, access, conversations and task records |                    |                                            |        |                                             |
| Uploaded objects and encrypted archives               |                    |                                            |        |                                             |
| Logs, runtime content and temporary exports           |                    |                                            |        |                                             |
| Agent service and downstream recipients               |                    |                                            |        |                                             |
| Backups and previously downloaded/shared copies       |                    |                                            |        |                                             |

| Closure field                                                     | Entry |
| ----------------------------------------------------------------- | ----- |
| Reply date and safe delivery reference                            |       |
| Handled scope explained to requester                              |       |
| Unhandled scope, uncertainty and follow-up explained to requester |       |
| Temporary attachment/export cleanup rule and actual completion    |       |
| Minimal record retention and next review                          |       |

Do not call partial handling full erasure. Local deletion does not prove
upstream or backup deletion; restoring an older backup may reintroduce data.
Record how outstanding data requests will be considered during recovery.

## Backup Coverage

Record policy and observed execution separately. A storage location or successful
database dump alone does not establish complete, recoverable coverage. Key
entries contain only restricted backup identifiers and custodians, never values.

| Component                                                          | Covered/excluded/unknown and reason | Frequency and retention | Restricted location reference and access owner | Latest successful backup and evidence |
| ------------------------------------------------------------------ | ----------------------------------- | ----------------------- | ---------------------------------------------- | ------------------------------------- |
| PostgreSQL data, roles/grants and migration state                  |                                     |                         |                                                |                                       |
| Uploaded objects and result artifacts, where locally stored        |                                     |                         |                                                |                                       |
| Encrypted Workflow archive objects                                 |                                     |                         |                                                |                                       |
| Persistent runtime content and snapshots                           |                                     |                         |                                                |                                       |
| Runtime configuration and required authentication/encryption keys  |                                     |                         |                                                |                                       |
| Logs and other retained operational state, where required          |                                     |                         |                                                |                                       |
| External Agent/model/identity service state or explicit exclusions |                                     |                         |                                                |                                       |

Confirm that database records, encrypted objects and matching decryption
keys/configuration form a recoverable set. Restrict access to key backups and
retain keys required to read historical backups. See
[backups and recovery](../OPERATIONS.md#6-backups-and-recovery) and
[credential incidents](../CREDENTIAL-INCIDENTS.md).

## Restoration Evidence

Without a recorded isolated restore and observed readability checks, record the
overall result as **Unverified**, not passed. Any new drill requires separate
authorization and isolated resources; do not test against live business data.

| Field                                                                   | Entry |
| ----------------------------------------------------------------------- | ----- |
| Acceptable data loss and recovery time, operator-approved targets       |       |
| Latest isolated restoration date, owner and authorization               |       |
| Restored application/database version and migration state               |       |
| Matched database/object backup and private configuration/key references |       |
| Account/access, history and encrypted credential readability results    |       |
| Uploaded file, result artifact and Workflow archive readability results |       |
| Measured recovery point/time and evidence reference                     |       |
| Outstanding deletion requests and restored-data handling                |       |
| Overall status, exclusions, failures and follow-up owner                |       |

## External Services And Incidents

| External service/category             | Retention/deletion terms and evidence reference | Revocation/cancellation route and known limits | Owner and confirmation status |
| ------------------------------------- | ----------------------------------------------- | ---------------------------------------------- | ----------------------------- |
| Agent/model/tool providers            |                                                 |                                                |                               |
| Identity/email/other enabled services |                                                 |                                                |                               |

Repeat the following fields per incident. Follow
[credential incident handling](../CREDENTIAL-INCIDENTS.md) for suspected exposed
tokens; this worksheet is not an automatic detector or action trigger.

| Incident field                                                      | Entry |
| ------------------------------------------------------------------- | ----- |
| Incident identifier, discovery time and reporter                    |       |
| Affected applications, accounts, data and scope still unknown       |       |
| Restricted evidence reference and assigned incident owner           |       |
| Explicit operator authorization: who, scope, time and reference     |       |
| Temporary access/entry containment and business impact              |       |
| Upstream credential revocation: attempt, confirmation or failure    |       |
| Session revocation: actual action/result or not performed           |       |
| Accepted/unknown work, authorized reads and unresolved side effects |       |
| Recovery decision, verified checks and remaining limitations        |       |
| User notification decision, rationale, owner and date               |       |
| Closure, retained evidence and follow-up actions with owners        |       |
