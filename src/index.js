export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ---------- ROUTE: GET / ----------
    if (url.pathname === "/") {
      return new Response(
        "Feedback Pulse is running.\n\nRoutes:\nGET /seed\nPOST /feedback\nGET /summary\nFirst, run the mock data (seed) with https://feedback-pulse.rbiglou.workers.dev/seed\nThen, Check the summary at https://feedback-pulse.rbiglou.workers.dev/summary",
        { headers: { "Content-Type": "text/plain" } }
      );
    }

    // ---------- ROUTE: GET /seed ----------
    if (url.pathname === "/seed" && request.method === "GET") {
      const now = new Date().toISOString();

      const samples = [
        ["github", "Rate limiting docs are confusing. I keep getting blocked."],
        ["support", "The dashboard loads slowly when viewing analytics."],
        ["discord", "Love the product, but error messages could be clearer."],
        ["twitter", "Why does my worker randomly fail at night?"],
        ["forum", "Pricing tiers are hard to understand for small projects."]
      ];

      for (const [source, content] of samples) {
        await env.feedback_pulse_db
          .prepare(
            "INSERT INTO feedback (source, content, created_at) VALUES (?, ?, ?)"
          )
          .bind(source, content, now)
          .run();
      }

      return new Response("Seed data inserted.", { status: 200 });
    }

    // ---------- ROUTE: POST /feedback ----------
    if (url.pathname === "/feedback" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response("Invalid JSON body", { status: 400 });
      }

      const { source, content } = body;

      if (!source || !content) {
        return new Response(
          "Missing 'source' or 'content'",
          { status: 400 }
        );
      }

      await env.feedback_pulse_db
        .prepare(
          "INSERT INTO feedback (source, content, created_at) VALUES (?, ?, ?)"
        )
        .bind(source, content, new Date().toISOString())
        .run();

      return new Response("Feedback stored.", { status: 201 });
    }

    // ---------- ROUTE: GET /summary ----------// ---------- ROUTE: GET /summary ----------
if (url.pathname === "/summary" && request.method === "GET") {
  const { results } = await env.feedback_pulse_db
    .prepare(
      "SELECT source, content, created_at FROM feedback ORDER BY created_at DESC LIMIT 12"
    )
    .all();

  if (!results.length) {
    return new Response("No feedback yet.", { status: 200 });
  }

  const now = new Date();
  const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const dateRange = `${start.toISOString()} to ${now.toISOString()}`;

  const feedbackItems = results
    .map((r, idx) => {
      const safeSource = String(r.source || "other").toLowerCase();
      const safeText = String(r.content || "").replace(/\s+/g, " ").trim();
      const ts = r.created_at || "";
      return `${safeSource} | ${idx + 1} | ${ts} | "${safeText}"`;
    })
    .join("\n");

  const systemPrompt =
    "You are an expert product analyst for a developer platform. Output ONLY valid JSON. No prose, no markdown.";

  const userPrompt = `Analyze the feedback and return ONLY valid JSON.

Rules:
- Use ONLY the content provided. Do not invent details.
- Quotes must be copied verbatim from the feedback.
- Keep it short. Close all brackets. No trailing commas.

Return STRICT JSON ONLY matching this schema:

{
  "date_range": "string",
  "total_items": number,
  "top_themes": [
    {
      "theme": "string",
      "summary": "string",
      "sentiment": "positive|neutral|negative|mixed",
      "urgency": "low|medium|high",
      "evidence_quote": "string"
    }
  ]
}

Constraints:
- top_themes must contain exactly 3 items.
- evidence_quote must be ONE quote (not an array).
- Each summary must be under 25 words.
- Output MUST be valid JSON.

DATE RANGE: ${dateRange}
TOTAL ITEMS: ${results.length}

ITEMS (each item is "source | id | timestamp | text"):
${feedbackItems}
`;

  // Helper: extract first JSON object and parse it
  const tryParse = (text) => {
    let candidate = String(text || "");
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      candidate = candidate.slice(firstBrace, lastBrace + 1);
    }
    return JSON.parse(candidate);
  };

  // Call Workers AI
  let aiText = "";
  try {
    const aiResp = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });

    aiText =
      (typeof aiResp === "string" && aiResp) ||
      aiResp?.response ||
      aiResp?.result ||
      aiResp?.output_text ||
      JSON.stringify(aiResp);
  } catch (err) {
    return new Response(
      `Workers AI error: ${err?.message || String(err)}`,
      { status: 500 }
    );
  }

  // Parse, and if it fails, retry once with a JSON repair prompt
  try {
    const parsed = tryParse(aiText);
    return new Response(JSON.stringify(parsed, null, 2), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (e1) {
    try {
      const repairPrompt = `Fix the following so it becomes valid JSON that matches this schema:

{
  "date_range": "string",
  "total_items": number,
  "top_themes": [
    {
      "theme": "string",
      "summary": "string",
      "sentiment": "positive|neutral|negative|mixed",
      "urgency": "low|medium|high",
      "evidence_quote": "string"
    }
  ]
}

Return ONLY the corrected JSON. No markdown. No extra text.

INVALID_OUTPUT:
${aiText}`;

      const repairResp = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [
          { role: "system", content: "You are a JSON repair tool. Output only valid JSON." },
          { role: "user", content: repairPrompt }
        ]
      });

      const repairedText =
        (typeof repairResp === "string" && repairResp) ||
        repairResp?.response ||
        repairResp?.result ||
        repairResp?.output_text ||
        JSON.stringify(repairResp);

      const repaired = tryParse(repairedText);

      return new Response(JSON.stringify(repaired, null, 2), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (e2) {
      return new Response(
        `AI output couldn't be parsed as JSON (even after repair).\n\n--- RAW ---\n${aiText}\n\n--- ERROR ---\n${e1?.message || e1}`,
        { headers: { "Content-Type": "text/plain" } }
      );
    }
  }
}





    // ---------- FALLBACK ----------
    return new Response("Not found", { status: 404 });
  },
};
