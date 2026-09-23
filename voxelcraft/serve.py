#!/usr/bin/env python3
"""Voxelcraft 本地开发服务器。

用 python -m http.server 时，Chromium 会用启发式缓存把旧版 .js 模块
当成"新鲜"的直接返回，改了代码刷新页面却还是旧逻辑（这是排查时踩过的坑）。
这里给所有响应加上 no-cache，保证每次刷新都拿到磁盘上的最新代码。

用法：
    python serve.py            # 默认 8471 端口（8000 被本机其它程序占用，勿动）
    python serve.py 8500       # 换端口
"""
import functools
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8471
ROOT = os.path.dirname(os.path.abspath(__file__))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


def main():
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as srv:
        print(f"Voxelcraft 开发服务器： http://localhost:{PORT}/  (Ctrl+C 停止)")
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            print("\n已停止")


if __name__ == "__main__":
    main()
