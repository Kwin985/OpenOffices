import { memo, useEffect, useRef, useState } from 'react'
import { message } from '@tauri-apps/plugin-dialog'
import type { IWorkbookData } from '@univerjs/presets'
import type { FUniver } from '@univerjs/presets'
import type { Tab } from '../store'
import { useApp } from '../store'
import { createSheetApp } from '../lib/univer'
import { payloadToWorkbook, workbookToPayload } from '../lib/univer-io'
import { baseName, pickSaveFile, readXlsx, writeXlsx } from '../lib/fs'
import { registerSaver } from '../lib/registry'

interface Props {
  tab: Tab
}

function SheetEditor({ tab }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<FUniver | null>(null)
  const [status, setStatus] = useState<string>(tab.path ? '正在加载…' : '')
  const renameTab = useApp((s) => s.renameTab)
  const markDirty = useApp((s) => s.markDirty)
  const markRecent = useApp((s) => s.markRecent)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let disposed = false
    let ready = false
    let api: FUniver | null = null
    const worker = new Worker(new URL('../univer-worker.ts', import.meta.url), {
      type: 'module',
    })
    ;(async () => {
      try {
        let data: IWorkbookData
        if (tab.path) {
          const dump = await readXlsx(tab.path)
          data = payloadToWorkbook(dump, baseName(tab.path))
        } else {
          data = payloadToWorkbook({ sheets: [] }, '未命名表格')
        }
        if (disposed) return
        const created = createSheetApp(container, worker)
        api = created.univerAPI
        apiRef.current = api
        api.createWorkbook(data)
        api.onCommandExecuted(() => {
          if (ready) markDirty(tab.id, true)
        })
        setTimeout(() => {
          ready = true
        }, 800)
        setStatus('')
      } catch (e) {
        console.error(e)
        setStatus(`加载失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    })()
    return () => {
      disposed = true
      apiRef.current = null
      api?.dispose()
      worker.terminate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id])

  const save = async (asNew: boolean) => {
    const api = apiRef.current
    const wb = api?.getActiveWorkbook()
    if (!api || !wb) return
    try {
      const snapshot = wb.save() as IWorkbookData
      const payload = workbookToPayload(snapshot)
      let path = asNew ? undefined : tab.path
      if (!path) {
        path = (await pickSaveFile(`${snapshot.name || '工作簿'}.xlsx`, ['xlsx'])) ?? undefined
        if (!path) return
      }
      await writeXlsx(path, payload)
      renameTab(tab.id, baseName(path), path)
      markRecent(path, 'sheet')
      setStatus('已保存')
      setTimeout(() => setStatus(''), 1500)
    } catch (e) {
      await message(String(e), { title: '保存失败', kind: 'error' })
    }
  }

  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => registerSaver(tab.id, (asNew) => saveRef.current(asNew)), [tab.id])

  return (
    <div className="editor-pane">
      <div className="editor-toolbar">
        <button className="tool-btn" onClick={() => save(false)}>保存</button>
        <button className="tool-btn" onClick={() => save(true)}>另存为…</button>
        {status && <span className="editor-status">{status}</span>}
        <span className="editor-hint">内核: Univer (Apache-2.0) · xlsx 读写: calamine / rust_xlsxwriter</span>
      </div>
      <div className="sheet-container" ref={containerRef} />
    </div>
  )
}

export default memo(SheetEditor)
