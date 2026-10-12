// ../../../mnt/attach/outputs/da-shaka-menu/netlify/lib/menu.mjs
import { getStore } from "@netlify/blobs";
var TZ = "Europe/Rome";
var store = () => getStore({ name: "ristorante", consistency: "strong" });
var day = (d = /* @__PURE__ */ new Date()) => d.toLocaleDateString("sv-SE", { timeZone: TZ });
var json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});
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

// ../../../mnt/attach/outputs/da-shaka-menu/netlify/functions/recensioni.mjs
var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
var clean = (s, max) => String(s ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, max);
async function vote(req) {
  let b;
  try {
    b = await req.json();
  } catch {
    return json({ error: "Richiesta non valida" }, 400);
  }
  const m = /^(\d{4}-\d{2}-\d{2})_[a-z0-9]+$/.exec(String(b.id || ""));
  if (!m) return json({ error: "Ordine non valido" }, 400);
  const stars = Number(b.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return json({ error: "Scegli da 1 a 5 stelle" }, 400);
  const s = store();
  const o = await s.get(`o/${m[1]}/${b.id}`, { type: "json" });
  if (!o || o.token !== b.t) return json({ error: "Ordine non trovato" }, 404);
  if (o.status !== "served") return json({ error: "Potrai votare quando l'ordine \xE8 stato servito" }, 409);
  const rec = {
    id: o.id,
    code: o.code,
    type: o.type || "tavolo",
    table: o.table ?? null,
    total: o.total,
    stars,
    comment: clean(b.comment, 600),
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  const w = await s.setJSON(`rev/${m[1]}/${o.id}`, rec, { onlyIfNew: true });
  if (!w.modified) return json({ error: "Hai gi\xE0 lasciato il tuo voto, grazie!" }, 409);
  return json({ ok: true }, 201);
}
async function list(req) {
  const bad = await needRole(req, ["titolare"]);
  if (bad) return bad;
  const u = new URL(req.url), today = day();
  const dal = DAY_RE.test(u.searchParams.get("dal") || "") ? u.searchParams.get("dal") : today;
  const al = DAY_RE.test(u.searchParams.get("al") || "") ? u.searchParams.get("al") : today;
  const days = [], d = /* @__PURE__ */ new Date(dal + "T12:00:00Z"), end = /* @__PURE__ */ new Date(al + "T12:00:00Z");
  while (d <= end && days.length < 92) {
    days.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  const s = store();
  const lists = await Promise.all(days.map(async (x) => {
    const { blobs } = await s.list({ prefix: `rev/${x}/` });
    return (await Promise.all(blobs.map((bl) => s.get(bl.key, { type: "json" })))).filter(Boolean);
  }));
  const reviews = lists.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const dist = [0, 0, 0, 0, 0];
  reviews.forEach((r) => dist[r.stars - 1]++);
  const avg = reviews.length ? Math.round(reviews.reduce((t, r) => t + r.stars, 0) / reviews.length * 10) / 10 : null;
  return json({ dal, al, count: reviews.length, avg, dist, reviews: reviews.slice(0, 500) });
}
var recensioni_default = async (req) => {
  try {
    if (req.method === "POST") return await vote(req);
    if (req.method === "GET") return await list(req);
    return json({ error: "Metodo non consentito" }, 405);
  } catch (e) {
    console.error(e);
    return json({ error: "Errore del server" }, 500);
  }
};
var config = { path: "/api/recensioni" };
export {
  config,
  recensioni_default as default
};
