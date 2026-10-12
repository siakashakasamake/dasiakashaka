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
var toMin = (t) => {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(String(t || "").trim());
  return m ? +m[1] * 60 + +m[2] : null;
};
function closureOf(R, iso) {
  return (R.closures || []).find((c) => c && c.from && iso >= c.from && iso <= (c.to || c.from)) || null;
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
function bookable(R, iso, time) {
  if (closureOf(R, iso)) return { ok: false, error: "Quel giorno il locale \xE8 chiuso (chiusura straordinaria)" };
  const wd = GIORNI[(/* @__PURE__ */ new Date(iso + "T12:00:00Z")).getUTCDay()];
  const own = ((R.booking_hours || []).find((h) => h.day === wd) || {}).hours || "";
  const open = ((R.opening_hours || []).find((h) => h.day === wd) || {}).hours || "";
  const txt = own.trim() || open;
  if (/chius/i.test(txt) || /chius/i.test(open)) return { ok: false, error: "Quel giorno il locale \xE8 chiuso" };
  const ranges = rangesOf(txt);
  if (!ranges.length) return { ok: true };
  const t = toMin(time), last = own.trim() ? 0 : R.booking_last_before ?? 60;
  if (ranges.some(([o, c]) => t >= o && t <= c - last)) return { ok: true };
  return { ok: false, error: "Orario non prenotabile: scegli un orario tra quelli proposti" };
}
var GIORNI = ["Domenica", "Luned\xEC", "Marted\xEC", "Mercoled\xEC", "Gioved\xEC", "Venerd\xEC", "Sabato"];
function rangesOf(hours) {
  if (!hours || /chius/i.test(hours)) return [];
  return [...String(hours).matchAll(/(\d{1,2})[:.](\d{2})\s*[–—-]\s*(\d{1,2})[:.](\d{2})/g)].map((m) => {
    const o = +m[1] * 60 + +m[2];
    let c = +m[3] * 60 + +m[4];
    if (c <= o) c += 1440;
    return [o, c];
  });
}

// ../../../mnt/attach/outputs/da-shaka-menu/netlify/functions/prenotazioni.mjs
var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
var TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
var STATI = ["nuova", "confermata", "rifiutata", "annullata", "arrivata", "noshow"];
var ATTIVE = ["nuova", "confermata", "arrivata"];
var clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
var rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
async function dayList(s, d) {
  const { blobs } = await s.list({ prefix: `pren/${d}/` });
  return (await Promise.all(blobs.map((bl) => s.get(bl.key, { type: "json" })))).filter(Boolean);
}
async function create(req) {
  let b;
  try {
    b = await req.json();
  } catch {
    return json({ error: "Richiesta non valida" }, 400);
  }
  if (req.headers.get("x-pin")) {
    const bad = await needRole(req, ["titolare", "sala"]);
    if (bad) return bad;
  }
  const role = roleOf(req), staff = role === "titolare" || role === "sala";
  const d = String(b.day || ""), t = String(b.time || ""), ppl = Number(b.ppl);
  const name = clean(b.name, 60), phone = clean(b.phone, 25).replace(/[^\d+ ]/g, "").trim(), note = clean(b.note, 200);
  if (!DAY_RE.test(d) || isNaN(Date.parse(d))) return json({ error: "Data non valida" }, 400);
  if (!TIME_RE.test(t)) return json({ error: "Orario non valido" }, 400);
  if (!Number.isInteger(ppl) || ppl < 1 || ppl > 99) return json({ error: "Numero di persone non valido" }, 400);
  if (name.length < 2) return json({ error: "Scrivi il nome per la prenotazione" }, 400);
  if (!staff && phone.replace(/\D/g, "").length < 6) return json({ error: "Numero di telefono non valido" }, 400);
  const today = day();
  if (d < today) return json({ error: "La data \xE8 gi\xE0 passata" }, 400);
  if (d > day(new Date(Date.now() + 180 * 864e5))) return json({ error: "Si pu\xF2 prenotare al massimo 6 mesi prima" }, 400);
  let site;
  try {
    site = await loadSite(siteOrigin(req), { fresh: true });
  } catch (e) {
    return json({ error: "Servizio non disponibile, riprova tra poco" }, 500);
  }
  const R = site.data.restaurant;
  if (!staff) {
    if (R.booking_on === false) return json({ error: "Le prenotazioni online sono sospese: chiama il locale" }, 400);
    const v = bookable(R, d, t);
    if (!v.ok) return json({ error: v.error }, 400);
  }
  const s = store();
  const ref = /^[a-z0-9]{6,40}$/.test(String(b.ref || "")) ? b.ref : null;
  if (ref) {
    const old = await s.get(`pref/${ref}`, { type: "json" });
    if (old) return json({ ok: true, id: old.id, dup: true }, 200);
  }
  const id = `${d}_${rid()}`;
  if (ref) {
    const w = await s.setJSON(`pref/${ref}`, { id }, { onlyIfNew: true });
    if (!w.modified) return json({ ok: true, id: (await s.get(`pref/${ref}`, { type: "json" })).id, dup: true }, 200);
  }
  const same2 = (await dayList(s, d)).filter((x) => ATTIVE.includes(x.status));
  const flags = [];
  const digits = phone.replace(/\D/g, "");
  if (digits && same2.some((x) => String(x.phone || "").replace(/\D/g, "") === digits)) flags.push("stesso telefono gi\xE0 prenotato quel giorno");
  const cap = R.booking_capacity || 0;
  if (cap) {
    const slot = Math.floor(toMin(t) / 30);
    const inSlot = same2.filter((x) => Math.floor(toMin(x.time) / 30) === slot).reduce((n, x) => n + x.ppl, 0);
    if (inSlot + ppl > cap) flags.push(`fascia oltre la capacit\xE0 (${inSlot + ppl} coperti su ${cap})`);
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const status = staff ? "confermata" : "nuova";
  const rec = {
    id,
    day: d,
    time: t,
    ppl,
    name,
    phone,
    note,
    status,
    src: staff ? "pannello" : "marina",
    flags,
    createdAt: now,
    history: [{ s: status, at: now, by: staff ? role : "cliente" }]
  };
  await s.setJSON(`pren/${d}/${id}`, rec);
  return json({ ok: true, id, status, flags }, 201);
}
async function list(req) {
  const u = new URL(req.url), today = day();
  const s = store();
  if (u.searchParams.get("conta")) {
    const { blobs } = await s.list({ prefix: "pren/" });
    const keys = blobs.map((x) => x.key).filter((k) => k.slice(5, 15) >= today);
    const recs = (await Promise.all(keys.map((k) => s.get(k, { type: "json" })))).filter(Boolean);
    return json({
      nuove: recs.filter((r) => r.status === "nuova").length,
      oggi: recs.filter((r) => r.day === today && ["nuova", "confermata"].includes(r.status)).length,
      copertiOggi: recs.filter((r) => r.day === today && ["nuova", "confermata"].includes(r.status)).reduce((n, r) => n + r.ppl, 0)
    });
  }
  const dal = DAY_RE.test(u.searchParams.get("dal") || "") ? u.searchParams.get("dal") : today;
  const al = DAY_RE.test(u.searchParams.get("al") || "") ? u.searchParams.get("al") : dal;
  const days = [], d = /* @__PURE__ */ new Date(dal + "T12:00:00Z"), end = /* @__PURE__ */ new Date(al + "T12:00:00Z");
  while (d <= end && days.length < 186) {
    days.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  const lists = await Promise.all(days.map((x) => dayList(s, x)));
  const items = lists.flat().sort((a, b) => (a.day + a.time).localeCompare(b.day + b.time) || a.createdAt.localeCompare(b.createdAt));
  return json({ dal, al, items: items.slice(0, 1e3) });
}
async function update(req) {
  let b;
  try {
    b = await req.json();
  } catch {
    return json({ error: "Richiesta non valida" }, 400);
  }
  const m = /^(\d{4}-\d{2}-\d{2})_[a-z0-9]+$/.exec(String(b.id || ""));
  if (!m) return json({ error: "Prenotazione non valida" }, 400);
  if (!STATI.includes(b.status)) return json({ error: "Stato non valido" }, 400);
  const s = store(), key = `pren/${m[1]}/${b.id}`;
  for (let i = 0; i < 6; i++) {
    const cur2 = await s.getWithMetadata(key, { type: "json" });
    if (!cur2?.data) return json({ error: "Prenotazione non trovata" }, 404);
    const r = cur2.data;
    if (r.status === b.status) return json({ ok: true, item: r, unchanged: true });
    if (b.from && b.from !== r.status) return json({ error: "La prenotazione \xE8 gi\xE0 stata aggiornata da un altro dispositivo", item: r }, 409);
    const at = (/* @__PURE__ */ new Date()).toISOString(), h = { s: b.status, at, by: roleOf(req) };
    const reason = clean(b.reason, 160);
    if (reason) h.reason = reason;
    const upd = { ...r, status: b.status, updatedAt: at, history: [...r.history || [{ s: "nuova", at: r.createdAt, by: r.src === "pannello" ? "titolare" : "cliente" }], h] };
    const w = await s.setJSON(key, upd, { onlyIfMatch: cur2.etag });
    if (w.modified) return json({ ok: true, item: upd });
  }
  return json({ error: "Modificata da un altro dispositivo, riprova" }, 409);
}
var prenotazioni_default = async (req) => {
  try {
    if (req.method === "POST") return await create(req);
    const bad = await needRole(req, ["titolare", "sala"]);
    if (bad) return bad;
    if (req.method === "GET") return await list(req);
    if (req.method === "PATCH") return await update(req);
    return json({ error: "Metodo non consentito" }, 405);
  } catch (e) {
    console.error(e);
    return json({ error: "Errore del server, riprova" }, 500);
  }
};
var config = { path: "/api/prenotazioni" };
export {
  config,
  prenotazioni_default as default
};
