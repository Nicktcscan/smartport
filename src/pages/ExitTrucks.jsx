// src/pages/ExitTrucks.jsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Box,
  Heading,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Text,
  Input,
  Select,
  useToast,
  Badge,
  HStack,
  Spacer,
  IconButton,
  Button,
  Modal,
  ModalOverlay,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  useDisclosure,
  ModalFooter,
  Stack,
  Flex,
  Divider,
  Icon,
  usePrefersReducedMotion,
  ModalContent,
  SimpleGrid,
} from '@chakra-ui/react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DownloadIcon,
  ArrowForwardIcon,
  InfoOutlineIcon,
  AtSignIcon,
} from '@chakra-ui/icons';
import {
  FaTruck,
  FaWeightHanging,
  FaUserTie,
  FaBoxes,
  FaRoute,
  FaCalendarAlt,
  FaFileInvoice,
} from 'react-icons/fa';

import { supabase } from '../supabaseClient'; // Adjust import path as needed

const MotionModalContent = motion.create(ModalContent);

function exportToCSV(data, filename = 'exited-trucks.csv') {
  if (!data.length) return;

  const headers = Object.keys(data[0]).join(',');
  const rows = data
    .map((row) =>
      Object.values(row)
        .map((val) => `"${val?.toString().replace(/"/g, '""') ?? ''}"`)
        .join(',')
    )
    .join('\n');

  const csvContent = [headers, rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Helper: parse numeric-ish value, allow strings with commas
function numericValue(v) {
  if (v === null || v === undefined || v === '') return null;
  const cleaned = String(v).replace(/[,\s]+/g, '').replace(/kg/i, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Helper: formatted number with thousand separators
function formatNumber(v) {
  if (v === null || v === undefined || v === '') return '-';
  const n = numericValue(v);
  if (n === null) return '-';
  // show integer without decimals if integer, otherwise two decimals
  return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Compute weights ensuring gross/tare/net are all present when possible
function computeWeightsFromObj({ gross, tare, net }) {
  let G = numericValue(gross);
  let T = numericValue(tare);
  let N = numericValue(net);

  // compute missing
  if ((G === null || G === undefined) && T !== null && N !== null) {
    G = T + N;
  }
  if ((N === null || N === undefined) && G !== null && T !== null) {
    N = G - T;
  }
  if ((T === null || T === undefined) && G !== null && N !== null) {
    T = G - N;
  }

  return {
    grossValue: G !== null ? G : null,
    tareValue: T !== null ? T : null,
    netValue: N !== null ? N : null,
    grossDisplay: G !== null ? formatNumber(G) : '-',
    tareDisplay: T !== null ? formatNumber(T) : '-',
    netDisplay: N !== null ? formatNumber(N) : '-',
  };
}

const Section = ({ icon, label, children }) => (
  <Flex align="center" gap={2} mb={1}>
    <Icon as={icon} color="teal.500" />
    <Text fontWeight="bold">{label}:</Text>
    <Text flex="1" wordBreak="break-word">
      {children}
    </Text>
  </Flex>
);

export default function ExitTrucks() {
  const [exitedTrucks, setExitedTrucks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [selectedTicket, setSelectedTicket] = useState(null);
  const toast = useToast();
  const prefersReducedMotion = usePrefersReducedMotion();
  const modalRef = useRef();

  // Date/time filter state
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');

  // Fetch exited tickets from Supabase on mount
  useEffect(() => {
    async function fetchExitedTrucks() {
      setLoading(true);
      const { data, error } = await supabase
        .from('tickets')
        .select('*')
        .eq('status', 'Exited')
        .order('submitted_at', { ascending: false });

      if (error) {
        toast({
          title: 'Error loading exited trucks',
          description: error.message,
          status: 'error',
          duration: 5000,
          isClosable: true,
        });
      } else if (data) {
        // Map DB fields to expected format for UI
        const mappedData = data.map((item) => ({
          ticketId: item.ticket_id || (item.id ? item.id.toString() : `${Math.random()}`),
          data: {
            ticketNo: item.ticket_no,
            gnswTruckNo: item.gnsw_truck_no,
            sadNo: item.sad_no,
            exitTime: item.created_at,
            driver: item.driver || item.driver,
            gross: item.gross !== null && item.gross !== undefined ? item.gross : item.gross_weight ?? item.grossWeight ?? null,
            net: item.net !== null && item.net !== undefined ? item.net : item.net ?? item.netWeight ?? null,
            date: item.date,
            status: item.status?.toLowerCase(),
            containerNo: item.container_no,
            operator: item.operator,
            tare: item.tare !== null && item.tare !== undefined ? item.tare : item.tare ?? null,
            passNumber: item.pass_number,
            scaleName: item.scale_name,
            anpr: item.wb_id,
            consolidated: item.consolidated,
            consignee: item.consignee,
            axles: null,
            fileUrl: item.file_url || null,
          },
        }));
        setExitedTrucks(mappedData);
      }
      setLoading(false);
    }

    fetchExitedTrucks();
  }, [toast]);

  // Helpers for date/time filtering
  const parseTimeToMinutes = (timeStr) => {
    if (!timeStr) return null;
    const parts = timeStr.split(':');
    if (parts.length < 2) return null;
    const hh = parseInt(parts[0], 10);
    const mm = parseInt(parts[1], 10);
    if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
    return hh * 60 + mm;
  };

  const startOfDay = (d) => {
    const dt = new Date(d);
    dt.setHours(0, 0, 0, 0);
    return dt;
  };
  const endOfDay = (d) => {
    const dt = new Date(d);
    dt.setHours(23, 59, 59, 999);
    return dt;
  };

  // Combine text filter + date/time range filter
  const filteredExitedTrucks = useMemo(() => {
    const lowerFilter = (filterText || '').toLowerCase().trim();
    const tfMinutes = parseTimeToMinutes(timeFrom);
    const ttMinutes = parseTimeToMinutes(timeTo);

    const hasDateRange = !!(dateFrom || dateTo);
    const hasTimeOnly = !hasDateRange && (timeFrom || timeTo);

    const startDate = dateFrom ? new Date(dateFrom) : null;
    const endDate = dateTo ? new Date(dateTo) : null;

    return exitedTrucks.filter(({ data }) => {
      // text filter
      if (lowerFilter) {
        const textMatch =
          (data.gnswTruckNo || '').toString().toLowerCase().includes(lowerFilter) ||
          (data.driver || '').toString().toLowerCase().includes(lowerFilter) ||
          (data.sadNo || '').toString().toLowerCase().includes(lowerFilter) ||
          (data.ticketNo || '').toString().toLowerCase().includes(lowerFilter);
        if (!textMatch) return false;
      }

      // date/time range filter
      const raw = data.date || data.exitTime;
      if (!raw) {
        // If ticket has no date, exclude when any date/time filter is applied
        if (hasDateRange || hasTimeOnly) return false;
        return true;
      }
      const ticketDate = new Date(raw);
      if (isNaN(ticketDate.getTime())) return false;

      if (hasDateRange) {
        let start = startDate ? startOfDay(startDate) : new Date(-8640000000000000);
        let end = endDate ? endOfDay(endDate) : new Date(8640000000000000);

        // If times also supplied, narrow the start/end times on the day(s)
        if (timeFrom) {
          const tf = parseTimeToMinutes(timeFrom);
          if (tf !== null) start.setHours(Math.floor(tf / 60), tf % 60, 0, 0);
        }
        if (timeTo) {
          const tt = parseTimeToMinutes(timeTo);
          if (tt !== null) end.setHours(Math.floor(tt / 60), tt % 60, 59, 999);
        }

        return ticketDate >= start && ticketDate <= end;
      }

      if (hasTimeOnly) {
        const ticketMins = ticketDate.getHours() * 60 + ticketDate.getMinutes();
        const fromM = tfMinutes !== null ? tfMinutes : 0;
        const toM = ttMinutes !== null ? ttMinutes : 24 * 60 - 1;
        return ticketMins >= fromM && ticketMins <= toM;
      }

      return true;
    });
  }, [exitedTrucks, filterText, dateFrom, dateTo, timeFrom, timeTo]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredExitedTrucks.length / pageSize));
  const pagedExitedTrucks = filteredExitedTrucks.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const handlePageChange = (newPage) => {
    if (newPage < 1 || newPage > totalPages) return;
    setCurrentPage(newPage);
  };

  // Prepare CSV data for export: use computed weights and include ticketNo correctly
  const csvData = pagedExitedTrucks.map(({ ticketId, data }) => {
    const computed = computeWeightsFromObj({ gross: data.gross, tare: data.tare, net: data.net });
    return {
      'Ticket ID': ticketId,
      'Ticket No': data.ticketNo || '',
      'Truck No': data.gnswTruckNo || '',
      'SAD No': data.sadNo ?? '',
      'Driver': data.driver || '',
      'Gross Weight (kg)': computed.grossValue !== null ? computed.grossValue : '',
      'Tare Weight (kg)': computed.tareValue !== null ? computed.tareValue : '',
      'Net Weight (kg)': computed.netValue !== null ? computed.netValue : '',
      'Entry Date & Time': data.date ? new Date(data.date).toLocaleString() : '',
      'Exit Date & Time': data.exitTime ? new Date(data.exitTime).toLocaleString() : '',
      Status: data.status || '',
    };
  });

  const openModalWithTicket = (ticket) => {
    setSelectedTicket(ticket);
    onOpen();
  };

  const resetRange = () => {
    setDateFrom('');
    setDateTo('');
    setTimeFrom('');
    setTimeTo('');
  };

  return (
    <Box p={6} maxW="1100px" mx="auto">
      <Heading mb={6}>Exited Trucks</Heading>

      <HStack mb={4} spacing={4}>
        <Text fontSize="xl" fontWeight="semibold">
          Exited Trucks
        </Text>
        <Input
          placeholder="Filter by Ticket No, Truck No, Driver, or SAD No"
          size="sm"
          maxW="400px"
          value={filterText}
          onChange={(e) => {
            setFilterText(e.target.value);
            setCurrentPage(1);
          }}
        />
        <Spacer />
        <Select
          size="sm"
          maxW="100px"
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setCurrentPage(1);
          }}
        >
          {[5, 10, 20, 50].map((size) => (
            <option key={size} value={size}>
              {size} / page
            </option>
          ))}
        </Select>
        <IconButton
          aria-label="Export CSV"
          icon={<DownloadIcon />}
          size="sm"
          colorScheme="teal"
          onClick={() => exportToCSV(csvData)}
          isDisabled={pagedExitedTrucks.length === 0}
          isLoading={loading}
        />
      </HStack>

      {/* Date & Time Range Controls */}
      <Box mb={4} border="1px solid" borderColor="gray.100" p={3} borderRadius="md">
        <Text fontWeight="semibold" mb={2}>
          Filter by Date & Time Range
        </Text>
        <SimpleGrid columns={[1, 4]} spacing={3} alignItems="end">
          <Box>
            <Text fontSize="sm" mb={1}>
              Date From
            </Text>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </Box>
          <Box>
            <Text fontSize="sm" mb={1}>
              Date To
            </Text>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </Box>
          <Box>
            <Text fontSize="sm" mb={1}>
              Time From
            </Text>
            <Input type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} />
          </Box>
          <Box>
            <Text fontSize="sm" mb={1}>
              Time To
            </Text>
            <Input type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} />
          </Box>
        </SimpleGrid>
        <Flex mt={3} gap={2}>
          <Button size="sm" colorScheme="blue" onClick={() => { setCurrentPage(1); }}>
            Apply Filters
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { resetRange(); setCurrentPage(1); }}>
            Reset Filters
          </Button>
          <Text ml={4} fontSize="sm" color="gray.600" alignSelf="center">
            Tip: Date narrows by day; adding Time refines the window.
          </Text>
        </Flex>
      </Box>

      {loading ? (
        <Text>Loading exited trucks...</Text>
      ) : pagedExitedTrucks.length > 0 ? (
        <>
          <Table variant="simple" colorScheme="teal" size="md" mb={4}>
            <Thead>
              <Tr>
                <Th>Ticket No</Th>
                <Th>Truck No</Th>
                <Th>SAD No</Th>
                <Th>Gross(kg)</Th>
                <Th>Tare(kg)</Th>
                <Th>Net(kg)</Th>
                <Th>Status</Th>
                <Th>View More</Th>
              </Tr>
            </Thead>
            <Tbody>
              {pagedExitedTrucks.map(({ ticketId, data }) => {
                const computed = computeWeightsFromObj({ gross: data.gross, tare: data.tare, net: data.net });
                return (
                  <Tr key={ticketId}>
                    <Td>{data.ticketNo || ticketId}</Td>
                    <Td>{data.gnswTruckNo}</Td>
                    <Td>{data.sadNo ?? '-'}</Td>
                    <Td>{computed.grossDisplay} kg</Td>
                    <Td>{computed.tareDisplay} kg</Td>
                    <Td>{computed.netDisplay} kg</Td>
                    <Td>
                      <Badge colorScheme="teal" variant="subtle" fontSize="0.9em">
                        Exited
                      </Badge>
                    </Td>
                    <Td>
                      <Button
                        size="sm"
                        colorScheme="teal"
                        variant="outline"
                        leftIcon={<ArrowForwardIcon />}
                        onClick={() => openModalWithTicket({ ticketId, data })}
                      >
                        View More
                      </Button>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>

          {/* Pagination controls */}
          <HStack mt={2} justify="center" spacing={4}>
            <Button
              size="sm"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
            >
              ‹
            </Button>
            <Text fontSize="sm" color="gray.600">
              Page {currentPage} of {totalPages}
            </Text>
            <Button
              size="sm"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
            >
              ›
            </Button>
          </HStack>
        </>
      ) : (
        <Text fontStyle="italic" color="gray.600" mt={4}>
          No trucks have exited yet.
        </Text>
      )}

      {/* Modal */}
      <Modal isOpen={isOpen} onClose={onClose} size="lg" scrollBehavior="inside" isCentered>
        <ModalOverlay />
        <AnimatePresence>
          {isOpen && selectedTicket && (
            <MotionModalContent
              ref={modalRef}
              borderRadius="lg"
              p={4}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 30 }}
              transition={{ duration: 0.25 }}
              aria-label="Ticket details modal"
            >
              <ModalHeader>
                <Flex align="center" gap={2}>
                  <Icon as={FaFileInvoice} color="teal.500" />
                  <Text>Ticket Details</Text>
                </Flex>
                <Text fontSize="sm" fontWeight="normal" color="gray.500" mt={1}>
                  {selectedTicket.ticketId} •{' '}
                  {selectedTicket.data.date ? new Date(selectedTicket.data.date).toLocaleString() : ''}
                </Text>
              </ModalHeader>
              <ModalCloseButton />
              <ModalBody>
                {selectedTicket && (
                  <Stack spacing={6} fontSize="sm">
                    {/* General Info */}
                    <Box>
                      <Flex align="center" mb={2}>
                        <Icon as={InfoOutlineIcon} color="teal.500" mr={2} />
                        <Text fontWeight="bold" fontSize="md">
                          General Information
                        </Text>
                      </Flex>
                      <Divider />
                      <Section icon={FaTruck} label="Truck No">
                        {selectedTicket.data.gnswTruckNo}
                      </Section>
                      <Section icon={FaBoxes} label="SAD No">
                        {selectedTicket.data.sadNo || '-'}
                      </Section>
                      <Section icon={FaUserTie} label="Driver">
                        {selectedTicket.data.driver}
                      </Section>
                      <Section icon={FaCalendarAlt} label="Entry Date">
                        {selectedTicket.data.date ? new Date(selectedTicket.data.date).toLocaleString() : '-'}
                      </Section>
                      <Section icon={FaFileInvoice} label="Pass Number">
                        {selectedTicket.data.passNumber || '-'}
                      </Section>
                      <Section icon={FaFileInvoice} label="Ticket No">
                        {selectedTicket.data.ticketNo || selectedTicket.ticketId}
                      </Section>
                    </Box>

                    {/* Weights */}
                    <Box>
                      <Flex align="center" mb={2}>
                        <Icon as={FaWeightHanging} color="teal.500" mr={2} />
                        <Text fontWeight="bold" fontSize="md">
                          Weight Details
                        </Text>
                      </Flex>
                      <Divider />
                      {(() => {
                        const computed = computeWeightsFromObj({
                          gross: selectedTicket.data.gross,
                          tare: selectedTicket.data.tare,
                          net: selectedTicket.data.net,
                        });
                        return (
                          <>
                            <Section icon={FaWeightHanging} label="Gross Weight">
                              {computed.grossDisplay} kg
                            </Section>
                            <Section icon={FaWeightHanging} label="Tare Weight">
                              {computed.tareDisplay} kg
                            </Section>
                            <Section icon={FaWeightHanging} label="Net Weight">
                              {computed.netDisplay} kg
                            </Section>
                          </>
                        );
                      })()}
                    </Box>

                    {/* Additional Info */}
                    <Box>
                      <Flex align="center" mb={2}>
                        <Icon as={FaRoute} color="teal.500" mr={2} />
                        <Text fontWeight="bold" fontSize="md">
                          Additional Info
                        </Text>
                      </Flex>
                      <Divider />
                      <Section icon={AtSignIcon} label="Operator">
                        {selectedTicket.data.operator || '-'}
                      </Section>
                      <Section icon={FaRoute} label="Scale Name">
                        {selectedTicket.data.scaleName || '-'}
                      </Section>
                      <Section icon={FaUserTie} label="Consignee">
                        {selectedTicket.data.consignee || '-'}
                      </Section>
                      <Section icon={FaCalendarAlt} label="Exit Time">
                        {selectedTicket.data.exitTime
                          ? new Date(selectedTicket.data.exitTime).toLocaleString()
                          : '-'}
                      </Section>
                      <Section icon={FaRoute} label="Container No">
                        {selectedTicket.data.containerNo || '-'}
                      </Section>
                    </Box>
                  </Stack>
                )}
              </ModalBody>
              <ModalFooter>
                <Button colorScheme="teal" mr={3} onClick={onClose}>
                  Close
                </Button>
              </ModalFooter>
            </MotionModalContent>
          )}
        </AnimatePresence>
      </Modal>
    </Box>
  );
}
