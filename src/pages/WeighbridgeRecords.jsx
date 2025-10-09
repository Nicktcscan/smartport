import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Input,
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
  Stack,
  Divider,
} from '@chakra-ui/react';
import { supabase } from '../supabaseClient';

const ITEMS_PER_PAGE = 5;

const WeighbridgeRecords = () => {
  const [records, setRecords] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState('date');
  const [sortDirection, setSortDirection] = useState('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const {
    isOpen: isDetailsOpen,
    onOpen: onDetailsOpen,
    onClose: onDetailsClose,
  } = useDisclosure();

  const [selectedRecord, setSelectedRecord] = useState(null);
  const [totalRecords, setTotalRecords] = useState(0);

  // Fetch total count for pagination
  const fetchTotalCount = async () => {
    try {
      let query = supabase.from('tickets').select('id', { count: 'exact', head: true });

      if (searchTerm.trim() !== '') {
        const term = `%${searchTerm.toLowerCase()}%`;
        query = supabase
          .from('tickets')
          .select('id', { count: 'exact', head: true })
          .or(
            `gnsw_truck_no.ilike.${term},driver.ilike.${term},consignee.ilike.${term}`
          );
      }

      const { count, error } = await query;
      if (error) throw error;
      setTotalRecords(count || 0);
    } catch (error) {
      toast({
        title: 'Error fetching total count',
        description: error.message,
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    }
  };

  // Fetch paginated records with search & sort
  const fetchRecords = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('tickets')
        .select('*')
        .order(sortField, { ascending: sortDirection === 'asc' })
        .range((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE - 1);

      if (searchTerm.trim() !== '') {
        const term = `%${searchTerm.toLowerCase()}%`;
        query = supabase
          .from('tickets')
          .select('*')
          .or(
            `gnsw_truck_no.ilike.${term},driver.ilike.${term},consignee.ilike.${term}`
          )
          .order(sortField, { ascending: sortDirection === 'asc' })
          .range((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE - 1);
      }

      const { data, error } = await query;

      if (error) throw error;

      setRecords(
        data.map((rec) => ({
          id: rec.id,
          vehicleNumber: rec.gnsw_truck_no,
          weighbridgeDateTime: rec.date,
          driverName: rec.driver,
          location: rec.scale_name,
          remarks: rec.manual || '',
          grossWeight: rec.gross,
          tareWeight: rec.tare,
          netWeight: rec.net,
          // Keep full record for details modal:
          fullRecord: rec,
        }))
      );
    } catch (error) {
      toast({
        title: 'Error loading records',
        description: error.message,
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setLoading(false);
    }
  };

  // Fetch count & records on load, and whenever dependencies change
  useEffect(() => {
    fetchTotalCount();
    fetchRecords();
  }, [currentPage, sortField, sortDirection, searchTerm]);

  const totalPages = Math.ceil(totalRecords / ITEMS_PER_PAGE);

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const openDetails = (record) => {
    setSelectedRecord(record.fullRecord || record);
    onDetailsOpen();
  };

  return (
    <Box p={4}>
      <Stack spacing={4}>
        <Text fontSize="2xl" fontWeight="bold">
          Weighbridge Records
        </Text>

        <Input
          placeholder="Search by Truck Number, Driver, or Consignee"
          maxW="400px"
          value={searchTerm}
          onChange={(e) => {
            setCurrentPage(1); // reset page on new search
            setSearchTerm(e.target.value);
          }}
        />

        {loading ? (
          <Flex justifyContent="center" p={8}>
            <Spinner size="xl" />
          </Flex>
        ) : records.length === 0 ? (
          <Text>No records found.</Text>
        ) : (
          <>
            <Box overflowX="auto" borderRadius="md" border="1px solid" borderColor="gray.200">
              <Table variant="striped" colorScheme="gray" size="sm">
                <Thead>
                  <Tr>
                    <Th cursor="pointer" onClick={() => toggleSort('gnsw_truck_no')}>
                      Vehicle Number {sortField === 'gnsw_truck_no' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
                    </Th>
                    <Th cursor="pointer" onClick={() => toggleSort('date')}>
                      Date & Time {sortField === 'date' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
                    </Th>
                    <Th cursor="pointer" onClick={() => toggleSort('driver')}>
                      Driver Name {sortField === 'driver' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
                    </Th>
                    <Th cursor="pointer" onClick={() => toggleSort('scale_name')}>
                      Location {sortField === 'scale_name' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
                    </Th>
                    <Th>Actions</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {records.map((record) => (
                    <Tr
                      key={record.id}
                      _hover={{ bg: 'gray.100', cursor: 'pointer' }}
                      onClick={() => openDetails(record)}
                    >
                      <Td>{record.vehicleNumber}</Td>
                      <Td>{new Date(record.weighbridgeDateTime).toLocaleString()}</Td>
                      <Td>{record.driverName}</Td>
                      <Td>{record.location}</Td>
                      <Td>
                        <Button
                          size="sm"
                          colorScheme="blue"
                          onClick={(e) => {
                            e.stopPropagation();
                            openDetails(record);
                          }}
                        >
                          Details
                        </Button>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </Box>

            <Flex justifyContent="center" alignItems="center" gap={4} mt={4}>
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
                isDisabled={currentPage === totalPages || totalPages === 0}
              >
                Next
              </Button>
            </Flex>
          </>
        )}
      </Stack>

      {/* Details Modal */}
      <Modal isOpen={isDetailsOpen} onClose={onDetailsClose} size="md" scrollBehavior="inside">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Record Details</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {selectedRecord ? (
              <Stack spacing={3}>
                <Text><b>Vehicle Number:</b> {selectedRecord.gnsw_truck_no}</Text>
                <Text><b>Date & Time:</b> {new Date(selectedRecord.date).toLocaleString()}</Text>
                <Text><b>Driver Name:</b> {selectedRecord.driver}</Text>
                <Text><b>Consignee:</b> {selectedRecord.consignee}</Text>
                <Text><b>Operation:</b> {selectedRecord.operation}</Text>
                <Text><b>Location (Scale):</b> {selectedRecord.scale_name}</Text>
                <Text><b>Remarks (Manual):</b> {selectedRecord.manual || '-'}</Text>

                <Divider />

                <Text fontWeight="semibold">Weight Details (kg):</Text>
                <Text><b>Gross Weight:</b> {selectedRecord.gross ?? '-'}</Text>
                <Text><b>Tare Weight:</b> {selectedRecord.tare ?? '-'}</Text>
                <Text><b>Net Weight:</b> {selectedRecord.net ?? '-'}</Text>
              </Stack>
            ) : (
              <Text>No record selected.</Text>
            )}
          </ModalBody>
          <ModalFooter>
            <Button onClick={onDetailsClose}>Close</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
};

export default WeighbridgeRecords;
