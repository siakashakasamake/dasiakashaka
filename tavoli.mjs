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

// ../../../mnt/attach/outputs/da-shaka-menu/netlify/functions/tavoli.mjs
var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
var OPEN = ["new", "accepted", "preparing", "ready"];
var rand = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
var clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
var covers = (v) => {
  if (v === null || v === void 0 || v === "") return null;
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n >= 1 && n <= 99 ? n : void 0;
};
async function ordersOfSession(s, sid, openedAt) {
  const days = /* @__PURE__ */ new Set([day(new Date(openedAt)), day(new Date(Date.now() - 864e5)), day()]);
  const out = [];
  for (const d of days) {
    const { blobs } = await s.list({ prefix: `o/${d}/` });
    const list2 = await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })));
    for (const o of list2) if (o && o.session === sid) out.push(o);
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
async function list(req) {
  const u = new URL(req.url), s = store();
  if (u.searchParams.get("storico")) {
    const today = day();
    const dal = DAY_RE.test(u.searchParams.get("dal") || "") ? u.searchParams.get("dal") : today;
    const al = DAY_RE.test(u.searchParams.get("al") || "") ? u.searchParams.get("al") : today;
    const days = [], d = /* @__PURE__ */ new Date(dal + "T12:00:00Z"), end = /* @__PURE__ */ new Date(al + "T12:00:00Z");
    while (d <= end && days.length < 92) {
      days.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 1);
    }
    const lists = await Promise.all(days.map(async (x) => {
      const { blobs: blobs2 } = await s.list({ prefix: `tsess/${x}/` });
      return (await Promise.all(blobs2.map((b) => s.get(b.key, { type: "json" })))).filter(Boolean);
    }));
    const items = lists.flat().sort((a, b) => b.closedAt.localeCompare(a.closedAt));
    return json({ dal, al, sessions: items.slice(0, 500) });
  }
  const site = await loadSite(siteOrigin(req));
  const n = site.data.restaurant.tables_count || 20;
  const { blobs } = await s.list({ prefix: "tav/" });
  const open = (await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })))).filter((x) => x && x.table <= n);
  return json({ tables: n, sessions: open, now: (/* @__PURE__ */ new Date()).toISOString(), role: roleOf(req) });
}
async function act(req) {
  let b;
  try {
    b = await req.json();
  } catch {
    return json({ error: "Richiesta non valida" }, 400);
  }
  const site = await loadSite(siteOrigin(req));
  const table = Number(b.table);
  if (!Number.isInteger(table) || table < 1 || table > (site.data.restaurant.tables_count || 20)) return json({ error: "Numero del tavolo non valido" }, 400);
  const s = store(), key = `tav/${table}`, by = roleOf(req);
  const cv = covers(b.covers);
  if (cv === void 0) return json({ error: "Numero di coperti non valido (da 1 a 99)" }, 400);
  if (b.azione === "apri") {
    const now = /* @__PURE__ */ new Date();
    const rec = { sid: `${day(now)}_${now.getTime().toString(36)}${rand(2)}`, table, openedAt: now.toISOString(), covers: cv, by, note: clean(b.note, 120) };
    const w = await s.setJSON(key, rec, { onlyIfNew: true });
    if (!w.modified) return json({ error: `Il tavolo ${table} \xE8 gi\xE0 aperto`, session: await s.get(key, { type: "json" }) }, 409);
    return json({ ok: true, session: rec }, 201);
  }
  const cur2 = await s.getWithMetadata(key, { type: "json" });
  if (!cur2?.data) return json({ error: `Il tavolo ${table} \xE8 gi\xE0 libero` }, 409);
  if (b.sid && b.sid !== cur2.data.sid) return json({ error: "Il tavolo \xE8 stato chiuso e riaperto da un altro dispositivo: aggiorna la pagina" }, 409);
  if (b.azione === "modifica") {
    const upd = { ...cur2.data, covers: cv, note: b.note === void 0 ? cur2.data.note : clean(b.note, 120) };
    const w = await s.setJSON(key, upd, { onlyIfMatch: cur2.etag });
    if (!w.modified) return json({ error: "Modificato da un altro dispositivo, riprova" }, 409);
    return json({ ok: true, session: upd });
  }
  if (b.azione === "chiudi") {
    const orders = await ordersOfSession(s, cur2.data.sid, cur2.data.openedAt);
    const open = orders.filter((o) => OPEN.includes(o.status));
    if (open.length && !b.forza) return json({ error: `Ci sono ancora ${open.length} comande non servite`, open: open.map((o) => o.code) }, 409);
    const valid = orders.filter((o) => o.status !== "cancelled");
    const closedAt = (/* @__PURE__ */ new Date()).toISOString();
    const rec = {
      ...cur2.data,
      closedAt,
      closedBy: by,
      total: Math.round(valid.reduce((t, o) => t + o.total, 0) * 100) / 100,
      orders: orders.map((o) => ({ id: o.id, code: o.code, status: o.status, total: o.total, createdAt: o.createdAt, items: o.items.map((i) => ({ name: i.name, qty: i.qty, price: i.price })) }))
    };
    await s.setJSON(`tsess/${day(new Date(cur2.data.openedAt))}/${cur2.data.sid}`, rec);
    const again = await s.getWithMetadata(key, { type: "json" });
    if (again?.data?.sid === cur2.data.sid) await s.delete(key);
    return json({ ok: true, session: rec });
  }
  return json({ error: "Azione non valida" }, 400);
}
var tavoli_default = async (req) => {
  try {
    const bad = await needRole(req, ["titolare", "sala"]);
    if (bad) return bad;
    if (req.method === "GET") return await list(req);
    if (req.method === "POST") return await act(req);
    return json({ error: "Metodo non consentito" }, 405);
  } catch (e) {
    console.error(e);
    return json({ error: "Errore del server, riprova" }, 500);
  }
};
var config = { path: "/api/tavoli" };
export {
  config,
  tavoli_default as default
};
