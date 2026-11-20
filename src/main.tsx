import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import '@/app/styles.css';
import { initIdentity } from '@/data/identity';
import { applySkinEarly } from '@/features/theme/skin';

// The owner of the library on screen is settled BEFORE the first render, so no screen ever starts from the wrong person's data.
void initIdentity().then(() => {
  applySkinEarly();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
