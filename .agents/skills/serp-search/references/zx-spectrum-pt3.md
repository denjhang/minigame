# ZX Spectrum PT3 曲库 —— 已知作者对照

FrameNote 的 `DMPlayer AY8910` 系列（Demo1–Demo4）与若干 MegaGRRL 笔记播放的曲目来自
ZX Spectrum 音乐档案站 **zxart.ee** 的 PT3 曲库。本文件记录已查证的曲目↔作者对照，
供后续查证时直接引用，避免重复消耗 SerpAPI 额度。

## 背景（已查证）

- **PT3**：ZX Spectrum 平台上由 **Vortex Tracker II** 制作的音乐模块格式，原始播放引擎作者 **S.V.Bulba**，
  目标音源为 **AY-3-8910** 系列 PSG。（来源：[SDCC_PT3player_Lib](https://github.com/mvac7/SDCC_PT3player_Lib) README）
- **zxart.ee**：ZX Spectrum 游戏/demo/图形/音乐档案站，音乐栏目 `https://zxart.ee/eng/music/tunes/`
  （标题「ZX Spectrum 128K 音乐 tunes 集锦」）。曲目页 URL 形如 `https://zxart.ee/tune/<id>`。
- **zxtunes.com**：另一 ZX Spectrum 音乐站，作者库列出作者的居住地、活跃年份与曲目数，适合补作者背景。
- **DiHalt**：俄罗斯 demoscene party（2006 年起，平台含 ZX Spectrum）。
  来源：[demoparty.net/dihalt](https://www.demoparty.net/dihalt)。曲名中的 `DiHalt` 指该聚会作品。
- ⚠️ 不要把 PT3 写成 "ProTracker 3" —— 所查来源只出现 Vortex Tracker II，该等同说法无据。

## 已查证曲目（2026-09-23）

| 文件名 | 曲名 | 作者 | 出处 |
|---|---|---|---|
| `NeOtpusk.vgm` | NeOtpusk（意为「Не отпускай / 别放手」）| **Сергей Бульба / Sergey Bulba** | [zxart.ee/tune/63659](https://zxart.ee/tune/63659)；zxtunes 载其为哈巴罗夫斯克 ZX 音乐人，1994–2004，53 首 AY/YM 曲目 |
| `Morensh.vgm` | Morensh | **Macros（Sergey Gulyaev）** | [zxart.ee/tune/75267](https://zxart.ee/tune/75267)；zxtunes 载其为俄罗斯科特拉斯音乐人，1999–2004，233 首 AY/YM 曲目 |
| `PrObA-10.vgm` | PrObA 10 (2000) | **MmcM** | [zxart.ee/tune/74361](https://zxart.ee/tune/74361) |
| `NQ-DAYOF.vgm` | Day of Victory (2016) | **nq** | [zxart.ee/tune/89576](https://zxart.ee/tune/89576) |
| `NQ-KPUM4.vgm` | 未查证 | 推测同属 **nq**（`NQ-` 为作者署名前缀） | 待查 |
| `NQ-VLECH.vgm` | 未查证 | 推测同属 **nq** | 待查 |
| `NOZHKI.vgm` | 未查证 | 未查证 | 裸名撞俄语词，需加限定词重查 |
| `Mysong.vgm` | 未查证 | 未查证 | 撞同名产品，需加限定词重查 |
| `My-tears-Sochi-Party-2014-3-.vgm` | 未查证 | 未查证（曲名含 Sochi Party 2014） | 待查 |
| `NeXt-dAy-DiHalt-2007-4-.vgm` | 未查证 | 未查证（DiHalt 2007 作品） | 待查 |
| `Necropolis-Xenium-2024-2-.vgm` | 未查证 | 未查证（Xenium 2024 竞赛作品） | 待查 |
| `Nearly-there-III-recombination-DiHalt-2022-7-.vgm` | 未查证 | 未查证（DiHalt 2022 作品） | 待查 |
| `Nice-Platz-Realtime-DiHalt-Lite-2017-2-.vgm` | 未查证 | 未查证（DiHalt Lite 2017 作品） | 待查 |
| `Solitude-Lost-Party-2024-1.vgm` | Solitude (2024) | **Pator（Kamil Patecki）/ Joker ^ Speccy.pl** | [zxart.ee/tune/522870](https://zxart.ee/tune/522870)；[demozoo.org/music/353088](https://demozoo.org/music/353088) 载其为 Lost Party 2024 音乐竞赛第 1 名 |
| （作者） | — | **Pator（Kamil Patecki）/ Joker ^ Speccy.pl** | [zxart.ee/author/351126](https://zxart.ee/author/351126)；波兰 ZX/PSG 音乐人，Demo3 帧中 Folder History 的 `[50] Pator` 目录即其作品集 |

## 已查实的聚会（曲名中的关键词）

| 关键词 | 说明 | 来源 |
|---|---|---|
| Lost Party | 波兰 8-bit demoparty（Atari/Commodore/Spectrum/Amstrad），2024 年 7 月 11–14 日在 Licheń Stary 举办 | [demozoo.org/parties/4439](https://demozoo.org/parties/4439/) |
| DiHalt | 俄罗斯 demoscene party，2006 年起，平台含 ZX Spectrum | [demoparty.net/dihalt](https://www.demoparty.net/dihalt) |
| Xenium | ZX Spectrum demoparty（乌克兰，曲名 Necropolis-Xenium-2024 指其 2024 年作品）| 待补 |


## 查询套路（省额度的顺序）

可用后端见 SKILL.md「八个后端」表。查 ZX Spectrum 曲目时推荐顺序：

1. **先抽样**：一个曲库不必每首都查。先查 2–3 首代表曲，若作者为同一人（如 `NQ-` 系列），其余可标注"同属该作者"。
2. **首选 serpapi + 引号**：`paysearch.py -m serpapi -n 5 '"zxart.ee" "曲名"'` —— 实测命中率最高。
3. **中文说明性查询走 metaso**：`paysearch.py -m metaso "ZX Spectrum PT3 曲库"`。
4. **别用 bing 查英文**：实测 cn.bing 对英文/带引号查询常回中文 SEO 垃圾（抖音、教师节、美甲店）。
5. **别用 `site:`**：SerpAPI 下不生效。
6. **拆前缀**：文件名形如 `<author>-<title>` 时，先查前缀再查本体（`NQ-DAYOF` → `nq` / Day of Victory）。
7. **换引擎**：google 无结果时 `-e duckduckgo` / `-e bing`。
8. **补作者背景**：查到 zxart 作者页后，再查 `zxtunes <作者>` 拿居住地/活跃年份/曲目数。
9. **找相关视频**：`paysearch.py -m bilibili --bili-type video "曲名"`。
