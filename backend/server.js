require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const https = require("https");
const FormData = require("form-data");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

const upload = multer({ dest: "tmp/" });
if (!fs.existsSync("tmp")) fs.mkdirSync("tmp");

// Helper — call OpenAI Whisper API
function transcribeAudio(filePath) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", fs.createReadStream(filePath), {
      filename: "audio.webm",
      contentType: "audio/webm"
    });
    form.append("model", "whisper-1");

    const options = {
      hostname: "api.openai.com",
      path: "/v1/audio/transcriptions",
      method: "POST",
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      }
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const result = JSON.parse(data);
          resolve(result.text || "");
        } catch (e) {
          reject(new Error("Failed to parse Whisper response"));
        }
      });
    });

    req.on("error", reject);
    form.pipe(req);
  });
}

// Helper — call Claude API to fix sentence
function fixSentence(rawText) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 100,
      messages: [{
        role: "user",
        content: `You are helping someone with Down syndrome communicate clearly.
They said: "${rawText}"
Rewrite this as a clear, natural English sentence. Return ONLY the sentence, nothing else.`
      }]
    });

    const options = {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const result = JSON.parse(data);
          resolve(result.content[0].text.trim());
        } catch (e) {
          resolve(rawText);
        }
      });
    });

    req.on("error", () => resolve(rawText));
    req.write(body);
    req.end();
  });
}

// POST /transcribe
app.post("/transcribe", upload.single("audio"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No audio file received" });
  }

  const filePath = req.file.path;

  try {
    // Step 1: Transcribe with OpenAI Whisper
    const rawText = await transcribeAudio(filePath);
    console.log("Transcribed:", rawText);

    // Step 2: Fix sentence with Claude
    const corrected = await fixSentence(rawText);
    console.log("Corrected:", corrected);

    fs.unlink(filePath, () => {});

    res.json({
      raw: rawText,
      corrected: corrected,
      word_corrected: corrected
    });

  } catch (err) {
    fs.unlink(filePath, () => {});
    console.error("Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /dataset
app.get("/dataset", (req, res) => {
  const datasetPath = path.join(__dirname, "dataset.txt");
  if (!fs.existsSync(datasetPath)) return res.json([]);
  const lines = fs.readFileSync(datasetPath, "utf-8").trim().split("\n");
  const entries = lines
    .map((l) => l.split(","))
    .filter((p) => p.length === 2)
    .map(([wrong, correct]) => ({ wrong, correct }));
  res.json(entries);
});

// POST /dataset
app.post("/dataset", (req, res) => {
  const { wrong, correct } = req.body;
  if (!wrong || !correct) return res.status(400).json({ error: "Missing fields" });
  const datasetPath = path.join(__dirname, "dataset.txt");
  let lines = [];
  if (fs.existsSync(datasetPath)) {
    lines = fs.readFileSync(datasetPath, "utf-8").trim().split("\n").filter((l) => {
      const parts = l.split(",");
      return parts[0] !== wrong;
    });
  }
  lines.push(`${wrong},${correct}`);
  fs.writeFileSync(datasetPath, lines.join("\n") + "\n");
  res.json({ ok: true });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Backend running at http://localhost:${PORT}`);
});
