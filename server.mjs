import express from 'express';
import { OpenAI } from 'openai';
import { config } from 'dotenv';
import fetch from 'node-fetch'; // Important for embedding
import fs from 'fs';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import multer from 'multer';
import cors from 'cors';
import EmailRoutes from "./EmailRoutes.js";
import mammoth from 'mammoth';
// import pdfPoppler from 'pdf-poppler';
import mime from 'mime-types'; // install it if needed: npm install mime-types
import { createRequire } from 'module';
import { Console } from 'console';
import bidi from 'bidi-js'; // Install this library: npm install bidi-js
import Tesseract from 'tesseract.js'; // Install it: npm install tesseract.js
const require = createRequire(import.meta.url);
const PDFParser = require('pdf2json');
import pdf from 'pdf-parse';
import { detectOne } from 'langdetect';

const EMBEDDINGS_FILE = "./embeddings.json";
async function saveEmbeddings(embeddings) {
  await writeFile(EMBEDDINGS_FILE, JSON.stringify(embeddings), "utf8");
  console.log("Saved embeddings to file.");
}

const upload = multer({ dest: 'uploads/' }); // uploads/ folder in your project

async function loadEmbeddings() {
  if (fs.existsSync(EMBEDDINGS_FILE)) {
    const data = await readFile(EMBEDDINGS_FILE, "utf8");
    console.log("Loaded embeddings from file.");
    return JSON.parse(data);
  }
  return null;
}

config();
globalThis.fetch = fetch; // Needed because openai uses fetch
const languageMap = {
  en: 'English',
  ar: 'Arabic',
  fr: 'French',
  es: 'Spanish',
  de: 'German',
  zh: 'Chinese',
  ru: 'Russian',
  ja: 'Japanese',
  it: 'Italian',
  pt: 'Portuguese',
  hi: 'Hindi',
  // Add more if needed!
};
const app = express();
app.use(express.json());
app.use(cors());
let uploadedChunks = [];
let uploadedEmbeddings = [];

let uploadedPrompt = ""; // Global variable to store the uploaded document's content

// --- OpenAI setup ---
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const apiRouter = express.Router();
// --- In-memory storage ---
let uaChunks = [];
let uaEmbeddings = [];

// --- Cosine similarity function ---
function cosineSimilarity(vecA, vecB) {
  const dotProduct = vecA.reduce((acc, val, i) => acc + val * vecB[i], 0);
  const normA = Math.sqrt(vecA.reduce((acc, val) => acc + val * val, 0));
  const normB = Math.sqrt(vecB.reduce((acc, val) => acc + val * val, 0));
  return dotProduct / (normA * normB);
}

// --- Load and embed UA content ---
async function loadUAContent() {
  const text = await readFile("./ua_cleaned_v2.txt", "utf8");
  const words = text.split(" ");
  const chunkSize = 300;

  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk = words
      .slice(i, i + chunkSize)
      .join(" ")
      .trim();
    uaChunks.push(chunk);
  }

  console.log(`Loaded ${uaChunks.length} chunks.`);

  // Check if embeddings already saved
  const savedEmbeddings = await loadEmbeddings();
  if (savedEmbeddings) {
    uaEmbeddings = savedEmbeddings;
    return;
  }

  console.log("Now creating embeddings...");

  for (const chunk of uaChunks) {
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: chunk,
    });
    uaEmbeddings.push(embeddingResponse.data[0].embedding);
  }

  await saveEmbeddings(uaEmbeddings);
  console.log("Generated and saved embeddings.");
}

// --- Find best matches based on embeddings ---
async function findRelevantChunks(question) {
  const embeddingResponse = await openai.embeddings.create({
    model: "text-embedding-ada-002",
    input: question,
  });
  const questionEmbedding = embeddingResponse.data[0].embedding;

  // Calculate cosine similarity for each chunk
  const similarities = uaEmbeddings.map((chunkEmbedding) =>
    cosineSimilarity(chunkEmbedding, questionEmbedding)
  );

  // Sort by similarity descending
  const topIndices = similarities
    .map((sim, idx) => ({ sim, idx }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 3) // Top 3 most similar
    .map((obj) => obj.idx);

  return topIndices.map((idx) => uaChunks[idx]);
}

// --- Routes ---
app.get("/", (req, res) => {
  res.send("Welcome to the UA Chatbot API! Use POST /ask to ask questions.");
});

async function detectLanguageName(text) {
  const langCode = detectOne(text);
  if (!langCode) {
    return 'Unknown';
  }
  
  const langName = languageMap[langCode] || 'Unknown'; // fallback if code not mapped
  return langName;
}

function detectLanguageUsingRegex(text) {
  const arabicRegex = /[\u0600-\u06FF]/g;
  const englishRegex = /[a-zA-Z]/g;

  const arabicMatches = text.match(arabicRegex) || [];
  const englishMatches = text.match(englishRegex) || [];

  if (arabicMatches.length > englishMatches.length) {
    return "Arabic";
  } else if (englishMatches.length > arabicMatches.length) {
    return "English";
  } else {
    return "Arabic";
  }
}

app.post("/ask", async (req, res) => {
  const { question, chatHistory = '' } = req.body;
  const chatHistoryString = `[${chatHistory
    .map(entry => `User: ${entry.UserInput}\nGlobalLink: ${entry.GlobalLink}`)
    .join('\n\n')}]`;


  console.log("chatHistory", chatHistoryString);
  let userLanguage = 'Arabic'; // Default fallback language
  userLanguage = detectLanguageUsingRegex(question);

  console.log("userLanguage", userLanguage);
  if (userLanguage !== 'English' && userLanguage !== 'Arabic') {
    userLanguage = 'English'; // Default to Arabic if not English or Arabic
  }
  if (userLanguage === 'Unknown') {
    userLanguage = 'Arabic'
  }
  if (!question) return res.status(400).json({ error: "No question provided." });

  try {
    const relevantChunks = await findRelevantChunks(question);
    let relevantUploadedChunks = [];

    // Use uploaded content if available
    if (uploadedChunks.length > 0) {
      const embeddingResponse = await openai.embeddings.create({
        model: "text-embedding-ada-002",
        input: question,
      });
      const questionEmbedding = embeddingResponse.data[0].embedding;

      const similarities = uploadedEmbeddings.map(embedding =>
        cosineSimilarity(embedding, questionEmbedding)
      );

      const topIndices = similarities
        .map((sim, idx) => ({ sim, idx }))
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 3)
        .map(obj => obj.idx);

      relevantUploadedChunks = topIndices.map(idx => uploadedChunks[idx]);
      // relevantChunks = relevantChunks.concat(relevantUploadedChunks);
      // Clear uploaded content after use
      uploadedChunks = [];
      uploadedEmbeddings = [];
    }

    // Combine relevant chunks
    const context = relevantChunks.join("\n\n");

    // Build the prompt
    //     You are a Universal Acceptance (UA) expert and you follow the latest IDN standard called IDNA2008 for Internationalized Domain Names (IDNs).
    let prompt = `
Your name is GlobalLink.

Respond in ${userLanguage}.

Answer concisely to the User Input.
Use the provided Context and Conversation History as your primary sources.
Treat the Conversation History as a memory of previous exchanges with the user.
If the user asks about previous messages, refer to the Conversation History to answer.

If the context and conversation history do not contain enough information, supplement your answer carefully with your own knowledge.
Be clear, accurate, and concise.

User Input:
${question}

Conversation History:
${chatHistoryString}

Context:
${context}

Answer:
`;



    // Send the prompt to OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    });

    const answer = completion.choices[0].message.content.trim();
    res.json({ answer });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to process request." });
  }
});


app.post('/summarize-pdf', upload.single('file'), async (req, res) => {
  const file = req.file;
  const { summaryLength = 'medium', language = 'عربي' } = req.body;

  if (!file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  let text = '';

  try {
    const mimetype = file.mimetype;

    if (mimetype === "application/pdf") {
      text = await extractTextFromPDF(file.path);
    } else if (
      mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      mimetype === "application/msword"
    ) {
      const data = await fs.readFile(file.path);
      const result = await mammoth.extractRawText({ buffer: data });
      text = result.value;
    } else if (mimetype === "text/plain") {
      text = await fs.readFile(file.path, "utf8");
    } else {
      return res.status(400).json({ error: "Unsupported file type. Please upload PDF, DOC, DOCX, or TXT files." });
    }

    // Cleanup: remove uploaded file
    // await fs.unlink(file.path);

    if (!text || text.length < 30) {
      return res.status(400).json({ error: "Extracted text is too short to summarize." });
    }

    // Build summarization prompt
    let lengthInstruction = '';
    if (summaryLength === 'short') {
      lengthInstruction = 'Summarize the document in 1 paragraph.';
    } else if (summaryLength === 'long') {
      lengthInstruction = 'Summarize the document in around 5 paragraphs.';
    } else {
      lengthInstruction = 'Summarize the document in around 3 paragraphs.';
    }

    const prompt = `
You are a summarization expert. Summarize the following document content in ${language}.

${lengthInstruction}

Here is the document content:
${text}

Summary:
`;

    // Send to OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.3,
      messages: [{ role: "user", content: prompt }],
    });

    const summary = completion.choices[0].message.content.trim();
    res.json({ summary });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to process the file.' });
  }
});


// --- File upload route ---
// --- Helper: Analyze code block for UA issues ---
async function analyzeCode(codeText) {
  const prompt = `
You are a Universal Acceptance (UA) code reviewer expert, following the latest IDNA2008 standards.

You must analyze the following code snippet carefully.

🔵 Check for Universal Acceptance issues:
- Domain name normalization problems
- Email address validation problems
- Incorrect regex patterns (e.g., restricting TLD length, ASCII-only assumptions)
- Missing Unicode normalization (NFC)
- Punycode handling issues
- Server storage or processing issues regarding IDN/EAI

🔵 Then provide your analysis using EXACTLY the following format:

---
Rating (out of 100): [Your Score]

Detected Problems:
- [Problem 1]
- [Problem 2]

Suggested Improvements:
- [Suggestion 1]
- [Suggestion 2]

Overall Comment:
[General comment about the code's UA readiness]
---

🔵 Only use this format. Do not add any extra text or explanations outside the format.

Code Snippet:
\`\`\`
${codeText}
\`\`\`
`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0.2,
    messages: [{ role: "user", content: prompt }],
  });

  const answer = completion.choices[0].message.content.trim();
  return answer;
}

// --- POST /upload (upload multiple files) ---
app.post("/upload", upload.array("files"), (req, res) => {
  res.json({ message: "Files uploaded successfully." });
});

// --- GET /analyze (analyze uploaded files) ---
app.get("/analyze", async (req, res) => {
  try {
    const files = await readdir("./uploads");
    const reports = [];

    for (const file of files) {
      const filePath = path.join("./uploads", file);
      const content = await readFile(filePath, "utf8");

      const report = await analyzeCode(content);
      reports.push({ file, report });
    }

    res.json({ results: reports });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to analyze uploaded files." });
  }
});

let trainingChunks = [];

function findRelevantChunks2(code) {
  const codeLower = code.toLowerCase();

  // Find chunks that include at least part of the code text
  const matches = trainingChunks.filter((chunk) =>
    chunk.toLowerCase().includes(codeLower)
  );

  // If matches found, return top 3 matches
  if (matches.length > 0) {
    return matches.slice(0, 3);
  }

  // If no matches found, fallback to first two chunks
  return trainingChunks.slice(0, 2);
}

// --- POST /analyze-text (analyze code sent as text) ---
app.post("/analyze-text", async (req, res) => {
  const { code, language = "arabic" } = req.body; // default language is Arabic
  console.log("Code:", code);
  if (!code) {
    return res.status(400).json({ error: "No code text provided." });
  }

  try {
    const relevantChunks = findRelevantChunks2(code);

    if (relevantChunks.length === 0) {
      relevantChunks.push(...trainingChunks.slice(0, 2));
    }

    // Build the language-specific instruction
    let instruction;
    if (language.toLowerCase() === "arabic") {
      instruction = `
أنت خبير في فحص الأكواد وفق معايير التوافق الشامل (Universal Acceptance - UA) ومعايير IDNA2008.

حلل الكود التالي وحدد:
- درجة التوافق (من 100)
- قائمة بالمشاكل المكتشفة
- اقتراحات التحسين لكل مشكلة
- تعليق عام على جاهزية الكود من ناحية التوافق الشامل

التقرير يجب أن يكون بهذا الشكل:

---
التقييم (من 100): [الدرجة]

المشاكل المكتشفة:
- [مشكلة 1]
- [مشكلة 2]

التحسينات المقترحة:
- [تحسين لمشكلة 1]
- [تحسين لمشكلة 2]

تعليق عام:
[تعليق عام عن الكود]
---

إذا لم تجد مشكلة، اذكر ذلك بوضوح.
`;
    } else {
      instruction = `
You are a Universal Acceptance (UA) code review expert following IDNA2008 standards.

Analyze the following code snippet and provide:
- Rating (out of 100)
- List of detected problems
- Suggested improvements for each problem
- Overall comment about the code's UA readiness

Respond exactly in this format:

---
Rating (out of 100): [Score]

Detected Problems:
- [Problem 1]
- [Problem 2]

Suggested Improvements:
- [Suggestion 1]
- [Suggestion 2]

Overall Comment:
[General comment about UA readiness]
---

If no problems are found, mention that clearly.
`;
    }

    const prompt = `
${instruction}

Context:
${relevantChunks.join("\n\n")}

Code Snippet:
\`\`\`
${code}
\`\`\`
      `;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    });

    const report = completion.choices[0].message.content.trim();
    res.json({ report });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to analyze code text." });
  }
});

apiRouter.use("/", EmailRoutes); // This will handle /api/sendEmail
// Mount the apiRouter under /api
app.use("/api", apiRouter);


//
// --- Route to upload document ---
app.post("/upload-doc-chat", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded." });
    console.log("Uploaded:", file.path);

    // Clear previous uploaded content
    uploadedChunks = [];
    uploadedEmbeddings = [];

    let text = "";

    // Determine the file type and extract text accordingly
    const mimetype = file.mimetype;
    if (mimetype === "application/pdf") {
      text = await extractTextFromPDF(file.path);
    } else if (
      mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      mimetype === "application/msword"
    ) {
      const data = await readFile(file.path);
      const result = await mammoth.extractRawText({ buffer: data });
      text = result.value;
    } else if (mimetype === "text/plain") {
      text = await readFile(file.path, "utf8");
    } else {
      return res.status(400).json({ error: "Unsupported file type. Please upload PDF, DOC, DOCX, or TXT files." });
    }

    // Split text into chunks and generate embeddings
    const words = text.split(" ");
    const chunkSize = 300;

    for (let i = 0; i < words.length; i += chunkSize) {
      const chunk = words.slice(i, i + chunkSize).join(" ").trim();
      uploadedChunks.push(chunk);

      const embeddingResponse = await openai.embeddings.create({
        model: "text-embedding-ada-002",
        input: chunk,
      });
      uploadedEmbeddings.push(embeddingResponse.data[0].embedding);
    }

    res.json({ message: "Document uploaded and processed successfully." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to process document." });
  }
});

// --- Route to chat with uploaded document ---
app.post("/ask-doc-chat", async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: "No question provided." });

  if (uploadedChunks.length === 0 || uploadedEmbeddings.length === 0) {
    return res.status(400).json({ error: "No document uploaded yet." });
  }

  try {
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: question,
    });
    const questionEmbedding = embeddingResponse.data[0].embedding;

    const similarities = uploadedEmbeddings.map(embedding =>
      cosineSimilarity(embedding, questionEmbedding)
    );

    const topIndices = similarities
      .map((sim, idx) => ({ sim, idx }))
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 3)
      .map(obj => obj.idx);

    const relevantChunks = topIndices.map(idx => uploadedChunks[idx]);

    const prompt = `
Answer in the same language of the question.

Context:
${relevantChunks.join("\n\n")}

Question:
${question}

Answer:
    `;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    });

    const answer = completion.choices[0].message.content.trim();
    res.json({ answer });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to generate answer." });
  }
});


async function extractUploadedText(filePath, mimetype) {
  const fullPath = path.resolve(filePath);
  const fileStats = await stat(fullPath);

  if (fileStats.size === 0) {
    throw new Error('Uploaded file is empty.');
  }

  if (mimetype === 'application/pdf') {
    console.log('Extracting text from PDF...');
    const pdfParser = new PDFParser();
    return new Promise((resolve, reject) => {
      pdfParser.on("pdfParser_dataError", errData => {
        console.error('Error parsing PDF:', errData.parserError);
        reject(new Error('Failed to parse PDF.'));
      });

      pdfParser.on("pdfParser_dataReady", async pdfData => {
        try {
          if (!pdfData?.formImage?.Pages) {
            console.warn('PDF has no formImage.Pages structure. Attempting OCR...');
            const ocrText = await performOCR(fullPath);
            if (ocrText.trim().length === 0) {
              reject(new Error('The uploaded PDF does not contain readable text. Please upload a proper PDF.'));
            } else {
              resolve(ocrText);
            }
            return;
          }

          const pages = pdfData.formImage.Pages;
          const pageTexts = pages.map(page => {
            const texts = page.Texts.map(textItem => {
              try {
                const decodedText = decodeURIComponent(textItem.R[0]?.T || '');
                // Reorder text for Arabic (RTL) using bidi
                const reorderedText = bidi.fromLogical(decodedText);
                return reorderedText;
              } catch (err) {
                console.error('Error decoding text item:', err.message);
                return ''; // Fallback to empty string if decoding fails
              }
            });
            return texts.join(' ');
          });

          const fullText = pageTexts.join('\n\n');

          if (fullText.trim().length < 500) {
            reject(new Error('The extracted PDF text is too short. Please upload a better quality PDF.'));
          } else {
            resolve(fullText);
          }
        } catch (err) {
          console.error('Error processing PDF text:', err.message);
          reject(new Error('Failed to properly extract PDF content.'));
        }
      });

      pdfParser.loadPDF(fullPath);
    });
  } else if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const data = await readFile(fullPath);
    const result = await mammoth.extractRawText({ buffer: data });
    console.log('Extracted text from DOCX:', result.value);
    return result.value;
  } else if (mimetype === 'text/plain') {
    let data = await readFile(fullPath, 'utf8');
    console.log('Extracted text from TXT:', data);
    return data;
  } else {
    throw new Error('Unsupported file type. Please upload PDF, DOCX, or TXT.');
  }
}

// async function performOCR(filePath) {
//   console.log('Performing OCR on scanned PDF...');

//   // Step 1: Convert PDF to images
//   const outputDir = path.resolve('./temp_images');
//   if (!fs.existsSync(outputDir)) {
//     fs.mkdirSync(outputDir);
//   }

//   const options = {
//     format: 'jpeg', // Output format
//     out_dir: outputDir,
//     out_prefix: path.basename(filePath, path.extname(filePath)),
//     page: null, // Process all pages
//   };

//   try {
//     console.log('Converting PDF to images...');
//     await pdfPoppler.convert(filePath, options);
//     console.log('PDF converted to images.');

//     // Step 2: Perform OCR on each image
//     const imageFiles = fs.readdirSync(outputDir).filter(file => file.endsWith('.jpeg'));
//     let fullText = '';

//     for (const imageFile of imageFiles) {
//       const imagePath = path.join(outputDir, imageFile);
//       console.log(`Processing image: ${imagePath}`);

//       const { data: { text } } = await Tesseract.recognize(imagePath, 'eng+ara', {
//         langPath: path.resolve('./tessdata'), // Path to the local tessdata directory
//         logger: info => console.log(info), // Log OCR progress
//       });

//       fullText += text + '\n';
//     }

//     console.log('OCR extraction complete.');
//     return fullText.trim();
//   } catch (error) {
//     console.error('Error during OCR:', error.message);
//     throw new Error('Failed to extract text using OCR.');
//   } finally {
//     // Clean up temporary images
//     fs.rmSync(outputDir, { recursive: true, force: true }); // Updated to use fs.rmSync
//   }
// }


async function extractTextFromPDF(filePath) {
  const dataBuffer = fs.readFileSync(filePath);
  const pdfData = await pdf(dataBuffer);
  return pdfData.text; // Extracted text from the PDF
}

async function chatWithPDF(filePath, question) {
  try {
    // Step 1: Extract text from the PDF
    const pdfText = await extractTextFromPDF(filePath);
    console.log('Extracted PDF text:', pdfText);
    // Step 2: Create a prompt with the extracted text and the user's question
    const prompt = `
The following is the content of a PDF document:

${pdfText}

Question:
${question}

Answer:
    `;

    // Step 3: Send the prompt to ChatGPT
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    });

    const answer = completion.choices[0].message.content.trim();
    console.log('ChatGPT Answer:', answer);
    return answer;
  } catch (error) {
    console.error('Error:', error.message);
    throw new Error('Failed to process the PDF or generate a response.');
  }
}

// // Example usage
// chatWithPDF('./GPT_API.pdf', 'What is the main topic of this document?')
//   .then(answer => console.log('Answer:', answer))
//   .catch(err => console.error('Error:', err.message));





// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", async () => {
  await loadUAContent();
  console.log(
    `Server running at http://${process.env.HOST || "localhost"}:${PORT}`
  );
});
