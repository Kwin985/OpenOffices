import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets'
import type { FUniver, Univer } from '@univerjs/presets'
import { UniverSheetsCorePreset } from '@univerjs/presets/preset-sheets-core'
import { UniverSheetsFilterPreset } from '@univerjs/presets/preset-sheets-filter'
import { UniverSheetsSortPreset } from '@univerjs/presets/preset-sheets-sort'
import { UniverSheetsConditionalFormattingPreset } from '@univerjs/presets/preset-sheets-conditional-formatting'
import { UniverSheetsDataValidationPreset } from '@univerjs/presets/preset-sheets-data-validation'
import { UniverSheetsFindReplacePreset } from '@univerjs/presets/preset-sheets-find-replace'
import { UniverSheetsDrawingPreset } from '@univerjs/presets/preset-sheets-drawing'
import { UniverSheetsNotePreset } from '@univerjs/presets/preset-sheets-note'
import { UniverSheetsHyperLinkPreset } from '@univerjs/presets/preset-sheets-hyper-link'
import UniverPresetSheetsCoreZhCN from '@univerjs/presets/preset-sheets-core/locales/zh-CN'
import UniverPresetSheetsFilterZhCN from '@univerjs/presets/preset-sheets-filter/locales/zh-CN'
import UniverPresetSheetsSortZhCN from '@univerjs/presets/preset-sheets-sort/locales/zh-CN'
import UniverPresetSheetsConditionalFormattingZhCN from '@univerjs/presets/preset-sheets-conditional-formatting/locales/zh-CN'
import UniverPresetSheetsDataValidationZhCN from '@univerjs/presets/preset-sheets-data-validation/locales/zh-CN'
import UniverPresetSheetsFindReplaceZhCN from '@univerjs/presets/preset-sheets-find-replace/locales/zh-CN'
import UniverPresetSheetsDrawingZhCN from '@univerjs/presets/preset-sheets-drawing/locales/zh-CN'
import UniverPresetSheetsNoteZhCN from '@univerjs/presets/preset-sheets-note/locales/zh-CN'
import UniverPresetSheetsHyperLinkZhCN from '@univerjs/presets/preset-sheets-hyper-link/locales/zh-CN'
import { openUrl } from '@tauri-apps/plugin-opener'
import '@univerjs/presets/lib/styles/preset-sheets-core.css'
import '@univerjs/presets/lib/styles/preset-sheets-filter.css'
import '@univerjs/presets/lib/styles/preset-sheets-sort.css'
import '@univerjs/presets/lib/styles/preset-sheets-conditional-formatting.css'
import '@univerjs/presets/lib/styles/preset-sheets-data-validation.css'
import '@univerjs/presets/lib/styles/preset-sheets-find-replace.css'
import '@univerjs/presets/lib/styles/preset-sheets-drawing.css'
import '@univerjs/presets/lib/styles/preset-sheets-note.css'
import '@univerjs/presets/lib/styles/preset-sheets-hyper-link.css'

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
        UniverPresetSheetsDrawingZhCN,
        UniverPresetSheetsNoteZhCN,
        UniverPresetSheetsHyperLinkZhCN,
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
      UniverSheetsDrawingPreset(),
      UniverSheetsNotePreset(),
      // 桌面上的 window.open 会开一个新 WebView 窗口，外部链接一律交给系统默认浏览器
      UniverSheetsHyperLinkPreset({
        urlHandler: {
          navigateToOtherWebsite: (url) => {
            void openUrl(url).catch(() => {})
          },
        },
      }),
    ],
  })
  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).__oofUniver = { univer, univerAPI }
  }
  return { univer, univerAPI }
}
