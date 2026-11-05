// Usage: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/test-runtime.mjs
// Optional SWARM_TEST_FILTER selects one named regression during investigation.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const runtime = fileURLToPath(new URL('../assets/swarm-intro.js', import.meta.url));
assert.ok(existsSync(runtime), 'Swarm runtime must exist before testing its browser contract');
// Exercise one runtime revision even if another process edits the file during the suite.
const runtimeSource = readFileSync(runtime);
const demoSource = readFileSync(new URL('../assets/demo.html', import.meta.url));
const modulePath = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(
  path.isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath
);
const filter = process.env.SWARM_TEST_FILTER
  ? new RegExp(process.env.SWARM_TEST_FILTER, 'i')
  : null;
const style = `*{box-sizing:border-box}html{scroll-behavior:auto}body{margin:0;background:#f5f3ed;color:#282725;font:18px system-ui}main{padding:35px;max-width:1180px}h1{font-size:42px;line-height:1.2;max-width:540px}.cards{display:flex;gap:18px}.card{width:210px;padding:20px;border:1px solid #999;border-radius:14px;background:white}hr{height:1px;border:0;background:#999}button{padding:12px}.controls{position:fixed;right:12px;top:12px;z-index:2;background:#f5f3ed;padding:4px}.long{padding:0;max-width:none}.long section{height:1100px;padding:100px 70px}.target{width:320px;height:180px;background:#ded8ef;border-radius:12px}.complex{display:grid;grid-template-columns:repeat(6,1fr);gap:14px;padding-top:90px}.tile{height:90px;padding:12px;border:1px solid #aaa;border-radius:8px;font-size:14px}@media(max-width:700px){main{padding:20px}.cards{gap:8px}.card{width:150px;padding:12px}.controls{position:static}h1{font-size:30px}}`;
const controls =
  '<div class="controls"><button id="action">Count 0</button><input id="input" aria-label="Test input" value="keep me"></div>';
const script = `import {startSwarmIntro} from '/swarm-intro.js';window.startSwarmIntro=startSwarmIntro;let n=0;document.querySelector('#action').onclick=()=>document.querySelector('#action').textContent='Count '+(++n);window.beforeNodes=[...document.querySelectorAll('main *')];window.snapshot=()=>({html:document.querySelector('main').innerHTML,bodyStyle:document.body.getAttribute('style'),layout:[...document.querySelectorAll('main *')].map(e=>[e.offsetLeft,e.offsetTop,e.offsetWidth,e.offsetHeight]),value:document.querySelector('#input').value});window.observeRun=run=>{window.controller=run;window.hasFinished=false;window.finishResult=null;window.startedAt=performance.now();run.finished.then(result=>{window.hasFinished=true;window.finishResult={...result,elapsed:performance.now()-startedAt};});};window.fixtureReady=true;`;
function html(main, extra = '') {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${style}${extra}</style></head><body>${controls}${main}<script type="module">${script}</script></body></html>`;
}
const sections = [1, 2, 3]
  .map(
    (n) =>
      `<section><div id="section-${n}" data-swarm="box" class="target">Section ${n}</div></section>`,
  )
  .join('');
const fixtures = {
  standard: html(
    '<main><h1 data-swarm="text" style="letter-spacing:-1px">Build in public.<br>Make it yours.</h1><p data-swarm="text">A thoughtful interface, assembled together.</p><hr id="rule" data-swarm="line"><div class="cards"><article id="first" data-swarm="box" class="card"><h2 data-swarm="text">First</h2></article><article data-swarm="duplicate" data-swarm-from="#first" class="card"><h2 data-swarm="text">Second</h2></article></div></main>',
  ),
  long: html(`<main class="long">${sections}</main>`),
  longOverflow: html(`<main class="long">${sections}</main>`, 'html{overflow-x:hidden}'),
  gap: html(`<main class="long">${sections}</main>`, '.long section{height:1400px}'),
  nested: html(
    `<main style="padding:0;max-width:none"><div id="scroller" style="margin:130px 0 0 100px;width:700px;height:480px;overflow:auto;border:4px solid #999">${[1, 2, 3].map((n) => `<section style="height:850px;position:relative"><div id="nested-${n}" data-swarm="box" class="target" style="position:absolute;left:60px;top:100px">Nested ${n}</div></section>`).join('')}</div></main>`,
  ),
  scaleUp: html(
    '<main style="padding:0"><div id="scaled-clip" style="position:relative;width:200px;height:100px;overflow:hidden;transform:scale(2);transform-origin:top left"><div id="scaled-target" data-swarm="box" style="position:absolute;left:20px;top:75px;width:80px;height:20px;background:#ded8ef">Visible</div></div></main>',
  ),
  scaleDown: html(
    '<main style="padding:0"><div id="scaled-clip" style="position:relative;width:200px;height:100px;overflow:hidden;transform:scale(.5);transform-origin:top left"><div id="scaled-target" data-swarm="box" style="position:absolute;left:20px;top:150px;width:80px;height:20px;background:#ded8ef">Clipped</div></div></main>',
  ),
  simple: html(
    '<main class="complex"><div data-swarm="box" class="tile">Simple</div><div data-swarm="box" class="tile">Two</div></main>',
  ),
  complex: html(
    `<main class="complex">${Array.from({ length: 29 }, (_, i) => `<div data-swarm="${i < 5 ? 'text' : 'box'}" class="tile">${i < 5 ? 'Build good things together.' : `Card ${i + 1}`}</div>`).join('')}</main>`,
  ),
};
const server = createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', req.url === '/swarm-intro.js' ? 'text/javascript' : 'text/html');
  res.end(
    req.url === '/swarm-intro.js'
      ? runtimeSource
      : req.url === '/demo.html'
        ? demoSource
        : fixtures[req.url.slice(1)] || fixtures.standard,
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  hasTouch: true,
});
const page = await context.newPage();
page.setDefaultTimeout(5000);
const base = `http://127.0.0.1:${server.address().port}`;
let errors = [],
  passes = 0,
  failures = 0;
page.on('pageerror', (error) => errors.push(error.message));
async function fresh(name = 'standard', viewport = { width: 1280, height: 900 }) {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`${base}/${name}`);
  await page.waitForFunction(() => window.fixtureReady);
}
async function start(options = {}) {
  await page.evaluate((options) => observeRun(startSwarmIntro(options)), options);
}
async function state() {
  return page.evaluate(() => controller.getState());
}
async function phase(value, timeout = 5000) {
  await page.waitForFunction((value) => controller.getState().phase === value, value, { timeout });
  return state();
}
async function ready() {
  await page.waitForFunction(() => controller.getState().phase !== 'preparing');
  return state();
}
async function finished(timeout = 5000) {
  await page.waitForFunction(() => window.hasFinished, null, { timeout });
  return page.evaluate(() => finishResult);
}
async function progress(selector) {
  return page
    .locator(selector)
    .evaluate((el) =>
      el.getAnimations().map((a) => ({ time: Number(a.currentTime), state: a.playState })),
    );
}
async function untouched(selector) {
  const animations = await progress(selector);
  assert.ok(animations.length > 0, 'unvisited targets keep their initial reveal mask');
  for (const a of animations) {
    assert.equal(a.time, 0, 'a target must not build before it becomes visible');
    assert.equal(a.state, 'paused', 'offscreen work must not run');
  }
}
async function clean() {
  assert.equal(
    await page.locator('[data-swarm-overlay]').count(),
    0,
    'temporary drawing tools must be removed',
  );
  assert.equal(
    await page.evaluate(() => document.getAnimations().length),
    0,
    'all reveal animations must be cancelled',
  );
  assert.ok(
    await page.evaluate(() =>
      beforeNodes.every((node, i) => node === [...document.querySelectorAll('main *')][i]),
    ),
    'real DOM identity must survive',
  );
}
async function wheel(delta, x = 1150, y = 700) {
  const before = await page.evaluate(() => scrollY);
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, delta);
  await page.waitForFunction((before) => Math.abs(scrollY - before) > 20, before);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}
async function alignedBox(selector) {
  await page.waitForFunction(
    (selector) => {
      const target = document.querySelector(selector).getBoundingClientRect(),
        shadow = document.querySelector('[data-swarm-overlay]')?.shadowRoot;
      return [...(shadow?.querySelectorAll('rect[fill="none"]') || [])].some((box) => {
        const r = box.getBoundingClientRect();
        return (
          box.getAttribute('display') !== 'none' &&
          r.width > 2 &&
          r.height > 2 &&
          Math.abs(r.x - target.x) < 3 &&
          Math.abs(r.y - target.y) < 3 &&
          r.width <= target.width + 3 &&
          r.height <= target.height + 3
        );
      });
    },
    selector,
    { timeout: 3000 },
  );
}
async function test(name, fn) {
  if (filter && !filter.test(name)) return;
  errors = [];
  const began = Date.now();
  try {
    await fn();
    assert.deepEqual(errors, [], 'runtime must not add page errors');
    passes++;
    console.log(`PASS ${name} (${Date.now() - began}ms)`);
  } catch (error) {
    failures++;
    const diagnostic = await page
      .evaluate(() => ({
        state: (window.controller || window.swarmRun)?.getState?.(),
        finished: window.finishResult || window.swarmResult,
        scrollY,
        animations: document.getAnimations().length,
      }))
      .catch(() => null);
    console.error(
      `FAIL ${name}\n${error.stack}\nState: ${JSON.stringify(diagnostic)}\nPage errors: ${JSON.stringify(errors)}`,
    );
  } finally {
    await page
      .evaluate(() => (window.controller || window.swarmRun)?.cleanup('test-end'))
      .catch(() => {});
  }
}
try {
  await test('progressive sections wait beyond six seconds and build only after real scrolling', async () => {
    await fresh('long');
    const before = await page.evaluate(() => snapshot());
    await start({ duration: 850 });
    // Original red assertion: the old runtime resolves after its first screen.
    await page.waitForTimeout(1300);
    assert.equal(
      await page.evaluate(() => hasFinished),
      false,
      'finishing the visible section must wait for unvisited content instead of completing the whole intro',
    );
    let s = await phase('waiting');
    assert.deepEqual([s.completed, s.pending, s.active, s.total], [1, 2, 0, 3]);
    await untouched('#section-2');
    await untouched('#section-3');
    await page.waitForTimeout(6500);
    assert.equal(
      await page.evaluate(() => hasFinished),
      false,
      'waiting has no six-second global deadline',
    );
    assert.equal((await state()).phase, 'waiting');
    assert.equal(
      await page.locator('[data-swarm-overlay]').count(),
      0,
      'waiting leaves no idle cursor overlay',
    );
    await untouched('#section-2');
    await wheel(1100);
    await phase('building');
    await alignedBox('#section-2');
    s = await phase('waiting');
    assert.deepEqual(
      [s.completed, s.pending],
      [2, 1],
      'stopping partway down builds the visible region and waits',
    );
    await untouched('#section-3');
    await wheel(-1100);
    await page.waitForTimeout(200);
    assert.equal((await state()).completed, 2, 'completed regions must not reset');
    assert.equal((await progress('#section-1')).length, 0, 'completed elements must not replay');
    await wheel(2200);
    await phase('building');
    assert.equal((await finished()).reason, 'complete');
    assert.equal((await state()).completed, 3);
    await clean();
    assert.deepEqual(await page.evaluate(() => snapshot()), before);
    assert.ok(
      await page.evaluate(() => scrollY > 2000),
      'completion preserves visitor scroll position',
    );
  });
  await test('leaving an unfinished region pauses it and returning resumes existing progress', async () => {
    await fresh('gap');
    await start({ duration: 3200 });
    await phase('building');
    await page.waitForFunction(() =>
      document
        .querySelector('#section-1')
        .getAnimations()
        .some((a) => a.currentTime > 150),
    );
    const before = (await progress('#section-1'))[0].time;
    await wheel(500);
    await phase('waiting');
    const paused = (await progress('#section-1'))[0];
    assert.ok(
      paused.time >= before && paused.time < 950,
      'partly built content retains incomplete progress',
    );
    assert.equal(paused.state, 'paused');
    await page.waitForTimeout(450);
    assert.ok(
      Math.abs((await progress('#section-1'))[0].time - paused.time) < 2,
      'offscreen progress freezes',
    );
    await untouched('#section-2');
    assert.equal(await page.evaluate(() => hasFinished), false);
    await wheel(-500);
    await phase('building');
    assert.ok(
      (await progress('#section-1'))[0].time >= paused.time - 2,
      'returning continues instead of starting at zero',
    );
    await page.waitForFunction(
      (previous) =>
        document
          .querySelector('#section-1')
          .getAnimations()
          .some((a) => a.currentTime > previous + 25),
      paused.time,
    );
    await page.evaluate(() => controller.cleanup('route-change'));
    assert.equal((await finished()).reason, 'route-change');
    await clean();
  });
  await test('nested overflow visibility and tool coordinates follow real inner scrolling', async () => {
    await fresh('nested');
    const before = await page.evaluate(() => snapshot());
    await start({ duration: 2400 });
    await phase('building');
    await alignedBox('#nested-1');
    await untouched('#nested-2');
    const r = await page.locator('#scroller').boundingBox();
    await page.mouse.move(r.x + r.width - 30, r.y + r.height - 30);
    await page.mouse.wheel(0, 120);
    await page.waitForFunction(() => document.querySelector('#scroller').scrollTop >= 115);
    await alignedBox('#nested-1');
    await untouched('#nested-2');
    assert.equal(await page.evaluate(() => scrollY), 0, 'the test must scroll the inner container');
    await page.mouse.wheel(0, 730);
    await page.waitForFunction(() => document.querySelector('#scroller').scrollTop >= 840);
    await alignedBox('#nested-2');
    await untouched('#nested-3');
    const stopped = (await progress('#nested-1'))[0].time;
    await page.waitForTimeout(180);
    assert.ok(
      Math.abs((await progress('#nested-1'))[0].time - stopped) < 2,
      'nested clipping pauses a departed target',
    );
    const position = await page.locator('#scroller').evaluate((el) => el.scrollTop);
    await page.evaluate(() => controller.cleanup('unmount'));
    assert.equal((await finished()).reason, 'unmount');
    await clean();
    assert.equal(await page.locator('#scroller').evaluate((el) => el.scrollTop), position);
    assert.deepEqual(await page.evaluate(() => snapshot()), before);
  });
  await test('scale up clipping starts targets inside the enlarged visible area', async () => {
    await fresh('scaleUp');
    const before = await page.evaluate(() => snapshot());
    const bounds = await page.evaluate(() => {
      const parent = document.querySelector('#scaled-clip').getBoundingClientRect();
      const target = document.querySelector('#scaled-target').getBoundingClientRect();
      return { parentBottom: parent.bottom, targetTop: target.top, targetBottom: target.bottom };
    });
    assert.deepEqual(bounds, { parentBottom: 200, targetTop: 150, targetBottom: 190 });
    await start({ duration: 700 });
    assert.equal(
      (await ready()).phase,
      'building',
      'screen-visible content inside a scaled-up clip must start',
    );
    await alignedBox('#scaled-target');
    assert.equal((await finished()).reason, 'complete');
    await clean();
    assert.deepEqual(await page.evaluate(() => snapshot()), before);
  });
  await test('scale down clipping keeps targets beyond the smaller visible area untouched', async () => {
    await fresh('scaleDown');
    const before = await page.evaluate(() => snapshot());
    const bounds = await page.evaluate(() => {
      const parent = document.querySelector('#scaled-clip').getBoundingClientRect();
      const target = document.querySelector('#scaled-target').getBoundingClientRect();
      return { parentBottom: parent.bottom, targetTop: target.top, targetBottom: target.bottom };
    });
    assert.deepEqual(bounds, { parentBottom: 50, targetTop: 75, targetBottom: 85 });
    await start({ duration: 400 });
    assert.equal(
      (await ready()).phase,
      'waiting',
      'content below a scaled-down clip must not start',
    );
    await page.waitForTimeout(700);
    await untouched('#scaled-target');
    const current = await state();
    assert.deepEqual([current.completed, current.active, current.pending], [0, 0, 1]);
    assert.equal(await page.evaluate(() => hasFinished), false);
    await page.evaluate(() => controller.cleanup('scale-test'));
    await clean();
    assert.deepEqual(await page.evaluate(() => snapshot()), before);
  });
  await test('PageDown and native touch input do not end progressive building', async () => {
    await fresh('long');
    await start({ duration: 2500 });
    await phase('building');
    await page.keyboard.press('PageDown');
    await page.waitForFunction(() => scrollY > 100);
    assert.equal(await page.evaluate(() => hasFinished), false, 'navigation keys must not cancel');
    await page.touchscreen.tap(1100, 500);
    assert.equal(await page.evaluate(() => hasFinished), false, 'touchstart must not cancel');
    await wheel(600);
    assert.equal(
      await page.evaluate(() => hasFinished),
      false,
      'wheel and actual scroll must keep the controller alive',
    );
    await page.keyboard.press('Escape');
    assert.equal((await finished()).reason, 'Escape');
    await clean();
  });
  await test('html overflow-x hidden does not mistake the scrolling root for a clipped inner scroller', async () => {
    await fresh('longOverflow');
    await start({ duration: 700 });
    await phase('waiting');
    await wheel(1100);
    await phase('building');
    await alignedBox('#section-2');
    await phase('waiting');
    assert.equal((await state()).completed, 2);
    await untouched('#section-3');
    await wheel(1100);
    assert.equal((await finished()).reason, 'complete');
    await clean();
  });
  await test('auto duration scales with complexity and first screen really lasts about six seconds', async () => {
    await fresh('simple');
    await start();
    const simple = await ready();
    assert.ok(simple.estimatedDuration > 0);
    await page.evaluate(() => controller.cleanup('compare'));
    await fresh('complex');
    await start();
    const complex = await ready();
    assert.equal(complex.total, 29);
    assert.ok(
      complex.estimatedDuration >= simple.estimatedDuration * 1.35,
      `29 targets should be noticeably slower than two: ${simple.estimatedDuration} vs ${complex.estimatedDuration}ms`,
    );
    assert.ok(
      complex.estimatedDuration >= 4800 && complex.estimatedDuration <= 7800,
      `representative first screen estimates about 6s, got ${complex.estimatedDuration}ms`,
    );
    const result = await finished(11000);
    assert.equal(result.reason, 'complete');
    assert.ok(
      result.elapsed >= 4500 && result.elapsed <= 9500,
      `default auto must really take roughly six seconds, got ${result.elapsed}ms`,
    );
    assert.ok(
      Math.abs(result.elapsed - complex.estimatedDuration) < 1500,
      'estimate describes observed build time',
    );
    await clean();
    console.log(
      `  Auto timing: simple=${Math.round(simple.estimatedDuration)}ms, complex=${Math.round(complex.estimatedDuration)}ms, observed=${Math.round(result.elapsed)}ms`,
    );
  });
  await test('bundled demo first screen takes about six seconds then waits for the lower page', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const began = Date.now();
    await page.goto(`${base}/demo.html`);
    await page.waitForFunction(() => window.swarmRun?.getState().phase === 'building');
    const initial = await page.evaluate(() => swarmRun.getState());
    assert.ok(
      initial.estimatedDuration >= 4800 && initial.estimatedDuration <= 8000,
      `demo first-screen estimate should be near 6s, got ${initial.estimatedDuration}ms`,
    );
    await page.waitForFunction(() => swarmRun.getState().phase === 'waiting', null, {
      timeout: 12000,
    });
    const elapsed = Date.now() - began;
    const waiting = await page.evaluate(() => swarmRun.getState());
    assert.ok(
      waiting.completed > 0 && waiting.pending > 0,
      'demo must leave lower sections untouched',
    );
    assert.equal(
      await page.evaluate(() => swarmResult),
      null,
      'the first-screen finish must not complete the full demo',
    );
    assert.ok(
      elapsed >= 5500 && elapsed <= 7500,
      `demo first screen must actually last about 6s; observed ${elapsed}ms`,
    );
    assert.ok(Math.abs(elapsed - initial.estimatedDuration) < 1500);
    assert.equal(await page.locator('[data-swarm-overlay]').count(), 0);
    console.log(
      `  Demo first screen: estimated=${Math.round(initial.estimatedDuration)}ms, observed=${elapsed}ms, completed=${waiting.completed}/${waiting.total}`,
    );
    await page.evaluate(() => swarmRun.cleanup('demo-test'));
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
  });
  await test('completion preserves DOM, one-pixel lines, layout, input and real handlers', async () => {
    await fresh();
    const before = await page.evaluate(() => snapshot());
    await start({ duration: 700 });
    await ready();
    assert.ok((await progress('#rule')).length > 0, 'one-pixel rules participate');
    assert.equal((await finished()).reason, 'complete');
    await clean();
    assert.deepEqual(await page.evaluate(() => snapshot()), before);
    await page.click('#action');
    assert.equal(await page.locator('#action').textContent(), 'Count 1');
    await page.fill('#input', 'still editable');
    assert.equal(await page.locator('#input').inputValue(), 'still editable');
    assert.equal(
      await page.evaluate(async () => (await startSwarmIntro().finished).reason),
      'already-played',
    );
  });
  await test('unclipped controls work during building and keep input state', async () => {
    await fresh();
    await page.fill('#input', 'typed before playback');
    await start({ duration: 2400 });
    await phase('building');
    await page.click('#action');
    assert.equal(await page.locator('#action').textContent(), 'Count 1');
    await page.fill('#input', 'typed during playback');
    await page.evaluate(() => controller.cleanup('interaction-test'));
    await clean();
    assert.equal(await page.locator('#input').inputValue(), 'typed during playback');
  });
  await test('reduced motion skips without changing content', async () => {
    await fresh();
    const before = await page.evaluate(() => snapshot());
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await start();
    assert.equal((await finished()).reason, 'reduced-motion');
    await clean();
    assert.deepEqual(await page.evaluate(() => snapshot()), before);
  });
  await test('readiness timeout and rejection fail open', async () => {
    await fresh();
    const before = await page.evaluate(() => snapshot());
    await page.evaluate(() =>
      observeRun(startSwarmIntro({ ready: new Promise(() => {}), readyTimeout: 80 })),
    );
    const result = await finished();
    assert.equal(result.reason, 'not-ready');
    assert.ok(result.elapsed < 1000);
    await clean();
    assert.deepEqual(await page.evaluate(() => snapshot()), before);
    await fresh();
    await page.evaluate(() =>
      observeRun(startSwarmIntro({ ready: Promise.reject(new Error('data unavailable')) })),
    );
    assert.equal((await finished()).reason, 'not-ready');
    await clean();
  });
  await test('cleanup during preparation prevents late resurrection', async () => {
    await fresh();
    await page.evaluate(() => {
      let resolve;
      const pending = new Promise((r) => (resolve = r));
      observeRun(startSwarmIntro({ ready: pending, readyTimeout: 1000 }));
      controller.cleanup('unmount');
      resolve();
    });
    assert.equal((await finished()).reason, 'unmount');
    await page.waitForTimeout(120);
    await clean();
  });
  await test('route cleanup while waiting restores unvisited content', async () => {
    await fresh('long');
    const before = await page.evaluate(() => snapshot());
    await start({ duration: 250 });
    await phase('waiting');
    await page.evaluate(() => controller.cleanup('route-change'));
    assert.equal((await finished()).reason, 'route-change');
    await clean();
    assert.deepEqual(await page.evaluate(() => snapshot()), before);
    await wheel(1100);
    await page.waitForTimeout(150);
    await clean();
  });
  await test('Escape while waiting clears the remaining page', async () => {
    await fresh('long');
    await start({ duration: 250 });
    await phase('waiting');
    await page.keyboard.press('Escape');
    assert.equal((await finished()).reason, 'Escape');
    await clean();
  });
  await test('StrictMode-style setup cleanup setup does not consume a run', async () => {
    await fresh();
    await page.evaluate(() => {
      const first = startSwarmIntro({ duration: 450 });
      first.cleanup('strict-mode-probe');
      observeRun(startSwarmIntro({ duration: 450 }));
    });
    assert.equal((await finished()).reason, 'complete');
    await clean();
  });
  await test('missing root fails open', async () => {
    await fresh();
    await start({ root: '#missing' });
    assert.equal((await finished()).reason, 'no-root');
    await clean();
  });
  await test('mobile viewport completes visible content and restores interaction', async () => {
    await fresh('standard', { width: 390, height: 844 });
    await start({ duration: 650 });
    assert.equal((await finished()).reason, 'complete');
    await clean();
    await page.click('#action');
    assert.equal(await page.locator('#action').textContent(), 'Count 1');
  });
  if (!passes && !failures) throw new Error(`No tests matched ${filter}`);
  console.log(`Browser regression result: ${passes} passed, ${failures} failed.`);
  if (failures) process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
