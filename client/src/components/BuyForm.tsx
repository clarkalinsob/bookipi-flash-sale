import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, attemptPurchase } from '../api';
import type { PurchaseResult } from '../api';

interface BuyFormProps {
  onSettled: () => void;
}

const FEEDBACK: Record<
  PurchaseResult,
  { tone: 'success' | 'warning'; text: string }
> = {
  success: { tone: 'success', text: 'Purchase successful — you got one!' },
  sold_out: { tone: 'warning', text: 'Sold out. Better luck next time.' },
  already_purchased: {
    tone: 'warning',
    text: 'You have already purchased this item.',
  },
  not_active: { tone: 'warning', text: 'The sale is not active right now.' },
};

export function BuyForm({ onSettled }: BuyFormProps) {
  const [userId, setUserId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = userId.trim();
    if (!trimmed || submitting) {
      return;
    }

    setSubmitting(true);
    setFeedback(null);
    try {
      const { result } = await attemptPurchase(trimmed);
      setFeedback(FEEDBACK[result]);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
      setFeedback({ tone: 'error', text: message });
    } finally {
      setSubmitting(false);
      onSettled();
    }
  }

  return (
    <form className="buy-form" onSubmit={handleSubmit}>
      <label htmlFor="userId">User ID</label>
      <div className="buy-form-row">
        <input
          id="userId"
          type="text"
          placeholder="e.g. jane-doe"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          maxLength={100}
          required
        />
        <button type="submit" disabled={submitting || !userId.trim()}>
          {submitting ? 'Buying…' : 'Buy Now'}
        </button>
      </div>
      {feedback && (
        <p className={`feedback feedback-${feedback.tone}`} role="status">
          {feedback.text}
        </p>
      )}
    </form>
  );
}
