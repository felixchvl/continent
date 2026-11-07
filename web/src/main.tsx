import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/app.css'
import App from './App'

// deck.gl draws stop names with the loaded font, so wait for Geist before the first frame.
await Promise.allSettled([
  document.fonts.load('500 12px "Geist Variable"'),
  document.fonts.load('500 12px "Geist Mono Variable"'),
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
