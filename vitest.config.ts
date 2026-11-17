import path from 'node:path'
import { defineConfig } from 'vitest/config'
import packageJson from './package.json' with { type: 'json' }

// Retained upstream packaging and server integration suites target other products.
const desktopExcluded = [
  'src/server/**',
  'src/main/platform/appimage-integration.test.ts',
  'src/main/platform/linux-default-apps.test.ts',
  'src/main/bridge/appimage-native-host.test.ts',
  'src/main/bridge/safari-bootstrap-registration.test.ts',
  'src/main/cli/**',
  'src/main/plugin/ffmpeg-probe-managed.test.ts',
  'tests/scripts/safari-desktop-package.test.ts',
  'tests/scripts/audit-server-runtime.test.ts',
  'src/renderer/routes/settings/cards/nas-dialog.test.tsx',
  'tests/scripts/*flatpak*.test.ts',
  'tests/scripts/*snap*.test.ts',
  'tests/scripts/*pacman*.test.ts',
  'tests/scripts/*fnos*.test.ts',
  'tests/scripts/*synology*.test.ts',
  'tests/scripts/*server-package.test.ts',
  'tests/scripts/release-signing-input.test.ts',
  'tests/scripts/workflow-release-matrix.test.ts',
  'tests/scripts/run-remote-extension-release-soak.test.ts',
  'tests/scripts/obsidian-docs.test.ts',
]

export default defineConfig({
  define: {
    __MOTRIX_TARGET__: JSON.stringify('electron'),
    __MOTRIX_FNOS__: JSON.stringify(true),
    __MOTRIX_PREVIEW_MAC_MENU__: JSON.stringify(false),
    __MOTRIX_APP_METADATA__: JSON.stringify({
      name: packageJson.productName,
      version: packageJson.version,
      author: packageJson.author,
      license: packageJson.license,
    }),
  },
  test: {
    environment: 'node',
    globals: true,
    setupFiles: [],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**', 'dist-test/**'],
    projects: [
      {
        test: {
          name: 'node',
          globalSetup: ['tests/setup/build-worker.ts'],
          include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
          exclude: ['src/{renderer,preload}/**', ...desktopExcluded],
        },
      },
      {
        test: {
          name: 'browser',
          environment: 'jsdom',
          setupFiles: ['tests/setup/nexus-renderer.ts'],
          include: ['src/{renderer,preload}/**/*.test.{ts,tsx}'],
          exclude: desktopExcluded,
        },
      },
    ],
  },
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, 'src/shared'),
      '@core': path.resolve(import.meta.dirname, 'src/core'),
      '@renderer': path.resolve(import.meta.dirname, 'src/renderer'),
      '@server': path.resolve(import.meta.dirname, 'src/server'),
      '@test-utils': path.resolve(import.meta.dirname, 'src/test-utils'),
    },
  },
})
