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

   - OpenTray `0.14.3` 继承 comparator 顶部 client 投影：左右和底部保留原生 resize inset，顶部只保留 `DWMWA_VISIBLE_FRAME_BORDER_THICKNESS`；同时保持 `style.platform.windows.showInSwitchers:false` 的 utility-window 投影。
   - `PNPM_PUB_OPENTRAY_WINDOWS_HOST_TOPOLOGY=production` 是回退与 A/B 诊断开关，不是产品设置。
   - 当公开 OpenTray 的 `frameless: true, resizable: true` 无需内部变量即可通过 HWND、托盘、placement、resize、taskbar 和视觉验收时，删除兼容模块及对应 skill 特例。

4. OpenTray retained tray window 生命周期（2026-07-17；用户原始输入：最小化后托盘必须显示 Show；默认不出现在系统任务栏；失焦默认 autoHide，除非 keepOnTop 或显式关闭 autoHide）
   - 版本基线为 `opentray@0.14.3` 与 `@opentray/ext-webview@0.14.3`。
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
   - `keepOnTop`、`autoHide`、`showInSwitchers` 是三个正交事实。pnpm-pub 原生窗口固定 `keepOnTop:true`、`style.platform.windows.showInSwitchers:false`；偏好字段 `keepOnTop` 当前只表示页面层保持打开门禁，不反向改写原生窗口层级。
   - 页面协议不得重新增加 `windowHidden` 回报。退出动画只允许回报 `completeAutoClose`，窗口事实由 OpenTray 查询与事件提供。

5. 文件意图预警
   - `src/daemon/tray-host.ts` 当前已承载 5 个正交意图，达到上限。后续新增 placement、icon、permission 或其它窗口策略前，必须先征得用户同意并拆分文件。
   - 当前不可调和原因：本轮需要保持既有 `TrayHost` 对外构造边界，且用户要求先完成视觉验收；因此只收敛现有生命周期，不在验收前引入目录级重构。
