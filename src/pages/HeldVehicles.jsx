import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Button,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Checkbox,
  Input,
  Select,
  Text,
  Flex,
  Spinner,
  useToast,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  useDisclosure,
} from '@chakra-ui/react';

const dummyHeldVehicles = [
  {
    id: '1',
    vehicleNumber: 'ABC123',
    heldSince: '2025-07-15',
    reason: 'Customs Inspection',
    imageUrl: 'https://via.placeholder.com/100',
    documents: ['Doc1.pdf', 'Doc2.pdf'],
  },
  {
    id: '2',
    vehicleNumber: 'XYZ789',
    heldSince: '2025-07-10',
    reason: 'Pending Payment',
    imageUrl: 'https://via.placeholder.com/100',
    documents: ['Invoice.pdf'],
  },
  {
    id: '3',
    vehicleNumber: 'DEF456',
    heldSince: '2025-07-20',
    reason: 'Documentation Issue',
    imageUrl: 'https://via.placeholder.com/100',
    documents: [],
  },
  // Add more dummy vehicles here if needed
];

function exportToCsv(data) {
  const csvRows = [];
  const headers = ['ID', 'Vehicle Number', 'Held Since', 'Reason'];
  csvRows.push(headers.join(','));

  data.forEach(({ id, vehicleNumber, heldSince, reason }) => {
    csvRows.push([id, vehicleNumber, heldSince, `"${reason}"`].join(','));
  });

  const csvString = csvRows.join('\n');
  const blob = new Blob([csvString], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = 'held_vehicles.csv';
  a.click();
  URL.revokeObjectURL(url);
}

const ITEMS_PER_PAGE = 5;

const HeldVehicles = () => {
  const [vehicles, setVehicles] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState('heldSince');
  const [sortDirection, setSortDirection] = useState('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  // Modal controls
  const {
    isOpen: isDetailsOpen,
    onOpen: onDetailsOpen,
    onClose: onDetailsClose,
  } = useDisclosure();

  const {
    isOpen: isReleaseOpen,
    onOpen: onReleaseOpen,
    onClose: onReleaseClose,
  } = useDisclosure();

  const {
    isOpen: isBulkReleaseOpen,
    onOpen: onBulkReleaseOpen,
    onClose: onBulkReleaseClose,
  } = useDisclosure();

  const [currentVehicle, setCurrentVehicle] = useState(null);
  const [confirmingRelease, setConfirmingRelease] = useState(false);

  // Simulate fetching
  useEffect(() => {
    setLoading(true);
    setTimeout(() => {
      setVehicles(dummyHeldVehicles);
      setLoading(false);
    }, 500);
  }, []);

  // Filter vehicles by search term (vehicle number or reason)
  const filteredVehicles = useMemo(() => {
    const lowerSearch = searchTerm.toLowerCase();
    return vehicles.filter(
      (v) =>
        v.vehicleNumber.toLowerCase().includes(lowerSearch) ||
        v.reason.toLowerCase().includes(lowerSearch)
    );
  }, [vehicles, searchTerm]);

  // Sort vehicles
  const sortedVehicles = useMemo(() => {
    return filteredVehicles.slice().sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];

      if (sortField === 'heldSince') {
        aVal = new Date(aVal);
        bVal = new Date(bVal);
      } else {
        aVal = aVal.toString().toLowerCase();
        bVal = bVal.toString().toLowerCase();
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredVehicles, sortField, sortDirection]);

  // Pagination
  const totalPages = Math.ceil(sortedVehicles.length / ITEMS_PER_PAGE);
  const paginatedVehicles = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return sortedVehicles.slice(start, start + ITEMS_PER_PAGE);
  }, [sortedVehicles, currentPage]);

  // Handle checkbox toggle for single vehicle
  const toggleSelect = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((sid) => sid !== id) : [...prev, id]
    );
  };

  // Handle select/deselect all visible on page
  const toggleSelectAll = () => {
    if (
      selectedIds.length === paginatedVehicles.length &&
      paginatedVehicles.length > 0
    ) {
      setSelectedIds([]);
    } else {
      setSelectedIds(paginatedVehicles.map((v) => v.id));
    }
  };

  // Open Details modal
  const openDetails = (vehicle) => {
    setCurrentVehicle(vehicle);
    onDetailsOpen();
  };

  // Open Release modal
  const openRelease = (vehicle) => {
    setCurrentVehicle(vehicle);
    onReleaseOpen();
  };

  // Confirm single vehicle release
  const confirmRelease = async () => {
    setConfirmingRelease(true);
    try {
      await new Promise((r) => setTimeout(r, 1000));
      setVehicles((v) => v.filter((veh) => veh.id !== currentVehicle.id));
      setSelectedIds((ids) => ids.filter((id) => id !== currentVehicle.id));
      toast({
        title: 'Vehicle released',
        description: `Vehicle ${currentVehicle.vehicleNumber} has been released.`,
        status: 'success',
        duration: 3000,
        isClosable: true,
      });
      onReleaseClose();
      setCurrentVehicle(null);
    } catch (err) {
      toast({
        title: 'Error',
        description: 'Failed to release vehicle.',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
    } finally {
      setConfirmingRelease(false);
    }
  };

  // Confirm bulk release
  const confirmBulkRelease = async () => {
    setConfirmingRelease(true);
    try {
      await new Promise((r) => setTimeout(r, 1000));
      setVehicles((v) => v.filter((veh) => !selectedIds.includes(veh.id)));
      toast({
        title: 'Vehicles released',
        description: `${selectedIds.length} vehicle(s) have been released.`,
        status: 'success',
        duration: 3000,
        isClosable: true,
      });
      setSelectedIds([]);
      onBulkReleaseClose();
    } catch (err) {
      toast({
        title: 'Error',
        description: 'Failed to release vehicles.',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
    } finally {
      setConfirmingRelease(false);
    }
  };

  // Toggle sorting direction or switch field
  const toggleSort = (field) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  return (
    <Box>
      <Text fontSize="2xl" mb={4} fontWeight="bold">
        Held Vehicles
      </Text>

      {/* Controls */}
      <Flex mb={4} gap={2} flexWrap="wrap" alignItems="center">
        <Input
          placeholder="Search vehicle number or reason"
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setCurrentPage(1);
          }}
          maxW="300px"
        />
        <Select
          w="150px"
          value={sortField}
          onChange={(e) => setSortField(e.target.value)}
        >
          <option value="vehicleNumber">Vehicle Number</option>
          <option value="heldSince">Held Since</option>
          <option value="reason">Reason</option>
        </Select>
        <Button onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}>
          Sort: {sortDirection === 'asc' ? 'Ascending ▲' : 'Descending ▼'}
        </Button>
        <Button colorScheme="blue" onClick={() => exportToCsv(sortedVehicles)}>
          Export CSV
        </Button>
        <Button
          colorScheme="red"
          onClick={onBulkReleaseOpen}
          isDisabled={selectedIds.length === 0}
        >
          Release Selected ({selectedIds.length})
        </Button>
      </Flex>

      {loading ? (
        <Flex justifyContent="center" p={8}>
          <Spinner size="xl" />
        </Flex>
      ) : paginatedVehicles.length === 0 ? (
        <Text>No held vehicles found.</Text>
      ) : (
        <>
          <Table variant="striped" colorScheme="gray" size="sm">
            <Thead>
              <Tr>
                <Th>
                  <Checkbox
                    isChecked={
                      selectedIds.length > 0 &&
                      selectedIds.length === paginatedVehicles.length
                    }
                    isIndeterminate={
                      selectedIds.length > 0 &&
                      selectedIds.length < paginatedVehicles.length
                    }
                    onChange={toggleSelectAll}
                  />
                </Th>
                <Th cursor="pointer" onClick={() => toggleSort('vehicleNumber')}>
                  Vehicle Number{' '}
                  {sortField === 'vehicleNumber'
                    ? sortDirection === 'asc'
                      ? '▲'
                      : '▼'
                    : ''}
                </Th>
                <Th cursor="pointer" onClick={() => toggleSort('heldSince')}>
                  Held Since{' '}
                  {sortField === 'heldSince'
                    ? sortDirection === 'asc'
                      ? '▲'
                      : '▼'
                    : ''}
                </Th>
                <Th cursor="pointer" onClick={() => toggleSort('reason')}>
                  Reason{' '}
                  {sortField === 'reason'
                    ? sortDirection === 'asc'
                      ? '▲'
                      : '▼'
                    : ''}
                </Th>
                <Th>Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {paginatedVehicles.map((vehicle) => (
                <Tr key={vehicle.id}>
                  <Td>
                    <Checkbox
                      isChecked={selectedIds.includes(vehicle.id)}
                      onChange={() => toggleSelect(vehicle.id)}
                    />
                  </Td>
                  <Td>{vehicle.vehicleNumber}</Td>
                  <Td>{vehicle.heldSince}</Td>
                  <Td>{vehicle.reason}</Td>
                  <Td>
                    <Button size="sm" mr={2} onClick={() => openDetails(vehicle)}>
                      Details
                    </Button>
                    <Button
                      size="sm"
                      colorScheme="red"
                      onClick={() => openRelease(vehicle)}
                    >
                      Release
                    </Button>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>

          {/* Pagination */}
          <Flex justifyContent="space-between" alignItems="center" mt={4}>
            <Button
              onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
              isDisabled={currentPage === 1}
            >
              Previous
            </Button>
            <Text>
              Page {currentPage} of {totalPages}
            </Text>
            <Button
              onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
              isDisabled={currentPage === totalPages}
            >
              Next
            </Button>
          </Flex>
        </>
      )}

      {/* Details Modal */}
      <Modal isOpen={isDetailsOpen} onClose={onDetailsClose} size="lg">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Vehicle Details</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {currentVehicle ? (
              <>
                <Text fontWeight="bold" mb={2}>
                  Vehicle Number: {currentVehicle.vehicleNumber}
                </Text>
                <Text mb={2}>Held Since: {currentVehicle.heldSince}</Text>
                <Text mb={2}>Reason: {currentVehicle.reason}</Text>
                <Box mb={4}>
                  <img
                    src={currentVehicle.imageUrl}
                    alt={`Vehicle ${currentVehicle.vehicleNumber}`}
                    style={{ maxWidth: '100%', maxHeight: '250px', borderRadius: '6px' }}
                  />
                </Box>
                <Text fontWeight="bold" mb={2}>
                  Documents:
                </Text>
                {currentVehicle.documents.length === 0 ? (
                  <Text>No documents available.</Text>
                ) : (
                  <ul>
                    {currentVehicle.documents.map((doc, i) => (
                      <li key={i}>{doc}</li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <Text>No vehicle selected.</Text>
            )}
          </ModalBody>
          <ModalFooter>
            <Button onClick={onDetailsClose}>Close</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Release Modal */}
      <Modal isOpen={isReleaseOpen} onClose={onReleaseClose}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Confirm Release</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {currentVehicle && (
              <Text>
                Are you sure you want to release vehicle{' '}
                <b>{currentVehicle.vehicleNumber}</b> held since{' '}
                <b>{currentVehicle.heldSince}</b> for reason: <i>{currentVehicle.reason}</i>?
              </Text>
            )}
          </ModalBody>
          <ModalFooter>
            <Button mr={3} onClick={onReleaseClose} isDisabled={confirmingRelease}>
              Cancel
            </Button>
            <Button
              colorScheme="red"
              onClick={confirmRelease}
              isLoading={confirmingRelease}
            >
              Release
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Bulk Release Modal */}
      <Modal isOpen={isBulkReleaseOpen} onClose={onBulkReleaseClose}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Confirm Bulk Release</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Text>
              Are you sure you want to release the selected{' '}
              <b>{selectedIds.length}</b> vehicle(s)?
            </Text>
          </ModalBody>
          <ModalFooter>
            <Button mr={3} onClick={onBulkReleaseClose} isDisabled={confirmingRelease}>
              Cancel
            </Button>
            <Button
              colorScheme="red"
              onClick={confirmBulkRelease}
              isLoading={confirmingRelease}
            >
              Release All
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
};

export default HeldVehicles;
