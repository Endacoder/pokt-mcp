/** Strip markdown code fences and parse JSON from LLM output. */
export function parseJsonFromModelText(text: string): unknown {
  let trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  if (fenced) {
    trimmed = fenced[1]!.trim();
  } else if (trimmed.startsWith("```")) {
    trimmed = trimmed.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "").trim();
  }
  return JSON.parse(trimmed);
}
