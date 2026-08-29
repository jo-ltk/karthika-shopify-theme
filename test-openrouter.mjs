async function testOpenRouter() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("Set OPENROUTER_API_KEY before running this script.");
  }
  const baseUrl = "https://openrouter.ai/api/v1";
  const model = "z-ai/glm-5.2:free";
  const prompt = "fish curry";
  const systemMessage = `You are the Karthika Supermarket AI Cooking & Shopping Assistant for an authentic South Indian and Kerala grocery store.
When a user specifies a dish they want to cook, provide a shopping basket in STRICT JSON format with NO markdown codeblock, NO backticks, and NO conversational explanation.

JSON schema required:
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

  const messages = [
    { role: "system", content: systemMessage },
    { role: "user", content: `Dish: "${prompt}". Return only the JSON object with title, price, ingredients list.` }
  ];

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://karthika-demo-cjracfc7.myshopify.com",
      "X-Title": "Karthika AI Assistant"
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      max_tokens: 800
    })
  });

  console.log("=== STATUS ===", res.status);
  const text = await res.text();
  console.log("=== RAW RESPONSE BODY ===");
  console.log(text);
}

testOpenRouter();
