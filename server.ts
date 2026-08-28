// server.ts - Secure AI Proxy Server for Karthika AI Shopping Assistant
import { serve } from "bun";

const PORT = process.env.PORT || 3001;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "";
const NVIDIA_BASE_URL = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || "nvidia/nemotron-3-super-120b-a12b";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Health check
    if (url.pathname === "/api/health") {
      return Response.json({ status: "ok", model: NVIDIA_MODEL }, { headers: corsHeaders });
    }

    // AI Assistant Generation Endpoint
    if (url.pathname === "/api/ai-assistant" && req.method === "POST") {
      try {
        const body = await req.json();
        const prompt = body.prompt?.trim();

        if (!prompt) {
          return Response.json({ error: "Prompt is required" }, { status: 400, headers: corsHeaders });
        }

        const systemMessage = `You are the Karthika Supermarket AI Cooking & Shopping Assistant for an authentic South Indian and Kerala grocery store.
When a user specifies a dish they want to cook, provide a shopping basket in STRICT JSON format with NO markdown wrapping, thinking process, or explanation.

JSON format:
{
  "title": "Kerala Fish Curry Meal Kit",
  "price": "$19.80",
  "ingredients": [
    "✓ Fresh Kingfish Steaks (500g) — $10.50",
    "✓ Fresh Grated Coconut / Coconut Milk — $3.20",
    "✓ Kudampuli (Malabar Tamarind) & Curry Leaves — $2.60",
    "✓ Karthika Fish Curry Masala & Fenugreek — $3.50"
  ]
}`;

        async function callAI(modelName: string) {
          return await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${NVIDIA_API_KEY}`,
            },
            body: JSON.stringify({
              model: modelName,
              messages: [
                { role: "system", content: systemMessage },
                { role: "user", content: `Dish to cook: "${prompt}". Return ONLY the JSON object.` }
              ],
              temperature: 0.1,
              max_tokens: 1024,
            }),
          });
        }

        let apiResponse = await callAI(NVIDIA_MODEL);
        
        // If the primary model encounters 503 (overloaded) or 502, retry with alternative high-capacity model
        if (!apiResponse.ok && (apiResponse.status === 503 || apiResponse.status === 502)) {
          console.warn(`[AI Proxy] ${NVIDIA_MODEL} busy (${apiResponse.status}), falling back to meta/llama-3.3-70b-instruct...`);
          apiResponse = await callAI("meta/llama-3.3-70b-instruct");
        }

        let parsedResult: any = null;

        if (apiResponse.ok) {
          const aiData = await apiResponse.json();
          const rawContent = aiData.choices?.[0]?.message?.content?.trim() || "";
          
          try {
            const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              parsedResult = JSON.parse(jsonMatch[0]);
            } else {
              parsedResult = JSON.parse(rawContent);
            }
          } catch (e) {
            console.warn("JSON Parse warning for content:", rawContent);
          }
        }

        // Guaranteed fallback if upstream AI timed out or failed to return valid JSON
        if (!parsedResult || !parsedResult.title || !Array.isArray(parsedResult.ingredients)) {
          console.log("[AI Proxy] Using smart dish kit generator fallback for:", prompt);
          parsedResult = {
            title: `${prompt.charAt(0).toUpperCase() + prompt.slice(1)} Meal Kit`,
            price: "$18.50",
            ingredients: [
              `✓ Fresh Main Ingredients for ${prompt} — $10.20`,
              `✓ Authentic Karthika Spices & Curry Masala — $4.50`,
              `✓ Fresh Curry Leaves, Coconut & Aromatics — $3.80`
            ]
          };
        }

        return Response.json(parsedResult, { headers: corsHeaders });
      } catch (err: any) {
        console.error("Server Error:", err);
        return Response.json({
          title: `${prompt?.charAt(0).toUpperCase() + prompt?.slice(1)} Meal Kit`,
          price: "$18.50",
          ingredients: [
            `✓ Fresh Main Ingredients for ${prompt} — $10.20`,
            `✓ Authentic Karthika Spices & Curry Masala — $4.50`,
            `✓ Fresh Curry Leaves, Coconut & Aromatics — $3.80`
          ]
        }, { headers: corsHeaders });
      }
    }

    // Static files or fallback
    return new Response("Karthika AI Server Running", { headers: corsHeaders });
  },
});

console.log(`🚀 Karthika AI Assistant Server running at http://localhost:${PORT}`);
