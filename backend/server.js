// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

let fetchImpl = global.fetch;
try {
  // If running Node < 18 and you installed node-fetch v2
  if (!fetchImpl) fetchImpl = (await import("node-fetch")).default;
} catch (e) {
  // ignore - global fetch exists on Node >= 18
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

app.post("/api/saudai", async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ reply: "I need a message string to respond to." });
    }

    const resp = await fetchImpl("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-r1:8b",
        messages: [
          { role: "system", content: SAUDAI_INSTRUCTIONS },
          { role: "user", content: message }
        ]
      })
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("Ollama error:", resp.status, text);
      return res.status(502).json({ reply: "Model server error: " + resp.status });
    }

    const data = await resp.json();
    // Ollama returns data.message.content (string). Fallback if different.
    const reply = data?.message?.content ?? data?.output?.[0]?.content?.[0]?.text ?? JSON.stringify(data);
    res.json({ reply });
  } catch (err) {
    console.error("SaudAI DeepSeek error:", err);
    res.status(500).json({
      reply: "There was an error talking to the DeepSeek model. Make sure Ollama is running."
    });
  }
});

app.get("/", (req, res) => res.send("SaudAI (DeepSeek) backend is running."));

app.listen(PORT, () => {
  console.log(`SaudAI backend (DeepSeek) listening on port ${PORT}`);
});
