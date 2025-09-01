import React, { useState, useEffect, useRef } from 'react';
import {
  Box, Heading, Table, Thead, Tbody, Tr, Th, Td, Button, HStack, Input, Select, Spinner,
  Text, useToast, Badge, Tooltip, IconButton, Modal, ModalOverlay, ModalContent,
  ModalHeader, ModalBody, ModalFooter, ModalCloseButton, useDisclosure
} from '@chakra-ui/react';
import { ViewIcon } from '@chakra-ui/icons';
import SignaturePad from 'react-signature-canvas';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

const sampleGateOperations = [
  {
    id: 'G-001',
    vehicleNumber: 'ABC-1234',
    containerNumber: 'CONT-001',
    entryTime: '2025-07-30 08:15',
    weight: 12000,
    exitTime: null,
    status: 'Pending Approval',
    remarks: '',
    logs: ['Entered at 08:15', 'Weight recorded: 12000kg'],
    operatorSignature: null,
  },
  {
    id: 'G-002',
    vehicleNumber: 'XYZ-5678',
    containerNumber: 'CONT-002',
    entryTime: '2025-07-30 09:00',
    weight: 15000,
    exitTime: null,
    status: 'Weighing Required',
    remarks: '',
    logs: ['Entered at 09:00', 'Sent back for reweighing'],
    operatorSignature: null,
  },
];

const exportToCSV = (data) => {
  const headers = ['ID', 'Vehicle', 'Container', 'Entry', 'Weight (kg)', 'Exit', 'Status', 'Remarks'];
  const rows = data.map(op => [
    op.id, op.vehicleNumber, op.containerNumber, op.entryTime,
    op.weight, op.exitTime || '-', op.status, op.remarks || ''
  ]);
  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', 'gate-operations.csv');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const exportToPDF = (data) => {
  const doc = new jsPDF();
  doc.setFontSize(18);
  doc.text('Gate Operations Report', 14, 22);
  doc.setFontSize(11);
  doc.setTextColor(100);

  const headers = [['ID', 'Vehicle', 'Container', 'Entry', 'Weight (kg)', 'Exit', 'Status']];
  const rows = data.map(op => [
    op.id, op.vehicleNumber, op.containerNumber, op.entryTime,
    op.weight.toString(), op.exitTime || '-', op.status
  ]);

  doc.autoTable({
    startY: 30,
    head: headers,
    body: rows,
    styles: { fontSize: 10 },
    headStyles: { fillColor: [22, 160, 133] },
  });

  doc.save('gate-operations.pdf');
};

export default function GateOperationsPage() {
  const [gateOps, setGateOps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [searchVehicle, setSearchVehicle] = useState('');
  const [searchContainer, setSearchContainer] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [selectedOp, setSelectedOp] = useState(null);
  const [sigError, setSigError] = useState(false);
  const sigPadRef = useRef();
  const toast = useToast();

  const { isOpen, onOpen, onClose } = useDisclosure(); // main modal
  const {
    isOpen: isConfirmOpen,
    onOpen: onConfirmOpen,
    onClose: onConfirmClose,
  } = useDisclosure(); // confirmation modal

  useEffect(() => {
    setTimeout(() => {
      setGateOps(sampleGateOperations);
      setLoading(false);
    }, 500);
  }, []);

  const filteredOps = gateOps.filter(op => {
    const matchesStatus = filterStatus ? op.status === filterStatus : true;
    const matchesVehicle = op.vehicleNumber.toLowerCase().includes(searchVehicle.toLowerCase());
    const matchesContainer = op.containerNumber.toLowerCase().includes(searchContainer.toLowerCase());
    const matchesDate = filterDate ? op.entryTime.startsWith(filterDate) : true;
    return matchesStatus && matchesVehicle && matchesContainer && matchesDate;
  });

  const statusBadge = (status) => {
    const badgeMap = {
      'Pending Approval': 'yellow',
      'Weighing Required': 'orange',
      'Approved for Exit': 'teal',
      'Exited': 'gray',
      'Held': 'red',
    };
    return <Badge colorScheme={badgeMap[status] || 'blue'}>{status}</Badge>;
  };

  const handleSave = () => {
    if (sigPadRef.current?.isEmpty()) {
      setSigError(true);
      onConfirmClose(); // Close confirm modal if signature missing
      return;
    }

    const signature = sigPadRef.current.getCanvas().toDataURL('image/png');

    const updated = gateOps.map(op => {
      if (op.id === selectedOp.id) {
        const nowStr = new Date().toISOString().slice(0, 16).replace('T', ' ');
        const newExitTime = selectedOp.status === 'Exited' ? nowStr : op.exitTime;
        const newLogs = [...(op.logs || [])];

        // Add status log
        newLogs.push(`${selectedOp.status} on ${new Date().toLocaleString()}`);

        // Add remarks log if remarks changed and not empty
        if (selectedOp.remarks && selectedOp.remarks !== op.remarks) {
          newLogs.push(`Remarks updated: ${selectedOp.remarks}`);
        }

        return {
          ...op,
          exitTime: newExitTime,
          status: selectedOp.status,
          remarks: selectedOp.remarks,
          logs: newLogs,
          operatorSignature: signature,
        };
      }
      return op;
    });

    setGateOps(updated);
    toast({
      title: `Saved ${selectedOp.id}`,
      description: 'Status and signature updated successfully.',
      status: 'success',
      duration: 3000,
      isClosable: true,
    });
    setSelectedOp(null);
    onClose();
    onConfirmClose();
    setSigError(false);
  };

  return (
    <Box p={6}>
      <Heading mb={6}>Outgate Officer Dashboard</Heading>

      <HStack spacing={4} mb={4} flexWrap="wrap">
        <Input
          placeholder="Search Vehicle"
          value={searchVehicle}
          onChange={(e) => setSearchVehicle(e.target.value)}
          maxW="200px"
        />
        <Input
          placeholder="Container ID"
          value={searchContainer}
          onChange={(e) => setSearchContainer(e.target.value)}
          maxW="200px"
        />
        <Input
          type="date"
          value={filterDate}
          onChange={(e) => setFilterDate(e.target.value)}
          maxW="180px"
        />
        <Select
          placeholder="Filter by Status"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          maxW="200px"
        >
          <option>Pending Approval</option>
          <option>Weighing Required</option>
          <option>Approved for Exit</option>
          <option>Held</option>
          <option>Exited</option>
        </Select>
        <Button
          onClick={() => {
            setSearchVehicle('');
            setSearchContainer('');
            setFilterStatus('');
            setFilterDate('');
          }}
        >
          Clear Filters
        </Button>
        <Button colorScheme="blue" onClick={() => exportToCSV(filteredOps)}>
          Export CSV
        </Button>
        <Button colorScheme="purple" onClick={() => exportToPDF(filteredOps)}>
          Export PDF
        </Button>
      </HStack>

      {loading ? (
        <Spinner />
      ) : (
        <Box overflowX="auto">
          <Table variant="simple" size="md">
            <Thead>
              <Tr>
                <Th>ID</Th>
                <Th>Vehicle</Th>
                <Th>Container</Th>
                <Th>Entry</Th>
                <Th>Weight</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {filteredOps.map((op) => (
                <Tr key={op.id}>
                  <Td>{op.id}</Td>
                  <Td>{op.vehicleNumber}</Td>
                  <Td>{op.containerNumber}</Td>
                  <Td>{op.entryTime}</Td>
                  <Td>{op.weight}</Td>
                  <Td>{statusBadge(op.status)}</Td>
                  <Td>
                    <Tooltip label="View / Update">
                      <IconButton
                        size="sm"
                        icon={<ViewIcon />}
                        onClick={() => {
                          setSelectedOp({ ...op }); // clone to avoid direct mutation
                          setSigError(false);
                          onOpen();
                          // Clear signature pad when opening modal
                          setTimeout(() => sigPadRef.current?.clear(), 50);
                        }}
                        aria-label="View"
                      />
                    </Tooltip>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Box>
      )}

      {/* Main Update Modal */}
      <Modal
        isOpen={isOpen}
        onClose={() => {
          setSelectedOp(null);
          onClose();
          setSigError(false);
        }}
        size="md"
        isCentered
        scrollBehavior="inside"
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Update: {selectedOp?.vehicleNumber}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {selectedOp && (
              <>
                <Text>
                  <strong>Container:</strong> {selectedOp.containerNumber}
                </Text>
                <Text>
                  <strong>Entry:</strong> {selectedOp.entryTime}
                </Text>
                <Text>
                  <strong>Weight:</strong> {selectedOp.weight} kg
                </Text>
                <Text>
                  <strong>Exit:</strong> {selectedOp.exitTime || '-'}
                </Text>

                <Select
                  mt={3}
                  value={selectedOp.status}
                  onChange={(e) =>
                    setSelectedOp({ ...selectedOp, status: e.target.value })
                  }
                >
                  <option>Pending Approval</option>
                  <option>Weighing Required</option>
                  <option>Approved for Exit</option>
                  <option>Held</option>
                  <option>Exited</option>
                </Select>

                <Input
                  mt={3}
                  placeholder="Remarks"
                  value={selectedOp.remarks || ''}
                  onChange={(e) =>
                    setSelectedOp({ ...selectedOp, remarks: e.target.value })
                  }
                />

                <Box mt={4}>
                  <Text fontWeight="semibold">Operator Signature</Text>
                  <Box border="1px solid gray" borderRadius="md" mt={2}>
                    <SignaturePad
                      ref={sigPadRef}
                      canvasProps={{ width: 400, height: 150, className: 'sigCanvas' }}
                    />
                  </Box>
                  <Button mt={2} size="sm" onClick={() => sigPadRef.current?.clear()}>
                    Clear Signature
                  </Button>
                  {sigError && (
                    <Text color="red.500" fontSize="sm" mt={1}>
                      Signature is required.
                    </Text>
                  )}
                </Box>

                <Box mt={4}>
                  <Text fontWeight="bold">Logs</Text>
                  {selectedOp.logs.map((log, i) => (
                    <Text key={i} fontSize="sm" color="gray.600">
                      - {log}
                    </Text>
                  ))}
                </Box>
              </>
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              onClick={() => {
                setSelectedOp(null);
                onClose();
                setSigError(false);
              }}
            >
              Cancel
            </Button>
            <Button colorScheme="green" ml={3} onClick={onConfirmOpen}>
              Save & Sign
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Confirmation Modal */}
      <Modal isOpen={isConfirmOpen} onClose={onConfirmClose} isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Confirm Save</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Text>Are you sure you want to save the updates and sign?</Text>
          </ModalBody>
          <ModalFooter>
            <Button onClick={onConfirmClose}>Cancel</Button>
            <Button colorScheme="green" ml={3} onClick={handleSave}>
              Confirm
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
}
