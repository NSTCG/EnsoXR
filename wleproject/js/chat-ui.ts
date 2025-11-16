// canvas-ai-chat.js
import { Component, Object3D } from '@wonderlandengine/api';
import { property } from '@wonderlandengine/api/decorators.js';
import { CursorTarget } from '@wonderlandengine/components';

const _tmp = new Float32Array(3);

export class CanvasAIChat extends Component {
  static TypeName = 'canvas-ai-chat';

  @property.material()
  material = null;

  @property.object()
  marker = null;

  @property.float(1024.0)
  canvasSize = 1024;

  // Editor API key (optional; recommended to use a server proxy in production)
  @property.string('')
  apiKey = '';

  // --- internals
  _canvas = null;
  _ctx = null;
  _texture = null;

  conversation = []; // {role:'user'|'assistant'|'system', text, img, imgElement}
  draft = '';
  popupImage = null;
  cameraStream = null;
  statusText = 'idle';

  // scroll/layout
  scrollOffset = 0;
  contentHeight = 0;
  isUserAtBottom = true;

  // DOM input overlay (invisible, used only when Type button clicked)
  _input = null;
  _boundPlaceOverlay = null;

  // engine canvas and wheel handler
  _engineCanvas = null;
  _wheelHandler = null;

  start() {
    this._initCanvas();
    this._createInputOverlay();

    // CursorTarget wiring
    this._cursorTarget =
      this.object.getComponent(CursorTarget) ||
      this.object.addComponent(CursorTarget);
    this._cursorTarget.onHover.add((_, cursor) => {
      this._currentCursor = cursor;
    });
    this._cursorTarget.onUnhover.add((_, cursor) => {
      if (this._currentCursor === cursor) this._currentCursor = null;
    });
    this._cursorTarget.onDown.add(this._onDown.bind(this));

    // attach wheel listener to the page's canvas (to detect pointer above chat)
    this._engineCanvas = document.querySelector('canvas');
    if (this._engineCanvas) {
      this._wheelHandler = (ev) => this._onEngineWheel(ev);
      this._engineCanvas.addEventListener('wheel', this._wheelHandler, {
        passive: false,
      });
    }

    // seed
    this.conversation.push({
      role: 'system',
      text: 'Session ready. Click Type Message or the Type button near image to focus input. Set API key with KEY: your_key',
    });
    this.conversation.push({
      role: 'assistant',
      text: 'Ready — supports **bold** and *italic* formatting in replies.',
    });

    this._computeLayoutAndRender(true);
  }

  onDestroy() {
    this._destroyCanvas();
    if (this._input) {
      window.removeEventListener('resize', this._boundPlaceOverlay);
      this._input.remove();
      this._input = null;
    }
    if (this._engineCanvas && this._wheelHandler)
      this._engineCanvas.removeEventListener('wheel', this._wheelHandler);
    this._stopCamera();
  }

  // ---------------- canvas + texture ----------------
  _initCanvas() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const size = Math.floor(Math.max(256, this.canvasSize));
    this._canvas = document.createElement('canvas');
    this._canvas.width = Math.floor(size * dpr);
    this._canvas.height = Math.floor(size * dpr);
    this._canvas.style.width = size + 'px';
    this._canvas.style.height = size + 'px';
    this._ctx = this._canvas.getContext('2d');
    this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this._texture = this.engine.textures.create(this._canvas);
    try {
      if (this.material && typeof this.material.setFlatTexture === 'function')
        this.material.setFlatTexture(this._texture);
    } catch (e) {
      console.warn('canvas-ai-chat: failed to set material texture', e);
    }
  }

  _destroyCanvas() {
    if (this._texture)
      try {
        this._texture.release();
      } catch (e) {}
    this._texture = null;
    this._ctx = null;
    this._canvas = null;
  }

  // ---------------- input overlay (invisible) ----------------
  _createInputOverlay() {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '';
    Object.assign(input.style, {
      position: 'fixed',
      left: '0px',
      top: '0px',
      width: '320px',
      height: '44px',
      border: '0',
      outline: 'none',
      background: 'transparent',
      color: 'transparent', // we render preview on canvas
      caretColor: '#7C5CFF',
      fontSize: '15px',
      zIndex: 9999,
      opacity: 0.02,
      pointerEvents: 'auto',
    });
    document.body.appendChild(input);
    this._input = input;

    input.addEventListener('input', () => {
      this.draft = input.value;
      this._drawDirty();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._onSendClicked();
      }
      setTimeout(() => this._drawDirty(), 0);
    });

    this._boundPlaceOverlay = this._placeInputOverlay.bind(this);
    window.addEventListener('resize', this._boundPlaceOverlay);
    this._placeInputOverlay();
  }

  _placeInputOverlay() {
    // positions are only used when focusing; default keep it hidden off-screen
    if (!this._input) return;
    this._input.style.left = '-9999px';
    this._input.style.top = '-9999px';
  }

  // call this to focus input at CSS coordinates (x,y,w,h) relative to the engine canvas
  _focusInputAtCanvasRect(rectX, rectY, rectW, rectH) {
    const canv = document.querySelector('canvas');
    if (!canv || !this._input) return;
    const cb = canv.getBoundingClientRect();
    const scale =
      cb.width / parseInt(this._canvas.style.width || this.canvasSize);
    const left = Math.round(cb.left + rectX * scale);
    const top = Math.round(cb.top + rectY * scale);
    const width = Math.round(rectW * scale);
    const height = Math.round(rectH * scale);
    this._input.style.left = left + 'px';
    this._input.style.top = top + 'px';
    this._input.style.width = Math.max(80, width) + 'px';
    this._input.style.height = Math.max(28, height) + 'px';
    try {
      this._input.focus({ preventScroll: true });
    } catch (e) {
      this._input.focus();
    }
  }

  // ---------------- marker UV mapping ----------------
  _computeUvFromMarker(cursor) {
    if (!this.marker) return null;
    this.marker.setPositionWorld(cursor.cursorPos);
    const v = this.marker.getPositionLocal(_tmp);
    const u = v[0] / 2 + 0.5;
    const vv = -v[1] / 2 + 0.5;
    return { u, v: vv };
  }

  update(dt) {
    // keep overlay off-screen unless a Type button focused it (we reposition and focus explicitly)
    // nothing else needed here
  }

  _drawDirty() {
    this._drawUI();
    if (this._texture) this._texture.update();
  }

  // ---------------- drawing + layout ----------------
  _drawUI() {
    if (!this._ctx || !this._canvas) return;
    const ctx = this._ctx;
    const SIZE = parseInt(this._canvas.style.width) || this.canvasSize;
    const PAD = 18,
      HEADER_H = 72,
      INPUT_H = 72;
    ctx.clearRect(0, 0, SIZE, SIZE);

    // header
    ctx.fillStyle = '#071824';
    ctx.fillRect(0, 0, SIZE, HEADER_H);
    ctx.fillStyle = '#7C5CFF';
    ctx.fillRect(16, 16, 44, 44);
    ctx.fillStyle = '#EAF0FF';
    ctx.font = '600 16px Inter, Arial';
    ctx.fillText('Image Chat', 72, 24);
    ctx.font = '12px Inter, Arial';
    ctx.fillStyle = '#94A3B8';
    ctx.fillText(
      'Click Type buttons to start typing. Scroll with wheel over chat area.',
      72,
      44,
    );

    // chat area
    const CHAT_X = PAD,
      CHAT_Y = HEADER_H + PAD,
      CHAT_W = SIZE - PAD * 2,
      CHAT_H = SIZE - HEADER_H - INPUT_H - PAD * 3;
    ctx.fillStyle = '#081726';
    this._drawRounded(ctx, CHAT_X, CHAT_Y, CHAT_W, CHAT_H, 12, true);

    // compute layout and draw messages clipped to chat region
    const layouts = this._computeLayout(CHAT_X, CHAT_Y, CHAT_W, CHAT_H);

    ctx.save();
    ctx.beginPath();
    ctx.rect(CHAT_X + 8, CHAT_Y + 8, CHAT_W - 16, CHAT_H - 16);
    ctx.clip();

    for (const L of layouts) {
      const { x, y, w, h, entry } = L;
      const by = CHAT_Y + 8 + (L.y - (CHAT_Y + 8)) - this.scrollOffset;
      if (by + h >= CHAT_Y && by <= CHAT_Y + CHAT_H) {
        ctx.fillStyle = entry.role === 'user' ? '#222' : '#333';
        ctx.fillRect(x, by, w, h);

        // user text darker gray
        ctx.fillStyle = entry.role === 'user' ? '#9aa0a9' : '#ddd';
        ctx.font = '16px Inter, Arial';
        for (let li = 0; li < L.lines.length; li++) {
          ctx.fillText(L.lines[li], x + 12, by + 12 + li * 20);
        }

        // if message has an image, draw a small thumbnail left of the bubble (for future)
        if (entry.img) {
          const iw = 72,
            ih = Math.min(72, h - 16);
          const ix = x - iw - 12,
            iy = by + 8;
          try {
            const im = entry.imgElement || this._cachedImage(entry.img);
            if (im.complete) ctx.drawImage(im, ix, iy, iw, ih);
            else im.onload = () => this._drawDirty();
          } catch (e) {}
        }
      }
    }

    ctx.restore();

    // popup image (above input) + Type button adjacent to it
    if (this.popupImage) {
      const pw = 160,
        ph = 110;
      const px = PAD + 16,
        py = SIZE - PAD - INPUT_H - ph - 8;
      ctx.fillStyle = 'rgba(255,255,255,0.02)';
      this._drawRounded(ctx, px, py, pw, ph, 10, true);
      try {
        const pi = this._cachedImage(this.popupImage);
        if (pi.complete) ctx.drawImage(pi, px + 8, py + 8, pw - 16, ph - 16);
        else pi.onload = () => this._drawDirty();
      } catch (e) {}
      // small 'Type' button to start typing attached to popup image
      const btnW = 56,
        btnH = 30;
      const btnX = px + pw + 8,
        btnY = py + Math.round((ph - btnH) / 2);
      ctx.fillStyle = '#2a2a2a';
      this._drawRounded(ctx, btnX, btnY, btnW, btnH, 8, true);
      ctx.fillStyle = '#EAF0FF';
      ctx.font = '600 12px Inter, Arial';
      ctx.fillText('Type', btnX + 12, btnY + 19);
      // store clickable popup type button rect for onDown mapping
      this._popupTypeBtn = { x: btnX, y: btnY, w: btnW, h: btnH };
    } else {
      this._popupTypeBtn = null;
    }

    // Input area + main "Type Message" button (must be clicked to focus input)
    const inputX = PAD + 16,
      inputY = SIZE - PAD - INPUT_H,
      inputW = SIZE - PAD * 2 - 32;
    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    this._drawRounded(ctx, inputX, inputY, inputW, INPUT_H - 8, 12, true);

    // camera icon (left of input area)
    const camCx = inputX + 28,
      camCy = inputY + INPUT_H / 2 - 4;
    this._drawCamera(ctx, camCx, camCy, 22, '#7C5CFF');

    // text preview on canvas (read from draft)
    ctx.font = '14px Inter, Arial';
    ctx.fillStyle = this.draft ? '#EAF0FF' : '#6F7C86';
    this._wrapPlainText(
      ctx,
      this.draft || '',
      camCx + 32,
      inputY + 22,
      inputW - 240,
      18,
    );

    // send button
    const btnW = 100,
      btnH = 44;
    const btnX = inputX + inputW - btnW - 20,
      btnY = inputY + (INPUT_H - 8 - btnH) / 2;
    ctx.fillStyle = '#7C5CFF';
    this._drawRounded(ctx, btnX, btnY, btnW, btnH, 10, true);
    ctx.fillStyle = '#fff';
    ctx.font = '600 14px Inter, Arial';
    ctx.fillText('Send', btnX + 34, btnY + 14);

    // main Type Message button (must be clicked to start typing)
    const typeBtnX = inputX + 50,
      typeBtnY = inputY + 8,
      typeBtnW = 120,
      typeBtnH = 44;
    ctx.fillStyle = '#2a2a2a';
    this._drawRounded(ctx, typeBtnX, typeBtnY, typeBtnW, typeBtnH, 8, true);
    ctx.fillStyle = '#EAF0FF';
    ctx.font = '600 14px Inter, Arial';
    ctx.fillText('Type Message', typeBtnX + 12, typeBtnY + 28);
    this._typeBtnRect = { x: typeBtnX, y: typeBtnY, w: typeBtnW, h: typeBtnH };

    // status + scrollbar
    const statusX = btnX - 120,
      statusY = btnY + 14;
    ctx.fillStyle = '#94A3B8';
    ctx.font = '12px Inter, Arial';
    ctx.fillText(this.statusText, statusX, statusY);

    // scrollbar track & thumb
    const trackX = CHAT_X + CHAT_W - 12,
      trackY = CHAT_Y + 8,
      trackH = CHAT_H - 16;
    ctx.fillStyle = '#2e2e2e';
    this._drawRounded(ctx, trackX, trackY, 12, trackH, 4, true);

    const visible = CHAT_H - 16;
    const maxScroll = Math.max(0, this.contentHeight - visible);
    const thumbH = Math.max(
      30,
      (visible / Math.max(1, this.contentHeight)) * trackH,
    );
    const maxThumbTop = Math.max(1, trackH - thumbH);
    const thumbTop =
      maxScroll <= 0 ? 0 : (this.scrollOffset / maxScroll) * maxThumbTop;
    ctx.fillStyle = '#999';
    ctx.fillRect(trackX, trackY + thumbTop, 12, thumbH);
    // store scrollbar geometry for hit testing
    this._scrollbarRect = {
      x: trackX,
      y: trackY,
      w: 12,
      h: trackH,
      thumbTop,
      thumbH,
      maxThumbTop,
      maxScroll,
      visible,
    };

    ctx.fillStyle = '#94A3B8';
    ctx.font = '11px Inter, Arial';
    ctx.fillText(
      'Prototype — do not put production keys in browser.',
      PAD + 12,
      SIZE - 14,
    );

    this._texture.update();
  }

  // ---------------- layout compute ----------------
  _computeLayout(CHAT_X, CHAT_Y, CHAT_W, CHAT_H) {
    const ctx = this._ctx;
    ctx.font = '16px Inter, Arial';
    const bubbleMaxW = CHAT_W - 16 - 120;
    let y = CHAT_Y + 8;

    const layouts = [];
    for (const entry of this.conversation) {
      const lines = this._wrapText(ctx, entry.text || '', bubbleMaxW - 24);
      const msgHeight = Math.max(40, lines.length * 20 + 20);
      const bx =
        entry.role === 'user' ? CHAT_X + CHAT_W - bubbleMaxW - 24 : CHAT_X + 20;
      const layout = { x: bx, y: y, w: bubbleMaxW, h: msgHeight, entry, lines };
      layouts.push(layout);
      y += msgHeight + 10;
    }

    this.contentHeight = Math.max(0, y - (CHAT_Y + 8));
    return layouts;
  }

  // ---------------- interactions ----------------
  _onDown(_, cursor) {
    if (!this.marker) return;
    const uv = this._computeUvFromMarker(cursor);
    if (!uv) return;
    const SIZE = parseInt(this._canvas.style.width) || this.canvasSize;
    const PAD = 18,
      HEADER_H = 72,
      INPUT_H = 72;
    const CHAT_X = PAD,
      CHAT_Y = HEADER_H + PAD,
      CHAT_W = SIZE - PAD * 2,
      CHAT_H = SIZE - HEADER_H - INPUT_H - PAD * 3;

    const x = Math.floor(uv.u * SIZE);
    const y = Math.floor(uv.v * SIZE);

    // clear icon top-right
    if (x >= SIZE - 60 && x <= SIZE - 16 && y >= 18 && y <= 58) {
      this.conversation = [];
      this.popupImage = null;
      this.scrollOffset = 0;
      this._drawDirty();
      return;
    }

    // if popup image present: detect click on popup 'Type' button (focus input)
    if (this.popupImage && this._popupTypeBtn) {
      const b = this._popupTypeBtn;
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        // focus input positioned over the Type button (canvas coordinates)
        this._focusInputAtCanvasRect(b.x, b.y, b.w, b.h);
        return;
      }
    }

    // camera icon region
    const inputX = PAD + 16,
      inputY = SIZE - PAD - INPUT_H;
    const camCx = inputX + 28,
      camCy = inputY + INPUT_H / 2 - 4;
    if (
      x >= camCx - 18 &&
      x <= camCx + 18 &&
      y >= camCy - 18 &&
      y <= camCy + 18
    ) {
      this._captureOnce();
      return;
    }

    // send button
    const btnW = 100,
      btnH = 44;
    const btnX = inputX + (CHAT_W - btnW - 32),
      btnY = inputY + (INPUT_H - 8 - btnH) / 2;
    if (x >= btnX && x <= btnX + btnW && y >= btnY && y <= btnY + btnH) {
      this._onSendClicked();
      return;
    }

    // main Type Message button (must be clicked to focus input)
    const t = this._typeBtnRect;
    if (t && x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) {
      // focus overlay over that button
      this._focusInputAtCanvasRect(t.x + 12, t.y + 8, t.w - 24, t.h - 12);
      return;
    }

    // scrollbar click: custom behavior
    if (this._scrollbarRect) {
      const sr = this._scrollbarRect;
      if (x >= sr.x && x <= sr.x + sr.w && y >= sr.y && y <= sr.y + sr.h) {
        // compute current thumb center
        const thumbCenter = sr.y + sr.thumbTop + sr.thumbH / 2;
        // if clicked above center -> page up; if clicked below center -> page down
        const page = Math.max(40, Math.round(sr.visible * 0.9));
        if (y < thumbCenter) {
          // page up
          this.scrollOffset = Math.max(0, this.scrollOffset - page);
        } else {
          // page down
          const maxScroll =
            sr.maxScroll || Math.max(0, this.contentHeight - sr.visible);
          this.scrollOffset = Math.min(maxScroll, this.scrollOffset + page);
        }
        this.isUserAtBottom =
          this.scrollOffset >=
          (sr.maxScroll || Math.max(0, this.contentHeight - sr.visible)) - 8;
        this._drawDirty();
        return;
      }
    }

    // clicking elsewhere does NOT focus input (user requested explicit Type buttons only)
  }

  // wheel scroll only when mouse is above chat area
  _onEngineWheel(ev) {
    const canv = this._engineCanvas;
    if (!canv) return;
    const rect = canv.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * (this._canvas.width / rect.width);
    const y = (ev.clientY - rect.top) * (this._canvas.height / rect.height);
    const SIZE = parseInt(this._canvas.style.width) || this.canvasSize;
    const PAD = 18,
      HEADER_H = 72,
      INPUT_H = 72;
    const CHAT_X = PAD,
      CHAT_Y = HEADER_H + PAD,
      CHAT_W = SIZE - PAD * 2,
      CHAT_H = SIZE - HEADER_H - INPUT_H - PAD * 3;

    // convert to CSS px for layout detection
    const cssX = x / (window.devicePixelRatio || 1);
    const cssY = y / (window.devicePixelRatio || 1);

    if (
      cssX >= CHAT_X + 8 &&
      cssX <= CHAT_X + CHAT_W - 8 &&
      cssY >= CHAT_Y + 8 &&
      cssY <= CHAT_Y + CHAT_H - 8
    ) {
      ev.preventDefault();
      const delta = ev.deltaY;
      const visible = CHAT_H - 16;
      const maxScroll = Math.max(0, this.contentHeight - visible);
      this.scrollOffset = Math.max(
        0,
        Math.min(this.scrollOffset + delta, maxScroll),
      );
      this.isUserAtBottom = this.scrollOffset >= maxScroll - 8;
      this._drawDirty();
    }
  }

  // ---------------- capture / send ----------------
  async _captureOnce() {
    try {
      this.statusText = 'camera…';
      this._drawDirty();
      this.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      const video = document.createElement('video');
      video.autoplay = true;
      video.playsInline = true;
      video.srcObject = this.cameraStream;
      await new Promise((r) => (video.onloadedmetadata = r));
      const off = document.createElement('canvas');
      off.width = video.videoWidth || 640;
      off.height = video.videoHeight || 480;
      const oc = off.getContext('2d');
      oc.drawImage(video, 0, 0, off.width, off.height);
      const data = off.toDataURL('image/jpeg', 0.85);
      this.popupImage = data;
      this._stopCamera();
      this.statusText = 'idle';
      this._drawDirty();
    } catch (err) {
      console.error(err);
      this.statusText = 'camera-error';
      this._stopCamera();
      this.conversation.push({
        role: 'assistant',
        text: 'Camera error: ' + (err.message || err),
      });
      this._computeLayoutAndRender(true);
    }
  }
  _stopCamera() {
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach((t) => t.stop());
      this.cameraStream = null;
    }
  }

  async _onSendClicked() {
    if (!this.draft.trim() && !this.popupImage) return;

    // KEY: special
    if (this.draft.trim().toUpperCase().startsWith('KEY:')) {
      this.apiKey = this.draft.trim().substring(4).trim();
      this.draft = '';
      if (this._input) this._input.value = '';
      this.conversation.push({
        role: 'assistant',
        text: 'API key saved (dev)',
      });
      this._computeLayoutAndRender(true);
      return;
    }

    // append user message and placeholder assistant
    const userEntry = {
      role: 'user',
      text: this.draft.trim(),
      img: this.popupImage || null,
      imgElement: this.popupImage ? this._cachedImage(this.popupImage) : null,
    };
    this.conversation.push(userEntry);
    this.conversation.push({ role: 'assistant', text: '…thinking' });

    // clear draft/popup
    this.draft = '';
    if (this._input) this._input.value = '';
    this.popupImage = null;

    const wasAtBottom = this.isUserAtBottom;
    this._computeLayoutAndRender(wasAtBottom);

    // send to Gemini (real call)
    try {
      await this.postSend(userEntry);
    } catch (e) {
      console.warn('postSend error', e);
    }
  }

  // ---------------- Gemini call ----------------
  async postSend(userEntry) {
    const key = (this.apiKey || '').trim();
    if (!key) {
      this._replaceLastAssistant(
        'No Gemini API key configured. Set `apiKey` property or type `KEY: your_key`',
      );
      this._computeLayoutAndRender(true);
      return;
    }

    const payload = this._buildGeminiPayload(userEntry.img, this.conversation);
    this.statusText = 'calling Gemini…';
    this._drawDirty();

    try {
      const res = await this._callGemini(payload, key);
      const text = this._extractTextFromGeminiResponse(res).trim();
      const finalText = text.length ? text : JSON.stringify(res, null, 2);
      this._replaceLastAssistant(finalText);
      this.statusText = 'idle';
      this._computeLayoutAndRender(true);
    } catch (err) {
      console.error('Gemini call error:', err);
      const raw = err.raw || err.message || String(err);
      this._replaceLastAssistant('Error calling Gemini: ' + raw);
      this.statusText = 'idle';
      this._computeLayoutAndRender(true);
    }
  }

  _buildGeminiPayload(base64Image, conv) {
    const parts = [];
    if (base64Image) {
      const comma = base64Image.indexOf(',');
      const b64 = comma >= 0 ? base64Image.slice(comma + 1) : base64Image;
      parts.push({
        inline_data: {
          mime_type: this._detectMime(base64Image) || 'image/jpeg',
          data: b64,
        },
      });
    }
    parts.push({
      text: 'You are a helpful assistant. Use markdown-like **bold**, *italic* and respond conversationally.',
    });
    for (const m of conv) {
      if (m.role === 'system') parts.push({ text: `[System] ${m.text}` });
      else if (m.role === 'user') parts.push({ text: `User: ${m.text}` });
      else if (m.role === 'assistant')
        parts.push({ text: `Assistant: ${m.text}` });
    }
    return { contents: [{ parts }] };
  }

  async _callGemini(payload, key) {
    const endpoint =
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent';
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      const e = new Error('HTTP ' + resp.status + ' ' + txt.slice(0, 200));
      e.raw = txt;
      throw e;
    }
    return resp.json();
  }

  _extractTextFromGeminiResponse(data) {
    try {
      if (Array.isArray(data.candidates) && data.candidates[0]?.content?.parts)
        return data.candidates[0].content.parts
          .map((p) => p.text || p.data || '')
          .join('\n');
      if (data.output?.[0]?.content?.[0]?.parts)
        return data.output[0].content[0].parts
          .map((p) => p.text || '')
          .join('\n');
      return '';
    } catch (e) {
      return '';
    }
  }

  _detectMime(dataUrl) {
    if (!dataUrl) return null;
    if (dataUrl.startsWith('data:image/png')) return 'image/png';
    if (dataUrl.startsWith('data:image/webp')) return 'image/webp';
    return 'image/jpeg';
  }

  _replaceLastAssistant(text) {
    for (let i = this.conversation.length - 1; i >= 0; i--) {
      if (this.conversation[i].role === 'assistant') {
        this.conversation[i].text = text;
        return;
      }
    }
    // if none found, push one
    this.conversation.push({ role: 'assistant', text });
  }

  // compute layout and scroll clamp + autoscroll
  _computeLayoutAndRender(shouldAutoScroll) {
    const SIZE = parseInt(this._canvas.style.width) || this.canvasSize;
    const PAD = 18,
      HEADER_H = 72,
      INPUT_H = 72;
    const CHAT_X = PAD,
      CHAT_Y = HEADER_H + PAD,
      CHAT_W = SIZE - PAD * 2,
      CHAT_H = SIZE - HEADER_H - INPUT_H - PAD * 3;
    this._computeLayout(CHAT_X, CHAT_Y, CHAT_W, CHAT_H);
    const visible = CHAT_H - 16;
    const maxScroll = Math.max(0, this.contentHeight - visible);
    if (shouldAutoScroll) {
      if (this.isUserAtBottom) this.scrollOffset = maxScroll;
    } else {
      this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxScroll));
    }
    this._drawDirty();
  }

  // ---------------- small helpers ----------------
  _drawRounded(ctx, x, y, w, h, r, fill) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    if (fill) ctx.fill();
    ctx.stroke();
  }

  _drawCamera(ctx, cx, cy, size, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.fillRect(cx - size / 2, cy - size / 4, size, size / 2);
    ctx.beginPath();
    ctx.fillStyle = '#071522';
    ctx.arc(cx, cy, size / 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _wrapPlainText(ctx, text, x, y, maxW, lineH) {
    ctx.fillStyle = ctx.fillStyle || '#fff';
    const words = String(text).split(' ');
    let line = '',
      yy = y;
    for (let n = 0; n < words.length; n++) {
      const test = (line ? line + ' ' : '') + words[n];
      if (ctx.measureText(test).width > maxW && n > 0) {
        ctx.fillText(line, x, yy);
        line = words[n];
        yy += lineH;
      } else line = test;
    }
    if (line) ctx.fillText(line, x, yy);
  }

  _wrapText(ctx, text, maxWidth) {
    const words = String(text).split(' ');
    const lines = [];
    let line = '';
    for (let i = 0; i < words.length; i++) {
      const testLine = (line ? line + ' ' : '') + words[i];
      const width = ctx.measureText(testLine).width;
      if (width > maxWidth && i > 0) {
        lines.push(line);
        line = words[i];
      } else {
        line = testLine;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  _cachedImage(data) {
    if (!data) return null;
    if (!CanvasAIChat._imgmap) CanvasAIChat._imgmap = {};
    if (CanvasAIChat._imgmap[data]) return CanvasAIChat._imgmap[data];
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.src = data;
    CanvasAIChat._imgmap[data] = im;
    return im;
  }
}
