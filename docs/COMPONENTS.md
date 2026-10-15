# 前端组件登记（COMPONENTS.md）

本文件登记 `web/src/components/` 下的可复用组件。新增或改动可复用组件时必须同笔更新本表。
每个组件文件头写 TSDoc（props 含义、默认值、注意事项、可访问性要点）。不引入 Storybook。

约定：组件均为命名导出；样式走同名 `*.module.css`。示例中的 `import` 省略 `.tsx` 后缀。

## 布局与导航

| 组件 | 用途 | 关键 props（默认值） | 最小示例 | 注意事项 |
|---|---|---|---|---|
| `HomeNav` | 首页顶部分类切换（倒计时 / 正数 / 生日）。| `category`、`onChange`、`hidden=false` | `<HomeNav category={c} onChange={setC} />` | `hidden` 为真时从视口隐藏但仍保留占位；`role` 用 tablist。|
| `SectionHeader` | 分组标题栏，支持折叠与计数。| `title`、`count`、`color`、`variant`、`collapsed`、`onToggle` | `<SectionHeader title="家人" count={3} color="#2196F3" variant="tag" collapsed={false} onToggle={fn} />` | `variant` 决定配色；折叠按钮带 `aria-expanded`。|
| `ReminderCard` | 单条提醒卡片，展示倒计时与标签色。| `item`、`today`、`tagColor=null`、`large=false`、`onOpen`、`onRequestMenu?` | `<ReminderCard item={it} today={d} onOpen={fn} />` | `onRequestMenu` 提供右键 / 长按菜单点；不可用时省略。|
| `ThemeToggle` | 明暗主题切换按钮。| 无 | `<ThemeToggle />` | 自读主题 store；带 `aria-label`。|
| `ThemeController` | 无 UI：把主题设置同步到 `document`。| 无 | `<ThemeController />` | 在应用根部挂载一次即可。|

## 通用 UI（`ui.tsx`）

| 组件 | 用途 | 关键 props（默认值） | 最小示例 | 注意事项 |
|---|---|---|---|---|
| `IconButton` | 图标按钮，提供可访问名称。| `label`、`onClick`、`children`、`pressed=false`、`disabled=false`、`className?` | `<IconButton label="设置" onClick={fn}><SettingsIcon /></IconButton>` | `label` 必填并映射为 `aria-label`。|
| `Toggle` | 开关。| `checked`、`onChange`、`label?`、`disabled=false` | `<Toggle checked={on} onChange={setOn} label="自动同步" />` | `role="switch"`；`label` 用于可访问名称。|
| `MenuOverlay` | 弹出菜单（可锚定坐标）。| `open`、`items`、`onClose`、`anchor?` | `<MenuOverlay open={o} items={items} onClose={fn} />` | Esc 关闭；`MenuItem={key,label,danger?,icon?,onSelect}`。|
| `ConfirmDialog` | 二次确认对话框（可要求输入指定词）。| `open`、`title`、`message`、`confirmText='确定'`、`cancelText='取消'`、`danger=false`、`requireText?`、`onConfirm`、`onCancel` | `<ConfirmDialog open={o} title="删除" message="确定删除？" danger onConfirm={fn} onCancel={fn2} />` | `role="dialog"` + `aria-modal`；`requireText` 需原样输入才可确认。|

## 认证与会话

| 组件 | 用途 | 关键 props（默认值） | 最小示例 | 注意事项 |
|---|---|---|---|---|
| `AppLockGate` | 应用锁：锁定态下渲染解锁门。| `children` | `<AppLockGate><App /></AppLockGate>` | 未设置锁时直接透传 `children`。|
| `UnlockForm` | 应用解锁表单。| `stored`、`onUnlock` | `<UnlockForm stored={s} onUnlock={fn} />` | 由 `AppLockGate` 内部使用；口令不落日志。|
| `PasswordField` | 带显隐切换的口令输入。| `value`、`visible`、`onChange`、`onToggleVisible`、`label?`、`autoComplete?`、`autoFocus=false`、`placeholder?`、`ariaLabel?`、`disabled=false` | `<PasswordField value={v} visible={vis} onChange={setV} onToggleVisible={fn} ariaLabel="口令" />` | 显隐按钮带可访问名称；`autoComplete` 建议 `current-password`。|
| `AuthWarningBanner` | 弱口令 / 认证风险提示条。| `onDismiss` | `<AuthWarningBanner onDismiss={fn} />` | 仅在服务端报告 `authWarning` 时渲染。|
| `ServerLoginDialog` | 服务器登录对话框。| 无 | `<ServerLoginDialog />` | 通过 store 驱动显隐；提交走 `lib/api`。|
| `ServerStatusBar` | 服务器连接状态条。| 无 | `<ServerStatusBar />` | 自读 store；客户端模式下不渲染。|

## 设置与同步

| 组件 | 用途 | 关键 props（默认值） | 最小示例 | 注意事项 |
|---|---|---|---|---|
| `ModeSettings` | 服务器 / 客户端模式切换与迁移入口。| `onNotice`、`mode?`、`serverReachable?` | `<ModeSettings onNotice={fn} />` | `mode` / `serverReachable` 可注入（测试 / SSR）；缺省读 store。|
| `ServerSettings` | 服务器模式设置面板。| `onNotice` | `<ServerSettings onNotice={fn} />` | 口令类字段只写不读。|
| `WebDavSettings` | WebDAV / 自动同步总设置面板。| `onNotice`、`mode?` | `<WebDavSettings onNotice={fn} />` | 含中继开关；凭据不回显。|
| `CloudBackupList` | 云端备份列表（恢复 / 删除）。| `files`、`onRestore`、`onDelete`、`busy` | `<CloudBackupList files={fs} onRestore={fn} onDelete={fn2} busy={b} />` | 供 `WebDavSettings` 复用。|
| `SyncStatusPanel` | 同步状态摘要面板。| `loaded`、`error`、`enabled`、`status` | `<SyncStatusPanel loaded error={e} enabled={en} status={st} />` | `status` 为 null 时展示占位。|

## 分享与导出

| 组件 | 用途 | 关键 props（默认值） | 最小示例 | 注意事项 |
|---|---|---|---|---|
| `ShareImageDialog` | 分享图预览与“下载 PNG”。| `item`、`today`、`tagColor`、`onClose` | `<ShareImageDialog item={it} today={d} tagColor={c} onClose={fn} />` | 画布带 `aria-label="分享图预览"`；下载走 `lib/download`。|

## 其它

| 组件 | 用途 | 关键 props | 最小示例 | 注意事项 |
|---|---|---|---|---|
| `LunarGate` | 农历数据就绪前占位。| `children` | `<LunarGate><App /></LunarGate>` | 需要农历时才触发按需载入。|
| `ErrorFallback` | 渲染错误回退界面。| `message` | `<ErrorFallback message={m} />` | 由 `ErrorBoundary` 内部使用。|
| `UnhandledErrorNotice` | 未捕获错误提示条。| 无 | `<UnhandledErrorNotice />` | 监听全局 `error` / `unhandledrejection`。|
| `icons.tsx` | 共用 SVG 图标集合。| `IconProps = {width?,height?,className?}` | `<SettingsIcon width={20} height={20} />` | 图标默认 `aria-hidden`；可访问名称由外层按钮提供。|

> `ErrorBoundary` / `ThemeController` 等以副作用为主的组件不额外登记 props；测试文件 `*.test.tsx` 不登记。
