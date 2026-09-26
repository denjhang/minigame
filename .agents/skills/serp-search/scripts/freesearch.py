#!/usr/bin/env python3
"""
freesearch — 无 key、本地优先的联网搜索 CLI（从 free-search-mcp 剥离的轻量版）。

与 paysearch.py 的分工：paysearch.py 管付费/带 key 后端（serpapi/metaso/github/bilibili），
freesearch.py 管免 key 后端（ddg/mojeek/googlenews/wikipedia/stackexchange），
并做 RRF 融合 + SQLite 缓存。一秒级出结果，无 MCP。

反爬原理（抄自 free-search-mcp）：curl_cffi 以 chrome131 指纹发请求，
搜索与抓取共用同一指纹，避免被 DDG 的 anomaly 检测识别。

用法：
  freesearch.py "AY-3-8910 pinout"                 # 默认 ddg，5 条
  freesearch.py -m all "NeOtpusk zxart author"     # 多引擎 RRF 融合
  freesearch.py -m mojeek "PT3 format"             # 单引擎
  freesearch.py -n 10 "YM2608 OPNA"
  freesearch.py --no-cache "Vortex Tracker II"     # 跳过缓存
"""
import argparse
import html as htmllib
import json
import os
import re
import sqlite3
import sys
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

from curl_cffi import requests

IMPERSONATE = "chrome131"
CACHE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".freesearch_cache.sqlite3")
CACHE_TTL = 7 * 86400  # 一周内的重复查询直接走缓存，零网络消耗

# 本机 clash 代理（2026-09-23 实测：curl_cffi 直连 DDG 超时，必须走代理；
# 代理下 DDG 只认 POST，GET 会 202 anomaly）
PROXY = os.environ.get("FS_PROXY", "http://127.0.0.1:7890")
PROXIES = {"http": PROXY, "https": PROXY}

# OpenAlex api_key（免费学术库；key 只用于 polite 池/更高速率，缺了也能查）
OPENALEX_KEY = os.environ.get("FS_OPENALEX_KEY", "yUqfoo8s4DZqRdViClgSpI")

DDG_FRESHNESS = {"day": "d", "week": "w", "month": "m", "year": "y"}


def sess() -> requests.Session:
    return requests.Session(impersonate=IMPERSONATE, timeout=15, proxies=PROXIES)


# ---------------- HTML 工具（无 selectolax 也能跑的兜底正则版） ----------------

def strip_tags(s: str) -> str:
    s = re.sub(r"<[^>]+>", "", s)
    return (s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
            .replace("&quot;", '"').replace("&#39;", "'").replace("&nbsp;", " "))


def text_of(node) -> str:
    try:  # selectolax 节点
        return node.text(separator=" ").strip() if node else ""
    except Exception:
        return ""


def parse_ddg(html: str, n: int):
    """html.duckduckgo.com/html 解析；selectolax 可用则用之，否则正则兜底。"""
    out, seen = [], set()
    try:
        from selectolax.parser import HTMLParser
        tree = HTMLParser(html)
        for div in tree.css("div.result"):
            cls = div.attributes.get("class") or ""
            if "result--ad" in cls or "result--sponsored" in cls:
                continue
            link = div.css_first("a.result__a")
            if not link:
                continue
            url = _ddg_unwrap(link.attributes.get("href", ""))
            if "duckduckgo.com/y.js" in url or "ad_provider=" in url:
                continue
            title = text_of(link)
            snippet = text_of(div.css_first(".result__snippet"))
            if url and title and url not in seen:
                seen.add(url)
                out.append({"title": title, "url": url, "snippet": snippet})
                if len(out) >= n:
                    break
        return out
    except ImportError:
        pass
    for href, title, snip in re.findall(
            r'class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)</a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)</(?:a|div)>', html)[:n]:
        url = _ddg_unwrap(href)
        if url in seen:
            continue
        seen.add(url)
        out.append({"title": strip_tags(title).strip(), "url": url,
                    "snippet": strip_tags(snip).strip()})
    return out


def _ddg_unwrap(href: str) -> str:
    if href.startswith("//"):
        href = "https:" + href
    p = urllib.parse.urlparse(href)
    if "duckduckgo.com" in p.netloc and p.path.startswith("/l/"):
        qs = urllib.parse.parse_qs(p.query)
        if "uddg" in qs:
            return qs["uddg"][0]
    return href


# ---------------- 引擎 ----------------

def e_ddg(q, n, region=None, freshness=None):
    params = {"q": q}
    if region:
        params["kl"] = region
    if freshness:
        params["df"] = DDG_FRESHNESS.get(freshness, "")
    # 实测：代理下 GET 会 202 anomaly，POST 稳定 200；出口被标记后仍会 202
    r = sess().post("https://html.duckduckgo.com/html/", data=params,
                    headers={"Referer": "https://html.duckduckgo.com/"})
    if r.status_code != 200 or "anomaly" in r.text.lower():
        return []
    return parse_ddg(r.text, n)


def e_bing_intl(q, n, **kw):
    """国际版 bing.com（走代理）—— keyless 主引擎，英文质量远好于 cn.bing。"""
    r = sess().get("https://www.bing.com/search",
                   params={"q": q, "setlang": "en", "count": max(n, 10)})
    if r.status_code != 200:
        return []
    out, seen = [], set()
    for blk in r.text.split('<li class="b_algo"')[1:n + 1]:
        href = re.search(r'<h2[^>]*>\s*<a[^>]+href="([^"]+)"', blk)
        title = re.search(r'<h2[^>]*>\s*<a[^>]*>([\s\S]*?)</a>', blk)
        snip = re.search(r'<p[^>]*>([\s\S]*?)</p>', blk)
        if href and title:
            url = htmllib.unescape(href.group(1))
            if url not in seen:
                seen.add(url)
                out.append({"title": strip_tags(title.group(1)).strip(), "url": url,
                            "snippet": strip_tags(snip.group(1)).strip() if snip else ""})
    return out


def e_yahoo(q, n, **kw):
    r = sess().get("https://search.yahoo.com/search", params={"p": q, "n": max(n, 10)})
    if r.status_code != 200:
        return []
    out, seen = [], set()
    for href, title in re.findall(
            r'<a[^>]+href="(https?://r\.search\.yahoo\.com/[^"]+)"[^>]*class="[^"]*d-ib[^"]*"[^>]*>([\s\S]*?)</a>', r.text):
        url = htmllib.unescape(href)
        if url not in seen:
            seen.add(url)
            out.append({"title": strip_tags(title).strip(), "url": url, "snippet": ""})
            if len(out) >= n:
                break
    return out


def e_mojeek(q, n, **kw):
    r = sess().get("https://www.mojeek.com/search", params={"q": q, "t": n},
                   headers={"Referer": "https://www.mojeek.com/"})
    if r.status_code != 200:
        return []
    out, seen = [], set()
    # mojeek 结果行：<a class="ob" href="..."> 标题在 <h2> 内
    for href, title in re.findall(r'<a[^>]+class="ob"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)</a>', r.text):
        url = htmllib.unescape(href)
        t = strip_tags(title).strip()
        if url.startswith("http") and t and url not in seen:
            seen.add(url)
            out.append({"title": t, "url": url, "snippet": ""})
            if len(out) >= n:
                break
    if not out:  # 布局变体兜底
        for href, title in re.findall(r'<h2><a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)</a></h2>', r.text):
            url = htmllib.unescape(href)
            t = strip_tags(title).strip()
            if url.startswith("http") and t and url not in seen:
                seen.add(url)
                out.append({"title": t, "url": url, "snippet": ""})
                if len(out) >= n:
                    break
    return out


def e_googlenews(q, n, **kw):
    """Google News RSS —— 官方 RSS 端点，无反爬、免 key。"""
    r = sess().get("https://news.google.com/rss/search",
                   params={"q": q, "hl": "en-US", "gl": "US", "ceid": "US:en"})
    if r.status_code != 200:
        return []
    out = []
    for item in re.findall(r"<item>([\s\S]*?)</item>", r.text)[:n]:
        title = re.search(r"<title>([\s\S]*?)</title>", item)
        link = re.search(r"<link>([\s\S]*?)</link>", item)
        date = re.search(r"<pubDate>([\s\S]*?)</pubDate>", item)
        src = re.search(r"<source[^>]*>([\s\S]*?)</source>", item)
        if title and link:
            t = strip_tags(title.group(1)).strip()
            t = re.sub(r" - [^-]+$", "", t) if src else t  # 去掉尾部的 " - 媒体名"
            out.append({"title": t, "url": link.group(1).strip(),
                        "snippet": f"[{strip_tags(src.group(1)).strip() if src else ''} {date.group(1).strip() if date else ''}]".strip(" []")})
    return out


def e_wikipedia(q, n, **kw):
    """Wikipedia 站内搜索（en+zh 双语）—— 查芯片/厂商/历史名词质量最高。"""
    out = []
    for lang in ("en", "zh"):
        r = sess().get(f"https://{lang}.wikipedia.org/w/api.php", params={
            "action": "query", "list": "search", "srsearch": q, "srlimit": n,
            "format": "json", "srprop": "snippet"})
        if r.status_code != 200:
            continue
        for x in (r.json().get("query", {}).get("search") or []):
            out.append({"title": f"[{lang}] {x['title']}",
                        "url": f"https://{lang}.wikipedia.org/wiki/{urllib.parse.quote(x['title'].replace(' ', '_'))}",
                        "snippet": strip_tags(x.get("snippet", ""))})
        if out:
            break  # en 命中就不查 zh
    return out[:n]


def e_stackexchange(q, n, **kw):
    r = sess().get("https://api.stackexchange.com/2.3/search/advanced", params={
        "order": "desc", "sort": "relevance", "q": q, "site": "stackoverflow", "pagesize": n})
    if r.status_code != 200:
        return []
    return [{"title": x.get("title", ""),
             "url": x.get("link", ""),
             "snippet": f"score {x.get('score', 0)} | answers {x.get('answer_count', 0)} | tags: {','.join(x.get('tags', []))}"}
            for x in r.json().get("items", [])]


def e_openalex(q, n, **kw):
    """OpenAlex 学术文献库（免费，api_key 走 polite 池提速率）——查芯片/格式史料论文。"""
    params = {"search": q, "per-page": n}
    if OPENALEX_KEY:
        params["api_key"] = OPENALEX_KEY
    r = sess().get("https://api.openalex.org/works", params=params)
    if r.status_code != 200:
        return []
    out = []
    for w in (r.json().get("results") or [])[:n]:
        year = w.get("publication_year") or ""
        venue = ((w.get("primary_location") or {}).get("source") or {}).get("display_name") or ""
        url = ((w.get("primary_location") or {}).get("landing_page_url") or w.get("doi") or "")
        out.append({"title": f"{w.get('display_name', '')} ({year})",
                    "url": url,
                    "snippet": f"cited_by {w.get('cited_by_count', 0)} | {venue}"})
    return out


ENGINES = {
    "bing": e_bing_intl,
    "ddg": e_ddg,
    "yahoo": e_yahoo,
    "news": e_googlenews,
    "wiki": e_wikipedia,
    "so": e_stackexchange,
    "oa": e_openalex,
}

# chain 默认：bing-intl 为主（走代理质量远好于 cn.bing），ddg/yahoo 兜底
DEFAULT_CHAIN = ["bing", "ddg", "yahoo"]


# ---------------- RRF 融合 ----------------

def rrf_merge(results_by_engine, n, k=60):
    """互惠排序融合：score = Σ 1/(k+rank)，多引擎都排前的结果自然胜出。"""
    scores, meta = {}, {}
    for eng, items in results_by_engine.items():
        for rank, it in enumerate(items, 1):
            u = it["url"]
            scores[u] = scores.get(u, 0.0) + 1.0 / (k + rank)
            if u not in meta:
                meta[u] = it
            else:
                # 补 snippet
                if not meta[u].get("snippet") and it.get("snippet"):
                    meta[u]["snippet"] = it["snippet"]
                meta[u]["_eng"] = meta[u].get("_eng", eng) + "+" + eng
    ranked = sorted(scores.items(), key=lambda kv: -kv[1])[:n]
    out = []
    for u, s in ranked:
        it = dict(meta[u])
        it["_score"] = round(s, 4)
        out.append(it)
    return out


# ---------------- SQLite 缓存 ----------------

def cache_init():
    db = sqlite3.connect(CACHE_PATH)
    db.execute("CREATE TABLE IF NOT EXISTS cache (k TEXT PRIMARY KEY, v TEXT, ts REAL)")
    db.commit()
    return db


def cache_get(db, key):
    try:
        row = db.execute("SELECT v, ts FROM cache WHERE k=?", (key,)).fetchone()
        if row and time.time() - row[1] < CACHE_TTL:
            return json.loads(row[1])
    except Exception:
        pass
    return None


def cache_put(db, key, val):
    try:
        db.execute("INSERT OR REPLACE INTO cache VALUES (?,?,?)", (key, json.dumps(val, ensure_ascii=False), time.time()))
        db.commit()
    except Exception:
        pass


# ---------------- 主流程 ----------------

def search(q, mode="chain", n=5, region=None, freshness=None, use_cache=True):
    key = json.dumps([q, mode, n, region, freshness], ensure_ascii=False)
    db = cache_init() if use_cache else None
    if db:
        hit = cache_get(db, key)
        if hit is not None:
            return hit, True
    engines = (list(ENGINES) if mode == "all"
               else DEFAULT_CHAIN if mode == "chain"
               else [mode] if mode in ENGINES else None)
    if engines is None:
        return {"error": f"unknown mode: {mode}（可选：{'/'.join(ENGINES)}/chain/all）"}, False

    def run(eng):
        try:
            return eng, ENGINES[eng](q, n, region=region, freshness=freshness)
        except Exception as e:
            return eng, {"error": f"{type(e).__name__}: {e}"}

    with ThreadPoolExecutor(max_workers=len(engines)) as ex:
        got = dict()
        for eng, items in ex.map(run, engines):
            if isinstance(items, list) and items:
                got[eng] = items
    if not got:
        res = {"error": "all engines empty"}
    elif mode in ("chain", "all") and len(got) > 1:
        res = {"engine": "+".join(got), "results": rrf_merge(got, n)}
    else:
        eng, items = next(iter(got.items()))
        res = {"engine": eng, "results": items[:n]}
    if db and "error" not in res:
        cache_put(db, key, res)
        db.close()
    elif db:
        db.close()
    return res, False


def fmt(res):
    if "error" in res:
        return f"[error] {res['error']}"
    lines = [f"(engine: {res['engine']})"]
    for i, r in enumerate(res["results"], 1):
        lines.append(f"{i}. {r['title']}")
        lines.append(f"   {r['url']}")
        if r.get("snippet"):
            snip = r["snippet"]
            lines.append(f"   {snip[:400]}{'…' if len(snip) > 400 else ''}")
    return "\n".join(lines)


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    ap = argparse.ArgumentParser(description="keyless 多引擎搜索（FrameNote 免费通道）")
    ap.add_argument("query", help="查询串")
    ap.add_argument("-m", "--mode", default="chain",
                    choices=list(ENGINES) + ["chain", "all"], help="引擎/融合模式")
    ap.add_argument("-n", "--count", type=int, default=5)
    ap.add_argument("-r", "--region", help="ddg 地区码，如 cn-zh / us-en / ru-ru")
    ap.add_argument("-f", "--freshness", choices=list(DDG_FRESHNESS), help="ddg 时间过滤")
    ap.add_argument("--no-cache", action="store_true")
    args = ap.parse_args()
    t0 = time.time()
    res, cached = search(args.query, args.mode, args.count, args.region,
                         args.freshness, use_cache=not args.no_cache)
    tag = " [cached]" if cached else ""
    print(fmt(res))
    print(f"\n({time.time() - t0:.2f}s{tag})")


if __name__ == "__main__":
    main()
