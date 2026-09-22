// 玩家物理：AABB 碰撞（逐轴分离）、原版重力/跳跃/移动参数
import * as THREE from 'three';
import { BLOCK, BLOCK_DEFS, PLAYER, JUMP_VY } from './constants.js';

export class Player {
  constructor(world) {
    this.world = world;
    this.pos = new THREE.Vector3();      // 脚底中心
    this.vel = new THREE.Vector3();
    this.onGround = false;
    this.inWater = false;
  }

  // 某点是否处于实心方块内
  solidAt(x, y, z) {
    const b = this.world.get(Math.floor(x), Math.floor(y), Math.floor(z));
    return b !== BLOCK.AIR && BLOCK_DEFS[b].solid;
  }

  // AABB [minX..maxX] 等是否与任一实心方块相交
  boxCollides(px, py, pz) {
    const hw = PLAYER.HALF_WIDTH;
    const minX = px - hw, maxX = px + hw;
    const minY = py, maxY = py + PLAYER.HEIGHT;
    const minZ = pz - hw, maxZ = pz + hw;
    for (let x = Math.floor(minX); x <= Math.floor(maxX); x++)
      for (let y = Math.floor(minY); y <= Math.floor(maxY); y++)
        for (let z = Math.floor(minZ); z <= Math.floor(maxZ); z++) {
          if (this.solidAt(x + 0.5, y + 0.5, z + 0.5)) return true;
        }
    return false;
  }

  // 移动输入：forward/strafe ∈ [-1,1]（已含对角归一化），sprint 布尔
  input(forward, strafe, sprint, dt) {
    const speed = sprint ? PLAYER.SPRINT_SPEED : PLAYER.WALK_SPEED;
    // 朝向：yaw 为 0 时朝 -Z
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // 前方向 = (sin, 0, -cos)；右方向 = (cos, 0, sin)
    const vx = (forward * sin + strafe * cos) * speed;
    const vz = (-forward * cos + strafe * sin) * speed;
    this.vel.x = vx;
    this.vel.z = vz;
  }

  jump() {
    if (this.onGround) {
      this.vel.y = JUMP_VY;
      this.onGround = false;
    }
  }

  update(dt) {
    // 固定物理子步（≤1/20s），保证高速下坠也不穿透方块
    let remaining = Math.min(dt, 0.25);
    while (remaining > 1e-6) {
      const step = Math.min(remaining, 1 / PLAYER.TICK_RATE);
      this.physicsStep(step);
      remaining -= step;
    }
  }

  physicsStep(dt) {
    // ---- 重力（原版：每 tick 速度变化 0.08，终端 ×0.98；本引擎 +Y 向上，故向下为负）----
    if (this.inWater) {
      this.vel.y = Math.min(this.vel.y + 0.02, 0.25); // 水中缓慢下沉
    } else {
      this.vel.y -= PLAYER.GRAVITY_PER_TICK;
      this.vel.y *= PLAYER.TERMINAL_DAMPING;
    }

    this.onGround = false;
    this.moveAxis('y', this.vel.y * dt);
    this.moveAxis('x', this.vel.x * dt);
    this.moveAxis('z', this.vel.z * dt);

    // 水中状态检测（身体中段）
    const mid = this.world.get(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.5), Math.floor(this.pos.z));
    this.inWater = mid === BLOCK.WATER;
    if (this.inWater && !this.onGround && this.vel.y < 0) {
      this.vel.y = Math.max(this.vel.y, -0.2); // 水中下坠限速
    }
  }

  // 单轴移动 + 碰撞回退
  moveAxis(axis, delta) {
    if (delta === 0) return;
    const p = this.pos;
    p[axis] += delta;
    if (this.boxCollides(p.x, p.y, p.z)) {
      // 回退并贴齐方块面
      if (axis === 'y') {
        if (delta < 0) {
          // 落到方块顶：贴到 整数+1
          p.y = Math.floor(p.y) + 1 + 1e-4;
          this.onGround = true;
        } else {
          // 头顶撞方块：贴到 整数-身高
          p.y = Math.floor(p.y + PLAYER.HEIGHT) - PLAYER.HEIGHT - 1e-4;
        }
        this.vel.y = 0;
      } else {
        const dir = Math.sign(delta);
        // 沿轴回退到最近格面
        const hw = PLAYER.HALF_WIDTH;
        if (axis === 'x') {
          p.x = dir > 0
            ? Math.floor(p.x + hw) - hw - 1e-4
            : Math.floor(p.x - hw) + 1 + hw + 1e-4;
        } else {
          p.z = dir > 0
            ? Math.floor(p.z + hw) - hw - 1e-4
            : Math.floor(p.z - hw) + 1 + hw + 1e-4;
        }
        this.vel[axis] = 0;
      }
    }
  }
}
