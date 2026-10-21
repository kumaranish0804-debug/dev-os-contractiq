# Prompt changelog

## v1 — 2026-10-18

- Initial extraction prompt (Spec 06 §6.7): system rules, 3 few-shot examples per contract type, JSON repair prompt.
- Model: gpt-4o-mini (`OPENAI_MODEL`), temperature 0.1, JSON mode, max 2,000 output tokens.

## v1.1 — 2026-10-21

Chat conversation memory (extraction prompts unchanged from v1):
- `chat-system.md` (CONTRACT): no longer shared with BOTH; earlier messages are context only, facts must come from the contract with [Page N].
- `chat-system-both.md` (BOTH, new): answers from the contract and the conversation; every fact attributed — [Page N] or [From conversation].
- `chat-system-history.md` (HISTORY): no contract text; answers end with [From conversation].
- Context window per question type: CONTRACT/BOTH get the last 10 turns (question + answer), HISTORY up to 20 turns.
