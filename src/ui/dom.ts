/** Tiny DOM helpers for the UI overlays (owner: ui). */

type Child = Node | string | number | null | undefined | false;
type Props = {
  class?: string;
  style?: string;
  title?: string;
  html?: string;
  on?: Partial<Record<keyof HTMLElementEventMap, (ev: any) => void>>;
  data?: Record<string, string>;
  attrs?: Record<string, string>;
};

/** Create an element: h('div', 'a3-card', child…) or h('button', { class, on: { click } }, 'Label'). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | string | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (typeof props === 'string') el.className = props;
  else if (props) {
    if (props.class) el.className = props.class;
    if (props.style) el.setAttribute('style', props.style);
    if (props.title) el.title = props.title;
    if (props.html !== undefined) el.innerHTML = props.html;
    if (props.on) for (const [k, fn] of Object.entries(props.on)) if (fn) el.addEventListener(k, fn as EventListener);
    if (props.data) for (const [k, v] of Object.entries(props.data)) el.dataset[k] = v;
    if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'number' ? String(c) : c);
  }
  return el;
}

/** Set text only when it changed (avoids layout work every frame). */
export function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function toggleClass(el: Element, cls: string, on: boolean): void {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

/** Inline SVG from a path list (24×24 viewBox, stroked). */
export function icon(paths: string, cls = 'a3-ico'): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = paths;
  return svg;
}

export const ICONS = {
  ofp: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 11h7M9 15h7M9 19h4"/>',
  load: '<path d="M4 20h16M6 20l2-11h8l2 11"/><circle cx="12" cy="6" r="2.5"/>',
  perf: '<path d="M3 17h18"/><path d="M5 17c2-6 7-10 14-11"/><path d="M15 5l4 1-2 3.5"/>',
  wx: '<path d="M7 18h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.2A3.5 3.5 0 0 0 7 18z"/>',
  check: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 9l2 2 4-4M8 15h8"/>',
  sop: '<path d="M4 5c3-1.5 5.5-1.5 8 0 2.5-1.5 5-1.5 8 0v14c-3-1.5-5.5-1.5-8 0-2.5-1.5-5-1.5-8 0z"/><path d="M12 5v14"/>',
  ground: '<path d="M3 16h11V8H3zM14 11h4l3 3v2h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  plane: '<path d="M21 12l-8-5V3.5a1 1 0 0 0-2 0V7l-8 5v2l8-2.5V17l-2 1.5V20l3-1 3 1v-1.5L13 17v-5.5l8 2.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
};
