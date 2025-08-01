const functions = require("firebase-functions");
const nodemailer = require("nodemailer");
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

// --- Email setup ---
const GMAIL_USER = "your-email@gmail.com";
const GMAIL_PASS = "your-app-password";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_PASS,
  },
});

// --- Email Cloud Function ---
exports.sendEmail = functions.https.onRequest(async (req, res) => {
  const { type, email, school } = req.body;

  if (!email || !school || !type) {
    return res.status(400).send("Missing required fields.");
  }

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

  try {
    await transporter.sendMail({
      from: `"Gomega Admin" <${GMAIL_USER}>`,
      to: email,
      subject,
      text,
    });

    return res.status(200).send("Email sent.");
  } catch (err) {
    console.error("Email send error:", err);
    return res.status(500).send("Failed to send email.");
  }
});


// --- Express App for /key and /verify-key ---
const app = express();
app.use(cors({
  origin: "https://gomega.watch"  // Allow only your domain
}));
app.use(express.json());

// Generate key that changes every 12 hours
function getCurrentKey() {
  const interval = Math.floor(Date.now() / (1000 * 60 * 60 * 12)); // changes every 12h
  const raw = "gomega-secret-salt" + interval;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12);
}

// Route: GET /key
app.get("/key", (req, res) => {
  const key = getCurrentKey();
  res.json({ key });
});

// Route: POST /verify-key
app.post("/verify-key", (req, res) => {
  const { key } = req.body;
  const isValid = key === getCurrentKey();
  res.json({ valid: isValid });
});

// Export Express API
exports.api = functions.https.onRequest(app);
