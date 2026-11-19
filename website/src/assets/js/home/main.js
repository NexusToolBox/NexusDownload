// 首页电影段：滚动 → 节拍
// 想调节奏，只改下面两段配置。

// 1) 底图（放在 src/assets/img/）。坐标都是“图片里的位置”，左上角 0,0，右下角 1,1
const PLATES = {
  desktop: {
    hero: '/assets/img/hero.jpg',        // 云海 + 岩石上的人
    focus: [0.40, 0.68],                 // 下潜时镜头扎向哪里
    glow: [0.92, 0.44],                  // 地平线上光最亮的位置（天慢慢亮的中心）
  },
  mobile: {
    hero: '/assets/img/hero-m.jpg',
    focus: [0.36, 0.76],
    glow: [0.86, 0.56],
  },
  inCloud: '/assets/img/incloud.jpg',    // 云内部
  clouds: '/assets/img/clouds.jpg',      // 纯黑底的四朵云（镜头穿过的云片）
};

// 2) 时间轴：数字是电影段的滚动进度（0 = 刚开始，1 = 滚完）
const TIMELINE = {
  heroOut: [0.015, 0.11],      // 首屏文字淡出
  dive: [0.03, 0.40],          // 镜头扎进云海（照片推镜）
  travel: [0.03, 0.86],        // 镜头在云片之间往前飞
  fog: [0.20, 0.36],           // 进入云层
  lines: [                     // 雾里的三句话：[出现开始, 完全出现, 开始消失, 完全消失]
    [0.33, 0.37, 0.44, 0.48],
    [0.48, 0.52, 0.59, 0.63],
    [0.63, 0.67, 0.73, 0.76],
  ],
  white: [0.74, 0.86],         // 雾变成页面底色
  land: [0.82, 0.95],          // 产品窗口浮出
  darkNavUntil: 0.24,          // 导航在这之前是白字（进云层后雾很亮，换回深色字）
};
const DAWN_SECONDS = 10;       // 开场“天慢慢亮”用多久

// ---------------------------------------------------------------
const cinema = document.querySelector('[data-cinema]');
const body = document.body;
// 是否“减少动效”在 <head> 里已经判定好了（html 上有 rm 这个 class）
const reduce = document.documentElement.classList.contains('rm');

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const range = (v, [a, b]) => clamp((v - a) / (b - a));
const ease = (t) => t * t * (3 - 2 * t);
const easeIn = (t) => t * t * t;
const bell = (v, [a, b, c, d]) => (v < b ? ease(range(v, [a, b])) : 1 - ease(range(v, [c, d])));

requestAnimationFrame(() => body.classList.add('is-ready'));
if (cinema) start();

// 两种画法：
//   three.js（完整动效）：推镜、下潜、云片穿过
//   图层（减少动效 / 不支持 WebGL）：同样的画面和节奏，只用溶解换场
async function start() {
  const canvas = cinema.querySelector('.cinema__gl');
  const hero = cinema.querySelector('.beat--hero');
  const lines = [...cinema.querySelectorAll('.line')];
  const land = cinema.querySelector('.beat--land');
  const layers = cinema.querySelector('.cinema__layers');
  const lyHero = layers.querySelector('.ly--hero');
  const portrait = () => innerWidth / innerHeight < 0.8;
  const mobile = portrait();

  let scene = null;
  if (!reduce) {
    try {
      const { createScene } = await import('./scene.js');
      const p = mobile ? PLATES.mobile : PLATES.desktop;
      scene = createScene(canvas, { mobile, plates: { ...p, inCloud: PLATES.inCloud, clouds: PLATES.clouds } });
      await scene.ready;
      cinema.classList.add('is-gl');
    } catch (e) {
      console.warn('WebGL 不可用，改用图层版：', e);
      scene = null;
    }
  }
  if (!scene) cinema.classList.add('is-layers');

  let target = 0, shown = 0, prev = 0, blur = 0, last = performance.now(), t0 = last, visible = true;
  const mouse = [0, 0], mouseT = [0, 0];
  const measure = () => {
    const r = cinema.getBoundingClientRect();
    target = clamp(-r.top / (r.height - innerHeight));
  };
  addEventListener('scroll', measure, { passive: true });
  addEventListener('resize', () => {
    measure();
    scene?.resize();
    if (scene && portrait() !== mobile) location.reload();   // 横竖屏切换时换一套底图
  });
  if (scene) addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    mouseT[0] = (e.clientX / innerWidth) * 2 - 1;
    mouseT[1] = (e.clientY / innerHeight) * 2 - 1;
  }, { passive: true });
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; }, { rootMargin: '100px' }).observe(cinema);
  measure();
  shown = prev = target;

  function frame(now) {
    const dt = Math.min(64, now - last); last = now;
    const k = (w) => 1 - Math.pow(1 - w, dt / 16.67);
    // 平滑跟随滚动；减少动效时直接跟手，不加惯性
    shown = reduce ? target : shown + (target - shown) * k(0.08);
    const p = shown;
    const time = (now - t0) / 1000;
    const speed = Math.abs(p - prev) / Math.max(dt, 1) * 1000; prev = p;
    blur += (clamp(speed * 3) - blur) * k(0.1);
    mouse[0] += (mouseT[0] - mouse[0]) * k(0.04);
    mouse[1] += (mouseT[1] - mouse[1]) * k(0.04);

    body.classList.toggle('is-dark', p < TIMELINE.darkNavUntil);

    const heroO = 1 - ease(range(p, TIMELINE.heroOut));
    hero.style.opacity = heroO;
    if (!reduce) hero.style.transform = `translate3d(0, ${-(1 - heroO) * 60}px, 0)`;
    hero.style.visibility = heroO < 0.01 ? 'hidden' : '';

    lines.forEach((el, i) => el.style.setProperty('--o', bell(p, TIMELINE.lines[i]).toFixed(3)));

    const landO = ease(range(p, TIMELINE.land));
    land.style.setProperty('--o', landO.toFixed(3));
    land.classList.toggle('is-on', landO > 0.01);

    const fog = ease(range(p, TIMELINE.fog));
    const white = ease(range(p, TIMELINE.white));
    if (visible && !document.hidden) {
      if (scene) {
        const dive = range(p, TIMELINE.dive);
        scene.render({
          time,
          intro: ease(clamp(time / 2.4)),
          dawn: ease(clamp(time / DAWN_SECONDS)),
          zoom: 1 + 0.035 * ease(clamp(time / 16)) + 1.7 * easeIn(dive),   // 开场慢推 + 下潜猛推
          dive: ease(dive),
          travel: range(p, TIMELINE.travel),
          fog,
          fogZoom: 1 + range(p, [0.2, 0.9]) * 0.5,
          white,
          blur: blur * (1 - range(p, TIMELINE.white)),
          mouse,
        });
      } else {
        // 图层版：先起一层雾，再溶解到云内部，最后化成纸色
        layers.style.setProperty('--haze', (Math.sin(Math.PI * clamp(fog * 1.15)) * 0.85).toFixed(3));
        layers.style.setProperty('--cloud', fog.toFixed(3));
        layers.style.setProperty('--paper', white.toFixed(3));
        // 不减少动效、只是没有 WebGL 时，保留一点推镜
        if (!reduce) lyHero.style.transform = `scale(${(1 + 0.5 * easeIn(range(p, TIMELINE.dive))).toFixed(4)})`;
      }
    }
    // 图层版不需要每帧重画：滚动停下就歇着
    if (scene || Math.abs(target - shown) > 1e-4 || dt === 0) requestAnimationFrame(frame);
    else idle = true;
  }
  let idle = false;
  addEventListener('scroll', () => { if (idle) { idle = false; last = performance.now(); requestAnimationFrame(frame); } }, { passive: true });
  requestAnimationFrame(frame);
}
