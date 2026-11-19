// 首页电影段的 three.js 场景
//
// 画面分三层：
//   1. 背景（全屏着色器）：首屏照片 → 下潜推镜 → 云内部照片 → 页面底色
//   2. 云片（三维平面）：从纯黑底的云朵素材里裁出来，分布在不同深度，镜头穿过它们
//   3. 雾气（背景着色器里用噪声画）：负责“一直在动”，可以无限循环、没有接缝
//
// 照片只负责质感，动都交给代码。
import * as THREE from '/assets/vendor/three.module.min.js';

const NOISE = /* glsl */ `
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = r * p * 2.03; a *= 0.5; }
    return v;
  }
`;

// ---------------------------------------------------------------- 背景
const backdropFrag = /* glsl */ `
  precision highp float;
  uniform vec2 uRes, uHeroSize, uCloudSize, uFocus, uMouse, uGlow;
  uniform float uTime, uIntro, uDawn, uZoom, uDive, uFog, uFogZoom, uWhite, uBlur, uHas;
  uniform sampler2D uHero, uCloud;
  uniform vec3 uBg;
  varying vec2 vUv;
  ${NOISE}

  // 图片坐标（左上角 0,0）下的 cover 铺满
  vec2 cover(vec2 uv, vec2 img) {
    float rs = uRes.x / uRes.y, ri = img.x / img.y;
    vec2 s = rs > ri ? vec2(1.0, ri / rs) : vec2(rs / ri, 1.0);
    return (uv - 0.5) * s + 0.5;
  }
  vec3 heroAt(vec2 p) { return texture2D(uHero, vec2(p.x, 1.0 - clamp(p.y, 0.001, 0.999))).rgb; }
  vec3 cloudAt(vec2 p) { return texture2D(uCloud, vec2(p.x, 1.0 - clamp(p.y, 0.001, 0.999))).rgb; }

  void main() {
    vec2 sp = vec2(vUv.x, 1.0 - vUv.y);         // 屏幕坐标，左上角 0,0
    float aspect = uRes.x / uRes.y;

    // ---- 首屏照片：推镜 + 鼠标视差 + 下潜
    vec2 cu = cover(sp, uHeroSize) + uMouse * vec2(0.006, 0.004);
    vec2 c0 = mix(uFocus, cover(vec2(0.5, 0.5), uHeroSize), uDive);
    vec2 hp = uFocus + (cu - c0) / uZoom;

    // 下潜时沿径向轻微拖影，速度感从这里来
    vec2 dir = (hp - uFocus) * 0.035 * uBlur;
    vec3 hero = vec3(0.0);
    for (int i = 0; i < 8; i++) hero += heroAt(hp - dir * float(i) / 7.0);
    hero /= 8.0;

    // 天慢慢亮：地平线右侧的光变暖、变宽
    vec2 g = (hp - uGlow) * vec2(1.0, 3.2);
    float glow = exp(-dot(g, g) * 7.0);
    hero += vec3(0.20, 0.13, 0.07) * glow * uDawn;
    hero *= 0.9 + 0.1 * uDawn;

    // 近处流动的薄雾（只在云海里，避开天空）
    float below = smoothstep(uGlow.y + 0.02, uGlow.y + 0.3, hp.y);
    vec2 mp = vec2(hp.x * aspect * 2.2 - uTime * 0.018, hp.y * 5.0);
    float mist = fbm(mp) * fbm(mp * 0.5 + vec2(uTime * 0.006, 3.0));
    hero = mix(hero, vec3(0.70, 0.72, 0.76) + glow * 0.12, smoothstep(0.12, 0.45, mist) * below * 0.22);

    vec3 col = hero;

    // ---- 云内部
    vec2 fu = cover(sp, uCloudSize);
    fu = vec2(0.5, 0.55) + (fu - vec2(0.5, 0.55)) / uFogZoom;
    float n1 = fbm(sp * vec2(aspect, 1.0) * 2.2 + vec2(uTime * 0.02, -uTime * 0.03));
    fu += (n1 - 0.5) * 0.012;                                   // 雾在微微翻涌
    vec3 cloud = cloudAt(fu);
    // 雾不是整体淡入，而是一团一团涌上来
    float edge = uFog * 1.3 - 0.15 + (n1 - 0.5) * 0.7 * (1.0 - uFog);
    col = mix(col, cloud, smoothstep(0.0, 0.35, edge));

    // ---- 落地：雾化成页面底色
    float w = smoothstep(0.0, 1.0, uWhite * 1.2 - 0.2 + (n1 - 0.5) * 0.4 * (1.0 - uWhite));
    col = mix(col, uBg, clamp(w, 0.0, 1.0));

    // 暗角
    float vig = smoothstep(0.45, 1.15, length((sp - 0.5) * vec2(aspect * 0.8, 1.0)));
    col *= 1.0 - vig * 0.28 * (1.0 - uFog) * (1.0 - uWhite);

    col *= uIntro;
    col += (hash(sp * uRes + fract(uTime)) - 0.5) / 255.0;     // 抖动，避免天空色带
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---------------------------------------------------------------- 云片
const cardVert = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const cardFrag = /* glsl */ `
  precision highp float;
  uniform sampler2D uMap;
  uniform vec4 uRect;      // 素材表里的位置 x0,y0,x1,y1（左上角 0,0）
  uniform vec3 uTint;
  uniform float uOpacity, uLift;
  varying vec2 vUv;
  void main() {
    vec2 p = vec2(mix(uRect.x, uRect.z, vUv.x), mix(uRect.y, uRect.w, 1.0 - vUv.y));
    vec3 t = texture2D(uMap, vec2(p.x, 1.0 - p.y)).rgb;
    float a = max(t.r, max(t.g, t.b));
    a = smoothstep(0.03, 0.85, a);
    a *= smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x) * smoothstep(0.0, 0.1, vUv.y) * smoothstep(1.0, 0.9, vUv.y);
    vec3 c = t / max(max(t.r, max(t.g, t.b)), 0.02);   // 去掉黑底后的云本色
    c = mix(c * uTint, vec3(0.95, 0.94, 0.92), uLift);
    float o = a * uOpacity;
    gl_FragColor = vec4(c * o, o);                       // 预乘
  }
`;

// 素材表 clouds.jpg 里四朵云的位置
const RECTS = [
  [0.0, 0.17, 0.5, 0.40],   // 宽云堤
  [0.5, 0.08, 1.0, 0.44],   // 高云
  [0.0, 0.66, 0.5, 0.81],   // 薄层云
  [0.5, 0.58, 1.0, 0.90],   // 雾团
];

export function createScene(canvas, { mobile = false, plates }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 1.75));
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;   // 照片按原样显示，不做色彩转换

  const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  blank.needsUpdate = true;

  // ---- 背景
  const U = {
    uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uIntro: { value: 0 }, uDawn: { value: 0 },
    uZoom: { value: 1 }, uDive: { value: 0 }, uFog: { value: 0 }, uFogZoom: { value: 1 }, uWhite: { value: 0 }, uBlur: { value: 0 },
    uHero: { value: blank }, uCloud: { value: blank }, uHas: { value: 0 },
    uHeroSize: { value: new THREE.Vector2(16, 9) }, uCloudSize: { value: new THREE.Vector2(16, 9) },
    uFocus: { value: new THREE.Vector2(...plates.focus) }, uGlow: { value: new THREE.Vector2(...plates.glow) },
    uMouse: { value: new THREE.Vector2() }, uBg: { value: new THREE.Color(0xf3f1ed) },
  };
  const bgScene = new THREE.Scene();
  const bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  bgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: U, depthTest: false, depthWrite: false, fragmentShader: backdropFrag,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  })));

  // ---- 云片：一部分低低地飘在首屏前景，其余分布在下潜路线上
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  const cardMat = (rect) => new THREE.ShaderMaterial({
    uniforms: { uMap: { value: blank }, uRect: { value: new THREE.Vector4(...rect) }, uTint: { value: new THREE.Color() }, uOpacity: { value: 0 }, uLift: { value: 0 } },
    vertexShader: cardVert, fragmentShader: cardFrag, transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const cards = [];
  const TRAVEL = 60;   // 镜头一共往前飞多远
  const DROP = 9;      // 同时往下落多少
  const N = mobile ? 14 : 22;
  for (let i = 0; i < N; i++) {
    const kind = i < 3 ? [0, 2, 3][i] : Math.floor(rnd() * 4);
    const rect = RECTS[kind];
    const aspect = ((rect[2] - rect[0]) / (rect[3] - rect[1]));
    const fore = i < 3;                                   // 首屏前景的三朵
    const w = fore ? 9 + rnd() * 5 : 7 + rnd() * 9;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / aspect), cardMat(rect));
    if (fore) m.position.set([-5, 4, 0.5][i], -3.4 - rnd() * 0.6, -9 - i * 2.5);
    else {
      // 云片都放在镜头“下方”：下潜时它们从画面下半部迎上来，再从两侧和脚下掠过
      const t = (i - 3) / (N - 3);
      const side = i % 2 ? 1 : -1;
      const z = -12 - t * (TRAVEL + 4);
      const camYThen = -DROP * Math.min(1, -z / TRAVEL);
      m.position.set(side * (1.0 + rnd() * 5.5), camYThen - 0.8 - rnd() * 2.6, z);
    }
    if (rnd() > 0.5) m.scale.x = -1;                      // 随机镜像，看不出是同一朵
    m.userData = { base: m.position.clone(), fore, drift: 0.04 + rnd() * 0.06, phase: rnd() * 6 };
    cards.push(m);
    scene.add(m);
  }

  // ---- 读图
  const loader = new THREE.TextureLoader();
  const load = (url) => new Promise((res) => {
    if (!url) return res(null);
    loader.load(url, (tx) => {
      tx.colorSpace = THREE.NoColorSpace;
      tx.minFilter = THREE.LinearMipmapLinearFilter;
      tx.anisotropy = 4;
      res(tx);
    }, undefined, () => res(null));
  });
  const heroReady = load(plates.hero).then((tx) => {
    if (!tx) throw new Error('hero image failed');
    U.uHero.value = tx; U.uHeroSize.value.set(tx.image.width, tx.image.height); U.uHas.value = 1;
  });
  load(plates.inCloud).then((tx) => { if (tx) { U.uCloud.value = tx; U.uCloudSize.value.set(tx.image.width, tx.image.height); } });
  load(plates.clouds).then((tx) => { if (tx) cards.forEach((c) => (c.material.uniforms.uMap.value = tx)); });

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 1 ? 62 : 50;
    camera.updateProjectionMatrix();
    U.uRes.value.set(w, h);
  }

  const dusk = new THREE.Color(0.52, 0.57, 0.65);
  const tint = new THREE.Color();
  const mistTint = new THREE.Color(0.86, 0.87, 0.9);   // 进入云层后云片的颜色，比背景略暗一点才不像贴上去的

  // s = { time, intro, dawn, zoom, dive, fog, fogZoom, white, blur, travel, mouse:[x,y] }
  function render(s) {
    U.uTime.value = s.time; U.uIntro.value = s.intro; U.uDawn.value = s.dawn;
    U.uZoom.value = s.zoom; U.uDive.value = s.dive; U.uFog.value = s.fog; U.uFogZoom.value = s.fogZoom;
    U.uWhite.value = s.white; U.uBlur.value = s.blur; U.uMouse.value.set(s.mouse[0], s.mouse[1]);

    camera.position.set(s.mouse[0] * 0.25, -s.travel * DROP - s.mouse[1] * 0.15, -s.travel * TRAVEL);
    tint.copy(dusk).lerp(mistTint, s.fog);

    for (const c of cards) {
      const { base, fore, drift, phase } = c.userData;
      const u = c.material.uniforms;
      c.position.x = base.x + Math.sin(s.time * (fore ? 0.03 : drift) + phase) * (fore ? 1.2 : 0.8);
      const dist = camera.position.z - c.position.z;
      const near = THREE.MathUtils.smoothstep(dist, 0.6, 5);
      const far = 1 - THREE.MathUtils.smoothstep(dist, 22, 34);
      let o = near * far * (1 - s.white);
      o *= fore ? 0.55 * (1 - s.fog * 0.6) : Math.min(1, s.dive * 2.5) * 0.7;
      u.uOpacity.value = o * s.intro;
      u.uTint.value.copy(tint);
      u.uLift.value = s.fog * 0.2;
      c.visible = u.uOpacity.value > 0.004;
      // 离镜头越近越晚画，保证前后关系
      c.renderOrder = Math.round(-dist * 10);
    }

    renderer.autoClear = false;
    renderer.clear();
    renderer.render(bgScene, bgCam);
    renderer.render(scene, camera);
  }

  resize();
  return { resize, render, ready: heroReady, dispose: () => renderer.dispose() };
}
