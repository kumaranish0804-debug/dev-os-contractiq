import type { Parent, Root, Text } from 'mdast';
import { visit, SKIP } from 'unist-util-visit';
import { splitCitations } from '@shared/citations';

/**
 * remark plugin (Spec 09 §9.3): splits text nodes on `[Page N]` and `[From conversation]` into
 * citation nodes, rendered by react-markdown as `<cite data-page>` / `<cite data-source>` and mapped
 * to chips. Code spans are left alone.
 */
export function remarkCitations() {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent: Parent | undefined) => {
      if (!parent || index === undefined) return;
      const segments = splitCitations(node.value);
      if (segments.length === 1 && segments[0]!.type === 'text') return;

      const replacement = segments.map((s) => {
        if (s.type === 'text') return { type: 'text', value: s.value } as Text;
        const [props, label] =
          s.type === 'citation' ? [{ dataPage: s.page }, `Page ${s.page}`] : [{ dataSource: 'conversation' }, 'Conversation'];
        return {
          type: 'citation',
          data: { hName: 'cite', hProperties: props },
          children: [{ type: 'text', value: label }],
        } as unknown as Text;
      });
      parent.children.splice(index, 1, ...(replacement as Parent['children']));
      return [SKIP, index + replacement.length];
    });
  };
}
