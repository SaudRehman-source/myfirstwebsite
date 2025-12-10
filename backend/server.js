import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Allow all origins (so GitHub Pages can access it)
app.use(
  cors({
    origin: "*",
  })
);

app.use(express.json());

// 🧪 TEMP SaudAI route: just echo back the message
app.post("/api/saudai", (req, res) => {
  const { message } = req.body || {};
  console.log("💬 SaudAI test request:", message);

  if (!message || typeof message !== "string") {
    return res.status(400).json({ reply: "I need a message string to respond to." });
  }

  // Just reply with a simple canned response for now
  res.json({
    reply: `Hi, I’m SaudAI (test mode). You said: "${message}". Once backend is stable, I’ll use OpenAI to answer properly.`,
  });
});

// Simple health check
app.get("/", (req, res) => {
  res.send("SaudAI backend is running (test mode).");
});

app.listen(PORT, () => {
  console.log(`SaudAI backend listening on port ${PORT} (test mode)`);
});
