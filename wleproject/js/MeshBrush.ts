// MeshBrush.ts (proximity-only + color-pick-on-#hex-name)
import { Component } from '@wonderlandengine/api';
import { property } from '@wonderlandengine/api/decorators.js';
import { MeshPaintable } from './MeshPaintable.js';

/**
 * MeshBrush (proximity-only) with color-pick-on-#hex-name
 *
 * When a physics body's name contains a hex color like "#ff00aa" (or "#f0a"),
 * the brush will pick that color and call `onPickedColor(hex)` and will not paint this frame.
 */
export class MeshBrush extends Component {
  static TypeName = 'mesh-brush';

  @property.int(10)
  brushRadiusPx = 10;

  @property.color(0, 0, 0, 1)
  brushColor: [number, number, number, number] = [0, 0, 0, 1];

  // enable painting by proximity (touch-like)
  @property.bool(true)
  paintOnProximity = true;

  // world-space radius (meters) for proximity painting
  @property.float(0.05)
  brushWorldRadius = 0.05;

  @property.float(10.0)
  maxDistance = 10.0;

  // --- internal state ---
  private _lastUVPerObject = new Map<number, [number, number]>();
  private _lastTriPerObject = new Map<number, [number, number, number]>();
  private _contactLostPerObject = new Map<number, boolean>();

  // temp arrays
  private _worldOrigin = new Float32Array(3);
  private _worldDir = new Float32Array(3);
  private _worldEnd = new Float32Array(3);

  // reuse buffers to avoid allocations each frame
  private _maxRayHits = 8;
  private _hitLocations!: Float32Array[]; // preallocated Float32Array(3) entries
  private _hitObjectsTemp: any[] = [];

  start(): void {
    // prepare buffered storage for rayHit.getLocations
    this._hitLocations = new Array(this._maxRayHits);
    for (let i = 0; i < this._maxRayHits; i++) {
      this._hitLocations[i] = new Float32Array(3);
    }
  }

  update(_: number): void {
    // origin & dir from this object (brush tip)
    this.object.getPositionWorld(this._worldOrigin);
    this.object.getForwardWorld(this._worldDir);

    const rayHit = this.engine.physics.rayCast(
      this._worldOrigin,
      this._worldDir,
      -1,
      this.maxDistance,
    );

    // If no hit -> mark contact lost for tracked objects and return
    if (!rayHit || rayHit.hitCount === 0) {
      for (const key of this._lastUVPerObject.keys()) {
        this._contactLostPerObject.set(key, true);
      }
      return;
    }

    // ensure our prealloc can hold the hits
    const hitCount = Math.min(rayHit.hitCount, this._maxRayHits);
    if (hitCount > this._hitLocations.length) {
      const oldLen = this._hitLocations.length;
      for (let i = oldLen; i < hitCount; i++)
        this._hitLocations.push(new Float32Array(3));
    }

    // getLocations expects NumberArray[] (array of arrays)
    rayHit.getLocations(this._hitLocations);

    // getObjects returns an array of Object3D
    const objs = rayHit.getObjects(this._hitObjectsTemp);

    // use the first hit
    const hitWorldPosArr = this._hitLocations[0];
    const hitWorldPos = [
      hitWorldPosArr[0],
      hitWorldPosArr[1],
      hitWorldPosArr[2],
    ] as [number, number, number];
    const hitObj: any = objs[0];
    if (!hitObj) {
      // mark contact lost for tracked objects
      for (const key of this._lastUVPerObject.keys()) {
        this._contactLostPerObject.set(key, true);
      }
      return;
    }

    // If hit object's name contains a hex color (#RGB or #RRGGBB), pick color and early return
    const picked = this._tryPickColorFromName(hitObj.name);
    if (picked) {
      // Clear continuity for the object (picking color should not connect strokes)
      const objectId =
        typeof hitObj.objectId === 'number'
          ? hitObj.objectId
          : this._stableObjectId(hitObj);
      this._lastUVPerObject.delete(objectId);
      this._lastTriPerObject.delete(objectId);
      this._contactLostPerObject.set(objectId, true);
      // notify hook and early return (no painting this frame)
      this.onPickedColor(picked);
      return;
    }

    // try to find MeshPaintable on hit object
    const paintable: MeshPaintable = hitObj.getComponent(MeshPaintable);
    if (!paintable) {
      const maybeId = hitObj.objectId ?? null;
      if (maybeId !== null) this._contactLostPerObject.set(maybeId, true);
      return;
    }

    // Convert the world ray (origin, end) into object's local space
    this._worldEnd[0] =
      this._worldOrigin[0] + this._worldDir[0] * this.maxDistance;
    this._worldEnd[1] =
      this._worldOrigin[1] + this._worldDir[1] * this.maxDistance;
    this._worldEnd[2] =
      this._worldOrigin[2] + this._worldDir[2] * this.maxDistance;

    const localOrigin = new Float32Array(3);
    const localEnd = new Float32Array(3);
    hitObj.transformPointInverseWorld(localOrigin, this._worldOrigin);
    hitObj.transformPointInverseWorld(localEnd, this._worldEnd);

    const localDir = new Float32Array(3);
    localDir[0] = localEnd[0] - localOrigin[0];
    localDir[1] = localEnd[1] - localOrigin[1];
    localDir[2] = localEnd[2] - localOrigin[2];
    const len = Math.hypot(localDir[0], localDir[1], localDir[2]) || 1;
    localDir[0] /= len;
    localDir[1] /= len;
    localDir[2] /= len;

    // Ask paintable for UV and triangle index
    const uvResult = paintable.getUVFromLocalRay(
      localOrigin,
      localDir,
      this.maxDistance,
    );
    if (!uvResult) {
      const idNull = hitObj.objectId ?? null;
      if (idNull !== null) this._contactLostPerObject.set(idNull, true);
      return;
    }

    const uv: [number, number] = uvResult.uv;
    const triIndex = uvResult.triIndex;
    const canvasSize = paintable.getCanvasSize?.() ?? {
      width: 1024,
      height: 1024,
    };

    // object id (stable numeric fallback)
    const objectId =
      typeof hitObj.objectId === 'number'
        ? hitObj.objectId
        : this._stableObjectId(hitObj);

    // PROXIMITY: compute distance from brush tip (object position) to world hit pos
    const dx = this._worldOrigin[0] - hitWorldPos[0];
    const dy = this._worldOrigin[1] - hitWorldPos[1];
    const dz = this._worldOrigin[2] - hitWorldPos[2];
    const worldDist = Math.hypot(dx, dy, dz);

    // decide whether to paint this frame
    const withinRange = !this.paintOnProximity
      ? false
      : worldDist <= this.brushWorldRadius;
    if (!withinRange) {
      // out of proximity -> clear continuity for this object and return
      this._lastUVPerObject.delete(objectId);
      this._lastTriPerObject.delete(objectId);
      this._contactLostPerObject.set(objectId, true);
      return;
    }

    // If contact was lost previously for this object, forget last UV so stroke doesn't connect
    if (this._contactLostPerObject.get(objectId)) {
      this._lastUVPerObject.delete(objectId);
      this._lastTriPerObject.delete(objectId);
      this._contactLostPerObject.set(objectId, false);
    }

    // island-jump / interpolation logic
    const lastUV = this._lastUVPerObject.get(objectId) ?? null;
    const lastTri = this._lastTriPerObject.get(objectId) ?? null;

    let doInterpolate = false;
    if (lastUV && lastTri) {
      const lastTriArr = lastTri as [number, number, number];
      const currTriIndices = this._getTriangleVertexIndices(
        paintable,
        triIndex,
      );
      if (currTriIndices) {
        const [c0, c1, c2] = currTriIndices;
        const [l0, l1, l2] = lastTriArr;
        // allow interpolation when triangles share at least one vertex (adjacent)
        if (
          c0 === l0 ||
          c0 === l1 ||
          c0 === l2 ||
          c1 === l0 ||
          c1 === l1 ||
          c1 === l2 ||
          c2 === l0 ||
          c2 === l1 ||
          c2 === l2
        ) {
          doInterpolate = true;
        }
      }
    }

    // compute steps based on UV distance and paint
    let steps = 1;
    if (doInterpolate && lastUV) {
      const dxuv = uv[0] * canvasSize.width - lastUV[0] * canvasSize.width;
      const dyuv = uv[1] * canvasSize.height - lastUV[1] * canvasSize.height;
      const distuv = Math.hypot(dxuv, dyuv);
      const stepSize = Math.max(1, Math.floor(this.brushRadiusPx * 0.5));
      steps = Math.max(1, Math.ceil(distuv / stepSize));
    }

    if (!doInterpolate) {
      paintable.paintAtUV(uv[0], uv[1], this.brushRadiusPx, this.brushColor);
    } else {
      for (let s = 0; s <= steps; s++) {
        const t = steps === 0 ? 0 : s / steps;
        const iu = lastUV ? lastUV[0] * (1 - t) + uv[0] * t : uv[0];
        const iv = lastUV ? lastUV[1] * (1 - t) + uv[1] * t : uv[1];
        paintable.paintAtUV(iu, iv, this.brushRadiusPx, this.brushColor);
      }
    }

    // store current as last for this object
    this._lastUVPerObject.set(objectId, uv);
    const currTriVerts = this._getTriangleVertexIndices(paintable, triIndex);
    if (currTriVerts) this._lastTriPerObject.set(objectId, currTriVerts);

    // ensure contact is marked present
    this._contactLostPerObject.set(objectId, false);
  }

  // Attempt to find a hex color in name and set brush color if found.
  // Returns the normalized hex string (e.g. "#ff7700") on success or null on no-match.
  private _tryPickColorFromName(name: string | undefined): string | null {
    if (!name) return null;
    // find first occurrence of # followed by 3 or 6 hex chars
    const re = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})/;
    const m = name.match(re);
    if (!m) return null;
    const hex = m[0]; // includes '#'
    const rgb = this._hexToRgbNormalized(hex);
    if (!rgb) return null;
    this.brushColor = [rgb[0], rgb[1], rgb[2], 1];
    return hex.toLowerCase();
  }

  // Hook called when color is picked. Default does a console.log — override or extend as needed.
  protected onPickedColor(hex: string) {
    // hex is like "#ff7700"
    // default behavior: log and can be overridden by subclass or monkeypatch
    console.log(
      `MeshBrush: picked color ${hex}, brushColor set to`,
      this.brushColor,
    );
  }

  // Convert "#fff" or "#rrggbb" -> [r,g,b] normalized 0..1, or null if invalid
  private _hexToRgbNormalized(hex: string): [number, number, number] | null {
    let h = hex.replace('#', '');
    if (h.length === 3) {
      h = h
        .split('')
        .map((c) => c + c)
        .join('');
    } else if (h.length !== 6) {
      return null;
    }
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return [r / 255, g / 255, b / 255];
  }

  // Helper to fetch triangle's vertex indices from the paintable's cached arrays
  private _getTriangleVertexIndices(
    paintable: MeshPaintable,
    triIndex: number,
  ): [number, number, number] | null {
    try {
      const anyP: any = paintable as any;
      const triIndices: Int32Array | undefined = anyP._triIndices;
      if (!triIndices) return null;
      const base = triIndex * 3;
      return [triIndices[base + 0], triIndices[base + 1], triIndices[base + 2]];
    } catch {
      return null;
    }
  }

  // Deterministic numeric fallback object id from name (if objectId missing)
  private _stableObjectId(obj: any): number {
    if (typeof obj.objectId === 'number') return obj.objectId;
    const name = obj.name ?? 'anonymous_obj';
    // simple 32-bit hash
    let h = 0;
    for (let i = 0; i < name.length; i++) {
      h = (h << 5) - h + name.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h) || 1;
  }
}
