/**
 * Text atlas shared by every pushbutton legend, annunciator and key label: one canvas texture,
 * cells allocated on demand with a shelf packer. Text is drawn white on black; colour is applied
 * by the materials (diffuse tint when unlit, emissive when lit).
 */
import * as THREE from 'three';
import { FONT } from '../../displays/framework';

const SIZE = 2048;

export interface AtlasCell {
  /** UV rect: u0, v0 (bottom-left), u1, v1 (top-right). */
  u0: number; v0: number; u1: number; v1: number;
}

export type AtlasStyle = 'legend' | 'key' | 'keySmall' | 'bar' | 'engraved';

class TextAtlas {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  private cells = new Map<string, AtlasCell>();
  private shelfY = 0;
  private shelfH = 0;
  private cursorX = 0;
  private dirty = false;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, SIZE, SIZE);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.generateMipmaps = true;
  }

  /**
   * Get (or render) a cell for `lines` of text. `aspect` = width / height of the physical legend area.
   * Height in px is chosen from the number of lines.
   */
  cell(lines: string[], aspect: number, style: AtlasStyle = 'legend'): AtlasCell {
    const key = `${style}|${aspect.toFixed(2)}|${lines.join('\n')}`;
    const hit = this.cells.get(key);
    if (hit) return hit;
    const h = style === 'bar' ? 32 : lines.length > 1 ? 128 : 64;
    const w = Math.min(512, Math.max(16, Math.round(h * aspect)));
    if (this.cursorX + w + 2 > SIZE) { this.shelfY += this.shelfH + 2; this.cursorX = 0; this.shelfH = 0; }
    if (this.shelfY + h + 2 > SIZE) {
      console.warn('[atlas] full');
      return { u0: 0, v0: 0, u1: 0.001, v1: 0.001 };
    }
    const x = this.cursorX, y = this.shelfY;
    this.cursorX += w + 2;
    this.shelfH = Math.max(this.shelfH, h);
    this.draw(lines, x, y, w, h, style);
    const c: AtlasCell = { u0: x / SIZE, u1: (x + w) / SIZE, v0: 1 - (y + h) / SIZE, v1: 1 - y / SIZE };
    this.cells.set(key, c);
    this.dirty = true;
    return c;
  }

  private draw(lines: string[], x: number, y: number, w: number, h: number, style: AtlasStyle) {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = '#000';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#fff';
    const text = lines.join('');
    if (style === 'bar' || text === '▬') {
      // Airbus "selected" bar: a short thick horizontal bar (FCU/EFIS/ECP pushbuttons)
      const bw = w * 0.5, bh = h * 0.28;
      ctx.fillRect(x + (w - bw) / 2, y + (h - bh) / 2, bw, bh);
      ctx.restore();
      return;
    }
    if (text === '▼') {
      // green down-lock triangle
      ctx.beginPath();
      ctx.moveTo(x + w * 0.25, y + h * 0.2);
      ctx.lineTo(x + w * 0.75, y + h * 0.2);
      ctx.lineTo(x + w * 0.5, y + h * 0.85);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      return;
    }
    const n = lines.length;
    const lineH = h / n;
    const family = style === 'legend' ? FONT.du : FONT.panel;
    const weight = style === 'legend' ? 700 : 600;
    for (let i = 0; i < n; i++) {
      const s = lines[i];
      let px = lineH * (style === 'keySmall' ? 0.5 : 0.66);
      ctx.font = `${weight} ${px}px ${family}`;
      const mw = ctx.measureText(s).width;
      const maxW = w * 0.9;
      if (mw > maxW) { px *= maxW / mw; ctx.font = `${weight} ${px}px ${family}`; }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(s, x + w / 2, y + lineH * (i + 0.5) + px * 0.04);
    }
    ctx.restore();
  }

  flush() {
    if (this.dirty) {
      this.texture.needsUpdate = true;
      this.dirty = false;
    }
  }
}

let _atlas: TextAtlas | null = null;
export function atlas(): TextAtlas {
  return (_atlas ??= new TextAtlas());
}

/** Plane geometry (w x h metres, centred) whose UVs map to an atlas cell. */
export function cellPlane(w: number, h: number, cell: AtlasCell): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    uv.setXY(i, cell.u0 + (cell.u1 - cell.u0) * u, cell.v0 + (cell.v1 - cell.v0) * v);
  }
  uv.needsUpdate = true;
  return g;
}
