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
const loginSchema = new mongoose.Schema({
  email: { type: String, required: true },
  code: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 300 }, // expires in 5 minutes
});

const Login = mongoose.model("Login", loginSchema);

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model("User", userSchema);
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

    // Check if this is a first-time subscription
    const existingSubscription = await Subscription.findOne({ aLabelEmail });

    // Save new subscription
    const newSubscription = new Subscription({
      uLabelEmail: email,
      aLabelEmail,
    });

    await newSubscription.save();

    // Send welcome email in Arabic for new subscribers
    await transporter.sendMail({
      from: `"فريق هاكاثون" <${punycode.toASCII("فريق١٠")}@${punycode.toASCII(
        "هاكاثون.البحرين"
      )}>`,
      to: aLabelEmail,
      subject: "مرحباً بك في نشرة هاكاثون البحرين",
      text: "شكراً لاشتراكك في النشرة الإخبارية لهاكاثون البحرين. سنبقيك على اطلاع بآخر الأخبار والفعاليات القادمة.",
      html: `
        <div dir="rtl" style="font-family: Arial, sans-serif; line-height: 1.6;">
          <h1 style="color: #2c3e50;">مرحباً بك في نشرة هاكاثون البحرين! 🚀</h1>
          <p style="font-size: 16px;">شكراً لاشتراكك في النشرة الإخبارية لدينا.</p>
          <p style="font-size: 16px;">سنقوم بإرسال:</p>
          <ul>
            <li>آخر الأخبار والتحديثات</li>
            <li>معلومات عن الفعاليات القادمة</li>
            <li>نصائح ومصادر مفيدة</li>
          </ul>
          <p style="font-size: 16px;">نتطلع إلى مشاركتك في فعالياتنا القادمة!</p>
          <p style="font-size: 16px;">مع أطيب التحيات،<br>فريق ١٠ هاكاثون البحرين</p>
        </div>
      `,
    });

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
router.post("/login", async (req, res) => {
  const { email } = req.body;

  if (!email || !validateEmail(email)) {
    return res.status(400).json({ error: "Valid email is required" });
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const loginAttempt = new Login({ email, code });
  await loginAttempt.save();

  await transporter.sendMail({
    from: `"فريق هاكاثون" <${punycode.toASCII("فريق١٠")}@${punycode.toASCII(
      "هاكاثون.البحرين"
    )}>`,
    to: email,
    subject: "رمز التحقق لتسجيل الدخول",
    text: `رمز التحقق الخاص بك هو: ${code}`,
    html: `<h1>رمز التحقق لتسجيل الدخول</h1><p>رمز التحقق الخاص بك هو: <b>${code}</b></p>`,
  });

  res.json({ message: "Verification code sent" });
});

router.post("/verify-code", async (req, res) => {
  const { email, code } = req.body;

  const validLogin = await Login.findOne({ email, code });

  if (!validLogin) {
    return res.status(400).json({ error: "Invalid or expired code" });
  }

  let user = await User.findOne({ email });
  if (!user) {
    user = new User({ email });
    await user.save();
  }

  res.json({ message: "Logged in successfully" });
});

export default router;
