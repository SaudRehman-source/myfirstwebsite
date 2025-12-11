// server.js (replace your file with this)
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

let fetchImpl = global.fetch;
async function ensureFetch() {
  if (fetchImpl) return fetchImpl;
  const mod = await import("node-fetch");
  fetchImpl = mod.default;
  return fetchImpl;
}

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors({ origin: "*" }));
app.use(express.json());

const SAUDAI_INSTRUCTIONS = `You are SaudAI, an AI version of Saud Rehman. Speak in the first person as "I"...`;

// Streaming call (keeps existing behavior)
async function callDeepSeekStream({ model = "deepseek-r1:1.5b", messages = [], timeoutMs = 60000, genOptions = {} } = {}) {
  const fetch = await ensureFetch();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const payload = { model, messages, stream: true, ...genOptions };

  try {
    const resp = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      clearTimeout(timeout);
      throw new Error(`Ollama non-OK ${resp.status}: ${txt.slice(0, 400)}`);
    }

    if (!resp.body) { clearTimeout(timeout); return ""; }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let finalText = "";
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        try {
          const j = JSON.parse(t);
          if (j?.message?.content && typeof j.message.content === "string") finalText += j.message.content;
        } catch (e) {
          // ignore
        }
      }
    }
    if (buffer.trim()) {
      try {
        const j = JSON.parse(buffer.trim());
        if (j?.message?.content) finalText += j.message.content;
      } catch {}
    }

    clearTimeout(timeout);
    return finalText.trim();
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// Non-streaming sync call (useful debug/fallback)
async function callDeepSeekSync({ model = "deepseek-r1:1.5b", messages = [], timeoutMs = 60000, genOptions = {} } = {}) {
  const fetch = await ensureFetch();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  // don't request stream — ask for a single JSON response
  const payload = { model, messages, ...genOptions };

  try {
    const resp = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const text = await resp.text().catch(() => "");
    // try parse JSON
    try {
      const json = JSON.parse(text);
      // common shapes
      if (typeof json?.message?.content === "string") return json.message.content;
      if (typeof json?.output_text === "string") return json.output_text;
      if (json?.output?.[0]?.content?.[0]?.text) return json.output[0].content[0].text;
      // fallback to whole text
      return text;
    } catch (parseErr) {
      // not JSON — return raw
      return text;
    }
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

app.post("/api/saudai", async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message) return res.status(400).json({ reply: "I need a message string." });

    const messages = [{ role: "system", content: SAUDAI_INSTRUCTIONS }, { role: "user", content: message }];

    const model = process.env.SAUDAI_MODEL || "deepseek-r1:1.5b";
    const timeoutMs = Number(process.env.SAUDAI_TIMEOUT_MS) || 60000;
    const genOptions = { temperature: Number(process.env.SAUDAI_TEMPERATURE) || 0.2, max_new_tokens: Number(process.env.SAUDAI_MAX_TOKENS) || 200 };

    const reply = await callDeepSeekStream({ model, messages, timeoutMs, genOptions });
    if (!reply) return res.json({ reply: "No reply (empty)." });
    return res.json({ reply });
  } catch (err) {
    console.error("STREAM ERROR:", err?.name || err, err?.message || "");
    if (err.name === "AbortError") return res.status(504).json({ reply: "Request timed out waiting for model (stream)." });
    return res.status(500).json({ reply: "Stream error. See server logs." });
  }
});

app.post("/api/saudai_sync", async (req, res) => {
  // Non-streaming fallback for debugging/compat
  try {
    const { message } = req.body || {};
    if (!message) return res.status(400).json({ reply: "I need a message string." });

    const messages = [{ role: "system", content: SAUDAI_INSTRUCTIONS }, { role: "user", content: message }];

    const model = process.env.SAUDAI_MODEL || "deepseek-r1:1.5b";
    const timeoutMs = Number(process.env.SAUDAI_TIMEOUT_MS) || 120000;
    const genOptions = { temperature: Number(process.env.SAUDAI_TEMPERATURE) || 0.2, max_new_tokens: Number(process.env.SAUDAI_MAX_TOKENS) || 100 };

    const reply = await callDeepSeekSync({ model, messages, timeoutMs, genOptions });
    return res.json({ reply });
  } catch (err) {
    console.error("SYNC ERROR:", err?.name || err, err?.message || "");
    if (err.name === "AbortError") return res.status(504).json({ reply: "Request timed out waiting for model (sync)." });
    return res.status(500).json({ reply: `Sync error: ${err?.message || err}` });
  }
});

app.get("/", (req, res) => res.send("SaudAI (DeepSeek) backend is running."));
app.listen(PORT, () => {
  console.log(`SaudAI backend listening on ${PORT}`);
  console.log("Model:", process.env.SAUDAI_MODEL || "deepseek-r1:1.5b");
  console.log("Timeout (ms):", process.env.SAUDAI_TIMEOUT_MS || 60000);
});
