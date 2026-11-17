/** Anonymous visitor state, held in memory only. No user account is created. */
export class DouyinAnonymous {
  private cookie = ''
  private at = 0
  constructor(private fetcher: typeof fetch = fetch) {}
  async get(renew = false) {
    if (!renew && this.cookie && Date.now() - this.at < 30 * 60 * 1000)
      return this.cookie
    const response = await this.fetcher(
      'https://ttwid.bytedance.com/ttwid/union/register/',
      {
        method: 'POST',
        redirect: 'error',
        credentials: 'omit',
        signal: AbortSignal.timeout(15000),
        headers: {
          'Content-Type': 'application/json',
          Referer: 'https://www.iesdouyin.com/',
        },
        body: JSON.stringify({
          region: 'cn',
          aid: 1768,
          needFid: false,
          service: 'www.iesdouyin.com',
          union: true,
          fid: '',
        }),
      }
    )
    if (!response.ok) throw new Error('media.blocked')
    const read = (r: Response) =>
      r.headers
        .getSetCookie()
        .map((c) => c.match(/(?:^|;\s*)ttwid=([^;\r\n]{1,4096})/)?.[1])
        .find(Boolean)
    let value = read(response)
    const body: unknown = await response.json()
    const callback =
      body && typeof body === 'object'
        ? (body as Record<string, unknown>).redirect_url
        : null
    if (typeof callback === 'string') {
      const url = new URL(callback)
      if (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        ['bytedance.com', 'iesdouyin.com', 'douyin.com'].some(
          (r) => url.hostname === r || url.hostname.endsWith(`.${r}`)
        )
      ) {
        try {
          const r = await this.fetcher(url, {
            redirect: 'manual',
            credentials: 'omit',
            signal: AbortSignal.timeout(15000),
          })
          value = read(r) || value
          await r.body?.cancel()
        } catch {
          /* Registration can succeed without the optional callback. */
        }
      }
    }
    if (!value) throw new Error('media.blocked')
    this.cookie = `ttwid=${value}`
    this.at = Date.now()
    return this.cookie
  }
}
