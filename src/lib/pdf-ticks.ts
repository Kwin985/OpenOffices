/**
 * pdf-lib 的两枚「让出」旋钮，归一处
 *
 * 解析与序列化都是每攒够 objectsPerTick 枚对象就 `await setTimeout(resolve, 0)` 交还一次主线程。
 * 库默认极细：parseSpeed = ParseSpeeds.Slow（100 枚一让）、save = 50 枚一让，
 * 而 Chromium 把嵌套的 0 延时定时器钳到 ≥4ms ⇒ 让出次数本身就成了耗时。
 *
 * 实测（2300 页 / 4764 枚间接对象，dev，只 load+save 不落盘）：
 * 默认档墙钟 985~993ms，而这段时间主线程最多只被占 3ms（node 侧 CDP 往返尺），页内 10ms 节拍与
 * longtask 观测器整窗 0 条——那 1 秒几乎全是等定时器；两头都不让出只要 55~64ms，那才是真 CPU。
 * 1500 这一档（库自己的 ParseSpeeds.Fast）：墙钟 73~96ms，单块 ≤10ms，输出字节与默认档逐位相同。
 * 所以按「一块的 CPU 预算」而不是按库默认来定，且大小件吃同一个数（件小本来就没几枚对象，让出次数≈0）。
 */
export const PDF_OBJECTS_PER_TICK = 1500
