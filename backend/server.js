import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ OpenAI client
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ✅ Allow all origins (fine for personal portfolio)
app.use(
  cors({
    origin: "*",
  })
);

app.use(express.json());

// 🧠 SaudAI system instructions
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

// 🔹 POST /api/saudai — main chat endpoint
app.post("/api/saudai", async (req, res) => {
  try {
    const { message } = req.body || {};
    console.log("💬 SaudAI request:", message);

    if (!message || typeof message !== "string") {
      return res.status(400).json({ reply: "I need a message string to respond to." });
    }

    // Call OpenAI Responses API
    const response = await client.responses.create({
      model: "gpt-5.1-mini", // you can use "gpt-5.1" if you want the bigger model
      instructions: SAUDAI_INSTRUCTIONS,
      input: [
        {
          role: "user",
          content: message,
        },
      ],
    });

    // Safely extract text (structure may vary)
    let reply = "";

    try {
      // Most common: response.output[0].content[0].text or .text.value
      const firstOutput = response.output?.[0];
      const firstContent = firstOutput?.content?.[0];

      if (firstContent?.type === "output_text") {
        reply = firstContent.text?.value || firstContent.text || "";
      } else if (typeof response.output_text === "string") {
        reply = response.output_text;
      }
    } catch (innerErr) {
      console.error("Error extracting reply:", innerErr);
    }

    if (!reply) {
      reply = "I couldn’t generate a full reply right now, but I did receive your message.";
    }

    res.json({ reply });
  } catch (err) {
    console.error("SaudAI error:", err);
    res.status(500).json({
      reply: "There was an error on the SaudAI backend. Please try again in a moment.",
    });
  }
});

// Health check
app.get("/", (req, res) => {
  res.send("SaudAI backend is running.");
});

app.listen(PORT, () => {
  console.log(`SaudAI backend listening on port ${PORT}`);
});
