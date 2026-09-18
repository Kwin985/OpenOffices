import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets'
import type { FUniver, Univer } from '@univerjs/presets'
import { UniverSheetsCorePreset } from '@univerjs/presets/preset-sheets-core'
import UniverPresetSheetsCoreZhCN from '@univerjs/presets/preset-sheets-core/locales/zh-CN'
import '@univerjs/presets/lib/styles/preset-sheets-core.css'

export interface SheetApp {
  univer: Univer
  univerAPI: FUniver
}

export function createSheetApp(container: HTMLElement, worker: Worker): SheetApp {
  const { univer, univerAPI } = createUniver({
    locale: LocaleType.ZH_CN,
    locales: {
      [LocaleType.ZH_CN]: mergeLocales(UniverPresetSheetsCoreZhCN),
    },
    presets: [
      UniverSheetsCorePreset({
        container,
        workerURL: worker,
      }),
    ],
  })
  return { univer, univerAPI }
}
