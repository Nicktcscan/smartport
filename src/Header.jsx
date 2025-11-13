// src/components/Header.jsx
import React, { useState } from 'react';
import {
  Flex,
  Text,
  Spacer,
  Avatar,
  Button,
  IconButton,
  Drawer,
  DrawerBody,
  DrawerHeader,
  DrawerOverlay,
  DrawerContent,
  DrawerCloseButton,
  useDisclosure,
  Badge,
  Box,
  Image,
} from '@chakra-ui/react';

import {
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
} from '@chakra-ui/menu';

import { BellIcon } from '@chakra-ui/icons';
import { supabase } from './supabaseClient';

import NotificationPanel from './NotificationPanel';
import logo from './assets/logo.png';
import { useAuth } from './context/AuthContext';
import { useNavigate } from 'react-router-dom';

function Header() {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [notificationsCount] = useState(3);

  const { logout, user } = useAuth() || {};
  const navigate = useNavigate();

  // Unified logout handler
  const handleLogout = async () => {
    try {
      if (typeof logout === 'function') {
        await logout(); // call context logout
      } else if (supabase?.auth?.signOut) {
        await supabase.auth.signOut(); // fallback
      }
    } catch (err) {
      console.error('Logout error:', err);
    }

    // Navigate to login and replace history
    try {
      navigate('/login', { replace: true });
    } catch {
      window.location.href = '/login';
    }
  };

  const displayName =
    (user && (user.full_name || user.username || user.email)) || 'User';

  return (
    <>
      <Flex
        as="header"
        position="fixed"
        top="0"
        left="0"
        right="0"
        zIndex="1100"
        width="100%"
        bg="linear-gradient(90deg, #7B1C1C 0%, #0D1A4B 100%)"
        p={4}
        align="center"
        boxShadow="sm"
        borderBottom="1px"
        borderColor="gray.200"
      >
        <Image src={logo} alt="Company Logo" boxSize="48px" objectFit="contain" mr={3} />

        <Box display="flex" flexDirection="column" lineHeight="1">
          <Text fontSize="xl" fontWeight="bold" color="white">
            SMARTPORT WEIGHBIDGE SYSTEM
          </Text>
          <Text fontSize="sm" color="whiteAlpha.800" mt="2px">
            NICK TC-SCAN (GAMBIA) LTD.
          </Text>
        </Box>

        <Spacer />

        <Box position="relative" mr={4}>
          <IconButton
            aria-label="Notifications"
            icon={<BellIcon color="white" />}
            variant="ghost"
            onClick={onOpen}
            size="lg"
          />
          {notificationsCount > 0 && (
            <Badge
              position="absolute"
              top="0"
              right="0"
              bg="red.500"
              color="white"
              borderRadius="full"
              fontSize="0.7rem"
              px={2}
              transform="translate(50%, -50%)"
            >
              {notificationsCount}
            </Badge>
          )}
        </Box>

        <Menu>
          <MenuButton as={Button} variant="ghost" p={0}>
            <Avatar name={displayName} size="sm" cursor="pointer" />
          </MenuButton>
          <MenuList color="black">
            <MenuItem onClick={handleLogout}>Logout</MenuItem>
          </MenuList>
        </Menu>
      </Flex>

      <Drawer isOpen={isOpen} placement="right" onClose={onClose} size="sm">
        <DrawerOverlay />
        <DrawerContent>
          <DrawerCloseButton />
          <DrawerHeader color="black">Notifications</DrawerHeader>
          <DrawerBody>
            <NotificationPanel />
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    </>
  );
}

export default Header;