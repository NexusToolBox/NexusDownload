/** Chromium supports WOFF2; retain all bundled glyphs without WOFF duplicates. */
export function nexusWoff2Fonts() {
  return {
    postcssPlugin: 'nexus-woff2-fonts',
    Declaration: {
      src(declaration: { value: string }) {
        if (!declaration.value.includes('.woff2')) return
        declaration.value = declaration.value.replace(
          /,\s*url\([^)]*\.woff\)\s*format\((?:'woff'|"woff")\)/g,
          ''
        )
      },
    },
  }
}
