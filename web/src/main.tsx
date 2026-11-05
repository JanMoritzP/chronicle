import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { PublicPage } from './components/PublicPage'
import { applyFonts } from './fonts'
import './styles.css'

applyFonts()

const shared = /^\/s\/([\w-]+)\/?$/.exec(location.pathname)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {shared ? <PublicPage token={shared[1]} /> : <App />}
  </StrictMode>,
)
