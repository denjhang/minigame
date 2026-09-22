// 体素 DDA 射线遍历（Amanatides & Woo 1987）
// 从 origin 沿 dir 前进，返回命中的体素及其入射面法线（即“点击的方块面”）
import { BLOCK } from './constants.js';

export function raycastVoxel(world, origin, dir, maxDist = 5) {
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  const stepX = dir.x > 0 ? 1 : -1;
  const stepY = dir.y > 0 ? 1 : -1;
  const stepZ = dir.z > 0 ? 1 : -1;

  const tDeltaX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;

  // 到各轴格面的距离
  const distX = dir.x > 0 ? (x + 1 - origin.x) : (origin.x - x);
  const distY = dir.y > 0 ? (y + 1 - origin.y) : (origin.y - y);
  const distZ = dir.z > 0 ? (z + 1 - origin.z) : (origin.z - z);
  let tMaxX = tDeltaX === Infinity ? Infinity : distX * tDeltaX;
  let tMaxY = tDeltaY === Infinity ? Infinity : distY * tDeltaY;
  let tMaxZ = tDeltaZ === Infinity ? Infinity : distZ * tDeltaZ;

  let face = null; // 入射面法线
  let t = 0;

  while (t <= maxDist) {
    const id = world.get(x, y, z);
    if (id !== BLOCK.AIR && id !== BLOCK.WATER) {
      return { x, y, z, id, face, dist: t };
    }
    // 前进到下一个格面
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; t = tMaxX; tMaxX += tDeltaX; face = [-stepX, 0, 0];
    } else if (tMaxY < tMaxZ) {
      y += stepY; t = tMaxY; tMaxY += tDeltaY; face = [0, -stepY, 0];
    } else {
      z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; face = [0, 0, -stepZ];
    }
  }
  return null;
}
