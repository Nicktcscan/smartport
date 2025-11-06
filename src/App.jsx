// src/App.jsx
import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Box, Center, Spinner, Text } from '@chakra-ui/react';
import { useAuth } from './context/AuthContext';
import { PersistedStateProvider } from './context/PersistedStateContext';

import Layout from './Layout';
import Header from './Header';
import Register from './pages/Register';

import Dashboard from './pages/Dashboard';
import TicketDetails from './pages/TicketDetails';
import OutgateDashboard from './pages/OutgateDashboard';
import CustomsManagementPage from './pages/CustomsManagementPage';
import AdminPanelPage from './pages/AdminPanelPage';
import UsersPage from './pages/UsersPage';
import RolesPermissionsPage from './pages/RolesPermissionsPage';
import GateOperationsPage from './pages/GateOperationsPage';
import Login from './pages/Login';
import WeighbridgeRecords from './pages/WeighbridgeRecords';
import CargoVerification from './pages/CargoInspection';
import WeighbridgeManagementPage from './pages/WeighbridgeManagementPage';
import HoldReleaseRequests from './pages/HoldReleaseRequests';
import ManualEntry from './pages/ManualEntry';
import WeightReports from './pages/WeightReports';
import ExitTrucks from './pages/ExitTrucks';

import OutgateTicketDetails from './pages/OutgateTicketDetails';
import OutgateSearchTickets from './pages/OutgateSearchTickets';
import ConfirmExit from './pages/ConfirmExit';
import OutgateReports from './pages/OutgateReports';

import OCRComponent from './OCRComponent';
import AgentDashboard from './pages/AgentDashboard';

// NEW: SAD Declaration page (ensure this file exists)
import SADDeclaration from './pages/SADDeclaration';
import Settings from './pages/Settings';

// NEW: Appointment page (public route)
import Appointment from './pages/appointment';

const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!allowedRoles.includes(user.role)) {
    switch (user.role) {
      case 'admin':
        return <Navigate to="/admin" replace />;
      case 'customs':
        return <Navigate to="/customs" replace />;
      case 'agent':
        return <Navigate to="/agent" replace />;
      case 'outgate':
        return <Navigate to="/outgate" replace />;
      case 'weighbridge':
        return <Navigate to="/weighbridge" replace />;
      default:
        return <Navigate to="/login" replace />;
    }
  }
  return children;
};

function App() {
  const { user, loading } = useAuth();
  const location = useLocation();

  // While AuthContext is determining session, show a centered loading spinner.
  if (loading) {
    return (
      <Center minH="100vh" bg="gray.50" p={4}>
        <Box textAlign="center">
          <Spinner size="xl" thickness="4px" color="teal.500" />
          <Text mt={3} fontSize="md" color="gray.600">Checking session…</Text>
        </Box>
      </Center>
    );
  }

  // Helper to detect if path is a static asset (file extensions)
  const isStaticAsset = location.pathname.match(/\.(js|css|png|jpg|jpeg|gif|ico|json|svg|txt|woff|woff2|ttf|eot|map)$/);

  return (
    <PersistedStateProvider>
      {!user ? (
        <Routes>
          <Route path="/login" element={<Login />} />

          {/* Public Appointment route: accessible without login */}
          <Route
            path="/appointment"
            element={
              <Layout>
                <Box as="main" p={4} bg="gray.50">
                  <Appointment />
                </Box>
              </Layout>
            }
          />

          <Route
            path="/register"
            element={
              <Layout>
                <Box as="main" p={4} bg="gray.50">
                  <Register />
                </Box>
              </Layout>
            }
          />

          <Route
            path="*"
            element={isStaticAsset ? null : <Navigate to="/login" replace />}
          />
        </Routes>
      ) : (
        <>
          <Header />
          <Routes>
            <Route
              path="/"
              element={
                user.role === 'admin' ? (
                  <Navigate to="/admin" replace />
                ) : user.role === 'customs' ? (
                  <Navigate to="/customs" replace />
                ) : user.role === 'outgate' ? (
                  <Navigate to="/outgate" replace />
                ) : user.role === 'weighbridge' ? (
                  <Navigate to="/weighbridge" replace />
                ) : user.role === 'agent' ? (
                  <Navigate to="/agent" replace />
                ) : (
                  <Navigate to="/dashboard" replace />
                )
              }
            />

            {/* Make Appointment accessible to logged-in users too */}
            <Route
              path="/appointment"
              element={
                <Layout>
                  <Box as="main" p={4} bg="gray.50">
                    <Appointment />
                  </Box>
                </Layout>
              }
            />

            {/* Weighbridge */}
            <Route
              path="/weighbridge"
              element={
                <ProtectedRoute allowedRoles={['admin', 'weighbridge']}>
                  <Layout>
                    <Box as="main" p={4} bg="gray.50">
                      <WeighbridgeManagementPage />
                    </Box>
                  </Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/ocr"
              element={
                <ProtectedRoute allowedRoles={['admin', 'weighbridge']}>
                  <Layout>
                    <Box as="main" p={4} bg="gray.50">
                      <OCRComponent />
                    </Box>
                  </Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/dashboard"
              element={
                <ProtectedRoute allowedRoles={['weighbridge']}>
                  <Layout>
                    <Box as="main" p={4} bg="gray.50">
                      <Dashboard />
                    </Box>
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/tickets/:id"
              element={
                <ProtectedRoute allowedRoles={['weighbridge','admin']}>
                  <Layout>
                    <Box as="main" p={4} bg="gray.50">
                      <TicketDetails />
                    </Box>
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/hold-release-requests"
              element={
                <ProtectedRoute allowedRoles={['admin', 'weighbridge']}>
                  <Layout>
                    <Box as="main" p={4} bg="gray.50">
                      <HoldReleaseRequests />
                    </Box>
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/cargo-verification"
              element={
                <ProtectedRoute allowedRoles={['admin', 'weighbridge']}>
                  <Layout>
                    <Box as="main" p={4} bg="gray.50">
                      <CargoVerification />
                    </Box>
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/weighbridge-records"
              element={
                <ProtectedRoute allowedRoles={['admin', 'weighbridge']}>
                  <Layout>
                    <Box as="main" p={4} bg="gray.50">
                      <WeighbridgeRecords />
                    </Box>
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/reports"
              element={
                <ProtectedRoute allowedRoles={['admin', 'weighbridge']}>
                  <Layout>
                    <Box as="main" p={4} bg="gray.50">
                      <WeighbridgeManagementPage />
                    </Box>
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/manual-entry"
              element={
                <ProtectedRoute allowedRoles={['admin', 'weighbridge']}>
                  <Layout>
                    <Box as="main" p={4} bg="gray.50">
                      <ManualEntry />
                    </Box>
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/weightreports"
              element={
                <ProtectedRoute allowedRoles={['admin', 'weighbridge']}>
                  <Layout>
                    <Box as="main" p={4} bg="gray.50">
                      <WeightReports />
                    </Box>
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/exit-trucks"
              element={
                <ProtectedRoute allowedRoles={['admin', 'weighbridge']}>
                  <Layout>
                    <Box as="main" p={4} bg="gray.50">
                      <ExitTrucks />
                    </Box>
                  </Layout>
                </ProtectedRoute>
              }
            />

            {/* NEW: SAD Declaration route */}
            <Route
              path="/sad-declarations"
              element={
                <ProtectedRoute allowedRoles={['admin', 'weighbridge']}>
                  <Layout>
                    <Box as="main" p={4} bg="gray.50">
                      <SADDeclaration />
                    </Box>
                  </Layout>
                </ProtectedRoute>
              }
            />

              {/* NEW: Settings route */}
            <Route
              path="/settings"
              element={
                <ProtectedRoute allowedRoles={['admin']}>
                  <Layout>
                    <Box as="main" p={4} bg="gray.50">
                      <Settings />
                    </Box>
                  </Layout>
                </ProtectedRoute>
              }
            />

            {/* Outgate */}
            <Route
              path="/outgate"
              element={
                <ProtectedRoute allowedRoles={['outgate','admin','customs']}>
                  <Layout>
                    <Box as="main" p={4} bg="gray.50">
                      <OutgateDashboard />
                    </Box>
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route path="/outgate/tickets" element={<Navigate to="/outgate/search" replace />} />
            <Route
              path="/outgate/tickets/:id"
              element={
                <ProtectedRoute allowedRoles={['outgate','admin','customs']}>
                  <Layout>
                    <Box as="main" p={4} bg="gray.50">
                      <OutgateTicketDetails />
                    </Box>
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/outgate/search"
              element={
                <ProtectedRoute allowedRoles={['outgate','admin','customs']}>
                  <Layout>
                    <Box as="main" p={4} bg="gray.50">
                      <OutgateSearchTickets />
                    </Box>
                  </Layout>
                </ProtectedRoute>
              }
            />
          
            <Route
              path="/outgate/confirm-exit"
              element={
                <ProtectedRoute allowedRoles={['outgate','admin','customs']}>
                  <Layout>
                    <Box as="main" p={4} bg="gray.50">
                      <ConfirmExit />
                    </Box>
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/outgate/reports"
              element={
                <ProtectedRoute allowedRoles={['outgate', 'admin', 'customs']}>
                  <Layout>
                    <Box as="main" p={4} bg="gray.50">
                      <OutgateReports />
                    </Box>
                  </Layout>
                </ProtectedRoute>
              }
            />

            {/* Customs */}
            <Route
              path="/customs"
              element={
                <ProtectedRoute allowedRoles={['admin', 'customs']}>
                  <Layout>
                    <Box as="main" p={4} bg="gray.50">
                      <OutgateDashboard />
                    </Box>
                  </Layout>
                </ProtectedRoute>
              }
            />
            
            <Route
              path="/customs/cargo-inspection"
              element={
                <ProtectedRoute allowedRoles={['customs']}>
                  <Layout>
                    <Box as="main" p={4} bg="gray.50">
                      <CargoVerification />
                    </Box>
                  </Layout>
                </ProtectedRoute>
              }
            />

            {/* Admin */}
            <Route
              path="/admin"
              element={
                <ProtectedRoute allowedRoles={['admin']}>
                  <AdminPanelPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/users"
              element={
                <ProtectedRoute allowedRoles={['admin']}>
                  <Layout>
                    <Box as="main" p={4} bg="gray.50">
                      <UsersPage />
                    </Box>
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/roles"
              element={
                <ProtectedRoute allowedRoles={['admin']}>
                  <Layout>
                    <Box as="main" p={4} bg="gray.50">
                      <RolesPermissionsPage />
                    </Box>
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/gate-operations"
              element={
                <ProtectedRoute allowedRoles={['admin']}>
                  <Layout>
                    <Box as="main" p={4} bg="gray.50">
                      <GateOperationsPage />
                    </Box>
                  </Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/agent"
              element={
                <ProtectedRoute allowedRoles={['admin', 'agent']}>
                  <Layout>
                    <Box as="main" p={4} bg="gray.50">
                      <AgentDashboard />
                    </Box>
                  </Layout>
                </ProtectedRoute>
              }
            />

            {/* Fallback */}
            <Route path="/login" element={<Navigate to="/" replace />} />
          </Routes>
        </>
      )}
    </PersistedStateProvider>
  );
}

export default App;
