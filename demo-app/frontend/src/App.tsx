import React from 'react';
import { LoginPage }   from './pages/LoginPage';
import { CheckoutPage } from './pages/CheckoutPage';

/**
 * Minimal client-side router — no react-router dependency.
 * In production you'd use react-router-dom.
 */
function useHash(): string {
  const [hash, setHash] = React.useState(window.location.pathname);
  React.useEffect(() => {
    const onPop = () => setHash(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return hash;
}

const App: React.FC = () => {
  const path = useHash();

  if (path === '/checkout') return <CheckoutPage />;
  return <LoginPage />;
};

export default App;
