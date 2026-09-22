// 区块网格化：只生成暴露在空气/透明方块前的面（面剔除），
// 每个面 2 三角形、4 角，顶点色烘焙 AO（环境光遮蔽）+ 方向明暗
import * as THREE from 'three';
import { BLOCK, BLOCK_DEFS } from './constants.js';
import { tileUV, TILE_INDEX } from './textures.js';

// 6 个面：normal、4 个角（顺序 c0,c1,c2,c3 构成 CCW 四边形，从面外看）、
// 是否顶/底面（决定纹理不翻转）
const FACES = [
  { n: [0, 1, 0],  c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], top: true },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 1], [0, 0, 1], [1, 0, 0]], top: true },
  { n: [1, 0, 0],  c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], top: false },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], top: false },
  { n: [0, 0, 1],  c: [[1, 0, 1], [0, 0, 1], [0, 1, 1], [1, 1, 1]], top: false },
  { n: [0, 0, -1], c: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], top: false },
];

// 面明暗（顶面最亮，侧面递减，底面最暗）
const FACE_SHADE = [1.0, 0.55, 0.8, 0.8, 0.7, 0.7];

// 角索引 → 该角在 3 个切向轴上的 AO 采样偏移
// 四边形 c0..c3 的切向：u 方向 = c1-c0 主轴，v 方向 = c3-c0 主轴
const AO_OFFSETS = [
  [[-1, 0], [0, -1]],  // c0
  [[1, 0], [0, -1]],   // c1
  [[1, 0], [0, 1]],    // c2
  [[-1, 0], [0, 1]],   // c3
];

// 切向轴：每个面，u 轴和 v 轴分别对应世界坐标哪个轴（+1/-1 为方向）
// u = c1-c0 的主轴，v = c3-c0 的主轴
function faceAxes(face) {
  const dx1 = face.c[1][0] - face.c[0][0];
  const dy1 = face.c[1][1] - face.c[0][1];
  const dz1 = face.c[1][2] - face.c[0][2];
  const axU = Math.abs(dx1) > 0 ? 0 : (Math.abs(dy1) > 0 ? 1 : 2);
  const sxU = [dx1, dy1, dz1][axU];
  const dx3 = face.c[3][0] - face.c[0][0];
  const dy3 = face.c[3][1] - face.c[0][1];
  const dz3 = face.c[3][2] - face.c[0][2];
  const axV = Math.abs(dx3) > 0 ? 0 : (Math.abs(dy3) > 0 ? 1 : 2);
  const sxV = [dx3, dy3, dz3][axV];
  return { axU, sxU, axV, sxV };
}

// AO 值：0,1,2,3 → 亮度
const AO_LIGHT = [0.45, 0.65, 0.85, 1.0];

// waterOnly=true 时只生成水面几何（用透明材质渲染），否则只生成不透明方块面
export function buildChunkGeometry(world, cx, cz, waterOnly = false) {
  const { SX, SZ, SY } = world;
  const x0 = cx * 16, z0 = cz * 16;
  const x1 = Math.min(x0 + 16, SX), z1 = Math.min(z0 + 16, SZ);

  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  const indices = [];

  const solidOpaque = (x, y, z) => {
    const b = world.getRaw(x, y, z);
    return b !== BLOCK.AIR && b !== BLOCK.WATER && BLOCK_DEFS[b].opaque;
  };

  for (let y = 0; y < SY; y++)
    for (let z = z0; z < z1; z++)
      for (let x = x0; x < x1; x++) {
        const id = world.get(x, y, z);
        if (id === BLOCK.AIR) continue;
        if (waterOnly ? id !== BLOCK.WATER : id === BLOCK.WATER) continue;
        const def = BLOCK_DEFS[id];
        if (!def.solid && id !== BLOCK.WATER) continue;

        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const nx = x + face.n[0], ny = y + face.n[1], nz = z + face.n[2];
          const nId = world.getRaw(nx, ny, nz);
          if (nId === BLOCK.AIR) {
            emitFace(x, y, z, id, f);
          } else if (BLOCK_DEFS[nId].opaque) {
            // 邻居不透明 → 面被完全遮挡，剔除
            continue;
          } else if (BLOCK_DEFS[id].opaque) {
            // 邻居透明（水/玻璃/树叶）而本方块不透明 → 画面
            emitFace(x, y, z, id, f);
          }
          // 其余情况（双方透明，如 水-水、玻璃-玻璃、树叶-树叶）剔除
        }
      }

  // ---------------- 单面发射 ----------------
  function emitFace(x, y, z, id, f) {
    const face = FACES[f];
    const def = BLOCK_DEFS[id];
    const nx = x + face.n[0], ny = y + face.n[1], nz = z + face.n[2];
    // 水面顶面降低 0.12（水不占满格）
    const isWaterTop = id === BLOCK.WATER && face.n[1] === 1;
    const page = def.faces[face.n[1] === 1 ? 0 : face.n[1] === -1 ? 1 : 2];
    const tile = tileUV(TILE_INDEX[page]);
    const base = isWaterTop ? 0.88 : 0;
    const verts = face.c.map(([cx2, cy2, cz2]) => [x + cx2, y + cy2 + base, z + cz2]);

    // 计算 4 角 AO
    const { axU, sxU, axV, sxV } = faceAxes(face);
    const ao = [0, 1, 2, 3].map((k) => {
      const [ou, ov] = AO_OFFSETS[k];
      const p = [nx, ny, nz];
      // 沿 u 轴偏移
      p[axU] += ou * sxU;
      const a = solidOpaque(p[0], p[1], p[2]) ? 1 : 0;
      p[axU] -= ou * sxU;
      // 沿 v 轴偏移
      p[axV] += ov * sxV;
      const b = solidOpaque(p[0], p[1], p[2]) ? 1 : 0;
      p[axV] -= ov * sxV;
      // 对角
      p[axU] += ou * sxU;
      p[axV] += ov * sxV;
      const c = solidOpaque(p[0], p[1], p[2]) ? 1 : 0;
      const corner = a + b + c;
      return (a && b) ? 0 : (3 - corner); // MC 规则：两邻同时遮挡=最暗，无遮挡=3（最亮）
    });

    // uv：c0 左下, c1 右下, c2 右上, c3 左上
    const shade = FACE_SHADE[f];
    const uvsFace = [
      [tile.u0, tile.vBot], [tile.u1, tile.vBot],
      [tile.u1, tile.vTop], [tile.u0, tile.vTop],
    ];
    const start = positions.length / 3;
    for (let k = 0; k < 4; k++) {
      positions.push(verts[k][0], verts[k][1], verts[k][2]);
      normals.push(face.n[0], face.n[1], face.n[2]);
      uvs.push(uvsFace[k][0], uvsFace[k][1]);
      const light = AO_LIGHT[ao[k]] * shade;
      colors.push(light, light, light);
    }
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }

  if (indices.length === 0) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  return geo;
}
