import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Box,
  Button,
  FormControl,
  FormLabel,
  Input,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  useDisclosure,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Heading,
  Text,
  SimpleGrid,
  useToast,
  FormErrorMessage,
  IconButton,
  Select,
  Flex,
} from '@chakra-ui/react';
import { ViewIcon, ExternalLinkIcon } from '@chakra-ui/icons';
import { supabase } from '../supabaseClient';

/* -----------------------
   Helpers: formatting + parsing
   ----------------------- */
function unformatNumberString(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[,\s]+/g, '').trim();
}
function numericValue(v) {
  if (v === null || v === undefined || v === '') return null;
  const cleaned = unformatNumberString(String(v)).replace(/kg/i, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
function formatNumber(v) {
  const n = numericValue(v);
  if (n === null) return '';
  if (Number.isInteger(n)) return n.toLocaleString('en-US');
  return Number(n.toFixed(2)).toLocaleString('en-US');
}

/* Compute missing weights given gross/tare/net
   Standard weighbridge rules (Net = Gross - Tare)
*/
function computeWeights(rowData) {
  const g0 = numericValue(rowData.gross);
  const t0 = numericValue(rowData.tare);
  const n0 = numericValue(rowData.net);

  let G = Number.isFinite(g0) ? g0 : null;
  let T = Number.isFinite(t0) ? t0 : null;
  let N = Number.isFinite(n0) ? n0 : null;

  // If gross missing but tare and net present -> gross = net + tare
  if ((G === null || G === undefined) && T !== null && N !== null) {
    G = N + T;
  }

  // If net missing but gross and tare present -> net = gross - tare
  if ((N === null || N === undefined) && G !== null && T !== null) {
    N = G - T;
  }

  // If tare missing but gross and net present -> tare = gross - net
  if ((T === null || T === undefined) && G !== null && N !== null) {
    T = G - N;
  }

  return {
    grossValue: G !== null && G !== undefined ? G : null,
    tareValue: T !== null && T !== undefined ? T : null,
    netValue: N !== null && N !== undefined ? N : null,
    grossDisplay: G !== null && G !== undefined ? formatNumber(G) : '',
    tareDisplay: T !== null && T !== undefined ? formatNumber(T) : '',
    netDisplay: N !== null && N !== undefined ? formatNumber(N) : '',
  };
}

/* Ticket ID generator (client fallback) */
function generateTicketId(existingIds) {
  let lastNumber = 0;
  existingIds.forEach((id) => {
    if (!id) return;
    const cleaned = String(id).replace(/^.*?(\d+)$/, '$1');
    const numPart = parseInt(cleaned, 10);
    if (!isNaN(numPart) && numPart > lastNumber) lastNumber = numPart;
  });
  return `M-${(lastNumber + 1).toString().padStart(4, '0')}`;
}

/* NumericInput: shows formatted value but reports unformatted (digits+dot) to parent.
   Implements caret preservation by counting numeric characters left of caret.
*/
function NumericInput({ name, rawValue, onRawChange, placeholder, isReadOnly = false, isDisabled = false }) {
  const ref = useRef(null);
  const desiredDigitsRef = useRef(null);

  const displayValue = formatNumber(rawValue);

  const handleChange = (e) => {
    if (isReadOnly || isDisabled) return;
    const inputVal = e.target.value;
    const selectionStart = e.target.selectionStart ?? inputVal.length;
    const left = inputVal.slice(0, selectionStart);
    const digitsLeft = (left.match(/[0-9]/g) || []).length;
    desiredDigitsRef.current = digitsLeft;
    const unformatted = inputVal.replace(/[^\d.-]/g, '');
    onRawChange(unformatted);
  };

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const desiredDigits = desiredDigitsRef.current;
    if (desiredDigits === null || desiredDigits === undefined) return;

    let digitsSeen = 0;
    let targetIndex = displayValue.length;
    for (let i = 0; i < displayValue.length; i++) {
      if (/[0-9]/.test(displayValue[i])) digitsSeen++;
      if (digitsSeen >= desiredDigits) {
        targetIndex = i + 1;
        break;
      }
    }
    requestAnimationFrame(() => {
      try {
        el.setSelectionRange(targetIndex, targetIndex);
      } catch (e) {
        // ignore
      }
    });
    desiredDigitsRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayValue]);

  return (
    <Input
      name={name}
      ref={ref}
      value={displayValue}
      onChange={handleChange}
      placeholder={placeholder}
      autoComplete="off"
      isReadOnly={isReadOnly}
      isDisabled={isDisabled}
      bg={isReadOnly ? 'gray.50' : undefined}
      _hover={isReadOnly ? { cursor: 'default' } : undefined}
    />
  );
}

/* -----------------------
   Main Component
   ----------------------- */
export default function ManualEntry() {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const {
    isOpen: isViewOpen,
    onOpen: onViewOpen,
    onClose: onViewClose,
  } = useDisclosure();

  const toast = useToast();
  const firstInputRef = useRef(null);

  // raw numeric strings for numeric fields (gross/tare/net)
  const [formData, setFormData] = useState({
    truckOnWb: '',
    consignee: '',
    operation: '',
    driver: '',
    sadNo: '',
    containerNo: '',
    gross: '',
    tare: '',
    net: '',
  });

  const [errors, setErrors] = useState({});
  const [history, setHistory] = useState([]);
  const [viewTicket, setViewTicket] = useState(null);

  // pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);

  // operator info
  const [operatorName, setOperatorName] = useState('');
  const [operatorId, setOperatorId] = useState(null);

  // submission guard
  const [isSubmitting, setIsSubmitting] = useState(false);

  // required fields
  const requiredFields = ['truckOnWb', 'operation', 'gross', 'tare', 'net', 'sadNo'];

  /* Load history and operator on mount */
  useEffect(() => {
    async function load() {
      // load tickets history
      const { data, error } = await supabase
        .from('tickets')
        .select('*')
        .order('submitted_at', { ascending: false });

      if (error) {
        toast({ title: 'Error loading tickets', description: error.message, status: 'error', duration: 5000, isClosable: true });
      } else if (data) {
        const mapped = data.map((item) => ({
          ticketId: item.ticket_id,
          data: {
            ticketNo: item.ticket_no,
            truckOnWb: item.truck_on_wb || item.gnsw_truck_no || '',
            consignee: item.consignee || '',
            operation: item.operation || '',
            driver: item.driver || item.driver || '',
            sadNo: item.sad_no || '',
            containerNo: item.container_no || '',
            gross: item.gross !== null && item.gross !== undefined ? formatNumber(String(item.gross)) : '',
            tare: item.tare !== null && item.tare !== undefined ? formatNumber(String(item.tare)) : '',
            net: item.net !== null && item.net !== undefined ? formatNumber(String(item.net)) : '',
            manual: item.manual || '',
            operator: item.operator || '',
            status: item.status,
            fileUrl: item.file_url || null,
          },
          submittedAt: item.submitted_at || new Date().toISOString(),
        }));
        setHistory(mapped);
        setPage(1);
      }

      // get logged-in user info
      try {
        let currentUser = null;
        if (supabase.auth?.getUser) {
          const { data, error: userErr } = await supabase.auth.getUser();
          if (!userErr) currentUser = data?.user || null;
        } else if (supabase.auth?.user) {
          currentUser = supabase.auth.user();
        }

        if (currentUser) {
          // try fetch from users table
          const { data: userRow } = await supabase.from('users').select('full_name, username').eq('id', currentUser.id).maybeSingle();
          setOperatorName((userRow && (userRow.full_name || userRow.username)) || currentUser.email || '');
          setOperatorId(currentUser.id);
        }
      } catch (e) {
        console.warn('Could not determine operator', e);
      }
    }

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isOpen && firstInputRef.current) firstInputRef.current.focus();
    // clear errors when opening modal fresh
    if (isOpen) setErrors({});
  }, [isOpen]);

  /* handle change for non-numeric inputs - runs live validation */
  const validateAll = useCallback((nextForm = null) => {
    const fd = nextForm || formData;
    const newErrors = {};

    // Required field presence
    requiredFields.forEach((f) => {
      if (!fd[f] || String(fd[f]).trim() === '') {
        newErrors[f] = 'This field is required';
      }
    });

    // compute weights
    const computed = computeWeights({
      gross: fd.gross,
      tare: fd.tare,
      net: fd.net,
    });

    if (computed.grossValue === null) newErrors.gross = newErrors.gross || 'Invalid or missing gross';
    if (computed.tareValue === null) newErrors.tare = newErrors.tare || 'Invalid or missing tare';
    if (computed.netValue === null) newErrors.net = newErrors.net || 'Invalid or missing net';

    // NEW VALIDATION: gross must be strictly greater than tare
    if (computed.grossValue !== null && computed.tareValue !== null) {
      if (!(computed.grossValue > computed.tareValue)) {
        newErrors.gross = 'Gross must be greater than Tare';
        newErrors.tare = 'Tare must be less than Gross';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData, requiredFields]);

  const handleChange = (field, value) => {
    const next = { ...formData, [field]: value };
    setFormData(next);

    // live validate using the next state
    validateAll(next);
  };

  /* updateNumericField: called by NumericInput with raw numeric string (digits and dot) */
  const updateNumericField = (fieldName, rawString) => {
    setFormData((prev) => {
      const next = { ...prev, [fieldName]: rawString };

      // Live recalculation: when gross or tare are changed, if both numeric then autocalc net = gross - tare
      if (fieldName === 'gross' || fieldName === 'tare') {
        const g = numericValue(fieldName === 'gross' ? rawString : prev.gross);
        const t = numericValue(fieldName === 'tare' ? rawString : prev.tare);
        if (g !== null && t !== null) {
          const liveNet = g - t;
          next.net = String(Number.isFinite(liveNet) ? liveNet : '');
        } else {
          next.net = '';
        }
      }

      // validate using the computed next object (live)
      setTimeout(() => validateAll(next), 0); // schedule after state update
      return next;
    });
  };

  /* Submit form */
  const handleSubmit = async () => {
    if (isSubmitting) return; // guard against double clicks
    setIsSubmitting(true); // lock immediately

    const ok = validateAll();
    if (!ok) {
      toast({
        title: 'Validation error',
        description: 'Please correct highlighted fields.',
        status: 'error',
        duration: 3500,
        isClosable: true,
      });
      setIsSubmitting(false);
      return;
    }

    const newTicketId = generateTicketId(history.map((h) => h.ticketId));

    // compute final numeric values
    const computed = computeWeights({
      gross: formData.gross,
      tare: formData.tare,
      net: formData.net,
    });

    const insertData = {
      ticket_no: newTicketId,
      ticket_id: newTicketId,
      truck_on_wb: formData.truckOnWb || null,
      gnsw_truck_no: formData.truckOnWb || null, // mirror truckOnWb
      consignee: formData.consignee || null,
      operation: formData.operation || null,
      driver: formData.driver || null,
      sad_no: formData.sadNo || null,
      container_no: formData.containerNo || null,
      material: 'No Material',
      pass_number: null,
      date: new Date().toISOString(),
      scale_name: 'WBRIDGE1',
      weight: computed.grossValue !== null ? computed.grossValue : null, // weight = gross
      manual: 'Yes',
      operator: operatorName || null,
      operator_id: operatorId || null,
      gross: computed.grossValue !== null ? computed.grossValue : null,
      tare: computed.tareValue !== null ? computed.tareValue : null,
      net: computed.netValue !== null ? computed.netValue : null,
      status: 'Pending',
    };

    try {
      const { error } = await supabase.from('tickets').insert([insertData]);
      if (error) {
        toast({ title: 'Submit failed', description: error.message, status: 'error', duration: 5000, isClosable: true });
        setIsSubmitting(false);
        return;
      }

      // update local history with formatted displays
      const saved = {
        ticketId: newTicketId,
        data: {
          ticketNo: newTicketId,
          truckOnWb: formData.truckOnWb || '',
          consignee: formData.consignee || '',
          operation: formData.operation || '',
          driver: formData.driver || '',
          sadNo: formData.sadNo || '',
          containerNo: formData.containerNo || '',
          gross: computed.grossDisplay,
          tare: computed.tareDisplay,
          net: computed.netDisplay,
          manual: 'Yes',
          operator: operatorName || '',
          status: 'Pending',
          fileUrl: null,
        },
        submittedAt: new Date().toISOString(),
      };

      setHistory((prev) => [saved, ...prev]);
      toast({ title: 'Ticket saved', description: `Ticket ${newTicketId} created`, status: 'success', duration: 3000, isClosable: true });
      onClose();
    } catch (err) {
      console.error(err);
      toast({ title: 'Submit error', description: err?.message || 'Unexpected error', status: 'error', duration: 5000, isClosable: true });
    } finally {
      setIsSubmitting(false); // always unlock
    }
  };

  /* View ticket */
  const handleView = (ticket) => {
    setViewTicket(ticket);
    onViewOpen();
  };

  /* Filter & pagination for history */
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const filteredHistory = history.filter((r) => {
    const q = (searchQuery || '').toLowerCase();
    const matchesSearch =
      (r.data.ticketNo || '').toLowerCase().includes(q) ||
      (r.data.truckOnWb || '').toLowerCase().includes(q) ||
      (r.data.driver || '').toLowerCase().includes(q) ||
      (r.data.sadNo || '').toLowerCase().includes(q);
    const matchesStatus = statusFilter ? r.data.status === statusFilter : true;
    return matchesSearch && matchesStatus;
  });

  useEffect(() => setPage(1), [searchQuery, statusFilter, history, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredHistory.length / pageSize));
  const startIndex = (page - 1) * pageSize;
  const pagedHistory = filteredHistory.slice(startIndex, startIndex + pageSize);

  const pageNumbers = [];
  for (let i = 1; i <= totalPages; i++) pageNumbers.push(i);

  return (
    <Box p={6} maxW="1200px" mx="auto">
      <Heading mb={6}>Manual Ticket Entry</Heading>

      <Button onClick={onOpen} colorScheme="teal" mb={6}>
        New Manual Ticket
      </Button>

      <Modal
        isOpen={isOpen}
        onClose={isSubmitting ? () => {} : onClose}
        size="xl"
        scrollBehavior="inside"
        initialFocusRef={firstInputRef}
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Manual Ticket Submission</ModalHeader>
          <ModalCloseButton isDisabled={isSubmitting} />
          <ModalBody>
            <SimpleGrid columns={[1, 2]} spacing={4}>
              {/* Truck on WB (required) */}
              <FormControl isRequired isInvalid={!!errors.truckOnWb}>
                <FormLabel>
                  Truck on WB <Text as="span" color="red">*</Text>
                </FormLabel>
                <Input
                  ref={firstInputRef}
                  value={formData.truckOnWb}
                  onChange={(e) => handleChange('truckOnWb', e.target.value)}
                  placeholder="Enter Truck on WB"
                  isDisabled={isSubmitting}
                />
                <FormErrorMessage>{errors.truckOnWb}</FormErrorMessage>
              </FormControl>

              {/* SAD No (required) */}
              <FormControl isRequired isInvalid={!!errors.sadNo}>
                <FormLabel>
                  SAD No <Text as="span" color="red">*</Text>
                </FormLabel>
                <Input value={formData.sadNo} onChange={(e) => handleChange('sadNo', e.target.value)} placeholder="Enter SAD No" isDisabled={isSubmitting} />
                <FormErrorMessage>{errors.sadNo}</FormErrorMessage>
              </FormControl>

              {/* Operation (required dropdown) */}
              <FormControl isRequired isInvalid={!!errors.operation}>
                <FormLabel>
                  Operation <Text as="span" color="red">*</Text>
                </FormLabel>
                <Select placeholder="Select operation" value={formData.operation} onChange={(e) => handleChange('operation', e.target.value)} isDisabled={isSubmitting}>
                  <option value="Import">Import</option>
                  <option value="Export">Export</option>
                </Select>
                <FormErrorMessage>{errors.operation}</FormErrorMessage>
              </FormControl>

              {/* Container No (optional) */}
              <FormControl>
                <FormLabel>Container No</FormLabel>
                <Input value={formData.containerNo} onChange={(e) => handleChange('containerNo', e.target.value)} placeholder="Container No (optional)" isDisabled={isSubmitting} />
              </FormControl>

              {/* Consignee (optional) */}
              <FormControl>
                <FormLabel>Consignee</FormLabel>
                <Input value={formData.consignee} onChange={(e) => handleChange('consignee', e.target.value)} placeholder="Consignee (optional)" isDisabled={isSubmitting} />
              </FormControl>

              {/* Driver (optional) */}
              <FormControl>
                <FormLabel>Driver Name</FormLabel>
                <Input value={formData.driver} onChange={(e) => handleChange('driver', e.target.value)} placeholder="Driver name (optional)" isDisabled={isSubmitting} />
              </FormControl>

              {/* Numeric fields row: Gross (required) */}
              <FormControl isRequired isInvalid={!!errors.gross}>
                <FormLabel>
                  Gross <Text as="span" color="red">*</Text>
                </FormLabel>
                <NumericInput
                  name="gross"
                  rawValue={formData.gross}
                  onRawChange={(v) => updateNumericField('gross', v)}
                  placeholder="Enter gross (kg)"
                  isDisabled={isSubmitting}
                />
                <FormErrorMessage>{errors.gross}</FormErrorMessage>
              </FormControl>

              {/* Tare (required) */}
              <FormControl isRequired isInvalid={!!errors.tare}>
                <FormLabel>
                  Tare (PT) <Text as="span" color="red">*</Text>
                </FormLabel>
                <NumericInput
                  name="tare"
                  rawValue={formData.tare}
                  onRawChange={(v) => updateNumericField('tare', v)}
                  placeholder="Enter tare (kg)"
                  isDisabled={isSubmitting}
                />
                <FormErrorMessage>{errors.tare}</FormErrorMessage>
              </FormControl>

              {/* Net (required, read-only) */}
              <FormControl isRequired isInvalid={!!errors.net}>
                <FormLabel>
                  Net <Text as="span" color="red">*</Text>
                </FormLabel>
                <NumericInput
                  name="net"
                  rawValue={formData.net}
                  onRawChange={() => {}}
                  placeholder="Net (auto-calculated: Gross − Tare)"
                  isReadOnly={true}
                  isDisabled={isSubmitting}
                />
                <FormErrorMessage>{errors.net}</FormErrorMessage>
              </FormControl>
            </SimpleGrid>
          </ModalBody>

          <ModalFooter>
            <Button colorScheme="teal" mr={3} onClick={handleSubmit} isLoading={isSubmitting} isDisabled={isSubmitting}>
              Submit Ticket
            </Button>
            <Button variant="ghost" onClick={onClose} isDisabled={isSubmitting}>
              Cancel
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Search & filter */}
      <Box mb={4} display="flex" justifyContent="space-between" flexWrap="wrap" gap={4}>
        <Input placeholder="Search by SAD, Truck on WB, Ticket No..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} maxW="480px" />
        <FormControl maxW="200px">
          <FormLabel>Status Filter</FormLabel>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #CBD5E0' }}>
            <option value="">All</option>
            <option value="Pending">Pending</option>
            <option value="Exited">Exited</option>
          </select>
        </FormControl>
      </Box>

      {/* History table */}
      {filteredHistory.length === 0 ? (
        <Text>No tickets found.</Text>
      ) : (
        <>
          <Table variant="striped" colorScheme="teal" size="sm">
            <Thead>
              <Tr>
                <Th>Ticket No</Th>
                <Th>Truck On WB</Th>
                <Th>SAD No</Th>
                <Th>Gross (kg)</Th>
                <Th>Tare (kg)</Th>
                <Th>Net (kg)</Th>
                <Th>Action</Th>
              </Tr>
            </Thead>
            <Tbody>
              {pagedHistory.map(({ ticketId, data, submittedAt }) => {
                return (
                  <Tr key={ticketId}>
                    <Td>{data.ticketNo}</Td>
                    <Td>{data.truckOnWb}</Td>
                    <Td>{data.sadNo}</Td>
                    <Td>{data.gross}</Td>
                    <Td>{data.tare}</Td>
                    <Td>{data.net}</Td>
                    <Td>
                      {data.fileUrl && (
                        <IconButton icon={<ExternalLinkIcon />} aria-label="Open file" size="sm" colorScheme="blue" mr={2} onClick={() => window.open(data.fileUrl, '_blank', 'noopener')} />
                      )}
                      <IconButton icon={<ViewIcon />} aria-label="View" size="sm" colorScheme="teal" onClick={() => handleView({ ticketId, data, submittedAt })} />
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>

          {/* Pagination */}
          <Box mt={4} display="flex" alignItems="center" gap={3} flexWrap="wrap">
            <Button size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} isDisabled={page === 1}>Previous</Button>

            <Flex align="center" gap={2}>
              {pageNumbers.map((n) => (
                <Button key={n} size="sm" onClick={() => setPage(n)} colorScheme={n === page ? 'teal' : 'gray'} variant={n === page ? 'solid' : 'outline'}>
                  {n}
                </Button>
              ))}
            </Flex>

            <Button size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} isDisabled={page === totalPages}>Next</Button>

            <Box ml="auto" display="flex" alignItems="center" gap={2}>
              <Text>Rows per page:</Text>
              <Select size="sm" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} width="80px">
                <option value={5}>5</option>
                <option value={10}>10</option>
                <option value={20}>20</option>
              </Select>
            </Box>
          </Box>
        </>
      )}

      {/* View modal */}
      <Modal isOpen={isViewOpen} onClose={onViewClose} size="xl" scrollBehavior="inside">
        <ModalOverlay />
        <ModalContent maxW="90vw">
          <ModalHeader>View Ticket</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {viewTicket ? (
              <Box>
                <SimpleGrid columns={[1, 2]} spacing={4}>
                  {Object.entries(viewTicket.data).map(([key, value]) => {
                    if (key === 'fileUrl') return null;
                    return (
                      <Box key={key} p={3} borderWidth="1px" borderRadius="md" bg="gray.50">
                        <Text fontWeight="semibold" color="teal.600" mb={1} textTransform="capitalize">{key}</Text>
                        <Text>{value ?? 'N/A'}</Text>
                      </Box>
                    );
                  })}
                </SimpleGrid>

                {viewTicket.data && viewTicket.data.fileUrl && (
                  <Box mt={6}>
                    <Text fontWeight="bold" color="teal.600" mb={2}>Attached PDF:</Text>
                    <Box borderWidth="1px" borderRadius="md" overflow="hidden" height={{ base: '300px', md: '600px' }}>
                      <iframe src={viewTicket.data.fileUrl} width="100%" height="100%" title="Ticket PDF" style={{ border: 'none' }} />
                    </Box>
                    <Box mt={2}>
                      <Button size="sm" variant="outline" onClick={() => window.open(viewTicket.data.fileUrl, '_blank', 'noopener')}>Open in new tab</Button>
                    </Box>
                  </Box>
                )}

                <Box mt={6} p={3} borderTop="1px" borderColor="gray.200">
                  <Text fontWeight="bold" color="teal.600">Submitted At:</Text>
                  <Text>{new Date(viewTicket.submittedAt).toLocaleString()}</Text>
                </Box>
              </Box>
            ) : (
              <Text>No data</Text>
            )}
          </ModalBody>
          <ModalFooter>
            <Button onClick={onViewClose}>Close</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
}
