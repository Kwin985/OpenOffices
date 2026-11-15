//! xlsx 属性级往返账的「产品真链路」dump（v0.200）。
//!
//! 这一模块只在 `cargo test` 时编译，不进生产包。它做的事只有一件：把「读 → 写」
//! 这一趟真实跑一遍，把源包与写出包落到 `tmp/sheet-roundtrip/`，交给
//! `scripts/sheet-roundtrip.mjs` 用 census 逐对对账。
//!
//! 为什么不把账本直接写在 Rust 里：census 的归一化（ST_OnOff 裸元素、true/1/on、
//! ISO 时刻、rgb/theme/indexed）已经在 docx 往返账里定死并验过，另写一份必然
//! 口径漂移。Rust 只负责「产品真出口」，Node 只负责「怎么数」。
//!
//! 口径：默认源包由产品写手自己造（`write_xlsx_sync` / `write_ods_sync`），
//! 所以量的是**二次保存稳定性**——产品写出的东西读回来再写一次还在不在。
//! 给 `SHEET_SRC_XLSX` / `ODS_SRC_ODS` 就把源件换成外部真件，量真件保真。
//! 两种输入不混在一个数字里，账本会写明来源。
//!
//! v0.201 起同一副骨架跑两种格式：xlsx 与 ODS。读侧都由 `read_xlsx_sync`
//! 按扩展名分流，产物分别落 `src.xlsx/out.xlsx` 与 `ods-src.ods/ods-out.ods`，
//! 由 `scripts/sheet-roundtrip.mjs --format` 各自出账。**两本账的 key 是两套
//! OOXML / ODF 词表，不可并排比百分比。**

use std::{collections::HashMap, fs, path::PathBuf};

use crate::ods::write_ods_sync;
use crate::xlsx::{
    read_xlsx_sync, write_xlsx_sync, CellPayload, SheetPayload, SheetPrintPayload, WorkbookPayload,
};

fn out_dir() -> PathBuf {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("tmp")
        .join("sheet-roundtrip");
    fs::create_dir_all(&dir).expect("建 tmp/sheet-roundtrip 失败");
    dir
}

/// 人手放的夹具：一张表、若干格、列宽行高、打印设置。
/// 每一枚属性都是产品载荷里真有槽的，不是往 XML 里硬塞非法字面。
fn fixture() -> WorkbookPayload {
    WorkbookPayload {
        sheets: vec![SheetPayload {
            name: "账样".into(),
            cells: (0..8)
                .map(|r| CellPayload {
                    r,
                    c: 0,
                    v: Some(serde_json::Value::String(format!("值{r}"))),
                    ..Default::default()
                })
                .collect(),
            col_widths: HashMap::from([(0u32, 120.0), (1u32, 80.0)]),
            row_heights: HashMap::from([(0u32, 30.0), (2u32, 24.0)]),
            print: Some(SheetPrintPayload {
                orientation: Some("landscape".into()),
                paper_size: Some(9),
                scale: Some(85),
                ..Default::default()
            }),
            ..Default::default()
        }],
        ..Default::default()
    }
}

#[test]
fn dump_sheet_roundtrip() {
    let dir = out_dir();
    let src = dir.join("src.xlsx");
    let out = dir.join("out.xlsx");
    if let Ok(external) = std::env::var("SHEET_SRC_XLSX") {
        fs::copy(&external, &src).unwrap_or_else(|e| panic!("复制外部语料 {external} 失败: {e}"));
    } else {
        write_xlsx_sync(src.to_string_lossy().into_owned(), fixture())
            .map_err(|e| e.0)
            .expect("产品写手造源包失败");
    }
    let payload = read_xlsx_sync(src.to_string_lossy().into_owned())
        .map_err(|e| e.0)
        .expect("产品读手读源包失败");
    write_xlsx_sync(out.to_string_lossy().into_owned(), payload)
        .map_err(|e| e.0)
        .expect("产品写手写出失败");
    println!("SHEETDUMP|src={} out={}", src.display(), out.display());
}

/// ODS 那一半：写手 `write_ods_sync` 造源包 → 同一个 `read_xlsx_sync`（按 .ods 分流）
/// → 再 `write_ods_sync` 一次。ODS 的 content.xml / styles.xml 是 ODF 词表，
/// 与 xlsx 的 sheetN.xml 不是同一套属性，所以单独出账。
#[test]
fn dump_ods_roundtrip() {
    let dir = out_dir();
    let src = dir.join("ods-src.ods");
    let out = dir.join("ods-out.ods");
    if let Ok(external) = std::env::var("ODS_SRC_ODS") {
        fs::copy(&external, &src).unwrap_or_else(|e| panic!("复制外部语料 {external} 失败: {e}"));
    } else {
        write_ods_sync(src.to_string_lossy().into_owned(), fixture())
            .map_err(|e| e.0)
            .expect("ODS 写手造源包失败");
    }
    let payload = read_xlsx_sync(src.to_string_lossy().into_owned())
        .map_err(|e| e.0)
        .expect("产品读手读 ODS 失败");
    write_ods_sync(out.to_string_lossy().into_owned(), payload)
        .map_err(|e| e.0)
        .expect("ODS 写手写出失败");
    println!("SHEETDUMP|ods-src={} ods-out={}", src.display(), out.display());
}
