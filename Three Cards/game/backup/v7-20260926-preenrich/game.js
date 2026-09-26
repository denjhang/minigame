/**
 * Three Cards — UI 层（DOM 渲染 + 交互 + 音效）
 * 依赖 core.js（ThreeCardsCore）与 levels.js（ThreeCardsLevels）。
 *
 * 渲染模型：
 *   - 棋盘区只渲染 status===0 的牌（在棋盘上的）。
 *   - 卡槽区只渲染 slot 中的牌（status===1）。
 *   - 点牌后：棋盘元素动画「飞入」对应槽位并淡出（离开棋盘），
 *     卡槽槽位淡入。消除时槽内图标淡出消失。
 *   - 这样被点走的牌不会在棋盘与卡槽各画一次（无「数量加倍」）。
 */
(function () {
    'use strict';

    const core = window.ThreeCardsCore;
    const levels = window.ThreeCardsLevels;

    const SLOT_CAP = 7;
    const MAX_LEVEL = 20;
    const TOOL_COUNT = { pop: 3, undo: 3, wash: 3 };
    const SFX_DELAY_MS = 150;      // 入槽后到消除判定之间的延迟（模拟飞入动画锁）
    const BEST_SCORE_KEY = 'threeCardsBestScore';
    const RATING_KEY = 'threeCardsBestRating';   // 全局评分持久化 key

    // ---------- 最高分（localStorage 持久化） ----------
    function loadBestScore() {
        const v = parseInt(localStorage.getItem(BEST_SCORE_KEY) || '0', 10);
        return Number.isFinite(v) && v > 0 ? v : 0;
    }
    function saveBestScore(v) {
        localStorage.setItem(BEST_SCORE_KEY, String(v));
    }
    function loadBestRating() {
        const v = parseInt(localStorage.getItem(RATING_KEY) || '0', 10);
        return Number.isFinite(v) && v > 0 ? v : 0;
    }
    function saveBestRating(v) {
        localStorage.setItem(RATING_KEY, String(v));
    }

    // ---------- DOM ----------
    const $ = (id) => document.getElementById(id);
    const boardEl = $('board');
    const slotRowEl = $('slot-row');
    const lvEl = $('lv');
    const maxLvEl = $('maxlv');
    const scoreEl = $('score');
    const ratingEl = $('rating');
    const bestScoreEl = $('bestScore');
    const remainEl = $('remain');
    const timeEl = $('time');
    const solvableEl = $('solvable');
    const modal = $('modal');
    const modalTitle = $('modal-title');
    const modalDesc = $('modal-desc');

    // ---------- 状态 ----------
    let scene = [];        // Card[]（status 0/1/2）
    let slot = [];         // 卡槽中的 Card[]
    let covered = {};      // { id: bool }
    let level = 1;
    let score = 0;
    let bestScore = loadBestScore();   // 历史最高分（localStorage 持久化）
    let bestRating = loadBestRating(); // 历史最高评分
    let animating = false;
    let finished = false;
    let solvableNow = false;
    let cardEls = {};      // id -> <div class=card>（仅棋盘上的牌）
    let slotEls = [];      // 槽位 DOM（slot 渲染的）
    let lastClickedId = null;
    let fireworksEl = null;

    let tools = Object.assign({}, TOOL_COUNT);
    let startTime = 0;
    let timer = null;
    let elapsed = 0;

    // ---------- 音效（WebAudio 合成，免音频文件） ----------
    let audioCtx = null;
    function ac() {
        if (!audioCtx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (AC) audioCtx = new AC();
        }
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().then(() => {});
        return audioCtx;
    }
    function beep(freq, dur, type, gain, when) {
        const ctx = ac();
        if (!ctx) return;
        const t0 = ctx.currentTime + (when || 0);
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(freq, t0);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(gain || 0.18, t0 + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(g); g.connect(ctx.destination);
        osc.start(t0); osc.stop(t0 + dur + 0.02);
    }
    // 参考 solvable-sheep-game 的音效设计
    const sfx = {
        // 点击牌
        click: () => beep(660, 0.07, 'triangle', 0.16),
        // 入槽（轻微 "咚"）
        slot: () => beep(320, 0.09, 'sine', 0.12),
        // 三连消除琶音
        triple: () => { beep(523, 0.10, 'sine', 0.16); beep(659, 0.10, 'sine', 0.14, 0.08); beep(784, 0.14, 'sine', 0.16, 0.16); },
        // 胜利 — 4 连上行琶音
        win: () => { [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.22, 'triangle', 0.16, i * 0.12)); },
        // 失败 — 下行半音阶
        lose: () => { beep(330, 0.20, 'sawtooth', 0.12); beep(220, 0.30, 'sawtooth', 0.12, 0.14); },
        // 道具音效（弹出/撤销/洗牌）
        tool: () => beep(440, 0.08, 'square', 0.10)
    };

    // ---------- 关卡生成（保证可解，重试直至通过） ----------
    function buildLevel(lv) {
        const opts = core.levelOpts(lv, MAX_LEVEL);
        let result = null;
        for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
            const cand = core.generateLevel(opts);
            if (!cand) continue;
            if (core.verifySolvable(cand.scene)) { result = cand; break; }
        }
        if (!result) result = core.generateLevel(Object.assign(opts, { maxAttempts: 1 }));
        return result;
    }

    // carryScore: 从上一关带过来的累计分（通关自动进关时传入，跳关/重开传 0）
    function startLevel(lv, carryScore) {
        level = lv;
        const res = buildLevel(lv);
        scene = res.scene.map(c => Object.assign({}, c));
        slot = [];
        score = (typeof carryScore === 'number') ? carryScore : 0;
        finished = false;
        animating = false;
        cardEls = {};
        lastClickedId = null;
        tools = Object.assign({}, TOOL_COUNT);
        elapsed = 0;

        covered = core.computeCovered(scene);
        solvableNow = core.verifySolvable(scene);

        render();
        updateStats();
        startTimer();
        hideModal();
    }

    // ---------- 渲染：棋盘 ----------
    // 坐标基准：core.js 里牌的坐标 = col*100（col 0..boardW-1，boardW=8），
    // 最大约 700，加上偏移/牌宽后接近 800 单位。用 800 作基准把整片牌堆
    // 等比缩放到棋盘可视区，保证边缘的牌不越界被裁掉。
    const BOARD_UNITS = 800;
    function boardScale() {
        const w = boardEl.clientWidth;
        const h = boardEl.clientHeight;
        return { sx: w / BOARD_UNITS, sy: h / BOARD_UNITS, w, h };
    }

    function render() {
        const s = boardScale();
        // 清理旧棋盘牌
        for (const id of Object.keys(cardEls)) { cardEls[id].remove(); }
        cardEls = {};

        for (const c of scene) {
            if (c.status !== 0) continue;   // 只画棋盘上的牌
            const isCovered = !!covered[c.id];
            const el = document.createElement('div');
            el.className = 'card' + (isCovered ? ' covered' : '');
            el.dataset.id = c.id;
            el.textContent = levels.iconFor(c.type);
            el.style.left = c.x * s.sx + 'px';
            el.style.top = c.y * s.sy + 'px';
            el.style.zIndex = String(c.layer);
            // 只有顶层（未被压）的牌才绑定点击；灰色被压牌不可点
            if (!isCovered) el.addEventListener('click', onCardClick);
            boardEl.appendChild(el);
            cardEls[c.id] = el;
        }
        renderSlot();
    }

    // ---------- 渲染：卡槽 ----------
    // 同类牌自动整理靠边：把 slot 按 type 稳定分组（同图标相邻、靠左排布），
    // 这是游戏机制的一部分。只有「新入槽」的那张牌触发 slot-in 动画，
    // 已有牌不重播（避免每次入槽时整排槽位一起缩放的闪烁）。
    let lastNewSlotId = null;
    function renderSlot(newId) {
        // 稳定排序：同 type 的牌相邻（保持入槽相对顺序），靠左紧凑排布
        const sorted = slot.slice().sort((a, b) => {
            if (a.type === b.type) return 0;
            return a.type < b.type ? -1 : 1;
        });
        // 同步 slot 数组为整理后的顺序（保持与 DOM 一致，便于后续消除判定）
        slot = sorted;
        lastNewSlotId = newId || null;

        slotRowEl.innerHTML = '';
        slotEls = [];
        for (let i = 0; i < SLOT_CAP; i++) {
            const d = document.createElement('div');
            if (slot[i]) {
                d.className = 'slot filled';
                d.textContent = levels.iconFor(slot[i].type);
                // 仅新入槽的牌做淡入动画，其余牌无动画
                if (slot[i].id === lastNewSlotId) {
                    d.style.animation = 'slot-in 0.18s ease-out';
                }
            } else {
                d.className = 'slot';
            }
            slotRowEl.appendChild(d);
            slotEls.push(d);
        }
    }

    // ---------- 动画：飞入槽位 ----------
    // 原版效果：点击后图标直接向下飞入收集槽（位移即动画，无淡出）。
    // 固定 ~220ms，关闭 CSS 自带的 transform 过渡，避免被 .18s 缓动干扰而显得像瞬移。
    function flyToSlot(cardEl, slotEl) {
        if (!cardEl || !slotEl) return;
        const b = cardEl.getBoundingClientRect();
        const t = slotEl.getBoundingClientRect();
        const dx = (t.left + t.width / 2) - (b.left + b.width / 2);
        const dy = (t.top + t.height / 2) - (b.top + b.height / 2);
        const d = 220;
        cardEl.style.transition = 'none';          // 关闭 CSS 过渡，用 JS 精确控制
        cardEl.style.willChange = 'transform';
        void cardEl.offsetWidth;                   // 强制 reflow 让起点生效
        cardEl.style.transition = 'transform ' + d + 'ms cubic-bezier(.4,0,.2,1)';
        cardEl.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(0.9)';
        cardEl.classList.add('covered');           // 飞行中置灰、不可点
        cardEl.style.pointerEvents = 'none';
    }

    // ---------- 交互：点牌 ----------
    function onCardClick(e) {
        if (finished || animating) return;
        const id = e.currentTarget.dataset.id;
        const c = scene.find(x => x.id === id);
        if (!c || c.status !== 0 || covered[id]) return;

        if (!startTime) startTimer();
        lastClickedId = id;

        sfx.click();
        c.status = 1;
        slot.push(c);
        covered = core.computeCovered(scene);

        animating = true;
        updateStats();
        renderSlot(c.id);       // 槽位就位并整理，仅新牌淡入

        // 棋盘元素飞入对应槽位（不重建棋盘，避免元素被删）
        const cardEl = cardEls[c.id];
        const slotIdx = slot.length - 1;
        const slotEl = slotEls[slotIdx];
        flyToSlot(cardEl, slotEl);

        // 飞行结束后：删除棋盘元素，刷新棋盘 covered 状态，判定消除
        // 槽内图标的显示与淡入动画由 renderSlot(c.id) 统一处理（含同类整理）
        setTimeout(() => {
            if (cardEl && cardEl.parentNode) cardEl.remove();
            delete cardEls[c.id];
            sfx.slot();
            render();   // 刷新棋盘：更新 covered 状态，被压牌置灰/解锁
            resolveMove();
        }, FLY_MS);
    }

    // ---------- 消除判定 ----------
    function resolveMove() {
        let eliminated = 0;   // 本次消除了几组（决定是否播琶音）
        let guard = 0;
        while (guard++ < 10) {
            const triples = core.findTriples(slot);
            if (!triples.length) break;
            eliminated += triples.length;
            const removedTypes = {};
            for (const tp of triples) removedTypes[tp] = (removedTypes[tp] || 0) + 3;
            const next = [];
            for (const c of slot) {
                if (removedTypes[c.type] > 0) {
                    removedTypes[c.type]--;
                    const inScene = scene.find(x => x.id === c.id);
                    if (inScene) inScene.status = 2;
                    score += 3;
                } else {
                    next.push(c);
                }
            }
            slot = next;
            covered = core.computeCovered(scene);
        }
        if (eliminated > 0) sfx.triple();   // 仅本次真正消除时才播琶音

        renderSlot();   // 消除后无新牌入槽，不触发淡入动画
        updateStats();

        const remaining = scene.filter(c => c.status === 0).length;
        if (remaining === 0 && slot.length === 0) { finish(true); animating = false; return; }
        if (slot.length >= SLOT_CAP) { finish(false); animating = false; return; }
        animating = false;
    }

    // ---------- 道具 ----------
    function useTool(kind) {
        if (finished || animating) return;
        if (tools[kind] <= 0) return;
        tools[kind]--;
        sfx.tool();

        if (kind === 'pop') {
            if (!slot.length) return;
            const c = slot.shift();
            const inScene = scene.find(x => x.id === c.id);
            if (inScene) inScene.status = 0;
            covered = core.computeCovered(scene);
        } else if (kind === 'undo') {
            if (!slot.length) return;
            const c = slot.pop();
            const inScene = scene.find(x => x.id === c.id);
            if (inScene) inScene.status = 0;
            covered = core.computeCovered(scene);
        } else if (kind === 'wash') {
            const alive = scene.filter(c => c.status === 0);
            const shuffled = core.shuffle(alive);
            shuffled.forEach((c, i) => {
                c.layer = i;
                c.x = core.randInt(0, 8) * core.CARD_SIZE;
                c.y = core.randInt(0, 8) * core.CARD_SIZE;
            });
            scene = scene.filter(c => c.status !== 0);
            for (const c of shuffled) scene.push(c);
            covered = core.computeCovered(scene);
            solvableNow = core.verifySolvable(scene);
        }

        render();
        updateStats();
    }

    // ---------- 烟花效果（CSS 粒子，参考 solvable-sheep-game） ----------
    function launchFireworks() {
        const container = document.createElement('div');
        container.className = 'fireworks-container';
        container.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
        document.body.appendChild(container);
        const particleCount = 50;
        const colors = ['#ff5252','#ff4081','#e040fb','#7c4dff','#448aff','#40c4ff','#40ffe0','#69f0ae','#b2ff59','#eeff41','#ffff00','#ffd740','#ffab40'];
        for (let i = 0; i < particleCount; i++) {
            const p = document.createElement('div');
            const color = colors[Math.floor(Math.random() * colors.length)];
            const x = Math.random() * 100;
            const y = Math.random() * 100;
            const angle = Math.random() * 360;
            const dist = 50 + Math.random() * 200;
            const size = 4 + Math.random() * 8;
            p.style.cssText = `position:absolute;top:${y}%;left:${x}%;width:${size}px;height:${size}px;background:${color};border-radius:50%;opacity:0;transform:translate(-50%,-50%);box-shadow:0 0 ${size+6}px ${color},0 0 ${size+12}px ${color};`;
            container.appendChild(p);
            const duration = 1000 + Math.random() * 1500;
            const delay = Math.random() * 800;
            setTimeout(() => {
                p.style.transition = `all ${duration}ms ease-out ${delay}ms`;
                p.style.opacity = '1';
                const endX = x + Math.cos(angle * Math.PI / 180) * dist;
                const endY = y + Math.sin(angle * Math.PI / 180) * dist + 100;
                p.style.left = endX + '%';
                p.style.top = endY + '%';
                p.style.opacity = '0';
                setTimeout(() => p.remove(), duration + delay + 100);
            }, 0);
        }
        setTimeout(() => {
            if (container.parentNode) container.parentNode.removeChild(container);
        }, 3500);
    }

    // ---------- 胜负 ----------
    function finish(win) {
        finished = true;
        stopTimer();
        if (win) {
            // 通关奖励：+level 分（参考 solvable-sheep-game 的通关加分）
            score += level;
            // 最高分持久化：本局得分超过历史最高则更新
            const isNewBest = score > bestScore;
            if (isNewBest) {
                bestScore = score;
                saveBestScore(bestScore);
            }
            // 评分 = score * 100 - timeSeconds（参考 solvable-sheep-game 的 rating 公式）
            const rating = Math.max(0, Math.round(score * 100 - elapsed));
            const isNewRating = rating > bestRating;
            if (isNewRating) {
                bestRating = rating;
                saveBestRating(bestRating);
            }
            sfx.win();
            updateStats();
            // 启动烟花
            launchFireworks();
            const clearedAll = level >= MAX_LEVEL;
            const bestNote = isNewBest ? ' 🏆 新纪录！' : '';
            const ratingNote = isNewRating ? ' (新评分！)' : '';
            showModal(true, clearedAll
                ? '🎉 全部通关！你是最强玩家！得分 ' + score + bestNote + ratingNote
                : '✅ 第 ' + level + ' 关通关！得分 ' + score + bestNote + ' 评分 ' + rating + ratingNote);
        } else {
            // 失败也更新最高分（本局已得的分可能超过历史）
            if (score > bestScore) {
                bestScore = score;
                saveBestScore(bestScore);
                updateStats();
            }
            const rating = Math.max(0, Math.round(score * 100 - elapsed));
            sfx.lose();
            showModal(false, '卡槽满了，本局失败。剩余 ' +
                scene.filter(c => c.status === 0).length + ' 张牌，评分 ' + rating);
        }
    }

    function showModal(win, desc) {
        modalTitle.textContent = win ? '通关！' : '失败';
        modalTitle.className = win ? 'win' : 'lose';
        modalDesc.textContent = desc;
        modal.hidden = false;
    }
    function hideModal() { modal.hidden = true; }

    // ---------- 统计 ----------
    function updateStats() {
        lvEl.textContent = level;
        maxLvEl.textContent = MAX_LEVEL;
        scoreEl.textContent = score;
        // 评分 = score * 100 - timeSeconds
        const rating = Math.max(0, score * 100 - elapsed);
        if (ratingEl) ratingEl.textContent = rating;
        if (bestScoreEl) bestScoreEl.textContent = bestScore;
        remainEl.textContent = scene.filter(c => c.status === 0).length;
        solvableEl.textContent = solvableNow ? '✔' : '✖';
        solvableEl.className = solvableNow ? 'good' : 'bad';
        $('cnt-pop').textContent = tools.pop;
        $('cnt-undo').textContent = tools.undo;
        $('cnt-wash').textContent = tools.wash;
        document.querySelector('[data-tool=pop]').disabled = tools.pop <= 0 || finished;
        document.querySelector('[data-tool=undo]').disabled = tools.undo <= 0 || finished;
        document.querySelector('[data-tool=wash]').disabled = tools.wash <= 0 || finished;
        $('btn-next').disabled = finished;
    }

    // ---------- 计时 ----------
    function startTimer() {
        if (timer) return;
        startTime = Date.now() - elapsed * 1000;
        timer = setInterval(() => {
            elapsed = Math.floor((Date.now() - startTime) / 1000);
            timeEl.textContent = fmtTime(elapsed);
        }, 250);
    }
    function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }
    function fmtTime(sec) {
        if (sec < 60) return sec + '秒';
        const m = Math.floor(sec / 60), s = sec % 60;
        return m + '分' + s + '秒';
    }

    // ---------- 按钮绑定 ----------
    function bind() {
        document.querySelectorAll('.tool').forEach(btn => {
            btn.addEventListener('click', () => useTool(btn.dataset.tool));
        });
        // 下一关（跳关）：参考 solvable-sheep-game，跳关扣当前关卡数值的分
        $('btn-next').addEventListener('click', () => {
            if (level < MAX_LEVEL) startLevel(level + 1, Math.max(0, score - level));
        });
        // 重开本关：分数清零
        $('btn-restart').addEventListener('click', () => startLevel(level, 0));
        // 通关弹窗「确定」：带当前累计分进入下一关（通关已 +level 分）
        $('modal-ok').addEventListener('click', () => {
            if (level < MAX_LEVEL) startLevel(level + 1, score);
            else hideModal();
        });
        // 失败弹窗「再来一次」：重开本关，分数清零
        $('modal-retry').addEventListener('click', () => startLevel(level, 0));

        window.addEventListener('resize', () => { if (!finished) render(); });
        // 首次用户手势后解锁音频上下文
        document.addEventListener('pointerdown', () => ac(), { once: true });
        // 移除 BGM 按钮绑定（HTML 已改为静态提示，无 <audio> 元素）
    }

    // ---------- 启动 ----------
    function init() {
        bind();
        startLevel(1);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
