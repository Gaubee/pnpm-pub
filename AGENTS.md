1. 实现 `sepc/*.md` 文档内的全部内容和功能
2. design.md/design.dark.md 是我们的参考设计，注意，仅作参考。因为我们的设计已经基于命令：`pnpm dlx shadcn-svelte init --preset b7VW4OwuB6` 来定调。design.md/design.dark.md 只能作为额外补充。

3. Windows OpenTray frameless 对接（2026-07-17；用户原始输入：直接修复 pnpm-pub，并优化自己的 skills 文档）
   - pnpm-pub 在 Windows 创建 OpenTray broker 前，必须通过 `src/daemon/opentray-windows-host.ts` 选择已验收的 native-material comparator 拓扑，使 `frameless: true, resizable: true` 与源码 `webview-control` 的原生 resize frame 对齐。
   - 内部变量只能存在于这个兼容边界。WebUI、启动脚本、发布脚本和通用 skill 示例不得重复写入 `OPENTRAY_WINDOWS_NATIVE_MATERIAL_COMPARATOR`。
   - 当前拓扑：

     ```text
     pnpm-pub default                  -> comparator HWND -> native L/R/B resize frame + DWM top border
     PNPM_PUB_..._TOPOLOGY=production -> full-client HWND -> application soft resize
     ```

   - OpenTray `0.14.4` 引入、`0.27.4` 沿用的 comparator 顶部 client 投影：左右和底部保留原生 resize inset，顶部只保留 `DWMWA_VISIBLE_FRAME_BORDER_THICKNESS`；utility-window 投影在 0.27 由 `appMode:false` 表达（旧 `style.platform.windows.showInSwitchers:false` 字段已移除）。
   - `PNPM_PUB_OPENTRAY_WINDOWS_HOST_TOPOLOGY=production` 是回退与 A/B 诊断开关，不是产品设置。
   - 当公开 OpenTray 的 `frameless: true, resizable: true` 无需内部变量即可通过 HWND、托盘、placement、resize、taskbar 和视觉验收时，删除兼容模块及对应 skill 特例。

4. OpenTray retained tray window 生命周期（2026-07-17；用户原始输入：最小化后托盘必须显示 Show；默认不出现在系统任务栏；失焦默认 autoHide，除非 keepOnTop 或显式关闭 autoHide；2026-09-15 升级至 0.27.4）
   - 版本基线为 `opentray@0.27.4` 与 `@opentray/ext-webview@0.27.4`（Dock 身份等新增事实见第 5 节）。
   - 单一事实源是原生 operational visibility：

     ```text
     show() 一次完成 bootstrap
       -> visibleChange 驱动菜单与 WebUI 投影
       -> 托盘点击先 isVisible()
            +-- true  -> close()
            `-- false -> toVisible()
     ```

   - 最小化、原生关闭隐藏、原生 auto-hide 都收敛为 `visibleChange(false)`；严禁 WebUI 使用 `document.visibilityState`、blur 或私有布尔值推断 HWND/NSWindow 可见性。
   - pnpm-pub 保留页面退出动画，因此显式使用 `autoHide:false`，动画完成后由 daemon 调用 `close()`；普通托盘应用优先使用 OpenTray 默认原生 auto-hide。
   - `keepOnTop`、`autoHide`、`appMode` 是三个正交事实（0.27 起旧 `style.platform.windows.showInSwitchers` 语义并入 `appMode`：false 即 utility 投影，不出现在任务栏/Alt+Tab）。pnpm-pub 原生窗口固定 `keepOnTop:true`、`appMode` 仅 darwin 为 true（Dock 身份）；偏好字段 `keepOnTop` 当前只表示页面层保持打开门禁，不反向改写原生窗口层级。
   - 页面协议不得重新增加 `windowHidden` 回报。退出动画只允许回报 `completeAutoClose`，窗口事实由 OpenTray 查询与事件提供。
   - 托盘动作必须暴露可等待的完成边界：事件源可以忽略返回值，但菜单回调仍返回同一个 `toggle()` Promise，使宿主适配器、关闭流程与测试能够观察队列完成。`toggle()` 内部必须吞并并记录原生拒绝，禁止形成未处理 Promise。

5. 应用身份与 Dock 启动（2026-09-15；用户原始输入：opentray 底层可以升级了；升级之后有 applicationIcon 的支持，这样我就可以从 Dock 栏直接启动）
   - 版本基线 `opentray@0.27.4` 与 `@opentray/ext-webview@0.27.4`。`createTray` 运行时选项声明 `appIcon` 与 `appLaunch`；`appLaunch` 仅 release 布局（`node <dist>/cli.js start`），dev 会话不写 .app 描述符。
   - darwin 应用图标是 `assets/app-icon.icns`，必须由 `@opentray/icon` 内核生成（`pnpm gen:app-icon`：figma-squircle 平铺、72 DPI、十标签 ICNS）；禁止手搓圆角矩形或直接调用 iconutil——那会偏离内核的统一视觉标准。
   - Dock 热重开由 ext-webview 自动处理（`appMode:true` 的 MRU 窗口 `toVisible()+focus()`）；冷启动走稳定 .app bundle 的 `opentray-launch.json`。`start` 命令（CLI/IPC/Daemon 全链路）对健康 daemon 必须投影开窗意图 `TrayHost.show()`，不得静默退出。
   - daemon 内引用 `trayHost` 的 IPC 回调，其 `let` 声明必须先于 `new IpcServer(...)` 执行——socket 在 boot 早期就接受连接，TDZ ReferenceError 会以 unhandledRejection 落日志（2026-09-15 实证）。

6. 文件意图预警
   - `src/daemon/tray-host.ts` 当前已承载 5 个正交意图，达到上限。后续新增 placement、icon、permission 或其它窗口策略前，必须先征得用户同意并拆分文件。
   - 当前不可调和原因：本轮需要保持既有 `TrayHost` 对外构造边界，且用户要求先完成视觉验收；因此只收敛现有生命周期，不在验收前引入目录级重构。

7. pnpx WebView2 profile 稳定性（2026-07-18；用户原始输入：本地 `pnpm pub start` 正常，但 `pnpx pnpm-pub@latest start` 托盘短暂出现后消失）
   - 根因归属 OpenTray Windows native host：旧版本以可执行文件相对路径创建 WebView2 profile。源码运行、全局安装、`pnpx` 临时安装和 GitHub Actions 构建产物的可执行文件位置不同，会导致 profile 不稳定、冲突或 WebView 初始化失败，最终表现为 broker 断开、托盘窗口消失。
   - OpenTray `0.14.4` 起改用稳定 profile 根目录：`~/.opentray/webview/<package-version>/<caller-label>`；可用 `OPENTRAY_WEBVIEW_DATA_DIR` 显式覆盖。`WebContext` 生命周期覆盖 `WebView`，创建失败时记录实际 profile 路径。
   - pnpm-pub 只需声明并锁定 `opentray` 与 `@opentray/ext-webview` 至 `^0.27.4`，不得在应用层拼接 WebView2 profile、复制 native broker 或通过 `pnpx` 路径做条件分支。
   - 发布验收必须分别检查源码启动和发布包启动：`pnpm pub start`、`pnpx pnpm-pub@latest start`；异常时先核对 `pnpm-pub version`、npm 上的实际版本与 OpenTray 依赖版本，再检查 broker 断开日志。
   - `pnpx` 短暂显示后消失属于发布 artifact/runtime 组合问题，不能只用本地 workspace 运行结果判定已修复。

8. 运行时依赖零构建脚本与发布验收矩阵（2026-09-15；`pnpx pnpm-pub@latest` 安装失败实证，1.4.2 起存量、1.5.1 修复）
   - `dependencies` 禁止出现携带 install/postinstall 构建脚本的包：pnpm dlx/pnpx 沙箱以 `ERR_PNPM_IGNORED_BUILDS` 拒绝安装，`pnpx pnpm-pub@latest start` 在 CLI 运行前就失败。新增运行时依赖前必须 `npm view <pkg> scripts` 核查；确需原生的走 `dist/prebuilds/` 自带分发或换纯 JS 实现。
   - 原生能力自带分发的范本是 keytar：构建期把 `@github/keytar` 的 JS shim 与其 npm tarball 自带的多平台 `.node` 预编译拷入 `dist/prebuilds/keytar/`（core-config 的 TARGET_PLATFORMS 四平台），运行时 `keychain.ts` 以 createRequire 动态加载该拷贝；keytar 因此留在 devDependencies，不得回移 dependencies。
   - 发布验收矩阵（每条真机实证后才算发布完成）：源码路径 `pnpm release:start/status/stop` 生命周期完整；发布包路径 `pnpx pnpm-pub@<version> start`（精确版本 spec）干净安装并启动 daemon；registry 解析由 npm 与当前默认 pnpm（10.x）把 `latest` 指向新版本。
   - 本机已知 quirk：全局 shim 派发的 pnpm 12.4.1 runner 把 `pnpm-pub@latest` 钉死解析到旧版本（dlx/packument 缓存、store、HOME、PNPM_HOME 逐层隔离无效，registry full/corgi/dist-tags 表面均正确）。本机验收一律用精确版本 spec；升级全局默认 pnpm 后需复查 `pnpx pnpm-pub@latest`。
   - 验收命令一律日志走文件、显式判 `$?`：`pnpx ... | head` 会因管道提前关闭把 dlx 进程 SIGPIPE 掉，制造假失败。
