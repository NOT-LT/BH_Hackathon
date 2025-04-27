import express from 'express';
import { OpenAI } from 'openai';
import { config } from 'dotenv';
import fetch from 'node-fetch'; // Important for embedding
import fs from 'fs';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import multer from 'multer';

const EMBEDDINGS_FILE = './embeddings.json';
async function saveEmbeddings(embeddings) {
  await writeFile(EMBEDDINGS_FILE, JSON.stringify(embeddings), 'utf8');
  console.log('Saved embeddings to file.');
}

const upload = multer({ dest: 'uploads/' });

async function loadEmbeddings() {
  if (fs.existsSync(EMBEDDINGS_FILE)) {
      const data = await readFile(EMBEDDINGS_FILE, 'utf8');
      console.log('Loaded embeddings from file.');
      return JSON.parse(data);
  }
  return null;
}

config();
globalThis.fetch = fetch; // Needed because openai uses fetch

const app = express();
app.use(express.json());

// --- OpenAI setup ---
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

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
  const text = await readFile('./ua_cleaned_v2.txt', 'utf8');
  const words = text.split(' ');
  const chunkSize = 300;

  for (let i = 0; i < words.length; i += chunkSize) {
      const chunk = words.slice(i, i + chunkSize).join(' ').trim();
      uaChunks.push(chunk);
  }

  console.log(`Loaded ${uaChunks.length} chunks.`);

  // Check if embeddings already saved
  const savedEmbeddings = await loadEmbeddings();
  if (savedEmbeddings) {
      uaEmbeddings = savedEmbeddings;
      return;
  }

  console.log('Now creating embeddings...');

  for (const chunk of uaChunks) {
      const embeddingResponse = await openai.embeddings.create({
          model: 'text-embedding-ada-002',
          input: chunk,
      });
      uaEmbeddings.push(embeddingResponse.data[0].embedding);
  }

  await saveEmbeddings(uaEmbeddings);
  console.log('Generated and saved embeddings.');
}


// --- Find best matches based on embeddings ---
async function findRelevantChunks(question) {
    const embeddingResponse = await openai.embeddings.create({
        model: 'text-embedding-ada-002',
        input: question,
    });
    const questionEmbedding = embeddingResponse.data[0].embedding;

    // Calculate cosine similarity for each chunk
    const similarities = uaEmbeddings.map(chunkEmbedding => cosineSimilarity(chunkEmbedding, questionEmbedding));

    // Sort by similarity descending
    const topIndices = similarities
        .map((sim, idx) => ({ sim, idx }))
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 3) // Top 3 most similar
        .map(obj => obj.idx);

    return topIndices.map(idx => uaChunks[idx]);
}

// --- Routes ---
app.get('/', (req, res) => {
    res.send('Welcome to the UA Chatbot API! Use POST /ask to ask questions.');
});

app.post('/ask', async (req, res) => {3
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: 'No question provided.' });

    try {
        const relevantChunks = await findRelevantChunks(question);
        const prompt = `Answer in Arabic Language.
You are a Universal Acceptance (UA) expert and you use the latest IDN standard called IDNA2008 for IDNs.
Answer primarly based on the information provided. If the context does not contain enough information to answer, use your own knowledge."
Context:
${relevantChunks.join('\n\n')}

Question:
${question}

Answer:
        `;

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o',
            temperature: 0.2, // Lower for more factual answers
            messages: [{ role: 'user', content: prompt }],
        });

        const answer = completion.choices[0].message.content.trim();
        res.json({ answer });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to process request.' });
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
      model: 'gpt-4o',
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }],
  });

  const answer = completion.choices[0].message.content.trim();
  return answer;
}


// --- POST /upload (upload multiple files) ---
app.post('/upload', upload.array('files'), (req, res) => {
  res.json({ message: 'Files uploaded successfully.' });
});

// --- GET /analyze (analyze uploaded files) ---
app.get('/analyze', async (req, res) => {
  try {
      const files = await readdir('./uploads');
      const reports = [];

      for (const file of files) {
          const filePath = path.join('./uploads', file);
          const content = await readFile(filePath, 'utf8');

          const report = await analyzeCode(content);
          reports.push({ file, report });
      }

      res.json({ results: reports });
  } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to analyze uploaded files.' });
  }
});

let trainingChunks = [];

function findRelevantChunks2(code) {
  const codeLower = code.toLowerCase();

  // Find chunks that include at least part of the code text
  const matches = trainingChunks.filter(chunk => chunk.toLowerCase().includes(codeLower));

  // If matches found, return top 3 matches
  if (matches.length > 0) {
      return matches.slice(0, 3);
  }

  // If no matches found, fallback to first two chunks
  return trainingChunks.slice(0, 2);
}

// --- POST /analyze-text (analyze code sent as text) ---
app.post('/analyze-text', async (req, res) => {
  const { code, language = 'arabic' } = req.body; // default language is Arabic

  if (!code) {
      return res.status(400).json({ error: 'No code text provided.' });
  }

  try {
    const relevantChunks = findRelevantChunks2(code);

    if (relevantChunks.length === 0) {
        relevantChunks.push(...trainingChunks.slice(0, 2));
    }
    
  

      // Build the language-specific instruction
      let instruction;
      if (language.toLowerCase() === 'arabic') {
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
${relevantChunks.join('\n\n')}

Code Snippet:
\`\`\`
${code}
\`\`\`
      `;

      const completion = await openai.chat.completions.create({
          model: 'gpt-4o',
          temperature: 0.2,
          messages: [{ role: 'user', content: prompt }],
      });

      const report = completion.choices[0].message.content.trim();
      res.json({ report });
  } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to analyze code text.' });
  }
});


// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    await loadUAContent();
    console.log(`Server running at http://localhost:${PORT}`);
});
