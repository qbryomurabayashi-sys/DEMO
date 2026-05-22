import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const upload = multer({ storage: multer.memoryStorage() });

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // App health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Fast transcription endpoint via Gemini 1.5 Flash
  app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No audio file uploaded" });
      }

      // We use base64 in-memory buffer directly
      const base64Audio = req.file.buffer.toString("base64");
      const mimeType = req.file.mimetype || "audio/webm";

      const prompt = "Please transcribe the Japanese speech in this audio perfectly. Reply ONLY with the transcription text. If there is no speech, reply with an empty string. Do not include markdown formatting or quotes.";
      
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          prompt,
          {
            inlineData: {
              data: base64Audio,
              mimeType: mimeType
            }
          }
        ],
        config: {
            temperature: 0.2
        }
      });

      res.json({ text: response.text || "" });
    } catch (e) {
      console.error("Transcription error:", e);
      res.status(500).json({ error: e.message || "Failed to transcribe" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(console.error);
