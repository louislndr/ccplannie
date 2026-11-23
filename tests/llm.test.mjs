// Model provider selection and the schema Gemini receives. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
const { llmProvider, MODEL } = await import("../src/llm.mjs");
const KEYS = ["PLANNIE_LLM", "GOOGLE_CLOUD_PROJECT", "GEMINI_API_KEY", "ANTHROPIC_VERTEX_PROJECT_ID", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "PLANNIE_GEMINI_MODEL", "PLANNIE_MODEL"];

test("provider: explicit choice wins, otherwise the first configured; nothing configured → none", () => {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  try {
    for (const k of KEYS) delete process.env[k];
    assert.equal(llmProvider(), null);
    process.env.ANTHROPIC_API_KEY = "x";
    assert.equal(llmProvider(), "claude-api"); assert.equal(MODEL(), "claude-opus-5-5");
    process.env.GOOGLE_CLOUD_PROJECT = "p";
    assert.equal(llmProvider(), "gemini-vertex"); assert.equal(MODEL(), "gemini-3.8-flash");
    process.env.PLANNIE_LLM = "claude-api";
    assert.equal(llmProvider(), "claude-api");
    process.env.PLANNIE_LLM = "gemini-key";
    assert.equal(llmProvider(), null, "explicit choice that isn't configured is not silently swapped");
  } finally { for (const k of KEYS) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]); }
});

test("the interpretation schema converts to JSON Schema for both providers", async () => {
  const { Interpretation } = await import("../src/interpret.mjs");
  const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
  const { toJSONSchema } = await import("zod/v4");
  assert.equal(zodOutputFormat(Interpretation).schema.type, "object");
  const s = toJSONSchema(Interpretation);
  assert.ok(s.properties.intents.items.properties.kind.enum.includes("new_request"));
});
