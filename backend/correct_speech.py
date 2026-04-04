import sys
import json
import os
from difflib import get_close_matches
import phonetics
from datetime import datetime
import urllib.request

# -------------------------------
# Paths
# -------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_FILE = os.path.join(BASE_DIR, "dataset.txt")
PERSONAL_VOCAB_FILE = os.path.join(BASE_DIR, "personal_vocab.json")

# -------------------------------
# API Keys
# -------------------------------
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

# -------------------------------
# Full Down Syndrome vocabulary
# -------------------------------
BASE_WORDS = [
    # Basic needs
    "water", "food", "eat", "drink", "hungry", "thirsty",
    "sleep", "tired", "rest", "bathroom", "toilet", "wash",
    "help", "please", "sorry", "stop", "go", "want", "need",
    # People
    "mother", "father", "mom", "dad", "sister", "brother",
    "teacher", "friend", "doctor", "baby", "family",
    # Feelings
    "pain", "hurt", "happy", "sad", "scared", "angry",
    "sick", "good", "bad", "hot", "cold", "okay",
    # Actions
    "give", "take", "come", "sit", "stand", "walk",
    "run", "play", "watch", "listen", "open", "close",
    # Places
    "home", "school", "hospital", "outside", "inside", "room",
    # Objects
    "medicine", "phone", "book", "ball", "chair", "bed",
    "cup", "spoon", "clothes", "shoes", "bag",
    # Responses
    "yes", "no", "more", "again", "finished", "wait",
    "ready", "here", "there", "i", "me", "my", "you",
    "the", "a", "to", "and", "is", "it", "in", "of"
]

# -------------------------------
# Step 1 — Transcribe using OpenAI Whisper API
# No heavy model needed — runs in the cloud!
# -------------------------------
def transcribe_audio(audio_path):
    try:
        with open(audio_path, "rb") as audio_file:
            audio_data = audio_file.read()

        boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
        filename = os.path.basename(audio_path)

        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f"Content-Type: audio/wav\r\n\r\n"
        ).encode() + audio_data + (
            f"\r\n--{boundary}\r\n"
            f'Content-Disposition: form-data; name="model"\r\n\r\n'
            f"whisper-1\r\n"
            f"--{boundary}--\r\n"
        ).encode()

        req = urllib.request.Request(
            "https://api.openai.com/v1/audio/transcriptions",
            data=body,
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": f"multipart/form-data; boundary={boundary}"
            },
            method="POST"
        )

        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))
            return result.get("text", "").lower().strip()

    except Exception as e:
        return f"transcription_error: {str(e)}"

# -------------------------------
# Load custom dataset
# -------------------------------
def load_dataset():
    mapping = {}
    if os.path.exists(DATASET_FILE):
        with open(DATASET_FILE, "r") as f:
            for line in f:
                parts = line.strip().split(",")
                if len(parts) == 2:
                    wrong, correct = parts
                    if correct.strip():
                        mapping[wrong.strip()] = correct.strip()
    return mapping

# -------------------------------
# Load personal vocabulary
# -------------------------------
def load_personal_vocab():
    if os.path.exists(PERSONAL_VOCAB_FILE):
        with open(PERSONAL_VOCAB_FILE, "r") as f:
            return json.load(f)
    return {}

# -------------------------------
# Save to personal vocab
# -------------------------------
def save_to_personal_vocab(word):
    vocab = load_personal_vocab()
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    if word in vocab:
        vocab[word]["count"] += 1
        vocab[word]["last_used"] = now
    else:
        vocab[word] = {
            "count": 1,
            "first_used": now,
            "last_used": now
        }
    with open(PERSONAL_VOCAB_FILE, "w") as f:
        json.dump(vocab, f, indent=2)

# -------------------------------
# Save unknown word
# -------------------------------
def save_unknown(word):
    if len(word) < 2:
        return
    with open(DATASET_FILE, "a") as f:
        f.write(word + ",\n")

# -------------------------------
# Step 2 — Correct single word
# -------------------------------
def correct_word(text, custom_map, personal_vocab):
    text = text.lower().strip()
    text = ''.join(c for c in text if c.isalpha())
    if not text:
        return text

    # 1. Custom dataset
    if text in custom_map:
        corrected = custom_map[text]
        save_to_personal_vocab(corrected)
        return corrected

    # 2. Already a known word
    if text in BASE_WORDS:
        save_to_personal_vocab(text)
        return text

    # 3. Fuzzy match
    match = get_close_matches(text, BASE_WORDS, n=1, cutoff=0.45)
    if match:
        save_to_personal_vocab(match[0])
        return match[0]

    # 4. Phonetic match
    try:
        text_ph = phonetics.metaphone(text)
        for word in BASE_WORDS:
            if phonetics.metaphone(word) == text_ph:
                save_to_personal_vocab(word)
                return word
    except:
        pass

    # 5. Personal vocab match
    if personal_vocab:
        personal_words = list(personal_vocab.keys())
        match = get_close_matches(text, personal_words, n=1, cutoff=0.45)
        if match:
            save_to_personal_vocab(match[0])
            return match[0]

    # 6. Unknown
    save_unknown(text)
    return text

# -------------------------------
# Correct full sentence
# -------------------------------
def correct_sentence(text, custom_map, personal_vocab):
    tokens = text.lower().strip().split()
    corrected = [correct_word(t, custom_map, personal_vocab) for t in tokens]
    corrected = [w for w in corrected if w]
    return " ".join(corrected)

# -------------------------------
# Step 3 — AI full sentence fix using Claude
# -------------------------------
def ai_fix_sentence(raw_text, word_corrected):
    try:
        if not ANTHROPIC_API_KEY:
            return word_corrected

        prompt = f"""You are a speech assistant helping someone with Down syndrome communicate clearly.

The person tried to say something. Here is what was heard (unclear speech):
"{raw_text}"

After basic word correction, it became:
"{word_corrected}"

Your job:
1. Understand what the person is trying to communicate
2. Rewrite it as a clear, natural, complete English sentence
3. Keep the meaning exactly the same — do NOT add extra information
4. Keep it simple and short
5. Return ONLY the corrected sentence — no explanation, no quotes

Corrected sentence:"""

        data = json.dumps({
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": 100,
            "messages": [{"role": "user", "content": prompt}]
        }).encode("utf-8")

        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=data,
            headers={
                "Content-Type": "application/json",
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01"
            },
            method="POST"
        )

        with urllib.request.urlopen(req, timeout=10) as response:
            result = json.loads(response.read().decode("utf-8"))
            return result["content"][0]["text"].strip()

    except Exception as e:
        return word_corrected

# -------------------------------
# MAIN
# -------------------------------
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No audio file provided"}))
        sys.exit(1)

    audio_path = sys.argv[1]

    if not os.path.exists(audio_path):
        print(json.dumps({"error": f"Audio file not found: {audio_path}"}))
        sys.exit(1)

    custom_map = load_dataset()
    personal_vocab = load_personal_vocab()

    # Step 1: Transcribe with OpenAI Whisper API
    raw_text = transcribe_audio(audio_path)

    # Step 2: Word correction
    word_corrected = correct_sentence(raw_text, custom_map, personal_vocab)

    # Step 3: AI full sentence fix
    final_sentence = ai_fix_sentence(raw_text, word_corrected)

    print(json.dumps({
        "raw": raw_text,
        "word_corrected": word_corrected,
        "corrected": final_sentence,
        "personal_vocab_size": len(personal_vocab)
    }))