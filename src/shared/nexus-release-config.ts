/** Public project and portable update release source. */
export const NEXUS_RELEASE_CONFIG = {
  repository: 'NexusToolBox/NexusDownload',
  website: 'https://nexusdl.papicure.de',
  apiBase: 'https://api.github.com',
} as const

export function getNexusWebsiteUrl(language: string): string {
  const route = /^zh(?:-|$)/i.test(language) ? '/' : '/en/'
  return `${NEXUS_RELEASE_CONFIG.website}${route}`
}
