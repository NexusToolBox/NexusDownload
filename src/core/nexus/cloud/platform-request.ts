import type { CloudErrorKind } from '@shared/schemas/nexus-cloud'
import { CloudError } from './cloud-adapter'
import { type CloudHttp, classifyCloudError, object, text } from './cloud-http'

/** Shared transport and account admission; platform validators run inside the governor. */
export async function platformRequest(
  http: CloudHttp,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  kind: 'request' | 'link' | 'transfer',
  validate: (json: Record<string, unknown>) => void
) {
  const operation = async () => {
    try {
      const response = await http.response(
        url,
        headers,
        body,
        !new Headers(headers).has('Cookie') &&
          !new Headers(headers).has('Authorization')
      )
      let json: Record<string, unknown>
      try {
        json = object(await response.json())
      } catch {
        http.record(new URL(url), response.status)
        throw new CloudError(classifyCloudError(0, '', response.status))
      }
      http.record(new URL(url), response.status, json)
      if (!response.ok)
        throw new CloudError(
          classifyCloudError(
            response.status,
            text(json.message ?? json.error),
            response.status
          )
        )
      validate(json)
      return { json, cookies: response.headers.getSetCookie() }
    } catch (error) {
      if (error instanceof CloudError) throw error
      throw new CloudError('network')
    }
  }
  return http.options.request
    ? http.options.request(operation, kind)
    : operation()
}
export function platformError(
  code: number,
  message: string,
  overrides: Record<number, CloudErrorKind>
) {
  return new CloudError(overrides[code] ?? classifyCloudError(code, message))
}
