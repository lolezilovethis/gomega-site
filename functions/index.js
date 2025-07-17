const functions = require("firebase-functions");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

admin.initializeApp();

// Load Gmail credentials from environment
const gmailEmail = functions.config().email.user;
const gmailPass = functions.config().email.pass;

// Create reusable email sender
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: gmailEmail,
    pass: gmailPass
  }
});

// General-purpose email sender
function sendEmail(to, subject, htmlContent) {
  const mailOptions = {
    from: `"Gomega Watch" <${gmailEmail}>`,
    to,
    subject,
    html: htmlContent
  };
  return transporter.sendMail(mailOptions);
}

// 📤 Send confirmation email
exports.sendSubmissionEmail = functions.https.onCall(async (data, context) => {
  const { email, school } = data;
  await sendEmail(
    email,
    `Opt-Out Request Received for ${school}`,
    `<p>📨 We've received your opt-out request for <strong>${school}</strong>.</p><p>Our team will review and respond soon.</p>`
  );
});

// ✅ Send approval email
exports.sendApprovalEmail = functions.https.onCall(async (data, context) => {
  const { email, school } = data;
  await sendEmail(
    email,
    `✅ Approved: ${school}`,
    `<p>🎉 Your opt-out request for <strong>${school}</strong> has been <strong>approved</strong>.</p><p>Your school will be removed from the platform within 7 days.</p>`
  );
});

// ❌ Send rejection email
exports.sendRejectionEmail = functions.https.onCall(async (data, context) => {
  const { email, school } = data;
  await sendEmail(
    email,
    `❌ Rejected: ${school}`,
    `<p>Your opt-out request for <strong>${school}</strong> has been <strong>rejected</strong>.</p><p>If this is a mistake, please contact support.</p>`
  );
});
