// ../../../mnt/attach/outputs/da-shaka-menu/netlify/lib/menu.mjs
import { getStore } from "@netlify/blobs";
var store = () => getStore({ name: "ristorante", consistency: "strong" });
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

// ../../../mnt/attach/outputs/da-shaka-menu/netlify/functions/foto.mjs
var TYPES = ["image/webp", "image/jpeg", "image/png"];
var foto_default = async (req) => {
  const url = new URL(req.url);
  const id = String(url.searchParams.get("id") || "").toUpperCase();
  if (!/^([A-Z]{1,2}\d{2,3}|COPERTINA|LOGO|AVATAR)$/.test(id)) return json({ error: "Codice non valido" }, 400);
  const s = store();
  if (req.method === "GET") {
    const r = await s.getWithMetadata(`img/${id}`, { type: "arrayBuffer" });
    if (!r) return new Response("Foto non trovata", { status: 404 });
    return new Response(r.data, {
      headers: { "Content-Type": r.metadata?.type || "image/webp", "Cache-Control": "public, max-age=31536000, immutable" }
    });
  }
  if (req.method === "POST") {
    const bad = await needRole(req, ["titolare"]);
    if (bad) return bad;
    const type = (req.headers.get("content-type") || "").split(";")[0];
    if (!TYPES.includes(type)) return json({ error: "Formato non supportato (usa JPG, PNG o WebP)" }, 400);
    const buf = await req.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > 600 * 1024) return json({ error: "Foto troppo grande (massimo 600 KB)" }, 413);
    await s.set(`img/${id}`, buf, { metadata: { type } });
    return json({ url: `/api/foto?id=${id}&v=${Date.now()}` });
  }
  return json({ error: "Metodo non consentito" }, 405);
};
var config = { path: "/api/foto" };
export {
  config,
  foto_default as default
};
