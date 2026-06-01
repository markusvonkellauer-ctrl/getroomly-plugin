import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { AppConfig } from './config/app-config'

// Dev demo config for `npm run dev`. Host pages in production supply their own.
// apiKey is read from VITE_GETROOMLY_API_KEY via AppConfig.ai.defaultApiKey.
window.GetRoomlyEmbedConfig = window.GetRoomlyEmbedConfig || {
  apiKey: AppConfig.ai.defaultApiKey ?? '',
  productImage: AppConfig.demo.chairImageUrl,
  sku: "CHAIR-SCAND-001",
  productName: "Modern Scandinavian Armchair",
  productPrice: 89900,
  category: "chairs",
  measurements: { width: 78, depth: 75, height: 80 },
  language: "en",
  buttonText: "Visualize in Your Room"
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
