/**
 * Central registry for external URLs used across main and renderer —
 * help menu links, docs deep-links, issue tracker. Keep all hardcoded
 * public URLs here so migrations (domain change, docs restructure,
 * locale-specific redirects) only touch one file.
 */
export const EXTERNAL_URLS = {
  browserExtension: {
    chrome:
      'https://github.com/NexusToolBox/NexusDownload/tree/main/packages/browser-extension',
    edge: 'https://github.com/NexusToolBox/NexusDownload/tree/main/packages/browser-extension',
    firefox:
      'https://github.com/NexusToolBox/NexusDownload/tree/main/packages/browser-extension',
    // Safari packages use their own release tags; latest points to Chromium/Firefox.
    safari:
      'https://github.com/NexusToolBox/NexusDownload/tree/main/packages/browser-extension',
    development:
      'https://github.com/NexusToolBox/NexusDownload/tree/main/packages/browser-extension',
  },
  github: {
    repository: 'https://github.com/NexusToolBox/NexusDownload',
    author: 'https://github.com/NexusToolBox/NexusDownload/blob/main/NOTICE',
    issues: 'https://github.com/NexusToolBox/NexusDownload/issues',
    releases: 'https://github.com/NexusToolBox/NexusDownload/releases',
    ffmpegStaticReleases:
      'https://github.com/motrixapp/ffmpeg-static/releases/latest',
  },
  motrix: {
    updateFeed:
      'https://raw.githubusercontent.com/NexusToolBox/NexusDownload/main/disabled-updates/',
    home: 'https://github.com/NexusToolBox/NexusDownload/',
    acknowledgments:
      'https://github.com/NexusToolBox/NexusDownload/blob/main/NOTICE',
    plugins: 'https://github.com/NexusToolBox/NexusDownload/tree/main/packages',
    changelog: 'https://github.com/NexusToolBox/NexusDownload/releases',
    releaseNotes: 'https://github.com/NexusToolBox/NexusDownload/releases',
    manual: {
      home: 'https://github.com/NexusToolBox/NexusDownload/blob/main/README.md',
      ffmpeg: {
        en: 'https://github.com/NexusToolBox/NexusDownload/blob/main/README.md',
        zh: 'https://github.com/NexusToolBox/NexusDownload/blob/main/README.md',
      },
      linuxAutostart: {
        en: 'https://github.com/NexusToolBox/NexusDownload/blob/main/README.md',
        zh: 'https://github.com/NexusToolBox/NexusDownload/blob/main/README.md',
      },
      downloadPerformance: {
        en: 'https://github.com/NexusToolBox/NexusDownload/blob/main/README.md',
        zh: 'https://github.com/NexusToolBox/NexusDownload/blob/main/README.md',
      },
      natTroubleshooting: {
        en: 'https://github.com/NexusToolBox/NexusDownload/blob/main/README.md',
        zh: 'https://github.com/NexusToolBox/NexusDownload/blob/main/README.md',
      },
      advancedProxy:
        'https://github.com/NexusToolBox/NexusDownload/blob/main/README.md',
      defaultApplication:
        'https://github.com/NexusToolBox/NexusDownload/blob/main/README.md',
    },
  },
} as const

export function getFfmpegManualUrl(language: string): string {
  const locale = language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  return EXTERNAL_URLS.motrix.manual.ffmpeg[locale]
}

export function getNatTroubleshootingUrl(language: string): string {
  const locale = language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  return EXTERNAL_URLS.motrix.manual.natTroubleshooting[locale]
}

export function getDownloadPerformanceUrl(language: string): string {
  const locale = language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  return EXTERNAL_URLS.motrix.manual.downloadPerformance[locale]
}

export function getLinuxAutostartUrl(language: string): string {
  const locale = language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  return EXTERNAL_URLS.motrix.manual.linuxAutostart[locale]
}
