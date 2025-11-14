// pages/appointment.jsx
import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Box, Button, Container, Heading, Input as ChakraInput, Select, Text, SimpleGrid,
  FormControl, FormLabel, HStack, Stack, Table, Thead, Tbody, Tr, Th, Td,
  useToast, Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalFooter, ModalCloseButton,
  IconButton, Badge, Divider, VStack, useBreakpointValue, Flex
} from '@chakra-ui/react';
import { AddIcon, DeleteIcon, EditIcon, DownloadIcon, RepeatIcon, SearchIcon, SmallCloseIcon } from '@chakra-ui/icons';
import { motion, AnimatePresence } from 'framer-motion';
import {
  pdf as pdfRender,
  Document,
  Page,
  Text as PdfText,
  View as PdfView,
  StyleSheet,
  Image as PdfImage,
  Font
} from '@react-pdf/renderer';
import QRCode from 'qrcode';
import { supabase } from '../supabaseClient'; // ensure this file exists and exports a configured supabase client

// ---------- Assets (ensure these exist in src/assets/) ----------
import gralogo from '../assets/gralogo.png';
import gnswlogo from '../assets/gnswlogo.png';

// ---------- Monospace font registration (update path if you use a different font file) ----------
import MonoFont from '../assets/RobotoMono-Regular.ttf'; // <-- ensure this file exists
Font.register({ family: 'Mono', src: MonoFont });

// ---------- Config ----------
const WAREHOUSES = [
  { value: 'WTGMBJLCON', label: 'WTGMBJLCON - GAMBIA PORTS AUTHORITY - P.O BOX 617 BANJUL BJ' },
];

const PACKING_TYPES = [
  { value: 'container', label: 'Container' },
  { value: 'bulk', label: 'Bulk' },
  { value: 'loose cargo', label: 'Loose Cargo' },
];

const MotionBox = motion(Box);

// ---------- PDF styles (premium look) ----------
const pdfStyles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingBottom: 36,
    paddingHorizontal: 24,
    fontSize: 10.5,
    fontFamily: 'Times-Roman',
    position: 'relative',
    color: '#0b1220',
    backgroundColor: '#ffffff',
  },

  headerBar: {
    backgroundColor: '#0f172a',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },

  headerLeft: { width: '18%', alignItems: 'flex-start' },
  headerCenter: { width: '60%', alignItems: 'center', textAlign: 'center' },
  headerRight: { width: '18%', alignItems: 'flex-end' },

  logoSmall: { width: 72, height: 40, objectFit: 'contain' },
  titleBig: { fontSize: 16, fontWeight: 700, color: '#fff', letterSpacing: 0.6 },
  subtitle: { fontSize: 9, color: '#d1d5db', marginTop: 2 },

  mainBox: { borderWidth: 0.6, borderColor: '#e6eef8', padding: 16, marginBottom: 12, position: 'relative', borderRadius: 10 },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },

  label: { fontSize: 10.5, fontFamily: 'Mono', fontWeight: 700, marginBottom: 2, color: '#0b1220' },
  value: { fontSize: 10.5, fontFamily: 'Times-Roman', marginBottom: 4, color: '#0b1220' },

  groupBoxTopBorder: { borderTopWidth: 0.8, borderTopColor: '#e6eef8', paddingTop: 10, marginTop: 10 },

  t1Table: { width: '100%', marginTop: 8, borderTopWidth: 0.5, borderTopColor: '#e6eef8' },
  t1HeaderRow: { flexDirection: 'row', borderBottomWidth: 0.6, borderBottomColor: '#e6eef8', paddingVertical: 6, backgroundColor: '#f8fafc' },
  t1Row: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 0.3, borderBottomColor: '#f1f5f9' },
  t1Col1: { width: '8%', fontSize: 10.5 },
  t1Col2: { width: '42%', fontSize: 10.5 },
  t1Col3: { width: '22%', fontSize: 10.5 },
  t1Col4: { width: '28%', fontSize: 10.5 },

  qrArea: { marginTop: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  qrBox: { width: '34%', alignItems: 'center' },

  footerText: { fontSize: 8.5, textAlign: 'center', marginTop: 12, color: '#6b7280' },

  infoPill: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, backgroundColor: '#eef2ff', color: '#4338ca', fontSize: 9 }
});

// ---------- PDF component (QR only + beautiful human-readable layout) ----------
function AppointmentPdf({ ticket }) {
  const t = ticket || {};
  const ticketData = {
    appointmentNumber: t.appointmentNumber || '',
    weighbridgeNumber: t.weighbridgeNumber || '',
    agentTin: t.agentTin || '',
    agentName: t.agentName || '',
    warehouse: t.warehouseLabel || t.warehouse || '',
    pickupDate: t.pickupDate || '',
    consolidated: t.consolidated || '',
    truckNumber: t.truckNumber || '',
    driverName: t.driverName || '',
    driverLicense: t.driverLicense || '',
    t1Count: (t.t1s || []).length,
    packingTypesUsed: Array.isArray(t.t1s) ? Array.from(new Set(t.t1s.map(r => r.packingType))).join(', ') : '',
    t1s: t.t1s || [],
    createdAt: t.createdAt || '',
  };

  return (
    <Document>
      <Page size="A4" style={pdfStyles.page}>
        {/* Header */}
        <PdfView style={pdfStyles.headerBar}>
          <PdfView style={pdfStyles.headerLeft}>
            <PdfImage src={gralogo} style={pdfStyles.logoSmall} />
          </PdfView>

          <PdfView style={pdfStyles.headerCenter}>
            <PdfText style={pdfStyles.titleBig}>NICK TC-SCAN (GAMBIA) LTD.</PdfText>
            <PdfText style={pdfStyles.subtitle}>Weighbridge Ticket — Official Appointment Document</PdfText>
          </PdfView>

          <PdfView style={pdfStyles.headerRight}>
            <PdfImage src={gnswlogo} style={pdfStyles.logoSmall} />
          </PdfView>
        </PdfView>

        <PdfView style={pdfStyles.mainBox}>
          <PdfView style={pdfStyles.sectionRow}>
            <PdfView style={{ width: '48%', zIndex: 1 }}>
              <PdfText style={pdfStyles.label}>Appointment No :</PdfText>
              <PdfText style={pdfStyles.value}>{ticketData.appointmentNumber}</PdfText>

              <PdfText style={pdfStyles.label}>Weighbridge No :</PdfText>
              <PdfText style={pdfStyles.value}>{ticketData.weighbridgeNumber}</PdfText>

              <PdfText style={pdfStyles.label}>Agent :</PdfText>
              <PdfText style={pdfStyles.value}>{ticketData.agentName} — {ticketData.agentTin}</PdfText>
            </PdfView>

            <PdfView style={{ width: '48%', zIndex: 1 }}>
              <PdfText style={pdfStyles.label}>Warehouse :</PdfText>
              <PdfText style={pdfStyles.value}>{ticketData.warehouse}</PdfText>

              <PdfText style={pdfStyles.label}>Pick-up Date :</PdfText>
              <PdfText style={pdfStyles.value}>{ticketData.pickupDate}</PdfText>

              <PdfText style={pdfStyles.label}>Consolidated :</PdfText>
              <PdfText style={pdfStyles.value}>{ticketData.consolidated === 'Y' ? 'Consolidated' : 'Single'}</PdfText>
            </PdfView>
          </PdfView>

          <PdfView style={[pdfStyles.sectionRow, pdfStyles.groupBoxTopBorder]}>
            <PdfView style={{ width: '48%', zIndex: 1 }}>
              <PdfText style={pdfStyles.label}>Truck / Driver :</PdfText>
              <PdfText style={pdfStyles.value}>{ticketData.truckNumber} — {ticketData.driverName}</PdfText>
            </PdfView>

            <PdfView style={{ width: '48%', zIndex: 1 }}>
              <PdfText style={pdfStyles.label}>Driver License :</PdfText>
              <PdfText style={pdfStyles.value}>{ticketData.driverLicense}</PdfText>
            </PdfView>
          </PdfView>

          <PdfView style={pdfStyles.groupBoxTopBorder}>
            <PdfText style={[pdfStyles.label, { textAlign: 'left', zIndex: 1 }]}>T1 Records Summary :</PdfText>
            <PdfView style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, zIndex: 1 }}>
              <PdfText style={pdfStyles.value}>Count : {ticketData.t1Count}</PdfText>
              <PdfText style={pdfStyles.value}>Packing types : {ticketData.packingTypesUsed || '—'}</PdfText>
            </PdfView>

            {ticketData.t1Count > 0 && (
              <PdfView style={pdfStyles.t1Table}>
                <PdfView style={pdfStyles.t1HeaderRow}>
                  <PdfText style={pdfStyles.t1Col1}>#</PdfText>
                  <PdfText style={pdfStyles.t1Col2}>SAD No</PdfText>
                  <PdfText style={pdfStyles.t1Col3}>Packing</PdfText>
                  <PdfText style={pdfStyles.t1Col4}>Container</PdfText>
                </PdfView>

                {ticketData.t1s.map((r, i) => (
                  <PdfView key={i} style={pdfStyles.t1Row}>
                    <PdfText style={pdfStyles.t1Col1}>{String(i + 1)}</PdfText>
                    <PdfText style={pdfStyles.t1Col2}>{r.sadNo || r.sad_no || '—'}</PdfText>
                    <PdfText style={pdfStyles.t1Col3}>{(r.packingType || r.packing_type || '—').toString()}</PdfText>
                    <PdfText style={pdfStyles.t1Col4}>{r.containerNo || r.container_no || '—'}</PdfText>
                  </PdfView>
                ))}
              </PdfView>
            )}
          </PdfView>

          {/* QR area (prominent) */}
          <PdfView style={pdfStyles.qrArea}>
            <PdfView style={{ width: '62%' }}>
              <PdfText style={[pdfStyles.label, { marginBottom: 6 }]}>Appointment Details (Human-friendly)</PdfText>

              {/* Small human-friendly table printed in the PDF as well */}
              <PdfView style={{ marginBottom: 8 }}>
                <PdfView style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <PdfText style={{ fontFamily: 'Mono', fontSize: 10, width: '30%' }}>Appointment</PdfText>
                  <PdfText style={{ fontSize: 10 }}>{ticketData.appointmentNumber}</PdfText>
                </PdfView>
                <PdfView style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <PdfText style={{ fontFamily: 'Mono', fontSize: 10, width: '30%' }}>Weighbridge</PdfText>
                  <PdfText style={{ fontSize: 10 }}>{ticketData.weighbridgeNumber}</PdfText>
                </PdfView>
                <PdfView style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <PdfText style={{ fontFamily: 'Mono', fontSize: 10, width: '30%' }}>Agent</PdfText>
                  <PdfText style={{ fontSize: 10 }}>{ticketData.agentName} ({ticketData.agentTin})</PdfText>
                </PdfView>
                <PdfView style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <PdfText style={{ fontFamily: 'Mono', fontSize: 10, width: '30%' }}>Warehouse</PdfText>
                  <PdfText style={{ fontSize: 10 }}>{ticketData.warehouse}</PdfText>
                </PdfView>
                <PdfView style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <PdfText style={{ fontFamily: 'Mono', fontSize: 10, width: '30%' }}>Pickup Date</PdfText>
                  <PdfText style={{ fontSize: 10 }}>{ticketData.pickupDate}</PdfText>
                </PdfView>
              </PdfView>

              <PdfText style={{ fontSize: 9, color: '#6b7280' }}>Scan the QR on the right with your phone to open a clean, readable appointment page (no JSON). Works offline — the QR encodes a tiny HTML page.</PdfText>
            </PdfView>

            <PdfView style={pdfStyles.qrBox}>
              {t.qrImage ? (
                <PdfImage src={t.qrImage} style={{ width: 140, height: 140 }} />
              ) : (
                <PdfText style={{ fontSize: 9, color: '#6b7280' }}>QR not available</PdfText>
              )}
              <PdfText style={{ fontSize: 9, marginTop: 6, color: '#374151' }}>{ticketData.appointmentNumber}</PdfText>
            </PdfView>
          </PdfView>
        </PdfView>

        <PdfView>
          <PdfText style={pdfStyles.footerText}>Generated by NICK TC-SCAN (GAMBIA) LTD. — Keep this ticket for audits. Scan the QR for a readable details page.</PdfText>
        </PdfView>
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

  // preview states for generated numbers (shown in confirm modal)
  const [previewAppointmentNumber, setPreviewAppointmentNumber] = useState('');
  const [previewWeighbridgeNumber, setPreviewWeighbridgeNumber] = useState('');

  // only need the setter (isOrbOpen was unused)
  const [, setOrbOpen] = useState(false);

  const recognitionRef = useRef(null);
  const [voiceActive, setVoiceActive] = useState(false);

  const containerRef = useRef(null);
  const isMobile = useBreakpointValue({ base: true, md: false });

  // utility UI highlights
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

  // voice command handler
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

  useEffect(() => {
    const id = 'appointment-page-styles';
    const css = `
      html, body, #root { background: #e6f6ff !important; }
      .appt-glass {
        background: linear-gradient(180deg, rgba(255,255,255,0.88), rgba(255,255,255,0.75));
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

  // Speech recognition setup
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
  }, );

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

  // Modified openConfirm: generate numbers, set preview, then open modal
  const openConfirm = async () => {
    if (!validateMainForm()) return;

    try {
      const pickup = pickupDate || new Date().toISOString().slice(0, 10);
      // generate preview numbers
      const { appointmentNumber, weighbridgeNumber } = await generateUniqueNumbers(pickup);
      setPreviewAppointmentNumber(appointmentNumber);
      setPreviewWeighbridgeNumber(weighbridgeNumber);
      setConfirmOpen(true);
    } catch (err) {
      console.error('Failed to generate preview numbers', err);
      try {
        const fallback = await generateNumbersUsingSupabase(pickupDate || new Date().toISOString().slice(0, 10));
        setPreviewAppointmentNumber(fallback.appointmentNumber);
        setPreviewWeighbridgeNumber(fallback.weighbridgeNumber);
        setConfirmOpen(true);
      } catch (e) {
        toast({ status: 'error', title: 'Could not generate appointment numbers', description: 'Please try again' });
      }
    }
  };
  const closeConfirm = () => {
    setConfirmOpen(false);
    setPreviewAppointmentNumber('');
    setPreviewWeighbridgeNumber('');
  };

  // --- New helper: generate unique numbers with checks ---
  async function generateUniqueNumbers(pickupDateValue) {
    // Returns { appointmentNumber, weighbridgeNumber }
    const maxAttempts = 10;
    const d = new Date(pickupDateValue);
    const YY = String(d.getFullYear()).slice(-2);
    const MM = String(d.getMonth() + 1).padStart(2, '0');
    const DD = String(d.getDate()).padStart(2, '0');

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Build base seq using count for that date (best-effort)
        const { count } = await supabase
          .from('appointments')
          .select('id', { head: true, count: 'exact' })
          .eq('pickup_date', pickupDateValue);

        const existing = Number(count || 0);
        const seq = existing + 1 + attempt; // add attempt to avoid repeating same seq if collision
        const appointmentNumberBase = `${YY}${MM}${DD}${String(seq).padStart(4, '0')}`;
        // add attempt-based suffix only when attempt>0 to help uniqueness
        const appointmentNumber = attempt === 0 ? appointmentNumberBase : `${appointmentNumberBase}${String(Math.floor(Math.random() * 900) + 100)}`;

        const weighbridgeBase = `WB${YY}${MM}${String(seq).padStart(5, '0')}`;
        const weighbridgeNumber = attempt === 0 ? weighbridgeBase : `${weighbridgeBase}${String(Math.floor(Math.random() * 900) + 100)}`;

        // check both uniqueness
        const { count: wbCount } = await supabase
          .from('appointments')
          .select('id', { head: true, count: 'exact' })
          .eq('weighbridge_number', weighbridgeNumber);

        const { count: apptCount } = await supabase
          .from('appointments')
          .select('id', { head: true, count: 'exact' })
          .eq('appointment_number', appointmentNumber);

        if ((Number(wbCount || 0) === 0) && (Number(apptCount || 0) === 0)) {
          return { appointmentNumber, weighbridgeNumber };
        }
        // else loop to try again
      } catch (e) {
        // if any error while checking, fallback to a timestamp + random and return it
        console.warn('generateUniqueNumbers: check failed, falling back to timestamp', e);
        const ts = Date.now();
        return {
          appointmentNumber: `${YY}${MM}${DD}${ts}`,
          weighbridgeNumber: `WB${YY}${MM}${ts}`,
        };
      }
    }

    // If exhausted attempts, fallback to timestamp + random
    const ts2 = Date.now();
    return {
      appointmentNumber: `${YY}${MM}${DD}${ts2}${String(Math.floor(Math.random() * 900) + 100)}`,
      weighbridgeNumber: `WB${YY}${MM}${ts2}${String(Math.floor(Math.random() * 900) + 100)}`,
    };
  }

  // eslint-disable-next-line no-unused-vars
  async function generateNumbersUsingSupabase(pickupDateValue) {
    // kept for backward compatibility – delegate to generateUniqueNumbers
    return await generateUniqueNumbers(pickupDateValue);
  }

  const createDirectlyInSupabase = async (payload) => {
    if (!supabase) throw new Error('Supabase client not available.');

    // generate unique appointment & weighbridge numbers (ensured unique by checking DB)
    let attempts = 0;
    const maxInsertAttempts = 6;
    let lastErr = null;
    const useProvidedNumbers = Boolean(payload.appointmentNumber && payload.weighbridgeNumber);

    while (attempts < maxInsertAttempts) {
      attempts += 1;
      let appointmentNumber;
      let weighbridgeNumber;

      // If the caller provided preview numbers, try them first (only on first attempt).
      if (useProvidedNumbers && attempts === 1) {
        appointmentNumber = payload.appointmentNumber;
        weighbridgeNumber = payload.weighbridgeNumber;
      } else {
        const nums = await generateUniqueNumbers(payload.pickupDate || new Date().toISOString().slice(0, 10));
        appointmentNumber = nums.appointmentNumber;
        weighbridgeNumber = nums.weighbridgeNumber;
      }

      const appointmentInsert = {
        appointment_number: appointmentNumber,
        weighbridge_number: weighbridgeNumber,
        agent_tin: payload.agentTin,
        agent_name: payload.agentName,
        warehouse_location: payload.warehouse,
        pickup_date: payload.pickupDate,
        consolidated: payload.consolidated || 'N',
        truck_number: payload.truckNumber,
        driver_name: payload.driverName,
        driver_license_no: payload.driverLicense,
        total_t1s: Array.isArray(payload.t1s) ? payload.t1s.length : 1,
        total_documented_weight: payload.totalDocumentedWeight || null,
        regime: payload.regime || null,
        barcode: null,
        pdf_url: null,
      };

      try {
        const { data: inserted, error: insertErr } = await supabase
          .from('appointments')
          .insert([appointmentInsert])
          .select()
          .maybeSingle();

        if (insertErr) {
          // If uniqueness constraint triggered, loop and try again with new numbers.
          lastErr = insertErr;
          const msg = (insertErr && insertErr.message) ? insertErr.message.toLowerCase() : '';
          if (msg.includes('weighbridge_number') || msg.includes('appointment_number') || (insertErr.code && String(insertErr.code).includes('23505'))) {
            // duplicate constraint — retry (and if we had used provided numbers, drop reliance on them next attempts)
            console.warn('Insert conflict on unique column, retrying generation...', insertErr);
            await new Promise(r => setTimeout(r, 120 + Math.random() * 200)); // small jitter
            continue;
          }
          // other error -> throw
          throw insertErr;
        }

        if (!inserted) {
          throw new Error('Failed to insert appointment.');
        }

        const appointmentId = inserted.id;

        const t1Rows = (payload.t1s || []).map((r) => ({
          appointment_id: appointmentId,
          sad_no: r.sadNo,
          packing_type: r.packingType,
          container_no: r.containerNo || null,
        }));

        if (t1Rows.length > 0) {
          const { error: t1Err } = await supabase.from('t1_records').insert(t1Rows);
          if (t1Err) {
            // roll back appointment insertion if t1 insert failed
            try { await supabase.from('appointments').delete().eq('id', appointmentId); } catch (_) {}
            throw t1Err;
          }
        }

        const { data: fullAppointment, error: fetchErr } = await supabase
          .from('appointments')
          .select('*, t1_records(*)')
          .eq('id', appointmentId)
          .maybeSingle();

        if (fetchErr || !fullAppointment) {
          // return a best-effort object
          return {
            appointment: {
              id: appointmentId,
              appointmentNumber,
              weighbridgeNumber,
              warehouse: appointmentInsert.warehouse_location,
              warehouseLabel: payload.warehouseLabel || appointmentInsert.warehouse_location,
              pickupDate: appointmentInsert.pickup_date,
              agentName: appointmentInsert.agent_name,
              agentTin: appointmentInsert.agent_tin,
              consolidated: appointmentInsert.consolidated,
              truckNumber: appointmentInsert.truck_number,
              driverName: appointmentInsert.driver_name,
              driverLicense: appointmentInsert.driver_license_no,
              regime: appointmentInsert.regime,
              totalDocumentedWeight: appointmentInsert.total_documented_weight,
              t1s: t1Rows.map(r => ({ sadNo: r.sad_no, packingType: r.packing_type, containerNo: r.container_no })),
              createdAt: inserted.created_at,
            }
          };
        }

        return {
          appointment: {
            id: fullAppointment.id,
            appointmentNumber: fullAppointment.appointment_number,
            weighbridgeNumber: fullAppointment.weighbridge_number,
            warehouse: fullAppointment.warehouse_location,
            warehouseLabel: payload.warehouseLabel || fullAppointment.warehouse_location,
            pickupDate: fullAppointment.pickup_date,
            agentName: fullAppointment.agent_name,
            agentTin: fullAppointment.agent_tin,
            consolidated: fullAppointment.consolidated,
            truckNumber: fullAppointment.truck_number,
            driverName: fullAppointment.driver_name,
            driverLicense: fullAppointment.driver_license_no,
            regime: fullAppointment.regime,
            totalDocumentedWeight: fullAppointment.total_documented_weight,
            t1s: (fullAppointment.t1_records || []).map((r) => ({ sadNo: r.sad_no, packingType: r.packing_type, containerNo: r.container_no })),
            createdAt: fullAppointment.created_at,
          }
        };
      } catch (finalErr) {
        lastErr = finalErr;
        // If we've exhausted attempts, throw
        if (attempts >= maxInsertAttempts) {
          console.error('createDirectlyInSupabase: exhausted attempts', finalErr);
          throw finalErr;
        }
        // otherwise loop to try again
        console.warn('createDirectlyInSupabase: attempt failed, retrying', finalErr);
        await new Promise(r => setTimeout(r, 120 + Math.random() * 200));
        continue;
      }
    }

    throw lastErr || new Error('Could not create appointment (unknown error)');
  };

  // helper to assemble the full payload used for QR and generate QR image that opens a human-friendly HTML page
  async function buildPrintableTicketObject(dbAppointment) {
    // dbAppointment = the object returned from DB/insert (may be partial)
    const ticket = {
      appointmentNumber: dbAppointment.appointmentNumber || dbAppointment.appointment_number || '',
      weighbridgeNumber: dbAppointment.weighbridgeNumber || dbAppointment.weighbridge_number || '',
      agentTin: dbAppointment.agentTin || dbAppointment.agent_tin || '',
      agentName: dbAppointment.agentName || dbAppointment.agent_name || '',
      warehouse: dbAppointment.warehouseLabel || dbAppointment.warehouse || '',
      pickupDate: dbAppointment.pickupDate || dbAppointment.pickup_date || '',
      consolidated: dbAppointment.consolidated || dbAppointment.consolidated || '',
      truckNumber: dbAppointment.truckNumber || dbAppointment.truck_number || '',
      driverName: dbAppointment.driverName || dbAppointment.driver_name || '',
      driverLicense: dbAppointment.driverLicense || dbAppointment.driver_license_no || '',
      t1s: dbAppointment.t1s || dbAppointment.t1_records || [],
      createdAt: dbAppointment.createdAt || dbAppointment.created_at || new Date().toISOString(),
    };

    // Build a small, elegant HTML page (inline styles) for the QR to open — human-readable table
    const smallHtml = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Appointment ${ticket.appointmentNumber}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    body{font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial; padding:18px; color:#0b1220;}
    .wrap{max-width:740px;margin:0 auto;background:#fff;padding:18px;border-radius:10px;box-shadow:0 6px 20px rgba(2,6,23,0.06);}
    h1{font-size:18px;margin:0 0 6px;color:#0f172a;}
    p.sub{color:#6b7280;margin:0 0 14px;font-size:13px;}
    table{width:100%;border-collapse:collapse;margin-top:12px;}
    td, th{padding:8px 10px;border-bottom:1px solid #eef2f7;text-align:left;font-size:13px;}
    th{background:#f8fafc;color:#111827;font-weight:700}
    .small{font-size:12px;color:#6b7280}
    .t1table{margin-top:14px}
    .pill{display:inline-block;padding:6px 10px;border-radius:999px;background:#eef2ff;color:#3730a3;font-weight:700;font-size:12px}
  </style>
</head>
<body>
  <div class="wrap">
    <h1>NICK TC-SCAN (GAMBIA) LTD. — Appointment</h1>
    <p class="sub">Appointment No: <strong>${escapeHtml(ticket.appointmentNumber)}</strong> &nbsp;&nbsp; Weighbridge: <strong>${escapeHtml(ticket.weighbridgeNumber)}</strong></p>
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">
      <div><span class="pill">Agent</span><div class="small">${escapeHtml(ticket.agentName)} (${escapeHtml(ticket.agentTin)})</div></div>
      <div><span class="pill">Warehouse</span><div class="small">${escapeHtml(ticket.warehouse)}</div></div>
      <div><span class="pill">Pickup</span><div class="small">${escapeHtml(ticket.pickupDate)}</div></div>
    </div>

    <table>
      <tr><th style="width:30%">Field</th><th>Value</th></tr>
      <tr><td>Truck</td><td>${escapeHtml(ticket.truckNumber)}</td></tr>
      <tr><td>Driver</td><td>${escapeHtml(ticket.driverName)}</td></tr>
      <tr><td>Driver License</td><td>${escapeHtml(ticket.driverLicense)}</td></tr>
      <tr><td>Consolidated</td><td>${ticket.consolidated === 'Y' ? 'Yes' : 'No'}</td></tr>
      <tr><td>Created At</td><td>${escapeHtml(ticket.createdAt)}</td></tr>
    </table>

    <div class="t1table">
      <h3 style="margin:12px 0 6px">T1 Records (${(ticket.t1s || []).length})</h3>
      <table>
        <tr><th>#</th><th>SAD No</th><th>Packing</th><th>Container</th></tr>
        ${(ticket.t1s || []).map((r, i) => `<tr><td>${i+1}</td><td>${escapeHtml(r.sadNo || r.sad_no || '')}</td><td>${escapeHtml(r.packingType || r.packing_type || '')}</td><td>${escapeHtml(r.containerNo || r.container_no || '')}</td></tr>`).join('')}
      </table>
    </div>

    <p style="margin-top:14px;font-size:12px;color:#6b7280">Show this QR to weighbridge staff or scan to open this page on your device.</p>
  </div>
</body>
</html>`.trim();

    // Build data URI using base64 encoding (more compatible)
    const base64Html = base64EncodeUnicode(smallHtml);
    const dataUri = `data:text/html;base64,${base64Html}`;

    // Generate QR image (PNG data URL) that encodes the data URI (so scanning opens the small HTML page)
    let qrDataUrl = null;
    try {
      qrDataUrl = await QRCode.toDataURL(dataUri, { margin: 1, scale: 8 });
    } catch (e) {
      console.warn('QR generation failed', e);
      // fallback: encode a compact JSON string if HTML QR fails
      try {
        const compact = JSON.stringify({
          appointmentNumber: ticket.appointmentNumber,
          weighbridgeNumber: ticket.weighbridgeNumber,
          agentName: ticket.agentName,
          pickupDate: ticket.pickupDate,
        });
        qrDataUrl = await QRCode.toDataURL(compact, { margin: 1, scale: 8 });
      } catch (ee) {
        qrDataUrl = null;
      }
    }

    ticket.qrImage = qrDataUrl;
    ticket.qrDataUri = dataUri; // optional: if you want to show or store the raw data URI elsewhere
    return ticket;
  }

  // helpers for HTML escaping and base64
  function escapeHtml(str = '') {
    return String(str || '').replace(/[&<>"']/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
    });
  }
  function base64EncodeUnicode(str) {
    // base64 encode Unicode safely
    try {
      return btoa(unescape(encodeURIComponent(str)));
    } catch (e) {
      // fallback - smaller inputs only
      return btoa(str);
    }
  }

  const handleCreateAppointment = async () => {
    if (!validateMainForm()) return;

    // verify all SADs exist in sad_declarations before creating appointment
    try {
      const rawSadList = (t1s || []).map(r => (r.sadNo || '').trim()).filter(Boolean);
      const uniqueSads = Array.from(new Set(rawSadList));
      if (uniqueSads.length === 0) {
        toast({ status: 'error', title: 'Please add at least one T1 record' });
        return;
      }

      // query sad_declarations for those SAD numbers
      const { data: existing, error: sadErr } = await supabase
        .from('sad_declarations')
        .select('sad_no')
        .in('sad_no', uniqueSads)
        .limit(1000);

      if (sadErr) {
        console.error('Error checking sad_declarations', sadErr);
        toast({ status: 'error', title: 'Unable to verify SADs', description: 'Could not validate SAD registration. Please try again or contact support.' });
        return;
      }

      const present = (existing || []).map(r => String(r.sad_no).trim());
      const missing = uniqueSads.filter(s => !present.includes(s));

      if (missing.length > 0) {
        toast({
          title: "This Appointment has an SAD that has not been registered. Kindly Contact App Support or Weighbridge Operators for assistance",
          description: `Missing SAD(s): ${missing.join(', ')}`,
          status: 'error',
          duration: 9000,
          isClosable: true,
        });
        return;
      }
    } catch (err) {
      console.error('SAD validation failed', err);
      toast({ status: 'error', title: 'Failed to verify SADs', description: err?.message || 'Unexpected error' });
      return;
    }

    // proceed to create
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
      // include preview numbers so createDirectlyInSupabase will try them first
      appointmentNumber: previewAppointmentNumber || undefined,
      weighbridgeNumber: previewWeighbridgeNumber || undefined,
      t1s: t1s.map(r => ({ sadNo: r.sadNo, packingType: r.packingType, containerNo: r.containerNo || '' })),
    };

    try {
      const result = await createDirectlyInSupabase(payload);
      const dbAppointment = result.appointment;

      // build printable ticket (includes QR image that opens a human-friendly HTML page)
      const printable = await buildPrintableTicketObject({
        appointmentNumber: dbAppointment.appointmentNumber || dbAppointment.appointment_number,
        weighbridgeNumber: dbAppointment.weighbridgeNumber || dbAppointment.weighbridge_number,
        agentTin: dbAppointment.agentTin || dbAppointment.agent_tin,
        agentName: dbAppointment.agentName || dbAppointment.agent_name,
        warehouse: dbAppointment.warehouseLabel || dbAppointment.warehouse_location,
        pickupDate: dbAppointment.pickupDate || dbAppointment.pickup_date,
        consolidated: dbAppointment.consolidated || dbAppointment.consolidated,
        truckNumber: dbAppointment.truckNumber || dbAppointment.truck_number,
        driverName: dbAppointment.driverName || dbAppointment.driver_name,
        driverLicense: dbAppointment.driverLicense || dbAppointment.driver_license_no,
        t1s: dbAppointment.t1s || dbAppointment.t1_records || [],
        createdAt: dbAppointment.createdAt || dbAppointment.created_at,
      });

      // generate PDF & download
      try {
        const doc = <AppointmentPdf ticket={printable} />;
        const asPdf = pdfRender(doc);
        const blob = await asPdf.toBlob();
        downloadBlob(blob, `WeighbridgeTicket-${printable.appointmentNumber || Date.now()}.pdf`);
      } catch (pdfErr) {
        console.error('PDF generation after DB create failed', pdfErr);
        toast({ title: 'Appointment created', description: 'Saved but PDF generation failed', status: 'warning' });
      }

      toast({ title: 'Appointment created', description: `Appointment saved`, status: 'success' });

      await triggerConfetti(160);

      setAgentTin(''); setAgentName(''); setWarehouse(WAREHOUSES[0].value);
      setPickupDate(''); setConsolidated('N'); setTruckNumber(''); setDriverName(''); setDriverLicense(''); setT1s([]);
      setConfirmOpen(false);
      setPreviewAppointmentNumber('');
      setPreviewWeighbridgeNumber('');
      setOrbOpen(false);
    } catch (err) {
      console.error('Create appointment (DB) failed', err);
      const message = err?.message || String(err);
      if (message.toLowerCase().includes('weighbridge_number') || message.toLowerCase().includes('appointment_number') || message.includes('duplicate')) {
        toast({
          title: 'Failed to create appointment — duplicate number',
          description: 'A generated appointment or weighbridge number already exists. Please retry. If this persists contact support.',
          status: 'error',
        });
      } else {
        toast({ title: 'Failed', description: message || 'Unexpected error', status: 'error' });
      }
    } finally {
      setLoadingCreate(false);
    }
  };

  const packingTypesUsed = useMemo(() => (t1s || []).map(t => t.packingType), [t1s]);

  const renderRecords = () => {
    if (t1s.length === 0) {
      return <Box p={6}><Text color="gray.600">No T1 records added yet.</Text></Box>;
    }
    if (isMobile) {
      return (
        <VStack spacing={3}>
          {t1s.map((r, i) => (
            <Box key={i} className="panel-card card-small" width="100%">
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
          <Button leftIcon={<AddIcon />} colorScheme="teal" onClick={() => { setT1ModalOpen(true); }}>Add T1 Record</Button>
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

      {/* T1 Modal */}
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
              {/* Generated numbers preview */}
              {previewAppointmentNumber && previewWeighbridgeNumber && (
                <Box border="1px solid" borderColor="gray.200" borderRadius="md" p={3} mb={2} bg="gray.50">
                  <Text fontWeight="bold" mb={2}>Generated Numbers (Preview)</Text>

                  <HStack mb={2} spacing={3}>
                    <Text fontWeight="semibold" minW="150px">Appointment No:</Text>
                    <Text color="blue.600" flex="1" wordBreak="break-all">{previewAppointmentNumber}</Text>
                    <Button size="xs" variant="outline" onClick={() => { navigator.clipboard.writeText(previewAppointmentNumber); toast({ status: 'success', title: 'Copied' }); }}>Copy</Button>
                  </HStack>

                  <HStack spacing={3}>
                    <Text fontWeight="semibold" minW="150px">Weighbridge No:</Text>
                    <Text color="blue.600" flex="1" wordBreak="break-all">{previewWeighbridgeNumber}</Text>
                    <Button size="xs" variant="outline" onClick={() => { navigator.clipboard.writeText(previewWeighbridgeNumber); toast({ status: 'success', title: 'Copied' }); }}>Copy</Button>
                  </HStack>
                </Box>
              )}

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
