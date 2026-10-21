import type { ChatMessage } from './openai.ts';
import {
  buildExtractionUserMessage,
  EXTRACTION_SYSTEM_V1,
  FEW_SHOT_MSA,
  FEW_SHOT_NDA,
} from './pure/prompts-v1.ts';
import { getStandardTerms, type ContractType, type TermDef } from './pure/term-library.ts';

export { PROMPT_VERSION, REPAIR_PROMPT } from './pure/prompts-v1.ts';

export type RequestedTerm = TermDef & { isCustom: boolean; sortOrder: number };

/**
 * System message, then 3 few-shot pairs for the selected type only (saves tokens), then the
 * real request. The contract sits last, inside <contract> delimiters (Spec 06 §6.7).
 */
export function buildExtractionMessages(input: {
  contractType: ContractType;
  requested: RequestedTerm[];
  contractText: string;
}): ChatMessage[] {
  const library = new Map(getStandardTerms(input.contractType).map((t) => [t.key, t]));
  const examples = input.contractType === 'NDA' ? FEW_SHOT_NDA : FEW_SHOT_MSA;

  const fewShot = examples.flatMap((example): ChatMessage[] => [
    {
      role: 'user',
      content: buildExtractionUserMessage({
        contractType: input.contractType,
        requested: example.requested.map((key) => {
          const def = library.get(key);
          if (!def) throw new Error(`Few-shot term ${key} is not in the ${input.contractType} library`);
          return def;
        }),
        contractText: example.contract,
      }),
    },
    { role: 'assistant', content: JSON.stringify(example.output) },
  ]);

  return [
    { role: 'system', content: EXTRACTION_SYSTEM_V1 },
    ...fewShot,
    {
      role: 'user',
      content: buildExtractionUserMessage({
        contractType: input.contractType,
        requested: input.requested,
        contractText: input.contractText,
      }),
    },
  ];
}
