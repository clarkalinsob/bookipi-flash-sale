import { useEffect, useState } from 'react';
import type { SaleStatus } from '../api';

interface StatusBannerProps {
  status: SaleStatus | null;
  error: string | null;
  onCountdownComplete?: () => void;
}

const STATUS_LABEL: Record<SaleStatus['status'], string> = {
  upcoming: 'Upcoming',
  active: 'Active',
  ended: 'Ended',
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

/**
 * Ticks locally off the browser clock purely for display — the actual sale
 * gate is always re-checked against server time on every request
 * (SaleService.isActive), so drift here can't let anyone buy early.
 */
function useCountdown(targetIso: string | null, onComplete?: () => void) {
  const [remainingMs, setRemainingMs] = useState<number | null>(() =>
    targetIso ? new Date(targetIso).getTime() - Date.now() : null,
  );

  useEffect(() => {
    // No target means nothing to count down to — the component only reads
    // remainingMs while isUpcoming is true, so a stale leftover value here
    // is never rendered and doesn't need resetting.
    if (!targetIso) {
      return;
    }
    const target = new Date(targetIso).getTime();
    const tick = () => {
      const next = target - Date.now();
      setRemainingMs(next);
      if (next <= 0) {
        onComplete?.();
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [targetIso, onComplete]);

  return remainingMs;
}

export function StatusBanner({ status, error, onCountdownComplete }: StatusBannerProps) {
  const isUpcoming = status?.status === 'upcoming';
  const remainingMs = useCountdown(
    isUpcoming ? status.startTime : null,
    onCountdownComplete,
  );

  if (error) {
    return (
      <div className="banner banner-error" role="alert">
        Unable to reach the server: {error}
      </div>
    );
  }

  if (!status) {
    return <div className="banner">Loading sale status…</div>;
  }

  return (
    <div className={`banner banner-${status.status}`}>
      <div className="banner-row">
        <span className={`badge badge-${status.status}`}>
          {STATUS_LABEL[status.status]}
        </span>
        <span className="stock">
          {status.status === 'ended'
            ? `${status.stockRemaining} unsold`
            : `${status.stockRemaining} in stock`}
        </span>
      </div>
      {isUpcoming && remainingMs !== null && remainingMs > 0 && (
        <div className="banner-row">
          <span className="countdown">Starts in {formatCountdown(remainingMs)}</span>
        </div>
      )}
      <div className="banner-row banner-times">
        <span>Starts: {formatTime(status.startTime)}</span>
        <span>Ends: {formatTime(status.endTime)}</span>
      </div>
    </div>
  );
}
