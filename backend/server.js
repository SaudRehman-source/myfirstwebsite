// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

// Use global fetch on Node >= 18, otherwise dynamic import node-fetch
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

const SAUDAI_INSTRUCTIONS = `
You are SaudAI, an AI version of Saud Rehman.

Speak in the first person as "I", as if you are Saud.
Tone: friendly, professional, honest, slightly informal when appropriate.

Background you MUST use:
- Technical Marketing Manager at NASTP (aerospace & defence ecosystem).
- Experience in renewable energy, C&I solar, IoT & AI products.
- Past roles: SkyElectric, Renergy Solutions, Rapidev, Spacedome.
- Education: MEng Renewable Electrical Engineering, BE Electrical & Electronics (COMSATS).
- Final year project: wind speed forecasting using Bi-LSTM and Bi-GRU.

Guidelines:
- Be clear and concise.
- If you don't know something from Saud's real experience, say that you would "need to check" rather than inventing.
- When asked for advice (career, learning, tools), give practical, step-by-step suggestions.
`;

/**
 * callDeepSeekStream - stream-consume NDJSON response from Ollama/DeepSeek
 * Returns concatenated message.content fragments (ignores thinking fragments).
 */
async function callDeepSeekStream({ model = "deepseek-r1:1.5b", messages = [], timeoutMs = 60000, genOptions = {} } = {}) {
  const fetch = await ensureFetch();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const payload = {
    model,
    messages,
    stream: true,
    ...genOptions,
  };

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
      throw new Error(`Ollama responded with status ${resp.status}: ${txt.slice(0, 400)}`);
    }

    if (!resp.body) {
      clearTimeout(timeout);
      return "";
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let finalText = "";
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      // Split into lines and keep remainder in buffer
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const j = JSON.parse(trimmed);
          if (j?.message?.content && typeof j.message.content === "string") {
            finalText += j.message.content;
          }
          // ignore j.message.thinking (partial tokens) to avoid duplicates
        } catch (err) {
          // skip non-json chunks
        }
      }
    }

    // Try parse leftover buffer
    const leftover = buffer.trim();
    if (leftover) {
      try {
        const j = JSON.parse(leftover);
        if (j?.message?.content && typeof j.message.content === "string") {
          finalText += j.message.content;
        }
      } catch (_) {
        // ignore
      }
    }

    clearTimeout(timeout);
    return finalText.trim();
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

/**
 * callDeepSeekSync - non-streaming / NDJSON-aware sync call
 * Ollama may still return NDJSON even when not requested; this handles it.
 */
async function callDeepSeekSync({ model = "deepseek-r1:1.5b", messages = [], timeoutMs = 60000, genOptions = {} } = {}) {
  const fetch = await ensureFetch();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const payload = { model, messages, ...genOptions };

  try {
    const resp = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const contentType = (resp.headers && resp.headers.get ? resp.headers.get("content-type") : "") || "";
    const text = await resp.text().catch(() => "");

    // If server returned NDJSON / chunked objects, parse line-by-line
    if (contentType.includes("ndjson") || text.includes("\n{")) {
      let finalText = "";
      const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        try {
          const j = JSON.parse(line);
          if (j?.message?.content && typeof j.message.content === "string") {
            finalText += j.message.content;
          }
        } catch (err) {
          // ignore non-JSON lines
        }
      }
      return finalText.trim();
    }

    // Otherwise try to parse single JSON object shapes
    try {
      const json = JSON.parse(text);
      if (typeof json?.message?.content === "string") return json.message.content;
      if (typeof json?.output_text === "string") return json.output_text;
      if (json?.output?.[0]?.content?.[0]?.text) return json.output[0].content[0].text;
      if (json?.choices?.[0]?.message?.content) return json.choices[0].message.content;
      // fallback to whole text
      return text;
    } catch (parseErr) {
      // not JSON — return raw text
      return text;
    }
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

/**
 * API routes
 */

// Streaming-safe endpoint (preferred)
app.post("/api/saudai", async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ reply: "I need a message string to respond to." });
    }

    const messages = [
      { role: "system", content: SAUDAI_INSTRUCTIONS },
      { role: "user", content: message },
    ];

    const modelName = process.env.SAUDAI_MODEL || "deepseek-r1:1.5b";
    const timeoutMs = Number(process.env.SAUDAI_TIMEOUT_MS) || 60000;
    const genOptions = {
      temperature: Number(process.env.SAUDAI_TEMPERATURE) || 0.2,
      max_new_tokens: Number(process.env.SAUDAI_MAX_TOKENS) || 300,
    };

    const reply = await callDeepSeekStream({ model: modelName, messages, timeoutMs, genOptions });

    if (!reply || reply.trim().length === 0) {
      return res.json({ reply: "I couldn’t generate a response right now. Try again or increase timeout." });
    }

    return res.json({ reply });
  } catch (err) {
    console.error("SaudAI (stream) error:", err?.name || err, err?.message || "");
    if (err?.name === "AbortError") {
      return res.status(504).json({ reply: "Request timed out waiting for model (stream). Try increasing SAUDAI_TIMEOUT_MS." });
    }
    return res.status(500).json({ reply: "There was an error talking to the model (stream). See server logs." });
  }
});

// NDJSON-aware synchronous fallback (good for debugging)
app.post("/api/saudai_sync", async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ reply: "I need a message string to respond to." });
    }

    const messages = [
      { role: "system", content: SAUDAI_INSTRUCTIONS },
      { role: "user", content: message },
    ];

    const modelName = process.env.SAUDAI_MODEL || "deepseek-r1:1.5b";
    const timeoutMs = Number(process.env.SAUDAI_TIMEOUT_MS) || 120000;
    const genOptions = {
      temperature: Number(process.env.SAUDAI_TEMPERATURE) || 0.2,
      max_new_tokens: Number(process.env.SAUDAI_MAX_TOKENS) || 150,
    };

    const reply = await callDeepSeekSync({ model: modelName, messages, timeoutMs, genOptions });

    return res.json({ reply });
  } catch (err) {
    console.error("SaudAI (sync) error:", err?.name || err, err?.message || "");
    if (err?.name === "AbortError") {
      return res.status(504).json({ reply: "Request timed out waiting for model (sync). Try increasing SAUDAI_TIMEOUT_MS." });
    }
    return res.status(500).json({ reply: `There was an error (sync). See server logs.` });
  }
});

app.get("/", (req, res) => res.send("SaudAI (DeepSeek) backend is running."));

app.listen(PORT, () => {
  console.log(`SaudAI backend (DeepSeek) listening on port ${PORT}`);
  console.log("Model:", process.env.SAUDAI_MODEL || "deepseek-r1:1.5b");
  console.log("Timeout (ms):", process.env.SAUDAI_TIMEOUT_MS || 60000);
});
