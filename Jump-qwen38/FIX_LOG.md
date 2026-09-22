# 跳一跳 3D — Bug 修复记录

**项目文件**: `jump-game.html`  
**日期**: 2026-09-21 ~ 09-22  
**引擎**: Three.js r128 (WebGL)

---

## BUG #1 — 方块创建崩溃（无法进入游戏）

| 项 | 内容 |
|---|---|
| **现象** | 点击开始后页面无任何反应，控制台报 `ReferenceError: geo is not defined` |
| **根因** | `createBlock()` 中 `const edgesGeo = new THREE.EdgesGeometry(geo)` 引用了仅在 if/else 分支内部声明的局部变量 `geo`。`const` 是块级作用域，出了 `{}` 就不可见，函数体后续代码访问时直接抛 ReferenceError，导致整个初始化中断 |
| **修复** | 改为引用 mesh 自身持有的 geometry：`new THREE.EdgesGeometry(mesh.geometry)`。mesh 在所有分支中都会被赋值，其 `.geometry` 属性始终可用 |
| **影响范围** | `createBlock()` → 所有方块（普通 + 特殊）的创建路径 |

```diff
- const edgesGeo = new THREE.EdgesGeometry(geo);
+ const edgesGeo = new THREE.EdgesGeometry(mesh.geometry);
```

---

## BUG #2 — Three.js CDN 加载失败无提示

| 项 | 内容 |
|---|---|
| **现象** | 网络不通或预览沙箱拦截外部请求时，页面白屏无任何反馈 |
| **根因** | 原始版本用单个 `<script src="cdnjs...">` 标签加载 Three.js，失败后 JS 全部静默跳过，用户只看到空白页 |
| **修复** | 改为动态多源加载器：依次尝试 cdnjs → unpkg → jsdelivr，底部显示"正在加载引擎..."进度提示；三源全失败时在游戏面板上红色提示"Three.js 加载失败，请检查网络后刷新" |

---

## BUG #3 — 棋子无法跳跃（蓄力正常但松手无反应）

| 项 | 内容 |
|---|---|
| **现象** | 按住屏幕角色能压缩蓄力，松开后角色不动，控制台报 `ReferenceError: dx is not defined` |
| **根因** | `doJump()` 函数内 `if (dist < 0.01) { dx = 0; dz = 1; } else { dx = ddx/dist; dz = ddz/dist; }` — `dx`/`dz` 从未用 `var` 声明。由于文件顶部有 `'use strict'`，对未声明变量赋值会直接抛 ReferenceError，跳跃逻辑在计算方向时即崩溃 |
| **修复** | 在使用前补上声明：`var dx, dz;` |
| **影响范围** | `doJump()` → 所有正式跳跃（非小跳）的方向计算 |

```diff
   var dist = Math.sqrt(ddx*ddx + ddz*ddz);
+  var dx, dz;
   if (dist < 0.01) { dx = 0; dz = 1; } else { dx = ddx/dist; dz = ddz/dist; }
```

---

## BUG #4 — 蓄力条消失

| 项 | 内容 |
|---|---|
| **现象** | 重构后按住蓄力时看不到底部力度条，无法直观判断蓄力程度 |
| **根因** | 全量重写 HTML 文件时遗漏了 `#power-bar-bg` / `#power-bar-fill` 两个 DOM 节点及其 CSS 样式和动画循环中的宽度更新逻辑 |
| **修复** | 恢复三件套：① HTML（底部居中 180px 宽圆角条）② CSS（渐变蓝填充 + opacity 过渡）③ `animate()` 中 charging 分支内 `pBarFill.style.width = (power*100)+'%'`，非蓄力时移除 `.visible` |

---

## BUG #5 — 棋子落入方块内部（垂直方向穿模）

| 项 | 内容 |
|---|---|
| **现象** | 棋子落地后"陷进"立方体中间，身体被方块表面截断，视觉上像嵌在石头里 |
| **根因** | 高度计算错误。方块 BoxGeometry 高 `h = size*0.5`，mesh 中心放在 `y=h/2`，因此**顶面实际位于 y = size*0.5**。但落点与初始站位都写成 `size*0.25 + 0.03`——这恰好是方块垂直中点（mesh 中心高度），导致棋子落在方块内部一半的位置 |
| **修复** | 两处统一改为顶面高度：① `resetGame()` 初始站位 `b0.size*0.5 + 0.01` ② `doJump()` 落点 `jTo[1] = target.size*0.5 + 0.01`（+0.01 微小抬升避免棋子底座与方块顶面共面 z-fighting） |
| **影响范围** | 所有落地帧的棋子 Y 坐标；跳跃弧线端点随之修正，飞行中不再出现"从方块内部起飞"的画面 |

```diff
- charGroup.position.set(b0.x, b0.size*0.25 + 0.03, b0.z);
+ charGroup.position.set(b0.x, b0.size*0.5 + 0.01, b0.z);
...
- jTo = [lx, target.size*0.25 + 0.03, lz];
+ jTo = [lx, target.size*0.5 + 0.01, lz];
```

> 备注：BUG #4 中做的"落点 clamp 到方块表面边界"只约束了 X/Z 水平范围，Y 轴高度错误是独立问题，两者叠加才造成完整的穿模观感。

---

## 经验教训

| # | 要点 |
|---|------|
| 1 | **块级作用域陷阱**：`const`/`let` 声明在 if/else 内部的变量，外部不可见。跨分支共享的几何体应通过已赋值的对象属性（如 `mesh.geometry`）访问，而非裸引用局部名 |
| 2 | **strict mode 下未声明赋值 = 崩溃**：重写代码时所有新引入的临时变量必须显式 `var`/`let`，不能依赖 sloppy mode 隐式全局 |
| 3 | **全量重写容易丢 UI 元素**：重构时应先列出所有 DOM ID / CSS class / 事件监听器清单，改完后逐项核对 |
| 4 | **外部 CDN 必须有兜底**：单源 `<script src>` 失败 = 白屏。生产环境至少双源 + 可见错误提示 |
| 5 | **"穿模"要分清轴**：水平越界（X/Z clamp）和垂直陷落（Y 高度算错）是两类独立问题，修了 X/Z 不代表 Y 对了。凡涉及"物体站在表面上"的代码，先推一遍表面真实高度 = mesh.position.y + geometry.height/2 |
