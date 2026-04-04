import { useState, useRef, useEffect } from "react";
import "./App.css";

const API = "http://localhost:5000";

const EMOJIS = ["🌟", "💬", "🎉", "👏", "🌈"];

export default function App() {
  const [phase, setPhase] = useState("idle"); // idle | recording | processing | done | error
  const [raw, setRaw] = useState("");
  const [corrected, setCorrected] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [history, setHistory] = useState([]);
  const [tab, setTab] = useState("speak"); // speak | teach
  const [teachWrong, setTeachWrong] = useState("");
  const [teachCorrect, setTeachCorrect] = useState("");
  const [teachStatus, setTeachStatus] = useState("");
  const [emoji, setEmoji] = useState("🌟");

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  const speak = (text) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    utterance.pitch = 1.1;
    window.speechSynthesis.speak(utterance);
  };

  const startRecording = async () => {
    setPhase("recording");
    setRaw("");
    setCorrected("");
    setEmoji(EMOJIS[Math.floor(Math.random() * EMOJIS.length)]);
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        await sendAudio(blob);
      };

      mr.start();
    } catch (e) {
      setErrorMsg("Microphone access denied. Please allow mic access.");
      setPhase("error");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && phase === "recording") {
      mediaRecorderRef.current.stop();
      setPhase("processing");
    }
  };

  const sendAudio = async (blob) => {
    const formData = new FormData();
    formData.append("audio", blob, "recording.webm");

    try {
      const res = await fetch(`${API}/transcribe`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setRaw(data.raw);
      setCorrected(data.corrected);
      setHistory((h) => [
        { raw: data.raw, corrected: data.corrected, time: new Date().toLocaleTimeString() },
        ...h.slice(0, 9),
      ]);
      setPhase("done");
      speak(data.corrected);
    } catch (e) {
      setErrorMsg(e.message || "Something went wrong.");
      setPhase("error");
    }
  };

  const handleTeach = async () => {
    if (!teachWrong.trim() || !teachCorrect.trim()) {
      setTeachStatus("Please fill both fields!");
      return;
    }
    try {
      const res = await fetch(`${API}/dataset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wrong: teachWrong.trim().toLowerCase(), correct: teachCorrect.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (data.ok) {
        setTeachStatus("✅ Saved! I'll remember that.");
        setTeachWrong("");
        setTeachCorrect("");
      }
    } catch (e) {
      setTeachStatus("❌ Could not save. Is the server running?");
    }
  };

  const reset = () => {
    setPhase("idle");
    setRaw("");
    setCorrected("");
    setErrorMsg("");
  };

  return (
    <div className="app">
      {/* Decorative blobs */}
      <div className="blob blob1" />
      <div className="blob blob2" />
      <div className="blob blob3" />

      <header className="header">
        <div className="logo">
          <span className="logo-icon">🗣️</span>
          <div>
            <h1>ClearVoice</h1>
            <p>Your words, clearly heard</p>
          </div>
        </div>
        <nav className="tabs">
          <button className={tab === "speak" ? "tab active" : "tab"} onClick={() => setTab("speak")}>
            🎤 Speak
          </button>
          <button className={tab === "teach" ? "tab active" : "tab"} onClick={() => setTab("teach")}>
            📚 Teach
          </button>
          <button className={tab === "history" ? "tab active" : "tab"} onClick={() => setTab("history")}>
            📋 History
          </button>
        </nav>
      </header>

      <main className="main">
        {/* ── SPEAK TAB ── */}
        {tab === "speak" && (
          <div className="speak-panel">
            {phase === "idle" && (
              <div className="idle-state">
                <div className="big-hint">Press and hold to speak</div>
                <button
                  className="record-btn"
                  onMouseDown={startRecording}
                  onMouseUp={stopRecording}
                  onTouchStart={startRecording}
                  onTouchEnd={stopRecording}
                >
                  <span className="mic-icon">🎤</span>
                </button>
                <p className="hint-text">Hold the button while speaking, then release</p>
              </div>
            )}

            {phase === "recording" && (
              <div className="recording-state">
                <div className="pulse-ring" />
                <button
                  className="record-btn recording"
                  onMouseUp={stopRecording}
                  onTouchEnd={stopRecording}
                >
                  <span className="mic-icon">🎙️</span>
                </button>
                <p className="recording-label">Listening... Release when done</p>
                <div className="wave-bars">
                  {[...Array(7)].map((_, i) => (
                    <div key={i} className="bar" style={{ animationDelay: `${i * 0.1}s` }} />
                  ))}
                </div>
              </div>
            )}

            {phase === "processing" && (
              <div className="processing-state">
                <div className="spinner" />
                <p className="processing-label">Understanding your words...</p>
              </div>
            )}

            {phase === "done" && (
              <div className="done-state">
                <div className="result-emoji">{emoji}</div>
                <div className="result-card raw-card">
                  <label>You said</label>
                  <p>{raw || "(nothing detected)"}</p>
                </div>
                <div className="arrow">↓</div>
                <div className="result-card corrected-card">
                  <label>Clear version</label>
                  <p>{corrected}</p>
                  <button className="speak-btn" onClick={() => speak(corrected)}>
                    🔊 Speak again
                  </button>
                </div>
                <button className="again-btn" onClick={reset}>
                  🎤 Try again
                </button>
              </div>
            )}

            {phase === "error" && (
              <div className="error-state">
                <div className="error-icon">😕</div>
                <p className="error-msg">{errorMsg}</p>
                <button className="again-btn" onClick={reset}>Try again</button>
              </div>
            )}
          </div>
        )}

        {/* ── TEACH TAB ── */}
        {tab === "teach" && (
          <div className="teach-panel">
            <h2>Teach me a word 🧠</h2>
            <p className="teach-desc">
              If I'm getting a word wrong, you can teach me the correct version here.
            </p>
            <div className="teach-form">
              <div className="field">
                <label>What I heard (wrong)</label>
                <input
                  value={teachWrong}
                  onChange={(e) => setTeachWrong(e.target.value)}
                  placeholder="e.g. wader"
                />
              </div>
              <div className="arrow-teach">→</div>
              <div className="field">
                <label>What it should be</label>
                <input
                  value={teachCorrect}
                  onChange={(e) => setTeachCorrect(e.target.value)}
                  placeholder="e.g. water"
                />
              </div>
            </div>
            <button className="save-btn" onClick={handleTeach}>💾 Save correction</button>
            {teachStatus && <p className="teach-status">{teachStatus}</p>}
          </div>
        )}

        {/* ── HISTORY TAB ── */}
        {tab === "history" && (
          <div className="history-panel">
            <h2>Recent conversations 📋</h2>
            {history.length === 0 ? (
              <p className="empty-history">No history yet. Start speaking!</p>
            ) : (
              <ul className="history-list">
                {history.map((h, i) => (
                  <li key={i} className="history-item">
                    <span className="history-time">{h.time}</span>
                    <div className="history-row">
                      <span className="history-raw">"{h.raw}"</span>
                      <span className="history-arrow">→</span>
                      <span className="history-corrected">"{h.corrected}"</span>
                    </div>
                    <button className="mini-speak" onClick={() => speak(h.corrected)}>🔊</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
