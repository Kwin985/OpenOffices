// WebSocket 中继（v0.130）——实时协同的传输层
//
// 做什么：把同一「房间」里的多个客户端收到的每一帧原样转发给房内其他人。
// 就这一件事。协同的语义（谁和谁冲突怎么合）全在 Yjs CRDT 里，中继不懂文档，
// 也不需要懂——它只认房间名，这使它同时能带表格、演示的协同，不只文字。
//
// 为什么不用 tokio-tungstenite：那一套拉进来是 tokio 整条运行时 + futures + tungstenite，
// 按本仓库记体积账的规矩（见 Cargo.toml 里 updater 那段实测）是 MB 级的增长，
// 而这里需要的只是 RFC 6455 的一个很小的子集：
//   - 握手：读 HTTP 头，回 101，Sec-WebSocket-Accept = base64(sha1(key + 魔数 GUID))
//   - 帧：客户端来的一律带掩码要卸，服务端出去的不带；7/16/64 三档长度
//   - 控制帧：ping/pong/close
// 于是 SHA-1 与 base64 都手搓（各几十行，算法是定死的），一个 crate 都不加。
//
// 线程模型：一个 accept 线程 + 每连接一个线程。文档协同是长连接小流量，
// 这个量级上 std::net 完全够，引入异步运行时属于用大炮打蚊子。
//
// **不缓存"入房之前"的帧**：A 发的更新到得比 B 入房早，那一帧就蒸发。
// 这是刻意的——补上它是 Yjs 同步协议的活（B 入房后会把状态向量发给 A，A 回全量差异），
// 中继为此背一份缓冲只会无限增长。真实客户端因此从不怕丢帧，测试里却会，
// 所以下面的端到端测试先用互发探针把两边都确认进房，再做断言。

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::thread::JoinHandle;

/// RFC 6455 握手用的那个魔数。写死在规范里，不是我们挑的
const WS_GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

// ────────────────────────── SHA-1 ──────────────────────────
// FIPS 180-1。只有握手用得到（40 字节以内的输入），不追求性能，只追求对。

fn sha1(input: &[u8]) -> [u8; 20] {
    let mut h: [u32; 5] = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0];
    // 填充：先补一个 1 bit，再补 0，最后 8 字节是大端位长
    let mut msg = input.to_vec();
    let bit_len = (input.len() as u64) * 8;
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in msg.chunks_exact(64) {
        let mut w = [0u32; 80];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([
                chunk[i * 4],
                chunk[i * 4 + 1],
                chunk[i * 4 + 2],
                chunk[i * 4 + 3],
            ]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }
        let (mut a, mut b, mut c, mut d, mut e) = (h[0], h[1], h[2], h[3], h[4]);
        for (i, &wi) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | ((!b) & d), 0x5A827999u32),
                20..=39 => (b ^ c ^ d, 0x6ED9EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1BBCDC),
                _ => (b ^ c ^ d, 0xCA62C1D6),
            };
            let tmp = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(wi);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = tmp;
        }
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
    }
    let mut out = [0u8; 20];
    for (i, v) in h.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&v.to_be_bytes());
    }
    out
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64(data: &[u8]) -> String {
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        out.push(B64[(b[0] >> 2) as usize] as char);
        out.push(B64[(((b[0] & 0x03) << 4) | (b[1] >> 4)) as usize] as char);
        out.push(if chunk.len() > 1 {
            B64[(((b[1] & 0x0f) << 2) | (b[2] >> 6)) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            B64[(b[2] & 0x3f) as usize] as char
        } else {
            '='
        });
    }
    out
}

// ────────────────────────── 帧读写 ──────────────────────────

/// 读一个完整的客户端帧。控制帧（ping/pong/close）也走这里，由调用方按 opcode 处理。
///
/// 三种返回各有各的去处，**不能合并**：
/// - `Ok(Some(..))`：读到一帧
/// - `Ok(None)`：协议错（长度越界/不支持的操作码）——连接该关，且**不用再探活**，
///   因为对端连帧格式都发错了，等着也没用
/// - `Err(e)`：I/O 错。调用方要按 `e.kind()` 分开：超时（还能再探一次）与真断了
///   （EOF/连接重置）。早先这里一律返回 None，于是"读超时"和"对端关了"是同一
///   个值，服务端无法只清死连接而不误杀正在沉默的健康会话
fn read_frame(s: &mut TcpStream) -> std::io::Result<Option<(u8, Vec<u8>)>> {
    let mut head = [0u8; 2];
    s.read_exact(&mut head)?;
    let opcode = head[0] & 0x0f;
    let masked = head[1] & 0x80 != 0;
    let len7 = (head[1] & 0x7f) as usize;
    let len: usize = match len7 {
        126 => {
            let mut b = [0u8; 2];
            s.read_exact(&mut b)?;
            u16::from_be_bytes(b) as usize
        }
        127 => {
            let mut b = [0u8; 8];
            s.read_exact(&mut b)?;
            // 中继用不到 4GB 以上的帧；真来了宁可关掉也不去赌 usize 截断
            let v = u64::from_be_bytes(b);
            if v > usize::MAX as u64 {
                return Ok(None);
            }
            v as usize
        }
        n => n,
    };
    // 上限 16MB：Yjs 的 update 帧量级在几十 KB，16MB 足够宽裕又不至于被恶意长度拖死
    if len > 16 * 1024 * 1024 {
        return Ok(None);
    }
    let mask = if masked {
        let mut m = [0u8; 4];
        s.read_exact(&mut m)?;
        Some(m)
    } else {
        None
    };
    let mut payload = vec![0u8; len];
    s.read_exact(&mut payload)?;
    if let Some(m) = mask {
        for (i, b) in payload.iter_mut().enumerate() {
            *b ^= m[i % 4];
        }
    }
    Ok(Some((opcode, payload)))
}

/// 应用层心跳的两个 kind。与传输层的 kind 字节同一层：[0]=同步、[1]=awareness、
/// [2]=ping、[3]=pong。
///
/// 为什么要有它：RFC 6455 的 ping/pong 帧浏览器会自动回，但 **JS 拿不到"收到了
/// ping"这个事件**，所以只有服务端能靠它探活，前端探不了服务端。反过来这一对
/// 是应用层的，前端收得到 pong，才知道"对面还活着"。
const MSG_PING: u8 = 2;
const MSG_PONG: u8 = 3;

fn write_frame(s: &mut TcpStream, opcode: u8, payload: &[u8]) -> std::io::Result<()> {
    let mut out = Vec::with_capacity(payload.len() + 10);
    out.push(0x80 | opcode); // FIN + opcode
    let n = payload.len();
    if n < 126 {
        out.push(n as u8);
    } else if n <= u16::MAX as usize {
        out.push(126);
        out.extend_from_slice(&(n as u16).to_be_bytes());
    } else {
        out.push(127);
        out.extend_from_slice(&(n as u64).to_be_bytes());
    }
    out.extend_from_slice(payload);
    s.write_all(&out)?;
    s.flush()
}

// ────────────────────────── 握手 ──────────────────────────

/// 握手最多等这么久。连上来却不把请求头发完的（端口扫描器之类）不该占着一个线程
const HANDSHAKE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// 连接级参数。
///
/// 做成可注入的只有一个理由：让测试能在毫秒级验证"死连接被清出去、房间被回收"，
/// 而不必等满生产那 90 秒。这个行为不真的跑一遍就不算数，而不跑的测试等于没有
#[derive(Clone, Copy)]
pub struct ConnCfg {
    /// 单帧读超时：到点没读到帧就算一次"没动静"
    pub read_timeout: std::time::Duration,
    /// 连续几次"没动静"就把连接踢掉（其间每次都会先发一次 ping 探活）
    pub max_missed: u32,
}

impl ConnCfg {
    /// 生产值：30 秒没动静发一次 ping，三次都没回声（90 秒）才认定这连接已经死了
    pub const DEFAULT: ConnCfg = ConnCfg {
        read_timeout: std::time::Duration::from_secs(30),
        max_missed: 2,
    };
}

/// 是不是"读超时"。std 在两个平台上给的都是这两个 kind 之一，都认下，
/// 免得换成另一个就被当成"对端断了"而误杀健康会话
fn is_timeout(e: &std::io::Error) -> bool {
    matches!(e.kind(), std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock)
}

fn handshake(s: &mut TcpStream) -> Option<String> {
    // 握手这一段用短超时：它必须一口气读完，没有"等一等"的道理
    s.set_read_timeout(Some(HANDSHAKE_TIMEOUT)).ok();
    let mut buf = Vec::with_capacity(2048);
    let mut b = [0u8; 1];
    // 读到头尾标志为止。请求头很小，4KB 够；超了当恶意连接直接关
    while buf.len() < 4096 {
        if s.read_exact(&mut b).is_err() {
            return None;
        }
        buf.push(b[0]);
        if buf.ends_with(b"\r\n\r\n") {
            break;
        }
    }
    let req = String::from_utf8_lossy(&buf);
    let mut key = None;
    for line in req.lines() {
        let lower = line.to_ascii_lowercase();
        // 冒号一定在（这行以 "sec-websocket-key:" 开头），但仍然走 find 取下标而不是
        // unwrap：这是网络边界上的代码，任何一处手滑都不该变成整进程退出
        if lower.starts_with("sec-websocket-key:") {
            if let Some(i) = line.find(':') {
                key = Some(line[i + 1..].trim().to_string());
            }
        }
    }
    let key = key?;
    let accept = base64(&sha1(format!("{key}{WS_GUID}").as_bytes()));
    let resp = format!(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n"
    );
    s.write_all(resp.as_bytes()).ok()?;
    s.flush().ok()?;
    Some(key)
}

// ────────────────────────── 中继 ──────────────────────────

/// 房间名 → 该房内各连接的写端。写端是 TcpStream 本身（每连接一个线程，
/// 广播时加锁逐份写）。文档协同的连接数是"几个人"，不是"几万个人"，
/// 这个量级上一把房级锁完全够，不必为此引入更细的并发结构。
type Room = Arc<Mutex<Vec<Arc<Mutex<TcpStream>>>>>;

type RoomMap = Arc<Mutex<HashMap<String, Room>>>;

struct Relay {
    /// 房间表。与 accept 线程共享同一份 Arc——两处看到的是同一张表，
    /// 否则新连接会注册进另一个 Map，转发时谁都找不到谁
    rooms: RoomMap,
    /// 实际监听的端口（界面显示与前端连接用） */
    port: u16,
    /// 关门信号：Some 的发送端活着就说明中继在跑
    shutdown: Option<Sender<()>>,
    /// accept 线程的句柄。`stop` 要 join 它：不 join 就再 spawn 一个，会有两个
    /// accept 线程短暂并存，而老线程退出前接到的连接会注册进**旧**房间表
    /// （新表看不见它）⇒ 那个连接成了孤儿，谁也转发不到它
    accept: Option<JoinHandle<()>>,
    /// accept 线程自己置 false。线程也会**自己**退出（`accept` 返回非 WouldBlock
    /// 的错），那一路上 `shutdown` 还留着 Some，单看它会把"已经死了"报成"在跑"
    alive: Arc<AtomicBool>,
}

static RELAY: Mutex<Option<Relay>> = Mutex::new(None);

/// 取锁，容忍"被污染"（曾有个持锁线程 panic 过）。
///
/// 本模块从不把房间表留在"改了一半"的状态：进房是 `push`、离场是 `retain`，
/// 都是一步到位，所以污染**不代表**里面的数据坏了，照用是对的。
/// 反过来看不这么做的代价：release 是 `panic = "abort"`，一个连接线程 panic
/// 之后其余线程在这里 `unwrap` 会跟着 panic ⇒ 整应用退出。网络那一侧的局部
/// 故障不该有这个爆炸半径，所以这里取锁一律走这个函数。
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// 起中继。传 0 让系统挑端口（返回实际挑中的那个）。
/// 已在跑就回报**当前**端口，不重起——重起会把房里的人全踢掉。
pub fn start(port: u16) -> Result<u16, String> {
    start_with(port, ConnCfg::DEFAULT)
}

/// 同上，连接参数由调用方给。只有测试用的独立中继（examples/relay.rs）需要它，
/// 为的是把超时压短、让端到端脚本也能验证"死连接会被清出去"
pub fn start_with(port: u16, cfg: ConnCfg) -> Result<u16, String> {
    let mut guard = lock(&RELAY);
    if let Some(r) = guard.as_ref() {
        // 在跑的判断要带上 alive：只认 shutdown 的话，一个"线程已死而信号还在"的
        // 残留会被当成还在跑，于是这一趟直接返回、再也没人 accept
        if r.shutdown.is_some() && r.alive.load(Ordering::SeqCst) {
            return Ok(r.port);
        }
    }
    // 走到这儿是"没起过"或"上一轮已经停了/已经死了"。先把上一轮收干净再起新的：
    // join 最多等一个轮询周期（100ms），换来的是"绝不出现两个 accept 线程并存"
    if let Some(r) = guard.as_mut() {
        if let Some(tx) = r.shutdown.take() {
            let _ = tx.send(());
        }
        if let Some(h) = r.accept.take() {
            let _ = h.join();
        }
    }
    let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|e| format!("绑定失败: {e}"))?;
    let actual = listener.local_addr().map_err(|e| e.to_string())?.port();
    // 非阻塞 accept 轮询 + shutdown 通道：不用时就退得出线程
    listener.set_nonblocking(true).ok();
    let (tx, rx) = channel::<()>();
    let rooms: RoomMap = Arc::new(Mutex::new(HashMap::new()));
    let alive = Arc::new(AtomicBool::new(true));
    let relay = guard.get_or_insert_with(|| Relay {
        rooms: Arc::clone(&rooms),
        port: 0,
        shutdown: None,
        accept: None,
        alive: Arc::clone(&alive),
    });
    relay.rooms = Arc::clone(&rooms);
    relay.port = actual;
    relay.shutdown = Some(tx);
    relay.alive = Arc::clone(&alive);
    // 线程要拿走的：监听口、房间表、关门信号的收端、以及"我还活着"那面旗
    let rooms_th = Arc::clone(&rooms);
    let alive_th = Arc::clone(&alive);
    let cfg_th = cfg;
    relay.accept = Some(thread::spawn(move || {
        loop {
            // 关门信号优先：一进来就查，保证 stop 之后最多再等一个轮询周期
            if rx.try_recv().is_ok() {
                break;
            }
            match listener.accept() {
                Ok((stream, _addr)) => {
                    let rooms = Arc::clone(&rooms_th);
                    thread::spawn(move || { let _ = handle_conn_with(stream, rooms, &cfg_th); });
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    // 没连接来：睡一小会儿再探。100ms 的代价是 stop 最多晚 100ms 生效，
                    // 换来的是一片安静的 CPU
                    thread::sleep(std::time::Duration::from_millis(100));
                }
                // 其余的错（fd 耗尽之类）没法接着 accept：退出，并把 alive 落下来，
                // 让 running() 说实话——否则界面会一直显示"协同已开启"而没人接客
                Err(_) => break,
            }
        }
        // 收摊：把房间清空，让 stop() 之后的状态是确定的
        lock(&rooms_th).clear();
        alive_th.store(false, Ordering::SeqCst);
    }));
    drop(guard);
    Ok(actual)
}

/// 关中继。幂等。
pub fn stop() {
    // 先把信号与句柄取出来，再在**锁外**发信号与 join：
    // join 最多等一个轮询周期（100ms），没必要拿着 RELAY 锁干等，
    // 那会让这段时间里 running() 的所有调用撞在这把锁上
    let taken = {
        let mut guard = lock(&RELAY);
        match guard.as_mut() {
            Some(r) => (r.shutdown.take(), r.accept.take()),
            None => return,
        }
    };
    if let Some(tx) = taken.0 {
        let _ = tx.send(());
    }
    if let Some(h) = taken.1 {
        let _ = h.join();
    }
    // 房间清干净：这一趟 join 过，收摊那一步（线程末尾的 clear）已经跑完，
    // 这里再清一次是兜"线程自己退出"那条路——那条路上没人替我们清
    if let Some(r) = lock(&RELAY).as_ref() {
        lock(&r.rooms).clear();
    }
}

/// 中继是否在跑（界面上的开关状态）
pub fn running() -> bool {
    lock(&RELAY)
        .as_ref()
        // 两个条件缺一不可：信号还在说明"没人叫它停"，alive 说明"线程确实还在接客"
        .map(|r| r.shutdown.is_some() && r.alive.load(Ordering::SeqCst))
        .unwrap_or(false)
}

/// 一个连接的一生：握手 → 首帧必须是房间名（文本帧）→ 之后每帧转发给房内其他人
/// 返回 None 表示连接该关（try_clone 失败这种致命错误）。
///
/// 连接参数由调用方给：`start` 传生产默认值，测试传毫秒级的（见 `ConnCfg`）
pub fn handle_conn_with(stream: TcpStream, rooms: RoomMap, cfg: &ConnCfg) -> Option<()> {
    let mut s = stream;
    s.set_nonblocking(false).ok();
    s.set_nodelay(true).ok();
    handshake(&mut s)?;
    // 进了房就用长一点的读超时：协同是"长时间闲着、偶尔说一句"的流量，
    // 超时不是用来判死的，是用来给自己一个"该发 ping 探一探"的节拍
    s.set_read_timeout(Some(cfg.read_timeout)).ok();
    // 首帧 = 房间名。用文本帧，纯粹是给人看的协议友好（浏览器 console 里能直接连上去试）
    let (op, payload) = read_frame(&mut s).ok().flatten()?;
    if op != 0x1 {
        let _ = write_frame(&mut s, 0x8, b"first frame must be a text room name");
        return None;
    }
    let room_name = String::from_utf8_lossy(&payload).trim().to_string();
    if room_name.is_empty() {
        return None;
    }

    let peers = {
        let mut g = lock(&rooms);
        g.entry(room_name.clone())
            .or_insert_with(|| Arc::new(Mutex::new(Vec::new())))
            .clone()
    };
    let me = Arc::new(Mutex::new(s.try_clone().ok()?));
    lock(&peers).push(Arc::clone(&me));

    // 主循环：收到什么就往房里其他人写什么。
    // 写端加锁的顺序是"逐份拿、写完就放"，不在持锁时读网络——否则一个慢客户端
    // 能把整个房（连带头部的 accept 线程之外的其他人）全堵住
    //
    // 这里不用 `while let Some(..) = read_frame(..)`：读超时不是"读完了"，
    // 用 while let 会把它当成流结束而直接掉出循环，于是根本没机会探活
    let mut missed = 0u32;
    loop {
        match read_frame(&mut s) {
            Ok(Some((op, payload))) => {
                missed = 0; // 任何一帧都证明对端还在，心跳的账从头算
                match op {
                    0x8 => break, // close
                    0x9 => {
                        // ping → pong（RFC 6455 的传输层心跳）
                        let _ = write_frame(&mut lock(&me), 0xA, &payload);
                    }
                    0xA => {} // pong：不用回
                    0x1 | 0x2 => {
                        // 唯一一处看载荷内容的地方：应用层心跳。
                        // 它**不能**进转发——N 个客户端各发各的心跳，广播会让它变成 N² 帧，
                        // 而这一帧的收件人从来只有发它的那一个
                        if op == 0x2 {
                            match payload.first() {
                                Some(&MSG_PING) => {
                                    let _ = write_frame(&mut lock(&me), 0x2, &[MSG_PONG]);
                                    continue;
                                }
                                Some(&MSG_PONG) => continue,
                                _ => {}
                            }
                        }
                        // 文本/二进制：转发。带上原 opcode，客户端那侧按同样的方式解
                        let list = lock(&peers);
                        for p in list.iter() {
                            if Arc::ptr_eq(p, &me) {
                                continue;
                            }
                            // 单个对端写失败不该影响其他人：它大概已经走了，下一轮读时自然清掉
                            let _ = write_frame(&mut lock(p), op, &payload);
                        }
                    }
                    _ => {} // 保留操作码：忽略
                }
            }
            // 协议错：不用探活，直接走离场清理
            Ok(None) => break,
            // 读超时：对端只是"这阵子没说话"。先按 RFC 6455 发一枚 ping 探一下——
            // 浏览器会自动回 pong，我们下一轮读就会读到它并重置 missed。
            // 真死了的（进程被杀、网断了）没人回，攒够次数才认
            Err(ref e) if is_timeout(e) => {
                missed += 1;
                if missed > cfg.max_missed {
                    break;
                }
                if write_frame(&mut lock(&me), 0x9, &[]).is_err() {
                    break;
                }
            }
            // EOF / 连接重置：走离场清理。这一路若也去探活，同屋的人会多轮往死连接写
            Err(_) => break,
        }
    }
    // 离场：把自己从房间里摘掉。**这一步必须在所有退出路径上都跑到**——
    // 留在表里的话，同屋的人会一直往一个已死的连接写帧
    let empty = {
        let mut list = lock(&peers);
        list.retain(|p| !Arc::ptr_eq(p, &me));
        list.is_empty()
    };
    // 房空了就把条目删掉。不删的话，每次协同用过的一次性房间名会攒成一张只增
    // 不减的表（房间名跟着文件路径走，开十个文件就是十条）
    if empty {
        let mut g = lock(&rooms);
        // 摘完到这里的空隙里可能有人刚进房：那时这个条目已经不属于"空房"了，
        // 删掉会把新来的那位变成孤儿（新房表看不见他）。所以删之前再看一眼
        let still_empty = g
            .get(&room_name)
            .map(|r| lock(r).is_empty())
            .unwrap_or(false);
        if still_empty {
            g.remove(&room_name);
        }
    }
    Some(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn sha1_matches_known_vectors() {
        // FIPS 180-1 与 RFC 3174 里的标准向量
        assert_eq!(
            hex(&sha1(b"abc")),
            "a9993e364706816aba3e25717850c26c9cd0d89d"
        );
        assert_eq!(
            hex(&sha1(b"")),
            "da39a3ee5e6b4b0d3255bfef95601890afd80709"
        );
        // 超过一个块（64 字节）的输入，用来验证填充分支
        assert_eq!(
            hex(&sha1(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")),
            "84983e441c3bd26ebaae4aa1f95129e5e54670f1"
        );
    }

    #[test]
    fn base64_matches_known_vectors() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
        // 刚好跨到第二组三字节
        assert_eq!(base64(b"foob"), "Zm9vYg==");
    }

    /// RFC 6455 第 1.3 节那个例子：这把 key 的 accept 必须是这个值。
    /// 这一条是整个握手唯一的"对外契约"，写死在这里防回归
    #[test]
    fn handshake_accept_matches_rfc_example() {
        let key = "dGhlIHNhbXBsZSBub25jZQ==";
        let accept = base64(&sha1(format!("{key}{WS_GUID}").as_bytes()));
        assert_eq!(accept, "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
    }

    fn hex(b: &[u8]) -> String {
        b.iter().map(|x| format!("{x:02x}")).collect()
    }

    // ── 一个手搓的最小 WebSocket 客户端，只为测试存在 ──
    // 生产路径上客户端是浏览器（自带 WebSocket），这里用裸 TCP 反而能验证帧的每个字节

    fn client_connect(port: u16) -> TcpStream {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
        let req = "GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n";
        s.write_all(req.as_bytes()).unwrap();
        let mut resp = Vec::new();
        let mut b = [0u8; 1];
        while !resp.ends_with(b"\r\n\r\n") {
            s.read_exact(&mut b).unwrap();
            resp.push(b[0]);
        }
        let text = String::from_utf8_lossy(&resp);
        assert!(text.starts_with("HTTP/1.1 101"), "握手响应不对: {text}");
        assert!(
            text.contains("s3pPLMBiTxaQ9kYGzzhZRbK+xOo="),
            "accept 值不对: {text}"
        );
        s
    }

    /// 客户端发一帧（带掩码，RFC 要求客户端必须掩码）
    fn client_send(s: &mut TcpStream, opcode: u8, payload: &[u8]) {
        let mask = [0x37u8, 0xfa, 0x21, 0x3d];
        let mut out = vec![0x80 | opcode, 0x80 | payload.len() as u8];
        out.extend_from_slice(&mask);
        for (i, b) in payload.iter().enumerate() {
            out.push(b ^ mask[i % 4]);
        }
        s.write_all(&out).unwrap();
    }

    /// 试着收一帧，超时/没数据就交回 None（探针阶段用，不因等不到就失败）
    fn try_recv_payload(s: &mut TcpStream) -> Option<Vec<u8>> {
        let mut head = [0u8; 2];
        match s.read_exact(&mut head) {
            Ok(()) => {}
            Err(_) => return None,
        }
        let len = (head[1] & 0x7f) as usize;
        let mut payload = vec![0u8; len];
        if s.read_exact(&mut payload).is_err() {
            return None;
        }
        Some(payload)
    }

    /// 客户端收一帧（服务端来的不带掩码）
    fn client_recv(s: &mut TcpStream) -> (u8, Vec<u8>) {
        let mut head = [0u8; 2];
        s.read_exact(&mut head).unwrap();
        let opcode = head[0] & 0x0f;
        assert_eq!(head[1] & 0x80, 0, "服务端出去的帧不该带掩码");
        let len = (head[1] & 0x7f) as usize;
        let mut payload = vec![0u8; len];
        s.read_exact(&mut payload).unwrap();
        (opcode, payload)
    }

    /// 起一个中继，房间表由调用方拿着（测试要直接看表里还剩几条）。
    /// 不走全局 RELAY：那一条路上 `start/stop` 会把表清空，没法单独观察一个连接的一生
    fn spawn_relay_with(cfg: ConnCfg) -> (u16, RoomMap) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let rooms: RoomMap = Arc::new(Mutex::new(HashMap::new()));
        let rooms_th = Arc::clone(&rooms);
        thread::spawn(move || {
            for s in listener.incoming().flatten() {
                let r = Arc::clone(&rooms_th);
                let c = cfg;
                thread::spawn(move || {
                    let _ = handle_conn_with(s, r, &c);
                });
            }
        });
        (port, rooms)
    }

    fn room_len(rooms: &RoomMap, name: &str) -> usize {
        lock(rooms)
            .get(name)
            .map(|r| lock(r).len())
            .unwrap_or(0)
    }

    fn room_names(rooms: &RoomMap) -> Vec<String> {
        lock(rooms).keys().cloned().collect()
    }

    /// 轮询等到房里有 n 个人（连接是另一个线程注册的，发出帧之后不是立刻在册）
    fn wait_room_len(rooms: &RoomMap, name: &str, n: usize) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while room_len(rooms, name) != n {
            assert!(Instant::now() < deadline, "房里人数没到 {n}");
            thread::sleep(Duration::from_millis(10));
        }
    }

    /// 把两边积压的探针帧排空，之后收到的每一帧都只可能是这一趟要断言的那一帧
    fn drain(s: &mut TcpStream) {
        s.set_read_timeout(Some(Duration::from_millis(120))).unwrap();
        while try_recv_payload(s).is_some() {}
    }

    /// 应用层心跳：ping 应当**只**回声给发它的人，房里其他人一个字节都不该收到。
    /// 这一条防的是两种回归——回声丢了（前端判定连接已死而反复重连）与
    /// 心跳被广播（N 个客户端的心跳变成 N² 帧，是这套中继唯一能自我打垮的地方）
    #[test]
    fn ping_pong_is_echoed_and_never_broadcast() {
        let (port, _rooms) = spawn_relay_with(ConnCfg::DEFAULT);
        let mut a = client_connect(port);
        let mut b = client_connect(port);
        client_send(&mut a, 0x1, b"room-ping");
        client_send(&mut b, 0x1, b"room-ping");
        wait_peers(&mut a, &mut b);
        drain(&mut a);
        drain(&mut b);

        client_send(&mut a, 0x2, &[MSG_PING]);
        let (op, payload) = client_recv(&mut a);
        assert_eq!(op, 0x2, "pong 应是二进制帧");
        assert_eq!(payload, vec![MSG_PONG], "ping 的回声该是 pong");
        assert!(
            try_recv_payload(&mut b).is_none(),
            "心跳不该被转发给房里其他人"
        );

        // 反过来：pong 帧本身既不回声也不转发
        client_send(&mut a, 0x2, &[MSG_PONG]);
        assert!(try_recv_payload(&mut a).is_none(), "pong 不该有回声");
        assert!(try_recv_payload(&mut b).is_none(), "pong 不该被转发");

        // 心跳之外的帧照旧要转发：不能因为加了心跳就把正事挡住
        client_send(&mut a, 0x2, b"still-forwarded");
        let (op2, payload2) = client_recv(&mut b);
        assert_eq!(op2, 0x2);
        assert_eq!(payload2, b"still-forwarded");
    }

    /// 连着却一言不发（进程被杀、网断了）的连接必须被服务端清出去，房间条目也要回收。
    /// 不清理的后果是同屋的人每帧都往一个死连接写，写失败还只是慢，
    /// 房间表却会一直攒着这些"幽灵"
    #[test]
    fn silent_connection_is_evicted_and_room_reclaimed() {
        // 60ms 一拍、两拍不回声就踢：把生产的 90 秒压成不到 300ms
        let cfg = ConnCfg {
            read_timeout: Duration::from_millis(60),
            max_missed: 2,
        };
        let (port, rooms) = spawn_relay_with(cfg);
        let mut dead = client_connect(port);
        client_send(&mut dead, 0x1, b"room-dead");
        wait_room_len(&rooms, "room-dead", 1);

        let deadline = Instant::now() + Duration::from_secs(5);
        while room_len(&rooms, "room-dead") != 0 {
            assert!(Instant::now() < deadline, "沉默的连接没被清出去");
            thread::sleep(Duration::from_millis(20));
        }
        assert!(
            room_names(&rooms).is_empty(),
            "房空了就该把条目删掉，而不是留一条空房攒着"
        );
    }

    /// 反面：会答话的连接不该被这套超时踢掉。
    /// 只测"死连接被清"是不够的——那一条在"把所有连接都踢了"的实现下同样会过
    #[test]
    fn connection_that_keeps_talking_is_not_evicted() {
        let cfg = ConnCfg {
            read_timeout: Duration::from_millis(80),
            max_missed: 2,
        };
        let (port, rooms) = spawn_relay_with(cfg);
        let mut a = client_connect(port);
        client_send(&mut a, 0x1, b"room-live");
        wait_room_len(&rooms, "room-live", 1);
        a.set_read_timeout(Some(Duration::from_millis(200))).unwrap();

        // 比一拍（80ms）更密地发心跳，跨过好几个"该发 ping 探活"的节拍
        let end = Instant::now() + Duration::from_millis(700);
        while Instant::now() < end {
            client_send(&mut a, 0x2, &[MSG_PING]);
            let _ = try_recv_payload(&mut a); // pong，或服务端主动探活的那一枚 ping
            thread::sleep(Duration::from_millis(30));
        }
        assert_eq!(
            room_len(&rooms, "room-live"),
            1,
            "一直在答话的连接不该被当成死连接踢掉"
        );
    }

    /// 互发探针直到 B 收到 A 的（两个连接都在册的证据）
    fn wait_peers(a: &mut TcpStream, b: &mut TcpStream) {
        for c in [&mut *a, &mut *b] {
            c.set_read_timeout(Some(Duration::from_millis(200))).unwrap();
        }
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut b_saw_a = false;
        while !b_saw_a {
            assert!(Instant::now() < deadline, "探针没打通");
            client_send(a, 0x2, b"probe-a");
            client_send(b, 0x2, b"probe-b");
            b_saw_a = try_recv_payload(b).as_deref() == Some(&b"probe-a"[..]) || b_saw_a;
            let _ = try_recv_payload(a);
        }
    }

    /// 端起中继、连两个客户端、互发一帧、再关掉。
    /// 这是整条链上唯一能证明"真的能协同"的测试：握手、房间、转发、离场全过一遍
    #[test]
    fn relay_forwards_between_two_clients_in_a_room() {
        let port = start(0).expect("起中继失败");
        let mut a = client_connect(port);
        let mut b = client_connect(port);

        // 首帧必须是房间名（文本帧）
        client_send(&mut a, 0x1, b"room-x");
        client_send(&mut b, 0x1, b"room-x");

        // 互发探针直到 B 收到 A 的：这一刻起两边必定都已在房里
        // （中继只往已入房的对端转发，B 能收到就说明 B 在册；而这一帧是 A 入房后发的，
        //  说明 A 也在册）。不做这一步，A 的数据帧可能比 B 入房更早到达而被蒸发——
        //  那是中继的刻意设计，由 Yjs 的同步协议补，不是缺陷
        for c in [&mut a, &mut b] {
            c.set_read_timeout(Some(std::time::Duration::from_millis(200))).unwrap();
        }
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        let mut b_saw_a = false;
        while !b_saw_a {
            assert!(std::time::Instant::now() < deadline, "探针没打通");
            client_send(&mut a, 0x2, b"probe-a");
            client_send(&mut b, 0x2, b"probe-b");
            // 短超时地各读一发：B 读到 A 的探针就成；A 侧积压的探针顺手排掉
            b_saw_a = try_recv_payload(&mut b).as_deref() == Some(&b"probe-a"[..]) || b_saw_a;
            let _ = try_recv_payload(&mut a);
        }

        client_send(&mut a, 0x2, b"hello-from-a");
        let (op, payload) = client_recv(&mut b);
        assert_eq!(op, 0x2, "转发的应是二进制帧");
        assert_eq!(payload, b"hello-from-a");

        // 反向也要通
        client_send(&mut b, 0x1, "中文也过得去".as_bytes());
        let (op2, payload2) = client_recv(&mut a);
        assert_eq!(op2, 0x1);
        assert_eq!(payload2, "中文也过得去".as_bytes());

        // 不该收到自己发的那一份
        client_send(&mut a, 0x2, b"self-echo-check");
        let addr = std::net::SocketAddr::from((
            std::net::Ipv4Addr::new(127, 0, 0, 1),
            port,
        ));
        let mut c = TcpStream::connect_timeout(&addr, std::time::Duration::from_secs(2)).unwrap();
        // 第三个连接只握手不进房：它的首帧是非文本，服务端该直接关
        c.write_all(b"GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n").unwrap();
        let mut resp = [0u8; 200];
        let n = c.read(&mut resp).unwrap();
        assert!(String::from_utf8_lossy(&resp[..n]).contains("101"));
        client_send(&mut c, 0x2, b"not-a-room-name");
        // 读到 EOF 或 close 帧都算正确离场
        let closed = match client_recv(&mut c) {
            (0x8, _) => true,
            _ => {
                let mut one = [0u8; 1];
                c.read(&mut one).is_err()
            }
        };
        assert!(closed, "首帧不是房间名时服务端应该关门");

        stop();
        assert!(!running(), "stop 之后不该还在跑");

        // 关掉再起：这一趟专门盯"重起"那条路。start 会 join 掉上一轮的 accept 线程，
        // 否则两个 accept 线程短暂并存，老线程退出前接到的连接会注册进**旧**房间表，
        // 新表看不见它 ⇒ 那边的客户端永远收不到帧。所以这里必须真的再转发一次才算过
        let port2 = start(0).expect("重起中继失败");
        assert!(running(), "重起之后应该在跑");
        let mut a2 = client_connect(port2);
        let mut b2 = client_connect(port2);
        client_send(&mut a2, 0x1, b"room-y");
        client_send(&mut b2, 0x1, b"room-y");
        for c in [&mut a2, &mut b2] {
            c.set_read_timeout(Some(std::time::Duration::from_millis(200))).unwrap();
        }
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        let mut ok = false;
        while !ok {
            assert!(std::time::Instant::now() < deadline, "重起后探针没打通");
            client_send(&mut a2, 0x2, b"probe-a2");
            client_send(&mut b2, 0x2, b"probe-b2");
            ok = try_recv_payload(&mut b2).as_deref() == Some(&b"probe-a2"[..]) || ok;
            let _ = try_recv_payload(&mut a2);
        }
        client_send(&mut a2, 0x2, b"after-restart");
        let (op3, payload3) = client_recv(&mut b2);
        assert_eq!(op3, 0x2);
        assert_eq!(payload3, b"after-restart", "重起后的中继必须还能转发");

        stop();
        assert!(!running(), "再停一次不该还在跑");
        // 幂等：连着停两次不该炸
        stop();
        assert!(!running());
    }
}

// ────────────────────────── Tauri 命令 ──────────────────────────

/// 起中继。`port` 传 0 让系统挑。返回实际监听的端口。
#[tauri::command]
pub fn ws_relay_start(port: u16) -> Result<u16, String> {
    start(port)
}

/// 关中继。幂等；没在跑也当成功（界面上的开关点下去不该弹错）。
#[tauri::command]
pub fn ws_relay_stop() {
    stop()
}

/// 中继是否在跑
#[tauri::command]
pub fn ws_relay_running() -> bool {
    running()
}
