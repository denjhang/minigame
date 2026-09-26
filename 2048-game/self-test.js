// 2048 逻辑自测脚本（纯 Node，无需浏览器）
// 用法: node self-test.js
// 覆盖：四方向移动、合并规则（含 [2,2,2,2] 双合并与 [2,4,2] 不合并）、
//       分数累计、游戏结束判定、以及模拟整局的随机压力测试。

"use strict";

var SIZE = 4;
var failures = 0;
var passes = 0;
var tileSeq = 0;

// ===== 与 index.html 中完全一致的压缩+合并算法 =====
function slideLine(line) {
  var out = [];
  var gained = 0;
  var i = 0;
  while (i < line.length) {
    var t = line[i];
    if (i + 1 < line.length && line[i + 1].val === t.val) {
      var mergedVal = t.val * 2;
      var survivor = line[i + 1];
      var absorbed = t;
      survivor.val = mergedVal;
      survivor.isMerged = true;
      absorbed.absorbedBy = survivor;
      out.push(survivor);
      gained += mergedVal;
      i += 2;
    } else {
      out.push(t);
      i += 1;
    }
  }
  return { out: out, gained: gained };
}

// 在纯数据棋盘上执行一次移动（不含 DOM）
// 与 index.html 的 move() 同构：先快照所有线 -> 逐线压缩合并 -> 清空棋盘 -> 按目标位置写回。
// 关键：写回前先把整盘置空，避免"源格残留旧引用"导致同一方块被多条线重复读取（跨行误合并根因）。
function move(grid, direction) {
  var horiz = (direction === "left" || direction === "right");
  var towardStart = (direction === "left" || direction === "up");
  var gained = 0;
  var moved = false;

  // 阶段 1：快照所有线（只取非空方块）
  var lines = [];
  for (var i = 0; i < SIZE; i++) {
    var line = [];
    for (var j = 0; j < SIZE; j++) {
      var idx = towardStart ? j : (SIZE - 1 - j);
      var cell = horiz ? grid[i][idx] : grid[idx][i];
      if (cell) line.push(cell);
    }
    lines.push(line);
  }

  // 阶段 2：逐线压缩 + 合并（与 index.html 的 slideLine 同构）
  var placements = [];
  for (var i2 = 0; i2 < SIZE; i2++) {
    var line2 = lines[i2];
    var out = [];
    var k = 0;
    while (k < line2.length) {
      if (k + 1 < line2.length && line2[k + 1].val === line2[k].val) {
        line2[k].val = line2[k].val * 2;
        line2[k].isMerged = true;
        out.push(line2[k]);
        gained += line2[k].val;
        k += 2;
      } else {
        out.push(line2[k]);
        k += 1;
      }
    }
    for (var m = 0; m < out.length; m++) {
      var destIdx = towardStart ? m : (SIZE - 1 - m);
      var rc = horiz ? [i2, destIdx] : [destIdx, i2];
      placements.push({ tile: out[m], rc: rc });
    }
  }

  // 阶段 3：清空棋盘，再按目标位置放置存活方块
  for (var r = 0; r < SIZE; r++) {
    for (var c = 0; c < SIZE; c++) grid[r][c] = null;
  }
  for (var p = 0; p < placements.length; p++) {
    var placed = placements[p].tile;
    var pr = placements[p].rc[0], pc = placements[p].rc[1];
    grid[pr][pc] = placed;
    if (placed.r !== pr || placed.c !== pc) {
      placed.r = pr;
      placed.c = pc;
      moved = true;
    }
  }
  if (typeof DEBUG_GRID !== "undefined" && DEBUG_GRID) {
    var refs = {};
    for (var dr = 0; dr < SIZE; dr++) {
      for (var dc = 0; dc < SIZE; dc++) {
        if (grid[dr][dc]) {
          var id = grid[dr][dc].id;
          refs[id] = (refs[id] || 0) + 1;
          if (refs[id] > 1) console.log("    !! 方块 id=" + id + " 被 " + refs[id] + " 格引用, 位于 grid[" + dr + "][" + dc + "]");
        }
      }
    }
  }
  return { gained: gained, moved: moved };
}

// 用数值数组（null 表示空）快速构造棋盘
function gridFrom(rows) {
  return rows.map(function (row) {
    return row.map(function (v) { return v === null ? null : v; });
  });
}
function dump(g) {
  return g.map(function (row) {
    return row.map(function (v) { return v === null ? "." : v; }).join(" ");
  }).join(" | ");
}

function makeGrid(rows) {
  var g = gridFrom(rows);
  g.forEach(function (row, r) {
    row.forEach(function (v, c) {
      if (v !== null) {
        g[r][c] = { id: ++tileSeq, val: v, r: r, c: c, isMerged: false, el: { remove: function () {} } };
      }
    });
  });
  return g;
}

// ===== 断言工具 =====
function check(name, cond, detail) {
  if (cond) {
    passes++;
    console.log("  PASS  " + name);
  } else {
    failures++;
    console.log("  FAIL  " + name + (detail ? "  ->  " + detail : ""));
  }
}
function checkGrid(name, grid, expectedRows) {
  var actual = grid.map(function (row) {
    return row.map(function (t) { return t ? t.val : null; });
  });
  var ok = JSON.stringify(actual) === JSON.stringify(gridFrom(expectedRows).map(function (r) { return r; }));
  check(name, ok, ok ? "" : "actual=[" + dump(grid.map(function (r) { return r.map(function (t) { return t ? t.val : null; }); })) + "] expected=[" + dump(expectedRows) + "]");
}

// ===== 测试用例 =====
console.log("\n== 1. 基本滑动（无合并） ==");
(function () {
  var g = makeGrid([
    [null, 2, null, null],
    [null, null, null, null],
    [null, null, null, null],
    [null, null, null, null]
  ]);
  move(g, "left");
  checkGrid("左滑到左边缘", g, [
    [2, null, null, null],
    [null, null, null, null],
    [null, null, null, null],
    [null, null, null, null]
  ]);
})();

console.log("\n== 2. 向上移动（此前用户报告失效的方向） ==");
(function () {
  // 第 2 行有方块，向上应滑到第 1 行
  var g = makeGrid([
    [null, null, null, null],
    [null, null, null, null],
    [2, null, null, null],
    [null, null, null, null]
  ]);
  move(g, "up");
  checkGrid("上滑：第2行的2到顶行", g, [
    [2, null, null, null],
    [null, null, null, null],
    [null, null, null, null],
    [null, null, null, null]
  ]);
})();

(function () {
  // 两列各自向上
  var g = makeGrid([
    [null, null, null, null],
    [null, null, null, null],
    [2, null, 4, null],
    [null, 8, null, null]
  ]);
  move(g, "up");
  checkGrid("上滑多列", g, [
    [2, 8, 4, null],
    [null, null, null, null],
    [null, null, null, null],
    [null, null, null, null]
  ]);
})();

console.log("\n== 3. 合并规则 ==");
(function () {
  var g = makeGrid([
    [2, 2, null, null],
    [null, null, null, null],
    [null, null, null, null],
    [null, null, null, null]
  ]);
  var r = move(g, "left");
  checkGrid("2+2 合并为 4（靠左）", g, [
    [4, null, null, null],
    [null, null, null, null],
    [null, null, null, null],
    [null, null, null, null]
  ]);
  check("合并得分为 4", r.gained === 4, "gained=" + r.gained);
})();

(function () {
  // 经典用例：[2,2,2,2] 左移 => [4,4]
  var g = makeGrid([
    [2, 2, 2, 2],
    [null, null, null, null],
    [null, null, null, null],
    [null, null, null, null]
  ]);
  var r = move(g, "left");
  checkGrid("[2,2,2,2] 左移 => [4,4]", g, [
    [4, 4, null, null],
    [null, null, null, null],
    [null, null, null, null],
    [null, null, null, null]
  ]);
  check("双合并得分 8", r.gained === 8, "gained=" + r.gained);
})();

(function () {
  // 经典用例：[2,4,2] 左移 => [2,4,2]（不相邻同值不合并）
  var g = makeGrid([
    [2, 4, 2, null],
    [null, null, null, null],
    [null, null, null, null],
    [null, null, null, null]
  ]);
  move(g, "left");
  checkGrid("[2,4,2] 左移保持不变", g, [
    [2, 4, 2, null],
    [null, null, null, null],
    [null, null, null, null],
    [null, null, null, null]
  ]);
})();

(function () {
  // 经典用例：[2,2,4] 左移 => [4,4]
  var g = makeGrid([
    [2, 2, 4, null],
    [null, null, null, null],
    [null, null, null, null],
    [null, null, null, null]
  ]);
  move(g, "left");
  checkGrid("[2,2,4] 左移 => [4,4]", g, [
    [4, 4, null, null],
    [null, null, null, null],
    [null, null, null, null],
    [null, null, null, null]
  ]);
})();

(function () {
  // [4,2,2] 左移 => [4,4]
  var g = makeGrid([
    [4, 2, 2, null],
    [null, null, null, null],
    [null, null, null, null],
    [null, null, null, null]
  ]);
  move(g, "left");
  checkGrid("[4,2,2] 左移 => [4,4]", g, [
    [4, 4, null, null],
    [null, null, null, null],
    [null, null, null, null],
    [null, null, null, null]
  ]);
})();

(function () {
  // [2,4,4,2] 右移 => [2,8,2] 靠右
  var g = makeGrid([
    [2, 4, 4, 2],
    [null, null, null, null],
    [null, null, null, null],
    [null, null, null, null]
  ]);
  move(g, "right");
  checkGrid("[2,4,4,2] 右移 => [2,8,2]", g, [
    [null, 2, 8, 2],
    [null, null, null, null],
    [null, null, null, null],
    [null, null, null, null]
  ]);
})();

(function () {
  // 垂直合并：一列 [2,2,2,2] 上移 => [4,4]
  var g = makeGrid([
    [2, null, null, null],
    [2, null, null, null],
    [2, null, null, null],
    [2, null, null, null]
  ]);
  move(g, "up");
  checkGrid("一列[2,2,2,2]上移=>[4,4]", g, [
    [4, null, null, null],
    [4, null, null, null],
    [null, null, null, null],
    [null, null, null, null]
  ]);
})();

console.log("\n== 4. 四方向对称性 ==");
(function () {
  // 同一个 L 形布局，分别向四个方向移动，验证结果符合直觉
  var layout = [
    [2, null, null, null],
    [null, 4, null, null],
    [null, null, null, 2],
    [null, null, null, null]
  ];

  var g = makeGrid(layout);
  move(g, "up");
  checkGrid("L形 上移", g, [
    [2, 4, null, 2],
    [null, null, null, null],
    [null, null, null, null],
    [null, null, null, null]
  ]);

  g = makeGrid(layout);
  move(g, "down");
  checkGrid("L形 下移", g, [
    [null, null, null, null],
    [null, null, null, null],
    [null, null, null, null],
    [2, 4, null, 2]
  ]);

  g = makeGrid(layout);
  move(g, "left");
  checkGrid("L形 左移", g, [
    [2, null, null, null],
    [4, null, null, null],
    [2, null, null, null],
    [null, null, null, null]
  ]);

  g = makeGrid(layout);
  move(g, "right");
  checkGrid("L形 右移", g, [
    [null, null, null, 2],
    [null, null, null, 4],
    [null, null, null, 2],
    [null, null, null, null]
  ]);
})();

console.log("\n== 5. 分数累计 ==");
(function () {
  var g = makeGrid([
    [2, 2, 2, 2],
    [null, null, null, null],
    [null, null, null, null],
    [null, null, null, null]
  ]);
  // 连续左移：[2,2,2,2] -> [4,4] 得 8；再左移 [4,4] -> [8] 得 8
  var total = move(g, "left").gained + move(g, "left").gained;
  check("分数累计正确", total === 16, "total=" + total);
  checkGrid("连续左移最终为 [8]", g, [
    [8, null, null, null],
    [null, null, null, null],
    [null, null, null, null],
    [null, null, null, null]
  ]);
})();

console.log("\n== 6. 游戏结束判定 ==");
function canMove(g) {
  for (var r = 0; r < SIZE; r++) {
    for (var c = 0; c < SIZE; c++) {
      if (!g[r][c]) return true;
      var v = g[r][c].val;
      if (c + 1 < SIZE && g[r][c + 1] && g[r][c + 1].val === v) return true;
      if (r + 1 < SIZE && g[r + 1][c] && g[r + 1][c].val === v) return true;
    }
  }
  return false;
}
(function () {
  var stuck = makeGrid([
    [2, 4, 2, 4],
    [4, 2, 4, 2],
    [2, 4, 2, 4],
    [4, 2, 4, 2]
  ]);
  check("棋盘填满且无相邻同值 => 结束", canMove(stuck) === false, dump(stuck.map(function (r) { return r.map(function (t) { return t ? t.val : null; }); })));

  var notStuck = makeGrid([
    [2, 4, 2, 4],
    [4, 2, 4, 2],
    [2, 4, 2, 4],
    [4, 2, 4, null]
  ]);
  check("有空格 => 可继续", canMove(notStuck) === true);

  var adjacent = makeGrid([
    [2, 4, 2, 4],
    [4, 2, 4, 2],
    [2, 4, 2, 4],
    [4, 2, 2, 4]
  ]);
  check("存在相邻同值 => 可继续（能合并）", canMove(adjacent) === true);
})();

console.log("\n== 7. 随机压力测试（5000 局模拟） ==");
(function () {
  var MAX_TILES = 16;
  var bad = 0;
  for (var game = 0; game < 5000; game++) {
    var g = makeGrid([
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null]
    ]);
    // 初始两个随机方块
    for (var s = 0; s < 2; s++) spawn(g, 2);

    var prevDir = null;
    var prevSpawned = false;
    for (var step = 0; step < 200 && canMove(g); step++) {
      var dirs = ["up", "down", "left", "right"];
      var dir = dirs[Math.floor(Math.random() * 4)];
      var r = move(g, dir);
      // 真实规则：仅当本次移动有变化（含合并）才补一个方块
      var spawned = false;
      if (r.gained > 0) { spawn(g, Math.random() < 0.9 ? 2 : 4); spawned = true; }

      // 不变量 1a：同一方块对象不能同时占据多个格子（跨行误合并的根因）
      var seenIds = {};
      for (var rr0 = 0; rr0 < SIZE; rr0++) {
        for (var cc0 = 0; cc0 < SIZE; cc0++) {
          var t0 = g[rr0][cc0];
          if (t0) {
            if (seenIds[t0.id]) { bad++; console.log("  方块 id=" + t0.id + " 占据多格（跨行误合并）"); }
            seenIds[t0.id] = true;
          }
        }
      }

      // 不变量 1b：方块总数不超过 16
      var count = 0;
      for (var rr = 0; rr < SIZE; rr++) for (var cc = 0; cc < SIZE; cc++) if (g[rr][cc]) count++;
      if (count > MAX_TILES) { bad++; console.log("  方块数量超限: " + count); break; }

      // 不变量 2：所有值必须是 2 的幂
      for (var r2 = 0; r2 < SIZE; r2++) {
        for (var c2 = 0; c2 < SIZE; c2++) {
          var t = g[r2][c2];
          if (t && (t.val & (t.val - 1)) !== 0) { bad++; console.log("  出现非 2 的幂: " + t.val); }
        }
      }

      // 不变量 3：连续两次同方向移动、且中间没有新方块生成时，
      // 结果中不应存在"可合并的同值相邻"（否则说明合并逻辑漏合并）
      // 不变量 3：连续两次同方向移动、中间无新方块时，
      // 被该方向压缩的"线"内不应残留可合并的同值对。
      // 横向移动检查每行，纵向移动检查每列（不同行/列的同值不构成可合并对）。
      if (prevDir === dir && !prevSpawned) {
        var horiz3 = (dir === "left" || dir === "right");
        if (horiz3) {
          for (var r3 = 0; r3 < SIZE; r3++) {
            for (var c3 = 0; c3 < SIZE - 1; c3++) {
              if (g[r3][c3] && g[r3][c3 + 1] && g[r3][c3].val === g[r3][c3 + 1].val) { bad++; }
            }
          }
        } else {
          for (var c3v = 0; c3v < SIZE; c3v++) {
            for (var r3v = 0; r3v < SIZE - 1; r3v++) {
              if (g[r3v][c3v] && g[r3v + 1][c3v] && g[r3v][c3v].val === g[r3v + 1][c3v].val) { bad++; }
            }
          }
        }
      }
      prevDir = dir;
      prevSpawned = spawned;
    }
  }
  check("5000 局模拟无逻辑错误", bad === 0, "bad=" + bad);
})();

console.log("\n== 8. 合并正确性 & 跨行误合并回归测试 ==");
(function () {
  // 场景 1（核心回归）：第 0 行 [2,2,.,.]、第 1 行 [2,.,.,2]。
  // 正确 2048 行为：第 0 行 2+2 合并为 4；第 1 行两个被空位隔开的 2 会滑到一起
  // 并合并为 4（标准规则：空位不阻挡合并）。两行各自独立，互不干扰。
  // 旧版 bug（写回不清空源格 => 同一方块被两格引用）会让某行的方块被另一行
  // 读取并合并，产生"不同行也合并"的异常。两阶段清空-写回后此问题消失。
  var g = makeGrid([
    [2, 2, null, null],
    [2, null, null, 2],
    [null, null, null, null],
    [null, null, null, null]
  ]);
  move(g, "left");
  // 期望：第 0 行 [2,2,.,.] 左移 => [4,.,.,.]；第 1 行 [2,.,.,2] 两个被空位隔开的 2
  // 滑动后贴在一起并合并 => [4,.,.,.]（标准 2048：空位不阻挡合并）。两行各自独立。
  checkGrid("左移后两行各自独立合并", g, [
    [4, null, null, null],
    [4, null, null, null],
    [null, null, null, null],
    [null, null, null, null]
  ]);
  // 关键不变量：没有任何方块被两格同时引用（旧版"源格残留旧引用"bug 的标志）
  check("无方块被两格同时引用（无跨行误合并）", !hasMultiRef(g));

  // 场景 2：再左移一次。每行已是 [4,.,.,.]，4 与 4 之间隔着空位，
  // 标准 2048 中"被空位隔开的同值"不会合并（需先滑动贴边），故棋盘不变。
  move(g, "left");
  checkGrid("连续左移稳定（[4] 不变）", g, [
    [4, null, null, null],
    [4, null, null, null],
    [null, null, null, null],
    [null, null, null, null]
  ]);
  check("连续移动后仍无方块被两格引用", !hasMultiRef(g));

  // 场景 3：两列各自 [.,.,2,2]（行2、行3 相邻的两个 2）向上移动 =>
  // 每列相邻的 2+2 合并为 4，贴顶行 => [4,.,.,.]，两列互不跨列合并。
  var g3 = makeGrid([
    [null, null, null, null],
    [null, null, null, null],
    [2, null, 2, null],
    [2, null, 2, null]
  ]);
  move(g3, "up");
  checkGrid("向上合并只在列内进行", g3, [
    [4, null, 4, null],
    [null, null, null, null],
    [null, null, null, null],
    [null, null, null, null]
  ]);
  check("向上移动后无方块被两格引用", !hasMultiRef(g3));
})();

// 检测棋盘上是否有同一方块被两个格子引用（跨行/列误合并的根因）
function hasMultiRef(g) {
  var seen = {};
  for (var r = 0; r < SIZE; r++) {
    for (var c = 0; c < SIZE; c++) {
      var t = g[r][c];
      if (t) {
        if (seen[t.id]) return true;
        seen[t.id] = true;
      }
    }
  }
  return false;
}

function spawn(g, val) {
  var empty = [];
  for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) if (!g[r][c]) empty.push([r, c]);
  if (empty.length === 0) return;
  var p = empty[Math.floor(Math.random() * empty.length)];
  g[p[0]][p[1]] = { id: ++tileSeq, val: val, r: p[0], c: p[1], isMerged: false, el: { remove: function () {} } };
}

console.log("\n========================================");
console.log("结果: " + passes + " 通过, " + failures + " 失败");
console.log("========================================");
process.exit(failures === 0 ? 0 : 1);
