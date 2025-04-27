import express from "express";
import nodemailer from "nodemailer";
import punycode from "punycode";
import mongoose from "mongoose";
import dotenv from "dotenv";
import idna from "idna-uts46";
const { toAscii, toUnicode } = idna;

dotenv.config();

const router = express.Router();

mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("MongoDB Connected ✅"))
  .catch((err) => console.error("MongoDB connection error ❌:", err.message));

const subscriptionSchema = new mongoose.Schema({
  uLabelEmail: { type: String, required: true },
  aLabelEmail: { type: String, required: true },
});

const Subscription = mongoose.model("Subscription", subscriptionSchema);

const transporter = nodemailer.createTransport({
  host: "mail.xn--mgbam8grabl.xn--mgbcpq6gpa1a",
  port: 465,
  secure: true,
  auth: {
    user: "Mailbox13",
    pass: "godomains",
  },
  tls: { rejectUnauthorized: false },
});

function isAsciiEmail(email) {
  return /^[\x00-\x7F]+@[\x00-\x7F]+\.[\x00-\x7F]+$/.test(email);
}

function validateEmail(email) {
  if (isAsciiEmail(email)) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  } else {
    try {
      const [localPart, domainPart] = email.split("@");
      const asciiDomain = toAscii(domainPart);
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(`${localPart}@${asciiDomain}`);
    } catch (e) {
      return false;
    }
  }
}

router.post("/validate-email", (req, res) => {
  const { email } = req.body;

  if (!email) return res.status(400).json({ error: "Email is required" });

  const isValid = validateEmail(email);

  if (isValid) {
    res.json({ valid: true, message: "Email is valid." });
  } else {
    res.status(400).json({ valid: false, error: "Invalid email address." });
  }
});

router.post("/subscribe", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !validateEmail(email)) {
      return res.status(400).json({ error: "Valid email is required" });
    }

    const [localPart, domainPart] = email.split("@");
    const aLabelEmail = isAsciiEmail(email)
      ? email
      : `${localPart}@${toAscii(domainPart)}`;

    const newSubscription = new Subscription({
      uLabelEmail: email,
      aLabelEmail,
    });

    await newSubscription.save();

    res.json({ message: "Subscribed successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/sendSubscribeEmail", async (req, res) => {
  try {
    const subscribers = await Subscription.find();

    if (subscribers.length === 0)
      return res.status(404).json({ error: "No subscribers found" });

    for (const subscriber of subscribers) {
      await transporter.sendMail({
        from: `"فريق هاكاثون" <${punycode.toASCII("فريق١٠")}@${punycode.toASCII(
          "هاكاثون.البحرين"
        )}>`,
        to: subscriber.aLabelEmail,
        subject: "أهلاً بك في هاكاثون البحرين!",
        text: "شكرًا لتسجيلك معنا 🎉",
        html: "<h1>شكرًا لتسجيلك معنا 🎉</h1><p>نتمنى لك التوفيق!</p>",
      });
    }

    res.json({ message: "Emails sent to all subscribers" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
