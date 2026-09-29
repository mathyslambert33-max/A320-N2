/**
 * In-game HUD (owner: ui): crosshair, control tooltip, FPS counter, crew message toasts, view-name flash,
 * screen fades. Everything is pointer-events: none; text is only touched when it changes.
 */
import { getControl } from '../core/catalog';
import type { HandleInfo } from '../cockpit/kit/interaction';
import { h, setText, toggleClass } from './dom';

/** How to operate a control (French), from its catalog kind. */
export function controlHint(id: string | undefined, cursor?: string): string {
  if (!id) return '';
  if (id.endsWith('_GUARD')) return 'Clic : ouvrir / fermer le cache';
  if (id.startsWith('EFB_TABLET')) return 'Clic : ouvrir la tablette (touche Tab)';
  const k = getControl(id)?.kind;
  switch (k) {
    case 'pb': return 'Clic : enfoncer / relâcher';
    case 'pbm': return 'Clic : appuyer (maintenir pour un appui long)';
    case 'sw': return 'Clic G : position haute · Clic D : position basse · Molette';
    case 'swm': return 'Clic G / D : maintenir (retour par ressort)';
    case 'rot': case 'rotm': return 'Molette ou clic D : sens horaire · Clic G : anti-horaire';
    case 'pot': return 'Molette ou glisser : régler';
    case 'lever': return 'Glisser ou molette : déplacer (crans)';
    case 'key': return 'Clic : appuyer';
    case 'axis': return 'Glisser';
    case 'enc': return '';
    default: return cursor === 'drag' ? 'Glisser ou molette' : cursor === 'rotate' ? 'Molette : tourner' : '';
  }
}

const ROT_SVG = '<path d="M9 6.2a9 9 0 0 1 12 0"/><path d="M21 6.2l-.4-3M21 6.2l-3 .5"/><path d="M21 23.8a9 9 0 0 1-12 0"/><path d="M9 23.8l.4 3M9 23.8l3-.5"/>';
const DRAG_SVG = '<path d="M15 4v22"/><path d="M11 8l4-4 4 4M11 22l4 4 4-4"/>';
const TOG_SVG = '<path d="M10 11l5-5 5 5M10 19l5 5 5-5"/>';

export class Hud {
  readonly el: HTMLElement;
  private xh: HTMLElement;
  private tip: HTMLElement;
  private tipN: HTMLElement;
  private tipS: HTMLElement;
  private tipFr: HTMLElement;
  private tipK: HTMLElement;
  private fps: HTMLElement;
  private toasts: HTMLElement;
  private flashEl: HTMLElement;
  private resumeEl: HTMLElement;
  private hintsEl: HTMLElement;
  private fadeEl: HTMLElement;
  private locked = false;
  private hoverKey = '';
  private tipShown = false;
  private mx = 0;
  private my = 0;
  private fpsAcc = 0;
  private fpsN = 0;
  private flashT = 0;
  tooltips = true;
  showFps = false;

  constructor(root: HTMLElement) {
    this.el = h('div', { class: 'a3-root', attrs: { id: 'a3-hud' } });
    const svg = (cls: string, d: string) => `<svg class="${cls}" viewBox="0 0 30 30">${d}</svg>`;
    this.xh = h('div', { class: 'a3-xh a3-hidden', html: `<div class="ring"></div><div class="dot"></div>${svg('rot', ROT_SVG)}${svg('drag', DRAG_SVG)}${svg('tog', TOG_SVG)}` });
    this.tipN = h('span', 'n');
    this.tipS = h('span', 's');
    this.tipFr = h('div', 'fr');
    this.tipK = h('div', 'k');
    this.tip = h('div', 'a3-tip', h('div', null, this.tipN, this.tipS), this.tipFr, this.tipK);
    this.fps = h('div', 'a3-fps a3-hidden');
    this.toasts = h('div', 'a3-toasts');
    this.flashEl = h('div', 'a3-flash');
    this.resumeEl = h('div', 'a3-resume a3-hidden', 'Cliquez dans la vue pour reprendre la visée');
    this.hintsEl = h('div', 'a3-hints a3-hidden');
    this.fadeEl = h('div', 'a3-fade');
    this.el.append(this.xh, this.tip, this.fps, this.toasts, this.flashEl, this.resumeEl, this.hintsEl);
    root.append(this.el, this.fadeEl);
  }

  setVisible(v: boolean): void {
    toggleClass(this.el, 'a3-hidden', !v);
  }

  setLocked(locked: boolean): void {
    this.locked = locked;
    toggleClass(this.xh, 'a3-hidden', !locked);
    this.placeTip();
  }

  /** Crosshair "held" style while a control captures the mouse. */
  setBusy(b: boolean): void {
    toggleClass(this.xh, 'busy', b);
  }

  setMouse(x: number, y: number): void {
    this.mx = x;
    this.my = y;
    if (!this.locked && this.tipShown) this.placeTip();
  }

  private placeTip(): void {
    const x = this.locked ? window.innerWidth / 2 + 22 : this.mx + 18;
    const y = this.locked ? window.innerHeight / 2 + 20 : this.my + 20;
    // keep on screen
    const w = this.tip.offsetWidth || 240, hh = this.tip.offsetHeight || 60;
    const cx = Math.min(x, window.innerWidth - w - 8);
    const cy = y + hh > window.innerHeight - 8 ? y - hh - 36 : y;
    this.tip.style.transform = `translate(${Math.round(cx)}px, ${Math.round(cy)}px)`;
  }

  /** Update the hovered control (null = none). Cheap when nothing changed. */
  setHover(info: HandleInfo | null, cursor?: string): void {
    const cls = info ? `hover c-${cursor ?? 'push'}` : '';
    if (this.xh.dataset.c !== cls) {
      this.xh.dataset.c = cls;
      this.xh.classList.remove('hover', 'c-push', 'c-toggle', 'c-rotate', 'c-drag', 'c-key');
      if (info) this.xh.classList.add('hover', `c-${cursor ?? 'push'}`);
    }
    const show = !!info && this.tooltips;
    if (!show) {
      if (this.tipShown) { this.tip.classList.remove('show'); this.tipShown = false; this.hoverKey = ''; }
      return;
    }
    const enc = info!.id ? getControl(info!.id)?.kind === 'enc' : false;
    const state = enc ? '' : (info!.state ?? '');
    const hint = enc ? (info!.state ?? '').replace(/ = /g, ' : ').replace(/clic G/g, 'clic gauche').replace(/clic D/g, 'clic droit') : controlHint(info!.id, cursor);
    const key = `${info!.name}|${state}|${info!.fr ?? ''}|${hint}`;
    if (key !== this.hoverKey) {
      this.hoverKey = key;
      setText(this.tipN, info!.name);
      setText(this.tipS, state);
      setText(this.tipFr, info!.fr ?? '');
      setText(this.tipK, hint);
      this.placeTip();
    }
    if (!this.tipShown) { this.tip.classList.add('show'); this.tipShown = true; this.placeTip(); }
  }

  frame(dt: number): void {
    if (this.showFps) {
      this.fpsAcc += dt;
      this.fpsN++;
      if (this.fpsAcc >= 0.5) {
        const f = this.fpsN / this.fpsAcc;
        setText(this.fps, `${f.toFixed(0)} FPS · ${(1000 / f).toFixed(1)} ms`);
        this.fpsAcc = 0;
        this.fpsN = 0;
      }
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.flashEl.classList.remove('show');
    }
  }

  setFps(on: boolean): void {
    this.showFps = on;
    toggleClass(this.fps, 'a3-hidden', !on);
  }

  flash(text: string, s = 1.6): void {
    setText(this.flashEl, text);
    this.flashEl.classList.add('show');
    this.flashT = s;
  }

  setResumeHint(on: boolean): void {
    toggleClass(this.resumeEl, 'a3-hidden', !on);
  }

  /** Short key reminder at the bottom, fades out after `s` seconds. */
  showHints(items: Array<[string, string]>, s = 12): void {
    this.hintsEl.replaceChildren(...items.map(([k, t]) => h('span', null, h('b', null, k), t)));
    this.hintsEl.classList.remove('a3-hidden', 'fade');
    window.setTimeout(() => this.hintsEl.classList.add('fade'), s * 1000);
    window.setTimeout(() => this.hintsEl.classList.add('a3-hidden'), s * 1000 + 900);
  }

  toast(who: string, text: string, level: 'info' | 'ok' | 'warn' = 'info'): void {
    const t = h('div', `a3-toast ${level}`, h('div', 'col', h('div', 'who', who), h('div', 'txt', text)));
    this.toasts.append(t);
    while (this.toasts.children.length > 4) this.toasts.firstElementChild?.remove();
    const life = level === 'warn' ? 11000 : 8000;
    window.setTimeout(() => {
      t.classList.add('out');
      window.setTimeout(() => t.remove(), 480);
    }, life);
  }

  /** Fade to black (true) or back (false); resolves when done. */
  fade(on: boolean): Promise<void> {
    toggleClass(this.fadeEl, 'on', on);
    return new Promise((r) => window.setTimeout(r, 300));
  }
}
