// 昼夜循环：完整一天 20 分钟（原版 24000 ticks）
// 太阳/月亮绕天球旋转，天空/雾/光照随之渐变
import * as THREE from 'three';
import { DAY_CYCLE } from './constants.js';

// 颜色关键帧：t ∈ [0,1) 一天中的进度
// 原版映射（minecraft.wiki）：日出 tick 0=游戏内 0:00，日落 tick 12000=12:00，
// 夜晚 13000=13:00，黎明 23000=23:00 → 太阳高度 = sin(t × 2π)，白天在 t∈[0,0.5)
const SKY_STOPS = [
  { t: 0.00, sky: 0x8fb8d8, sun: 0.25, fog: 0xc8dce8 },  // 日出 (0:00)
  { t: 0.10, sky: 0x9fd4f5, sun: 0.9,  fog: 0xcfe8f8 },
  { t: 0.25, sky: 0x8fd3ff, sun: 1.0,  fog: 0xcfe8f8 },  // 太阳最高 (6:00)
  { t: 0.45, sky: 0x9fd4f5, sun: 0.9,  fog: 0xcfe8f8 },
  { t: 0.52, sky: 0xf2a15f, sun: 0.55, fog: 0xd8b08a },  // 日落 (12:00)
  { t: 0.60, sky: 0x3a2f4d, sun: 0.12, fog: 0x4a4058 },  // 黄昏
  { t: 0.75, sky: 0x0b1026, sun: 0.05, fog: 0x141a30 },  // 午夜 (18:00)
  { t: 0.92, sky: 0x3a2f4d, sun: 0.12, fog: 0x4a4058 },  // 黎明前 (22:00)
  { t: 1.00, sky: 0x8fb8d8, sun: 0.25, fog: 0xc8dce8 },  // 回到日出
];

export class DayCycle {
  constructor(scene) {
    this.scene = scene;
    this.t = DAY_CYCLE.START; // 一天中的进度
    this.skyColor = new THREE.Color();
    this.fogColor = new THREE.Color();
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.position.set(50, 80, 30);
    scene.add(this.sun);
    scene.add(this.sun.target); // target 每帧指向玩家，保证光照方向正确
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    this.ambient = scene.children[scene.children.length - 1];
    // 雾距离收紧：96 格世界里 near=30/far=90 会让大半场景雾化、
    // 看起来像半透明方块；15/45 保证近处清晰、远处自然淡出
    scene.fog = new THREE.Fog(0xcfe8f8, 15, 45);
    // 太阳/月亮指示球
    this.orb = new THREE.Mesh(
      new THREE.SphereGeometry(3, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffdd66, fog: false })
    );
    scene.add(this.orb);
    this.moon = new THREE.Mesh(
      new THREE.SphereGeometry(2, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xd8e0f0, fog: false })
    );
    scene.add(this.moon);
  }

  update(dt) {
    this.t = (this.t + dt / DAY_CYCLE.SECONDS) % 1;
    const [sky, sunI, fog] = this.sample(this.t);
    this.skyColor.setHex(sky);
    this.fogColor.setHex(fog);
    this.scene.background = this.skyColor;
    this.scene.fog.color.copy(this.fogColor);
    this.sun.intensity = 0.05 + sunI * 1.0;
    this.ambient.intensity = 0.12 + sunI * 0.42;

    // 太阳角度：t=0 日出（地平线东），t=0.25 正午（天顶），t=0.5 日落（西）
    const ang = this.t * Math.PI * 2;
    const R = 120;
    this.sun.position.set(Math.cos(ang) * R, Math.sin(ang) * R, 30);
    this.orb.position.set(Math.cos(ang) * R, Math.sin(ang) * R, 30);
    this.orb.visible = Math.sin(ang) > -0.15;
    this.moon.position.set(-Math.cos(ang) * R, -Math.sin(ang) * R, 30);
    this.moon.visible = Math.sin(ang) < 0.15;
  }

  // 在关键帧之间线性插值
  sample(t) {
    for (let i = 0; i < SKY_STOPS.length - 1; i++) {
      const a = SKY_STOPS[i], b = SKY_STOPS[i + 1];
      if (t >= a.t && t < b.t) {
        const f = (t - a.t) / (b.t - a.t);
        return [
          lerpColor(a.sky, b.sky, f),
          a.sun + (b.sun - a.sun) * f,
          lerpColor(a.fog, b.fog, f),
        ];
      }
    }
    const last = SKY_STOPS[SKY_STOPS.length - 1];
    return [last.sky, last.sun, last.fog];
  }

  // 原版：夜晚 = 游戏内 13:00 ~ 23:00（游戏时间 = t × 48）
  get isNight() { const gt = this.t * 48; return gt >= 13 && gt < 23; }
}

function lerpColor(h1, h2, f) {
  const c1 = new THREE.Color(h1), c2 = new THREE.Color(h2);
  const r = Math.round((c1.r + (c2.r - c1.r) * f) * 255);
  const g = Math.round((c1.g + (c2.g - c1.g) * f) * 255);
  const b = Math.round((c1.b + (c2.b - c1.b) * f) * 255);
  return (r << 16) | (g << 8) | b;
}
