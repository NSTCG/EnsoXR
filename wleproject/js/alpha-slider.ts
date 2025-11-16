import { Component, Material, MeshComponent, Object3D } from '@wonderlandengine/api';
import { property } from '@wonderlandengine/api/decorators.js';
import { CursorTarget } from '@wonderlandengine/components';
import { vec4 } from 'gl-matrix';

/**
 * Alpha slider rendered to a canvas texture (no DOM) and mapped onto a material.
 * - Inspector: set `targetObject` (object whose materials alpha we will change)
 * - Optional `uiMaterial`: a material to which the slider canvas will be set as a flat texture
 * - Optional `marker`: an Object3D used to compute UV from pointer (works with CursorTarget)
 *
 * Interaction:
 * - Uses a CursorTarget on the component's object. Clicking the canvas-mapped surface
 *   with the marker will control the slider (maps UV -> slider position).
 * - Designed to work in VR/MR since it uses a texture on a material rather than DOM.
 */
export class AlphaSliderCanvas extends Component {
  static TypeName = 'alpha-slider-canvas';

  @property.object()
  targetObject :Object3D;

  // material used to display the slider (optional). If not set we try to use first collected material.
  @property.material()
  uiMaterial = null;

  @property.object()
  marker = null; // used for UV mapping when pointer/cursor interacts

  @property.float(1.0)
  alpha = 1.0;

  @property.float(256)
  canvasSize = 256;

  // internals
  _materials = null;
  _origAlpha = null;
  _canvas = null;
  _ctx = null;
  _texture = null;
  _cursorTarget = null;
  _currentCursor = null;

  onActivate(): void
  {
    this.engine.onXRSessionStart.add(() => {
      // on XR start, re-apply alpha to ensure visibility in XR
       // collect materials from targetObject
      if (this.targetObject) this._collectMaterialsRecursive(this.targetObject);
    });
  }

  onDeactivate(): void
  {
    this.engine.onXRSessionStart.remove(() => {
      // on XR start, re-apply alpha to ensure visibility in XR
       // collect materials from targetObject
      if (this.targetObject) this._collectMaterialsRecursive(this.targetObject);
    });
  }

  start() {
    this._materials = new Set();
    this._origAlpha = new Map();

    if (!this.targetObject)
      console.warn('AlphaSliderCanvas: no targetObject assigned');

    

    // collect materials from targetObject
    if (this.targetObject) this._collectMaterialsRecursive(this.targetObject.getChildren()[0]);

    // remember original alpha per material
    for (const m of this._materials) {
      this._origAlpha.set(m, this._readMaterialAlpha(m));
    }

    // create canvas texture
    this._initCanvas();

    // assign texture to uiMaterial or first collected material (best-effort)
    const matToUse =
      this.uiMaterial ||
      (this._materials.size ? [...this._materials][0] : null);
    if (matToUse && this._texture) {
      try {
        if (typeof matToUse.setFlatTexture === 'function')
          matToUse.setFlatTexture(this._texture);
        // otherwise attempt common property names
        else matToUse.flatTexture = this._texture;
      } catch (e) {
        console.warn(
          'AlphaSliderCanvas: failed to set flat texture on material',
          e,
        );
      }
    }

    // cursor wiring for VR pointer interactions
    this._cursorTarget =
      this.object.getComponent(CursorTarget) ||
      this.object.addComponent(CursorTarget);
    this._cursorTarget.onHover.add(
      (_, cursor) => (this._currentCursor = cursor),
    );
    this._cursorTarget.onUnhover.add((_, cursor) => {
      if (this._currentCursor === cursor) this._currentCursor = null;
    });
    this._cursorTarget.onDown.add(this._onDown.bind(this));

    // apply initial alpha to target materials
    this._applyAlpha(this.alpha);

    // initial draw
    this._draw();
  }

  onDestroy() {
    // restore original alphas
    for (const [m, a] of this._origAlpha.entries()) {
      if (a === null) continue;
      this._writeMaterialAlpha(m, a);
      if (typeof m.update === 'function')
        try {
          m.update();
        } catch (e) {}
    }

    // release texture
    if (this._texture) {
      try {
        this._texture.release();
      } catch (e) {}
      this._texture = null;
    }

    if (this._canvas) {
      this._canvas = null;
      this._ctx = null;
    }

    if (this._cursorTarget) {
      this._cursorTarget.onHover.remove((_, cursor) => {});
      this._cursorTarget.onUnhover.remove((_, cursor) => {});
      this._cursorTarget.onDown.remove(this._onDown.bind(this));
    }
  }

  // ---------------- canvas texture ----------------
  _initCanvas() {
    const size = Math.max(64, Math.floor(this.canvasSize));
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    this._canvas = document.createElement('canvas');
    this._canvas.width = Math.floor(size * dpr);
    this._canvas.height = Math.floor(size * dpr);
    this._canvas.style.width = size + 'px';
    this._canvas.style.height = size + 'px';
    this._ctx = this._canvas.getContext('2d');
    this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this._texture = this.engine.textures.create(this._canvas);
  }

  // ---------------- drawing slider onto canvas ----------------
  _draw() {
    if (!this._ctx || !this._canvas) return;
    const ctx = this._ctx;
    const SIZE = parseInt(this._canvas.style.width) || this.canvasSize;
    ctx.clearRect(0, 0, SIZE, SIZE);

    // background
    ctx.fillStyle = 'rgba(8,10,12,0.9)';
    ctx.fillRect(0, 0, SIZE, SIZE);

    // title
    ctx.fillStyle = '#EAF0FF';
    ctx.font = '14px Inter, Arial';
    ctx.fillText('Alpha', 12, 20);

    // slider track
    const trackX = 12,
      trackY = Math.round(SIZE / 2),
      trackW = SIZE - 24,
      trackH = 10;
    // track background
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    this._drawRounded(
      ctx,
      trackX,
      trackY - trackH / 2,
      trackW,
      trackH,
      6,
      true,
    );

    // filled portion
    const fillW = Math.round(trackW * Math.max(0, Math.min(1, this.alpha)));
    ctx.fillStyle = 'rgba(124,92,255,0.95)';
    this._drawRounded(ctx, trackX, trackY - trackH / 2, fillW, trackH, 6, true);

    // thumb
    const thumbX = trackX + fillW;
    const thumbR = 12;
    ctx.beginPath();
    ctx.arc(thumbX, trackY, thumbR, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#7C5CFF';
    ctx.stroke();

    // value text
    ctx.fillStyle = '#94A3B8';
    ctx.font = '11px Inter, Arial';
    ctx.fillText(this.alpha.toFixed(2), SIZE - 40, 22);

    // update texture
    if (this._texture)
      try {
        this._texture.update();
      } catch (e) {}
  }

  // ---------------- interactions (map UV -> slider) ----------------
  _onDown(_, cursor) {
    // compute UV from marker position (if marker provided) else use cursor cursorPos
    const uv = this._computeUvFromMarker(cursor);
    if (!uv) return;

    const SIZE = parseInt(this._canvas.style.width) || this.canvasSize;
    // slider occupies from x=12 to x=SIZE-12 at y~=SIZE/2
    const trackX = 12,
      trackW = SIZE - 24;

    const clickX = Math.round(uv.u * SIZE);
    let v = (clickX - trackX) / trackW;
    v = Math.max(0, Math.min(1, v));
    this.alpha = v;
    this._applyAlpha(v);
    this._draw();
  }

  _computeUvFromMarker(cursor) {
    // prefer user-provided marker so we can position it in world
    const m = this.marker;
    if (!m) {
      // fallback: use cursor.hitUV if available
      if (cursor && cursor.hitUV)
        return { u: cursor.hitUV[0], v: cursor.hitUV[1] };
      return null;
    }

    m.setPositionWorld(cursor.cursorPos);
    const tmp = new Float32Array(3);
    const v = m.getPositionLocal(tmp);
    const u = v[0] / 2 + 0.5;
    const vv = -v[1] / 2 + 0.5;
    return { u, v: vv };
  }

  // ---------------- material alpha helpers (same as before) ----------------
  _collectMaterialsRecursive(obj:Object3D) {
    if (!obj) return;
    const comps = obj.getComponents(MeshComponent) || [];
    for (const c of comps) {
        if (c.material)
            this._materials.add(c.material);   
    }
    const children = obj.children || [];
    for (const ch of children) this._collectMaterialsRecursive(ch);
  }

  _readMaterialAlpha(mat) {
    if (!mat) return null;
    try {
      if (Array.isArray(mat.color) && mat.color.length >= 4)
        return mat.color[3];
      if (Array.isArray(mat.albedoColor) && mat.albedoColor.length >= 4)
        return mat.albedoColor[3];
      if (Array.isArray(mat.diffuseColor) && mat.diffuseColor.length >= 4)
        return mat.diffuseColor[3];
    } catch (e) {}
    return null;
  }

  _writeMaterialAlpha(mat: Material, alpha) {
    if (!mat) return false;

    try {
      if (mat.color) {
        mat.color = [mat.color[0], mat.color[1], mat.color[2], alpha];
        return true;
      }
      if (mat.albedoColor) {
        mat.albedoColor = [
          mat.albedoColor[0],
          mat.albedoColor[1],
          mat.albedoColor[2],
          alpha,
        ];
        return true;
      }
      if (mat.diffuseColor) {
        mat.diffuseColor = [
          mat.diffuseColor[0],
          mat.diffuseColor[1],
          mat.diffuseColor[2],
          alpha,
        ];
        return true;
      }
    } catch (e) {
      console.warn('AlphaSliderCanvas: write failed', e);
    }
    return false;
  }



  _applyAlpha(alpha) {
    alpha = Math.max(0, Math.min(1, Number(alpha) || 0));
    for (const m of this._materials) {
      this._writeMaterialAlpha(m, alpha);
      if (typeof m.update === 'function')
        try {
          m.update();
        } catch (e) {}
    }
  }

  // small canvas helper
  _drawRounded(ctx, x, y, w, h, r, fill) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    if (fill) ctx.fill();
    else ctx.stroke();
  }
}
