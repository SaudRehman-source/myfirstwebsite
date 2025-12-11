import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch"; // important for calling Ollama API

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Allow frontend access
app.use(
  cors({
    origin: "*",
  })
);

app.use(express.json());

// SaudAI system prompt
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

// 🧠 DeepSeek via Ollama API
app.post("/api/saudai", async (req, res) => {
  try {
    const { message } = req.body || {};
    console.log("💬 SaudAI request:", message);

    if (!message || typeof message !== "string") {
      return res.status(400).json({ reply: "I need a message string to respond to." });
    }

    // 🔻 Send to DeepSeek (running locally in Ollama)
    const ollamaResponse = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-r1:8b", // << YOUR MODEL HERE
        messages: [
          { role: "system", content: SAUDAI_INSTRUCTIONS },
          { role: "user", content: message },
        ],
      }),
    });

    const data = await ollamaResponse.json();

    // DeepSeek's response format typically returns:
    // data.message.content
    const reply = data?.message?.content || "I couldn't generate a response right now.";

    res.json({ reply });
  } catch (err) {
    console.error("SaudAI DeepSeek error:", err);
    res.status(500).json({
      reply: "There was an error talking to the DeepSeek model. Make sure Ollama is running.",
    });
  }
});

// Health check
app.get("/", (req, res) => {
  res.send("SaudAI (DeepSeek) backend is running.");
});

app.listen(PORT, () => {
  console.log(`SaudAI backend (DeepSeek) listening on port ${PORT}`);
});
