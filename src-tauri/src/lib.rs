mod csv;
mod pdf;
mod ods;
mod xlsx;
mod xlsx_cell_side;
mod xlsx_chart;
mod xlsx_rules;
mod xlsx_style;

use std::sync::Mutex;

/// 应用可打开的扩展名（须与前端 lib/fs.ts 的 kindOfPath 保持一致）
pub const OPEN_EXTS: &[&str] = &[
    "xlsx", "xls", "ods", "csv", "docx", "odoc", "odt", "pptx", "ppt", "opd", "pdf",
];

/// 从进程 argv（含 argv[0]）里挑出可打开的文件路径——Windows 文件关联把路径作为参数传入
pub fn startup_file_paths<I: IntoIterator<Item = String>>(args: I) -> Vec<String> {
    args.into_iter()
        .skip(1)
        .map(|a| a.trim_matches('"').to_string())
        .filter(|a| match a.rsplit_once('.') {
            Some((stem, ext)) => {
                !stem.is_empty() && OPEN_EXTS.contains(&ext.to_ascii_lowercase().as_str())
            }
            None => false,
        })
        .collect()
}

#[tauri::command]
fn take_startup_files(state: tauri::State<'_, StartupFiles>) -> Vec<String> {
    std::mem::take(&mut state.0.lock().unwrap())
}

struct StartupFiles(Mutex<Vec<String>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial = startup_file_paths(std::env::args());
    tauri::Builder::default()
        // 单实例：二次双击关联文件不重开进程，把路径转发给已开窗口
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            use tauri::{Emitter, Manager};
            let paths = startup_file_paths(args);
            if !paths.is_empty() {
                let _ = app.emit("oof://open-paths", paths);
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // 只注册插件本身：应用侧只用到 check（前端仅授予 updater:allow-check），下载与安装没接线
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(StartupFiles(Mutex::new(initial)))
        .invoke_handler(tauri::generate_handler![
            xlsx::read_xlsx,
            xlsx::write_xlsx,
            csv::write_csv,
            ods::write_ods,
            pdf::export_pdf,
            pdf::file_len,
            pdf::read_range,
            take_startup_files
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::startup_file_paths;

    fn v(xs: &[&str]) -> Vec<String> {
        xs.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn picks_associated_paths_and_skips_argv0() {
        let got = startup_file_paths(v(&[
            "C:\\apps\\OpenOffices.exe",
            "D:\\docs\\季度报告.docx",
            "D:\\a b\\演示.OPD",
            "D:\\x\\note.txt",
            "--flag",
        ]));
        assert_eq!(
            got,
            v(&["D:\\docs\\季度报告.docx", "D:\\a b\\演示.OPD"]),
            "大小写不敏感、跳过 argv0 与无关参数"
        );
    }

    #[test]
    fn rejects_extensionless_and_bare_extension() {
        assert_eq!(startup_file_paths(v(&["exe", "README", ".pdf"])), Vec::<String>::new());
    }

    #[test]
    fn trims_wrapping_quotes() {
        let got = startup_file_paths(v(&["exe", "\"D:\\数据\\表.xlsx\""]));
        assert_eq!(got, v(&["D:\\数据\\表.xlsx"]));
    }
}
