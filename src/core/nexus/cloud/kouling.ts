// Ported from YunX Desktop 1.3.4 XunleiKouling.kt, XunleiApi.parseKouling,
// StarSeaApi.kt and StarSeaConstants.kt. Copyright YunX contributors.
// SPDX-License-Identifier: AGPL-3.0-only
import { CloudError } from './cloud-adapter'
import { encode, object, text } from './cloud-http'

export async function resolveKouling(
  input: string,
  key: string,
  fetcher: typeof fetch = fetch
): Promise<string> {
  const command = input.trim()
  if (!command || command.length > 120 || /https?:\/\//i.test(command))
    throw new CloudError('unsupported')
  const keyword = command
    .replace(
      /^[「」『』【】《》〈〉“”‘’"'`()（）[\]{}<>.,，。;；:：!！?？、|]+|[「」『』【】《》〈〉“”‘’"'`()（）[\]{}<>.,，。;；:：!！?？、|]+$/g,
      ''
    )
    .trim()
  if (
    keyword.length <= 64 &&
    /^[\p{L}\p{N}]+$/u.test(keyword) &&
    /[\u4E00-\u9FFF]/.test(keyword)
  ) {
    try {
      const response = await fetcher(
        `https://api-shoulei-ssl.xunlei.com/xlppc.searcher.api/jump?noredirect=1&t=20&wd=${encode(keyword)}&tn=15007414_5_dg&src=lm&ls=sm3016480&lm_extend=ctype:31`,
        {
          redirect: 'error',
          signal: AbortSignal.timeout(15000),
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.5359.215 Safari/537.36 TBC/1.3.3.999 Thunder/12.4.4.3740',
            Accept: '*/*',
            Origin: 'https://sl-m-ssl.xunlei.com',
            Referer: 'https://sl-m-ssl.xunlei.com/',
            'Accept-Language': 'zh-CN',
          },
        }
      )
      const json = object(await response.json())
      if (response.ok && object(json.ext).kouling_type === 'share_page') {
        const url = new URL(text(json.location))
        const id =
          url.hostname === 'pan.xunlei.com'
            ? url.pathname.match(/^\/s\/([A-Za-z0-9_-]+)$/)?.[1]
            : undefined
        if (id) {
          const pwd = url.searchParams.get('pwd')
          return `https://pan.xunlei.com/s/${id}${pwd && /^[A-Za-z0-9]+$/.test(pwd) ? `?pwd=${pwd}` : ''}`
        }
      }
    } catch {
      /* Fall through to the explicitly enabled secondary service. */
    }
  }
  // Service credentials are entered locally, encrypted, and never bundled from upstream.
  if (!key) throw new CloudError('login')
  try {
    const response = await fetcher('https://starsea-api.qwq.pics/api/resolve', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: {
        'X-API-Key': key,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clipboard: command,
        platform: 'auto',
        step: 'parse',
      }),
    })
    const json = object(await response.json())
    if (!response.ok || json.success !== true)
      throw new CloudError(response.status === 429 ? 'rate' : 'expired-share')
    const data = object(json.data)
    const id = text(data.pwdId)
    if (
      !/^[A-Za-z0-9_-]+$/.test(id) ||
      !['uc', 'qk', 'quark'].includes(text(data.platform))
    )
      throw new CloudError('expired-share')
    return `https://${data.platform === 'uc' ? 'drive.uc.cn' : 'pan.quark.cn'}/s/${id}`
  } catch (error) {
    if (error instanceof CloudError) throw error
    throw new CloudError('network')
  }
}
