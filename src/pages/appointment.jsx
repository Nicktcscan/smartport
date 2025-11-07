// pages/appointment.jsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Box, Button, Container, Heading, Input as ChakraInput, Select, Text, SimpleGrid,
  FormControl, FormLabel, HStack, Stack, Table, Thead, Tbody, Tr, Th, Td,
  useToast, Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalFooter, ModalCloseButton,
  IconButton, Badge, Divider, VStack, useBreakpointValue, Flex
} from '@chakra-ui/react';
import { AddIcon, DeleteIcon, EditIcon, DownloadIcon, RepeatIcon, SearchIcon, SmallCloseIcon, InfoIcon } from '@chakra-ui/icons';
import { motion, AnimatePresence } from 'framer-motion';
import { pdf as pdfRender, Document, Page, Text as PdfText, View as PdfView, StyleSheet, Image as PdfImage } from '@react-pdf/renderer';

// ---------- Config ----------
const API_URL = 'https://smartport-api.vercel.app/api/appointments';

const WAREHOUSES = [
  { value: 'WTGMBJLCON', label: 'WTGMBJLCON - GAMBIA PORTS AUTHORITY - P.O BOX 617 BANJUL BJ' },
];

const PACKING_TYPES = [
  { value: 'container', label: 'Container' },
  { value: 'bulk', label: 'Bulk' },
  { value: 'loose', label: 'Loose Cargo' },
];

const MotionBox = motion(Box);

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

async function triggerConfetti(count = 140) {
  try {
    if (typeof window !== 'undefined' && !window.confetti) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.5.1/dist/confetti.browser.min.js';
        s.onload = () => resolve();
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    if (window.confetti) {
      window.confetti({
        particleCount: Math.min(count, 400),
        spread: 160,
        origin: { y: 0.6 },
      });
    }
  } catch (e) {
    // silent
  }
}

// ---------- PDF component ----------
function AppointmentPdf({ ticket }) {
  const barcodeDataUrl = generateBarcodeSvgDataUrl(ticket.appointmentNumber || ticket.appointment_number, 400, 60);
  return (
    <Document>
      <Page size="A4" style={pdfStyles.page}>
        <PdfView style={pdfStyles.headerRow}>
          <PdfText style={pdfStyles.title}>Weighbridge Appointment Ticket</PdfText>
          <PdfView>
            <PdfText>Appointment Number: {ticket.appointmentNumber || ticket.appointment_number}</PdfText>
            <PdfText>Weighbridge No: {ticket.weighbridgeNumber || ticket.weighbridge_number}</PdfText>
          </PdfView>
        </PdfView>

        <PdfView style={pdfStyles.section}>
          <PdfText>Agent: {ticket.agentName || ticket.agent_name} ({ticket.agentTin || ticket.agent_tin})</PdfText>
          <PdfText>Warehouse: {ticket.warehouseLabel || ticket.warehouse_label}</PdfText>
          <PdfText>Pick-up Date: {ticket.pickupDate || ticket.pickup_date}</PdfText>
          <PdfText>Truck Number: {ticket.truckNumber || ticket.truck_number}</PdfText>
          <PdfText>Driver: {ticket.driverName || ticket.driver_name} — License: {ticket.driverLicense || ticket.driver_license}</PdfText>
        </PdfView>

        <PdfView style={pdfStyles.section}>
          <PdfText>Sub-T1s: {(ticket.t1s || ticket.t1_records || []).length}</PdfText>
          <PdfView style={{ marginTop: 6, marginBottom: 6 }}>
            <PdfView style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#ccc', paddingBottom: 4 }}>
              <PdfText style={{ width: '30%', fontWeight: 'bold' }}>SAD No</PdfText>
              <PdfText style={{ width: '30%', fontWeight: 'bold' }}>Packing</PdfText>
              <PdfText style={{ width: '40%', fontWeight: 'bold' }}>Container No</PdfText>
            </PdfView>
            {(ticket.t1s || ticket.t1_records || []).map((r, i) => (
              <PdfView key={i} style={{ flexDirection: 'row', paddingVertical: 4 }}>
                <PdfText style={{ width: '30%' }}>{r.sadNo || r.sad_no}</PdfText>
                <PdfText style={{ width: '30%' }}>{r.packingType || r.packing_type}</PdfText>
                <PdfText style={{ width: '40%' }}>{r.containerNo || r.container_no || ''}</PdfText>
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

  // UI state for orb modal / holographic
  const [isOrbOpen, setOrbOpen] = useState(false);

  // voice recognition
  const recognitionRef = useRef(null);
  const [voiceActive, setVoiceActive] = useState(false);

  // confetti and panel interactions
  const containerRef = useRef(null);

  // responsiveness
  const isMobile = useBreakpointValue({ base: true, md: false });

  useEffect(() => {
    // page-level styles: light mode forced + lightblue background + glassmorphism helpers
    const id = 'appointment-page-styles';
    const css = `
      html, body, #root { background: #e6f6ff !important; } /* light blue whole page */
      .appt-glass {
        background: linear-gradient(180deg, rgba(255,255,255,0.85), rgba(255,255,255,0.72));
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.6);
        box-shadow: 0 10px 30px rgba(2,6,23,0.06);
        backdrop-filter: blur(6px) saturate(120%);
      }
      .floating-orb {
        position: fixed;
        right: 28px;
        bottom: 28px;
        z-index: 2200;
      }
      .orb {
        width:72px;height:72px;border-radius:999px;display:flex;align-items:center;justify-content:center;
        box-shadow: 0 10px 30px rgba(59,130,246,0.18), inset 0 -6px 18px rgba(62,180,200,0.08);
        background: linear-gradient(90deg,#7b61ff,#3ef4d0);
        color: #fff; cursor: pointer; transform-origin:center;
      }
      .orb:active { transform: scale(0.96); }
      .panel-3d { perspective: 1400px; }
      .panel-card { transition: transform 0.6s ease, box-shadow 0.6s ease; transform-style: preserve-3d; }
      @media (min-width:1600px) {
        .panel-3d:hover .panel-card { transform: rotateY(6deg) rotateX(3deg) translateZ(8px); box-shadow: 0 30px 80px rgba(2,6,23,0.12); }
      }
      .highlight-flash { box-shadow: 0 0 0 6px rgba(96,165,250,0.12) !important; transition: box-shadow 0.5s ease; }
      .card-small { border-radius: 12px; padding: 14px; border: 1px solid rgba(2,6,23,0.04); background: linear-gradient(180deg,#ffffff,#f7fbff); }
    `;
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('style');
      el.id = id;
      el.innerHTML = css;
      document.head.appendChild(el);
    } else {
      el.innerHTML = css;
    }
    return () => {
      const e = document.getElementById(id);
      if (e) e.remove();
    };
  }, []);

  // Voice recognition setup
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      recognitionRef.current = null;
      return;
    }
    const rec = new SpeechRecognition();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (ev) => {
      const text = ev.results?.[0]?.[0]?.transcript ?? '';
      handleVoiceCommand(text);
    };
    rec.onend = () => setVoiceActive(false);
    rec.onerror = () => setVoiceActive(false);
    recognitionRef.current = rec;
    return () => {
      try { rec.stop(); } catch (e) {}
    };
  }, []);

  const startVoice = () => {
    const r = recognitionRef.current;
    if (!r) {
      toast({ status: 'warning', title: 'Voice not supported' });
      return;
    }
    setVoiceActive(true);
    try { r.start(); } catch (e) { setVoiceActive(false); }
  };
  const stopVoice = () => {
    try { recognitionRef.current && recognitionRef.current.stop(); } catch (e) {}
    setVoiceActive(false);
  };

  const pulseRow = (index) => {
    const rows = document.querySelectorAll('.panel-card');
    const idx = Math.max(0, Math.min(index, rows.length - 1));
    const row = rows[idx];
    if (!row) return;
    row.classList.add('highlight-flash');
    setTimeout(() => row.classList.remove('highlight-flash'), 2400);
  };
  const highlightAll = () => {
    const els = document.querySelectorAll('.panel-card');
    els.forEach((el) => el.classList.add('highlight-flash'));
    setTimeout(() => els.forEach((el) => el.classList.remove('highlight-flash')), 2000);
  };

  const handleVoiceCommand = (text = '') => {
    const t = String(text || '').toLowerCase().trim();
    toast({ status: 'info', title: 'Voice command', description: `"${t}"`, duration: 2000 });
    if (t.includes('promote all')) {
      highlightAll();
      return;
    }
    if (t.includes('demote row')) {
      const m = t.match(/demote row (\d+)/);
      const digits = m ? Number(m[1]) : null;
      if (digits) {
        pulseRow(digits - 1);
      } else {
        toast({ status: 'warning', title: 'No row number found' });
      }
      return;
    }
    toast({ status: 'warning', title: 'Unknown command' });
  };

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

  // Create appointment — POST to external API
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
      const resp = await fetch(API_URL, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        // try to parse JSON error, fallback to text
        let err = null;
        try { err = await resp.json(); } catch (e) { err = { error: await resp.text() }; }
        console.error('API error', resp.status, err);
        toast({ title: 'Failed', description: err?.error || err?.message || `Server returned ${resp.status}`, status: 'error' });
        setLoadingCreate(false);
        return;
      }

      const body = await resp.json();
      const ticket = body?.appointment || body?.data || body?.appointment_data || null;
      if (!ticket) {
        toast({ title: 'API returned no appointment', status: 'error' });
        setLoadingCreate(false);
        return;
      }

      // Render PDF client-side for immediate download
      try {
        const doc = <AppointmentPdf ticket={{
          appointmentNumber: ticket.appointmentNumber || ticket.appointment_number,
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
          t1s: ticket.t1s || ticket.t1_records || [],
        }} />;

        const asPdf = pdfRender(doc);
        const blob = await asPdf.toBlob();
        downloadBlob(blob, `Appointment-${ticket.appointmentNumber || ticket.appointment_number || Date.now()}.pdf`);
      } catch (pdfErr) {
        console.error('PDF generation after API create failed', pdfErr);
        toast({ title: 'Appointment created', description: 'Saved but PDF generation failed', status: 'warning' });
      }

      toast({ title: 'Appointment created', description: `Appointment ${ticket.appointmentNumber || ticket.appointment_number} saved`, status: 'success' });

      // light stardust/confetti
      await triggerConfetti(160);

      // Reset form
      setAgentTin(''); setAgentName(''); setWarehouse(WAREHOUSES[0].value);
      setPickupDate(''); setConsolidated('N'); setTruckNumber(''); setDriverName(''); setDriverLicense(''); setT1s([]);
      setConfirmOpen(false);
      setOrbOpen(false);
    } catch (err) {
      console.error('Create appointment failed', err);
      toast({ title: 'Failed', description: err?.message || 'Unexpected error', status: 'error' });
    } finally {
      setLoadingCreate(false);
    }
  };

  const packingTypesUsed = useMemo(() => (t1s || []).map(t => t.packingType), [t1s]);

  // UI: when mobile show cards, else table
  const renderRecords = () => {
    if (t1s.length === 0) {
      return <Box p={6}><Text color="gray.600">No T1 records added yet.</Text></Box>;
    }

    if (isMobile) {
      return (
        <VStack spacing={3}>
          {t1s.map((r, i) => (
            <Box key={i} className="panel-card card-small panel-3d" width="100%">
              <Flex justify="space-between" align="start">
                <Box>
                  <Text fontWeight="bold">SAD: {r.sadNo}</Text>
                  <Text fontSize="sm" color="gray.600">Packing: {r.packingType}</Text>
                  {r.containerNo && <Text fontSize="sm" color="gray.600">Container: {r.containerNo}</Text>}
                </Box>
                <HStack spacing={2}>
                  <IconButton size="sm" icon={<EditIcon />} aria-label="Edit" onClick={() => openEditT1(i)} />
                  <IconButton size="sm" colorScheme="red" icon={<DeleteIcon />} aria-label="Remove" onClick={() => removeT1(i)} />
                </HStack>
              </Flex>
            </Box>
          ))}
        </VStack>
      );
    }

    // desktop table
    return (
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
          {t1s.map((r, i) => (
            <Tr key={i} className="panel-card">
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
    );
  };

  return (
    <Container maxW="container.lg" py={8} ref={containerRef}>
      <Heading mb={4}>Weighbridge Appointment — Self Service</Heading>

      <Box p={5} className="appt-glass" mb={6}>
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
              If <b>NO</b> only one T1 allowed. If <b>YES</b> multiple T1 allowed but each packing type only once.
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
          <Badge colorScheme="purple">{t1s.length} T1(s) added</Badge>
          {consolidated === 'Y' && (
            <Text fontSize="sm" color="gray.600">Packing types used: {packingTypesUsed.join(', ') || '—'}</Text>
          )}

          <HStack ml="auto" spacing={2}>
            <Button size="sm" leftIcon={<SearchIcon />} variant="ghost" onClick={() => { /* placeholder for quick search */ }}>
              Quick Search
            </Button>

            <Button size="sm" leftIcon={voiceActive ? <SmallCloseIcon /> : <RepeatIcon />} onClick={() => (voiceActive ? stopVoice() : startVoice())} colorScheme={voiceActive ? 'red' : 'teal'}>
              {voiceActive ? 'Stop Voice' : 'Voice'}
            </Button>
          </HStack>
        </HStack>

        <Box overflowX="auto" mb={4}>
          {renderRecords()}
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

      {/* Floating crystal orb CTA (opens T1 modal) */}
      <Box className="floating-orb" onClick={() => { setOrbOpen(true); setT1ModalOpen(true); }} role="button" aria-label="Add T1">
        <MotionBox
          className="orb"
          whileHover={{ scale: 1.08, rotate: 6 }}
          whileTap={{ scale: 0.96 }}
          animate={{ y: [0, -8, 0] }}
          transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
          title="Add T1"
        >
          <Box fontSize="22px" fontWeight="700">✺</Box>
        </MotionBox>
      </Box>

      {/* T1 Modal — cinematic holographic modal */}
      <Modal isOpen={isT1ModalOpen} onClose={closeT1Modal} isCentered size="md">
        <ModalOverlay bg="rgba(2,6,23,0.6)" />
        <AnimatePresence>
          {isT1ModalOpen && (
            <MotionBox
              initial={{ opacity: 0, y: 40, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 40, scale: 0.96 }}
            >
              <ModalContent bg="linear-gradient(180deg, rgba(255,255,255,0.95), rgba(255,255,255,0.85))" borderRadius="2xl" boxShadow="0 30px 80px rgba(2,6,23,0.12)">
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
            </MotionBox>
          )}
        </AnimatePresence>
      </Modal>

      {/* Confirm Modal */}
      <Modal isOpen={isConfirmOpen} onClose={closeConfirm} isCentered>
        <ModalOverlay />
        <ModalContent maxW="lg" borderRadius="lg" className="appt-glass">
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
                <Box overflowX="auto" mt={2}>
                  <Table size="sm">
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
