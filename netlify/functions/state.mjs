import { getStore } from "@netlify/blobs";

const EMPTY = { v: 0, results: {}, settings: {} };
const KEY = "state";

// Union merge: keep, per student per day, the record with the latest completedAt.
function mergeStates(a, b) {
  a = a || EMPTY;
  b = b || EMPTY;
  const out = {
    results: {},
    settings: Object.assign({}, a.settings || {}, b.settings || {}),
    v: Math.max(a.v || 0, b.v || 0),
  };
  for (const st of [a, b]) {
    const res = st.results || {};
    for (const sid of Object.keys(res)) {
      out.results[sid] = out.results[sid] || {};
      const days = res[sid] || {};
      for (const did of Object.keys(days)) {
        const rec = days[did];
        const ex = out.results[sid][did];
        if (!ex || ((rec && rec.completedAt) || 0) > (ex.completedAt || 0)) {
          out.results[sid][did] = rec;
        }
      }
    }
  }
  return out;
}

export default async (req) => {
  const store = getStore("navtsentr");

  if (req.method === "GET") {
    const data = (await store.get(KEY, { type: "json" })) || EMPTY;
    return Response.json(data);
  }

  if (req.method === "POST") {
    let incoming = {};
    try {
      incoming = await req.json();
    } catch (_) {
      incoming = {};
    }
    // Compare-and-set with retry so simultaneous writes from different devices never lose data.
    for (let attempt = 0; attempt < 5; attempt++) {
      const cur = await store.getWithMetadata(KEY, { type: "json" });
      const base = (cur && cur.data) || EMPTY;
      const etag = cur && cur.etag;
      const merged = mergeStates(base, incoming);
      merged.v = Date.now();
      try {
        const opts = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
        const res = await store.setJSON(KEY, merged, opts);
        if (res && res.modified === false) continue; // someone wrote first — retry
        return Response.json(merged);
      } catch (_) {
        // fall through to retry
      }
    }
    // Last resort: unconditional merge-and-write.
    const latest = (await store.get(KEY, { type: "json" })) || EMPTY;
    const m2 = mergeStates(latest, incoming);
    m2.v = Date.now();
    await store.setJSON(KEY, m2);
    return Response.json(m2);
  }

  return new Response("Method not allowed", { status: 405 });
};
