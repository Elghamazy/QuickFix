// api/generate.js
const { GoogleGenerativeAI } = require("@google/generative-ai");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const API_KEY = process.env.API_KEY;
const MODEL_ID = "gemini-2.5-flash-preview-05-20";

const SYSTEM_PROMPT = `You are QuickFix, a helpful assistant that provides straightforward, step-by-step instructions for everyday tasks and questions.

You must respond with a JSON object in the following format:
{
  "title": "Brief title describing the task",
  "summary": "One sentence summary of what this accomplishes",
  "steps": [
    "Step 1 description",
    "Step 2 description",
    "Step 3 description"
  ],
  "tips": ["Optional helpful tip 1", "Optional helpful tip 2"],
  "timeEstimate": "Estimated time to complete (e.g., '5 minutes', '30 seconds')",
  "difficulty": "easy|medium|hard"
}

Guidelines:
- Keep steps concise and actionable
- Use plain, friendly language
- Include 2-8 steps typically
- Tips are optional but helpful
- Always provide realistic time estimates
- Set difficulty appropriately

Example:
User: How can I make pasta?
Response:
{
  "title": "Cook Basic Pasta",
  "summary": "Boil pasta in salted water until tender",
  "steps": [
    "Fill a large pot with water and bring to a rolling boil",
    "Add 1-2 tablespoons of salt to the boiling water",
    "Add pasta and stir occasionally to prevent sticking",
    "Cook for 8-12 minutes (check package directions)",
    "Drain pasta in a colander and serve immediately"
  ],
  "tips": [
    "Use about 4-6 quarts of water per pound of pasta",
    "Save some pasta water before draining - it's great for sauce"
  ],
  "timeEstimate": "15 minutes",
  "difficulty": "easy"
}`;

let genAI;
if (GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
}

export default async function handler(req, res) {
  // Allow both GET and POST requests
  if (req.method !== "POST" && req.method !== "GET") {
    return res
      .status(405)
      .json({ error: "Method not allowed. Use GET or POST." });
  }

  // Check API key authentication
  const providedApiKey =
    req.headers["x-api-key"] ||
    req.headers["authorization"]?.replace("Bearer ", "") ||
    req.query.api_key; // Allow API key in query params for GET requests

  if (!API_KEY) {
    return res
      .status(500)
      .json({ error: "API_KEY is not configured on server." });
  }

  if (!providedApiKey) {
    return res.status(401).json({
      error: "API key is required.",
      methods: {
        POST: "Provide in 'x-api-key' header or 'Authorization: Bearer <key>' header",
        GET: "Provide in 'api_key' query parameter, 'x-api-key' header, or 'Authorization: Bearer <key>' header",
      },
    });
  }

  if (providedApiKey !== API_KEY) {
    return res.status(403).json({ error: "Invalid API key." });
  }

  if (!GEMINI_API_KEY || !genAI) {
    return res.status(500).json({ error: "GEMINI_API_KEY is not configured." });
  }

  // Extract prompt from request body (POST) or query params (GET)
  let userPrompt;
  if (req.method === "POST") {
    userPrompt = req.body.prompt;
  } else if (req.method === "GET") {
    userPrompt = req.query.prompt || req.query.q;
  }

  if (!userPrompt) {
    return res.status(400).json({
      error: "Prompt is required.",
      usage: {
        POST: "Include 'prompt' in request body JSON",
        GET: "Include 'prompt' or 'q' as query parameter",
      },
    });
  }

  try {
    const model = genAI.getGenerativeModel({
      model: MODEL_ID,
      generationConfig: {
        temperature: 0.1,
        topP: 0.8,
        topK: 40,
        maxOutputTokens: 1024,
      },
    });

    const fullPrompt = `${SYSTEM_PROMPT}

User: ${userPrompt}
Response:`;

    const result = await model.generateContent(fullPrompt);
    const response = await result.response;
    const text = response.text();

    if (!text && response.promptFeedback?.blockReason) {
      return res.status(400).json({
        success: false,
        error: "Content generation blocked",
        reason: response.promptFeedback.blockReason,
      });
    }

    // Parse the JSON response from Gemini
    let parsedResponse;
    try {
      // Clean up the response text (remove any markdown formatting)
      const cleanText = text
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();
      parsedResponse = JSON.parse(cleanText);
    } catch (parseError) {
      console.error("Failed to parse Gemini response as JSON:", parseError);
      console.error("Raw response:", text);

      // Fallback: return the raw text in a structured format
      return res.status(200).json({
        success: true,
        data: {
          title: "QuickFix Response",
          summary: "Generated response",
          content: text,
          steps: [],
          tips: [],
          timeEstimate: "Unknown",
          difficulty: "unknown",
        },
        metadata: {
          timestamp: new Date().toISOString(),
          model: MODEL_ID,
          parseError: "Response was not valid JSON",
        },
      });
    }

    // Validate required fields
    const requiredFields = ["title", "summary", "steps"];
    const missingFields = requiredFields.filter(
      (field) => !parsedResponse[field],
    );

    if (missingFields.length > 0) {
      return res.status(200).json({
        success: true,
        data: {
          title: parsedResponse.title || "QuickFix Response",
          summary: parsedResponse.summary || "Generated response",
          steps: Array.isArray(parsedResponse.steps)
            ? parsedResponse.steps
            : [],
          tips: Array.isArray(parsedResponse.tips) ? parsedResponse.tips : [],
          timeEstimate: parsedResponse.timeEstimate || "Unknown",
          difficulty: parsedResponse.difficulty || "unknown",
          content: text,
        },
        metadata: {
          timestamp: new Date().toISOString(),
          model: MODEL_ID,
          warning: `Missing fields: ${missingFields.join(", ")}`,
        },
      });
    }

    // Return successful structured response
    res.status(200).json({
      success: true,
      data: {
        title: parsedResponse.title,
        summary: parsedResponse.summary,
        steps: parsedResponse.steps,
        tips: parsedResponse.tips || [],
        timeEstimate: parsedResponse.timeEstimate || "Unknown",
        difficulty: parsedResponse.difficulty || "unknown",
      },
      metadata: {
        timestamp: new Date().toISOString(),
        model: MODEL_ID,
        stepCount: parsedResponse.steps?.length || 0,
      },
    });
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    res.status(500).json({
      success: false,
      error: "Failed to generate response",
      details: error.message,
    });
  }
}
