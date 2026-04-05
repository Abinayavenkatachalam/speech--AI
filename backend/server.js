require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const upload = multer({ dest: "tmp/" });
if (!fs.existsSync("tmp")) fs.mkdirSync("tmp");

// POST /transcribe — sends audio directly to Python (no ffmpeg needed!)
app.post("/transcribe", upload.single("audio"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No audio file received" });
  }

  const inputPath = req.file.path;
  const scriptPath = path.join(__dirname, "correct_speech.py");

  const env = {
    ...process.env,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || ""
  };

  // No ffmpeg needed — OpenAI Whisper API accepts any audio format!
  exec(`python3 ${scriptPath} ${inputPath}`, { env }, (pyErr, stdout, stderr) => {
    fs.unlink(inputPath, () => {});

    if (pyErr) {
      console.error("Python error:", stderr);
      return res.status(500).json({ error: "Speech processing failed", detail: stderr });
    }

    try {
      const result = JSON.parse(stdout.trim());
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: "Failed to parse output", raw: stdout });
    }
  });
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
