// Zee Tv backend: access code check, TMDB proxy, Groq AI.
// Keys are read from Netlify environment variables, never put them in index.html.
//   ACCESS_CODE  = the code people type on the first screen
//   TMDB_KEY     = TMDB API key (v3 key) or "API Read Access Token" (v4)
//   GROQ_KEY     = Groq API key
// Optional: GROQ_MODEL, GROQ_VISION_MODEL

const crypto = require("crypto");
const json = (status, body) => ({
  statusCode: status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const same = (a, b) => {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const { ACCESS_CODE, TMDB_KEY, GROQ_KEY } = process.env;
  if (!ACCESS_CODE) return json(500, { error: "ACCESS_CODE not set" });

  const code = event.headers["x-code"] || event.headers["X-Code"] || "";
  if (!same(code, ACCESS_CODE)) return json(401, { error: "bad code" });

  let b;
  try { b = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "bad json" }); }

  try {
    if (b.type === "check") return json(200, { ok: true });

    if (b.type === "tmdb") {
      if (!TMDB_KEY) return json(500, { error: "TMDB_KEY not set" });
      const path = String(b.path || "");
      if (!/^\/[a-zA-Z0-9_\/]+$/.test(path)) return json(400, { error: "bad path" });
      const u = new URL("https://api.themoviedb.org/3" + path);
      for (const [k, v] of Object.entries(b.params || {}))
        if (v !== "" && v != null) u.searchParams.set(k, v);
      const headers = {};
      if (TMDB_KEY.length > 60) headers.Authorization = "Bearer " + TMDB_KEY;
      else u.searchParams.set("api_key", TMDB_KEY);
      const r = await fetch(u, { headers });
      return { statusCode: r.status, headers: { "content-type": "application/json" }, body: await r.text() };
    }

    if (b.type === "ai") {
      if (!GROQ_KEY) return json(500, { error: "GROQ_KEY not set" });
      let messages = Array.isArray(b.messages) ? b.messages.slice(-30) : [];
      let model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
      if (b.vision) { // image scan: vision is a data URL
        model = process.env.GROQ_VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct";
        const last = messages.pop() || { role: "user", content: "Which movie or series is this?" };
        messages.push({ role: "user", content: [
          { type: "text", text: String(last.content) },
          { type: "image_url", image_url: { url: b.vision } },
        ]});
      }
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: "Bearer " + GROQ_KEY },
        body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 1200 }),
      });
      return { statusCode: r.status, headers: { "content-type": "application/json" }, body: await r.text() };
    }

    return json(400, { error: "unknown type" });
  } catch (e) {
    return json(500, { error: "server error" });
  }
};
