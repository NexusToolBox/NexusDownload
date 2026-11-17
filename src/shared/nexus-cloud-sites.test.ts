import { describe, expect, it } from 'vitest'
import { CLOUD_LOGIN_ROOTS, isCloudLoginAddress } from './nexus-cloud-sites'

describe('official cloud login navigation', () => {
  it('accepts official roots and login-center subdomains', () => {
    for (const [platform, roots] of Object.entries(CLOUD_LOGIN_ROOTS))
      for (const root of roots) {
        expect(
          isCloudLoginAddress(
            platform as keyof typeof CLOUD_LOGIN_ROOTS,
            `https://${root}/`
          )
        ).toBe(true)
        expect(
          isCloudLoginAddress(
            platform as keyof typeof CLOUD_LOGIN_ROOTS,
            `https://user.${root}/centerlogin`
          )
        ).toBe(true)
        expect(
          isCloudLoginAddress(
            platform as keyof typeof CLOUD_LOGIN_ROOTS,
            `https://${root}.example.org/`
          )
        ).toBe(false)
        expect(
          isCloudLoginAddress(
            platform as keyof typeof CLOUD_LOGIN_ROOTS,
            `https://fake${root}/`
          )
        ).toBe(false)
      }
  })
  it.each([
    'http://drive.uc.cn/',
    'https://drive.uc.cn:8443/',
    'javascript:void(0)',
    'https://drive.uc.cn@other.example/',
  ])('rejects unsafe navigation', (address) => {
    expect(isCloudLoginAddress('uc', address)).toBe(false)
  })
})
