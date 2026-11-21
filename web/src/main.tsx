import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { JoinPage } from './components/JoinPage'
import { PublicPage } from './components/PublicPage'
import { applyFonts } from './fonts'
import './styles.css'

applyFonts()

const shared = /^\/s\/([\w-]+)\/?$/.exec(location.pathname)
const invited = /^\/join\/([\w-]+)\/?$/.exec(location.pathname)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {shared ? <PublicPage token={shared[1]} /> : invited ? <JoinPage token={invited[1]} /> : <App />}
  </StrictMode>,
)
