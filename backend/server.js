// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

// Use global fetch on Node >= 18, otherwise try node-fetch
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
 * callDeepSeek - streams Ollama (DeepSeek) response and concatenates final content.
 * - model: e.g. deepseek-r1:1.5b or deepseek-r1:8b
 * - timeoutMs: how long to wait before abort (default 60s)
 * - genOptions: max_new_tokens, temperature, etc.
 */
async function callDeepSeek({ model = "deepseek-r1:1.5b", messages = [], timeoutMs = 60000, genOptions = {} } = {}) {
  const fetch = await ensureFetch();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  // include stream: true so Ollama returns line-delimited JSON chunks
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

    // non-stream fallback: if server returns a single JSON object, read it as text and try parse
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      clearTimeout(timeout);
      throw new Error(`Ollama responded with status ${resp.status}: ${txt.slice(0, 400)}`);
    }

    // If body is null (shouldn't be), return empty
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

      // Ollama tends to send JSON objects separated by newlines.
      // Process complete lines; keep remainder in buffer.
      const lines = buffer.split("\n");
      buffer = lines.pop(); // remainder

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Sometimes non-json garbage may appear — guard parse
        try {
          const j = JSON.parse(trimmed);

          // If object contains message.content (the generated text), append it
          if (j?.message?.content && typeof j.message.content === "string") {
            finalText += j.message.content;
          }

          // Some streams include partial tokens in .message.thinking — ignore them
          // Optionally, you could append thinking chunks if you want progressive output

          // If final done flag set, we can optionally break early.
          if (j.done === true) {
            // continue to drain the reader until done === true and then exit loop
          }
        } catch (err) {
          // Not JSON — ignore (may be partial chunk)
          // console.debug("Non-JSON chunk skipped:", trimmed.slice(0, 200));
        }
      }
    }

    // If any leftover buffer contains a final JSON object, try parse it
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
    // Re-throw so caller can distinguish AbortError (timeout) vs others
    throw err;
  }
}

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

    // prefer smaller model by default for responsiveness; use 8b if you set env
    const reply = await callDeepSeek({ model: modelName, messages, timeoutMs, genOptions });

    if (!reply || reply.trim().length === 0) {
      return res.json({ reply: "I couldn’t generate a response right now. Try again or increase timeout." });
    }

    return res.json({ reply });
  } catch (err) {
    console.error("SaudAI error:", err?.name || err, err?.message || "");
    if (err.name === "AbortError") {
      return res.status(504).json({ reply: "Request timed out waiting for model. Try again or increase timeout." });
    }
    return res.status(500).json({ reply: "There was an error talking to the model. See server logs." });
  }
});

app.get("/", (req, res) => res.send("SaudAI (DeepSeek) backend is running."));

app.listen(PORT, () => {
  console.log(`SaudAI backend (DeepSeek) listening on port ${PORT}`);
  console.log("Model:", process.env.SAUDAI_MODEL || "deepseek-r1:1.5b");
  console.log("Timeout (ms):", process.env.SAUDAI_TIMEOUT_MS || 60000);
});
