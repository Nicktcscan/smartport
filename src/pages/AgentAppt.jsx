// pages/appointment.jsx
import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Box, Button, Container, Heading, Input as ChakraInput, Select, Text, SimpleGrid,
  FormControl, FormLabel, HStack, Stack, Table, Thead, Tbody, Tr, Th, Td,
  useToast, Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalFooter, ModalCloseButton,
  IconButton, Badge, Divider, VStack, useBreakpointValue, Flex, InputGroup, InputRightElement, RadioGroup, Radio, Tooltip
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
import { supabase } from '../supabaseClient'; // ensure this file exists and exports a configured supabase client
import { useAuth } from '../context/AuthContext'; // <--- added

// ---------- Assets (ensure these exist in src/assets/) ----------
import gralogo from '../assets/gralogo.png';
import gnswlogo from '../assets/gnswlogo.png';
import logo from '../assets/logo.png'; // watermark image - ensure this file exists

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
    backgroundColor: '#f3f4f6',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },

  headerLeft: { width: '18%', alignItems: 'flex-start', zIndex: 2 },
  headerCenter: { width: '60%', alignItems: 'center', textAlign: 'center', zIndex: 2 },
  headerRight: { width: '18%', alignItems: 'flex-end', zIndex: 2 },

  logoSmall: { width: 72, height: 40, objectFit: 'contain' },
  titleBig: { fontSize: 16, fontWeight: 700, color: '#0b1220', letterSpacing: 0.6 },
  subtitle: { fontSize: 9, color: '#6b7280', marginTop: 2 },

  mainBox: { borderWidth: 0.6, borderColor: '#e6eef8', padding: 16, marginBottom: 12, position: 'relative', borderRadius: 10, zIndex: 3 },
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

  qrArea: { marginTop: 14, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
  qrBox: { width: '34%', alignItems: 'center', marginRight: 28, zIndex: 3 },

  barcodeContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 80,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },

  footerText: { fontSize: 8.5, textAlign: 'center', marginTop: 12, color: '#6b7280' },

  infoPill: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, backgroundColor: '#eef2ff', color: '#4338ca', fontSize: 9 },

  watermarkCenter: {
    position: 'absolute',
    left: '12.5%',
    top: '6%',
    width: '75%',
    opacity: 0.06,
    zIndex: 1,
  },
});

// ---------- New: Code39 generator using JsBarcode (reliable, proven library) ----------
async function ensureJsBarcodeLoaded() {
  if (typeof window === 'undefined') return;
  if (window.JsBarcode) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js';
    s.onload = () => resolve();
    s.onerror = (e) => reject(new Error('Failed to load JsBarcode'));
    document.head.appendChild(s);
  });
}

async function svgStringToPngDataUrl(svgString, width, height) {
  return await new Promise((resolve, reject) => {
    try {
      const img = new Image();
      const svg64 = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width);
        canvas.height = Math.round(height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        try {
          const png = canvas.toDataURL('image/png');
          resolve(png);
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = (err) => reject(err);
      img.src = svg64;
    } catch (e) {
      reject(e);
    }
  });
}

async function generateCode39DataUrl(payloadStr, width = 420, height = 48) {
  try {
    await ensureJsBarcodeLoaded();
    const svgNS = 'http://www.w3.org/2000/svg';
    const svgEl = document.createElementNS(svgNS, 'svg');
    window.JsBarcode(svgEl, String(payloadStr || ''), {
      format: 'CODE39',
      displayValue: false,
      height: height,
      width: 3,
      margin: 10,
      background: '#ffffff',
      lineColor: '#000000',
      flat: true,
    });
    const svgString = new XMLSerializer().serializeToString(svgEl);
    const pngDataUrl = await svgStringToPngDataUrl(svgString, width, height);
    return pngDataUrl;
  } catch (e) {
    console.error('generateCode39DataUrl failed', e);
    return null;
  }
}

function downloadBlob(blob, filename) {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'file.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error('downloadBlob failed', e);
  }
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
    console.warn('triggerConfetti failed', e);
  }
}

// ---------- PDF component ----------
function AppointmentPdf({ ticket }) {
  const t = ticket || {};
  const ticketData = {
    appointmentNumber: t.appointmentNumber || t.appointment_number || '',
    weighbridgeNumber: t.weighbridgeNumber || t.weighbridge_number || '',
    agentTin: t.agentTin || t.agent_tin || '',
    agentName: t.agentName || t.agent_name || '',
    warehouse: t.warehouseLabel || t.warehouse || '',
    pickupDate: t.pickupDate || t.pickup_date || '',
    consolidated: t.consolidated || t.consolidated || '',
    truckNumber: t.truckNumber || t.truck_number || '',
    driverName: t.driverName || t.driver_name || '',
    driverLicense: t.driverLicense || t.driver_license_no || '',
    t1Count: (t.t1s || []).length,
    packingTypesUsed: Array.isArray(t.t1s) ? Array.from(new Set(t.t1s.map(r => r.packingType || r.packing_type))).join(', ') : '',
    t1s: t.t1s || t.t1_records || [],
    createdAt: t.createdAt || t.created_at || '',
  };

  return (
    <Document>
      <Page size="A4" style={pdfStyles.page}>
        <PdfImage src={logo} style={pdfStyles.watermarkCenter} />

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
            <PdfView style={{ width: '48%', zIndex: 3 }}>
              <PdfText style={pdfStyles.label}>Appointment No :</PdfText>
              <PdfText style={pdfStyles.value}>{ticketData.appointmentNumber}</PdfText>

              <PdfText style={pdfStyles.label}>Weighbridge No :</PdfText>
              <PdfText style={pdfStyles.value}>{ticketData.weighbridgeNumber}</PdfText>

              <PdfText style={pdfStyles.label}>Agent :</PdfText>
              <PdfText style={pdfStyles.value}>{ticketData.agentName} — {ticketData.agentTin}</PdfText>
            </PdfView>

            <PdfView style={{ width: '48%', zIndex: 3 }}>
              <PdfText style={pdfStyles.label}>Warehouse :</PdfText>
              <PdfText style={pdfStyles.value}>{ticketData.warehouse}</PdfText>

              <PdfText style={pdfStyles.label}>Pick-up Date :</PdfText>
              <PdfText style={pdfStyles.value}>{ticketData.pickupDate}</PdfText>

              <PdfText style={pdfStyles.label}>Consolidated :</PdfText>
              <PdfText style={pdfStyles.value}>{ticketData.consolidated === 'Y' ? 'Consolidated' : 'Single'}</PdfText>
            </PdfView>
          </PdfView>

          <PdfView style={[pdfStyles.sectionRow, pdfStyles.groupBoxTopBorder]}>
            <PdfView style={{ width: '48%', zIndex: 3 }}>
              <PdfText style={pdfStyles.label}>Truck / Driver :</PdfText>
              <PdfText style={pdfStyles.value}>{ticketData.truckNumber} — {ticketData.driverName}</PdfText>
            </PdfView>

            <PdfView style={{ width: '48%', zIndex: 3 }}>
              <PdfText style={pdfStyles.label}>Driver License :</PdfText>
              <PdfText style={pdfStyles.value}>{ticketData.driverLicense}</PdfText>
            </PdfView>
          </PdfView>

          <PdfView style={pdfStyles.groupBoxTopBorder}>
            <PdfText style={[pdfStyles.label, { textAlign: 'left', zIndex: 3 }]}>T1 Records Summary :</PdfText>
            <PdfView style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, zIndex: 3 }}>
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
        </PdfView>

        <PdfView style={pdfStyles.barcodeContainer}>
          {t.barcodeImage ? (
            <PdfImage src={t.barcodeImage} style={{ width: 420, height: 48 }} />
          ) : (
            <PdfText style={{ fontSize: 9, color: '#6b7280' }}>Barcode not available</PdfText>
          )}
          <PdfText style={{ fontSize: 9, marginTop: 8, color: '#111827' }}>
            Appointment: {ticketData.appointmentNumber} {ticketData.weighbridgeNumber ? `  |  Weighbridge: ${ticketData.weighbridgeNumber}` : ''}
          </PdfText>
        </PdfView>

        <PdfView>
          <PdfText style={pdfStyles.footerText}>Generated by NICK TC-SCAN (GAMBIA) LTD. — Keep this ticket for audits. Scan the barcode for the appointment identifier(s).</PdfText>
        </PdfView>
      </Page>
    </Document>
  );
}

// ---------- Main page component ----------
export default function AppointmentPage() {
  const toast = useToast();
  const { user } = useAuth() || {}; // <--- added to capture logged-in user

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

  const [previewAppointmentNumber, setPreviewAppointmentNumber] = useState('');
  const [previewWeighbridgeNumber, setPreviewWeighbridgeNumber] = useState('');

  const [t1SadStatus, setT1SadStatus] = useState(null); // null | 'checking' | 'found' | 'missing'
  const t1CheckTimer = useRef(null);

  const [, setOrbOpen] = useState(false);

  const recognitionRef = useRef(null);
  const [voiceActive, setVoiceActive] = useState(false);

  const containerRef = useRef(null);
  const isMobile = useBreakpointValue({ base: true, md: false });

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
      .muted { color: #6b7280; font-size: 0.9rem; }
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
    setT1SadStatus(null);
    setT1ModalOpen(true);
  };
  const closeT1Modal = () => { setT1ModalOpen(false); setEditingIndex(null); setT1Sad(''); setT1Packing(PACKING_TYPES[0].value); setT1Container(''); setT1SadStatus(null); if (t1CheckTimer.current) clearTimeout(t1CheckTimer.current); };

  useEffect(() => {
    if (!isT1ModalOpen) return;
    if (!t1Sad || t1Sad.trim().length === 0) { setT1SadStatus(null); return; }
    setT1SadStatus('checking');
    if (t1CheckTimer.current) clearTimeout(t1CheckTimer.current);
    t1CheckTimer.current = setTimeout(async () => {
      try {
        const sadVal = t1Sad.trim();
        const { data, error } = await supabase.from('sad_declarations').select('sad_no').eq('sad_no', sadVal).maybeSingle();
        if (error) { setT1SadStatus(null); return; }
        setT1SadStatus(data ? 'found' : 'missing');
      } catch (e) {
        setT1SadStatus(null);
      }
    }, 650);
    return () => {
      if (t1CheckTimer.current) clearTimeout(t1CheckTimer.current);
    };
  }, [t1Sad, isT1ModalOpen]);

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

  const openConfirm = async () => {
    if (!validateMainForm()) return;

    try {
      const pickup = pickupDate || new Date().toISOString().slice(0, 10);
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

  async function generateUniqueNumbers(pickupDateValue) {
    const maxAttempts = 10;
    const d = new Date(pickupDateValue);
    const YY = String(d.getFullYear()).slice(-2);
    const MM = String(d.getMonth() + 1).padStart(2, '0');
    const DD = String(d.getDate()).padStart(2, '0');

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const { count } = await supabase
          .from('appointments')
          .select('id', { head: true, count: 'exact' })
          .eq('pickup_date', pickupDateValue);

        const existing = Number(count || 0);
        const seq = existing + 1 + attempt;
        const appointmentNumberBase = `${YY}${MM}${DD}${String(seq).padStart(4, '0')}`;
        const appointmentNumber = attempt === 0 ? appointmentNumberBase : `${appointmentNumberBase}${String(Math.floor(Math.random() * 900) + 100)}`;

        const weighbridgeBase = `WB${YY}${MM}${String(seq).padStart(5, '0')}`;
        const weighbridgeNumber = attempt === 0 ? weighbridgeBase : `${weighbridgeBase}${String(Math.floor(Math.random() * 900) + 100)}`;

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
      } catch (e) {
        console.warn('generateUniqueNumbers: check failed, falling back to timestamp', e);
        const ts = Date.now();
        return {
          appointmentNumber: `${YY}${MM}${DD}${ts}`,
          weighbridgeNumber: `WB${YY}${MM}${ts}`,
        };
      }
    }

    const ts2 = Date.now();
    return {
      appointmentNumber: `${YY}${MM}${DD}${ts2}${String(Math.floor(Math.random() * 900) + 100)}`,
      weighbridgeNumber: `WB${YY}${MM}${ts2}${String(Math.floor(Math.random() * 900) + 100)}`,
    };
  }

  async function generateNumbersUsingSupabase(pickupDateValue) {
    return await generateUniqueNumbers(pickupDateValue);
  }

  const createDirectlyInSupabase = async (payload) => {
    if (!supabase) throw new Error('Supabase client not available.');

    let attempts = 0;
    const maxInsertAttempts = 6;
    let lastErr = null;
    const useProvidedNumbers = Boolean(payload.appointmentNumber && payload.weighbridgeNumber);

    while (attempts < maxInsertAttempts) {
      attempts += 1;
      let appointmentNumber;
      let weighbridgeNumber;

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
        created_by: payload.createdBy || null, // <--- capture creator here
      };

      try {
        const { data: inserted, error: insertErr } = await supabase
          .from('appointments')
          .insert([appointmentInsert])
          .select()
          .maybeSingle();

        if (insertErr) {
          lastErr = insertErr;
          const msg = (insertErr && insertErr.message) ? insertErr.message.toLowerCase() : '';
          if (msg.includes('weighbridge_number') || msg.includes('appointment_number') || (insertErr.code && String(insertErr.code).includes('23505'))) {
            console.warn('Insert conflict on unique column, retrying generation...', insertErr);
            await new Promise(r => setTimeout(r, 120 + Math.random() * 200));
            continue;
          }
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
              created_by: appointmentInsert.created_by || null,
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
            created_by: fullAppointment.created_by || null,
          }
        };
      } catch (finalErr) {
        lastErr = finalErr;
        if (attempts >= maxInsertAttempts) {
          console.error('createDirectlyInSupabase: exhausted attempts', finalErr);
          throw finalErr;
        }
        console.warn('createDirectlyInSupabase: attempt failed, retrying', finalErr);
        await new Promise(r => setTimeout(r, 120 + Math.random() * 200));
        continue;
      }
    }

    throw lastErr || new Error('Could not create appointment (unknown error)');
  };

  async function buildPrintableTicketObject(dbAppointment) {
    const appointmentNum =
      dbAppointment.appointment_number ??
      dbAppointment.appointmentNumber ??
      dbAppointment.appointmentNo ??
      dbAppointment.appointment_no ??
      '';

    const weighbridgeNum =
      dbAppointment.weighbridge_number ??
      dbAppointment.weighbridgeNumber ??
      dbAppointment.weighbridge_no ??
      dbAppointment.weighbridge ??
      '';

    const ticket = {
      appointmentNumber: appointmentNum,
      weighbridgeNumber: weighbridgeNum,
      agentTin: dbAppointment.agent_tin || dbAppointment.agentTin || '',
      agentName: dbAppointment.agent_name || dbAppointment.agentName || '',
      warehouse: dbAppointment.warehouseLabel || dbAppointment.warehouse || dbAppointment.warehouse_location || '',
      pickupDate: dbAppointment.pickup_date || dbAppointment.pickupDate || '',
      consolidated: dbAppointment.consolidated || dbAppointment.consolidated || '',
      truckNumber: dbAppointment.truck_number || dbAppointment.truckNumber || '',
      driverName: dbAppointment.driver_name || dbAppointment.driverName || '',
      driverLicense: dbAppointment.driver_license_no || dbAppointment.driverLicense || '',
      t1s: dbAppointment.t1s || dbAppointment.t1_records || [],
      createdAt: dbAppointment.createdAt || dbAppointment.created_at || new Date().toISOString(),
    };

    const barcodePayload = weighbridgeNum ? `${appointmentNum}/${weighbridgeNum}` : String(appointmentNum || '');

    let barcodeDataUrl = null;
    try {
      barcodeDataUrl = await generateCode39DataUrl(barcodePayload, 420, 48);
    } catch (e) {
      console.warn('barcode generation failed', e);
      barcodeDataUrl = null;
    }

    ticket.barcodeImage = barcodeDataUrl;
    ticket.barcodePayload = barcodePayload;
    return ticket;
  }

  const handleCreateAppointment = async () => {
    if (!validateMainForm()) return;

    try {
      const rawSadList = (t1s || []).map(r => (r.sadNo || '').trim()).filter(Boolean);
      const uniqueSads = Array.from(new Set(rawSadList));
      if (uniqueSads.length === 0) {
        toast({ status: 'error', title: 'Please add at least one T1 record' });
        return;
      }

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
      appointmentNumber: previewAppointmentNumber || undefined,
      weighbridgeNumber: previewWeighbridgeNumber || undefined,
      t1s: t1s.map(r => ({ sadNo: r.sadNo, packingType: r.packingType, containerNo: r.containerNo || '' })),
      createdBy: user?.id || null, // <--- attach the currently logged-in user as creator
      warehouseLabelProvided: (WAREHOUSES.find(w => w.value === warehouse) || {}).label || warehouse,
    };

    try {
      const result = await createDirectlyInSupabase(payload);
      const dbAppointment = result.appointment;

      const printable = await buildPrintableTicketObject({
        appointmentNumber: dbAppointment.appointmentNumber || dbAppointment.appointment_number,
        weighbridgeNumber: dbAppointment.weighbridgeNumber || dbAppointment.weighbridge_number,
        agentTin: dbAppointment.agentTin || dbAppointment.agent_tin,
        agentName: dbAppointment.agentName || dbAppointment.agent_name,
        warehouse: dbAppointment.warehouseLabel || dbAppointment.warehouse_location || dbAppointment.warehouse,
        pickupDate: dbAppointment.pickupDate || dbAppointment.pickup_date,
        consolidated: dbAppointment.consolidated || dbAppointment.consolidated,
        truckNumber: dbAppointment.truckNumber || dbAppointment.truck_number,
        driverName: dbAppointment.driverName || dbAppointment.driver_name,
        driverLicense: dbAppointment.driverLicense || dbAppointment.driver_license_no,
        t1s: dbAppointment.t1s || dbAppointment.t1_records || [],
        createdAt: dbAppointment.createdAt || dbAppointment.created_at,
      });

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

      <Box p={6} className="appt-glass" mb={6} borderRadius="lg">
        <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
          <FormControl isRequired>
            <FormLabel>Agent TIN</FormLabel>
            <InputGroup>
              <ChakraInput value={agentTin} onChange={(e) => setAgentTin(e.target.value)} placeholder="Enter Agent TIN" />
              <InputRightElement width="4.5rem">
                <Tooltip label="Clear">
                  <IconButton size="sm" aria-label="clear" icon={<SmallCloseIcon />} variant="ghost" onClick={() => setAgentTin('')} />
                </Tooltip>
              </InputRightElement>
            </InputGroup>
            <Text className="muted" mt={1}>Company or taxpayer identification number</Text>
          </FormControl>

          <FormControl isRequired>
            <FormLabel>Agent Name</FormLabel>
            <ChakraInput value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="Agent / Company Name" />
            <Text className="muted" mt={1}>As printed on registration documents</Text>
          </FormControl>

          <FormControl isRequired>
            <FormLabel>Warehouse Location</FormLabel>
            <Select value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
              {WAREHOUSES.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
            </Select>
            <Text className="muted" mt={1}>Choose where the goods will be handled</Text>
          </FormControl>

          <FormControl isRequired>
            <FormLabel>Pick-up Date</FormLabel>
            <ChakraInput type="date" value={pickupDate} onChange={(e) => setPickupDate(e.target.value)} />
            <Text className="muted" mt={1}>Select the day the truck will visit the weighbridge</Text>
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

      <Modal isOpen={isT1ModalOpen} onClose={closeT1Modal} isCentered size="md">
        <ModalOverlay bg="rgba(2,6,23,0.6)" />
        <AnimatePresence>
          {isT1ModalOpen && (
            <MotionBox
              initial={{ opacity: 0, y: 40, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 40, scale: 0.98 }}
            >
              <ModalContent bg="linear-gradient(180deg, rgba(255,255,255,0.98), rgba(250,250,255,0.98))" borderRadius="2xl" boxShadow="0 30px 120px rgba(2,6,23,0.12)">
                <ModalHeader display="flex" alignItems="center" justifyContent="space-between">
                  <Box>{editingIndex !== null ? 'Edit T1 Record' : 'Add T1 Record'}</Box>
                  <Badge colorScheme={t1SadStatus === 'found' ? 'green' : t1SadStatus === 'checking' ? 'yellow' : t1SadStatus === 'missing' ? 'red' : 'gray'}>
                    {t1SadStatus === 'found' ? 'Registered' : t1SadStatus === 'checking' ? 'Checking...' : t1SadStatus === 'missing' ? 'Not found' : 'SAD status'}
                  </Badge>
                </ModalHeader>
                <ModalCloseButton />
                <ModalBody>
                  <Stack spacing={3}>
                    <FormControl isRequired>
                      <FormLabel>SAD No</FormLabel>
                      <InputGroup>
                        <ChakraInput value={t1Sad} onChange={(e) => setT1Sad(e.target.value)} placeholder="e.g. C26370" autoFocus />
                        <InputRightElement width="5.5rem">
                          <HStack spacing={2}>
                            <Tooltip label="Check now">
                              <IconButton size="sm" aria-label="check" icon={<SearchIcon />} variant="ghost" onClick={async () => {
                                setT1SadStatus('checking');
                                try {
                                  const sadVal = (t1Sad || '').trim();
                                  if (!sadVal) { setT1SadStatus(null); return; }
                                  const { data } = await supabase.from('sad_declarations').select('sad_no').eq('sad_no', sadVal).maybeSingle();
                                  setT1SadStatus(data ? 'found' : 'missing');
                                  if (!data) toast({ status: 'warning', title: 'SAD not registered', description: 'This SAD does not exist in the declarations table.' });
                                } catch (e) {
                                  setT1SadStatus(null);
                                }
                              }} />
                            </Tooltip>
                            <Tooltip label="Clear">
                              <IconButton size="sm" aria-label="clear" icon={<SmallCloseIcon />} variant="ghost" onClick={() => { setT1Sad(''); setT1SadStatus(null); }} />
                            </Tooltip>
                          </HStack>
                        </InputRightElement>
                      </InputGroup>
                      {t1SadStatus === 'found' && <Text color="green.600" mt={1}>SAD found in declarations.</Text>}
                      {t1SadStatus === 'missing' && <Text color="red.600" mt={1}>SAD not found — it must be registered before creating an appointment with it.</Text>}
                      {t1SadStatus === 'checking' && <Text color="yellow.600" mt={1}>Checking SAD existence...</Text>}
                    </FormControl>

                    <FormControl isRequired>
                      <FormLabel>Packing Type</FormLabel>
                      <RadioGroup onChange={setT1Packing} value={t1Packing}>
                        <HStack spacing={4}>
                          {PACKING_TYPES.map(p => (
                            <Radio key={p.value} value={p.value}>
                              {p.label}
                            </Radio>
                          ))}
                        </HStack>
                      </RadioGroup>
                    </FormControl>

                    {t1Packing === 'container' && (
                      <FormControl isRequired>
                        <FormLabel>Container No</FormLabel>
                        <ChakraInput value={t1Container} onChange={(e) => setT1Container(e.target.value)} placeholder="Container No (e.g. TEST1000001)" />
                        <Text className="muted" mt={1}>Enter container number. Accepts alphanumeric format.</Text>
                      </FormControl>
                    )}
                  </Stack>
                </ModalBody>

                <ModalFooter>
                  <Button onClick={closeT1Modal} mr={3}>Cancel</Button>
                  <Button colorScheme="teal" onClick={handleT1Save}>{editingIndex !== null ? 'Save' : <><AddIcon mr={2} /> Add</>}</Button>
                </ModalFooter>
              </ModalContent>
            </MotionBox>
          )}
        </AnimatePresence>
      </Modal>

      <Modal isOpen={isConfirmOpen} onClose={closeConfirm} isCentered>
        <ModalOverlay />
        <ModalContent maxW="lg" borderRadius="lg" className="appt-glass">
          <ModalHeader>Confirm Appointment</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Stack spacing={3}>
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
