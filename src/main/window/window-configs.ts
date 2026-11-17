import { APP_NAME } from '@shared/constants'
import {
  ADD_TASK_COLLAPSED_HEIGHT,
  TASK_FORM_WIDTH,
} from '@shared/constants/add-task'
import type { WindowId } from '@shared/types/window'
import { WindowRoutes } from '@shared/types/window'

export type { WindowId }

export interface WindowConfig {
  id: WindowId
  title: string
  width: number
  height: number
  minWidth?: number
  minHeight?: number
  resizable: boolean
  route: string
  closeBehavior: 'hide' | 'destroy'
  persistBounds: boolean
  maximizable: boolean
  vibrancy: boolean
  liquidGlass: boolean
  transparent?: boolean
}

export const WINDOW_CONFIGS: Record<WindowId, WindowConfig> = {
  main: {
    id: 'main',
    title: APP_NAME,
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    resizable: true,
    route: WindowRoutes.main,
    closeBehavior: 'hide',
    persistBounds: true,
    maximizable: true,
    vibrancy: false,
    liquidGlass: false,
    transparent: false,
  },
  'add-task': {
    id: 'add-task',
    title: 'New Task',
    width: TASK_FORM_WIDTH,
    height: ADD_TASK_COLLAPSED_HEIGHT,
    resizable: false,
    route: WindowRoutes['add-task'],
    closeBehavior: 'destroy',
    persistBounds: false,
    maximizable: false,
    vibrancy: false,
    liquidGlass: false,
    transparent: false,
  },
  'create-torrent': {
    id: 'create-torrent',
    title: APP_NAME,
    width: TASK_FORM_WIDTH,
    height: ADD_TASK_COLLAPSED_HEIGHT,
    minWidth: 470,
    minHeight: 290,
    resizable: true,
    route: WindowRoutes['create-torrent'],
    closeBehavior: 'destroy',
    persistBounds: false,
    maximizable: false,
    vibrancy: false,
    liquidGlass: false,
  },
  onboarding: {
    id: 'onboarding',
    title: APP_NAME,
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    resizable: true,
    route: WindowRoutes.onboarding,
    closeBehavior: 'destroy',
    persistBounds: false,
    maximizable: false,
    vibrancy: false,
    liquidGlass: true,
    transparent: false,
  },
}
