# NexusDownload 官网 v4「云下」

只有首页是电影级（three.js），其余页面是干净的浅色阅读页。中英双语。

## 本地预览

装好 Node（18 以上）后，双击 `预览.cmd`，或者在这个文件夹里运行：

```
node build.mjs --serve
```

浏览器打开 http://localhost:8140/ 。改了 `src/` 里的文件会自动重新生成，刷新浏览器就能看到。
首页加 `?motion=full` 可以在开了“减少动态效果”的电脑上强制看完整动画。
按 `Ctrl + K`（或 `/`）打开站内搜索。

> 必须通过预览地址打开，直接双击 `dist/index.html` 会因为浏览器安全限制看不到 3D 效果。

## 常见修改去哪改

| 想改的东西 | 文件 |
|---|---|
| 发布信息的离线默认值、仓库地址、域名 | `site.json` |
| 导航、页脚的文字 | `src/i18n/zh.json`、`src/i18n/en.json` |
| 导航、页脚的结构 | `src/partials/nav.html`、`src/partials/footer.html` |
| 首页文字 | `src/pages/zh/index.html`、`src/pages/en/index.html` |
| 首页电影段的节奏、底图路径 | `src/assets/js/home/main.js` 顶部的 `PLATES` 和 `TIMELINE` |
| 首页图片 | `src/assets/img/`（hero 桌面首屏、hero-m 手机首屏、incloud 云内部、clouds 纯黑底云片表） |
| 软件界面示意（首页落地段、下载页） | `src/partials/app-zh.html`、`app-en.html`，样式在 `src/assets/css/app.css` |
| 颜色、字体 | `src/assets/css/site.css` 最上面的变量 |
| 更新日志 | `src/pages/zh/changelog.html`、`src/pages/en/changelog.html`（新版本加在最上面） |
| 文档内容 | `src/pages/zh/docs/*.html`、`src/pages/en/docs/*.html` |
| 文档左侧目录 | `src/data/docs.json` |

### 加一篇文档

1. 在 `src/pages/zh/docs/` 新建 `xxx.html`（复制一篇现有的改），英文同理放 `src/pages/en/docs/`。
2. 在 `src/data/docs.json` 里加一项，照着现有的写：`slug` 网址、`icon` 图标名（可选的在 `src/data/icons.json`）、`zh`/`en` 标题、`desc` 一句话简介（显示在文档首页卡片上）。

文档会自动进入站内搜索，不用另外配置。

每个页面开头的 `<!-- -->` 是页面信息：`title` 标题、`description` 搜索引擎摘要、`layout` 用哪个布局（home / page / docs）、`nav` 导航高亮哪一项。
页面里可以用 `{{site.version}}` 这样的写法引用构建配置。构建会从 GitHub 读取最新的正式版本、发布日期和 Windows 便携 ZIP；读取失败时使用 `site.json`，没有 ZIP 时打开最新发布页。更新日志仍手写。

## 部署到 Cloudflare Pages

Cloudflare Pages 项目 `nexusdownload` 使用直接上传。根目录 `website`，运行 `node build.mjs`，输出目录 `dist`。

`main` 分支的官网改动或正式发布完成后，GitHub Actions 构建并上传 `dist`。部署需要仓库机密 `CLOUDFLARE_ACCOUNT_ID` 和 `CLOUDFLARE_API_TOKEN`，令牌只授权该账户的 Cloudflare Pages 编辑权限。

本地手动部署时，在 `website` 运行 `node build.mjs`，再运行 `npx --yes wrangler@4.165.0 pages deploy dist --project-name nexusdownload --branch main`。

已经处理好的：`404.html`（中英各一个）、`sitemap.xml`、`robots.txt`、`_headers`（字体和 three.js 长期缓存）。单个文件都远小于 Cloudflare 的 25 MB 上限。

## 目录

```
website/
  site.json            全站配置
  build.mjs            构建脚本（零依赖）
  src/
    pages/zh|en/       页面
    layouts/           页面骨架（home / page / docs）
    partials/          公用片段（head / nav / footer / logo）
    i18n/              导航、页脚等公用文字
    data/docs.json     文档目录
    assets/            CSS、JS、字体、图片、three.js
    static/            原样复制到网站根目录的文件（favicon、_headers）
  dist/                生成结果（不用手改）
```

## 第三方

three.js（MIT）、Inter（OFL）、Noto Serif SC（OFL），均已放在本地，不依赖外部 CDN。
