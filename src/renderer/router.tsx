import { createHashRouter, Navigate, type RouteObject } from 'react-router'
import { RootRouteFailure, RouteFailure } from './components/renderer-boundary'
import { AppLayout } from './layouts/app-layout'
import type { RouteHandle } from './router-types'
import { DashboardPage } from './routes/dashboard/dashboard-page'
import { NexusCloudPage } from './routes/nexus-cloud/cloud-page'
import { NexusDownloadsPage } from './routes/nexus-downloads/downloads-page'
import { NexusMediaPage } from './routes/nexus-media/media-page'
import { NexusServicesPage } from './routes/nexus-services/services-page'
import { NexusSettingsPage } from './routes/nexus-settings/settings-page'
import { NotificationsPage } from './routes/notifications/notifications-page'
import { PluginDetailPage } from './routes/plugins/plugin-detail-page'
import { PluginDiagnosticsPage } from './routes/plugins/plugin-diagnostics-page'
import { PluginsPage } from './routes/plugins/plugins-page'
import { TrackersPage } from './routes/trackers/trackers-page'

const routes = [
  {
    path: '/',
    errorElement: <RootRouteFailure />,
    element: <AppLayout />,
    children: [
      {
        index: true,
        element: <Navigate to="downloads/all" replace />,
      },
      {
        path: 'downloads',
        element: <NexusDownloadsPage />,
        children: [
          { index: true, element: <Navigate to="all" replace /> },
          { path: ':filter', element: null },
        ],
      },
      {
        path: 'dashboard',
        element: <DashboardPage />,
        handle: { transparentInset: true } satisfies RouteHandle,
      },
      { path: 'cloud', element: <NexusCloudPage /> },
      { path: 'media', element: <NexusMediaPage /> },
      { path: 'services', element: <NexusServicesPage /> },
      { path: 'trackers', element: <TrackersPage /> },
      { path: 'plugins', element: <PluginsPage /> },
      {
        path: 'plugins/diagnostics',
        element: <PluginDiagnosticsPage />,
      },
      { path: 'plugins/:id', element: <PluginDetailPage /> },
      { path: 'notifications', element: <NotificationsPage /> },
      // MigrationPage is retained by AppLayout across navigation.
      { path: 'migration', element: null },
      {
        path: 'settings',
        element: <NexusSettingsPage />,
        children: [{ path: ':cardId', element: null }],
      },
    ],
  },
] satisfies RouteObject[]

for (const route of routes[0].children)
  Object.assign(route, { errorElement: <RouteFailure /> })

export const router = createHashRouter(routes)
