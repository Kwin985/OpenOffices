import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets'
import type { FUniver, Univer } from '@univerjs/presets'
import { UniverSheetsCorePreset } from '@univerjs/presets/preset-sheets-core'
import { UniverSheetsFilterPreset } from '@univerjs/presets/preset-sheets-filter'
import { UniverSheetsSortPreset } from '@univerjs/presets/preset-sheets-sort'
import { UniverSheetsConditionalFormattingPreset } from '@univerjs/presets/preset-sheets-conditional-formatting'
import { UniverSheetsDataValidationPreset } from '@univerjs/presets/preset-sheets-data-validation'
import { UniverSheetsFindReplacePreset } from '@univerjs/presets/preset-sheets-find-replace'
import UniverPresetSheetsCoreZhCN from '@univerjs/presets/preset-sheets-core/locales/zh-CN'
import UniverPresetSheetsFilterZhCN from '@univerjs/presets/preset-sheets-filter/locales/zh-CN'
import UniverPresetSheetsSortZhCN from '@univerjs/presets/preset-sheets-sort/locales/zh-CN'
import UniverPresetSheetsConditionalFormattingZhCN from '@univerjs/presets/preset-sheets-conditional-formatting/locales/zh-CN'
import UniverPresetSheetsDataValidationZhCN from '@univerjs/presets/preset-sheets-data-validation/locales/zh-CN'
import UniverPresetSheetsFindReplaceZhCN from '@univerjs/presets/preset-sheets-find-replace/locales/zh-CN'
import '@univerjs/presets/lib/styles/preset-sheets-core.css'
import '@univerjs/presets/lib/styles/preset-sheets-filter.css'
import '@univerjs/presets/lib/styles/preset-sheets-sort.css'
import '@univerjs/presets/lib/styles/preset-sheets-conditional-formatting.css'
import '@univerjs/presets/lib/styles/preset-sheets-data-validation.css'
import '@univerjs/presets/lib/styles/preset-sheets-find-replace.css'

export interface SheetApp {
  univer: Univer
  univerAPI: FUniver
}

export function createSheetApp(container: HTMLElement, worker: Worker): SheetApp {
  const { univer, univerAPI } = createUniver({
    locale: LocaleType.ZH_CN,
    locales: {
      [LocaleType.ZH_CN]: mergeLocales(
        UniverPresetSheetsCoreZhCN,
        UniverPresetSheetsFilterZhCN,
        UniverPresetSheetsSortZhCN,
        UniverPresetSheetsConditionalFormattingZhCN,
        UniverPresetSheetsDataValidationZhCN,
        UniverPresetSheetsFindReplaceZhCN,
      ),
    },
    presets: [
      UniverSheetsCorePreset({
        container,
        workerURL: worker,
      }),
      UniverSheetsFilterPreset(),
      UniverSheetsSortPreset(),
      UniverSheetsConditionalFormattingPreset(),
      UniverSheetsDataValidationPreset(),
      UniverSheetsFindReplacePreset(),
    ],
  })
  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).__oofUniver = { univer, univerAPI }
  }
  return { univer, univerAPI }
}
