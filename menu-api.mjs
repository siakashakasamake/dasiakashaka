// ../../../mnt/attach/outputs/da-shaka-menu/netlify/lib/menu.mjs
import { getStore } from "@netlify/blobs";
var ALLERGENS = ["Glutine", "Crostacei", "Uova", "Pesce", "Arachidi", "Soia", "Latte", "Frutta a guscio", "Sedano", "Senape", "Sesamo", "Solfiti", "Lupini", "Molluschi"];
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
async function saveMenu(origin, data, baseVersion, { keepVersion = false } = {}) {
  const s = store();
  const cur2 = await s.getWithMetadata("menu/current", { type: "json" });
  const curVer = cur2?.data?.version || 0;
  if (Number(baseVersion) !== curVer) {
    const e = new Error("Il menu \xE8 stato modificato da un altro dispositivo: ricarica la pagina");
    e.status = 409;
    throw e;
  }
  const base2 = await loadBase(origin);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const rec = {
    data,
    version: keepVersion ? curVer : curVer + 1,
    rev: (cur2?.data?.rev || 0) + 1,
    updatedAt: now,
    contentAt: keepVersion || cur2 && sameContent(cur2.data.data, data) ? cur2?.data?.contentAt || null : now,
    baseCats: base2.data.categories.map((c) => c.name)
  };
  const w = cur2 ? await s.setJSON("menu/current", rec, { onlyIfMatch: cur2.etag }) : await s.setJSON("menu/current", rec, { onlyIfNew: true });
  if (!w.modified) {
    const e = new Error("Il menu \xE8 stato modificato da un altro dispositivo, riprova");
    e.status = 409;
    e.retry = true;
    throw e;
  }
  cur_reset();
  return rec;
}
function cur_reset() {
  cur = { at: 0, v: null };
}
function sameContent(a, b) {
  const strip = (d) => JSON.stringify((d?.categories || []).map((c) => [c.name, c.items.map(({ av, out_until, ...p }) => p)]));
  return strip(a) === strip(b);
}
var compact = (o) => ({
  id: o.id,
  code: o.code,
  type: o.type || "tavolo",
  table: o.table,
  session: o.session || null,
  pickup: o.pickup || null,
  createdAt: o.createdAt,
  status: o.status,
  total: o.total,
  note: o.note || "",
  source: o.source || "",
  cancelReason: o.cancelReason || "",
  history: o.history || null,
  items: (o.items || []).map((i) => ({ id: i.id, name: i.name, cat: i.cat || "", qty: i.qty, price: i.price, all: i.all || null, note: i.note || "" })),
  prepMin: o.times?.ready ? Math.round((Date.parse(o.times.ready) - Date.parse(o.createdAt)) / 6e4) : null
});
var mem = /* @__PURE__ */ new Map();
async function ordersOfDay(s, d, today, yesterday) {
  const closed = d < yesterday;
  if (closed) {
    if (mem.has(d)) return mem.get(d);
    const sum = await s.get(`sum/${d}`, { type: "json" });
    if (sum) {
      mem.set(d, sum);
      return sum;
    }
  }
  const { blobs } = await s.list({ prefix: `o/${d}/` });
  const list = (await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })))).filter(Boolean).map(compact);
  if (closed) {
    await s.setJSON(`sum/${d}`, list);
    mem.set(d, list);
  }
  return list;
}
var topMem = { at: 0, ids: [] };
async function topSellers() {
  if (Date.now() - topMem.at < 30 * 60 * 1e3) return topMem.ids;
  const s = store();
  try {
    const saved = await s.get("top/current", { type: "json" });
    if (saved && Date.now() - saved.at < 30 * 60 * 1e3) {
      topMem = saved;
      return saved.ids;
    }
  } catch {
  }
  const today = day(), yesterday = day(new Date(Date.now() - 864e5)), days = [];
  for (let k = 0; k < 14; k++) days.push(day(new Date(Date.now() - k * 864e5)));
  const qty = {};
  try {
    const lists = await Promise.all(days.map((d) => ordersOfDay(s, d, today, yesterday)));
    for (const o of lists.flat()) if (o.status !== "cancelled") for (const i of o.items || []) qty[i.id] = (qty[i.id] || 0) + i.qty;
  } catch (e) {
    console.error("top", e);
  }
  const ids = Object.keys(qty).sort((a, b) => qty[b] - qty[a]).slice(0, 12);
  topMem = { at: Date.now(), ids };
  try {
    await s.setJSON("top/current", topMem);
  } catch {
  }
  return ids;
}

// ../../../mnt/attach/outputs/da-shaka-menu/netlify/functions/menu-api.mjs
var str = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, max);
var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
var HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
var int = (v, min, max, def) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def;
};
function cleanWa(v) {
  const s = str(v, 30);
  if (!s) return "";
  const d = s.replace(/[^\d+]/g, "");
  if (!/^\+\d{8,15}$/.test(d)) throw new Error("Numero WhatsApp non valido: scrivilo con il prefisso internazionale, per esempio +39 333 1234567");
  return s;
}
function validate(input) {
  const R = input?.restaurant, cats = input?.categories;
  if (!R || typeof R !== "object") throw new Error("Dati del locale mancanti");
  if (!Array.isArray(cats) || !cats.length || cats.length > 20) throw new Error("Categorie non valide");
  const days7 = (a) => (Array.isArray(a) ? a : []).slice(0, 7).map((h) => ({ day: str(h?.day, 20), hours: str(h?.hours, 60) }));
  const closures = (Array.isArray(R.closures) ? R.closures : []).slice(0, 40).map((c) => {
    const from = String(c?.from || ""), to = String(c?.to || c?.from || "");
    if (!DAY_RE.test(from) || !DAY_RE.test(to)) throw new Error("Data di chiusura non valida");
    return { from: from <= to ? from : to, to: from <= to ? to : from, note: str(c?.note, 80) };
  });
  const faq = (Array.isArray(R.marina?.faq) ? R.marina.faq : []).slice(0, 60).map((f) => ({ q: str(f?.q, 160), a: str(f?.a, 600) })).filter((f) => f.q && f.a);
  const restaurant = {
    ...R,
    name: str(R.name, 60) || "Ristorante",
    tagline: str(R.tagline, 80),
    order_prefix: str(R.order_prefix, 4).toUpperCase().replace(/[^A-Z]/g, "") || "ORD",
    address: str(R.address, 120),
    postal_code: str(R.postal_code, 10),
    city: str(R.city, 60),
    province: str(R.province, 4),
    region: str(R.region, 40),
    country: str(R.country, 40),
    google_review_url: /^https:\/\/[^\s"'<>]+$/.test(String(R.google_review_url || "").trim()) ? str(R.google_review_url, 300) : "",
    phone: str(R.phone, 40),
    whatsapp: cleanWa(R.whatsapp),
    email: str(R.email, 80),
    website: str(R.website, 120),
    description: str(R.description, 1200),
    closing_days: str(R.closing_days, 300),
    info: str(R.info, 800),
    seats: int(R.seats, 0, 2e3, 0),
    hero: typeof R.hero === "string" && /^\/api\/foto\?id=COPERTINA&v=\d+$/.test(R.hero) ? R.hero : null,
    waiter_img: typeof R.waiter_img === "string" && /^\/api\/foto\?id=AVATAR&v=\d+$/.test(R.waiter_img) ? R.waiter_img : null,
    logo: typeof R.logo === "string" && /^\/api\/foto\?id=LOGO&v=\d+$/.test(R.logo) ? R.logo : null,
    takeaway_on: !!R.takeaway_on,
    takeaway_min: int(R.takeaway_min, 5, 180, 20),
    takeaway_open_before: int(R.takeaway_open_before, 0, 180, 30),
    takeaway_close_before: int(R.takeaway_close_before, 0, 180, 30),
    tables_count: int(R.tables_count, 1, 200, 1),
    opening_hours: days7(R.opening_hours),
    services: (Array.isArray(R.services) ? R.services : []).map((s) => str(s, 80)).filter(Boolean).slice(0, 30),
    closures,
    lunch_until: HM_RE.test(String(R.lunch_until || "")) ? R.lunch_until : "16:00",
    late_min: int(R.late_min, 3, 90, 15),
    booking_on: R.booking_on !== false,
    booking_hours: days7(R.booking_hours),
    booking_step: [15, 30, 60].includes(Number(R.booking_step)) ? Number(R.booking_step) : 30,
    booking_last_before: int(R.booking_last_before, 0, 240, 60),
    booking_capacity: int(R.booking_capacity, 0, 2e3, 0),
    marina: { faq, updatedAt: str(R.marina?.updatedAt, 40) || null }
  };
  const ids = /* @__PURE__ */ new Set();
  let total = 0;
  const categories = cats.map((c) => {
    const items = (Array.isArray(c?.items) ? c.items : []).map((p) => {
      const id = str(p?.id, 8).toUpperCase();
      if (!/^[A-Z]{1,2}\d{2,3}$/.test(id)) throw new Error("Codice prodotto non valido: " + id);
      if (ids.has(id)) throw new Error("Codice prodotto duplicato: " + id);
      ids.add(id);
      const name = str(p.name, 90);
      if (!name) throw new Error("Un prodotto non ha il nome");
      const price = Math.round(Number(p.price) * 100) / 100;
      if (!Number.isFinite(price) || price < 0 || price > 5e3) throw new Error(`Prezzo non valido per "${name}"`);
      const img = typeof p.img === "string" && /^\/api\/foto\?id=[A-Z0-9]+&v=\d+$/.test(p.img) ? p.img : null;
      const out = {
        id,
        name,
        price,
        img,
        desc: str(p.desc, 300),
        ingr: str(p.ingr, 400),
        all: (Array.isArray(p.all) ? p.all : []).filter((a) => ALLERGENS.includes(a)),
        veg: !!p.veg,
        star: !!p.star,
        av: p.av !== false
      };
      if (p.hidden) out.hidden = true;
      if (p.when === "pranzo" || p.when === "cena") out.when = p.when;
      if (p.qty !== null && p.qty !== void 0 && p.qty !== "") out.qty = int(p.qty, 0, 999, 0);
      if (DAY_RE.test(String(p.out_until || ""))) out.out_until = p.out_until;
      if (DAY_RE.test(String(p.all_ok || ""))) out.all_ok = p.all_ok;
      return out;
    });
    total += items.length;
    return { name: str(c.name, 40) || "Categoria", items };
  });
  if (total > 400) throw new Error("Troppi prodotti (massimo 400)");
  return { restaurant, categories };
}
function keepAvailability(next, cur2) {
  const byId = {};
  cur2.categories.forEach((c) => c.items.forEach((p) => byId[p.id] = p));
  next.categories.forEach((c) => c.items.forEach((p) => {
    const o = byId[p.id];
    if (!o) return;
    p.av = o.av !== false;
    if (o.out_until) p.out_until = o.out_until;
    else delete p.out_until;
  }));
  return next;
}
async function quick(req, origin) {
  let b;
  try {
    b = await req.json();
  } catch {
    return json({ error: "Richiesta non valida" }, 400);
  }
  const id = String(b.id || ""), az = String(b.azione || "");
  if (!["esaurito_oggi", "disponibile", "non_disponibile"].includes(az)) return json({ error: "Azione non valida" }, 400);
  for (let i = 0; i < 5; i++) {
    const site = await loadSite(origin, { fresh: true });
    const data = JSON.parse(JSON.stringify(site.data));
    let p = null;
    data.categories.forEach((c) => c.items.forEach((x) => {
      if (x.id === id) p = x;
    }));
    if (!p) return json({ error: "Piatto non trovato" }, 404);
    if (az === "esaurito_oggi") {
      p.av = true;
      p.out_until = day();
    }
    if (az === "disponibile") {
      p.av = true;
      delete p.out_until;
    }
    if (az === "non_disponibile") {
      p.av = false;
      delete p.out_until;
    }
    try {
      const rec = await saveMenu(origin, data, site.version, { keepVersion: true });
      return json({ ok: true, id, av: p.av, out_until: p.out_until || null, version: rec.version, updatedAt: rec.updatedAt });
    } catch (e) {
      if (e.status !== 409) throw e;
    }
  }
  return json({ error: "Menu modificato da un altro dispositivo, riprova" }, 409);
}
var menu_api_default = async (req) => {
  const origin = siteOrigin(req);
  try {
    const url = new URL(req.url);
    if (req.method === "GET" && url.searchParams.get("tutto")) {
      const bad = await needRole(req, ["titolare", "sala"]);
      if (bad) return bad;
      const s = await loadSite(origin, { fresh: true });
      return json({ data: s.data, version: s.version, updatedAt: s.updatedAt, contentAt: s.contentAt, sold: await soldToday(), today: day() });
    }
    if (req.method === "GET") {
      const s = await loadSite(origin);
      let top = [];
      try {
        top = (await topSellers()).filter((id) => s.byId[id] && !s.byId[id].hidden);
      } catch {
      }
      return json({ data: await publicData(s), version: s.version, updatedAt: s.updatedAt, contentAt: s.contentAt, top });
    }
    if (req.method === "PATCH") {
      const bad = await needRole(req, ["titolare", "sala"]);
      if (bad) return bad;
      return await quick(req, origin);
    }
    if (req.method === "PUT") {
      const bad = await needRole(req, ["titolare"]);
      if (bad) return bad;
      let body;
      try {
        body = await req.json();
      } catch {
        return json({ error: "Richiesta non valida" }, 400);
      }
      let data;
      try {
        data = validate(body.data);
      } catch (e) {
        return json({ error: e.message }, 400);
      }
      for (let i = 0; ; i++) {
        const cur2 = await loadSite(origin, { fresh: true });
        const next = keepAvailability(JSON.parse(JSON.stringify(data)), cur2.data);
        try {
          const rec = await saveMenu(origin, next, body.baseVersion);
          return json({ version: rec.version, updatedAt: rec.updatedAt, data: next });
        } catch (e) {
          if (!e.retry || i >= 4) throw e;
        }
      }
    }
    return json({ error: "Metodo non consentito" }, 405);
  } catch (e) {
    console.error(e);
    return json({ error: e.status === 409 ? e.message : "Errore del server, riprova" }, e.status || 500);
  }
};
var config = { path: "/api/menu" };
export {
  config,
  menu_api_default as default
};
