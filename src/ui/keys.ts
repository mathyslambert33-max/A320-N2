/**
 * Keyboard mapping (owner: ui). Actions are bound to physical key positions (`KeyboardEvent.code`) so that
 * WASD on QWERTY and ZQSD on AZERTY both work; the help shows the labels of the player's layout.
 */

const AZERTY: Record<string, string> = { KeyW: 'Z', KeyA: 'Q', KeyQ: 'A', KeyZ: 'W', Semicolon: 'M', KeyM: ',' };

let labels: Record<string, string> = {};
let azerty = typeof navigator !== 'undefined' && /^fr/i.test(navigator.language ?? '') && !/^fr-(CA|CH)/i.test(navigator.language ?? '');

/** Label of a physical key on the current layout. */
export function keyLabel(code: string): string {
  if (labels[code]) return labels[code];
  if (azerty && AZERTY[code]) return AZERTY[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

/** Refine the labels with the Keyboard Map API when the browser exposes it (Chromium). */
export async function detectLayout(): Promise<void> {
  try {
    const kb = (navigator as unknown as { keyboard?: { getLayoutMap(): Promise<Map<string, string>> } }).keyboard;
    if (!kb?.getLayoutMap) return;
    const map = await kb.getLayoutMap();
    const next: Record<string, string> = {};
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyC', 'KeyF', 'KeyB', 'KeyH', 'KeyZ']) {
      const v = map.get(code);
      if (v) next[code] = v.toUpperCase();
    }
    labels = next;
    azerty = next.KeyW === 'Z';
  } catch { /* not allowed (e.g. in a frame) */ }
}

/** "Z Q S D" or "W A S D". */
export function leanKeys(): string {
  return ['KeyW', 'KeyA', 'KeyS', 'KeyD'].map(keyLabel).join(' ');
}

/** Preset views on the number keys. */
export const VIEW_KEYS: Array<[string, import('./view').PresetId, string]> = [
  ['1', 'normal', 'Vue normale'],
  ['2', 'overhead', 'Panneau supérieur (2× : ADIRS)'],
  ['3', 'pedestal', 'Pylône : MCDU (2× : manettes, 3× : arrière)'],
  ['4', 'ecam', 'ECAM'],
  ['5', 'fcu', 'FCU / EFIS'],
  ['6', 'other', 'Planche de bord opposée'],
  ['7', 'left', 'Regard à gauche'],
  ['8', 'right', 'Regard à droite'],
  ['9', 'door', 'Porte du poste (arrière)'],
  ['0', 'efb', 'Tablette EFB'],
];
