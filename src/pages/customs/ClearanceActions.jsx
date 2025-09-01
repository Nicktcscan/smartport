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
  useToast,
} from '@chakra-ui/react';
import { FaTrash, FaFileExport, FaEye, FaSortUp, FaSortDown, FaCheck, FaTimes, FaPause } from 'react-icons/fa';

const PAGE_SIZE = 10;

const sampleActions = [
  {
    id: 'CA-1001',
    dateTime: '2025-08-02 09:45',
    actionType: 'Approve',
    status: 'Completed',
    officer: 'John Doe',
    remarks: 'All documents verified.',
    cargoId: 'CI-001',
  },
  {
    id: 'CA-1002',
    dateTime: '2025-08-02 10:15',
    actionType: 'Hold',
    status: 'Pending',
    officer: 'Jane Smith',
    remarks: 'Missing paperwork.',
    cargoId: 'CI-002',
  },
  {
    id: 'CA-1003',
    dateTime: '2025-08-02 11:00',
    actionType: 'Reject',
    status: 'Completed',
    officer: 'John Doe',
    remarks: 'Failed inspection criteria.',
    cargoId: 'CI-003',
  },
  // Add more sample data as needed
];

export default function ClearanceActions() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterActionType, setFilterActionType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterOfficer, setFilterOfficer] = useState('all');

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

  // Toast for feedback on actions
  const toast = useToast();

  // Chakra UI colors at top-level
  const bgRemarks = useColorModeValue('gray.100', 'gray.700');
  const tableBg = useColorModeValue('gray.50', 'gray.700');
  const theadBg = useColorModeValue('gray.100', 'gray.600');

  // Derive filter options
  const actionTypes = useMemo(() => {
    const setTypes = new Set(records.map((r) => r.actionType));
    return Array.from(setTypes).sort();
  }, [records]);

  const statuses = useMemo(() => {
    const setStatuses = new Set(records.map((r) => r.status));
    return Array.from(setStatuses).sort();
  }, [records]);

  const officers = useMemo(() => {
    const setOfficers = new Set(records.map((r) => r.officer));
    return Array.from(setOfficers).sort();
  }, [records]);

  useEffect(() => {
    // Simulate loading
    setLoading(true);
    setTimeout(() => {
      setRecords(sampleActions);
      setLoading(false);
    }, 800);
  }, []);

  // Filtering
  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      if (filterActionType !== 'all' && r.actionType !== filterActionType) return false;
      if (filterStatus !== 'all' && r.status !== filterStatus) return false;
      if (filterOfficer !== 'all' && r.officer !== filterOfficer) return false;
      return true;
    });
  }, [records, filterActionType, filterStatus, filterOfficer]);

  // Sorting
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

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sortedRecords.length / PAGE_SIZE));
  const paginatedRecords = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return sortedRecords.slice(start, start + PAGE_SIZE);
  }, [sortedRecords, page]);

  // Sorting handlers
  function handleSort(key) {
    if (sortKey === key) {
      if (sortOrder === 'asc') setSortOrder('desc');
      else if (sortOrder === 'desc') {
        setSortKey(null);
        setSortOrder(null);
      } else setSortOrder('asc');
    } else {
      setSortKey(key);
      setSortOrder('asc');
    }
  }

  function getSortDirection(key) {
    if (sortKey !== key) return null;
    return sortOrder;
  }

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
      setSelectedIds([]);
    } else {
      setSelectedIds(paginatedRecords.map((r) => r.id));
    }
  }

  // Bulk Delete
  function handleBulkDelete() {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Delete ${selectedIds.length} selected action(s)?`))
      return;

    setRecords(records.filter((r) => !selectedIds.includes(r.id)));
    setSelectedIds([]);
    setPage(1);
    toast({
      title: 'Deleted',
      description: `${selectedIds.length} clearance action(s) deleted.`,
      status: 'success',
      duration: 3000,
      isClosable: true,
    });
  }

  // Export CSV
  function exportCSV(exportAllFiltered) {
    const toExport = exportAllFiltered ? sortedRecords : records.filter(r => selectedIds.includes(r.id));
    if (toExport.length === 0) {
      alert('No records to export.');
      return;
    }

    const header = ['ID', 'Date/Time', 'Action Type', 'Status', 'Officer', 'Remarks', 'Cargo ID'];
    const rows = toExport.map((r) => [
      r.id,
      r.dateTime,
      r.actionType,
      r.status,
      r.officer,
      r.remarks.replace(/\n/g, ' '),
      r.cargoId,
    ]);

    let csvContent =
      'data:text/csv;charset=utf-8,' +
      [header, ...rows].map((e) => e.map((v) => `"${v}"`).join(',')).join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.href = encodedUri;
    const fileName = exportAllFiltered
      ? 'clearance_actions_filtered.csv'
      : 'clearance_actions_selected.csv';
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Modal open
  function handleViewDetails(record) {
    setSelectedRecord(record);
    onOpen();
  }

  // Action buttons handler (Approve, Reject, Hold)
  function handleAction(action) {
    if (!selectedRecord) return;

    // Just simulate update status here
    const updatedStatus = action === 'Approve' ? 'Completed' : action === 'Reject' ? 'Rejected' : 'On Hold';

    setRecords((prev) =>
      prev.map((r) =>
        r.id === selectedRecord.id ? { ...r, status: updatedStatus } : r
      )
    );

    toast({
      title: `Action: ${action}`,
      description: `Clearance action ${selectedRecord.id} marked as ${updatedStatus}.`,
      status: 'info',
      duration: 3000,
      isClosable: true,
    });

    // Update selectedRecord so modal updates
    setSelectedRecord((prev) => (prev ? { ...prev, status: updatedStatus } : null));
  }

  return (
    <Box p={4}>
      <Heading as="h1" size="xl" mb={6}>
        Clearance Actions
      </Heading>

      {/* Filters & bulk actions */}
      <VStack spacing={4} align="stretch" mb={4}>
        <HStack spacing={4} flexWrap="wrap" justify="space-between">
          <HStack spacing={3} flexWrap="wrap">
            <Select
              maxW="160px"
              value={filterActionType}
              onChange={(e) => {
                setFilterActionType(e.target.value);
                setPage(1);
              }}
              aria-label="Filter by Action Type"
            >
              <option value="all">All Action Types</option>
              {actionTypes.map((at) => (
                <option key={at} value={at}>
                  {at}
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
              value={filterOfficer}
              onChange={(e) => {
                setFilterOfficer(e.target.value);
                setPage(1);
              }}
              aria-label="Filter by Officer"
            >
              <option value="all">All Officers</option>
              {officers.map((off) => (
                <option key={off} value={off}>
                  {off}
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
              aria-label="Bulk delete selected clearance actions"
            >
              Delete Selected
            </Button>

            <Button
              size="sm"
              leftIcon={<FaFileExport />}
              onClick={() => exportCSV(true)}
              aria-label="Export all filtered clearance actions as CSV"
            >
              Export All Filtered
            </Button>

            <Button
              size="sm"
              leftIcon={<FaFileExport />}
              onClick={() => exportCSV(false)}
              aria-label="Export selected clearance actions as CSV"
              isDisabled={selectedIds.length === 0}
            >
              Export Selected
            </Button>
          </HStack>
        </HStack>
      </VStack>

      {/* Table */}
      <Box borderWidth="1px" borderRadius="md" overflowX="auto" bg={tableBg}>
        <Table variant="striped" size="sm" aria-label="Clearance actions records table">
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
                  aria-label="Select all clearance actions on current page"
                />
              </Th>
              <Th
                cursor="pointer"
                onClick={() => handleSort('id')}
                aria-sort={getSortDirection('id') || 'none'}
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
              <Th>Action Type</Th>
              <Th>Status</Th>
              <Th>Officer</Th>
              <Th>Remarks</Th>
              <Th>Cargo ID</Th>
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
                    <Td>
                      <Skeleton height="20px" />
                    </Td>
                  </Tr>
                ))
              : paginatedRecords.length === 0 ? (
                <Tr>
                  <Td colSpan={9} textAlign="center" py={6}>
                    No clearance actions found.
                  </Td>
                </Tr>
              ) : (
                paginatedRecords.map((rec) => (
                  <Tr key={rec.id}>
                    <Td px={2}>
                      <Checkbox
                        isChecked={selectedIds.includes(rec.id)}
                        onChange={() => toggleSelectOne(rec.id)}
                        aria-label={`Select clearance action ${rec.id}`}
                      />
                    </Td>
                    <Td>{rec.id}</Td>
                    <Td>{rec.dateTime}</Td>
                    <Td>{rec.actionType}</Td>
                    <Td>{rec.status}</Td>
                    <Td>{rec.officer}</Td>
                    <Td>
                      <Box
                        maxH="80px"
                        overflowY="auto"
                        p={2}
                        borderRadius="md"
                        bg={bgRemarks}
                        whiteSpace="pre-wrap"
                        fontSize="sm"
                      >
                        {rec.remarks}
                      </Box>
                    </Td>
                    <Td>{rec.cargoId}</Td>
                    <Td>
                      <Tooltip label="View Details" aria-label={`View details for clearance action ${rec.id}`}>
                        <IconButton
                          icon={<FaEye />}
                          size="sm"
                          aria-label={`View details of clearance action ${rec.id}`}
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

      {/* Modal for viewing details and actions */}
      <Modal isOpen={isOpen} onClose={onClose} size="lg" isCentered motionPreset="slideInBottom">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Clearance Action Details</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {selectedRecord ? (
              <>
                <Text fontWeight="bold" mb={2}>
                  ID: {selectedRecord.id}
                </Text>
                <Text mb={2}>Date/Time: {selectedRecord.dateTime}</Text>
                <Text mb={2}>Action Type: {selectedRecord.actionType}</Text>
                <Text mb={2}>Status: {selectedRecord.status}</Text>
                <Text mb={2}>Officer: {selectedRecord.officer}</Text>
                <Text mb={2}>Cargo ID: {selectedRecord.cargoId}</Text>
                <Box
                  maxH="150px"
                  overflowY="auto"
                  p={3}
                  borderRadius="md"
                  bg={bgRemarks}
                  whiteSpace="pre-wrap"
                  mb={4}
                  fontSize="sm"
                >
                  {selectedRecord.remarks}
                </Box>
              </>
            ) : (
              <Text>No clearance action selected.</Text>
            )}
          </ModalBody>

          <ModalFooter justifyContent="space-between" flexWrap="wrap" gap={3}>
            <Button
              colorScheme="green"
              leftIcon={<FaCheck />}
              onClick={() => handleAction('Approve')}
              isDisabled={!selectedRecord || selectedRecord.status === 'Completed'}
              aria-label="Approve clearance action"
            >
              Approve
            </Button>
            <Button
              colorScheme="red"
              leftIcon={<FaTimes />}
              onClick={() => handleAction('Reject')}
              isDisabled={!selectedRecord || selectedRecord.status === 'Rejected'}
              aria-label="Reject clearance action"
            >
              Reject
            </Button>
            <Button
              colorScheme="yellow"
              leftIcon={<FaPause />}
              onClick={() => handleAction('Hold')}
              isDisabled={!selectedRecord || selectedRecord.status === 'On Hold'}
              aria-label="Hold clearance action"
            >
              Hold
            </Button>
            <Button onClick={onClose} aria-label="Close clearance action details">
              Close
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
}
