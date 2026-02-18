# AgentifUI i18n 技术分析

## 1. 目标与范围

本文分析当前项目国际化（i18n）实现机制，覆盖：

- 语言来源与解析流程
- 翻译资源结构与回退策略
- 页面层调用方式（静态翻译 + 动态翻译）
- 管理后台错误模块的 i18n 落地情况
- 校验与回归手段

---

## 2. 核心架构

### 2.1 语言配置中心

文件：`lib/config/language-config.ts`

- 定义 `SUPPORTED_LANGUAGES`（当前 10 种语言）：
  - `en-US`, `zh-CN`, `zh-TW`, `ja-JP`, `es-ES`, `pt-PT`, `fr-FR`, `de-DE`, `ru-RU`, `it-IT`
- 默认语言：`DEFAULT_LOCALE = 'en-US'`
- 提供：
  - `isValidLocale(locale)`：语言合法性校验
  - `setLanguageCookie(locale)` / `getCurrentLocaleFromCookie()`：前端 cookie 读写

### 2.2 请求级语言与消息加载

文件：`i18n/request.ts`

请求链路：

1. 从 cookie `NEXT_LOCALE` 读取当前语言
2. 若非法则回落到 `DEFAULT_LOCALE`
3. 加载 `messages/{locale}.json`
4. 若非默认语言，再加载英文包并 `deepMerge` 补齐缺失键

关键结论：

- 回退是“键级补齐”，不是整包覆盖
- 非英文语言允许逐步补翻译，不会因为缺键直接崩溃

### 2.3 全局注入

文件：`app/layout.tsx`

- `getLocale()` + `getMessages()` 获取当前请求语言和文案
- 通过 `NextIntlClientProvider` 注入到整个 React 树
- 页面组件通过 `useTranslations(namespace)` 读取翻译

---

## 3. 翻译资源组织

目录：`messages/*.json`

- 所有语言使用一致 JSON 结构（项目有脚本强约束）
- 主要命名空间：
  - `pages.*`：页面文案
  - `dynamicTitle.*`：浏览器动态标题
  - `errors.*` 等公共区块

约束特性：

- 项目要求“行数一致 + 键结构一致”，用于快速发现缺失和漂移
- 新增键时必须同步到所有语言文件，否则校验失败

---

## 4. 页面侧调用模式

### 4.1 静态翻译（主流）

使用 `next-intl`：

- `useTranslations('pages.admin.layout')`
- `useTranslations('pages.admin.errors')`

适合稳定文案、菜单、按钮、表头、提示文案。

### 4.2 动态翻译（后台可改文案）

文件：`lib/hooks/use-dynamic-translations.ts`

机制：

- 通过 `/api/translations/{locale}?sections=...` 拉取动态文案
- 内存缓存（带 TTL）
- API 失败自动回退到静态文案 `useTranslations()`

适合“运营后台实时可编辑”的文案区块，不影响静态包兜底。

---

## 5. 动态标题（Dynamic Title）机制

文件：`components/ui/dynamic-title.tsx`

- 基于路由计算标题
- 使用 `dynamicTitle.*` 命名空间
- 本次已补充 `/admin/errors` 路由映射，确保错误监控页标题支持多语言

---

## 6. 管理后台错误模块 i18n 落地（本轮）

已完成的代码改造：

- `app/admin/layout.tsx`
  - 侧边栏 `Errors` 菜单改为 `menuItems.errors.*` 翻译键
- `app/admin/page.tsx`
  - 首页错误模块卡片标题/描述改为翻译键
- `app/admin/errors/page.tsx`
  - 标题、副标题、刷新按钮、统计卡、表头、空态、错误兜底文案全部改为 `pages.admin.errors.*`
  - 严重级别（critical/error/warn/info）使用翻译键映射
- `components/ui/dynamic-title.tsx`
  - 新增 `/admin/errors -> dynamicTitle.admin.errors`

翻译资源：

- 主翻译：`messages/en-US.json`、`messages/zh-CN.json`
- 同步补齐并本地化：`zh-TW / ja-JP / es-ES / pt-PT / fr-FR / de-DE / ru-RU / it-IT`

---

## 7. 校验与验证

### 7.1 结构校验

- `pnpm -s i18n:check`
- `pnpm -s i18n:validate`

校验点：

- 所有语言文件 JSON 可解析
- 行数一致
- 键结构一致

### 7.2 类型与代码检查

- `pnpm -s type-check`
- `pnpm -s lint:files <changed-files>`

### 7.3 UI 冒烟（已执行）

对 `/admin/errors` 做 8 语言可视化验证（标题 + 刷新按钮 + 页面可达）：

- 结果：`output/playwright/i18n-errors-smoke/result.json`
- 摘要：`output/playwright/i18n-errors-smoke/summary.md`
- 截图：`output/playwright/i18n-errors-smoke/admin-errors-*.png`

---

## 8. 风险与建议

### 8.1 当前风险

- 项目 i18n 对“全语言同结构”要求严格，新功能加键时改动面较大
- 若只改 `en-US/zh-CN`，CI 很容易被 i18n 校验拦截

### 8.2 建议流程

新增翻译键时固定执行：

1. 先在 `en-US`、`zh-CN` 定稿
2. 同步补齐其余语言（可先占位，再本地化）
3. 跑 `i18n:check` + `i18n:validate`
4. 再跑对应页面 UI 冒烟

---

## 9. 关键文件索引

- `lib/config/language-config.ts`
- `i18n/request.ts`
- `app/layout.tsx`
- `lib/hooks/use-dynamic-translations.ts`
- `components/ui/dynamic-title.tsx`
- `app/admin/layout.tsx`
- `app/admin/page.tsx`
- `app/admin/errors/page.tsx`
- `messages/en-US.json`
- `messages/zh-CN.json`
