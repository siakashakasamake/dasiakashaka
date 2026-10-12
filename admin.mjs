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

// ../../../mnt/attach/outputs/da-shaka-menu/netlify/functions/admin.mjs
var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
var hourOf = (iso) => Number(new Date(iso).toLocaleString("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false })) % 24;
function daysBetween(dal, al) {
  const out = [];
  const d = /* @__PURE__ */ new Date(dal + "T12:00:00Z"), end = /* @__PURE__ */ new Date(al + "T12:00:00Z");
  while (d <= end && out.length < 92) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
function stats(orders, days) {
  const valid = orders.filter((o) => o.status !== "cancelled");
  const revenue = valid.reduce((s, o) => s + o.total, 0);
  const byHour = Array.from({ length: 24 }, (_, h) => ({ h, orders: 0, revenue: 0 }));
  const byDay = Object.fromEntries(days.map((d) => [d, { date: d, orders: 0, revenue: 0 }]));
  const prod = {}, cat = {}, tab = {};
  let itemsSold = 0, prepSum = 0, prepN = 0;
  const takeaway = { orders: 0, revenue: 0 };
  for (const o of valid) {
    const h = byHour[hourOf(o.createdAt)];
    h.orders++;
    h.revenue += o.total;
    const d = byDay[day(new Date(o.createdAt))];
    if (d) {
      d.orders++;
      d.revenue += o.total;
    }
    const tk = o.type === "asporto" ? "asporto" : o.table;
    const t = tab[tk] ||= { table: tk, orders: 0, revenue: 0 };
    t.orders++;
    t.revenue += o.total;
    if (o.type === "asporto") {
      takeaway.orders++;
      takeaway.revenue += o.total;
    }
    if (o.prepMin != null && o.prepMin >= 0 && o.prepMin < 240) {
      prepSum += o.prepMin;
      prepN++;
    }
    for (const i of o.items) {
      itemsSold += i.qty;
      const p = prod[i.id + "|" + i.name] ||= { id: i.id, name: i.name, qty: 0, revenue: 0 };
      p.qty += i.qty;
      p.revenue += i.qty * i.price;
      const c = cat[i.cat || "Altro"] ||= { cat: i.cat || "Altro", qty: 0, revenue: 0 };
      c.qty += i.qty;
      c.revenue += i.qty * i.price;
    }
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  return {
    orders: valid.length,
    cancelled: orders.length - valid.length,
    revenue: r2(revenue),
    avgTicket: valid.length ? r2(revenue / valid.length) : 0,
    itemsSold,
    takeaway: { orders: takeaway.orders, revenue: r2(takeaway.revenue) },
    avgPrepMin: prepN ? Math.round(prepSum / prepN) : null,
    byHour: byHour.map((x) => ({ ...x, revenue: r2(x.revenue) })),
    byDay: Object.values(byDay).map((x) => ({ ...x, revenue: r2(x.revenue) })),
    topProducts: Object.values(prod).sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, 15).map((x) => ({ ...x, revenue: r2(x.revenue) })),
    byCategory: Object.values(cat).sort((a, b) => b.revenue - a.revenue).map((x) => ({ ...x, revenue: r2(x.revenue) })),
    byTable: Object.values(tab).sort((a, b) => b.revenue - a.revenue).map((x) => ({ ...x, revenue: r2(x.revenue) }))
  };
}
async function bookingStats(s, days) {
  const out = { richieste: 0, dalPannello: 0, confermate: 0, rifiutate: 0, annullate: 0, completate: 0, noshow: 0, inAttesa: 0, coperti: 0 };
  for (const d of days) {
    const { blobs } = await s.list({ prefix: `pren/${d}/` });
    const list = (await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })))).filter(Boolean);
    for (const r of list) {
      if (r.src === "pannello") out.dalPannello++;
      else out.richieste++;
      const confirmed = (r.history || []).some((h) => h.s === "confermata") || ["confermata", "arrivata", "noshow"].includes(r.status);
      if (confirmed && r.src !== "pannello") out.confermate++;
      if (r.status === "rifiutata") out.rifiutate++;
      if (r.status === "annullata") out.annullate++;
      if (r.status === "arrivata") {
        out.completate++;
        out.coperti += r.ppl;
      }
      if (r.status === "noshow") out.noshow++;
      if (r.status === "nuova") out.inAttesa++;
    }
  }
  return out;
}
var admin_default = async (req) => {
  const url = new URL(req.url);
  const azione = url.searchParams.get("azione");
  const bad = await needRole(req, azione === "stats" ? ["titolare"] : ["titolare", "sala"]);
  if (bad) return bad;
  if (azione === "verifica") return json({ ok: true, role: roleOf(req) });
  const today = day(), yesterday = day(new Date(Date.now() - 864e5));
  const dal = DAY_RE.test(url.searchParams.get("dal") || "") ? url.searchParams.get("dal") : today;
  const al = DAY_RE.test(url.searchParams.get("al") || "") ? url.searchParams.get("al") : today;
  if (dal > al) return json({ error: "Intervallo di date non valido" }, 400);
  const days = daysBetween(dal, al < today ? al : today);
  try {
    const s = store();
    const orders = (await Promise.all(days.map((d) => ordersOfDay(s, d, today, yesterday)))).flat();
    if (azione === "stats") return json({ dal, al, ...stats(orders, days), bookings: await bookingStats(s, daysBetween(dal, al)) });
    if (azione === "ordini") {
      orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return json({ dal, al, orders: orders.slice(0, 3e3) });
    }
    return json({ error: "Azione sconosciuta" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "Errore del server, riprova" }, 500);
  }
};
var config = { path: "/api/admin" };
export {
  config,
  admin_default as default
};
