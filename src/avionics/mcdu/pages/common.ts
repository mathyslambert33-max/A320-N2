/**
 * Helpers shared by MCDU pages.
 */
import { datRow, lblRow, type Color } from '../mcdu/screen';
import type { View } from '../mcdu/mcdu';
import { CLR } from '../mcdu/mcdu';
import { MSG, type McduMessage, isMsg } from '../mcdu/format';

export { CLR };

export const title = (v: View, text: string, c: Color = 'w') => v.s.center(0, text, c, false);
/** Label (small) above LSK n, left / right. */
export const lblL = (v: View, n: number, text: string, c: Color = 'w') => v.s.left(lblRow(n), text, c, true);
export const lblR = (v: View, n: number, text: string, c: Color = 'w') => v.s.right(lblRow(n), text, c, true);
export const lblC = (v: View, n: number, text: string, c: Color = 'w') => v.s.center(lblRow(n), text, c, true);
/** Data line of LSK n (large font unless markup says {s}). */
export const datL = (v: View, n: number, text: string, c: Color = 'w', small = false) => v.s.left(datRow(n), text, c, small);
export const datR = (v: View, n: number, text: string, c: Color = 'w', small = false) => v.s.right(datRow(n), text, c, small);
export const datC = (v: View, n: number, text: string, c: Color = 'w', small = false) => v.s.center(datRow(n), text, c, small);
export const datAt = (v: View, n: number, col: number, text: string, c: Color = 'w', small = false) => v.s.text(datRow(n), col, text, c, small);
export const lblAt = (v: View, n: number, col: number, text: string, c: Color = 'w') => v.s.text(lblRow(n), col, text, c, true);

/** Apply a parser result: returns the message, or calls `set` with the value. */
export function apply<T>(r: T | McduMessage, set: (v: T) => void): McduMessage | void {
  if (isMsg(r)) return r;
  set(r as T);
}

/** Handler guard: entries on fields that cannot be cleared. */
export function noClr(sp: string): McduMessage | void {
  if (sp === CLR) return MSG.NOT_ALLOWED;
}

export const dashes = (n: number) => '-'.repeat(n);
