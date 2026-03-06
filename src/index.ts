// ─── Attractor: DOT-based Pipeline Orchestration for AI Workflows ───────────
//
// Three layers:
//   1. Unified LLM Client  - Provider-agnostic SDK (OpenAI, Anthropic, Gemini)
//   2. Coding Agent Loop   - Agentic loop with sessions, tools, profiles
//   3. Attractor Engine    - DOT graph pipeline orchestration
//

export * as llm from "./llm/index.js";
export * as agent from "./agent/index.js";
export * as attractor from "./attractor/index.js";
