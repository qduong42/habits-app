import { createHashRouter, RouterProvider } from 'react-router-dom';
import { RequireAuth } from './auth';
import { GameProvider } from './game';
import Layout from './Layout';
import Login from './pages/Login';
import Today from './pages/Today';
import Inbox from './pages/Inbox';
import Stats from './pages/Stats';
import Profile from './pages/Profile';

// Hash routing: the SPA works from plain static file serving with no
// server-side route configuration.
const router = createHashRouter([
  { path: '/login', element: <Login /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <Layout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Today /> },
      { path: 'dump', element: <Inbox /> },
      { path: 'stats', element: <Stats /> },
      { path: 'profile', element: <Profile /> },
    ],
  },
]);

export default function App() {
  return (
    <GameProvider>
      <RouterProvider router={router} />
    </GameProvider>
  );
}
