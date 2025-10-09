// src/components/Layout.jsx
import React, { useState, useEffect } from 'react';
import { Box, useBreakpointValue } from '@chakra-ui/react';
import Sidebar from './Sidebar';

function Layout({ children }) {
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(false);
  const isMobile = useBreakpointValue({ base: true, md: false });

  useEffect(() => {
    setSidebarCollapsed(isMobile);
  }, [isMobile]);

  const toggleSidebar = () => setSidebarCollapsed(prev => !prev);

  const expandedSidebarWidth = 288;
  const collapsedSidebarWidth = 60;
  const sidebarWidth = isSidebarCollapsed ? collapsedSidebarWidth : expandedSidebarWidth;

  const headerHeight = 64; // Adjust this to match your Header height (in px)

  return (
    <>
      {/* Fixed Sidebar */}
      <Box
        as="aside"
        position="fixed"
        top={`${headerHeight}px`} // 👈 Start sidebar below the header
        left="0"
        height={`calc(100vh - ${headerHeight}px)`} // 👈 Subtract header height from full height
        width={`${sidebarWidth}px`}
        bg="white"
        borderRight="1px solid #E2E8F0"
        overflowY="auto"
        transition="width 0.3s ease"
        zIndex="100"
      >
        <Sidebar isCollapsed={isSidebarCollapsed} toggleCollapse={toggleSidebar} />
      </Box>

      {/* Scrollable Main Content */}
      <Box
        as="main"
        ml={`${sidebarWidth}px`}
        pt={`${headerHeight + 16}px`} // 👈 Top padding = header height + some spacing
        px={{ base: 4, md: 6, lg: 8 }}
        minHeight="100vh"
        bg="white"
        overflowX="hidden"
        overflowY="auto"
      >
        {children}
      </Box>
    </>
  );
}

export default Layout;
