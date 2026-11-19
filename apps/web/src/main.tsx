import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/plus-jakarta-sans/800.css';
import '@fontsource/fraunces/300-italic.css';
import '@fontsource/fraunces/400-italic.css';
import './index.css';
import App from './App.tsx';
import { AuthProvider } from './auth/AuthContext.tsx';
import { ThemeProvider } from './theme/ThemeContext.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { GENERIC_BRAND } from './lib/brand';

document.title = GENERIC_BRAND.APP_NAME;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <ErrorBoundary>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ErrorBoundary>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
);
