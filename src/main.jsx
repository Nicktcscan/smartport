// src/main.jsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ChakraProvider } from '@chakra-ui/react';
import App from './App';

// Context providers (assumes these files exist in your project)
import { AuthProvider } from './context/AuthContext';

// Optional global css (Tailwind / custom)
import './index.css';

// createRoot in React 18/19
const rootEl = document.getElementById('root');

if (!rootEl) {
  throw new Error('Root element not found');
}

createRoot(rootEl).render(
  <React.StrictMode>
    <ChakraProvider>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </ChakraProvider>
  </React.StrictMode>
);
