/** CSS of the UI overlays (owner: ui), injected once. Prefix `a3-`. */
export const CSS = String.raw`
:root {
  --a3-f-ui: "B612", system-ui, -apple-system, "Segoe UI", sans-serif;
  --a3-f-head: "Barlow Semi Condensed", "B612", system-ui, sans-serif;
  --a3-f-mono: "B612 Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
  --a3-bg: #070a0e;
  --a3-panel: rgba(12, 17, 23, 0.94);
  --a3-panel-2: rgba(19, 26, 34, 0.96);
  --a3-line: rgba(150, 180, 210, 0.13);
  --a3-line-2: rgba(150, 180, 210, 0.26);
  --a3-text: #e7edf3;
  --a3-dim: #97a5b3;
  --a3-faint: #627181;
  --a3-cyan: #4fd1ff;
  --a3-cyan-d: #1f89b3;
  --a3-green: #3ddc84;
  --a3-amber: #ffb224;
  --a3-red: #ff5d52;
}
.a3-root, .a3-root * { box-sizing: border-box; }
.a3-root { font-family: var(--a3-f-ui); color: var(--a3-text); -webkit-font-smoothing: antialiased; }
.a3-hidden { display: none !important; }
.a3-ico { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; flex: none; }

/* ------------------------------------------------------------------ HUD */
#a3-hud { position: fixed; inset: 0; pointer-events: none; z-index: 40; overflow: hidden; }
.a3-xh { position: absolute; left: 50%; top: 50%; width: 30px; height: 30px; margin: -15px 0 0 -15px; }
.a3-xh .dot { position: absolute; left: 50%; top: 50%; width: 4px; height: 4px; margin: -2px 0 0 -2px; border-radius: 50%;
  background: rgba(255,255,255,.92); box-shadow: 0 0 0 1px rgba(0,0,0,.55), 0 0 6px rgba(0,0,0,.5); transition: transform .12s; }
.a3-xh .ring { position: absolute; inset: 5px; border-radius: 50%; border: 1.6px solid rgba(255,255,255,.95);
  box-shadow: 0 0 0 1px rgba(0,0,0,.45), inset 0 0 0 1px rgba(0,0,0,.35); opacity: 0; transform: scale(.6); transition: opacity .12s, transform .12s; }
.a3-xh svg { position: absolute; inset: 0; width: 30px; height: 30px; opacity: 0; transition: opacity .12s; stroke: #fff; fill: none; stroke-width: 1.8;
  filter: drop-shadow(0 0 1.5px rgba(0,0,0,.9)); }
.a3-xh.hover .ring { opacity: 1; transform: scale(1); }
.a3-xh.hover .dot { transform: scale(.8); }
.a3-xh.hover.c-rotate svg.rot, .a3-xh.hover.c-drag svg.drag, .a3-xh.hover.c-toggle svg.tog { opacity: 1; }
.a3-xh.hover.c-rotate .ring, .a3-xh.hover.c-drag .ring, .a3-xh.hover.c-toggle .ring { opacity: 0; }
.a3-xh.busy .ring { border-color: var(--a3-cyan); }
.a3-tip { position: absolute; left: 0; top: 0; max-width: 360px; padding: 7px 10px 8px; border-radius: 6px;
  background: rgba(8, 12, 17, .82); border: 1px solid rgba(255,255,255,.1); box-shadow: 0 6px 18px rgba(0,0,0,.35);
  backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); will-change: transform; opacity: 0; transition: opacity .1s; }
.a3-tip.show { opacity: 1; }
.a3-tip .n { font: 600 14px/1.2 var(--a3-f-head); letter-spacing: .05em; text-transform: uppercase; color: #fff; }
.a3-tip .s { display: inline-block; margin-left: 8px; padding: 1px 6px; border-radius: 3px; font: 700 11px/1.35 var(--a3-f-mono);
  color: var(--a3-cyan); background: rgba(79, 209, 255, .12); border: 1px solid rgba(79, 209, 255, .3); vertical-align: 1px; }
.a3-tip .s:empty { display: none; }
.a3-tip .fr { margin-top: 3px; font-size: 12px; line-height: 1.35; color: #c9d3dc; }
.a3-tip .fr:empty { display: none; }
.a3-tip .k { margin-top: 4px; font-size: 10.5px; color: var(--a3-dim); letter-spacing: .01em; }
.a3-tip .k:empty { display: none; }
.a3-fps { position: absolute; left: 10px; top: 8px; font: 11px/1 var(--a3-f-mono); color: #9fdc9f; background: rgba(0,0,0,.45);
  padding: 4px 6px; border-radius: 4px; }
.a3-toasts { position: absolute; right: 16px; top: 16px; width: 380px; display: flex; flex-direction: column; gap: 8px; align-items: stretch; }
.a3-toast { display: flex; gap: 10px; padding: 9px 12px 10px; border-radius: 7px; background: rgba(9, 13, 18, .86);
  border: 1px solid var(--a3-line); border-left: 3px solid var(--a3-cyan); box-shadow: 0 8px 22px rgba(0,0,0,.35);
  animation: a3-in .28s ease-out both; }
.a3-toast.out { animation: a3-out .45s ease-in both; }
.a3-toast.warn { border-left-color: var(--a3-amber); }
.a3-toast.ok { border-left-color: var(--a3-green); }
.a3-toast .who { font: 600 11px/1.3 var(--a3-f-head); letter-spacing: .09em; text-transform: uppercase; color: var(--a3-cyan); white-space: nowrap; }
.a3-toast.warn .who { color: var(--a3-amber); }
.a3-toast.ok .who { color: var(--a3-green); }
.a3-toast .txt { font-size: 12.5px; line-height: 1.4; color: #dde5ec; }
.a3-toast .col { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
@keyframes a3-in { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: none; } }
@keyframes a3-out { to { opacity: 0; transform: translateX(24px); } }
.a3-flash { position: absolute; left: 50%; bottom: 13%; transform: translateX(-50%); padding: 7px 14px; border-radius: 20px;
  font: 600 13px/1 var(--a3-f-head); letter-spacing: .1em; text-transform: uppercase; color: #fff; background: rgba(8,12,17,.7);
  border: 1px solid rgba(255,255,255,.12); opacity: 0; transition: opacity .25s; white-space: nowrap; }
.a3-flash.show { opacity: 1; }
.a3-resume { position: absolute; left: 50%; top: 50%; transform: translate(-50%, 34px); padding: 8px 14px; border-radius: 6px;
  font-size: 12.5px; color: #fff; background: rgba(8,12,17,.78); border: 1px solid rgba(79,209,255,.35); }
.a3-hints { position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); display: flex; gap: 14px; padding: 7px 14px;
  border-radius: 8px; background: rgba(8,12,17,.62); border: 1px solid rgba(255,255,255,.08); font-size: 11.5px; color: #c6d0da;
  transition: opacity .8s; white-space: nowrap; }
.a3-hints b { font: 700 10.5px/1 var(--a3-f-mono); color: #fff; padding: 2px 5px; border: 1px solid rgba(255,255,255,.28); border-radius: 3px; margin-right: 5px; }
.a3-hints.fade { opacity: 0; }
.a3-fade { position: fixed; inset: 0; background: #000; opacity: 0; pointer-events: none; transition: opacity .28s; z-index: 80; }
.a3-fade.on { opacity: 1; }

/* ------------------------------------------------------------------ overlays / cards */
#a3-overlay { position: fixed; inset: 0; z-index: 60; pointer-events: none; }
#a3-overlay > * { pointer-events: auto; }
.a3-screen { position: absolute; inset: 0; display: flex; }
.a3-dim { background: radial-gradient(ellipse at center, rgba(3,5,8,.62) 0%, rgba(3,5,8,.86) 100%); }
.a3-card { background: var(--a3-panel); border: 1px solid var(--a3-line); border-radius: 12px; box-shadow: 0 24px 60px rgba(0,0,0,.5); }
.a3-over { font: 600 12px/1 var(--a3-f-head); letter-spacing: .22em; text-transform: uppercase; color: var(--a3-cyan); }
.a3-h1 { font: 600 52px/1 var(--a3-f-head); letter-spacing: .02em; margin: 10px 0 0; color: #fff; }
.a3-h2 { font: 600 22px/1.1 var(--a3-f-head); letter-spacing: .08em; text-transform: uppercase; margin: 0; color: #fff; }
.a3-h3 { font: 600 13px/1.2 var(--a3-f-head); letter-spacing: .14em; text-transform: uppercase; margin: 0 0 10px; color: var(--a3-dim); }
.a3-p { font-size: 13.5px; line-height: 1.55; color: #c3ced8; margin: 0; }
.a3-btn { appearance: none; border: 1px solid var(--a3-line-2); background: rgba(255,255,255,.04); color: var(--a3-text);
  font: 600 14px/1 var(--a3-f-head); letter-spacing: .1em; text-transform: uppercase; padding: 12px 18px; border-radius: 7px; cursor: pointer;
  transition: background .15s, border-color .15s, color .15s, transform .08s; display: inline-flex; align-items: center; gap: 9px; justify-content: center; }
.a3-btn:hover { background: rgba(255,255,255,.09); border-color: rgba(180,210,235,.45); }
.a3-btn:active { transform: translateY(1px); }
.a3-btn:focus-visible { outline: 2px solid var(--a3-cyan); outline-offset: 2px; }
.a3-btn.primary { background: var(--a3-cyan); border-color: var(--a3-cyan); color: #04121a; }
.a3-btn.primary:hover { background: #7bdcff; }
.a3-btn.danger { border-color: rgba(255,93,82,.45); color: #ffb3ad; }
.a3-btn.danger:hover { background: rgba(255,93,82,.12); }
.a3-btn.small { padding: 8px 12px; font-size: 12px; }
.a3-btn.big { padding: 17px 30px; font-size: 18px; letter-spacing: .16em; }
.a3-btn[disabled] { opacity: .45; cursor: default; }
.a3-seg { display: inline-flex; border: 1px solid var(--a3-line-2); border-radius: 7px; overflow: hidden; }
.a3-seg button { appearance: none; border: 0; border-right: 1px solid var(--a3-line); background: transparent; color: var(--a3-dim);
  font: 600 12.5px/1.15 var(--a3-f-head); letter-spacing: .06em; padding: 8px 12px; cursor: pointer; text-align: center; }
.a3-seg button:last-child { border-right: 0; }
.a3-seg button small { display: block; font: 10.5px/1.2 var(--a3-f-ui); letter-spacing: 0; opacity: .75; margin-top: 2px; }
.a3-seg button:hover { background: rgba(255,255,255,.06); color: #fff; }
.a3-seg button.on { background: rgba(79,209,255,.16); color: #fff; box-shadow: inset 0 -2px 0 var(--a3-cyan); }
.a3-kbd { font: 700 11px/1 var(--a3-f-mono); padding: 3px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,.25);
  background: rgba(255,255,255,.06); color: #fff; white-space: nowrap; }

/* ------------------------------------------------------------------ start screen */
.a3-start { background: linear-gradient(90deg, rgba(4,7,10,.96) 0%, rgba(4,7,10,.9) 36%, rgba(4,7,10,.35) 70%, rgba(4,7,10,.15) 100%); overflow: auto; }
.a3-start .col { width: min(640px, 100%); padding: 30px 44px 24px; display: flex; flex-direction: column; gap: 16px; height: max-content; min-height: 100%; }
.a3-start .col > * { flex-shrink: 0; }
.a3-start .a3-h1 { font-size: 46px; margin-top: 8px; }
.a3-start .sub { font-size: 13.5px; color: var(--a3-dim); margin-top: 6px; }
.a3-brief { border: 1px solid var(--a3-line); border-radius: 10px; background: rgba(255,255,255,.025); overflow: hidden; }
.a3-route { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 14px; padding: 14px 18px; }
.a3-route .ap b { display: block; font: 600 34px/1 var(--a3-f-head); letter-spacing: .05em; color: #fff; }
.a3-route .ap span { font-size: 12px; color: var(--a3-dim); }
.a3-route .ap.r { text-align: right; }
.a3-route .mid { position: relative; height: 22px; display: flex; align-items: center; justify-content: center; color: var(--a3-cyan); }
.a3-route .mid::before { content: ""; position: absolute; left: 0; right: 0; top: 50%; border-top: 1px dashed rgba(79,209,255,.45); }
.a3-route .mid .a3-ico { position: relative; width: 22px; height: 22px; transform: rotate(90deg); background: #0c1117; padding: 1px; fill: rgba(79,209,255,.2); }
.a3-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; background: var(--a3-line); border-top: 1px solid var(--a3-line); }
.a3-stats div { background: #0b1016; padding: 9px 12px; }
.a3-stats small { display: block; font: 600 10.5px/1 var(--a3-f-head); letter-spacing: .14em; text-transform: uppercase; color: var(--a3-faint); }
.a3-stats b { display: block; margin-top: 6px; font: 400 15px/1 var(--a3-f-mono); color: #fff; }
.a3-mission { border-left: 2px solid var(--a3-cyan); padding: 2px 0 2px 14px; }
.a3-mission .a3-p { font-size: 13px; line-height: 1.5; }
.a3-metar { font: 11.5px/1.4 var(--a3-f-mono); color: #9fb0bf; background: #080c11; border-top: 1px solid var(--a3-line); padding: 7px 18px; }
.a3-opts { display: grid; grid-template-columns: 150px 1fr; gap: 9px 16px; align-items: center; }
.a3-opts > label { font: 600 12px/1.2 var(--a3-f-head); letter-spacing: .1em; text-transform: uppercase; color: var(--a3-dim); }
.a3-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.a3-foot { font-size: 11.5px; color: var(--a3-faint); display: flex; gap: 14px; flex-wrap: wrap; align-items: center; }
.a3-note { font-size: 12px; color: var(--a3-amber); }

/* ------------------------------------------------------------------ pause & panels */
.a3-center { margin: auto; }
.a3-pause { width: 400px; padding: 28px; display: flex; flex-direction: column; gap: 10px; }
.a3-pause .a3-btn { width: 100%; justify-content: flex-start; }
.a3-pause .meta { font-size: 12px; color: var(--a3-dim); margin: 2px 0 12px; }
.a3-panel { width: min(720px, 94vw); max-height: 90vh; display: flex; flex-direction: column; }
.a3-panel.wide { width: min(940px, 95vw); }
.a3-panel > header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px 14px; border-bottom: 1px solid var(--a3-line); }
.a3-panel > .body { padding: 18px 24px 22px; overflow: auto; }
.a3-panel > footer { padding: 14px 24px 18px; border-top: 1px solid var(--a3-line); display: flex; justify-content: flex-end; gap: 10px; }
.a3-xbtn { appearance: none; background: transparent; border: 0; color: var(--a3-dim); cursor: pointer; padding: 6px; border-radius: 6px; display: flex; }
.a3-xbtn:hover { color: #fff; background: rgba(255,255,255,.07); }
.a3-set { display: grid; grid-template-columns: 1fr auto; gap: 10px 20px; align-items: center; margin-bottom: 20px; }
.a3-set .lab { font-size: 13px; color: #d7e0e8; }
.a3-set .lab small { display: block; font-size: 11px; color: var(--a3-faint); margin-top: 2px; }
.a3-range { display: flex; align-items: center; gap: 10px; }
.a3-range output { font: 12px/1 var(--a3-f-mono); color: var(--a3-cyan); width: 48px; text-align: right; }
.a3-range input { width: 220px; accent-color: var(--a3-cyan); }
.a3-switch { position: relative; width: 44px; height: 24px; border-radius: 12px; background: rgba(255,255,255,.12); border: 1px solid var(--a3-line-2); cursor: pointer; transition: background .15s; }
.a3-switch::after { content: ""; position: absolute; left: 3px; top: 3px; width: 16px; height: 16px; border-radius: 50%; background: #cfd8e0; transition: transform .15s, background .15s; }
.a3-switch.on { background: rgba(79,209,255,.35); border-color: var(--a3-cyan); }
.a3-switch.on::after { transform: translateX(20px); background: #fff; }
.a3-help { display: grid; grid-template-columns: 1fr 1fr; gap: 20px 32px; }
.a3-help table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.a3-help td { padding: 6px 0; border-bottom: 1px solid var(--a3-line); vertical-align: top; color: #cbd5de; }
.a3-help td:first-child { width: 44%; padding-right: 10px; color: #fff; }
.a3-help .full { grid-column: 1 / -1; }

/* ------------------------------------------------------------------ end screen */
.a3-end { background: linear-gradient(180deg, rgba(3,6,9,.7), rgba(3,6,9,.94)); overflow: auto; }
.a3-end .wrap { margin: auto; width: min(900px, 94vw); padding: 26px 0; display: flex; flex-direction: column; gap: 16px; }
.a3-end .wrap > * { flex-shrink: 0; }
.a3-end .big { font: 600 44px/1 var(--a3-f-head); letter-spacing: .04em; color: #fff; }
.a3-end .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.a3-end .kpi { padding: 12px 16px; border-radius: 10px; background: rgba(255,255,255,.035); border: 1px solid var(--a3-line); }
.a3-end .kpi small { font: 600 11px/1 var(--a3-f-head); letter-spacing: .14em; text-transform: uppercase; color: var(--a3-faint); }
.a3-end .kpi b { display: block; margin-top: 8px; font: 600 28px/1 var(--a3-f-head); color: #fff; letter-spacing: .03em; }
.a3-end .kpi b.g { color: var(--a3-green); } .a3-end .kpi b.a { color: var(--a3-amber); }
.a3-deb { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.a3-deb section { padding: 14px 14px 8px; border-radius: 10px; background: rgba(255,255,255,.025); border: 1px solid var(--a3-line); }
.a3-deb ul { list-style: none; margin: 0; padding: 0; }
.a3-deb li { display: grid; grid-template-columns: 18px 1fr; gap: 8px; padding: 6px 0; border-top: 1px solid var(--a3-line); font-size: 12.5px; line-height: 1.35; color: #d8e1e8; }
.a3-deb li:first-child { border-top: 0; }
.a3-deb li i { font-style: normal; font-weight: 700; }
.a3-deb li.ok i { color: var(--a3-green); } .a3-deb li.ko i { color: var(--a3-amber); }
.a3-deb li small { display: block; color: var(--a3-dim); font-size: 11px; margin-top: 2px; }

/* ------------------------------------------------------------------ EFB tablet */
.a3-efbwrap { background: rgba(2,4,6,.55); align-items: center; justify-content: center; }
.a3-tablet { position: relative; width: min(1220px, 95vw); height: min(860px, 92vh); border-radius: 36px; padding: 18px;
  background: linear-gradient(145deg, #2a2e33, #15181b 40%, #0e1012); box-shadow: 0 30px 80px rgba(0,0,0,.65), inset 0 0 0 1.5px #3a3f45, inset 0 0 0 7px #0b0c0e;
  animation: a3-pop .2s ease-out; }
@keyframes a3-pop { from { opacity: .5; transform: scale(.97) translateY(10px); } to { opacity: 1; transform: none; } }
.a3-tablet::before { content: ""; position: absolute; left: 50%; top: 7px; width: 7px; height: 7px; margin-left: -3.5px; border-radius: 50%; background: #1d2126; box-shadow: inset 0 0 2px #000; }
.a3-efb { --e-bg: #eef1f4; --e-bg2: #ffffff; --e-rail: #1b2430; --e-text: #16202b; --e-dim: #5b6776; --e-line: #d3dae2; --e-acc: #0a72c2; --e-acc-bg: #e3f0fb;
  --e-ok: #108a4a; --e-warn: #b86b00; --e-bad: #c0392b; --e-mono-bg: #fbfcfd;
  position: relative; width: 100%; height: 100%; border-radius: 16px; overflow: hidden; display: grid; grid-template-rows: 26px 50px 1fr; grid-template-columns: 170px 1fr;
  background: var(--e-bg); color: var(--e-text); font-family: var(--a3-f-ui); }
.a3-efb.night { --e-bg: #0f141a; --e-bg2: #161d25; --e-rail: #0a0e13; --e-text: #dbe4ec; --e-dim: #8c9aa8; --e-line: #26313d; --e-acc: #4fb8ff; --e-acc-bg: rgba(79,184,255,.13);
  --e-ok: #3ddc84; --e-warn: #ffb224; --e-bad: #ff6b5f; --e-mono-bg: #121920; }
.a3-efb .sbar { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; background: #000; color: #fff; font: 600 12px/1 var(--a3-f-ui); }
.a3-efb .sbar .bat { display: inline-flex; align-items: center; gap: 6px; }
.a3-efb .sbar .bat i { display: inline-block; width: 22px; height: 11px; border: 1.5px solid #fff; border-radius: 3px; position: relative; }
.a3-efb .sbar .bat i::after { content: ""; position: absolute; left: 1.5px; top: 1.5px; bottom: 1.5px; width: 70%; background: #fff; border-radius: 1px; }
.a3-efb .hbar { grid-column: 1 / -1; display: flex; align-items: center; gap: 14px; padding: 0 14px 0 18px; background: var(--e-rail); color: #fff; }
.a3-efb .hbar .logo { font: 600 17px/1 var(--a3-f-head); letter-spacing: .12em; display: flex; align-items: center; gap: 8px; }
.a3-efb .hbar .logo .a3-ico { width: 20px; height: 20px; color: #4fd1ff; fill: rgba(79,209,255,.25); }
.a3-efb .hbar .flt { font: 13px/1 var(--a3-f-mono); color: #b8c6d4; margin-left: 10px; }
.a3-efb .hbar .sp { flex: 1; }
.a3-efb .hbar button { appearance: none; border: 1px solid rgba(255,255,255,.18); background: rgba(255,255,255,.06); color: #fff; border-radius: 8px; height: 34px;
  padding: 0 12px; display: inline-flex; align-items: center; gap: 7px; cursor: pointer; font: 600 12px/1 var(--a3-f-head); letter-spacing: .08em; text-transform: uppercase; }
.a3-efb .hbar button:hover { background: rgba(255,255,255,.14); }
.a3-efb .hbar button .k { font: 700 10px/1 var(--a3-f-mono); padding: 2px 4px; border: 1px solid rgba(255,255,255,.3); border-radius: 3px; opacity: .8; margin-left: 2px; }
.a3-efb .rail { background: var(--e-rail); display: flex; flex-direction: column; padding: 8px 8px 12px; gap: 3px; overflow: auto; }
.a3-efb .rail button { appearance: none; border: 0; background: transparent; color: #aebccb; border-radius: 9px; padding: 10px 10px; display: flex; align-items: center; gap: 10px;
  font: 600 12.5px/1.1 var(--a3-f-head); letter-spacing: .07em; text-transform: uppercase; cursor: pointer; text-align: left; position: relative; }
.a3-efb .rail button:hover { background: rgba(255,255,255,.07); color: #fff; }
.a3-efb .rail button.on { background: #0a72c2; color: #fff; }
.a3-efb .rail button .badge { position: absolute; right: 8px; top: 50%; margin-top: -9px; min-width: 18px; height: 18px; border-radius: 9px; background: #ff5d52; color: #fff;
  font: 700 10px/18px var(--a3-f-ui); text-align: center; padding: 0 5px; }
.a3-efb .rail .grow { flex: 1; }
.a3-efb .rail .utc { font: 12px/1.3 var(--a3-f-mono); color: #7f8fa0; padding: 8px 10px 0; }
.a3-efb .main { position: relative; overflow: auto; padding: 22px 26px 30px; }
.a3-efb h2 { font: 600 21px/1.1 var(--a3-f-head); letter-spacing: .06em; text-transform: uppercase; margin: 0 0 4px; }
.a3-efb h3 { font: 600 13px/1.2 var(--a3-f-head); letter-spacing: .12em; text-transform: uppercase; color: var(--e-dim); margin: 18px 0 8px; }
.a3-efb .lead { font-size: 12.5px; color: var(--e-dim); margin: 0 0 16px; }
.a3-efb .doc { font: 12.5px/1.5 var(--a3-f-mono); white-space: pre; background: var(--e-mono-bg); border: 1px solid var(--e-line); border-radius: 8px; padding: 16px 18px; overflow: auto; color: var(--e-text); }
.a3-efb .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin-bottom: 16px; }
.a3-efb .kv { background: var(--e-bg2); border: 1px solid var(--e-line); border-radius: 9px; padding: 10px 12px; }
.a3-efb .kv small { display: block; font: 600 10.5px/1 var(--a3-f-head); letter-spacing: .12em; text-transform: uppercase; color: var(--e-dim); }
.a3-efb .kv b { display: block; margin-top: 6px; font: 600 19px/1.1 var(--a3-f-mono); }
.a3-efb .kv b.acc { color: var(--e-acc); }
.a3-efb .banner { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 9px; margin: 0 0 14px; font-size: 13px; border: 1px solid var(--e-line); background: var(--e-bg2); }
.a3-efb .banner.warn { border-color: rgba(255,178,36,.5); background: rgba(255,178,36,.1); }
.a3-efb .banner.ok { border-color: rgba(61,220,132,.5); background: rgba(61,220,132,.1); }
.a3-efb table.t { width: 100%; border-collapse: collapse; font-size: 13px; background: var(--e-bg2); border: 1px solid var(--e-line); border-radius: 9px; overflow: hidden; }
.a3-efb table.t td, .a3-efb table.t th { padding: 8px 12px; border-bottom: 1px solid var(--e-line); text-align: left; }
.a3-efb table.t th { font: 600 11px/1 var(--a3-f-head); letter-spacing: .12em; text-transform: uppercase; color: var(--e-dim); background: rgba(127,140,155,.07); }
.a3-efb table.t td.m { font-family: var(--a3-f-mono); }
.a3-efb .tabs2 { display: inline-flex; gap: 4px; background: rgba(127,140,155,.12); padding: 3px; border-radius: 9px; margin-bottom: 14px; }
.a3-efb .tabs2 button { appearance: none; border: 0; background: transparent; color: var(--e-dim); padding: 7px 14px; border-radius: 7px; cursor: pointer;
  font: 600 12px/1 var(--a3-f-head); letter-spacing: .08em; text-transform: uppercase; }
.a3-efb .tabs2 button.on { background: var(--e-bg2); color: var(--e-text); box-shadow: 0 1px 3px rgba(0,0,0,.15); }
/* checklists */
.a3-efb .cl { background: var(--e-bg2); border: 1px solid var(--e-line); border-radius: 12px; margin-bottom: 16px; overflow: hidden; }
.a3-efb .cl header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--e-line); }
.a3-efb .cl header b { font: 600 16px/1 var(--a3-f-head); letter-spacing: .14em; }
.a3-efb .cl header span { font: 12px/1 var(--a3-f-mono); color: var(--e-dim); }
.a3-efb .cl .row { display: grid; grid-template-columns: 30px 1fr; gap: 10px; align-items: center; padding: 11px 16px; border-bottom: 1px solid var(--e-line); cursor: pointer; user-select: none; }
.a3-efb .cl .row:last-of-type { border-bottom: 0; }
.a3-efb .cl .row:hover { background: rgba(127,140,155,.07); }
.a3-efb .cl .box { width: 22px; height: 22px; border-radius: 6px; border: 2px solid var(--e-line); display: flex; align-items: center; justify-content: center; color: transparent; font-weight: 700; }
.a3-efb .cl .row.on .box { background: var(--e-ok); border-color: var(--e-ok); color: #fff; }
.a3-efb .cl .line { display: flex; align-items: baseline; gap: 6px; font: 14px/1.3 var(--a3-f-mono); }
.a3-efb .cl .line .it { white-space: nowrap; }
.a3-efb .cl .line .dots { flex: 1; border-bottom: 2px dotted var(--e-line); transform: translateY(-4px); min-width: 20px; }
.a3-efb .cl .line .rs { white-space: nowrap; font-weight: 700; }
.a3-efb .cl .row.on .line { color: var(--e-dim); }
.a3-efb .cl .hint { grid-column: 2; font-size: 11.5px; color: var(--e-acc); margin-top: -4px; }
.a3-efb .cl .done { padding: 10px 16px; background: rgba(61,220,132,.14); color: var(--e-ok); font: 600 13px/1 var(--a3-f-head); letter-spacing: .16em; text-align: center; border-top: 1px solid var(--e-line); }
/* SOP */
.a3-efb .sop section { background: var(--e-bg2); border: 1px solid var(--e-line); border-radius: 12px; padding: 14px 18px 12px; margin-bottom: 14px; }
.a3-efb .sop h4 { margin: 0; font: 600 17px/1.2 var(--a3-f-head); letter-spacing: .04em; }
.a3-efb .sop h4 small { margin-left: 10px; font: 600 11px/1 var(--a3-f-head); letter-spacing: .14em; color: var(--e-dim); }
.a3-efb .sop .intro { font-size: 12.5px; color: var(--e-dim); margin: 6px 0 4px; line-height: 1.45; }
.a3-efb .sop h5 { margin: 12px 0 4px; font: 600 12px/1 var(--a3-f-head); letter-spacing: .12em; text-transform: uppercase; color: var(--e-acc); }
.a3-efb .sop .st { display: grid; grid-template-columns: 190px 1fr; gap: 12px; padding: 6px 0; border-top: 1px solid var(--e-line); font-size: 13px; line-height: 1.4; }
.a3-efb .sop .st.plain { grid-template-columns: 1fr; font-style: italic; color: var(--e-dim); }
.a3-efb .sop .st b { font: 700 12.5px/1.4 var(--a3-f-mono); }
.a3-efb .sop .cltag { display: inline-block; margin-top: 10px; font: 600 11px/1 var(--a3-f-head); letter-spacing: .12em; padding: 6px 9px; border-radius: 6px; background: var(--e-acc-bg); color: var(--e-acc); }
/* ground services */
.a3-efb .gs { display: grid; grid-template-columns: 330px 1fr; gap: 18px; align-items: start; }
.a3-efb .gs .left { position: sticky; top: 0; display: flex; flex-direction: column; gap: 12px; }
.a3-efb .gs svg.plan { width: 100%; height: auto; background: var(--e-bg2); border: 1px solid var(--e-line); border-radius: 12px; }
.a3-efb .gs .log { background: var(--e-bg2); border: 1px solid var(--e-line); border-radius: 12px; max-height: 300px; overflow: auto; padding: 4px 12px; }
.a3-efb .gs .log div { padding: 7px 0; border-bottom: 1px solid var(--e-line); font-size: 12px; line-height: 1.4; }
.a3-efb .gs .log div:last-child { border-bottom: 0; }
.a3-efb .gs .log time { font: 11px/1 var(--a3-f-mono); color: var(--e-dim); margin-right: 6px; }
.a3-efb .gs .log b { font: 600 11px/1 var(--a3-f-head); letter-spacing: .08em; text-transform: uppercase; color: var(--e-acc); margin-right: 6px; }
.a3-efb .gs .log .warn b { color: var(--e-warn); }
.a3-efb .gs .log .ok b { color: var(--e-ok); }
.a3-efb .svc { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; }
.a3-efb .sv { background: var(--e-bg2); border: 1px solid var(--e-line); border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; min-height: 108px; }
.a3-efb .sv .top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.a3-efb .sv .top b { font: 600 14px/1.15 var(--a3-f-head); letter-spacing: .06em; text-transform: uppercase; }
.a3-efb .chip { font: 600 10.5px/1 var(--a3-f-head); letter-spacing: .1em; text-transform: uppercase; padding: 5px 8px; border-radius: 20px; white-space: nowrap;
  background: rgba(127,140,155,.15); color: var(--e-dim); }
.a3-efb .chip.ok { background: rgba(61,220,132,.16); color: var(--e-ok); }
.a3-efb .chip.warn { background: rgba(255,178,36,.18); color: var(--e-warn); }
.a3-efb .chip.busy { background: var(--e-acc-bg); color: var(--e-acc); }
.a3-efb .sv .desc { font-size: 12px; color: var(--e-dim); line-height: 1.35; flex: 1; }
.a3-efb .bar { height: 5px; border-radius: 3px; background: rgba(127,140,155,.2); overflow: hidden; }
.a3-efb .bar i { display: block; height: 100%; width: 0; background: var(--e-acc); transition: width .3s linear; }
.a3-efb .sv .btns { display: flex; gap: 6px; flex-wrap: wrap; }
.a3-efb .eb { appearance: none; border: 1px solid var(--e-line); background: var(--e-bg); color: var(--e-text); border-radius: 8px; padding: 8px 11px; cursor: pointer;
  font: 600 12px/1 var(--a3-f-head); letter-spacing: .06em; text-transform: uppercase; }
.a3-efb .eb:hover { border-color: var(--e-acc); color: var(--e-acc); }
.a3-efb .eb.p { background: var(--e-acc); border-color: var(--e-acc); color: #fff; }
.a3-efb .eb.p:hover { filter: brightness(1.1); color: #fff; }
.a3-efb .doors { display: grid; grid-template-columns: 1fr auto auto; gap: 6px 8px; align-items: center; font-size: 12.5px; }
.a3-efb .doors .st { font: 600 10.5px/1 var(--a3-f-head); letter-spacing: .1em; text-transform: uppercase; }
.a3-efb .doors .st.o { color: var(--e-warn); } .a3-efb .doors .st.c { color: var(--e-ok); } .a3-efb .doors .st.m { color: var(--e-acc); }
.a3-efb .wx .card { background: var(--e-bg2); border: 1px solid var(--e-line); border-radius: 12px; padding: 12px 16px; margin-bottom: 12px; }
.a3-efb .wx .card header { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
.a3-efb .wx .card header b { font: 600 18px/1 var(--a3-f-head); letter-spacing: .08em; }
.a3-efb .wx .card header span { font-size: 12px; color: var(--e-dim); }
.a3-efb .wx .card header i { font-style: normal; font: 600 10.5px/1 var(--a3-f-head); letter-spacing: .12em; padding: 4px 7px; border-radius: 5px; background: var(--e-acc-bg); color: var(--e-acc); }
.a3-efb .wx .m { font: 13px/1.5 var(--a3-f-mono); white-space: pre-wrap; }
.a3-efb .wx .m.taf { color: var(--e-dim); margin-top: 4px; }
.a3-efb .wx ul { margin: 8px 0 0; padding-left: 18px; font-size: 12.5px; color: var(--e-dim); }
.a3-efb .closehint { position: absolute; right: 18px; bottom: 12px; font-size: 11px; color: var(--e-dim); pointer-events: none; }
.a3-efb .setwrap { max-width: 640px; }
.a3-efb .setwrap .a3-set .lab { color: var(--e-text); }
.a3-efb .setwrap .a3-range output { color: var(--e-acc); }
.a3-efb .setwrap .a3-seg { border-color: var(--e-line); }
.a3-efb .setwrap .a3-seg button { color: var(--e-dim); border-color: var(--e-line); }
.a3-efb .setwrap .a3-seg button.on { color: var(--e-text); background: var(--e-acc-bg); box-shadow: inset 0 -2px 0 var(--e-acc); }
.a3-efb .setwrap .a3-switch { background: rgba(127,140,155,.25); border-color: var(--e-line); }
.a3-efb .setwrap .a3-switch.on { background: var(--e-acc); border-color: var(--e-acc); }
.a3-efb .setwrap h3:first-child { margin-top: 0; }
.a3-efb svg.plan .ac path, .a3-efb svg.plan .ac rect { fill: rgba(127,140,155,.14); stroke: var(--e-dim); stroke-width: 1.2; }
.a3-efb svg.plan .ac .win { fill: var(--e-dim); stroke: none; }
.a3-efb svg.plan .eq { fill: rgba(127,140,155,.22); stroke: var(--e-dim); stroke-width: 1; }
.a3-efb svg.plan .eq.on { fill: rgba(61,220,132,.28); stroke: var(--e-ok); }
.a3-efb svg.plan .cable { fill: none; stroke: var(--e-warn); stroke-width: 1.6; stroke-dasharray: 3 2; }
.a3-efb svg.plan #p-chocks rect { fill: var(--e-warn); }
.a3-efb svg.plan .d { stroke: none; }
.a3-efb svg.plan .d.c { fill: var(--e-ok); }
.a3-efb svg.plan .d.o { fill: var(--e-warn); }
.a3-efb svg.plan .d.m { fill: var(--e-acc); }
.a3-efb svg.plan text { font: 600 10px var(--a3-f-head); fill: var(--e-text); letter-spacing: .05em; }
.a3-efb svg.plan text.lab { fill: var(--e-dim); font-size: 9px; font-weight: 500; }
.a3-efb .eb[disabled] { opacity: .4; cursor: default; pointer-events: none; }
@media (max-width: 900px) {
  .a3-efb { grid-template-columns: 64px 1fr; }
  .a3-efb .rail button span { display: none; }
  .a3-efb .gs { grid-template-columns: 1fr; }
  .a3-start .col { padding: 28px 22px; }
  .a3-h1 { font-size: 40px; }
  .a3-deb, .a3-end .kpis, .a3-help { grid-template-columns: 1fr; }
  .a3-toasts { width: min(380px, calc(100vw - 32px)); }
}
`;
