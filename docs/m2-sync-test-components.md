# M2 同步测试组件（无新增本地基础设施）

日期：2026-02-14  
阶段：M2（OIDC 统一 + CAS->OIDC 桥接并行接入）

## 1. 结论

当前阶段不新增物理机容器组件。  
沿用现有 `PostgreSQL + Redis + MinIO`，并接入外部真实服务做联调：

1. 外部 IdP（OIDC/OAuth）
2. 外部 SMTP 服务
3. 外部短信 API（如启用手机登录）

## 2. 新增代码级“同步测试组件”

1. `better-auth` 并行路由：`/api/auth/better/*`
2. OIDC/CAS-bridge 配置解析：
   - `lib/auth/better-auth/sso-providers.ts`
3. OIDC Discovery 连通性校验：
   - `scripts/m2-oidc-discovery-verify.mjs`
   - `pnpm m2:oidc:verify`
4. Mock OIDC SSO 端到端验收（含冲突拒绝）：
   - `scripts/m2-sso-mock-e2e-verify.mjs`
   - `pnpm m2:sso:mock:verify`
5. 解析器单测：
   - `__tests__/auth/better-auth/sso-providers.test.ts`

## 3. CAS->OIDC 桥接约定

在 `BETTER_AUTH_SSO_PROVIDERS_JSON` 中：

1. `mode: "native"`：原生 OIDC 提供商
2. `mode: "cas-bridge"`：CAS 经桥接后以 OIDC 接入
3. `casIssuer`：仅用于桥接来源标识与审计（可用于后续策略）

## 4. 校验命令

```bash
pnpm m2:oidc:verify
```

M2 全量 Gate（email/password + SSO）：

```bash
pnpm m2:gate:verify
```

可选超时配置：

```bash
OIDC_DISCOVERY_TIMEOUT_MS=12000 pnpm m2:oidc:verify
```

若有 provider discovery 不可达，命令会以非 0 退出，便于 CI 阻断。
