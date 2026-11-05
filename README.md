# Swarm Page Intro

让彩色光标像设计团队一样，协作搭建你的网页。

光标会拖出框体、显示尺寸、逐字揭示文字、描绘线条和复制卡片轮廓。普通演示首屏约 **6 秒**，实际根据可见内容的复杂度调整；滚动到新区域时才继续构建。当前区域完成后，光标退场等待，页面保持正常交互。

## 预览

下载或克隆仓库后，直接用浏览器打开 **[preview.html](preview.html)**。这是包含运行时的独立长页演示，无需安装依赖。

也可以启动本地服务：

```bash
python3 -m http.server 8765 --bind 127.0.0.1 --directory assets
```

然后打开 `http://127.0.0.1:8765/demo.html`。

尝试停在半页、继续下滚、返回上方，以及点击“跳过动画”。

## 作为 Codex Skill 使用

将仓库放入 `~/.codex/skills/swarm-page-intro`，供 Codex 发现。目录已经存在时，先保留或更新已有版本。

在目标项目中调用：

```text
使用 $swarm-page-intro 为这个项目添加多光标协作搭建效果。
首屏约 6 秒，按内容复杂度调整，随滚动继续，结束后正常使用。
```

[SKILL.md](SKILL.md) 是入口；[接入指南](references/integration.md) 包含原生、React / Next.js 等项目的接入方式、生命周期和验收要求。已上线网站需要将效果接入源码并重新部署，访客无需安装浏览器插件。

## 直接接入网页

将 [assets/swarm-intro.js](assets/swarm-intro.js) 加入项目，给需要参与的真实元素标注动作类型：

```html
<h1 data-swarm="text">Build together.</h1>
<div data-swarm="line" class="divider"></div>
<article id="card-a" data-swarm="box">…</article>
<article data-swarm="duplicate" data-swarm-from="#card-a">…</article>
```

```js
import { startSwarmIntro } from './swarm-intro.js';

const intro = startSwarmIntro({
  root: document.querySelector('#app'),
  duration: 'auto',
});

// 所在视图卸载时：
// intro.cleanup('unmount');
```

普通点击和滚动不会取消整场；Esc 或显式 `cleanup()` 会立即恢复完整页面。`prefers-reduced-motion: reduce` 会跳过效果。关键按钮和表单保留正常命中区域，只给内部视觉层标注动画。更多参数与边界见接入指南。

## 滚动和时长

- 只推进真正进入视口的目标；屏外内容等待。
- 当前区域完成后停止动画循环，等待下次滚动。
- 已完成内容不重播，未完成内容离屏暂停、返回续接。
- 按当前任务数量、字数、依赖和光标并发估算时长，不按整页长度延长首屏等待。
- 所有目标完成或显式退出后，清理临时覆盖层、动画与监听器。

`intro.getState()` 提供状态快照，`onStateChange` 可用于演示提示。`intro.finished` 只在整场结束时解析；页面不应等待这个 Promise 后才开放交互。

## 测试

需要 Node.js 与 Playwright Chromium：

```bash
npm install --no-save --package-lock=false playwright
npx playwright install chromium
node scripts/test-runtime.mjs
```

已有外部 Playwright 环境时：

```bash
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/test-runtime.mjs
```

测试覆盖长页等待、实际滚动、暂停续建、内部容器和缩放裁剪、时长、真实交互及清理。`SWARM_TEST_FILTER` 可按测试名筛选运行。

## 文件

| 文件 | 用途 |
| --- | --- |
| `SKILL.md` | Codex Skill 入口 |
| `assets/swarm-intro.js` | 零依赖 ES module 运行时 |
| `assets/demo.html` | 使用外部运行时的长页演示 |
| `preview.html` | 可直接打开的独立演示 |
| `references/integration.md` | 参数、框架接入和验收 |
| `references/motion-spec.md` | 视觉规范与来源 |
| `scripts/test-runtime.mjs` | 浏览器回归测试 |

## 灵感与实现

视觉行为参考 [Swarm Rebuild](https://github.com/DhvanilPatel/swarm-cursors)，其灵感来自 Joel Califa 的 [Swarm](https://califa.github.io/swarm-site/)。本项目运行时为独立实现，未复制上游源码或媒体资源；参考来源与复用边界记录在视觉规范中。

当前实现面向显式标注的页面元素，不包含原扩展的任意网页快照、Tour、声音或上千图层重建。旋转、斜切及负缩放镜像容器的裁剪需在具体项目中另行验证。
