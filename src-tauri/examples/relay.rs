// 独立中继（只为测试存在）
//
// 用途：Node 侧的协同端到端测试需要一个真的中继在跑。
// 这个 example 把 ws_relay 起在一个端口上然后挂着，测试连完就杀。
// 不进安装包：example 目标默认不参与 tauri build。
//
// 用法：cargo run --example relay -- <port> [read_timeout_ms]
//       端口传 0 让系统挑；第二个参数只给端到端脚本用——把连接的读超时压到毫秒级，
//       好在几百毫秒内验证"连着却不说话的连接会被清出去"，而不是干等生产的 90 秒
// 然后它把实际端口打到 stdout 第一行

fn main() {
    let port: u16 = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let cfg = match std::env::args().nth(2).and_then(|s| s.parse().ok()) {
        Some(ms) => openoffices_lib::ws_relay::ConnCfg {
            read_timeout: std::time::Duration::from_millis(ms),
            max_missed: 2,
        },
        None => openoffices_lib::ws_relay::ConnCfg::DEFAULT,
    };
    match openoffices_lib::ws_relay::start_with(port, cfg) {
        Ok(p) => {
            // 第一行给测试脚本读，之后别再往 stdout 写东西
            println!("{p}");
            use std::io::Write;
            let _ = std::io::stdout().flush();
            // 挂到被信号杀掉为止
            loop {
                std::thread::sleep(std::time::Duration::from_secs(3600));
            }
        }
        Err(e) => {
            eprintln!("起中继失败: {e}");
            std::process::exit(1);
        }
    }
}
