// src/pages/WeighbridgeReports.jsx
import React, { useState } from 'react';
import {
  Box,
  Heading,
  Button,
  Input,
  FormControl,
  FormLabel,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  useToast,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  useDisclosure,
  Text, // Required
} from '@chakra-ui/react';


// Mock OCR extraction simulating async call to AI OCR service
async function mockOcrExtract(file) {
  await new Promise((r) => setTimeout(r, 1500));
  return {
    vehicleRegNo: 'ABC-1234',
    containerNumber: 'CONT-56789',
    grossWeight: 25000,
    tareWeight: 8000,
    netWeight: 17000,
    driverName: 'Michael Johnson',
    date: '2025-08-01',
    time: '14:30',
    cargoType: 'Electronics',
  };
}

function generateTicketId(existingIds) {
  let lastNumber = 0;
  existingIds.forEach((id) => {
    const numPart = parseInt(id.replace('TICKET-', ''), 10);
    if (numPart > lastNumber) lastNumber = numPart;
  });
  return `TICKET-${(lastNumber + 1).toString().padStart(4, '0')}`;
}

function WeighbridgeReports() {
  const [file, setFile] = useState(null);
  const [extractedData, setExtractedData] = useState(null);
  const [loadingOcr, setLoadingOcr] = useState(false);
  const [history, setHistory] = useState([]);
  const [ticketId, setTicketId] = useState('');
  const [reviewMode, setReviewMode] = useState(false);
  const toast = useToast();

  const { isOpen, onOpen, onClose } = useDisclosure();
  const [selectedRecord, setSelectedRecord] = useState(null);

  function handleFileChange(e) {
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;

    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(selectedFile.type)) {
      toast({
        title: 'Unsupported file type',
        description: 'Please upload a PDF, JPG, or PNG file.',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    setFile(selectedFile);
    setExtractedData(null);
    setReviewMode(false);
    setTicketId('');
  }

  async function handleExtract() {
    if (!file) {
      toast({
        title: 'No file selected',
        description: 'Please upload a file to extract data.',
        status: 'warning',
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    setLoadingOcr(true);
    try {
      const data = await mockOcrExtract(file);
      setExtractedData(data);
      const newTicketId = generateTicketId(history.map((h) => h.ticketId));
      setTicketId(newTicketId);
      setReviewMode(true);
    } catch (error) {
      toast({
        title: 'Extraction failed',
        description: 'Failed to extract data from the file.',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
    }
    setLoadingOcr(false);
  }

  function handleInputChange(field, value) {
    setExtractedData((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  function handleSubmit() {
    if (!extractedData) return;

    const newRecord = {
      ticketId,
      fileName: file.name,
      fileUrl: URL.createObjectURL(file),
      data: extractedData,
      submittedAt: new Date().toISOString(),
    };
    setHistory((prev) => [newRecord, ...prev]);

    toast({
      title: 'Ticket submitted',
      description: `Ticket ${ticketId} has been successfully submitted.`,
      status: 'success',
      duration: 3000,
      isClosable: true,
    });

    setFile(null);
    setExtractedData(null);
    setTicketId('');
    setReviewMode(false);
  }

  function openRecordModal(record) {
    setSelectedRecord(record);
    onOpen();
  }

  return (
    <Box p={6} maxW="900px" mx="auto">
      <Heading mb={6}>Weighbridge Ticket Submission</Heading>

      <FormControl mb={4}>
        <FormLabel>Upload Weighbridge Ticket (Image or PDF)</FormLabel>
        <Input type="file" accept="application/pdf,image/jpeg,image/png" onChange={handleFileChange} />
      </FormControl>

      <Button
        onClick={handleExtract}
        colorScheme="blue"
        isLoading={loadingOcr}
        loadingText="Extracting..."
        mb={6}
        isDisabled={!file}
      >
        Extract Ticket Data with OCR👈🏽
      </Button>

      {reviewMode && extractedData && (
        <Box mb={6} p={4} borderWidth="1px" borderRadius="md" bg="gray.50">
          <Heading size="md" mb={4}>
            Review Extracted Data - Ticket ID: {ticketId}
          </Heading>

          {[
            ['Vehicle Registration No.', 'vehicleRegNo'],
            ['Container Number', 'containerNumber'],
            ['Gross Weight (kg)', 'grossWeight'],
            ['Tare Weight (kg)', 'tareWeight'],
            ['Net Weight (kg)', 'netWeight'],
            ['Driver Name', 'driverName'],
            ['Date', 'date', 'date'],
            ['Time', 'time', 'time'],
            ['Cargo Type', 'cargoType'],
          ].map(([label, key, type = 'text']) => (
            <FormControl mb={3} key={key}>
              <FormLabel>{label}</FormLabel>
              <Input
                type={type}
                value={extractedData[key]}
                onChange={(e) => handleInputChange(key, e.target.value)}
              />
            </FormControl>
          ))}

          <Button colorScheme="green" onClick={handleSubmit}>
            Submit Ticket
          </Button>
        </Box>
      )}

      <Heading size="md" mb={4}>
        Submission History
      </Heading>

      {history.length === 0 ? (
        <Text>No tickets submitted yet.</Text>
      ) : (
        <Table variant="simple" colorScheme="blue" size="sm">
          <Thead>
            <Tr>
              <Th>Ticket ID</Th>
              <Th>File Name</Th>
              <Th>Vehicle Reg No.</Th>
              <Th>Gross Weight (kg)</Th>
              <Th>Date</Th>
              <Th>Actions</Th>
            </Tr>
          </Thead>
          <Tbody>
            {history.map((record) => (
              <Tr key={record.ticketId}>
                <Td>{record.ticketId}</Td>
                <Td>{record.fileName}</Td>
                <Td>{record.data.vehicleRegNo}</Td>
                <Td>{record.data.grossWeight}</Td>
                <Td>{new Date(record.submittedAt).toLocaleDateString()}</Td>
                <Td>
                  <Button size="sm" onClick={() => openRecordModal(record)}>
                    View Details
                  </Button>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      {/* Modal to view detailed record */}
      <Modal isOpen={isOpen} onClose={onClose} size="lg" scrollBehavior="inside">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Ticket Details: {selectedRecord?.ticketId}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {selectedRecord && (
              <>
                <Text><b>File Name:</b> {selectedRecord.fileName}</Text>
                <Text mb={2}>
                  <b>Submitted At:</b>{' '}
                  {new Date(selectedRecord.submittedAt).toLocaleString()}
                </Text>

                <Table variant="simple" size="sm" mb={4}>
                  <Tbody>
                    {Object.entries(selectedRecord.data).map(([key, value]) => (
                      <Tr key={key}>
                        <Td fontWeight="bold" textTransform="capitalize">
                          {key.replace(/([A-Z])/g, ' $1')}
                        </Td>
                        <Td>{value}</Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>

                <Box mb={4}>
                  <b>Preview File:</b>
                  {selectedRecord.fileName.toLowerCase().endsWith('.pdf') ? (
                    <iframe
                      title="PDF Preview"
                      src={selectedRecord.fileUrl}
                      style={{ width: '100%', height: '400px', border: 'none' }}
                    />
                  ) : (
                    <img
                      alt="Ticket preview"
                      src={selectedRecord.fileUrl}
                      style={{ maxWidth: '100%', maxHeight: '400px' }}
                    />
                  )}
                </Box>
              </>
            )}
          </ModalBody>

          <ModalFooter>
            <Button onClick={onClose}>Close</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
}

export default WeighbridgeReports;
