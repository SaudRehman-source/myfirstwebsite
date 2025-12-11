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
 * Helper: POST to Ollama with timeout and good defaults
 * - timeoutMs: how long to wait before aborting (default 60s)
 * - model: deepseek-r1:8b or smaller
 * - genOptions: e.g. max_new_tokens, temperature, stop, etc.
 */
async function callOllamaChat({ model = "deepseek-r1:8b", messages = [], timeoutMs = 60000, genOptions = {} } = {}) {
  const fetch = await ensureFetch();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  // Provide some generation params (reduce reply size to speed things up)
  const payload = {
    model,
    messages,
    // Typical Ollama accepts `max_tokens`/`max_new_tokens` or similar;
    // include common options but you can tune them.
    // If your model ignores some fields, it won't hurt.
    ...genOptions,
  };

  try {
    const resp = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const txt = await resp.text().catch(() => null);

    // If response JSON, try parse. If not, return text fallback.
    let data = null;
    try {
      data = txt ? JSON.parse(txt) : null;
    } catch (parseErr) {
      // Not JSON — return raw text
      return { ok: resp.ok, rawText: txt, parsed: null, status: resp.status };
    }

    return { ok: resp.ok, parsed: data, rawText: txt, status: resp.status };
  } catch (err) {
    clearTimeout(timeout);
    // Propagate abort so caller can detect timeout
    throw err;
  }
}

app.post("/api/saudai", async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ reply: "I need a message string to respond to." });
    }

    // build messages array for Ollama
    const messages = [
      { role: "system", content: SAUDAI_INSTRUCTIONS },
      { role: "user", content: message },
    ];

    // Choose model and generation options:
    // - If you find deepseek-r1:8b is slow, switch to deepseek-r1:1.5b
    const modelName = process.env.SAUDAI_MODEL || "deepseek-r1:8b";
    const timeoutMs = Number(process.env.SAUDAI_TIMEOUT_MS) || 60000; // default 60s

    // sensible generation options to limit length & speed
    const genOptions = {
      temperature: 0.2,
      // limit response size. Reduce if responses are slow.
      max_new_tokens: Number(process.env.SAUDAI_MAX_TOKENS) || 300,
    };

    // Call Ollama
    const result = await callOllamaChat({ model: modelName, messages, timeoutMs, genOptions });

    if (!result.ok) {
      console.error("Ollama responded with non-OK:", result.status, result.rawText?.slice(0, 400));
      return res.status(502).json({ reply: `Model server error (${result.status}).` });
    }

    // Attempt to extract reply text from common shapes:
    // - data.message.content (string)
    // - data.output[0].content[0].text or .text.value
    // - fallback: rawText (plain)
    const data = result.parsed;

    let reply = null;

    if (data) {
      // Ollama sometimes returns: { message: { role, content: "..." } }
      if (typeof data?.message?.content === "string") {
        reply = data.message.content;
      }
      // Another possible shape: response.output[0].content[0].text or .text.value
      else if (Array.isArray(data.output) && data.output[0]?.content) {
        const c = data.output[0].content[0];
        if (c?.type === "output_text" && (c.text?.value || c.text)) {
          reply = c.text?.value || c.text || null;
        } else if (typeof c === "string") {
          reply = c;
        }
      }
      // Some Ollama responses put generated text in data.output_text
      else if (typeof data.output_text === "string") {
        reply = data.output_text;
      }
      // Some models return `data.choices[0].message.content` (OpenAI-like)
      else if (data.choices?.[0]?.message?.content) {
        reply = data.choices[0].message.content;
      }
    }

    // fallback to rawText if parsing failed but we have text
    if (!reply && result.rawText) {
      // If rawText looks like JSON lines / stream, show first 200 chars
      reply = result.rawText;
    }

    if (!reply) {
      reply = "I couldn’t generate a response right now. Check model logs or increase timeout.";
    }

    res.json({ reply });
  } catch (err) {
    console.error("SaudAI error:", err?.name || err, err?.message || "");
    if (err.name === "AbortError") {
      return res.status(504).json({ reply: "Request timed out waiting for model. Try again or increase timeout." });
    }
    res.status(500).json({ reply: "There was an error talking to the model. See server logs." });
  }
});

app.get("/", (req, res) => res.send("SaudAI (DeepSeek) backend is running."));

app.listen(PORT, () => {
  console.log(`SaudAI backend (DeepSeek) listening on port ${PORT}`);
  console.log("Model:", process.env.SAUDAI_MODEL || "deepseek-r1:8b");
  console.log("Timeout (ms):", process.env.SAUDAI_TIMEOUT_MS || 60000);
});
