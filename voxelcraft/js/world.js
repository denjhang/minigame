// 世界：体素存储 + 地形生成（原版 Minecraft 式分层：基岩→石头→泥土→草/沙/雪）
import { BLOCK, WORLD } from './constants.js';
import { Noise } from './noise.js';

export class World {
  constructor() {
    this.SX = WORLD.SIZE_X;
    this.SY = WORLD.HEIGHT;
    this.SZ = WORLD.SIZE_Z;
    this.blocks = new Uint8Array(this.SX * this.SY * this.SZ);
    this.version = 0; // 任何 set() 后 +1，用于脏 chunk 追踪
  }

  idx(x, y, z) {
    return x + z * this.SX + y * this.SX * this.SZ;
  }

  inBounds(x, y, z) {
    return x >= 0 && x < this.SX && y >= 0 && y < this.SY && z >= 0 && z < this.SZ;
  }

  get(x, y, z) {
    if (!this.inBounds(x, y, z)) return BLOCK.AIR;
    return this.blocks[this.idx(x, y, z)];
  }

  // 越界（世界之外）视为空气，但 y 向下越界视为石头（防止底部露洞）
  getRaw(x, y, z) {
    if (y < 0) return BLOCK.STONE;
    if (!this.inBounds(x, y, z)) return BLOCK.AIR;
    return this.blocks[this.idx(x, y, z)];
  }

  set(x, y, z, id) {
    if (!this.inBounds(x, y, z)) return false;
    if (this.blocks[this.idx(x, y, z)] === id) return false;
    this.blocks[this.idx(x, y, z)] = id;
    this.version++;
    return true;
  }

  // ---------------- 地形生成 ----------------
  generate(seed = 1337) {
    const n1 = new Noise(seed);
    const n2 = new Noise(seed * 7 + 1);
    const { SX, SZ, SY } = this;
    const WL = WORLD.WATER_LEVEL;

    // 1. 高度图
    const heights = new Int16Array(SX * SZ);
    for (let z = 0; z < SZ; z++) {
      for (let x = 0; x < SX; x++) {
        const continent = n1.fbm(x * 0.008, z * 0.008, 4);   // 大陆起伏
        const hills = n2.fbm(x * 0.035, z * 0.035, 4);       // 丘陵细节
        let h = Math.round(26 + continent * 9 + hills * 5);
        if (h < 3) h = 3;
        if (h > SY - 8) h = SY - 8;
        heights[x + z * SX] = h;
      }
    }

    // 2. 填充列
    for (let z = 0; z < SZ; z++) {
      for (let x = 0; x < SX; x++) {
        const h = heights[x + z * SX];
        for (let y = 0; y <= h; y++) {
          let id;
          if (y === 0) id = BLOCK.BEDROCK;
          else if (y <= 2 + ((x * 31 + z * 17) % 2)) id = BLOCK.BEDROCK; // 1~3 层基岩
          else if (y < h - 3) id = BLOCK.STONE;
          else if (y < h) id = (h <= WL) ? BLOCK.SAND : BLOCK.DIRT;
          else {
            // 顶块
            if (h <= WL) id = BLOCK.SAND;                 // 水下/沙滩
            else if (h >= 40) id = BLOCK.SNOW;            // 雪顶
            else id = BLOCK.GRASS;
          }
          this.blocks[this.idx(x, y, z)] = id;
        }
        // 3. 水
        if (h < WL) {
          for (let y = h + 1; y <= WL; y++)
            this.blocks[this.idx(x, y, z)] = BLOCK.WATER;
        }
      }
    }

    // 4. 树木（只在草方块上，确定性分布）
    for (let z = 2; z < SZ - 2; z++) {
      for (let x = 2; x < SX - 2; x++) {
        const h = heights[x + z * SX];
        if (this.get(x, h, z) !== BLOCK.GRASS) continue;
        // 哈希决定是否种树（约 0.7% 的草方块）
        const hx = Math.imul(x, 374761393) + Math.imul(z, 668265263) + seed;
        const hz = (hx ^ (hx >>> 13)) >>> 0;
        if (hz % 1000 > 7) continue;
        this.plantTree(x, h, z, 4 + (hz % 3)); // 树干高 4~6
      }
    }

    this.version++;
  }

  plantTree(x, baseY, z, trunkH) {
    const top = baseY + trunkH;
    if (top + 3 >= this.SY) return;
    // 树干
    for (let y = baseY + 1; y <= top; y++) this.set(x, y, z, BLOCK.LOG);
    // 树冠：倒数两层半径 2，再上一层半径 1，顶上一片
    for (let dy = -2; dy <= 0; dy++) {
      const r = dy < -1 ? 1 : 2;
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) {
          if (dx === 0 && dz === 0 && dy < 0) continue;      // 树干位置
          if (Math.abs(dx) === r && Math.abs(dz) === r && (dx + dz) % 2 !== 0) continue; // 削角
          const y = top + dy;
          if (this.get(x + dx, y, z + dz) === BLOCK.AIR)
            this.set(x + dx, y, z + dz, BLOCK.LEAVES);
        }
    }
    this.set(x, top + 1, z, BLOCK.LEAVES);
    this.set(x + 1, top + 1, z, BLOCK.LEAVES);
    this.set(x - 1, top + 1, z, BLOCK.LEAVES);
    this.set(x, top + 1, z + 1, BLOCK.LEAVES);
    this.set(x, top + 1, z - 1, BLOCK.LEAVES);
  }

  // 找到玩家出生点（世界中心附近的草方块/沙，不在水下）
  findSpawn() {
    const cx = Math.floor(this.SX / 2), cz = Math.floor(this.SZ / 2);
    for (let r = 0; r < 20; r++) {
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = cx + dx, z = cz + dz;
          if (!this.inBounds(x, 0, z)) continue;
          for (let y = this.SY - 2; y > 1; y--) {
            const b = this.get(x, y, z);
            if (b === BLOCK.AIR && (this.get(x, y - 1, z) === BLOCK.GRASS ||
                this.get(x, y - 1, z) === BLOCK.SAND)) {
              return { x: x + 0.5, y: y + 0.01, z: z + 0.5 };
            }
          }
        }
    }
    return { x: cx + 0.5, y: this.SY - 10, z: cz + 0.5 };
  }
}
