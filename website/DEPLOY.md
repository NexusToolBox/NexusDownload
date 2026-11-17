# 把 NexusDownload 官网部署到 Cloudflare Pages

这个目录是可以直接上传的静态网站。首页是 `index.html`，字体、图标和应用截图都在目录里，不需要安装软件、编译代码或配置服务器。

下载按钮目前是占位链接；网盘、视频解析和后处理已标明计划开放版本。v0.1 按仓库当前 MIT 许可标注，第三方资源保留各自许可。

## 1. 第一次上线：在网页上直接上传

1. 注册或登录 [Cloudflare](https://dash.cloudflare.com/)；免费账户即可。
2. 在 Windows 资源管理器里打开本仓库的 `website` 文件夹。确认能看到 `index.html`、`assets`、`icons`、`licenses`、`site.css`、`site.js` 和 `tokens.css`。
3. 在这个文件夹里面按 Ctrl+A 全选，右键选择“压缩为 ZIP 文件”。也可以选择“发送到 → 压缩(zipped)文件夹”。ZIP 最外层应该直接是 `index.html` 和上述文件夹，不能再套一层 `website`。
4. 打开 Cloudflare 左侧的 **Workers & Pages**，点击 **Create application（创建应用）**，选择 **Pages** 的 **Get started（开始）**，再选择 **Drag and drop your files（拖放文件）**。如果先看到的是 Workers 页面，切换到 Pages 入口。
5. 项目名称填 `nexusdownload`，或填一个尚未被占用的名称。把刚做好的“官网 ZIP”拖进上传框。
6. 点击 **Deploy site（部署站点）** 或 **Save and Deploy（保存并部署）**。完成后，打开它给出的 `https://项目名称.pages.dev` 地址。
7. 在电脑和手机上检查：首页标题、应用截图、字体、四个导航锚点、开源许可链接。下载按钮仍然是占位链接，暂时不会下载应用。

本目录约 430 个文件、11 MiB，符合网页拖放上传的 1,000 文件限制；单个文件也低于 25 MiB。**这里上传的是官网 ZIP，不是 Windows 应用 ZIP。** 应用包超过 Pages 的单文件上限，正式下载文件应放在 GitHub Releases 或其他下载托管服务上。

## 2. 绑定自己的域名

以下用 `example.com` 举例；操作时换成你自己的域名。域名仍然在原来的购买平台续费。

### 用主域名，例如 example.com

1. 在 Cloudflare 账户主页选择“添加域名 / Add a domain”，输入自己的域名，选择免费套餐。
2. Cloudflare 会导入现有 DNS 记录。按页面核对原有网站、邮件的 A / CNAME / MX / TXT 记录，保留仍在使用的记录。
3. 记下 Cloudflare 分配的两个名称服务器（Nameservers）。
4. 登录买域名的平台，找到“DNS 服务器 / 名称服务器 / Nameservers”，把原来的名称服务器换成 Cloudflare 给出的两个地址。这一步是在域名商处更改名称服务器，不是在 DNS 记录里添加 NS。
5. 回到 Cloudflare，等域名状态变成 **Active（已激活）**。
6. 打开 **Workers & Pages → 你的 Pages 项目 → Custom domains（自定义域名）→ Set up a domain（设置域名）**。
7. 输入 `example.com`，点击 **Continue（继续）**。确认 Cloudflare 自动创建的 DNS 记录，完成向导。
8. 等自定义域名状态变成 **Active** 后，打开 `https://example.com`，确认能看到网站且浏览器没有证书错误。

如果还想让 `www.example.com` 也能访问，在同一个 Pages 项目的自定义域名页面，再添加一次 `www.example.com`。

### 只用子域名，例如 download.example.com

如果不想把整个域名的 DNS 交给 Cloudflare，可以只绑定一个子域名：

1. **先**在 Pages 项目的 **Custom domains → Set up a domain** 添加 `download.example.com`。
2. 到当前 DNS 服务商的管理页面，新增一条记录：

   | 项目 | 填写内容 |
   |---|---|
   | 类型 | CNAME |
   | 名称 / 主机记录 | `download` |
   | 目标 / 记录值 | `项目名称.pages.dev`，不带 `https://` 或路径 |
   | TTL | 自动或默认 |

3. 回到 Pages 页面完成验证，等状态变成 **Active**，再打开 `https://download.example.com`。

不能只添加 CNAME 而跳过 Pages 的自定义域名向导，否则可能出现 522 错误。已经由 Cloudflare 管理 DNS 的域名，通常会由向导自动添加 CNAME。

## 3. 以后更新官网

如果使用上面的直接上传方式：

1. 在本地修改 `website` 里的文件，再按第 1 节的方法把文件夹内的内容压成新的官网 ZIP。
2. 打开已有 Pages 项目，选择 **Create a new deployment（创建新部署）**，上传新的 ZIP 并部署到 **Production（生产环境）**。
3. 打开自己的域名刷新检查。域名绑定只需要做一次；保留同一个 Pages 项目，地址不会变。

### 已有自己的 GitHub 仓库时：自动更新

想在每次提交后自动更新网站，可以新建一个连接 GitHub 的 Pages 项目。直接上传项目不能原地改成 Git 集成项目。

1. 确保自己的 GitHub 仓库里已经包含完整的 `website/` 目录。不要选择 Motrix 上游仓库。
2. 在 **Workers & Pages → Create application → Pages** 选择连接 Git，授权 Cloudflare 访问自己的仓库，再选择该仓库。
3. 生产分支选保存正式官网的分支，通常是 `main`。构建设置填写：

   | 设置 | 值 |
   |---|---|
   | Framework preset（框架预设） | None |
   | Root directory（根目录，高级设置） | `website` |
   | Build command（构建命令） | 留空 |
   | Build output directory（构建输出目录） | `.` |

   输出目录是相对于根目录计算的。根目录已经是 `website`，输出目录不要再填 `website`。这里没有 `package.json`，无需安装应用依赖。
4. 点击 **Save and Deploy**，先检查新的 `pages.dev` 地址，再按第 2 节给这个项目绑定自己的域名。
5. 以后把 `website/` 的改动提交并推送到所选生产分支，Cloudflare 就会自动更新。其他分支一般只生成预览地址。

## 4. 正式开放下载时需要替换的占位信息

用文本编辑器打开 `website/index.html`：

- 找到 `data-placeholder="download"` 所在的“下载便携版 ZIP”链接，把该链接的 `href="#download"` 换成实际的 Windows x64 ZIP 下载地址；去掉这条链接的占位 `title` 和 `data-placeholder`。
- 找到“下载链接待发布”，换成实际发布日期或版本说明。
- SHA-256 区域填写对应 ZIP 的真实校验值。打包交付的 `.sha256` 文件提供完整值；链接到这个校验文件，方便用户核对。
- 搜索 `data-placeholder="source"`，把两处源代码链接换成自己的仓库地址；把 `issues` 的链接换成自己的反馈页面。
- `data-placeholder="releases"` 对应“更新记录”，正式发布时换成自己的发布记录地址。
- 后续版本实际完成并验收后，再更新 v0.2 / v0.3 / v0.4 的功能说明。

把上述修改部署到原来的 Pages 项目即可。不要把应用 ZIP 复制进 `website/`。

## 官方说明

- [直接上传及限制](https://developers.cloudflare.com/pages/get-started/direct-upload/)
- [连接 Git 仓库](https://developers.cloudflare.com/pages/get-started/git-integration/)
- [静态 HTML 部署](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/)
- [自定义域名](https://developers.cloudflare.com/pages/configuration/custom-domains/)
