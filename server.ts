import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';

// Multi-Key Rotation & Auto-Failover Engine
function getGeminiApiKeys(): string[] {
  const keys: string[] = [];

  // Check comma-separated list
  if (process.env.GEMINI_API_KEYS) {
    keys.push(...process.env.GEMINI_API_KEYS.split(',').map(k => k.trim()).filter(Boolean));
  }

  // Check default GEMINI_API_KEY (can also be comma-separated)
  if (process.env.GEMINI_API_KEY) {
    keys.push(...process.env.GEMINI_API_KEY.split(',').map(k => k.trim()).filter(Boolean));
  }

  // Check indexed variables (GEMINI_API_KEY_1 to GEMINI_API_KEY_10)
  for (let i = 1; i <= 10; i++) {
    const key = process.env[`GEMINI_API_KEY_${i}`];
    if (key && key.trim()) {
      keys.push(key.trim());
    }
  }

  // Filter out undefined, empty, or duplicate keys
  const uniqueKeys = Array.from(new Set(keys)).filter(k => Boolean(k) && k !== 'undefined' && k !== 'null');
  return uniqueKeys;
}

let currentKeyIndex = 0;

async function executeWithKeyRotation<T>(
  operation: (aiClient: GoogleGenAI, apiKey: string) => Promise<T>
): Promise<T> {
  const keys = getGeminiApiKeys();
  if (keys.length === 0) {
    throw new Error('No Gemini API key found. Please set GEMINI_API_KEY or GEMINI_API_KEY_2..6 in Settings / environment variables.');
  }

  let lastError: any = null;
  const totalKeys = keys.length;

  for (let attempt = 0; attempt < totalKeys; attempt++) {
    const keyIdx = (currentKeyIndex + attempt) % totalKeys;
    const apiKey = keys[keyIdx];

    try {
      const client = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      const result = await operation(client, apiKey);
      // Advance to next key for load balancing
      currentKeyIndex = (keyIdx + 1) % totalKeys;
      return result;
    } catch (err: any) {
      const maskedKey = apiKey.length > 8 ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : '***';
      console.warn(`[KeyRotation] API call failed on key #${keyIdx + 1} (${maskedKey}):`, err?.message || err);
      lastError = err;
      // Continue to next available key in the rotation pool
    }
  }

  throw lastError || new Error('All Gemini API keys in the rotation pool failed.');
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  const flattenQuestions = (questions: any[]): any[] => {
    if (!Array.isArray(questions)) return [];
    const result: any[] = [];
    questions.forEach((q: any) => {
      const rows = q.rows || q.gridRows || q.subQuestions;
      if (Array.isArray(rows) && rows.length > 0) {
        rows.forEach((row: any) => {
          const topTitle = (q.title || q.name || q.label || '').trim();
          const rowTitle = (row.title || row.label || row.name || '').trim();
          const fullTitle = topTitle && rowTitle ? `${topTitle} → ${rowTitle}` : (rowTitle || topTitle);

          result.push({
            entryId: row.entryId || row.id || row.entry_id || q.entryId,
            title: fullTitle,
            type: q.type || 'multiple_choice_grid',
            options: row.options || row.choices || row.values || q.options || [],
            sectionId: q.sectionId ?? row.sectionId ?? 0
          });
        });
      } else {
        result.push({
          entryId: q.entryId || q.id || q.entry_id,
          title: q.title || q.name || q.label,
          type: q.type,
          options: q.options || q.choices || q.values || [],
          sectionId: q.sectionId ?? 0
        });
      }
    });
    return result;
  };

  // Masked URL Redirect endpoint to hide raw Google Form parameter structure
  app.get('/r/:token', (req, res) => {
    try {
      const token = req.params.token;
      // Convert base64url back to original URL
      const base64 = token.replace(/-/g, '+').replace(/_/g, '/');
      const targetUrl = Buffer.from(base64, 'base64').toString('utf-8');
      if (targetUrl.startsWith('http://') || targetUrl.startsWith('https://')) {
        return res.redirect(302, targetUrl);
      }
    } catch (e) {
      console.error('Redirect token error:', e);
    }
    res.status(400).send('Invalid or expired response link');
  });

  app.post('/api/submit-single-form', async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) {
        return res.status(400).json({ error: 'URL is required' });
      }
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      res.json({ success: true, status: response.status });
    } catch (err: any) {
      console.error('Form auto-submit error:', err);
      // Even if fetch throws on CORS/redirect, try GET fallback
      try {
        const getResp = await fetch(req.body.url, { method: 'GET' });
        res.json({ success: true, status: getResp.status });
      } catch (e2: any) {
        res.status(500).json({ error: e2.message || 'Failed to submit form' });
      }
    }
  });

  app.post('/api/generate-personas', async (req, res) => {
    try {
      const { questions, count } = req.body;
      const flatQuestions = flattenQuestions(questions);
      
      const prompt = `
        Here is the complete guide on how to create personas conceptually, domain-wise, and programmatically.
        Step 1: The 4 Pillars of a Persona
        Every persona should be defined across 4 core pillars: Demographics, Behaviors, Mindset/Traits, and Pain Points.
        
        Step 2: The "3-to-5 Persona Strategy"
        Structure your personas around classic archetypes:
        - The Innovator / Power User
        - The Traditional / Skeptic
        - The Pragmatic Middle
        - The Outlier / Edge Case
        
        Step 3: Tailor Personas to the Specific Form Domain
        Analyze the form's topic from its questions and infer the target audience.
        
        Task:
        Generate ${count || 3} highly distinct, realistic personas for the provided Google Form following the guide above.
        For each persona, you MUST provide their EXACT answers to the form's questions in the 'answers' object, mapped by 'entryId'.
        
        CRITICAL RULES:
        1. STRICT CASE-SENSITIVE OPTION MATCHING:
           - Google Forms option matching is strictly CASE-SENSITIVE.
           - When sampling a categorical choice or scale choice for an entry ID, ALWAYS select the exact string directly from the extracted q.options array.
           - DO NOT re-format, lowercase, or transform option strings (e.g., if extracted option is "Strongly Disagree", the payload MUST use "Strongly Disagree", NOT "Strongly disagree").
           
        2. MULTIPLE-CHOICE MATRIX / GRID HANDLING:
           - Detect matrix/grid questions where multiple sub-rows exist under the same parent question or construct.
           - Treat each grid sub-row as an individual entryId, but sample ALL sub-rows within the same grid using the SAME persona latent trait score. This guarantees consistent, natural Likert ratings across all rows of a matrix question (e.g., if a persona is supportive, they will rate "Agree"/"Strongly Agree" across the grid rows consistently).

        3. OPEN-ENDED RESPONSES:
           - For open-ended text questions, DO NOT write perfect, formal, or "AI-sounding" English.
           - Introduce human irregularities: minor typos, casual casing, colloquialisms, short sentences.
           - Use a mix of languages across personas: English, Nepali (Devanagari like "धेरै राम्रो छ"), and Nepanglish ("ekdam ramro lagyo", "thik chha").
           - Keep responses varied in length.
        
        Form Questions (with entryIds and options):
        ${JSON.stringify(flatQuestions.map((q: any) => ({
          entryId: q.entryId,
          title: q.title,
          type: q.type,
          options: q.options
        })), null, 2)}
      `;

      const answerProperties: Record<string, any> = {};
      const answerRequired: string[] = [];
      flatQuestions.forEach((q: any) => {
        const id = q.entryId;
        if (id && id !== '-') {
          answerProperties[id] = { type: Type.STRING };
          answerRequired.push(id);
        }
      });

      const response = await executeWithKeyRotation(async (aiClient) => {
        return await aiClient.models.generateContent({
          model: 'gemini-3.6-flash',
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  name: { type: Type.STRING },
                  archetype: { type: Type.STRING },
                  demographics: {
                    type: Type.OBJECT,
                    properties: {
                      age: { type: Type.STRING },
                      gender: { type: Type.STRING },
                      occupation: { type: Type.STRING },
                      country: { type: Type.STRING }
                    },
                    required: ["age", "gender", "occupation", "country"]
                  },
                  behaviors: { type: Type.STRING },
                  mindset: { type: Type.STRING },
                  painPoints: { type: Type.STRING },
                  answers: {
                    type: Type.OBJECT,
                    description: "A map where the key is the question's entryId and the value is the exact string answer.",
                    properties: answerProperties,
                    required: answerRequired.length > 0 ? answerRequired : undefined
                  }
                },
                required: ["id", "name", "archetype", "demographics", "behaviors", "mindset", "painPoints", "answers"]
              }
            }
          }
        });
      });

      const personas = JSON.parse(response.text || "[]");
      res.json({ personas });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to generate personas" });
    }
  });

  app.post('/api/generate-random-responses', async (req, res) => {
    try {
      const { questions, count } = req.body;
      const numCount = Math.min(Math.max(parseInt(count) || 5, 1), 50);
      const flatQuestions = flattenQuestions(questions);

      const prompt = `
        Task:
        Generate ${numCount} completely UNCORRELATED, RANDOM, independent survey responses for the provided Google Form questions.
        
        CRITICAL RULES FOR UNCORRELATED RANDOMIZATION:
        1. Every response must be completely independent from all other responses (ZERO correlation across questions or responses).
        2. STRICT CASE-SENSITIVE OPTION MATCHING:
           - Google Forms option matching is strictly CASE-SENSITIVE.
           - When sampling a categorical choice or scale choice for an entry ID, ALWAYS select the exact string directly from the extracted q.options array.
           - DO NOT re-format, lowercase, or transform option strings (e.g., if extracted option is "Strongly Disagree", the payload MUST use "Strongly Disagree", NOT "Strongly disagree").
        3. For multiple-choice, dropdown, checkbox, or scale questions: Select choices completely at random from the available options. Distribute choices evenly across responses.
        4. For all open-ended text / paragraph questions: Use EXACTLY the text "Sample response" for every text response. Do not generate custom themes or correlated text.
        
        Form Questions:
        ${JSON.stringify(flatQuestions.map((q: any) => ({
          entryId: q.entryId,
          title: q.title,
          type: q.type,
          options: q.options
        })), null, 2)}
      `;

      const answerProperties: Record<string, any> = {};
      const answerRequired: string[] = [];
      flatQuestions.forEach((q: any) => {
        const id = q.entryId;
        if (id && id !== '-') {
          answerProperties[id] = { type: Type.STRING };
          answerRequired.push(id);
        }
      });

      const response = await executeWithKeyRotation(async (aiClient) => {
        return await aiClient.models.generateContent({
          model: 'gemini-3.6-flash',
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  answers: {
                    type: Type.OBJECT,
                    description: "Map of question entryId to exact answer string",
                    properties: answerProperties,
                    required: answerRequired.length > 0 ? answerRequired : undefined
                  }
                },
                required: ["answers"]
              }
            }
          }
        });
      });

      const items = JSON.parse(response.text || "[]");
      res.json({ items });
    } catch (error) {
      console.error('Random response generation error:', error);
      res.status(500).json({ error: "Failed to generate random responses" });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
