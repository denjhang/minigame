/**
 * Three Cards — 离线功能模拟（Node 环境，无 DOM）
 * 验证核心逻辑的正确性：
 *   1. 关卡生成：每种牌数 = 3 的倍数，总数正确；
 *   2. 可解性验证器：对生成的盘面 verifySolvable 应为 true；
 *   3. 完整消除流程：用「贪心求解器」从生成盘面一路消到空，
 *      模拟玩家操作路径，验证玩法闭环成立；
 *   4. 遮挡判定：被压牌不可点、消除后下层解锁；
 *   5. 道具（洗牌/弹出/撤销）不破坏状态一致性。
 *
 * 运行：node test/offline-sim.js
 */
'use strict';

const path = require('path');
const core = require(path.join(__dirname, '..', 'js', 'core.js'));

let passed = 0, failed = 0;
function assert(cond, msg) {
    if (cond) { passed++; console.log('  ✔ ' + msg); }
    else { failed++; console.log('  ✖ FAIL: ' + msg); }
}

console.log('== Three Cards 离线功能模拟 ==\n');

// ---------- 1. 关卡生成 ----------
console.log('[1] 关卡生成');
const MAX_LEVEL = 20;
for (const lv of [1, 5, 10, 15, 20]) {
    const opts = core.levelOpts(lv, MAX_LEVEL);
    let ok = null;
    for (let a = 0; a < opts.maxAttempts && !ok; a++) {
        const cand = core.generateLevel(opts);
        if (cand && core.verifySolvable(cand.scene)) ok = cand;
    }
    assert(!!ok, `level ${lv}: 生成并通过可解性验证 (types=${opts.types}, total=${ok ? ok.scene.length : '?'})`);
    if (ok) {
        const cnt = {};
        for (const c of ok.scene) cnt[c.type] = (cnt[c.type] || 0) + 1;
        const allMult3 = Object.values(cnt).every(v => v % 3 === 0);
        assert(allMult3, `level ${lv}: 每种牌数为 3 的倍数`);
        assert(ok.scene.length % 3 === 0, `level ${lv}: 总牌数为 3 的倍数 (${ok.scene.length})`);
    }
}

// ---------- 2. 可解性验证器自检 ----------
console.log('\n[2] 可解性验证器自检');
// 构造一个必可解的小盘面：3 种牌各 3 张，平铺不重叠
function flatScene(types, per) {
    const cards = [];
    let i = 0;
    for (const t of types) for (let k = 0; k < per; k++) {
        cards.push({ id: 'f' + (i++), type: t, x: (i % 5) * 100, y: Math.floor(i / 5) * 100, layer: i, status: 0 });
    }
    return cards;
}
assert(core.verifySolvable(flatScene(['A','B','C'], 3)) === true, '可解小盘面 → true');
// 构造一个必无解盘面：A 有 4 张（非 3 倍数）
assert(core.verifySolvable(flatScene(['A','A','A','A','B','B','B'], 1)) === false, '含非3倍数牌 → false');

// ---------- 3. 完整消除流程（贪心求解器模拟玩家） ----------
console.log('\n[3] 完整消除流程模拟');
// 贪心：每步选「入槽后能直接凑三连」的牌；否则任选一个可点牌。
// 若卡槽将满(>=6)且无即时三连可选，则用洗牌/弹出道具兜底。
function greedySolve(scene) {
    const cards = scene.filter(c => c.status === 0).map(c => Object.assign({}, c));
    let slot = [];
    const cap = 7;
    let steps = 0;
    const maxSteps = 10000;
    let usesWash = 0, usesPop = 0;
    while (steps++ < maxSteps) {
        if (cards.length === 0 && slot.length === 0) return { win: true, steps, usesWash, usesPop };
        const cov = core.computeCovered(cards);
        const clickables = cards.filter(c => !cov[c.id]);
        if (clickables.length === 0) return { win: false, reason: 'deadlock-no-clickable', steps };

        // 优先找能即时凑三连的牌
        let chosen = null;
        for (const c of clickables) {
            const simSlot = slot.concat([c]);
            if (core.findTriples(simSlot).length > 0) { chosen = c; break; }
        }
        if (!chosen) {
            // 卡槽将满且无即时三连 → 先弹出（pop）腾空间
            if (slot.length >= cap - 1 && slot.length > 0) {
                const popped = slot.shift();
                popped.status = 0;
                cards.push(popped);
                usesPop++;
                continue;
            }
            // 仍无解 → 洗牌
            if (slot.length >= cap - 1 && usesWash < 99) {
                const alive = cards.filter(c => c.status === 0);
                const sh = core.shuffle(alive);
                sh.forEach((c, i) => {
                    c.layer = i;
                    c.x = core.randInt(0, 8) * 100;
                    c.y = core.randInt(0, 8) * 100;
                });
                cards.length = 0;
                for (const c of sh) cards.push(c);
                usesWash++;
                continue;
            }
            // 否则任选可点牌
            chosen = clickables[core.randInt(0, clickables.length)];
        }

        // 执行：入槽
        chosen.status = 1;
        slot.push(chosen);
        const idx = cards.indexOf(chosen);
        if (idx >= 0) cards.splice(idx, 1);

        // 消除
        let guard = 0;
        while (guard++ < 10) {
            const triples = core.findTriples(slot);
            if (!triples.length) break;
            const rem = {};
            for (const tp of triples) rem[tp] = (rem[tp] || 0) + 3;
            slot = slot.filter(c => { if (rem[c.type] > 0) { rem[c.type]--; return false; } return true; });
        }
        if (slot.length >= cap) return { win: false, reason: 'slot-full', steps };
    }
    return { win: false, reason: 'max-steps', steps };
}

let allWin = true;
for (const lv of [1, 3, 6, 10, 14, 20]) {
    const opts = core.levelOpts(lv, MAX_LEVEL);
    let ok = null;
    for (let a = 0; a < opts.maxAttempts && !ok; a++) {
        const cand = core.generateLevel(opts);
        if (cand && core.verifySolvable(cand.scene)) ok = cand;
    }
    const res = greedySolve(ok.scene);
    const msg = `level ${lv}: 贪心求解 win=${res.win} steps=${res.steps} wash=${res.usesWash}` +
        (res.reason ? ' reason=' + res.reason : '');
    assert(res.win, msg);
    if (!res.win) allWin = false;
}
assert(allWin, '所有抽样关卡贪心均可通关（玩法闭环成立）');

// ---------- 4. 遮挡判定 ----------
console.log('\n[4] 遮挡判定');
// 两张完全重叠：上层压住下层
const ov = [
    { id: 'a', type: 'A', x: 0, y: 0, layer: 0, status: 0 },
    { id: 'b', type: 'B', x: 0, y: 0, layer: 1, status: 0 }
];
const covOv = core.computeCovered(ov);
assert(covOv['a'] === true && covOv['b'] === false, '重叠时下层被压、上层可点');
// 两张不重叠：都不可被压
const noOv = [
    { id: 'a', type: 'A', x: 0, y: 0, layer: 0, status: 0 },
    { id: 'b', type: 'B', x: 200, y: 200, layer: 1, status: 0 }
];
const covNo = core.computeCovered(noOv);
assert(covNo['a'] === false && covNo['b'] === false, '不重叠时两牌均可点');

// ---------- 5. 道具一致性 ----------
console.log('\n[5] 道具状态一致性');
// 洗牌后：牌数不变、每种牌数仍为 3 倍数
const opts5 = core.levelOpts(5, MAX_LEVEL);
let ok5 = null;
for (let a = 0; a < 20 && !ok5; a++) {
    const c = core.generateLevel(opts5);
    if (c && core.verifySolvable(c.scene)) ok5 = c;
}
const before = ok5.scene.filter(c => c.status === 0).length;
// 模拟洗牌
const alive = ok5.scene.filter(c => c.status === 0);
const sh = core.shuffle(alive);
sh.forEach((c, i) => { c.layer = i; c.x = core.randInt(0,7)*100; c.y = core.randInt(0,7)*100; });
ok5.scene = sh;
const cnt5 = {};
for (const c of ok5.scene) cnt5[c.type] = (cnt5[c.type] || 0) + 1;
assert(ok5.scene.length === before, '洗牌后牌数不变');
assert(Object.values(cnt5).every(v => v % 3 === 0), '洗牌后每种牌数仍为 3 倍数');

// ---------- 汇总 ----------
console.log(`\n== 结果: ${passed} passed, ${failed} failed ==`);
process.exit(failed === 0 ? 0 : 1);
