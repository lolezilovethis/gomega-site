// functions/index.js
const functions = require("firebase-functions");
const nodemailer = require("nodemailer");
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
app.use(express.json());

// Allow all origins for dev. Change origin to 'https://gomega.watch' for production if you want stricter CORS.
const corsOptions = { origin: true };
app.use(cors(corsOptions));

// ---------------- EMAIL SYSTEM (optional) ----------------

const GMAIL_USER = "your-email@gmail.com"; // replace with your Gmail
const GMAIL_PASS = "your-app-password"; // use App Password, not your real password

let transporter = null;
if (GMAIL_USER && GMAIL_PASS) {
  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_PASS }
  });
}

// Exposed sendEmail function (keeps your original logic but with CORS)
exports.sendEmail = functions.https.onRequest((req, res) => {
  cors(corsOptions)(req, res, async () => {
    try {
      const { type, email, school } = req.body;
      if (!email || !school || !type) return res.status(400).send("Missing required fields.");

      let subject = "";
      let text = "";
      switch (type) {
        case "submitted":
          subject = "Opt-Out Request Submitted";
          text = `Your request to opt-out "${school}" has been received and is pending review.`;
          break;
        case "approved":
          subject = "Opt-Out Request Approved";
          text = `Your request for "${school}" has been approved.\n\nIt may take up to 7 days to delete and IP-ban all users from this school. Please be patient.`;
          break;
        case "declined":
          subject = "Opt-Out Request Declined";
          text = `Your request to opt-out "${school}" has been declined. Contact support for help.`;
          break;
        default:
          return res.status(400).send("Invalid email type.");
      }

      if (!transporter) return res.status(500).send("Email transporter not configured.");

      await transporter.sendMail({
        from: `"Gomega Admin" <${GMAIL_USER}>`,
        to: email,
        subject,
        text
      });

      return res.status(200).send("Email sent.");
    } catch (err) {
      console.error("Email send error:", err);
      return res.status(500).send("Failed to send email.");
    }
  });
});

// ---------------- KEY SYSTEM ----------------

function getCurrentKey() {
  const interval = Math.floor(Date.now() / (1000 * 60 * 60 * 12)); // every 12h
  const raw = "gomega-secret-salt" + interval;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12);
}

app.get("/key", (req, res) => {
  res.json({ key: getCurrentKey() });
});

app.post("/verify-key", (req, res) => {
  const { key } = req.body || {};
  res.json({ valid: key === getCurrentKey() });
});

// ---------------- Demo storage + models ----------------
const memories = []; // in-memory only (resets on cold start)
function pushMemory(role, text) {
  memories.push({ role, text: String(text || ""), ts: Date.now() });
  while (memories.length > 500) memories.shift();
}

const MODELS = [
  { id: "gomega-5", label: "gomega-5 (best)" },
  { id: "gomega-4o", label: "gomega-4o (balanced)" },
  { id: "gomega-4mini", label: "gomega-4mini (small)" },
  { id: "gomega-3.0", label: "gomega-3.0 (legacy)" },
  { id: "gomega-3mini", label: "gomega-3mini (fast)" },
  { id: "local-sm", label: "local-sm (fast)" },
  { id: "local-md", label: "local-md (learning)" }
];

// GET /config — frontend expects this
app.get("/config", (req, res) => {
  res.json({
    provider: "gomega-firebase",
    premiumAvailable: false,
    models: MODELS,
    info: "Firebase Functions demo API (non-streaming)."
  });
});

// POST /chat — returns JSON { choices:[{text: reply}], reply }
app.post("/chat", (req, res) => {
  try {
    const { modelId = "gomega-5", temperature = 0.7, system, messages = [], stream } = req.body || {};
    const last = Array.isArray(messages) ? messages.slice(-1)[0] : null;
    const userText = last && last.content ? String(last.content) : "";

    if (userText) pushMemory("user", userText);

    // Simple demo reply; replace with real AI calls in production
    const replyText =
      `Gomega (${modelId}) — reply from Firebase demo backend:\n\n` +
      `Received message: "${userText}"\n\n` +
      `This is a demo response from the Firebase function. Temperature: ${temperature}`;

    // Save assistant memory
    pushMemory("assistant", replyText);

    // Return non-streaming JSON (works reliably on Functions)
    return res.json({
      choices: [{ text: replyText }],
      reply: replyText
    });
  } catch (err) {
    console.error("chat error:", err);
    return res.status(500).json({ error: "server error", detail: String(err) });
  }
});

// GET /memories — show saved memories (for debug)
app.get("/memories", (req, res) => {
  res.json({
    count: memories.length,
    memories: memories.slice(-200).map(m => ({ role: m.role, text: m.text, ts: m.ts }))
  });
});

// Mount the Express app as a Cloud Function
exports.api = functions.https.onRequest(app);
