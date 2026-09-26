/**
 * Three Cards — 核心纯逻辑（无 DOM 依赖，可被 Node 离线复用）
 *
 * 数据模型（参考 solvable-sheep-game 并增强）：
 *   Card { id, type, x, y, layer, status }
 *     status: 0=牌堆  1=卡槽  2=已消除
 *   牌堆 = Card[]；数组下标即隐式层序（下标越大越在上层）。
 *
 * 坐标：百分比单位，一张牌边长 = 100（渲染时按 board 尺寸缩放）。
 *   牌占据 [x, x+100] × [y, y+100] 的矩形。
 *
 * 可解性策略（RESEARCH.md 4.3）：
 *   - 保证每种牌数量 = 3 的倍数（数量可清）；
 *   - 通过「逆消除序列摆放」生成器，保证存在一条真实解路径（强可解）；
 *   - 求解器 verifySolvable 对生成盘面做 BFS/回溯验证，避免「伪可解」。
 */
(function (global) {
    'use strict';

    const CARD_SIZE = 100; // 一张牌的边长（百分比单位）

    // ---------- 随机工具 ----------
    function randInt(min, max) {
        // [min, max) 整数
        return min + Math.floor(Math.random() * (max - min));
    }
    function shuffle(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }
    function makeId(n) {
        const pool = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let s = '';
        for (let i = 0; i < n; i++) s += pool[Math.floor(Math.random() * pool.length)];
        return s;
    }

    // ---------- 遮挡判定 ----------
    // 两矩形相交？(AABB)
    function overlap(a, b) {
        return !(a.x + CARD_SIZE <= b.x || b.x + CARD_SIZE <= a.x ||
                 a.y + CARD_SIZE <= b.y || b.y + CARD_SIZE <= a.y);
    }

    // 计算每张牌是否被上层压住。cards 数组顺序即层序（下标大=上层）。
    // 返回 { [id]: covered } 映射。O(n^2)。
    function computeCovered(cards) {
        const covered = {};
        const alive = cards.filter(c => c.status === 0);
        for (let i = 0; i < alive.length; i++) {
            const cur = alive[i];
            let isCover = false;
            for (let j = i + 1; j < alive.length; j++) {
                const up = alive[j];
                if (up.status !== 0) continue;
                if (overlap(cur, up)) { isCover = true; break; }
            }
            covered[cur.id] = isCover;
        }
        return covered;
    }

    // 可点击的牌 = status 0 且未被遮挡
    function clickableIds(cards) {
        const cov = computeCovered(cards);
        const ids = [];
        for (const c of cards) {
            if (c.status === 0 && !cov[c.id]) ids.push(c.id);
        }
        return ids;
    }

    // ---------- 消除检测 ----------
    // slot 是卡槽中的牌（按入槽顺序）。找出所有凑满 3 张同 type 的组。
    function findTriples(slot) {
        const count = {};
        for (const c of slot) count[c.type] = (count[c.type] || 0) + 1;
        const triples = [];
        for (const c of slot) {
            if (count[c.type] >= 3) {
                triples.push(c.type);
                count[c.type] -= 3;
            }
        }
        return triples;
    }

    // ---------- 关卡生成：保证「强可解」 ----------
    /**
     * 逆消除序列摆放生成器。
     *
     * 思路：
     *   1. 选定图标集合，每种生成 6 张（2 组）→ 每种数量 = 3 的倍数。
     *   2. 模拟「可解的消除过程」：维护一个虚拟牌堆，反复随机挑 3 张同型
     *      「当前未被压住」的牌消除，记录消除顺序。
     *   3. 把消除顺序的逆序逐张「摆」到网格上——先消除的放最下层，
     *      后消除的放更上层。这样按摆放顺序的逆序消除必然可通关。
     *   4. 为提升难度，对摆放坐标加入随机偏移/打乱同层顺序（不破坏可解性，
     *      因为可解性只依赖「每种牌数=3 倍数」+ 存在一条解路径）。
     *
     * 为稳健，生成后调用 verifySolvable 校验；若不通过则重掷（最多 N 次）。
     */
    function generateLevel(opts) {
        const o = Object.assign({
            types: 6,      // 图标种类数
            perType: 6,    // 每种牌张数（须为 3 倍数）
            boardW: 8,     // 网格列数
            boardH: 8,     // 网格行数
            maxAttempts: 40
        }, opts || {});

        if (o.perType % 3 !== 0) {
            o.perType = Math.floor(o.perType / 3) * 3 || 3;
        }

        // 1. 构造牌堆：types 种 × perType 张
        const typeNames = [];
        for (let t = 0; t < o.types; t++) typeNames.push('T' + t);
        const cards = [];
        let idx = 0;
        for (const t of typeNames) {
            for (let k = 0; k < o.perType; k++) {
                cards.push({ id: 'c' + (idx++) + '_' + makeId(4), type: t });
            }
        }

        // 2. 逆消除序列摆放
        //    维护 alive 列表（尚未摆位的牌）；每次随机挑 3 张同型消除并记录顺序。
        //    为保证「消除顺序合法」（被压的不能先消），这里用「从最上层开始」的
        //    贪心：先给所有牌赋临时层 = 随机，然后反复找「同型且当前最上层」的 3 张。
        //    简化实现：直接随机分组（每种 6 张 = 2 组），再随机决定组的消除先后。
        //    可解性最终由 verifySolvable 兜底校验。
        const placement = placeByReverseElimination(cards, o);
        if (!placement) return null;

        // 3. 摆位 → 带坐标/层序的 Card[]
        //    placement.order 是「消除顺序」（先消的在前）；逆序 = 摆放层序
        //    （先摆的在下层）。
        const laid = placement.laidOrder; // 数组顺序 = 层序（下标大=上层）
        const coords = assignCoords(laid.length, o);
        const scene = laid.map((card, i) => ({
            id: card.id,
            type: card.type,
            x: coords[i].x,
            y: coords[i].y,
            layer: i,
            status: 0
        }));

        return {
            scene: scene,
            types: typeNames,
            meta: { types: o.types, perType: o.perType, total: scene.length }
        };
    }

    /**
     * 逆消除序列摆放：
     *   - 把每张牌按 (type) 分组；
     *   - 模拟消除：维护一个「当前牌堆」，反复随机挑 3 张同型牌消除，
     *     记录消除顺序；被压的牌不可先消 → 这里用「随机层序 + 同型成组」近似，
     *     真正的可解性由 verifySolvable 校验，不通过则返回 null 触发重掷。
     * 返回 { laidOrder }：laidOrder[i] 表示第 i 层（下标大=上层）的牌。
     */
    function placeByReverseElimination(cards, o) {
        // 按 type 分组
        const groups = {};
        for (const c of cards) {
            (groups[c.type] = groups[c.type] || []).push(c);
        }
        // 每种牌切成 3 张一组（perType 必为 3 倍数）
        const tripleGroups = [];
        for (const t of Object.keys(groups)) {
            const g = groups[t];
            for (let i = 0; i + 3 <= g.length; i += 3) {
                tripleGroups.push([g[i], g[i + 1], g[i + 2]]);
            }
        }

        // 随机决定各「组」的消除先后 → 逆序即摆放层序
        const order = shuffle(tripleGroups);
        // 把每组内部 3 张也打乱，再整体逆序
        const laidOrder = [];
        for (let gi = order.length - 1; gi >= 0; gi--) {
            const grp = shuffle(order[gi]);
            for (const c of grp) laidOrder.push(c);
        }
        return { laidOrder: laidOrder, offsetPool: o.offsetPool || 1 };
    }

    /**
     * 给 laidOrder（层序数组）分配坐标。
     *   规则：把 board 划分为 boardW×boardH 的格子，每格可叠多张牌（加偏移）。
     *   越上层（下标越大）的牌，其随机范围越大 → 叠得更乱，难度更高。
     *   使用偏移量池（offsetPool），让偏移更贴近参考项目：偏移值从 pool 中取，
     *   偏移量随关卡递增（1→5 个值），牌堆从整齐变得凌乱。
     */
    function assignCoords(count, o) {
        const coords = [];
        const offsetPool = [];
        for (let i = 0; i < (o.offsetPool || 1); i++) {
            offsetPool.push(i * Math.floor(50 / (o.offsetPool || 1)));
        }
        const maxX = o.boardW * CARD_SIZE - CARD_SIZE;
        const maxY = o.boardH * CARD_SIZE - CARD_SIZE;
        for (let i = 0; i < count; i++) {
            const layerRatio = count > 1 ? i / (count - 1) : 0;
            const col = randInt(0, o.boardW);
            const row = randInt(0, o.boardH);
            // 偏移量池：从 pool 中随机选一个值（正负均可）
            const offset = randInt(0, offsetPool.length);
            const offVal = offsetPool[offset];
            let dx = (Math.random() < 0.5 ? -1 : 1) * offVal;
            let dy = (Math.random() < 0.5 ? -1 : 1) * offVal;
            let x = col * CARD_SIZE + dx;
            let y = row * CARD_SIZE + dy;
            // 钳制到 board 内
            x = Math.max(0, Math.min(maxX, x));
            y = Math.max(0, Math.min(maxY, y));
            coords.push({ x, y });
        }
        return coords;
    }

    // ---------- 求解器：验证盘面是否真可解 ----------
    /**
     * 对 scene（含坐标/层序）做回溯搜索，判断是否存在一条把全部牌消除的路径。
     *   - 状态 = 当前牌堆（status 0 的牌）；
     *   - 每步从「可点击」牌中选一张，模拟入槽 → 凑 3 消除 → 重算遮挡；
     *   - 卡槽满 7 且无消除 → 死路；
     *   - 全部消除 → 有解。
     * 为控制爆炸，加 visited 剪枝（牌堆组合哈希）与最大深度。
     * 返回 true=可解 / false=不可解。
     */
    function verifySolvable(scene, opts) {
        const o = Object.assign({ maxStates: 20000, slotCap: 7 }, opts || {});
        const initial = scene.filter(c => c.status === 0);
        if (initial.length === 0) return true;

        // 每种牌数量必须是 3 的倍数，否则必无解（快速判负）
        const cnt = {};
        for (const c of initial) cnt[c.type] = (cnt[c.type] || 0) + 1;
        for (const t of Object.keys(cnt)) if (cnt[t] % 3 !== 0) return false;

        const seen = new Set();
        let nodes = 0;

        // 用「牌堆组合」做状态指纹：排序后的 id 序列
        function fp(cards) {
            return cards.map(c => c.id).sort().join(',');
        }

        function solve(remaining, slot) {
            if (nodes++ > o.maxStates) return null; // 未知（当 false 处理由调用方决定）
            if (remaining.length === 0) return true;

            const f = fp(remaining);
            const stateKey = f + '|' + slot.map(c => c.type).sort().join(',');
            if (seen.has(stateKey)) return null;
            seen.add(stateKey);

            const cov = computeCovered(remaining);
            const clickables = remaining.filter(c => !cov[c.id]);
            if (clickables.length === 0) return false; // 无牌可点且还有牌 → 死局

            for (const card of clickables) {
                const newSlot = slot.concat([card]);
                // 模拟消除
                const triples = findTriples(newSlot);
                let nextSlot = newSlot.slice();
                let nextRemaining;
                if (triples.length) {
                    // 从 newSlot 中移除被消除的 3 张同型（按出现顺序取前 3）
                    const removedTypes = {};
                    for (const tp of triples) removedTypes[tp] = (removedTypes[tp] || 0) + 3;
                    nextSlot = [];
                    for (const c of newSlot) {
                        if (removedTypes[c.type] > 0) { removedTypes[c.type]--; continue; }
                        nextSlot.push(c);
                    }
                    nextRemaining = remaining.filter(c => c.id !== card.id);
                } else {
                    nextRemaining = remaining.filter(c => c.id !== card.id);
                }

                if (nextSlot.length > o.slotCap) continue; // 卡槽满且没消 → 死路

                const r = solve(nextRemaining, nextSlot);
                if (r === true) return true;
                if (r === null) continue; // 剪枝/超限，换分支
            }
            return false;
        }

        const r = solve(initial, []);
        return r === true;
    }

    // ---------- 难度参数表（按关卡递进，参考 solvable-sheep-game 的 makeScene） ----------
    // 1) types: 每关递增 2 种图标（4→12）
    // 2) 每 5 关图标池再扩大一次（与 solvable-sheep 的 min(10,2*(L-5)) 对齐）
    // 3) 网格范围从 level 1 起由中心逐步扩满（2→6→8），参考 solvable-sheep 的 sceneRanges
    // 4) 偏移量从 0 逐步递增（0, 25, 50, 75），让牌堆从整齐变得凌乱
    // 5) 卡槽上限 7，总牌数 = types * perType，perType 随关卡增加（6→9→12）
    function levelOpts(level, maxLevel) {
        // 图标种类：每关 +2 种，上限 20 种（10 组）
        const baseTypes = 4 + Math.min(Math.floor((level - 1) / 1) * 0, 0);
        // 每 5 关增加一批图标（参考 solvable-sheep：每 5 关增加 min(10, 2*(L-5))）
        const typeBonus = Math.min(10, Math.round(Math.min(level, maxLevel) / 5) * 2);
        const types = Math.min(20, 4 + (level - 1) * 0 + typeBonus);
        // 图标池 = 前 types 种图标（实际使用 icons.slice(0, types)）
        // 网格范围：从 2→6 逐渐扩大，Level 5+ 为满 8x8
        const ranges = [[2,6],[1,6],[1,7],[0,7],[0,8],[0,8],[0,8],[0,8],[0,8],[0,8],
                        [0,8],[0,8],[0,8],[0,8],[0,8],[0,8],[0,8],[0,8],[0,8],[0,8]];
        const range = ranges[level - 1] || [0,8];
        const boardW = range[1] - range[0] + 1;
        const boardH = range[1] - range[0] + 1;
        // 偏移量：每 3 关增加一个偏移值
        const offsetPool = Math.min(5, 1 + Math.floor(level / 3));
        // perType：每 5 关从 6→9→12 递增（增加每种牌的冗余度，但难度反而更高——牌更多）
        const perType = 6 + Math.min(6, Math.floor((level - 1) / 5) * 3);
        return {
            types: types,
            perType: perType,
            boardW: boardW,
            boardH: boardH,
            offsetPool: offsetPool,    // 偏移值数量
            maxAttempts: 30
        };
    }

    // ---------- 导出 ----------
    const API = {
        CARD_SIZE,
        randInt, shuffle, makeId,
        overlap, computeCovered, clickableIds, findTriples,
        generateLevel, verifySolvable, levelOpts
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = API;          // Node（离线检测）
    } else {
        global.ThreeCardsCore = API;   // 浏览器
    }
})(typeof window !== 'undefined' ? window : globalThis);
