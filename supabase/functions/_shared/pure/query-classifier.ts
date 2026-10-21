// Deterministic chat query classification — no API call (Spec 09 §9.6). Pure module: zero imports.

export type QueryType = 'contract' | 'history' | 'both';

const HISTORY_CUES =
  /\b(earlier|before|previous(ly)?|you (said|mentioned|told)|above|last (answer|response|question)|summari[sz]e (our|this) (chat|conversation)|what did (i|you) (ask|say))\b/i;
const CONTRACT_CUES =
  /\b(clause|section|page|term|contract|agreement|nda|msa|party|parties|liabil|indemn|terminat|confidential|payment|notice|governing|renew)\w*/i;

export function classifyQuery(question: string, history: unknown[]): QueryType {
  if (history.length === 0 || !HISTORY_CUES.test(question)) return 'contract';
  return CONTRACT_CUES.test(question) ? 'both' : 'history';
}
