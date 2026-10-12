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
function same(a, b) {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function roleOf(req) {
  const given = req.headers.get("x-pin") || "";
  if (!given) return null;
  for (const [env, role] of [["ADMIN_PIN", "titolare"], ["SALA_PIN", "sala"], ["KITCHEN_PIN", "cucina"]]) {
    if (same(process.env[env], given)) return role;
  }
  return null;
}
var ipKey = (req) => (req.headers.get("x-nf-client-connection-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0] || "locale").trim().replace(/[^0-9a-fA-F.:]/g, "").slice(0, 45) || "locale";
async function needRole(req, roles) {
  if (!process.env.ADMIN_PIN) return json({ error: "Accesso non ancora configurato: contatta l'assistenza" }, 503);
  const s = store(), key = `lock/${ipKey(req)}`, now = Date.now();
  let st = null;
  try {
    st = await s.get(key, { type: "json" });
  } catch {
  }
  if (st?.until > now) return json({ error: "Troppi tentativi con un PIN sbagliato: riprova tra qualche minuto" }, 429);
  const r = roleOf(req);
  if (!r) {
    const fresh = st && now - st.first < 15 * 6e4;
    const rec = { fails: (fresh ? st.fails : 0) + 1, first: fresh ? st.first : now };
    if (rec.fails >= 10) rec.until = now + 15 * 6e4;
    try {
      await s.setJSON(key, rec);
    } catch {
    }
    return json({ error: rec.until ? "Troppi tentativi con un PIN sbagliato: riprova tra qualche minuto" : "PIN errato" }, rec.until ? 429 : 401);
  }
  if (!roles.includes(r)) return json({ error: "Operazione non consentita con questo accesso" }, 403);
  return null;
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
var STATE_TXT = { nascosto: "non \xE8 nel menu", non_disponibile: "oggi non \xE8 disponibile", esaurito_oggi: "\xE8 esaurito per oggi", solo_pranzo: "si serve solo a pranzo", solo_cena: "si serve solo a cena", finito: "\xE8 terminato per oggi" };
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
function rangesOf(hours) {
  if (!hours || /chius/i.test(hours)) return [];
  return [...String(hours).matchAll(/(\d{1,2})[:.](\d{2})\s*[–—-]\s*(\d{1,2})[:.](\d{2})/g)].map((m) => {
    const o = +m[1] * 60 + +m[2];
    let c = +m[3] * 60 + +m[4];
    if (c <= o) c += 1440;
    return [o, c];
  });
}

// ../../../mnt/attach/outputs/da-shaka-menu/netlify/functions/ordini.mjs
var STATUSES = ["new", "accepted", "preparing", "ready", "served", "cancelled"];
var NEXT = { new: ["accepted", "preparing", "cancelled"], accepted: ["preparing", "cancelled"], preparing: ["ready", "cancelled"], ready: ["served", "cancelled"] };
var rand = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
var keyOf = (id) => {
  const m = /^(\d{4}-\d{2}-\d{2})_[a-z0-9]+$/.exec(String(id || ""));
  return m ? `o/${m[1]}/${id}` : null;
};
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
var clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
var WHO = { titolare: "titolare", sala: "sala", cucina: "cucina" };
var publicOrder = ({ token, ...o }) => o;
async function nextNumber(s, orderId) {
  const hint = Number((await s.get("counter", { type: "json" }))?.n) || 0;
  for (let n = hint + 1; n <= hint + 200; n++) {
    const w = await s.setJSON(`num/${String(n).padStart(6, "0")}`, { id: orderId }, { onlyIfNew: true });
    if (w.modified) {
      await s.setJSON("counter", { n });
      return n;
    }
  }
  throw new Error("Numerazione ordini non disponibile, riprova");
}
async function readOrder(s, id) {
  const k = keyOf(id);
  return k ? s.getWithMetadata(k, { type: "json" }) : null;
}
async function changeSold(s, d, delta, limits) {
  const key = `sold/${d}`;
  for (let i = 0; i < 12; i++) {
    const cur2 = await s.getWithMetadata(key, { type: "json" });
    const sold = { ...cur2?.data || {} };
    for (const [id, q] of Object.entries(delta)) {
      const next = (sold[id] || 0) + q;
      if (limits && Number.isInteger(limits[id]) && q > 0 && next > limits[id]) {
        const left = Math.max(0, limits[id] - (sold[id] || 0));
        return { ok: false, id, left };
      }
      sold[id] = Math.max(0, next);
    }
    const w = cur2 ? await s.setJSON(key, sold, { onlyIfMatch: cur2.etag }) : await s.setJSON(key, sold, { onlyIfNew: true });
    if (w.modified) return { ok: true };
    await sleep(30);
  }
  throw new Error("Porzioni non aggiornate, riprova");
}
async function sessionOf(s, table, by) {
  for (let i = 0; i < 6; i++) {
    const cur2 = await s.get(`tav/${table}`, { type: "json" });
    if (cur2?.sid) return cur2.sid;
    const now = /* @__PURE__ */ new Date();
    const rec = { sid: `${day(now)}_${now.getTime().toString(36)}${rand(2)}`, table, openedAt: now.toISOString(), covers: null, by, note: "" };
    const w = await s.setJSON(`tav/${table}`, rec, { onlyIfNew: true });
    if (w.modified) return rec.sid;
  }
  return null;
}
async function createOrder(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Richiesta non valida" }, 400);
  }
  let role = null;
  if (body.manuale === true) {
    const bad = await needRole(req, ["titolare", "sala"]);
    if (bad) return bad;
    role = roleOf(req);
  }
  const staff = body.manuale === true;
  let site;
  try {
    site = await loadSite(siteOrigin(req), { fresh: true });
  } catch (e) {
    return json({ error: "Menu non leggibile, riprova tra poco" }, 500);
  }
  const R = site.data.restaurant;
  const now = /* @__PURE__ */ new Date(), today = day(now);
  const asporto = body.type === "asporto" && !staff;
  let table = null, pickup = null;
  if (asporto) {
    if (!R.takeaway_on) return json({ error: "Al momento l'asporto non \xE8 attivo" }, 400);
    const oggi = now.toLocaleDateString("it-IT", { weekday: "long", timeZone: "Europe/Rome" }).toLowerCase();
    const orario = (R.opening_hours || []).find((h) => String(h.day).toLowerCase() === oggi);
    if (closureOf(R, today) || orario && /chius/i.test(orario.hours)) return json({ error: "Oggi il locale \xE8 chiuso: l'asporto non \xE8 disponibile, puoi prenotare un tavolo" }, 400);
    if (orario) {
      const nowM = romeMin(now), OB = R.takeaway_open_before ?? 30, CB = R.takeaway_close_before ?? 30;
      const [ph, pm] = String(body.time || "").split(":").map(Number), pick = ph * 60 + pm;
      const ranges = rangesOf(orario.hours);
      const ok = !ranges.length || ranges.some(([o, c]) => nowM >= o - OB && nowM <= c - CB && pick >= o && pick <= c - CB && pick >= nowM);
      if (!ok) return json({ error: "Orario di ritiro non disponibile: gli ordini da asporto si aprono mezz'ora prima dell'apertura e chiudono mezz'ora prima della chiusura" }, 400);
    }
    const name = clean(body.name, 60), phone = String(body.phone || "").replace(/[^\d+ ]/g, "").trim().slice(0, 20), time = String(body.time || "");
    if (name.length < 2) return json({ error: "Scrivi il tuo nome per il ritiro" }, 400);
    if (body.via !== "whatsapp" && phone.replace(/\D/g, "").length < 6) return json({ error: "Numero di telefono non valido" }, 400);
    if (phone && phone.replace(/\D/g, "").length < 6) return json({ error: "Numero di telefono non valido" }, 400);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return json({ error: "Orario di ritiro non valido" }, 400);
    pickup = { name, phone, time, via: body.via === "whatsapp" ? "whatsapp" : "sito" };
  } else {
    table = Number(body.table);
    if (!Number.isInteger(table) || table < 1 || table > (R.tables_count || 20)) return json({ error: "Numero del tavolo non valido" }, 400);
  }
  const raw = Array.isArray(body.items) ? body.items : [];
  if (!raw.length) return json({ error: "Il carrello \xE8 vuoto" }, 400);
  if (raw.length > 40) return json({ error: "Troppe righe nell'ordine" }, 400);
  const needsSold = raw.some((it) => Number.isInteger(site.byId[String(it?.id || "")]?.qty));
  let sold = {};
  if (needsSold) sold = await store().get(`sold/${today}`, { type: "json" }) || {};
  const items = [], want = {}, limits = {};
  for (const it of raw) {
    const p = site.byId[String(it?.id || "")];
    const q = Number(it?.q);
    if (!p || p.hidden) return json({ error: "Un prodotto non \xE8 pi\xF9 nel menu: aggiorna la pagina" }, 400);
    const st = itemState(p, R, now, sold);
    if (st !== "ok") return json({ error: `"${p.name}" ${STATE_TXT[st] || "non \xE8 disponibile"}` }, 409);
    if (!Number.isInteger(q) || q < 1 || q > 20) return json({ error: "Quantit\xE0 non valida" }, 400);
    items.push({ id: p.id, name: p.name, cat: p.cat, qty: q, price: p.price, all: (p.all || []).slice(), note: clean(it.nota, 200) });
    if (Number.isInteger(p.qty)) {
      want[p.id] = (want[p.id] || 0) + q;
      limits[p.id] = p.qty;
    }
  }
  const total = Math.round(items.reduce((s2, i) => s2 + i.qty * i.price, 0) * 100) / 100;
  const ref = /^[a-z0-9-]{16,64}$/i.test(String(body.ref || "")) ? String(body.ref) : null;
  const s = store();
  const fromRef = async () => {
    for (let i = 0; i < 10; i++) {
      const r = await s.get(`ref/${ref}`, { type: "json" });
      if (r?.id) {
        const o = await readOrder(s, r.id);
        if (o?.data) return json({ ...publicOrder(o.data), token: o.data.token, duplicate: true });
      }
      await sleep(150);
    }
    return json({ error: "Ordine in elaborazione, riprova tra un attimo" }, 409);
  };
  if (ref && await s.get(`ref/${ref}`, { type: "json" })) return fromRef();
  const id = `${today}_${now.getTime().toString(36)}${rand(3)}`;
  if (ref) {
    const w = await s.setJSON(`ref/${ref}`, { id }, { onlyIfNew: true });
    if (!w.modified) return fromRef();
  }
  if (Object.keys(want).length) {
    const r = await changeSold(s, today, want, limits);
    if (!r.ok) {
      if (ref) await s.delete(`ref/${ref}`);
      const p = site.byId[r.id];
      return json({ error: r.left ? `Di "${p.name}" restano solo ${r.left} porzioni` : `"${p.name}" \xE8 terminato per oggi` }, 409);
    }
  }
  let n;
  try {
    n = await nextNumber(s, id);
  } catch (e) {
    if (Object.keys(want).length) await changeSold(s, today, Object.fromEntries(Object.entries(want).map(([k, v]) => [k, -v])));
    return json({ error: e.message }, 503);
  }
  const by = staff ? WHO[role] : "cliente";
  const session = table ? await sessionOf(s, table, staff ? WHO[role] : "qr") : null;
  const order = {
    id,
    code: `${R.order_prefix || "ORD"}-${String(n).padStart(4, "0")}`,
    number: n,
    type: asporto ? "asporto" : "tavolo",
    table,
    session,
    pickup,
    items,
    note: clean(body.note, 300),
    total,
    status: "new",
    source: staff ? "personale" : asporto ? pickup.via === "whatsapp" ? "chat + WhatsApp" : "menu" : "QR del tavolo",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    history: [{ s: "new", at: now.toISOString(), by }],
    token: rand(12)
  };
  await s.setJSON(keyOf(id), order);
  return json({ ...publicOrder(order), token: order.token }, 201);
}
var listCache = /* @__PURE__ */ new Map();
async function listOrders() {
  const s = store();
  const today = /* @__PURE__ */ new Date();
  const yesterday = new Date(today.getTime() - 864e5);
  const blobs = [];
  for (const d of [day(yesterday), day(today)]) {
    const { blobs: b } = await s.list({ prefix: `o/${d}/` });
    blobs.push(...b);
  }
  const out = await Promise.all(
    blobs.map(async ({ key, etag }) => {
      const c = listCache.get(key);
      if (c && etag && c.etag === etag) return c.data;
      const data = await s.get(key, { type: "json" });
      if (data && etag) listCache.set(key, { etag, data });
      return data;
    })
  );
  const cutoff = Date.now() - 16 * 36e5;
  return out.filter(Boolean).filter((o) => ["new", "accepted", "preparing", "ready"].includes(o.status) || Date.parse(o.createdAt) > cutoff).map(publicOrder).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
async function updateStatus(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Richiesta non valida" }, 400);
  }
  const to = String(body.status || "");
  if (!STATUSES.includes(to)) return json({ error: "Stato non valido" }, 400);
  const reason = clean(body.reason, 160);
  if (to === "cancelled" && reason.length < 3) return json({ error: "Scrivi il motivo dell'annullamento" }, 400);
  const by = WHO[roleOf(req)] || "personale";
  const s = store();
  const k = keyOf(body.id);
  if (!k) return json({ error: "Ordine non trovato" }, 404);
  for (let i = 0; i < 8; i++) {
    const cur2 = await s.getWithMetadata(k, { type: "json" });
    if (!cur2) return json({ error: "Ordine non trovato" }, 404);
    const o = cur2.data;
    if (o.status === to) return json({ ...publicOrder(o), unchanged: true });
    if (body.from && body.from !== o.status) return json({ error: `L'ordine \xE8 gi\xE0 "${o.status}" (cambiato da un altro dispositivo)`, order: publicOrder(o) }, 409);
    if (!(NEXT[o.status] || []).includes(to)) return json({ error: `Passaggio non consentito: ${o.status} \u2192 ${to}` }, 409);
    const at = (/* @__PURE__ */ new Date()).toISOString();
    const h = { s: to, at, by };
    if (to === "cancelled") h.reason = reason;
    const upd = { ...o, status: to, updatedAt: at, times: { ...o.times || {}, [to]: at }, history: [...o.history || [{ s: "new", at: o.createdAt, by: "cliente" }], h] };
    if (to === "cancelled") upd.cancelReason = reason;
    const w = await s.setJSON(k, upd, { onlyIfMatch: cur2.etag });
    if (w.modified) {
      if (to === "cancelled") {
        const site = await loadSite(siteOrigin(req)).catch(() => null);
        const back = {};
        for (const it of o.items || []) if (Number.isInteger(site?.byId[it.id]?.qty)) back[it.id] = (back[it.id] || 0) - it.qty;
        if (Object.keys(back).length) await changeSold(s, o.createdAt ? day(new Date(o.createdAt)) : day(), back).catch(() => {
        });
      }
      return json(publicOrder(upd));
    }
    await sleep(50);
  }
  return json({ error: "Ordine modificato da un altro dispositivo, riprova" }, 409);
}
var ordini_default = async (req) => {
  try {
    const url = new URL(req.url);
    if (req.method === "POST") return await createOrder(req);
    if (req.method === "GET" && url.searchParams.get("id")) {
      const o = await readOrder(store(), url.searchParams.get("id"));
      if (!o?.data || o.data.token !== url.searchParams.get("t")) return json({ error: "Ordine non trovato" }, 404);
      return json(publicOrder(o.data));
    }
    const bad = await needRole(req, ["titolare", "sala", "cucina"]);
    if (bad) return bad;
    if (req.method === "GET") return json({ orders: await listOrders(), now: (/* @__PURE__ */ new Date()).toISOString(), role: roleOf(req) });
    if (req.method === "PATCH") return await updateStatus(req);
    return json({ error: "Metodo non consentito" }, 405);
  } catch (e) {
    console.error(e);
    return json({ error: "Errore del server, riprova" }, 500);
  }
};
var config = { path: "/api/ordini" };
export {
  config,
  ordini_default as default
};
