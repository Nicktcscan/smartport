// src/pages/CargoInspection.jsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Box,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Button,
  Select,
  Input,
  Spinner,
  Flex,
  Text,
  Checkbox,
  Stack,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  useDisclosure,
  SimpleGrid,
  FormControl,
  FormLabel,
  useToast,
  AlertDialog,
  AlertDialogBody,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogContent,
  AlertDialogOverlay,
} from '@chakra-ui/react';
import { TriangleDownIcon, TriangleUpIcon } from '@chakra-ui/icons';
import { motion, AnimatePresence } from 'framer-motion';

// Simulated API fetch (replace with real fetch)
const fetchCargoData = () =>
  new Promise((res) =>
    setTimeout(
      () =>
        res([
          {
            id: 1,
            cargo_id: 'CARGO001',
            description: 'Electronics',
            weight: 2000,
            status: 'pending',
            flagged: false,
            verified_at: null,
          },
          {
            id: 2,
            cargo_id: 'CARGO002',
            description: 'Furniture',
            weight: 3500,
            status: 'verified',
            flagged: true,
            verified_at: '2025-07-31T14:20:00.000Z',
          },
          // ... more sample data
        ]),
      800
    )
  );

// Columns config
const columns = [
  { key: 'cargo_id', label: 'Cargo ID' },
  { key: 'description', label: 'Description' },
  { key: 'weight', label: 'Weight (kg)' },
  { key: 'status', label: 'Status' },
  { key: 'verified_at', label: 'Verified At' },
  { key: 'flagged', label: 'Flagged' },
];

// Motion-enabled components for animations
const MotionTr = motion.create(Tr);
const MotionButton = motion.create(Button);
const MotionModalContent = motion.create(ModalContent);

export default function CargoVerification() {
  const [cargoList, setCargoList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [visibleColumns, setVisibleColumns] = useState(
    () => JSON.parse(localStorage.getItem('cargoVisibleColumns')) || columns.map(c => c.key)
  );
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Modal state
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [selectedCargo, setSelectedCargo] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [editedCargo, setEditedCargo] = useState(null);

  // Delete confirmation dialog state
  const {
    isOpen: isDeleteOpen,
    onOpen: onDeleteOpen,
    onClose: onDeleteClose,
  } = useDisclosure();
  const cancelRef = useRef();

  const toast = useToast();

  // Fetch cargo data on mount
  useEffect(() => {
    fetchCargoData().then((data) => {
      setCargoList(data);
      setLoading(false);
    });
  }, []);

  // Persist visibleColumns to localStorage
  useEffect(() => {
    localStorage.setItem('cargoVisibleColumns', JSON.stringify(visibleColumns));
  }, [visibleColumns]);

  // Sorting handler
  const onSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };

  // Toggle visible columns
  const toggleColumn = (key) => {
    setVisibleColumns((prev) =>
      prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key]
    );
  };

  // Filter and sort cargo
  const filteredCargo = useMemo(() => {
    let filtered = [...cargoList];

    if (filterStatus !== 'all') {
      filtered = filtered.filter((c) => {
        if (filterStatus === 'flagged') return c.flagged === true;
        return c.status.toLowerCase() === filterStatus.toLowerCase();
      });
    }

    if (searchTerm.trim()) {
      filtered = filtered.filter(
        (c) =>
          c.cargo_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
          c.description.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    if (sortConfig.key) {
      filtered.sort((a, b) => {
        let aVal = a[sortConfig.key];
        let bVal = b[sortConfig.key];

        // For dates, convert to timestamp for comparison
        if (sortConfig.key === 'verified_at') {
          aVal = aVal ? new Date(aVal).getTime() : 0;
          bVal = bVal ? new Date(bVal).getTime() : 0;
        }

        if (typeof aVal === 'string') aVal = aVal.toLowerCase();
        if (typeof bVal === 'string') bVal = bVal.toLowerCase();

        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return filtered;
  }, [cargoList, filterStatus, searchTerm, sortConfig]);

  // Open modal and set selected cargo
  const handleViewClick = (cargo) => {
    setSelectedCargo(cargo);
    setEditedCargo(cargo);
    setEditMode(false);
    onOpen();
  };

  // Handle edit toggle
  const toggleEditMode = () => setEditMode((v) => !v);

  // Handle field change in edit mode
  const handleFieldChange = (key, value) => {
    setEditedCargo((prev) => ({ ...prev, [key]: value }));
  };

  // Save edited cargo (simulated)
  const handleSave = () => {
    setCargoList((prev) =>
      prev.map((c) => (c.id === editedCargo.id ? editedCargo : c))
    );
    setSelectedCargo(editedCargo);
    setEditMode(false);
    toast({
      title: 'Cargo updated.',
      description: `Cargo ${editedCargo.cargo_id} has been updated.`,
      status: 'success',
      duration: 3000,
      isClosable: true,
    });
  };

  // Open delete confirmation dialog
  const handleDeleteClick = () => {
    onDeleteOpen();
  };

  // Confirm deletion (simulated)
  const confirmDelete = () => {
    setCargoList((prev) => prev.filter((c) => c.id !== selectedCargo.id));
    onDeleteClose();
    onClose();
    toast({
      title: 'Cargo deleted.',
      description: `Cargo ${selectedCargo.cargo_id} has been deleted.`,
      status: 'info',
      duration: 3000,
      isClosable: true,
    });
  };

  if (loading) {
    return (
      <Box textAlign="center" py={10}>
        <Spinner size="xl" />
      </Box>
    );
  }

  if (!cargoList.length) {
    return (
      <Box textAlign="center" py={10}>
        <Text>No cargo items found.</Text>
      </Box>
    );
  }

  return (
    <Box p={4}>
      {/* Controls */}
      <Flex flexWrap="wrap" gap={4} mb={4} align="center">
        <Select
          w="200px"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          aria-label="Filter by status"
          _hover={{ bg: 'blue.50' }}
          transition="background-color 0.3s"
        >
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="verified">Verified</option>
          <option value="flagged">Flagged</option>
        </Select>

        <Input
          maxW="300px"
          placeholder="Search Cargo ID or Description"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          aria-label="Search cargo"
          _hover={{ bg: 'blue.50' }}
          transition="background-color 0.3s"
        />
      </Flex>

      {/* Column toggles */}
      <Box mb={4}>
        <Text fontWeight="bold" mb={2}>
          Toggle Columns:
        </Text>
        <Stack direction="row" spacing={4} wrap="wrap">
          {columns.map((col) => (
            <Checkbox
              key={col.key}
              isChecked={visibleColumns.includes(col.key)}
              onChange={() => toggleColumn(col.key)}
              size="sm"
              _hover={{ bg: 'gray.100' }}
              transition="background-color 0.3s"
            >
              {col.label}
            </Checkbox>
          ))}
        </Stack>
      </Box>

      {/* Cargo Table */}
      <Table variant="striped" size="md" boxShadow="md" borderRadius="md" overflow="hidden">
        <Thead bg="blue.600" color="white">
          <Tr>
            {columns
              .filter((col) => visibleColumns.includes(col.key))
              .map((col) => (
                <Th
                  key={col.key}
                  onClick={() => onSort(col.key)}
                  cursor="pointer"
                  userSelect="none"
                  whiteSpace="nowrap"
                  color="white"
                  _hover={{ bg: 'blue.700' }}
                  transition="background-color 0.2s"
                >
                  {col.label}
                  {sortConfig.key === col.key &&
                    (sortConfig.direction === 'asc' ? (
                      <TriangleUpIcon ml={1} />
                    ) : (
                      <TriangleDownIcon ml={1} />
                    ))}
                </Th>
              ))}
            <Th color="white" whiteSpace="nowrap">
              Actions
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {filteredCargo.map((cargo) => (
            <MotionTr
              key={cargo.id}
              whileHover={{ backgroundColor: 'rgba(237, 242, 247, 1)' }}
              transition={{ duration: 0.25 }}
              cursor="default"
            >
              {columns
                .filter((col) => visibleColumns.includes(col.key))
                .map((col) => {
                  let value = cargo[col.key];

                  if (col.key === 'flagged') value = cargo.flagged ? 'Yes' : 'No';
                  if (col.key === 'verified_at') value = cargo.verified_at ? new Date(cargo.verified_at).toLocaleString() : '-';
                  if (col.key === 'status') {
                    return (
                      <Td key={col.key}>
                        <StatusBadge status={value} />
                      </Td>
                    );
                  }

                  return <Td key={col.key}>{value}</Td>;
                })}
              <Td>
                <MotionButton
                  size="sm"
                  colorScheme="blue"
                  onClick={() => handleViewClick(cargo)}
                  whileTap={{ scale: 0.95 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                >
                  View
                </MotionButton>
              </Td>
            </MotionTr>
          ))}
        </Tbody>
      </Table>

      {/* Cargo Details Modal */}
      <Modal
        isOpen={isOpen}
        onClose={() => {
          onClose();
          setEditMode(false);
        }}
        size="lg"
        isCentered
        scrollBehavior="inside"
        motionPreset="slideInBottom"
      >
        <ModalOverlay />
        <AnimatePresence>
          {isOpen && (
            <MotionModalContent
              boxShadow="xl"
              borderRadius="lg"
              p={4}
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 50 }}
              transition={{ duration: 0.3 }}
            >
              <ModalHeader fontWeight="extrabold" fontSize="2xl" color="blue.700">
                Cargo Details {editMode && `(Editing ${editedCargo?.cargo_id})`}
              </ModalHeader>
              <ModalCloseButton />

              <ModalBody pb={6}>
                {selectedCargo ? (
                  <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                    <FormControl>
                      <FormLabel>Cargo ID</FormLabel>
                      {editMode ? (
                        <Input
                          value={editedCargo.cargo_id}
                          onChange={(e) => handleFieldChange('cargo_id', e.target.value)}
                          isDisabled
                        />
                      ) : (
                        <Text>{selectedCargo.cargo_id}</Text>
                      )}
                    </FormControl>

                    <FormControl>
                      <FormLabel>Description</FormLabel>
                      {editMode ? (
                        <Input
                          value={editedCargo.description}
                          onChange={(e) => handleFieldChange('description', e.target.value)}
                        />
                      ) : (
                        <Text>{selectedCargo.description}</Text>
                      )}
                    </FormControl>

                    <FormControl>
                      <FormLabel>Weight (kg)</FormLabel>
                      {editMode ? (
                        <Input
                          type="number"
                          value={editedCargo.weight}
                          onChange={(e) => handleFieldChange('weight', Number(e.target.value))}
                          min={0}
                        />
                      ) : (
                        <Text>{selectedCargo.weight}</Text>
                      )}
                    </FormControl>

                    <FormControl>
                      <FormLabel>Status</FormLabel>
                      {editMode ? (
                        <Select
                          value={editedCargo.status}
                          onChange={(e) => handleFieldChange('status', e.target.value)}
                        >
                          <option value="pending">Pending</option>
                          <option value="verified">Verified</option>
                          <option value="flagged">Flagged</option>
                        </Select>
                      ) : (
                        <StatusBadge status={selectedCargo.status} />
                      )}
                    </FormControl>

                    <FormControl>
                      <FormLabel>Flagged</FormLabel>
                      {editMode ? (
                        <Checkbox
                          isChecked={editedCargo.flagged}
                          onChange={(e) => handleFieldChange('flagged', e.target.checked)}
                        />
                      ) : (
                        <Text>{selectedCargo.flagged ? 'Yes' : 'No'}</Text>
                      )}
                    </FormControl>

                    <FormControl>
                      <FormLabel>Verified At</FormLabel>
                      {editMode ? (
                        <Input
                          type="datetime-local"
                          value={
                            editedCargo.verified_at
                              ? new Date(editedCargo.verified_at).toISOString().slice(0, 16)
                              : ''
                          }
                          onChange={(e) => handleFieldChange('verified_at', new Date(e.target.value).toISOString())}
                        />
                      ) : (
                        <Text>
                          {selectedCargo.verified_at
                            ? new Date(selectedCargo.verified_at).toLocaleString()
                            : '-'}
                        </Text>
                      )}
                    </FormControl>
                  </SimpleGrid>
                ) : (
                  <Text>No cargo selected.</Text>
                )}
              </ModalBody>

              <ModalFooter gap={3}>
                {editMode ? (
                  <>
                    <MotionButton
                      colorScheme="green"
                      onClick={handleSave}
                      whileTap={{ scale: 0.95 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    >
                      Save
                    </MotionButton>
                    <MotionButton
                      onClick={() => setEditMode(false)}
                      whileTap={{ scale: 0.95 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    >
                      Cancel
                    </MotionButton>
                  </>
                ) : (
                  <>
                    <MotionButton
                      colorScheme="blue"
                      onClick={toggleEditMode}
                      whileTap={{ scale: 0.95 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    >
                      Edit
                    </MotionButton>
                    <MotionButton
                      colorScheme="red"
                      onClick={handleDeleteClick}
                      whileTap={{ scale: 0.95 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    >
                      Delete
                    </MotionButton>
                    <MotionButton
                      onClick={() => {
                        onClose();
                        setEditMode(false);
                      }}
                    >
                      Close
                    </MotionButton>
                  </>
                )}
              </ModalFooter>
            </MotionModalContent>
          )}
        </AnimatePresence>
      </Modal>

      {/* Delete Confirmation AlertDialog */}
      <AlertDialog
        isOpen={isDeleteOpen}
        leastDestructiveRef={cancelRef}
        onClose={onDeleteClose}
        isCentered
      >
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold" color="red.600">
              Delete Cargo
            </AlertDialogHeader>

            <AlertDialogBody>
              Are you sure you want to delete cargo{' '}
              <strong>{selectedCargo?.cargo_id}</strong>? This action cannot be undone.
            </AlertDialogBody>

            <AlertDialogFooter>
              <Button ref={cancelRef} onClick={onDeleteClose}>
                Cancel
              </Button>
              <Button colorScheme="red" onClick={confirmDelete} ml={3}>
                Delete
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </Box>
  );
}

function StatusBadge({ status }) {
  const colorMap = {
    pending: 'yellow',
    verified: 'green',
    flagged: 'red',
  };
  return (
    <Box
      px={2}
      py={1}
      borderRadius="md"
      bg={`${colorMap[status] || 'gray'}.300`}
      color={`${colorMap[status] || 'gray'}.800`}
      fontWeight="semibold"
      textAlign="center"
      userSelect="none"
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Box>
  );
}
