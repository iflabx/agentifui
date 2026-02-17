# 前端直连数据库改造映射（统一接口）

## 目标
将前端运行时（浏览器）中所有直接访问数据库模块的调用，统一收口到内部 API：

`Frontend -> callInternalDataAction -> /api/internal/data -> @lib/db/*`

## 统一入口与代码位置
- 浏览器侧统一入口：`lib/db/internal-data-api.ts`（`callInternalDataAction`）
- 服务端统一入口：`app/api/internal/data/route.ts`（`POST /api/internal/data`）
- 前端调用封装层：
  - `lib/services/client/conversations-api.ts`
  - `lib/services/client/messages-api.ts`
  - `lib/services/client/app-executions-api.ts`

## 改造映射（Before -> After）

### 1) Conversations
- 原调用（浏览器直连 DB）：
  - `components/nav-bar/conversation-title-button.tsx` 动态导入 `@lib/db/conversations`
  - `components/sidebar/sidebar-chat-list.tsx` 动态导入 `@lib/db/conversations`
- 新调用（统一客户端封装）：
  - `renameConversation(...)` -> `@lib/services/client/conversations-api`
  - `deleteConversation(...)` -> `@lib/services/client/conversations-api`
- 对应后端 action：
  - `conversations.renameConversation`
  - `conversations.deleteConversation`

### 2) Messages
- 原调用（浏览器直连 DB / DB service）：
  - `lib/hooks/use-chat-messages.ts`
    - `@lib/db/messages`：`getMessageByContentAndRole`、`createPlaceholderAssistantMessage`
    - `@lib/services/db/message-service`：`messageService.saveMessage`
  - `lib/hooks/use-conversation-messages.ts`
    - `@lib/services/db/message-service`：`messageService.getLatestMessages`
- 新调用（统一客户端封装）：
  - `findDuplicateMessage(...)` -> `@lib/services/client/messages-api`
  - `saveMessageRecord(...)` -> `@lib/services/client/messages-api`
  - `createPlaceholderAssistantMessageRecord(...)` -> `@lib/services/client/messages-api`
  - `getLatestMessages(...)` -> `@lib/services/client/messages-api`
- 对应后端 action：
  - `messages.getLatest`
  - `messages.findDuplicate`
  - `messages.save`
  - `messages.createPlaceholder`

### 3) App Executions（workflow / text-generation）
- 原调用（浏览器直连 DB）：
  - `lib/hooks/use-workflow-execution.ts` 动态导入 `@lib/db/app-executions`
  - `lib/hooks/use-text-generation-execution.ts` 动态导入 `@lib/db/app-executions`
  - `components/workflow/execution-history/index.tsx` 动态导入 `@lib/db/app-executions`
- 新调用（统一客户端封装）：
  - `createExecution(...)` -> `@lib/services/client/app-executions-api`
  - `updateExecutionStatus(...)` -> `@lib/services/client/app-executions-api`
  - `updateCompleteExecutionData(...)` -> `@lib/services/client/app-executions-api`
  - `getExecutionsByServiceInstance(...)` -> `@lib/services/client/app-executions-api`
  - `getExecutionById(...)` -> `@lib/services/client/app-executions-api`
  - `deleteExecution(...)` -> `@lib/services/client/app-executions-api`
- 对应后端 action：
  - `appExecutions.getByServiceInstance`
  - `appExecutions.getById`
  - `appExecutions.create`
  - `appExecutions.updateStatus`
  - `appExecutions.updateComplete`
  - `appExecutions.delete`

### 4) App Parameters（补齐浏览器端 DB 直连）
- 原调用：
  - `lib/services/dify/app-parameters-service.ts` 直接调用 `@lib/db/service-instances`（`getAppParametersFromDb`）
- 新调用：
  - 改为浏览器请求 `GET /api/internal/apps?instanceId=...`
  - 不再在浏览器运行时直接导入 DB 模块

## 服务端路由扩展点（本次新增）
`app/api/internal/data/route.ts` 新增并注册以下 action：
- `messages.getLatest`
- `messages.findDuplicate`
- `messages.save`
- `messages.createPlaceholder`
- `appExecutions.getByServiceInstance`
- `appExecutions.getById`
- `appExecutions.create`
- `appExecutions.updateStatus`
- `appExecutions.updateComplete`
- `appExecutions.delete`

同时新增服务端校验逻辑：
- 会话归属校验：`ensureConversationOwnedByActor(...)`
- 执行记录归属校验：`ensureExecutionOwnedByActor(...)`
- 状态字段解析校验：`parseMessageStatus(...)`、`parseExecutionStatus(...)`

## 防回归守卫
- 脚本：`scripts/check-client-db-imports.mjs`
- 作用：
  - 禁止客户端运行时代码导入 `@lib/db/*`（仅允许 `@lib/db/internal-data-api`）
  - 禁止客户端运行时代码导入 `@lib/services/db/data-service`
  - 禁止客户端运行时代码导入 `@lib/services/db/message-service`
  - 检查静态 import 与动态 import
- 运行命令：
  - `pnpm -s guard:client-db-imports`

## 当前结论
前端运行时数据库访问已统一收口到内部接口路径，后续新增数据读写应遵循同一模式：

`client wrapper -> callInternalDataAction -> /api/internal/data -> server db module`
