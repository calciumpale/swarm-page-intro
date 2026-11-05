/**
 * Swarm Page Intro — independent, dependency-free, viewport-driven DOM reveal.
 * Mark block/inline-block elements data-swarm="box|text|line|duplicate".
 * Scrolling schedules work; leaving the viewport pauses it without resetting it.
 */
const played = new WeakSet();
const active = new WeakMap();
const NS = 'http://www.w3.org/2000/svg';
const COLORS = ['#7758d6', '#e16949', '#278e81', '#3283cd', '#b768a7', '#9b802d'];
const NAMES = ['Layout', 'Type', 'Detail', 'Media', 'Compose', 'Polish'];
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const ease = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const lerp = (a, b, t) => a + (b - a) * t;
const hiddenClip = 'inset(0 100% 100% 0)';

export function startSwarmIntro(options = {}) {
  const doc = typeof document === 'object' ? document : null, win = doc?.defaultView;
  let resolveFinished;
  const finished = new Promise(resolve => { resolveFinished = resolve; });
  let root, controller, observer, resizeObserver, host, svg, agents = [], items = [];
  let frame, watchdog, readinessTimer, closed = false, initialized = false;
  let phase = 'preparing', estimatedDuration = 0, lastFrame = 0, lastState = '';
  let batchRemaining = 0, buildingSince = 0, count = 5, labels = NAMES;
  const handle = { finished, cleanup, getState };
  function getState() {
    const completed = items.filter(item => item.done).length;
    const running = closed || phase !== 'building' ? 0 : items.filter(item => !item.done && item.lane !== null && item.visible).length;
    return { phase, pending: items.length - completed - running, active: running,
      completed, total: items.length, estimatedDuration };
  }
  function notify() {
    const state = getState(), signature = JSON.stringify(state);
    if (signature === lastState) return;
    lastState = signature;
    try { options.onStateChange?.(state); } catch { /* UI callbacks cannot break cleanup. */ }
  }
  function cleanup(reason = 'manual') {
    if (closed) return;
    closed = true;
    if (win) {
      win.cancelAnimationFrame(frame);win.clearTimeout(watchdog);win.clearTimeout(readinessTimer);
    }
    controller?.abort();observer?.disconnect();resizeObserver?.disconnect();
    for (const item of items) { item.animation?.cancel();item.animation = null;item.lane = null; }
    host?.remove();
    phase = ['complete','no-targets','reduced-motion','already-played'].includes(reason) ? 'complete' : 'cancelled';
    if (doc && active.get(doc) === handle) active.delete(doc);
    notify();resolveFinished({ reason });
  }
  if (!doc || !win || !doc.body || !win.Element.prototype.animate) { cleanup('unsupported');return handle; }
  if (active.has(doc)) return active.get(doc);
  try {
    if (win.matchMedia('(prefers-reduced-motion: reduce)').matches) { cleanup('reduced-motion');return handle; }
    if (played.has(doc) && !options.force) { cleanup('already-played');return handle; }
    root = typeof options.root === 'string' ? doc.querySelector(options.root) : options.root || doc;
    if (!root?.querySelectorAll) { cleanup('no-root');return handle; }
    count = Math.round(clamp(Number(options.cursorCount) || (win.innerWidth < 700 ? 3 : 5), 2, 6));
    labels = Array.isArray(options.labels) ? options.labels : NAMES;
    controller = new win.AbortController();active.set(doc, handle);
    const listen = (target, event, callback) => target.addEventListener(event, callback,
      { capture: true, passive: true, signal: controller.signal });
    listen(win, 'keydown', event => { if (event.key === 'Escape') cleanup('Escape'); });
    listen(win, 'pagehide', () => cleanup('pagehide'));
    listen(win, 'scroll', wake);listen(win, 'resize', () => { for (const item of items) { item.measured = false; item.clips = undefined; }wake(); });
    listen(doc, 'visibilitychange', () => { if (doc.hidden) wait();else wake(); });
    listen(doc, 'focusin', event => revealControl(event.target));
    listen(doc, 'pointerdown', event => {
      const control = event.target.closest?.('a,button,input,select,textarea,[contenteditable],[role="button"]');
      if (control) revealControl(control);
    });
    const motion = win.matchMedia('(prefers-reduced-motion: reduce)');
    listen(motion, 'change', () => { if (motion.matches) cleanup('reduced-motion'); });
    const readyTimeout = clamp(Number(options.readyTimeout) || 650, 50, 5000);
    const imageReady = [...root.querySelectorAll('img')].filter(img => intersects(img) && !img.complete).map(img => new Promise(resolve => {
      img.addEventListener('load',resolve,{once:true,signal:controller.signal});
      img.addEventListener('error',resolve,{once:true,signal:controller.signal});
    }));
    const prepared = Promise.all([options.ready,doc.fonts?.ready,...imageReady]).then(() => true,() => false);
    const bounded = new Promise(resolve => {
      readinessTimer = win.setTimeout(() => resolve(false), readyTimeout);
      controller.signal.addEventListener('abort',() => resolve(false),{once:true});
    });
    notify();
    Promise.race([prepared,bounded]).then(ready => {
      if (closed) return;
      win.clearTimeout(readinessTimer);
      if (!ready) { cleanup('not-ready');return; }
      try { initialize(); } catch { cleanup('error'); }
    });
  } catch { cleanup('error'); }
  return handle;

  function initialize() {
    const candidates = [...root.querySelectorAll('[data-swarm]')];
    if (root instanceof win.Element && root.matches('[data-swarm]')) candidates.unshift(root);
    const maxTargets = Math.round(clamp(Number(options.maxTargets) || 160,1,500));
    const indexed = new Map();
    const selected = candidates.filter(el => {
      const r=el.getBoundingClientRect(),style=win.getComputedStyle(el);
      const structural = ['box','duplicate'].includes(el.dataset.swarm) && r.height > win.innerHeight * 1.15 && el.querySelector('[data-swarm]');
      return !structural && r.width>0 && r.height>0 && style.display!=='none' && style.visibility!=='hidden'
        && Number(style.opacity)!==0 && !el.closest('[data-swarm-skip]');
    }).slice(0,maxTargets);
    items = [];
    for (const el of selected) {
      const type=['box','text','line','duplicate'].includes(el.dataset.swarm)?el.dataset.swarm:'box';
      const item={el,type,done:false,progress:0,visible:false,lane:null,duration:0,measured:false,parents:[],clips:[],source:null};
      let parent=el.parentElement;
      while(parent){
        if(indexed.has(parent)) item.parents.push(indexed.get(parent));
        const s=win.getComputedStyle(parent);
        if(parent!==doc.documentElement && parent!==doc.scrollingElement && /auto|scroll|hidden|clip/.test(s.overflowX+' '+s.overflowY)) item.clips.push(parent);
        parent=parent.parentElement;
      }
      if(type==='duplicate') {
        let source;
        try {source=el.dataset.swarmFrom?doc.querySelector(el.dataset.swarmFrom):el.previousElementSibling;} catch {}
        // Forward/self references are box reveals. Dependencies cannot point into the future.
        if(source && source!==el && (!source.matches('[data-swarm]') || indexed.has(source))) item.source=source;
        else item.type='box';
        item.master=indexed.get(source);
      }
      item.cost=type==='text'?clamp(.75+(el.textContent?.trim().length||0)*.022,.85,3):type==='line'?.7:1.15;
      // Paused WAAPI effects hide future content without mutating inline styles or DOM nodes.
      items.push(item);
      item.animation=el.animate([{clipPath:hiddenClip},{clipPath:hiddenClip}],{duration:1000,fill:'both'});
      item.animation.pause();item.animation.currentTime=0;
      indexed.set(el,item);
    }
    if(!items.length){cleanup('no-targets');return;}
    host=doc.createElement('div');host.setAttribute('data-swarm-overlay','');host.setAttribute('aria-hidden','true');
    host.style.cssText='all:initial!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:2147483646!important;pointer-events:none!important;overflow:hidden!important;contain:strict!important;';
    const shadow=host.attachShadow({mode:'open'}),style=doc.createElement('style');
    style.textContent=':host{pointer-events:none}svg{display:block;width:100%;height:100%;overflow:hidden}text{font-family:ui-monospace,SFMono-Regular,monospace;font-size:11px;font-weight:500}';
    shadow.append(style);svg=make('svg',{},shadow);
    agents=Array.from({length:count},(_,i)=>makeAgent(svg,COLORS[i],String(labels[i]||NAMES[i])));
    if(win.IntersectionObserver){observer=new win.IntersectionObserver(wake,{threshold:0});items.forEach(item=>observer.observe(item.el));}
    if(win.ResizeObserver){resizeObserver=new win.ResizeObserver(()=>{items.forEach(item=>item.measured=false);wake();});items.forEach(item=>resizeObserver.observe(item.el));}
    initialized=true;played.add(doc);revealControl(doc.activeElement);wake();
  }
  function intersects(el, clips) {
    if(!el.isConnected) return false;
    const r=el.getBoundingClientRect();
    let left=Math.max(0,r.left),right=Math.min(win.innerWidth,r.right),top=Math.max(0,r.top),bottom=Math.min(win.innerHeight,r.bottom);
    if(!clips){clips=[];for(let p=el.parentElement;p;p=p.parentElement){const s=win.getComputedStyle(p);if(p!==doc.documentElement && p!==doc.scrollingElement && /auto|scroll|hidden|clip/.test(s.overflowX+' '+s.overflowY))clips.push(p);}}
    for(const ancestor of clips){
      if(ancestor===doc.documentElement || ancestor===doc.scrollingElement) continue;
      const b=ancestor.getBoundingClientRect(),s=win.getComputedStyle(ancestor);
      // DOMRects are transformed viewport pixels; client metrics are local CSS pixels.
      // Scale the scrollport before intersecting (axis-aligned positive scales).
      const scaleX=ancestor.offsetWidth?b.width/ancestor.offsetWidth:1;
      const scaleY=ancestor.offsetHeight?b.height/ancestor.offsetHeight:1;
      if(/auto|scroll|hidden|clip/.test(s.overflowX)){left=Math.max(left,b.left+ancestor.clientLeft*scaleX);right=Math.min(right,b.left+(ancestor.clientLeft+ancestor.clientWidth)*scaleX);}
      if(/auto|scroll|hidden|clip/.test(s.overflowY)){top=Math.max(top,b.top+ancestor.clientTop*scaleY);bottom=Math.min(bottom,b.top+(ancestor.clientTop+ancestor.clientHeight)*scaleY);}
    }
    return right>left && bottom>top;
  }
  function revealControl(target) {
    if(!initialized || !target || target===doc.body || target===doc.documentElement) return;
    for(const item of items) if(!item.done && (item.el===target || item.el.contains(target) || target.contains?.(item.el))) finishItem(item);
    wake();
  }
  function finishItem(item) {
    item.done=true;item.progress=1;item.lane=null;item.animation?.cancel();item.animation=null;
    observer?.unobserve(item.el);resizeObserver?.unobserve(item.el);
  }
  function wake() {
    if(closed || !initialized || frame!==undefined) return;
    if(doc.hidden){wait();return;}
    frame=win.requestAnimationFrame(tick);
  }
  function wait() {
    if(closed || !initialized) return;
    win.cancelAnimationFrame(frame);frame=undefined;lastFrame=0;
    if(buildingSince){batchRemaining=Math.max(0,batchRemaining-(win.performance.now()-buildingSince));buildingSince=0;}
    win.clearTimeout(watchdog);watchdog=undefined;
    host?.remove();phase='waiting';notify();
  }
  function planBatch(visible) {
    const fresh=visible.filter(item=>!item.duration);
    if(!fresh.length) return;
    const chars=visible.filter(i=>i.type==='text').reduce((n,i)=>n+Math.min(200,i.el.textContent?.trim().length||0),0);
    const depth=Math.max(0,...visible.map(i=>i.parents.length));
    const explicit=Number(options.duration);
    estimatedDuration=Number.isFinite(explicit)&&explicit>0?clamp(explicit,200,30000)
      :clamp(2200+visible.length*85+chars*2+depth*180+Math.max(0,5-count)*200,3000,12000);
    // Simulate the same ready-task/backfill scheduler used by tick. Reserving a lane
    // for a blocked child overestimates the critical path and makes playback too fast.
    const batch = new Set(visible), simulatedDone = new Set(), started = new Set();
    let simulatedTime = 0, running = [];
    while (simulatedDone.size < visible.length) {
      for (const item of visible) {
        if (running.length >= count) break;
        if (started.has(item)) continue;
        const dependencies = [...item.parents, item.master].filter(dep => dep && batch.has(dep));
        if (dependencies.some(dep => !simulatedDone.has(dep))) continue;
        started.add(item);
        running.push({ item, end: simulatedTime + item.cost * (1 - item.progress) });
      }
      if (!running.length) break;
      simulatedTime = Math.min(...running.map(job => job.end));
      for (const job of running) if (job.end <= simulatedTime + .00001) simulatedDone.add(job.item);
      running = running.filter(job => !simulatedDone.has(job.item));
    }
    const unit = estimatedDuration / Math.max(.001, simulatedTime);
    fresh.forEach(item=>{item.duration=Math.max(70,item.cost*unit);});
    batchRemaining=estimatedDuration*1.8+2500;
    buildingSince=0;win.clearTimeout(watchdog);watchdog=undefined;
  }
  function armWatchdog() {
    if(watchdog!==undefined) return;
    if(batchRemaining<=0) batchRemaining=Math.max(3000,estimatedDuration*1.8+2500);
    buildingSince=win.performance.now();
    watchdog=win.setTimeout(()=>{
      watchdog=undefined;buildingSince=0;
      // Only the visible batch fails open. Unvisited sections retain their scroll gate.
      for(const item of items) if(!item.done && item.visible) finishItem(item);
      batchRemaining=0;
      if(items.every(item=>item.done))cleanup('complete');else{wait();wake();}
    },batchRemaining);
  }
  function tick(time) {
    frame=undefined;
    if(closed) return;
    if(doc.hidden){wait();return;}
    try {
      const delta=lastFrame?Math.min(100,time-lastFrame):0;lastFrame=time;
      for(const item of items){
        if(item.done) continue;
        const r=item.el.getBoundingClientRect();
        if(!item.el.isConnected || r.width<=0 || r.height<=0){finishItem(item);continue;}
        if(item.w!==r.width || item.h!==r.height) item.measured=false;
        Object.assign(item,{x:r.x,y:r.y,w:r.width,h:r.height});
        item.visible=intersects(item.el,item.clips);
        if(!item.visible) item.lane=null;
      }
      const visible=items.filter(item=>!item.done&&item.visible);
      // A visible child can overflow an offscreen parent's box. Reveal that hidden ancestor immediately.
      for(const item of visible) for(const parent of item.parents) if(!parent.done&&!parent.visible) finishItem(parent);
      for(const item of visible) if(item.master&&!item.master.done&&!item.master.visible){item.master=null;item.source=null;item.type='box';item.measured=false;}
      planBatch(visible);
      const used=new Set(items.filter(item=>!item.done&&item.lane!==null).map(item=>item.lane));
      for(const item of visible){
        if(item.done||item.lane!==null||item.parents.some(parent=>!parent.done)||item.master&&!item.master.done)continue;
        const lane=agents.findIndex((_,i)=>!used.has(i));
        if(lane<0) break;
        item.lane=lane;used.add(lane);item.justStarted=true;
      }
      const running=items.filter(item=>!item.done&&item.visible&&item.lane!==null);
      if(items.every(item=>item.done)){cleanup('complete');return;}
      if(!running.length){wait();return;}
      phase='building';armWatchdog();
      if(!host.isConnected)doc.body.append(host);
      set(svg,{viewBox:`0 0 ${win.innerWidth} ${win.innerHeight}`,width:win.innerWidth,height:win.innerHeight});
      agents.forEach(agent=>hide(agent.layer));
      for(const item of running){
        if(!item.measured) configure(item);
        if(!item.justStarted)item.progress=clamp(item.progress+delta/item.duration,0,1);
        item.justStarted=false;item.animation.currentTime=item.progress*1000;
        if(item.progress>=1){finishItem(item);continue;}
        const agent=agents[item.lane];show(agent.layer);draw(item,agent,time);
      }
      if(items.every(item=>item.done)){cleanup('complete');return;}
      notify();if(!closed)frame=win.requestAnimationFrame(tick);
    } catch {cleanup('error');}
  }
  function configure(item) {
    item.letters=item.type==='text'?measureLetters(item.el,item.el.getBoundingClientRect()):[];
    let keyframes;
    if(item.type==='text'&&item.letters.length){
      keyframes=[{clipPath:hiddenClip,offset:0,easing:'steps(1,end)'}];
      item.letters.forEach((letter,i)=>keyframes.push({clipPath:letter.clip,offset:.16+(i+1)/item.letters.length*.79,easing:'steps(1,end)'}));
      keyframes.push({clipPath:'inset(0 0 0 0)',offset:1});
    } else {
      const hidden=item.type==='line'?(item.h>item.w?'inset(0 0 100% 0)':'inset(0 100% 0 0)'):hiddenClip;
      keyframes=[{clipPath:hidden,offset:0},{clipPath:hidden,offset:(item.type==='duplicate'&&item.source?.isConnected) ? .8 : .16},{clipPath:'inset(0 0 0 0)',offset:1}];
    }
    item.animation.effect.setKeyframes(keyframes);item.animation.currentTime=item.progress*1000;item.measured=true;
  }
  function draw(item,agent,time) {
    resetAgent(agent);
    const progress=item.progress,action=clamp((progress-.16)/.84,0,1);
    let x,y;
    const logo=root.querySelector('[data-swarm-logo]')?.getBoundingClientRect();
    const origin=logo&&logo.width&&logo.height&&logo.bottom>0&&logo.top<win.innerHeight
      ?{x:logo.x+logo.width/2,y:logo.y+logo.height/2}:{x:win.innerWidth/2,y:win.innerHeight*.4};
    const source=item.source?.isConnected?item.source.getBoundingClientRect():null;
    if(progress<.16){
      const start=source||item;
      const orbit=progress<.045?(1-progress/.045)*22:0;
      x=lerp(origin.x,start.x,ease(progress/.16))+Math.cos(time/240+item.lane)*orbit;
      y=lerp(origin.y,start.y,ease(progress/.16))+Math.sin(time/240+item.lane)*orbit;
    }else if(item.type==='text'){
      const letter=item.letters[Math.min(item.letters.length-1,Math.floor(action*item.letters.length))];
      x=item.x+(letter?letter.x:item.w*action);y=item.y+(letter?letter.y:item.h);
      show(agent.ibeam);hide(agent.pointer);
      set(agent.caret,{x1:x,y1:item.y+(letter?.top||0),x2:x,y2:y});show(agent.caret);
      set(agent.guide,{x1:Math.max(0,item.x-30),y1:item.y+item.h,x2:Math.min(win.innerWidth,item.x+item.w+30),y2:item.y+item.h});show(agent.guide);
    }else if(item.type==='line'){
      const vertical=item.h>item.w;
      x=item.x+(vertical?item.w/2:item.w*action);y=item.y+(vertical?item.h*action:item.h/2);
      const startX=vertical?x:item.x,startY=vertical?item.y:y;
      show(agent.pen);hide(agent.pointer);
      set(agent.trace,{x1:startX,y1:startY,x2:x,y2:y});show(agent.trace);
      set(agent.anchor,{cx:startX,cy:startY});show(agent.anchor);
    }else if(item.type==='duplicate'&&source){
      x=lerp(source.x,item.x,ease(action));y=lerp(source.y,item.y,ease(action));
      set(agent.box,{x,y,width:item.w,height:item.h});show(agent.box);badge(agent,x+8,y-25,'⌥ copy');
    }else{
      x=item.x+item.w*action;y=item.y+item.h*action;show(agent.crosshair);hide(agent.pointer);
      set(agent.box,{x:item.x,y:item.y,width:Math.max(1,x-item.x),height:Math.max(1,y-item.y)});show(agent.box);
      badge(agent,x+14,y-30,`${Math.round(item.w*action)} × ${Math.round(item.h*action)}`);
    }
    set(agent.cursor,{transform:`translate(${clamp(x,6,win.innerWidth-10)} ${clamp(y,6,win.innerHeight-10)})`});
  }
  function measureLetters(el, rect) {
    if (win.getComputedStyle(el).direction === 'rtl') return [];
    const nodes = [], walker = doc.createTreeWalker(el, win.NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
    const length = nodes.reduce((total, node) => total + node.length, 0);
    const stride = Math.max(1, Math.ceil(length / 120));
    const letters = [], range = doc.createRange();
    let index = 0;
    for (const node of nodes) {
      let offset = 0;
      // Grapheme boundaries keep emoji and combining characters intact.
      const segments = typeof Intl.Segmenter === 'function'
        ? [...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(node.data)].map(v=>v.segment)
        : Array.from(node.data);
      for (const char of segments) {
        const end = offset + char.length;
        index += char.length;
        if (index % stride < char.length || index === length) {
          range.setStart(node, offset);range.setEnd(node, end);
          const r = range.getClientRects()[0];
          if (r && r.width > 0 && r.height > 0) {
            const x=clamp(r.right-rect.x,0,rect.width),top=clamp(r.top-rect.y-2,0,rect.height),bottom=clamp(r.bottom-rect.y+2,0,rect.height);
            letters.push({x:r.right-rect.x,y:r.bottom-rect.y,top:r.top-rect.y,clip:`polygon(0 0,100% 0,100% ${top}px,${x}px ${top}px,${x}px ${bottom}px,0 ${bottom}px)`});
          }
        }
        offset=end;
      }
    }
    return letters;
  }
  function make(tag, attributes, parent) {
    const el=doc.createElementNS(NS,tag);set(el,attributes);parent?.append(el);return el;
  }
  function makeAgent(svg,color,name) {
    const layer=make('g',{},svg);
    const guide=make('line',{stroke:'#e87878','stroke-width':1,'stroke-dasharray':'4 4'},layer);
    const trace=make('line',{stroke:color,'stroke-width':2},layer);
    const anchor=make('circle',{r:3,fill:'white',stroke:color,'stroke-width':1.5},layer);
    const caret=make('line',{stroke:color,'stroke-width':2},layer);
    const box=make('rect',{fill:'none',stroke:color,'stroke-width':1.3,rx:1},layer);
    const pill=make('g',{},layer);
    const pillRect=make('rect',{height:20,rx:4,fill:color},pill);
    const pillText=make('text',{x:7,y:14,fill:'white'},pill);
    const cursor=make('g',{},layer);
    const pointer=make('path',{d:'M0 0L0 19L5.5 14.5L9.5 23L13 21L9 13L16 12Z',fill:color,stroke:'white','stroke-width':1.3,'stroke-linejoin':'round'},cursor);
    const crosshair=make('path',{d:'M-9 0H9M0 -9V9',stroke:color,'stroke-width':1.8},cursor);
    const ibeam=make('path',{d:'M-4 -11H4M0 -11V9M-4 9H4',stroke:color,'stroke-width':1.8},cursor);
    const pen=make('path',{d:'M0 0L6 -14L15 -5Z M0 0L8 -7',fill:'white',stroke:color,'stroke-width':1.5},cursor);
    make('rect',{x:15,y:19,width:Math.min(name.length,18)*6.6+13,height:19,rx:4,fill:color},cursor);
    make('text',{x:21,y:32,fill:'white'},cursor).textContent=name.slice(0,18);
    return {layer,cursor,pointer,crosshair,ibeam,pen,guide,trace,anchor,caret,box,pill,pillRect,pillText};
  }
  function set(el,attributes) { for(const [name,value] of Object.entries(attributes)) el.setAttribute(name,String(value)); }
  function show(el) { el.removeAttribute('display'); }
  function hide(el) { el.setAttribute('display','none'); }
  function resetAgent(agent) {
    for (const key of ['crosshair','ibeam','pen','guide','trace','anchor','caret','box','pill']) hide(agent[key]);
    show(agent.pointer);
  }
  function badge(agent,x,y,text) {
    const width=text.length*6.6+14;
    set(agent.pill,{transform:`translate(${clamp(x,4,win.innerWidth-width-4)} ${clamp(y,4,win.innerHeight-24)})`});agent.pillText.textContent=text;
    set(agent.pillRect,{width});show(agent.pill);
  }
}
