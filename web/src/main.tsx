import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import Auth from './routes/Auth'
import Orgs from './routes/Orgs'
import Team from './routes/Team'
import OrgAdmin from './routes/OrgAdmin'
import ProtectedRoute from './components/ProtectedRoute'

const qc = new QueryClient()

const router = createBrowserRouter([
  { path: '/', element: <Auth /> }, // always public
  { path: '/orgs',          element: <ProtectedRoute><Orgs/></ProtectedRoute> },
  { path: '/team/:id',      element: <ProtectedRoute><Team/></ProtectedRoute> },
  { path: '/org/:id/admin', element: <ProtectedRoute><OrgAdmin/></ProtectedRoute> },
])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>
)
