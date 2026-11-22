#!/usr/bin/env python3
"""修复中文内容里误用的半角引号：把字符串内部的 " 转换为「」配对。"""
import json
import re
import sys


def fix_text(s):
    out = []
    i = 0
    n = len(s)
    in_str = False
    inner_open = True
    while i < n:
        ch = s[i]
        if not in_str:
            out.append(ch)
            if ch == '"':
                j = len(out) - 2
                while j >= 0 and out[j] in ' \t\n':
                    j -= 1
                prev = out[j] if j >= 0 else ''
                if prev in ':[,':
                    in_str = True
                    inner_open = True
            i += 1
            continue
        if ch == '"':
            j = i + 1
            while j < n and s[j] in ' \t\n':
                j += 1
            nxt = s[j] if j < n else ''
            if nxt in ',}]:' or nxt == '':
                out.append('"')
                in_str = False
                i += 1
                continue
            out.append('「' if inner_open else '」')
            inner_open = not inner_open
            i += 1
            continue
        out.append(ch)
        i += 1
    return ''.join(out)


def main(path):
    raw = open(path, encoding='utf-8').read()
    try:
        json.loads(raw)
        print(f'{path}: already valid')
        return 0
    except Exception:
        pass
    fixed = fix_text(raw)
    try:
        data = json.loads(fixed)
    except Exception as e:
        print(f'{path}: STILL INVALID -> {e}')
        m = re.search(r'line (\d+) column (\d+)', str(e))
        if m:
            ln = int(m.group(1))
            print(fixed.split('\n')[ln - 1][:220])
        return 1
    open(path, 'w', encoding='utf-8').write(fixed)
    count = len(data.get('questions', [])) if isinstance(data, dict) else len(data)
    print(f'{path}: fixed & valid ({count} items)')
    return 0


if __name__ == '__main__':
    code = 0
    for p in sys.argv[1:]:
        code |= main(p)
    sys.exit(code)
