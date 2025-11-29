// src/components/Sidebar.jsx
import React from 'react';
import { NavLink } from 'react-router-dom';
import { MdLocalShipping } from 'react-icons/md';
import {
  FaTachometerAlt,
  FaFileAlt,
  FaUsers,
  FaUpload,
  FaEdit,
  FaListAlt,
  FaIdCard,
  FaCheckCircle,
  FaFileInvoice,
  FaCog,
  FaChartBar,
  FaCalendarCheck,   // ✅ Added for Appointments
} from 'react-icons/fa';


import {
  Box,
  VStack,
  Text,
  IconButton,
  Tooltip,
  HStack,
  Icon,
} from '@chakra-ui/react';

import { HamburgerIcon, CloseIcon } from '@chakra-ui/icons';

import { useAuth } from './context/AuthContext';

// Admin menu
const adminNavItems = [
  { path: '/dashboard', label: 'Dashboard', icon: FaTachometerAlt },
  { path: '/sad-declarations', label: 'SAD Declaration', icon: FaFileAlt },
  { path: '/tickets', label: 'Upload Ticket', icon: FaUpload },
  { path: '/manual-entry', label: 'Manual Entry', icon: FaEdit },
  { path: '/weightreports', label: 'Ticket Records', icon: FaListAlt },
  { path: '/outgate/confirm-exit', label: 'Confirm Exit', icon: FaCheckCircle },
  { path: '/exit-trucks', label: 'Exited Trucks', icon: MdLocalShipping },
  { path: '/outgate/reports', label: 'Outgate Records', icon: FaFileInvoice },
  { path: '/users', label: 'Manage Users', icon: FaUsers },
  { path: '/drivers', label: 'Manage Drivers', icon: FaIdCard }, // You can replace icon if needed
  { path: '/agentappt', label: 'Create Appointments', icon: FaCalendarCheck },
  { path: '/appointments', label: 'Manage Appointments', icon: FaCalendarCheck },
  { path: '/settings', label: 'System Settings', icon: FaCog },
];


// Weighbridge menu
const weighbridgeNavItems = [
  { path: '/dashboard', label: 'Dashboard', icon: FaTachometerAlt },
  { path: '/sad-declarations', label: 'SAD Declaration', icon: FaFileAlt },
  { path: '/weighbridge', label: 'Upload Ticket', icon: FaUpload },
  { path: '/manual-entry', label: 'Manual Entry', icon: FaEdit },
  { path: '/weightreports', label: 'Ticket Records', icon: FaListAlt },
  { path: '/exit-trucks', label: 'Exited Trucks', icon: MdLocalShipping },
  { path: '/agentappt', label: 'Create Appointments', icon: FaCalendarCheck },
  { path: '/appointments', label: 'Manage Appointments', icon: FaCalendarCheck },
];

// Outgate Officer menu
const outgateNavItems = [
  { path: '/outgate', label: 'Dashboard', icon: FaTachometerAlt },
  { path: '/outgate/confirm-exit', label: 'Confirm Exit', icon: FaCheckCircle },
  { path: '/outgate/reports', label: 'Reports', icon: FaFileInvoice },
];

// Customs Officer menu
const customsNavItems = [
  { path: '/outgate', label: 'Dashboard', icon: FaTachometerAlt },
  { path: '/outgate/confirm-exit', label: 'Confirm Exit', icon: FaCheckCircle },
  { path: '/outgate/reports', label: 'Reports', icon: FaFileInvoice },
];

// Agent menu
const agentNavItems = [
  { path: '/agent', label: 'Reports', icon: FaChartBar },
  { path: '/agentsads', label: 'My SADs', icon: FaFileInvoice },
  { path: '/myappointments', label: 'My Appointments', icon: FaCalendarCheck },
  { path: '/agentappt', label: 'Create Appointments', icon: FaCalendarCheck },
];

// Finance menu
const financeNavItems = [
  { path: '/finance', label: 'Finance Dashboard', icon: FaTachometerAlt },
  { path: '/sads', label: 'SAD Declarations', icon: FaFileInvoice },
];

function Sidebar({ isCollapsed, toggleCollapse }) {
  const { user } = useAuth();

  // Determine nav items based on user role
  let navItems;
  if (user?.role === 'admin') {
    navItems = adminNavItems;
  } else if (user?.role === 'weighbridge') {
    navItems = weighbridgeNavItems;
  } else if (user?.role === 'outgate') {
    navItems = outgateNavItems;
  } else if (user?.role === 'customs') {
    navItems = customsNavItems;
  } else if (user?.role === 'agent') {
    navItems = agentNavItems;
  } else if (user?.role === 'finance') {
    navItems = financeNavItems;
  } else {
    navItems = []; // fallback or generic user menu
  }

  const activeBg = 'rgba(255, 255, 255, 0.12)';

  return (
    <Box
      bg="linear-gradient(90deg, #7B1C1C 0%, #0D1A4B 100%)"
      color="white"
      height="100vh"
      p={4}
      width={isCollapsed ? '60px' : '260px'}
      transition="width 0.2s"
      display="flex"
      flexDirection="column"
    >
      {/* Collapse/Expand Button */}
      <Box mb={6} display="flex" justifyContent={isCollapsed ? 'center' : 'flex-end'}>
        <IconButton
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          icon={isCollapsed ? <HamburgerIcon color="white" /> : <CloseIcon color="white" />}
          size="sm"
          onClick={toggleCollapse}
          bg="transparent"
          _hover={{ bg: 'whiteAlpha.200' }}
          color="white"
        />
      </Box>

      <VStack spacing={3} align={isCollapsed ? 'center' : 'stretch'}>
        {navItems.map(({ path, label, icon }) => (
          <Tooltip key={path} label={isCollapsed ? label : ''} placement="right" openDelay={300}>
            <NavLink
              to={path}
              style={({ isActive }) => ({
                backgroundColor: isActive ? activeBg : 'transparent',
                padding: isCollapsed ? '10px 0' : '10px',
                borderRadius: '6px',
                display: 'block',
                color: 'white',
                fontWeight: isActive ? 'bold' : 'normal',
                textDecoration: 'none',
                textAlign: isCollapsed ? 'center' : 'left',
                whiteSpace: 'nowrap',
              })}
            >
              <HStack spacing={isCollapsed ? 0 : 3} justify={isCollapsed ? 'center' : 'flex-start'}>
                <Icon as={icon} boxSize={5} color="white" />
                {!isCollapsed && <Text color="white">{label}</Text>}
              </HStack>
            </NavLink>
          </Tooltip>
        ))}
      </VStack>
    </Box>
  );
}

export default Sidebar;
