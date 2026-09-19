mod pdf;
mod xlsx;
mod xlsx_chart;
mod xlsx_style;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            xlsx::read_xlsx,
            xlsx::write_xlsx,
            pdf::export_pdf
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
