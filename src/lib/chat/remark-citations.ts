import type { Parent, Root, Text } from 'mdast';
import { visit, SKIP } from 'unist-util-visit';
import { splitCitations } from '@shared/citations';

/**
 * remark plugin (Spec 09 §9.3): splits text nodes on `[Page N]` into citation nodes, rendered by
 * react-markdown as `<cite data-page>` and mapped to <CitationChip>. Code spans are left alone.
 */
export function remarkCitations() {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent: Parent | undefined) => {
      if (!parent || index === undefined) return;
      const segments = splitCitations(node.value);
      if (segments.length === 1 && segments[0]!.type === 'text') return;

      const replacement = segments.map((s) =>
        s.type === 'text'
          ? ({ type: 'text', value: s.value } as Text)
          : ({
              type: 'citation',
              data: { hName: 'cite', hProperties: { dataPage: s.page } },
              children: [{ type: 'text', value: `Page ${s.page}` }],
            } as unknown as Text),
      );
      parent.children.splice(index, 1, ...(replacement as Parent['children']));
      return [SKIP, index + replacement.length];
    });
  };
}
