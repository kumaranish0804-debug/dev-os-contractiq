'use client';

import { useId, useState } from 'react';
import { CheckCircle2, ThumbsDown, ThumbsUp } from 'lucide-react';
import { LIMITS } from '@shared/limits';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { useSubmitFeedback } from '@/hooks/use-review-actions';
import { ApiError } from '@/lib/api/api-error';
import type { ContractDetail } from '@/lib/data/contracts';
import { cn } from '@/lib/utils/cn';
import { ERROR_MESSAGES } from '@/lib/utils/errors';

type Rating = 'up' | 'down';

/** The counter appears once the comment nears the limit. */
const COUNTER_FROM = 900;

const RATINGS: { value: Rating; label: string; Icon: typeof ThumbsUp }[] = [
  { value: 'up', label: 'Yes, accurate', Icon: ThumbsUp },
  { value: 'down', label: 'No, not accurate', Icon: ThumbsDown },
];

/**
 * "Were these extracted terms accurate?" (Spec 07 §7.6, US-010). Starts from the saved feedback;
 * after submit it shows a thank-you with "Edit", which reopens the form prefilled.
 */
export function FeedbackWidget({
  contractId,
  feedback,
}: {
  contractId: string;
  feedback: ContractDetail['feedback'];
}) {
  const [editing, setEditing] = useState(feedback === null);
  const [rating, setRating] = useState<Rating | null>(feedback?.rating ?? null);
  const [comment, setComment] = useState(feedback?.comment ?? '');
  const submit = useSubmitFeedback(contractId);
  const commentId = useId();
  const counterId = `${commentId}-count`;

  function reopen() {
    setRating(feedback?.rating ?? null);
    setComment(feedback?.comment ?? '');
    submit.reset();
    setEditing(true);
  }

  if (!editing && feedback) {
    return (
      <section aria-labelledby="feedback-title" className="flex flex-wrap items-center gap-2 border-t border-border pt-6">
        <h2 id="feedback-title" className="sr-only">
          Feedback
        </h2>
        <CheckCircle2 aria-hidden="true" className="size-4 text-success-text" />
        <p role="status" className="text-body-lg text-text-primary">
          Thanks for your feedback.
        </p>
        <button
          type="button"
          onClick={reopen}
          className="rounded-sm text-body-lg font-medium text-brand transition-colors duration-fast ease-out hover:text-brand-hover hover:underline"
        >
          Edit
        </button>
      </section>
    );
  }

  const errorMessage = submit.isError
    ? submit.error instanceof ApiError
      ? ERROR_MESSAGES[submit.error.code]
      : ERROR_MESSAGES.INTERNAL
    : null;

  return (
    <section aria-labelledby="feedback-title" className="flex flex-col gap-4 border-t border-border pt-6">
      <h2 id="feedback-title" className="text-body-lg font-medium text-text-primary">
        Were these extracted terms accurate?
      </h2>
      <div role="group" aria-labelledby="feedback-title" className="flex gap-2">
        {RATINGS.map(({ value, label, Icon }) => (
          <button
            key={value}
            type="button"
            aria-pressed={rating === value}
            aria-label={label}
            onClick={() => setRating(value)}
            className={cn(
              'inline-flex size-10 items-center justify-center rounded-md border transition-colors duration-fast ease-out',
              rating === value
                ? 'border-brand bg-brand-subtle text-brand'
                : 'border-border bg-bg-primary text-text-secondary hover:border-border-strong hover:text-text-primary',
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
          </button>
        ))}
      </div>

      {rating ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate({ rating, comment }, { onSuccess: () => setEditing(false) });
          }}
        >
          <div className="flex flex-col gap-2">
            <label htmlFor={commentId} className="text-body-sm text-text-secondary">
              Anything we got wrong? (optional)
            </label>
            <textarea
              id={commentId}
              value={comment}
              rows={3}
              maxLength={LIMITS.feedbackCommentMax}
              aria-describedby={comment.length >= COUNTER_FROM ? counterId : undefined}
              onChange={(e) => setComment(e.target.value)}
              className="w-full resize-y rounded-md border border-border bg-bg-primary px-3 py-2 text-body-lg text-text-primary transition-colors duration-fast ease-out placeholder:text-text-secondary hover:border-border-strong focus-visible:border-brand focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
            />
            {comment.length >= COUNTER_FROM ? (
              <p id={counterId} className="self-end text-body-sm text-text-secondary">
                {comment.length}/{LIMITS.feedbackCommentMax}
              </p>
            ) : null}
          </div>
          {errorMessage ? <Alert variant="error">{errorMessage}</Alert> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={submit.isPending}>
              Submit
            </Button>
            {feedback ? (
              <Button variant="ghost" disabled={submit.isPending} onClick={() => setEditing(false)}>
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
    </section>
  );
}
