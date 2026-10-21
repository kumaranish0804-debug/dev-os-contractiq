import { AlertTriangle } from 'lucide-react';
import { confidenceLevel, type ConfidenceLevel } from '@shared/confidence';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';

const LEVELS: Record<ConfidenceLevel, { label: string; variant: BadgeVariant }> = {
  high: { label: 'High', variant: 'success' },
  medium: { label: 'Medium', variant: 'warning' },
  low: { label: 'Low', variant: 'error' },
};

// "{score}% {label}" — confidence is conveyed as text, not colour alone (Spec 07 §7.4, §7.10).
export function ConfidenceBadge({ score, found }: { score: number; found: boolean }) {
  if (!found) {
    return (
      <Badge variant="neutral">
        <span aria-hidden="true">—</span>
        <span className="sr-only">No confidence: not found</span>
      </Badge>
    );
  }
  const level = confidenceLevel(score);
  const { label, variant } = LEVELS[level];
  return (
    <Badge variant={variant}>
      {level === 'low' ? <AlertTriangle aria-hidden="true" className="size-3" /> : null}
      {score}% {label}
    </Badge>
  );
}
