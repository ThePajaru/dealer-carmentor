// Single source of truth for the client-facing presupuesto.
//
// renderPresupuestoHtml(data) returns a complete, self-contained HTML document.
// It powers BOTH the live editor preview (iframe srcDoc) and the final PDF
// (POSTed to Doppio) — so what the dealer edits is byte-identical to what the
// client receives. Do not fork this layout anywhere.

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface PresupuestoChip { text: string; eco?: boolean }
export interface PresupuestoIncluded { label: string; sub?: string }
export interface PresupuestoSpec { k: string; v: string }
export interface PresupuestoScoreBar { label: string; value: number } // 0–10
export interface PresupuestoCheck { title: string; note: string }

export interface PresupuestoDealer {
  name: string;
  tagline: string;
  logoUrl?: string | null;
  initials: string;
  phone?: string;
  whatsapp?: string;
}

export interface PresupuestoData {
  brandColor: string;
  dealer: PresupuestoDealer;
  docDate: string;
  ref: string;

  // hero
  eyebrow: string;
  title: string;
  chips: PresupuestoChip[];
  heroImage: string | null;
  gallery: string[];

  // offer
  /** Show the price block to the client. Undefined (old presupuestos) = show. */
  showPrice?: boolean;
  price: number;
  priceNote: string;
  /** Replaces the amount when showPrice is false (e.g. "Precio a consultar"). */
  priceHiddenLabel?: string;
  included: PresupuestoIncluded[];

  // why this car
  showWhy: boolean;
  resumen: string;
  marketNote: string;
  showScore: boolean;
  scoreGlobal: number;
  scoreBars: PresupuestoScoreBar[];

  // ficha
  showFicha: boolean;
  specs: PresupuestoSpec[];

  // equipamiento
  showEquip: boolean;
  equip: string[];

  // checks
  showChecks: boolean;
  checks: PresupuestoCheck[];
  checksNote: string;

  // contact
  contactTitle: string;
  contactNote: string;
  validityNote: string;
}

/* ------------------------------------------------------------------ helpers */

export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fmtEur(n: number): string {
  return `${Math.round(n || 0).toLocaleString('es-ES')} €`;
}

/** Derive uppercase initials (max 2) from a business name. */
export function initialsOf(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'CM';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

/* ------------------------------------------------------------------ sections */

function heroSection(d: PresupuestoData): string {
  const chips = d.chips.map(c =>
    `<span class="chip${c.eco ? ' eco' : ''}">${esc(c.text)}</span>`
  ).join('');
  const gallery = d.gallery.length
    ? `<div class="gallery">${d.gallery.slice(0, 5).map(src =>
        `<img src="${esc(src)}" alt="" />`).join('')}</div>`
    : '';
  const hero = d.heroImage
    ? `<img class="hero-img" src="${esc(d.heroImage)}" alt="${esc(d.title)}" />`
    : `<div class="hero-img"></div>`;
  return `
  <div class="pad">
    <div class="hero-head">
      <span class="eyebrow">${esc(d.eyebrow)}</span>
      <div class="title">${esc(d.title)}</div>
      ${chips ? `<div class="spec-chips">${chips}</div>` : ''}
    </div>
    ${hero}
    ${gallery}
  </div>`;
}

function offerSection(d: PresupuestoData): string {
  const showPrice = d.showPrice !== false; // undefined = old presupuesto = show
  const hiddenLabel = (d.priceHiddenLabel ?? '').trim();

  // Price hidden and no replacement text → no price cell at all; the "todo
  // incluido" list takes the full width. Nothing left to show → no section.
  const hasPriceCell = showPrice || !!hiddenLabel;
  if (!hasPriceCell && !d.included.length) return '';

  const items = d.included.map(i =>
    `<div class="inc-item">${CHECK_SVG}<span><b>${esc(i.label)}</b>${i.sub ? ' ' + esc(i.sub) : ''}</span></div>`
  ).join('');

  const priceCell = hasPriceCell
    ? `<div class="price-cell">
        <span class="lbl">${showPrice ? 'Precio llave en mano' : 'Precio'}</span>
        <span class="amt${showPrice ? ' num' : ' amt-text'}">${esc(showPrice ? fmtEur(d.price) : hiddenLabel)}</span>
        ${showPrice && d.priceNote ? `<span class="sub">${CHECK_SVG.replace('2.4', '2')} ${esc(d.priceNote)}</span>` : ''}
      </div>`
    : '';

  const incluido = d.included.length
    ? `<div class="incluido"><h4>${showPrice ? 'Todo incluido en tu precio' : 'Todo incluido'}</h4><div class="inc-list">${items}</div></div>`
    : '';

  return `
  <div class="section" style="border-top:none;padding-top:4px">
    <div class="offer${hasPriceCell ? '' : ' no-price'}${incluido ? '' : ' only-price'}">
      ${priceCell}
      ${incluido}
    </div>
  </div>`;
}

function whySection(d: PresupuestoData): string {
  if (!d.showWhy) return '';
  // Sin precio, la nota de mercado («precio por debajo de la media, 13.852 €»)
  // sigue delatando la cifra: si se oculta el precio, se oculta con él.
  const market = d.marketNote && d.showPrice !== false
    ? `<div class="market-note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg><span>${esc(d.marketNote)}</span></div>`
    : '';
  const bars = d.scoreBars.map(b =>
    `<div class="bar-row"><div class="bl"><span>${esc(b.label)}</span><span>${Math.round(b.value)}<i>/100</i></span></div><div class="track"><div class="fill" style="width:${Math.max(0, Math.min(100, b.value))}%"></div></div></div>`
  ).join('');
  const score = d.showScore
    ? `<div class="score-card">
        <div class="score-top">
          <div class="score-badge" style="--val:${Math.max(0, Math.min(100, d.scoreGlobal * 10))}"><span>${d.scoreGlobal.toFixed(1)}<i>/10</i></span></div>
          <div><h5>Score CarMentor</h5><p>Análisis independiente</p></div>
        </div>
        ${bars}
      </div>`
    : '';
  return `
  <div class="section">
    <div class="section-eyebrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2Z"/></svg> Por qué este coche</div>
    <div class="why-grid ${d.showScore ? '' : 'no-score'}">
      <div>
        <p class="resumen">${esc(d.resumen)}</p>
        ${market}
      </div>
      ${score}
    </div>
  </div>`;
}

function fichaSection(d: PresupuestoData): string {
  if (!d.showFicha || !d.specs.length) return '';
  const cells = d.specs.map(s =>
    `<div class="spec"><div class="k">${esc(s.k)}</div><div class="v">${esc(s.v)}</div></div>`
  ).join('');
  return `
  <div class="section">
    <div class="section-eyebrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M9 13h6M9 17h6"/></svg> Ficha técnica</div>
    <div class="specs">${cells}</div>
  </div>`;
}

function equipSection(d: PresupuestoData): string {
  if (!d.showEquip || !d.equip.length) return '';
  const chips = d.equip.map(e => `<span class="chip">${esc(e)}</span>`).join('');
  return `
  <div class="section">
    <div class="section-eyebrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5Z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/></svg> Equipamiento destacado</div>
    <div class="equip">${chips}</div>
  </div>`;
}

function checksSection(d: PresupuestoData): string {
  if (!d.showChecks || !d.checks.length) return '';
  const items = d.checks.map(c =>
    `<div class="check"><div class="ic">${CHECK_SVG.replace('2.4', '2.2')}</div><div><h6>${esc(c.title)}</h6><p>${esc(c.note)}</p></div></div>`
  ).join('');
  const note = d.checksNote
    ? `<div class="trust"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg> ${esc(d.checksNote)}</div>`
    : '';
  return `
  <div class="section">
    <div class="section-eyebrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg> Análisis mecánico independiente</div>
    <div class="checks">${items}</div>
    ${note}
  </div>`;
}

function contactSection(d: PresupuestoData): string {
  const wa = d.dealer.whatsapp
    ? `<a class="btn btn-wa" href="https://wa.me/${esc(d.dealer.whatsapp.replace(/[^0-9]/g, ''))}"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.8 4.9-1.3A10 10 0 1 0 12 2Zm0 18a8 8 0 0 1-4.1-1.1l-.3-.2-2.9.8.8-2.8-.2-.3A8 8 0 1 1 12 20Zm4.6-6c-.3-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.6.8-.8 1-.3.2-.5.1a6.5 6.5 0 0 1-3.2-2.8c-.2-.4.2-.4.6-1.2 0-.2 0-.3-.1-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3A2.8 2.8 0 0 0 6.7 9c0 1.7 1.2 3.3 1.4 3.5s2.4 3.6 5.7 5c2 .9 2.8.9 3.8.8.6-.1 1.5-.7 1.7-1.3s.2-1.2.2-1.3-.3-.3-.6-.4Z"/></svg> WhatsApp</a>`
    : '';
  const phone = d.dealer.phone
    ? `<a class="btn btn-ghost" href="tel:${esc(d.dealer.phone.replace(/\s+/g, ''))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .3 1.9.6 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.5 2.8.6a2 2 0 0 1 1.7 2Z"/></svg> ${esc(d.dealer.phone)}</a>`
    : '';
  return `
  <div class="section contact">
    <div class="contact-in">
      <div><h3>${esc(d.contactTitle)}</h3><p>${esc(d.contactNote)}</p></div>
      <div class="cta-row">${wa}${phone}</div>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ document */

export interface RenderOptions {
  /** Extra tags injected before </head> — og: meta for the public /pr link. */
  headExtra?: string;
  /**
   * Client-facing self-accept UI. Only passed from the public /pr route — never
   * from the PDF renderer, so the archived document stays a clean, static sheet.
   * `accepted` renders the confirmation banner instead of the button.
   */
  accept?: { presupuestoId: string; accepted: boolean };
}

const ACCEPT_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
const WA_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.8 4.9-1.3A10 10 0 1 0 12 2Zm0 18a8 8 0 0 1-4.1-1.1l-.3-.2-2.9.8.8-2.8-.2-.3A8 8 0 1 1 12 20Zm4.6-6c-.3-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.6.8-.8 1-.3.2-.5.1a6.5 6.5 0 0 1-3.2-2.8c-.2-.4.2-.4.6-1.2 0-.2 0-.3-.1-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3A2.8 2.8 0 0 0 6.7 9c0 1.7 1.2 3.3 1.4 3.5s2.4 3.6 5.7 5c2 .9 2.8.9 3.8.8.6-.1 1.5-.7 1.7-1.3s.2-1.2.2-1.3-.3-.3-.6-.4Z"/></svg>';

function acceptSection(d: PresupuestoData, opts: RenderOptions): string {
  if (!opts.accept) return '';
  const { accepted } = opts.accept;

  // Click-to-chat button to the dealer, so accepting also reaches them as a real
  // WhatsApp from the client (on top of the email). Only when the dealer set a
  // WhatsApp number. The client still taps "send" in WhatsApp — a fully
  // automatic server-sent WhatsApp would need the paid WhatsApp Business API.
  const waRaw = (d.dealer.whatsapp || '').replace(/[^0-9]/g, '');
  const carTitle = d.title || 'el coche';
  const waCtaLink = waRaw
    ? `https://wa.me/${esc(waRaw)}?text=${encodeURIComponent(`Hola, quiero aceptar el presupuesto de ${carTitle}. ¿Cómo seguimos?`)}`
    : '';
  const waDoneLink = waRaw
    ? `https://wa.me/${esc(waRaw)}?text=${encodeURIComponent(`He aceptado el presupuesto de ${carTitle}. ¿Cómo seguimos?`)}`
    : '';

  return `
  <div class="section accept" id="accept-block">
    <div class="accept-done" style="${accepted ? '' : 'display:none'}">
      <div class="accept-done-ic">${ACCEPT_CHECK}</div>
      <div class="accept-done-body">
        <h3>Presupuesto aceptado</h3>
        <p>El concesionario ya tiene tu confirmación. Se pondrá en contacto contigo para los siguientes pasos.</p>
        ${waDoneLink ? `<a class="accept-wa" href="${waDoneLink}">${WA_SVG}<span>Escríbenos por WhatsApp</span></a>` : ''}
      </div>
    </div>
    <div class="accept-cta" style="${accepted ? 'display:none' : ''}">
      <div class="accept-copy">
        <h3>¿Todo correcto?</h3>
        <p>Acepta el presupuesto y avisamos al concesionario al instante para arrancar tu compra.</p>
      </div>
      <div class="accept-actions">
        <button type="button" class="accept-btn" id="accept-btn">
          ${ACCEPT_CHECK}<span>Aceptar presupuesto</span>
        </button>
        ${waCtaLink ? `<a class="accept-wa" id="accept-wa-btn" href="${waCtaLink}">${WA_SVG}<span>Aceptar por WhatsApp</span></a>` : ''}
      </div>
      <p class="accept-err" id="accept-err" style="display:none">No se pudo aceptar. Inténtalo de nuevo en un momento.</p>
    </div>
  </div>`;
}

function acceptScript(opts: RenderOptions): string {
  if (!opts.accept || opts.accept.accepted) return '';
  const id = esc(opts.accept.presupuestoId);
  return `<script>
(function(){
  var url='/pr/${id}/accept';
  var btn=document.getElementById('accept-btn');
  var err=document.getElementById('accept-err');
  var block=document.getElementById('accept-block');
  var wa=document.getElementById('accept-wa-btn');
  if(btn){
    btn.addEventListener('click',function(){
      btn.disabled=true;err.style.display='none';
      var span=btn.querySelector('span');var prev=span?span.textContent:'';
      if(span)span.textContent='Aceptando…';
      fetch(url,{method:'POST'}).then(function(r){
        if(!r.ok)throw new Error();
        block.querySelector('.accept-cta').style.display='none';
        block.querySelector('.accept-done').style.display='flex';
      }).catch(function(){
        btn.disabled=false;if(span)span.textContent=prev;err.style.display='block';
      });
    });
  }
  // "Aceptar por WhatsApp" opens the chat AND records the acceptance in the
  // background (sendBeacon survives the page leaving for the WhatsApp app).
  if(wa){
    wa.addEventListener('click',function(){
      try{if(navigator.sendBeacon)navigator.sendBeacon(url);else fetch(url,{method:'POST',keepalive:true});}
      catch(e){try{fetch(url,{method:'POST',keepalive:true});}catch(e2){}}
    });
  }
})();
</script>`;
}

export function renderPresupuestoHtml(d: PresupuestoData, opts: RenderOptions = {}): string {
  const logo = d.dealer.logoUrl
    ? `<div class="logo"><img src="${esc(d.dealer.logoUrl)}" alt="" /></div>`
    : `<div class="logo">${esc(d.dealer.initials)}</div>`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Presupuesto · ${esc(d.dealer.name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root{
    --brand:${esc(d.brandColor)};
    --brand-ink:#14335f;--brand-tint:#eef3fb;
    --ink:#161a20;--muted:#5c6570;--dim:#98a1ac;
    --line:#e9e7e2;--line-2:#eef0f3;--paper:#fff;--bg:#f4f2ee;
    --green:#1f9d63;--green-tint:#eaf6ef;--radius:16px;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-family:'Outfit',system-ui,sans-serif;color:var(--ink);background:var(--bg);line-height:1.55;font-size:14px;padding:32px 16px}
  .num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum"}
  .sheet{max-width:800px;margin:0 auto;background:var(--paper);border-radius:22px;overflow:hidden;box-shadow:0 24px 60px -28px rgba(20,30,50,.28),0 2px 8px -3px rgba(20,30,50,.12)}
  .pad{padding:34px 40px}
  .top{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:22px 40px;border-bottom:1px solid var(--line)}
  .brand{display:flex;align-items:center;gap:13px}
  .logo{width:46px;height:46px;border-radius:12px;flex:none;background:var(--brand);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px;letter-spacing:.5px;overflow:hidden}
  .logo img{width:100%;height:100%;object-fit:cover}
  .brand h1{font-size:17px;font-weight:700;letter-spacing:-.01em;line-height:1.1}
  .brand p{font-size:12px;color:var(--dim);margin-top:1px}
  .doc-meta{text-align:right}
  .eyebrow{font-family:'Bebas Neue',sans-serif;letter-spacing:.13em;font-size:14px;color:var(--brand);line-height:1}
  .doc-meta .eyebrow{font-size:16px}
  .doc-meta p{font-size:12px;color:var(--dim);margin-top:4px}
  .hero-head{margin-bottom:16px}
  .hero-head .eyebrow{display:block;margin-bottom:7px}
  .title{font-size:30px;font-weight:700;letter-spacing:-.02em;line-height:1.05}
  .spec-chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:13px}
  .chip{display:inline-flex;align-items:center;gap:6px;background:#f6f6f4;border:1px solid var(--line);border-radius:999px;padding:5px 12px;font-size:12.5px;color:var(--muted);font-weight:500}
  .chip b{color:var(--ink);font-weight:600}
  .chip.eco{background:var(--green-tint);border-color:#cdebd9;color:#157a4b}
  .hero-img{width:100%;height:340px;border-radius:var(--radius);object-fit:cover;background:#edeae5;display:block}
  .gallery{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:8px}
  .gallery img{width:100%;height:74px;object-fit:cover;border-radius:9px;background:#edeae5}
  .section{padding:30px 40px;border-top:1px solid var(--line-2)}
  .section-eyebrow{font-family:'Bebas Neue',sans-serif;letter-spacing:.13em;font-size:15px;color:var(--brand);margin-bottom:14px;display:flex;align-items:center;gap:8px}
  .section-eyebrow svg{width:16px;height:16px}
  .offer{display:grid;grid-template-columns:1fr 1.15fr;gap:0;border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}
  .offer.no-price,.offer.only-price{grid-template-columns:1fr}
  .price-cell{background:var(--brand);color:#fff;padding:28px 26px;display:flex;flex-direction:column;justify-content:center;background-image:linear-gradient(150deg,var(--brand),var(--brand-ink))}
  .price-cell .lbl{font-size:12.5px;opacity:.82;font-weight:500;letter-spacing:.02em}
  .price-cell .amt{font-size:46px;font-weight:800;letter-spacing:-.03em;line-height:1;margin:8px 0 10px}
  .price-cell .amt-text{font-size:30px;font-weight:700;letter-spacing:-.02em}
  .offer.no-price .inc-list{grid-template-columns:1fr 1fr 1fr}
  .price-cell .sub{font-size:12.5px;opacity:.9;display:flex;align-items:center;gap:7px}
  .price-cell .sub svg{width:15px;height:15px;flex:none}
  .incluido{padding:22px 26px}
  .incluido h4{font-size:13px;font-weight:600;color:var(--ink);margin-bottom:13px}
  .inc-list{display:grid;grid-template-columns:1fr 1fr;gap:9px 16px}
  .inc-item{display:flex;align-items:flex-start;gap:8px;font-size:12.5px;color:var(--muted)}
  .inc-item svg{width:15px;height:15px;flex:none;color:var(--green);margin-top:1px}
  .inc-item b{color:var(--ink);font-weight:600}
  .why-grid{display:grid;grid-template-columns:1fr 232px;gap:26px;align-items:start}
  .why-grid.no-score{grid-template-columns:1fr}
  .resumen{font-size:14px;color:#33393f;line-height:1.68}
  .market-note{margin-top:16px;display:flex;align-items:center;gap:10px;background:var(--green-tint);border:1px solid #cdebd9;border-radius:12px;padding:11px 14px;font-size:12.5px;color:#157a4b;font-weight:500}
  .market-note svg{width:17px;height:17px;flex:none}
  .score-card{border:1px solid var(--line);border-radius:var(--radius);padding:18px;background:#fcfcfb}
  .score-top{display:flex;align-items:center;gap:13px;margin-bottom:16px}
  .score-badge{width:60px;height:60px;border-radius:50%;flex:none;position:relative;background:conic-gradient(var(--brand) calc(var(--val)*1%),#e9edf3 0);display:flex;align-items:center;justify-content:center}
  .score-badge::after{content:"";position:absolute;inset:6px;background:#fcfcfb;border-radius:50%}
  .score-badge span{position:relative;z-index:1;font-weight:800;font-size:16px;letter-spacing:-.02em}
  .score-badge span i{font-style:normal;font-size:10px;color:var(--dim);font-weight:600}
  .score-top h5{font-size:13px;font-weight:700;line-height:1.2}
  .score-top p{font-size:11px;color:var(--dim);margin-top:2px}
  .bar-row{margin-bottom:11px}.bar-row:last-child{margin-bottom:0}
  .bar-row .bl{display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:4px}
  .bar-row .bl span:first-child{color:var(--muted)}
  .bar-row .bl span:last-child{color:var(--ink);font-weight:600}
  .bar-row .bl span:last-child i{font-style:normal;font-size:9.5px;color:var(--dim);font-weight:500}
  .track{height:6px;background:#eaedf1;border-radius:99px;overflow:hidden}
  .fill{height:100%;background:var(--brand);border-radius:99px}
  .specs{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--line-2);border:1px solid var(--line-2);border-radius:var(--radius);overflow:hidden}
  .spec{background:#fff;padding:14px 16px}
  .spec .k{font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.04em;font-weight:600}
  .spec .v{font-size:14.5px;color:var(--ink);font-weight:600;margin-top:3px}
  .equip{display:flex;flex-wrap:wrap;gap:8px}
  .equip .chip{background:var(--brand-tint);border-color:#dfe8f5;color:var(--brand-ink);font-weight:500}
  .checks{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .check{display:flex;gap:11px;align-items:flex-start;border:1px solid var(--line);border-radius:12px;padding:12px 14px}
  .check .ic{width:30px;height:30px;border-radius:8px;flex:none;background:var(--green-tint);color:var(--green);display:flex;align-items:center;justify-content:center}
  .check .ic svg{width:16px;height:16px}
  .check h6{font-size:13px;font-weight:600;line-height:1.25}
  .check p{font-size:12px;color:var(--muted);margin-top:2px;line-height:1.45}
  .trust{font-size:12px;color:var(--dim);margin-top:14px;display:flex;align-items:center;gap:7px}
  .trust svg{width:14px;height:14px;flex:none}
  .contact{background:var(--brand-tint);border-top:1px solid var(--line)}
  .contact-in{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap}
  .contact h3{font-size:18px;font-weight:700;letter-spacing:-.01em}
  .contact p{font-size:13px;color:var(--muted);margin-top:3px}
  .cta-row{display:flex;gap:9px;flex-wrap:wrap}
  .btn{display:inline-flex;align-items:center;gap:8px;padding:11px 18px;border-radius:11px;font-size:13.5px;font-weight:600;text-decoration:none}
  .btn svg{width:16px;height:16px}
  .btn-wa{background:#25d366;color:#fff}
  .btn-ghost{background:#fff;color:var(--brand-ink);border:1px solid var(--line)}
  .accept{background:#fff}
  .accept-cta{display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;border:1px solid var(--line);border-radius:var(--radius);padding:22px 24px;background:linear-gradient(150deg,#fbfdfb,#f4faf6)}
  .accept-copy h3{font-size:18px;font-weight:700;letter-spacing:-.01em}
  .accept-copy p{font-size:13px;color:var(--muted);margin-top:4px;max-width:46ch}
  .accept-btn{display:inline-flex;align-items:center;gap:9px;padding:14px 26px;border-radius:12px;font-size:15px;font-weight:700;font-family:inherit;color:#fff;background:var(--green);border:none;cursor:pointer;box-shadow:0 10px 24px -10px rgba(31,157,99,.7);transition:transform .06s ease,filter .15s ease}
  .accept-btn:hover{filter:brightness(1.04)}
  .accept-btn:active{transform:translateY(1px)}
  .accept-btn:disabled{opacity:.7;cursor:default;box-shadow:none}
  .accept-btn svg{width:19px;height:19px}
  .accept-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .accept-wa{display:inline-flex;align-items:center;gap:8px;padding:14px 22px;border-radius:12px;font-size:14.5px;font-weight:700;text-decoration:none;color:#fff;background:#25d366;box-shadow:0 10px 24px -12px rgba(37,211,102,.7)}
  .accept-wa svg{width:18px;height:18px}
  .accept-err{width:100%;font-size:12.5px;color:#c0392b;margin-top:2px}
  .accept-done{display:flex;align-items:flex-start;gap:14px;border:1px solid #cdebd9;border-radius:var(--radius);padding:20px 22px;background:var(--green-tint)}
  .accept-done-ic{width:40px;height:40px;flex:none;border-radius:50%;background:var(--green);color:#fff;display:flex;align-items:center;justify-content:center;margin-top:1px}
  .accept-done-ic svg{width:22px;height:22px}
  .accept-done h3{font-size:16px;font-weight:700;color:#157a4b}
  .accept-done p{font-size:13px;color:#2c7a54;margin-top:2px}
  .accept-done-body .accept-wa{margin-top:12px}
  .foot{padding:18px 40px;border-top:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:12px}
  .powered{display:inline-flex;align-items:center;gap:7px;font-size:11.5px;color:var(--dim);font-weight:500}
  .powered .mark{display:inline-flex;align-items:center;gap:5px;color:var(--ink);font-weight:700;letter-spacing:-.01em}
  .powered .mark svg{width:14px;height:14px;color:var(--brand)}
  .foot .ref{font-size:11px;color:var(--dim)}
  @media (max-width:680px){.why-grid,.offer,.contact-in{grid-template-columns:1fr}.inc-list,.checks,.specs{grid-template-columns:1fr 1fr}.gallery{grid-template-columns:repeat(4,1fr)}.price-cell{align-items:flex-start}.accept-cta{flex-direction:column;align-items:stretch}.accept-actions{flex-direction:column;align-items:stretch}.accept-btn,.accept-wa{justify-content:center;width:100%}}
  @media print{body{background:#fff;padding:0}.sheet{box-shadow:none;border-radius:0;max-width:none}.section,.top,.foot{break-inside:avoid}}
  @page{size:A4;margin:0}
</style>
${opts.headExtra || ''}
</head>
<body>
<div class="sheet">
  <div class="top">
    <div class="brand">
      ${logo}
      <div><h1>${esc(d.dealer.name)}</h1><p>${esc(d.dealer.tagline)}</p></div>
    </div>
    <div class="doc-meta"><div class="eyebrow">Presupuesto</div><p>${esc(d.docDate)}${d.ref ? ' · Ref. ' + esc(d.ref) : ''}</p></div>
  </div>
  ${heroSection(d)}
  ${offerSection(d)}
  ${whySection(d)}
  ${fichaSection(d)}
  ${equipSection(d)}
  ${checksSection(d)}
  ${contactSection(d)}
  ${acceptSection(d, opts)}
  <div class="foot">
    <span class="powered">Análisis independiente por <span class="mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 4 6v6c0 5 3.4 7.7 8 10 4.6-2.3 8-5 8-10V6l-8-4Z"/></svg> CarMentor</span></span>
    <span class="ref">${esc(d.validityNote)}</span>
  </div>
</div>
${acceptScript(opts)}
</body>
</html>`;
}

/* ------------------------------------------------------ initial data builder */

/**
 * Build an initial editable PresupuestoData from a car_analyses row + the dealer
 * profile + a selling price. The dealer then tweaks everything in the editor.
 */
export function buildInitialPresupuestoData(opts: {
  analysis: any;
  dealer: any;
  sellingPrice: number;
  docDate: string;
  ref?: string;
}): PresupuestoData {
  const { analysis, dealer, sellingPrice, docDate, ref } = opts;
  const rj = analysis?.result_json || {};
  const ficha = rj.ficha_tecnica_inicial || {};
  const score = rj.score_carmentor || {};
  const mercado = rj.investigacion_mercado || {};
  const precios = mercado.precios_espana || {};
  const problemas = rj.problemas_comunes_modelo || {};
  const tax = rj.parametros_calculo_impuestos || {};
  const country = analysis?.country_of_origin || rj.pais_origen || 'Alemania';

  const images: string[] = Array.isArray(rj.car_images)
    ? rj.car_images.filter((u: unknown): u is string => typeof u === 'string' && u.length > 0)
    : [];
  const heroImage = images[0] || analysis?.car_image_url || null;
  const gallery = images.filter(u => u !== heroImage).slice(0, 5);

  // chips
  const chips: PresupuestoChip[] = [];
  const push = (v: any, suffix = '', eco = false) => { if (v != null && String(v).trim() && String(v).trim() !== '0') chips.push({ text: `${v}${suffix}`, eco }); };
  push(ficha.año);
  if (ficha.kilometraje) chips.push({ text: `${Number(ficha.kilometraje).toLocaleString('es-ES')} km` });
  push(ficha.combustible);
  push(ficha.transmision);
  push(ficha.potencia);
  push(ficha.tipo_traccion);
  if (ficha.etiqueta_ambiental) chips.push({ text: `Etiqueta ${ficha.etiqueta_ambiental}`, eco: true });

  // included value list (no amounts) — justifies the markup
  const included: PresupuestoIncluded[] = [
    { label: 'Importación y transporte', sub: `desde ${country}` },
    { label: 'Gestoría', sub: 'y trámites de importación' },
    { label: 'Matriculación', sub: 'española' },
    { label: 'ITV', sub: 'y homologación' },
    { label: 'Impuestos', sub: '(IVA + matriculación)' },
    { label: 'Garantía', sub: '12 meses' },
    { label: 'Entrega', sub: 'a domicilio' },
  ];

  // score bars
  const scoreBars: PresupuestoScoreBar[] = [];
  const addBar = (label: string, key: string) => { if (typeof score[key] === 'number') scoreBars.push({ label, value: score[key] }); };
  addBar('Fiabilidad mecánica', 'fiabilidad_mecanica');
  addBar('Coste mantenimiento', 'coste_mantenimiento');
  addBar('Precio vs mercado', 'precio_vs_mercado');
  addBar('Consumo / eficiencia', 'consumo_eficiencia');
  const scoreGlobal = typeof score.score_global === 'number' ? score.score_global : 0;

  // market note
  let marketNote = '';
  if (precios.precio_medio) {
    const media = Number(precios.precio_medio);
    if (media > sellingPrice) marketNote = `Precio por debajo de la media del mercado español (${fmtEur(media)} para equivalentes).`;
    else marketNote = `Media del mercado español para equivalentes: ${fmtEur(media)}.`;
  }

  // specs
  const specs: PresupuestoSpec[] = [];
  const addSpec = (k: string, v: any) => { if (v != null && String(v).trim()) specs.push({ k, v: String(v) }); };
  addSpec('Año', ficha.año);
  if (ficha.kilometraje) addSpec('Kilometraje', `${Number(ficha.kilometraje).toLocaleString('es-ES')} km`);
  addSpec('Combustible', ficha.combustible);
  addSpec('Potencia', ficha.potencia);
  addSpec('Cambio', ficha.transmision);
  addSpec('Carrocería', ficha.carroceria);
  addSpec('Tracción', ficha.tipo_traccion);
  if (ficha.emisiones_co2) addSpec('Emisiones CO₂', `${ficha.emisiones_co2} g/km`);
  addSpec('Etiqueta DGT', ficha.etiqueta_ambiental);

  // equipamiento — trim/equipment keywords extracted during analysis
  const equip: string[] = Array.isArray(tax.acabado_anuncio)
    ? tax.acabado_anuncio.filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0)
    : [];

  // mechanical checks (model faults, reframed as verified points)
  const rawFallos = problemas.fallos_verificados || problemas.fallos_tipicos_mecanicos || [];
  const checks: PresupuestoCheck[] = (Array.isArray(rawFallos) ? rawFallos : [])
    .slice(0, 4)
    .map((f: any) => ({
      title: f.componente || f.problema || 'Punto de control',
      note: f.descripcion || 'Verificado antes de la compra.',
    }));

  const name = dealer?.business_name || 'Concesionario';

  return {
    brandColor: dealer?.brand_color || '#1e4b8f',
    dealer: {
      name,
      tagline: dealer?.city ? `Concesionario · ${dealer.city}` : 'Concesionario multimarca',
      logoUrl: dealer?.logo_url || null,
      initials: initialsOf(name),
      phone: dealer?.phone || '',
      whatsapp: dealer?.whatsapp || '',
    },
    docDate,
    ref: ref || '',

    eyebrow: 'Tu coche seleccionado',
    title: analysis?.title || ficha.marca_modelo || 'Vehículo',
    chips,
    heroImage,
    gallery,

    showPrice: true,
    price: Math.round(sellingPrice || 0),
    priceNote: 'IVA incluido · Sin sorpresas ni extras',
    priceHiddenLabel: 'A consultar',
    included,

    showWhy: !!(ficha.resumen || scoreBars.length || marketNote),
    resumen: ficha.resumen || '',
    marketNote,
    showScore: scoreBars.length > 0,
    scoreGlobal,
    scoreBars,

    showFicha: specs.length > 0,
    specs,

    showEquip: equip.length > 0,
    equip,

    showChecks: checks.length > 0,
    checks,
    checksNote: 'Fallos típicos del modelo analizados y revisados uno a uno antes de la compra.',

    contactTitle: '¿Te lo reservamos?',
    contactNote: `Contacta con ${name} y resolvemos cualquier duda.`,
    validityNote: 'Presupuesto sin compromiso · válido 7 días',
  };
}
