// src/pages/HoldReleaseRequests.jsx
import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Heading,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Button,
  Badge,
  Spinner,
  Flex,
  Input,
  InputGroup,
  InputRightElement,
  IconButton,
  useToast,
  AlertDialog,
  AlertDialogBody,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogContent,
  AlertDialogOverlay,
} from '@chakra-ui/react';
import { SearchIcon } from '@chakra-ui/icons';

const mockRequests = [
  {
    id: 'HRR-001',
    cargo: 'Electronics Shipment #1234',
    status: 'Hold',
    requestedBy: 'John Doe',
    date: '2025-07-28',
  },
  {
    id: 'HRR-002',
    cargo: 'Furniture Shipment #5678',
    status: 'Release',
    requestedBy: 'Jane Smith',
    date: '2025-07-29',
  },
  {
    id: 'HRR-003',
    cargo: 'Automotive Parts #9012',
    status: 'Hold',
    requestedBy: 'Mike Johnson',
    date: '2025-07-30',
  },
];

function HoldReleaseRequests() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const toast = useToast();

  // State for confirmation modal
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState(null); // { id, action }
  const cancelRef = useRef();

  useEffect(() => {
    // Simulate API fetch
    setTimeout(() => {
      setRequests(mockRequests);
      setLoading(false);
    }, 1000);
  }, []);

  // Filter requests by search term
  const filteredRequests = requests.filter((req) =>
    req.cargo.toLowerCase().includes(searchTerm.toLowerCase()) ||
    req.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
    req.requestedBy.toLowerCase().includes(searchTerm.toLowerCase())
  );

  function formatDate(dateStr) {
    const options = { year: 'numeric', month: 'short', day: 'numeric' };
    return new Date(dateStr).toLocaleDateString(undefined, options);
  }

  // Called when user clicks Approve/Put On Hold — opens confirmation dialog
  function confirmAction(id, action) {
    setPendingAction({ id, action });
    setIsConfirmOpen(true);
  }

  // Called when user confirms the action in modal
  function handleConfirm() {
    const { id, action } = pendingAction;
    const newStatus = action === 'approve' ? 'Release' : 'Hold';

    setRequests((prev) =>
      prev.map((req) =>
        req.id === id ? { ...req, status: newStatus } : req
      )
    );
    toast({
      title: `Request ${action === 'approve' ? 'approved' : 'put on hold'}`,
      description: `Request ID ${id} has been updated.`,
      status: action === 'approve' ? 'success' : 'info',
      duration: 3000,
      isClosable: true,
    });

    setIsConfirmOpen(false);
    setPendingAction(null);
  }

  return (
    <Box p={6}>
      <Heading mb={6}>Hold & Release Requests</Heading>

      <InputGroup maxW="400px" mb={4}>
        <Input
          aria-label="Search requests by cargo, ID, or requester"
          placeholder="Search by cargo, ID, or requester"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <InputRightElement>
          <IconButton
            aria-label="Clear search"
            icon={<SearchIcon />}
            size="sm"
            onClick={() => setSearchTerm('')}
          />
        </InputRightElement>
      </InputGroup>

      {loading ? (
        <Flex justify="center" align="center" height="200px">
          <Spinner size="xl" />
        </Flex>
      ) : (
        <Table variant="simple" colorScheme="blue" size="md">
          <Thead>
            <Tr>
              <Th>Request ID</Th>
              <Th>Cargo Details</Th>
              <Th>Status</Th>
              <Th>Requested By</Th>
              <Th>Date</Th>
              <Th>Actions</Th>
            </Tr>
          </Thead>
          <Tbody>
            {filteredRequests.length === 0 ? (
              <Tr>
                <Td colSpan={6} textAlign="center" py={6}>
                  No requests found.
                </Td>
              </Tr>
            ) : (
              filteredRequests.map(({ id, cargo, status, requestedBy, date }) => (
                <Tr key={id}>
                  <Td>{id}</Td>
                  <Td>{cargo}</Td>
                  <Td>
                    <Badge colorScheme={status === 'Release' ? 'green' : 'orange'}>
                      {status}
                    </Badge>
                  </Td>
                  <Td>{requestedBy}</Td>
                  <Td>{formatDate(date)}</Td>
                  <Td>
                    {status === 'Hold' ? (
                      <Button
                        size="sm"
                        colorScheme="green"
                        mr={2}
                        onClick={() => confirmAction(id, 'approve')}
                      >
                        Approve Release
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        colorScheme="orange"
                        onClick={() => confirmAction(id, 'hold')}
                      >
                        Put on Hold
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))
            )}
          </Tbody>
        </Table>
      )}

      {/* Confirmation Modal */}
      <AlertDialog
        isOpen={isConfirmOpen}
        leastDestructiveRef={cancelRef}
        onClose={() => setIsConfirmOpen(false)}
        isCentered
      >
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              {pendingAction?.action === 'approve'
                ? 'Approve Release'
                : 'Put on Hold'}
            </AlertDialogHeader>

            <AlertDialogBody>
              Are you sure you want to{' '}
              {pendingAction?.action === 'approve'
                ? 'approve this release request'
                : 'put this request on hold'}
              ?
            </AlertDialogBody>

            <AlertDialogFooter>
              <Button ref={cancelRef} onClick={() => setIsConfirmOpen(false)}>
                Cancel
              </Button>
              <Button
                colorScheme={pendingAction?.action === 'approve' ? 'green' : 'orange'}
                onClick={handleConfirm}
                ml={3}
              >
                Yes
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </Box>
  );
}

export default HoldReleaseRequests;
