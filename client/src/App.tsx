import { useCallback, useEffect, useState } from 'react';
import { ApiError, getSaleStatus } from './api';
import type { SaleStatus } from './api';
import { StatusBanner } from './components/StatusBanner';
import { BuyForm } from './components/BuyForm';

const POLL_INTERVAL_MS = 5_000;

function App() {
  const [status, setStatus] = useState<SaleStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const next = await getSaleStatus();
      setStatus(next);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'network error');
    }
  }, []);

  useEffect(() => {
    // Polling a remote server is exactly the "external system" case this
    // effect exists for, not a derivable-from-render value.
    // oxlint-disable-next-line react/set-state-in-effect
    void refreshStatus();
    const interval = setInterval(() => void refreshStatus(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refreshStatus]);

  return (
    <main className="page">
      <h1>Flash Sale</h1>
      <StatusBanner status={status} error={error} />
      <BuyForm onSettled={refreshStatus} />
    </main>
  );
}

export default App;
