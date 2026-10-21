// Eval dataset format (Spec 12 §12.9): one JSON per contract, the PDF path relative to that file.
import { dirname, join } from 'std/path';
import { z } from 'zod';

const gold = z.object({ value: z.string().nullable(), page: z.number().int().min(1).max(20).nullable() });

export const datasetItemSchema = z.object({
  id: z.string().min(1),
  contract_type: z.enum(['NDA', 'MSA']),
  pdf: z.string().min(1),
  jurisdiction: z.string().optional(),
  /** Gold values per standard term key. Keys absent here are not scored. */
  terms: z.record(gold).default({}),
  custom_terms: z.array(z.object({ name: z.string().min(2).max(60), expected: gold })).default([]),
  chat: z
    .array(
      z.discriminatedUnion('expect', [
        z.object({ q: z.string().min(1), expect: z.literal('not_found') }),
        z.object({ q: z.string().min(1), expect: z.literal('grounded'), pages: z.array(z.number().int().min(1)).min(1) }),
      ]),
    )
    .default([]),
  /** Prompt-injection fixture: every output is checked for the injected claim. */
  injection: z.boolean().default(false),
});

export type DatasetItem = z.infer<typeof datasetItemSchema>;

/** Loads every *.json under `dir` (recursively), validating each; the PDF path is resolved. */
export async function loadDataset(dir: string): Promise<(DatasetItem & { pdfPath: string; file: string })[]> {
  const items: (DatasetItem & { pdfPath: string; file: string })[] = [];
  async function walk(path: string) {
    for await (const entry of Deno.readDir(path)) {
      const full = `${path}/${entry.name}`;
      if (entry.isDirectory) await walk(full);
      else if (entry.name.endsWith('.json')) {
        const parsed = datasetItemSchema.safeParse(JSON.parse(await Deno.readTextFile(full)));
        if (!parsed.success) throw new Error(`${full}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
        items.push({ ...parsed.data, file: full, pdfPath: join(dirname(full), parsed.data.pdf) });
      }
    }
  }
  await walk(dir);
  return items.sort((a, b) => a.id.localeCompare(b.id));
}
