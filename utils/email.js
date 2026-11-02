const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false,

  connectionTimeout: 30000,
  greetingTimeout: 30000,
  socketTimeout: 60000,

  auth: {
    user: process.env.BREVO_USER,
    pass: process.env.BREVO_PASS
  }
});

async function sendEmail(to, subject, html) {
  return transporter.sendMail({
    from: `"Ecrin d'art d'amina" <${process.env.MAIL_FROM}>`,
    to,
    subject,
    html
  });
}

module.exports = { sendEmail };