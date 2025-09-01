
import React, { useState } from 'react';
import {
  Box, Heading, Input, Button, SimpleGrid, Table, Thead, Tbody, Tr, Th, Td,
  Text, Flex, Spinner, useToast, IconButton, HStack, Modal, ModalOverlay,
  ModalContent, ModalHeader, ModalCloseButton, ModalBody, ModalFooter,
  useDisclosure, Center
} from '@chakra-ui/react';
import {
  RepeatIcon, SearchIcon, DownloadIcon, ViewIcon, TriangleDownIcon, TriangleUpIcon
} from '@chakra-ui/icons';
import { format } from 'date-fns';
import { CSVLink } from 'react-csv';
import { supabase } from '../supabaseClient';

const OutgateSearchTickets = () => {
  const [searchParams, setSearchParams] = useState({
    gnsw_truck_no: '',
    container_no: '',
    sad_no: '',
    dateFrom: '',
    dateTo: ''
  });

  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortConfig, setSortConfig] = useState({ key: 'date', direction: 'desc' }); // default sort by date desc
  const [selectedTicket, setSelectedTicket] = useState(null);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const toast = useToast();

  const itemsPerPage = 5;

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setSearchParams((prev) => ({ ...prev, [name]: value }));
  };

  const handleSearch = async () => {
    setLoading(true);

    try {
      let query = supabase.from('tickets').select('*');

      if (searchParams.gnsw_truck_no) {
        query = query.ilike('gnsw_truck_no', `%${searchParams.gnsw_truck_no}%`);
      }
      if (searchParams.container_no) {
        query = query.ilike('container_no', `%${searchParams.container_no}%`);
      }
      if (searchParams.sad_no) {
        query = query.ilike('sad_no', `%${searchParams.sad_no}%`);
      }
      if (searchParams.dateFrom) {
        query = query.gte('date', searchParams.dateFrom);
      }
      if (searchParams.dateTo) {
        query = query.lte('date', searchParams.dateTo);
      }

      // Optional: filter only allowed statuses (Pending, Exited, Flagged)
      query = query.in('status', ['Pending', 'Exited', 'Flagged']);

      // Order by date descending by default
      query = query.order('date', { ascending: false });

      const { data, error } = await query;

      if (error) throw error;

      if (!data || data.length === 0) {
        toast({
          title: 'No tickets found.',
          status: 'info',
          duration: 3000,
          isClosable: true
        });
      }

      setResults(data || []);
      setCurrentPage(1);
    } catch (error) {
      console.error('Search error:', error);
      toast({
        title: 'Error fetching tickets.',
        description: error.message,
        status: 'error',
        duration: 4000,
        isClosable: true
      });
      setResults([]);
    }

    setLoading(false);
  };

  const handleReset = () => {
    setSearchParams({
      gnsw_truck_no: '',
      container_no: '',
      sad_no: '',
      dateFrom: '',
      dateTo: ''
    });
    setResults([]);
    setCurrentPage(1);
  };

  // **Add this handleSort function here**
  const handleSort = (key) => {
    setSortConfig((prev) => {
      const isSameKey = prev.key === key;
      const newDirection = isSameKey && prev.direction === 'asc' ? 'desc' : 'asc';
      return { key, direction: newDirection };
    });
  };

  // Enhanced sort with type awareness
  const sortedResults = [...results].sort((a, b) => {
    if (!sortConfig.key) return 0;

    const valA = a[sortConfig.key];
    const valB = b[sortConfig.key];

    // Handle null or undefined gracefully
    if (valA == null && valB == null) return 0;
    if (valA == null) return sortConfig.direction === 'asc' ? -1 : 1;
    if (valB == null) return sortConfig.direction === 'asc' ? 1 : -1;

    // Date fields
    if (sortConfig.key === 'date' || valA instanceof Date || valB instanceof Date) {
      const timeA = new Date(valA).getTime();
      const timeB = new Date(valB).getTime();
      if (timeA < timeB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (timeA > timeB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    }

    // Numeric fields (id, gross, net, etc)
    if (typeof valA === 'number' && typeof valB === 'number') {
      return sortConfig.direction === 'asc' ? valA - valB : valB - valA;
    }

    // String comparison
    const strA = String(valA).toLowerCase();
    const strB = String(valB).toLowerCase();

    if (strA < strB) return sortConfig.direction === 'asc' ? -1 : 1;
    if (strA > strB) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  const paginatedResults = sortedResults.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalPages = Math.ceil(results.length / itemsPerPage);

  const handleViewTicket = (ticket) => {
    setSelectedTicket(ticket);
    onOpen();
  };

  return (
    <Box p={4}>
      <Heading size="lg" mb={6}>Search & Filter Tickets</Heading>

      <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4} mb={4}>
        <Input
          placeholder="Truck Number"
          name="gnsw_truck_no"
          value={searchParams.gnsw_truck_no}
          onChange={handleInputChange}
          bg="white"
        />
        <Input
          placeholder="Container Number"
          name="container_no"
          value={searchParams.container_no}
          onChange={handleInputChange}
          bg="white"
        />
        <Input
          placeholder="SAD Number"
          name="sad_no"
          value={searchParams.sad_no}
          onChange={handleInputChange}
          bg="white"
        />
      </SimpleGrid>

      <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4} mb={4}>
        <Input
          type="date"
          name="dateFrom"
          value={searchParams.dateFrom}
          onChange={handleInputChange}
          bg="white"
        />
        <Input
          type="date"
          name="dateTo"
          value={searchParams.dateTo}
          onChange={handleInputChange}
          bg="white"
        />
      </SimpleGrid>

      <Flex gap={3} mb={6} flexWrap="wrap">
        <Button leftIcon={<SearchIcon />} colorScheme="blue" onClick={handleSearch}>
          Search
        </Button>
        <Button leftIcon={<RepeatIcon />} onClick={handleReset}>
          Reset
        </Button>
        {results.length > 0 && (
          <Button
            leftIcon={<DownloadIcon />}
            variant="solid"
            colorScheme="teal"
            as={CSVLink}
            filename="search_results.csv"
            data={sortedResults}
          >
            Export CSV
          </Button>
        )}
      </Flex>

      {loading ? (
        <Center py={10}><Spinner size="xl" /></Center>
      ) : (
        <>
          <Box bg="white" borderRadius="md" boxShadow="sm" overflowX="auto">
            <Table size="sm">
              <Thead bg="gray.100">
                <Tr>
                  <Th
                    cursor="pointer"
                    onClick={() => handleSort('id')}
                  >
                    Ticket ID {sortConfig.key === 'id' &&
                      (sortConfig.direction === 'asc' ? <TriangleUpIcon fontSize="xs" /> : <TriangleDownIcon fontSize="xs" />)}
                  </Th>
                  <Th
                    cursor="pointer"
                    onClick={() => handleSort('gnsw_truck_no')}
                  >
                    Truck No {sortConfig.key === 'gnsw_truck_no' &&
                      (sortConfig.direction === 'asc' ? <TriangleUpIcon fontSize="xs" /> : <TriangleDownIcon fontSize="xs" />)}
                  </Th>
                  <Th>Container No</Th>
                  <Th>SAD No</Th>
                  <Th
                    cursor="pointer"
                    onClick={() => handleSort('date')}
                  >
                    Date {sortConfig.key === 'date' &&
                      (sortConfig.direction === 'asc' ? <TriangleUpIcon fontSize="xs" /> : <TriangleDownIcon fontSize="xs" />)}
                  </Th>
                  <Th textAlign="center">Actions</Th>
                </Tr>
              </Thead>
              <Tbody>
                {paginatedResults.length > 0 ? (
                  paginatedResults.map((ticket) => (
                    <Tr key={ticket.id}>
                      <Td>{ticket.id}</Td>
                      <Td>{ticket.gnsw_truck_no}</Td>
                      <Td>{ticket.container_no}</Td>
                      <Td>{ticket.sad_no}</Td>
                      <Td>{format(new Date(ticket.date), 'yyyy-MM-dd')}</Td>
                      <Td textAlign="center">
                        <IconButton
                          size="sm"
                          icon={<ViewIcon />}
                          aria-label="View"
                          onClick={() => handleViewTicket(ticket)}
                        />
                      </Td>
                    </Tr>
                  ))
                ) : (
                  <Tr>
                    <Td colSpan={6}>
                      <Text textAlign="center" py={4} color="gray.500">
                        No tickets to display.
                      </Text>
                    </Td>
                  </Tr>
                )}
              </Tbody>
            </Table>
          </Box>

          {results.length > 0 && (
            <Flex justify="space-between" align="center" mt={4} flexWrap="wrap" gap={2}>
              <Text fontSize="sm">Page {currentPage} of {totalPages}</Text>
              <HStack spacing={2}>
                <Button
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                  isDisabled={currentPage === 1}
                >
                  Prev
                </Button>
                <Button
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                  isDisabled={currentPage === totalPages}
                >
                  Next
                </Button>
              </HStack>
            </Flex>
          )}
        </>
      )}

      {/* Modal for Ticket Details */}
      <Modal isOpen={isOpen} onClose={onClose} size="md" isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Ticket Details</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {selectedTicket ? (
              <Box
                bg="gray.50"
                borderRadius="md"
                p={4}
                boxShadow="sm"
                w="100%"
              >
                <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                  {Object.entries(selectedTicket).map(([key, value]) => (
                    <Box key={key} p={3} bg="white" borderRadius="md" boxShadow="xs">
                      <Text fontSize="sm" color="gray.500" mb={1} fontWeight="medium" textTransform="capitalize">
                        {key.replace(/_/g, ' ')}
                      </Text>
                      <Text fontSize="md" color="gray.800" wordBreak="break-word">
                        {value instanceof Date
                          ? format(new Date(value), 'yyyy-MM-dd')
                          : value === null || value === undefined
                          ? '-'
                          : String(value)}
                      </Text>
                    </Box>
                  ))}
                </SimpleGrid>
              </Box>
            ) : (
              <Text>No ticket selected.</Text>
            )}
          </ModalBody>
          <ModalFooter>
            <Button onClick={onClose} colorScheme="blue">Close</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
};

export default OutgateSearchTickets;