const functions = require("firebase-functions");
const nodemailer = require("nodemailer");

const GMAIL_USER = "your-email@gmail.com";
const GMAIL_PASS = "your-app-password";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_PASS,
  },
});

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
