// server.ts - Multi-tier AI Proxy Server for Karthika AI Shopping Assistant
import http from "node:http";

const PORT = Number(process.env.PORT) || 3001;

// NVIDIA configuration
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "";
const NVIDIA_BASE_URL = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || "nvidia/nemotron-3-super-120b-a12b";

// OpenRouter configuration
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "z-ai/glm-5.2:free";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

// Helper to parse JSON body in standard Node.js
function getRequestBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", (err) => reject(err));
  });
}

const server = http.createServer(async (req, res) => {
  const host = req.headers.host || `localhost:${PORT}`;
  const url = new URL(req.url || "/", `http://${host}`);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  // Health check
  if (url.pathname === "/api/health" || url.pathname === "/health") {
    res.writeHead(200, corsHeaders);
    res.end(JSON.stringify({
      status: "ok",
      primary_model: NVIDIA_MODEL,
      openrouter_model: OPENROUTER_MODEL,
    }));
    return;
  }

  // AI Assistant Generation Endpoint
  if (url.pathname === "/api/ai-assistant" && req.method === "POST") {
    let prompt = "";
    try {
      const body = await getRequestBody(req);
      prompt = body.prompt?.trim() || "";

      if (!prompt) {
        res.writeHead(400, corsHeaders);
        res.end(JSON.stringify({ error: "Prompt is required" }));
        return;
      }

      const systemMessage = `You are the Karthika Supermarket AI Cooking & Shopping Assistant for an authentic South Indian and Kerala grocery store.
When a user specifies a dish they want to cook, return a shopping basket in STRICT JSON format with NO markdown codeblock, NO backticks, and NO conversational explanation.

CRITICAL RULES:
- ONLY list ingredients that are genuinely required for the named dish.
- Ingredients must be cuisine-appropriate and realistic for how the dish is actually cooked.
- NEVER include ingredients that do not belong in the dish (e.g. avocado does not belong in fish curry).
- Use authentic South Indian / Kerala ingredient names where applicable.
- Aim for 4-6 ingredients that represent the most important items to buy.

FEW-SHOT EXAMPLE — for dish "fish curry":
{
  "title": "Kerala Fish Curry Meal Kit",
  "price": "$19.80",
  "ingredients": [
    "✓ Fresh Kingfish Steaks (500g) — $10.50",
    "✓ Fresh Grated Coconut / Coconut Milk — $3.20",
    "✓ Kudampuli (Malabar Tamarind) & Curry Leaves — $2.60",
    "✓ Karthika Fish Curry Masala & Fenugreek — $3.50"
  ]
}

Return ONLY the JSON object. No extra text, no markdown fences.`;

      // Helper to call OpenAI-compatible endpoints (NVIDIA, OpenRouter)
      async function callProvider(baseUrl: string, apiKey: string, model: string, extraHeaders: Record<string, string> = {}) {
        if (!apiKey) throw new Error(`Missing API Key for model ${model}`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000); // 12s timeout

        try {
          const apiRes = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKey}`,
              ...extraHeaders,
            },
            body: JSON.stringify({
              model,
              messages: [
                { role: "system", content: systemMessage },
                { role: "user", content: `Dish: "${prompt}". Return only the JSON object with title, price, ingredients list.` }
              ],
              temperature: 0.2,
              max_tokens: 800,
            }),
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          return apiRes;
        } catch (e) {
          clearTimeout(timeoutId);
          throw e;
        }
      }

      // Ordered list of candidate models to try in sequence
      const modelPipeline = [
        // 1. NVIDIA Primary
        {
          name: `NVIDIA (${NVIDIA_MODEL})`,
          call: () => callProvider(NVIDIA_BASE_URL, NVIDIA_API_KEY, NVIDIA_MODEL),
        },
        // 2. NVIDIA High-Capacity Backup
        {
          name: "NVIDIA (meta/llama-3.3-70b-instruct)",
          call: () => callProvider(NVIDIA_BASE_URL, NVIDIA_API_KEY, "meta/llama-3.3-70b-instruct"),
        },
        // 3. OpenRouter Model
        {
          name: `OpenRouter (${OPENROUTER_MODEL})`,
          call: () => callProvider(OPENROUTER_BASE_URL, OPENROUTER_API_KEY, OPENROUTER_MODEL, {
            "HTTP-Referer": "https://karthika-demo-cjracfc7.myshopify.com",
            "X-Title": "Karthika AI Assistant",
          }),
        },
        // 4. OpenRouter Free Fallback
        {
          name: "OpenRouter (meta-llama/llama-3.3-70b-instruct:free)",
          call: () => callProvider(OPENROUTER_BASE_URL, OPENROUTER_API_KEY, "meta-llama/llama-3.3-70b-instruct:free", {
            "HTTP-Referer": "https://karthika-demo-cjracfc7.myshopify.com",
            "X-Title": "Karthika AI Assistant",
          }),
        },
      ];

      let parsedResult: any = null;

      for (const candidate of modelPipeline) {
        try {
          console.log(`[AI Proxy] Trying ${candidate.name}...`);
          const response = await candidate.call();

          if (!response.ok) {
            const errorText = await response.text().catch(() => "");
            console.warn(`[AI Proxy] ${candidate.name} returned status ${response.status}: ${errorText.slice(0, 120)}`);
            continue;
          }

          const aiData: any = await response.json();
          const rawContent = aiData.choices?.[0]?.message?.content?.trim() || "";
          console.log(`[AI Proxy] RAW response from ${candidate.name}:`, rawContent);

          // Clean markdown code fence if present
          const cleanContent = rawContent.replace(/```json/gi, "").replace(/```/g, "").trim();
          const jsonMatch = cleanContent.match(/\{[\s\S]*\}/);

          if (jsonMatch) {
            parsedResult = JSON.parse(jsonMatch[0]);
          } else {
            parsedResult = JSON.parse(cleanContent);
          }

          if (parsedResult && parsedResult.title && Array.isArray(parsedResult.ingredients) && parsedResult.ingredients.length > 0) {
            console.log(`[AI Proxy] Successfully generated with ${candidate.name}`);
            console.log(`[AI Proxy] Final ingredient list being sent to frontend:`, JSON.stringify(parsedResult.ingredients, null, 2));
            break;
          }
        } catch (err: any) {
          console.warn(`[AI Proxy] ${candidate.name} failed:`, err?.message || err);
        }
      }

      // Guaranteed fallback if all upstream AI models failed
      if (!parsedResult || !parsedResult.title || !Array.isArray(parsedResult.ingredients)) {
        console.log("[AI Proxy] Using smart dish kit generator fallback for:", prompt);
        parsedResult = {
          title: `${prompt.charAt(0).toUpperCase() + prompt.slice(1)} Fresh Meal Kit`,
          price: "$18.50",
          ingredients: [
            `✓ Fresh Main Ingredients for ${prompt} — $10.20`,
            `✓ Authentic Karthika Spices & Curry Masala — $4.50`,
            `✓ Fresh Curry Leaves, Coconut & Aromatics — $3.80`
          ]
        };
      }

      res.writeHead(200, corsHeaders);
      res.end(JSON.stringify(parsedResult));
      return;
    } catch (err: any) {
      console.error("Server Error:", err);
      res.writeHead(200, corsHeaders);
      res.end(JSON.stringify({
        title: `${prompt ? prompt.charAt(0).toUpperCase() + prompt.slice(1) : 'Custom'} Meal Kit`,
        price: "$18.50",
        ingredients: [
          `✓ Fresh Main Ingredients for ${prompt || 'Recipe'} — $10.20`,
          `✓ Authentic Karthika Spices & Curry Masala — $4.50`,
          `✓ Fresh Curry Leaves, Coconut & Aromatics — $3.80`
        ]
      }));
      return;
    }
  }

  // Root endpoint / fallback
  res.writeHead(200, { ...corsHeaders, "Content-Type": "text/plain" });
  res.end("Karthika AI Assistant Server Running");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Karthika AI Assistant Server running on port ${PORT}`);
});
