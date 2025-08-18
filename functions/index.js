const functions = require("firebase-functions");
const admin = require("firebase-admin");
const cors = require("cors")({ origin: true });

admin.initializeApp();

exports.chat = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).send("Method not allowed");
    }

    const { message } = req.body;

    // 🔹 Replace this with your AI logic later
    const reply = `Echo: ${message}`;

    res.json({ reply });
  });
});
