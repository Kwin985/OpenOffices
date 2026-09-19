//! PDF 导出：调 WebView2 原生 PrintToPdf，按页面 @media print 样式矢量落盘。

use tauri::WebviewWindow;

#[tauri::command]
pub async fn export_pdf(window: WebviewWindow, file_path: String) -> Result<(), String> {
    let _ = (&window, &file_path);
    #[cfg(windows)]
    {
        use std::sync::mpsc::channel;
        use std::time::Duration;
        let (tx, rx) = channel::<Result<(), String>>();
        window
            .with_webview(move |webview| {
                let r = unsafe { kick_print(webview, &file_path, tx.clone()) };
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
        Err("当前平台暂不支持导出 PDF".into())
    }
}

#[cfg(windows)]
unsafe fn kick_print(
    webview: tauri::webview::PlatformWebview,
    path: &str,
    tx: std::sync::mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment6, ICoreWebView2_7,
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
        settings.SetMarginTop(0.5).map_err(|e| e.to_string())?;
        settings.SetMarginBottom(0.5).map_err(|e| e.to_string())?;
        settings.SetMarginLeft(0.6).map_err(|e| e.to_string())?;
        settings.SetMarginRight(0.6).map_err(|e| e.to_string())?;
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
