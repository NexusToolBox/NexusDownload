// NexusDownload 官网构建脚本（零依赖，Node 18+）
//
//   node build.mjs            生成 dist/
//   node build.mjs --serve    生成 + 本地预览 http://localhost:8140 （改了 src 自动重建，刷新浏览器即可）
//
// 规则很少：
//   src/pages/zh/**.html  → 中文页面（网址不带前缀）
//   src/pages/en/**.html  → 英文页面（网址带 /en）
//   页面开头的 <!-- ... --> 是页面信息（标题、描述、用哪个布局、导航高亮哪一项）
//   {{site.xxx}} 来自 site.json；{{t.xxx}} 来自 src/i18n/<语言>.json；{{> 名字}} 插入 src/partials/名字.html

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const LANGS = { zh: { prefix: '', htmlLang: 'zh-CN' }, en: { prefix: '/en', htmlLang: 'en' } };

const read = (p) => fs.readFileSync(p, 'utf8');
const readJSON = (p) => JSON.parse(read(p));

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });
}

function copyDir(from, to) {
  for (const file of walk(from)) {
    const out = path.join(to, path.relative(from, file));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(file, out);
  }
}

// 页面开头的信息块
function parsePage(raw) {
  const m = raw.match(/^\s*<!--([\s\S]*?)-->/);
  const meta = {};
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return { meta, body: m ? raw.slice(m[0].length) : raw };
}

// src/pages/zh/docs/accounts.html → /docs/accounts/
function urlFor(lang, rel) {
  const r = rel.replace(/\\/g, '/').replace(/\.html$/, '');
  if (r === '404') return LANGS[lang].prefix + '/404.html';
  const clean = r === 'index' ? '' : r.replace(/\/index$/, '') + '/';
  return (LANGS[lang].prefix + '/' + clean).replace(/\/+/g, '/');
}

function outFileFor(url) {
  if (url.endsWith('.html')) return path.join(DIST, url);
  return path.join(DIST, url, 'index.html');
}

function get(obj, key) {
  return key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

const docUrl = (lang, it) => `${LANGS[lang].prefix}/docs/${it.slug ? it.slug + '/' : ''}`;
const icon = (icons, name, cls = 'di') =>
  `<svg class="${cls}" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${icons[name] || ''}</svg>`;

// 文档左侧目录
function docsNav(docs, icons, lang, currentUrl) {
  return docs
    .map((g) => {
      const items = g.items
        .map((it) => {
          const url = docUrl(lang, it);
          const cur = url === currentUrl ? ' aria-current="page"' : '';
          return `<li><a href="${url}"${cur}>${icon(icons, it.icon)}<span>${it[lang]}</span></a></li>`;
        })
        .join('');
      return `<div class="docs-nav__group"><p class="docs-nav__title">${g.group[lang]}</p><ul>${items}</ul></div>`;
    })
    .join('');
}

// 文档首页的卡片（除了首页自己）
function docsCards(docs, icons, lang) {
  return `<div class="doc-cards">${docs
    .flatMap((g) => g.items)
    .filter((it) => it.slug)
    .map((it) => `<a class="doc-card" href="${docUrl(lang, it)}">${icon(icons, it.icon, 'doc-card__icon')}<b>${it[lang]}</b><span>${it.desc[lang]}</span></a>`)
    .join('')}</div>`;
}

// 面包屑：文档 › 分组
function docsCrumb(docs, lang, currentUrl, t) {
  const g = docs.find((g) => g.items.some((it) => docUrl(lang, it) === currentUrl));
  if (!g) return '';
  return `<nav class="crumb" aria-label="breadcrumb"><a href="${LANGS[lang].prefix}/docs/">${t.nav.docs}</a><span>/</span><span>${g.group[lang]}</span></nav>`;
}

function docsPager(docs, lang, currentUrl, t) {
  const flat = docs.flatMap((g) => g.items).map((it) => ({ ...it, url: docUrl(lang, it) }));
  const i = flat.findIndex((it) => it.url === currentUrl);
  if (i < 0) return '';
  const prev = flat[i - 1], next = flat[i + 1];
  return `<nav class="pager">${prev ? `<a class="pager__prev" href="${prev.url}"><small>← ${t.docs.prev}</small>${prev[lang]}</a>` : '<span></span>'}${
    next ? `<a class="pager__next" href="${next.url}"><small>${t.docs.next} →</small>${next[lang]}</a>` : ''
  }</nav>`;
}

// 站内搜索用的索引：去掉标签后的纯文字
function toText(html) {
  return html
    .replace(/<!--[\s\S]*?-->|<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function loadSite(request = fetch) {
  const fallback = readJSON(path.join(ROOT, 'site.json'));
  const repository = new URL(fallback.github).pathname.replace(/\/$/, '');
  try {
    const response = await request(`https://api.github.com/repos${repository}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'NexusDownload-website' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Release unavailable');
    const release = await response.json();
    const version = typeof release.tag_name === 'string' && /^v?(\d+\.\d+\.\d+)$/.exec(release.tag_name)?.[1];
    if (!version || !/^\d{4}-\d{2}-\d{2}T/.test(release.published_at) || !Number.isFinite(Date.parse(release.published_at))) {
      throw new Error('Invalid release metadata');
    }
    const name = `NexusDownload-v${version}-win-x64.zip`;
    const downloadUrl = `${fallback.releasesUrl}/download/${release.tag_name}/${name}`;
    const hasZip = Array.isArray(release.assets) && release.assets.some((asset) => (
      asset?.name === name && asset.browser_download_url === downloadUrl && asset.state === 'uploaded'
    ));
    return {
      ...fallback,
      version,
      releaseDate: release.published_at.slice(0, 10),
      downloadUrl: hasZip ? downloadUrl : `${fallback.releasesUrl}/latest`,
    };
  } catch {
    console.warn('无法读取最新发布，使用 site.json。');
    return fallback;
  }
}

export async function build() {
  const started = Date.now();
  const site = await loadSite();
  const docs = readJSON(path.join(SRC, 'data', 'docs.json'));
  const icons = readJSON(path.join(SRC, 'data', 'icons.json'));
  const search = { zh: [], en: [] };
  const partials = {};
  for (const f of walk(path.join(SRC, 'partials'))) partials[path.basename(f, '.html')] = read(f);
  const layouts = {};
  for (const f of walk(path.join(SRC, 'layouts'))) layouts[path.basename(f, '.html')] = read(f);

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
  copyDir(path.join(SRC, 'assets'), path.join(DIST, 'assets'));
  copyDir(path.join(SRC, 'static'), DIST);

  // 先收集所有页面，方便算“另一种语言的同一页”
  const pages = [];
  for (const lang of Object.keys(LANGS)) {
    const dir = path.join(SRC, 'pages', lang);
    for (const file of walk(dir).filter((f) => f.endsWith('.html'))) {
      const rel = path.relative(dir, file);
      pages.push({ lang, rel: rel.replace(/\\/g, '/'), file, url: urlFor(lang, rel) });
    }
  }
  const exists = new Set(pages.map((p) => p.lang + ':' + p.rel));
  const warnings = new Set();

  for (const p of pages) {
    const t = readJSON(path.join(SRC, 'i18n', p.lang + '.json'));
    const { meta, body } = parsePage(read(p.file));
    const layout = layouts[meta.layout || 'page'];
    if (!layout) throw new Error(`${p.file}: 找不到布局 ${meta.layout}`);
    const other = p.lang === 'zh' ? 'en' : 'zh';
    const altUrl = exists.has(other + ':' + p.rel) ? urlFor(other, p.rel) : LANGS[other].prefix + '/';
    const ctx = {
      site,
      t,
      page: { ...meta, url: p.url },
      lang: p.lang,
      htmlLang: LANGS[p.lang].htmlLang,
      root: LANGS[p.lang].prefix,
      altUrl,
      altHtmlLang: LANGS[other].htmlLang,
      year: new Date().getFullYear(),
      canonical: site.domain.replace(/\/$/, '') + p.url,
      docsNav: docsNav(docs, icons, p.lang, p.url),
      docsCards: docsCards(docs, icons, p.lang),
      docsCrumb: docsCrumb(docs, p.lang, p.url, t),
      docsPager: docsPager(docs, p.lang, p.url, t),
    };

    let html = layout.replace('{{content}}', () => body);
    for (let i = 0; i < 5 && /\{\{>\s*[\w-]+\s*\}\}/.test(html); i++) {
      html = html.replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, name) => {
        if (!(name in partials)) warnings.add(`缺少片段 ${name}`);
        return partials[name] ?? '';
      });
    }
    html = html.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (all, key) => {
      if (key.startsWith('active.')) return key.slice(7) === meta.nav ? ' aria-current="page"' : '';
      const v = get(ctx, key);
      if (v === undefined) {
        warnings.add(`${path.relative(ROOT, p.file)}: 未定义 {{${key}}}`);
        return '';
      }
      return String(v);
    });

    // 收进搜索索引（文档、下载、更新日志）
    if (meta.search !== 'no' && !p.url.endsWith('404.html') && meta.layout !== 'home') {
      const main = (html.match(/<article class="prose">([\s\S]*?)<\/article>/) || html.match(/<main[^>]*>([\s\S]*?)<\/main>/) || [, ''])[1];
      const heads = [...main.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => toText(m[1]));
      search[p.lang].push({ t: meta.title || '', u: p.url, s: meta.layout === 'docs' ? t.nav.docs : t.nav[meta.nav] || '', h: heads, x: toText(main) });
    }

    const out = outFileFor(p.url);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, html);
  }

  fs.mkdirSync(path.join(DIST, 'assets', 'search'), { recursive: true });
  for (const lang of Object.keys(search)) fs.writeFileSync(path.join(DIST, 'assets', 'search', lang + '.json'), JSON.stringify(search[lang]));

  // sitemap / robots
  const urls = pages.filter((p) => !p.url.endsWith('404.html')).map((p) => site.domain.replace(/\/$/, '') + p.url);
  fs.writeFileSync(
    path.join(DIST, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map((u) => `  <url><loc>${u}</loc></url>`)
      .join('\n')}\n</urlset>\n`
  );
  fs.writeFileSync(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${site.domain.replace(/\/$/, '')}/sitemap.xml\n`);

  for (const w of warnings) console.warn('  ! ' + w);
  console.log(`✓ 构建完成：${pages.length} 个页面 → dist/（${Date.now() - started} ms）`);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2',
  '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.mp4': 'video/mp4', '.ico': 'image/x-icon',
};

function serve(port) {
  http
    .createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let file = path.join(DIST, p);
      if (!file.startsWith(DIST)) return res.writeHead(403).end();
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!fs.existsSync(file)) {
        // 和 Cloudflare Pages 一样：找最近的 404.html
        const en = p.startsWith('/en/') ? path.join(DIST, 'en', '404.html') : null;
        file = en && fs.existsSync(en) ? en : path.join(DIST, '404.html');
        res.statusCode = 404;
      }
      res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      fs.createReadStream(file).pipe(res);
    })
    .listen(port, () => {
      console.log(`→ 预览地址 http://localhost:${port}/   （按 Ctrl+C 结束）`);
      if (process.argv.includes('--open')) {
        const url = `http://localhost:${port}/`;
        exec(process.platform === 'win32' ? `start "" ${url}` : process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`);
      }
    });

  let timer, pending = Promise.resolve();
  const rebuild = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      pending = pending.then(build).catch((e) => console.error('✗ 构建失败：', e.message));
    }, 150);
  };
  fs.watch(SRC, { recursive: true }, rebuild);
  fs.watch(path.join(ROOT, 'site.json'), rebuild);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await build();
  if (process.argv.includes('--serve')) serve(Number(process.env.PORT) || 8140);
}
