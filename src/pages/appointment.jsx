// pages/appointment.jsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  Box, Button, Container, Heading, Input as ChakraInput, Select, Text, SimpleGrid,
  FormControl, FormLabel, HStack, Stack, Table, Thead, Tbody, Tr, Th, Td,
  useToast, Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalFooter, ModalCloseButton,
  IconButton, Badge, Divider
} from '@chakra-ui/react';
import { AddIcon, DeleteIcon, EditIcon, DownloadIcon } from '@chakra-ui/icons';
import { Document, Page, Text as PdfText, View as PdfView, StyleSheet, pdf as pdfRender, Image as PdfImage } from '@react-pdf/renderer';

// ---------- Config ----------
const WAREHOUSES = [
  { value: 'WTGMBJLCON', label: 'WTGMBJLCON - GAMBIA PORTS AUTHORITY - P.O BOX 617 BANJUL BJ' },
];

const PACKING_TYPES = [
  { value: 'container', label: 'Container' },
  { value: 'bulk', label: 'Bulk' },
  { value: 'loose', label: 'Loose Cargo' },
];

// ---------- PDF styles ----------
const pdfStyles = StyleSheet.create({
  page: { padding: 20, fontSize: 11, fontFamily: 'Helvetica' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontSize: 16, fontWeight: '700', marginBottom: 6 },
  section: { marginBottom: 8 },
  barcodeImg: { width: 240, height: 48, marginTop: 8, objectFit: 'cover' },
  footer: { position: 'absolute', bottom: 20, left: 20, right: 20, textAlign: 'center', fontSize: 9, color: '#888' },
});

// ---------- Helpers ----------
function uidSeed(key = 'appt_seq') {
  try {
    if (typeof window === 'undefined') return Date.now();
    const raw = localStorage.getItem(key);
    let n = raw ? parseInt(raw, 10) : 0;
    n = Number.isFinite(n) ? n + 1 : 1;
    localStorage.setItem(key, String(n));
    return n;
  } catch (e) {
    return Math.floor(Math.random() * 10000);
  }
}

function generateBarcodeSvgDataUrl(value, width = 400, height = 80) {
  const chars = String(value || '').split('');
  let bits = [];
  for (let i = 0; i < chars.length; i++) {
    const code = chars[i].charCodeAt(0);
    for (let b = 0; b < 8; b++) bits.push((code >> b) & 1);
  }
  while (bits.length < 120) bits = bits.concat(bits);
  const totalBars = Math.min(bits.length, 200);
  const barWidth = Math.max(1, Math.floor(width / totalBars));
  let x = 0;
  let rects = '';
  for (let i = 0; i < totalBars; i++) {
    const bit = bits[i];
    const hScale = 0.8 + (bits[(i + 7) % bits.length] ? 0.2 : 0);
    const bw = barWidth;
    if (bit) rects += `<rect x="${x}" y="${0}" width="${bw}" height="${Math.floor(height * hScale)}" fill="black"/>`;
    else rects += `<rect x="${x}" y="${0}" width="${Math.max(1, Math.floor(bw / 2))}" height="${Math.floor(height * 0.9)}" fill="black"/>`;
    x += bw;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="white" />
    ${rects}
    <text x="50%" y="${height - 4}" font-size="10" text-anchor="middle" fill="#222" font-family="monospace">${value}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------- PDF component ----------
function AppointmentPdf({ ticket }) {
  const barcodeDataUrl = generateBarcodeSvgDataUrl(ticket.appointmentNumber, 400, 60);
  return (
    <Document>
      <Page size="A4" style={pdfStyles.page}>
        <PdfView style={pdfStyles.headerRow}>
          <PdfText style={pdfStyles.title}>Weighbridge Appointment Ticket</PdfText>
          <PdfView>
            <PdfText>Appointment Number: {ticket.appointmentNumber}</PdfText>
            <PdfText>Weighbridge No: {ticket.weighbridgeNumber}</PdfText>
          </PdfView>
        </PdfView>

        <PdfView style={pdfStyles.section}>
          <PdfText>Agent: {ticket.agentName} ({ticket.agentTin})</PdfText>
          <PdfText>Warehouse: {ticket.warehouseLabel}</PdfText>
          <PdfText>Pick-up Date: {ticket.pickupDate}</PdfText>
          <PdfText>Truck Number: {ticket.truckNumber}</PdfText>
          <PdfText>Driver: {ticket.driverName} — License: {ticket.driverLicense}</PdfText>
        </PdfView>

        <PdfView style={pdfStyles.section}>
          <PdfText>Sub-T1s: {ticket.t1s.length}</PdfText>
          <PdfView style={{ marginTop: 6, marginBottom: 6 }}>
            <PdfView style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#ccc', paddingBottom: 4 }}>
              <PdfText style={{ width: '30%', fontWeight: 'bold' }}>SAD No</PdfText>
              <PdfText style={{ width: '30%', fontWeight: 'bold' }}>Packing</PdfText>
              <PdfText style={{ width: '40%', fontWeight: 'bold' }}>Container No</PdfText>
            </PdfView>
            {ticket.t1s.map((r, i) => (
              <PdfView key={i} style={{ flexDirection: 'row', paddingVertical: 4 }}>
                <PdfText style={{ width: '30%' }}>{r.sadNo}</PdfText>
                <PdfText style={{ width: '30%' }}>{r.packingType}</PdfText>
                <PdfText style={{ width: '40%' }}>{r.containerNo || ''}</PdfText>
              </PdfView>
            ))}
          </PdfView>
        </PdfView>

        <PdfView style={{ marginTop: 8 }}>
          <PdfImage src={barcodeDataUrl} style={pdfStyles.barcodeImg} />
        </PdfView>

        <PdfText style={pdfStyles.footer}>Generated: {new Date().toLocaleString()}</PdfText>
      </Page>
    </Document>
  );
}

// ---------- Main page component ----------
export default function AppointmentPage() {
  const toast = useToast();

  // form state
  const [agentTin, setAgentTin] = useState('');
  const [agentName, setAgentName] = useState('');
  const [warehouse, setWarehouse] = useState(WAREHOUSES[0].value);
  const [pickupDate, setPickupDate] = useState('');
  const [consolidated, setConsolidated] = useState('N');
  const [truckNumber, setTruckNumber] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverLicense, setDriverLicense] = useState('');

  const [t1s, setT1s] = useState([]);
  const [isT1ModalOpen, setT1ModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [t1Sad, setT1Sad] = useState('');
  const [t1Packing, setT1Packing] = useState(PACKING_TYPES[0].value);
  const [t1Container, setT1Container] = useState('');

  const [isConfirmOpen, setConfirmOpen] = useState(false);
  const [loadingCreate, setLoadingCreate] = useState(false);

  // Basic validation
  const validateMainForm = () => {
    if (!agentTin.trim()) { toast({ status: 'error', title: 'Agent TIN required' }); return false; }
    if (!agentName.trim()) { toast({ status: 'error', title: 'Agent Name required' }); return false; }
    if (!warehouse) { toast({ status: 'error', title: 'Warehouse required' }); return false; }
    if (!pickupDate) { toast({ status: 'error', title: 'Pick-up Date required' }); return false; }
    if (!truckNumber.trim()) { toast({ status: 'error', title: 'Truck Number required' }); return false; }
    if (!driverName.trim()) { toast({ status: 'error', title: 'Driver Name required' }); return false; }
    if (!driverLicense.trim()) { toast({ status: 'error', title: 'Driver License required' }); return false; }
    if (t1s.length === 0) { toast({ status: 'error', title: 'Please add at least one T1 record' }); return false; }
    if (consolidated === 'N' && t1s.length > 1) { toast({ status: 'error', title: 'Consolidated = N allows only one T1 record' }); return false; }
    return true;
  };

  // T1 modal
  const openAddT1 = () => {
    setEditingIndex(null);
    setT1Sad('');
    setT1Packing(PACKING_TYPES[0].value);
    setT1Container('');
    setT1ModalOpen(true);
  };
  const openEditT1 = (idx) => {
    const row = t1s[idx];
    if (!row) return;
    setEditingIndex(idx);
    setT1Sad(row.sadNo);
    setT1Packing(row.packingType);
    setT1Container(row.containerNo || '');
    setT1ModalOpen(true);
  };
  const closeT1Modal = () => { setT1ModalOpen(false); setEditingIndex(null); };

  const handleT1Save = () => {
    if (!t1Sad.trim()) { toast({ status: 'error', title: 'SAD No required' }); return; }
    if (!t1Packing) { toast({ status: 'error', title: 'Packing Type required' }); return; }
    if (t1Packing === 'container' && !t1Container.trim()) { toast({ status: 'error', title: 'Container No required for container packing' }); return; }
    if (consolidated === 'N' && editingIndex === null && t1s.length >= 1) { toast({ status: 'error', title: 'Consolidated = N allows only one T1' }); return; }
    if (consolidated === 'Y') {
      const existsSamePackingIndex = t1s.findIndex((r, i) => r.packingType === t1Packing && i !== editingIndex);
      if (existsSamePackingIndex !== -1) { toast({ status: 'error', title: `Packing type "${t1Packing}" already added` }); return; }
    }

    const newRow = { sadNo: t1Sad.trim(), packingType: t1Packing, containerNo: t1Packing === 'container' ? t1Container.trim() : null };
    if (editingIndex !== null && editingIndex >= 0) {
      const cp = [...t1s];
      cp[editingIndex] = newRow;
      setT1s(cp);
      toast({ status: 'success', title: 'T1 updated' });
    } else {
      setT1s((p) => [...p, newRow]);
      toast({ status: 'success', title: 'T1 added' });
    }
    closeT1Modal();
  };

  const removeT1 = (idx) => { setT1s((p) => p.filter((_, i) => i !== idx)); toast({ status: 'info', title: 'T1 removed' }); };

  // Confirm modal
  const openConfirm = () => {
    if (!validateMainForm()) return;
    setConfirmOpen(true);
  };
  const closeConfirm = () => setConfirmOpen(false);

  // Create appointment — POST to /api/appointments (Step 2)
  const handleCreateAppointment = async () => {
    if (!validateMainForm()) return;
    setLoadingCreate(true);

    const payload = {
      warehouse,
      warehouseLabel: (WAREHOUSES.find(w => w.value === warehouse) || {}).label || warehouse,
      pickupDate,
      agentName: agentName.trim(),
      agentTin: agentTin.trim(),
      consolidated,
      truckNumber: truckNumber.trim(),
      driverName: driverName.trim(),
      driverLicense: driverLicense.trim(),
      regime: '',
      totalDocumentedWeight: '',
      t1s: t1s.map(r => ({ sadNo: r.sadNo, packingType: r.packingType, containerNo: r.containerNo || '' })),
    };

    try {
      const resp = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => null);
        console.error('API error', err);
        toast({ title: 'Failed', description: err?.error || err?.message || 'Server error creating appointment', status: 'error' });
        setLoadingCreate(false);
        return;
      }

      const body = await resp.json();
      const ticket = body?.appointment;
      if (!ticket) {
        toast({ title: 'API returned no appointment', status: 'error' });
        setLoadingCreate(false);
        return;
      }

      // Render PDF client-side for immediate download
      try {
        const doc = <AppointmentPdf ticket={{
          appointmentNumber: ticket.appointmentNumber || ticket.appointment_number || ticket.appointmentNumber,
          weighbridgeNumber: ticket.weighbridgeNumber || ticket.weighbridge_number,
          warehouse: ticket.warehouse,
          warehouseLabel: ticket.warehouseLabel || ticket.warehouse_label,
          pickupDate: ticket.pickupDate || ticket.pickup_date,
          agentName: ticket.agentName || ticket.agent_name,
          agentTin: ticket.agentTin || ticket.agent_tin,
          truckNumber: ticket.truckNumber || ticket.truck_number,
          driverName: ticket.driverName || ticket.driver_name,
          driverLicense: ticket.driverLicense || ticket.driver_license,
          regime: ticket.regime || '',
          totalDocumentedWeight: ticket.totalDocumentedWeight || ticket.total_documented_weight,
          t1s: ticket.t1s || (ticket.t1_records || []).map(r => ({ sadNo: r.sad_no, packingType: r.packing_type, containerNo: r.container_no })),
        }} />;

        const asPdf = pdfRender(doc);
        const blob = await asPdf.toBlob();
        downloadBlob(blob, `Appointment-${ticket.appointmentNumber || ticket.appointment_number}.pdf`);
      } catch (pdfErr) {
        console.error('PDF generation after API create failed', pdfErr);
        toast({ title: 'Appointment created', description: 'Saved but PDF generation failed', status: 'warning' });
      }

      toast({ title: 'Appointment created', description: `Appointment ${ticket.appointmentNumber || ticket.appointment_number} saved`, status: 'success' });

      // Reset form
      setAgentTin(''); setAgentName(''); setWarehouse(WAREHOUSES[0].value);
      setPickupDate(''); setConsolidated('N'); setTruckNumber(''); setDriverName(''); setDriverLicense(''); setT1s([]);
      setConfirmOpen(false);

    } catch (err) {
      console.error('Create appointment failed', err);
      toast({ title: 'Failed', description: err?.message || 'Unexpected error', status: 'error' });
    } finally {
      setLoadingCreate(false);
    }
  };

  const packingTypesUsed = useMemo(() => (t1s || []).map(t => t.packingType), [t1s]);

  return (
    <Container maxW="container.lg" py={8}>
      <Heading mb={4}>Weighbridge Appointment — Self Service</Heading>

      <Box p={5} borderWidth="1px" borderRadius="md" mb={6}>
        <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
          <FormControl isRequired>
            <FormLabel>Agent TIN</FormLabel>
            <ChakraInput value={agentTin} onChange={(e) => setAgentTin(e.target.value)} placeholder="Enter Agent TIN" />
          </FormControl>

          <FormControl isRequired>
            <FormLabel>Agent Name</FormLabel>
            <ChakraInput value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="Agent / Company Name" />
          </FormControl>

          <FormControl isRequired>
            <FormLabel>Warehouse Location</FormLabel>
            <Select value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
              {WAREHOUSES.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
            </Select>
          </FormControl>

          <FormControl isRequired>
            <FormLabel>Pick-up Date</FormLabel>
            <ChakraInput type="date" value={pickupDate} onChange={(e) => setPickupDate(e.target.value)} />
          </FormControl>

          <FormControl isRequired>
            <FormLabel>Consolidated</FormLabel>
            <Select value={consolidated} onChange={(e) => setConsolidated(e.target.value)}>
              <option value="N">NO</option>
              <option value="Y">YES</option>
            </Select>
            <Text fontSize="sm" color="gray.600" mt={1}>
              If <b>NO</b> only one T1 allowed. If <b>YES</b> multiple T1 allowed but each packing type only once. Contact App Support for assistance.
            </Text>
          </FormControl>

          <FormControl isRequired>
            <FormLabel>Truck Number</FormLabel>
            <ChakraInput value={truckNumber} onChange={(e) => setTruckNumber(e.target.value)} placeholder="Truck Plate / No." />
          </FormControl>

          <FormControl isRequired>
            <FormLabel>Driver Name</FormLabel>
            <ChakraInput value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="Driver full name" />
          </FormControl>

          <FormControl isRequired>
            <FormLabel>Driver License No</FormLabel>
            <ChakraInput value={driverLicense} onChange={(e) => setDriverLicense(e.target.value)} placeholder="Driver License No" />
          </FormControl>
        </SimpleGrid>

        <Divider my={4} />

        <HStack spacing={3} mb={3}>
          <Button leftIcon={<AddIcon />} colorScheme="teal" onClick={openAddT1}>Add T1 Record</Button>
          <Badge colorScheme="purple">{t1s.length} T1(s) added</Badge>
          {consolidated === 'Y' && (
            <Text fontSize="sm" color="gray.600">Packing types used: {packingTypesUsed.join(', ') || '—'}</Text>
          )}
        </HStack>

        <Box overflowX="auto">
          <Table variant="simple" size="sm">
            <Thead>
              <Tr>
                <Th>#</Th>
                <Th>SAD No</Th>
                <Th>Packing</Th>
                <Th>Container No</Th>
                <Th>Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {t1s.length === 0 && (
                <Tr><Td colSpan={5}><Text color="gray.500">No T1 records added yet.</Text></Td></Tr>
              )}
              {t1s.map((r, i) => (
                <Tr key={i}>
                  <Td>{i + 1}</Td>
                  <Td>{r.sadNo}</Td>
                  <Td textTransform="capitalize">{r.packingType}</Td>
                  <Td>{r.containerNo || '—'}</Td>
                  <Td>
                    <HStack>
                      <IconButton size="sm" icon={<EditIcon />} aria-label="Edit" onClick={() => openEditT1(i)} />
                      <IconButton size="sm" colorScheme="red" icon={<DeleteIcon />} aria-label="Remove" onClick={() => removeT1(i)} />
                    </HStack>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Box>

        <HStack justify="flex-end" mt={6}>
          <Button variant="outline" onClick={() => {
            setAgentTin(''); setAgentName(''); setWarehouse(WAREHOUSES[0].value);
            setPickupDate(''); setConsolidated('N'); setTruckNumber(''); setDriverName(''); setDriverLicense(''); setT1s([]);
            toast({ status: 'info', title: 'Form cleared' });
          }}>Clear</Button>

          <Button colorScheme="blue" onClick={openConfirm}>Create Weighbridge</Button>
        </HStack>
      </Box>

      {/* T1 Modal */}
      <Modal isOpen={isT1ModalOpen} onClose={closeT1Modal} isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>{editingIndex !== null ? 'Edit T1 Record' : 'Add T1 Record'}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Stack spacing={3}>
              <FormControl isRequired>
                <FormLabel>SAD No</FormLabel>
                <ChakraInput value={t1Sad} onChange={(e) => setT1Sad(e.target.value)} placeholder="e.g. C26370" />
              </FormControl>

              <FormControl isRequired>
                <FormLabel>Packing Type</FormLabel>
                <Select value={t1Packing} onChange={(e) => setT1Packing(e.target.value)}>
                  {PACKING_TYPES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </Select>
              </FormControl>

              {t1Packing === 'container' && (
                <FormControl isRequired>
                  <FormLabel>Container No</FormLabel>
                  <ChakraInput value={t1Container} onChange={(e) => setT1Container(e.target.value)} placeholder="Container No (e.g. TEST1000001)" />
                </FormControl>
              )}
            </Stack>
          </ModalBody>

          <ModalFooter>
            <Button onClick={closeT1Modal} mr={3}>Cancel</Button>
            <Button colorScheme="teal" onClick={handleT1Save}>{editingIndex !== null ? 'Save' : 'Add'}</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Confirm Modal */}
      <Modal isOpen={isConfirmOpen} onClose={closeConfirm} isCentered>
        <ModalOverlay />
        <ModalContent maxW="lg">
          <ModalHeader>Confirm Appointment</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Stack spacing={3}>
              <Text><b>Agent:</b> {agentName} ({agentTin})</Text>
              <Text><b>Warehouse:</b> {(WAREHOUSES.find(w => w.value === warehouse) || {}).label}</Text>
              <Text><b>Pick-up Date:</b> {pickupDate}</Text>
              <Text><b>Truck:</b> {truckNumber}</Text>
              <Text><b>Driver:</b> {driverName} — {driverLicense}</Text>
              <Text><b>Consolidated:</b> {consolidated}</Text>

              <Box>
                <Text fontWeight="semibold">T1 Records ({t1s.length})</Text>
                <Table size="sm" mt={2}>
                  <Thead><Tr><Th>#</Th><Th>SAD</Th><Th>Packing</Th><Th>Container</Th></Tr></Thead>
                  <Tbody>
                    {t1s.map((r, i) => (
                      <Tr key={i}>
                        <Td>{i + 1}</Td>
                        <Td>{r.sadNo}</Td>
                        <Td>{r.packingType}</Td>
                        <Td>{r.containerNo || '—'}</Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </Box>
            </Stack>
          </ModalBody>
          <ModalFooter>
            <Button onClick={closeConfirm} mr={3}>Cancel</Button>
            <Button colorScheme="blue" leftIcon={<DownloadIcon />} onClick={handleCreateAppointment} isLoading={loadingCreate}>Confirm & Download Ticket</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Container>
  );
}
