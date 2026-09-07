import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './grid.css'
import GridApp from './GridApp.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <GridApp />
  </StrictMode>,
)
