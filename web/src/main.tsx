import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/app.css'
import App from './App'

// Deployed builds load Halyard Display from an Adobe Fonts web project (the font cannot be
// self-hosted); in development the locally installed font is used (see tokens.css).
const kit = import.meta.env.VITE_ADOBE_FONTS_KIT
if (kit) {
  const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: `https://use.typekit.net/${kit}.css` })
  document.head.append(link)
}
// deck.gl draws city and station names with the loaded font, so wait for it before the first frame.
await Promise.allSettled(['300', '350', '400', '500'].map((w) => document.fonts.load(`${w} 12px Halyard`)))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
