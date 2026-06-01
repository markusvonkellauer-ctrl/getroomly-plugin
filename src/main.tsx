import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { AppConfig } from './config/app-config'

// Set default config for testing if not provided
window.GetRoomlyEmbedConfig = window.GetRoomlyEmbedConfig || {
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
