import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/global.css'
import './styles/source-ui.css'
import './styles/desktop.css'
import './styles/settings.css'
import './styles/sidebar.css'
import './styles/ide-workspace.css'
import './styles/dark-shell.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root container is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
