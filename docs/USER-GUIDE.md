---
layout: default
title: User Guide
nav_order: 4
---

# User Guide

This guide covers the current AgentifUI interface. Your administrator chooses the
available applications, sign-in methods and permissions. Button labels can differ
with the selected language and site branding. Ask your administrator for the
instance URL; a GitHub repository account does not automatically grant access to
a separately deployed instance.
For differences between application modes, see the
[compatibility reference](COMPATIBILITY.md). Ask the operator about their data
policy; [security and data handling](SECURITY-PRIVACY.md) explains the product's
general storage, external-service and deletion boundaries.

## Quick Navigation

| I want to...                                          | Read                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------- |
| Sign in, register or reset a password                 | [Access](#1-sign-in-and-recover-access)                              |
| Find the right Agent or model                         | [Applications](#2-choose-a-model-or-an-application)                  |
| Send messages, read results or understand task status | [Conversations](#3-start-and-continue-a-conversation)                |
| Reopen, rename or delete saved conversations          | [History](#4-find-and-manage-history)                                |
| Approve or reject an Agent's requested action         | [Human confirmation](#5-respond-to-human-confirmation)               |
| Use attachments or run a workflow                     | [Application capabilities](#6-files-stopping-and-other-capabilities) |
| Change my profile, language, theme or timezone        | [Personal settings](#7-personal-settings-and-sign-out)               |

## 1. Sign In And Recover Access

1. Open the instance's normal HTTPS address and go to `/login`.
2. Use an enabled method: email/password, GitHub, organizational SSO or phone OTP.
   A missing button usually means that method is not enabled for this instance.
3. If registration is available, use `/register` and follow the verification email.
   Check the sender and destination before opening a link. Never send your
   password, reset link or verification code to support.
4. For a local password, use `/forgot-password` and open the reset email. After a
   successful reset, sign in again; previous sessions are revoked. For an SSO
   password, use your organization's identity provider instead.

Email signup and password reset can be disabled by the operator. A generic reset
response does not prove the email was delivered or that an account exists. Check
spam and allow time for delivery; repeated requests are limited. If you normally
use GitHub or SSO, continue using the original method: signing in through another
provider with the same email can be restricted by account-linking policy.

## 2. Choose A Model Or An Application

- The regular chat's model selector lists configured, accessible Dify model entries.
- The application list at `/apps` exposes configured applications, including
  LangChain Agents and Dify chatbot, chatflow, workflow and text-generation entries.
- LangChain Agents are opened from the application list, not the Dify model
  selector. An empty selector does not necessarily mean no applications exist.
- The list depends on your account, group membership, application visibility and
  whether the application/provider is enabled. A public application still requires
  an active signed-in account; it does not mean anonymous access.

If an expected entry is missing or shows **No models available**, check that you
are in the intended entry point and ask the administrator to verify configuration
and access. Users do not need an upstream Dify or LangChain service token.

### Browse, Search And Favorite Applications

Cards use the application's existing description. Choose **Read full description**
to expand it without opening the application. The application-name button opens
the entry; the favorite button is separate and also available by keyboard.
Interaction labels distinguish conversation, workflow, text generation or the
platform's configured text interaction. They do not promise that the upstream
model is currently available. An explicitly selected text-only entry states its
attachment, citation, voice and custom-variable limitations. Missing descriptions
or capability information are not automatically generated.

1. Open the application list. Search by application name, description or tags.
2. Use the category/tag filters to narrow the list. Clear both the search and
   category when investigating a missing application.
3. Switch between grid and list views if useful. Open an application card to
   enter its own conversation or execution page.
4. Use the card's star control to add/remove a favorite. Favorites/common-app
   filtering and the sidebar provide shortcuts to frequently used applications.
   A favorite does not grant access or keep a disabled application available.

Favorites are retained in this browser's local storage. Clearing site data or
using another browser/device can change that list; it is not a guaranteed
account-wide synchronized preference.

### Understand The Application Types

| Entry                        | Typical use                                            | What you interact with                                                          |
| ---------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Regular model chat           | General questions and follow-up conversation           | Chat input and a configured Dify model selector                                 |
| Dify chatbot or legacy Agent | A published conversational application                 | Messages, plus enabled application-specific controls                            |
| Dify chatflow                | Conversation backed by a workflow                      | Chat and supported input fields; execution/node progress where available        |
| Dify workflow                | A task submitted with structured inputs                | Input form, execution status, result and application execution history          |
| Dify text generation         | Generate text from a configured input form             | Inputs, generated text and execution records                                    |
| LangChain Agent              | Conversation with a compatible externally hosted Agent | Shared chat/history, supported tool activities and optional native confirmation |

An application's name or tag is descriptive, not a guarantee of capability.
For example, choosing an application called "Document Assistant" does not enable
upload if its actual backend/profile does not support it.

## 3. Start And Continue A Conversation

1. Open the model or application you want to use.
2. Enter a question and submit once. Some Dify applications require additional
   input fields; fill the fields shown by that application.
3. Wait for the response and any execution/saving indicator to settle. Receiving
   streamed text alone is not proof the complete result has been saved.
4. For ordinary conversational applications, send the next question in the same
   conversation. Open the sidebar or history to return to an existing conversation.
5. After completion, refresh and reopen the conversation to check persisted history.

The shared Agent chat uses the normal product message components and history
entry points. An application may show tool names and progress as activities;
these are controlled summaries, not raw tool parameters or results and not
permission to execute a tool in your browser.

When the interface reports incomplete saving or an unknown result, keep any
important visible text until the issue is resolved. Use the available status/save
retry to check the same run; it does not generate another response. If the state
does not settle, contact the administrator rather than repeatedly submitting the
question. Navigating away, closing the browser or losing the network does not
prove the upstream task was cancelled.

### Input And Message Actions

Dedicated application pages share the same composer and introduction: the configured
application name appears above its muted description, immediately above the input.
There is no generic visible placeholder. This introduction is not a message or model
input; it disappears after the first request is accepted, not on a rejected send,
and returns for a new task or conversation. The model homepage keeps its existing
greeting and input defaults. A configured Dify opening statement can appear as
supplementary guidance; it does not replace the application's description.

Chatflow uses the standard chat composer to start a single-turn task. Attach files with the button inside
the input box; selected files appear as cards there, with upload status, remove
and retry actions. A single available purpose opens the file picker directly.
When several purposes are available, choose the purpose first; each has its own
file count and limit. The attachment icon stays visible and is disabled when local
uploads are unsupported, unavailable, or the current draft is full. A short hint
states the required or maximum count and how many files have been added; removing
an item makes room to select another. Multiple purposes retain separate limits.

Non-file Chatflow settings appear directly above the composer before the first
message, with subdued guidance and no expand action. The administrator's application
description appears above the input using the same typography as assistant replies;
it is introductory text, not a saved or upstream message. Required fields must still
be completed before sending. Once the conversation starts, the description, guidance and
settings disappear to leave room for messages; initialization values remain fixed
for that conversation. Start another conversation to change them. Reopening
history does not show the initialization form again. Initial files remain
accessible from their original messages.

The application type configured by an administrator determines native execution
semantics: Workflow and Text Generation perform an independent task per send.
For now, the product also presents Chatflow as one task per conversation: while
running, the stop action remains available; afterwards, **Start new task** replaces
the composer. Chatflow follow-ups and edit-and-resend are not offered. Starting a
new task opens a fresh conversation and requires its own parameters and files.
Existing history, including older multi-turn conversations, remains readable.
The notice does not imply that a failed or stopped task completed successfully;
requests rejected before acceptance retain their editable inputs for retry.
This is a product UI convention, not a Dify API limitation or server-enforced
maximum-turns policy. Ordinary chat and LangChain agents are unaffected. Declared
application types must still match their actual backend API.

In the shared chat input, **Enter** submits when sending is available and
**Shift+Enter** inserts a newline. Composition with an input method is not a
request to submit. You can also use the send button. Empty input, an unfinished
upload or an unresolved task may prevent sending; read the current status before
trying again.

Use the actions actually present on a message:

- **Copy** copies available message text. Browser clipboard permission and a
  secure context can affect whether copying succeeds.
- **Edit and send** on a historical user text message opens an editor at that
  message's original position, containing only the original question. Edit it and
  choose **Send** (or press Ctrl/Cmd+Enter); Enter inserts a newline. Choose
  **Cancel** or press Escape to leave without changing the conversation. Sending
  immediately shows the revised question and temporarily hides its old answer and
  subsequent turns while the request is being confirmed. Once accepted,
  the conversation continues from that position with the revised question and new
  answer; the superseded question and subsequent turns no longer appear in the
  current conversation view, including after reopening history.
  The backend retains the old records and appends the revision to the same Agent
  conversation. It supplies an implicit correction instruction, not displayed in
  your message, to favor the new request. This is not a context reset or a true
  branch: old context may still influence the model, and past tool effects are not
  undone. Repeated identical requests or failed earlier requests can also make the
  intended correction ambiguous to the model. Both your text and the implicit
  instruction count toward request limits.
  Your unsent draft and selected attachments in the bottom composer are preserved;
  ordinary sending is disabled while editing. A definite refusal restores the old
  conversation view and reopens the editor with your changes. A network interruption
  or timeout does not prove rejection: the provisional view stays in place, with
  sending blocked until the result can be confirmed. Use the status check rather
  than sending again. Failure after acceptance does not restore the old path.
  Historical attachments are not copied to the
  edited request, and the inline editor currently sends text only. To send new files,
  cancel editing and use the normal composer if the application supports uploads.
  Existing application parameters remain in effect. Single-task applications, workflow
  records, attachment-only messages and non-user messages do not offer this operation.
  Running tasks, unresolved saves and pending human input retain their normal limits.
- **Regenerate**, where offered, requests another answer. Neither action repairs an
  incompletely saved run. Each accepted new request follows normal usage and permission
  rules. Refresh or reopen history to check that the current conversation view persists.
- **Useful/Not useful** feedback is offered only on paths wired to feedback.
  Selecting feedback does not modify the answer or guarantee an upstream model
  will be retrained.
- Suggested follow-up questions, when supplied, are shortcuts for another
  question. They are not steps the Agent has already performed.

Shared visual components do not mean every backend supports every action.
In particular, the shared LangChain/negotiated Dify path does not inherit legacy
regeneration or feedback merely because it renders the same message layout.

### Read Rich Results

Messages can render supported Markdown, tables, mathematical notation and code
blocks. Code blocks provide copy/export controls when available; exporting a
code snippet downloads text, it does not execute the code. Review generated code
before using it.

Some existing Dify responses include collapsible reasoning blocks or reference
sources. Expand a reference to inspect the provided document/excerpt and available
metadata. A displayed relevance score is not a factual-accuracy guarantee. These
controls appear only when the response/path actually supplies the relevant data;
they are not promised on all AG-UI or LangChain conversations.

### Understand Execution And Saving Indicators

| Displayed state          | Meaning and next action                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Preparing/running        | The current request is being admitted or executed; wait instead of submitting duplicates                     |
| Waiting for confirmation | Read and answer the confirmation card; this is not a completed task                                          |
| Saved                    | The current known result has been persisted; it can be reopened through history                              |
| Saving incomplete        | Execution and saving differ; keep visible content and use the available status/save lookup                   |
| Interrupted/unknown      | Completion or acceptance is not established; check status and ask support if unresolved                      |
| Failed                   | The request did not finish successfully; read the error before deciding whether a new request is appropriate |

Exact labels vary by language and application. A save-status retry queries or
persists the same known result; starting a new generation is a different action.
Not every path displays all of these states.

## 4. Find And Manage History

Open **History** at `/chat/history` or select a conversation from the sidebar.
The current history search filters conversation titles and available last-message
previews; it is not a guaranteed full-text search of all messages. You can rename conversations and use the history
selection controls to delete one or multiple entries after confirmation.

Sign in with the same account to see its saved history. Logging out does not
delete saved conversations. After logging in again, reopen the history rather
than assuming an empty new-chat page means your data disappeared.

Deleting a conversation removes it from the local product's normal use. It does
not promise erasure of upstream Agent memory, provider logs or backups. Ask the
operator about retention requirements; do not use local deletion as evidence
that an external system has erased its copy.

## 5. Respond To Human Confirmation

Only explicitly enabled compatible LangChain applications support the current
human-input profile. Ordinary LangChain applications and Dify applications do
not gain this feature automatically.

1. Start a task in the designated application and wait for a confirmation card.
2. Read its title, description and any expiration information. Decide whether the
   described action is appropriate; do not approve merely because the task paused.
3. Choose **Approve** or **Reject**, adding an optional comment if provided.
4. Submit once and wait for the resumed task's status. A decision being accepted
   is not the same as the complete task finishing successfully.

Refreshing or reopening history displays the saved confirmation state; it does
not submit a decision. A card may become unavailable because it expired, was
already answered, is being submitted, or its outcome is not yet known. Check the
current status instead of responding from multiple tabs. Revoked permissions can
also prevent a response.

This profile supports one task per conversation. Start a new conversation for
another task after the previous one finishes. Rejection is sent to the Agent as
a decision; it does not prove that every upstream side effect was undone.

## 6. Files, Stopping And Other Capabilities

Use only the controls exposed by the selected application. Capabilities are not
identical across backends:

| Application path              | Current boundary                                                                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing Dify modes           | Input forms, attachments, speech and other controls depend on the mode and configuration; some file-preview and workflow follow-up operations are administrator-only |
| Dify shared AG-UI chatbot     | Explicitly enabled text-only chat; no files, human confirmation or native stop/run-query capability on this path                                                     |
| Ordinary LangChain Agent      | Text chat and supported tool activity summaries; no general file input, execution cancellation or durable stream recovery                                            |
| LangChain human-input profile | Controlled approve/reject interaction, not arbitrary forms or a general approval workflow                                                                            |

A backend may have more features than AgentifUI exposes. A disabled or missing
control is not fixed by adding a service token in the browser. A stopped display,
network interruption and confirmed upstream cancellation are different states.

### Attach A File On A Supported Dify Path

1. Open an application that exposes an attachment control or a file input field.
   Its configuration determines accepted file types, count and size.
   Requirements are read from the application service. A file field has its own
   purpose and limit; attachments in older messages do not consume the current
   draft's capacity. If requirements cannot be loaded, retry rather than assuming
   uploads are unrestricted.
2. Select the file and wait for upload to finish. Inspect the attachment preview
   and remove an incorrect selection before submitting. A selected local file is
   not yet a completed upload.
   A selection that exceeds the remaining capacity is rejected as a whole. Pending
   uploads and failed items still occupy a place; retry the same item or remove it
   before selecting another file. Existing draft files are not silently discarded.
3. Submit the message/form only after required uploads and other fields are ready.
4. Use the response's available attachment controls to view or download results.
   If preview is denied, do not try another user's file ID or assume you can
   bypass the restriction with a direct service URL; ask the administrator.

The application, AgentifUI API, reverse proxy and upstream service can impose
different limits. A file accepted by the browser can still be rejected during
upload. Shared text-only Dify/LangChain chat does not currently expose general
file handling. An export of displayed text/code is not a durable Agent-generated
file artifact with a managed lifecycle.

The separately enabled frozen-result profile provides bounded report/CSV delivery,
not general file input. See [reports, data and sources](#9-reports-data-and-sources).

### Run A Workflow Or Text-Generation Application

1. Open the application from `/apps`, not the model selector. Workflow and
   text-generation applications use the shared chat input and message display.
   Complete any parameters above the input and wait for required file uploads.
   Choose files with the attachment button inside the composer; uploaded files
   use the same status, remove and retry cards as chat. Each upload purpose keeps
   its own limits. Per-task parameters stay available after sending, even when
   the introductory application name and description are hidden.
   When a main text field is configured or unambiguously detected, the input
   fills that exact upstream variable. Parameter/file-only tasks need no dummy text.
2. Send once. Each send is an independent task, not a conversational continuation:
   previous results are not automatically sent upstream as memory. Each round
   retains its input, result and available execution-process details.
3. Read ordinary text results directly in the reply. Structured or multi-field
   results retain a **View full result** entry; its viewer preserves all output
   fields. Its copy/download controls export the
   displayed result: workflow output can be Markdown/JSON text and text-generation
   output can be a `.txt` download. This is not a universal export of conversation
   history, original uploaded files or an Agent's external state.
4. New tasks are grouped into a local conversation in the sidebar. Reopen it to
   view saved rounds, and load earlier tasks when more history is available.
   Older unlinked execution records remain readable through their original
   execution-history links; they are not converted or duplicated automatically.
5. Open a round's **More options** menu and choose **Use these inputs again** to
   prepare another run, then submit explicitly.
   This creates a new task rather than editing or branching a completed run.
   Reopening history never runs a task. Deleting a local task conversation also
   removes its linked executions from accessible history.

Refreshing or leaving during a task can interrupt browser-side saving without
stopping the upstream task. When its outcome cannot be confirmed, the saved round
shows an unknown outcome, not an endless spinner or an automatic rerun. An explicit
**Mark interrupted and prepare another run** action releases that local round for
a new submission; it does not cancel an upstream task that might still be running.

Older execution-history pages retain their original form/tracker/history layout.
If a workflow stop/detail or file-preview action is denied for an ordinary user,
the current Dify proxy may intentionally restrict that operation to administrators.
Do not interpret every disabled follow-up action as a failed task submission.
The node tracker is a display of supported events, not a workflow editor.

Choose **View execution process** on a task round to open its right-side panel,
using the same panel and activity display as Chatflow. Only one task's process
panel is open at a time; its task heading identifies the selected round. Live
activity updates while that task runs; reopening older rounds shows their saved
process rather than another task's live activity. Close it with the close button
or Escape. On small screens the panel stays within the viewport.

### Execution Process

Dify Workflow steps, Chatflow steps and LangChain tool activities use a shared
execution-process display. It shows the reported activity names, states and
known durations. The completed-activity count is not a percentage of the whole
task: an Agent may discover more work while it runs. A returned tool result does
not by itself mean that the whole task succeeded. Task outcome, saving status,
human-input requests and result files remain separate.
For Dify, expanding or collapsing nested details does not change the completed
count; iteration and branch summaries are not counted again as extra steps.

- In a LangChain conversation, use **View execution process** beside the first
  tool activity of a run to expand that run's activities inline. Other tool hints
  keep their original positions among messages. Close the list with its close
  button, the entry button or Escape inside the list; closing restores focus to
  the entry. This inline area is separate from file-preview drawers and does not
  start or resume a task. Unfinished tools in saved or ended runs show an unknown
  state rather than continuing to animate; confirmed final tool states remain
  unchanged.
- In Chatflow, use the process toggle to open or hide the floating list. Its close
  button returns focus to the toggle. The list is scrollable on narrow screens.
  Supported live iteration, loop and parallel details can be expanded with their
  step buttons. Saved per-response process snapshots remain available when
  reopening a conversation. Older messages without a saved snapshot do not
  recreate a missing process record.
- In Workflow, the execution area shows live steps and supported nested details.
  Selecting a saved execution displays only that execution's saved step summary,
  never another live task's nodes. Close the result viewer to see the summary;
  close the process summary to leave the selected historical execution. Missing
  or incomplete snapshots show an empty/unknown state, not a simulated running
  task. Saved summaries do not reconstruct every loop iteration or a full event
  replay. Live error banners and their retry/dismiss actions are hidden while
  viewing history and return when you leave it.

Older tool records without reliable ordering are labelled as summaries rather
than an exact event timeline. Process views do not expose raw tool arguments,
node inputs/outputs or upstream error payloads. These presentation controls do
not add backend execution capabilities or change conversation persistence.

## 7. Personal Settings And Sign-Out

Use `/settings` and its navigation to open the relevant page:

| Page                   | Available use                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| `/settings/profile`    | Inspect profile data, edit allowed display-name/username fields and manage the avatar                         |
| `/settings/appearance` | Select light/dark/system theme and the timezone used by supported date displays                               |
| `/settings/language`   | Choose the interface language; the page reloads to apply the language cookie                                  |
| `/settings/account`    | Inspect account information and sign out; this is not a complete identity-provider account-management console |

For profile changes, edit the enabled fields and save. Fields supplied by an
external identity provider can be read-only; changing your local username does
not change your organization's account identifier. For an avatar, open the avatar
dialog, select or drop an image, adjust the crop and confirm upload. Use its delete
action to remove an existing avatar. File validation and storage errors are
reported by the upload flow.

The current locale choices are English, Simplified/Traditional Chinese, Japanese,
Spanish, Portuguese, French, German, Russian and Italian. Changing language affects
the interface and available localized page copy, not automatic translation of
Agent responses or previous messages. Theme/language/timezone preferences have
browser-side storage behavior; do not assume every preference synchronizes across
devices. A display-timezone change does not change an upstream task's actual
schedule or server timestamps.

Use the account sign-out control and confirm when requested, especially on a
shared device. Logout does not delete saved history. Use the password-reset flow
for a forgotten local password; the account page is not a universal password,
email-address or SSO-account editor. Never share a signed-in browser session.

## 8. Common Problems

An administrator can revoke all existing website login sessions; sign in again
if asked. A suspended account instead needs an administrator's access review.
Revocation is not a guarantee that an already accepted Agent reply or tool action
has stopped upstream.

For an access issue, disputed output or a personal-data export/deletion request,
use the contact route published by this installation in its application description
or Home/About notice. Provide a safe request/error ID and approximate time, not
passwords, service keys, reset links or complete private conversations. A reaction
button is not a formal request channel. Administrators verify identity and scope;
accepting a request does not mean full export/erasure has already occurred.
Local history deletion does not erase upstream copies, downloaded files or backups.

| Symptom                                   | What to do                                                                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Login returns an error or loops           | Use the normal instance address and original sign-in method; report the time and sanitized error to the administrator      |
| Registration/reset email is missing       | Check spam and the address; wait before requesting again; ask support to check delivery without sharing the link           |
| An application disappeared or returns 403 | Ask the administrator to check account status, group access and application visibility                                     |
| Busy or quota message                     | Wait for the existing task or ask about allowance; do not bypass it with duplicate requests                                |
| Text appeared but history is missing      | Check the saving/status message and same-account history; report the conversation and time before deleting or regenerating |
| Confirmation is disabled                  | Check whether it expired or was already submitted; reload its state once and ask support if unresolved                     |

When reporting a problem, include the application name, time, browser, short
reproduction steps and any visible error/request identifier. Redact personal
content and credentials from screenshots. Administrators can use the
[administrator guide](ADMIN-GUIDE.md) and [operations guide](OPERATIONS.md).

## 9. Reports, Data And Sources

An explicitly enabled result application can publish a report and CSV dataset
inside the existing conversation. Result cards show the filename, media type and
size. Select a file to preview it, or use its download button. Results are not
automatically opened when a task finishes. Close the preview or press Escape to
return to the card; the same content is available in the mobile preview panel.

Markdown is displayed without executable HTML or external images. CSV is a
read-only table, not a spreadsheet: formulas are displayed as text. Preview is
limited to 200 rows, 20 columns and 2,000 characters per cell; a truncation notice
means the original download contains more data. Downloaded CSV may be interpreted
as formulas by spreadsheet software. Inspect Agent-generated files before using
them in another program. A source title and excerpt are supplied by the backend,
not a guarantee that a conclusion is correct; use the source copy action as needed.

Saved results remain associated with their original task after refresh, history
pagination and sign-in again. If a known task has no registered result, use
**Query result**; this reads existing work rather than running the Agent again.
Pending results are checked at most once every three seconds for up to one minute
while visible, then leave a manual query action. Changing conversations, leaving
the page or hiding the tab stops those checks.

Execution, message saving, result registration and file loading are separate.
A result can be ready while the task status remains unknown, or a preview can
fail even though the result is saved. Do not resend to repair a saving failure.
Use the read-only query and contact an administrator for unresolved run status.
Upstream outages or removal can prevent downloads without removing the stored
card. Deleting the conversation removes platform access, not downloaded copies
or all upstream/backup data. See [data handling](SECURITY-PRIVACY.md#8-result-artifact-data).
