/** Self-hosted fonts (no network needed). B612 = the typeface Airbus designed for cockpit displays. */
import '@fontsource/b612/400.css';
import '@fontsource/b612/700.css';
import '@fontsource/b612-mono/400.css';
import '@fontsource/b612-mono/700.css';
import '@fontsource/barlow-semi-condensed/500.css';
import '@fontsource/barlow-semi-condensed/600.css';

/** Resolves once the fonts used by canvases are loaded. */
export async function loadFonts(): Promise<void> {
  if (typeof document === 'undefined' || !(document as any).fonts) return;
  const f = (document as any).fonts as FontFaceSet;
  await Promise.all([
    f.load('400 20px B612'), f.load('700 20px B612'),
    f.load('400 20px "B612 Mono"'), f.load('700 20px "B612 Mono"'),
    f.load('500 20px "Barlow Semi Condensed"'), f.load('600 20px "Barlow Semi Condensed"'),
  ]).catch(() => undefined);
}
