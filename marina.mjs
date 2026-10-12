// ../../../mnt/attach/outputs/da-shaka-menu/netlify/lib/menu.mjs
import { getStore } from "@netlify/blobs";
var TZ = "Europe/Rome";
var store = () => getStore({ name: "ristorante", consistency: "strong" });
var day = (d = /* @__PURE__ */ new Date()) => d.toLocaleDateString("sv-SE", { timeZone: TZ });
var json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});
function siteOrigin(req) {
  return process.env.URL || new URL(req.url).origin;
}
function romeMin(now = /* @__PURE__ */ new Date()) {
  const [h, m] = now.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }).split(":").map(Number);
  return h % 24 * 60 + m;
}
var toMin = (t) => {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(String(t || "").trim());
  return m ? +m[1] * 60 + +m[2] : null;
};
function closureOf(R, iso) {
  return (R.closures || []).find((c) => c && c.from && iso >= c.from && iso <= (c.to || c.from)) || null;
}
function periodOf(R, now = /* @__PURE__ */ new Date()) {
  return romeMin(now) < (toMin(R.lunch_until) ?? 16 * 60) ? "pranzo" : "cena";
}
function itemState(p, R, now = /* @__PURE__ */ new Date(), sold = {}) {
  if (p.hidden) return "nascosto";
  if (p.av === false) return "non_disponibile";
  if (p.out_until && p.out_until >= day(now)) return "esaurito_oggi";
  if ((p.when === "pranzo" || p.when === "cena") && p.when !== periodOf(R, now)) return p.when === "pranzo" ? "solo_pranzo" : "solo_cena";
  if (Number.isInteger(p.qty) && (sold[p.id] || 0) >= p.qty) return "finito";
  return "ok";
}
async function soldToday(now = /* @__PURE__ */ new Date()) {
  try {
    return await store().get(`sold/${day(now)}`, { type: "json" }) || {};
  } catch {
    return {};
  }
}
async function publicData(site, now = /* @__PURE__ */ new Date()) {
  const R = site.data.restaurant;
  const needsSold = site.data.categories.some((c) => c.items.some((p) => Number.isInteger(p.qty)));
  const sold = needsSold ? await soldToday(now) : {};
  const categories = site.data.categories.map((c) => ({
    name: c.name,
    items: c.items.filter((p) => !p.hidden).map((p) => {
      const st = itemState(p, R, now, sold);
      const { out_until, qty, hidden, ...pub } = p;
      const out = { ...pub, av: st === "ok" };
      if (st !== "ok") out.why = st;
      if (Number.isInteger(qty) && st === "ok") out.left = Math.max(0, qty - (sold[p.id] || 0));
      return out;
    })
  })).filter((c) => c.items.length);
  return { restaurant: R, categories };
}
var base = { at: 0, v: null };
async function loadBase(origin) {
  if (base.v && Date.now() - base.at < 10 * 60 * 1e3) return base.v;
  const res = await fetch(origin + "/index.html", { headers: { "cache-control": "no-cache" } });
  if (!res.ok) throw new Error("index.html non raggiungibile (" + res.status + ")");
  const html = await res.text();
  const pick = (id) => {
    const m = new RegExp(`<script id="${id}"[^>]*>([\\s\\S]*?)</script>`).exec(html);
    if (!m) throw new Error("Blocco " + id + " non trovato in index.html");
    return m[1].replace(/<\\\//g, "</");
  };
  base = { at: Date.now(), v: { data: JSON.parse(pick("menu-data")), rules: pick("marina-rules") } };
  return base.v;
}
var cur = { at: 0, v: null };
async function loadSite(origin, { fresh = false } = {}) {
  if (!fresh && cur.v && Date.now() - cur.at < 10 * 1e3) return cur.v;
  const b = await loadBase(origin);
  let saved = null;
  try {
    saved = await store().get("menu/current", { type: "json" });
  } catch (e) {
    console.error("menu/current", e);
  }
  let data = saved?.data || b.data;
  if (saved?.data) {
    const known = /* @__PURE__ */ new Set([...saved.baseCats || [], ...saved.data.categories.map((c) => c.name)]);
    const ids = new Set(saved.data.categories.flatMap((c) => c.items.map((p) => p.id)));
    const add = b.data.categories.map((c, i) => ({ c, i })).filter(({ c }) => !known.has(c.name));
    if (add.length) {
      const cats = saved.data.categories.slice();
      for (const { c, i } of add) cats.splice(Math.min(i, cats.length), 0, { ...c, items: c.items.filter((p) => !ids.has(p.id)) });
      data = { ...saved.data, categories: cats };
    }
  }
  const byId = {};
  data.categories.forEach((c) => c.items.forEach((p) => byId[p.id] = { ...p, cat: c.name }));
  cur = { at: Date.now(), v: { data, byId, rules: b.rules, version: saved?.version || 0, updatedAt: saved?.updatedAt || null, contentAt: saved?.contentAt || null } };
  return cur.v;
}
var euro = (n) => (Math.round(n * 100) / 100).toFixed(2);
var GIORNI = ["Domenica", "Luned\xEC", "Marted\xEC", "Mercoled\xEC", "Gioved\xEC", "Venerd\xEC", "Sabato"];
var hm = (t) => String(Math.floor(t / 60) % 24).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0");
function rangesOf(hours) {
  if (!hours || /chius/i.test(hours)) return [];
  return [...String(hours).matchAll(/(\d{1,2})[:.](\d{2})\s*[–—-]\s*(\d{1,2})[:.](\d{2})/g)].map((m) => {
    const o = +m[1] * 60 + +m[2];
    let c = +m[3] * 60 + +m[4];
    if (c <= o) c += 1440;
    return [o, c];
  });
}
function openStatus(R, now = /* @__PURE__ */ new Date()) {
  const iso = day(now), wd = (/* @__PURE__ */ new Date(iso + "T12:00:00Z")).getUTCDay();
  const [h, m] = now.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }).split(":").map(Number);
  const nowM = h * 60 + m, hoursOf = (w) => ((R.opening_hours || []).find((x) => x.day === GIORNI[w]) || {}).hours || "";
  const label = (/* @__PURE__ */ new Date(iso + "T12:00:00Z")).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const cl = closureOf(R, iso);
  const today = cl ? [] : rangesOf(hoursOf(wd)), cur2 = today.find(([o, c]) => nowM >= o && nowM < c);
  if (cur2) return { open: true, text: `${label}, ore ${hm(nowM)}. Il locale \xE8 APERTO adesso (fino alle ${hm(cur2[1])}).` };
  if (cl) return { open: false, text: `${label}, ore ${hm(nowM)}. Il locale \xE8 CHIUSO per chiusura straordinaria${cl.note ? " (" + cl.note + ")" : ""} fino al ${cl.to || cl.from} compreso.` };
  for (let k = 0; k < 8; k++) {
    const dk = day(new Date(now.getTime() + k * 864e5));
    if (closureOf(R, dk)) continue;
    const w = (wd + k) % 7, r = rangesOf(hoursOf(w)).find(([o]) => k > 0 || o > nowM);
    if (r) {
      const quando = k === 0 ? "oggi" : k === 1 ? "domani" : GIORNI[w].toLowerCase();
      return { open: false, text: `${label}, ore ${hm(nowM)}. Il locale \xE8 CHIUSO adesso: riapre ${quando} alle ${hm(r[0])}.` };
    }
  }
  return { open: false, text: `${label}, ore ${hm(nowM)}. Il locale \xE8 CHIUSO adesso.` };
}
var STATE_SHORT = { non_disponibile: "NON DISPONIBILE oggi", esaurito_oggi: "ESAURITO oggi", solo_pranzo: "NON DISPONIBILE ora (solo a pranzo)", solo_cena: "NON DISPONIBILE ora (solo a cena)", finito: "TERMINATO oggi" };
function localeText(R, now = /* @__PURE__ */ new Date()) {
  const oggi = day(now);
  const chiusure = (R.closures || []).filter((c) => (c.to || c.from) >= oggi).map((c) => (c.from === (c.to || c.from) ? c.from : `dal ${c.from} al ${c.to}`) + (c.note ? ` (${c.note})` : ""));
  return `${R.name}${R.tagline ? " \u2013 " + R.tagline : ""}. ${R.address}, ${R.postal_code} ${R.city} (${R.province}). Tel ${R.phone}${R.whatsapp ? ", WhatsApp " + R.whatsapp : ""}${R.email ? ", " + R.email : ""}${R.website ? ", " + R.website : ""}.
Orari: ${(R.opening_hours || []).map((h) => `${h.day} ${h.hours}`).join("; ")}. ${R.closing_days || ""}
` + (chiusure.length ? `Chiusure straordinarie: ${chiusure.join("; ")}.
` : "") + `Coperti ${R.seats}, tavoli ${R.tables_count}. Servizi: ${(R.services || []).join("; ") || "-"}.
Info: ${R.info || "-"}
` + (R.takeaway_on ? `Asporto: attivo, si ordina in chat. Pronto in almeno ${R.takeaway_min || 20} minuti, si paga al ritiro. Nei giorni di chiusura niente asporto.` : "Asporto: non disponibile.") + "\n" + (R.booking_on === false ? "Richieste di prenotazione online: SOSPESE. Per prenotare il cliente deve telefonare." : "Richieste di prenotazione: attive (le conferma sempre il personale).");
}
function faqText(R) {
  const f = ((R.marina || {}).faq || []).filter((x) => x && x.q && x.a);
  return f.length ? f.map((x) => `D: ${x.q}
R: ${x.a}`).join("\n") : "(nessuna)";
}
function buildRules({ data, rules }, table) {
  const R = data.restaurant;
  const menu = data.categories.map((c) => `## ${c.name}
` + c.items.map((p) => `${p.id} | ${p.name} | ${euro(p.price)} | ${(p.all || []).join(", ") || "nessuno indicato"} | ${p.veg ? "V" : "-"} | ${p.av ? "disponibile" : STATE_SHORT[p.why] || "NON DISPONIBILE"} | ${p.ingr || "ingredienti non indicati"} | ${p.desc}`).join("\n")).join("\n");
  const modo = table ? `TAVOLO ${table} (il cliente \xE8 seduto al tavolo ${table})` : `SITO (${R.takeaway_on ? "asporto" : "asporto non attivo"}; ${R.booking_on === false ? "prenotazioni online sospese" : "richieste di prenotazione"})`;
  return rules.replace("{{LOCALE}}", localeText(R)).replace("{{FAQ}}", faqText(R)).replace("{{ORA}}", openStatus(R).text).replace("{{MODO}}", modo).replace("{{MENU}}", menu);
}

// ../../../mnt/attach/outputs/da-shaka-menu/netlify/functions/marina.mjs
var marina_default = async (req) => {
  if (req.method !== "POST") return json({ error: "Metodo non consentito" }, 405);
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json({ error: "ANTHROPIC_API_KEY non configurata su Netlify" }, 500);
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Richiesta non valida" }, 400);
  }
  let turns = (Array.isArray(body.turns) ? body.turns : []).filter((t) => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string" && t.content.trim()).map((t) => ({ role: t.role, content: t.content.slice(0, 2e3) })).slice(-16);
  while (turns.length && turns[0].role !== "user") turns.shift();
  if (!turns.length || turns[turns.length - 1].role !== "user") return json({ error: "Messaggio mancante" }, 400);
  const table = /^\d{1,3}$/.test(String(body.table ?? "")) ? Number(body.table) : null;
  let system;
  try {
    const site = await loadSite(siteOrigin(req));
    system = buildRules({ data: await publicData(site), rules: site.rules }, table);
  } catch (e) {
    return json({ error: "Menu non leggibile: " + e.message }, 500);
  }
  let r;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(2e4),
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.CHAT_MODEL || "claude-haiku-4-5",
        max_tokens: 500,
        system,
        messages: turns
      })
    });
  } catch (e) {
    return json({ error: "Il servizio AI non risponde" }, 504);
  }
  const out = await r.json().catch(() => ({}));
  if (!r.ok) return json({ error: out?.error?.message || "Errore del servizio AI" }, 502);
  const text = (out.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  return json({ text: text || "Scusa, non ho capito. Puoi ripetere?" });
};
var config = { path: "/api/marina" };
export {
  config,
  marina_default as default
};
