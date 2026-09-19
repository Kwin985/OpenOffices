import { createUniver } from '@univerjs/presets'
import { UniverSheetsCoreWorkerPreset } from '@univerjs/presets/preset-sheets-core/worker'
import { UniverSheetsFilterWorkerPreset } from '@univerjs/presets/preset-sheets-filter/worker'

createUniver({
  presets: [UniverSheetsCoreWorkerPreset(), UniverSheetsFilterWorkerPreset()],
})
