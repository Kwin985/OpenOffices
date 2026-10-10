# -*- coding: utf-8 -*-
# 独立分母腿：用另一种 XML 解析器（Python 标准库 xml.etree）把同一批真件的属性字面再数一遍。
#
# 为什么要有这一枚：docs/fidelity.json 里的分母是 scripts/fidelity-report.mjs 用我们自己那台
# 迷你解析器（src/lib/ooxml.ts 的 parseXml）数的。一台解析器数错了，整份覆盖率就跟着错，而这种
# 错法不会在任何地方露出来。这一枚走完全不同的一条路（zipfile + ElementTree），两枚数出来的
# distinct_pairs 与 total_occ 必须逐枚相同——不相同就是其中一台在骗人。
#
# 输出只有聚合数字：语料是每个人本地的那些件，公开的产物里不许出现路径或文件名。
#
#   python3 scripts/fidelity-census.py --corpus /path/to/docx
#   python3 scripts/fidelity-census.py --clist clist.txt --json tmp/census.json
import argparse
import io
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter

# 与生成器同一套口径：读手真正吃进去的 7 枚部件
PARTS = [
    "word/document.xml",
    "word/styles.xml",
    "word/numbering.xml",
    "word/footnotes.xml",
    "word/endnotes.xml",
    "word/comments.xml",
    "word/commentsExtended.xml",
]
# Word 的存档流水号：按名字规则归噪音档（与生成器的 NOISE 同一条）
NOISE = re.compile(r"^(rsid[A-Za-z]*|paraId|textId)$")

LOCAL = lambda q: q.rsplit("}", 1)[-1] if "}" in q else q


def win(p: str) -> str:
    # 清单可能是 MSYS 形态（/d/x/...），Windows 上的 python 要盘符形态；统一正斜杠避开反斜杠转义
    m = re.match(r"^/([a-zA-Z])/(.*)$", p)
    if m:
        return f"{m.group(1).upper()}:/{m.group(2)}"
    return p


def listing(args):
    if args.clist:
        with open(args.clist, encoding="utf-8") as fh:
            return [win(s.strip()) for s in fh if s.strip()]
    out = []
    skip = {"node_modules", ".git", "dist", "target", "__pycache__"}
    for root, dirs, names in os.walk(args.corpus):
        dirs[:] = [d for d in dirs if d not in skip]
        for nm in names:
            if nm.lower().endswith(".docx") and not nm.startswith("~$"):
                out.append(os.path.join(root, nm))
    return sorted(out)


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--corpus", help="docx 目录")
    g.add_argument("--clist", help="一行一枚路径的清单文件")
    ap.add_argument("--json", help="把逐对计数写到这个文件（供比对）")
    args = ap.parse_args()

    files = listing(args)
    pairs = Counter()
    per_part = Counter()
    ok = 0
    bad = 0
    # 键只有「元素|属性」名，路径从不进键 ⇒ 同名件既不会并错，产物里也不带文件名
    for path in files:
        try:
            raw = open(path, "rb").read()
            zf = zipfile.ZipFile(io.BytesIO(raw))
        except Exception:
            bad += 1
            continue
        read_any = False
        for part in PARTS:
            try:
                data = zf.read(part)
            except KeyError:
                continue
            read_any = True
            try:
                root = ET.fromstring(data)
            except Exception:
                continue
            stack = [root]
            while stack:
                el = stack.pop()
                parent = LOCAL(el.tag)
                for k in el.attrib:
                    pairs[f"{parent}|{LOCAL(k)}"] += 1
                    per_part[part] += 1
                stack.extend(list(el))
        if read_any:
            ok += 1
        else:
            bad += 1

    noise = sum(v for k, v in pairs.items() if NOISE.match(k.split("|")[1]))
    total = sum(pairs.values())
    print(f"CENSUS|files={len(files)} files_ok={ok} files_bad={bad}")
    print(f"CENSUS|distinct_pairs={len(pairs)} total_occ={total} noise_occ={noise} meaningful_occ={total - noise}")
    print("CENSUS|per_part " + " ".join(f"{p.split('/')[-1]}={per_part[p]}" for p in PARTS if per_part[p]))
    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump({"distinct_pairs": len(pairs), "total_occ": total, "noise_occ": noise,
                       "files_ok": ok, "files_bad": bad, "pairs": dict(sorted(pairs.items()))},
                      fh, ensure_ascii=False, indent=2, sort_keys=True)
            fh.write("\n")
        print(f"CENSUS|逐对计数写盘 {args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
