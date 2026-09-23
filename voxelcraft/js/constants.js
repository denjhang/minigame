// ============================================================
// 原版 Minecraft 机制数据（来源：minecraft.wiki，2026-09-22 抓取）
//   - 步行速度   4.317 blocks/s
//   - 疾跑速度   5.612 blocks/s
//   - 跳跃高度   1.25 blocks
//   - 重力       0.08 blocks/tick²，终端速度 ×0.98（20 ticks/s）
//   - 昼夜循环   完整一天 20 分钟 = 24000 ticks；白天 1000 / 黄昏 12000 /
//                夜晚 13000 / 黎明 23000（游戏内时间单位，每 tick = 3.6 游戏秒）
//   - 玩家身高 1.8 blocks，眼睛高度 1.62 blocks
//   - 方块徒手破坏耗时 = hardness × 1.5 s：
//     泥土/沙 0.75s | 草方块 0.9s | 石头 2.25s | 圆石/木板/原木 3.0s
//     树叶 0.3s | 基岩不可破坏
// ============================================================

export const BLOCK = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  COBBLE: 4,
  PLANKS: 5,
  LOG: 6,
  LEAVES: 7,
  SAND: 8,
  GRAVEL: 9,
  WATER: 10,
  BEDROCK: 11,
  SNOW: 12,
  GLASS: 13,
  BRICK: 14,
};

// 各面使用的图集页（page 索引对应 textures.js 中的 TILE 顺序）
export const FACES = {
  TOP: 0, BOTTOM: 1, SIDE: 2,
};

// 方块定义：solid 参与碰撞；opaque 可完全遮挡邻居面（透明方块会露出相邻面）
export const BLOCK_DEFS = {
  0:  { name: 'air',       solid: false, opaque: false, hardness: 0,    faces: [] },
  1:  { name: 'grass',     solid: true,  opaque: true,  hardness: 0.6,  faces: ['grass_top', 'dirt', 'grass_side'] },
  2:  { name: 'dirt',      solid: true,  opaque: true,  hardness: 0.5,  faces: ['dirt', 'dirt', 'dirt'] },
  3:  { name: 'stone',     solid: true,  opaque: true,  hardness: 1.5,  faces: ['stone', 'stone', 'stone'] },
  4:  { name: 'cobble',    solid: true,  opaque: true,  hardness: 2.0,  faces: ['cobble', 'cobble', 'cobble'] },
  5:  { name: 'planks',    solid: true,  opaque: true,  hardness: 2.0,  faces: ['planks', 'planks', 'planks'] },
  6:  { name: 'log',       solid: true,  opaque: true,  hardness: 2.0,  faces: ['log_top', 'log_top', 'log_side'] },
  7:  { name: 'leaves',    solid: true,  opaque: false, hardness: 0.2,  faces: ['leaves', 'leaves', 'leaves'] },
  8:  { name: 'sand',      solid: true,  opaque: true,  hardness: 0.5,  faces: ['sand', 'sand', 'sand'] },
  9:  { name: 'gravel',    solid: true,  opaque: true,  hardness: 0.6,  faces: ['gravel', 'gravel', 'gravel'] },
  10: { name: 'water',     solid: false, opaque: false, hardness: 0,    faces: ['water', 'water', 'water'] },
  11: { name: 'bedrock',   solid: true,  opaque: true,  hardness: -1,   faces: ['bedrock', 'bedrock', 'bedrock'] },
  12: { name: 'snow',      solid: true,  opaque: true,  hardness: 0.1,  faces: ['snow', 'dirt', 'snow_side'] },
  13: { name: 'glass',     solid: true,  opaque: false, hardness: 0.3,  faces: ['glass', 'glass', 'glass'] },
  14: { name: 'brick',     solid: true,  opaque: true,  hardness: 2.0,  faces: ['brick', 'brick', 'brick'] },
};

// 热键栏 9 格（对应原版数字键 1-9）
export const HOTBAR = [
  BLOCK.DIRT, BLOCK.STONE, BLOCK.COBBLE, BLOCK.PLANKS, BLOCK.LOG,
  BLOCK.LEAVES, BLOCK.SAND, BLOCK.GLASS, BLOCK.BRICK,
];

export const WORLD = {
  SIZE_X: 96,
  SIZE_Z: 96,
  HEIGHT: 64,
  CHUNK: 16,
  WATER_LEVEL: 28,
  SEA_FLOOR: 24, // 海床基线
};

export const PLAYER = {
  WALK_SPEED: 4.317,
  SPRINT_SPEED: 5.612,
  FLY_SPEED: 10,           // 创造模式飞行水平移速（原版约 10 blocks/s）
  FLY_VERTICAL_SPEED: 10,  // 飞行上升/下降的最大垂直速度
  JUMP_HEIGHT: 1.25,
  GRAVITY_PER_TICK: 0.08,
  TICK_RATE: 20,
  TERMINAL_DAMPING: 0.98,
  HEIGHT: 1.8,
  EYE: 1.62,
  HALF_WIDTH: 0.3,
  REACH: 5,
};

// 起跳初速（blocks/s）。按本引擎的精确离散模型（每 tick：v −= 1.6 后 ×0.98，
// 位移 = v × 0.05）反推，使跳顶高度恰好 1.25 格：v0 ≈ 10.05
// （连续近似 sqrt(2·g·h)=8.944 在此离散模型下只能跳到约 1.0 格，偏低）
export const JUMP_VY = 10.05;

export const DAY_CYCLE = {
  SECONDS: 1200,        // 一天 20 分钟 = 24000 ticks（原版）
  START: 0.05,          // 开局约为游戏内 6:50（清晨，tick 1200/24000）
};

// 方块图标（热键栏显示用），按 HOTBAR 顺序
export const HOTBAR_TILES = [
  'dirt', 'stone', 'cobble', 'planks', 'log_side', 'leaves', 'sand', 'glass', 'brick',
];
