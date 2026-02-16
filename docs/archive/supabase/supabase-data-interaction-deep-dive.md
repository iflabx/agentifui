# AgentifUI 与 Supabase 数据交互深度分析

分析日期：2026-02-13

## 1. 分析范围与结论

本文聚焦“运行时数据面”：

1. 会话型聊天链路：`conversations` + `messages`
2. 任务型执行链路：`app_executions`
3. 权限与可见性链路：`groups`/`group_members`/`group_app_permissions` + RPC
4. SSO 与用户资料链路：`profiles`/`sso_providers` + 安全函数
5. Storage 链路：`avatars`/`content-images`
6. 配置控制面：`providers`/`service_instances`/`api_keys` 与 Dify 代理

总体结论：

- 项目形成了“前端 Hook/Store -> 统一数据服务 -> Supabase 表/RPC/Storage”的标准化路径，聊天与执行两类业务的落库模型分离清晰（`lib/hooks/use-chat-interface.ts:4`, `lib/hooks/use-workflow-execution.ts:20`, `lib/hooks/use-text-generation-execution.ts:20`）。
- 关键数据流可追踪性较好，但存在若干安全与一致性风险：客户端 Supabase 实例边界、过宽 RLS、群组配额多组语义、部分管理 API 鉴权缺失（详见第 8 节）。

## 2. Supabase 数据访问基线

### 2.1 三类 Client 的职责边界

- 浏览器端单例 Client：`lib/supabase/client.ts:15`
- 服务端 Client（带 cookie 上下文）：`lib/supabase/server.ts:10`
- 服务端 Admin Client（service role，绕过 RLS）：`lib/supabase/server.ts:38`

中间件在入口统一做 `auth.getUser()` 和 `profiles(role,status)` 校验，形成页面级保护：`middleware.ts:116`, `middleware.ts:157`, `middleware.ts:209`。

### 2.2 统一数据服务层

`DataService` 将 Supabase 查询包装为统一 `Result` 与重试/缓存机制：

- 实例化 Supabase：`lib/services/db/data-service.ts:34`
- 通用查询与重试：`lib/services/db/data-service.ts:51`, `lib/services/db/data-service.ts:75`
- CRUD/soft delete/count：`lib/services/db/data-service.ts:249`, `lib/services/db/data-service.ts:272`, `lib/services/db/data-service.ts:296`, `lib/services/db/data-service.ts:320`, `lib/services/db/data-service.ts:350`

配套：

- 进程内 TTL 缓存：`lib/services/db/cache-service.ts:42`
- Realtime 订阅复用：`lib/services/db/realtime-service.ts:49`

## 3. 会话型聊天数据流（conversations/messages）

### 3.1 新会话创建与双 ID 对齐

核心问题：系统同时维护 Dify 会话 ID（`external_id`）和本地数据库 UUID（`conversations.id`）。

时序如下：

1. `useChatInterface.handleSubmit` 判断新会话分支并调用 `initiateNewConversation`：`lib/hooks/use-chat-interface.ts:434`, `lib/hooks/use-chat-interface.ts:439`
2. `useCreateConversation` 在收到 Dify 会话 ID 后立即落库：`createConversation({ external_id, app_id, user_id ... })`，不等待标题生成：`lib/hooks/use-create-conversation.ts:271`, `lib/hooks/use-create-conversation.ts:296`
3. DB 创建成功后通过 `onDbIdCreated` 回调把本地 UUID 回传上层，立即触发用户消息落库：`lib/hooks/use-create-conversation.ts:327`, `lib/hooks/use-chat-interface.ts:444`, `lib/hooks/use-chat-interface.ts:454`
4. 标题异步生成后再回写 `conversations.title`：`lib/hooks/use-create-conversation.ts:376`, `lib/hooks/use-create-conversation.ts:396`

这条链路的关键价值是：避免“流式中断时消息丢失”，因为会话记录先落库、用户消息可提前保存。

### 3.2 消息流式接收与最终持久化

`useChatInterface` 负责流式 chunk 聚合与结束后写库：

- 创建流式 assistant 占位消息：`lib/hooks/use-chat-interface.ts:715`
- 收到 `completionPromise` 后把 usage/metadata 合并回前端消息：`lib/hooks/use-chat-interface.ts:783`, `lib/hooks/use-chat-interface.ts:813`
- 流结束后统一保存 user + assistant（若未保存）：`lib/hooks/use-chat-interface.ts:913`, `lib/hooks/use-chat-interface.ts:939`

实际落库入口是 `useChatMessages.saveMessage`：

- 先做内容去重查询：`lib/hooks/use-chat-messages.ts:133`
- 再调用 `messageService.saveMessage`：`lib/hooks/use-chat-messages.ts:168`

### 3.3 MessageService 的 DB 写入策略

`messageService` 直接决定消息与会话预览的写入语义：

- 按 `created_at + sequence_index + id` 稳定排序分页：`lib/services/db/message-service.ts:85`
- assistant 消息保存后，同步更新 `conversations.last_message_preview` 与 `updated_at`：`lib/services/db/message-service.ts:204`, `lib/services/db/message-service.ts:229`
- 预览文本先剥离 `<think>/<details>`：`lib/utils/index.ts:37`

数据库侧演进：

- 对话与消息扩展字段、RLS 策略：`supabase/migrations/20250513104549_extend_conversations_messages.sql:4`, `supabase/migrations/20250513104549_extend_conversations_messages.sql:54`, `supabase/migrations/20250513104549_extend_conversations_messages.sql:82`
- 旧触发器方案：`supabase/migrations/20250521125100_add_message_trigger.sql:2`
- 后续明确移除触发器，改应用层统一更新预览：`supabase/migrations/20250608155950_remove_message_preview_trigger.sql:1`
- 新增 `sequence_index` 与排序索引：`supabase/migrations/20250712133249_add_sequence_index_column.sql:15`, `supabase/migrations/20250712133249_add_sequence_index_column.sql:20`

### 3.4 历史加载路径

历史消息读取通过“URL 中 Dify ID -> DB UUID 映射”完成：

- `getConversationByExternalId`：`lib/db/conversations.ts:222`
- `useConversationMessages` 先查 DB 会话 ID，再分页拉取消息：`lib/hooks/use-conversation-messages.ts:190`, `lib/hooks/use-conversation-messages.ts:272`

## 4. 任务型执行数据流（app_executions）

### 4.1 Workflow 执行链路

`useWorkflowExecution` 的落库策略是“先创建 pending，再状态推进”：

1. 先写入 `app_executions(status=pending)`：`lib/hooks/use-workflow-execution.ts:251`, `lib/hooks/use-workflow-execution.ts:278`
2. 置为 `running`：`lib/hooks/use-workflow-execution.ts:293`
3. 流式消费 Dify workflow 事件并收集 node 数据：`lib/hooks/use-workflow-execution.ts:335`, `lib/hooks/use-workflow-execution.ts:345`
4. `completionPromise` 返回后，一次性 `updateCompleteExecutionData` 回写最终状态、outputs、metadata、tokens 等：`lib/hooks/use-workflow-execution.ts:365`, `lib/hooks/use-workflow-execution.ts:384`

停止/失败路径同样回写 `stopped/failed`，保证执行记录闭环：`lib/hooks/use-workflow-execution.ts:513`, `lib/hooks/use-workflow-execution.ts:552`。

### 4.2 Text Generation 执行链路

`useTextGenerationExecution` 复用同一表，但元数据结构偏文本生成语义：

- 建立 pending 记录：`lib/hooks/use-text-generation-execution.ts:233`
- 置 running：`lib/hooks/use-text-generation-execution.ts:270`
- 流式累计文本并更新进度：`lib/hooks/use-text-generation-execution.ts:301`
- 完成后 `updateCompleteExecutionData`：`lib/hooks/use-text-generation-execution.ts:359`
- 手动停止时可保存部分文本到 `outputs.generated_text`：`lib/hooks/use-text-generation-execution.ts:503`, `lib/hooks/use-text-generation-execution.ts:550`

### 4.3 app_executions 表与 RLS

- 表与索引定义：`supabase/migrations/20250601124105_add_app_executions_table.sql:12`, `supabase/migrations/20250601124105_add_app_executions_table.sql:48`
- 用户级 RLS：`supabase/migrations/20250601124105_add_app_executions_table.sql:74`
- 管理员可查看全量：`supabase/migrations/20250601124105_add_app_executions_table.sql:87`
- 扩展软删除状态 `deleted`：`supabase/migrations/20250607215513_add_deleted_status.sql:5`

代码侧 `getExecutionById`/`getExecutionsByServiceInstance` 继续叠加 `user_id` 过滤，形成应用层二次防线：`lib/db/app-executions.ts:83`, `lib/db/app-executions.ts:382`。

## 5. 权限与应用可见性数据流（Groups + RPC）

### 5.1 数据模型与策略

群组模型由三表组成：

- `groups`、`group_members`、`group_app_permissions`：`supabase/migrations/20250630021741_migrate_to_groups_system.sql:61`, `supabase/migrations/20250630021741_migrate_to_groups_system.sql:70`, `supabase/migrations/20250630021741_migrate_to_groups_system.sql:79`

RLS 核心：

- 群组管理仅 admin：`supabase/migrations/20250630021741_migrate_to_groups_system.sql:103`
- 成员可读 group_members，admin 可全管：`supabase/migrations/20250630021741_migrate_to_groups_system.sql:120`, `supabase/migrations/20250630021741_migrate_to_groups_system.sql:124`
- 成员可读 group_app_permissions，admin 可全管：`supabase/migrations/20250630021741_migrate_to_groups_system.sql:131`, `supabase/migrations/20250630021741_migrate_to_groups_system.sql:135`

### 5.2 RPC 与前端消费

权限逻辑主要由 3 个 `SECURITY DEFINER` 函数承担：

- `get_user_accessible_apps`：`supabase/migrations/20250630021741_migrate_to_groups_system.sql:153`
- `check_user_app_permission`：`supabase/migrations/20250630021741_migrate_to_groups_system.sql:200`
- `increment_app_usage`：`supabase/migrations/20250630021741_migrate_to_groups_system.sql:260`

TS 调用层：

- RPC 封装：`lib/db/group-permissions.ts:466`, `lib/db/group-permissions.ts:491`, `lib/db/group-permissions.ts:528`
- 应用列表加载基于 `getUserAccessibleApps`：`lib/stores/app-list-store.ts:142`
- 客户端去重采用 `service_instance_id`（消除多群组重复项）：`lib/stores/app-list-store.ts:170`

### 5.3 数据语义要点

- 可见性模型：`public | group_only | private`（`lib/types/database.ts:61`）
- `group_only` 的配额来自 `group_app_permissions.usage_quota/used_count`，剩余配额由 RPC 计算并返回（`supabase/migrations/20250630021741_migrate_to_groups_system.sql:183`, `supabase/migrations/20250630021741_migrate_to_groups_system.sql:249`）。

## 6. SSO 与用户资料数据流

### 6.1 登录入口到回调

1. `/api/sso/[providerId]/login` 生成 CAS 登录 URL 并重定向：`app/api/sso/[providerId]/login/route.ts:47`, `app/api/sso/[providerId]/login/route.ts:61`
2. `/api/sso/[providerId]/callback` 验票、查找/创建用户：`app/api/sso/[providerId]/callback/route.ts:65`, `app/api/sso/[providerId]/callback/route.ts:113`

CAS 配置读取来自安全函数：

- `get_sso_provider_config` RPC：`lib/services/sso/generic-cas-service.ts:399`
- SQL 定义：`supabase/migrations/20250709101517_fix_sso_login_secure_complete.sql:65`

### 6.2 用户创建与资料同步

`SSOUserService` 使用 admin client 执行“auth.users + profiles”一致化：

- 创建 `auth.users`：`lib/services/admin/user/sso-user-service.ts:215`
- 回填/修复 `profiles`（含 employee_number、sso_provider_id、auth_source）：`lib/services/admin/user/sso-user-service.ts:360`, `lib/services/admin/user/sso-user-service.ts:428`, `lib/services/admin/user/sso-user-service.ts:463`
- 更新最后登录时间（RPC）：`lib/services/admin/user/sso-user-service.ts:533`

数据库函数：`update_sso_user_login`（`SECURITY DEFINER`）定义于：`supabase/migrations/20250617185202_add_cas_sso_data.sql:221`。

### 6.3 Session 建立与状态拦截

- 回调成功后写入两类 cookie（httpOnly 敏感 + 可读公开）并跳 `/sso/processing`：`app/api/sso/[providerId]/callback/route.ts:208`, `app/api/sso/[providerId]/callback/route.ts:220`
- 处理页读取公开 cookie 并调用 `/api/auth/sso-signin`：`app/sso/processing/page.tsx:57`, `app/sso/processing/page.tsx:88`
- `sso-signin` 从 httpOnly cookie 取敏感数据，校验 `profiles.status` 后创建 session：`app/api/auth/sso-signin/route.ts:23`, `app/api/auth/sso-signin/route.ts:134`, `app/api/auth/sso-signin/route.ts:149`

### 6.4 登录页公开配置读取

登录组件直接读取 `public_sso_providers` 视图：`components/auth/sso-button.tsx:115`。

该视图由 `get_public_sso_providers` 生成，并通过 `filter_sensitive_sso_settings` 去敏字段：`supabase/migrations/20250709101517_fix_sso_login_secure_complete.sql:6`, `supabase/migrations/20250709101517_fix_sso_login_secure_complete.sql:27`, `supabase/migrations/20250709101517_fix_sso_login_secure_complete.sql:59`。

## 7. Storage 数据流（头像与内容图片）

### 7.1 头像（avatars）

业务路径：

1. 前端上传到 `storage.objects`（bucket=`avatars`）：`lib/hooks/use-avatar-upload.ts:143`
2. 获取公开 URL：`lib/hooks/use-avatar-upload.ts:157`
3. 回写 `profiles.avatar_url`：`lib/hooks/use-avatar-upload.ts:166`
4. 删除旧文件：`lib/hooks/use-avatar-upload.ts:184`

策略与桶配置：

- 初始策略含 `user-{uid}` 目录约束：`supabase/migrations/20250628210700_setup_avatar_storage.sql:33`
- 后续“properly”迁移改为插入时仅要求认证，不再强制路径前缀：`supabase/migrations/20250628214015_create_avatar_storage_properly.sql:20`

### 7.2 内容图片（content-images）

业务路径：

- 上传：`lib/services/content-image-upload-service.ts:150`
- 删除：`lib/services/content-image-upload-service.ts:185`
- 按 `user-{uid}` 列表与清理未引用图片：`lib/services/content-image-upload-service.ts:202`, `lib/services/content-image-upload-service.ts:246`

策略：

- 上传强制目录前缀 `user-{auth.uid}`：`supabase/migrations/20250930172735_setup_content_images_storage.sql:33`
- 删除/更新按 `owner` 控制：`supabase/migrations/20250930172735_setup_content_images_storage.sql:47`, `supabase/migrations/20250930172735_setup_content_images_storage.sql:54`

## 8. 配置控制面数据流（providers/service_instances/api_keys）

### 8.1 Dify 代理与配置读取

`/api/dify/[appId]/[...slug]` 的路径：

1. 先做 Supabase 鉴权：`app/api/dify/[appId]/[...slug]/route.ts:78`
2. 从 DB 装载 app 配置 `getDifyAppConfig`：`app/api/dify/[appId]/[...slug]/route.ts:167`
3. 解析 `service_instances + providers + api_keys`，并解密 key：`lib/config/dify-config.ts:129`, `lib/config/dify-config.ts:211`, `lib/config/dify-config.ts:238`
4. 将请求代理到 Dify，支持 SSE/媒体透传：`app/api/dify/[appId]/[...slug]/route.ts:327`, `app/api/dify/[appId]/[...slug]/route.ts:436`

### 8.2 管理端配置写入

管理端通过 `useApiConfigStore` 写入 provider/instance/key：

- 新建实例 + 写 api key：`lib/stores/api-config-store.ts:69`, `lib/stores/api-config-store.ts:108`
- 更新实例 + 更新 key：`lib/stores/api-config-store.ts:155`, `lib/stores/api-config-store.ts:209`
- 删除实例时先删 key：`lib/stores/api-config-store.ts:272`, `lib/stores/api-config-store.ts:285`

前端先调用 `/api/admin/encrypt` 获取密文，再写 `api_keys`（isEncrypted=true）：`lib/stores/api-config-store.ts:93`, `lib/stores/api-config-store.ts:118`。

## 9. 关键风险与改进建议（数据面）

### 9.1 高风险：配置表 RLS 过宽

证据：

- `providers/service_instances/api_keys` 的 SELECT 策略条件是 `auth.uid() IS NULL OR auth.uid() IS NOT NULL`，等价于全放开：`supabase/migrations/20250524230000_fix_dify_config_rls.sql:18`, `supabase/migrations/20250524230000_fix_dify_config_rls.sql:41`, `supabase/migrations/20250524230000_fix_dify_config_rls.sql:64`

建议：

1. 仅允许 `service_role` 或受控 `SECURITY DEFINER` 函数读取敏感表。
2. 前端可见信息与密钥信息分表/分视图，最小化暴露面。

### 9.2 高风险：管理 API 鉴权缺失

证据：

- `app/api/admin/translations/route.ts` 未见用户/角色校验入口（handler 直接执行）：`app/api/admin/translations/route.ts:164`, `app/api/admin/translations/route.ts:215`
- `app/api/admin/status/route.ts` 同样未显式鉴权：`app/api/admin/status/route.ts:8`

建议：

1. 为 `app/api/admin/**` 统一封装 `requireAdmin()`。
2. 路由内二次校验，不依赖页面层中间件。

### 9.3 中风险：Client/Server 数据访问边界混用

证据：

- `DataService` 与多个 `lib/db/*` 模块直接依赖 browser client：`lib/services/db/data-service.ts:7`, `lib/db/service-instances.ts:12`, `lib/db/providers.ts:1`, `lib/db/api-keys.ts:11`
- `getDifyAppConfig`（可在服务端路径调用）也依赖 browser client：`lib/config/dify-config.ts:1`, `lib/config/dify-config.ts:113`

建议：

1. 明确拆分 `server-only` 与 `client-only` DB 模块。
2. 服务端链路强制使用 `lib/supabase/server.ts`。

### 9.4 中风险：群组配额在“多群组同应用”场景语义不稳定

证据：

- `check_user_app_permission` / `increment_app_usage` 直接按 `JOIN group_members` 命中，不做聚合与优先级规则：`supabase/migrations/20250630021741_migrate_to_groups_system.sql:232`, `supabase/migrations/20250630021741_migrate_to_groups_system.sql:278`
- 前端列表层做了 `service_instance_id` 去重，可能掩盖多群组来源差异：`lib/stores/app-list-store.ts:170`

建议：

1. 在 RPC 中明确多组冲突策略（最严格/最宽松/按优先级）。
2. 返回命中的 `group_id` 与策略来源，便于审计。

### 9.5 中风险：SSO 调试日志包含敏感内容

证据：

- 登录入口打印完整登录 URL：`app/api/sso/[providerId]/login/route.ts:57`
- CAS 服务打印完整 XML 响应：`lib/services/sso/generic-cas-service.ts:189`, `lib/services/sso/generic-cas-service.ts:192`

建议：

1. 生产环境禁用原文日志。
2. ticket、employeeNumber、XML 敏感字段统一脱敏。

### 9.6 中风险：头像策略与路径约束存在迁移漂移

证据：

- 早期策略要求 `user-{auth.uid}` 目录：`supabase/migrations/20250628210700_setup_avatar_storage.sql:37`
- 后续策略放宽为“任意路径可上传”（仅认证约束）：`supabase/migrations/20250628214015_create_avatar_storage_properly.sql:20`, `supabase/migrations/20250628214015_create_avatar_storage_properly.sql:24`

建议：

1. 收敛到一致策略（推荐保留目录约束）。
2. 将路径约束与 owner 校验同时用于 INSERT/UPDATE/DELETE。

## 10. 结语

从数据层看，项目已经具备较完整的“业务双模型 + 权限 RPC + SSO 安全函数 + Storage 策略”体系。下一步优先级建议：

1. 先收紧配置表 RLS 与管理 API 鉴权（安全面）。
2. 再统一 client/server DB 访问边界（稳定性与可维护性）。
3. 最后细化群组配额多组语义与审计字段（规则可解释性）。
