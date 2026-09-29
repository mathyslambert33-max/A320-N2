/**
 * MCDU screen model: 14 lines x 24 columns (title, 6 x [label, data], scratchpad). DOM-free.
 *
 * Markup accepted by the writers: `{w}` white `{g}` green `{c}` cyan `{a}` amber `{m}` magenta `{y}` yellow
 * `{s}` small font `{l}` large font. Special characters: '□' amber box, '←' '→' '↑' '↓' arrows, '°', 'Δ' overfly.
 */

export type Color = 'w' | 'g' | 'c' | 'a' | 'm' | 'y';

export interface Cell {
  ch: string;
  c: Color;
  small: boolean;
}

export const COLS = 24;
export const ROWS = 14;

/** Row of the label line above LSK n (1..6). */
export const lblRow = (n: number) => n * 2 - 1;
/** Row of the data line of LSK n (1..6). */
export const datRow = (n: number) => n * 2;

interface Seg { text: string; c: Color; small: boolean }

export function parseMarkup(m: string, c: Color, small: boolean): Seg[] {
  const out: Seg[] = [];
  let cur: Seg = { text: '', c, small };
  const re = /\{([wgcamysl])\}/g;
  let last = 0;
  let r: RegExpExecArray | null;
  while ((r = re.exec(m))) {
    cur.text += m.slice(last, r.index);
    if (cur.text) out.push(cur);
    const k = r[1];
    cur = { text: '', c: cur.c, small: cur.small };
    if (k === 's') cur.small = true;
    else if (k === 'l') cur.small = false;
    else cur.c = k as Color;
    last = re.lastIndex;
  }
  cur.text += m.slice(last);
  if (cur.text) out.push(cur);
  return out;
}

export const visibleLength = (m: string) => m.replace(/\{[wgcamysl]\}/g, '').length;

export class Screen {
  cells: (Cell | null)[][] = [];

  constructor() {
    this.clear();
  }

  clear(): void {
    this.cells = Array.from({ length: ROWS }, () => new Array<Cell | null>(COLS).fill(null));
  }

  /** Write markup at a column. Label rows (odd 1..11) default to small font. */
  text(row: number, col: number, markup: string, c: Color = 'w', small?: boolean): void {
    if (row < 0 || row >= ROWS) return;
    const sm = small ?? (row % 2 === 1 && row < 12);
    let x = col;
    for (const seg of parseMarkup(markup, c, sm)) {
      for (const ch of seg.text) {
        if (x >= 0 && x < COLS) this.cells[row][x] = ch === ' ' ? null : { ch, c: seg.c, small: seg.small };
        x++;
      }
    }
  }

  left(row: number, markup: string, c: Color = 'w', small?: boolean): void {
    this.text(row, 0, markup, c, small);
  }

  right(row: number, markup: string, c: Color = 'w', small?: boolean): void {
    this.text(row, COLS - visibleLength(markup), markup, c, small);
  }

  center(row: number, markup: string, c: Color = 'w', small?: boolean): void {
    this.text(row, Math.floor((COLS - visibleLength(markup)) / 2), markup, c, small);
  }

  /** Text of a line (spaces for empty cells). */
  line(row: number): string {
    return this.cells[row].map((c) => (c ? c.ch : ' ')).join('');
  }

  lines(): string[] {
    return this.cells.map((_, i) => this.line(i));
  }

  /** Colour of the first non-space character of `needle` in a row (tests). */
  colorOf(row: number, needle: string): Color | undefined {
    const i = this.line(row).indexOf(needle);
    return i >= 0 ? this.cells[row][i]?.c : undefined;
  }

  smallAt(row: number, col: number): boolean {
    return !!this.cells[row][col]?.small;
  }
}
