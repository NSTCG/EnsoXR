// MeshPaintable.ts (patched)
// (same imports as before)
import {
  Component,
  Texture,
  Material,
  MeshAttribute,
  MeshAttributeAccessor,
  Mesh,
} from '@wonderlandengine/api';
import { property } from '@wonderlandengine/api/decorators.js';

/**
 * MeshPaintable - patched:
 *  - assigns canvasTexture to multiple material slots (avoid slot mismatch)
 *  - attempts to set wrap/clamp to prevent tiling
 *  - clamps UVs to [0,1] before painting
 *  - optional visual dot on each paint (markPaintOnCanvas)
 *  - optional debug logging (debugPaintLog)
 */
export class MeshPaintable extends Component {
  static TypeName = 'mesh-paintable';

  @property.material()
  material: Material | null = null;

  @property.int(1024)
  textureWidth = 1024;

  @property.int(1024)
  textureHeight = 1024;

  @property.color(1, 1, 1, 1)
  initialColor: [number, number, number, number] = [1, 1, 1, 1];

  @property.bool(true)
  flipY = true;

  @property.bool(false)
  showUvDebug = false;

  @property.bool(true)
  planarFallback = true;

  // NEW: show small magenta mark on canvas at computed UV each paint (helps debug when UV debug is OFF)
  @property.bool(true)
  markPaintOnCanvas = true;

  // NEW: verbose per-paint logging
  @property.bool(false)
  debugPaintLog = false;

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private canvasTexture!: Texture;
  private created = false;

  // cached mesh arrays
  private _meshRef: Mesh | null = null;
  private _positionsFlat: Float32Array | null = null;
  private _uvsFlat: Float32Array | null = null;
  private _triIndices: Int32Array | null = null;
  private _triMin: Float32Array | null = null;
  private _triMax: Float32Array | null = null;
  private _triAreas: Float32Array | null = null;
  private _triCum: Float32Array | null = null;
  private _triCount = 0;
  private _triTotalArea = 0;

  private _tmpP0 = new Float32Array(3);
  private _tmpP1 = new Float32Array(3);
  private _tmpP2 = new Float32Array(3);

  start(): void {
    const meshComp = this.object.getComponent('mesh');
    if (!meshComp || !meshComp.mesh) {
      console.warn('mesh-paintable: no mesh component found on object');
      return;
    }

    const mesh = meshComp.mesh;
    this._meshRef = mesh;

    // canvas
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.textureWidth;
    this.canvas.height = this.textureHeight;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      console.error('mesh-paintable: failed to get 2D context');
      return;
    }
    this.ctx = ctx;

    // fill initial background
    const c = this.initialColor;
    this.ctx.fillStyle = `rgba(${Math.round(c[0] * 255)}, ${Math.round(
      c[1] * 255,
    )}, ${Math.round(c[2] * 255)}, ${c[3]})`;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.showUvDebug) this.drawUvDebug();

    // create engine texture
    this.canvasTexture = this.engine.textures.create(this.canvas);

    // assign to material (attempt multiple common slots) - FIX #1
    if (!this.material) {
      try {
        this.material = (meshComp as any).material?.clone?.() ?? null;
      } catch {
        this.material = null;
      }
    }
    if (this.material) {
      try {
        // try preferred API
        if ((this.material as any).setDiffuseTexture) {
          (this.material as any).setDiffuseTexture(this.canvasTexture);
        }
      } catch (e) {
        // ignore
      }
      // also try assigning a bunch of common slots so we don't miss the one the shader uses

      try {
        (this.material as any).albedoTexture = this.canvasTexture;
      } catch {}
      try {
        (this.material as any).diffuseTexture = this.canvasTexture;
      } catch {}
      try {
        (this.material as any).flatTexture = this.canvasTexture;
      } catch {}

      // NOTE: some material systems use named uniforms etc. We attempt common names so the shader sees our canvas.
    }

    // try to set wrap/clamp so UVs outside 0..1 don't tile - FIX #2 (best-effort)
    try {
      const texAny: any = this.canvasTexture as any;
      // different WLE versions expose different APIs — try common ones
      if (typeof texAny.setWrap === 'function') {
        // enum constants may be on engine.textures; try them (best-effort)
        const wrapClamp =
          (this.engine as any).TEXTURE_WRAP_CLAMP_TO_EDGE ?? 33071;
        texAny.setWrap(wrapClamp, wrapClamp);
      } else {
        // try properties
        if ('wrapS' in texAny)
          texAny.wrapS = texAny.WRAP_CLAMP_TO_EDGE ?? 33071;
        if ('wrapT' in texAny)
          texAny.wrapT = texAny.WRAP_CLAMP_TO_EDGE ?? 33071;
      }
    } catch (e) {
      // not critical — some runtimes don't expose wrap controls
    }

    // set material back to meshComp (unique)
    try {
      (meshComp as any).material = this.material;
    } catch {}

    this.created = true;

    // build caches
    this._buildMeshCaches(mesh);
  }

  private _buildMeshCaches(mesh: Mesh) {
    const posAttr: MeshAttributeAccessor | null =
      mesh.attribute(MeshAttribute.Position) ?? null;
    const uvAttr: MeshAttributeAccessor | null =
      mesh.attribute(MeshAttribute.TextureCoordinate) ?? null;
    const indices: Int32Array | null = mesh.indexData ?? null;

    if (!posAttr) {
      console.warn('mesh-paintable: mesh missing Position attribute');
      return;
    }

    const vertexCount = posAttr.length;
    const positionsFlat = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i++) {
      posAttr.get(i, positionsFlat.subarray(i * 3, i * 3 + 3));
    }
    this._positionsFlat = positionsFlat;

    if (uvAttr) {
      const uvsFlat = new Float32Array(vertexCount * 2);
      for (let i = 0; i < vertexCount; i++) {
        uvAttr.get(i, uvsFlat.subarray(i * 2, i * 2 + 2));
      }
      this._uvsFlat = uvsFlat;
    } else {
      this._uvsFlat = null;
      if (!this.planarFallback) {
        console.warn(
          'mesh-paintable: mesh missing UVs and planarFallback disabled',
        );
      } else {
        console.warn(
          'mesh-paintable: mesh missing UVs — using planar fallback',
        );
      }
    }

    let triCount = 0;
    let triIndices: Int32Array;
    if (indices && indices.length > 0) {
      triCount = indices.length / 3;
      triIndices = new Int32Array(indices.length);
      triIndices.set(indices);
    } else {
      triCount = vertexCount / 3;
      triIndices = new Int32Array(triCount * 3);
      for (let t = 0; t < triCount; t++) {
        triIndices[t * 3 + 0] = t * 3 + 0;
        triIndices[t * 3 + 1] = t * 3 + 1;
        triIndices[t * 3 + 2] = t * 3 + 2;
      }
    }

    this._triCount = triCount;
    this._triIndices = triIndices;

    const triMin = new Float32Array(triCount * 3);
    const triMax = new Float32Array(triCount * 3);
    const triAreas = new Float32Array(triCount);
    let totalArea = 0;
    const tmp0 = this._tmpP0,
      tmp1 = this._tmpP1,
      tmp2 = this._tmpP2;

    for (let t = 0; t < triCount; t++) {
      const i0 = triIndices[t * 3 + 0],
        i1 = triIndices[t * 3 + 1],
        i2 = triIndices[t * 3 + 2];

      tmp0[0] = positionsFlat[i0 * 3 + 0];
      tmp0[1] = positionsFlat[i0 * 3 + 1];
      tmp0[2] = positionsFlat[i0 * 3 + 2];
      tmp1[0] = positionsFlat[i1 * 3 + 0];
      tmp1[1] = positionsFlat[i1 * 3 + 1];
      tmp1[2] = positionsFlat[i1 * 3 + 2];
      tmp2[0] = positionsFlat[i2 * 3 + 0];
      tmp2[1] = positionsFlat[i2 * 3 + 1];
      tmp2[2] = positionsFlat[i2 * 3 + 2];

      triMin[t * 3 + 0] = Math.min(tmp0[0], tmp1[0], tmp2[0]);
      triMin[t * 3 + 1] = Math.min(tmp0[1], tmp1[1], tmp2[1]);
      triMin[t * 3 + 2] = Math.min(tmp0[2], tmp1[2], tmp2[2]);

      triMax[t * 3 + 0] = Math.max(tmp0[0], tmp1[0], tmp2[0]);
      triMax[t * 3 + 1] = Math.max(tmp0[1], tmp1[1], tmp2[1]);
      triMax[t * 3 + 2] = Math.max(tmp0[2], tmp1[2], tmp2[2]);

      const abx = tmp1[0] - tmp0[0],
        aby = tmp1[1] - tmp0[1],
        abz = tmp1[2] - tmp0[2];
      const acx = tmp2[0] - tmp0[0],
        acy = tmp2[1] - tmp0[1],
        acz = tmp2[2] - tmp0[2];
      const cx = aby * acz - abz * acy;
      const cy = abz * acx - abx * acz;
      const cz = abx * acy - aby * acx;
      const area = 0.5 * Math.hypot(cx, cy, cz);
      triAreas[t] = area;
      totalArea += area;
    }

    const triCum = new Float32Array(triCount + 1);
    let cum = 0;
    for (let t = 0; t < triCount; t++) {
      triCum[t] = cum;
      cum += triAreas[t];
    }
    triCum[triCount] = cum;

    this._triMin = triMin;
    this._triMax = triMax;
    this._triAreas = triAreas;
    this._triCum = triCum;
    this._triTotalArea = cum;
  }

  getUVFromLocalRay(
    localOrigin: Float32Array,
    localDir: Float32Array,
    maxDistance = Infinity,
  ): {
    uv: [number, number];
    triIndex: number;
    localHit: [number, number, number];
  } | null {
    const positions = this._positionsFlat;
    const triIndices = this._triIndices;
    const triMin = this._triMin;
    const triMax = this._triMax;
    const triCount = this._triCount;

    if (!positions || !triIndices || !triMin || !triMax) return null;

    const localEnd = new Float32Array(3);
    localEnd[0] = localOrigin[0] + localDir[0] * maxDistance;
    localEnd[1] = localOrigin[1] + localDir[1] * maxDistance;
    localEnd[2] = localOrigin[2] + localDir[2] * maxDistance;

    const rayMinX = Math.min(localOrigin[0], localEnd[0]);
    const rayMinY = Math.min(localOrigin[1], localEnd[1]);
    const rayMinZ = Math.min(localOrigin[2], localEnd[2]);
    const rayMaxX = Math.max(localOrigin[0], localEnd[0]);
    const rayMaxY = Math.max(localOrigin[1], localEnd[1]);
    const rayMaxZ = Math.max(localOrigin[2], localEnd[2]);

    let closestT = Infinity;
    let bestTri: number | null = null;
    let bestU = 0,
      bestV = 0;
    let bestLocalHit: Float32Array | null = null;
    const p0 = this._tmpP0,
      p1 = this._tmpP1,
      p2 = this._tmpP2;

    for (let t = 0; t < triCount; t++) {
      const minX = triMin[t * 3 + 0],
        minY = triMin[t * 3 + 1],
        minZ = triMin[t * 3 + 2];
      const maxX = triMax[t * 3 + 0],
        maxY = triMax[t * 3 + 1],
        maxZ = triMax[t * 3 + 2];

      if (
        maxX < rayMinX ||
        minX > rayMaxX ||
        maxY < rayMinY ||
        minY > rayMaxY ||
        maxZ < rayMinZ ||
        minZ > rayMaxZ
      ) {
        continue;
      }

      const vi0 = triIndices[t * 3 + 0],
        vi1 = triIndices[t * 3 + 1],
        vi2 = triIndices[t * 3 + 2];

      p0[0] = positions[vi0 * 3 + 0];
      p0[1] = positions[vi0 * 3 + 1];
      p0[2] = positions[vi0 * 3 + 2];
      p1[0] = positions[vi1 * 3 + 0];
      p1[1] = positions[vi1 * 3 + 1];
      p1[2] = positions[vi1 * 3 + 2];
      p2[0] = positions[vi2 * 3 + 0];
      p2[1] = positions[vi2 * 3 + 1];
      p2[2] = positions[vi2 * 3 + 2];

      const hit = rayTriangleIntersectMollerTrumbore(
        localOrigin,
        localDir,
        p0,
        p1,
        p2,
      );
      if (hit && hit.t > 1e-6 && hit.t < closestT && hit.t <= maxDistance) {
        closestT = hit.t;
        bestTri = t;
        bestU = hit.u;
        bestV = hit.v;
        bestLocalHit = new Float32Array([
          localOrigin[0] + localDir[0] * hit.t,
          localOrigin[1] + localDir[1] * hit.t,
          localOrigin[2] + localDir[2] * hit.t,
        ]);
      }
    }

    if (bestTri === null || !bestLocalHit) return null;

    // interpolate UVs or fallback planar
    if (this._uvsFlat) {
      const vi0 = triIndices[bestTri * 3 + 0],
        vi1 = triIndices[bestTri * 3 + 1],
        vi2 = triIndices[bestTri * 3 + 2];

      const u0 = this._uvsFlat[vi0 * 2 + 0],
        v0 = this._uvsFlat[vi0 * 2 + 1];
      const u1 = this._uvsFlat[vi1 * 2 + 0],
        v1 = this._uvsFlat[vi1 * 2 + 1];
      const u2 = this._uvsFlat[vi2 * 2 + 0],
        v2 = this._uvsFlat[vi2 * 2 + 1];

      const w0 = 1 - bestU - bestV;
      const w1 = bestU;
      const w2 = bestV;

      let finalU = w0 * u0 + w1 * u1 + w2 * u2;
      let finalV = w0 * v0 + w1 * v1 + w2 * v2;

      // CLAMP UVs to [0,1] to prevent runaway values (FIX #3)
      finalU = Math.min(Math.max(finalU, 0), 1);
      finalV = Math.min(Math.max(finalV, 0), 1);

      if (this.debugPaintLog) {
        console.log('paint hit:', {
          tri: bestTri,
          vi0,
          vi1,
          vi2,
          uv0: [u0, v0],
          uv1: [u1, v1],
          uv2: [u2, v2],
          finalUV: [finalU, finalV],
          localHit: bestLocalHit,
        });
      }

      return {
        uv: [finalU, finalV],
        triIndex: bestTri,
        localHit: [bestLocalHit[0], bestLocalHit[1], bestLocalHit[2]],
      };
    } else if (this.planarFallback) {
      // compute mesh AABB once cheaply using positions array
      let minX = Infinity,
        minZ = Infinity,
        maxX = -Infinity,
        maxZ = -Infinity;
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i],
          z = positions[i + 2];
        if (x < minX) minX = x;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (z > maxZ) maxZ = z;
      }
      const denomX = maxX - minX || 1;
      const denomZ = maxZ - minZ || 1;
      let u = (bestLocalHit[0] - minX) / denomX;
      let v = (bestLocalHit[2] - minZ) / denomZ;
      u = Math.min(Math.max(u, 0), 1);
      v = Math.min(Math.max(v, 0), 1);
      return {
        uv: [u, v],
        triIndex: bestTri,
        localHit: [bestLocalHit[0], bestLocalHit[1], bestLocalHit[2]],
      };
    }

    return null;
  }

  paintAtUV(
    u: number,
    v: number,
    radiusPx = 8,
    colorRGBA: [number, number, number, number] = [0, 0, 0, 1],
  ) {
    if (!this.created) return;

    // ensure u,v in 0..1 - FIX #3
    const cu = Math.min(Math.max(u, 0), 1);
    const cv = Math.min(Math.max(v, 0), 1);

    const x = Math.floor(cu * this.canvas.width);
    const y = Math.floor((this.flipY ? 1 - cv : cv) * this.canvas.height);

    this.ctx.beginPath();
    this.ctx.fillStyle = `rgba(${Math.round(
      colorRGBA[0] * 255,
    )},${Math.round(colorRGBA[1] * 255)},${Math.round(
      colorRGBA[2] * 255,
    )},${colorRGBA[3]})`;
    this.ctx.arc(x, y, radiusPx, 0, Math.PI * 2);
    this.ctx.fill();

    // optional: show small magenta dot to visualize exact UV location even when showUvDebug is off (FIX #4)
    if (this.markPaintOnCanvas) {
      this.ctx.beginPath();
      this.ctx.fillStyle = 'magenta';
      this.ctx.arc(
        x,
        y,
        Math.max(2, Math.floor(radiusPx * 0.4)),
        0,
        Math.PI * 2,
      );
      this.ctx.fill();
    }

    // update texture
    this.canvasTexture.update();
  }

  getCanvasSize() {
    return { width: this.canvas.width, height: this.canvas.height };
  }

  private drawUvDebug() {
    const ctx = this.ctx;
    const w = this.canvas.width,
      h = this.canvas.height;
    const size = 32;
    for (let y = 0; y < h; y += size) {
      for (let x = 0; x < w; x += size) {
        const even = (((x / size) | 0) + ((y / size) | 0)) % 2 === 0;
        ctx.fillStyle = even ? 'rgba(200,200,200,0.9)' : 'rgba(80,80,80,0.9)';
        ctx.fillRect(x, y, size, size);
      }
    }

    const img = ctx.createImageData(w, h);
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const i = (yy * w + xx) * 4;
        img.data[i + 0] = Math.round((xx / (w - 1)) * 255);
        img.data[i + 1] = Math.round((yy / (h - 1)) * 255);
        img.data[i + 2] = 128;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.canvasTexture.update();
  }
}

/* Möller-Trumbore (unchanged) */
function rayTriangleIntersectMollerTrumbore(
  orig: Float32Array,
  dir: Float32Array,
  p0: Float32Array,
  p1: Float32Array,
  p2: Float32Array,
) {
  const EPS = 1e-8;
  const edge1x = p1[0] - p0[0],
    edge1y = p1[1] - p0[1],
    edge1z = p1[2] - p0[2];
  const edge2x = p2[0] - p0[0],
    edge2y = p2[1] - p0[1],
    edge2z = p2[2] - p0[2];

  const px = dir[1] * edge2z - dir[2] * edge2y;
  const py = dir[2] * edge2x - dir[0] * edge2z;
  const pz = dir[0] * edge2y - dir[1] * edge2x;

  const det = edge1x * px + edge1y * py + edge1z * pz;
  if (det > -EPS && det < EPS) return null;
  const invDet = 1 / det;

  const tx = orig[0] - p0[0],
    ty = orig[1] - p0[1],
    tz = orig[2] - p0[2];
  const u = (tx * px + ty * py + tz * pz) * invDet;
  if (u < 0 || u > 1) return null;

  const qx = ty * edge1z - tz * edge1y;
  const qy = tz * edge1x - tx * edge1z;
  const qz = tx * edge1y - ty * edge1x;

  const v = (dir[0] * qx + dir[1] * qy + dir[2] * qz) * invDet;
  if (v < 0 || u + v > 1) return null;

  const t = (edge2x * qx + edge2y * qy + edge2z * qz) * invDet;
  if (t <= EPS) return null;
  return { t, u, v };
}
