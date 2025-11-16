import { Component, Object3D, Property } from '@wonderlandengine/api';
import { property } from '@wonderlandengine/api/decorators.js';

/**
 * CinematicIntro component — updated:
 * - PC flow: shows inputs for URL and Scale, and generates HMD link with appended params (src and scale).
 * - MR flow: if ?src=... and optionally ?scale=..., preload model and apply scale to the instantiated root (tries several fallbacks).
 * - When user provides inputs in MR UI, the Start Painting button will load the model and apply the provided scale before entering MR.
 */
export class CinematicIntro extends Component {
  static TypeName = 'cinematic_intro';

  @property.string('')
  videoSrc = '';

  @property.string(
    'https://cdn.jsdelivr.net/gh/wonderland-engine/examples@master/assets/model-demo.glb',
  )
  demoModelUrl = '';

  @property.object(null)
  demoObjects = null;

  _overlay = null;
  _video = null;
  _uiCard = null;
  supportsAR = false;
  supportsVR = false;

  start() {
    if (!document.getElementById('we-cinematic-styles')) {
      const style = document.createElement('style');
      style.id = 'we-cinematic-styles';
      style.textContent = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600&display=swap');
.cinematic-overlay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:10001}
.cinematic-video-wrap{position:absolute;inset:0;overflow:hidden}
.cinematic-video-wrap video{width:100%;height:100%;object-fit:cover;transition:filter 360ms,transform 360ms,opacity 360ms}
.cinematic-video-wrap video.blurred{filter:blur(10px) saturate(130%);transform:scale(1.02);opacity:0.92}
.cinematic-uicard{position:relative;z-index:10002;width:min(980px,calc(100% - 64px));padding:28px;border-radius:18px;pointer-events:auto;color:rgba(255,255,255,0.98);font-family:Inter,system-ui,Segoe UI,Roboto,Arial;background:linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02));border:1px solid rgba(255,255,255,0.10);backdrop-filter:blur(8px) saturate(120%);box-shadow:0 30px 70px rgba(0,0,0,0.6);display:flex;flex-direction:column;gap:18px}
.cinematic-hero{display:flex;gap:18px;align-items:center}
.cinematic-hero-left{flex:1}
.cinematic-hero-title{font-size:28px;font-weight:700;letter-spacing:-0.4px}
.cinematic-hero-sub{color:rgba(255,255,255,0.84);font-size:15px;margin-top:6px}
.cinematic-hero-actions{display:flex;gap:14px;align-items:center;margin-top:12px}
.cinematic-btn{padding:16px 20px;border-radius:12px;border:1px solid rgba(255,255,255,0.12);background:linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02));cursor:pointer;font-weight:800;font-size:15px;min-width:220px}
.cinematic-btn.ghost{background:transparent;border:1px dashed rgba(255,255,255,0.12);font-weight:700}
.cinematic-input{width:100%;padding:12px;border-radius:10px;border:none;outline:none;background:rgba(255,255,255,0.03);color:inherit;font-size:14px}
.cinematic-note{color:rgba(255,255,255,0.82);font-size:13px}
@media(max-width:760px){.cinematic-uicard{width:calc(100% - 28px);padding:16px}.cinematic-hero-title{font-size:20px}.cinematic-btn{min-width:140px;padding:12px 14px}}
`;
      document.head.appendChild(style);
    }

    this._overlay = document.createElement('div');
    this._overlay.className = 'cinematic-overlay';
    const vwrap = document.createElement('div');
    vwrap.className = 'cinematic-video-wrap';
    const video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.muted = true;
    video.autoplay = true;
    video.controls = false;
    video.loop = false;
    video.src =
      this.videoSrc ||
      'https://cdn.jsdelivr.net/gh/WonderlandEngine/examples@master/assets/intro-loop.mp4';
    vwrap.appendChild(video);
    this._video = video;

    this._uiCard = document.createElement('div');
    this._uiCard.className = 'cinematic-uicard';
    this._uiCard.style.display = 'none';

    const hero = document.createElement('div');
    hero.className = 'cinematic-hero';
    const left = document.createElement('div');
    left.className = 'cinematic-hero-left';
    const title = document.createElement('div');
    title.className = 'cinematic-hero-title';
    title.textContent = 'Step into Mixed Reality — Paint with Reference';
    const sub = document.createElement('div');
    sub.className = 'cinematic-hero-sub';
    sub.textContent = 'Load a reference model or practice freely in MR.';
    left.appendChild(title);
    left.appendChild(sub);
    const actions = document.createElement('div');
    actions.className = 'cinematic-hero-actions';
    hero.appendChild(left);
    hero.appendChild(actions);

    const content = document.createElement('div');
    content.className = 'cinematic-content';
    this._uiCard.appendChild(hero);
    this._uiCard.appendChild(content);

    this._overlay.appendChild(vwrap);
    this._overlay.appendChild(this._uiCard);
    document.body.appendChild(this._overlay);

    const revealUI = () => {
      try {
        video.pause();
        video.classList.add('blurred');
        this._uiCard.style.display = 'flex';
        this._overlay.style.pointerEvents = 'auto';
        this.detectXRSupport().then(() => this.buildContent(content));
      } catch (e) {
        console.warn('revealUI', e);
      }
    };
    video.addEventListener('ended', revealUI, { passive: true });
    video.addEventListener('timeupdate', () => {
      if (video.duration && video.currentTime >= video.duration - 0.12)
        revealUI();
    });
    video.play().catch(() => {
      this._uiCard.style.display = 'flex';
      this._overlay.style.pointerEvents = 'auto';
      this.detectXRSupport().then(() => this.buildContent(content));
    });
  }

  async detectXRSupport() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('force_non_mr') === 'true') {
      this.supportsAR = false;
      this.supportsVR = false;
      return;
    }
    if (params.get('force_xr') === 'true') {
      this.supportsAR = true;
      this.supportsVR = true;
      return;
    }

    const xr = navigator.xr;
    if (xr && typeof xr.isSessionSupported === 'function') {
      try {
        const [ar, vr] = await Promise.all([
          xr.isSessionSupported('immersive-ar').catch(() => false),
          xr.isSessionSupported('immersive-vr').catch(() => false),
        ]);
        this.supportsAR = !!ar;
        this.supportsVR = !!vr;
      } catch (e) {
        this.supportsAR = false;
        this.supportsVR = false;
      }
    } else {
      const ua = navigator.userAgent || '';
      const hasEmulator =
        ua.includes('WebXR') ||
        ua.includes('OculusBrowser') ||
        ua.includes('Oculus') ||
        ua.includes('OpenXR') ||
        !!window.__webxr_polyfill;
      if (hasEmulator) {
        this.supportsAR = true;
        this.supportsVR = true;
      } else {
        this.supportsAR = false;
        this.supportsVR = false;
      }
    }
  }

  // try multiple strategies to apply uniform scale to instantiated root
  _applyScaleToRoot(root:Object3D, scale) {
    root.setScalingWorld([scale, scale, scale]);
      // 4) fallback: walk children and try to set their scale
    if (root.children && root.children.length) {
        for (let i = 0; i < root.children.length; i++)
          this._applyScaleToRoot(root.children[i], scale);
      }
    
  }

  async buildContent(container) {
    container.innerHTML = '';
    const arBtn = document.getElementById('ar-button');
    if (arBtn) arBtn.classList.add('liquid-glass-btn');

    const params = new URLSearchParams(window.location.search);
    const srcParam = params.get('src');
    const scaleParam = params.get('scale');

    if (!this.supportsAR && !this.supportsVR) {
      const note = document.createElement('div');
      note.className = 'cinematic-note';
      note.textContent =
        'This experience is best on a Mixed Reality headset. Generate an HMD link and open it on your headset.';
      container.appendChild(note);

      // URL input
      const urlInput = document.createElement('input');
      urlInput.className = 'cinematic-input';
      urlInput.type = 'url';
      urlInput.placeholder = 'Reference 3D model URL (.glb/.gltf)';
      urlInput.value = srcParam || this.demoModelUrl || '';
      container.appendChild(urlInput);
      // Scale input
      const scaleInput = document.createElement('input');
      scaleInput.className = 'cinematic-input';
      scaleInput.type = 'number';
      scaleInput.placeholder = 'Uniform scale (e.g. 1.0)';
      scaleInput.value = scaleParam || '0.1';
      container.appendChild(scaleInput);

      const btn = document.createElement('button');
      btn.className = 'cinematic-btn';
      btn.textContent = 'Generate HMD Link';
      btn.addEventListener('click', () => {
        const url = urlInput.value || this.demoModelUrl || window.location.href;
        const scaleV = scaleInput.value || '1.0';
        // link format: https://hmd.link/<currentPage>?src=<encodedUrl>&scale=<scale>
        const base = window.location.href.split('?')[0];
        const hmdLink = `https://hmd.link/${base}?src=${encodeURIComponent(url)}&scale=${encodeURIComponent(scaleV)}`;
        window.open(hmdLink, '_blank');
      });
      container.appendChild(btn);

      // const demoBtn = document.createElement("button"); demoBtn.className = "cinematic-btn ghost"; demoBtn.textContent = "Demo Mode (preview on this device)";
      // demoBtn.addEventListener("click", async ()=>{
      //     try{ const url = urlInput.value || this.demoModelUrl; const prefab = await this.loadAvatar(url); // try to apply scale locally as well
      //         this._applyScaleToRoot(prefab && prefab.root ? prefab.root : null, Number(scaleInput.value || 1.0));
      //         this.destroyIntro();
      //     }catch(e){ alert('Could not load demo model — see console'); console.error(e); }
      // });
      // container.appendChild(demoBtn);

      const dismiss = document.createElement('button');
      dismiss.className = 'cinematic-btn ghost';
      dismiss.textContent = 'Dismiss';
      dismiss.addEventListener('click', () => this.destroyIntro());
      container.appendChild(dismiss);

      return;
    }

    // MR-capable devices
    const note = document.createElement('div');
    note.className = 'cinematic-note';
    note.textContent = 'Mixed Reality ready — choose how you want to enter:';
    container.appendChild(note);

    // If src param exists, preload and apply scaleParam
    if (srcParam) {
      const loading = document.createElement('div');
      loading.className = 'cinematic-note';
      loading.textContent = `Loading reference from URL: ${srcParam}`;
      container.appendChild(loading);
      this.loadAvatar(srcParam)
        .then((prefab) => {
          try {
            const root = prefab && prefab.root ? prefab.root : null;
            if (scaleParam) this._applyScaleToRoot(root, Number(scaleParam));
            loading.textContent = `Reference loaded from URL`;
          } catch (e) {
            loading.textContent = `Loaded but scale apply failed`;
            console.warn(e);
          }
        })
        .catch((e) => {
          loading.textContent = `Failed to load reference from URL`;
          console.warn(e);
        });
    }

    // Input fields (allow override or manual entry)
    const input = document.createElement('input');
    input.className = 'cinematic-input';
    input.type = 'url';
    input.placeholder = 'Reference 3D model URL (.glb/.gltf)';
    input.value = srcParam || this.demoModelUrl || '';
    container.appendChild(input);
    const scaleInput = document.createElement('input');
    scaleInput.className = 'cinematic-input';
    scaleInput.type = 'number';
    scaleInput.placeholder = 'Uniform scale (e.g. 1.0)';
    scaleInput.value = scaleParam || '1.0';
    container.appendChild(scaleInput);

    const btnWrap = document.createElement('div');
    btnWrap.style.display = 'flex';
    btnWrap.style.gap = '12px';
    btnWrap.style.flexWrap = 'wrap';

    const startBtn = document.createElement('button');
    startBtn.className = 'cinematic-btn';
    startBtn.textContent = 'Start Painting in MR';
    startBtn.addEventListener('click', async () => {
      const url = input.value || srcParam || this.demoModelUrl;
      const sc = Number(scaleInput.value || 1.0);
      if (url) {
        try {
          const model = await this.loadAvatar(url);
          this._applyScaleToRoot(model, sc);
        } catch (e) {
          console.warn('load before MR failed', e);
        }
      }
      this.enterMixedReality();
    });
    btnWrap.appendChild(startBtn);

    const practiceBtn = document.createElement('button');
    practiceBtn.className = 'cinematic-btn';
    practiceBtn.textContent =
      'No figurine to paint? Practice your painting skill on a virtual model';
    practiceBtn.style.minWidth = '360px';
    practiceBtn.addEventListener('click', () => {
      try {
        this._enableDemoObjectsRecursive(this.demoObjects, true);
      } catch (e) {
        console.warn(e);
      }
      this.enterMixedReality();
    });
    btnWrap.appendChild(practiceBtn);

    const demoBtn = document.createElement('button');
    demoBtn.className = 'cinematic-btn ghost';
    demoBtn.textContent = 'Demo Mode';
    demoBtn.addEventListener('click', () => {
      this.enterMixedReality();
    });
    btnWrap.appendChild(demoBtn);

    container.appendChild(btnWrap);
    const dismiss = document.createElement('button');
    dismiss.className = 'cinematic-btn ghost';
    dismiss.textContent = 'Dismiss';
    dismiss.addEventListener('click', () => this.destroyIntro());
    container.appendChild(dismiss);
  }

  _enableDemoObjectsRecursive(obj, enabled) {
    try {
      if (!obj) return;
      if (typeof obj.enabled === 'boolean') obj.enabled = enabled;
      if (obj.children && obj.children.length) {
        for (let i = 0; i < obj.children.length; i++)
          this._enableDemoObjectsRecursive(obj.children[i], enabled);
      }
    } catch (e) {
      console.warn(e);
    }
  }

  async enterMixedReality() {
    const arBtn = document.getElementById('ar-button');
    if (arBtn) {
      arBtn.click();
      return;
    }
    try {
      const xr = navigator.xr;
      if (xr && xr.requestSession) {
        if (this.supportsAR) await xr.requestSession('immersive-ar');
        else if (this.supportsVR) await xr.requestSession('immersive-vr');
      }
    } catch (e) {
      console.warn('Programmatic XR request failed', e);
    }
  }

  async loadAvatar(url) {
    if (!url) throw new Error('No URL provided for loadAvatar');
    const prefab = await this.engine.loadGLTF({ url: url, extensions: true });
    const { root } = this.engine.scene.instantiate(prefab);
    const holder = this.object.addChild();
    if (holder && root && root.children) {
      root.children.forEach((child) => {
        try {
          child.parent = holder;
        } catch (e) {}
      });
    }
    holder.resetPositionRotation();
    return holder;
  }

  destroyIntro() {
    try {
      if (this._overlay && this._overlay.parentElement)
        this._overlay.parentElement.removeChild(this._overlay);
    } catch (e) {}
  }
  onDestroy() {
    this.destroyIntro();
  }
}
