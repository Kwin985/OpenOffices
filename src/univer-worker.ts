import { createUniver } from '@univerjs/presets'
import { UniverSheetsCoreWorkerPreset } from '@univerjs/presets/preset-sheets-core/worker'

createUniver({
  presets: [UniverSheetsCoreWorkerPreset()],
})
