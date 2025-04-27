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
  fullname: { type: String, required: true },
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

// Requires a punycode conversion function for IDN domains.
// (In Node.js, you can use require('punycode').toASCII; in browsers, use an IDN library.)
function linkify(text) {
  // Trim the input to remove leading/trailing whitespace
  const input = text.trim();

  // Simple regex patterns (using Unicode escapes) for email vs domain
  const emailPattern =
    /^([\p{L}\p{N}._%+-]+)@([\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+)$/u;
  const domainPattern = /^([\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+)$/u;

  let match;
  if ((match = input.match(emailPattern))) {
    let [, localPart, domainPart] = match;
    // Convert the domain part of the email to ASCII (punycode) if needed
    const asciiDomain = toASCII(domainPart); // assume toASCII converts Unicode domain -> punycode
    return `mailto:${localPart}@${asciiDomain}`;
  } else if ((match = input.match(domainPattern))) {
    let domain = match[1];
    const asciiDomain = toASCII(domain);
    return `http://${asciiDomain}`;
  } else {
    // No link found or input is not a valid single domain/email
    return null;
  }
}

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
router.post("/linkify", (req, res) => {
  const { text } = req.body;

  if (!text) return res.status(400).json({ error: "Text is required" });

  const input = text.trim();

  // Email pattern: local-part@domain
  const emailPattern =
    /^([\p{L}\p{N}._%+-]+)@([\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+)$/u;
  // Domain pattern: domain (must have at least one dot)
  const domainPattern = /^([\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+)$/u;

  let match;
  try {
    if ((match = input.match(emailPattern))) {
      const localPart = match[1];
      const domainPart = match[2];
      const asciiDomain = toAscii(domainPart);
      return res.json({ link: `mailto:${localPart}@${asciiDomain}` });
    } else if ((match = input.match(domainPattern))) {
      const domain = match[1];
      const asciiDomain = toAscii(domain);
      return res.json({ link: `http://${asciiDomain}` });
    } else {
      return res
        .status(400)
        .json({ error: "Input must be a valid domain or email" });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

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
router.post("/signup", async (req, res) => {
  const { email, fullname } = req.body;

  if (!email || !fullname) {
    return res.status(400).json({ error: "Email and fullname are required." });
  }

  if (!validateEmail(email)) {
    return res.status(400).json({ error: "Valid email is required" });
  }

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return res
      .status(400)
      .json({ error: "User already exists. Please log in." });
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();

  await Login.create({ email, code });

  await transporter.sendMail({
    from: `"فريق هاكاثون" <${punycode.toASCII("فريق١٠")}@${punycode.toASCII(
      "هاكاثون.البحرين"
    )}>`,
    to: email,
    subject: "رمز التحقق لإنشاء حساب جديد",
    text: `رمز التحقق الخاص بك هو: ${code}`,
    html: `<h1>رمز التحقق لإنشاء حساب</h1><p>رمزك هو: <b>${code}</b></p>`,
  });

  res.json({ message: "Verification code sent for signup" });
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
  const { email, code, fullname } = req.body;

  const validLogin = await Login.findOne({ email, code });
  if (!validLogin) {
    return res
      .status(400)
      .json({ error: "Invalid or expired verification code" });
  }

  let user = await User.findOne({ email });

  if (!user && fullname) {
    // إذا كان التحقق ضمن تسجيل حساب جديد
    user = new User({ email, fullname });
    await user.save();
  } else if (!user) {
    return res.status(400).json({
      error: "User not found. Please sign up first.",
    });
  }

  res.json({ message: "Logged in successfully" });
});

export default router;
