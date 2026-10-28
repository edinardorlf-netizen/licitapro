import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  sb, appUrl, portal, PORTAIS, ETAPAS, etapa, ATIVAS, PAPEIS, fmtData, fmtDataCurta, fmtHora, fmtDH, diaChave, hojeChave,
  diaLongo, falta, brl, num, parseNum, fmtIn, valorMinimo, errMsg, chamarRobo, iniciais,
} from "./util.js";

/* ============================================================
   LicitaPro · app da equipe
   ============================================================ */

const css = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
:root{
  --bg:#F2F5F8; --surface:#FFFFFF; --ink:#0E1A26; --ink-2:#334155; --muted:#64748B;
  --line:#E2E8F0; --line-2:#EEF2F6;
  --accent:#0F5C6E; --accent-ink:#0B4756; --accent-soft:#E1F0F3; --accent-tint:#F2F9FA;
  --red:#B91C1C; --red-soft:#FDECEC; --amber:#B45309; --amber-soft:#FEF4E2; --green:#15803D; --green-soft:#E6F4EA;
  --shadow:0 1px 2px rgba(14,26,38,.05), 0 8px 24px rgba(14,26,38,.06);
  --font:'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}
*{box-sizing:border-box}
html,body{background:var(--bg)}
body{margin:0;font-family:var(--font);color:var(--ink);font-size:14px;line-height:1.45;-webkit-font-smoothing:antialiased}
button,input,select,textarea{font:inherit;color:inherit}
button{cursor:pointer}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.num{font-variant-numeric:tabular-nums}

.side{position:fixed;inset:0 auto 0 0;width:232px;background:var(--surface);border-right:1px solid var(--line);
  padding:calc(22px + env(safe-area-inset-top,0px)) 14px calc(18px + env(safe-area-inset-bottom,0px)) calc(14px + env(safe-area-inset-left,0px));display:flex;flex-direction:column;gap:24px;z-index:20}
.brand{display:flex;align-items:center;gap:10px;padding:0 8px;font-weight:800;font-size:16.5px;letter-spacing:-.02em}
.brand-mark{width:32px;height:32px;border-radius:10px;background:var(--accent);display:grid;place-items:center;color:#fff}
.nav{display:flex;flex-direction:column;gap:3px}
.nav button{display:flex;align-items:center;gap:12px;border:0;background:transparent;padding:10px 12px;border-radius:10px;color:var(--ink-2);font-weight:500;text-align:left}
.nav button:hover{background:var(--line-2)}
.nav button.on{background:var(--accent-soft);color:var(--accent-ink);font-weight:600}
.nav .badge{margin-left:auto}
.side-foot{margin-top:auto;display:flex;align-items:center;gap:10px;padding:10px;border-radius:12px;background:var(--bg)}
.side-foot small{display:block;color:var(--muted);font-size:11.5px}

.main{margin-left:232px;padding-block:26px 64px;padding-left:max(28px, env(safe-area-inset-left,0px));padding-right:max(28px, env(safe-area-inset-right,0px));max-width:1400px}
.bnav{display:none}
@media (max-width:880px){
  .side{display:none}
  .main{margin-left:0;padding-block:16px calc(96px + env(safe-area-inset-bottom,0px));padding-left:max(14px, env(safe-area-inset-left,0px));padding-right:max(14px, env(safe-area-inset-right,0px))}
  .bnav{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:30;background:var(--surface);border-top:1px solid var(--line);
    padding:6px max(6px, env(safe-area-inset-right,0px)) calc(6px + env(safe-area-inset-bottom,0px)) max(6px, env(safe-area-inset-left,0px))}
  .bnav button{flex:1;min-width:0;border:0;background:transparent;display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 2px;border-radius:10px;font-size:10.5px;color:var(--muted);font-weight:500;position:relative}
  .bnav button.on{color:var(--accent-ink);background:var(--accent-soft);font-weight:600}
  .bnav .dot-badge{position:absolute;top:3px;right:calc(50% - 18px)}
}

.top{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:20px}
.top h1{margin:0;font-size:24px;letter-spacing:-.025em;font-weight:800;text-wrap:balance}
.top p{margin:3px 0 0;color:var(--muted)}
.stack{display:flex;flex-direction:column;gap:16px}
.card{background:var(--surface);border-radius:16px;box-shadow:var(--shadow);padding:18px;min-width:0}
.card-h{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px;flex-wrap:wrap}
.card-h h2{margin:0;font-size:15px;font-weight:700}
.card-h small{color:var(--muted)}
.grid2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}
.grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px}
@media (max-width:1100px){.grid2{grid-template-columns:minmax(0,1fr)}}

.btn{text-decoration:none;border:0;border-radius:10px;height:40px;padding:0 16px;font-weight:700;background:var(--accent);color:#fff;display:inline-flex;align-items:center;gap:7px;white-space:nowrap}
.btn:hover{background:var(--accent-ink)}
.btn:disabled{opacity:.6;cursor:default}
.input:disabled{background:var(--line-2);color:var(--ink-2);cursor:default;opacity:1;-webkit-text-fill-color:var(--ink-2)}
.btn.ghost{background:var(--surface);color:var(--ink-2);border:1px solid var(--line);font-weight:600}
.btn.ghost:hover{background:var(--line-2)}
.btn.sm{height:32px;padding:0 11px;font-size:12.5px;border-radius:9px}
.btn.danger{background:var(--red)}
.btn.block{width:100%;justify-content:center;height:44px}
.linkbtn{border:0;background:transparent;color:var(--accent-ink);font-weight:600;padding:2px 0;text-decoration:underline;text-underline-offset:3px}
.xbtn{border:0;background:transparent;color:var(--muted);font-size:12px;font-weight:600;padding:6px 8px;border-radius:8px}
.xbtn:hover{background:var(--red-soft);color:var(--red)}
.xbtn.confirm{background:var(--red);color:#fff}
.iconbtn{border:0;background:var(--line-2);width:36px;height:36px;border-radius:10px;display:grid;place-items:center;flex:none}

.input,select.input,textarea.input{height:40px;border:1px solid var(--line);border-radius:10px;padding:0 11px;background:var(--surface);width:100%}
textarea.input{height:auto;min-height:80px;padding:10px 11px;resize:vertical}
.input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.field{display:flex;flex-direction:column;gap:5px;min-width:0}
.field>label,.flabel{font-size:12px;font-weight:600;color:var(--ink-2)}
.fgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.emp{border:1px solid var(--line);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:10px}
.emp-h{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
.emp-body{display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--line);padding-top:10px}
.acc-form{display:flex;flex-direction:column;gap:10px;background:var(--bg, #f6f7f9);border-radius:10px;padding:12px}
.form{display:flex;flex-direction:column;gap:12px}
.err{color:var(--red);font-size:13px;font-weight:500;margin:0}
.hint{font-size:12.5px;color:var(--muted);margin:0}
.row-inline{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.seg{display:inline-flex;background:var(--line-2);border-radius:10px;padding:3px;gap:3px;flex-wrap:wrap}
.seg button{border:0;background:transparent;padding:7px 12px;border-radius:8px;font-weight:600;color:var(--muted);font-size:13px}
.seg button.on{background:var(--surface);color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.08)}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{border:1px solid var(--line);background:var(--surface);border-radius:999px;padding:5px 11px;font-size:12.5px;font-weight:500}
.chip.on{background:var(--accent-soft);border-color:var(--accent);color:var(--accent-ink);font-weight:600}
.tag{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;background:var(--line-2);color:var(--ink-2);white-space:nowrap}
.pdot{width:7px;height:7px;border-radius:50%;display:inline-block;flex:none}
.badge{min-width:20px;height:20px;border-radius:99px;background:var(--red);color:#fff;font-size:11px;font-weight:700;display:inline-grid;place-items:center;padding:0 6px}
.badge.soft{background:var(--accent-soft);color:var(--accent-ink)}
.empty{color:var(--muted);text-align:center;padding:26px 12px;border:1.5px dashed var(--line);border-radius:12px}
.empty b{display:block;color:var(--ink-2);margin-bottom:4px}
.clamp2{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.clamp3{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.banner{display:flex;gap:10px;align-items:flex-start;border-radius:12px;padding:12px 14px}
.banner.warn{background:var(--amber-soft);color:#7A3E06}
.banner.info{background:var(--accent-tint);color:var(--accent-ink);border:1px solid var(--accent-soft)}
.banner.bad{background:var(--red-soft);color:var(--red)}

.kpi{display:flex;flex-direction:column;gap:4px}
.kpi b{font-size:26px;font-weight:800;letter-spacing:-.02em}
.kpi small{color:var(--muted)}

.list{display:flex;flex-direction:column}
.lrow{display:flex;gap:12px;align-items:flex-start;padding:12px 0;border-top:1px solid var(--line-2)}
.lrow:first-child{border-top:0;padding-top:2px}
.lrow.click{cursor:pointer}
.lrow.click:hover .lt{color:var(--accent-ink)}
.lmain{flex:1;min-width:0}
.lt{font-weight:600;display:block}
.ls{font-size:12.5px;color:var(--muted);display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:2px}
.when{flex:none;text-align:right;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
.when b{display:block;font-size:13.5px;color:var(--ink)}
.datebox{width:48px;flex:none;text-align:center;border-radius:10px;background:var(--accent-tint);border:1px solid var(--accent-soft);padding:5px 0}
.datebox b{display:block;font-size:17px;line-height:1.1;color:var(--accent-ink)}
.datebox small{font-size:10.5px;text-transform:uppercase;color:var(--accent-ink);font-weight:600;letter-spacing:.04em}

.ed{display:flex;flex-direction:column;gap:8px;padding:14px 0;border-top:1px solid var(--line-2)}
.ed:first-child{border-top:0;padding-top:0}
.ed-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
.ed-obj{font-weight:600;line-height:1.4}
.ed-meta{display:flex;gap:6px 12px;flex-wrap:wrap;font-size:12.5px;color:var(--muted)}
.ed-meta b{color:var(--ink-2);font-weight:600}
.termos{display:flex;gap:5px;flex-wrap:wrap}
.termos span{font-size:11px;background:var(--green-soft);color:var(--green);border-radius:6px;padding:1px 7px;font-weight:600}

.pcard{display:flex;flex-direction:column;gap:8px;text-align:left;border:1px solid var(--line);border-radius:14px;padding:14px;background:var(--surface);width:100%}
.pcard:hover{border-color:#B9D4DA;box-shadow:var(--shadow)}
.pgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
.pcard .ptop{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
.pcard .porg{font-weight:700}
.estado{font-size:12px;color:var(--ink-2);background:var(--bg);border-radius:8px;padding:6px 9px}
.err-mini{font-size:12px;color:var(--amber)}

.back{border:0;background:transparent;color:var(--accent-ink);font-weight:600;display:inline-flex;align-items:center;gap:2px;padding:4px 8px 4px 0;margin-bottom:6px}
.phead{display:flex;flex-direction:column;gap:10px}
.phead h1{margin:0;font-size:21px;letter-spacing:-.02em;font-weight:800;text-wrap:balance}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
.fact{background:var(--bg);border-radius:12px;padding:10px 12px;min-width:0}
.fact small{display:block;color:var(--muted);font-size:11.5px}
.fact b{font-size:14px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.fact .hint{font-size:11.5px}

.tl{display:flex;flex-direction:column}
.tl-day{font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);padding:14px 0 4px}
.tl-day:first-child{padding-top:0}
.tl-item{display:flex;gap:11px;padding:9px 0;border-top:1px solid var(--line-2)}
.tl-day + .tl-item{border-top:0}
.tl-ico{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;flex:none;font-size:14px;background:var(--line-2)}
.tl-item.imp .tl-ico{background:var(--amber-soft)}
.tl-item.novo{background:linear-gradient(90deg, var(--accent-tint), transparent)}
.tl-body{flex:1;min-width:0}
.tl-body b{font-weight:600;display:block}
.tl-body p{margin:2px 0 0;color:var(--ink-2);font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}
.tl-meta{font-size:11.5px;color:var(--muted);display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:3px}

.item{border:1px solid var(--line);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:8px}
.item.on{border-color:#9CC8D2;background:var(--accent-tint)}
.item-top{display:flex;gap:10px;align-items:flex-start}
.item-n{font-weight:800;color:var(--accent-ink);min-width:34px;font-variant-numeric:tabular-nums}
.item-d{flex:1;min-width:0;font-weight:500}
.item-meta{display:flex;gap:6px 14px;flex-wrap:wrap;font-size:12.5px;color:var(--muted)}
.item-meta b{color:var(--ink);font-weight:600}
.toggle{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}
.toggle input{width:18px;height:18px;accent-color:var(--accent);margin:0}
.calc{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;align-items:end}
.vmin{background:var(--surface);border:1px solid var(--accent-soft);border-radius:10px;padding:8px 10px}
.vmin small{display:block;font-size:11px;color:var(--muted)}
.vmin b{font-size:16px;color:var(--accent-ink)}
.alerta-lance{font-size:12.5px;font-weight:600;border-radius:8px;padding:6px 9px}
.alerta-lance.ok{background:var(--green-soft);color:var(--green)}
.alerta-lance.ruim{background:var(--red-soft);color:var(--red)}

.sheet-bg{position:fixed;inset:0;background:rgba(14,26,38,.45);z-index:60;display:flex;align-items:flex-end;justify-content:center;padding:calc(16px + env(safe-area-inset-top,0px)) 0 0}
.sheet{background:var(--surface);width:100%;max-width:560px;max-height:100%;overflow:auto;border-radius:20px 20px 0 0;padding:18px max(18px, env(safe-area-inset-right,0px)) calc(20px + env(safe-area-inset-bottom,0px)) max(18px, env(safe-area-inset-left,0px));display:flex;flex-direction:column;gap:12px}
@media (min-width:720px){.sheet-bg{align-items:center;padding:24px}.sheet{border-radius:18px}}
.sheet-h{display:flex;justify-content:space-between;align-items:center;gap:10px}
.sheet-h h2{margin:0;font-size:17px}

.auth{max-width:420px;margin:6vh auto 0;display:flex;flex-direction:column;gap:14px}
.auth-hero{text-align:center;display:flex;flex-direction:column;align-items:center;gap:8px}
.auth-hero h1{margin:0;font-size:24px;font-weight:800;letter-spacing:-.02em}
.auth-hero p{margin:0;color:var(--muted)}

.toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(24px + env(safe-area-inset-bottom,0px));background:var(--ink);color:#fff;padding:11px 16px;border-radius:12px;font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,.2);z-index:80;max-width:calc(100vw - 32px)}
@media (max-width:880px){.toast{bottom:calc(84px + env(safe-area-inset-bottom,0px))}}
.spin{display:inline-block;width:14px;height:14px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:sp .8s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.spin{animation:none}}
.wordlist{display:flex;flex-wrap:wrap;gap:6px}
.word{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--line);border-radius:99px;padding:3px 4px 3px 10px;font-size:12.5px;background:var(--surface)}
.word button{border:0;background:var(--line-2);border-radius:99px;width:20px;height:20px;font-size:11px;color:var(--muted)}
.word.ex{background:var(--red-soft);border-color:#F5C6C6}
.steps{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px;color:var(--ink-2)}
code{background:var(--line-2);border-radius:6px;padding:1px 6px;font-size:12.5px}
`;

/* ---------- Ícones ---------- */
const Icon = ({ name, size = 20 }) => {
  const p = {
    home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h14V9.5" /></>,
    radar: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><path d="M12 12 18 6" /></>,
    folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
    cal: <><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
    cog: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
    left: <path d="m15 18-6-6 6-6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    x: <path d="M6 6l12 12M18 6 6 18" />,
    ext: <><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></>,
    refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>,
    logout: <><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l5-5-5-5M15 12H4" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  }[name];
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{p}</svg>;
};

function ConfirmX({ label = "Excluir", confirmLabel = "Confirmar", onConfirm }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 3000); return () => clearTimeout(t); }, [armed]);
  return <button type="button" className={`xbtn${armed ? " confirm" : ""}`} onClick={(e) => { e.stopPropagation(); armed ? onConfirm() : setArmed(true); }}>{armed ? confirmLabel : label}</button>;
}

const PortalTag = ({ k }) => <span className="tag"><i className="pdot" style={{ background: portal(k).cor }} />{portal(k).curto}</span>;
const EtapaTag = ({ id }) => <span className="tag" style={{ background: `${etapa(id).cor}18`, color: etapa(id).cor }}>{etapa(id).nome}</span>;

const TABS = [
  { id: "inicio", nome: "Início", icon: "home" },
  { id: "radar", nome: "Radar", icon: "radar" },
  { id: "processos", nome: "Processos", icon: "folder" },
  { id: "agenda", nome: "Agenda", icon: "cal" },
  { id: "ajustes", nome: "Ajustes", icon: "cog" },
];

/* ============================================================
   Sessão
   ============================================================ */
function useSession() {
  const [session, setSession] = useState(undefined);
  const [recovery, setRecovery] = useState(false);
  useEffect(() => {
    if (!sb) { setSession(null); return; }
    sb.auth.getSession().then(({ data }) => setSession(data.session || null));
    const { data: sub } = sb.auth.onAuthStateChange((ev, s) => { setSession(s || null); if (ev === "PASSWORD_RECOVERY") setRecovery(true); });
    return () => sub.subscription.unsubscribe();
  }, []);
  return [session, recovery, setRecovery];
}

export default function App() {
  const [session, recovery, setRecovery] = useSession();
  const [papel, setPapel] = useState(undefined);
  const [toast, setToast] = useState("");
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 2800); return () => clearTimeout(t); }, [toast]);

  useEffect(() => {
    if (!session) { setPapel(undefined); return; }
    sb.rpc("meu_papel").then(({ data, error }) => setPapel(error ? null : data || null));
  }, [session && session.user.id]);

  let body;
  if (!sb) body = <div className="auth card empty"><b>Configuração ausente</b>Preencha o arquivo config.js.</div>;
  else if (session === undefined) body = <div className="auth"><div className="empty">Carregando…</div></div>;
  else if (!session) body = <Auth />;
  else if (recovery) body = <NovaSenha onDone={() => setRecovery(false)} notify={setToast} />;
  else if (papel === undefined) body = <div className="auth"><div className="empty">Conferindo seu acesso…</div></div>;
  else if (!papel) body = <SemAcesso email={session.user.email} />;
  else body = <Painel session={session} papel={papel} notify={setToast} />;

  return (
    <>
      <style>{css}</style>
      {body}
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}

function Auth() {
  const [modo, setModo] = useState("entrar");
  const [f, setF] = useState({ nome: "", email: "", senha: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const go = async (e) => {
    e.preventDefault(); setErr(""); setInfo("");
    const email = f.email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr("Digite um e-mail válido.");
    if (modo !== "esqueci" && f.senha.length < 6) return setErr("A senha precisa ter pelo menos 6 caracteres.");
    setBusy(true);
    try {
      if (modo === "entrar") { const { error } = await sb.auth.signInWithPassword({ email, password: f.senha }); if (error) throw error; }
      else if (modo === "criar") {
        const { data, error } = await sb.auth.signUp({ email, password: f.senha, options: { data: { name: f.nome.trim() }, emailRedirectTo: appUrl() } });
        if (error) throw error;
        if (!data.session) setInfo(`Enviamos um link de confirmação para ${email}. Confirme e depois entre aqui.`);
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: appUrl() }); if (error) throw error;
        setInfo(`Se existir uma conta com ${email}, você vai receber um link para criar uma nova senha.`);
      }
    } catch (e2) { setErr(errMsg(e2)); }
    setBusy(false);
  };
  return (
    <div className="auth" style={{ paddingInline: 16 }}>
      <div className="auth-hero">
        <span className="brand-mark" style={{ width: 48, height: 48, borderRadius: 14 }}><Icon name="radar" size={26} /></span>
        <h1>LicitaPro</h1>
        <p>Editais, processos e disputas da equipe num lugar só.</p>
      </div>
      <form className="card form" onSubmit={go} noValidate>
        {modo !== "esqueci" ? (
          <div className="seg" style={{ alignSelf: "flex-start" }}>
            <button type="button" className={modo === "entrar" ? "on" : ""} onClick={() => setModo("entrar")}>Entrar</button>
            <button type="button" className={modo === "criar" ? "on" : ""} onClick={() => setModo("criar")}>Criar conta</button>
          </div>
        ) : <b>Criar nova senha</b>}
        {modo === "criar" && <div className="field"><label htmlFor="a-nome">Seu nome</label><input id="a-nome" className="input" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} autoComplete="name" /></div>}
        <div className="field"><label htmlFor="a-email">E-mail</label><input id="a-email" className="input" type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        {modo !== "esqueci" && <div className="field"><label htmlFor="a-senha">Senha</label><input id="a-senha" className="input" type="password" autoComplete={modo === "criar" ? "new-password" : "current-password"} value={f.senha} onChange={(e) => setF({ ...f, senha: e.target.value })} /></div>}
        {err && <p className="err">{err}</p>}
        {info && <div className="banner info">{info}</div>}
        <button className="btn block" disabled={busy}>{busy ? "Aguarde…" : modo === "entrar" ? "Entrar" : modo === "criar" ? "Criar conta" : "Enviar link"}</button>
        {modo === "entrar" && <button type="button" className="linkbtn" onClick={() => setModo("esqueci")}>Esqueci minha senha</button>}
        {modo === "esqueci" && <button type="button" className="linkbtn" onClick={() => setModo("entrar")}>Voltar para o login</button>}
      </form>
      <p className="hint" style={{ textAlign: "center" }}>O acesso é liberado pelo administrador da equipe.</p>
    </div>
  );
}

function NovaSenha({ onDone, notify }) {
  const [s, setS] = useState(""); const [err, setErr] = useState("");
  const go = async (e) => {
    e.preventDefault();
    if (s.length < 6) return setErr("A senha precisa ter pelo menos 6 caracteres.");
    const { error } = await sb.auth.updateUser({ password: s });
    if (error) return setErr(errMsg(error));
    notify("Senha alterada"); onDone();
  };
  return (
    <form className="auth card form" onSubmit={go} noValidate style={{ marginInline: 16 }}>
      <b>Escolha uma nova senha</b>
      <div className="field"><label htmlFor="ns">Nova senha</label><input id="ns" className="input" type="password" value={s} onChange={(e) => setS(e.target.value)} autoComplete="new-password" /></div>
      {err && <p className="err">{err}</p>}
      <button className="btn block">Salvar</button>
    </form>
  );
}

function SemAcesso({ email }) {
  return (
    <div className="auth" style={{ paddingInline: 16 }}>
      <div className="card form">
        <b style={{ fontSize: 17 }}>Seu acesso ainda não foi liberado</b>
        <p style={{ margin: 0, color: "var(--ink-2)" }}>Peça ao administrador para adicionar <b>{email}</b> em <b>Ajustes → Equipe</b>. Depois disso, é só abrir o app de novo.</p>
        <button className="btn ghost" onClick={() => sb.auth.signOut()}><Icon name="logout" size={16} />Sair</button>
      </div>
    </div>
  );
}

/* ============================================================
   Painel principal
   ============================================================ */
function lerHash() {
  const h = (typeof location !== "undefined" ? location.hash : "").replace(/^#/, "");
  const m = h.match(/^p=([0-9a-f-]{36})$/i);
  if (m) return { tab: "processos", proc: m[1] };
  if (TABS.some((t) => t.id === h)) return { tab: h, proc: null };
  return { tab: "inicio", proc: null };
}

/* No celular o LicitaPro é só para monitorar e buscar editais; o resto fica no computador. */
const MQ_CELULAR = "(max-width: 880px)";
function useCelular() {
  const get = () => { try { return window.matchMedia(MQ_CELULAR).matches; } catch (e) { return false; } };
  const [cel, setCel] = useState(get);
  useEffect(() => {
    let mq; try { mq = window.matchMedia(MQ_CELULAR); } catch (e) { return; }
    const on = () => setCel(mq.matches);
    if (mq.addEventListener) mq.addEventListener("change", on); else mq.addListener(on);
    return () => { if (mq.removeEventListener) mq.removeEventListener("change", on); else mq.removeListener(on); };
  }, []);
  return cel;
}

const fmtCnpj = (c) => { const d = String(c || "").replace(/\D/g, ""); return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : c || ""; };
function cnpjValido(c) {
  const d = String(c || "").replace(/\D/g, "");
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (n) => { let s = 0, p = n - 7; for (let i = 0; i < n; i++) { s += Number(d[i]) * p--; if (p < 2) p = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}
const nomeCurto = (e) => (e ? (String(e.apelidos || "").split(",")[0].trim() || e.nome) : "");

function Painel({ session, papel, notify }) {
  const inicial = lerHash();
  const [tab, setTab] = useState(inicial.tab);
  const [procId, setProcId] = useState(inicial.proc);
  const [procs, setProcs] = useState(null);
  const [naoVistas, setNaoVistas] = useState({});
  const [equipe, setEquipe] = useState([]);
  const [config, setConfig] = useState(null);
  const [empresas, setEmpresas] = useState([]);
  const celular = useCelular();
  const email = session.user.email.toLowerCase();
  const podeEquipe = papel === "admin" || papel === "equipe";
  const pode = podeEquipe && !celular; // edição completa só no computador
  const eu = equipe.find((p) => p.email === email);

  const carregar = useCallback(async () => {
    const [p, nv, eq, cf, em] = await Promise.all([
      sb.from("processos").select("id,orgao,municipio,numero,objeto,portal,etapa,responsavel,data_sessao,prazo_impugnacao,prazo_esclarecimento,situacao_pncp,situacao_portal,link_origem,controle_pncp,erro,ultima_verificacao,created_at,valor_estimado,empresa_id").order("data_sessao", { ascending: true, nullsFirst: false }),
      sb.rpc("nao_vistas"),
      sb.from("equipe").select("*").order("nome"),
      sb.from("config").select("*").eq("id", 1).single(),
      sb.from("empresas").select("*").order("nome"),
    ]);
    if (!p.error) setProcs(p.data);
    if (!nv.error) setNaoVistas(Object.fromEntries((nv.data || []).map((r) => [r.processo_id, r])));
    if (!eq.error) setEquipe(eq.data);
    if (!cf.error) setConfig(cf.data);
    if (!em.error) setEmpresas(em.data || []);
  }, []);

  useEffect(() => {
    carregar();
    let t = null;
    const depois = () => { clearTimeout(t); t = setTimeout(carregar, 600); };
    const novaMov = (payload) => {
      depois();
      const m = payload && payload.new;
      if (!m || !m.importante || m.historico) return;
      if (somLigado()) tocarAlerta();
      notify(`🔔 ${m.titulo || "Nova movimentação importante"}`);
    };
    const ch = sb.channel("painel")
      .on("postgres_changes", { event: "*", schema: "public", table: "processos" }, depois)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "movimentacoes" }, novaMov)
      .subscribe();
    const vis = () => { if (document.visibilityState === "visible") depois(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearTimeout(t); sb.removeChannel(ch); document.removeEventListener("visibilitychange", vis); };
  }, []);

  useEffect(() => {
    const h = procId ? `#p=${procId}` : tab === "inicio" ? "" : `#${tab}`;
    try { history.replaceState(null, "", location.pathname + h); } catch (e) { /* ignora */ }
    try { window.scrollTo(0, 0); } catch (e) { /* ignora */ }
  }, [tab, procId]);

  const abrir = (id) => { setTab("processos"); setProcId(id); };
  const ir = (t) => { setProcId(null); setTab(t); };
  const totalNV = Object.values(naoVistas).reduce((a, r) => a + Number(r.importantes || 0), 0);
  const ctx = { session, email, papel, pode, podeEquipe, celular, equipe, config, empresas, procs, naoVistas, carregar, notify, abrir, ir, setConfig };

  let tela;
  if (procId) tela = <Processo key={procId} id={procId} ctx={ctx} onBack={() => { setProcId(null); carregar(); }} />;
  else if (tab === "inicio") tela = <Inicio ctx={ctx} />;
  else if (tab === "radar") tela = <Radar ctx={ctx} />;
  else if (tab === "processos") tela = <Processos ctx={ctx} />;
  else if (tab === "agenda") tela = <Agenda ctx={ctx} />;
  else tela = <Ajustes ctx={ctx} />;

  return (
    <>
      <aside className="side">
        <div className="brand"><span className="brand-mark"><Icon name="radar" size={18} /></span>LicitaPro</div>
        <nav className="nav" aria-label="Seções">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => ir(t.id)} aria-current={tab === t.id ? "page" : undefined}>
              <Icon name={t.icon} />{t.nome}
              {t.id === "processos" && totalNV > 0 && <span className="badge">{totalNV}</span>}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <span className="brand-mark" style={{ background: "var(--ink-2)", fontSize: 12, fontWeight: 700 }}>{iniciais(eu ? eu.nome : email)}</span>
          <div style={{ minWidth: 0, flex: 1 }}><b style={{ fontSize: 13 }}>{eu ? eu.nome : email}</b><small>{PAPEIS[papel]}</small></div>
          <button className="iconbtn" onClick={() => sb.auth.signOut()} aria-label="Sair" title="Sair"><Icon name="logout" size={16} /></button>
        </div>
      </aside>
      <main className="main">{tela}</main>
      <nav className="bnav" aria-label="Seções">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => ir(t.id)}>
            <Icon name={t.icon} size={21} />{t.nome}
            {t.id === "processos" && totalNV > 0 && <span className="badge dot-badge">{totalNV}</span>}
          </button>
        ))}
      </nav>
    </>
  );
}

/* ============================================================
   Início
   ============================================================ */
function Inicio({ ctx }) {
  const { procs, naoVistas, abrir, ir, config, email, equipe } = ctx;
  const [movs, setMovs] = useState(null);
  const [radarN, setRadarN] = useState(null);
  const eu = equipe.find((p) => p.email === email);

  useEffect(() => {
    sb.from("movimentacoes").select("id,processo_id,titulo,detalhe,fonte,tipo,ocorrido_em,created_at,processos(orgao,numero)")
      .eq("importante", true).eq("historico", false).order("created_at", { ascending: false }).limit(15)
      .then(({ data }) => setMovs(data || []));
    sb.from("editais").select("id", { count: "exact", head: true }).eq("relevante", true).eq("status", "novo").gte("encerramento_propostas", new Date().toISOString())
      .then(({ count }) => setRadarN(count || 0));
  }, [procs]);

  const agora = Date.now();
  const ativos = (procs || []).filter((p) => ATIVAS.includes(p.etapa));
  const proximas = ativos.filter((p) => p.data_sessao && new Date(p.data_sessao).getTime() > agora - 3 * 3600e3 && new Date(p.data_sessao).getTime() < agora + 7 * 864e5);
  const prazos = ativos.filter((p) => p.prazo_impugnacao && new Date(p.prazo_impugnacao).getTime() > agora && new Date(p.prazo_impugnacao).getTime() < agora + 3 * 864e5);
  const hojeN = ativos.filter((p) => p.data_sessao && diaChave(p.data_sessao) === hojeChave()).length;
  const nvTotal = Object.values(naoVistas).reduce((a, r) => a + Number(r.importantes || 0), 0);

  return (
    <div className="stack">
      <div className="top"><div><h1>Olá{eu && eu.nome ? `, ${eu.nome.split(" ")[0]}` : ""}</h1><p>Resumo das licitações da equipe</p></div></div>
      {!ctx.empresas.length && ctx.papel === "admin" && !ctx.celular && (
        <div className="banner warn"><span>Cadastre a empresa em <b>Ajustes → Empresas</b>. Assim o robô reconhece quando o pregoeiro citar vocês e quando vocês vencerem um item.</span></div>
      )}
      <div className="grid3">
        <button className="card kpi" style={{ border: 0, textAlign: "left" }} onClick={() => ir("agenda")}><small>Disputas hoje</small><b className="num">{hojeN}</b><small>{proximas.length} nos próximos 7 dias</small></button>
        <button className="card kpi" style={{ border: 0, textAlign: "left" }} onClick={() => ir("processos")}><small>Processos ativos</small><b className="num">{ativos.length}</b><small>{nvTotal ? `${nvTotal} movimentações importantes novas` : "Nada novo para ver"}</small></button>
        <button className="card kpi" style={{ border: 0, textAlign: "left" }} onClick={() => ir("radar")}><small>Editais novos no radar</small><b className="num">{radarN == null ? "…" : radarN}</b><small>Relevantes e ainda abertos</small></button>
      </div>
      <div className="grid2">
        <div className="card">
          <div className="card-h"><h2>Próximas disputas</h2><button className="btn ghost sm" onClick={() => ir("agenda")}>Agenda</button></div>
          {procs === null ? <div className="empty">Carregando…</div> : proximas.length ? (
            <div className="list">
              {proximas.map((p) => (
                <div key={p.id} className="lrow click" onClick={() => abrir(p.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && abrir(p.id)}>
                  <div className="datebox"><b>{new Date(p.data_sessao).toLocaleDateString("pt-BR", { day: "2-digit", timeZone: "America/Sao_Paulo" })}</b><small>{new Date(p.data_sessao).toLocaleDateString("pt-BR", { month: "short", timeZone: "America/Sao_Paulo" }).replace(".", "")}</small></div>
                  <div className="lmain"><span className="lt">{p.orgao}</span><span className="ls"><PortalTag k={p.portal} />{p.numero && <span>Nº {p.numero}</span>}<EtapaTag id={p.etapa} /></span></div>
                  <div className="when"><b>{fmtHora(p.data_sessao)}</b>{falta(p.data_sessao)}</div>
                </div>
              ))}
            </div>
          ) : <div className="empty"><b>Nenhuma disputa nos próximos 7 dias</b>Cadastre processos pelo Radar ou em Processos.</div>}
          {prazos.length > 0 && (
            <div className="banner warn" style={{ marginTop: 12 }}>
              <div>{prazos.map((p) => <div key={p.id}>⏰ Prazo de impugnação de <b>{p.orgao}</b> termina {fmtDH(p.prazo_impugnacao)}</div>)}</div>
            </div>
          )}
        </div>
        <div className="card">
          <div className="card-h"><h2>Movimentações importantes</h2><small>Mais recentes</small></div>
          {movs === null ? <div className="empty">Carregando…</div> : movs.length ? (
            <div className="list">
              {movs.map((m) => (
                <div key={m.id} className="lrow click" onClick={() => abrir(m.processo_id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && abrir(m.processo_id)}>
                  <div className="tl-ico">{icoMov(m)}</div>
                  <div className="lmain"><span className="lt clamp2">{m.titulo}</span>{m.detalhe && <span className="ls clamp2" style={{ display: "-webkit-box" }}>{m.detalhe}</span>}<span className="ls">{m.processos ? m.processos.orgao : ""}</span></div>
                  <div className="when">{fmtDataCurta(m.ocorrido_em)}<br />{fmtHora(m.ocorrido_em)}</div>
                </div>
              ))}
            </div>
          ) : <div className="empty"><b>Sem movimentações importantes ainda</b>Quando um processo andar, aparece aqui.</div>}
        </div>
      </div>
    </div>
  );
}

const icoMov = (m) => ({ chat: "💬", documento: "📄", resultado: "🏁", item: "📦", situacao: "🔄", lembrete: "⏰", cadastro: "📌", nota: "📝" }[m.tipo] || (m.fonte === "equipe" ? "📝" : "•"));

/* ============================================================
   Radar de editais
   ============================================================ */
function Radar({ ctx }) {
  const { notify, abrir } = ctx;
  const pode = ctx.podeEquipe; // buscar e marcar editais vale também no celular
  const [modo, setModo] = useState("relevantes");
  const [port, setPort] = useState("todos");
  const [q, setQ] = useState("");
  const [busca, setBusca] = useState("");
  const [lista, setLista] = useState(null);
  const [limite, setLimite] = useState(50);
  const [total, setTotal] = useState(0);
  const [ocupado, setOcupado] = useState("");
  const [rodando, setRodando] = useState(false);

  useEffect(() => { const t = setTimeout(() => setBusca(q.trim()), 350); return () => clearTimeout(t); }, [q]);

  const carregar = useCallback(async () => {
    let query = sb.from("editais").select("*", { count: "exact" });
    if (modo === "relevantes") query = query.eq("relevante", true).eq("status", "novo").gte("encerramento_propostas", new Date().toISOString());
    else if (modo === "abertos") query = query.neq("status", "descartado").gte("encerramento_propostas", new Date().toISOString());
    else if (modo === "descartados") query = query.eq("status", "descartado");
    if (port !== "todos") query = port === "outros" ? query.not("portal", "in", "(pcp,licitar,comprasgov,bll,licitacoes-e)") : query.eq("portal", port);
    if (busca) {
      const s = busca.replace(/[,()%*]/g, " ").trim();
      if (s) query = query.or(`objeto.ilike.%${s}%,orgao.ilike.%${s}%,municipio.ilike.%${s}%`);
    }
    query = modo === "descartados" ? query.order("updated_at", { ascending: false }) : query.order("encerramento_propostas", { ascending: true });
    const { data, count, error } = await query.limit(limite);
    if (error) { notify(errMsg(error)); setLista([]); return; }
    setLista(data); setTotal(count || 0);
  }, [modo, port, busca, limite]);
  useEffect(() => { carregar(); }, [carregar]);

  const acompanhar = async (e) => {
    setOcupado(e.id);
    try {
      const r = await chamarRobo({ acao: "cadastrar", entrada: e.controle_pncp });
      notify(r.existente ? "Esse processo já estava cadastrado" : ctx.empresas.filter((x) => x.ativa).length > 1 ? "Processo cadastrado. Escolha a empresa que vai participar." : "Processo cadastrado. O robô já está acompanhando.");
      ctx.carregar();
      abrir(r.id);
    } catch (err) { notify(errMsg(err)); }
    setOcupado("");
  };
  const marcar = async (e, status) => {
    const { error } = await sb.from("editais").update({ status }).eq("id", e.id);
    if (error) return notify(errMsg(error));
    setLista((l) => (modo === "descartados" || status === "descartado" ? l.filter((x) => x.id !== e.id) : l));
    notify(status === "descartado" ? "Edital descartado" : "Edital de volta ao radar");
  };
  const rodar = async () => {
    setRodando(true);
    try { const r = await chamarRobo({ acao: "radar" }); notify(`Radar atualizado: ${r.lidos} editais lidos, ${r.relevantes} relevantes`); carregar(); }
    catch (err) { notify(errMsg(err)); }
    setRodando(false);
  };

  return (
    <div className="stack">
      <div className="top">
        <div><h1>Radar de editais</h1><p>Licitações publicadas no PNCP em {ctx.config ? ctx.config.uf : "MG"}, filtradas pelos produtos da empresa</p></div>
        {pode && <button className="btn ghost" onClick={rodar} disabled={rodando}>{rodando ? <span className="spin" /> : <Icon name="refresh" size={16} />}Buscar agora</button>}
      </div>
      <div className="card form">
        <div className="row-inline" style={{ justifyContent: "space-between" }}>
          <div className="seg">
            {[["relevantes", "Novos relevantes"], ["abertos", "Todos abertos"], ["descartados", "Descartados"]].map(([k, l]) => (
              <button key={k} className={modo === k ? "on" : ""} onClick={() => { setModo(k); setLimite(50); }}>{l}</button>
            ))}
          </div>
          <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 360 }}>
            <input id="radar-busca" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar objeto, órgão ou cidade" style={{ paddingLeft: 34 }} aria-label="Buscar" />
            <span style={{ position: "absolute", left: 10, top: 10, color: "var(--muted)" }}><Icon name="search" size={18} /></span>
          </div>
        </div>
        <div className="chips">
          {[["todos", "Todos os portais"], ["pcp", PORTAIS.pcp.nome], ["licitar", PORTAIS.licitar.nome], ["comprasgov", PORTAIS.comprasgov.nome], ["bll", PORTAIS.bll.nome], ["licitacoes-e", PORTAIS["licitacoes-e"].nome], ["outros", "Outros"]].map(([k, l]) => (
            <button key={k} className={`chip${port === k ? " on" : ""}`} onClick={() => { setPort(k); setLimite(50); }}>{l}</button>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="card-h"><h2>{lista === null ? "Carregando…" : `${total} ${total === 1 ? "edital" : "editais"}`}</h2><small>Ordenados pela data da sessão</small></div>
        {lista && !lista.length && <div className="empty"><b>Nada por aqui</b>{modo === "relevantes" ? "O radar roda a cada hora. Ajuste as palavras-chave em Ajustes se estiver deixando algo de fora." : "Tente outro filtro ou busca."}</div>}
        {lista && lista.length > 0 && (
          <div>
            {lista.map((e) => (
              <div className="ed" key={e.id}>
                <div className="ed-top">
                  <div className="ed-obj clamp3">{e.objeto || "Sem descrição"}</div>
                  {e.status === "acompanhando" && <span className="tag" style={{ background: "var(--accent-soft)", color: "var(--accent-ink)" }}>Acompanhando</span>}
                </div>
                <div className="ed-meta">
                  <span><b>{e.orgao}</b>{e.municipio ? ` · ${e.municipio}` : ""}</span>
                  <PortalTag k={e.portal} />
                  <span>{e.modalidade}{e.numero ? ` nº ${e.numero}` : ""}</span>
                </div>
                <div className="ed-meta">
                  <span>Sessão: <b>{fmtDH(e.encerramento_propostas)}</b> ({falta(e.encerramento_propostas)})</span>
                  {Number(e.valor_estimado) > 0 && <span>Estimado: <b>{brl(e.valor_estimado)}</b></span>}
                  {e.srp && <span>Registro de preços</span>}
                </div>
                {e.termos && e.termos.length > 0 && <div className="termos">{e.termos.slice(0, 6).map((t) => <span key={t}>{t}</span>)}</div>}
                <div className="row-inline">
                  {pode && e.status !== "acompanhando" && <button className="btn sm" onClick={() => acompanhar(e)} disabled={ocupado === e.id}>{ocupado === e.id ? <><span className="spin" />Cadastrando…</> : "Acompanhar"}</button>}
                  {pode && e.status === "novo" && <button className="btn ghost sm" onClick={() => marcar(e, "descartado")}>Descartar</button>}
                  {pode && e.status === "descartado" && <button className="btn ghost sm" onClick={() => marcar(e, "novo")}>Voltar ao radar</button>}
                  {e.link_origem && <a className="btn ghost sm" href={e.link_origem} target="_blank" rel="noopener noreferrer"><Icon name="ext" size={14} />Portal</a>}
                  <a className="btn ghost sm" href={`https://pncp.gov.br/app/editais/${e.cnpj}/${e.ano}/${e.seq}`} target="_blank" rel="noopener noreferrer"><Icon name="ext" size={14} />PNCP</a>
                </div>
              </div>
            ))}
            {lista.length < total && <button className="btn ghost block" style={{ marginTop: 10 }} onClick={() => setLimite(limite + 50)}>Mostrar mais</button>}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   Processos
   ============================================================ */
function Processos({ ctx }) {
  const { procs, naoVistas, abrir, pode, equipe, empresas } = ctx;
  const [filtro, setFiltro] = useState("ativos");
  const [emp, setEmp] = useState("todas");
  const [q, setQ] = useState("");
  const [novo, setNovo] = useState(false);
  const variasEmpresas = empresas.length > 1;
  const empDe = (id) => empresas.find((e) => e.id === id);
  const nomeDe = (e) => (equipe.find((p) => p.email === e) || {}).nome || (e ? e.split("@")[0] : "—");
  const lista = (procs || []).filter((p) =>
    (emp === "todas" || (emp === "sem" ? !p.empresa_id : p.empresa_id === emp)) &&
    (filtro === "todos" || (filtro === "ativos" ? ATIVAS.includes(p.etapa) : filtro === "ganhos" ? p.etapa === "ganhamos" : ["perdemos", "desistimos"].includes(p.etapa))) &&
    (!q || `${p.orgao} ${p.municipio} ${p.numero} ${p.objeto}`.toLowerCase().includes(q.toLowerCase())));
  const ordenada = [...lista].sort((a, b) => {
    const na = naoVistas[a.id] ? 1 : 0, nb = naoVistas[b.id] ? 1 : 0;
    if (na !== nb) return nb - na;
    return (a.data_sessao || "9") < (b.data_sessao || "9") ? -1 : 1;
  });

  return (
    <div className="stack">
      <div className="top">
        <div><h1>Processos</h1><p>Licitações que a equipe está acompanhando</p></div>
        {pode && <button className="btn" onClick={() => setNovo(true)}><Icon name="plus" size={17} />Cadastrar processo</button>}
      </div>
      <div className="row-inline" style={{ justifyContent: "space-between" }}>
        <div className="seg">
          {[["ativos", "Ativos"], ["ganhos", "Ganhos"], ["perdidos", "Perdidos"], ["todos", "Todos"]].map(([k, l]) => <button key={k} className={filtro === k ? "on" : ""} onClick={() => setFiltro(k)}>{l}</button>)}
        </div>
        <input id="proc-busca" className="input" style={{ maxWidth: 300 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar órgão, número ou objeto" aria-label="Buscar processos" />
      </div>
      {variasEmpresas && (
        <div className="chips">
          {[["todas", "Todas as empresas"], ...empresas.map((e) => [e.id, nomeCurto(e)]), ["sem", "Sem empresa"]].map(([k, l]) => (
            <button key={k} className={`chip${emp === k ? " on" : ""}`} onClick={() => setEmp(k)}>{l}</button>
          ))}
        </div>
      )}
      {procs === null ? <div className="card empty">Carregando…</div> : !ordenada.length ? (
        <div className="card empty"><b>Nenhum processo aqui</b>{pode ? "Use “Acompanhar” no Radar ou cadastre pelo link do processo." : "Quando a equipe cadastrar processos, eles aparecem aqui."}</div>
      ) : (
        <div className="pgrid">
          {ordenada.map((p) => {
            const nv = naoVistas[p.id];
            return (
              <button key={p.id} className="pcard" onClick={() => abrir(p.id)}>
                <div className="ptop">
                  <div style={{ minWidth: 0 }}><div className="porg">{p.orgao || "Órgão"}</div><div className="hint">{[p.municipio, p.numero && `Nº ${p.numero}`].filter(Boolean).join(" · ")}</div></div>
                  {nv && <span className={`badge${Number(nv.importantes) ? "" : " soft"}`} title="Movimentações novas">{nv.qtd}</span>}
                </div>
                <div className="hint clamp2" style={{ color: "var(--ink-2)" }}>{p.objeto}</div>
                <div className="row-inline"><EtapaTag id={p.etapa} /><PortalTag k={p.portal} />{variasEmpresas && <span className="tag">{p.empresa_id ? nomeCurto(empDe(p.empresa_id)) : "Sem empresa"}</span>}</div>
                <div className="estado">
                  {p.data_sessao ? <>Sessão {fmtDH(p.data_sessao)} · <b>{falta(p.data_sessao)}</b></> : "Data da sessão não informada"}
                  {(p.situacao_portal || p.situacao_pncp) && <div className="hint">{p.situacao_portal || p.situacao_pncp}</div>}
                </div>
                <div className="row-inline" style={{ justifyContent: "space-between" }}>
                  <span className="hint">Responsável: {nomeDe(p.responsavel)}</span>
                  {p.erro && <span className="err-mini">⚠ verificação com erro</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}
      {novo && <NovoProcesso ctx={ctx} onClose={() => setNovo(false)} />}
    </div>
  );
}

function NovoProcesso({ ctx, onClose }) {
  const ativas = ctx.empresas.filter((x) => x.ativa);
  const [v, setV] = useState("");
  const [empId, setEmpId] = useState(ativas.length === 1 ? ativas[0].id : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const go = async (e) => {
    e.preventDefault();
    if (!v.trim()) return setErr("Cole o link ou o número do processo.");
    if (ativas.length > 1 && !empId) return setErr("Escolha a empresa que vai participar.");
    setBusy(true); setErr("");
    try {
      const r = await chamarRobo({ acao: "cadastrar", entrada: v.trim(), empresa_id: empId || null });
      ctx.notify(r.existente ? "Esse processo já estava cadastrado" : "Processo cadastrado. O robô já está acompanhando.");
      ctx.carregar(); onClose(); ctx.abrir(r.id);
    } catch (e2) { setErr(errMsg(e2)); }
    setBusy(false);
  };
  return (
    <div className="sheet-bg" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={go} noValidate role="dialog" aria-modal="true" aria-label="Cadastrar processo">
        <div className="sheet-h"><h2>Cadastrar processo</h2><button type="button" className="iconbtn" onClick={onClose} aria-label="Fechar"><Icon name="x" size={18} /></button></div>
        <div className="field">
          <label htmlFor="np-link">Link ou número do processo</label>
          <textarea id="np-link" className="input" rows={3} value={v} onChange={(e) => setV(e.target.value)} placeholder="https://www.portaldecompraspublicas.com.br/processos/MG/…" />
        </div>
        {ativas.length > 1 && (
          <div className="field"><label htmlFor="np-emp">Empresa que vai participar</label>
            <select id="np-emp" className="input" value={empId} onChange={(e) => setEmpId(e.target.value)}>
              <option value="">Escolha…</option>
              {ativas.map((x) => <option key={x.id} value={x.id}>{x.nome} · {fmtCnpj(x.cnpj)}</option>)}
            </select></div>
        )}
        <div className="hint">
          Aceita:
          <ul className="steps" style={{ marginTop: 6, fontSize: 12.5 }}>
            <li>link do processo no <b>Portal de Compras Públicas</b>;</li>
            <li>link do processo no <b>PNCP</b> (pncp.gov.br/app/editais/…);</li>
            <li>número de controle do PNCP (ex.: <code>18192898000102-1-000167/2026</code>);</li>
            <li>link do <b>Licitar Digital</b>, se o processo já apareceu no radar.</li>
          </ul>
        </div>
        {err && <p className="err">{err}</p>}
        <button className="btn block" disabled={busy}>{busy ? <><span className="spin" />Buscando o processo…</> : "Cadastrar e acompanhar"}</button>
      </form>
    </div>
  );
}

/* ============================================================
   Detalhe do processo
   ============================================================ */
function Processo({ id, ctx, onBack }) {
  const { pode, email, equipe, notify } = ctx;
  const [p, setP] = useState(null);
  const [movs, setMovs] = useState([]);
  const [itens, setItens] = useState([]);
  const [aba, setAba] = useState("mov");
  const [filtroMov, setFiltroMov] = useState("todas");
  const [soMeus, setSoMeus] = useState(false);
  const [verificando, setVerificando] = useState(false);
  const [nota, setNota] = useState("");
  const [vistoAntes, setVistoAntes] = useState(null);
  const [err, setErr] = useState("");

  const carregar = useCallback(async () => {
    const [a, b, c] = await Promise.all([
      sb.from("processos").select("*").eq("id", id).maybeSingle(),
      sb.from("movimentacoes").select("*").eq("processo_id", id).order("ocorrido_em", { ascending: false }).limit(400),
      sb.from("itens").select("*").eq("processo_id", id).order("numero"),
    ]);
    if (a.error || !a.data) { setErr(a.error ? errMsg(a.error) : "Processo não encontrado."); return; }
    setP(a.data); setMovs(b.data || []); setItens(c.data || []);
    if (c.data && c.data.some((i) => i.participar)) setSoMeus((s) => s || false);
  }, [id]);

  useEffect(() => {
    (async () => {
      const { data } = await sb.from("vistos").select("visto_em").eq("email", email).eq("processo_id", id).maybeSingle();
      setVistoAntes(data ? data.visto_em : "1970-01-01T00:00:00Z");
      await sb.from("vistos").upsert({ email, processo_id: id, visto_em: new Date().toISOString() }, { onConflict: "email,processo_id" });
    })();
    carregar();
    const ch = sb.channel(`proc-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "movimentacoes", filter: `processo_id=eq.${id}` }, () => carregar())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "processos", filter: `id=eq.${id}` }, () => carregar())
      .subscribe();
    return () => {
      sb.removeChannel(ch);
      sb.from("vistos").upsert({ email, processo_id: id, visto_em: new Date().toISOString() }, { onConflict: "email,processo_id" });
    };
  }, [id]);

  const salvar = async (patch, msg) => {
    const { error } = await sb.from("processos").update(patch).eq("id", id);
    if (error) return notify(errMsg(error));
    setP((x) => ({ ...x, ...patch })); notify(msg);
  };
  const verificar = async () => {
    setVerificando(true);
    try { const r = await chamarRobo({ acao: "verificar", id }); notify(r.novas ? `${r.novas} movimentação(ões) registradas` : "Nada novo desde a última verificação"); await carregar(); }
    catch (e) { notify(errMsg(e)); }
    setVerificando(false);
  };
  const anotar = async (e) => {
    e.preventDefault();
    const t = nota.trim(); if (!t) return;
    const { error } = await sb.from("movimentacoes").insert({ processo_id: id, fonte: "equipe", tipo: "nota", titulo: t.length > 120 ? t.slice(0, 117) + "…" : t, detalhe: t.length > 120 ? t : null, autor: email, ocorrido_em: new Date().toISOString() });
    if (error) return notify(errMsg(error));
    setNota(""); carregar();
  };
  const apagarNota = async (m) => { const { error } = await sb.from("movimentacoes").delete().eq("id", m.id); if (error) return notify(errMsg(error)); carregar(); };
  const excluir = async () => { const { error } = await sb.from("processos").delete().eq("id", id); if (error) return notify(errMsg(error)); notify("Processo removido do acompanhamento"); onBack(); };

  if (err) return <div className="stack"><button className="back" onClick={onBack}><Icon name="left" size={18} />Processos</button><div className="card empty"><b>Não foi possível abrir</b>{err}</div></div>;
  if (!p) return <div className="card empty">Abrindo o processo…</div>;

  const nomeDe = (e) => (equipe.find((x) => x.email === e) || {}).nome || (e ? e.split("@")[0] : "");
  const filtradas = movs.filter((m) => filtroMov === "todas" ? true : filtroMov === "importantes" ? m.importante : filtroMov === "chat" ? m.tipo === "chat" : filtroMov === "docs" ? m.tipo === "documento" : m.fonte === "equipe");
  const meus = itens.filter((i) => i.participar);
  const pncpLink = p.cnpj ? `https://pncp.gov.br/app/editais/${p.cnpj}/${p.ano}/${p.seq}` : null;

  let ultimoDia = "";
  return (
    <div className="stack">
      <div>
        <button className="back" onClick={onBack}><Icon name="left" size={18} />Processos</button>
        <div className="phead">
          <div className="row-inline"><PortalTag k={p.portal} /><EtapaTag id={p.etapa} />{p.modalidade && <span className="tag">{p.modalidade}</span>}</div>
          <h1>{p.orgao}{p.numero ? ` · Nº ${p.numero}` : ""}</h1>
          <div className="hint clamp3" style={{ color: "var(--ink-2)", fontSize: 13.5 }}>{p.objeto}</div>
        </div>
      </div>

      {p.erro && <div className="banner warn">⚠ Última verificação: {p.erro}</div>}

      <div className="card stack" style={{ gap: 12 }}>
        <div className="facts">
          <div className="fact"><small>Sessão</small><b>{fmtDH(p.data_sessao)}</b><div className="hint">{p.data_sessao ? falta(p.data_sessao) : ""}</div></div>
          <div className="fact"><small>Situação</small><b>{p.situacao_portal || p.situacao_pncp || "—"}</b>{p.situacao_portal && p.situacao_pncp && <div className="hint">PNCP: {p.situacao_pncp}</div>}</div>
          <div className="fact"><small>Prazo de impugnação</small><b>{fmtDH(p.prazo_impugnacao)}</b></div>
          <div className="fact"><small>Valor estimado</small><b>{Number(p.valor_estimado) > 0 ? brl(p.valor_estimado) : "Sigiloso ou não informado"}</b>{Number(p.valor_homologado) > 0 && <div className="hint">Homologado: {brl(p.valor_homologado)}</div>}</div>
        </div>
        <div className="fgrid">
          <div className="field"><label htmlFor="pe-etapa">Etapa</label>
            <select id="pe-etapa" className="input" value={p.etapa} disabled={!pode} onChange={(e) => salvar({ etapa: e.target.value }, `Etapa: ${etapa(e.target.value).nome}`)}>
              {ETAPAS.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
            </select></div>
          <div className="field"><label htmlFor="pe-resp">Responsável</label>
            <select id="pe-resp" className="input" value={p.responsavel || ""} disabled={!pode} onChange={(e) => salvar({ responsavel: e.target.value || null }, "Responsável atualizado")}>
              <option value="">Ninguém</option>
              {equipe.filter((x) => x.ativo).map((x) => <option key={x.email} value={x.email}>{x.nome || x.email}</option>)}
            </select></div>
          <div className="field"><label htmlFor="pe-emp">Empresa participante</label>
            <select id="pe-emp" className="input" value={p.empresa_id || ""} disabled={!pode} onChange={(e) => salvar({ empresa_id: e.target.value || null }, "Empresa atualizada")}>
              <option value="">Nenhuma marcada</option>
              {ctx.empresas.filter((x) => x.ativa || x.id === p.empresa_id).map((x) => <option key={x.id} value={x.id}>{nomeCurto(x)} · {fmtCnpj(x.cnpj)}</option>)}
            </select></div>
        </div>
        {ctx.celular && <p className="hint">No celular o processo fica só para acompanhar. Etapa, empresa, itens e anotações são editados pelo computador.</p>}
        <div className="row-inline">
          <button className="btn ghost sm" onClick={verificar} disabled={verificando}>{verificando ? <span className="spin" /> : <Icon name="refresh" size={15} />}Verificar agora</button>
          {p.link_origem && <a className="btn ghost sm" href={p.link_origem} target="_blank" rel="noopener noreferrer"><Icon name="ext" size={14} />Abrir no portal</a>}
          {pncpLink && <a className="btn ghost sm" href={pncpLink} target="_blank" rel="noopener noreferrer"><Icon name="ext" size={14} />Ver no PNCP</a>}
          <span className="hint" style={{ marginLeft: "auto" }}>{p.ultima_verificacao ? `Verificado ${falta(p.ultima_verificacao)} · próxima ${falta(p.proxima_verificacao)}` : "Aguardando a primeira verificação"}</span>
        </div>
        {p.portal === "licitar" && <p className="hint">No Licitar Digital, o robô acompanha pelo PNCP: situação, itens, documentos e resultados. O chat da sessão fica só no portal.</p>}
      </div>

      <div className="seg" role="tablist" style={{ alignSelf: "flex-start" }}>
        <button role="tab" aria-selected={aba === "mov"} className={aba === "mov" ? "on" : ""} onClick={() => setAba("mov")}>Movimentações ({movs.filter((m) => !m.historico).length})</button>
        <button role="tab" aria-selected={aba === "itens"} className={aba === "itens" ? "on" : ""} onClick={() => setAba("itens")}>Itens ({itens.length}){meus.length ? ` · ${meus.length} nossos` : ""}</button>
      </div>

      {aba === "mov" && (
        <div className="card">
          {!ctx.celular && (
            <form className="row-inline" onSubmit={anotar} style={{ marginBottom: 14, flexWrap: "nowrap" }}>
              <input id="pe-nota" className="input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Escrever uma anotação para a equipe" aria-label="Anotação" />
              <button className="btn" disabled={!nota.trim()}>Anotar</button>
            </form>
          )}
          <div className="chips" style={{ marginBottom: 12 }}>
            {[["todas", "Todas"], ["importantes", "Importantes"], ["chat", "Chat do pregão"], ["docs", "Documentos"], ["equipe", "Anotações"]].map(([k, l]) => <button key={k} className={`chip${filtroMov === k ? " on" : ""}`} onClick={() => setFiltroMov(k)}>{l}</button>)}
          </div>
          {!filtradas.length ? <div className="empty">Nenhuma movimentação neste filtro.</div> : (
            <div className="tl">
              {filtradas.map((m) => {
                const dia = diaChave(m.ocorrido_em);
                const head = dia !== ultimoDia ? <div className="tl-day">{diaLongo(dia)}</div> : null;
                ultimoDia = dia;
                const novo = vistoAntes && !m.historico && m.created_at > vistoAntes;
                return (
                  <React.Fragment key={m.id}>
                    {head}
                    <div className={`tl-item${m.importante ? " imp" : ""}${novo ? " novo" : ""}`}>
                      <div className="tl-ico">{icoMov(m)}</div>
                      <div className="tl-body">
                        <b>{m.titulo}</b>
                        {m.detalhe && m.detalhe !== m.titulo && <p>{m.detalhe}</p>}
                        <div className="tl-meta">
                          <span>{fmtHora(m.ocorrido_em)}</span>
                          <span className="tag">{{ pncp: "PNCP", portal: "Portal", equipe: nomeDe(m.autor) || "Equipe", lembrete: "Lembrete", sistema: "Sistema" }[m.fonte]}</span>
                          {m.importante && <span className="tag" style={{ background: "var(--amber-soft)", color: "var(--amber)" }}>Importante</span>}
                          {novo && <span className="tag" style={{ background: "var(--accent-soft)", color: "var(--accent-ink)" }}>Novo</span>}
                          {m.historico && <span>antes do cadastro</span>}
                          {m.link && <a href={m.link} target="_blank" rel="noopener noreferrer" className="linkbtn" style={{ fontSize: 12 }}>Abrir documento</a>}
                          {m.fonte === "equipe" && (m.autor === email || ctx.papel === "admin") && <ConfirmX label="Apagar" confirmLabel="Apagar?" onConfirm={() => apagarNota(m)} />}
                        </div>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </div>
      )}

      {aba === "itens" && (
        <div className="card">
          <div className="card-h">
            <h2>Itens</h2>
            <label className="toggle"><input type="checkbox" checked={soMeus} onChange={(e) => setSoMeus(e.target.checked)} />Só os que vamos disputar</label>
          </div>
          <p className="hint" style={{ marginBottom: 12 }}>Marque os itens que a empresa vai disputar e preencha custo, frete, impostos e margem. O app calcula o <b>valor mínimo</b> do lance e o robô avisa quando o resultado de cada um sair.</p>
          {!itens.length ? <div className="empty">Os itens aparecem aqui depois da primeira verificação.</div> : (
            <div className="stack" style={{ gap: 10 }}>
              {(soMeus ? meus : itens).map((it) => <Item key={it.id} it={it} pode={pode} notify={notify} onSaved={(n) => setItens((l) => l.map((x) => (x.id === n.id ? n : x)))} />)}
              {soMeus && !meus.length && <div className="empty">Nenhum item marcado ainda.</div>}
            </div>
          )}
        </div>
      )}

      {pode && (
        <div className="row-inline" style={{ justifyContent: "flex-end" }}>
          <ConfirmX label="Parar de acompanhar e excluir" confirmLabel="Excluir processo e histórico?" onConfirm={excluir} />
        </div>
      )}
    </div>
  );
}

function Item({ it, pode, notify, onSaved }) {
  const [aberto, setAberto] = useState(false);
  const [f, setF] = useState({ custo: fmtIn(it.custo), frete: fmtIn(it.frete), impostos_pct: fmtIn(it.impostos_pct), margem_pct: fmtIn(it.margem_pct), marca: it.marca || "" });
  const [busy, setBusy] = useState(false);
  const calc = valorMinimo({ custo: parseNum(f.custo), frete: parseNum(f.frete), impostos_pct: parseNum(f.impostos_pct), margem_pct: parseNum(f.margem_pct) });
  const vm = it.valor_minimo != null ? Number(it.valor_minimo) : null;
  const lance = it.melhor_lance != null ? Number(it.melhor_lance) : null;

  const marcar = async (v) => {
    const { data, error } = await sb.from("itens").update({ participar: v }).eq("id", it.id).select("*").single();
    if (error) return notify(errMsg(error));
    onSaved(data); if (v) setAberto(true);
  };
  const salvar = async () => {
    setBusy(true);
    const patch = { custo: parseNum(f.custo), frete: parseNum(f.frete), impostos_pct: parseNum(f.impostos_pct), margem_pct: parseNum(f.margem_pct), marca: f.marca.trim() || null, valor_minimo: calc };
    const { data, error } = await sb.from("itens").update(patch).eq("id", it.id).select("*").single();
    setBusy(false);
    if (error) return notify(errMsg(error));
    onSaved(data); notify(`Item ${it.numero}: valor mínimo ${brl(calc, 2)}`);
  };

  return (
    <div className={`item${it.participar ? " on" : ""}`}>
      <div className="item-top">
        <span className="item-n">{it.numero}</span>
        <div className="item-d clamp3">{it.descricao || "Sem descrição"}</div>
        {pode ? <label className="toggle"><input type="checkbox" checked={it.participar} onChange={(e) => marcar(e.target.checked)} />Vamos disputar</label>
          : it.participar && <span className="tag">Vamos disputar</span>}
      </div>
      <div className="item-meta">
        <span>Qtd: <b>{num(it.quantidade)} {it.unidade || ""}</b></span>
        {it.valor_ref != null && Number(it.valor_ref) > 0 && <span>Ref. unitária: <b>{brl(it.valor_ref)}</b></span>}
        {(it.situacao_portal || it.situacao) && <span>Situação: <b>{it.situacao_portal || it.situacao}</b></span>}
        {lance != null && <span>Melhor lance: <b>{brl(lance)}</b></span>}
        {vm != null && <span>Nosso mínimo: <b style={{ color: "var(--accent-ink)" }}>{brl(vm)}</b></span>}
        {it.marca && <span>Marca: <b>{it.marca}</b></span>}
      </div>
      {it.participar && vm != null && lance != null && (
        <div className={`alerta-lance ${lance >= vm ? "ok" : "ruim"}`}>{lance >= vm ? `Ainda dá para disputar: o melhor lance está ${brl(lance - vm)} acima do nosso mínimo.` : `O melhor lance está ${brl(vm - lance)} abaixo do nosso mínimo.`}</div>
      )}
      {it.resultado_fornecedor && <div className="estado">🏁 Vencedor: <b>{it.resultado_fornecedor}</b>{it.resultado_valor != null ? ` · ${brl(it.resultado_valor)}` : ""}</div>}
      {it.participar && (
        aberto || vm == null ? (
          <div className="stack" style={{ gap: 8 }}>
            <div className="calc">
              <div className="field"><label htmlFor={`c-${it.id}`}>Custo unitário</label><input id={`c-${it.id}`} className="input num" inputMode="decimal" disabled={!pode} value={f.custo} onChange={(e) => setF({ ...f, custo: e.target.value })} placeholder="0,00" /></div>
              <div className="field"><label htmlFor={`f-${it.id}`}>Frete unitário</label><input id={`f-${it.id}`} className="input num" inputMode="decimal" disabled={!pode} value={f.frete} onChange={(e) => setF({ ...f, frete: e.target.value })} placeholder="0,00" /></div>
              <div className="field"><label htmlFor={`i-${it.id}`}>Impostos %</label><input id={`i-${it.id}`} className="input num" inputMode="decimal" disabled={!pode} value={f.impostos_pct} onChange={(e) => setF({ ...f, impostos_pct: e.target.value })} placeholder="Ex.: 8" /></div>
              <div className="field"><label htmlFor={`m-${it.id}`}>Margem %</label><input id={`m-${it.id}`} className="input num" inputMode="decimal" disabled={!pode} value={f.margem_pct} onChange={(e) => setF({ ...f, margem_pct: e.target.value })} placeholder="Ex.: 12" /></div>
              <div className="field"><label htmlFor={`mk-${it.id}`}>Marca</label><input id={`mk-${it.id}`} className="input" disabled={!pode} value={f.marca} onChange={(e) => setF({ ...f, marca: e.target.value })} /></div>
              <div className="vmin"><small>Valor mínimo do lance</small><b className="num">{calc != null ? brl(calc) : "—"}</b></div>
            </div>
            <p className="hint">Valor mínimo = (custo + frete) ÷ (1 − impostos − margem). Abaixo dele, a empresa passa a ter margem menor que a definida.</p>
            {pode && <div className="row-inline"><button className="btn sm" onClick={salvar} disabled={busy}>{busy ? "Salvando…" : "Salvar valores"}</button>{vm != null && <button className="btn ghost sm" onClick={() => setAberto(false)}>Fechar</button>}</div>}
          </div>
        ) : <button className="linkbtn" style={{ alignSelf: "flex-start" }} onClick={() => setAberto(true)}>{pode ? "Editar custo e margem" : "Ver cálculo"}</button>
      )}
    </div>
  );
}

/* ============================================================
   Agenda
   ============================================================ */
function Agenda({ ctx }) {
  const { procs, abrir } = ctx;
  const agora = Date.now();
  const eventos = [];
  (procs || []).filter((p) => ATIVAS.includes(p.etapa)).forEach((p) => {
    if (p.data_sessao && new Date(p.data_sessao).getTime() > agora - 12 * 3600e3) eventos.push({ quando: p.data_sessao, tipo: "Sessão de disputa", p });
    if (p.prazo_impugnacao && new Date(p.prazo_impugnacao).getTime() > agora) eventos.push({ quando: p.prazo_impugnacao, tipo: "Fim do prazo de impugnação e esclarecimento", p });
  });
  eventos.sort((a, b) => (a.quando < b.quando ? -1 : 1));
  let ultimo = "";
  return (
    <div className="stack">
      <div className="top"><div><h1>Agenda</h1><p>Sessões e prazos dos processos ativos</p></div></div>
      <div className="card">
        {procs === null ? <div className="empty">Carregando…</div> : !eventos.length ? <div className="empty"><b>Nada agendado</b>As sessões aparecem aqui quando os processos são cadastrados.</div> : (
          <div className="tl">
            {eventos.map((ev, i) => {
              const dia = diaChave(ev.quando);
              const head = dia !== ultimo ? <div className="tl-day">{diaLongo(dia)} · {fmtData(ev.quando)}</div> : null;
              ultimo = dia;
              return (
                <React.Fragment key={i}>
                  {head}
                  <div className="tl-item" style={{ cursor: "pointer" }} onClick={() => abrir(ev.p.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && abrir(ev.p.id)}>
                    <div className="tl-ico">{ev.tipo.startsWith("Sessão") ? "⚖️" : "⏰"}</div>
                    <div className="tl-body">
                      <b>{fmtHora(ev.quando)} · {ev.p.orgao}</b>
                      <p>{ev.tipo}{ev.p.numero ? ` · Nº ${ev.p.numero}` : ""}</p>
                      <div className="tl-meta"><PortalTag k={ev.p.portal} /><EtapaTag id={ev.p.etapa} /><span>{falta(ev.quando)}</span></div>
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   Ajustes
   ============================================================ */
function Ajustes({ ctx }) {
  const { papel, pode, config, equipe, notify, carregar, email, setConfig } = ctx;
  const admin = papel === "admin";
  const conta = (
    <div className="card form">
      <div className="card-h" style={{ marginBottom: 0 }}><h2>Sua conta</h2></div>
      <p className="hint">{email} · {PAPEIS[papel]}</p>
      <button className="btn ghost" style={{ alignSelf: "flex-start" }} onClick={() => sb.auth.signOut()}><Icon name="logout" size={16} />Sair</button>
    </div>
  );
  if (ctx.celular) {
    return (
      <div className="stack">
        <div className="top"><div><h1>Ajustes</h1><p>Alerta e conta neste celular</p></div></div>
        <div className="banner info"><span>Empresas, acessos aos portais, equipe e palavras-chave são configurados pelo <b>computador</b>.</span></div>
        <SomAlerta />
        {conta}
      </div>
    );
  }
  return (
    <div className="stack">
      <div className="top"><div><h1>Ajustes</h1><p>Empresas, acessos, equipe, palavras-chave e avisos</p></div></div>
      <Empresas ctx={ctx} />
      <div className="grid2">
        <div className="stack">
          <Equipe equipe={equipe} admin={admin} notify={notify} carregar={carregar} email={email} />
          <SomAlerta />
        </div>
        <div className="stack">
          <Palavras pode={pode} notify={notify} />
          {admin && config && <Telegram config={config} notify={notify} setConfig={setConfig} />}
          {conta}
        </div>
      </div>
    </div>
  );
}

/* ---------- Empresas (uma por CNPJ) e acessos aos portais ---------- */
const PORTAIS_ACESSO = ["pcp", "licitar", "comprasgov", "bll", "licitacoes-e", "mg", "bnc", "licitanet", "outro"];

function Empresas({ ctx }) {
  const { empresas, papel, notify, carregar } = ctx;
  const admin = papel === "admin";
  const [acessos, setAcessos] = useState([]);
  const [aberta, setAberta] = useState(null);
  const [form, setForm] = useState(null);
  const carregarAcessos = useCallback(async () => {
    const { data, error } = await sb.rpc("acessos_status");
    if (!error) setAcessos(data || []);
  }, []);
  useEffect(() => { carregarAcessos(); }, [carregarAcessos]);
  useEffect(() => { if (aberta === null && empresas.length === 1) setAberta(empresas[0].id); }, [empresas]);

  return (
    <div className="card">
      <div className="card-h">
        <h2>Empresas e acessos aos portais</h2>
        {admin && <button className="btn sm" onClick={() => setForm({})}><Icon name="plus" size={15} />Nova empresa</button>}
      </div>
      <p className="hint" style={{ marginBottom: 12 }}>
        Cada empresa é cadastrada pelo CNPJ, com o login dela em cada portal. As senhas ficam guardadas criptografadas no cofre do banco:
        depois de salvas, ninguém consegue vê-las pelo app, nem o administrador. Elas serão usadas pelo robô de lances quando ele estiver pronto.
      </p>
      {!empresas.length ? <div className="empty"><b>Nenhuma empresa cadastrada</b>{admin ? "Use “Nova empresa”." : "O administrador cadastra as empresas."}</div> : (
        <div className="stack" style={{ gap: 10 }}>
          {empresas.map((e) => {
            const meus = acessos.filter((a) => a.empresa_id === e.id);
            const open = aberta === e.id;
            return (
              <div key={e.id} className="emp">
                <div className="emp-h">
                  <div style={{ minWidth: 0 }}>
                    <b>{e.nome}</b>{!e.ativa && <span className="tag" style={{ marginLeft: 8 }}>Inativa</span>}
                    <div className="hint">CNPJ {fmtCnpj(e.cnpj)}{e.apelidos ? ` · também aparece como: ${e.apelidos}` : ""}</div>
                  </div>
                  <div className="row-inline" style={{ flexWrap: "nowrap" }}>
                    {ctx.podeEquipe && <button className="btn ghost sm" onClick={() => setAberta(open ? null : e.id)} aria-expanded={open}>Acessos ({meus.length})</button>}
                    {admin && <button className="btn ghost sm" onClick={() => setForm(e)}>Editar</button>}
                  </div>
                </div>
                {open && <Acessos empresa={e} acessos={meus} admin={admin} notify={notify} recarregar={carregarAcessos} />}
              </div>
            );
          })}
        </div>
      )}
      {form && <EmpresaForm emp={form} notify={notify} onClose={() => setForm(null)} onSaved={(id) => { setForm(null); carregar(); if (id) setAberta(id); }} />}
    </div>
  );
}

function EmpresaForm({ emp, notify, onClose, onSaved }) {
  const novo = !emp.id;
  const [f, setF] = useState({ nome: emp.nome || "", cnpj: fmtCnpj(emp.cnpj || ""), apelidos: emp.apelidos || "", ativa: emp.ativa !== false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const salvar = async (ev) => {
    ev.preventDefault();
    const cnpj = f.cnpj.replace(/\D/g, "");
    if (f.nome.trim().length < 2) return setErr("Digite a razão social.");
    if (!cnpjValido(cnpj)) return setErr("CNPJ inválido. Confira os 14 números.");
    const apelidos = f.apelidos.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean).join(", ");
    setBusy(true); setErr("");
    const row = { nome: f.nome.trim(), cnpj, apelidos, ativa: f.ativa };
    const r = novo ? await sb.from("empresas").insert(row).select("id").single() : await sb.from("empresas").update(row).eq("id", emp.id).select("id").single();
    setBusy(false);
    if (r.error) return setErr(/duplicate|unique/i.test(r.error.message) ? "Já existe uma empresa com esse CNPJ." : errMsg(r.error));
    notify(novo ? "Empresa cadastrada. Agora adicione os acessos aos portais." : "Empresa atualizada");
    onSaved(r.data && r.data.id);
  };
  return (
    <div className="sheet-bg" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={salvar} noValidate role="dialog" aria-modal="true" aria-label={novo ? "Nova empresa" : "Editar empresa"}>
        <div className="sheet-h"><h2>{novo ? "Nova empresa" : "Editar empresa"}</h2><button type="button" className="iconbtn" onClick={onClose} aria-label="Fechar"><Icon name="x" size={18} /></button></div>
        <div className="field"><label htmlFor="ef-nome">Razão social</label><input id="ef-nome" className="input" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Ex.: Miramed Comércio Ltda" /></div>
        <div className="field"><label htmlFor="ef-cnpj">CNPJ</label><input id="ef-cnpj" className="input num" inputMode="numeric" value={f.cnpj} onChange={(e) => setF({ ...f, cnpj: e.target.value })} onBlur={() => setF((x) => ({ ...x, cnpj: fmtCnpj(x.cnpj) }))} placeholder="00.000.000/0000-00" /></div>
        <div className="field"><label htmlFor="ef-ap">Outros nomes usados nos portais <span style={{ fontWeight: 400, color: "var(--muted)" }}>(separe por vírgula)</span></label><input id="ef-ap" className="input" value={f.apelidos} onChange={(e) => setF({ ...f, apelidos: e.target.value })} placeholder="Ex.: Miramed" /></div>
        <p className="hint" style={{ margin: 0 }}>O robô usa a razão social, esses nomes e o CNPJ para avisar quando o pregoeiro citar a empresa e quando ela vencer um item.</p>
        {!novo && <label className="toggle"><input type="checkbox" checked={f.ativa} onChange={(e) => setF({ ...f, ativa: e.target.checked })} />Empresa ativa em licitações</label>}
        {err && <p className="err">{err}</p>}
        <button className="btn block" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</button>
      </form>
    </div>
  );
}

function Acessos({ empresa, acessos, admin, notify, recarregar }) {
  const vazio = { portal: "", usuario: "", senha: "", observacao: "" };
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const usados = acessos.map((a) => a.portal);
  const editar = (a) => { setErr(""); setF({ portal: a.portal, usuario: a.usuario, senha: "", observacao: a.observacao || "", existente: true, tem_senha: a.tem_senha }); };
  const salvar = async (ev) => {
    ev.preventDefault();
    if (!f.portal) return setErr("Escolha o portal.");
    if (!f.usuario.trim()) return setErr("Digite o usuário (login) do portal.");
    if (!f.existente && !f.senha) return setErr("Digite a senha do portal.");
    setBusy(true); setErr("");
    const { error } = await sb.rpc("salvar_acesso", { p_empresa: empresa.id, p_portal: f.portal, p_usuario: f.usuario.trim(), p_senha: f.senha || null, p_obs: f.observacao || null });
    setBusy(false);
    if (error) return setErr(errMsg(error));
    notify(f.senha ? "Acesso salvo. A senha foi guardada criptografada." : "Acesso atualizado");
    setF(null); recarregar();
  };
  const remover = async (a) => {
    const { error } = await sb.rpc("remover_acesso", { p_id: a.id });
    if (error) return notify(errMsg(error));
    notify("Acesso removido e senha apagada do cofre"); recarregar();
  };
  return (
    <div className="emp-body">
      {!acessos.length ? <div className="hint">Nenhum acesso cadastrado para esta empresa.</div> : (
        <div className="list">
          {acessos.map((a) => (
            <div key={a.id} className="lrow">
              <div className="lmain">
                <span className="lt"><PortalTag k={a.portal} /> {portal(a.portal).nome}</span>
                <span className="ls">Usuário: <b>{a.usuario}</b> · {a.tem_senha ? "🔒 senha guardada" : "⚠ sem senha"}{a.observacao ? ` · ${a.observacao}` : ""}</span>
                <span className="ls">Atualizado {fmtDH(a.atualizado_em)}{a.atualizado_por ? ` por ${a.atualizado_por.split("@")[0]}` : ""}</span>
              </div>
              {admin && (
                <div className="row-inline" style={{ flexWrap: "nowrap" }}>
                  <button className="btn ghost sm" onClick={() => editar(a)}>Alterar</button>
                  <ConfirmX label="Remover" confirmLabel="Remover?" onConfirm={() => remover(a)} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {admin && !f && usados.length < PORTAIS_ACESSO.length && (
        <button className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={() => { setErr(""); setF({ ...vazio }); }}><Icon name="plus" size={15} />Adicionar acesso</button>
      )}
      {admin && f && (
        <form className="acc-form" onSubmit={salvar} noValidate autoComplete="off">
          <div className="fgrid">
            <div className="field"><label htmlFor={`ac-p-${empresa.id}`}>Portal</label>
              <select id={`ac-p-${empresa.id}`} className="input" value={f.portal} disabled={f.existente} onChange={(e) => setF({ ...f, portal: e.target.value })}>
                <option value="">Escolha…</option>
                {PORTAIS_ACESSO.filter((k) => f.existente ? k === f.portal : !usados.includes(k)).map((k) => <option key={k} value={k}>{portal(k).nome}</option>)}
              </select></div>
            <div className="field"><label htmlFor={`ac-u-${empresa.id}`}>Usuário / login</label>
              <input id={`ac-u-${empresa.id}`} name={`licitapro-usuario-${empresa.id}`} className="input" autoComplete="off" value={f.usuario} onChange={(e) => setF({ ...f, usuario: e.target.value })} /></div>
            <div className="field"><label htmlFor={`ac-s-${empresa.id}`}>{f.existente ? "Nova senha (deixe em branco para manter)" : "Senha do portal"}</label>
              <input id={`ac-s-${empresa.id}`} name={`licitapro-senha-${empresa.id}`} className="input" type="password" autoComplete="new-password" value={f.senha} onChange={(e) => setF({ ...f, senha: e.target.value })} /></div>
            <div className="field"><label htmlFor={`ac-o-${empresa.id}`}>Observação <span style={{ fontWeight: 400, color: "var(--muted)" }}>(opcional)</span></label>
              <input id={`ac-o-${empresa.id}`} className="input" value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} placeholder="Ex.: certificado digital do Marcio" /></div>
          </div>
          {err && <p className="err">{err}</p>}
          <div className="row-inline">
            <button className="btn sm" disabled={busy}>{busy ? "Salvando…" : "Salvar acesso"}</button>
            <button type="button" className="btn ghost sm" onClick={() => setF(null)}>Cancelar</button>
          </div>
        </form>
      )}
    </div>
  );
}

/* ---------- Alerta sonoro (movimentações importantes em tempo real) ---------- */
const SOM_KEY = "licitapro-som";
const somLigado = () => { try { return localStorage.getItem(SOM_KEY) !== "0"; } catch (e) { return true; } };
let audioCtx = null;
function tocarAlerta() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = audioCtx || new AC();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const t0 = audioCtx.currentTime;
    [0, 0.22, 0.44].forEach((d, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = "sine";
      o.frequency.value = i === 2 ? 1175 : 880;
      g.gain.setValueAtTime(0.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(0.35, t0 + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.18);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0 + d);
      o.stop(t0 + d + 0.2);
    });
  } catch (e) { /* ignora */ }
}

function SomAlerta() {
  const [on, setOn] = useState(somLigado);
  const mudar = (v) => { setOn(v); try { localStorage.setItem(SOM_KEY, v ? "1" : "0"); } catch (e) { /* ignora */ } if (v) tocarAlerta(); };
  return (
    <div className="card form">
      <div className="card-h" style={{ marginBottom: 0 }}><h2>Alerta sonoro</h2></div>
      <p className="hint">Com o LicitaPro aberto, toca um bipe quando o pregoeiro citar a empresa ou houver movimentação importante (vale para este aparelho).</p>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        <label className="toggle"><input type="checkbox" checked={on} onChange={(e) => mudar(e.target.checked)} />Tocar som nos avisos importantes</label>
        <button type="button" className="btn ghost sm" onClick={tocarAlerta}>Testar som</button>
      </div>
    </div>
  );
}

function Equipe({ equipe, admin, notify, carregar, email }) {
  const [f, setF] = useState({ email: "", nome: "", papel: "equipe" });
  const add = async (e) => {
    e.preventDefault();
    const em = f.email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(em)) return notify("Digite um e-mail válido.");
    const { error } = await sb.from("equipe").upsert({ email: em, nome: f.nome.trim(), papel: f.papel, ativo: true }, { onConflict: "email" });
    if (error) return notify(errMsg(error));
    setF({ email: "", nome: "", papel: "equipe" }); notify(`${f.nome || em} liberado(a)`); carregar();
  };
  const upd = async (m, patch, msg) => { const { error } = await sb.from("equipe").update(patch).eq("email", m.email); if (error) return notify(errMsg(error)); notify(msg); carregar(); };
  return (
    <div className="card form">
      <div className="card-h" style={{ marginBottom: 0 }}><h2>Equipe</h2><small>{equipe.filter((m) => m.ativo).length} com acesso</small></div>
      <div className="list">
        {equipe.map((m) => (
          <div key={m.email} className="lrow" style={{ alignItems: "center", flexWrap: "wrap" }}>
            <span className="brand-mark" style={{ background: m.ativo ? "var(--accent)" : "var(--muted)", fontSize: 12, fontWeight: 700 }}>{iniciais(m.nome || m.email)}</span>
            <div className="lmain"><span className="lt">{m.nome || m.email}{m.email === email ? " (você)" : ""}</span><span className="ls">{m.email}{!m.ativo ? " · sem acesso" : ""}</span></div>
            {admin && m.email !== email ? (
              <div className="row-inline">
                <select className="input" style={{ width: "auto", height: 34 }} value={m.papel} onChange={(e) => upd(m, { papel: e.target.value }, "Perfil atualizado")} aria-label={`Perfil de ${m.nome || m.email}`}>
                  {Object.entries(PAPEIS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                {m.ativo ? <ConfirmX label="Bloquear" confirmLabel="Bloquear acesso?" onConfirm={() => upd(m, { ativo: false }, "Acesso bloqueado")} />
                  : <button className="btn ghost sm" onClick={() => upd(m, { ativo: true }, "Acesso liberado")}>Liberar</button>}
              </div>
            ) : <span className="tag">{PAPEIS[m.papel].split(" (")[0]}</span>}
          </div>
        ))}
      </div>
      {admin && (
        <form className="form" onSubmit={add} noValidate style={{ borderTop: "1px solid var(--line-2)", paddingTop: 12 }}>
          <b style={{ fontSize: 13.5 }}>Liberar acesso</b>
          <div className="fgrid">
            <div className="field"><label htmlFor="eq-nome">Nome</label><input id="eq-nome" className="input" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Ex.: Marcio" /></div>
            <div className="field"><label htmlFor="eq-email">E-mail</label><input id="eq-email" className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
            <div className="field"><label htmlFor="eq-papel">Perfil</label>
              <select id="eq-papel" className="input" value={f.papel} onChange={(e) => setF({ ...f, papel: e.target.value })}>
                {Object.entries(PAPEIS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
          </div>
          <p className="hint">Depois de liberar, a pessoa cria a conta no app com este mesmo e-mail. “Acompanha disputas” vê tudo e faz anotações, mas não muda valores nem cadastra processos.</p>
          <button className="btn" style={{ alignSelf: "flex-start" }}>Liberar acesso</button>
        </form>
      )}
    </div>
  );
}

function Palavras({ pode, notify }) {
  const [lista, setLista] = useState([]);
  const [termo, setTermo] = useState("");
  const [tipo, setTipo] = useState("incluir");
  const carregar = () => sb.from("palavras").select("*").order("termo").then(({ data }) => setLista(data || []));
  useEffect(() => { carregar(); }, []);
  const add = async (e) => {
    e.preventDefault();
    const t = termo.trim().toLowerCase();
    if (t.length < 2) return;
    const { error } = await sb.from("palavras").insert({ termo: t, tipo });
    if (error) return notify(/duplicate/i.test(error.message) ? "Essa palavra já está na lista" : errMsg(error));
    setTermo(""); carregar(); notify("Palavra adicionada. Vale para os próximos editais do radar.");
  };
  const del = async (p) => { const { error } = await sb.from("palavras").delete().eq("id", p.id); if (error) return notify(errMsg(error)); carregar(); };
  const inc = lista.filter((p) => p.tipo === "incluir");
  const exc = lista.filter((p) => p.tipo === "excluir");
  return (
    <div className="card form">
      <div className="card-h" style={{ marginBottom: 0 }}><h2>Palavras-chave do radar</h2></div>
      <p className="hint">O radar marca como relevante o edital cujo objeto contém alguma palavra de <b>incluir</b> e nenhuma de <b>excluir</b>. Acentos e maiúsculas não importam, e o começo da palavra já basta: “medicament” pega “medicamentos”.</p>
      <div><span className="flabel">Incluir ({inc.length})</span><div className="wordlist" style={{ marginTop: 6 }}>{inc.map((p) => <span className="word" key={p.id}>{p.termo}{pode && <button onClick={() => del(p)} aria-label={`Remover ${p.termo}`}>✕</button>}</span>)}</div></div>
      <div><span className="flabel">Excluir ({exc.length})</span><div className="wordlist" style={{ marginTop: 6 }}>{exc.map((p) => <span className="word ex" key={p.id}>{p.termo}{pode && <button onClick={() => del(p)} aria-label={`Remover ${p.termo}`}>✕</button>}</span>)}</div></div>
      {pode && (
        <form className="row-inline" onSubmit={add} noValidate>
          <input id="pal-termo" className="input" style={{ flex: "1 1 160px" }} value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Nova palavra" aria-label="Nova palavra" />
          <select className="input" style={{ width: "auto" }} value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo"><option value="incluir">Incluir</option><option value="excluir">Excluir</option></select>
          <button className="btn">Adicionar</button>
        </form>
      )}
    </div>
  );
}

function Telegram({ config, notify, setConfig }) {
  const [tem, setTem] = useState(false);
  const [f, setF] = useState({ token: "", chat: config.telegram_chat_id || "", ativo: config.telegram_ativo });
  useEffect(() => { sb.rpc("telegram_configurado").then(({ data }) => setTem(!!data)); }, []);
  const salvar = async (e) => {
    e.preventDefault();
    const { error } = await sb.rpc("definir_telegram", { p_token: f.token || null, p_chat: f.chat, p_ativo: f.ativo });
    if (error) return notify(errMsg(error));
    setConfig((c) => ({ ...c, telegram_chat_id: f.chat || null, telegram_ativo: f.ativo }));
    if (f.token) setTem(true);
    setF({ ...f, token: "" }); notify("Avisos salvos");
  };
  return (
    <form className="card form" onSubmit={salvar} noValidate>
      <div className="card-h" style={{ marginBottom: 0 }}><h2>Avisos no celular (Telegram)</h2>{tem && config.telegram_ativo ? <span className="tag" style={{ background: "var(--green-soft)", color: "var(--green)" }}>Ligado</span> : <span className="tag">Desligado</span>}</div>
      <p className="hint">O robô manda as movimentações importantes para um grupo do Telegram da equipe.</p>
      <ol className="steps" style={{ fontSize: 12.5 }}>
        <li>No Telegram, fale com <b>@BotFather</b>, envie <code>/newbot</code> e copie o token que ele mostrar.</li>
        <li>Crie um grupo com a equipe e adicione o bot criado.</li>
        <li>Mande qualquer mensagem no grupo e abra <code>api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code> no navegador. O número em <code>"chat":{"{"}"id"</code> (começa com <code>-</code>) é o ID do grupo.</li>
      </ol>
      <div className="fgrid">
        <div className="field"><label htmlFor="tg-token">Token do bot {tem && <span style={{ fontWeight: 400, color: "var(--muted)" }}>(já salvo, preencha só para trocar)</span>}</label><input id="tg-token" className="input" type="password" autoComplete="off" value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} placeholder={tem ? "••••••••" : "123456:ABC…"} /></div>
        <div className="field"><label htmlFor="tg-chat">ID do grupo</label><input id="tg-chat" className="input num" value={f.chat} onChange={(e) => setF({ ...f, chat: e.target.value })} placeholder="-100…" /></div>
      </div>
      <label className="toggle"><input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} />Enviar avisos</label>
      <button className="btn" style={{ alignSelf: "flex-start" }}>Salvar avisos</button>
    </form>
  );
}
