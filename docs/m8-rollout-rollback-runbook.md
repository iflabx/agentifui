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
- 可配置流量切换命令、流量比例验证命令、冒烟命令、抽样对账命令、回滚命令
- 产出 `stage-*/summary.json|md`

3. `scripts/m8-rollout-run.mjs`

- 按阶段顺序执行完整放量计划
- 任一阶段失败即停止后续阶段

4. `scripts/m8-rollback-drill.mjs`

- 强制触发回滚分支，验证回滚路径可执行

5. `scripts/m8-gate-verify.mjs` + `scripts/m8-gate-verify.sh`

- M8 总门禁编排（rollout + rollback drill）
- 产出 `artifacts/m8/gate/<timestamp>/summary.json|md`

6. `scripts/m8-smoke-verify.sh`

- 默认关键路径冒烟聚合（auth/storage/realtime）

## 3. NPM 命令

1. `pnpm m8:metrics:verify`
2. `pnpm m8:smoke:verify`
3. `pnpm m8:stage:run`
4. `pnpm m8:rollout:run`
5. `pnpm m8:rollback:drill`
6. `pnpm m8:gate:report`
7. `pnpm m8:gate:verify`

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
6. 在 `100%` 阶段，稳定窗口 < `1440` 分钟

## 6. 关键环境变量

执行行为：

1. `M8_DRY_RUN`：默认 `0`（fail-closed）
2. `M8_ENFORCE_WAIT`：默认 `1`，按观察窗口真实等待
3. `M8_ROLLOUT_STAGES`：阶段配置，默认 `5:30,20:60,50:120,100:1440`
4. `M8_START_FROM_PERCENT` / `M8_STOP_AFTER_PERCENT`：阶段起止控制
5. `M8_APPROVED`：`M8_DRY_RUN=0` 时必须为 `1` 才允许执行
6. `M8_LOCK_FILE`：并发互斥锁文件路径（默认 `.m8-rollout.lock`）
7. `M8_ALLOW_DRY_RUN_PASS`：默认 `0`，仅用于测试环境模拟通过

命令钩子：

1. `M8_SWITCH_TRAFFIC_COMMAND`：切流命令（由你的网关/Ingress 实现）
2. `M8_VERIFY_TRAFFIC_COMMAND`：切流后比例验证命令（必须）
3. `M8_SMOKE_COMMAND`：阶段冒烟命令（默认 `bash scripts/m8-smoke-verify.sh`）
4. `M8_RECONCILE_COMMAND`：阶段抽样对账命令（必须）
5. `M8_ROLLBACK_COMMAND`：回滚命令（必须）

指标输入：

1. `M8_METRICS_JSON`
2. `M8_METRICS_PATH`
3. `M8_METRICS_COMMAND`
4. `M8_METRICS_STRICT`：默认 `1`
5. `M8_METRICS_REQUIRE_ALL_SIGNALS`：默认 `1`
6. `M8_REQUIRE_100_STABILITY`：默认 `1`
7. `M8_REQUIRED_100_STABILITY_MINUTES`：默认 `1440`

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
  "authBypassEventCount": 0,
  "at100StableMinutes": 1440
}
```

## 8. 常用执行示例

1. 仅做 M8 门禁模拟（开发环境，需显式开启 dry-run 通过）

`M8_DRY_RUN=1 M8_ALLOW_DRY_RUN_PASS=1 M8_SWITCH_TRAFFIC_COMMAND='echo "{\"ok\":true}"' M8_VERIFY_TRAFFIC_COMMAND='echo "{\"ok\":true}"' M8_RECONCILE_COMMAND='echo "{\"ok\":true}"' M8_ROLLBACK_COMMAND='echo "{\"ok\":true}"' M8_SMOKE_COMMAND='echo "{\"ok\":true}"' M8_METRICS_JSON='{"http5xxRatePct":0,"http5xxSustainedMinutes":0,"realtimeP95Ms":0,"realtimeSustainedMinutes":0,"loginFailureRatePct":0,"loginFailureSustainedMinutes":0,"unexplainedReconcileDiffCount":0,"authBypassEventCount":0,"at100StableMinutes":1440}' pnpm -s m8:gate:verify`

2. 执行完整阶段编排（dry-run）

`M8_DRY_RUN=1 M8_ALLOW_DRY_RUN_PASS=1 M8_SWITCH_TRAFFIC_COMMAND='echo "{\"ok\":true}"' M8_VERIFY_TRAFFIC_COMMAND='echo "{\"ok\":true}"' M8_RECONCILE_COMMAND='echo "{\"ok\":true}"' M8_ROLLBACK_COMMAND='echo "{\"ok\":true}"' M8_SMOKE_COMMAND='echo "{\"ok\":true}"' M8_METRICS_JSON='{"http5xxRatePct":0,"http5xxSustainedMinutes":0,"realtimeP95Ms":0,"realtimeSustainedMinutes":0,"loginFailureRatePct":0,"loginFailureSustainedMinutes":0,"unexplainedReconcileDiffCount":0,"authBypassEventCount":0,"at100StableMinutes":1440}' pnpm -s m8:rollout:run`

3. 强制回滚演练（dry-run）

`M8_DRY_RUN=1 M8_ALLOW_DRY_RUN_PASS=1 M8_SWITCH_TRAFFIC_COMMAND='echo "{\"ok\":true}"' M8_VERIFY_TRAFFIC_COMMAND='echo "{\"ok\":true}"' M8_RECONCILE_COMMAND='echo "{\"ok\":true}"' M8_ROLLBACK_COMMAND='echo "{\"ok\":true}"' M8_SMOKE_COMMAND='echo "{\"ok\":true}"' M8_METRICS_JSON='{"http5xxRatePct":0,"http5xxSustainedMinutes":0,"realtimeP95Ms":0,"realtimeSustainedMinutes":0,"loginFailureRatePct":0,"loginFailureSustainedMinutes":0,"unexplainedReconcileDiffCount":0,"authBypassEventCount":0,"at100StableMinutes":1440}' pnpm -s m8:rollback:drill`

4. 严格指标模式 + 自定义指标文件

`M8_METRICS_STRICT=1 M8_METRICS_PATH=./artifacts/metrics/latest.json pnpm -s m8:metrics:verify`

5. 实流量执行（示例）

`M8_DRY_RUN=0 M8_APPROVED=1 M8_ENFORCE_WAIT=1 M8_SWITCH_TRAFFIC_COMMAND='your-switch-cli --percent ${M8_TARGET_PERCENT}' M8_VERIFY_TRAFFIC_COMMAND='your-switch-cli --get-percent | jq ...' M8_ROLLBACK_COMMAND='your-switch-cli --percent 0' M8_RECONCILE_COMMAND='pnpm -s m7:gate:verify' M8_METRICS_STRICT=1 M8_METRICS_REQUIRE_ALL_SIGNALS=1 M8_METRICS_COMMAND='your-metrics-exporter --json' pnpm -s m8:rollout:run`

## 9. 报告目录

- M8 gate：`artifacts/m8/gate/<timestamp>/`
- 阶段执行：`artifacts/m8/<timestamp>/stage-*/`
- 回滚演练：`artifacts/m8/rollback-drill/<timestamp>/`
