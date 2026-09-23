// 玩家物理：AABB 碰撞（逐轴分离）、原版重力/跳跃/移动参数
import * as THREE from 'three';
import { BLOCK, BLOCK_DEFS, PLAYER, JUMP_VY } from './constants.js';

export class Player {
  constructor(world) {
    this.world = world;
    this.pos = new THREE.Vector3();      // 脚底中心
    this.prevPos = new THREE.Vector3();  // 上一步位置（渲染插值用）
    this.alpha = 0;                      // 两次物理步之间的插值系数
    this.vel = new THREE.Vector3();
    this.onGround = false;
    this.inWater = false;
    this.flying = false;
    this.tickAcc = 0;      // 跨帧累积到 1 tick（1/20s）才施加一次重力 Δv
    // 每 tick 的垂直控制意图（由主循环按按键设置）
    this.flyUp = false;    // 飞行：Space 上升
    this.flyDown = false;  // 飞行：Shift 下降
    this.swimUp = false;   // 游泳：Space 上浮
    this.swimDown = false; // 游泳：Shift 下潜
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
    const speed = this.flying ? PLAYER.FLY_SPEED
      : (sprint ? PLAYER.SPRINT_SPEED : PLAYER.WALK_SPEED);
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

  // 原版创造模式飞行（minecraft.wiki）：双击跳跃键切换飞行，
  // 飞行中跳跃键上升、潜行键下降，水平移速约 10 blocks/s；再双击关闭
  setFlying(v) {
    if (this.flying === v) return;
    this.flying = v;
    if (v) this.vel.y = 0; // 进入飞行时清掉下坠速度
  }

  update(dt) {
    const TICK = 1 / PLAYER.TICK_RATE;
    // 记录上一步位置，供渲染插值（物理只有 20Hz，插值后画面才顺滑）
    this.prevPos.copy(this.pos);

    // 固定 20Hz 步进：每个 tick 内「施加一次 Δv」+「按 1/20s 积分位移」，
    // 二者绑定，物理结果与显示器帧率完全无关（原版就是 20 ticks/s）。
    // 关键：余额不足一个 tick 时不要另外积分位移 —— 否则该 tick 的位移
    // 会被算两次，帧率越高重复越多（表现为帧率越高跳得越高）。
    this.tickAcc += Math.min(dt, 0.25);
    let n = 0;
    while (this.tickAcc >= TICK - 1e-9 && n < 5) {
      this.tickAcc -= TICK;
      this.tick(TICK);
      n++;
    }
    // 本帧没跑物理步进时，插值无意义，令前后位置一致
    if (n === 0) this.prevPos.copy(this.pos);
    this.alpha = Math.min(this.tickAcc / TICK, 1);
  }

  // 渲染用插值位置：在前后两个物理步之间线性插值
  renderPos(out) {
    return out.set(
      this.prevPos.x + (this.pos.x - this.prevPos.x) * this.alpha,
      this.prevPos.y + (this.pos.y - this.prevPos.y) * this.alpha,
      this.prevPos.z + (this.pos.z - this.prevPos.z) * this.alpha,
    );
  }

  // 单个物理 tick：先按模式施加垂直 Δv，再积分位移，最后更新水体状态
  tick(dt) {
    if (this.flying) {
      // 创造模式飞行：不受重力；Space 上升 / Shift 下降 / 不按键=平飞
      if (this.flyUp) this.vel.y = Math.min(this.vel.y + 0.6, PLAYER.FLY_VERTICAL_SPEED);
      else if (this.flyDown) this.vel.y = Math.max(this.vel.y - 0.6, -PLAYER.FLY_VERTICAL_SPEED);
      else this.vel.y = 0;
    } else if (this.inWater) {
      // 游泳（原版）：Space 上浮、Shift 下潜；无输入时缓慢下沉
      if (this.swimUp) this.vel.y = Math.min(this.vel.y + 0.4, 3.6);
      else if (this.swimDown) this.vel.y = Math.max(this.vel.y - 0.4, -3.0);
      else {
        this.vel.y -= 0.01;              // 水中重力约为空气的 1/8
        this.vel.y *= 0.9;
        this.vel.y = Math.max(this.vel.y, -0.4);
      }
    } else {
      // vel 单位是 blocks/s：每 tick 速度变化 = 0.08 blocks/tick² × 20 = 1.6
      // （旧代码直接减 0.08，等效重力只有原版的 1/20，跳得又高又飘）
      this.vel.y -= PLAYER.GRAVITY_PER_TICK * PLAYER.TICK_RATE;
      this.vel.y *= PLAYER.TERMINAL_DAMPING;
    }

    // 位移按长度细分，保证终端速度（约 78 格/秒）下也不穿透 1 格厚的方块
    const maxMove = Math.max(Math.abs(this.vel.x), Math.abs(this.vel.y), Math.abs(this.vel.z)) * dt;
    const sub = Math.max(1, Math.min(16, Math.ceil(maxMove / 0.4)));
    const sdt = dt / sub;
    this.onGround = false;
    for (let i = 0; i < sub; i++) {
      this.moveAxis('y', this.vel.y * sdt);
      this.moveAxis('x', this.vel.x * sdt);
      this.moveAxis('z', this.vel.z * sdt);
    }

    // 水中状态检测：脚底格或身体中段任一在水体中即算"在水中"（原版按身体盒
    // 与水体相交判定）。若只看中段，脚还在水里就切到空气物理，重力把人拽回
    // 水中，形成上蹿下跳的振荡
    const fx = Math.floor(this.pos.x), fz = Math.floor(this.pos.z);
    const feet = this.world.get(fx, Math.floor(this.pos.y), fz);
    const mid = this.world.get(fx, Math.floor(this.pos.y + 0.5), fz);
    const wasInWater = this.inWater;
    this.inWater = feet === BLOCK.WATER || mid === BLOCK.WATER;
    // 完全离开水体时清零垂直速度（游泳惯性不保留到空中）
    if (wasInWater && !this.inWater) this.vel.y = 0;
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
