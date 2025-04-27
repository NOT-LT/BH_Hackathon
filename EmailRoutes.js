import express from "express";
import nodemailer from "nodemailer";
import punycode from "punycode";

const router = express.Router();

// إعداد الاتصال بسيرفر SMTP
const transporter = nodemailer.createTransport({
  host: "mail.xn--mgbam8grabl.xn--mgbcpq6gpa1a",
  port: 465,
  secure: true,
  auth: {
    user: "Mailbox13",
    pass: "godomains",
  },
  tls: {
    rejectUnauthorized: false,
  },
});

router.post("/sendEmail", async (req, res) => {
  try {
    const { toEmail } = req.body; // الإيميل اللي يدخل من المستخدم

    if (!toEmail) {
      return res.status(400).json({ error: "Email is required" });
    }

    // معالجة Punycode للدومين لو كان بالعربي
    const [localPart, domainPart] = toEmail.split("@");
    const encodedDomain = punycode.toASCII(domainPart);
    const emailAddress = `${localPart}@${encodedDomain}`;

    // تجهيز الإيميل
    const info = await transporter.sendMail({
      from: `"فريق هاكاثون" <${punycode.toASCII("فريق١٠")}@${punycode.toASCII(
        "هاكاثون.البحرين"
      )}>`, // المرسل بصيغة Punycode
      to: emailAddress, // المستقبل
      subject: "أهلاً بك في هاكاثون البحرين!",
      text: "شكرًا لتسجيلك معنا 🎉",
      html: "<h1>شكرًا لتسجيلك معنا 🎉</h1><p>نتمنى لك التوفيق!</p>",
    });

    console.log("Message sent: %s", info.messageId);
    res.json({ output: "Email sent successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
