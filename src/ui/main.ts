/**
 * UI controller (owner: ui) — the DOM / Three.js side, loaded by index.ts after the DOM-free logic.
 *
 * States: title (sim paused) → play ⇄ efb, play ⇄ pause (sim paused), play → end (both engines running).
 * Look modes: "visée" (pointer lock, crosshair, the mouse turns the head) or free cursor (the cursor clicks the
 * controls, drag in empty space to look). Pointer lock may be refused (sandboxed page): the game then falls back
 * to the free cursor. URL options (game and dev harness): ui.menu=0|1, ui.free=1, ui.fo=1, ui.view=<preset>,
 * ui.efb=<tab>, ui.pause=1, ui.help=1, ui.settings=1, ui.end=1, ui.gate=1, ui.pace=real|fast.
 * Debug handle: window.__ui.
 */
import type { App } from '../app';
import type { Handle } from '../cockpit/kit/interaction';
import { CSS } from './styles';
import { h } from './dom';
import { HeadCamera } from './camera';
import { Hud } from './hud';
import { Efb, type EfbTab } from './efb';
import { buildTablets } from './tablet';
import { ChecklistState, normalChecklists } from './checklists';
import { confirmDialog, endScreen, helpContent, panel, pauseMenu, settingsForm, startScreen, type MenuCtx } from './menus';
import { setUiPref, uiPrefs } from './prefs';
import { detectLayout, keyLabel, VIEW_KEYS } from './keys';
import { SPEAKERS, type GroundService } from './ground';
import type { GameResult, GameService } from './game';
import type { PresetId, Vec3 } from './view';

type Mode = 'title' | 'play' | 'pause' | 'efb' | 'end';

const ROT_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M7 9.5a8.5 8.5 0 0 1 14 0M21 9.5l.3-3.4M21 9.5l-3.3-.7M21 18.5a8.5 8.5 0 0 1-14 0M7 18.5l-.3 3.4M7 18.5l3.3.7" stroke="#000" stroke-width="4"/><path d="M7 9.5a8.5 8.5 0 0 1 14 0M21 9.5l.3-3.4M21 9.5l-3.3-.7M21 18.5a8.5 8.5 0 0 1-14 0M7 18.5l-.3 3.4M7 18.5l3.3.7" stroke="#fff" stroke-width="1.8"/><circle cx="14" cy="14" r="2" fill="#fff" stroke="#000"/></g></svg>')}") 14 14, pointer`;

const cursorFor = (c: Handle['cursor'] | undefined): string =>
  c === 'rotate' ? ROT_CURSOR : c === 'drag' ? 'ns-resize' : 'pointer';

export function installUi(app: App, ground: GroundService, game: GameService): void {
  const q = new URLSearchParams(location.search);
  const sim = app.sim;
  const canvas = app.renderer.domElement;
  document.head.append(h('style', { attrs: { 'data-owner': 'ui' } }, CSS));
  void detectLayout();

  const overlay = h('div', { class: 'a3-root', attrs: { id: 'a3-overlay' } });
  document.body.append(overlay);
  const hud = new Hud(document.body);
  hud.tooltips = app.settings.get().tooltips;
  hud.setFps(app.settings.get().showFps);

  const orbit = app.isHarness && q.get('orbit') === '1';
  const cam = orbit ? null : new HeadCamera(app);
  const tablets = buildTablets(app, () => openEfb());
  if (cam) cam.efbTarget = tablets.target();
  if (cam && app.isHarness && q.get('cam')) {
    const c = q.get('cam')!.split(',').map(Number);
    if (c.length === 6 && c.every(Number.isFinite)) cam.setFromLook([c[0], c[1], c[2]], [c[3], c[4], c[5]]);
  }

  const tod = app.settings.get().timeOfDay;
  const checklists = new ChecklistState(normalChecklists(tod, app.settings.get().weightUnit));

  /* ------------------------------------------------------------------ state */
  let mode: Mode = 'title';
  // The dev harness starts in free-cursor mode (screenshots, no pointer lock without a click) unless ui.free=0.
  let wantLock = uiPrefs().pointerLock && q.get('ui.free') !== '1' && !(app.isHarness && q.get('ui.free') !== '0');
  let lockBroken = false;
  let expectUnlock = false;
  let lastUnlockT = -10;
  let sub: HTMLElement | null = null;
  let endEl: HTMLElement | null = null;
  let titleEl: HTMLElement | null = null;
  let switching = false;
  const now = () => performance.now() / 1000;
  const isLocked = () => document.pointerLockElement === canvas;
  const audio = () => app.services.audio as { resume?: () => Promise<void>; setMuted?: (b: boolean) => void } | undefined;

  const menuCtx: MenuCtx = {
    app,
    ground,
    setPointerLockPref: (v) => setWantLock(v, false),
    reload: () => doReload(),
    inGame: () => mode !== 'title',
    confirm: (text, ok) => new Promise<boolean>((res) => {
      const d = confirmDialog(text, ok, (r) => { d.remove(); res(r); });
      overlay.append(d);
    }),
  };

  const efb = new Efb({
    app, ground, game, checklists, menu: menuCtx,
    notify: (t) => hud.toast('EFB', t, 'info'),
    onClose: () => closeEfb(),
  });
  overlay.append(efb.el);
  const pause = pauseMenu({
    resume: () => resume(),
    efb: () => openEfb(),
    settings: () => openSub('settings'),
    help: () => openSub('help'),
    fullscreen: () => fullscreen(),
    restart: () => void menuCtx.confirm('Redémarrer la partie ? La progression sera perdue.', 'Redémarrer').then((y) => { if (y) doReload(); }),
    title: () => void menuCtx.confirm("Quitter vers l'écran titre ? La progression sera perdue.", 'Quitter').then((y) => { if (y) doReload(); }),
  }, () => game.elapsed());

  function doReload(): void {
    overlay.append(h('div', 'a3-screen a3-dim', h('div', { class: 'a3-center a3-over', style: 'font-size:14px' }, 'Rechargement…')));
    window.setTimeout(() => location.reload(), 60);
  }

  function fullscreen(): void {
    const fail = () => hud.toast('Affichage', 'Plein écran indisponible dans cette page.', 'info');
    try {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      else {
        const r = document.documentElement.requestFullscreen?.();
        if (r) r.catch(fail); else fail();
      }
    } catch { fail(); }
  }

  /* ------------------------------------------------------------------ pointer lock */
  function requestLock(): void {
    const el = canvas as HTMLCanvasElement & { requestPointerLock?: () => Promise<void> | void };
    if (typeof el.requestPointerLock !== 'function') { onLockFail(true); return; }
    try {
      const r = el.requestPointerLock();
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => onLockFail());
    } catch { onLockFail(); }
  }

  function onLockFail(unsupported = false): void {
    // Right after the player left the lock with Esc the browser refuses for ~1 s: wait for a click instead.
    if (!unsupported && now() - lastUnlockT < 1.6) { sync(); return; }
    if (!lockBroken) {
      lockBroken = true;
      if (mode === 'play') hud.toast('Affichage', `Visée (pointeur verrouillé) indisponible ici : mode curseur libre. Cliquer-glisser pour regarder, ${keyLabel('KeyC')} pour réessayer.`, 'info');
    }
    sync();
  }

  function exitLock(): void {
    if (isLocked()) { expectUnlock = true; document.exitPointerLock(); }
  }

  document.addEventListener('pointerlockerror', () => onLockFail());
  document.addEventListener('pointerlockchange', () => {
    const locked = isLocked();
    hud.setLocked(locked);
    if (locked) { lockBroken = false; sync(); return; }
    lastUnlockT = now();
    if (expectUnlock) { expectUnlock = false; sync(); return; }
    if (mode === 'play') openPause(); else sync();
  });

  function setWantLock(v: boolean, flash = true): void {
    wantLock = v;
    setUiPref('pointerLock', v);
    if (v) {
      lockBroken = false;
      if (mode === 'play') requestLock();
    } else exitLock();
    if (flash) hud.flash(v ? 'Visée' : 'Curseur libre');
    sync();
  }

  /** Interaction, HUD and cursor according to the state. */
  function sync(): void {
    const lockPending = mode === 'play' && wantLock && !lockBroken && !isLocked();
    app.interaction.enabled = mode === 'play' && !lockPending;
    hud.setVisible(mode === 'play' || mode === 'efb');
    hud.setResumeHint(lockPending);
    hud.setLocked(isLocked());
    if (mode !== 'play') hud.setHover(null);
    if (mode !== 'play' && canvas.style.cursor !== 'default') canvas.style.cursor = 'default';
  }

  /* ------------------------------------------------------------------ transitions */
  function showTitle(): void {
    mode = 'title';
    sim.paused = true;
    if (cam) cam.attract = true;
    titleEl = startScreen(menuCtx, { start: () => startGame(), help: () => openSub('help'), settings: () => openSub('settings') });
    overlay.append(titleEl);
    sync();
  }

  function startGame(): void {
    closeSub();
    titleEl?.remove();
    titleEl = null;
    if (cam) { cam.attract = false; cam.preset('normal'); }
    game.begin();
    void audio()?.resume?.();
    hud.showHints([['Souris', 'regarder'], ['Clic', 'actionner'], ['Tab', 'tablette EFB'], [keyLabel('KeyC'), 'curseur libre'], ['1-0', 'vues'], ['Échap', 'menu'], [keyLabel('KeyH'), 'aide']], 14);
    enterPlay();
  }

  function enterPlay(): void {
    mode = 'play';
    sim.paused = false;
    audio()?.setMuted?.(false);
    if (wantLock && !lockBroken && !isLocked()) requestLock();
    sync();
  }

  function openPause(subPanel?: 'settings' | 'help'): void {
    if (mode === 'title' || mode === 'end') { if (subPanel) openSub(subPanel); return; }
    if (mode === 'efb') efb.close();
    if (mode !== 'pause') {
      mode = 'pause';
      sim.paused = true;
      audio()?.setMuted?.(true);
      exitLock();
      pause.refresh();
      overlay.append(pause.el);
    }
    if (subPanel) openSub(subPanel);
    sync();
  }

  function resume(): void {
    closeSub();
    pause.el.remove();
    enterPlay();
  }

  function openSub(which: 'settings' | 'help'): void {
    closeSub();
    sub = which === 'settings'
      ? panel('Réglages', settingsForm(menuCtx), closeSub)
      : panel('Commandes', helpContent(), closeSub, true);
    overlay.append(sub);
  }

  function closeSub(): void {
    sub?.remove();
    sub = null;
  }

  function openEfb(tab?: EfbTab): void {
    if (mode === 'efb') { if (tab) efb.show(tab); return; }
    if (mode !== 'play' && mode !== 'pause') return;
    if (mode === 'pause') { closeSub(); pause.el.remove(); }
    mode = 'efb';
    exitLock();
    sim.paused = false;
    audio()?.setMuted?.(false);
    efb.open(tab);
    sync();
  }

  function closeEfb(): void {
    if (mode !== 'efb') return;
    efb.close();
    enterPlay();
  }

  function showEnd(r: GameResult): void {
    if (mode === 'efb') efb.close();
    closeSub();
    titleEl?.remove();
    titleEl = null;
    pause.el.remove();
    mode = 'end';
    exitLock();
    sim.paused = true;
    audio()?.setMuted?.(true);
    endEl?.remove();
    endEl = endScreen(r, {
      explore: () => { endEl?.remove(); endEl = null; enterPlay(); },
      restart: () => doReload(),
    });
    overlay.append(endEl);
    sync();
  }
  game.onComplete((r) => window.setTimeout(() => showEnd(r), 300));

  async function switchSeat(): Promise<void> {
    if (!cam || switching) return;
    switching = true;
    await hud.fade(true);
    cam.setSeat(cam.seat === 'capt' ? 'fo' : 'capt');
    await hud.fade(false);
    hud.flash(cam.seat === 'capt' ? 'Siège commandant' : 'Siège copilote');
    switching = false;
  }

  function goPreset(id: PresetId): void {
    if (!cam) return;
    if (id === 'efb') {
      const t = tablets.target();
      cam.efbTarget = [t[0], t[1], t[2]] as Vec3;
    }
    hud.flash(cam.preset(id));
  }

  /* ------------------------------------------------------------------ keyboard */
  const held = new Set<string>();
  const typing = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t as HTMLElement | null)?.isContentEditable;
  const presetKeys = new Map<string, PresetId>();
  for (const [k, id] of VIEW_KEYS) { presetKeys.set(`Digit${k}`, id); presetKeys.set(`Numpad${k}`, id); }

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const c = e.code;
    if (c === 'Escape') {
      e.preventDefault();
      const recent = now() - lastUnlockT < 0.4;
      if (mode === 'play') { if (!isLocked() && !recent) openPause(); }
      else if (mode === 'pause') { if (sub) closeSub(); else if (!recent) resume(); }
      else if (mode === 'efb') closeEfb();
      else if (mode === 'title') closeSub();
      return;
    }
    if (typing(e.target) && c !== 'Tab') return;
    if (c === 'Tab') {
      e.preventDefault();
      if (mode === 'play') openEfb();
      else if (mode === 'efb') closeEfb();
      return;
    }
    if (c === 'KeyH' && (mode === 'play' || mode === 'pause')) { openPause('help'); return; }
    if (mode !== 'play') return;
    if (c.startsWith('Arrow') || c === 'Space') e.preventDefault();
    held.add(c);
    if (c === 'Equal' || c === 'NumpadAdd') { cam?.zoomBy(1); return; }
    if (c === 'Minus' || c === 'NumpadSubtract') { cam?.zoomBy(-1); return; }
    if (e.repeat) return;
    const p = presetKeys.get(c);
    if (p) { goPreset(p); return; }
    switch (c) {
      case 'KeyC': setWantLock(!wantLock); break;
      case 'KeyF': void switchSeat(); break;
      case 'Space': if (cam) { cam.resetZoom(); goPreset('normal'); } break;
    }
  });
  window.addEventListener('keyup', (e) => held.delete(e.code));
  window.addEventListener('blur', () => held.clear());

  /* ------------------------------------------------------------------ mouse */
  let drag: { id: number } | null = null;
  let synthetic = false;
  const clampPx = (v: number) => Math.max(-250, Math.min(250, v));

  document.addEventListener('mousemove', (e) => {
    if (mode !== 'play') return;
    if (isLocked()) { if (!app.interaction.capturing) cam?.look(clampPx(e.movementX), clampPx(e.movementY)); }
    else hud.setMouse(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointerdown', (e) => {
    if (synthetic || mode !== 'play' || isLocked()) return;
    if (wantLock && !lockBroken) { e.preventDefault(); requestLock(); return; }
    if (e.defaultPrevented) return; // a control was hit (kit interaction)
    drag = { id: e.pointerId };
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', (e) => {
    if (drag && e.pointerId === drag.id) cam?.look(clampPx(e.movementX), clampPx(e.movementY));
  });
  const endDrag = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  let wheelAcc = 0;
  canvas.addEventListener('wheel', (e) => {
    if (mode !== 'play' || e.defaultPrevented || app.interaction.wheelConsumed()) return;
    e.preventDefault();
    wheelAcc += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    while (wheelAcc <= -60) { cam?.zoomBy(1); wheelAcc += 60; }
    while (wheelAcc >= 60) { cam?.zoomBy(-1); wheelAcc -= 60; }
  }, { passive: false });

  /* ------------------------------------------------------------------ gamepad (optional) */
  let gpIndex = -1;
  const gpPrev: boolean[] = [];
  let gpLook: [number, number] = [0, 0];
  let gpLean: Vec3 = [0, 0, 0];
  let gpBrake: [number, number] = [0, 0];
  window.addEventListener('gamepadconnected', (e) => {
    gpIndex = (e as GamepadEvent).gamepad.index;
    hud.toast('Manette', 'Manette détectée : stick droit pour regarder, A pour actionner, Y pour la tablette.', 'info');
  });
  window.addEventListener('gamepaddisconnected', () => { gpIndex = -1; gpLook = [0, 0]; gpLean = [0, 0, 0]; gpBrake = [0, 0]; });

  function synth(type: 'pointerdown' | 'pointerup', button: number): void {
    const r = canvas.getBoundingClientRect();
    if (!isLocked()) app.interaction.mouse.set(0, 0);
    synthetic = true;
    try {
      const ev = new PointerEvent(type, { button, buttons: type === 'pointerdown' ? (button === 2 ? 2 : 1) : 0, bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 77, pointerType: 'mouse' });
      (type === 'pointerdown' ? canvas : window).dispatchEvent(ev);
    } finally { synthetic = false; }
  }

  function pollGamepad(): void {
    if (gpIndex < 0 || typeof navigator.getGamepads !== 'function') return;
    const gp = navigator.getGamepads()[gpIndex];
    if (!gp) return;
    const dz = (v = 0) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
    gpLook = [-dz(gp.axes[2]), -dz(gp.axes[3])];
    gpLean = [dz(gp.axes[0]), 0, -dz(gp.axes[1])];
    gpBrake = [gp.buttons[6]?.value ?? 0, gp.buttons[7]?.value ?? 0];
    const edge = (i: number) => { const p = !!gp.buttons[i]?.pressed; const was = !!gpPrev[i]; gpPrev[i] = p; return p && !was ? 1 : !p && was ? -1 : 0; };
    const a = edge(0), b = edge(1), lb = edge(4), rb = edge(5), y = edge(3), start = edge(9), back = edge(8), l3 = edge(10);
    const up = edge(12), down = edge(13), left = edge(14), right = edge(15);
    if (start === 1) { if (mode === 'play') openPause(); else if (mode === 'pause') resume(); }
    if (y === 1) { if (mode === 'play') openEfb(); else if (mode === 'efb') closeEfb(); }
    if (mode !== 'play') return;
    if (a) synth(a > 0 ? 'pointerdown' : 'pointerup', 0);
    if (b) synth(b > 0 ? 'pointerdown' : 'pointerup', 2);
    if (lb === 1 || rb === 1) canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: rb === 1 ? -100 : 100, bubbles: true, cancelable: true }));
    if (back === 1) goPreset('normal');
    if (l3 === 1) void switchSeat();
    if (up === 1) goPreset('overhead');
    if (down === 1) goPreset('pedestal');
    if (left === 1) goPreset('left');
    if (right === 1) goPreset('right');
  }

  /* ------------------------------------------------------------------ rudder / toe brakes */
  let rudder = 0;
  let brakes: [number, number] = [0, 0];
  function axes(dt: number): void {
    if (mode !== 'play') return;
    const rT = (held.has('Numpad0') ? -1 : 0) + (held.has('NumpadEnter') ? 1 : 0);
    if (rT !== 0 || rudder !== 0) {
      const step = 2.5 * dt;
      rudder = Math.abs(rT - rudder) <= step ? rT : rudder + Math.sign(rT - rudder) * step;
      sim.set('C:RUDDER', Math.round(rudder * 1000) / 1000);
    }
    const kb = held.has('KeyB') ? 1 : 0;
    const bl = Math.max(kb, gpBrake[0]), br = Math.max(kb, gpBrake[1]);
    if (bl !== brakes[0] || br !== brakes[1]) {
      brakes = [bl, br];
      sim.set('C:BRAKE_L', bl);
      sim.set('C:BRAKE_R', br);
    }
  }

  /* ------------------------------------------------------------------ hover → HUD */
  let hoverDirty = true;
  let hoverAcc = 0;
  app.interaction.onHoverChange(() => { hoverDirty = true; });
  function hover(dt: number): void {
    if (mode !== 'play') return;
    hoverAcc += dt;
    if (!hoverDirty && hoverAcc < 0.15) return;
    hoverAcc = 0;
    hoverDirty = false;
    const hv = app.interaction.hovered;
    hud.setHover(app.interaction.hoverInfo(), hv?.cursor);
    if (!isLocked()) {
      const cur = drag ? 'grabbing' : hv ? cursorFor(hv.cursor) : 'default';
      if (canvas.style.cursor !== cur) canvas.style.cursor = cur;
    }
  }

  /* ------------------------------------------------------------------ frame */
  let pauseAcc = 0;
  app.onFrame((dt) => {
    pollGamepad();
    if (cam) {
      const k = (c: string) => (held.has(c) ? 1 : 0);
      const play = mode === 'play';
      cam.lean[0] = play ? k('KeyD') - k('KeyA') + gpLean[0] : 0;
      cam.lean[1] = play ? k('KeyE') - k('KeyQ') : 0;
      cam.lean[2] = play ? k('KeyW') - k('KeyS') + gpLean[2] : 0;
      cam.lookRate[0] = play ? k('ArrowLeft') - k('ArrowRight') + gpLook[0] : 0;
      cam.lookRate[1] = play ? k('ArrowUp') - k('ArrowDown') + gpLook[1] : 0;
      cam.update(dt);
    }
    tablets.update(dt);
    efb.update(dt);
    hud.frame(dt);
    hud.setBusy(app.interaction.capturing);
    hover(dt);
    axes(dt);
    if (mode === 'pause') { pauseAcc += dt; if (pauseAcc > 1) { pauseAcc = 0; pause.refresh(); } }
  }, -50);

  app.settings.onChange((s, key) => {
    if (key === 'tooltips') { hud.tooltips = s.tooltips; hoverDirty = true; }
    if (key === 'showFps') hud.setFps(s.showFps);
  });

  ground.onMessage((m) => {
    hud.toast(SPEAKERS[m.from], m.text, m.level);
    if (m.call) sim.emit('fwc:sound', { sound: 'BUZZER', duration: 0.45 });
  });

  /* ------------------------------------------------------------------ start-up */
  const pace = q.get('ui.pace');
  ground.setPace(pace === 'fast' || pace === 'real' ? pace : uiPrefs().groundPace);
  if (q.get('ui.gate') === '1') ground.debug.gateReady();
  const menuParam = q.get('ui.menu');
  if (menuParam === '0' || (app.isHarness && menuParam !== '1')) {
    mode = 'play';
    sim.paused = false;
    game.begin();
    sync();
  } else showTitle();
  if (cam && q.get('ui.fo') === '1') cam.setSeat('fo');
  const view = q.get('ui.view') as PresetId | null;
  if (cam && view && VIEW_KEYS.some(([, id]) => id === view)) {
    if (view === 'efb') cam.efbTarget = tablets.target();
    cam.preset(view, true);
  }
  const efbTab = q.get('ui.efb');
  if (efbTab && mode === 'play') openEfb(efbTab as EfbTab);
  if (q.get('ui.pause') === '1') openPause();
  if (q.get('ui.help') === '1') openPause('help');
  if (q.get('ui.settings') === '1') openPause('settings');
  if (q.get('ui.end') === '1') game.forceComplete();

  (window as unknown as { __ui: unknown }).__ui = {
    mode: () => mode,
    startGame, openEfb, closeEfb, openPause, resume, showTitle,
    help: () => openPause('help'),
    settings: () => openPause('settings'),
    end: () => game.forceComplete(),
    preset: (id: PresetId) => cam?.preset(id, true),
    seat: (s: 'capt' | 'fo') => cam?.setSeat(s),
    pose: () => cam?.pose(),
    fitTablets: () => tablets.fit(),
    cam, efb, hud, ground, game, checklists,
  };
}
