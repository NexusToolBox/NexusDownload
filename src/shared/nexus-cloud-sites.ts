import type { CloudPlatform } from './schemas/nexus-cloud'

export const CLOUD_LOGIN_ROOTS: Record<CloudPlatform, readonly string[]> = {
  quark: ['quark.cn', 'quark.com', 'myquark.cn'],
  uc: ['uc.cn', 'ucweb.com'],
  baidu: ['baidu.com', 'baidupcs.com'],
  '115': ['115.com', '115cdn.com', '115rc.com'],
  '123': [
    '123pan.com',
    '123pan.cn',
    '123684.com',
    '123684.cn',
    '123865.com',
    '123912.com',
  ],
  aliyun: ['alipan.com', 'aliyundrive.com', 'aliyun.com', 'aliyundrive.net'],
}
export function isCloudLoginAddress(platform: CloudPlatform, address: string) {
  try {
    const url = new URL(address)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === '443') &&
      CLOUD_LOGIN_ROOTS[platform].some(
        (root) => url.hostname === root || url.hostname.endsWith(`.${root}`)
      )
    )
  } catch {
    return false
  }
}
