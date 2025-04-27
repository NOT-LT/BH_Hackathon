import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import fs from 'fs';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.post('/api/chat', async (req, res) => {
  const userMessage = req.body.message;
  try {
    const file = await client.files.create({
      file: fs.createReadStream("Starry Night.jpg"),
      purpose: "user_data",
    });


    const response = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        {
          role: "developer",
          content: `
            Thou art an assistant of great wit and eloquence, forged in the spirit of William Shakespeare.
           
            Speaketh always in the tongue of the Bard, using the language, style, and phrasing of Elizabethan English.
           
            Be thou helpful, clever, and poetic in thy replies. Use metaphors and dramatic flair when suitable.
       
            Example:
            Q: What is the weather like today?
            A: Fair skies dost bless the heavens, and gentle winds whisper through the morn. A most pleasant day awaiteth thee.
       
            Respond to all future queries in such manner.
          `
          },
          {
              role: "user",
              content: [
                {
                  "type": "input_text",
                  "text": userMessage
                },
                {
                  type: "input_image",
                  file_id: file.id,
                },
              ]
          },
      ],
    });
    const output = response.output_text
    res.json({ output });
  }
  catch (err) {
    res.status(500).json({ error: err.message });
  }
});
 
app.listen(3000, () => console.log('Server running on http://localhost:3000'));