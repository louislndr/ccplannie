// One place that decides which model reads Plannie's email. The rest of the app asks for structured JSON
// (interpret.mjs) or short text (chat.mjs) and never sees the provider.
//
//   gemini-vertex    Gemini on Google Cloud Vertex AI   GOOGLE_CLOUD_PROJECT (+ GOOGLE_CLOUD_LOCATION, default "global");
//                                                      auth: `gcloud auth application-default login`; billed to the project
//   gemini-key       Gemini via a Google AI Studio key  GEMINI_API_KEY
//   claude-vertex    Claude on Vertex AI                ANTHROPIC_VERTEX_PROJECT_ID (+ CLOUD_ML_REGION, default "global")
//   claude-api       Claude via the Anthropic API       ANTHROPIC_API_KEY
//
// PLANNIE_LLM picks one explicitly; otherwise the first configured one in the order above is used.
// The model only PROPOSES an interpretation; permissions and money rules stay in plain code.
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { GoogleGenAI } from "@google/genai";
import { toJSONSchema } from "zod/v4";

const configured = {
  "gemini-vertex": () => !!process.env.GOOGLE_CLOUD_PROJECT,
  "gemini-key": () => !!process.env.GEMINI_API_KEY,
  "claude-vertex": () => !!process.env.ANTHROPIC_VERTEX_PROJECT_ID,
  "claude-api": () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
};
export function llmProvider() {
  const want = process.env.PLANNIE_LLM;
  if (want) return configured[want]?.() ? want : null;
  return Object.keys(configured).find((k) => configured[k]()) || null;
}
const isGemini = () => llmProvider()?.startsWith("gemini");
// Gemini: a comma-separated fallback chain. When a model stays busy after retries, the next one is tried.
export const GEMINI_DEFAULT = "gemini-3.8-flash,gemini-3.5-flash,gemini-3.1-flash-lite";
export const MODELS = () => (isGemini() ? (process.env.PLANNIE_GEMINI_MODEL || GEMINI_DEFAULT) : process.env.PLANNIE_MODEL || "claude-opus-5-5").split(",").map((m) => m.trim()).filter(Boolean);
export const MODEL = () => MODELS()[0];
export const llmLabel = () => ({
  "gemini-vertex": `Google Cloud Vertex AI (project ${process.env.GOOGLE_CLOUD_PROJECT}, ${process.env.GOOGLE_CLOUD_LOCATION || "global"})`,
  "gemini-key": "Google AI Studio API key",
  "claude-vertex": `Google Cloud Vertex AI (project ${process.env.ANTHROPIC_VERTEX_PROJECT_ID}, ${process.env.CLOUD_ML_REGION || "global"})`,
  "claude-api": "Anthropic API",
})[llmProvider()] || "not configured";

let clients = {};
function client() {
  const p = llmProvider();
  if (!p) throw new Error("No language model is configured");
  if (clients[p]) return clients[p];
  if (p === "gemini-vertex") clients[p] = new GoogleGenAI({ vertexai: true, project: process.env.GOOGLE_CLOUD_PROJECT, location: process.env.GOOGLE_CLOUD_LOCATION || "global" });
  else if (p === "gemini-key") clients[p] = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  else if (p === "claude-vertex") clients[p] = new AnthropicVertex({ projectId: process.env.ANTHROPIC_VERTEX_PROJECT_ID, region: process.env.CLOUD_ML_REGION || "global" });
  else clients[p] = new Anthropic();
  return clients[p];
}

// Temporary provider trouble (busy, rate-limited, network) is retried with backoff; anything else fails fast.
const transient = (e) => [429, 500, 502, 503, 504].includes(e?.status ?? e?.code) || /UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|overloaded|ECONNRESET|ETIMEDOUT|fetch failed/i.test(String(e?.message));
async function withRetry(fn, tries = Number(process.env.PLANNIE_LLM_RETRIES || 3)) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) { if (i >= tries - 1 || !transient(e)) throw e; await new Promise((r) => setTimeout(r, Math.min(8000, 1000 * 2 ** i) + Math.random() * 500)); }
  }
}
// Each model in the chain gets its retries; only temporary trouble moves on to the next model.
async function acrossModels(fn) {
  const models = MODELS();
  for (let i = 0; ; i++) {
    try { return await withRetry(() => fn(models[i])); }
    catch (e) { if (i >= models.length - 1 || !transient(e)) throw e; }
  }
}

// Gemini's JSON-schema support is a subset: drop the keys it doesn't need.
function geminiSchema(schema) {
  const s = toJSONSchema(schema);
  const strip = (o) => {
    if (Array.isArray(o)) return o.map(strip);
    if (!o || typeof o !== "object") return o;
    const { $schema, additionalProperties, ...rest } = o;
    return Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, strip(v)]));
  };
  return strip(s);
}

// Structured output validated against a zod (v4) schema. Returns { data, model }; throws if the model
// refuses or returns something that doesn't match the schema.
// `files` ([{ mimeType, data(base64) }], e.g. a PDF) are passed to Gemini as document parts.
export async function generateJson({ system, user, schema, maxTokens = 4000, files = [] }) {
  const c = client();
  if (isGemini()) {
    const res = await acrossModels((model) => c.models.generateContent({
      model,
      contents: [{ role: "user", parts: [...files.map((f) => ({ inlineData: { mimeType: f.mimeType, data: f.data } })), { text: user }] }],
      config: { systemInstruction: system, maxOutputTokens: maxTokens, temperature: 0, responseMimeType: "application/json", responseJsonSchema: geminiSchema(schema) },
    }));
    const text = res.text;
    if (!text) throw new Error(`Gemini returned no output (finish reason: ${res.candidates?.[0]?.finishReason || "unknown"})`);
    return { data: schema.parse(JSON.parse(text)), model: res.modelVersion || MODEL() };
  }
  const res = await withRetry(() => c.messages.parse({
    model: MODEL(), max_tokens: maxTokens, system,
    output_config: { effort: "low", format: zodOutputFormat(schema) },
    messages: [{ role: "user", content: [...files.map((f) => ({ type: "document", source: { type: "base64", media_type: f.mimeType, data: f.data } })), { type: "text", text: user }] }],
  }));
  if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error(`Model returned no output (stop_reason: ${res.stop_reason})`);
  return { data: res.parsed_output, model: res.model };
}

// Short free-text answer from a conversation ([{ role: "user"|"assistant", content }]).
export async function generateText({ system, messages, maxTokens = 2000 }) {
  const c = client();
  if (isGemini()) {
    const res = await acrossModels((model) => c.models.generateContent({
      model,
      contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: String(m.content) }] })),
      config: { systemInstruction: system, maxOutputTokens: maxTokens },
    }));
    if (!res.text) throw new Error("Gemini returned no text");
    return { text: res.text, model: res.modelVersion || MODEL() };
  }
  const res = await withRetry(() => c.messages.create({ model: MODEL(), max_tokens: maxTokens, output_config: { effort: "low" }, system, messages }));
  if (res.stop_reason === "refusal") throw new Error("Model declined");
  return { text: res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n"), model: res.model };
}
