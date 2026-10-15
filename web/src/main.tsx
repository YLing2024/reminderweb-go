import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/global.css';

// 生产构建下注册 Service Worker（离线可用 + 通知兜底）。
if (import.meta.env.PROD) {
  registerSW({ immediate: true });
}

const rootElement = document.getElementById('root');
if (rootElement === null) {
  throw new Error('缺少 #root 挂载点');
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
