/**
 * Three Cards — UI 层（DOM 渲染 + 交互）
 * 依赖 core.js（ThreeCardsCore）与 levels.js（ThreeCardsLevels）。
 */
(function () {
    'use strict';

    const core = window.ThreeCardsCore;
    const levels = window.ThreeCardsLevels;

    const SLOT_CAP = 7;
    const MAX_LEVEL = 20;
    const TOOL_COUNT = { pop: 3, undo: 3, wash: 3 };

    // ---------- DOM ----------
    const $ = (id) => document.getElementById(id);
    const boardEl = $('board');
    const slotRowEl = $('slot-row');
    const lvEl = $('lv');
    const maxLvEl = $('maxlv');
    const scoreEl = $('score');
    const remainEl = $('remain');
    const timeEl = $('time');
    const solvableEl = $('solvable');
    const modal = $('modal');
    const modalTitle = $('modal-title');
    const modalDesc = $('modal-desc');
    const bgmEl = $('bgm');
    const bgmBtn = $('btn-bgm');

    // ---------- 状态 ----------
    let scene = [];        // Card[]（status 0/1/2）
    let slot = [];         // 卡槽中的 Card[]
    let covered = {};      // { id: bool }
    let level = 1;
    let score = 0;
    let animating = false;
    let finished = false;
    let solvableNow = false;
    let cardEls = {};      // id -> <div class=card>
    let lastClickedId = null;

    let tools = Object.assign({}, TOOL_COUNT);
    let startTime = 0;
    let timer = null;
    let elapsed = 0;

    // ---------- 关卡生成（保证可解，重试直至通过） ----------
    function buildLevel(lv) {
        const opts = core.levelOpts(lv, MAX_LEVEL);
        let result = null;
        for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
            const cand = core.generateLevel(opts);
            if (!cand) continue;
            if (core.verifySolvable(cand.scene)) {
                result = cand;
                break;
            }
        }
        // 兜底：若始终验证不通过，退回一个「数量可清」的简单盘面（仍可玩）
        if (!result) {
            result = core.generateLevel(Object.assign(opts, { maxAttempts: 1 }));
        }
        return result;
    }

    function startLevel(lv) {
        level = lv;
        const res = buildLevel(lv);
        scene = res.scene.map(c => Object.assign({}, c));
        slot = [];
        score = 0;
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

    // ---------- 渲染 ----------
    function boardScale() {
        // 把百分比坐标映射到 board 像素
        const w = boardEl.clientWidth;
        const h = boardEl.clientHeight;
        // 牌堆坐标范围：boardW*100 .. 我们按 800 宽基准换算
        return { sx: w / 800, sy: h / 800, w, h };
    }

    function render() {
        const s = boardScale();
        // 清理旧牌
        for (const id of Object.keys(cardEls)) {
            cardEls[id].remove();
        }
        cardEls = {};

        for (const c of scene) {
            if (c.status === 2) continue; // 已消除不画
            const el = document.createElement('div');
            el.className = 'card';
            el.dataset.id = c.id;
            el.textContent = levels.iconFor(c.type);
            el.style.left = c.x * s.sx + 'px';
            el.style.top = c.y * s.sy + 'px';
            el.style.zIndex = String(c.layer);
            if (covered[c.id]) el.classList.add('covered');
            el.addEventListener('click', onCardClick);
            boardEl.appendChild(el);
            cardEls[c.id] = el;
        }
        renderSlot();
    }

    function renderSlot() {
        slotRowEl.innerHTML = '';
        for (let i = 0; i < SLOT_CAP; i++) {
            const d = document.createElement('div');
            if (slot[i]) {
                d.className = 'slot filled';
                d.textContent = levels.iconFor(slot[i].type);
            } else {
                d.className = 'slot';
            }
            slotRowEl.appendChild(d);
        }
    }

    // ---------- 交互：点牌 ----------
    function onCardClick(e) {
        if (finished || animating) return;
        const id = e.currentTarget.dataset.id;
        const c = scene.find(x => x.id === id);
        if (!c || c.status !== 0 || covered[id]) return;

        if (!startTime) startTimer();
        lastClickedId = id;

        // 入槽
        c.status = 1;
        slot.push(c);
        covered = core.computeCovered(scene);

        animating = true;
        render();
        updateStats();

        // 动画锁 160ms 后判定消除
        setTimeout(resolveMove, 160);
    }

    function resolveMove() {
        // 检测卡槽中的三连
        let changed = false;
        let guard = 0;
        while (guard++ < 10) {
            const triples = core.findTriples(slot);
            if (!triples.length) break;
            changed = true;
            // 移除被消除的牌
            const removedTypes = {};
            for (const tp of triples) removedTypes[tp] = (removedTypes[tp] || 0) + 3;
            const next = [];
            for (const c of slot) {
                if (removedTypes[c.type] > 0) {
                    removedTypes[c.type]--;
                    const inScene = scene.find(x => x.id === c.id);
                    if (inScene) inScene.status = 2;
                    if (cardEls[c.id]) {
                        cardEls[c.id].classList.add('removing');
                        const el = cardEls[c.id];
                        setTimeout(() => el.remove(), 180);
                        delete cardEls[c.id];
                    }
                    score += 3;
                } else {
                    next.push(c);
                }
            }
            slot = next;
            covered = core.computeCovered(scene);
        }

        renderSlot();
        updateStats();

        // 判定胜负
        const remaining = scene.filter(c => c.status === 0).length;
        if (remaining === 0 && slot.length === 0) {
            finish(true);
            animating = false;
            return;
        }
        if (slot.length >= SLOT_CAP) {
            finish(false);
            animating = false;
            return;
        }
        animating = false;
    }

    // ---------- 道具 ----------
    function useTool(kind) {
        if (finished || animating) return;
        if (tools[kind] <= 0) return;
        tools[kind]--;

        if (kind === 'pop') {
            if (!slot.length) return;
            const c = slot.shift();
            const inScene = scene.find(x => x.id === c.id);
            if (inScene) { inScene.status = 0; }
            covered = core.computeCovered(scene);
        } else if (kind === 'undo') {
            if (!slot.length) return;
            const c = slot.pop();
            const inScene = scene.find(x => x.id === c.id);
            if (inScene) { inScene.status = 0; }
            covered = core.computeCovered(scene);
        } else if (kind === 'wash') {
            // 洗牌：打乱牌堆中 status 0 的牌的坐标与层序
            const alive = scene.filter(c => c.status === 0);
            const shuffled = core.shuffle(alive);
            shuffled.forEach((c, i) => {
                c.layer = i;
                // 重新随机坐标
                const col = core.randInt(0, 7);
                const row = core.randInt(0, 7);
                c.x = col * core.CARD_SIZE;
                c.y = row * core.CARD_SIZE;
            });
            // 保持 scene 顺序与层序一致
            scene = scene.filter(c => c.status !== 0);
            for (const c of shuffled) scene.push(c);
            covered = core.computeCovered(scene);
            solvableNow = core.verifySolvable(scene);
        }

        render();
        updateStats();
    }

    // ---------- 胜负 ----------
    function finish(win) {
        finished = true;
        stopTimer();
        if (win) {
            showModal(true, level >= MAX_LEVEL
                ? '🎉 全部通关！你是最强玩家！'
                : '✅ 第 ' + level + ' 关通关！得分 ' + score);
        } else {
            showModal(false, '卡槽满了，本局失败。剩余 ' +
                scene.filter(c => c.status === 0).length + ' 张牌');
        }
    }

    function showModal(win, desc) {
        modalTitle.textContent = win ? '通关！' : '失败';
        modalTitle.className = win ? 'win' : 'lose';
        modalDesc.textContent = desc;
        modal.hidden = false;
    }
    function hideModal() { modal.hidden = true; }

    // ---------- 统计 / 计时 ----------
    function updateStats() {
        lvEl.textContent = level;
        maxLvEl.textContent = MAX_LEVEL;
        scoreEl.textContent = score;
        remainEl.textContent = scene.filter(c => c.status === 0).length;
        solvableEl.textContent = solvableNow ? '✔' : '✖';
        solvableEl.className = solvableNow ? 'good' : 'bad';
        $('cnt-pop').textContent = tools.pop;
        $('cnt-undo').textContent = tools.undo;
        $('cnt-wash').textContent = tools.wash;
        document.querySelector('[data-tool=pop]').disabled = tools.pop <= 0 || finished;
        document.querySelector('[data-tool=undo]').disabled = tools.undo <= 0 || finished;
        document.querySelector('[data-tool=wash]').disabled = tools.wash <= 0 || finished;
        $('btn-next').disabled = finished && !solvableNow;
    }

    function startTimer() {
        if (timer) return;
        startTime = Date.now() - elapsed * 1000;
        timer = setInterval(() => {
            elapsed = Math.floor((Date.now() - startTime) / 1000);
            timeEl.textContent = fmtTime(elapsed);
        }, 250);
    }
    function stopTimer() {
        if (timer) { clearInterval(timer); timer = null; }
    }
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
        $('btn-next').addEventListener('click', () => {
            if (level < MAX_LEVEL) startLevel(level + 1);
        });
        $('btn-restart').addEventListener('click', () => startLevel(level));
        $('modal-ok').addEventListener('click', () => {
            if (solvableNow && !finished) return;
            if (level < MAX_LEVEL) startLevel(level + 1);
            else hideModal();
        });
        $('modal-retry').addEventListener('click', () => startLevel(level));

        // BGM（占位：无音频文件时静默）
        bgmBtn.addEventListener('click', () => {
            if (!bgmEl.src) return;
            if (bgmEl.paused) {
                bgmEl.volume = 0.5;
                bgmEl.play().then().catch(() => {});
                bgmBtn.textContent = '🔊';
            } else {
                bgmEl.pause();
                bgmBtn.textContent = '🔈';
            }
        });

        window.addEventListener('resize', () => { if (!finished) render(); });
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
