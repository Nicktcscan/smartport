import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Button,
  Checkbox,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tooltip,
  Tr,
  useColorModeValue,
  useDisclosure,
  VStack,
  Skeleton,
  Heading,
} from '@chakra-ui/react';
import { FaTrash, FaFileExport, FaEye, FaSortUp, FaSortDown } from 'react-icons/fa';

const PAGE_SIZE = 10;

const sampleInspections = [
  {
    id: 'CI-001',
    dateTime: '2025-08-01 10:30',
    status: 'Passed',
    cargoType: 'Electronics',
    inspector: 'Alice',
    comments: 'No issues found.',
    imageUrl: 'https://via.placeholder.com/300x200?text=Inspection+CI-001',
  },
  {
    id: 'CI-002',
    dateTime: '2025-08-01 11:00',
    status: 'Failed',
    cargoType: 'Furniture',
    inspector: 'Bob',
    comments: 'Damaged packaging.',
    imageUrl: 'https://via.placeholder.com/300x200?text=Inspection+CI-002',
  },
  // ... add more sample data as needed
];

export default function CargoInspection() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterCargoType, setFilterCargoType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterInspector, setFilterInspector] = useState('all');

  // Sorting
  const [sortKey, setSortKey] = useState(null);
  const [sortOrder, setSortOrder] = useState(null); // 'asc' | 'desc'

  // Pagination
  const [page, setPage] = useState(1);

  // Selection
  const [selectedIds, setSelectedIds] = useState([]);

  // Modal
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [selectedRecord, setSelectedRecord] = useState(null);

  // Call useColorModeValue hooks at top-level to fix React hook conditional call error
  const bgComments = useColorModeValue('gray.100', 'gray.700');
  const bgImageBox = useColorModeValue('gray.100', 'gray.700');
  const tableBg = useColorModeValue('gray.50', 'gray.700');
  const theadBg = useColorModeValue('gray.100', 'gray.600');

  // Possible filter options derived from data (cargoTypes, statuses, inspectors)
  const cargoTypes = useMemo(() => {
    const setTypes = new Set(records.map((r) => r.cargoType));
    return Array.from(setTypes).sort();
  }, [records]);

  const statuses = useMemo(() => {
    const setStatuses = new Set(records.map((r) => r.status));
    return Array.from(setStatuses).sort();
  }, [records]);

  const inspectors = useMemo(() => {
    const setInspectors = new Set(records.map((r) => r.inspector));
    return Array.from(setInspectors).sort();
  }, [records]);

  useEffect(() => {
    // Simulate loading data
    setLoading(true);
    setTimeout(() => {
      setRecords(sampleInspections);
      setLoading(false);
    }, 800);
  }, []);

  // Filtered records based on filters
  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      if (filterCargoType !== 'all' && r.cargoType !== filterCargoType) return false;
      if (filterStatus !== 'all' && r.status !== filterStatus) return false;
      if (filterInspector !== 'all' && r.inspector !== filterInspector) return false;
      return true;
    });
  }, [records, filterCargoType, filterStatus, filterInspector]);

  // Sorted records
  const sortedRecords = useMemo(() => {
    if (!sortKey) return filteredRecords;

    const sorted = [...filteredRecords].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return aVal.localeCompare(bVal);
      }
      if (aVal < bVal) return -1;
      if (aVal > bVal) return 1;
      return 0;
    });

    if (sortOrder === 'desc') sorted.reverse();
    return sorted;
  }, [filteredRecords, sortKey, sortOrder]);

  // Pagination info
  const totalPages = Math.max(1, Math.ceil(sortedRecords.length / PAGE_SIZE));
  const paginatedRecords = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return sortedRecords.slice(start, start + PAGE_SIZE);
  }, [sortedRecords, page]);

  // Sort handler
  function handleSort(key) {
    if (sortKey === key) {
      // cycle asc -> desc -> none
      if (sortOrder === 'asc') {
        setSortOrder('desc');
      } else if (sortOrder === 'desc') {
        setSortKey(null);
        setSortOrder(null);
      } else {
        setSortOrder('asc');
      }
    } else {
      setSortKey(key);
      setSortOrder('asc');
    }
  }

  // Get sort direction for aria-sort & icon
  function getSortDirection(key) {
    if (sortKey !== key) return null;
    return sortOrder;
  }

  // Render sort icon
  function renderSortIcon(key) {
    const dir = getSortDirection(key);
    if (dir === 'asc') return <FaSortUp aria-label="ascending" />;
    if (dir === 'desc') return <FaSortDown aria-label="descending" />;
    return null;
  }

  // Selection toggles
  function toggleSelectOne(id) {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((x) => x !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  }

  function toggleSelectAll() {
    if (
      paginatedRecords.length > 0 &&
      selectedIds.length === paginatedRecords.length
    ) {
      // Deselect all on page
      setSelectedIds([]);
    } else {
      // Select all on current page
      setSelectedIds(paginatedRecords.map((r) => r.id));
    }
  }

  // Bulk Delete
  function handleBulkDelete() {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Delete ${selectedIds.length} selected inspection(s)?`))
      return;

    setRecords(records.filter((r) => !selectedIds.includes(r.id)));
    setSelectedIds([]);
    setPage(1);
  }

  // Export CSV utility
  function exportCSV(exportAllFiltered) {
    const toExport = exportAllFiltered ? sortedRecords : records.filter(r => selectedIds.includes(r.id));
    if (toExport.length === 0) {
      alert('No records to export.');
      return;
    }

    const header = ['ID', 'Date/Time', 'Status', 'Cargo Type', 'Inspector', 'Comments'];
    const rows = toExport.map((r) => [
      r.id,
      r.dateTime,
      r.status,
      r.cargoType,
      r.inspector,
      r.comments.replace(/\n/g, ' '),
    ]);

    let csvContent =
      'data:text/csv;charset=utf-8,' +
      [header, ...rows].map((e) => e.map((v) => `"${v}"`).join(',')).join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.href = encodedUri;
    const fileName = exportAllFiltered
      ? 'cargo_inspections_filtered.csv'
      : 'cargo_inspections_selected.csv';
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // View Details modal open
  function handleViewDetails(record) {
    setSelectedRecord(record);
    onOpen();
  }

  return (
    <Box p={4}>
      <Heading as="h1" size="xl" mb={6}>
        Cargo Inspection
      </Heading>

      {/* Filters and bulk actions */}
      <VStack spacing={4} align="stretch" mb={4}>
        <HStack spacing={4} flexWrap="wrap" justify="space-between">
          <HStack spacing={3} flexWrap="wrap">
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

          <HStack spacing={3} flexWrap="wrap">
            <Button
              colorScheme="red"
              size="sm"
              leftIcon={<FaTrash />}
              onClick={handleBulkDelete}
              isDisabled={selectedIds.length === 0}
              aria-label="Bulk delete selected inspections"
            >
              Delete Selected
            </Button>

            <Button
              size="sm"
              leftIcon={<FaFileExport />}
              onClick={() => exportCSV(true)}
              aria-label="Export all filtered inspections as CSV"
            >
              Export All Filtered
            </Button>

            <Button
              size="sm"
              leftIcon={<FaFileExport />}
              onClick={() => exportCSV(false)}
              aria-label="Export selected inspections as CSV"
              isDisabled={selectedIds.length === 0}
            >
              Export Selected
            </Button>
          </HStack>
        </HStack>
      </VStack>

      {/* Table */}
      <Box borderWidth="1px" borderRadius="md" overflowX="auto" bg={tableBg}>
        <Table variant="striped" size="sm" aria-label="Cargo inspection records table">
          <Thead bg={theadBg}>
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
                  aria-label="Select all inspections on current page"
                />
              </Th>
              <Th
                cursor="pointer"
                onClick={() => handleSort('id')}
                aria-sort={getSortDirection('id') || 'none'}
                isNumeric={false}
              >
                ID {renderSortIcon('id')}
              </Th>
              <Th
                cursor="pointer"
                onClick={() => handleSort('dateTime')}
                aria-sort={getSortDirection('dateTime') || 'none'}
              >
                Date/Time {renderSortIcon('dateTime')}
              </Th>
              <Th>Status</Th>
              <Th>Cargo Type</Th>
              <Th>Inspector</Th>
              <Th>Comments</Th>
              <Th>Actions</Th>
            </Tr>
          </Thead>
          <Tbody>
            {loading
              ? Array.from({ length: PAGE_SIZE }).map((_, idx) => (
                  <Tr key={idx}>
                    <Td px={2}>
                      <Skeleton height="20px" width="20px" />
                    </Td>
                    <Td>
                      <Skeleton height="20px" />
                    </Td>
                    <Td>
                      <Skeleton height="20px" />
                    </Td>
                    <Td>
                      <Skeleton height="20px" />
                    </Td>
                    <Td>
                      <Skeleton height="20px" />
                    </Td>
                    <Td>
                      <Skeleton height="20px" />
                    </Td>
                    <Td>
                      <Skeleton height="20px" />
                    </Td>
                    <Td>
                      <Skeleton height="20px" />
                    </Td>
                  </Tr>
                ))
              : paginatedRecords.length === 0 ? (
                <Tr>
                  <Td colSpan={8} textAlign="center" py={6}>
                    No inspection records found.
                  </Td>
                </Tr>
              ) : (
                paginatedRecords.map((rec) => (
                  <Tr key={rec.id}>
                    <Td px={2}>
                      <Checkbox
                        isChecked={selectedIds.includes(rec.id)}
                        onChange={() => toggleSelectOne(rec.id)}
                        aria-label={`Select inspection ${rec.id}`}
                      />
                    </Td>
                    <Td>{rec.id}</Td>
                    <Td>{rec.dateTime}</Td>
                    <Td>{rec.status}</Td>
                    <Td>{rec.cargoType}</Td>
                    <Td>{rec.inspector}</Td>
                    <Td>
                      <Box
                        maxH="80px"
                        overflowY="auto"
                        p={2}
                        borderRadius="md"
                        bg={bgComments}
                        whiteSpace="pre-wrap"
                        fontSize="sm"
                      >
                        {rec.comments}
                      </Box>
                    </Td>
                    <Td>
                      <Tooltip label="View Details" aria-label={`View details for inspection ${rec.id}`}>
                        <IconButton
                          icon={<FaEye />}
                          size="sm"
                          aria-label={`View details of inspection ${rec.id}`}
                          onClick={() => handleViewDetails(rec)}
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
      <HStack mt={4} spacing={4} justify="center" flexWrap="wrap">
        <Button
          onClick={() => setPage(1)}
          isDisabled={page === 1}
          size="sm"
          aria-label="First page"
        >
          {'<<'}
        </Button>
        <Button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          isDisabled={page === 1}
          size="sm"
          aria-label="Previous page"
        >
          {'<'}
        </Button>
        <Text>
          Page {page} of {totalPages}
        </Text>
        <Button
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          isDisabled={page === totalPages}
          size="sm"
          aria-label="Next page"
        >
          {'>'}
        </Button>
        <Button
          onClick={() => setPage(totalPages)}
          isDisabled={page === totalPages}
          size="sm"
          aria-label="Last page"
        >
          {'>>'}
        </Button>
      </HStack>

      {/* Modal for viewing details */}
      <Modal isOpen={isOpen} onClose={onClose} size="lg" isCentered motionPreset="slideInBottom">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Inspection Details</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {selectedRecord ? (
              <>
                <Text fontWeight="bold" mb={2}>
                  ID: {selectedRecord.id}
                </Text>
                <Text mb={2}>Date/Time: {selectedRecord.dateTime}</Text>
                <Text mb={2}>Status: {selectedRecord.status}</Text>
                <Text mb={2}>Cargo Type: {selectedRecord.cargoType}</Text>
                <Text mb={2}>Inspector: {selectedRecord.inspector}</Text>
                <Box
                  maxH="120px"
                  overflowY="auto"
                  p={3}
                  borderRadius="md"
                  bg={bgComments}
                  whiteSpace="pre-wrap"
                  mb={4}
                  fontSize="sm"
                >
                  {selectedRecord.comments}
                </Box>
                <Box
                  maxH="300px"
                  bg={bgImageBox}
                  borderRadius="md"
                  overflow="hidden"
                  display="flex"
                  justifyContent="center"
                  alignItems="center"
                >
                  <img
                    src={selectedRecord.imageUrl}
                    alt={`Inspection ${selectedRecord.id}`}
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                  />
                </Box>
              </>
            ) : (
              <Text>No inspection selected.</Text>
            )}
          </ModalBody>
          <ModalFooter>
            <Button onClick={onClose} aria-label="Close inspection details">
              Close
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
}
