// Voxelcraft 主程序：场景搭建、区块网格管理、破坏/放置、游戏主循环
import * as THREE from 'three';
import { BLOCK, BLOCK_DEFS, HOTBAR, HOTBAR_TILES, PLAYER, WORLD } from './constants.js';
import { buildAtlas, tileIconDataUrl, TILE_INDEX } from './textures.js';
import { World } from './world.js';
import { buildChunkGeometry } from './mesher.js';
import { Player } from './player.js';
import { raycastVoxel } from './raycast.js';
import { DayCycle } from './daycycle.js';
import { Input } from './input.js';

// ---------------- 基础场景 ----------------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 400);

const atlas = buildAtlas();
const opaqueMat = new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true });
const waterMat = new THREE.MeshLambertMaterial({
  map: atlas, vertexColors: true, transparent: true, opacity: 0.75,
  depthWrite: false, side: THREE.DoubleSide,
});

const dayCycle = new DayCycle(scene);
const input = new Input(canvas, (locked) => setLocked(locked || input.fallback));

// ---------------- 世界与区块 ----------------
const world = new World();
world.generate(20260922);

const CHUNK = 16;
const CHUNKS_X = WORLD.SIZE_X / CHUNK;
const CHUNKS_Z = WORLD.SIZE_Z / CHUNK;
const chunkMeshes = new Map(); // "cx,cz" → { solid, water, version }

function chunkKey(cx, cz) { return cx + ',' + cz; }

function rebuildChunk(cx, cz) {
  const key = chunkKey(cx, cz);
  const old = chunkMeshes.get(key);
  if (old) {
    for (const m of [old.solid, old.water]) {
      if (m) { scene.remove(m); m.geometry.dispose(); }
    }
  }
  const geoSolid = buildChunkGeometry(world, cx, cz, true);
  const geoWater = buildChunkGeometry(world, cx, cz, false);
  const entry = { version: world.version, solid: null, water: null };
  if (geoSolid) {
    entry.solid = new THREE.Mesh(geoSolid, opaqueMat);
    scene.add(entry.solid);
  }
  if (geoWater) {
    entry.water = new THREE.Mesh(geoWater, waterMat);
    scene.add(entry.water);
  }
  chunkMeshes.set(key, entry);
}

function buildAllChunks() {
  const t0 = performance.now();
  for (let cz = 0; cz < CHUNKS_Z; cz++)
    for (let cx = 0; cx < CHUNKS_X; cx++)
      rebuildChunk(cx, cz);
  console.log(`生成 ${CHUNKS_X * CHUNKS_Z} 个区块，耗时 ${(performance.now() - t0).toFixed(0)}ms`);
}

// 只重建被编辑方块影响的区块（含相邻区块，因为面剔除跨区块）
function markDirty(x, z) {
  const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
  const set = new Set([cx + ',' + cz]);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const nx = cx + dx, nz = cz + dz;
    if (nx >= 0 && nx < CHUNKS_X && nz >= 0 && nz < CHUNKS_Z) set.add(nx + ',' + nz);
  }
  for (const key of set) {
    const [a, b] = key.split(',').map(Number);
    if (chunkMeshes.get(key).version !== world.version) rebuildChunk(a, b);
  }
}

buildAllChunks();

// ---------------- 玩家 ----------------
const spawn = world.findSpawn();
const player = new Player(world);
player.pos.set(spawn.x, spawn.y, spawn.z);
let yaw = 0, pitch = 0;
player.yaw = yaw;

// ---------------- 目标高亮框 ----------------
const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
  new THREE.LineBasicMaterial({ color: 0x111111 })
);
highlight.visible = false;
scene.add(highlight);

// ---------------- HUD ----------------
const hud = {
  fps: document.getElementById('hud-fps'),
  pos: document.getElementById('hud-pos'),
  clock: document.getElementById('hud-clock'),
  hotbar: document.getElementById('hotbar'),
  breakBar: document.getElementById('break-bar'),
  overlay: document.getElementById('overlay'),
  msg: document.getElementById('hud-msg'),
  msgTimer: 0,
};

// 热键栏图标
HOTBAR_TILES.forEach((name, i) => {
  const slot = document.createElement('div');
  slot.className = 'slot' + (i === 0 ? ' selected' : '');
  slot.title = BLOCK_DEFS[HOTBAR[i]].name;
  const img = document.createElement('img');
  img.src = tileIconDataUrl(TILE_INDEX[name]);
  img.alt = BLOCK_DEFS[HOTBAR[i]].name;
  const num = document.createElement('span');
  num.className = 'slot-num';
  num.textContent = i + 1;
  slot.append(img, num);
  hud.hotbar.appendChild(slot);
});
const slots = [...hud.hotbar.children];
function selectSlot(i) {
  hud.selected = i;
  input.selected = i;
  slots.forEach((s, k) => s.classList.toggle('selected', k === i));
}

function setLocked(locked) {
  hud.overlay.classList.toggle('hidden', locked);
  if (!locked) {
    hud.breakBar.style.setProperty('--p', '0%');
    highlight.visible = false;
  }
}

function flashMsg(text) {
  hud.msg.textContent = text;
  hud.msg.classList.remove('hidden');
  hud.msgTimer = 2;
}

// ---------------- 破坏 / 放置 ----------------
let breakTarget = null;
let breakProgress = 0;
const camDir = new THREE.Vector3();

function getTarget() {
  camera.getWorldDirection(camDir);
  return raycastVoxel(world, camera.position, camDir, PLAYER.REACH);
}

function doBreak(t) {
  const def = BLOCK_DEFS[t.id];
  if (def.hardness < 0) { flashMsg('基岩不可破坏！'); return; }
  world.set(t.x, t.y, t.z, BLOCK.AIR);
  markDirty(t.x, t.z);
}

function doPlace(t) {
  if (!t.face) return;
  const px = t.x + t.face[0], py = t.y + t.face[1], pz = t.z + t.face[2];
  if (!world.inBounds(px, py, pz)) return;
  const cur = world.get(px, py, pz);
  if (cur !== BLOCK.AIR && cur !== BLOCK.WATER) return;
  // 不能放在玩家身体内
  const hw = PLAYER.HALF_WIDTH;
  const p = player.pos;
  if (px + 1 > p.x - hw && px < p.x + hw &&
      pz + 1 > p.z - hw && pz < p.z + hw &&
      py + 1 > p.y && py < p.y + PLAYER.HEIGHT) {
    return;
  }
  const id = HOTBAR[input.selected];
  world.set(px, py, pz, id);
  markDirty(px, pz);
}

// ---------------- 游戏主循环 ----------------
let lastT = performance.now();
let fpsAcc = 0, fpsCount = 0, fps = 60;

function tick(now) {
  const dt = Math.min((now - lastT) / 1000, 0.1);
  lastT = now;

  fpsAcc += dt; fpsCount++;
  if (fpsAcc >= 0.5) { fps = Math.round(fpsCount / fpsAcc); fpsAcc = 0; fpsCount = 0; }

  if (input.active) {
    const inp = input.consume();

    // 视角（鼠标右移 → 向右转，鼠标上移 → 抬头）
    yaw += inp.mouseDX * 0.0022;
    pitch -= inp.mouseDY * 0.0022;
    pitch = Math.max(-1.55, Math.min(1.55, pitch));
    player.yaw = yaw;

    // 热键栏切换
    if (inp.wheel !== 0) selectSlot((input.selected + inp.wheel + 9) % 9);

    // 移动
    const fwd = inp.forward, str = inp.strafe;
    const mag = Math.hypot(fwd, str);
    player.input(mag > 1 ? fwd / mag : fwd, mag > 1 ? str / mag : str, inp.sprint, dt);

    // 跳跃 / 游泳
    if (inp.jump) {
      if (player.inWater) player.vel.y = Math.max(player.vel.y, 2.8);
      else player.jump();
    }
    player.update(dt);
    // 掉出世界底部 → 回出生点
    if (player.pos.y < -10) {
      player.pos.set(spawn.x, spawn.y, spawn.z);
      player.vel.set(0, 0, 0);
      flashMsg('掉落出世界，已传送回出生点');
    }

    // 瞄准与破坏
    const t = getTarget();
    if (t) {
      highlight.visible = true;
      highlight.position.set(t.x + 0.5, t.y + 0.5, t.z + 0.5);
    } else {
      highlight.visible = false;
    }

    if (inp.leftHeld && t && BLOCK_DEFS[t.id].hardness >= 0) {
      if (!breakTarget || breakTarget.x !== t.x || breakTarget.y !== t.y || breakTarget.z !== t.z) {
        breakTarget = t;
        breakProgress = 0;
      }
      const need = BLOCK_DEFS[t.id].hardness * 1.5; // 原版：hardness × 1.5s
      breakProgress += dt / need;
      hud.breakBar.style.setProperty('--p', Math.min(breakProgress * 100, 100) + '%');
      if (breakProgress >= 1) {
        doBreak(breakTarget);
        breakTarget = null;
        breakProgress = 0;
        hud.breakBar.style.setProperty('--p', '0%');
      }
    } else {
      if (!inp.leftHeld && breakProgress > 0) {
        breakProgress = Math.max(0, breakProgress - dt * 3);
        hud.breakBar.style.setProperty('--p', breakProgress * 100 + '%');
        if (breakProgress === 0) breakTarget = null;
      }
    }

    if (inp.clickRight && t) doPlace(t);

    // 相机跟随（yaw=0 朝 -Z，与移动向量一致）
    camera.position.set(player.pos.x, player.pos.y + PLAYER.EYE, player.pos.z);
    camera.rotation.set(0, 0, 0);
    camera.rotateY(-yaw);
    camera.rotateX(pitch);
  } else {
    input.consume(); // 丢弃锁定外的输入
  }

  dayCycle.update(dt);
  dayCycle.sun.target.position.copy(player.pos); // 光照方向跟随玩家

  // HUD
  hud.fps.textContent = fps;
  hud.pos.textContent = `${player.pos.x.toFixed(1)} / ${player.pos.y.toFixed(1)} / ${player.pos.z.toFixed(1)}`;
  // 原版时钟：游戏时间 = t × 48（日出 0:00，日落 12:00，午夜 18:00）
  const gt = dayCycle.t * 48;
  const hour = Math.floor(gt) % 24;
  const min = Math.floor((gt % 1) * 60);
  hud.clock.textContent = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}` +
    (dayCycle.isNight ? ' 🌙' : ' ☀️');
  if (hud.msgTimer > 0) {
    hud.msgTimer -= dt;
    if (hud.msgTimer <= 0) hud.msg.classList.add('hidden');
  }

  renderer.render(scene, camera);
}

function frame(now) {
  tick(now);
  requestAnimationFrame(frame);
}

// 点击遮罩开始游戏
hud.overlay.addEventListener('click', () => input.requestLock());
requestAnimationFrame(frame);

// 开发/测试钩子（不影响游戏运行；tick 可被外部手动驱动以在无 rAF 环境测试）
window.__voxelcraft = {
  world, player, camera, scene, dayCycle, input, tick,
  raycast: (origin, dir) => raycastVoxel(world, origin, dir, PLAYER.REACH),
};
