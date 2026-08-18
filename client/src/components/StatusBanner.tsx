import type { SaleStatus } from '../api';

interface StatusBannerProps {
  status: SaleStatus | null;
  error: string | null;
}

const STATUS_LABEL: Record<SaleStatus['status'], string> = {
  upcoming: 'Upcoming',
  active: 'Active',
  ended: 'Ended',
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function StatusBanner({ status, error }: StatusBannerProps) {
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
      <div className="banner-row banner-times">
        <span>Starts: {formatTime(status.startTime)}</span>
        <span>Ends: {formatTime(status.endTime)}</span>
      </div>
    </div>
  );
}
