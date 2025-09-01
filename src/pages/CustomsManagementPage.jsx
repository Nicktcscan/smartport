import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Heading,
  Text,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Badge,
  Button,
  useToast,
  HStack,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  VStack,
  Divider,
  Switch,
  FormControl,
  FormLabel,
  Textarea,
  useDisclosure,
  Spinner,
  SimpleGrid,
} from '@chakra-ui/react';

import SignatureCanvas from 'react-signature-canvas';

// Simple CSV export utility (same as before)
function exportToCsv(filename, rows) {
  if (!rows || !rows.length) return;
  const separator = ',';
  const keys = Object.keys(rows[0]);
  const csvContent =
    keys.join(separator) +
    '\n' +
    rows
      .map(row =>
        keys
          .map(k => {
            let cell = row[k] === null || row[k] === undefined ? '' : row[k];
            cell = cell.toString().replace(/"/g, '""');
            return `"${cell}"`;
          })
          .join(separator)
      )
      .join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  if (navigator.msSaveBlob) {
    navigator.msSaveBlob(blob, filename);
  } else {
    const link = document.createElement('a');
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }
}

export default function CustomsManagementPage() {
  const [entries, setEntries] = useState([]);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [isSaving, setIsSaving] = useState(false);
  const toast = useToast();

  const sigCanvasRef = useRef(null);

  // Mock fetching data including extra fields relevant to customs officers
  useEffect(() => {
    const mockData = [
      {
        id: 1,
        entryNumber: 'CUST-2025-001',
        importer: 'Acme Corp',
        status: 'Pending',
        dateSubmitted: '2025-07-31',
        declaredWeight: 2000,
        actualWeight: 2050,
        clearanceStatus: 'Not Cleared',
        flaggedIssue: '',
        digitalSignatureValid: false,
        digitalSignatureData: null,
        accessLogs: [
          { timestamp: '2025-07-30 08:00', activity: 'Vehicle entered port' },
          { timestamp: '2025-07-31 10:15', activity: 'Ticket created' },
        ],
      },
      {
        id: 2,
        entryNumber: 'CUST-2025-002',
        importer: 'Globex Inc',
        status: 'Approved',
        dateSubmitted: '2025-07-30',
        declaredWeight: 3500,
        actualWeight: 3490,
        clearanceStatus: 'Cleared',
        flaggedIssue: '',
        digitalSignatureValid: true,
        digitalSignatureData: null, // could be a saved base64 image here
        accessLogs: [
          { timestamp: '2025-07-29 07:45', activity: 'Vehicle entered port' },
          { timestamp: '2025-07-30 09:00', activity: 'Ticket approved' },
        ],
      },
    ];
    setEntries(mockData);
  }, []);

  const openModal = (entry) => {
    setSelectedEntry(entry);
    onOpen();
  };

  const handleSave = () => {
    if (!selectedEntry) return;
    setIsSaving(true);

    // Simulate save delay and update entries list
    setTimeout(() => {
      setEntries((prev) =>
        prev.map((e) => (e.id === selectedEntry.id ? selectedEntry : e))
      );
      setIsSaving(false);
      toast({
        title: 'Entry updated',
        description: `Entry ${selectedEntry.entryNumber} updated successfully.`,
        status: 'success',
        duration: 3000,
        isClosable: true,
      });
      onClose();
    }, 1000);
  };

  const updateField = (field, value) => {
    setSelectedEntry((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  // Clear the signature pad and clear saved signature
  const clearSignature = () => {
    if (sigCanvasRef.current) {
      sigCanvasRef.current.clear();
    }
    updateField('digitalSignatureData', null);
    updateField('digitalSignatureValid', false);
  };

  // Save signature from canvas to state
  const saveSignature = () => {
    if (sigCanvasRef.current && sigCanvasRef.current.isEmpty()) {
      toast({
        title: 'No signature detected',
        description: 'Please sign before saving.',
        status: 'warning',
        duration: 3000,
        isClosable: true,
      });
      return;
    }
    const dataURL = sigCanvasRef.current.getTrimmedCanvas().toDataURL('image/png');
    updateField('digitalSignatureData', dataURL);
    updateField('digitalSignatureValid', true);
    toast({
      title: 'Signature saved',
      status: 'success',
      duration: 2000,
      isClosable: true,
    });
  };

  // Load saved signature into signature pad when modal opens or selectedEntry changes
  useEffect(() => {
    if (isOpen && selectedEntry && selectedEntry.digitalSignatureData && sigCanvasRef.current) {
      sigCanvasRef.current.fromDataURL(selectedEntry.digitalSignatureData);
    } else if (sigCanvasRef.current) {
      sigCanvasRef.current.clear();
    }
  }, [isOpen, selectedEntry]);

  return (
    <Box p={6} maxW="100vw" overflowX="auto">
      <Heading mb={6}>Customs Management</Heading>

      <HStack mb={4}>
        <Button
          colorScheme="blue"
          onClick={() => exportToCsv('customs_entries.csv', entries)}
          isDisabled={entries.length === 0}
        >
          Export CSV
        </Button>
      </HStack>

      {entries.length === 0 ? (
        <Text>No customs entries found.</Text>
      ) : (
        <Table variant="striped" size="md" maxW="100%">
          <Thead>
            <Tr>
              <Th>Entry Number</Th>
              <Th>Importer</Th>
              <Th>Date Submitted</Th>
              <Th>Status</Th>
              <Th>Clearance Status</Th>
              <Th>Flagged Issue</Th>
              <Th>Actions</Th>
            </Tr>
          </Thead>
          <Tbody>
            {entries.map((entry) => (
              <Tr key={entry.id}>
                <Td>{entry.entryNumber}</Td>
                <Td>{entry.importer}</Td>
                <Td>{entry.dateSubmitted}</Td>
                <Td>
                  <Badge
                    colorScheme={
                      entry.status === 'Pending'
                        ? 'yellow'
                        : entry.status === 'Approved'
                        ? 'green'
                        : 'red'
                    }
                  >
                    {entry.status}
                  </Badge>
                </Td>
                <Td>
                  <Badge
                    colorScheme={
                      entry.clearanceStatus === 'Cleared' ? 'green' : 'orange'
                    }
                  >
                    {entry.clearanceStatus}
                  </Badge>
                </Td>
                <Td>
                  {entry.flaggedIssue ? (
                    <Badge colorScheme="red" maxW="200px" isTruncated>
                      {entry.flaggedIssue}
                    </Badge>
                  ) : (
                    <Text fontSize="sm" color="gray.500" noOfLines={1}>
                      None
                    </Text>
                  )}
                </Td>
                <Td>
                  <Button size="sm" colorScheme="teal" onClick={() => openModal(entry)}>
                    View
                  </Button>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      {/* Modal for viewing and editing entry */}
      <Modal size="xl" isOpen={isOpen} onClose={onClose} scrollBehavior="inside">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            {selectedEntry ? `Entry Details: ${selectedEntry.entryNumber}` : ''}
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {selectedEntry ? (
              <VStack spacing={4} align="stretch">
                <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                  <Box>
                    <Text fontWeight="bold">Importer:</Text>
                    <Text>{selectedEntry.importer}</Text>
                  </Box>
                  <Box>
                    <Text fontWeight="bold">Date Submitted:</Text>
                    <Text>{selectedEntry.dateSubmitted}</Text>
                  </Box>
                  <Box>
                    <Text fontWeight="bold">Declared Weight (kg):</Text>
                    <Text>{selectedEntry.declaredWeight}</Text>
                  </Box>
                  <Box>
                    <Text fontWeight="bold">Actual Weight (kg):</Text>
                    <Text>{selectedEntry.actualWeight}</Text>
                  </Box>
                  <Box>
                    <Text fontWeight="bold">Status:</Text>
                    <Badge
                      colorScheme={
                        selectedEntry.status === 'Pending'
                          ? 'yellow'
                          : selectedEntry.status === 'Approved'
                          ? 'green'
                          : 'red'
                      }
                    >
                      {selectedEntry.status}
                    </Badge>
                  </Box>
                  <Box>
                    <Text fontWeight="bold">Clearance Status:</Text>
                    <Badge
                      colorScheme={
                        selectedEntry.clearanceStatus === 'Cleared' ? 'green' : 'orange'
                      }
                    >
                      {selectedEntry.clearanceStatus}
                    </Badge>
                  </Box>
                </SimpleGrid>

                <Divider />

                <FormControl display="flex" alignItems="center">
                  <FormLabel htmlFor="clearanceStatus" mb="0">
                    Clearance Status:
                  </FormLabel>
                  <Switch
                    id="clearanceStatus"
                    colorScheme="green"
                    isChecked={selectedEntry.clearanceStatus === 'Cleared'}
                    onChange={(e) =>
                      updateField('clearanceStatus', e.target.checked ? 'Cleared' : 'Not Cleared')
                    }
                  />
                </FormControl>

                <FormControl>
                  <FormLabel>Flagged Issue (if any):</FormLabel>
                  <Textarea
                    placeholder="Describe issue or leave blank"
                    value={selectedEntry.flaggedIssue}
                    onChange={(e) => updateField('flaggedIssue', e.target.value)}
                  />
                </FormControl>

                <FormControl display="flex" alignItems="center" mb={4}>
                  <FormLabel htmlFor="digitalSignature" mb="0" flexShrink={0}>
                    Digital Signature Valid:
                  </FormLabel>
                  <Switch
                    id="digitalSignature"
                    colorScheme="blue"
                    isChecked={selectedEntry.digitalSignatureValid}
                    onChange={(e) => updateField('digitalSignatureValid', e.target.checked)}
                  />
                </FormControl>

                <Divider />

                {/* Signature Pad Section */}
                <Box>
                  <Text fontWeight="bold" mb={2}>
                    E-Signature:
                  </Text>

                  <Box
                    border="1px solid #CBD5E0"
                    borderRadius="md"
                    p={2}
                    bg="gray.50"
                    maxW="400px"
                    minH="150px"
                  >
                    <SignatureCanvas
                      ref={sigCanvasRef}
                      penColor="black"
                      canvasProps={{ width: 400, height: 150, className: 'sigCanvas' }}
                      backgroundColor="white"
                    />
                  </Box>

                  <HStack spacing={4} mt={2}>
                    <Button size="sm" onClick={clearSignature} colorScheme="red">
                      Clear
                    </Button>
                    <Button size="sm" onClick={saveSignature} colorScheme="green">
                      Save Signature
                    </Button>
                  </HStack>

                  {/* Show saved signature image if available */}
                  {selectedEntry.digitalSignatureData && (
                    <Box mt={4}>
                      <Text fontSize="sm" mb={1}>
                        Saved Signature Preview:
                      </Text>
                      <Box
                        border="1px solid #CBD5E0"
                        borderRadius="md"
                        maxW="400px"
                        maxH="150px"
                        overflow="hidden"
                      >
                        <img
                          src={selectedEntry.digitalSignatureData}
                          alt="Saved Signature"
                          style={{ width: '100%', height: 'auto', display: 'block' }}
                        />
                      </Box>
                    </Box>
                  )}
                </Box>

                <Divider />

                <Box>
                  <Text fontWeight="bold" mb={2}>
                    Access Logs:
                  </Text>
                  <Box
                    maxH="150px"
                    overflowY="auto"
                    borderWidth="1px"
                    borderRadius="md"
                    p={2}
                    bg="gray.50"
                  >
                    {selectedEntry.accessLogs.length === 0 ? (
                      <Text fontStyle="italic">No logs available.</Text>
                    ) : (
                      selectedEntry.accessLogs.map((log, idx) => (
                        <Text key={idx} fontSize="sm" mb={1}>
                          <b>{log.timestamp}:</b> {log.activity}
                        </Text>
                      ))
                    )}
                  </Box>
                </Box>
              </VStack>
            ) : (
              <Spinner size="xl" />
            )}
          </ModalBody>

          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={onClose}>
              Cancel
            </Button>
            <Button colorScheme="blue" onClick={handleSave} isLoading={isSaving}>
              Save Changes
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
}
