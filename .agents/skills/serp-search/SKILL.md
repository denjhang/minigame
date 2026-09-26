---
name: serp-search
description: 付费与免费双 CLI 联网查证——paysearch.py（Tavily 主力/SerpAPI/Brave/Metaso/GitHub/B站/chain/fetch）+ freesearch.py（免 key：Google News RSS/Wikipedia/StackOverflow/OpenAlex，curl_cffi 指纹 + RRF 融合 + SQLite 缓存）。FrameNote 写笔记时查证专名（**曲名必须查到作者**）、项目/工具/芯片、网页正文等均用此技能。触发示例："查一下这首曲子的作者"、"查证这个项目/芯片/工具"、"搜一下"、"查源码"、"查 B 站"、"读这个 URL"、"查账户余额"。
---

# 多后端联网查证（付费 + 免费双 CLI）

FrameNote 写笔记时需要查证专有名词——尤其是**曲目名称与作者**。本技能两个脚本按「付费/免费」分工，勿混：

- **`scripts/paysearch.py`** —— 付费/带 key 通道（主力）
- **`scripts/freesearch.py`** —— 免 key 通道（兜底 + 垂直查证）

统一调用方式：`C:/Python313/python.exe .agents/skills/serp-search/scripts/<脚本>.py ...`（下文简写脚本名）。

## 配额账本（2026-09-23）

| 通道 | 额度 | 角色 |
|---|---|---|
| Tavily | Researcher 1000 次/月 | **主力**，chain 默认打头，质量最好，结果自带正文摘要 |
| SerpAPI | 250 次/月（剩 209） | 疑难查询兜底（`-m serpapi -e google/baidu/...` 七引擎） |
| Brave | 待定（key 已入列） | ⚠️ 需先在 clash 放行 brave.com，见下 |
| Metaso / GitHub / B站 | 按 key / 60-5000 次/h / 无限 | 中文语义 / 项目源码 / B 站内容 |
| freesearch 全部 | **无限免 key** | 配额耗尽应急 + 垂直查证（新闻/百科/技术问答/学术论文） |

## paysearch.py 后端（`-m` 选择）

| 后端 | 来源 | 适合什么 |
|---|---|---|
| `tavily` | Tavily REST API（`POST api.tavily.com/search`，Bearer key） | 通用搜索主力；冷门芯片查询记得给专名加引号（见坑 1） |
| `serpapi` | SerpAPI 官方（google/bing/baidu/duckduckgo/brave/yahoo/yandex，`-e` 切） | 带引号精准搜索 |
| `brave` | Brave Search API（X-Subscription-Token） | ⚠️ 待代理放行 |
| `bing` | `cn.bing.com` HTML 抓取 + u=a1 重定向解码 | 中文查询免配额；英文易回中文 SEO 垃圾 |
| `metaso` | Metaso.cn 语义搜索 | 中文查询 |
| `github` | api.github.com search（repos/code/issues） | 找项目/源码/Issues |
| `bilibili` | api.bilibili.com search（video/article/live） | 找视频/专栏/直播 |
| `chain` | 自动链：中文 `tavily→metaso→serpapi→bing`；英文 `tavily→serpapi→bing` | 默认模式 |
| `fetch` | 拉取 URL 正文（GitHub 走 contents API、Metaso reader 回退、直拉最后） | 读搜索结果页 |
| `account` | SerpAPI 额度查询 | 月度配额监控 |

## 快速开始

```bash
cd D:/working/vscode-projects/FrameNote
C:/Python313/python.exe .agents/skills/serp-search/scripts/paysearch.py -m tavily -n 5 "NeOtpusk zxart"
C:/Python313/python.exe .agents/skills/serp-search/scripts/paysearch.py -m chain -n 5 "Solitude Lost Party 2024 author"
C:/Python313/python.exe .agents/skills/serp-search/scripts/paysearch.py -m fetch https://zxart.ee/eng/music/tunes/
C:/Python313/python.exe .agents/skills/serp-search/scripts/paysearch.py -m account
C:/Python313/python.exe .agents/skills/serp-search/scripts/freesearch.py -m wiki "YM2151"
```

## 按场景选后端

```bash
# 1) 查单首曲目（chain 默认走 tavily，多数够用）
paysearch.py -m chain -n 5 "NeOtpusk zxart author"
paysearch.py -m serpapi -n 5 "NeOtpusk"              # 疑难查询兜底

# 2) 冷门芯片：专名加引号防带偏（实测 SAA1099 不加引号会被 "Philips sound" 带到医疗新闻）
paysearch.py -m tavily -n 5 '"SAA1099" sound generator'
freesearch.py  -m wiki "SAA1099"                      # 芯片类 Wikipedia 命中率极高，免配额优先

# 3) 学术史料（芯片评测论文、格式沿革一手文献）
freesearch.py -m oa "AY-3-8910 sound generator"      # OpenAlex，查到 1984 年该芯片评测论文

# 4) 限定域名
paysearch.py -m serpapi -n 5 '"zxart.ee" "NeOtpusk" pt3 author'

# 5) 找项目/源码
paysearch.py -m github --gh-type repos -n 5 "denjhang"
paysearch.py -m fetch "github.com/denjhang/node-spfm/blob/master/README.md"

# 6) 找 B 站视频
paysearch.py -m bilibili --bili-type video -n 5 "AY-3-8910"

# 7) 拉页面正文
paysearch.py -m fetch https://bulba.untergrund.net/emulator_e.htm

# 8) 批量查一个曲库
paysearch.py --batch names.txt -m serpapi -t '"zxart.ee" "{q}"'
```

参数：`-m` 后端、`-e` SerpAPI 引擎、`-n` 条数、`-s` 摘要字符数、`-t` 模板（`{q}` 占位）、
`--batch` 文件（每行一个查询）、`--gh-type`/`--bili-type` 限定资源类型、`--no-quote` 关闭自动加引号。

## 关键经验（踩过的坑，务必遵守）

### 1. 单串专名必须加引号 —— 脚本已自动处理

不加引号时引擎会**自由联想拆词**。实测：

- `NeOtpusk zx spectrum pt3` → 返回美国运营商 **Spectrum 官网**（把 "Spectrum" 当 ISP）
- `"NeOtpusk" zx spectrum` → 命中 `zxart.ee/tune/63659`，读到作者 **Сергей Бульба**
- `"SAA1099" Philips sound generator` → 命中芯片资料；不加引号 → 飞利浦医疗新闻

脚本对**网页搜索后端**的**无空格查询串**自动加引号（`autoquote`），多词查询请自己给专名加。
`fetch/github/bilibili` 三类**关闭自动加引号**——URL/仓库名/搜索关键词加引号只会坏数据。

### 2. 域名也得加引号，否则被拆词

不带引号的 `zxart.ee NeOtpusk pt3` 会被引擎拆成 `x art`，结果被成人网站污染。
实测 `'"zxart.ee" "NeOtpusk"'` 直命中 `zxart.ee/tune/63659` 与作者页
`zxart.ee/author/39718`（作者页含该作者全部曲目，适合批量核实）。

### 3. `site:` 操作符在 SerpAPI 的 google 引擎下不生效

实测 `site:zxart.ee NeOtpusk` 返回工业分销商页面。**不要用 `site:`**，改用把域名写进
查询串并加引号（见上条）。

### 4. chain 的引擎顺序按实测调整过

**英文查询不能走 cn.bing 优先**——cn.bing 对英文/带引号查询经常返回中文 SEO 垃圾
（查 zxart 曲目时返回过抖音、教师节、美甲店）。本技能 chain：两种语言都 **tavily 打头**，
中文二选 metaso，英文二选 serpapi-google。

### 5. 曲名可能要变形后再查

文件名里的曲名未必是正式曲名。实测 `NQ-DAYOF` 直接查无结果，但查 `zxart NQ-DAYOF pt3` 命中
**作者 `nq`，曲名 «Day of Victory» (2016)**——`NQ-` 原来是作者署名前缀。**先查作者前缀，再查曲名本体**：
文件名 `<author>-<title>` 形式时，拆开分别查。

### 6. 元数据配套

- `PT3` = ZX Spectrum 上由 **Vortex Tracker II** 制作的音乐模块格式，原始播放引擎作者 **S.V.Bulba**，
  目标音源 **AY-3-8910** 系列 PSG（[SDCC_PT3player_Lib](https://github.com/mvac7/SDCC_PT3player_Lib) README）
- `zxart.ee` = ZX Spectrum 游戏/demo/图形/音乐档案站，曲目页形如 `https://zxart.ee/tune/<id>`
- `zxtunes.com` = 另一 ZX Spectrum 音乐站，作者库含居住地/活跃年份/曲目数
- ⚠️ **不要把 PT3 写成 "ProTracker 3"** —— 所查来源只出现 Vortex Tracker II，该等同说法无据
- `DiHalt` = 俄罗斯 demoscene party（2006 年起，平台含 ZX Spectrum）
- `Lost Party` = 波兰 8-bit demoparty，2024 年 7 月在 Licheń Stary 举办
- 完整对照表见 `references/zx-spectrum-pt3.md`，查 AY8910/DMPlayer 系列前先读它，避免重复消耗额度

### 7. fetch 模式的 GitHub 路径自动识别

`fetch` 走 URL 路由（仿 Denjhang Harness `web_fetch`）：
- `github.com/owner/repo/blob/branch/path` → 调 GitHub contents API 拿原始内容
- `github.com/owner/repo`（无具体文件）→ 自动尝试 `README.md`/`readme.md`/...
- 其它 URL → 先试 Metaso reader（中文友好），失败则直拉 + 去 HTML

实测 `fetch "https://github.com/denjhang/node-spfm/blob/master/README.md"` 能完整拉回 README。

### 8. bilibili 412 反爬

B 站 search API 会回 412 风控。脚本自动生成随机 buvid3 cookie 通过。若仍 412，
**改去搜 `cn.bilibili.com` 网页版或用 `bing`/`serpapi -e baidu` 兜底**。

## 密钥

密钥硬编码在脚本里，可用环境变量覆盖：

```bash
export DJH_SERPAPI_KEY="..."    # SerpAPI（250 次/月）
export DJH_TAVILY_KEY="..."     # Tavily（1000 次/月，2026-09-23 入列）
export DJH_BRAVE_KEY="..."      # Brave（2026-09-23 入列，待代理放行）
export DJH_METASO_KEY="..."     # Metaso
export DJH_GITHUB_TOKEN="ghp_..."  # GitHub 限流提升至 5000/h
export FS_PROXY="http://..."    # freesearch 代理（默认 127.0.0.1:7890）
export FS_OPENALEX_KEY="..."    # OpenAlex polite 池 key（缺省也能查）
```

**Brave 使用前提**：本机 brave.com 被墙且 clash 默认判直连——需在代理规则加
`DOMAIN-SUFFIX,brave.com,PROXY`（或切全局模式）后 `-m brave` 才可用，报连接失败即此因。
放行后应把 brave 排进 chain。

## 免 key 兜底：scripts/freesearch.py（2026-09-23 新增）

无 key 的备用 CLI（从开源 free-search-mcp 剥离，curl_cffi chrome131 指纹 + 7890 代理 + RRF 融合 + SQLite 缓存，单查约 2 秒）：
`freesearch.py "查询串" [-m bing|ddg|yahoo|news|wiki|so|oa|chain|all] [-n 5]`

⚠️ 实测局限（这台机器 + 代理出口）：DDG html 端点连发 2-3 次即 202 挑战（出口 IP 被标记）；bing.com 走代理被地域重定向回中文结果（质量差）；Google 是 JS 空壳；Mojeek 403。**稳定可用的是四个垂直通道**：

| `-m` | 通道 | 用途 |
|---|---|---|
| `news` | Google News RSS | 新闻时效查询 |
| `wiki` | Wikipedia API（en/zh） | **芯片/厂商/历史名词，命中率极高，免配额优先** |
| `so` | StackOverflow API | 技术问答 |
| `oa` | OpenAlex 学术库 | 芯片/格式史料论文（实测查 AY-3-8910 直出 1984 年评测论文） |

通用网页搜索质量不行，所以 freesearch 只作配额耗尽时的应急 + 垂直查证，主力走 Tavily。

## 写笔记时的用法

查到信息后，按以下方式写进 content.json：

- **meta 字段**：只写纯文本。⚠️ meta 经 `esc()` 转义，**不要放 HTML 标签**，否则页面会显示
  `<a href=...>` 源码。
- **正文 / ul / concl.table**：可放可点击链接，生成器对这些字段原样插入、不转义。
- 链接格式：
  ```html
  <a href="https://zxart.ee/tune/63659" style="color:#5b9cff;text-decoration:underline" target="_blank" rel="noopener">zxart.ee/tune/63659</a>
  ```
- **只写查到的**：查不到就标"未能查证"，**禁止**用 ASR 谐音词或猜测填空。

## 文件清单

```
serp-search/
├── SKILL.md                          ← 本文件
├── scripts/paysearch.py              ← 付费/带 key CLI（tavily/serpapi/brave/bing/metaso/github/bilibili/chain/fetch/account）
├── scripts/freesearch.py             ← 免 key CLI（news/wiki/so/oa + bing/ddg/yahoo + RRF + 缓存）
└── references/zx-spectrum-pt3.md     ← ZX Spectrum PT3 曲库已知作者对照
```
