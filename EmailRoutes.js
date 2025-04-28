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
  progress: {
    type: Map,
    of: new mongoose.Schema(
      { completed: Boolean, score: Number },
      { _id: false }
    ),
    default: {},
  },
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
// Define the verifyCodeForEmail function
async function verifyCodeForEmail(email, code) {
  try {
    // Check if the code exists in the Login collection for the given email
    const loginRecord = await Login.findOne({ email, code });
    return !!loginRecord; // Return true if a matching record is found
  } catch (err) {
    console.error("Error verifying code:", err);
    return false;
  }
}
// Express route for verifying the signup/login code
router.post("/verify-code", async (req, res) => {
  const { email, code, fullname } = req.body;
  try {
    // 1. Verify that the provided code is valid for the given email (implementation depends on how codes are stored)
    const codeValid = await verifyCodeForEmail(email, code); // pseudo-function for code verification
    if (!codeValid) {
      return res
        .status(400)
        .json({ error: "Invalid or expired verification code" });
    }

    // 2. Find existing user by email, or create a new user if this is a signup
    let user = await User.findOne({ email });
    if (!user) {
      // New user (signup scenario): create user with provided name and empty progress
      user = new User({ email, fullname, progress: {} });
    } else if (fullname && !user.fullname) {
      // (Optional) If fullname provided (e.g. during signup) and user exists, update name if not set
      user.fullname = fullname;
    }

    // 3. Save the user (this will create a new record for signups or update existing)
    await user.save();

    // 4. Respond with user info and current progress
    res.json({
      email: user.email,
      fullname: user.fullname || "",
      progress: user.progress || {},
    });
  } catch (err) {
    console.error("Verification failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Enhanced linkification following UTS58 draft more closely

/**
 * Linkifies text according to Unicode Technical Standard #58 (UTS58)
 * Reference: https://www.unicode.org/L2/L2024/24217r2-uts58-working-draft.html
 */
function linkifyTextUTS58(text) {
  // Preserve line breaks and whitespace
  const preserveLineBreaks = text.replace(/\n/g, "\n ").replace(/\r/g, "\r ");

  // UTS58 defines different link types, we'll implement URL and email

  // ===== URL LINKIFICATION =====

  // UTS58 - rule B.1: URL prefix patterns
  const urlPrefixPattern = /(?:https?:\/\/|www\.)/iu;

  // UTS58 - rules B.2 & B.3: Domain patterns allowing IDNs (Internationalized Domain Names)
  // Unicode script-mixing restrictions are complex - this is a simplification
  const domainLabelPattern = /[\p{L}\p{N}][\p{L}\p{N}-]*/gu;
  const domainPattern = new RegExp(
    `(${domainLabelPattern.source}(?:\\.${domainLabelPattern.source})+)`,
    "u"
  );

  // UTS58 - rule B.4: Path, query and fragment patterns
  const pathQueryFragmentPattern = /(?:\/[^\s<>()[\]{}]*)?/gu;

  // Combined URL pattern
  const urlPattern = new RegExp(
    `(?:${urlPrefixPattern.source})?${domainPattern.source}${pathQueryFragmentPattern.source}`,
    "gu"
  );

  // ===== EMAIL LINKIFICATION =====

  // UTS58 - rule C.1: Email local part pattern
  const emailLocalPartPattern = /[\p{L}\p{N}._%+-]+/gu;

  // UTS58 - rule C.2: Email pattern combining local part and domain
  const emailPattern = new RegExp(
    `(${emailLocalPartPattern.source}@${domainPattern.source})`,
    "gu"
  );

  // Process the text to find and linkify all matches
  let processedText = preserveLineBreaks;

  // Track positions where we've already inserted links to avoid double-processing
  const processedRanges = [];

  // First process emails (as they're more specific than URLs)
  let match;
  while ((match = emailPattern.exec(processedText)) !== null) {
    const fullMatch = match[0];
    const startPos = match.index;
    const endPos = startPos + fullMatch.length;

    // Skip if this range overlaps with an already processed range
    if (
      processedRanges.some(
        (range) =>
          (startPos >= range.start && startPos < range.end) ||
          (endPos > range.start && endPos <= range.end) ||
          (startPos <= range.start && endPos >= range.end)
      )
    ) {
      continue;
    }

    try {
      const [localPart, domainPart] = fullMatch.split("@");
      const asciiDomain = toAscii(domainPart);
      const asciiEmail = `${localPart}@${asciiDomain}`;

      // Replace the email with a link
      const replacement = `<a href="mailto:${asciiEmail}">${fullMatch}</a>`;
      processedText =
        processedText.substring(0, startPos) +
        replacement +
        processedText.substring(endPos);

      // Adjust subsequent matches for the length difference after replacement
      const lengthDiff = replacement.length - fullMatch.length;
      emailPattern.lastIndex += lengthDiff;

      // Record the processed range
      processedRanges.push({
        start: startPos,
        end: startPos + replacement.length,
      });
    } catch (e) {
      console.error("Email processing error:", e);
    }
  }

  // Reset for URL processing
  urlPattern.lastIndex = 0;

  // Then process URLs
  while ((match = urlPattern.exec(processedText)) !== null) {
    const fullMatch = match[0];
    const startPos = match.index;
    const endPos = startPos + fullMatch.length;

    // Skip if this range overlaps with an already processed range
    if (
      processedRanges.some(
        (range) =>
          (startPos >= range.start && startPos < range.end) ||
          (endPos > range.start && endPos <= range.end) ||
          (startPos <= range.start && endPos >= range.end)
      )
    ) {
      continue;
    }

    try {
      // Determine if this is a valid URL (simple validation)
      if (!fullMatch.includes(".")) continue;

      // Check if URL has protocol
      const hasProtocol = /^https?:\/\//i.test(fullMatch);
      const hasWww = /^www\./i.test(fullMatch);

      // Extract domain part (handling both protocol and www prefixes)
      let domainPart;
      if (hasProtocol) {
        domainPart = fullMatch.split("//")[1].split("/")[0];
      } else if (hasWww) {
        domainPart = fullMatch.split("/")[0];
      } else {
        domainPart = fullMatch.split("/")[0];
      }

      // Convert domain to ASCII (punycode)
      const asciiDomain = toAscii(domainPart);

      // Reconstruct the URL with ASCII domain
      let asciiUrl = fullMatch.replace(domainPart, asciiDomain);

      // Ensure URL has proper protocol for the href attribute
      const href = hasProtocol
        ? asciiUrl
        : hasWww
        ? `http://${asciiUrl}`
        : `http://${asciiUrl}`;

      // Replace the URL with a link
      const replacement = `<a href="${href}">${fullMatch}</a>`;
      processedText =
        processedText.substring(0, startPos) +
        replacement +
        processedText.substring(endPos);

      // Adjust for the length difference
      const lengthDiff = replacement.length - fullMatch.length;
      urlPattern.lastIndex += lengthDiff;

      // Record the processed range
      processedRanges.push({
        start: startPos,
        end: startPos + replacement.length,
      });
    } catch (e) {
      console.error("URL processing error:", e);
    }
  }

  // Remove the spaces we added to preserve line breaks
  return processedText.replace(/\n /g, "\n").replace(/\r /g, "\r");
}

// Add this new endpoint to your router
router.post("/linkify-text", (req, res) => {
  const { text } = req.body;

  if (!text) return res.status(400).json({ error: "Text is required" });

  try {
    // Process the text according to Unicode Linkification Standard
    const processedText = linkifyTextUTS58(text);
    return res.json({ processedText });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
// Express route to update a user's progress for a lesson
router.post("/progress/update", async (req, res) => {
  try {
    const { email, level, lessonId, score } = req.body;
    // Build the field path for the specific lesson (e.g., "progress.beginner.1")
    const progressField = `progress.${level}.${lessonId}`;
    // Use $set with dot notation to update this lesson's progress
    const update = {
      $set: { [progressField]: { completed: true, score: score } },
    };

    // Find the user by email and update their progress for the given lesson
    const user = await User.findOneAndUpdate({ email }, update, { new: true });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Respond with success (and optionally the updated progress or message)
    return res.json({
      message: "Progress updated successfully",
      progress: user.progress,
    });
  } catch (err) {
    console.error("Error updating progress:", err);
    res.status(500).json({ error: "Failed to update progress" });
  }
});

router.get("/users/:email", async (req, res) => {
  const { email } = req.params;
  const user = await User.findOne({ email });
  res.json(user);
});
router.get("/progress/:email", async (req, res) => {
  const { email } = req.params;

  try {
    const user = await User.findOne({ email }).lean(); // NOTICE: lean() !!

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const progress = {};

    if (user.progress) {
      for (const [level, lessons] of Object.entries(user.progress)) {
        progress[level] = {};
        for (const [lessonId, lessonData] of Object.entries(lessons)) {
          progress[level][lessonId] = lessonData;
        }
      }
    }

    res.status(200).json({ progress });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
