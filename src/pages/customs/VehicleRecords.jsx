import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Box,
  Heading,
  Input,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Skeleton,
  HStack,
  Select,
  VStack,
  Text,
  Button,
  useColorModeValue,
  IconButton,
  Tooltip,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  ModalFooter,
  useDisclosure,
  chakra,
  Checkbox,
  CheckboxGroup,
  Stack,
  useToast,
} from '@chakra-ui/react';
import {
  FaSearch,
  FaEye,
  FaSort,
  FaSortUp,
  FaSortDown,
  FaFileExport,
  FaTrash,
} from 'react-icons/fa';

// Mock API fetch function with extended data (images & comments)
const mockFetchVehicleRecords = () =>
  new Promise((resolve) => {
    setTimeout(() => {
      resolve([
        {
          id: 'VH001',
          dateTime: '2025-08-01 09:30',
          status: 'Cleared',
          cargoType: 'Electronics',
          inspector: 'John Doe',
          imageUrl: 'https://via.placeholder.com/150?text=VH001',
          comments: 'Inspected thoroughly, no issues found.',
        },
        {
          id: 'VH002',
          dateTime: '2025-08-01 10:15',
          status: 'Pending',
          cargoType: 'Furniture',
          inspector: 'Jane Smith',
          imageUrl: 'https://via.placeholder.com/150?text=VH002',
          comments: 'Waiting for customs approval.',
        },
        {
          id: 'VH003',
          dateTime: '2025-08-01 11:00',
          status: 'Cleared',
          cargoType: 'Clothing',
          inspector: 'John Doe',
          imageUrl: 'https://via.placeholder.com/150?text=VH003',
          comments: 'No irregularities found.',
        },
        {
          id: 'VH004',
          dateTime: '2025-08-01 11:45',
          status: 'Rejected',
          cargoType: 'Machinery',
          inspector: 'Peter Parker',
          imageUrl: 'https://via.placeholder.com/150?text=VH004',
          comments: 'Rejected due to paperwork issues.',
        },
        {
          id: 'VH005',
          dateTime: '2025-08-01 12:30',
          status: 'Pending',
          cargoType: 'Electronics',
          inspector: 'Mary Jane',
          imageUrl: 'https://via.placeholder.com/150?text=VH005',
          comments: 'Delayed due to cargo inspection.',
        },
      ]);
    }, 1500);
  });

const PAGE_SIZE = 5;

export default function VehicleRecords() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterCargoType, setFilterCargoType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterInspector, setFilterInspector] = useState('all');
  const [page, setPage] = useState(1);

  // Multi-column sorting state: array [{key, direction}]
  const [sortConfig, setSortConfig] = useState([]);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState([]);

  // Modal state
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [selectedRecord, setSelectedRecord] = useState(null);

  const toast = useToast();

  // Fetch data
  const fetchRecords = useCallback(() => {
    setLoading(true);
    mockFetchVehicleRecords()
      .then((data) => {
        setRecords(data);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  // Unique cargo types for filter dropdown
  const cargoTypes = useMemo(() => {
    const types = records.map((r) => r.cargoType);
    return [...new Set(types)];
  }, [records]);

  // Unique statuses
  const statuses = useMemo(() => {
    const sts = records.map((r) => r.status);
    return [...new Set(sts)];
  }, [records]);

  // Unique inspectors
  const inspectors = useMemo(() => {
    const insp = records.map((r) => r.inspector);
    return [...new Set(insp)];
  }, [records]);

  // Filter records by search term and cargo type, status, inspector
  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      const matchesSearch =
        r.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.inspector.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCargo =
        filterCargoType === 'all' || r.cargoType === filterCargoType;
      const matchesStatus = filterStatus === 'all' || r.status === filterStatus;
      const matchesInspector =
        filterInspector === 'all' || r.inspector === filterInspector;

      return matchesSearch && matchesCargo && matchesStatus && matchesInspector;
    });
  }, [records, searchTerm, filterCargoType, filterStatus, filterInspector]);

  // Multi-column sort function
  const sortedRecords = useMemo(() => {
    if (sortConfig.length === 0) return filteredRecords;

    const sorted = [...filteredRecords].sort((a, b) => {
      for (let { key, direction } of sortConfig) {
        let aVal = a[key];
        let bVal = b[key];

        if (key === 'dateTime') {
          aVal = new Date(aVal).getTime();
          bVal = new Date(bVal).getTime();
        }

        if (aVal < bVal) return direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return direction === 'asc' ? 1 : -1;
      }
      return 0;
    });

    return sorted;
  }, [filteredRecords, sortConfig]);

  // Pagination
  const totalPages = Math.ceil(sortedRecords.length / PAGE_SIZE);
  const paginatedRecords = sortedRecords.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE
  );

  // Sort cycle for multi-column sorting
  const handleSort = (key) => {
    setPage(1);
    setSortConfig((current) => {
      const existingIndex = current.findIndex((c) => c.key === key);

      if (existingIndex === -1) {
        return [...current, { key, direction: 'asc' }];
      }

      const currentDirection = current[existingIndex].direction;
      if (currentDirection === 'asc') {
        const newConfig = [...current];
        newConfig[existingIndex].direction = 'desc';
        return newConfig;
      }

      // Remove key
      const newConfig = [...current];
      newConfig.splice(existingIndex, 1);
      return newConfig;
    });
  };

  const handleViewDetails = (record) => {
    setSelectedRecord(record);
    onOpen();
  };

  // Checkbox handlers
  const toggleSelectAll = () => {
    if (selectedIds.length === paginatedRecords.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(paginatedRecords.map((r) => r.id));
    }
  };

  const toggleSelectOne = (id) => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    );
  };

  // Bulk delete selected
  const handleBulkDelete = () => {
    if (selectedIds.length === 0) {
      toast({
        title: 'No records selected',
        status: 'warning',
        duration: 3000,
        isClosable: true,
      });
      return;
    }
    setRecords((current) => current.filter((r) => !selectedIds.includes(r.id)));
    setSelectedIds([]);
    toast({
      title: `Deleted ${selectedIds.length} record(s)`,
      status: 'success',
      duration: 3000,
      isClosable: true,
    });
  };

  // Bulk export selected CSV
  const exportCSV = (all = false) => {
    let dataToExport = all ? sortedRecords : paginatedRecords;
    if (!all && selectedIds.length > 0) {
      dataToExport = sortedRecords.filter((r) => selectedIds.includes(r.id));
    }
    if (dataToExport.length === 0) {
      toast({
        title: 'No data to export',
        status: 'info',
        duration: 2000,
        isClosable: true,
      });
      return;
    }

    const headers = [
      'Vehicle ID',
      'Date/Time',
      'Status',
      'Cargo Type',
      'Inspector',
      'Comments',
    ];

    const csvRows = [
      headers.join(','), // header row
      ...dataToExport.map((r) =>
        [
          r.id,
          `"${r.dateTime}"`,
          r.status,
          r.cargoType,
          `"${r.inspector}"`,
          `"${r.comments}"`,
        ].join(',')
      ),
    ];

    const csvString = csvRows.join('\n');

    const blob = new Blob([csvString], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = all
      ? `vehicle-records-all.csv`
      : selectedIds.length > 0
      ? `vehicle-records-selected.csv`
      : `vehicle-records-page-${page}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Sort icon and aria
  const getSortDirection = (key) => {
    const found = sortConfig.find((c) => c.key === key);
    return found ? found.direction : null;
  };

  const renderSortIcon = (key) => {
    const idx = sortConfig.findIndex((c) => c.key === key);
    if (idx === -1) return <FaSort />;
    return sortConfig[idx].direction === 'asc' ? (
      <>
        <FaSortUp />
        <chakra.span fontSize="xs" ml={1} color="gray.500">
          {idx + 1}
        </chakra.span>
      </>
    ) : (
      <>
        <FaSortDown />
        <chakra.span fontSize="xs" ml={1} color="gray.500">
          {idx + 1}
        </chakra.span>
      </>
    );
  };

  const bgCard = useColorModeValue('white', 'gray.800');
  const textColor = useColorModeValue('gray.700', 'gray.200');

  return (
    <Box maxW="1100px" mx="auto" p={6}>
      <Heading mb={6} color={textColor}>
        Vehicle Records
      </Heading>

      {/* Filters and Bulk Actions */}
      <VStack spacing={4} align="stretch" mb={4}>
        <HStack spacing={4} flexWrap="wrap" justify="space-between">
          <HStack spacing={4} flexWrap="wrap">
            <Input
              placeholder="Search by Vehicle ID or Inspector"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              maxW="300px"
              aria-label="Search vehicles"
            />
            <Select
              maxW="160px"
              value={filterCargoType}
              onChange={(e) => {
                setFilterCargoType(e.target.value);
                setPage(1);
              }}
              aria-label="Filter by Cargo Type"
            >
              <option value="all">All Cargo Types</option>
              {cargoTypes.map((ct) => (
                <option key={ct} value={ct}>
                  {ct}
                </option>
              ))}
            </Select>
            <Select
              maxW="160px"
              value={filterStatus}
              onChange={(e) => {
                setFilterStatus(e.target.value);
                setPage(1);
              }}
              aria-label="Filter by Status"
            >
              <option value="all">All Statuses</option>
              {statuses.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </Select>
            <Select
              maxW="160px"
              value={filterInspector}
              onChange={(e) => {
                setFilterInspector(e.target.value);
                setPage(1);
              }}
              aria-label="Filter by Inspector"
            >
              <option value="all">All Inspectors</option>
              {inspectors.map((insp) => (
                <option key={insp} value={insp}>
                  {insp}
                </option>
              ))}
            </Select>
          </HStack>

          {/* Bulk Action Buttons */}
          <HStack spacing={3} flexWrap="wrap">
            <Button
              colorScheme="red"
              size="sm"
              leftIcon={<FaTrash />}
              onClick={handleBulkDelete}
              isDisabled={selectedIds.length === 0}
              aria-label="Bulk delete selected records"
            >
              Delete Selected
            </Button>
            <Button
              colorScheme="blue"
              size="sm"
              leftIcon={<FaFileExport />}
              onClick={() => exportCSV(false)}
              isDisabled={selectedIds.length === 0}
              aria-label="Export selected records to CSV"
            >
              Export Selected
            </Button>
            <Button
              colorScheme="blue"
              size="sm"
              leftIcon={<FaFileExport />}
              onClick={() => exportCSV(true)}
              aria-label="Export all filtered records to CSV"
            >
              Export All Filtered
            </Button>
          </HStack>
        </HStack>
      </VStack>

      {/* Table */}
      <Box
        borderWidth="1px"
        borderRadius="md"
        overflowX="auto"
        bg={bgCard}
        color={textColor}
      >
        <Table variant="simple" size="sm" aria-label="Vehicle Records Table">
          <Thead bg={useColorModeValue('gray.100', 'gray.700')}>
            <Tr>
              <Th px={2}>
                <Checkbox
                  isChecked={
                    paginatedRecords.length > 0 &&
                    selectedIds.length === paginatedRecords.length
                  }
                  isIndeterminate={
                    selectedIds.length > 0 &&
                    selectedIds.length < paginatedRecords.length
                  }
                  onChange={toggleSelectAll}
                  aria-label="Select all records on current page"
                />
              </Th>
              <Th
                cursor="pointer"
                onClick={() => handleSort('id')}
                userSelect="none"
                aria-sort={
                  getSortDirection('id') === 'asc'
                    ? 'ascending'
                    : getSortDirection('id') === 'desc'
                    ? 'descending'
                    : 'none'
                }
              >
                Vehicle ID {renderSortIcon('id')}
              </Th>
              <Th
                cursor="pointer"
                onClick={() => handleSort('dateTime')}
                userSelect="none"
                aria-sort={
                  getSortDirection('dateTime') === 'asc'
                    ? 'ascending'
                    : getSortDirection('dateTime') === 'desc'
                    ? 'descending'
                    : 'none'
                }
              >
                Date/Time {renderSortIcon('dateTime')}
              </Th>
              <Th
                cursor="pointer"
                onClick={() => handleSort('status')}
                userSelect="none"
                aria-sort={
                  getSortDirection('status') === 'asc'
                    ? 'ascending'
                    : getSortDirection('status') === 'desc'
                    ? 'descending'
                    : 'none'
                }
              >
                Status {renderSortIcon('status')}
              </Th>
              <Th
                cursor="pointer"
                onClick={() => handleSort('cargoType')}
                userSelect="none"
                aria-sort={
                  getSortDirection('cargoType') === 'asc'
                    ? 'ascending'
                    : getSortDirection('cargoType') === 'desc'
                    ? 'descending'
                    : 'none'
                }
              >
                Cargo Type {renderSortIcon('cargoType')}
              </Th>
              <Th
                cursor="pointer"
                onClick={() => handleSort('inspector')}
                userSelect="none"
                aria-sort={
                  getSortDirection('inspector') === 'asc'
                    ? 'ascending'
                    : getSortDirection('inspector') === 'desc'
                    ? 'descending'
                    : 'none'
                }
              >
                Inspector {renderSortIcon('inspector')}
              </Th>
              <Th>Actions</Th>
            </Tr>
          </Thead>
          <Tbody>
            {loading ? (
              Array.from({ length: PAGE_SIZE }).map((_, i) => (
                <Tr key={i}>
                  <Td>
                    <Skeleton height="24px" />
                  </Td>
                  <Td>
                    <Skeleton height="24px" />
                  </Td>
                  <Td>
                    <Skeleton height="24px" />
                  </Td>
                  <Td>
                    <Skeleton height="24px" />
                  </Td>
                  <Td>
                    <Skeleton height="24px" />
                  </Td>
                  <Td>
                    <Skeleton height="24px" />
                  </Td>
                  <Td>
                    <Skeleton height="24px" />
                  </Td>
                </Tr>
              ))
            ) : paginatedRecords.length === 0 ? (
              <Tr>
                <Td colSpan={7} textAlign="center" py={6}>
                  No records found.
                </Td>
              </Tr>
            ) : (
              paginatedRecords.map((record) => (
                <Tr key={record.id}>
                  <Td px={2}>
                    <Checkbox
                      isChecked={selectedIds.includes(record.id)}
                      onChange={() => toggleSelectOne(record.id)}
                      aria-label={`Select record ${record.id}`}
                    />
                  </Td>
                  <Td>{record.id}</Td>
                  <Td>{record.dateTime}</Td>
                  <Td>{record.status}</Td>
                  <Td>{record.cargoType}</Td>
                  <Td>{record.inspector}</Td>
                  <Td>
                    <Tooltip label="View Details">
                      <IconButton
                        aria-label={`View details for ${record.id}`}
                        icon={<FaEye />}
                        size="sm"
                        onClick={() => handleViewDetails(record)}
                      />
                    </Tooltip>
                  </Td>
                </Tr>
              ))
            )}
          </Tbody>
        </Table>
      </Box>

      {/* Pagination */}
      <HStack justify="center" mt={4} spacing={3}>
        <Button
          size="sm"
          onClick={() => setPage((p) => Math.max(p - 1, 1))}
          isDisabled={page === 1}
          aria-label="Previous page"
        >
          Prev
        </Button>
        <Text>
          Page {page} of {totalPages}
        </Text>
        <Button
          size="sm"
          onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
          isDisabled={page === totalPages}
          aria-label="Next page"
        >
          Next
        </Button>
      </HStack>

      {/* Details Modal */}
      <Modal isOpen={isOpen} onClose={onClose} size="md" isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Vehicle Details</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {selectedRecord && (
              <VStack spacing={4} align="start">
                <Text>
                  <b>Vehicle ID:</b> {selectedRecord.id}
                </Text>
                <Text>
                  <b>Date/Time:</b> {selectedRecord.dateTime}
                </Text>
                <Text>
                  <b>Status:</b> {selectedRecord.status}
                </Text>
                <Text>
                  <b>Cargo Type:</b> {selectedRecord.cargoType}
                </Text>
                <Text>
                  <b>Inspector:</b> {selectedRecord.inspector}
                </Text>
                <Text>
                  <b>Comments:</b> {selectedRecord.comments}
                </Text>
                {selectedRecord.imageUrl && (
                  <Box mt={2} w="100%" textAlign="center">
                    <img
                      src={selectedRecord.imageUrl}
                      alt={`Vehicle ${selectedRecord.id}`}
                      style={{ maxWidth: '100%', borderRadius: 6 }}
                    />
                  </Box>
                )}
              </VStack>
            )}
          </ModalBody>
          <ModalFooter>
            <Button onClick={onClose} colorScheme="blue">
              Close
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
}
