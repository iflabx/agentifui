# M8 灰度切流与回滚演练 Runbook

## 1. 目标

M8 目标是把“切流 + 门禁 + 回滚演练”变成可重复执行的脚本流程，覆盖：

1. 按阶段放量（5% -> 20% -> 50% -> 100%）
2. 每阶段执行冒烟、抽样对账、指标审查
3. 命中回滚触发条件后自动进入回滚分支
4. 支持强制回滚演练（drill）
5. 全过程归档报告（JSON + Markdown + step logs）

## 2. 脚本清单

1. `scripts/m8-metrics-verify.mjs`

- 读取指标（JSON/文件/命令）
- 依据阈值判定是否命中回滚触发条件

2. `scripts/m8-rollout-stage.mjs`

- 执行单个灰度阶段
- 可配置流量切换命令、冒烟命令、抽样对账命令、回滚命令
- 产出 `stage-*/summary.json|md`

3. `scripts/m8-rollout-run.mjs`

- 按阶段顺序执行完整放量计划
- 任一阶段失败即停止后续阶段

4. `scripts/m8-rollback-drill.mjs`

- 强制触发回滚分支，验证回滚路径可执行

5. `scripts/m8-gate-verify.mjs` + `scripts/m8-gate-verify.sh`

- M8 总门禁编排（rollout + rollback drill）
- 产出 `artifacts/m8/gate/<timestamp>/summary.json|md`

## 3. NPM 命令

1. `pnpm m8:metrics:verify`
2. `pnpm m8:stage:run`
3. `pnpm m8:rollout:run`
4. `pnpm m8:rollback:drill`
5. `pnpm m8:gate:report`
6. `pnpm m8:gate:verify`

## 4. 默认阶段计划

默认值：`5:30,20:60,50:120,100:1440`

- 语法：`M8_ROLLOUT_STAGES=5:30,20:60,50:120,100:1440`
- 含义：`百分比:观察分钟`

## 5. 回滚触发条件（脚本内置）

对应 `scripts/m8-metrics-verify.mjs`：

1. `5xx` 比例 > `1.0%` 且持续 >= `5` 分钟
2. realtime `p95` > `2000ms` 且持续 >= `10` 分钟
3. 登录失败率 > `1.0%` 且持续 >= `5` 分钟
4. 不可解释对账差异数 > `0`
5. 鉴权绕过事件数 > `0`

## 6. 关键环境变量

执行行为：

1. `M8_DRY_RUN`：默认 `1`，dry-run 不执行真实流量切换/回滚命令
2. `M8_ENFORCE_WAIT`：默认 `0`，是否按观察窗口真实等待
3. `M8_ROLLOUT_STAGES`：阶段配置，默认 `5:30,20:60,50:120,100:1440`
4. `M8_START_FROM_PERCENT` / `M8_STOP_AFTER_PERCENT`：阶段起止控制

命令钩子：

1. `M8_SWITCH_TRAFFIC_COMMAND`：切流命令（由你的网关/Ingress 实现）
2. `M8_SMOKE_COMMAND`：阶段冒烟命令（默认 `pnpm -s m7:ci:verify`）
3. `M8_RECONCILE_COMMAND`：阶段抽样对账命令（默认空）
4. `M8_ROLLBACK_COMMAND`：回滚命令（由你的网关/Ingress 实现）

指标输入：

1. `M8_METRICS_JSON`
2. `M8_METRICS_PATH`
3. `M8_METRICS_COMMAND`
4. `M8_METRICS_STRICT`：默认 `0`，为 `1` 时必须提供指标输入

## 7. 指标 JSON 示例

```json
{
  "http5xxRatePct": 0.2,
  "http5xxSustainedMinutes": 2,
  "realtimeP95Ms": 800,
  "realtimeSustainedMinutes": 2,
  "loginFailureRatePct": 0.1,
  "loginFailureSustainedMinutes": 1,
  "unexplainedReconcileDiffCount": 0,
  "authBypassEventCount": 0
}
```

## 8. 常用执行示例

1. 仅做 M8 门禁模拟（推荐开发环境）

`pnpm -s m8:gate:verify`

2. 执行完整阶段编排（dry-run）

`M8_DRY_RUN=1 pnpm -s m8:rollout:run`

3. 强制回滚演练（dry-run）

`M8_DRY_RUN=1 pnpm -s m8:rollback:drill`

4. 严格指标模式 + 自定义指标文件

`M8_METRICS_STRICT=1 M8_METRICS_PATH=./artifacts/metrics/latest.json pnpm -s m8:metrics:verify`

5. 实流量执行（示例）

`M8_DRY_RUN=0 M8_ENFORCE_WAIT=1 M8_SWITCH_TRAFFIC_COMMAND='your-switch-cli --percent ${M8_TARGET_PERCENT}' M8_ROLLBACK_COMMAND='your-switch-cli --percent 0' M8_RECONCILE_COMMAND='pnpm -s m7:gate:verify' M8_METRICS_STRICT=1 M8_METRICS_COMMAND='your-metrics-exporter --json' pnpm -s m8:rollout:run`

## 9. 报告目录

- M8 gate：`artifacts/m8/gate/<timestamp>/`
- 阶段执行：`artifacts/m8/<timestamp>/stage-*/`
- 回滚演练：`artifacts/m8/rollback-drill/<timestamp>/`
