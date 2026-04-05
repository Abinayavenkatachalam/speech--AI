require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// POST /fix — fix sentence using Claude
app.post("/fix", (req, res) => {
  const { text } = req.body;
  if (!text) return res.json({ corrected: "" });

  const body = JSON.stringify({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 100,
    messages: [{
      role: "user",
      content: `You are helping someone with Down syndrome communicate clearly.
They said: "${text}"
Rewrite this as a clear, natural English sentence. Keep meaning same. Return ONLY the sentence.`
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

  const apiReq = https.request(options, (apiRes) => {
    let data = "";
    apiRes.on("data", (chunk) => (data += chunk));
    apiRes.on("end", () => {
      try {
        const result = JSON.parse(data);
        const corrected = result.content[0].text.trim();
        res.json({ corrected });
      } catch (e) {
        res.json({ corrected: text });
      }
    });
  });

  apiReq.on("error", () => res.json({ corrected: text }));
  apiReq.write(body);
  apiReq.end();
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
