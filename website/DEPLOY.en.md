# Deploy the NexusDownload website to Cloudflare Pages

This is a ready-to-upload static website. The entry point is `index.html`; fonts, icons and the application screenshot are local. No software installation, compilation or server configuration is required.

Download links are placeholders. Cloud, media and post-processing features show their planned versions. v0.1 uses the repository's current MIT license, with separate third-party terms.

## 1. First deployment: upload in the dashboard

1. Register or sign in to [Cloudflare](https://dash.cloudflare.com/). A free account is sufficient.
2. Open this repository's `website` folder in Windows File Explorer. Check that it contains `index.html`, `assets`, `icons`, `licenses`, `site.css`, `site.js` and `tokens.css`.
3. Inside that folder, select all files and folders, then choose “Compress to ZIP file” or “Send to → Compressed (zipped) folder”. The archive's top level must contain `index.html`, without an extra wrapping `website` directory.
4. In Cloudflare, go to **Workers & Pages → Create application → Pages → Get started → Drag and drop your files**. If the first screen shows Workers, switch to the Pages entry.
5. Enter an available project name, such as `nexusdownload`, and upload the website ZIP.
6. Select **Deploy site** or **Save and Deploy**. Open the resulting `https://project-name.pages.dev` URL.
7. Check the hero, application screenshot, local fonts, navigation anchors and license links on desktop and mobile. The application download is still a placeholder.

The site has approximately 430 files and occupies 11 MiB, below the dashboard's 1,000-file limit and 25 MiB per-file limit. **Upload the website ZIP, not the Windows application ZIP.** Host application releases on GitHub Releases or another download host.

## 2. Connect your domain

Replace `example.com` with your own domain. Continue renewing it with your existing registrar.

### Apex domain, such as example.com

1. In your Cloudflare account, choose **Add a domain**, enter the domain and choose the free plan.
2. Review the imported DNS records. Preserve any A, CNAME, MX and TXT records used by existing websites or email.
3. Note the two nameservers assigned by Cloudflare.
4. At your domain registrar, replace the domain's nameservers with those two addresses. Change the nameserver setting; do not add an NS record in the DNS record editor.
5. Wait for the domain's status in Cloudflare to become **Active**.
6. Open **Workers & Pages → your Pages project → Custom domains → Set up a domain**.
7. Enter `example.com`, choose **Continue** and confirm the DNS record that Cloudflare creates.
8. Once the custom domain is **Active**, open `https://example.com` and confirm that the website loads without certificate errors.

To also serve `www.example.com`, add that hostname separately in the same Pages project's custom-domain settings.

### Subdomain, such as download.example.com

You can keep your current DNS provider when using a subdomain:

1. **First**, add `download.example.com` through the Pages project's **Custom domains → Set up a domain** flow.
2. At your current DNS provider, create this record:

   | Field | Value |
   |---|---|
   | Type | CNAME |
   | Name / Host | `download` |
   | Target / Value | `project-name.pages.dev`, without a scheme or path |
   | TTL | Automatic or default |

3. Complete verification in Pages. When the status is **Active**, open `https://download.example.com`.

Adding only the CNAME without associating the domain in Pages can produce a 522 error. If Cloudflare already manages your DNS, the wizard usually adds the CNAME automatically.

## 3. Update the website

For a Direct Upload project:

1. Edit the local `website` files, then create a new ZIP from the folder's contents.
2. Open the existing Pages project, choose **Create a new deployment**, upload the ZIP and deploy to **Production**.
3. Refresh your domain to verify the changes. Keep the same project to retain its address and domain bindings.

### Automatic updates with your own GitHub repository

Create a new Git-integrated Pages project if you want deployments after every push. An existing Direct Upload project cannot be converted to Git integration.

1. Ensure your own GitHub repository contains the complete `website/` directory. Do not select the upstream Motrix repository.
2. Choose **Workers & Pages → Create application → Pages**, connect Git, authorize access and select your repository.
3. Choose the branch holding your production website, usually `main`, and enter:

   | Setting | Value |
   |---|---|
   | Framework preset | None |
   | Root directory, advanced | `website` |
   | Build command | Empty |
   | Build output directory | `.` |

   The output directory is relative to the root directory. Do not enter `website` twice. This directory has no `package.json`, so application dependencies do not need installation.
4. Choose **Save and Deploy**, check the new `pages.dev` URL, then connect your domain using section 2.
5. Push website changes to the selected production branch to update the site. Other branches usually create preview deployments.

## 4. Replace release placeholders

Open `website/index.html` in a text editor:

- Find the link containing `data-placeholder="download"`. Replace its `href="#download"` with the actual Windows x64 ZIP URL and remove its placeholder `title` and `data-placeholder` attributes.
- Replace the text indicating that the download URL is pending with a release date or version note.
- Fill the SHA-256 area with the real ZIP checksum. The delivered `.sha256` file contains the full value; link to that checksum file.
- Replace both `data-placeholder="source"` links with your own repository URL, and replace the `issues` link with your feedback page.
- Replace the `releases` link with your release-notes page.
- Update the v0.2 / v0.3 / v0.4 feature notes only after those versions are implemented and accepted.

Deploy these changes to the existing Pages project. Keep application ZIP files outside `website/`.

## Official documentation

- [Direct Upload and limits](https://developers.cloudflare.com/pages/get-started/direct-upload/)
- [Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/)
- [Static HTML deployment](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/)
- [Custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)
