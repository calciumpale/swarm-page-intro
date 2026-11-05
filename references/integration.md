# 接入与恢复指南

## 页面标注

在页面各段标注有代表性的内容。保持无脚本时 HTML 正常显示。不要把整页、跨数屏的大容器或包含关键交互控件的祖先作为待隐藏目标。

```html
<h1><span data-swarm="text">Build something.</span></h1>
<div data-swarm="line" class="divider"></div>
<article id="card-a" data-swarm="box">…</article>
<article data-swarm="duplicate" data-swarm-from="#card-a">…</article>
<section>
  <h2 data-swarm="text">This starts when it scrolls into view.</h2>
</section>
```

`box` 用于图片、框体、按钮内部视觉层；`text` 用于文字；`line` 用于已有分隔线；`duplicate` 通过 `data-swarm-from` 指向先完成的母版。母版无效、未完成或不适合当前位置时可降级拖框，不等待屏外母版而死锁。复制的是轮廓，内部文字独立揭示。`data-swarm-logo` 指定聚集起点，`data-swarm-skip` 排除子树。

标题可按现有设计分为 block span，不能为动画破坏响应式换行。复杂排版、竖排、RTL、媒体内部内容用整体揭示并目测。跨屏父容器只做布局，让子元素分别进入调度；嵌套目标过多会延长依赖链，影响节奏。

**命中测试：** `clip-path` 会影响被裁剪元素的点击区域。关键 CTA/输入框及祖先不裁剪，只标记内部视觉层。普通点击不会取消整场；焦点进入时引擎会释放相关遮罩，但无法保证首击命中尚未显示的裁剪按钮。不要合成或重放用户点击。页面不设 `inert`，覆盖层不接收输入。

## 接入原生项目

复制 `assets/swarm-intro.js` 到项目源码，正常打包并同源加载。

```js
import { startSwarmIntro } from './swarm-intro.js';
const intro = startSwarmIntro({
  root: document.querySelector('#app'),
  duration: 'auto',
});
// 视图卸载：intro.cleanup('unmount');
// 明确跳过：intro.cleanup('skip');
```

外部 ES module 示例需 HTTP 服务；独立打包演示把运行时内嵌后可双击打开。CSP 严格的项目按现有 nonce/stylesheet 机制适配 Shadow DOM 样式，不放宽全站 CSP。模块加载失败时页面本来就是可见的。

## 时长与滚动状态

默认不是整页 6 秒，也不是每段固定 6 秒。先筛出当前真实可见的待构建内容，按数量、字数、依赖、并发成本估算本批预算：普通演示首屏约 6 秒，少内容更短、复杂视口更长。手机减少光标，但不固定压缩成一两秒。

返回 `{finished, cleanup, getState}`：

- `getState()` 返回 `phase`、`pending`、`active`、`completed`、`total`、`estimatedDuration`（ms）。预算表示当前/最近工作批次，不包含等待下一次滚动的时间。
- `onStateChange(state)` 在状态变化时回调，适合演示提示；业务站无需显示实现细节，也不需要轮询。
- `finished` 只在整场完成或取消时 resolve `{reason}`。停在半页时长期未 resolve 是正常状态，网站不能等待它后才开放交互。

状态顺序为 `preparing → building ↔ waiting → complete`，显式退出为 `cancelled`。当前视口完成后移除光标层并停止 RAF，保留屏外目标的暂停遮罩与滚动/布局观察器。进入新区域时重新开工，已完成内容不重播；出屏未完成任务暂停，回来续接。

| 参数 | 默认与用途 |
| --- | --- |
| `root` | `document`；建议页面根 HTMLElement，不是 viewport 限定范围 |
| `duration` | `'auto'` / 省略：按当前任务复杂度估时；数值用于显式指定当前批次参考预算，受引擎范围限制 |
| `ready` | 可选 Promise，关键初始内容就绪；reject 或超时则跳过 |
| `readyTimeout` | 650ms；准备阶段不遮住页面 |
| `cursorCount` | 桌面 5，手机 3 |
| `maxTargets` | 160；超出部分保持原页面，不纳入永远等待的任务 |
| `labels` | 光标简短身份标签 |
| `force` | `false`；显式重播/预览才设 `true` |
| `onStateChange` | 可选状态回调；不在回调里阻塞主线程 |

候选在准备结束时采集。客户端动态插入的后续业务内容默认正常显示；若要求同样参与构建，应在应用 ready 后统一启动，或按明确页面生命周期重新建立作用域，不声称默认会自动追踪无限流。

普通滚轮、触摸、滚动条拖动、Space/PageDown、点击不取消；Esc/明确跳过、路由 cleanup、pagehide 会取消。后台不推进、恢复后继续；resize 重新测量或安全恢复。窗口和内部滚动容器都按真实可见交集触发，不使用向下预加载的巨大 rootMargin。轴对齐正比例缩放的容器统一换算屏幕坐标；旋转、斜切或负缩放镜像的裁剪容器需在项目中另行验证，当前矩形交集不是任意 CSS 变换的精确可见性求解。

无 6 秒全局截止。活动批次有超时恢复，等待滚动、后台时间不计入。所有正常路径与失败路径的 cleanup 都要解除遮罩，取消动画、RAF、timer、observer 与 listener。

## React / Next.js

保持 SSR，独立 client component 启动；不把整个站点改为 client-only。初始候选已挂载后启动，所在页面卸载时清理。

```jsx
'use client';
import { useEffect } from 'react';
import { startSwarmIntro } from './swarm-intro.js';

export function SwarmIntro() {
  useEffect(() => {
    const root = document.querySelector('[data-page-root]');
    if (!root) return;
    const run = startSwarmIntro({ root, duration: 'auto' });
    return () => run.cleanup('unmount');
  }, []);
  return null;
}
```

启动器挂页面组件，避免仅挂持久 layout 导致路由离开不清理。Vue 用 `onMounted`/`onBeforeUnmount`。默认每 document 一次，SPA 内导航不重播；若用户要求每路由一次，在应用层按路由键管理，而不是每次 render 使用 `force`。

默认刷新文档可重播；“每会话一次”需要项目专属 `sessionStorage` key 包装，并捕获存储异常。不要混淆文档、路由和会话。StrictMode 准备中的预演取消不能消耗已播放标记。晚到的 Suspense/客户端内容，应在关键内容 ready 后启动；不为动画阻塞内容显示。

## 防闪与原状态

准备完成前保留真实页面，慢网下可能先看见内容再进入重建。需要无闪首帧时，结合现有启动/加载流程与可自动失效的局部遮罩，不给 `body` 默认永久 `opacity:0`。文字、表单值、事件、焦点、滚动位置和布局均保留，不 clone 整个 body、不替换框架根节点。

## 验收

真实项目至少测试桌面、手机、长页面与实际内部滚动容器；保存动作中段和区域完成截图。

1. **节奏**：普通演示首屏实测约 6 秒；简单与复杂内容时长不同。复杂度只取当前可见任务，不由整页总长度决定。
2. **等待**：停在第一页等待超过 6 秒，当前内容可用、光标消失，下方任务仍未推进。无活动 RAF，未完成的 WAAPI 遮罩是暂停状态。
3. **滚动**：向下带入新内容才开工；停止后仅完成当前可见内容；回到已完成区域不重播；快速滚出未完成区域再回来续接进度，光标对准最新位置。
4. **完整清理**：所有任务完成或跳过后与禁用动画页面比较：DOM 身份、布局、内联样式、输入值、滚动位置保持，无 overlay、动画、辅助线和监听器残留。不能要求 waiting 时移除唤醒监听器或屏外待建遮罩。
5. **交互与故障**：实际点击关键 CTA、输入、Tab、拖动滚动条、触摸和 PageDown 不取消整场且功能可用。另测 Esc、reduced motion、ready 超时/拒绝、后台恢复、resize、卸载、BFCache、重播与 StrictMode；未实际测试的项如实报告。

所附脚本：

```bash
node scripts/test-runtime.mjs
# 外部 Playwright 环境：
# PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/test-runtime.mjs
```

演示：

```bash
python3 -m http.server 8765 --bind 127.0.0.1 --directory /absolute/path/to/swarm-page-intro/assets
```

访问 `http://127.0.0.1:8765/demo.html`。只启动本地服务，不把本地通过说成已部署。
