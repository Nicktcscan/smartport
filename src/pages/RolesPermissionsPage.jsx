// src/pages/RolesPermissionsPage.jsx
import React, { useState, useRef } from 'react';
import {
  Box,
  Heading,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Checkbox,
  Button,
  VStack,
  HStack,
  useToast,
  Tooltip,
  useDisclosure,
  AlertDialog,
  AlertDialogOverlay,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogBody,
  AlertDialogFooter,
  useColorModeValue,
  chakra,
} from '@chakra-ui/react';

const initialRoles = [
  {
    name: 'admin',
    permissions: ['manage_users', 'view_reports', 'edit_settings'],
  },
  {
    name: 'customs',
    permissions: ['view_customs_data'],
  },
  {
    name: 'outgate',
    permissions: ['view_outgate_data'],
  },
  {
    name: 'weighbridge',
    permissions: ['upload_tickets', 'view_dashboard'],
  },
];

// Detailed labels and descriptions for permissions
const permissionDetails = {
  manage_users: 'Manage users (add, edit, remove)',
  view_reports: 'Access and view reports',
  edit_settings: 'Modify system settings',
  view_customs_data: 'View customs related data',
  view_outgate_data: 'View outgate operations data',
  upload_tickets: 'Upload new weighbridge tickets',
  view_dashboard: 'Access weighbridge dashboard',
};

const allPermissions = Object.keys(permissionDetails);

export default function RolesPermissionsPage() {
  const [roles, setRoles] = useState(initialRoles);
  const [originalRoles, setOriginalRoles] = useState(initialRoles);
  const toast = useToast();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const cancelRef = useRef();

  // Detect if there are unsaved changes
  const hasChanges = JSON.stringify(roles) !== JSON.stringify(originalRoles);

  // Get colors once here (fix React hooks rules)
  const headerBg = useColorModeValue('gray.100', 'gray.800');
  const borderColor = useColorModeValue('gray.200', 'gray.700');
  const changedCellBg = useColorModeValue('green.50', 'green.900');
  const rowHoverBg = useColorModeValue('gray.50', 'gray.700');

  // Toggle permission on a specific role
  const togglePermission = (roleName, permission) => {
    setRoles((prevRoles) =>
      prevRoles.map((role) => {
        if (role.name !== roleName) return role;
        const hasPermission = role.permissions.includes(permission);
        const updatedPermissions = hasPermission
          ? role.permissions.filter((p) => p !== permission)
          : [...role.permissions, permission];
        return { ...role, permissions: updatedPermissions };
      })
    );
  };

  // Select all permissions for a role
  const selectAllForRole = (roleName) => {
    setRoles((prevRoles) =>
      prevRoles.map((role) => {
        if (role.name !== roleName) return role;
        return { ...role, permissions: allPermissions };
      })
    );
  };

  // Deselect all permissions for a role
  const deselectAllForRole = (roleName) => {
    setRoles((prevRoles) =>
      prevRoles.map((role) => {
        if (role.name !== roleName) return role;
        return { ...role, permissions: [] };
      })
    );
  };

  // Select all permissions for all roles
  const selectAll = () => {
    setRoles((prevRoles) =>
      prevRoles.map((role) => ({
        ...role,
        permissions: allPermissions,
      }))
    );
  };

  // Deselect all permissions for all roles
  const deselectAll = () => {
    setRoles((prevRoles) =>
      prevRoles.map((role) => ({
        ...role,
        permissions: [],
      }))
    );
  };

  // Undo changes (reset to original)
  const undoChanges = () => {
    setRoles(originalRoles);
    toast({
      title: 'Changes reverted.',
      status: 'info',
      duration: 2500,
      isClosable: true,
    });
  };

  const handleSave = () => {
    onOpen(); // Open confirmation dialog
  };

  const confirmSave = () => {
    // Call your API here to save roles & permissions
    setOriginalRoles(roles);
    onClose();
    toast({
      title: 'Roles and permissions saved.',
      status: 'success',
      duration: 3000,
      isClosable: true,
    });
  };

  // Helper to detect if a permission checkbox changed for a role
  const isPermissionChanged = (roleName, permission) => {
    const originalRole = originalRoles.find((r) => r.name === roleName);
    if (!originalRole) return false;
    const hadPermission = originalRole.permissions.includes(permission);
    const hasPermissionNow = roles
      .find((r) => r.name === roleName)
      .permissions.includes(permission);
    return hadPermission !== hasPermissionNow;
  };

  return (
    <Box p={6} maxW="100vw" overflowX="auto">
      <Heading mb={6} fontSize={['2xl', '3xl']}>
        Roles & Permissions
      </Heading>

      <HStack mb={4} spacing={4} flexWrap="wrap" justify="space-between">
        <VStack spacing={2} align="start">
          <Button size="sm" onClick={selectAll} colorScheme="teal" variant="solid">
            Select All Permissions
          </Button>
          <Button size="sm" onClick={deselectAll} variant="outline" colorScheme="red">
            Deselect All Permissions
          </Button>
        </VStack>

        <VStack spacing={2} align="end">
          <Button
            size="sm"
            onClick={undoChanges}
            variant="ghost"
            colorScheme="yellow"
            isDisabled={!hasChanges}
          >
            Undo Changes
          </Button>
          <Button
            size="sm"
            colorScheme="teal"
            onClick={handleSave}
            isDisabled={!hasChanges}
            aria-disabled={!hasChanges}
            fontWeight="bold"
            boxShadow="md"
          >
            Save Changes
          </Button>
        </VStack>
      </HStack>

      <Box overflowX="auto" border="1px solid" borderColor={borderColor} borderRadius="md">
        <Table
          variant="striped"
          size="md"
          whiteSpace="nowrap"
          sx={{
            'thead tr': {
              position: 'sticky',
              top: 0,
              backgroundColor: headerBg,
              zIndex: 2,
            },
          }}
        >
          <Thead>
            <Tr>
              <Th>Role</Th>
              {allPermissions.map((perm) => (
                <Th
                  key={perm}
                  textTransform="capitalize"
                  fontSize="sm"
                  whiteSpace="nowrap"
                  textAlign="center"
                >
                  <Tooltip label={permissionDetails[perm]} placement="top" openDelay={300}>
                    <chakra.span>{perm.replace(/_/g, ' ')}</chakra.span>
                  </Tooltip>
                </Th>
              ))}
              <Th textAlign="center" minW="140px">
                Actions
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {roles.map(({ name, permissions }) => (
              <Tr key={name} _hover={{ bg: rowHoverBg }}>
                <Td fontWeight="bold" textTransform="capitalize" minW="150px">
                  {name}
                </Td>
                {allPermissions.map((perm) => (
                  <Td
                    key={perm}
                    textAlign="center"
                    bg={isPermissionChanged(name, perm) ? changedCellBg : undefined}
                    transition="background-color 0.3s"
                  >
                    <Checkbox
                      isChecked={permissions.includes(perm)}
                      onChange={() => togglePermission(name, perm)}
                      colorScheme="teal"
                      aria-label={`${
                        permissions.includes(perm) ? 'Revoke' : 'Grant'
                      } permission '${perm.replace(/_/g, ' ')}' for role ${name}`}
                    />
                  </Td>
                ))}
                <Td textAlign="center" minW="140px">
                  <HStack spacing={2} justify="center" flexWrap="wrap">
                    <Button
                      size="xs"
                      colorScheme="teal"
                      variant="outline"
                      onClick={() => selectAllForRole(name)}
                      aria-label={`Select all permissions for ${name}`}
                    >
                      Select All
                    </Button>
                    <Button
                      size="xs"
                      colorScheme="red"
                      variant="outline"
                      onClick={() => deselectAllForRole(name)}
                      aria-label={`Deselect all permissions for ${name}`}
                    >
                      Clear All
                    </Button>
                  </HStack>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Box>

      {/* Save Confirmation Dialog */}
      <AlertDialog isOpen={isOpen} leastDestructiveRef={cancelRef} onClose={onClose} isCentered>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              Confirm Save
            </AlertDialogHeader>

            <AlertDialogBody>
              Are you sure you want to save these changes to roles and permissions? This action
              cannot be undone.
            </AlertDialogBody>

            <AlertDialogFooter>
              <Button ref={cancelRef} onClick={onClose}>
                Cancel
              </Button>
              <Button colorScheme="teal" onClick={confirmSave} ml={3}>
                Yes, Save
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </Box>
  );
}
