//! 保留式写回（v0.98）：存盘本体仍是 rust_xlsxwriter 整包重建——这条链路的保真账本已经
//! 调平，不能为第三方件推倒重来。重建落地之后，再把原件里「读侧不认、模型里也没有」的
//! 部件按**表名映射**整份搬进新包，并接好三处线：sheet 部件上的引用元素、逐层 rels、
//! `[Content_Types].xml`。
//!
//! 方向是「部件级搬运」而不是「逐属性缝合」：以部件为粒度照搬，部件内部我们不认识的
//! 字节一位不动地活着（x14ac:dyDescent 这类行级属性账不在此列，见 README 挂账）。
//! 守卫按表逐一对名：同名表才搬；改名/删除的表自然不搬（原部件随整包重建消失），
//! 且要记一条账，让「图片/表格怎么没了」说得出原因。

use std::collections::HashMap;
use std::fs::File;
use std::io::{Cursor, Read, Write};

use zip::write::SimpleFileOptions;
use zip::ZipWriter;

use crate::xlsx_chart::{parse_rels, rels_of, resolve_rel};
use crate::xlsx_style::{read_entry, read_entry_bytes, sheet_paths};

pub struct CarryOutcome {
    pub bytes: Vec<u8>,
    pub notes: Vec<String>,
}

/// 媒体扩展名 → MIME（搬图片要往 [Content_Types].xml 补 Default）；认不出的不搬
fn media_mime(ext: &str) -> Option<&'static str> {
    match ext {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "bmp" => Some("image/bmp"),
        "tif" | "tiff" => Some("image/tiff"),
        "emf" => Some("image/x-emf"),
        "wmf" => Some("image/x-wmf"),
        _ => None,
    }
}

const RELS_NS: &str = "http://schemas.openxmlformats.org/package/2006/relationships";
const REL_DRAWING: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing";
const REL_TABLE: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/table";
const REL_IMAGE: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const REL_PIVOT_TABLE: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotTable";
const REL_PIVOT_CACHE_DEF: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition";
const REL_PIVOT_CACHE_RECORDS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheRecords";
// 切片器不是 ECMA-376：关系类型是 MS 扩展 URI（与 timeline 同一族）
const REL_SLICER: &str = "http://schemas.microsoft.com/office/2007/relationships/slicer";
const REL_SLICER_CACHE: &str = "http://schemas.microsoft.com/office/2007/relationships/slicerCache";
/// 页眉页脚的 VML（legacyDrawingHF）与批注/表单控件的 VML 同一个关系类型，
/// 区别只在 sheet 部件上用哪个元素引用它
const REL_VML_DRAWING: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing";
const REL_CONNECTION: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/connections";
const REL_QUERY_TABLE: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/queryTable";
const CT_CONNECTION: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml";
const CT_QUERY_TABLE: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.queryTable+xml";
/// VML 部件的 ContentType：走 [Content_Types].xml 的 Default Extension="vml"
const VML_CT: &str = "application/vnd.openxmlformats-officedocument.vmlDrawing";
const X14_NS: &str = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main";
/// 切片器缓存那一枚 ext 的 uri（Excel 亲笔固定值，搬过去要原样写回）
const SLICER_EXT_URI: &str = "{BBE1A952-AA13-448e-AADC-164F8C751C88}";

pub fn carry(
    orig_path: &str,
    new_bytes: &[u8],
    sheet_names: &[String],
) -> Result<CarryOutcome, String> {
    let file = File::open(orig_path).map_err(|e| format!("原件打不开: {e}"))?;
    let mut orig = zip::ZipArchive::new(file).map_err(|e| format!("原件不是合法的 zip: {e}"))?;

    let mut entries = entries_of(&new_bytes)?;
    // 两边的表名 → sheet 部件路径都走 workbook.xml + rels 的正路解析，不赌 crate 的部件命名
    let orig_sheets = sheet_paths(&mut orig);
    if orig_sheets.is_empty() {
        return Err("原件里没有工作表".into());
    }
    let new_sheets = {
        let mut z = zip::ZipArchive::new(Cursor::new(new_bytes))
            .map_err(|e| format!("产物读不回来: {e}"))?;
        sheet_paths(&mut z)
    };
    let new_by_name: HashMap<&str, &str> = new_sheets
        .iter()
        .map(|(n, p)| (n.as_str(), p.as_str()))
        .collect();

    // 部件名分配从「新包里已有」的最大号往后排：crate 重建的产物里 drawingN 可能已存在
    // （图表），表格/媒体按 app 的模型 crate 从不写出——撞号只可能来自旧产物，逐名探测最稳
    let next_drawing = next_free(&entries, "xl/drawings/drawing", ".xml");
    let mut next_table = next_free(&entries, "xl/tables/table", ".xml");
    let mut next_image = next_free(&entries, "xl/media/image", "");

    let mut notes = Vec::new();
    // content types 的三笔账，收尾统一落（部件搬成什么样这里说了不算，先攒着）
    let mut ct_overrides: Vec<(String, &'static str)> = Vec::new(); // (part, ContentType)
    let mut ct_defaults: Vec<(String, &'static str)> = Vec::new(); // (ext, ContentType)
    let mut carried_tables = 0usize;
    let mut carried_pics = 0usize;
    // 原件部件路径 → 产物部件路径：透视缓存给切片器缓存改指数据源用，表格同理（v0.109）
    let mut table_map: HashMap<String, String> = HashMap::new();
    // cNvPr id 的重排基数：跳过产物里已有图形的那段号，从 1000 的倍数起整段独占
    let mut cnvpr_next = next_drawing * 1000;

    for name in sheet_names {
        let Some(orig_part) = orig_sheets
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, p)| p.as_str())
        else {
            continue; // 新簿里的新表，原件没有对应物，无从搬起
        };
        let Some(new_part) = new_by_name.get(name.as_str()).copied() else {
            notes.push(format!("表「{name}」在产物里没找到对应部件，原件内容没搬"));
            continue;
        };
        let Some(orig_sheet_xml) = read_entry(&mut orig, orig_part) else {
            continue;
        };
        let Some(orig_rels_xml) = read_entry(&mut orig, &rels_of(orig_part)) else {
            continue; // 原件这张表没有任何 rels（无图无表格），自然没得搬
        };
        let orig_rels = parse_rels(&orig_rels_xml);

        // —— 表格（ListObjects）：rels 里 Type 以 /table 结尾的部件，整份照搬 ——
        for target in rels_of_type(&orig_rels_xml, REL_TABLE) {
            let part = resolve_rel(orig_part, &target);
            let Some(bytes) = read_entry_bytes(&mut orig, &part) else {
                notes.push(format!("表「{name}」的表格部件 {part} 读不出来，没搬"));
                continue;
            };
            let tbl_part = format!("xl/tables/table{}.xml", next_table);
            next_table += 1;
            upsert(&mut entries, tbl_part.clone(), bytes);
            ct_overrides.push((
                tbl_part.clone(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml",
            ));
            let rid = add_sheet_rel(&mut entries, new_part, REL_TABLE, &part_target(&tbl_part))?;
            attach_table_part(&mut entries, new_part, &rid, name, &mut notes)?;
            table_map.insert(part.clone(), tbl_part);
            carried_tables += 1;
        }

        // —— 图片：原件 drawing 里的 pic 锚点搬进产物的 drawing（与 crate 写的图表共存）——
        // 页眉页脚图住在 `<picture r:id>` 指的那份 drawing 里（不是浮动图），整份跳过
        let header_drawing = sheet_xml_attr(&orig_sheet_xml, "<picture r:id=\"")
            .and_then(|rid| orig_rels.get(&rid).cloned())
            .map(|t| resolve_rel(orig_part, &t));
        for target in rels_of_type(&orig_rels_xml, REL_DRAWING) {
            let dw = resolve_rel(orig_part, &target);
            if header_drawing.as_deref() == Some(dw.as_str()) {
                continue; // 页眉页脚那份独立 drawing 归 carry_hf_pics 接手（v0.110）
            }
            let Some(dw_xml) = read_entry(&mut orig, &dw) else {
                continue;
            };
            let dw_rels_raw = read_entry(&mut orig, &rels_of(&dw)).unwrap_or_default();
            let dw_rels = parse_rels(&dw_rels_raw);
            let anchors = pic_anchors(&dw_xml);
            if anchors.is_empty() {
                continue; // 这份 drawing 里没有图（纯图表/形状），不惊动产物
            }
            // 先把要用的媒体按旧 rId 对好号，认不出的扩展名当场记账跳过
            let mut media_map: HashMap<String, (String, String)> = HashMap::new(); // 旧rid → (新rid, 部件路径)
            for a in &anchors {
                for (kind, rid) in rel_refs_in(a) {
                    if kind != "embed" || media_map.contains_key(&rid) {
                        continue;
                    }
                    let Some(t) = dw_rels.get(&rid) else {
                        notes.push(format!("表「{name}」的一张图片的引用断了，那张图没搬"));
                        continue;
                    };
                    let media = resolve_rel(&dw, t);
                    let ext = media
                        .rsplit('.')
                        .next()
                        .unwrap_or("")
                        .to_ascii_lowercase();
                    let Some(mime) = media_mime(&ext) else {
                        notes.push(format!(
                            "表「{name}」有一张 {media}，格式认不出，没搬"
                        ));
                        continue;
                    };
                    let Some(bytes) = read_entry_bytes(&mut orig, &media) else {
                        notes.push(format!(
                            "表「{name}」的一张图片（{media}）读不出来或指向外部，没搬"
                        ));
                        continue;
                    };
                    let new_media = format!("xl/media/image{}.{ext}", next_image);
                    next_image += 1;
                    upsert(&mut entries, new_media.clone(), bytes);
                    if !ct_defaults.iter().any(|(e, _)| *e == ext) {
                        ct_defaults.push((ext.clone(), mime));
                    }
                    let new_rid = free_rid(&dw_rels_raw, "rIdC", media_map.len() + 1);
                    media_map.insert(rid, (new_rid, new_media));
                }
            }
            if media_map.is_empty() {
                continue;
            }
            // 锚点重写：embed 换新号、cNvPr id 重排（并入 crate 的 drawing 后不许撞号）；
            // 带超链接等额外 rel 的锚整块放弃——搬一半比不搬更恶劣
            let mut blocks: Vec<String> = Vec::new();
            for a in &anchors {
                let foreign = rel_refs_in(a).iter().any(|(_, r)| !media_map.contains_key(r));
                if foreign {
                    notes.push(format!(
                        "表「{name}」有一张带超链接的图片，链接路本轮没搬，整张图放弃"
                    ));
                    continue;
                }
                let mut block = a.clone();
                for (old, (new, _)) in &media_map {
                    block =
                        block.replace(&format!("r:embed=\"{old}\""), &format!("r:embed=\"{new}\""));
                }
                blocks.push(renumber_cnvpr(&block, &mut cnvpr_next));
            }
            if blocks.is_empty() {
                continue;
            }
            // 落进产物：该表已有 drawing（crate 图表）就并进去，没有就新建一份
            let (drawing_part, is_new) = target_drawing(&mut entries, new_part, name)?;
            if is_new {
                ct_overrides.push((
                    drawing_part.clone(),
                    "application/vnd.openxmlformats-officedocument.drawing+xml",
                ));
            }
            // drawing 的 rels：新 rid → 搬来的媒体
            let dw_rels_part = rels_of(&drawing_part);
            let mut rels_xml = entries
                .iter()
                .find(|(n, _)| *n == dw_rels_part)
                .map(|(_, d)| String::from_utf8_lossy(d).into_owned())
                .unwrap_or_else(|| format!("<Relationships xmlns=\"{RELS_NS}\"></Relationships>"));
            for (new_rid, (_, media_path)) in &media_map {
                let rel = format!(
                    "<Relationship Id=\"{new_rid}\" Type=\"{REL_IMAGE}\" Target=\"{}\"/>",
                    &media_path
                );
                rels_xml.insert_str(
                    rels_xml.len().saturating_sub("</Relationships>".len()),
                    &rel,
                );
            }
            upsert(&mut entries, dw_rels_part, rels_xml.into_bytes());
            // 锚点并进 drawing 本体（顺带补根元素缺的命名空间，xdr/a/r 三样都得在）
            merge_into_drawing(&mut entries, &drawing_part, &blocks, &mut notes, name)?;
            carried_pics += blocks.len();
        }
    }

    // 原件有、新簿没有同名表的：说一句，用户才知道改名那张表的图和表格没跟过去
    let (carried_pivots, def_map) =
        carry_pivots(&mut orig, &mut entries, &orig_sheets, &new_by_name, sheet_names, &mut ct_overrides, &mut notes)?;
    let carried_slicers = carry_slicers(
        &mut orig,
        &mut entries,
        &orig_sheets,
        &new_by_name,
        sheet_names,
        &def_map,
        &table_map,
        &mut cnvpr_next,
        &mut ct_overrides,
        &mut notes,
    )?;
    // 页眉页脚图片（v0.110）：媒体编号与正文图片共用一条流水，不许撞号
    let carried_hf = carry_hf_pics(
        &mut orig,
        &mut entries,
        &orig_sheets,
        &new_by_name,
        sheet_names,
        &mut next_image,
        &mut ct_overrides,
        &mut ct_defaults,
        &mut notes,
    )?;
    // 查询连接 + 查询表（v0.112）：workbook.xml 线收口；连接 id 原样保留，queryTable 按它对账
    let (carried_conns, conn_map) =
        carry_connections(&mut orig, &mut entries, &def_map, &mut ct_overrides, &mut notes)?;
    let carried_qt = carry_query_tables(
        &mut orig,
        &mut entries,
        &orig_sheets,
        &new_by_name,
        sheet_names,
        &conn_map,
        &mut ct_overrides,
        &mut notes,
    )?;
    for (n, _) in &orig_sheets {
        if !sheet_names.iter().any(|s| s == n) {
            notes.push(format!("原件表「{n}」在新簿里没有同名表（改名或删除），它上面的表格与图片没有搬"));
        }
    }
    if carried_tables > 0
        || carried_pics > 0
        || carried_pivots > 0
        || carried_hf > 0
        || carried_conns > 0
        || carried_qt > 0
    {
        let mut head = String::from("保留式写回：");
        let mut sep = "";
        if carried_tables > 0 {
            head.push_str(&format!("表格部件 {carried_tables} 份"));
            sep = "、";
        }
        if carried_pics > 0 {
            head.push_str(&format!("{sep}图片 {carried_pics} 张"));
            sep = "、";
        }
        if carried_pivots > 0 {
            head.push_str(&format!("{sep}透视表 {carried_pivots} 块"));
            sep = "、";
        }
        if carried_slicers > 0 {
            head.push_str(&format!("{sep}切片器 {carried_slicers} 块"));
            sep = "、";
        }
        if carried_hf > 0 {
            head.push_str(&format!("{sep}页眉页脚图 {carried_hf} 张"));
            sep = "、";
        }
        if carried_conns > 0 {
            head.push_str(&format!("{sep}查询连接 {carried_conns} 份"));
            sep = "、";
        }
        if carried_qt > 0 {
            head.push_str(&format!("{sep}查询表 {carried_qt} 份"));
        }
        notes.push(head);
    }

    if !ct_overrides.is_empty() || !ct_defaults.is_empty() {
        patch_content_types(&mut entries, &ct_overrides, &ct_defaults)?;
    }
    Ok(CarryOutcome {
        bytes: write_zip(entries)?,
        notes,
    })
}

/// 透视表部件搬运（v0.105）：三层链，workbook.xml `<pivotCaches>`（簿级）→
/// pivotCacheDefinition（自身 rels 指向 records）→ 各表 rels 里的 pivotTable（自身 rels
/// 指回 definition）。sheet 部件本身**不需要**任何内联元素——透视表在 sheet 上只挂 rels。
/// 只搬被「同名表活下来」的 pivotTable 引用到的缓存：孤儿缓存不搬（改名/删表的透视整体
/// 随表消失，账走既有的「没有同名表」那一条）。cacheId 沿用原件的，新簿没有别的缓存不撞号。
/// 返回 (搬了几块, 原件缓存部件 → 产物缓存部件)——后者是切片器缓存改指数据源的依据（v0.109）
fn carry_pivots(
    orig: &mut zip::ZipArchive<std::fs::File>,
    entries: &mut Vec<(String, Vec<u8>)>,
    orig_sheets: &[(String, String)],
    new_by_name: &HashMap<&str, &str>,
    sheet_names: &[String],
    ct_overrides: &mut Vec<(String, &'static str)>,
    notes: &mut Vec<String>,
) -> Result<(usize, HashMap<String, String>), String> {
    struct PendingPivot {
        old_part: String,
        new_sheet: String,
        cache_def: String,
    }
    // 先收一遍：同名活表在原件里的 pivotTable 部件，各自引用的缓存定义部件
    let mut pending: Vec<PendingPivot> = Vec::new();
    for name in sheet_names {
        let Some(orig_part) = orig_sheets
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, p)| p.as_str())
        else {
            continue;
        };
        let Some(new_part) = new_by_name.get(name.as_str()).copied() else {
            continue;
        };
        let Some(rels_xml) = read_entry(orig, &rels_of(orig_part)) else {
            continue;
        };
        for target in rels_of_type(&rels_xml, REL_PIVOT_TABLE) {
            let old_part = resolve_rel(orig_part, &target);
            let cache_def = read_entry(orig, &rels_of(&old_part))
                .and_then(|r| rels_of_type(&r, REL_PIVOT_CACHE_DEF).into_iter().next())
                .map(|t| resolve_rel(&old_part, &t))
                .unwrap_or_default();
            pending.push(PendingPivot { old_part, new_sheet: new_part.to_string(), cache_def });
        }
    }
    if pending.is_empty() {
        return Ok((0, HashMap::new()));
    }

    // 缓存定义（连带 records）：被引用到的才搬；旧定义部件路径 → 新定义部件路径
    let mut def_map: HashMap<String, String> = HashMap::new();
    let mut next_def = next_free(entries, "xl/pivotCache/pivotCacheDefinition", ".xml");
    let mut next_rec = next_free(entries, "xl/pivotCache/pivotCacheRecords", ".xml");
    for p in &pending {
        if p.cache_def.is_empty() || def_map.contains_key(&p.cache_def) {
            continue;
        }
        let Some(def_bytes) = read_entry_bytes(orig, &p.cache_def) else {
            notes.push(format!("透视表缓存部件 {p} 读不出来，那块透视没搬", p = p.cache_def));
            continue;
        };
        let new_def = format!("xl/pivotCache/pivotCacheDefinition{next_def}.xml");
        next_def += 1;
        upsert(entries, new_def.clone(), def_bytes);
        ct_overrides.push((
            new_def.clone(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml",
        ));
        let def_rels = read_entry(orig, &rels_of(&p.cache_def));
        // records：definition 的 rels 里 /pivotCacheRecords 的那条；搬过去 Target 改指新名
        // （rId 本身不动——definition XML 里的 r:id 就还认得）
        if let Some(rels_xml) = &def_rels {
            if let Some(t) = rels_of_type(rels_xml, REL_PIVOT_CACHE_RECORDS).into_iter().next() {
                let old_recs = resolve_rel(&p.cache_def, &t);
                if let Some(rec_bytes) = read_entry_bytes(orig, &old_recs) {
                    let new_recs = format!("xl/pivotCache/pivotCacheRecords{next_rec}.xml");
                    next_rec += 1;
                    upsert(entries, new_recs.clone(), rec_bytes);
                    ct_overrides.push((
                        new_recs.clone(),
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml",
                    ));
                    let patched = retarget_rels(
                        rels_xml,
                        REL_PIVOT_CACHE_RECORDS,
                        &rel_target(&p.cache_def, &new_recs),
                    );
                    upsert(entries, rels_of(&new_def), patched.into_bytes());
                } else {
                    notes.push(format!("透视表缓存记录 {old_recs} 读不出来，缓存里没数据"));
                }
            }
        }
        def_map.insert(p.cache_def.clone(), new_def);
    }

    // 簿级接线：原件 workbook.xml 的 <pivotCache> 条目里，凡缓存被搬了的，在新 rels
    // 补关系、在 workbook.xml 补 <pivotCaches> 元素（cacheId 沿用原件）
    let mut wired: Vec<(String, String)> = Vec::new();
    if let Some(wb_xml) = read_entry(orig, "xl/workbook.xml") {
        let wb_rels = read_entry(orig, &rels_of("xl/workbook.xml"))
            .map(|x| parse_rels(&x))
            .unwrap_or_default();
        for (cid, rid) in pivot_caches_of(&wb_xml) {
            let Some(target) = wb_rels.get(&rid) else { continue };
            let def_part = resolve_rel("xl/workbook.xml", target);
            let Some(new_def) = def_map.get(&def_part) else { continue };
            let new_rid = add_sheet_rel(entries, "xl/workbook.xml", REL_PIVOT_CACHE_DEF, &rel_target("xl", new_def))?;
            wired.push((cid, new_rid));
        }
    }
    insert_pivot_caches(entries, &wired)?;

    // 表级：pivotTable 部件整份照搬 + 自身 rels 的 definition 引用改指新部件 + 表 rels 挂链
    let mut carried = 0usize;
    let mut next_tbl = next_free(entries, "xl/pivotTables/pivotTable", ".xml");
    for p in &pending {
        let Some(new_def) = def_map.get(&p.cache_def) else {
            notes.push("一块透视表的缓存没搬成，那块透视表也没搬".to_string());
            continue;
        };
        let Some(tbl_bytes) = read_entry_bytes(orig, &p.old_part) else {
            notes.push(format!("透视表部件 {} 读不出来，没搬", p.old_part));
            continue;
        };
        let new_tbl = format!("xl/pivotTables/pivotTable{next_tbl}.xml");
        next_tbl += 1;
        upsert(entries, new_tbl.clone(), tbl_bytes);
        ct_overrides.push((
            new_tbl.clone(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml",
        ));
        add_sheet_rel(entries, &p.new_sheet, REL_PIVOT_TABLE, &part_target(&new_tbl))?;
        if let Some(rels_xml) = read_entry(orig, &rels_of(&p.old_part)) {
            let patched = retarget_rels(rels_xml.as_str(), REL_PIVOT_CACHE_DEF, &rel_target(&p.old_part, new_def));
            upsert(entries, rels_of(&new_tbl), patched.into_bytes());
        }
        carried += 1;
    }
    Ok((carried, def_map))
}

/// 切片器部件搬运（v0.109）：两条链，都按「部件级照搬 + 关系改指新部件」办——
/// ① 缓存侧：workbook.xml 的 `<x14:slicerCaches>` → workbook rels → `xl/slicerCaches/slicerCacheN.xml`
///   （自身 rels 指回透视缓存/表格，改指搬过去的那个新部件）；
/// ② 形状侧：原件 drawing 里带 `slicer r:id` 的 `<xdr:graphicFrame>` → drawing rels →
///   `xl/slicers/slicerN.xml`，锚点块整份并进产物的 drawing（与 crate 图表、搬来的图片共存）。
/// 数据源没搬成的缓存不搬（切片器按 cache 名对账，跟着一起不搬），账要说得出。
fn carry_slicers(
    orig: &mut zip::ZipArchive<std::fs::File>,
    entries: &mut Vec<(String, Vec<u8>)>,
    orig_sheets: &[(String, String)],
    new_by_name: &HashMap<&str, &str>,
    sheet_names: &[String],
    def_map: &HashMap<String, String>,
    table_map: &HashMap<String, String>,
    cnvpr_next: &mut usize,
    ct_overrides: &mut Vec<(String, &'static str)>,
    notes: &mut Vec<String>,
) -> Result<usize, String> {
    // —— ① 缓存 ——
    let mut cache_names: Vec<String> = Vec::new(); // 搬成的缓存名（切片器按名对账）
    let mut wired_caches: Vec<String> = Vec::new(); // 产物里的缓存部件（簿级接线用）
    if let Some(wb_xml) = read_entry(orig, "xl/workbook.xml") {
        let wb_rels = read_entry(orig, &rels_of("xl/workbook.xml"))
            .map(|x| parse_rels(&x))
            .unwrap_or_default();
        let mut next_cache = next_free(entries, "xl/slicerCaches/slicerCache", ".xml");
        for rid in slicer_cache_rids(&wb_xml) {
            let Some(target) = wb_rels.get(&rid) else {
                notes.push("一份切片器缓存的关系断了，那块缓存没搬".to_string());
                continue;
            };
            let old_part = resolve_rel("xl/workbook.xml", target);
            let Some(bytes) = read_entry_bytes(orig, &old_part) else {
                notes.push(format!("切片器缓存部件 {old_part} 读不出来，没搬"));
                continue;
            };
            // 数据源：透视缓存/表格没搬成的，整块缓存不搬（切片器也就跟着不搬）
            let mut carry_it = true;
            let mut patched_rels: Option<String> = None;
            if let Some(rels_xml) = read_entry(orig, &rels_of(&old_part)) {
                let mut p = rels_xml.clone();
                for t in rels_of_type(&rels_xml, REL_PIVOT_CACHE_DEF) {
                    let old_def = resolve_rel(&old_part, &t);
                    match def_map.get(&old_def) {
                        Some(new_def) => {
                            p = retarget_rels(&p, REL_PIVOT_CACHE_DEF, &rel_target(&old_part, new_def))
                        }
                        None => {
                            carry_it = false;
                            notes.push(format!(
                                "切片器缓存 {old_part} 的透视缓存没搬成，这块缓存没搬"
                            ));
                        }
                    }
                }
                for t in rels_of_type(&rels_xml, REL_TABLE) {
                    let old_tbl = resolve_rel(&old_part, &t);
                    match table_map.get(&old_tbl) {
                        Some(new_tbl) => {
                            p = retarget_rels(&p, REL_TABLE, &rel_target(&old_part, new_tbl))
                        }
                        None => {
                            carry_it = false;
                            notes.push(format!("切片器缓存 {old_part} 的源表格没搬成，这块缓存没搬"));
                        }
                    }
                }
                if carry_it {
                    patched_rels = Some(p);
                }
            }
            if !carry_it {
                continue;
            }
            let new_part = format!("xl/slicerCaches/slicerCache{next_cache}.xml");
            next_cache += 1;
            let name = sheet_xml_attr(&String::from_utf8_lossy(&bytes), "name=\"");
            upsert(entries, new_part.clone(), bytes);
            ct_overrides.push((new_part.clone(), "application/vnd.ms-excel.slicerCache+xml"));
            if let Some(p) = patched_rels {
                upsert(entries, rels_of(&new_part), p.into_bytes());
            }
            if let Some(n) = name {
                cache_names.push(n);
            }
            wired_caches.push(new_part);
        }
    }

    // —— ② 切片器本体（drawing 里的 graphicFrame 锚点） ——
    let mut carried = 0usize;
    let mut next_slicer = next_free(entries, "xl/slicers/slicer", ".xml");
    for name in sheet_names {
        let Some(orig_part) = orig_sheets
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, p)| p.as_str())
        else {
            continue;
        };
        let Some(new_part) = new_by_name.get(name.as_str()).copied() else {
            continue;
        };
        let Some(rels_xml) = read_entry(orig, &rels_of(orig_part)) else {
            continue;
        };
        let mut blocks: Vec<String> = Vec::new();
        for target in rels_of_type(&rels_xml, REL_DRAWING) {
            let dw = resolve_rel(orig_part, &target);
            let Some(dw_xml) = read_entry(orig, &dw) else { continue };
            let dw_rels = parse_rels(&read_entry(orig, &rels_of(&dw)).unwrap_or_default());
            for block in slicer_frames(&dw_xml) {
                let Some(old_rid) = sheet_xml_attr(&block, "r:id=\"") else {
                    continue;
                };
                let Some(t) = dw_rels.get(&old_rid) else {
                    notes.push(format!("表「{name}」一个切片器的引用断了，那块切片器没搬"));
                    continue;
                };
                let old_slice = resolve_rel(&dw, t);
                let Some(bytes) = read_entry_bytes(orig, &old_slice) else {
                    notes.push(format!("切片器部件 {old_slice} 读不出来，没搬"));
                    continue;
                };
                // 按 cache 名对账：这块切片器认的缓存没搬成就不搬（搬一半比不搬更恶劣）
                let s_xml = String::from_utf8_lossy(&bytes);
                if let Some(c) = sheet_xml_attr(&s_xml, "cache=\"") {
                    if !cache_names.iter().any(|n| n == &c) {
                        notes.push(format!(
                            "表「{name}」一块切片器要的缓存「{c}」没搬成，那块切片器没搬"
                        ));
                        continue;
                    }
                }
                let new_slice = format!("xl/slicers/slicer{next_slicer}.xml");
                next_slicer += 1;
                upsert(entries, new_slice.clone(), bytes);
                ct_overrides.push((new_slice.clone(), "application/vnd.ms-excel.slicer+xml"));
                let (drawing_part, is_new) = target_drawing(entries, new_part, name)?;
                if is_new {
                    ct_overrides.push((
                        drawing_part.clone(),
                        "application/vnd.openxmlformats-officedocument.drawing+xml",
                    ));
                }
                let new_rid =
                    add_sheet_rel(entries, &drawing_part, REL_SLICER, &part_target(&new_slice))?;
                let mut block =
                    block.replace(&format!("r:id=\"{old_rid}\""), &format!("r:id=\"{new_rid}\""));
                block = renumber_cnvpr(&block, cnvpr_next);
                blocks.push(block);
            }
        }
        if blocks.is_empty() {
            continue;
        }
        let (drawing_part, _) = target_drawing(entries, new_part, name)?;
        merge_into_drawing(entries, &drawing_part, &blocks, notes, name)?;
        carried += blocks.len();
    }

    // —— 簿级接线：workbook.xml 补一枚 ext（x14:slicerCaches）——
    if !wired_caches.is_empty() {
        let mut rids = Vec::new();
        for part in &wired_caches {
            let rid = add_sheet_rel(
                entries,
                "xl/workbook.xml",
                REL_SLICER_CACHE,
                &rel_target("xl", part),
            )?;
            rids.push(rid);
        }
        insert_slicer_caches(entries, &rids)?;
    }
    Ok(carried)
}

/// 查询连接部件搬运（v0.112）：workbook.xml 的 `<connections>` 清单 → workbook rels →
/// `xl/connections/connectionN.xml`。连接的 `id` 一位不改——queryTable 与透视缓存定义里的
/// `connectionId` 是按它对账的，改号等于把查询接到别的线上。
/// 返回 (搬了几份, 旧 connection 部件 → 新部件)：后者是 queryTable 改指数据源的依据
fn carry_connections(
    orig: &mut zip::ZipArchive<std::fs::File>,
    entries: &mut Vec<(String, Vec<u8>)>,
    def_map: &HashMap<String, String>,
    ct_overrides: &mut Vec<(String, &'static str)>,
    notes: &mut Vec<String>,
) -> Result<(usize, HashMap<String, String>), String> {
    let Some(wb_xml) = read_entry(orig, "xl/workbook.xml") else {
        return Ok((0, HashMap::new()));
    };
    let Some(block) = connections_block(&wb_xml) else {
        return Ok((0, HashMap::new())); // 没有查询连接的簿，不动
    };
    let wb_rels = read_entry(orig, &rels_of("xl/workbook.xml"))
        .map(|x| parse_rels(&x))
        .unwrap_or_default();
    let mut conn_map: HashMap<String, String> = HashMap::new();
    let mut tags: Vec<String> = Vec::new(); // 换过 r:id 的 `<connection …/>`
    let mut next_conn = next_free(entries, "xl/connections/connection", ".xml");
    for tag in connection_tags(&block) {
        let Some(old_rid) = tag_attr(&tag, "r:id") else {
            notes.push("workbook.xml 里有一份查询连接没写 r:id，没搬".to_string());
            continue;
        };
        let Some(target) = wb_rels.get(&old_rid) else {
            notes.push(format!("查询连接的关系 {old_rid} 断了，那份连接没搬"));
            continue;
        };
        let old_part = resolve_rel("xl/workbook.xml", target);
        let Some(bytes) = read_entry_bytes(orig, &old_part) else {
            notes.push(format!("查询连接部件 {old_part} 读不出来，没搬"));
            continue;
        };
        let new_part = format!("xl/connections/connection{next_conn}.xml");
        next_conn += 1;
        upsert(entries, new_part.clone(), bytes);
        ct_overrides.push((new_part.clone(), CT_CONNECTION));
        // 连接自身的 rels：指回透视缓存的那条改指新部件（数据源没搬成就原样留着，说一句）
        if let Some(rels_xml) = read_entry(orig, &rels_of(&old_part)) {
            let mut p = rels_xml.clone();
            for t in rels_of_type(&rels_xml, REL_PIVOT_CACHE_DEF) {
                let old_def = resolve_rel(&old_part, &t);
                match def_map.get(&old_def) {
                    Some(new_def) => {
                        p = retarget_rels(&p, REL_PIVOT_CACHE_DEF, &rel_target(&old_part, new_def))
                    }
                    None => notes.push(format!(
                        "查询连接 {old_part} 的透视缓存没搬成，那条关系原样留着"
                    )),
                }
            }
            upsert(entries, rels_of(&new_part), p.into_bytes());
        }
        let new_rid =
            add_sheet_rel(entries, "xl/workbook.xml", REL_CONNECTION, &rel_target("xl", &new_part))?;
        conn_map.insert(old_part, new_part);
        tags.push(tag.replace(&format!("r:id=\"{old_rid}\""), &format!("r:id=\"{new_rid}\"")));
    }
    if tags.is_empty() {
        return Ok((0, conn_map));
    }
    insert_connections(entries, &tags)?;
    Ok((tags.len(), conn_map))
}

/// 查询表部件搬运（v0.112）：sheet rels 上的 `/queryTable` → `xl/queryTables/queryTableN.xml`，
/// 自身 rels 里的连接引用改指搬过去那份。sheet 部件**不需要**内联元素——queryTable 与
/// pivotTable 一样只挂在表 rels 上。它认的连接没搬成就不搬：接不上线的查询表比没有更糟
fn carry_query_tables(
    orig: &mut zip::ZipArchive<std::fs::File>,
    entries: &mut Vec<(String, Vec<u8>)>,
    orig_sheets: &[(String, String)],
    new_by_name: &HashMap<&str, &str>,
    sheet_names: &[String],
    conn_map: &HashMap<String, String>,
    ct_overrides: &mut Vec<(String, &'static str)>,
    notes: &mut Vec<String>,
) -> Result<usize, String> {
    let mut carried = 0usize;
    let mut next_qt = next_free(entries, "xl/queryTables/queryTable", ".xml");
    for name in sheet_names {
        let Some(orig_part) = orig_sheets
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, p)| p.as_str())
        else {
            continue;
        };
        let Some(new_part) = new_by_name.get(name.as_str()).copied() else {
            continue;
        };
        let Some(rels_xml) = read_entry(orig, &rels_of(orig_part)) else {
            continue;
        };
        for target in rels_of_type(&rels_xml, REL_QUERY_TABLE) {
            let old_part = resolve_rel(orig_part, &target);
            let Some(bytes) = read_entry_bytes(orig, &old_part) else {
                notes.push(format!("查询表部件 {old_part} 读不出来，没搬"));
                continue;
            };
            let mut patched: Option<String> = None;
            let mut ok = true;
            if let Some(q_rels) = read_entry(orig, &rels_of(&old_part)) {
                let mut p = q_rels.clone();
                for t in rels_of_type(&q_rels, REL_CONNECTION) {
                    let old_conn = resolve_rel(&old_part, &t);
                    match conn_map.get(&old_conn) {
                        Some(new_conn) => {
                            p = retarget_rels(&p, REL_CONNECTION, &rel_target(&old_part, new_conn))
                        }
                        None => {
                            ok = false;
                            notes.push(format!("查询表 {old_part} 的查询连接没搬成，没搬"));
                        }
                    }
                }
                if ok {
                    patched = Some(p);
                }
            }
            if !ok {
                continue;
            }
            let new_qt = format!("xl/queryTables/queryTable{next_qt}.xml");
            next_qt += 1;
            upsert(entries, new_qt.clone(), bytes);
            ct_overrides.push((new_qt.clone(), CT_QUERY_TABLE));
            if let Some(p) = patched {
                upsert(entries, rels_of(&new_qt), p.into_bytes());
            }
            add_sheet_rel(entries, new_part, REL_QUERY_TABLE, &part_target(&new_qt))?;
            carried += 1;
        }
    }
    Ok(carried)
}

/// 页眉页脚图片搬运（v0.110）：两条线，媒体都按旧 rId 对号搬到新部件再改指
///
/// ① `<picture r:id>`——Excel 把页眉图放进一份**独立** drawing，正文浮动图的搬运会
///    跳过它，正是这条线接手（整份照搬，内部不认识的字节一位不动）；
/// ② `<legacyDrawingHF r:id>`——老式 VML 页眉图：只挑带 `<v:imagedata>` 的 `<v:shape>`
///    并进产物已有的 vmlDrawing（crate 给批注写的那份），批注形状不惊动。
///
/// 页眉正文里的 `&G` 标记归 xlsx_print 那路保留式重写，这里只补图片本体
fn carry_hf_pics(
    orig: &mut zip::ZipArchive<std::fs::File>,
    entries: &mut Vec<(String, Vec<u8>)>,
    orig_sheets: &[(String, String)],
    new_by_name: &HashMap<&str, &str>,
    sheet_names: &[String],
    next_image: &mut usize,
    ct_overrides: &mut Vec<(String, &'static str)>,
    ct_defaults: &mut Vec<(String, &'static str)>,
    notes: &mut Vec<String>,
) -> Result<usize, String> {
    let mut carried = 0usize;
    for name in sheet_names {
        let Some(orig_part) = orig_sheets
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, p)| p.as_str())
        else {
            continue;
        };
        let Some(new_part) = new_by_name.get(name.as_str()).copied() else {
            continue;
        };
        let Some(orig_sheet_xml) = read_entry(orig, orig_part) else {
            continue;
        };
        let Some(orig_rels_xml) = read_entry(orig, &rels_of(orig_part)) else {
            continue;
        };
        let orig_rels = parse_rels(&orig_rels_xml);
        if let Some(rid) = sheet_xml_attr(&orig_sheet_xml, "<picture r:id=\"") {
            carried += carry_hf_picture(
                orig,
                entries,
                orig_part,
                new_part,
                name,
                &orig_rels,
                &rid,
                next_image,
                ct_overrides,
                ct_defaults,
                notes,
            )?;
        }
        if let Some(rid) = sheet_xml_attr(&orig_sheet_xml, "<legacyDrawingHF r:id=\"") {
            carried += carry_hf_vml(
                orig,
                entries,
                orig_part,
                new_part,
                name,
                &orig_rels,
                &rid,
                next_image,
                ct_defaults,
                notes,
            )?;
        }
    }
    Ok(carried)
}

/// ① `<picture r:id>` 那份 drawing 整份照搬，它的媒体逐个搬成新部件、rels 改指
fn carry_hf_picture(
    orig: &mut zip::ZipArchive<std::fs::File>,
    entries: &mut Vec<(String, Vec<u8>)>,
    orig_part: &str,
    new_part: &str,
    name: &str,
    rels: &HashMap<String, String>,
    rid: &str,
    next_image: &mut usize,
    ct_overrides: &mut Vec<(String, &'static str)>,
    ct_defaults: &mut Vec<(String, &'static str)>,
    notes: &mut Vec<String>,
) -> Result<usize, String> {
    let Some(t) = rels.get(rid) else {
        notes.push(format!("表「{name}」页眉页脚图片的引用断了，那张图没搬"));
        return Ok(0);
    };
    let dw = resolve_rel(orig_part, t);
    let Some(bytes) = read_entry_bytes(orig, &dw) else {
        notes.push(format!("表「{name}」的页眉页脚 drawing 部件 {dw} 读不出来，没搬"));
        return Ok(0);
    };
    // 新部件号逐号探测：产物由 crate 重建，drawing 号是连续的，探测最稳
    let mut n = next_free(entries, "xl/drawings/drawing", ".xml");
    let new_dw = loop {
        let p = format!("xl/drawings/drawing{n}.xml");
        if entry(entries, &p).is_none() {
            break p;
        }
        n += 1;
    };
    let dw_rels_raw = read_entry(orig, &rels_of(&dw)).unwrap_or_default();
    // 块内引用一位不动（rId 原样保留），只把 rels 的 Target 改指搬过去的媒体
    let mut moved = 0usize;
    let mut out_rels = format!("<Relationships xmlns=\"{RELS_NS}\">");
    for (old_rid, target) in rels_pairs_of_type(&dw_rels_raw, REL_IMAGE) {
        let media = resolve_rel(&dw, &target);
        let ext = media.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
        let Some(mime) = media_mime(&ext) else {
            notes.push(format!(
                "表「{name}」页眉页脚有一张 {media}，格式认不出，没搬"
            ));
            continue;
        };
        let Some(mb) = read_entry_bytes(orig, &media) else {
            notes.push(format!(
                "表「{name}」页眉页脚的一张图片（{media}）读不出来或指向外部，没搬"
            ));
            continue;
        };
        let new_media = format!("xl/media/image{}.{ext}", *next_image);
        *next_image += 1;
        upsert(entries, new_media.clone(), mb);
        if !ct_defaults.iter().any(|(e, _)| *e == ext) {
            ct_defaults.push((ext.clone(), mime));
        }
        out_rels.push_str(&format!(
            "<Relationship Id=\"{old_rid}\" Type=\"{REL_IMAGE}\" Target=\"{}\"/>",
            rel_target(&new_dw, &new_media)
        ));
        moved += 1;
    }
    if moved == 0 {
        return Ok(0);
    }
    out_rels.push_str("</Relationships>");
    upsert(entries, new_dw.clone(), bytes);
    upsert(entries, rels_of(&new_dw), out_rels.into_bytes());
    ct_overrides.push((
        new_dw.clone(),
        "application/vnd.openxmlformats-officedocument.drawing+xml",
    ));
    let new_rid = add_sheet_rel(entries, new_part, REL_DRAWING, &part_target(&new_dw))?;
    insert_sheet_el(
        entries,
        new_part,
        &format!("<picture r:id=\"{new_rid}\"/>"),
        &["<oleObjects", "<controls", "<tableParts", "<extLst", "</worksheet>"],
        name,
    )?;
    Ok(moved)
}

/// ② `<legacyDrawingHF r:id>` 那份 VML：只搬带 `<v:imagedata>` 的形状，
/// 并进产物已有的 vmlDrawing（批注那份），没有就新建
fn carry_hf_vml(
    orig: &mut zip::ZipArchive<std::fs::File>,
    entries: &mut Vec<(String, Vec<u8>)>,
    orig_part: &str,
    new_part: &str,
    name: &str,
    rels: &HashMap<String, String>,
    rid: &str,
    next_image: &mut usize,
    ct_defaults: &mut Vec<(String, &'static str)>,
    notes: &mut Vec<String>,
) -> Result<usize, String> {
    let Some(t) = rels.get(rid) else {
        notes.push(format!("表「{name}」页眉页脚 VML 的引用断了，那张图没搬"));
        return Ok(0);
    };
    let vml = resolve_rel(orig_part, t);
    let Some(vml_xml) = read_entry(orig, &vml) else {
        notes.push(format!("表「{name}」的页眉页脚 VML 部件 {vml} 读不出来，没搬"));
        return Ok(0);
    };
    let shapes = vml_pic_shapes(&vml_xml);
    if shapes.is_empty() {
        notes.push(format!(
            "表「{name}」的页眉页脚 VML 里没有图片形状，没搬"
        ));
        return Ok(0);
    }
    let vml_rels_raw = read_entry(orig, &rels_of(&vml)).unwrap_or_default();
    let (target_vml, is_new) = target_vml(entries, new_part, name)?;
    if is_new {
        ct_defaults.push(("vml".to_string(), VML_CT));
    }
    let rels_part = rels_of(&target_vml);
    let mut rels_xml = entry_str(entries, &rels_part).unwrap_or_else(|| {
        format!("<Relationships xmlns=\"{RELS_NS}\"></Relationships>")
    });
    let mut moved = 0usize;
    let mut blocks: Vec<String> = Vec::new();
    for sh in shapes {
        let mut block = sh;
        let mut wired = false;
        for (old_rid, target) in rels_pairs_of_type(&vml_rels_raw, REL_IMAGE) {
            if !block.contains(&format!("r:id=\"{old_rid}\"")) {
                continue;
            }
            let media = resolve_rel(&vml, &target);
            let ext = media.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
            let Some(mime) = media_mime(&ext) else {
                notes.push(format!("表「{name}」页眉页脚有一张 {media}，格式认不出，没搬"));
                continue;
            };
            let Some(mb) = read_entry_bytes(orig, &media) else {
                notes.push(format!(
                    "表「{name}」页眉页脚的一张图片（{media}）读不出来或指向外部，没搬"
                ));
                continue;
            };
            let new_media = format!("xl/media/image{}.{ext}", *next_image);
            *next_image += 1;
            upsert(entries, new_media.clone(), mb);
            if !ct_defaults.iter().any(|(e, _)| *e == ext) {
                ct_defaults.push((ext.clone(), mime));
            }
            let new_rid = free_rid(&rels_xml, "rIdV", moved + 1);
            rels_xml.insert_str(
                rels_xml.len().saturating_sub("</Relationships>".len()),
                &format!(
                    "<Relationship Id=\"{new_rid}\" Type=\"{REL_IMAGE}\" Target=\"{}\"/>",
                    rel_target(&target_vml, &new_media)
                ),
            );
            block = block.replace(
                &format!("r:id=\"{old_rid}\""),
                &format!("r:id=\"{new_rid}\""),
            );
            moved += 1;
            wired = true;
        }
        if wired {
            blocks.push(block);
        }
    }
    if blocks.is_empty() {
        return Ok(0);
    }
    upsert(entries, rels_part, rels_xml.into_bytes());
    merge_into_vml(entries, &target_vml, &blocks, notes, name)?;
    // sheet 上插 `<legacyDrawingHF>`：与 `<legacyDrawing>`（批注）可以指同一份部件，
    // 这正是 Excel 亲笔的写法——两个元素、一份 VML
    let new_rid = add_sheet_rel(
        entries,
        new_part,
        REL_VML_DRAWING,
        &rel_target(new_part, &target_vml),
    )?;
    insert_sheet_el(
        entries,
        new_part,
        &format!("<legacyDrawingHF r:id=\"{new_rid}\"/>"),
        &["<picture ", "<oleObjects", "<controls", "<tableParts", "<extLst", "</worksheet>"],
        name,
    )?;
    Ok(moved)
}

/// VML 里带 `<v:imagedata>` 的 `<v:shape>` 块——页眉页脚图片的地盘；
/// 批注形状（`#_x0000_t202`）没有 imagedata，自然不在其中。
/// `<v:shapetype` 也以 `<v:shape` 开头，靠标签名后的分隔符区分
fn vml_pic_shapes(xml: &str) -> Vec<String> {
    const OPEN: &str = "<v:shape";
    const CLOSE: &str = "</v:shape>";
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(i) = rest.find(OPEN) {
        let after = &rest[i + OPEN.len()..];
        if !after.starts_with(' ') && !after.starts_with('>') {
            rest = &rest[i + OPEN.len()..];
            continue;
        }
        let Some(len) = rest[i..].find(CLOSE) else { break };
        let end = i + len + CLOSE.len();
        let block = &rest[i..end];
        if block.contains("<v:imagedata") {
            out.push(block.to_string());
        }
        rest = &rest[end..];
    }
    out
}

/// 产物里该表要并进的那份 vmlDrawing：已有（crate 给批注写的）就用它，没有就新建一份
fn target_vml(
    entries: &mut Vec<(String, Vec<u8>)>,
    sheet_part: &str,
    sheet_name: &str,
) -> Result<(String, bool), String> {
    let sheet_xml = entry_str(entries, sheet_part)
        .ok_or_else(|| format!("表「{sheet_name}」的部件在产物里读不到"))?;
    if let Some(rid) = sheet_xml_attr(&sheet_xml, "<legacyDrawing r:id=\"") {
        if let Some(rels) = entry_str(entries, &rels_of(sheet_part)) {
            let map = parse_rels(&rels);
            if let Some(t) = map.get(&rid) {
                let part = resolve_rel(sheet_part, t);
                if entry(entries, &part).is_some() {
                    return Ok((part, false));
                }
            }
        }
    }
    let mut n = next_free(entries, "xl/drawings/vmlDrawing", ".vml");
    let part = loop {
        let p = format!("xl/drawings/vmlDrawing{n}.vml");
        if entry(entries, &p).is_none() {
            break p;
        }
        n += 1;
    };
    let vml = "<xml xmlns:v=\"urn:schemas-microsoft-com:vml\" xmlns:o=\"urn:schemas-microsoft-com:office:office\" xmlns:x=\"urn:schemas-microsoft-com:office:excel\"></xml>";
    upsert(entries, part.clone(), vml.as_bytes().to_vec());
    Ok((part, true))
}

/// 形状块并进 vmlDrawing：根元素缺命名空间就补（搬来的形状可能用到 v/o/x/r 四个前缀），
/// 块插在 `</xml>` 之前
fn merge_into_vml(
    entries: &mut Vec<(String, Vec<u8>)>,
    vml_part: &str,
    blocks: &[String],
    notes: &mut Vec<String>,
    sheet_name: &str,
) -> Result<(), String> {
    let xml = entry_str(entries, vml_part)
        .ok_or_else(|| format!("表「{sheet_name}」的 vmlDrawing 部件读不到"))?;
    let Some(rs) = xml.find("<xml") else {
        notes.push(format!("表「{sheet_name}」的 vmlDrawing 形状不对，页眉页脚图没搬"));
        return Ok(());
    };
    let head = rs
        + xml[rs..]
            .find('>')
            .ok_or_else(|| format!("表「{sheet_name}」的 vmlDrawing 不是合法 XML"))?
        + 1;
    let mut root = xml[rs..head].to_string();
    for (pfx, uri) in [
        ("xmlns:v", "urn:schemas-microsoft-com:vml"),
        ("xmlns:o", "urn:schemas-microsoft-com:office:office"),
        ("xmlns:x", "urn:schemas-microsoft-com:office:excel"),
        (
            "xmlns:r",
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        ),
    ] {
        if !root.contains(pfx) {
            root = root.replace('>', &format!(" {pfx}=\"{uri}\">"));
        }
    }
    let Some(close) = xml.rfind("</xml>") else {
        notes.push(format!("表「{sheet_name}」的 vmlDrawing 形状不对，页眉页脚图没搬"));
        return Ok(());
    };
    let mut out = String::with_capacity(xml.len() + blocks.iter().map(|b| b.len()).sum::<usize>());
    out.push_str(&xml[..rs]); // 文件声明（若有）原样带头
    out.push_str(&root);
    out.push_str(&xml[head..close]);
    for b in blocks {
        out.push_str(b);
    }
    out.push_str(&xml[close..]);
    upsert(entries, vml_part.to_string(), out.into_bytes());
    Ok(())
}

/// rels XML 里指定 Type 的关系：(Id, Target)。改写 Target 时要知道是哪一个 rId
fn rels_pairs_of_type(rels_xml: &str, rel_type: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut rest = rels_xml;
    while let Some(i) = rest.find("<Relationship ") {
        let Some(end) = rest[i..].find("/>") else { break };
        let tag = &rest[i..i + end];
        if tag.contains(&format!("Type=\"{rel_type}\"")) {
            if let (Some(id), Some(t)) = (tag_attr(tag, "Id"), tag_attr(tag, "Target")) {
                out.push((id, t));
            }
        }
        rest = &rest[i + end + 2..];
    }
    out
}

/// workbook.xml 里 `<x14:slicerCaches>` 下的 `<x14:slicerCache r:id="…"/>` 清单；
/// 退化情形（元素自身带 r:id）也认，认不出就当没有切片器
fn slicer_cache_rids(wb_xml: &str) -> Vec<String> {
    let mut out = Vec::new();
    for marker in ["<x14:slicerCache ", "<x14:slicerCaches "] {
        let mut rest = wb_xml;
        while let Some(i) = rest.find(marker) {
            let end = rest[i..].find("/>").unwrap_or(rest.len() - i);
            if let Some(r) = tag_attr(&rest[i..i + end], "r:id") {
                out.push(r);
            }
            rest = &rest[i + end + 2..];
        }
        if !out.is_empty() {
            break; // 子项形式优先；没子项才认退化形式
        }
    }
    out
}

/// drawing 里带切片器的 `<xdr:graphicFrame>` 整块（锚点不嵌套，取到闭合标签为止）；
/// 认的是 graphicData 的 uri（…/2010/slicer），timeline 是另一枚 uri 不会误收
fn slicer_frames(dw_xml: &str) -> Vec<String> {
    let open = "<xdr:graphicFrame";
    let close = "</xdr:graphicFrame>";
    let mut out = Vec::new();
    let mut rest = dw_xml;
    while let Some(i) = rest.find(open) {
        let Some(len) = rest[i..].find(close) else { break };
        let block = &rest[i..i + len + close.len()];
        if block.contains("slicer") && block.contains("r:id=\"") {
            out.push(block.to_string());
        }
        rest = &rest[i + len + close.len()..];
    }
    out
}

/// `<extLst>` 里补一枚切片器缓存的 ext（CT_Workbook 里 extLst 是最后一节）；
/// 产物里已有 extLst 就往里并，没有就整节新建——x14 的命名空间与 uri 照 Excel 亲笔写
fn insert_slicer_caches(
    entries: &mut Vec<(String, Vec<u8>)>,
    rids: &[String],
) -> Result<(), String> {
    if rids.is_empty() {
        return Ok(());
    }
    let xml = entry_str(entries, "xl/workbook.xml").ok_or("产物的 workbook.xml 读不到")?;
    if xml.contains("<x14:slicerCaches") || xml.contains("<x14:slicerCache ") {
        return Ok(()); // 已有就保守不重复插
    }
    let inner: String = rids
        .iter()
        .map(|r| format!("<x14:slicerCache r:id=\"{r}\"/>"))
        .collect();
    let caches = format!("<x14:slicerCaches>{inner}</x14:slicerCaches>");
    let out = if let Some(i) = xml.find("<extLst") {
        let ext = format!("<ext xmlns:x14=\"{X14_NS}\" uri=\"{SLICER_EXT_URI}\">{caches}</ext>");
        match xml[i..].find("</extLst>") {
            Some(c) => format!("{}{}{}", &xml[..i + c], ext, &xml[i + c..]),
            None => return Err("workbook.xml 的 extLst 没闭合".into()),
        }
    } else {
        let el = format!(
            "<extLst><ext xmlns:x14=\"{X14_NS}\" uri=\"{SLICER_EXT_URI}\">{caches}</ext></extLst>"
        );
        let at = xml
            .rfind("</workbook>")
            .ok_or("workbook.xml 没有闭合标签")?;
        format!("{}{}{}", &xml[..at], el, &xml[at..])
    };
    upsert(entries, "xl/workbook.xml".to_string(), out.into_bytes());
    Ok(())
}

/// rels XML 里指定 Type 的关系，Target 全部改写成 new_target（rId 不动，引用方 XML 无感）
fn retarget_rels(rels_xml: &str, rel_type: &str, new_target: &str) -> String {
    let mut out = String::with_capacity(rels_xml.len() + 32);
    let mut rest = rels_xml;
    while let Some(i) = rest.find("<Relationship ") {
        let Some(end) = rest[i..].find("/>") else {
            out.push_str(rest);
            rest = "";
            break;
        };
        let tag = &rest[i..i + end + 2];
        if tag.contains(&format!("Type=\"{rel_type}\"")) {
            let patched = match tag.find("Target=\"") {
                Some(j) => {
                    let head = &tag[..j + "Target=\"".len()];
                    let t = &tag[j + "Target=\"".len()..];
                    let k = t.find('"').unwrap_or(0);
                    format!("{head}{new_target}{}", &t[k..])
                }
                None => tag.to_string(),
            };
            out.push_str(&rest[..i]);
            out.push_str(&patched);
        } else {
            out.push_str(tag);
        }
        rest = &rest[i + end + 2..];
    }
    out.push_str(rest);
    out
}

/// rels 的 Target 相对写法：从「拥有这份 rels 的部件」的目录走到 to_part。
/// workbook 的 rels 基准是 xl/（如 `pivotCache/…`）；同目录裸文件名；其余 `../` 一跳
fn rel_target(owner_part: &str, to_part: &str) -> String {
    let to = to_part.strip_prefix("xl/").unwrap_or(to_part);
    let owner_dir = &owner_part[..owner_part.rfind('/').unwrap_or(owner_part.len())];
    if owner_dir == "xl" {
        return to.to_string();
    }
    let owner_sub = owner_dir.strip_prefix("xl/").unwrap_or(owner_dir);
    let to_sub = &to[..to.rfind('/').unwrap_or(0)];
    if to_sub == owner_sub {
        to[to.rfind('/').map(|i| i + 1).unwrap_or(0)..].to_string()
    } else {
        format!("../{to}")
    }
}

/// 原件 workbook.xml 里 `<pivotCache cacheId="1" r:id="rId4"/>` 清单
fn pivot_caches_of(wb_xml: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut rest = wb_xml;
    while let Some(i) = rest.find("<pivotCache ") {
        let Some(end) = rest[i..].find("/>") else { break };
        let tag = &rest[i..i + end];
        if let (Some(c), Some(r)) = (tag_attr(tag, "cacheId"), tag_attr(tag, "r:id")) {
            out.push((c, r));
        }
        rest = &rest[i + end..];
    }
    out
}

fn tag_attr(tag: &str, name: &str) -> Option<String> {
    let marker = format!("{name}=\"");
    let i = tag.find(&marker)? + marker.len();
    let t = &tag[i..];
    let j = t.find('"')?;
    Some(t[..j].to_string())
}

/// `<pivotCaches>` 插进 workbook.xml：CT_Workbook 序里它排在 oleSize/customWorkbookViews
/// 之后、smartTagPr 之前——crate 产物写到 calcPr/definedNames 为止，贴 `</workbook>` 即合规
fn insert_pivot_caches(
    entries: &mut Vec<(String, Vec<u8>)>,
    items: &[(String, String)],
) -> Result<(), String> {
    if items.is_empty() {
        return Ok(());
    }
    let xml = entry_str(entries, "xl/workbook.xml").ok_or("产物的 workbook.xml 读不到")?;
    if xml.contains("<pivotCaches") {
        return Ok(()); // crate 写不出这元素；真在就保守不重复插
    }
    let inner: String = items
        .iter()
        .map(|(c, r)| format!("<pivotCache cacheId=\"{c}\" r:id=\"{r}\"/>"))
        .collect();
    let el = format!("<pivotCaches>{inner}</pivotCaches>");
    let at = [
        "<smartTagPr",
        "<smartTagTypes",
        "<webPublishing",
        "<fileRecoveryPr",
        "<webPublishObjects",
        "<extLst",
        "</workbook>",
    ]
    .iter()
    .find_map(|m| xml.find(m))
    .ok_or("workbook.xml 没有闭合标签")?;
    upsert(
        entries,
        "xl/workbook.xml".to_string(),
        format!("{}{}{}", &xml[..at], el, &xml[at..]).into_bytes(),
    );
    Ok(())
}

/// workbook.xml 里 `<connections>…</connections>` 的内容（MS 扩展元素，ECMA-376 没有它）
fn connections_block(wb_xml: &str) -> Option<String> {
    let i = wb_xml.find("<connections")?;
    let gt = wb_xml[i..].find('>')? + i + 1;
    let end = wb_xml[gt..].find("</connections>")? + gt;
    Some(wb_xml[gt..end].to_string())
}

/// `<connections>` 里的自闭合 `<connection …/>` 标签（带子元素的那种不认，宁可不搬）
fn connection_tags(block: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = block;
    while let Some(i) = rest.find("<connection ") {
        let Some(end) = rest[i..].find("/>") else { break };
        out.push(rest[i..i + end + 2].to_string());
        rest = &rest[i + end + 2..];
    }
    out
}

/// `<connections>` 插进 workbook.xml：CT_Workbook 序里它跟在 pivotCaches 之后、
/// smartTag/extLst 之前——与 insert_pivot_caches 同一组锚点，先插的先占位
fn insert_connections(
    entries: &mut Vec<(String, Vec<u8>)>,
    tags: &[String],
) -> Result<(), String> {
    if tags.is_empty() {
        return Ok(());
    }
    let xml = entry_str(entries, "xl/workbook.xml").ok_or("产物的 workbook.xml 读不到")?;
    if xml.contains("<connections") {
        return Ok(()); // 保守：已有就不重复插
    }
    let el = format!("<connections>{}</connections>", tags.concat());
    let at = [
        "<smartTagPr",
        "<smartTagTypes",
        "<webPublishing",
        "<fileRecoveryPr",
        "<webPublishObjects",
        "<extLst",
        "</workbook>",
    ]
    .iter()
    .find_map(|m| xml.find(m))
    .ok_or("workbook.xml 没有闭合标签")?;
    upsert(
        entries,
        "xl/workbook.xml".to_string(),
        format!("{}{}{}", &xml[..at], el, &xml[at..]).into_bytes(),
    );
    Ok(())
}

/// 新包里挑 drawing 的落点：该表已有 crate 的 drawing 就并进去（返回 is_new=false），
/// 没有就新建 drawingN 并把 `<drawing r:id>` 插进 sheet 部件
fn target_drawing(
    entries: &mut Vec<(String, Vec<u8>)>,
    sheet_part: &str,
    sheet_name: &str,
) -> Result<(String, bool), String> {
    let sheet_xml = entry_str(entries, sheet_part)
        .ok_or_else(|| format!("表「{sheet_name}」的部件在产物里读不到"))?;
    if let Some(rid) = sheet_xml_attr(&sheet_xml, "<drawing r:id=\"") {
        // 顺这条 rel 找到 crate 写的那份 drawing，往里并
        if let Some(rels) = entry_str(entries, &rels_of(sheet_part)) {
            let map = parse_rels(&rels);
            if let Some(t) = map.get(&rid) {
                let part = resolve_rel(sheet_part, t);
                if entry(entries, &part).is_some() {
                    return Ok((part, false));
                }
            }
        }
        return Err(format!("表「{sheet_name}」的 drawing 引用断了，图片没搬"));
    }
    // 新建：下一个空号。部件编号从 1 起，探测到第一个缺号即用（产物由 crate 新建，号是连续的）
    let mut n = 1usize;
    loop {
        let part = format!("xl/drawings/drawing{n}.xml");
        if entry(entries, &part).is_none() {
            let drawing = format!(
                "<xdr:wsDr xmlns:xdr=\"http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"></xdr:wsDr>"
            );
            upsert(entries, part.clone(), drawing.into_bytes());
            let rid = add_sheet_rel(entries, sheet_part, REL_DRAWING, &part_target(&part))?;
            insert_drawing_ref(entries, sheet_part, &rid, sheet_name)?;
            return Ok((part, true));
        }
        n += 1;
    }
}

/// 锚点块并进 drawing 部件：根元素缺命名空间就补，块插在闭合标签前。
/// 根标签的定位从 `<xdr:wsDr` 起找——`<?xml …?>` 声明里也有 `>`，不能拿文件头当根
fn merge_into_drawing(
    entries: &mut Vec<(String, Vec<u8>)>,
    drawing_part: &str,
    blocks: &[String],
    notes: &mut Vec<String>,
    sheet_name: &str,
) -> Result<(), String> {
    let xml = entry_str(entries, drawing_part)
        .ok_or_else(|| format!("表「{sheet_name}」的 drawing 部件读不到"))?;
    let Some(rs) = xml.find("<xdr:wsDr") else {
        notes.push(format!("表「{sheet_name}」的 drawing 形状不对，图片没搬"));
        return Ok(());
    };
    let head = rs
        + xml[rs..]
            .find('>')
            .ok_or_else(|| format!("表「{sheet_name}」的 drawing 不是合法 XML"))?
        + 1;
    let mut root = xml[rs..head].to_string();
    for (pfx, uri) in [
        (
            "xmlns:xdr",
            "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
        ),
        (
            "xmlns:a",
            "http://schemas.openxmlformats.org/drawingml/2006/main",
        ),
        (
            "xmlns:r",
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        ),
    ] {
        if !root.contains(pfx) {
            root = root.replace('>', &format!(" {pfx}=\"{uri}\">"));
        }
    }
    let body = &xml[head..];
    let Some(close) = body.rfind("</xdr:wsDr>") else {
        notes.push(format!("表「{sheet_name}」的 drawing 形状不对，图片没搬"));
        return Ok(());
    };
    let mut out =
        String::with_capacity(xml.len() + blocks.iter().map(|b| b.len()).sum::<usize>());
    out.push_str(&xml[..rs]); // 文件声明（若有）原样带头
    out.push_str(&root);
    out.push_str(&body[..close]);
    for b in blocks {
        out.push_str(b);
    }
    out.push_str(&body[close..]);
    upsert(entries, drawing_part.to_string(), out.into_bytes());
    Ok(())
}

/// 一个自闭合元素插进 sheet 部件：按 CT_Worksheet 的schema 序，落在 anchors 里
/// 最先出现的那个之前——一个都没有就贴着 `</worksheet>`（drawing/页眉页脚引用都走它）
fn insert_sheet_el(
    entries: &mut Vec<(String, Vec<u8>)>,
    sheet_part: &str,
    el: &str,
    anchors: &[&str],
    sheet_name: &str,
) -> Result<(), String> {
    let xml = entry_str(entries, sheet_part)
        .ok_or_else(|| format!("表「{sheet_name}」的部件在产物里读不到"))?;
    let at = anchors
        .iter()
        .find_map(|m| xml.find(m))
        .ok_or_else(|| format!("表「{sheet_name}」的 sheet 部件没有闭合标签"))?;
    let mut out = String::with_capacity(xml.len() + el.len());
    out.push_str(&xml[..at]);
    out.push_str(el);
    out.push_str(&xml[at..]);
    upsert(entries, sheet_part.to_string(), out.into_bytes());
    Ok(())
}

/// `<drawing r:id="rIdX"/>` 插进 sheet 部件：按 CT_Worksheet 的顺序，落在
/// legacyDrawing/picture/tableParts/extLst 之前——都没有就贴着 `</worksheet>`
fn insert_drawing_ref(
    entries: &mut Vec<(String, Vec<u8>)>,
    sheet_part: &str,
    rid: &str,
    sheet_name: &str,
) -> Result<(), String> {
    insert_sheet_el(
        entries,
        sheet_part,
        &format!("<drawing r:id=\"{rid}\"/>"),
        &[
            "<legacyDrawing",
            "<picture ",
            "<oleObjects",
            "<controls",
            "<tableParts",
            "<extLst",
            "</worksheet>",
        ],
        sheet_name,
    )
}

/// `<tableParts>` 落进 sheet 部件（顺序：extLst 之前，紧贴 `</worksheet>` 也合规）；
/// 已有 tableParts（理论不会，crate 写不出表格）就往里追加
fn attach_table_part(
    entries: &mut Vec<(String, Vec<u8>)>,
    sheet_part: &str,
    rid: &str,
    sheet_name: &str,
    notes: &mut Vec<String>,
) -> Result<(), String> {
    let xml = entry_str(entries, sheet_part)
        .ok_or_else(|| format!("表「{sheet_name}」的部件在产物里读不到"))?;
    let el = format!("<tablePart r:id=\"{rid}\"/>");
    let out = if let Some(i) = xml.find("<tableParts") {
        let Some(close) = xml[i..].find("</tableParts>") else {
            notes.push(format!("表「{sheet_name}」的 tableParts 形状不对，表格没搬"));
            return Ok(());
        };
        let at = i + close;
        format!("{}{}{}", &xml[..at], el, &xml[at..])
    } else {
        let head = format!("<tableParts count=\"1\">{el}</tableParts>");
        let at = ["<extLst", "</worksheet>"]
            .iter()
            .find_map(|m| xml.find(m))
            .ok_or_else(|| format!("表「{sheet_name}」的 sheet 部件没有闭合标签"))?;
        format!("{}{}{}", &xml[..at], head, &xml[at..])
    };
    upsert(entries, sheet_part.to_string(), out.into_bytes());
    Ok(())
}

/// sheet 的 rels：追加一条 Relationship（rels 部件没有就建），返回新 rId
fn add_sheet_rel(
    entries: &mut Vec<(String, Vec<u8>)>,
    sheet_part: &str,
    rel_type: &str,
    target: &str,
) -> Result<String, String> {
    let rels_part = rels_of(sheet_part);
    let (xml, base) = match entry_str(entries, &rels_part) {
        Some(x) => {
            let base = max_rid(&x);
            (x, base)
        }
        None => (format!("<Relationships xmlns=\"{RELS_NS}\"></Relationships>"), 0),
    };
    let rid = free_rid(&xml, "rIdP", base + 1);
    let rel = format!("<Relationship Id=\"{rid}\" Type=\"{rel_type}\" Target=\"{target}\"/>");
    let mut out = xml;
    out.insert_str(out.len().saturating_sub("</Relationships>".len()), &rel);
    upsert(entries, rels_part, out.into_bytes());
    Ok(rid)
}

/// 表格/图片搬过来时给 sheet rels 的 Target：按相对路径写（`../tables/table1.xml`）
fn part_target(part: &str) -> String {
    format!("../{}", &part["xl/".len()..])
}

fn rels_of_type(rels_xml: &str, rel_type: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = rels_xml;
    while let Some(i) = rest.find("<Relationship ") {
        let Some(end) = rest[i..].find("/>") else { break };
        let tag = &rest[i..i + end];
        if tag.contains(&format!("Type=\"{rel_type}\"")) {
            if let Some(j) = tag.find("Target=\"") {
                let t = &tag[j + "Target=\"".len()..];
                if let Some(k) = t.find('"') {
                    out.push(t[..k].to_string());
                }
            }
        }
        rest = &rest[i + end..];
    }
    out
}

/// sheet XML 里 `<drawing r:id="rId3"/>` 这类自闭合元素的 rId
fn sheet_xml_attr(xml: &str, marker: &str) -> Option<String> {
    let i = xml.find(marker)? + marker.len();
    let rest = &xml[i..];
    let j = rest.find('"')?;
    Some(rest[..j].to_string())
}

/// 原件 drawing 里的 pic 锚点块：oneCell/twoCell/absolute 三种包裹各扫一遍（锚点不嵌套）
fn pic_anchors(dw_xml: &str) -> Vec<String> {
    let mut out = Vec::new();
    for tag in ["oneCellAnchor", "twoCellAnchor", "absoluteAnchor"] {
        let open = format!("<xdr:{tag}");
        let close = format!("</xdr:{tag}>");
        let mut rest = dw_xml;
        while let Some(i) = rest.find(&open) {
            let Some(len) = rest[i..].find(&close) else { break };
            let block = &rest[i..i + len + close.len()];
            if block.contains("<xdr:pic") {
                out.push(block.to_string());
            }
            rest = &rest[i + len + close.len()..];
        }
    }
    out
}

/// 锚点里的 rel 引用：(种类, rId)。种类：embed（blip 内嵌图）/ link（外链）/ id（其余，如超链接）
fn rel_refs_in(xml: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for (kind, marker) in [("embed", "r:embed=\""), ("link", "r:link=\""), ("id", "r:id=\"")] {
        let mut rest = xml;
        while let Some(i) = rest.find(marker) {
            let t = &rest[i + marker.len()..];
            if let Some(j) = t.find('"') {
                out.push((kind.to_string(), t[..j].to_string()));
            }
            rest = &rest[i + marker.len()..];
        }
    }
    out
}

/// 重排锚点里的 cNvPr id（从 *next 起递增、推进游标）——并入 crate 的 drawing 后不许撞号
fn renumber_cnvpr(block: &str, next: &mut usize) -> String {
    let mut out = String::with_capacity(block.len());
    let mut rest = block;
    while let Some(i) = rest.find("<xdr:cNvPr id=\"") {
        let at = i + "<xdr:cNvPr id=\"".len();
        let Some(j) = rest[at..].find('"') else { break };
        out.push_str(&rest[..at]);
        out.push_str(&next.to_string());
        *next += 1;
        rest = &rest[at + j..];
    }
    out.push_str(rest);
    out
}

/// rels XML 里已有 rId 的最大编号（新建的不许撞）。
/// 号可能是 `rId7` 也可能是我们自己造的 `rIdP7`/`rIdC7`——v0.109 的实测：只认 `rId<数字>`
/// 时 `rIdP1` 数不进去，透视表搬运就把图片搬运刚建的 drawing 关系抢成了同名，
/// `<drawing r:id>` 于是解析到 pivotTable 部件上。所以字母前缀一律跳过再取数字
fn max_rid(rels_xml: &str) -> usize {
    let mut max = 0;
    let mut rest = rels_xml;
    while let Some(i) = rest.find("Id=\"rId") {
        let at = i + "Id=\"rId".len();
        let tail = &rest[at..];
        let skip = tail.chars().take_while(|c| !c.is_ascii_digit()).count();
        let digits: String = tail[skip..].chars().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(n) = digits.parse::<usize>() {
            max = max.max(n);
        }
        rest = &rest[at..];
    }
    max
}

/// 取一枚这串 rels 里**确实没被占**的 rId：`{prefix}{n}`，n 从 start 起遇撞号就往后让
fn free_rid(rels_xml: &str, prefix: &str, start: usize) -> String {
    let mut n = start.max(1);
    loop {
        let rid = format!("{prefix}{n}");
        if !rels_xml.contains(&format!("Id=\"{rid}\"")) {
            return rid;
        }
        n += 1;
    }
}

fn next_free(entries: &[(String, Vec<u8>)], prefix: &str, suffix: &str) -> usize {
    entries
        .iter()
        .filter_map(|(n, _)| n.strip_prefix(prefix))
        .filter_map(|r| r.strip_suffix(suffix))
        .filter_map(|r| r.split('.').next()) // 媒体还有 .png 这截
        .filter_map(|r| r.parse::<usize>().ok())
        .max()
        .unwrap_or(0)
        + 1
}

fn entry<'a>(entries: &'a [(String, Vec<u8>)], name: &str) -> Option<&'a Vec<u8>> {
    entries.iter().find(|(n, _)| n == name).map(|(_, d)| d)
}

fn entry_str(entries: &[(String, Vec<u8>)], name: &str) -> Option<String> {
    entry(entries, name).map(|d| String::from_utf8_lossy(d).into_owned())
}

/// 替换或追加条目（保持原序，新条目排在最后）
fn upsert(entries: &mut Vec<(String, Vec<u8>)>, name: String, data: Vec<u8>) {
    match entries.iter_mut().find(|(n, _)| *n == name) {
        Some(slot) => slot.1 = data,
        None => entries.push((name, data)),
    }
}

/// [Content_Types].xml 收尾：Override（表格/drawing 部件）与 Default（媒体扩展名）各补各的，
/// 已在的条目不重写——crate 自己的那份账不动
fn patch_content_types(
    entries: &mut Vec<(String, Vec<u8>)>,
    overrides: &[(String, &'static str)],
    defaults: &[(String, &'static str)],
) -> Result<(), String> {
    const CT: &str = "[Content_Types].xml";
    let xml = entry_str(entries, CT).ok_or("[Content_Types].xml 不在产物里")?;
    let mut add = String::new();
    for (part, ct) in overrides {
        if xml.contains(&format!("PartName=\"/{part}\"")) {
            continue;
        }
        add.push_str(&format!("<Override PartName=\"/{part}\" ContentType=\"{ct}\"/>"));
    }
    for (ext, mime) in defaults {
        if xml.contains(&format!("Extension=\"{ext}\"")) {
            continue;
        }
        add.push_str(&format!("<Default Extension=\"{ext}\" ContentType=\"{mime}\"/>"));
    }
    if add.is_empty() {
        return Ok(());
    }
    let Some(i) = xml.find("</Types>") else {
        return Err("[Content_Types].xml 形状不对".into());
    };
    let out = format!("{}{}{}", &xml[..i], add, &xml[i..]);
    upsert(entries, CT.to_string(), out.into_bytes());
    Ok(())
}

fn entries_of(bytes: &[u8]) -> Result<Vec<(String, Vec<u8>)>, String> {
    let mut z = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|e| format!("产物读不回来: {e}"))?;
    let mut out = Vec::with_capacity(z.len());
    for i in 0..z.len() {
        let mut f = z.by_index(i).map_err(|e| format!("产物读不回来: {e}"))?;
        let name = f.name().to_string();
        let mut data = Vec::new();
        f.read_to_end(&mut data).map_err(|e| format!("产物读不回来: {e}"))?;
        out.push((name, data));
    }
    Ok(out)
}

/// 重新打包：条目原序、Deflated 压缩（媒体重压一遍的代价可忽略，换来的是不挑压缩方式）
fn write_zip(entries: Vec<(String, Vec<u8>)>) -> Result<Vec<u8>, String> {
    let out = Cursor::new(Vec::new());
    let mut zw = ZipWriter::new(out);
    let opt =
        SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for (name, data) in &entries {
        zw.start_file(name.as_str(), opt)
            .map_err(|e| format!("保留式写回打包失败: {e}"))?;
        zw.write_all(data)
            .map_err(|e| format!("保留式写回打包失败: {e}"))?;
    }
    let z = zw
        .finish()
        .map_err(|e| format!("保留式写回打包失败: {e}"))?;
    Ok(z.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xlsx::{CellPayload, SheetPayload, WorkbookPayload};
    use calamine::Reader as _;
    use serde_json::json;

    fn tmp_path(tag: &str) -> String {
        std::env::temp_dir()
            .join(format!("openoffices-preserve-{}-{}.xlsx", tag, std::process::id()))
            .to_string_lossy()
            .to_string()
    }

    fn load(path: &str) -> Vec<(String, Vec<u8>)> {
        let f = std::fs::File::open(path).unwrap();
        let mut z = zip::ZipArchive::new(f).unwrap();
        let mut out = Vec::new();
        for i in 0..z.len() {
            let mut f = z.by_index(i).unwrap();
            let name = f.name().to_string();
            let mut data = Vec::new();
            f.read_to_end(&mut data).unwrap();
            out.push((name, data));
        }
        out
    }

    fn upsert(entries: &mut Vec<(String, Vec<u8>)>, name: &str, data: Vec<u8>) {
        match entries.iter_mut().find(|(n, _)| n == name) {
            Some(slot) => slot.1 = data,
            None => entries.push((name.to_string(), data)),
        }
    }

    fn save(path: &str, entries: Vec<(String, Vec<u8>)>) {
        std::fs::write(path, write_zip(entries).unwrap()).unwrap();
    }

    fn entry_str<'a>(entries: &'a [(String, Vec<u8>)], name: &str) -> Option<&'a str> {
        entries
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, d)| std::str::from_utf8(d).unwrap())
    }

    const TABLE_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="成绩表" displayName="成绩表" ref="A1:B3" totalsRowShown="0"><autoFilter ref="A1:B3"/><tableColumns count="2"><tableColumn id="1" name="姓名"/><tableColumn id="2" name="分数"/></tableColumns><tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>"#;

    const PIC_ANCHOR: &str = r#"<xdr:oneCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="990600" cy="792480"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="图片 1"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rIdImg1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="990600" cy="792480"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>"#;

    const PNG_BYTES: &[u8] = b"\x89PNG\r\n\x1a\nfake-image-bytes";

    /// 原件 fixture：crate 产物之上注入一份表格部件 + 一份图片 drawing + media，
    /// 全部接线（sheet 部件元素、rels、content types）都按 Excel 亲笔的形状补齐
    fn make_orig(tag: &str, sheet_xml_has_drawing: bool) -> String {
        let path = tmp_path(tag);
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "数据".into(),
                cells: vec![
                    CellPayload {
                        r: 0,
                        c: 0,
                        v: Some(json!("姓名")),
                        ..Default::default()
                    },
                    CellPayload {
                        r: 1,
                        c: 0,
                        v: Some(json!("张三")),
                        ..Default::default()
                    },
                ],
                ..Default::default()
            }],
            ..Default::default()
        };
        crate::xlsx::write_xlsx_sync(path.clone(), wb).expect("底件写出失败");
        let mut entries = load(&path);

        let sheet = "xl/worksheets/sheet1.xml";
        let rels_part = "xl/worksheets/_rels/sheet1.xml.rels";
        // sheet rels：底件没有 rels（无批注/链接），从空表起补 drawing 与 table 两条
        let sheet_rels = format!(
            "<Relationships xmlns=\"{RELS_NS}\">\
             <Relationship Id=\"rIdD1\" Type=\"{REL_DRAWING}\" Target=\"../drawings/drawing9.xml\"/>\
             <Relationship Id=\"rIdT1\" Type=\"{REL_TABLE}\" Target=\"../tables/table1.xml\"/>\
             </Relationships>"
        );
        upsert(&mut entries, rels_part, sheet_rels.into_bytes());
        // sheet 部件：drawing 引用（可选）+ tableParts，都贴着 </worksheet> 按顺序插
        let xml = entry_str(&entries, sheet).unwrap().to_string();
        let mut patch = String::new();
        if sheet_xml_has_drawing {
            patch.push_str("<drawing r:id=\"rIdD1\"/>");
        }
        patch.push_str("<tableParts count=\"1\"><tablePart r:id=\"rIdT1\"/></tableParts>");
        let xml = xml.replace("</worksheet>", &format!("{patch}</worksheet>"));
        upsert(&mut entries, sheet, xml.into_bytes());
        // 表格部件 + 图片三件套
        upsert(
            &mut entries,
            "xl/tables/table1.xml",
            TABLE_XML.as_bytes().to_vec(),
        );
        let drawing9 = format!(
            "<xdr:wsDr xmlns:xdr=\"http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">{PIC_ANCHOR}</xdr:wsDr>"
        );
        upsert(&mut entries, "xl/drawings/drawing9.xml", drawing9.into_bytes());
        let dw_rels = format!(
            "<Relationships xmlns=\"{RELS_NS}\"><Relationship Id=\"rIdImg1\" Type=\"{REL_IMAGE}\" Target=\"../media/image1.png\"/></Relationships>"
        );
        upsert(
            &mut entries,
            "xl/drawings/_rels/drawing9.xml.rels",
            dw_rels.into_bytes(),
        );
        upsert(&mut entries, "xl/media/image1.png", PNG_BYTES.to_vec());
        // content types 补账（底件是纯 crate 产物，这三样都不会在）
        let ct = entry_str(&entries, "[Content_Types].xml")
            .unwrap()
            .to_string();
        let ct = ct.replace(
            "</Types>",
            "<Override PartName=\"/xl/tables/table1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml\"/>\
             <Override PartName=\"/xl/drawings/drawing9.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.drawing+xml\"/>\
             <Default Extension=\"png\" ContentType=\"image/png\"/></Types>",
        );
        upsert(&mut entries, "[Content_Types].xml", ct.into_bytes());
        save(&path, entries);
        path
    }

    fn payload_named(names: &[&str]) -> WorkbookPayload {
        WorkbookPayload {
            sheets: names
                .iter()
                .map(|n| SheetPayload {
                    name: (*n).into(),
                    cells: vec![CellPayload {
                        r: 0,
                        c: 0,
                        v: Some(json!("新值")),
                        ..Default::default()
                    }],
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        }
    }

    const PIVOT_DEF_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<pivotCacheDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdR1" refreshOnLoad="1" refreshedBy="我" createdVersion="6" refreshedVersion="6" minRefreshableVersion="3" recordCount="2"><cacheSource type="worksheet"><worksheetSource ref="A1:B3" sheet="数据"/></cacheSource><cacheFields count="2"><cacheField name="姓名" numFmtId="0"><sharedItems count="2"><s v="张三"/><s v="李四"/></sharedItems></cacheField><cacheField name="分数" numFmtId="0"><sharedItems containsSemiMixedTypes="0" containsString="0" containsNumber="1" containsInteger="1" minValue="60" maxValue="90" count="2"><n v="60"/><n v="90"/></sharedItems></cacheField></cacheFields></pivotCacheDefinition>"#;

    const PIVOT_REC_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<pivotCacheRecords xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" count="2"><r><x v="0"/><n v="60"/></r><r><x v="1"/><n v="90"/></r></pivotCacheRecords>"#;

    const PIVOT_TBL_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<pivotTableDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" name="透视表1" cacheId="1" applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="1" dataCaption="值" updatedVersion="6" minRefreshableVersion="3" createdVersion="6" indent="0" outline="1" outlineData="1" multipleFieldFilters="0"><location ref="D1:E3" firstHeaderRow="1" firstDataRow="1" firstDataCol="1"/><pivotFields count="2"><pivotField axis="axisRow" showAll="0"><items count="3"><item x="0"/><item x="1"/><item t="default"/></items></pivotField><pivotField dataField="1" showAll="0"/></pivotFields><rowFields count="1"><field x="0"/></rowFields><rowItems count="3"><i><x/></i><i><x v="1"/></i><i t="grand"><x/></i></rowItems><colItems count="1"><i/></colItems><dataFields count="1"><dataField name="求和项:分数" fld="1" baseField="0" baseItem="0"/></dataFields></pivotTableDefinition>"#;

    /// 在 make_orig 之上注入透视三件套（cacheDefinition + records + pivotTable），
    /// 簿级 / 表级接线与 content types 都按 Excel 亲笔的形状补齐
    fn make_orig_pivot(tag: &str) -> String {
        let path = make_orig(tag, false);
        let mut entries = load(&path);

        // 簿级：workbook.xml 补 <pivotCaches>，workbook rels 补定义部件的关系
        let wb = "xl/workbook.xml";
        let xml = entry_str(&entries, wb).unwrap().to_string();
        let xml = xml.replace(
            "</workbook>",
            "<pivotCaches><pivotCache cacheId=\"1\" r:id=\"rIdP9\"/></pivotCaches></workbook>",
        );
        upsert(&mut entries, wb, xml.into_bytes());
        let wb_rels = "xl/_rels/workbook.xml.rels";
        let rels = entry_str(&entries, wb_rels).unwrap().to_string();
        let rels = rels.replace(
            "</Relationships>",
            &format!(
                "<Relationship Id=\"rIdP9\" Type=\"{REL_PIVOT_CACHE_DEF}\" Target=\"pivotCache/pivotCacheDefinition1.xml\"/></Relationships>"
            ),
        );
        upsert(&mut entries, wb_rels, rels.into_bytes());

        // 缓存两件套 + definition 的 rels
        upsert(
            &mut entries,
            "xl/pivotCache/pivotCacheDefinition1.xml",
            PIVOT_DEF_XML.as_bytes().to_vec(),
        );
        upsert(
            &mut entries,
            "xl/pivotCache/pivotCacheRecords1.xml",
            PIVOT_REC_XML.as_bytes().to_vec(),
        );
        let def_rels = format!(
            "<Relationships xmlns=\"{RELS_NS}\"><Relationship Id=\"rIdR1\" Type=\"{REL_PIVOT_CACHE_RECORDS}\" Target=\"pivotCacheRecords1.xml\"/></Relationships>"
        );
        upsert(
            &mut entries,
            "xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels",
            def_rels.into_bytes(),
        );

        // 表级：pivotTable + 自身 rels + sheet rels（sheet 部件本身不需要任何元素）
        upsert(
            &mut entries,
            "xl/pivotTables/pivotTable1.xml",
            PIVOT_TBL_XML.as_bytes().to_vec(),
        );
        let tbl_rels = format!(
            "<Relationships xmlns=\"{RELS_NS}\"><Relationship Id=\"rIdC1\" Type=\"{REL_PIVOT_CACHE_DEF}\" Target=\"../pivotCache/pivotCacheDefinition1.xml\"/></Relationships>"
        );
        upsert(
            &mut entries,
            "xl/pivotTables/_rels/pivotTable1.xml.rels",
            tbl_rels.into_bytes(),
        );
        let sheet_rels = "xl/worksheets/_rels/sheet1.xml.rels";
        let rels = entry_str(&entries, sheet_rels).unwrap().to_string();
        let rels = rels.replace(
            "</Relationships>",
            &format!(
                "<Relationship Id=\"rIdPT1\" Type=\"{REL_PIVOT_TABLE}\" Target=\"../pivotTables/pivotTable1.xml\"/></Relationships>"
            ),
        );
        upsert(&mut entries, sheet_rels, rels.into_bytes());

        let ct = entry_str(&entries, "[Content_Types].xml")
            .unwrap()
            .to_string();
        let ct = ct.replace(
            "</Types>",
            "<Override PartName=\"/xl/pivotCache/pivotCacheDefinition1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml\"/>\
             <Override PartName=\"/xl/pivotCache/pivotCacheRecords1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml\"/>\
             <Override PartName=\"/xl/pivotTables/pivotTable1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml\"/></Types>",
        );
        upsert(&mut entries, "[Content_Types].xml", ct.into_bytes());
        save(&path, entries);
        path
    }

    const SLICER_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<x14:slicer xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" name="切片 1" cache="Slicer_A" caption="切片 1" rowHeight="0" columnCount="1" levelCount="1" style="slicerStyleLight1" showCaption="1" startItem="0" sortOrder="asc" crossFilter="none" headerRowCount="1" itemCount="2"/>"#;

    const SLICER_CACHE_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<x14:slicerCache xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" name="Slicer_A" sourceName="姓名"><x14:data><x14:tabular pivotCacheId="1"/><x14:levels count="1"><x14:level colId="0" uniqueCount="2" sortOrder="asc" hideNoData="1" crossFilter="none"/></x14:levels></x14:data><x14:slicerCachePivotTables/></x14:slicerCache>"#;

    /// drawing 里承载切片器的 graphicFrame（Excel 亲笔的形状：graphicData uri 带 slicer，内部 r:id 指部件）
    const SLICER_FRAME: &str = r#"<xdr:twoCellAnchor><xdr:from><xdr:col>4</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>6</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>10</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro="" fPublished="0"><xdr:nvGraphicFramePr><xdr:cNvPr id="5" name="切片 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/drawing/2010/slicer"><sle:slicer xmlns:sle="http://schemas.microsoft.com/office/drawing/2010/slicer" r:id="rIdS1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>"#;

    /// 在 make_orig_pivot 之上注入切片器两件套：drawing 里的 graphicFrame 锚点 + slicer 部件，
    /// 以及簿级的 x14:slicerCaches ext（缓存自身 rels 指回那块透视缓存）——接线与 content types
    /// 都按 Excel 亲笔的形状补齐
    fn make_orig_slicer(tag: &str) -> String {
        let path = make_orig_pivot(tag);
        let mut entries = load(&path);

        // 形状侧：drawing9 追加锚点、drawing rels 补 slicer 关系、落 slicer 部件
        let dw = "xl/drawings/drawing9.xml";
        let xml = entry_str(&entries, dw).unwrap().to_string();
        let xml = xml.replace("</xdr:wsDr>", &format!("{SLICER_FRAME}</xdr:wsDr>"));
        upsert(&mut entries, dw, xml.into_bytes());
        let dw_rels = "xl/drawings/_rels/drawing9.xml.rels";
        let rels = entry_str(&entries, dw_rels).unwrap().to_string();
        let rels = rels.replace(
            "</Relationships>",
            &format!(
                "<Relationship Id=\"rIdS1\" Type=\"{REL_SLICER}\" Target=\"../slicers/slicer1.xml\"/></Relationships>"
            ),
        );
        upsert(&mut entries, dw_rels, rels.into_bytes());
        upsert(&mut entries, "xl/slicers/slicer1.xml", SLICER_XML.as_bytes().to_vec());

        // 簿级：workbook.xml 的 extLst（x14:slicerCaches）+ workbook rels
        let wb = "xl/workbook.xml";
        let xml = entry_str(&entries, wb).unwrap().to_string();
        let xml = xml.replace(
            "</workbook>",
            &format!(
                "<extLst><ext xmlns:x14=\"{X14_NS}\" uri=\"{SLICER_EXT_URI}\"><x14:slicerCaches><x14:slicerCache r:id=\"rIdS9\"/></x14:slicerCaches></ext></extLst></workbook>"
            ),
        );
        upsert(&mut entries, wb, xml.into_bytes());
        let wb_rels = "xl/_rels/workbook.xml.rels";
        let rels = entry_str(&entries, wb_rels).unwrap().to_string();
        let rels = rels.replace(
            "</Relationships>",
            &format!(
                "<Relationship Id=\"rIdS9\" Type=\"{REL_SLICER_CACHE}\" Target=\"slicerCaches/slicerCache1.xml\"/></Relationships>"
            ),
        );
        upsert(&mut entries, wb_rels, rels.into_bytes());

        // 缓存部件 + 自身 rels 指回透视缓存定义
        upsert(
            &mut entries,
            "xl/slicerCaches/slicerCache1.xml",
            SLICER_CACHE_XML.as_bytes().to_vec(),
        );
        let cache_rels = format!(
            "<Relationships xmlns=\"{RELS_NS}\"><Relationship Id=\"rIdC1\" Type=\"{REL_PIVOT_CACHE_DEF}\" Target=\"../pivotCache/pivotCacheDefinition1.xml\"/></Relationships>"
        );
        upsert(
            &mut entries,
            "xl/slicerCaches/_rels/slicerCache1.xml.rels",
            cache_rels.into_bytes(),
        );

        let ct = entry_str(&entries, "[Content_Types].xml")
            .unwrap()
            .to_string();
        let ct = ct.replace(
            "</Types>",
            "<Override PartName=\"/xl/slicerCaches/slicerCache1.xml\" ContentType=\"application/vnd.ms-excel.slicerCache+xml\"/>\
             <Override PartName=\"/xl/slicers/slicer1.xml\" ContentType=\"application/vnd.ms-excel.slicer+xml\"/></Types>",
        );
        upsert(&mut entries, "[Content_Types].xml", ct.into_bytes());
        save(&path, entries);
        path
    }

    /// 页眉页脚图：`&G` 之外的本体。原件里是一份独立 drawing（`<picture r:id>` 指它）
    const HF_PIC_ANCHOR: &str = r#"<xdr:absoluteAnchor><xdr:pos x="0" y="0"/><xdr:ext cx="952500" cy="952500"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="3" name="页眉图"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rIdHImg1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="952500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:absoluteAnchor>"#;

    /// 原件 VML：一枚 `<v:shapetype>`、一枚批注形状（无 imagedata）、一枚页眉图形状。
    /// shapetype 同样以 `<v:shape` 开头，专门拿来钉住形状提取的边界；
    /// 根上故意不声明 xmlns:r——搬过去的形状要用 r: 前缀，产物那份得补齐
    const HF_VML: &str = r##"<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,21600l21600,xe"><v:stroke joinstyle="miter"/></v:shapetype><v:shape id="_x0000_s1025" type="#_x0000_t202" style="position:absolute;width:96pt;height:55.5pt" fillcolor="#ffffe1" o:insetmode="auto"><v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox><div style="text-align:left"/></v:textbox><x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:AutoFill>False</x:AutoFill><x:Row>1</x:Row><x:Column>1</x:Column></x:ClientData></v:shape><v:shape id="CH" type="#_x0000_t75" style="width:48pt;height:48pt"><v:imagedata r:id="rIdHV1" o:title="徽标"/></v:shape></xml>"##;

    const HF_PNG: &[u8] = b"\x89PNG\r\n\x1a\nheader-footer-image";

    /// 页眉页脚两条线都接上的原件：`<picture r:id>` → 一份独立 drawing，
    /// `<legacyDrawingHF r:id>` → 一份 VML。with_note 时底件带批注，
    /// 产物里就先有一份 crate 写的 vmlDrawing（考验「并进去」而不是「另起一份」）
    fn make_orig_hf(tag: &str, with_note: bool) -> String {
        let path = tmp_path(tag);
        let wb = WorkbookPayload {
            sheets: vec![SheetPayload {
                name: "数据".into(),
                cells: vec![CellPayload {
                    r: 0,
                    c: 0,
                    v: Some(json!("姓名")),
                    ..Default::default()
                }],
                notes: if with_note {
                    vec![crate::xlsx::CellNotePayload {
                        r: 1,
                        c: 1,
                        text: "批注一条".into(),
                        author: Some("张三".into()),
                        width: None,
                        height: None,
                        show: None,
                    }]
                } else {
                    vec![]
                },
                ..Default::default()
            }],
            ..Default::default()
        };
        crate::xlsx::write_xlsx_sync(path.clone(), wb).expect("底件写出失败");
        let mut entries = load(&path);

        let sheet = "xl/worksheets/sheet1.xml";
        let rels_part = "xl/worksheets/_rels/sheet1.xml.rels";
        // 底件带批注时 sheet rels 已存在（comments/vmlDrawing 两条），在其之上追加
        let fallback = format!("<Relationships xmlns=\"{RELS_NS}\"></Relationships>");
        let base = entry_str(&entries, rels_part)
            .unwrap_or(fallback.as_str())
            .to_string();
        let add = format!(
            "<Relationship Id=\"rIdHP1\" Type=\"{REL_DRAWING}\" Target=\"../drawings/drawing8.xml\"/>\
             <Relationship Id=\"rIdHV2\" Type=\"{REL_VML_DRAWING}\" Target=\"../drawings/vmlDrawing7.vml\"/>"
        );
        upsert(
            &mut entries,
            rels_part,
            base.replace("</Relationships>", &format!("{add}</Relationships>"))
                .into_bytes(),
        );
        // sheet 部件：CT_Worksheet 的序里 legacyDrawingHF 在 picture 之前
        let xml = entry_str(&entries, sheet).unwrap().to_string();
        upsert(
            &mut entries,
            sheet,
            xml.replace(
                "</worksheet>",
                "<legacyDrawingHF r:id=\"rIdHV2\"/><picture r:id=\"rIdHP1\"/></worksheet>",
            )
            .into_bytes(),
        );
        // ① picture 那路：drawing 部件 + 它的 rels + media
        let drawing8 = format!(
            "<xdr:wsDr xmlns:xdr=\"http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">{HF_PIC_ANCHOR}</xdr:wsDr>"
        );
        upsert(&mut entries, "xl/drawings/drawing8.xml", drawing8.into_bytes());
        let dw_rels = format!(
            "<Relationships xmlns=\"{RELS_NS}\"><Relationship Id=\"rIdHImg1\" Type=\"{REL_IMAGE}\" Target=\"../media/image7.png\"/></Relationships>"
        );
        upsert(
            &mut entries,
            "xl/drawings/_rels/drawing8.xml.rels",
            dw_rels.into_bytes(),
        );
        upsert(&mut entries, "xl/media/image7.png", HF_PNG.to_vec());
        // ② VML 那路：vmlDrawing 部件 + 它的 rels + media
        upsert(
            &mut entries,
            "xl/drawings/vmlDrawing7.vml",
            HF_VML.as_bytes().to_vec(),
        );
        let vml_rels = format!(
            "<Relationships xmlns=\"{RELS_NS}\"><Relationship Id=\"rIdHV1\" Type=\"{REL_IMAGE}\" Target=\"../media/image8.png\"/></Relationships>"
        );
        upsert(
            &mut entries,
            "xl/drawings/_rels/vmlDrawing7.vml.rels",
            vml_rels.into_bytes(),
        );
        upsert(&mut entries, "xl/media/image8.png", HF_PNG.to_vec());
        // content types：底件是纯 crate 产物，这三样都不会在
        let ct = entry_str(&entries, "[Content_Types].xml")
            .unwrap()
            .to_string();
        let ct = ct.replace(
            "</Types>",
            "<Override PartName=\"/xl/drawings/drawing8.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.drawing+xml\"/>\
             <Default Extension=\"vml\" ContentType=\"application/vnd.openxmlformats-officedocument.vmlDrawing\"/>\
             <Default Extension=\"png\" ContentType=\"image/png\"/></Types>",
        );
        upsert(&mut entries, "[Content_Types].xml", ct.into_bytes());
        save(&path, entries);
        path
    }

    fn sheet_rel_targets(got: &[(String, Vec<u8>)]) -> HashMap<String, String> {
        let rels = parse_rels(entry_str(got, "xl/worksheets/_rels/sheet1.xml.rels").unwrap_or(""));
        rels.iter()
            .map(|(k, t)| (k.clone(), resolve_rel("xl/worksheets/sheet1.xml", t)))
            .collect()
    }

    #[test]
    fn hf_pics_are_carried_end_to_end() {
        let orig = make_orig_hf("hf", false);
        let out = tmp_path("hf-out");
        let mut wb = payload_named(&["数据"]);
        wb.src_path = Some(orig.clone());
        let notes = crate::xlsx::write_xlsx_sync(out.clone(), wb).expect("写盘失败");

        let got = load(&out);
        // ① picture 路：drawing 整份照搬（锚点字节与块内 rId 一位不动），媒体搬成新部件
        let hf_dw = got
            .iter()
            .filter(|(n, _)| n.starts_with("xl/drawings/drawing") && n.ends_with(".xml"))
            .map(|(n, _)| n.clone())
            .find(|n| entry_str(&got, n).unwrap().contains("页眉图"))
            .expect("产物里应有一份页眉图的 drawing");
        assert!(
            entry_str(&got, &hf_dw).unwrap().contains("r:embed=\"rIdHImg1\""),
            "块内 rId 应原样保留：{}",
            entry_str(&got, &hf_dw).unwrap()
        );
        let dw_rels = entry_str(&got, &rels_of(&hf_dw)).unwrap();
        assert!(
            dw_rels.contains("Id=\"rIdHImg1\"")
                && dw_rels.contains(&format!("Type=\"{REL_IMAGE}\""))
                && dw_rels.contains("Target=\"../media/"),
            "rels 应改指搬来的媒体：{dw_rels}"
        );
        // 媒体：两张图都搬过来，字节原样
        let media: Vec<String> = got
            .iter()
            .filter(|(n, _)| n.starts_with("xl/media/"))
            .map(|(n, _)| n.clone())
            .collect();
        assert_eq!(media.len(), 2, "两张页眉页脚图都该搬过去：{media:?}");
        for m in &media {
            assert_eq!(
                entry(&got, m).map(|d| d.as_slice()),
                Some(HF_PNG),
                "媒体字节应原样：{m}"
            );
        }
        // sheet 上的两枚引用：都指对部件，且守住 CT_Worksheet 的序
        let sheet = entry_str(&got, "xl/worksheets/sheet1.xml").unwrap().to_string();
        let prid = sheet_xml_attr(&sheet, "<picture r:id=\"").expect("应有 picture 引用");
        let hrid = sheet_xml_attr(&sheet, "<legacyDrawingHF r:id=\"").expect("应有 HF 引用");
        assert!(
            sheet.find("<legacyDrawingHF") < sheet.find("<picture "),
            "CT_Worksheet 序里 HF 应在 picture 之前：{sheet}"
        );
        let targets = sheet_rel_targets(&got);
        assert_eq!(
            targets.get(&prid).map(String::as_str),
            Some(hf_dw.as_str()),
            "picture 应指向那份 drawing：{targets:?}"
        );
        let vml_part = targets.get(&hrid).cloned().expect("HF 应指向一份 VML");
        assert!(vml_part.ends_with(".vml"), "HF 应指向 vmlDrawing：{vml_part}");
        // ② VML 路：只搬带 imagedata 的形状；shapetype 与批注形状都不跟着走
        let vml = entry_str(&got, &vml_part).unwrap();
        assert!(
            vml.contains("<v:imagedata") && vml.contains("id=\"CH\""),
            "页眉图形状应搬过来：{vml}"
        );
        assert!(
            !vml.contains("_x0000_s1025") && !vml.contains("_x0000_t202"),
            "批注形状与 shapetype 不该被页眉页脚线搬动：{vml}"
        );
        assert!(
            vml.contains("xmlns:r="),
            "搬来的形状用 r: 前缀，根上要补命名空间：{vml}"
        );
        assert!(
            !vml.contains("r:id=\"rIdHV1\""),
            "VML 里的 rId 应换成产物 rels 上的号：{vml}"
        );
        let vml_rels = entry_str(&got, &rels_of(&vml_part)).unwrap();
        assert!(
            vml_rels.contains(&format!("Type=\"{REL_IMAGE}\"")) && vml_rels.contains("Target=\"../media/"),
            "VML rels 应指向搬来的媒体：{vml_rels}"
        );
        // content types：vml 走 Default Extension
        let ct = entry_str(&got, "[Content_Types].xml").unwrap();
        assert!(
            ct.contains(&format!("ContentType=\"{VML_CT}\"")),
            "vml 的 Default 应在：{ct}"
        );
        assert!(
            notes.iter().any(|n| n.contains("页眉页脚图 2 张")),
            "应有一条搬运总账：{notes:?}"
        );
        let r = calamine::open_workbook_auto(&out).expect("产物应能被 calamine 打开");
        assert_eq!(r.sheet_names(), vec!["数据".to_string()]);
        std::fs::remove_file(&orig).ok();
        std::fs::remove_file(&out).ok();
    }

    #[test]
    fn hf_vml_merges_into_the_note_vml() {
        let orig = make_orig_hf("hf-note", true);
        let out = tmp_path("hf-note-out");
        let mut wb = payload_named(&["数据"]);
        // 产物这侧也要有批注：crate 才会写出 vmlDrawing1.vml 与 `<legacyDrawing>`，
        // 页眉图形状该并进它，而不是另起一份
        wb.sheets[0].notes = vec![crate::xlsx::CellNotePayload {
            r: 1,
            c: 1,
            text: "批注一条".into(),
            author: Some("张三".into()),
            width: None,
            height: None,
            show: None,
        }];
        wb.src_path = Some(orig.clone());
        crate::xlsx::write_xlsx_sync(out.clone(), wb).expect("写盘失败");

        let got = load(&out);
        // 产物里 crate 已给批注写了一份 vmlDrawing：HF 形状并进去，不另起一份
        let vmls: Vec<String> = got
            .iter()
            .filter(|(n, _)| n.ends_with(".vml"))
            .map(|(n, _)| n.clone())
            .collect();
        assert_eq!(vmls.len(), 1, "不该新建第二份 vmlDrawing：{vmls:?}");
        let vml = entry_str(&got, &vmls[0]).unwrap();
        assert!(
            vml.contains("_x0000_s1025") && vml.contains("<v:imagedata"),
            "批注形状与页眉图应同处一份 VML：{vml}"
        );
        // sheet 上 legacyDrawing 与 legacyDrawingHF 指同一份部件——Excel 亲笔就是这么写的
        let sheet = entry_str(&got, "xl/worksheets/sheet1.xml").unwrap().to_string();
        let lrid = sheet_xml_attr(&sheet, "<legacyDrawing r:id=\"").expect("批注的 legacyDrawing 应在");
        let hrid = sheet_xml_attr(&sheet, "<legacyDrawingHF r:id=\"").expect("HF 引用应在");
        let targets = sheet_rel_targets(&got);
        assert_eq!(
            targets.get(&lrid),
            targets.get(&hrid),
            "两个元素应指同一份 VML：{targets:?}"
        );
        std::fs::remove_file(&orig).ok();
        std::fs::remove_file(&out).ok();
    }

    #[test]
    fn hf_pic_with_unknown_media_is_skipped() {
        let orig = make_orig_hf("hf-bad", false);
        // 把 picture 那路的媒体换成一个认不出的扩展名
        let mut entries = load(&orig);
        upsert(
            &mut entries,
            "xl/drawings/_rels/drawing8.xml.rels",
            format!(
                "<Relationships xmlns=\"{RELS_NS}\"><Relationship Id=\"rIdHImg1\" Type=\"{REL_IMAGE}\" Target=\"../media/image7.xyz\"/></Relationships>"
            )
            .into_bytes(),
        );
        upsert(&mut entries, "xl/media/image7.xyz", HF_PNG.to_vec());
        save(&orig, entries);

        let out = tmp_path("hf-bad-out");
        let mut wb = payload_named(&["数据"]);
        wb.src_path = Some(orig.clone());
        let notes = crate::xlsx::write_xlsx_sync(out.clone(), wb).expect("写盘失败");
        let got = load(&out);
        assert!(
            !got.iter().any(|(n, _)| n.ends_with(".xyz")),
            "认不出的媒体不该搬：{:?}",
            got.iter().map(|(n, _)| n).collect::<Vec<_>>()
        );
        let sheet = entry_str(&got, "xl/worksheets/sheet1.xml").unwrap();
        assert!(
            !sheet.contains("<picture "),
            "没搬成就不该在 sheet 上留 picture 引用：{sheet}"
        );
        assert!(
            notes.iter().any(|n| n.contains("格式认不出")),
            "应记一条账：{notes:?}"
        );
        // 另一条线不受牵连
        assert!(sheet.contains("<legacyDrawingHF"), "VML 那条线照搬：{sheet}");
        std::fs::remove_file(&orig).ok();
        std::fs::remove_file(&out).ok();
    }

    /// 查询连接部件：workbook.xml 的 `<connections><connection … r:id>` 指它
    const CONN_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<connection xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="成绩查询" type="1" refreshedVersion="7" minRefreshableVersion="3" savePassword="0" background="1" refreshOnLoad="1"><dbPr connection="Provider=SQLOLEDB;Data Source=report" command="SELECT 姓名, 分数 FROM 成绩" commandType="3"/></connection>"#;

    /// 查询表部件：`connectionId="1"` 按 workbook `<connections>` 里那位的 id 对账
    const QUERY_TABLE_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<queryTable xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" name="成绩查询" connectionId="1" refreshOnLoad="1"><queryTableFields count="2"><queryTableField id="1" name="姓名" tableColumnId="0"/><queryTableField id="2" name="分数" tableColumnId="1"/></queryTableFields></queryTable>"#;

    /// 查询连接 + 查询表原件：sheet rels 挂 queryTable、queryTable rels 指回连接、
    /// workbook.xml 带一份 `<connections>` 清单。with_wb_rel=false 时把 workbook rels
    /// 里那条连接关系抽掉——专门钉「关系断了则整条线不搬」的守卫
    fn make_orig_conn(tag: &str, with_wb_rel: bool) -> String {
        let path = make_orig(tag, false);
        let mut entries = load(&path);

        // sheet rels 追加 queryTable 关系（sheet 部件上不需要内联元素）
        let sheet_rels = "xl/worksheets/_rels/sheet1.xml.rels";
        let rels = entry_str(&entries, sheet_rels).unwrap().to_string();
        let rels = rels.replace(
            "</Relationships>",
            &format!(
                "<Relationship Id=\"rIdQ1\" Type=\"{REL_QUERY_TABLE}\" Target=\"../queryTables/queryTable1.xml\"/></Relationships>"
            ),
        );
        upsert(&mut entries, sheet_rels, rels.into_bytes());
        upsert(
            &mut entries,
            "xl/queryTables/queryTable1.xml",
            QUERY_TABLE_XML.as_bytes().to_vec(),
        );
        let qt_rels = format!(
            "<Relationships xmlns=\"{RELS_NS}\"><Relationship Id=\"rIdConn\" Type=\"{REL_CONNECTION}\" Target=\"../connections/connection1.xml\"/></Relationships>"
        );
        upsert(
            &mut entries,
            "xl/queryTables/_rels/queryTable1.xml.rels",
            qt_rels.into_bytes(),
        );
        upsert(&mut entries, "xl/connections/connection1.xml", CONN_XML.as_bytes().to_vec());

        // 簿级：workbook.xml 的 <connections> 清单 + workbook rels
        let wb = "xl/workbook.xml";
        let xml = entry_str(&entries, wb).unwrap().to_string();
        let xml = xml.replace(
            "</workbook>",
            "<connections><connection id=\"1\" name=\"成绩查询\" type=\"1\" refreshedVersion=\"7\" r:id=\"rIdConn1\"/></connections></workbook>",
        );
        upsert(&mut entries, wb, xml.into_bytes());
        if with_wb_rel {
            let wb_rels = "xl/_rels/workbook.xml.rels";
            let rels = entry_str(&entries, wb_rels).unwrap().to_string();
            let rels = rels.replace(
                "</Relationships>",
                &format!(
                    "<Relationship Id=\"rIdConn1\" Type=\"{REL_CONNECTION}\" Target=\"connections/connection1.xml\"/></Relationships>"
                ),
            );
            upsert(&mut entries, wb_rels, rels.into_bytes());
        }

        let ct = entry_str(&entries, "[Content_Types].xml")
            .unwrap()
            .to_string();
        let ct = ct.replace(
            "</Types>",
            "<Override PartName=\"/xl/connections/connection1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml\"/>\
             <Override PartName=\"/xl/queryTables/queryTable1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.queryTable+xml\"/></Types>",
        );
        upsert(&mut entries, "[Content_Types].xml", ct.into_bytes());
        save(&path, entries);
        path
    }

    #[test]
    fn connections_and_query_tables_are_carried_end_to_end() {
        let orig = make_orig_conn("conn", true);
        let out = tmp_path("conn-out");
        let mut wb = payload_named(&["数据"]);
        wb.src_path = Some(orig.clone());
        let notes = crate::xlsx::write_xlsx_sync(out.clone(), wb).expect("写盘失败");

        let got = load(&out);
        // 部件字节原样
        assert_eq!(
            entry_str(&got, "xl/connections/connection1.xml"),
            Some(CONN_XML),
            "查询连接部件应整份照搬"
        );
        assert_eq!(
            entry_str(&got, "xl/queryTables/queryTable1.xml"),
            Some(QUERY_TABLE_XML),
            "查询表部件应整份照搬"
        );
        // 簿级接线：<connections> 里的 r:id 换新号，wb rels 里认得它
        let wbxml = entry_str(&got, "xl/workbook.xml").unwrap();
        assert!(
            wbxml.contains("<connections>") && wbxml.contains("<connection id=\"1\""),
            "workbook.xml 应有 <connections> 清单：{wbxml}"
        );
        let wb_rels = entry_str(&got, "xl/_rels/workbook.xml.rels").unwrap();
        let _new_rid = {
            let conn_tag = wbxml[wbxml.find("<connection id=\"1\"").unwrap()..].to_string();
            let rid = tag_attr(&conn_tag[..conn_tag.find("/>").unwrap()], "r:id").unwrap();
            assert!(
                wb_rels.contains(&format!("Id=\"{rid}\""))
                    && wb_rels.contains(&format!("Type=\"{REL_CONNECTION}\""))
                    && wb_rels.contains("Target=\"connections/connection1.xml\""),
                "workbook rels 应有指向新连接部件的关系：{wb_rels}"
            );
            rid
        };
        assert!(
            wbxml.find("<pivotCaches").map(|p| p < wbxml.find("<connections").unwrap()) != Some(false),
            "CT_Workbook 序里 connections 应在 extLst/smartTag 之前、pivotCaches 之后"
        );
        // queryTable 的数据源改指搬过去那份连接
        let qt_rels = entry_str(&got, "xl/queryTables/_rels/queryTable1.xml.rels").unwrap();
        assert!(
            qt_rels.contains(&format!("Type=\"{REL_CONNECTION}\""))
                && qt_rels.contains("Target=\"../connections/connection1.xml\""),
            "查询表 rels 应指向新连接部件：{qt_rels}"
        );
        // sheet rels 挂上 queryTable 关系
        let sheet_rels = entry_str(&got, "xl/worksheets/_rels/sheet1.xml.rels").unwrap();
        assert!(
            sheet_rels.contains(&format!("Type=\"{REL_QUERY_TABLE}\""))
                && sheet_rels.contains("Target=\"../queryTables/queryTable1.xml\""),
            "sheet rels 应有 queryTable 关系：{sheet_rels}"
        );
        // content types 两笔
        let ct = entry_str(&got, "[Content_Types].xml").unwrap();
        assert!(
            ct.contains("/xl/connections/connection1.xml")
                && ct.contains(CT_CONNECTION)
                && ct.contains("/xl/queryTables/queryTable1.xml")
                && ct.contains(CT_QUERY_TABLE),
            "content types 应补连接与查询表两笔：{ct}"
        );
        assert!(
            notes.iter().any(|n| n.contains("查询连接 1 份") && n.contains("查询表 1 份")),
            "搬运账应说清连接与查询表：{notes:?}"
        );
    }

    #[test]
    fn broken_connection_leaves_query_table_unwired() {
        let orig = make_orig_conn("conn-broken", false);
        let out = tmp_path("conn-broken-out");
        let mut wb = payload_named(&["数据"]);
        wb.src_path = Some(orig.clone());
        let notes = crate::xlsx::write_xlsx_sync(out.clone(), wb).expect("写盘失败");

        let got = load(&out);
        assert!(
            entry_str(&got, "xl/connections/connection1.xml").is_none(),
            "关系断了的连接不该搬"
        );
        assert!(
            entry_str(&got, "xl/queryTables/queryTable1.xml").is_none(),
            "接不上连接的查询表不该搬"
        );
        if let Some(rels) = entry_str(&got, "xl/worksheets/_rels/sheet1.xml.rels") {
            assert!(
                !rels.contains(&format!("Type=\"{REL_QUERY_TABLE}\"")),
                "sheet rels 不该留悬空的 queryTable 引用：{rels}"
            );
        }
        assert!(
            notes
                .iter()
                .any(|n| n.contains("查询连接的关系 rIdConn1 断了")),
            "连接那条账要说得出：{notes:?}"
        );
        assert!(
            notes
                .iter()
                .any(|n| n.contains("查询表 xl/queryTables/queryTable1.xml 的查询连接没搬成")),
            "查询表那条账要说得出：{notes:?}"
        );
    }

    #[test]
    fn slicers_are_carried_end_to_end() {
        let orig = make_orig_slicer("slicer");
        let out = tmp_path("slicer-out");
        let mut wb = payload_named(&["数据"]);
        wb.src_path = Some(orig.clone());
        let notes = crate::xlsx::write_xlsx_sync(out.clone(), wb).expect("写盘失败");

        let got = load(&out);
        // 部件字节原样
        assert_eq!(
            entry_str(&got, "xl/slicers/slicer1.xml"),
            Some(SLICER_XML),
            "切片器部件应整份照搬"
        );
        assert_eq!(
            entry_str(&got, "xl/slicerCaches/slicerCache1.xml"),
            Some(SLICER_CACHE_XML),
            "切片器缓存部件应整份照搬"
        );
        // 缓存的数据源改指搬过去的透视缓存（rId 不动）
        let cache_rels = entry_str(&got, "xl/slicerCaches/_rels/slicerCache1.xml.rels").unwrap();
        assert!(
            cache_rels.contains(&format!("Type=\"{REL_PIVOT_CACHE_DEF}\""))
                && cache_rels.contains("Target=\"../pivotCache/pivotCacheDefinition1.xml\"")
                && cache_rels.contains("Id=\"rIdC1\""),
            "缓存 rels 应只改 Target：{cache_rels}"
        );
        // 簿级接线：extLst 里一枚 x14:slicerCaches，且仍排在 pivotCaches 之后
        let wbxml = entry_str(&got, "xl/workbook.xml").unwrap();
        assert!(
            wbxml.contains("<x14:slicerCaches>") && wbxml.contains("<x14:slicerCache r:id="),
            "workbook.xml 应有切片器缓存 ext：{wbxml}"
        );
        assert!(
            wbxml.find("<pivotCaches") < wbxml.find("<extLst"),
            "CT_Workbook 序里 pivotCaches 应在 extLst 之前：{wbxml}"
        );
        let wb_rels = entry_str(&got, "xl/_rels/workbook.xml.rels").unwrap();
        assert!(
            wb_rels.contains(&format!("Type=\"{REL_SLICER_CACHE}\""))
                && wb_rels.contains("Target=\"slicerCaches/slicerCache1.xml\""),
            "workbook rels 应有缓存关系：{wb_rels}"
        );
        // 形状侧：锚点并进产物的 drawing，并与搬来的图片同处一份 drawing
        let sheet = entry_str(&got, "xl/worksheets/sheet1.xml").unwrap();
        assert!(sheet.contains("<drawing r:id="), "sheet 部件应有 drawing 引用：{sheet}");
        let drawing = got
            .iter()
            .find(|(n, _)| n.starts_with("xl/drawings/drawing"))
            .map(|(n, _)| n.clone())
            .expect("产物里应有一份 drawing");
        let dw = entry_str(&got, &drawing).unwrap();
        assert!(dw.contains("<xdr:graphicFrame") && dw.contains("slicer"), "锚点应并进 drawing：{dw}");
        assert!(dw.contains("<xdr:pic"), "同一份 drawing 里搬来的图片也应还在：{dw}");
        let dw_rels = entry_str(&got, &format!("xl/drawings/_rels/{}", &drawing["xl/drawings/".len()..]))
            .or_else(|| {
                got.iter()
                    .find(|(n, _)| n.starts_with("xl/drawings/_rels/"))
                    .map(|(n, _)| entry_str(&got, n).unwrap())
            })
            .unwrap();
        assert!(
            dw_rels.contains(&format!("Type=\"{REL_SLICER}\"")),
            "drawing rels 应有切片器关系：{dw_rels}"
        );
        let ct = entry_str(&got, "[Content_Types].xml").unwrap();
        assert!(
            ct.contains("slicerCache+xml") && ct.contains("slicer+xml"),
            "两笔 Override 应在：{ct}"
        );
        assert!(
            notes.iter().any(|n| n.contains("切片器 1 块")),
            "应有一条搬运总账：{notes:?}"
        );
        let r = calamine::open_workbook_auto(&out).expect("产物应能被 calamine 打开");
        assert_eq!(r.sheet_names(), vec!["数据".to_string()]);
        std::fs::remove_file(&orig).ok();
        std::fs::remove_file(&out).ok();
    }

    /// v0.109 实测抓到的抢名：图片搬运给 drawing 造的 rId 是 `rIdP1`，而 max_rid 只认
    /// `rId<数字>` ⇒ 透视表搬运又造出一枚 `rIdP1`，`<drawing r:id>` 于是解析到 pivotTable
    /// 部件上。这一条钉住「同一张 sheet 上图片 + 透视表 + 切片器同时搬」时三条关系不许重名
    #[test]
    fn carried_rel_ids_never_collide() {
        let orig = make_orig_slicer("rid");
        let out = tmp_path("rid-out");
        let mut wb = payload_named(&["数据"]);
        wb.src_path = Some(orig.clone());
        crate::xlsx::write_xlsx_sync(out.clone(), wb).expect("写盘失败");

        let got = load(&out);
        let rels = entry_str(&got, "xl/worksheets/_rels/sheet1.xml.rels").unwrap();
        let ids: Vec<&str> = {
            let mut out = Vec::new();
            let mut rest = rels;
            while let Some(i) = rest.find("Id=\"") {
                let t = &rest[i + "Id=\"".len()..];
                if let Some(j) = t.find('"') {
                    out.push(&t[..j]);
                    rest = &t[j..];
                } else {
                    break;
                }
            }
            out
        };
        let mut seen = std::collections::HashSet::new();
        for id in &ids {
            assert!(seen.insert(*id), "sheet rels 里 rId 撞号了（{id}）：{rels}");
        }
        // 三条搬来的关系各就各位：drawing 真指 drawing、透视表真指 pivotTable
        let sheet = entry_str(&got, "xl/worksheets/sheet1.xml").unwrap();
        let dw_rid = sheet_xml_attr(sheet, "<drawing r:id=\"").unwrap();
        let map = parse_rels(rels);
        let dw_target = map.get(&dw_rid).expect("drawing 关系应在");
        assert!(
            dw_target.contains("drawings/"),
            "drawing 关系应指向 drawing 部件，实际 {dw_target}：{rels}"
        );
        assert!(
            map.values().any(|t| t.contains("pivotTables/")),
            "透视表关系应在：{rels}"
        );
        // 切片器的关系挂在 drawing 上（锚点在 drawing 里），那边同样不许撞号
        let dw_rels = entry_str(&got, "xl/drawings/_rels/drawing1.xml.rels")
            .expect("产物的 drawing rels 应在");
        let dw_ids: Vec<&str> = {
            let mut out = Vec::new();
            let mut rest = dw_rels;
            while let Some(i) = rest.find("Id=\"") {
                let t = &rest[i + "Id=\"".len()..];
                if let Some(j) = t.find('"') {
                    out.push(&t[..j]);
                    rest = &t[j..];
                } else {
                    break;
                }
            }
            out
        };
        let mut seen_dw = std::collections::HashSet::new();
        for id in &dw_ids {
            assert!(seen_dw.insert(*id), "drawing rels 里 rId 撞号了（{id}）：{dw_rels}");
        }
        assert!(
            dw_rels.contains("slicers/") && dw_rels.contains("media/"),
            "drawing rels 应同时挂切片器与图片：{dw_rels}"
        );
        std::fs::remove_file(&orig).ok();
        std::fs::remove_file(&out).ok();
    }

    #[test]
    fn slicer_without_carried_source_is_skipped() {
        let orig = make_orig_slicer("slicer-orphan");
        // 把缓存的数据源改指一块不会被搬的透视缓存（它不在 workbook 的 pivotCaches 清单里）
        {
            let mut entries = load(&orig);
            let rels = format!(
                "<Relationships xmlns=\"{RELS_NS}\"><Relationship Id=\"rIdC1\" Type=\"{REL_PIVOT_CACHE_DEF}\" Target=\"../pivotCache/pivotCacheDefinition9.xml\"/></Relationships>"
            );
            upsert(
                &mut entries,
                "xl/slicerCaches/_rels/slicerCache1.xml.rels",
                rels.into_bytes(),
            );
            save(&orig, entries);
        }
        let out = tmp_path("slicer-orphan-out");
        let mut wb = payload_named(&["数据"]);
        wb.src_path = Some(orig.clone());
        let notes = crate::xlsx::write_xlsx_sync(out.clone(), wb).expect("写盘失败");

        let got = load(&out);
        assert!(
            got.iter()
                .all(|(n, _)| !n.starts_with("xl/slicerCaches/") && !n.starts_with("xl/slicers/")),
            "数据源没搬成时缓存与切片器都不该凭空出现"
        );
        let wbxml = entry_str(&got, "xl/workbook.xml").unwrap();
        assert!(
            !wbxml.contains("<x14:slicerCaches"),
            "簿级接线不该有：{wbxml}"
        );
        assert!(
            notes.iter().any(|n| n.contains("没搬") && n.contains("切片器缓存")),
            "账要说得出：{notes:?}"
        );
        std::fs::remove_file(&orig).ok();
        std::fs::remove_file(&out).ok();
    }

    #[test]
    fn pivots_are_carried_end_to_end() {
        let orig = make_orig_pivot("pivot");
        let out = tmp_path("pivot-out");
        let mut wb = payload_named(&["数据"]);
        wb.src_path = Some(orig.clone());
        let notes = crate::xlsx::write_xlsx_sync(out.clone(), wb).expect("写盘失败");

        let got = load(&out);
        // 缓存定义字节原样、records 到位、definition 的 rels 仍指同名记录（rId 不动）
        assert_eq!(
            entry_str(&got, "xl/pivotCache/pivotCacheDefinition1.xml"),
            Some(PIVOT_DEF_XML),
            "缓存定义应整份照搬"
        );
        assert_eq!(
            entry_str(&got, "xl/pivotCache/pivotCacheRecords1.xml"),
            Some(PIVOT_REC_XML),
            "缓存记录应整份照搬"
        );
        let def_rels = entry_str(&got, "xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels").unwrap();
        assert!(
            def_rels.contains("Target=\"pivotCacheRecords1.xml\"") && def_rels.contains("Id=\"rIdR1\""),
            "definition 的 rels 应保留 rId 只改 Target：{def_rels}"
        );
        // 簿级接线：workbook.xml 的 pivotCaches + rels 的定义部件关系
        let wb = entry_str(&got, "xl/workbook.xml").unwrap();
        assert!(
            wb.contains("<pivotCaches>") && wb.contains("cacheId=\"1\""),
            "workbook.xml 应有 pivotCaches：{wb}"
        );
        let wb_rels = entry_str(&got, "xl/_rels/workbook.xml.rels").unwrap();
        assert!(
            wb_rels.contains(&format!("Type=\"{REL_PIVOT_CACHE_DEF}\""))
                && wb_rels.contains("Target=\"pivotCache/pivotCacheDefinition1.xml\""),
            "workbook rels 应有缓存关系：{wb_rels}"
        );
        // 表级接线：sheet rels 挂 pivotTable、部件自身的 rels 改指新缓存、sheet 部件无内联元素
        let sheet_rels = entry_str(&got, "xl/worksheets/_rels/sheet1.xml.rels").unwrap();
        assert!(
            sheet_rels.contains(&format!("Type=\"{REL_PIVOT_TABLE}\""))
                && sheet_rels.contains("../pivotTables/pivotTable1.xml"),
            "sheet rels 应有透视表关系：{sheet_rels}"
        );
        assert_eq!(
            entry_str(&got, "xl/pivotTables/pivotTable1.xml"),
            Some(PIVOT_TBL_XML),
            "透视表部件应整份照搬"
        );
        let tbl_rels = entry_str(&got, "xl/pivotTables/_rels/pivotTable1.xml.rels").unwrap();
        assert!(
            tbl_rels.contains("Target=\"../pivotCache/pivotCacheDefinition1.xml\""),
            "透视表的 rels 应改指搬入的缓存：{tbl_rels}"
        );
        let ct = entry_str(&got, "[Content_Types].xml").unwrap();
        assert!(ct.contains("pivotCacheDefinition+xml") && ct.contains("pivotTable+xml"), "三笔 Override 应在：{ct}");
        // 账要说得出
        assert!(
            notes.iter().any(|n| n.contains("透视表 1 块")),
            "应有一条搬运总账：{notes:?}"
        );
        // 产物仍是合法工作簿
        let r = calamine::open_workbook_auto(&out).expect("产物应能被 calamine 打开");
        assert_eq!(r.sheet_names(), vec!["数据".to_string()]);
        std::fs::remove_file(&orig).ok();
        std::fs::remove_file(&out).ok();
    }

    #[test]
    fn renamed_sheet_leaves_pivots_uncarried() {
        let orig = make_orig_pivot("pivot-rename");
        let out = tmp_path("pivot-rename-out");
        let mut wb = payload_named(&["改名页"]);
        wb.src_path = Some(orig.clone());
        crate::xlsx::write_xlsx_sync(out.clone(), wb).expect("写盘失败");

        let got = load(&out);
        assert!(
            got.iter().all(|(n, _)| !n.starts_with("xl/pivotCache/") && !n.starts_with("xl/pivotTables/")),
            "改名后缓存与透视表都不该凭空出现"
        );
        let wb = entry_str(&got, "xl/workbook.xml").unwrap();
        assert!(!wb.contains("<pivotCaches"), "簿级接线不该有：{wb}");
        std::fs::remove_file(&orig).ok();
        std::fs::remove_file(&out).ok();
    }

    #[test]
    fn tables_and_pics_are_carried() {
        let orig = make_orig("carry", false);
        let out = tmp_path("carry-out");
        let mut wb = payload_named(&["数据"]);
        wb.src_path = Some(orig.clone());
        crate::xlsx::write_xlsx_sync(out.clone(), wb).expect("写盘失败");

        let got = load(&out);
        // 表格部件搬进来了（产物里没有其他表格，编号沿用 1），接线齐全
        assert_eq!(
            entry_str(&got, "xl/tables/table1.xml"),
            Some(TABLE_XML),
            "表格部件应整份照搬"
        );
        let sheet = entry_str(&got, "xl/worksheets/sheet1.xml").unwrap();
        assert!(
            sheet.contains("<tableParts"),
            "sheet 部件应有 tableParts：{sheet}"
        );
        let sheet_rels = entry_str(&got, "xl/worksheets/_rels/sheet1.xml.rels").unwrap();
        assert!(
            sheet_rels.contains(
                "Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/table\""
            ) && sheet_rels.contains("../tables/table1.xml"),
            "sheet rels 应有表格关系：{sheet_rels}"
        );
        // 图片：media 字节原样、锚点并进产物 drawing、embed 换了新号
        assert_eq!(
            got.iter()
                .find(|(n, _)| n == "xl/media/image1.png")
                .map(|(_, d)| d.as_slice()),
            Some(PNG_BYTES),
            "媒体字节应原样搬"
        );
        let drawing = got
            .iter()
            .find(|(n, _)| n.starts_with("xl/drawings/drawing") && n.ends_with(".xml"))
            .map(|(_, d)| String::from_utf8_lossy(d).into_owned())
            .expect("产物里应有 drawing");
        assert!(
            drawing.contains("<xdr:pic"),
            "pic 锚点应并进 drawing：{drawing}"
        );
        assert!(
            drawing.contains("r:embed=\"rIdC1\""),
            "embed 应换成搬入的新号：{drawing}"
        );
        assert!(
            drawing.contains("<xdr:cNvPr id=\"1000\""),
            "cNvPr id 应重排避开撞号：{drawing}"
        );
        assert!(
            sheet.contains("<drawing r:id="),
            "sheet 部件应有 drawing 引用：{sheet}"
        );
        // content types 两笔账都在
        let ct = entry_str(&got, "[Content_Types].xml").unwrap();
        assert!(ct.contains("Extension=\"png\""), "png Default 应补上：{ct}");
        assert!(ct.contains("/xl/tables/table1.xml"), "表格 Override 应在：{ct}");
        // 产物仍是合法的工作簿（calamine 能开、数据还在）
        let wb2 = calamine::open_workbook_auto(&out).expect("产物应能被 calamine 打开");
        assert_eq!(wb2.sheet_names(), vec!["数据".to_string()]);
        let back = crate::xlsx::read_xlsx_sync(out.clone()).expect("产物应能读回");
        assert_eq!(back.sheets[0].cells[0].v, Some(json!("新值")));
        std::fs::remove_file(&orig).ok();
        std::fs::remove_file(&out).ok();
    }

    #[test]
    fn pics_merge_into_crate_chart_drawing() {
        // 该表有 crate 图表（payload 带图表）→ 搬来的图片应并入**同一份** drawing，不开新档
        let orig = make_orig("merge", false);
        let out = tmp_path("merge-out");
        let mut wb = payload_named(&["数据"]);
        wb.sheets[0].cells.push(CellPayload {
            r: 0,
            c: 1,
            v: Some(json!(7.0)),
            ..Default::default()
        });
        wb.sheets[0].charts = vec![crate::xlsx::ChartPayload {
            chart_type: "column".into(),
            grouping: String::new(),
            title: "测试图".into(),
            radar_style: None,
            scatter_style: None,
            anchor_row: 3,
            anchor_col: 3,
            width: 480,
            height: 288,
            // crate 对零系列的图表 insert_chart 直接报错，真图表至少有一条系列
            series: vec![crate::xlsx::ChartSeries {
                name: "系列".into(),
                cat: None,
                val: crate::xlsx::RangeRef {
                    sheet: String::new(),
                    r1: 0,
                    c1: 1,
                    r2: 0,
                    c2: 1,
                },
                cats: Vec::new(),
                vals: vec![7.0],
                chart_type: None,
                secondary_axis: false,
            }],
            axes: vec![],
        }];
        wb.src_path = Some(orig.clone());
        crate::xlsx::write_xlsx_sync(out.clone(), wb).expect("写盘失败");

        let got = load(&out);
        let sheet = entry_str(&got, "xl/worksheets/sheet1.xml").unwrap();
        // crate 图表已经让 sheet 带着 drawing 引用，搬入不许再加第二枚
        assert_eq!(
            sheet.matches("<drawing r:id=").count(),
            1,
            "drawing 引用只许一枚：{sheet}"
        );
        let drawing = got
            .iter()
            .filter(|(n, _)| n.starts_with("xl/drawings/drawing") && n.ends_with(".xml"))
            .map(|(_, d)| String::from_utf8_lossy(d).into_owned())
            .collect::<Vec<_>>()
            .join("\n----\n");
        assert!(
            drawing.contains("graphicFrame") && drawing.contains("<xdr:pic"),
            "同一份 drawing 里应既有 crate 图表又有搬来的图片：{drawing}"
        );
        std::fs::remove_file(&orig).ok();
        std::fs::remove_file(&out).ok();
    }

    #[test]
    fn renamed_sheet_leaves_notes_and_carries_nothing() {
        let orig = make_orig("rename", false);
        let out = tmp_path("rename-out");
        let mut wb = payload_named(&["改名页"]);
        wb.src_path = Some(orig.clone());
        crate::xlsx::write_xlsx_sync(out.clone(), wb).expect("写盘失败");

        let got = load(&out);
        let sheet = entry_str(&got, "xl/worksheets/sheet1.xml").unwrap();
        assert!(!sheet.contains("<tableParts"), "改了名就不该搬：{sheet}");
        assert!(
            got.iter().all(|(n, _)| !n.starts_with("xl/media/")),
            "媒体不该凭空出现"
        );
        // 账要说得出：原件那几张东西为什么没了
        let out2 = tmp_path("rename-out2");
        let notes = crate::xlsx::write_xlsx_sync(out2, {
            let mut w = payload_named(&["改名页"]);
            w.src_path = Some(orig.clone());
            w
        })
        .expect("写盘失败");
        assert!(
            notes.iter().any(|n| n.contains("没有同名表")),
            "应记一条改名的账：{notes:?}"
        );
        std::fs::remove_file(&orig).ok();
        std::fs::remove_file(&out).ok();
        std::fs::remove_file(tmp_path("rename-out2")).ok();
    }

    #[test]
    fn missing_src_falls_back_with_note() {
        let out = tmp_path("fallback");
        let mut wb = payload_named(&["数据"]);
        wb.src_path = Some(tmp_path("不存在的原件"));
        let notes = crate::xlsx::write_xlsx_sync(out.clone(), wb).expect("写盘失败");
        assert!(
            notes.iter().any(|n| n.contains("保留式写回没启用")),
            "原件不在应记账退回：{notes:?}"
        );
        let r = calamine::open_workbook_auto(&out).expect("退回产物仍应能打开");
        assert_eq!(r.sheet_names(), vec!["数据".to_string()]);
        std::fs::remove_file(&out).ok();
    }
}
