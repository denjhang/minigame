#!/usr/bin/env python3
"""
付费/带 key 联网查证 CLI（FrameNote 验证曲名/作者/专名用）。
免费免 key 的通用+垂直通道见同目录 freesearch.py——两个文件按「付费/免费」分工，勿混。

支持的后端（按优先级自动链）：
  tavily    Tavily（Researcher 1000 次/月，chain 默认打头，质量最好）
  serpapi   SerpAPI 多引擎（google/bing/baidu/duckduckgo/brave/yahoo/yandex）
  bing      cn.bing.com HTML 抓取 + 真实 URL 解码
  metaso    Metaso.cn 中文语义搜索
  github    GitHub repos / code / issues 检索
  bilibili  B站 video / article / live 检索
  chain     自动链：中文 tavily→metaso→serpapi→bing；英文 tavily→serpapi→bing
  fetch     拉取 URL 正文（GitHub 走 contents API，Metaso reader 回退）

密钥来源：Denjhang Harness 的 src/tools/web.ts；可用环境变量覆盖。
  DJH_SERPAPI_KEY   DJH_TAVILY_KEY   DJH_METASO_KEY   DJH_GITHUB_TOKEN

用法：
  paysearch.py -m serpapi -n 5 "NeOtpusk zx spectrum pt3"
  paysearch.py -m bing -n 5 "FrameNote site:zxart.ee"
  paysearch.py -m metaso "ZX Spectrum PT3 曲库"
  paysearch.py -m github -t repos "node-spfm"
  paysearch.py -m bilibili -t video "AY-3-8910"
  paysearch.py -m chain -n 5 "Solitude Lost Party 2024 author"
  paysearch.py -m fetch https://zxart.ee/eng/music/tunes/
  paysearch.py --batch names.txt -m chain -t '"zxart.ee" "{q}"'
  paysearch.py -m account         查 SerpAPI 剩余额度
"""
import argparse
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request

DEFAULT_SERPAPI_KEY = "6f4d9e6b1b454d51fe2f82dc1fb50624d8755e8350c7a1f110f3b704ece1b16f"
DEFAULT_METASO_KEY = "mk-141B657C931B159E5CB4447BCBE93886"
DEFAULT_TAVILY_KEY = "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"
SERPAPI = "https://serpapi.com/search"
BING = "http://cn.bing.com/search"
METASO_SEARCH = "https://metaso.cn/api/v1/search"
METASO_READER = "https://metaso.cn/api/v1/reader"
GITHUB = "https://api.github.com"
BILI = "https://api.bilibili.com/x/web-interface/search/type"
TAVILY = "https://api.tavily.com/search"

ENGINES = ["google", "bing", "baidu", "duckduckgo", "brave", "yahoo", "yandex"]
BILI_TYPES = ["video", "article", "live"]
GH_TYPES = {"repos": "repositories", "code": "code", "issues": "issues"}


def k_serp() -> str:
    return os.environ.get("DJH_SERPAPI_KEY") or DEFAULT_SERPAPI_KEY


def k_meta() -> str:
    return os.environ.get("DJH_METASO_KEY") or DEFAULT_METASO_KEY


def k_gh() -> str:
    return os.environ.get("DJH_GITHUB_TOKEN", "")


def k_tavily() -> str:
    return os.environ.get("DJH_TAVILY_KEY") or DEFAULT_TAVILY_KEY


def http_get(url: str, headers=None, timeout=20):
    h = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) FrameNote/1.0", "Accept": "*/*"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", errors="replace")
    except Exception as e:
        return 0, f"[error] {type(e).__name__}: {e}"


def http_post_json(url: str, payload: dict, headers=None, timeout=20):
    h = {"User-Agent": "Mozilla/5.0 FrameNote/1.0", "Content-Type": "application/json"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"),
                                 headers=h, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", errors="replace")
    except Exception as e:
        return 0, f"[error] {type(e).__name__}: {e}"


def strip_tags(s: str) -> str:
    return (s.replace("<[^>]+>", "", 1) if False else re.sub(r"<[^>]+>", "", s)) \
        .replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">") \
        .replace("&quot;", '"').replace("&#39;", "'")


def autoquote(s: str) -> str:
    """单串专名自动加引号（避免搜索引擎自由联想拆分）。"""
    if '"' in s or "'" in s or " " in s or not s.strip():
        return s
    return f'"{s}"'


def truncate(s: str, n: int) -> str:
    return s if len(s) <= n else s[:n] + "…"


def fmt_results(items, snip_chars=400):
    out = []
    for i, r in enumerate(items, 1):
        title = (r.get("title") or "").strip()
        link = (r.get("link") or "").strip()
        snip = (r.get("snippet") or r.get("description") or "").strip()
        b = [f"{i}. {title}"]
        if link:
            b.append(f"   {link}")
        if snip:
            b.append(f"   {truncate(snip, snip_chars)}")
        if r.get("date"):
            b.append(f"   date: {r['date']}")
        out.append("\n".join(b))
    return "\n".join(out)


# =================== serpapi ===================

def search_serpapi(query, engine="google", n=5, snip=400, hl="en", gl="us"):
    url = (f"{SERPAPI}?engine={urllib.parse.quote(engine)}"
           f"&q={urllib.parse.quote(query)}&hl={hl}&gl={gl}"
           f"&num={max(1, min(int(n), 100))}&api_key={k_serp()}")
    s, b = http_get(url, timeout=30)
    if s != 200:
        return f"[error] serpapi HTTP {s}"
    try:
        d = json.loads(b)
    except Exception as e:
        return f"[error] serpapi json: {e}"
    if d.get("error"):
        return f"[error] {d['error']}"
    org = d.get("organic_results") or []
    for alt in ("video_results", "news_results", "top_stories"):
        if not org and d.get(alt):
            org = d[alt]
    return fmt_results(org, snip) or "(no organic results)"


# =================== tavily ===================

def search_tavily(query, n=5, snip_chars=400):
    """Tavily（Researcher 计划 1000 次/月）——为 agent 设计，结果自带正文摘要，质量高。"""
    payload = {"query": query, "max_results": max(1, min(int(n), 10)),
               "search_depth": "basic", "include_answer": False}
    s, b = http_post_json(TAVILY, payload,
                          headers={"Authorization": f"Bearer {k_tavily()}"}, timeout=30)
    if s != 200:
        return f"[error] tavily HTTP {s}: {b[:200]}"
    try:
        d = json.loads(b)
    except Exception as e:
        return f"[error] tavily json: {e}"
    items = [{"title": r.get("title", ""), "link": r.get("url", ""),
              "snippet": r.get("content", "")} for r in (d.get("results") or [])]
    return fmt_results(items, snip_chars) if items else "(no tavily results)"


# =================== brave ===================

def search_brave(query, n=5, snip_chars=400):
    """Brave Search API（X-Subscription-Token）。⚠️ 本机 brave.com 被墙且 clash 默认判直连，
    必须在代理规则里加 DOMAIN-SUFFIX,brave.com,PROXY（或切全局模式）才通。走 curl_cffi 浏览器指纹 + 7890。"""
    key = os.environ.get("DJH_BRAVE_KEY", "BSAfa5ajfqD1v5julD2QJv8df-WnRp4")
    proxy = os.environ.get("DJH_PROXY", "http://127.0.0.1:7890")
    try:
        from curl_cffi import requests as cffi_requests
    except ImportError:
        return "[error] 需要 curl_cffi：C:/Python313/python.exe -m pip install curl_cffi"
    try:
        s = cffi_requests.Session(impersonate="chrome131", timeout=15,
                                  proxies={"http": proxy, "https": proxy})
        r = s.get("https://api.search.brave.com/res/v1/web/search",
                  params={"q": query, "count": max(1, min(int(n), 20))},
                  headers={"Accept": "application/json",
                           "X-Subscription-Token": key})
    except Exception as e:
        return (f"[error] brave 连接失败（brave.com 被墙/代理未放行）：{type(e).__name__}。"
                f"请在 clash 规则加 DOMAIN-SUFFIX,brave.com,PROXY 后重试")
    if r.status_code != 200:
        return f"[error] brave HTTP {r.status_code}: {r.text[:200]}"
    try:
        d = r.json()
    except Exception as e:
        return f"[error] brave json: {e}"
    items = [{"title": x.get("title", ""), "link": x.get("url", ""),
              "snippet": x.get("description", "")}
             for x in ((d.get("web") or {}).get("results") or [])]
    return fmt_results(items, snip_chars) if items else "(no brave results)"


# =================== bing HTML ===================

def search_bing(query, n=5, snip_chars=400):
    s, b = http_get(f"{BING}?q={urllib.parse.quote(query)}&ensearch=1")
    if s != 200:
        return f"[error] bing HTTP {s}"
    items = []
    for blk in b.split('<li class="b_algo"')[1: n + 1]:
        href = re.search(r'<h2[^>]*>\s*<a[^>]+href="([^"]+)"', blk)
        title = re.search(r'<h2[^>]*>\s*<a[^>]*>([\s\S]*?)</a>', blk)
        snip_m = re.search(r'<p[^>]*>([\s\S]*?)</p>', blk)
        if href and title:
            items.append({
                "title": strip_tags(title.group(1)).strip(),
                "link": decode_bing(href.group(1)),
                "snippet": strip_tags(snip_m.group(1)).strip() if snip_m else "",
            })
    return fmt_results(items, snip_chars) if items else "(no bing results)"


def decode_bing(href: str) -> str:
    h = href.replace("&amp;", "&")
    m = re.search(r"[?&]u=a1([A-Za-z0-9+/=_-]+)", h)
    if not m:
        return h
    import base64
    try:
        b = m.group(1).replace("-", "+").replace("_", "/")
        while len(b) % 4:
            b += "="
        d = base64.b64decode(b).decode("utf-8", errors="replace")
        return d if d.startswith("http") else h
    except Exception:
        return h


# =================== metaso ===================

def search_metaso(query, n=5, snip_chars=400):
    s, b = http_post_json(METASO_SEARCH,
                          {"q": query, "scope": "webpage", "includeSummary": False,
                           "size": str(max(1, min(int(n), 50))), "includeRawContent": False,
                           "conciseSnippet": False},
                          headers={"Authorization": f"Bearer {k_meta()}"})
    if s != 200:
        return f"[error] metaso HTTP {s}"
    try:
        d = json.loads(b)
    except Exception as e:
        return f"[error] metaso json: {e}"
    items = []
    for r in (d.get("webpages") or [])[:n]:
        items.append({"title": r.get("title", ""), "link": r.get("link", ""),
                      "snippet": r.get("snippet", "")})
    return fmt_results(items, snip_chars) if items else "(no metaso results)"


def fetch_metaso(url: str) -> str:
    s, b = http_post_json(METASO_READER, {"url": url},
                          headers={"Authorization": f"Bearer {k_meta()}"})
    if s != 200:
        return ""
    return b.strip()


# =================== github ===================

def search_github(query, t="repos", n=5):
    api_t = GH_TYPES.get(t, "repositories")
    url = f"{GITHUB}/search/{api_t}?q={urllib.parse.quote(query)}&per_page={n}"
    h = {"Accept": "application/vnd.github.v3+json"}
    if k_gh():
        h["Authorization"] = f"token {k_gh()}"
    s, b = http_get(url, headers=h, timeout=25)
    if s != 200:
        return f"[error] github HTTP {s} (rate limit?)"
    try:
        d = json.loads(b)
    except Exception as e:
        return f"[error] github json: {e}"
    items = d.get("items") or []
    if not items:
        return "(no github results)"
    out = []
    for i, r in enumerate(items, 1):
        if api_t == "repositories":
            out.append(f"{i}. {r['full_name']} ★{r['stargazers_count']}\n   {truncate((r.get('description') or ''), 150)}\n   {r['html_url']}")
        else:
            out.append(f"{i}. {r['html_url']}\n   {truncate((r.get('name') or r.get('title') or ''), 120)}")
    return "\n".join(out)


def fetch_github_file(repo, path, branch="master"):
    """仿 Denjhang Harness：依次尝试 master/main + README 变体。"""
    if not re.match(r"^[^/\s]+/[^/\s]+$", repo):
        return "[error] repo 形如 'owner/name'"
    variants = [path] if not path.lower().startswith("readme") else \
        ["README.md", "Readme.md", "readme.md", "README.txt", "README"]
    branches = ["master", "main"] if branch == "main" else [branch, "main"]
    for br in branches:
        for v in variants:
            url = f"{GITHUB}/repos/{repo}/contents/{urllib.parse.quote(v).replace('%2F', '/')}?ref={urllib.parse.quote(br)}"
            h = {"Accept": "application/vnd.github.v3+json"}
            if k_gh():
                h["Authorization"] = f"token {k_gh()}"
            s, b = http_get(url, headers=h, timeout=20)
            if s != 200:
                continue
            try:
                d = json.loads(b)
            except Exception:
                continue
            if d.get("encoding") == "base64" and isinstance(d.get("content"), str):
                import base64
                try:
                    return base64.b64decode(d["content"].replace("\n", "")).decode("utf-8", errors="replace")
                except Exception:
                    return d["content"]
            return d.get("content", "")
    return f"[error] file not found: {repo}/{path} (tried master and main)"


# =================== bilibili ===================

def search_bilibili(query, t="video", n=5):
    if t not in BILI_TYPES:
        t = "video"
    # 412 anti-crawler gate: a fresh buvid3 satisfies it
    import random, string
    buvid = "".join(random.choices(string.digits + string.ascii_lowercase, k=24)) + "infoc"
    url = f"{BILI}?search_type={t}&keyword={urllib.parse.quote(query)}&page=1&page_size={n}"
    s, b = http_get(url, headers={
        "Referer": "https://www.bilibili.com/",
        "Accept": "application/json",
        "Cookie": f"buvid3={buvid}",
    }, timeout=20)
    if s != 200:
        return f"[error] bilibili HTTP {s}"
    try:
        d = json.loads(b)
    except Exception as e:
        return f"[error] bilibili json: {e}"
    data = d.get("data") or {}
    items = (data.get("result") if t != "live" else (data.get("result") or {}).get("live_room")) or []
    if not items:
        return "(no bilibili results)"
    out = []
    for i, r in enumerate(items[:n], 1):
        title = strip_tags(r.get("title") or r.get("uname") or "")
        if t == "video":
            link = f"https://www.bilibili.com/video/{r.get('bvid')}"
            stat = f"up: {r.get('author','')} | play: {r.get('play', 0)}"
        elif t == "live":
            link = f"https://live.bilibili.com/{r.get('roomid')}"
            stat = f"anchor: {r.get('uname','')} | viewers: {r.get('online', 0)}"
        else:
            link = r.get("arcurl") or f"https://www.bilibili.com/read/cv{r.get('id','')}"
            stat = ""
        out.append(f"{i}. {title}\n   {link}\n   {stat}")
    return "\n".join(out)


# =================== web_fetch ===================

def fetch_url(url: str, n=4000):
    url = re.sub(r"\s+", "", url)
    if not re.match(r"^https?://", url, re.I):
        url = "http://" + url
    # GitHub raw
    m = re.match(r"github\.com/([^/]+)/([^/]+)/blob/([^/]+)/(.+)$", url)
    if m:
        c = fetch_github_file(f"{m.group(1)}/{m.group(2)}", m.group(4), m.group(3))
        if not c.startswith("[error]"):
            return truncate(c, 20000)
    m = re.match(r"github\.com/([^/]+)/([^/]+)(?:/|$)", url)
    if m:
        c = fetch_github_file(f"{m.group(1)}/{m.group(2)}", "README.md")
        if not c.startswith("[error]"):
            return truncate(c, 20000)
    # Metaso reader
    if k_meta():
        s, b = http_post_json(METASO_READER, {"url": url},
                              headers={"Authorization": f"Bearer {k_meta()}"}, timeout=25)
        if s == 200 and b.strip():
            return b.strip()
    # 直拉 + 去 HTML
    s, b = http_get(url, timeout=25)
    if s != 200:
        return f"[error] HTTP {s}"
    text = strip_tags(re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", "", b, flags=re.I))
    text = re.sub(r"\s+", " ", text).strip()
    return truncate(text, n) if text else "[error] empty page"


# =================== chain（自动引擎链） ===================

def chain_search(query, n=5, snip=400, prefer="auto"):
    """自动引擎链。

    与 Denjhang Harness 的 web_search 同为「多后端依次尝试」，但顺序按本项目
    实测调整过：
      - 英文查询把 **serpapi-google 放首位**。原实现英文优先走 keyless 的
        cn.bing（为省额度），但实测 cn.bing 对英文/带引号查询经常返回中文
        SEO 垃圾（查 zxart 曲目时返回过抖音、教师节、美甲店），检索质量不可靠。
      - 中文查询仍走 metaso（中文语义搜索）优先。
      - serpapi 无额度或失败时，回退到 bing 兜底。
    """
    is_cjk = bool(re.search(r"[\u4e00-\u9fff]", query))
    # tavily（2026-09-23 入列，Researcher 1000 次/月，质量最好）打头；
    # 免费兜底见 scripts/freesearch.py（bing-intl/yahoo 免 key 走代理）
    engines = (["tavily", "metaso", "serpapi-google", "bing"] if is_cjk
               else ["tavily", "serpapi-google", "serpapi-ddg", "bing"])
    errors = []
    for name in engines:
        try:
            if name == "tavily":
                r = search_tavily(query, n, snip)
            elif name == "metaso":
                r = search_metaso(query, n, snip)
            elif name == "bing":
                r = search_bing(query, n, snip)
            elif name == "serpapi-google":
                r = search_serpapi(query, "google", n, snip)
            elif name == "serpapi-ddg":
                r = search_serpapi(query, "duckduckgo", n, snip)
            else:
                continue
            if not r or r.startswith("[error]") or r.startswith("(no "):
                errors.append(f"{name}: empty/error")
                continue
            return r
        except Exception as e:
            errors.append(f"{name}: {e}")
    return f"[error] all backends failed: {'; '.join(errors)}"


# =================== account ===================

def account():
    s, b = http_get(f"https://serpapi.com/account?api_key={k_serp()}")
    if s != 200:
        return f"[error] HTTP {s}"
    try:
        d = json.loads(b)
    except Exception as e:
        return f"[error] json: {e}"
    keys = ["plan_name", "searches_per_month", "plan_searches_left",
            "total_searches_left", "this_month_usage", "account_email"]
    return "\n".join(f"{k}: {d.get(k)}" for k in keys if k in d) or b[:800]


# =================== dispatcher ===================

def run_one(mode, queries, n, snip, engine, ghtype, bilitype, tpl,
            raw=False, noquote=False):
    for q in queries:
        # fetch/github/bilibili 不吃 autoquote：URL 加引号会坏，仓库名/关键词加引号
        # 只会缩小命中面；只有网页搜索后端需要它防自由联想
        if mode in ("fetch", "github", "bilibili"):
            base = q
        else:
            base = q if noquote else autoquote(q)
        r = tpl.replace("{q}", base) if tpl else base
        print(f"## {r}  (mode={mode})")
        out = ""
        try:
            if mode == "serpapi":
                out = search_serpapi(r, engine, n, snip)
            elif mode == "brave":
                out = search_brave(r, n, snip)
            elif mode == "tavily":
                out = search_tavily(r, n, snip)
            elif mode == "bing":
                out = search_bing(r, n, snip)
            elif mode == "metaso":
                out = search_metaso(r, n, snip)
            elif mode == "chain":
                out = chain_search(r, n, snip)
            elif mode == "github":
                out = search_github(r, ghtype, n)
            elif mode == "bilibili":
                out = search_bilibili(r, bilitype, n)
            elif mode == "fetch":
                out = fetch_url(r)
            elif mode == "account":
                out = account()
            else:
                out = f"[error] unknown mode: {mode}"
        except Exception as e:
            out = f"[error] {type(e).__name__}: {e}"
        if raw and mode in ("serpapi", "bing", "metaso", "github", "bilibili"):
            # raw only meaningful for those that return raw JSON; otherwise print text
            print(out)
        else:
            print(out)
        print()


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    ap = argparse.ArgumentParser(description="Multi-backend search (FrameNote)")
    ap.add_argument("-m", "--mode", default="chain",
                    choices=["serpapi", "tavily", "brave", "bing", "metaso", "chain",
                             "github", "bilibili", "fetch", "account"],
                    help="default=chain (auto engine chain)")
    ap.add_argument("queries", nargs="*", help="query string(s)")
    ap.add_argument("-e", "--engine", default="google", choices=ENGINES)
    ap.add_argument("-n", "--count", type=int, default=5)
    ap.add_argument("-s", "--snippet", type=int, default=400)
    ap.add_argument("-t", "--template", help="batch template with {q} placeholder")
    ap.add_argument("--batch", help="file: one query per line")
    ap.add_argument("--gh-type", default="repos",
                    choices=list(GH_TYPES.keys()))
    ap.add_argument("--bili-type", default="video", choices=BILI_TYPES)
    ap.add_argument("--raw", action="store_true",
                    help="for fetch: don't prettify; for engines: print raw text")
    ap.add_argument("--no-quote", action="store_true",
                    help="disable auto-quoting of single-token queries")
    args = ap.parse_args()

    if args.mode == "account":
        print(account()); return 0

    queries = list(args.queries)
    if args.batch:
        with io.open(args.batch, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    queries.append(line)
    if args.mode == "fetch" and not queries and args.queries:
        queries = list(args.queries)
    if not queries and args.mode != "fetch":
        ap.error("需要至少一个查询串（fetch 模式可只传 URL）")

    run_one(args.mode, queries, args.count, args.snippet, args.engine,
            args.gh_type, args.bili_type, args.template, args.raw, args.no_quote)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
