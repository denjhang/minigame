// 程序化生成 Minecraft 风格 16x16 像素纹理图集（无外部图片，H5 离线可玩）
// 每个图块由确定性 RNG 生成，保证每次刷新画面一致

import * as THREE from 'three';

export const TILE = {
  GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3, COBBLE: 4,
  PLANKS: 5, LOG_SIDE: 6, LOG_TOP: 7, LEAVES: 8, SAND: 9,
  GRAVEL: 10, WATER: 11, BEDROCK: 12, SNOW: 13, SNOW_SIDE: 14,
  GLASS: 15, BRICK: 16,
};

const TILE_PX = 16;
// 图集：17 列 × 1 行，宽 272px，高 16px
export const TILE_COUNT = 17;
const ATLAS_COLS = TILE_COUNT;
export const ATLAS_U_FRAC = 1 / ATLAS_COLS;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 生成器返回 16x16 RGBA；像素 (x,y)：y=0 是纹理顶部
function makeTile(gen) {
  const data = new Uint8ClampedArray(TILE_PX * TILE_PX * 4);
  gen(data);
  return data;
}

function px(data, x, y, r, g, b, a = 255) {
  const i = (y * TILE_PX + x) * 4;
  data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
}

// 在基准色上做 ±var 的抖动
function noisyFill(data, base, variation, rng, alpha = 255) {
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const d = Math.round((rng() * 2 - 1) * variation);
      px(data, x, y,
        Math.max(0, Math.min(255, base[0] + d)),
        Math.max(0, Math.min(255, base[1] + d)),
        Math.max(0, Math.min(255, base[2] + d)), alpha);
    }
}

// ---------------- 各图块 ----------------

function grassTop(data) {
  const rng = mulberry32(100);
  noisyFill(data, [106, 190, 74], 16, rng);
}

function dirt(data) {
  const rng = mulberry32(200);
  noisyFill(data, [134, 96, 67], 16, rng);
  for (let i = 0; i < 8; i++) { // 深色斑点
    px(data, Math.floor(rng() * 16), Math.floor(rng() * 16), 96, 66, 44);
  }
}

function grassSide(data) {
  const rng = mulberry32(300);
  noisyFill(data, [134, 96, 67], 16, rng); // 底层泥土
  const edge = [];
  for (let x = 0; x < 16; x++) edge[x] = 2 + Math.floor(rng() * 2); // 2 或 3 行草
  for (let x = 0; x < 16; x++)
    for (let y = 0; y < edge[x] + 1; y++) {
      const d = Math.round((rng() * 2 - 1) * 14);
      px(data, x, y, 106 + d, 190 + d, 74 + d);
    }
}

function stone(data) {
  const rng = mulberry32(400);
  noisyFill(data, [125, 125, 125], 9, rng);
  for (let i = 0; i < 10; i++)
    px(data, Math.floor(rng() * 16), Math.floor(rng() * 16), 100, 100, 100);
}

function cobble(data) {
  const rng = mulberry32(500);
  noisyFill(data, [112, 112, 112], 10, rng);
  // 深色“石块接缝”：横向断线
  const lines = [
    [0, 3, 7], [8, 3, 16], [0, 9, 11], [12, 9, 16], [4, 13, 16], [0, 13, 3],
  ];
  for (const [x0, y, x1] of lines)
    for (let x = x0; x < x1 && x < 16; x++) px(data, x, y, 78, 78, 78);
  for (let i = 0; i < 14; i++)
    px(data, Math.floor(rng() * 16), Math.floor(rng() * 16), 88, 88, 88);
}

function planks(data) {
  const rng = mulberry32(600);
  noisyFill(data, [168, 134, 82], 10, rng);
  // 四条板缝（每 4 行一条板）
  for (const y of [3, 7, 11, 15])
    for (let x = 0; x < 16; x++) px(data, x, y, 104, 80, 48);
  // 每行的竖向接缝（错开位置）
  const seams = [9, 3, 12, 6];
  seams.forEach((x, row) => {
    for (let y = row * 4; y < row * 4 + 3; y++) px(data, x, y, 104, 80, 48);
  });
  // 木纹
  for (let i = 0; i < 18; i++) {
    const x = Math.floor(rng() * 16), y = Math.floor(rng() * 16);
    if (y % 4 === 3) continue;
    px(data, x, y, 150, 116, 68);
  }
}

function logSide(data) {
  const rng = mulberry32(700);
  for (let x = 0; x < 16; x++) {
    // 纵向树皮条纹
    const dark = rng() < 0.4;
    for (let y = 0; y < 16; y++) {
      const d = Math.round((rng() * 2 - 1) * 10);
      if (dark) px(data, x, y, 88 + d, 66 + d, 38 + d);
      else px(data, x, y, 122 + d, 95 + d, 56 + d);
    }
  }
}

function logTop(data) {
  const rng = mulberry32(800);
  // 从外到内的同心方环：深-浅交替
  const rings = [[7, 86, 64, 36], [5, 122, 95, 56], [3, 150, 120, 74], [1, 180, 148, 92]];
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      let c = rings[3][2];
      for (const [r, rr, gg, bb] of rings) if (d <= r) c = rr;
      const v = (rng() * 2 - 1) * 8;
      px(data, x, y, c + v, (c * 0.75) + v, (c * 0.45) + v);
    }
}

function leaves(data) {
  const rng = mulberry32(900);
  noisyFill(data, [60, 134, 44], 20, rng);
  for (let i = 0; i < 10; i++)
    px(data, Math.floor(rng() * 16), Math.floor(rng() * 16), 38, 96, 28);
}

function sand(data) {
  const rng = mulberry32(1000);
  noisyFill(data, [219, 206, 160], 9, rng);
}

function gravel(data) {
  const rng = mulberry32(1100);
  const palette = [[130, 120, 110], [95, 85, 80], [160, 150, 140], [75, 68, 64]];
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const c = palette[Math.floor(rng() * palette.length)];
      const d = Math.round((rng() * 2 - 1) * 10);
      px(data, x, y, c[0] + d, c[1] + d, c[2] + d);
    }
}

function water(data) {
  const rng = mulberry32(1200);
  noisyFill(data, [52, 116, 212], 12, rng, 205);
  // 波纹亮点
  for (let i = 0; i < 10; i++)
    px(data, Math.floor(rng() * 16), Math.floor(rng() * 16), 110, 170, 240, 205);
}

function bedrock(data) {
  const rng = mulberry32(1300);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const v = 30 + Math.floor(rng() * 70);
      px(data, x, y, v, v, v);
    }
}

function snow(data) {
  const rng = mulberry32(1400);
  noisyFill(data, [242, 248, 255], 4, rng);
}

function snowSide(data) {
  const rng = mulberry32(1500);
  noisyFill(data, [134, 96, 67], 16, rng);
  for (let x = 0; x < 16; x++)
    for (let y = 0; y < 3; y++) {
      const d = Math.round((rng() * 2 - 1) * 4);
      px(data, x, y, 242 + d, 248 + d, 255);
    }
}

function glass(data) {
  // 白色边框 + 半透明玻璃 + 两条高光斜线
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if (x === 0 || y === 0 || x === 15 || y === 15) px(data, x, y, 255, 255, 255);
      else px(data, x, y, 220, 240, 255, 55);
    }
  for (let i = 1; i < 5; i++) { px(data, i, 3 - i + 3, 255, 255, 255, 200); px(data, i + 1, 3 - i + 4, 255, 255, 255, 140); }
  for (let i = 1; i < 4; i++) px(data, 12 - i, 10 + i, 255, 255, 255, 180);
}

function brick(data) {
  const rng = mulberry32(1600);
  // 砖体
  noisyFill(data, [150, 94, 82], 12, rng);
  // 灰浆：横向 4 行砖缝 + 每行错位的竖缝
  for (const y of [3, 7, 11, 15])
    for (let x = 0; x < 16; x++) px(data, x, y, 200, 190, 180);
  for (let row = 0; row < 4; row++) {
    const offset = row % 2 === 0 ? 4 : 10;
    for (let y = row * 4; y < row * 4 + 3; y++) px(data, offset % 16, y, 200, 190, 180);
  }
}

export const TILE_GENERATORS = {
  grass_top: grassTop, grass_side: grassSide, dirt, stone, cobble,
  planks, log_side: logSide, log_top: logTop, leaves, sand,
  gravel, water, bedrock, snow, snow_side: snowSide, glass, brick,
};

// 名字 -> 页索引
export const TILE_INDEX = {};
Object.entries(TILE_GENERATORS).forEach(([name, gen], i) => { TILE_INDEX[name] = i; });

// 生成图集：宽 272px（17 列 × 16），高 16px
export function buildAtlas() {
  const W = ATLAS_COLS * TILE_PX, H = TILE_PX;
  const data = new Uint8ClampedArray(W * H * 4);
  Object.entries(TILE_GENERATORS).forEach(([name, gen], page) => {
    const tile = makeTile(gen);
    for (let y = 0; y < TILE_PX; y++)
      for (let x = 0; x < TILE_PX; x++) {
        const si = (y * TILE_PX + x) * 4;
        const di = ((y * W + (page * TILE_PX + x)) * 4);
        data[di] = tile[si]; data[di + 1] = tile[si + 1]; data[di + 2] = tile[si + 2]; data[di + 3] = tile[si + 3];
      }
  });
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(data, W, H), 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;   // 像素风
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = true; // 默认；配合 uv 计算
  return tex;
}

// 某图块的 uv 范围。图集只有 1 行（高 16px = 1 个图块），
// 所以 v 恒为 [0,1]；u 按页切分。注意 flipY=true：图像顶行 → v=1。
export function tileUV(page) {
  const u0 = page * ATLAS_U_FRAC;
  return { u0, u1: u0 + ATLAS_U_FRAC, vTop: 1, vBot: 0 };
}

// 方块图标（热键栏/图标渲染）：返回 64x64 的 dataURL（把对应图块放大 4 倍）
export function tileIconDataUrl(page, size = 48) {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gen = Object.values(TILE_GENERATORS)[page];
  const tile = makeTile(gen);
  const img = new ImageData(new Uint8ClampedArray(tile), TILE_PX, TILE_PX);
  const tmp = document.createElement('canvas');
  tmp.width = TILE_PX; tmp.height = TILE_PX;
  tmp.getContext('2d').putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, size, size);
  return canvas.toDataURL();
}
