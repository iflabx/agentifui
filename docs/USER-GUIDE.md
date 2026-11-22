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

In the shared chat input, **Enter** submits when sending is available and
**Shift+Enter** inserts a newline. Composition with an input method is not a
request to submit. You can also use the send button. Empty input, an unfinished
upload or an unresolved task may prevent sending; read the current status before
trying again.

Use the actions actually present on a message:

- **Copy** copies available message text. Browser clipboard permission and a
  secure context can affect whether copying succeeds.
- **Edit and send** on a historical user text message prepares an editable correction
  in the existing composer. Review the quoted old request and edit the new requirements,
  then use the normal send button. This appends a new user message and answer to the
  same conversation; it does not change the original message, remove later messages,
  create a branch or reset the Agent's memory or previous tool effects.
  You can change or delete all correction wording. Only the visible final text is sent.
  The correction asks the model to prefer the new requirements, but cannot guarantee
  that it ignores all old context. The full text counts toward normal request limits.
  Replacing an existing draft or selected attachments requires confirmation; cancelling
  keeps them. **Exit editing** dismisses the notice but keeps the prepared text.
  Historical attachments are not copied: attach files again if needed and supported.
  Existing application parameters remain in effect. Single-task applications, workflow
  records, attachment-only messages and non-user messages do not offer this operation.
  Running tasks, unresolved saves and pending human input retain their normal limits.
- **Regenerate**, where offered, requests another answer. Neither action repairs an
  incompletely saved run. Each accepted new request follows normal usage and permission
  rules. Refresh or reopen history to check that the original and appended turns persist.
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
2. Select the file and wait for upload to finish. Inspect the attachment preview
   and remove an incorrect selection before submitting. A selected local file is
   not yet a completed upload.
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

1. Open the application from `/apps`, not the model selector. Review its input
   form: supported fields include text, paragraph, number, selection and configured
   file/file-list inputs. Complete required fields and wait for uploads.
2. Submit once. Workflow tracking can show node progress and execution state;
   text generation shows the generated content and available execution details.
3. Open the result viewer when available. Its copy/download controls export the
   displayed result: workflow output can be Markdown/JSON text and text-generation
   output can be a `.txt` download. This is not a universal export of conversation
   history, original uploaded files or an Agent's external state.
4. Use that application's execution-history panel to reopen saved records.
   It is separate from conversational history at `/chat/history`. Where selection
   deletion is offered, confirm the intended records before removing them.
5. Change the inputs and start a new execution for a new task. Reopening a record
   displays a saved result; it does not rerun the workflow.

On small screens, workflow views provide tabs for the form, tracker and history.
If a workflow stop/detail or file-preview action is denied for an ordinary user,
the current Dify proxy may intentionally restrict that operation to administrators.
Do not interpret every disabled follow-up action as a failed task submission.
The node tracker is a display of supported events, not a workflow editor.

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
  step buttons. Chatflow process data is transient: reloading a saved conversation
  does not recreate a missing process record.
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
