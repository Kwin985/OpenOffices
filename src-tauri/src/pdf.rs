//! PDF 相关命令：导出走 WebView2 原生 PrintToPdf；大文档读取按字节区间切片。

use std::io::{Read, Seek, SeekFrom};
use tauri::WebviewWindow;

/// 文件字节数：前端据此决定整本读还是分段读
#[tauri::command]
pub async fn file_len(path: String) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::metadata(&path)
            .map(|m| m.len())
            .map_err(|e| format!("无法读取文件信息 {path}: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 读 [start, start+len) 字节区间（越界自动裁到文件末尾）。返回原始字节，走 Tauri 的 raw IPC，
/// 免得大 PDF 整本进 JS 堆——首屏只需要其中几十 KB。
#[tauri::command]
pub async fn read_range(path: String, start: u64, len: u64) -> Result<tauri::ipc::Response, String> {
    let data = tauri::async_runtime::spawn_blocking(move || read_range_sync(&path, start, len))
        .await
        .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(data))
}

fn read_range_sync(path: &str, start: u64, len: u64) -> Result<Vec<u8>, String> {
    let mut f = std::fs::File::open(path).map_err(|e| format!("无法打开文件 {path}: {e}"))?;
    let size = f
        .metadata()
        .map_err(|e| format!("无法读取文件大小: {e}"))?
        .len();
    if start >= size || len == 0 {
        return Ok(Vec::new());
    }
    let want = (size - start).min(len) as usize;
    f.seek(SeekFrom::Start(start))
        .map_err(|e| format!("定位失败: {e}"))?;
    let mut buf = vec![0u8; want];
    f.read_exact(&mut buf)
        .map_err(|e| format!("读取失败: {e}"))?;
    Ok(buf)
}

#[tauri::command]
pub async fn export_pdf(
    window: WebviewWindow,
    file_path: String,
    // margins：四边页边距（英寸，top/right/bottom/left），None 走内置默认
    margins: Option<(f64, f64, f64, f64)>,
    page: Option<(f64, f64)>,
) -> Result<(), String> {
    let _ = (&window, &file_path);
    #[cfg(windows)]
    {
        use std::sync::mpsc::channel;
        use std::time::Duration;
        let (tx, rx) = channel::<Result<(), String>>();
        window
            .with_webview(move |webview| {
                let r = unsafe { kick_print(webview, &file_path, margins, page, tx.clone()) };
                if let Err(e) = r {
                    let _ = tx.send(Err(e));
                }
            })
            .map_err(|e| e.to_string())?;
        // PrintToPdf 完成回调在主线程消息泵触发；超时兜底防挂死
        rx.recv_timeout(Duration::from_secs(120))
            .map_err(|_| "PDF 生成超时".to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (margins, page);
        Err("当前平台暂不支持导出 PDF".into())
    }
}

#[cfg(windows)]
unsafe fn kick_print(
    webview: tauri::webview::PlatformWebview,
    path: &str,
    margins: Option<(f64, f64, f64, f64)>,
    page: Option<(f64, f64)>,
    tx: std::sync::mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment6, ICoreWebView2_7, COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE,
        COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
    };
    use webview2_com::PrintToPdfCompletedHandler;
    use windows::core::{Interface, PCWSTR};

    let controller = webview.controller();
    let wv = controller.CoreWebView2().map_err(|e| e.to_string())?;
    let wv7: ICoreWebView2_7 = wv.cast().map_err(|e| e.to_string())?;
    let env6: ICoreWebView2Environment6 = webview.environment().cast().map_err(|e| e.to_string())?;
    let settings = env6.CreatePrintSettings().map_err(|e| e.to_string())?;
    let _ = || -> Result<(), String> {
        // 失败即用默认设置（例如旧运行时不支持某项）
        settings.SetShouldPrintBackgrounds(true).map_err(|e| e.to_string())?;
        settings.SetShouldPrintHeaderAndFooter(false).map_err(|e| e.to_string())?;
        match margins {
            // 四边各自给定（幻灯片全出血传 0，文档传页面设置的 mm→英寸）
            Some((top, right, bottom, left)) => {
                settings.SetMarginTop(top).map_err(|e| e.to_string())?;
                settings.SetMarginRight(right).map_err(|e| e.to_string())?;
                settings.SetMarginBottom(bottom).map_err(|e| e.to_string())?;
                settings.SetMarginLeft(left).map_err(|e| e.to_string())?;
            }
            None => {
                settings.SetMarginTop(0.5).map_err(|e| e.to_string())?;
                settings.SetMarginBottom(0.5).map_err(|e| e.to_string())?;
                settings.SetMarginLeft(0.6).map_err(|e| e.to_string())?;
                settings.SetMarginRight(0.6).map_err(|e| e.to_string())?;
            }
        }
        // CSS @page size 在 PrintToPdf 里定不了纸张，须显式给宽高（英寸）。
        // PageWidth/Height 语义是"纵向纸"的边长，Orientation 再整体转置，故横向要先交换。
        if let Some((w, h)) = page {
            let landscape = w > h;
            settings
                .SetPageWidth(if landscape { h } else { w })
                .map_err(|e| e.to_string())?;
            settings
                .SetPageHeight(if landscape { w } else { h })
                .map_err(|e| e.to_string())?;
            settings
                .SetOrientation(if landscape {
                    COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE
                } else {
                    COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT
                })
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }();
    let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
    let handler = PrintToPdfCompletedHandler::create(Box::new(move |status, ok| {
        let msg = if status.is_ok() && ok {
            Ok(())
        } else {
            Err("WebView2 未能生成 PDF".into())
        };
        let _ = tx.send(msg);
        Ok(())
    }));
    wv7.PrintToPdf(PCWSTR::from_raw(wide.as_ptr()), &settings, &handler)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::read_range_sync;

    fn tmp_path(tag: &str) -> String {
        std::env::temp_dir()
            .join(format!("openoffices-test-pdf-{}-{}.bin", tag, std::process::id()))
            .to_string_lossy()
            .to_string()
    }

    #[test]
    fn reads_exact_window() {
        let p = tmp_path("range");
        std::fs::write(&p, b"0123456789ABCDEF").unwrap();
        assert_eq!(read_range_sync(&p, 4, 6).unwrap(), b"456789");
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn clamps_past_eof() {
        let p = tmp_path("clamp");
        std::fs::write(&p, b"hello").unwrap();
        assert_eq!(read_range_sync(&p, 2, 100).unwrap(), b"llo");
        assert_eq!(read_range_sync(&p, 5, 10).unwrap(), Vec::<u8>::new());
        assert_eq!(read_range_sync(&p, 0, 0).unwrap(), Vec::<u8>::new());
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn reports_len_and_missing_file() {
        let p = tmp_path("len");
        std::fs::write(&p, "一二三".as_bytes()).unwrap();
        assert_eq!(std::fs::metadata(&p).unwrap().len(), 9);
        let missing = tmp_path("nope");
        assert!(read_range_sync(&missing, 0, 10).is_err());
        let _ = std::fs::remove_file(&p);
    }
}
