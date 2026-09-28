//! 单元格的两位邻居（批注 / 超链接）在 xlsx 里的读写。
//!
//! 与 v0.46 那三类规则不同，这两样都不住在 worksheet 的 `<sheetData>` 里：
//! - 批注在**独立部件**——老式 `xl/commentsN.xml`（`<authors>` 表 + `comment@ref`，正文里常带一行
//!   「作者:」前缀）与新式 `xl/threadedComments/*.xml`（作者住 `xl/persons/person.xml`，Excel 为兼容
//!   会把同一条批注**两份都写**）；部件归属只能靠 sheet 的 rels 认，不能按 `sheetN ↔ commentsN` 猜。
//! - 超链接的 `ref` 在 worksheet 上，外部地址却在其 rels 里（`r:id` → Target），表内跳转才是 `location` 字面。
//!
//! 认不出的形状一律记账，不挑个像样的凑数。

use std::collections::HashMap;
use std::fs::File;
use std::io::{Cursor, Read, Write};

use quick_xml::events::Event;
use quick_xml::Reader;
use rust_xlsxwriter::{Note, Workbook, Worksheet};
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

use crate::xlsx::{CellLinkPayload, CellNotePayload, SheetPayload};
use crate::xlsx_chart::{rels_of, resolve_rel};
use crate::xlsx_style::{a1_to_rc, attr_str, read_entry, sheet_paths};

/// 一张表上的批注与链接
#[derive(Clone, Default)]
pub struct SheetSide {
    pub notes: Vec<CellNotePayload>,
    pub links: Vec<CellLinkPayload>,
    /// 这张表上"文件里有、我们的模型装不下"的账
    pub accounts: Vec<String>,
}

#[derive(Default)]
pub struct SideRead {
    pub by_sheet: HashMap<String, SheetSide>,
    /// 整包级别的账（部件认不出属于哪张表这类），不挂在某一张表上冒充归属
    pub accounts: Vec<String>,
}

struct Rel {
    rtype: String,
    target: String,
    external: bool,
}

/// 一条批注在读侧的中间形状：作者与正文已经分开，位置还是 A1 字面
struct RawNote {
    cell: String,
    author: Option<String>,
    text: String,
}

pub fn read_cell_side(path: &str) -> SideRead {
    let mut by_sheet: HashMap<String, SheetSide> = HashMap::new();
    let mut accounts: Vec<String> = Vec::new();
    let Ok(file) = File::open(path) else {
        return SideRead { by_sheet, accounts };
    };
    let Ok(mut zip) = zip::ZipArchive::new(file) else {
        return SideRead { by_sheet, accounts };
    };
    let persons = read_entry(&mut zip, "xl/persons/person.xml")
        .map(|xml| parse_persons(&xml))
        .unwrap_or_default();
    let part_names: Vec<String> = zip.file_names().map(|s| s.to_string()).collect();
    let mut claimed: Vec<String> = Vec::new();
    for (name, sheet_path) in sheet_paths(&mut zip) {
        let Some(xml) = read_entry(&mut zip, &sheet_path) else {
            continue;
        };
        let rels = read_entry(&mut zip, &rels_of(&sheet_path))
            .map(|r| parse_rels(&r))
            .unwrap_or_default();
        // 部件路径先按 rels 算成 owned String，再逐段取 zip——别让 &mut zip 的借用撞上
        let legacy_part = find_rel(&rels, |t| t.ends_with("/comments"))
            .map(|t| resolve_rel(&sheet_path, &t));
        let thread_part = find_rel(&rels, |t| t.contains("threadedComment"))
            .map(|t| resolve_rel(&sheet_path, &t));
        let mut legacy_xml = None;
        if let Some(p) = legacy_part.as_deref() {
            claimed.push(p.to_string());
            legacy_xml = read_entry(&mut zip, p);
        }
        let mut thread_xml = None;
        if let Some(p) = thread_part.as_deref() {
            claimed.push(p.to_string());
            thread_xml = read_entry(&mut zip, p);
        }
        let mut side = SheetSide::default();
        read_links(&xml, &rels, &mut side);
        let legacy = legacy_xml
            .as_deref()
            .map(|x| read_legacy_comments(x))
            .unwrap_or_default();
        let threaded = thread_xml
            .as_deref()
            .map(|x| read_threaded_comments(x, &persons))
            .unwrap_or_default();
        merge_notes(legacy, threaded, &mut side);
        // 气泡多大、是否常开只写在 vmlDrawing 里（那是批注形状的地盘），按格子对回同一条批注
        let vml_part = find_rel(&rels, |t| t.ends_with("/vmlDrawing")).map(|t| resolve_rel(&sheet_path, &t));
        let mut vml_xml = None;
        if let Some(p) = vml_part.as_deref() {
            vml_xml = read_entry(&mut zip, p);
        }
        if let Some(x) = vml_xml.as_deref() {
            apply_note_geometry(x, &mut side);
        }
        // 表上的账说得出是哪张表缺了什么，照旧并进全局账（状态栏再按同类聚合）
        accounts.append(&mut side.accounts);
        if !side.notes.is_empty() || !side.links.is_empty() {
            by_sheet.insert(name, side);
        }
    }
    // 包里剩下没被任何一张表认领的批注部件：说得出数量，不硬分给某张表
    let orphan = part_names
        .iter()
        .filter(|p| {
            (p.starts_with("xl/comments") || p.starts_with("xl/threadedComments/"))
                && !claimed.contains(p)
        })
        .count();
    if orphan > 0 {
        accounts.push(format!("有 {orphan} 个批注部件认不出属于哪张表，未收进来"));
    }
    SideRead { by_sheet, accounts }
}

fn find_rel(rels: &HashMap<String, Rel>, pred: impl Fn(&str) -> bool) -> Option<String> {
    rels.values()
        .find(|r| pred(r.rtype.as_str()))
        .map(|r| r.target.clone())
}

/// rels 里一枚关系：Id → Type/Target/TargetMode（超链接要区分外部地址与包内部件）
fn parse_rels(xml: &str) -> HashMap<String, Rel> {
    let mut out = HashMap::new();
    let mut reader = Reader::from_str(xml);
    while let Ok(ev) = reader.read_event() {
        match ev {
            Event::Empty(e) | Event::Start(e) => {
                if e.local_name().as_ref() == "Relationship" {
                    if let (Some(id), Some(rtype), Some(target)) =
                        (attr_str(&e, "Id"), attr_str(&e, "Type"), attr_str(&e, "Target"))
                    {
                        out.insert(
                            id,
                            Rel {
                                rtype,
                                target,
                                external: attr_str(&e, "TargetMode").as_deref() == Some("External"),
                            },
                        );
                    }
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    out
}

/// 作者表：threadedComment@authorId 对的是 person 的标识，不同工具写的键不一样，两种都收
fn parse_persons(xml: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let mut reader = Reader::from_str(xml);
    while let Ok(ev) = reader.read_event() {
        match ev {
            Event::Empty(e) | Event::Start(e) => {
                if e.local_name().as_ref() == "person" {
                    if let Some(name) = attr_str(&e, "displayName") {
                        for key in ["id", "userId"] {
                            if let Some(v) = attr_str(&e, key) {
                                out.insert(v, name.clone());
                            }
                        }
                    }
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    out
}

/// `<hyperlink ref r:id|location tooltip>`：ref 是格，目标在 rels 或 location 字面里
fn read_links(xml: &str, rels: &HashMap<String, Rel>, side: &mut SheetSide) {
    let mut reader = Reader::from_str(xml);
    while let Ok(ev) = reader.read_event() {
        match ev {
            Event::Empty(e) | Event::Start(e) => {
                if e.local_name().as_ref() != "hyperlink" {
                    continue;
                }
                let Some(raw_ref) = attr_str(&e, "ref") else {
                    side.accounts.push("有链接没写它在哪一格，未收进来".to_string());
                    continue;
                };
                let Some((r, c)) = a1_to_rc(raw_ref.split(':').next().unwrap_or(raw_ref.as_str()))
                else {
                    side.accounts
                        .push(format!("有链接的位置「{raw_ref}」认不出来，未收进来"));
                    continue;
                };
                if raw_ref.contains(':') {
                    side.accounts.push(format!(
                        "第 {} 行第 {} 列的链接写着一片区域，只按左上角收",
                        r + 1,
                        c + 1
                    ));
                }
                let location = attr_str(&e, "location").filter(|s| !s.is_empty());
                let rel = attr_str(&e, "id")
                    .as_deref()
                    .and_then(|id| rels.get(id));
                let mut link = CellLinkPayload {
                    r,
                    c,
                    ..Default::default()
                };
                match (location, rel) {
                    (Some(loc), _) => link.location = Some(loc),
                    // 非 External 的 rel 指向包内部件（另一张表那种），不是地址，别当成 url
                    (None, Some(x)) if x.external => link.url = Some(x.target.clone()),
                    (None, _) => {
                        side.accounts.push(format!(
                            "第 {} 行第 {} 列的链接没有可用的目标地址，未收进来",
                            r + 1,
                            c + 1
                        ));
                        continue;
                    }
                }
                link.tip = attr_str(&e, "tooltip").filter(|s| !s.is_empty());
                side.links.push(link);
            }
            Event::Eof => break,
            _ => {}
        }
    }
    side.links.sort_by_key(|l| (l.r, l.c));
}

/// 老式批注部件：`<authors>` 是表、`comment@authorId` 是下标，正文在 `<text>` 的若干 `<r><t>` 里
fn read_legacy_comments(xml: &str) -> Vec<RawNote> {
    let mut reader = Reader::from_str(xml);
    let mut authors: Vec<String> = Vec::new();
    let mut out: Vec<RawNote> = Vec::new();
    let (mut in_authors, mut in_author, mut in_comment, mut in_text, mut in_t) =
        (false, false, false, false, false);
    let mut buf = String::new();
    let mut text = String::new();
    let mut cell = String::new();
    let mut author_id = usize::MAX;
    while let Ok(ev) = reader.read_event() {
        let empty = matches!(ev, Event::Empty(_));
        match ev {
            Event::Start(e) | Event::Empty(e) => match e.local_name().as_ref() {
                "authors" => in_authors = true,
                "author" if in_authors => {
                    in_author = true;
                    buf.clear();
                    if empty {
                        authors.push(String::new());
                        in_author = false;
                    }
                }
                "comment" => {
                    cell = attr_str(&e, "ref").unwrap_or_default();
                    author_id = attr_str(&e, "authorId")
                        .and_then(|s| s.trim().parse::<usize>().ok())
                        .unwrap_or(usize::MAX);
                    text.clear();
                    in_comment = true;
                    if empty {
                        out.push(RawNote {
                            cell: std::mem::take(&mut cell),
                            author: authors
                                .get(author_id)
                                .cloned()
                                .filter(|a| !a.trim().is_empty()),
                            text: String::new(),
                        });
                        in_comment = false;
                    }
                }
                "text" if in_comment => in_text = true,
                "t" if in_text => in_t = true,
                _ => {}
            },
            Event::Text(t) => {
                let s = t.as_ref().to_string();
                if in_author {
                    buf.push_str(&s);
                } else if in_t {
                    text.push_str(&s);
                }
            }
            // quick-xml 0.42 把 &amp;/&#x…; 拆成独立事件：先还原成转义形状，末尾统一解一次
            Event::GeneralRef(r) => {
                if in_author {
                    push_entity(&mut buf, r.as_ref());
                } else if in_t {
                    push_entity(&mut text, r.as_ref());
                }
            }
            Event::End(e) => match e.local_name().as_ref() {
                "authors" => in_authors = false,
                "author" if in_author => {
                    authors.push(unesc(&std::mem::take(&mut buf)));
                    in_author = false;
                }
                "t" => in_t = false,
                "text" => in_text = false,
                "comment" if in_comment => {
                    out.push(RawNote {
                        cell: std::mem::take(&mut cell),
                        author: authors.get(author_id).cloned().filter(|a| !a.trim().is_empty()),
                        text: unesc(&std::mem::take(&mut text)),
                    });
                    in_comment = false;
                }
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
    }
    out
}

/// 新式批注部件：同一条线程按文档序连着写，第一条是正文、其后是回复
fn read_threaded_comments(xml: &str, persons: &HashMap<String, String>) -> Vec<RawNote> {
    let mut reader = Reader::from_str(xml);
    let mut out: Vec<RawNote> = Vec::new();
    let (mut in_item, mut in_text) = (false, false);
    let mut cell = String::new();
    let mut author_key = String::new();
    let mut text = String::new();
    while let Ok(ev) = reader.read_event() {
        let empty = matches!(ev, Event::Empty(_));
        match ev {
            Event::Start(e) | Event::Empty(e) => {
                if e.local_name().as_ref() == "threadedComment" {
                    cell = attr_str(&e, "ref").unwrap_or_default();
                    author_key = attr_str(&e, "authorId").unwrap_or_default();
                    text.clear();
                    in_item = true;
                    if empty {
                        out.push(finish_threaded(&cell, &author_key, String::new(), persons));
                        in_item = false;
                    }
                } else if in_item && e.local_name().as_ref() == "text" {
                    in_text = true;
                }
            }
            Event::Text(t) if in_text => text.push_str(t.as_ref()),
            Event::GeneralRef(r) if in_text => push_entity(&mut text, r.as_ref()),
            Event::End(e) => {
                if e.local_name().as_ref() == "text" {
                    in_text = false;
                } else if e.local_name().as_ref() == "threadedComment" && in_item {
                    out.push(finish_threaded(
                        &cell,
                        &author_key,
                        unesc(&std::mem::take(&mut text)),
                        persons,
                    ));
                    in_item = false;
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    out
}

fn finish_threaded(
    cell: &str,
    author_key: &str,
    text: String,
    persons: &HashMap<String, String>,
) -> RawNote {
    RawNote {
        cell: cell.to_string(),
        author: persons.get(author_key).cloned(),
        text,
    }
}

/// 两份写法归一成"一格一枚"：同一条批注不重复收，回复并进正文（我们的模型只有一层）
fn merge_notes(legacy: Vec<RawNote>, threaded: Vec<RawNote>, side: &mut SheetSide) {
    let mut by_cell: HashMap<(u32, u32), usize> = HashMap::new();
    for n in legacy {
        let Some((r, c)) = rc_of(&n.cell) else {
            side.accounts
                .push(format!("有批注的位置「{}」认不出来，未收进来", n.cell));
            continue;
        };
        let text = match n.author.as_deref() {
            Some(a) if !a.is_empty() => strip_author_prefix(&n.text, a),
            _ => n.text.clone(),
        };
        if text.is_empty() {
            side.accounts
                .push(format!("第 {} 行第 {} 列的批注没有正文，未收进来", r + 1, c + 1));
            continue;
        }
        by_cell.insert((r, c), side.notes.len());
        side.notes.push(CellNotePayload {
            r,
            c,
            text,
            author: n.author,
            ..Default::default()
        });
    }
    // 同一 ref 的线程：第一条是正文，其余是回复
    let mut groups: Vec<((u32, u32), Vec<RawNote>)> = Vec::new();
    for n in threaded {
        let Some(rc) = rc_of(&n.cell) else {
            side.accounts
                .push(format!("有批注回复的位置「{}」认不出来，未收进来", n.cell));
            continue;
        };
        match groups.last_mut() {
            Some(((r2, c2), list)) if (*r2, *c2) == rc => list.push(n),
            _ => groups.push((rc, vec![n])),
        }
    }
    let mut replies = 0usize;
    for ((r, c), list) in groups {
        let Some(head) = list.first() else { continue };
        let extra = &list[1..];
        if !extra.is_empty() {
            replies += extra.len();
        }
        let tail: Vec<String> = extra
            .iter()
            .map(|x| join_author(x.author.as_deref(), &x.text))
            .collect();
        let body = &head.text;
        match by_cell.get(&(r, c)) {
            // Excel 的同一条批注两份写法：去前缀后同文就是同一枚，只补作者
            Some(&i) if same_note(&side.notes[i].text, body) => {
                if side.notes[i].author.is_none() {
                    side.notes[i].author = head.author.clone();
                }
                if !tail.is_empty() {
                    side.notes[i].text = format!("{}\n{}", side.notes[i].text, tail.join("\n"));
                }
            }
            Some(&i) => {
                side.accounts.push(format!(
                    "第 {} 行第 {} 列的批注有两份写法且内容不同，按新式那份收",
                    r + 1,
                    c + 1
                ));
                side.notes[i].text = join_all(body, &tail);
                side.notes[i].author = head.author.clone();
            }
            None => {
                by_cell.insert((r, c), side.notes.len());
                side.notes.push(CellNotePayload {
                    r,
                    c,
                    text: join_all(body, &tail),
                    author: head.author.clone(),
                    ..Default::default()
                });
            }
        }
    }
    if replies > 0 {
        side.accounts
            .push(format!("有 {replies} 条批注的回复被并进了正文（我们的模型不分层）"));
    }
    side.notes.sort_by_key(|n| (n.r, n.c));
}

/// 气泡的宽高与"是否一直开着"不在 comments 里，而在 vmlDrawing 的 `<v:shape>` 上
/// （`style` 给 pt，`<x:Row>/<x:Column>` 给 0 基格子，`<x:Visible/>` 给常开）。
/// 认不出格子的形状一律放过——批注正文已经在手，别让形状读不出来反倒拖累它。
fn apply_note_geometry(vml: &str, side: &mut SheetSide) {
    let mut reader = Reader::from_str(vml);
    let (mut style, mut row, mut col, mut visible) =
        (String::new(), None::<u32>, None::<u32>, false);
    let mut field = 0u8; // 1=Row 2=Column
    let mut digits = String::new();
    while let Ok(ev) = reader.read_event() {
        let empty = matches!(ev, Event::Empty(_));
        match ev {
            Event::Start(e) | Event::Empty(e) => match e.local_name().as_ref() {
                "shape" | "rect" | "rectangular" => {
                    style = attr_str(&e, "style").unwrap_or_default();
                    row = None;
                    col = None;
                    visible = false;
                    field = 0;
                    if empty {
                        stamp_note(&style, row, col, visible, side);
                    }
                }
                "Row" => {
                    field = 1;
                    digits.clear();
                    if empty {
                        field = 0;
                    }
                }
                "Column" => {
                    field = 2;
                    digits.clear();
                    if empty {
                        field = 0;
                    }
                }
                "Visible" => visible = true,
                _ => {}
            },
            Event::Text(t) if field > 0 => digits.push_str(t.as_ref()),
            Event::End(e) => match e.local_name().as_ref() {
                "Row" | "Column" => {
                    let v = digits.trim().parse::<u32>().ok();
                    if field == 1 {
                        row = v;
                    } else if field == 2 {
                        col = v;
                    }
                    field = 0;
                    digits.clear();
                }
                "shape" | "rect" | "rectangular" => {
                    stamp_note(&style, row, col, visible, side);
                    field = 0;
                }
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
    }
}

fn stamp_note(style: &str, row: Option<u32>, col: Option<u32>, visible: bool, side: &mut SheetSide) {
    let Some((r, c)) = row.zip(col) else { return };
    let Some(n) = side.notes.iter_mut().find(|n| n.r == r && n.c == c) else {
        return;
    };
    if n.show.ne(&Some(true)) && visible {
        n.show = Some(true);
    }
    // VML 用 pt，Univer 与我们的载荷用 px（96/72 = 4/3）
    let (w, h) = (
        style_len(style, "width").map(|pt| pt * 4.0 / 3.0),
        style_len(style, "height").map(|pt| pt * 4.0 / 3.0),
    );
    // 气泡尺寸在 VML 里总是写着的，写的就是 Excel 的默认档（96pt×55.5pt = 128×74 px）：
    // 那不代表用户设过尺寸，照抄进载荷会让"没声明"变成"声明了默认值"，重存一次就回不去了
    if w == Some(DEFAULT_NOTE_PX.0) && h == Some(DEFAULT_NOTE_PX.1) {
        return;
    }
    if n.width.is_none() {
        n.width = w;
    }
    if n.height.is_none() {
        n.height = h;
    }
}

/// Excel（和 rust_xlsxwriter）没设尺寸时画出来的那档气泡
const DEFAULT_NOTE_PX: (f64, f64) = (128.0, 74.0);

/// 从 `width:120pt;height:67.5pt;…` 里取一项的长度（只认 pt，认不出的单位交回 None 而不是照数硬用）
fn style_len(style: &str, key: &str) -> Option<f64> {
    for part in style.split(';') {
        let Some(raw) = part.trim().strip_prefix(key).and_then(|s| s.trim().strip_prefix(':'))
        else {
            continue;
        };
        let raw = raw.trim();
        let num = raw.strip_suffix("pt")?.trim();
        let pt = num.parse::<f64>().ok()?;
        if pt > 0.0 {
            return Some(pt);
        }
        return None;
    }
    None
}

fn join_all(body: &str, tail: &[String]) -> String {
    if tail.is_empty() {
        return body.to_string();
    }
    format!("{}\n{}", body, tail.join("\n"))
}

fn same_note(legacy: &str, threaded: &str) -> bool {
    let (a, b) = (legacy.trim(), threaded.trim());
    !b.is_empty() && (a == b || a.ends_with(b) || b.contains(a))
}

/// 事件流里的正文是原始字节（未解实体），交出去前统一解一次
fn unesc(s: &str) -> String {
    quick_xml::escape::unescape(s)
        .map(|c| c.into_owned())
        .unwrap_or_else(|_| s.to_string())
}

/// quick-xml 0.42 把 `&amp;` 这类实体拆成独立事件（不带 & 与 ;）：补回转义形状，末尾再统一解一次
fn push_entity(buf: &mut String, raw: &str) {
    buf.push('&');
    buf.push_str(raw);
    buf.push(';');
}

fn join_author(author: Option<&str>, body: &str) -> String {
    match author {
        Some(a) if !a.is_empty() => format!("{a}: {body}"),
        _ => body.to_string(),
    }
}

fn rc_of(cell: &str) -> Option<(u32, u32)> {
    a1_to_rc(cell.split(':').next().unwrap_or(cell))
}

/// 一格一枚批注时 Excel 会把作者写在正文第一行；只有认得出作者才剥这层前缀
fn strip_author_prefix(raw: &str, author: &str) -> String {
    for sep in [':', '：'] {
        let head = format!("{author}{sep}");
        if let Some(rest) = raw.strip_prefix(head.as_str()) {
            return rest.trim_start_matches(['\r', '\n', ' ', '\t']).to_string();
        }
    }
    raw.to_string()
}

/// 写侧：批注走 Note（作者住在 authors 表里，不重复写进气泡正文），链接走 Url
/// 写侧一趟的收获：这趟的账，加上这张表的作者表在产物里**应该**长什么样
#[derive(Default)]
pub struct SheetSideWrite {
    pub accounts: Vec<String>,
    /// 只有真插进了批注才有：没有批注的表根本不会生成 comments 部件
    pub authors: Option<AuthorTable>,
}

/// 一张表的作者表，用来核对与重排产物里的 `<authors>`（见 [`save_workbook`]）
#[derive(Clone, Default)]
pub struct AuthorTable {
    /// 第 i 项 = `authorId` 为 i 的署名；第 0 项恒是空串（"没人署过"在表里的样子）
    names: Vec<String>,
    /// 按格子序（行→列）排的 A1 位置，与产物里 `<comment>` 元素的文档序一致
    refs: Vec<String>,
}

impl AuthorTable {
    /// 产物里那张表按名字排序写出、编号却按格子序登记（rust_xlsxwriter 0.99.1 的写法）：
    /// 两种顺序一致时不必重排，绝大多数件（没批注或只有一位署名）走这条
    fn needs_rewrite(&self) -> bool {
        let mut sorted = self.names.clone();
        sorted.sort();
        sorted != self.names
    }
}

pub fn write_sheet_side(ws: &mut Worksheet, sheet: &SheetPayload) -> SheetSideWrite {
    let mut accounts: Vec<String> = Vec::new();
    // 格子 → 署名（后写的算，跟 crate 的 notes 映射一样按格子归并），末尾按格子序换出登记表
    let mut signed: HashMap<(u32, u32), String> = HashMap::new();
    // 链接先写：store_url 落一格文本，随后的普通格写入只覆盖值与格式，<hyperlink> 元素照旧在
    for l in &sheet.links {
        let Ok(col) = u16::try_from(l.c) else {
            accounts.push(format!("第 {} 行有一枚链接的列超出可写范围，未写入", l.r + 1));
            continue;
        };
        let Some(target) = link_target(l) else {
            accounts.push(format!(
                "第 {} 行第 {} 列的链接既没有外部地址也没有表内跳转目标，未写入",
                l.r + 1,
                l.c + 1
            ));
            continue;
        };
        let text = display_text(sheet, l.r, l.c);
        let tip = l.tip.clone().unwrap_or_default();
        let direct = ws.write_url_with_options(
            l.r,
            col,
            target.as_str(),
            text.as_str(),
            tip.as_str(),
            None,
        );
        let written = direct.is_ok()
            // 没有 scheme 的目标（指向同目录另一个文件这类）按 OOXML 的 file 形状补一次再试
            || (target.contains(':') == false
                && ws
                    .write_url_with_options(
                        l.r,
                        col,
                        format!("file://{target}").as_str(),
                        text.as_str(),
                        tip.as_str(),
                        None,
                    )
                    .is_ok());
        if !written {
            accounts.push(format!(
                "第 {} 行第 {} 列的链接（{}）摆不进 OOXML，未写入",
                l.r + 1,
                l.c + 1,
                trim_for_account(target.as_str())
            ));
        }
    }
    for n in &sheet.notes {
        let Ok(col) = u16::try_from(n.c) else {
            accounts.push(format!("第 {} 行有一条批注的列超出可写范围，未写入", n.r + 1));
            continue;
        };
        if n.text.is_empty() {
            accounts.push(format!(
                "第 {} 行第 {} 列的批注没有正文，未写入",
                n.r + 1,
                n.c + 1
            ));
            continue;
        }
        let mut note = Note::new(n.text.as_str()).add_author_prefix(false);
        // 没署名也要占一格：crate 给"没有作者"的批注准备的槽位写的是字面量 Author，
        // 指过去就等于替用户签了个名——空作者才是"没人署过"在 OOXML 里的样子
        let mut author = n.author.as_deref().map(str::trim).unwrap_or("").to_string();
        if author.chars().count() > 52 {
            accounts.push(format!(
                "第 {} 行第 {} 列的批注作者超过 52 字（Excel 的上限），作者未写入",
                n.r + 1,
                n.c + 1
            ));
            author = String::new();
        } else {
            note = note.set_author(author.as_str());
        }
        if let Some(w) = n.width.filter(|w| *w > 0.0) {
            note = note.set_width(w.round().max(1.0) as u32);
        }
        if let Some(h) = n.height.filter(|h| *h > 0.0) {
            note = note.set_height(h.round().max(1.0) as u32);
        }
        if n.show == Some(true) {
            note = note.set_visible(true);
        }
        if ws.insert_note(n.r, col, &note).is_err() {
            accounts.push(format!(
                "第 {} 行第 {} 列的批注放不下（超出行列范围或正文长度上限），未写入",
                n.r + 1,
                n.c + 1
            ));
        } else {
            signed.insert((n.r, u32::from(col)), author);
        }
    }
    if !signed.is_empty() {
        // crate 给"没有作者"的批注准备的槽位写的是字面量 Author，指过去就等于替用户签了个名；
        // 把那张表的第 0 格换成空串，没署名的批注才真的没人署过
        ws.set_default_note_author("");
    }
    if signed.is_empty() {
        // 一张批注都没插进（正文空、列越界……）就不会有 comments 部件，别占一个编号
        return SheetSideWrite { accounts, authors: None };
    }
    // 登记序（作者表的编号按它给）是格子序而不是载荷里的书写序，这里就按格子序数一遍
    let mut cells: Vec<(u32, u32)> = signed.keys().copied().collect();
    cells.sort_unstable();
    let mut names = vec![String::new()];
    let mut refs = Vec::with_capacity(cells.len());
    for (r, c) in cells {
        refs.push(rc_to_a1(r, c));
        let name = &signed[&(r, c)];
        if !name.is_empty() && !names.contains(name) {
            names.push(name.clone());
        }
    }
    SheetSideWrite {
        accounts,
        authors: Some(AuthorTable { names, refs }),
    }
}

/// 格子 → A1（产物里的 `<comment ref>` 就是这个形状）
fn rc_to_a1(r: u32, c: u32) -> String {
    let mut col = c + 1;
    let mut letters = String::new();
    while col > 0 {
        let rem = (col - 1) % 26;
        letters.insert(0, (b'A' + rem as u8) as char);
        col = (col - 1) / 26;
    }
    format!("{letters}{}", r + 1)
}

/// 存盘：`wb` 先落到内存，需要改字节的部件（批注作者表 / 打印设置的半边）在一次重打包里一起换掉。
///
/// 为什么需要这一趟：rust_xlsxwriter 0.99.1 把 `<authors>` 按名字排序写出，而 `<comment authorId>`
/// 用的是"按格子序首次出现"的编号（packager 只把 BTreeMap 的键抄出来，编号却是登记序）。
/// 于是 A1=李四、A2=张三 的件在 Excel 里会把 A1 显示成张三——署名串到了别人头上。
/// 载荷里那张表我们自己数得出来，就按编号重排回去；数不上（产物与预期对不齐）宁可不动也不猜。
/// 同一趟里还要补 worksheet 上的打印设置（crate 只写 odd 页眉页脚，起始页码又落错了属性）。
pub fn save_workbook(
    path: &str,
    wb: &mut Workbook,
    tables: &[Option<AuthorTable>],
    print: &[(String, crate::xlsx_print::PrintPatch)],
) -> Result<Vec<String>, String> {
    let bytes = wb.save_to_buffer().map_err(|e| format!("保存失败: {e}"))?;
    // `xl/comments1.xml`、`comments2.xml`… 按"有批注的表"的先后编号（crate 的 write_comment_files），
    // 所以第 i 份归第 i 张有批注的表
    let mut want: Vec<(String, Fix<'_>)> = Vec::new();
    let mut idx = 1usize;
    for t in tables.iter().filter_map(|x| x.as_ref()) {
        if t.needs_rewrite() {
            want.push((format!("xl/comments{idx}.xml"), Fix::Authors(t)));
        }
        idx += 1;
    }
    for (part, p) in print {
        want.push((part.clone(), Fix::Print(p)));
    }
    if want.is_empty() {
        std::fs::write(path, bytes).map_err(|e| format!("保存失败: {e}"))?;
        return Ok(Vec::new());
    }
    let (out, accounts) = rezip_parts(&bytes, want.as_slice())?;
    std::fs::write(path, out).map_err(|e| format!("保存失败: {e}"))?;
    Ok(accounts)
}

/// 重打包要动的两类部件（都是"只换点名的那一个，其余原样搬"）
enum Fix<'a> {
    Authors(&'a AuthorTable),
    Print(&'a crate::xlsx_print::PrintPatch),
}

/// 整包重打包，只换掉点名的那几个部件（其余条目原样搬过去、压缩方式照旧）
fn rezip_parts(bytes: &[u8], want: &[(String, Fix<'_>)]) -> Result<(Vec<u8>, Vec<String>), String> {
    let mut src = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| format!("保存失败: {e}"))?;
    let mut done = vec![false; want.len()];
    let mut accounts: Vec<String> = Vec::new();
    let out = Cursor::new(Vec::new());
    let mut zw = ZipWriter::new(out);
    for i in 0..src.len() {
        let mut f = src.by_index(i).map_err(|e| format!("保存失败: {e}"))?;
        let name = f.name().to_string();
        let opt = SimpleFileOptions::default().compression_method(f.compression());
        let Some(k) = want.iter().position(|(n, _)| *n == name) else {
            zw.start_file(name.as_str(), opt)
                .map_err(|e| format!("保存失败: {e}"))?;
            std::io::copy(&mut f, &mut zw).map_err(|e| format!("保存失败: {e}"))?;
            continue;
        };
        let mut text = String::new();
        f.read_to_string(&mut text)
            .map_err(|e| format!("保存失败: {e}"))?;
        let (body, fixed) = match want[k].1 {
            Fix::Authors(table) => match swap_authors(text.as_str(), table) {
                Some(new) => (new, true),
                // 数不上就不动：把署名的作者名硬搬到别人格子上，比留一条账恶劣得多
                None => {
                    accounts.push(format!(
                        "{} 的作者表与载荷对不上，那张表的批注署名可能对在别的作者名下",
                        want[k].0
                    ));
                    (text, false)
                }
            },
            Fix::Print(patch) => {
                let (new, mut notes) = crate::xlsx_print::patch_part_xml(text.as_str(), patch);
                accounts.append(&mut notes);
                (new, true)
            }
        };
        done[k] = done[k] || fixed;
        zw.start_file(name.as_str(), opt)
            .map_err(|e| format!("保存失败: {e}"))?;
        zw.write_all(body.as_bytes())
            .map_err(|e| format!("保存失败: {e}"))?;
    }
    for (k, got) in done.iter().enumerate() {
        if *got {
            continue;
        }
        match want[k].1 {
            Fix::Authors(_) => accounts.push(format!(
                "产物里没有 {}，那张表的批注没写出去",
                want[k].0
            )),
            Fix::Print(_) => accounts.push(format!(
                "产物里没有 {}，那张表的页眉页脚、起始页码或缺省行高没写出去",
                want[k].0
            )),
        }
    }
    let out = zw.finish().map_err(|e| format!("保存失败: {e}"))?;
    Ok((out.into_inner(), accounts))
}

/// 把 `<authors>` 整块换成按编号排的那份；核对不过就返回 None（宁可不改）
fn swap_authors(xml: &str, table: &AuthorTable) -> Option<String> {
    let (names, refs) = read_comment_table(xml)?;
    let mut got = names;
    let mut want = table.names.clone();
    got.sort();
    want.sort();
    if got != want || refs != table.refs {
        return None;
    }
    let head = xml.find("<authors>")? + "<authors>".len();
    let tail = xml.find("</authors>")?;
    let mut out = String::with_capacity(xml.len() + table.names.len() * 20);
    out.push_str(&xml[..head]);
    for name in &table.names {
        out.push_str("<author>");
        out.push_str(xml_escape(name).as_str());
        out.push_str("</author>");
    }
    out.push_str(&xml[tail..]);
    Some(out)
}

/// 产物里的作者表与批注位置（文档序）：重排前得先确认这份件就是我们刚写出去的那份
fn read_comment_table(xml: &str) -> Option<(Vec<String>, Vec<String>)> {
    let mut reader = Reader::from_str(xml);
    let mut authors: Vec<String> = Vec::new();
    let mut refs: Vec<String> = Vec::new();
    let mut in_authors = false;
    let mut in_author = false;
    let mut buf = String::new();
    while let Ok(ev) = reader.read_event() {
        let empty = matches!(ev, Event::Empty(_));
        match ev {
            Event::Start(e) | Event::Empty(e) => match e.local_name().as_ref() {
                "authors" => in_authors = true,
                "author" if in_authors => {
                    if empty {
                        authors.push(String::new());
                    } else {
                        in_author = true;
                        buf.clear();
                    }
                }
                "comment" => refs.push(attr_str(&e, "ref").unwrap_or_default()),
                _ => {}
            },
            Event::Text(t) if in_author => buf.push_str(t.as_ref()),
            Event::GeneralRef(r) if in_author => push_entity(&mut buf, r.as_ref()),
            Event::End(e) => match e.local_name().as_ref() {
                "author" => {
                    authors.push(unesc(&std::mem::take(&mut buf)));
                    in_author = false;
                }
                "authors" => in_authors = false,
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
    }
    Some((authors, refs))
}

/// 作者名进 XML 正文：五个预定义实体，认不出的原样留着（载荷里本来就允许任意字符）
fn xml_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(ch),
        }
    }
    out
}

fn link_target(l: &CellLinkPayload) -> Option<String> {
    if let Some(url) = l.url.as_deref().filter(|s| !s.is_empty()) {
        return Some(url.to_string());
    }
    l.location
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(|s| format!("internal:{s}"))
}

/// 链接格的显示文本取格子的值；空格外壳交给 crate 按目标自动补
fn display_text(sheet: &SheetPayload, r: u32, c: u32) -> String {
    sheet
        .cells
        .iter()
        .find(|x| x.r == r && x.c == c)
        .and_then(|x| x.v.as_ref())
        .map(crate::xlsx::cell_text)
        .unwrap_or_default()
}

fn trim_for_account(s: &str) -> String {
    let n = s.chars().count();
    if n <= 40 {
        return s.to_string();
    }
    let mut out: String = s.chars().take(40).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xlsx::{read_xlsx_sync, write_xlsx_sync, CellPayload, WorkbookPayload};
    use serde_json::{json, Value};

    fn cell(r: u32, c: u32, v: Value) -> CellPayload {
        CellPayload {
            r,
            c,
            v: Some(v),
            ..Default::default()
        }
    }

    fn note(r: u32, c: u32, text: &str, author: Option<&str>) -> CellNotePayload {
        CellNotePayload {
            r,
            c,
            text: text.into(),
            author: author.map(Into::into),
            ..Default::default()
        }
    }

    fn link(
        r: u32,
        c: u32,
        url: Option<&str>,
        loc: Option<&str>,
        tip: Option<&str>,
    ) -> CellLinkPayload {
        CellLinkPayload {
            r,
            c,
            url: url.map(Into::into),
            location: loc.map(Into::into),
            tip: tip.map(Into::into),
        }
    }

    fn sheet(
        name: &str,
        cells: Vec<CellPayload>,
        notes: Vec<CellNotePayload>,
        links: Vec<CellLinkPayload>,
    ) -> SheetPayload {
        SheetPayload {
            name: name.into(),
            cells,
            notes,
            links,
            ..Default::default()
        }
    }

    fn tmp(tag: &str) -> String {
        std::env::temp_dir()
            .join(format!("oof-side-{tag}-{}.xlsx", std::process::id()))
            .to_string_lossy()
            .to_string()
    }

    fn entry(path: &str, name: &str) -> String {
        let file = File::open(path).expect("打开产物失败");
        let mut zip = zip::ZipArchive::new(file).expect("产物不是 zip");
        read_entry(&mut zip, name).unwrap_or_else(|| panic!("产物里没有 {name}"))
    }

    /// 重打包：加部件，并往 worksheet 的 rels 末尾补一段关系（手搭 threaded 批注用）
    fn rezip(src: &str, dst: &str, add: &[(&str, &str)], rels_tail: &str) {
        let file = File::open(src).expect("打开失败");
        let mut zip = zip::ZipArchive::new(file).expect("不是 zip");
        let mut parts: Vec<(String, Vec<u8>)> = Vec::new();
        for i in 0..zip.len() {
            let mut f = zip.by_index(i).expect("index");
            let name = f.name().to_string();
            let mut buf = Vec::new();
            f.read_to_end(&mut buf).expect("读失败");
            if !rels_tail.is_empty() && name.starts_with("xl/worksheets/") && name.ends_with(".rels") {
                let mut s = String::from_utf8_lossy(&buf).to_string();
                s = s.replace("</Relationships>", &format!("{rels_tail}</Relationships>"));
                buf = s.into_bytes();
            }
            parts.push((name, buf));
        }
        for (name, body) in add {
            parts.push(((*name).to_string(), (*body).as_bytes().to_vec()));
        }
        let out = File::create(dst).expect("创建失败");
        let mut zw = ZipWriter::new(std::io::BufWriter::new(out));
        let opt = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        for (name, buf) in &parts {
            zw.start_file(name.as_str(), opt).expect("start_file");
            zw.write_all(buf).expect("write");
        }
        zw.finish().expect("finish");
    }

    const PERSONS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><persons xmlns="http://schemas.openxmlformats.org/office/2018/08/coauthoring"><person displayName="张三" uniqueName="张三@example.com" id="ID.1"/><person displayName="李四" id="ID.2"/></persons>"#;

    const THREADED: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:threadedComments xmlns:p="http://schemas.microsoft.com/office/2018/08/coauthoring"><p:threadedComment ref="A1" id="t1" authorId="ID.1" parentId="d1"><p:text>这里要复核</p:text></p:threadedComment><p:threadedComment ref="A1" id="t2" authorId="ID.2" parentId="t1" refBy="t1"><p:text>同意&amp;知道</p:text></p:threadedComment><p:threadedComment ref="B7" id="t3" authorId="ID.1" parentId="d2"><p:text>只在新式里有的一条</p:text></p:threadedComment></p:threadedComments>"#;

    const THREADED_REL: &str = r#"<Relationship Id="tc1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/threadedComment" Target="../threadedComments/threadedComment_1.xml"/>"#;

    const ORPHAN: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors><author>无人认领</author></authors><commentList><comment ref="C3" authorId="0"><text><r><t>没人认领的一条</t></r></text></comment></commentList></comments>"#;

    #[test]
    fn side_survives_xlsx_round_trip() {
        let path = tmp("rt");
        let wb = WorkbookPayload {
            sheets: vec![sheet(
                "边",
                vec![
                    cell(0, 0, json!("官网")),
                    cell(1, 0, json!(42)),
                    cell(2, 0, json!("带链接的字")),
                ],
                vec![
                    CellNotePayload {
                        r: 0,
                        c: 0,
                        text: "这里要复核".into(),
                        author: Some("张三".into()),
                        width: Some(160.0),
                        height: Some(90.0),
                        show: Some(true),
                    },
                    note(1, 0, "匿名一条", None),
                ],
                vec![
                    link(2, 0, Some("https://example.com/a?x=1&y=2"), None, Some("打开看看")),
                    link(3, 0, None, Some("边!A1"), None),
                ],
            )],
            ..Default::default()
        };
        let accounts = write_xlsx_sync(path.clone(), wb).expect("写失败");
        // 对照组：形状正常的件不该凭空长出账目来
        assert_eq!(accounts, Vec::<String>::new(), "写侧凭空记了账");
        let back = read_xlsx_sync(path.clone()).expect("读失败");
        assert_eq!(back.warnings, Vec::<String>::new(), "读侧凭空记了账");
        let s = &back.sheets[0];
        assert_eq!(s.notes.len(), 2);
        let n = &s.notes[0];
        assert_eq!((n.r, n.c, n.text.as_str()), (0, 0, "这里要复核"));
        assert_eq!(n.author.as_deref(), Some("张三"));
        assert_eq!(
            (n.width, n.height, n.show),
            (Some(160.0), Some(90.0), Some(true)),
            "气泡尺寸与常开没能来回"
        );
        assert_eq!(s.notes[1].author, None, "没署名的批注被安上了作者");
        assert_eq!(s.links.len(), 2);
        // 地址里的 & 要在 rels 的转义里活下来
        assert_eq!(s.links[0].url.as_deref(), Some("https://example.com/a?x=1&y=2"));
        assert_eq!(s.links[0].tip.as_deref(), Some("打开看看"));
        assert_eq!(s.links[1].location.as_deref(), Some("边!A1"));
        assert_eq!(s.links[1].url, None, "表内跳转被当成了外部地址");
        // 链接格的值不能被链接的显示文本顶掉
        assert_eq!(
            s.cells.iter().find(|c| c.r == 1 && c.c == 0).and_then(|c| c.v.as_ref()),
            Some(&json!(42))
        );
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn author_table_lands_in_id_order() {
        let path = tmp("authors");
        // 载荷书写序、格子序、名字的字节序三者各不相同，才分得出编号按哪个走
        let wb = WorkbookPayload {
            sheets: vec![sheet(
                "作者",
                vec![cell(0, 0, json!("占位"))],
                vec![
                    note(5, 2, "丙格", Some("王五&赵")),
                    note(0, 0, "甲格", Some("李四")),
                    note(2, 7, "乙格", Some("Adam")),
                    note(3, 3, "丁格", None),
                ],
                vec![],
            )],
            ..Default::default()
        };
        let accounts = write_xlsx_sync(path.clone(), wb).expect("写失败");
        assert_eq!(accounts, Vec::<String>::new());
        let xml = entry(&path, "xl/comments1.xml");
        let table = xml
            .split("<authors>")
            .nth(1)
            .and_then(|x| x.split("</authors>").next())
            .expect("作者表不见了");
        assert_eq!(
            table, "<author></author><author>李四</author><author>Adam</author><author>王五&amp;赵</author>",
            "作者表没按编号排（按字节序排会把中文名字提前，署名就串了）"
        );
        let back = read_xlsx_sync(path.clone()).expect("读失败");
        let got: Vec<(u32, u32, Option<String>)> = back.sheets[0]
            .notes
            .iter()
            .map(|n| (n.r, n.c, n.author.clone()))
            .collect();
        assert_eq!(
            got,
            vec![
                (0, 0, Some("李四".into())),
                (2, 7, Some("Adam".into())),
                (3, 3, None),
                (5, 2, Some("王五&赵".into())),
            ],
            "署名串到了别的作者名下"
        );
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn author_tables_of_two_sheets_stay_apart() {
        let path = tmp("two");
        let wb = WorkbookPayload {
            sheets: vec![
                sheet(
                    "头",
                    vec![],
                    vec![note(0, 0, "头甲", Some("李四")), note(1, 0, "头乙", Some("张三"))],
                    vec![],
                ),
                sheet("没批注", vec![cell(0, 0, json!("空"))], vec![], vec![]),
                sheet(
                    "尾",
                    vec![],
                    vec![note(3, 1, "尾甲", Some("Adam")), note(0, 0, "尾乙", Some("李四"))],
                    vec![],
                ),
            ],
            ..Default::default()
        };
        let accounts = write_xlsx_sync(path.clone(), wb).expect("写失败");
        assert_eq!(accounts, Vec::<String>::new());
        // 部件按"有批注的表"的先后编号，中间那张空表不占号
        assert!(entry(&path, "xl/comments1.xml").contains("<author>李四</author><author>张三</author>"));
        assert!(entry(&path, "xl/comments2.xml").contains("<author>李四</author><author>Adam</author>"));
        let back = read_xlsx_sync(path.clone()).expect("读失败");
        let of = |name: &str| -> Vec<String> {
            let s = back.sheets.iter().find(|s| s.name == name).expect("表不见了");
            s.notes
                .iter()
                .map(|n| format!("{}:{}={}", n.r, n.c, n.author.clone().unwrap_or_default()))
                .collect()
        };
        assert_eq!(of("头"), vec!["0:0=李四", "1:0=张三"]);
        assert_eq!(of("尾"), vec!["0:0=李四", "3:1=Adam"]);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn default_note_size_stays_undeclared() {
        let path = tmp("size");
        let wb = WorkbookPayload {
            sheets: vec![sheet("尺", vec![], vec![note(0, 0, "没设尺寸", Some("张三"))], vec![])],
            ..Default::default()
        };
        assert_eq!(
            write_xlsx_sync(path.clone(), wb).expect("写失败"),
            Vec::<String>::new()
        );
        // VML 总是写着尺寸，抄回来会让"没声明"变成"声明了 128×74"
        let xml = entry(&path, "xl/drawings/vmlDrawing1.vml");
        assert!(
            xml.contains("width:96pt") && xml.contains("height:55.5pt"),
            "默认气泡尺寸的形状变了：{xml}"
        );
        let back = read_xlsx_sync(path.clone()).expect("读失败");
        let n = &back.sheets[0].notes[0];
        assert_eq!((n.width, n.height), (None, None), "默认尺寸被当成用户声明的尺寸");
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn threaded_comments_merge_with_their_legacy_copy() {
        let path = tmp("threaded");
        let wb = WorkbookPayload {
            sheets: vec![sheet(
                "讨",
                vec![cell(0, 0, json!("正文"))],
                vec![note(0, 0, "这里要复核", Some("张三"))],
                vec![],
            )],
            ..Default::default()
        };
        assert_eq!(
            write_xlsx_sync(path.clone(), wb).expect("写失败"),
            Vec::<String>::new()
        );
        let patched = tmp("threaded-patched");
        rezip(
            &path,
            &patched,
            &[("xl/persons/person.xml", PERSONS), ("xl/threadedComments/threadedComment_1.xml", THREADED)],
            THREADED_REL,
        );
        let side = read_cell_side(patched.as_str());
        assert_eq!(
            side.accounts,
            vec!["有 1 条批注的回复被并进了正文（我们的模型不分层）"],
            "同一批注的两份写法不该各记一条"
        );
        let notes = &side.by_sheet["讨"].notes;
        assert_eq!(notes.len(), 2, "同一批注释了两份写法，只该收一条");
        // 回复折进正文时带上回复人的名字：层没了，谁说的还在
        assert_eq!(notes[0].text, "这里要复核\n李四: 同意&知道", "回复没折进正文或实体丢了");
        assert_eq!(notes[0].author.as_deref(), Some("张三"));
        assert_eq!((notes[1].r, notes[1].c), (6, 1));
        assert_eq!(notes[1].text, "只在新式里有的一条");
        assert_eq!(notes[1].author.as_deref(), Some("张三"));
        std::fs::remove_file(&path).ok();
        std::fs::remove_file(&patched).ok();
    }

    #[test]
    fn unclaimed_comment_part_reports_itself() {
        let path = tmp("orphan");
        let wb = WorkbookPayload {
            sheets: vec![sheet("孤", vec![], vec![note(0, 0, "有主的一条", Some("张三"))], vec![])],
            ..Default::default()
        };
        write_xlsx_sync(path.clone(), wb).expect("写失败");
        let patched = tmp("orphan-patched");
        rezip(&path, &patched, &[("xl/comments9.xml", ORPHAN)], "");
        let side = read_cell_side(patched.as_str());
        assert_eq!(
            side.accounts,
            vec!["有 1 个批注部件认不出属于哪张表，未收进来"]
        );
        let notes = &side.by_sheet["孤"].notes;
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].text, "有主的一条");
        std::fs::remove_file(&path).ok();
        std::fs::remove_file(&patched).ok();
    }

    #[test]
    fn notes_that_cannot_be_written_report_themselves() {
        let path = tmp("refused");
        let long_author = "名".repeat(53);
        let wb = WorkbookPayload {
            sheets: vec![sheet(
                "拒",
                vec![],
                vec![
                    note(0, 0, "", Some("张三")),
                    note(1, 0, "署名太长", Some(long_author.as_str())),
                ],
                vec![link(2, 0, None, None, None)],
            )],
            ..Default::default()
        };
        let accounts = write_xlsx_sync(path.clone(), wb).expect("写失败");
        assert_eq!(
            accounts,
            vec![
                // 链接先写、批注后写，账也按这个次序报
                "第 3 行第 1 列的链接既没有外部地址也没有表内跳转目标，未写入",
                "第 1 行第 1 列的批注没有正文，未写入",
                "第 2 行第 1 列的批注作者超过 52 字（Excel 的上限），作者未写入",
            ]
        );
        // 超长的署名不写名字，正文照留
        let back = read_xlsx_sync(path.clone()).expect("读失败");
        assert_eq!(back.sheets[0].notes.len(), 1);
        assert_eq!(back.sheets[0].notes[0].author, None);
        assert_eq!(back.sheets[0].notes[0].text, "署名太长");
        std::fs::remove_file(&path).ok();
    }

    // 实机腿夹具：`cargo test gen_smoke_side -- --ignored` 写出 tmp/fixture-side.xlsx，
    // 供 Excel 只读腿（作者归属）与 CDP 真机腿（放回界面）共用同一份产物
    #[test]
    #[ignore]
    fn gen_smoke_side() {
        let path = std::env::var("OO_FIXTURE_PATH").unwrap_or_else(|_| {
            concat!(env!("CARGO_MANIFEST_DIR"), "/../tmp/fixture-side.xlsx").to_string()
        });
        if let Some(parent) = std::path::Path::new(&path).parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let mut n = vec![
            note(0, 0, "第一条：作者李四", Some("李四")),
            note(0, 1, "第二条：作者Adam", Some("Adam")),
            note(0, 2, "第三条：作者张三", Some("张三")),
            note(0, 3, "第四条：没人署过", None),
            note(0, 4, "第五条：作者王五&赵", Some("王五&赵")),
        ];
        // 第三条带尺寸与"打开就摊开"：Excel 里应当看得见气泡而不是只留个红点
        n[2].width = Some(160.0);
        n[2].height = Some(90.0);
        n[2].show = Some(true);
        let first = sheet(
            "边",
            vec![
                cell(0, 0, json!("李四的格")),
                cell(0, 1, json!("Adam的格")),
                cell(0, 2, json!("张三的格")),
                cell(0, 3, json!("匿名的格")),
                cell(0, 4, json!("王五&赵的格")),
                cell(0, 5, json!("官网")),
                cell(0, 6, json!("跳回A2")),
            ],
            n,
            vec![
                link(0, 5, Some("https://example.com/a?x=1&y=2"), None, Some("打开看看")),
                link(0, 6, None, Some("边!A2"), None),
            ],
        );
        // 第二张表单独一份作者表：两张表的编号不能互相指（crate 按表各写一个 comments 部件）
        let second = sheet(
            "第二",
            vec![cell(0, 0, json!("另表一格"))],
            vec![note(0, 0, "这一条也署了张三", Some("张三"))],
            vec![],
        );
        let wb = WorkbookPayload {
            sheets: vec![first, second],
            ..Default::default()
        };
        let accounts = write_xlsx_sync(path.clone(), wb).expect("写夹具失败");
        assert!(accounts.is_empty(), "这份夹具不该有账: {accounts:?}");
        println!("夹具：{path}");
    }
}
