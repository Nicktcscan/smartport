// pages/appointment.jsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Box, Button, Container, Heading, Input as ChakraInput, Select, Text, SimpleGrid,
  FormControl, FormLabel, HStack, Stack, Table, Thead, Tbody, Tr, Th, Td,
  useToast, Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalFooter, ModalCloseButton,
  IconButton, Badge, Divider, VStack, useBreakpointValue, Flex
} from '@chakra-ui/react';
import { AddIcon, DeleteIcon, EditIcon, DownloadIcon, RepeatIcon, SearchIcon, SmallCloseIcon } from '@chakra-ui/icons';
import { motion, AnimatePresence } from 'framer-motion';
import { pdf as pdfRender, Document, Page, Text as PdfText, View as PdfView, StyleSheet, Image as PdfImage } from '@react-pdf/renderer';
import { supabase } from '../supabaseClient'; // ensure this file exists and exports a configured supabase client

// ----- Logos (ensure these files are in src/assets/) -----
import gralogo from '../assets/gralogo.png';
import gpalogo from '../assets/gpalogo.png';
import gnswlogo from '../assets/gnswlogo.png';

// ---------- Config ----------
const WAREHOUSES = [
  { value: 'WTGMBJLCON', label: 'WTGMBJLCON - GAMBIA PORTS AUTHORITY - P.O BOX 617 BANJUL BJ' },
];

const PACKING_TYPES = [
  { value: 'container', label: 'Container' },
  { value: 'bulk', label: 'Bulk' },
  { value: 'loose', label: 'Loose Cargo' },
];

const MotionBox = motion(Box);

// ---------- PDF styles (react-pdf) ----------
const pdfStyles = StyleSheet.create({
  page: {
    padding: 18,
    fontSize: 10.5,
    fontFamily: 'Helvetica',
    position: 'relative',
    color: '#111',
  },
  headerWrap: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  leftHeader: { width: '22%', alignItems: 'flex-start' },
  centerHeader: { width: '56%', alignItems: 'center', textAlign: 'center' },
  rightHeader: { width: '22%', alignItems: 'flex-end' },
  logoSmall: { width: 70, height: 40, objectFit: 'contain' },
  titleBig: { fontSize: 14, fontWeight: 700, marginBottom: 4 },
  subtitle: { fontSize: 9, color: '#222', marginBottom: 2 },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, marginBottom: 6 },
  twoCol: { flexDirection: 'row', justifyContent: 'space-between' },
  colLeft: { width: '48%' },
  colRight: { width: '48%' },
  fieldLabel: { fontSize: 9, fontWeight: 700 },
  fieldValue: { fontSize: 10, marginBottom: 2 },
  smallMuted: { fontSize: 8.5, color: '#666' },
  bigBadge: { fontSize: 10, fontWeight: '700', padding: 4, borderRadius: 4 },
  table: { width: '100%', borderTopWidth: 1, borderTopColor: '#CCC', marginTop: 6 },
  tableHeader: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#ccc', paddingVertical: 6, marginTop: 6 },
  tableRow: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 0, borderBottomColor: '#eee' },
  col1: { width: '8%', fontSize: 9 },
  col2: { width: '35%', fontSize: 9 },
  col3: { width: '22%', fontSize: 9 },
  col4: { width: '35%', fontSize: 9 },
  barcodeImg: { width: 260, height: 48, marginTop: 8, objectFit: 'cover', alignSelf: 'flex-start' },
  watermark: { position: 'absolute', left: -40, top: 100, width: 520, opacity: 0.06 },
  footer: { position: 'absolute', left: 18, right: 18, bottom: 22, fontSize: 9, color: '#222', borderTopWidth: 0.5, borderTopColor: '#eee', paddingTop: 8, flexDirection: 'row', justifyContent: 'space-between' },
  signatureBlock: { width: '48%', fontSize: 9 },
  sigLine: { marginTop: 18, borderTopWidth: 0.5, borderTopColor: '#222', paddingTop: 4, fontSize: 9 },
  metaSmall: { fontSize: 8.5, color: '#444' },
});

// ---------- Helpers ----------
function pad(num, length = 4) {
  const s = String(num || 0);
  return s.padStart(length, '0');
}

function generateBarcodeSvgDataUrl(value, width = 400, height = 70) {
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
    const hScale = 0.76 + (bits[(i + 7) % bits.length] ? 0.24 : 0);
    const bw = barWidth;
    if (bit) rects += `<rect x="${x}" y="${0}" width="${bw}" height="${Math.floor(height * hScale)}" fill="black"/>`;
    else rects += `<rect x="${x}" y="${0}" width="${Math.max(1, Math.floor(bw / 2))}" height="${Math.floor(height * 0.9)}" fill="black"/>`;
    x += bw;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="white" />
    ${rects}
    <text x="50%" y="${height - 6}" font-size="10" text-anchor="middle" fill="#222" font-family="monospace">${value}</text>
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
  // Use provided ticket data or default "example" values requested
  const t = ticket || {};
  const defaults = {
    ticketNo: '52517',
    dateTime: '24-Oct-25 9:48:17 AM',
    printDate: '24-Oct-25 9:48:26 AM',
    refCode: 'WCR3567C',
    gnswTruckNo: 'REPRINTED TICKET',
    printTimes: '2',
    manualTransaction: 'MANUAL TRANSACTION',
    trailerNo: 'unknown',
    wbRef: 'WB251006082',
    anpr: 'NO',
    weighbridgeId: 'WB251006082',
    gross: '88420 kg',
    consignee: 'No Name',
    operation: 'Received',
    tare: '(PT) 20920 kg',
    net: '67500 kg',
    driver: 'DEMBA CEESAY',
    consolidated: 'NO',
    truckOnWB: 'WCR3745D',
    sadNo: '22867',
    containerNo: 'BULK',
    material: 'No Material',
    scaleName: 'Manual?',
    passDetails: [
      { passNumber: '1', dateTime: '24-Oct-25 9:48:17 AM', operator: 'Bella', weight: '88420 kg', scale: 'WBRIDGE1', flagged: 'False' },
    ],
  };

  const data = {
    ticketNo: t.appointmentNumber || t.ticketNo || defaults.ticketNo,
    dateTime: t.dateTime || defaults.dateTime,
    printDate: t.printDate || defaults.printDate,
    refCode: t.refCode || defaults.refCode,
    gnswTruckNo: t.gnswTruckNo || defaults.gnswTruckNo,
    printTimes: t.printTimes || defaults.printTimes,
    manualTransaction: t.manualTransaction || defaults.manualTransaction,
    trailerNo: t.trailerNo || defaults.trailerNo,
    wbRef: t.weighbridgeNumber || t.wbRef || defaults.wbRef,
    anpr: t.anpr || defaults.anpr,
    weighbridgeId: t.weighbridgeId || defaults.weighbridgeId,
    gross: t.gross || defaults.gross,
    consignee: t.consignee || defaults.consignee,
    operation: t.operation || defaults.operation,
    tare: t.tare || defaults.tare,
    net: t.net || defaults.net,
    driver: t.driver || t.driverName || defaults.driver,
    consolidated: t.consolidated || defaults.consolidated,
    truckOnWB: t.truckOnWB || defaults.truckOnWB,
    sadNo: (t.t1s && t.t1s.length > 0 && (t.t1s[0].sadNo || t.t1s[0].sad_no)) || t.sadNo || defaults.sadNo,
    containerNo: (t.t1s && t.t1s.length > 0 && (t.t1s[0].containerNo || t.t1s[0].container_no)) || t.containerNo || defaults.containerNo,
    material: t.material || defaults.material,
    scaleName: t.scaleName || defaults.scaleName,
    passDetails: t.passDetails || defaults.passDetails,
  };

  const barcodeDataUrl = generateBarcodeSvgDataUrl(data.ticketNo || 'TICKET');

  return (
    <Document>
      <Page size="A4" style={pdfStyles.page}>
        {/* Watermark (GPA logo large & faint) */}
        <PdfImage src={gpalogo} style={pdfStyles.watermark} />

        {/* Header: left logo, center titles, right logo */}
        <PdfView style={pdfStyles.headerWrap}>
          <PdfView style={pdfStyles.leftHeader}>
            <PdfImage src={gralogo} style={pdfStyles.logoSmall} />
            <PdfText style={pdfStyles.smallMuted}>GAMBIA REVENUE AUTHORITY</PdfText>
          </PdfView>

          <PdfView style={pdfStyles.centerHeader}>
            <PdfText style={pdfStyles.titleBig}>GAMBIA REVENUE AUTHORITY</PdfText>
            <PdfText style={pdfStyles.subtitle}>Banjul Sea Port, Banjul, The Gambia</PdfText>
            <PdfText style={[pdfStyles.smallMuted, { marginTop: 6 }]}>WEIGHBRIDGE TICKET</PdfText>
          </PdfView>

          <PdfView style={pdfStyles.rightHeader}>
            <PdfImage src={gnswlogo} style={pdfStyles.logoSmall} />
            <PdfText style={pdfStyles.smallMuted}>GNSW</PdfText>
          </PdfView>
        </PdfView>

        {/* Top meta row */}
        <PdfView style={pdfStyles.sectionRow}>
          <PdfView style={pdfStyles.colLeft}>
            <PdfText style={pdfStyles.fieldLabel}>Ticket No.:</PdfText>
            <PdfText style={pdfStyles.fieldValue}>{data.ticketNo}</PdfText>

            <PdfText style={pdfStyles.fieldLabel}>Date Time.:</PdfText>
            <PdfText style={pdfStyles.fieldValue}>{data.dateTime}</PdfText>

            <PdfText style={pdfStyles.fieldLabel}>WEIGHBRIDGE TICKET Print Date:</PdfText>
            <PdfText style={pdfStyles.fieldValue}>{data.printDate}</PdfText>

            <PdfText style={pdfStyles.fieldLabel}>Ref Code:</PdfText>
            <PdfText style={pdfStyles.fieldValue}>{data.refCode}</PdfText>
          </PdfView>

          <PdfView style={pdfStyles.colRight}>
            <PdfText style={pdfStyles.fieldLabel}>GNSW Truck No.:</PdfText>
            <PdfText style={pdfStyles.fieldValue}>{data.gnswTruckNo}</PdfText>

            <PdfText style={pdfStyles.fieldLabel}>PRINT TIMES:</PdfText>
            <PdfText style={pdfStyles.fieldValue}>{data.printTimes}</PdfText>

            <PdfText style={pdfStyles.fieldLabel}>Transaction Type:</PdfText>
            <PdfText style={pdfStyles.fieldValue}>{data.manualTransaction}</PdfText>

            <PdfText style={pdfStyles.fieldLabel}>Trailer No.:</PdfText>
            <PdfText style={pdfStyles.fieldValue}>{data.trailerNo}</PdfText>
          </PdfView>
        </PdfView>

        <PdfView style={pdfStyles.sectionRow}>
          <PdfView style={pdfStyles.colLeft}>
            <PdfText style={pdfStyles.fieldLabel}>WB Reference:</PdfText>
            <PdfText style={pdfStyles.fieldValue}>{data.wbRef}</PdfText>

            <PdfText style={pdfStyles.fieldLabel}>ANPR:</PdfText>
            <PdfText style={pdfStyles.fieldValue}>{data.anpr}</PdfText>

            <PdfText style={pdfStyles.fieldLabel}>Weighbridge Id:</PdfText>
            <PdfText style={pdfStyles.fieldValue}>{data.weighbridgeId} — Gross: {data.gross}</PdfText>

            <PdfText style={pdfStyles.fieldLabel}>Consignee:</PdfText>
            <PdfText style={pdfStyles.fieldValue}>{data.consignee}</PdfText>
          </PdfView>

          <PdfView style={pdfStyles.colRight}>
            <PdfText style={pdfStyles.fieldLabel}>Operation:</PdfText>
            <PdfText style={pdfStyles.fieldValue}>{data.operation}</PdfText>

            <PdfText style={pdfStyles.fieldLabel}>Tare:</PdfText>
            <PdfText style={pdfStyles.fieldValue}>{data.tare}</PdfText>

            <PdfText style={pdfStyles.fieldLabel}>Net:</PdfText>
            <PdfText style={pdfStyles.fieldValue}>{data.net}</PdfText>

            <PdfText style={pdfStyles.fieldLabel}>Driver:</PdfText>
            <PdfText style={pdfStyles.fieldValue}>{data.driver}</PdfText>
          </PdfView>
        </PdfView>

        {/* Middle area: details & table */}
        <PdfView style={{ marginTop: 6 }}>
          <PdfView style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <PdfView style={{ width: '49%' }}>
              <PdfText style={pdfStyles.fieldLabel}>Consolidated:</PdfText>
              <PdfText style={pdfStyles.fieldValue}>{data.consolidated}</PdfText>

              <PdfText style={pdfStyles.fieldLabel}>Truck on WB:</PdfText>
              <PdfText style={pdfStyles.fieldValue}>{data.truckOnWB}</PdfText>

              <PdfText style={pdfStyles.fieldLabel}>SAD No.:</PdfText>
              <PdfText style={pdfStyles.fieldValue}>{data.sadNo}</PdfText>

              <PdfText style={pdfStyles.fieldLabel}>Container No.:</PdfText>
              <PdfText style={pdfStyles.fieldValue}>{data.containerNo}</PdfText>
            </PdfView>

            <PdfView style={{ width: '49%' }}>
              <PdfText style={pdfStyles.fieldLabel}>Material:</PdfText>
              <PdfText style={pdfStyles.fieldValue}>{data.material}</PdfText>

              <PdfText style={pdfStyles.fieldLabel}>Scale Name:</PdfText>
              <PdfText style={pdfStyles.fieldValue}>{data.scaleName}</PdfText>

              <PdfText style={pdfStyles.fieldLabel}>WB Ref / ID:</PdfText>
              <PdfText style={pdfStyles.fieldValue}>{data.weighbridgeId}</PdfText>
            </PdfView>
          </PdfView>

          {/* passes table */}
          <PdfView style={pdfStyles.table}>
            <PdfView style={pdfStyles.tableHeader}>
              <PdfText style={pdfStyles.col1}>#</PdfText>
              <PdfText style={pdfStyles.col2}>Date / Time</PdfText>
              <PdfText style={pdfStyles.col3}>Weight</PdfText>
              <PdfText style={pdfStyles.col4}>Operator / Scale</PdfText>
            </PdfView>

            {(data.passDetails || []).map((p, i) => (
              <PdfView key={i} style={pdfStyles.tableRow}>
                <PdfText style={pdfStyles.col1}>{p.passNumber}</PdfText>
                <PdfText style={pdfStyles.col2}>{p.dateTime}</PdfText>
                <PdfText style={pdfStyles.col3}>{p.weight}</PdfText>
                <PdfText style={pdfStyles.col4}>{p.operator} — {p.scale} — {String(p.flagged || '')}</PdfText>
              </PdfView>
            ))}
          </PdfView>
        </PdfView>

        {/* Barcode */}
        <PdfView style={{ marginTop: 10 }}>
          <PdfImage src={barcodeDataUrl} style={pdfStyles.barcodeImg} />
        </PdfView>

        {/* Footer / signatures */}
        <PdfView style={pdfStyles.footer}>
          <PdfView style={pdfStyles.signatureBlock}>
            <PdfText>Driver Signature ({data.driver}):</PdfText>
            <PdfText style={pdfStyles.sigLine}> </PdfText>
          </PdfView>

          <PdfView style={pdfStyles.signatureBlock}>
            <PdfText>Operator Signature (Bella/):</PdfText>
            <PdfText style={pdfStyles.sigLine}> </PdfText>
          </PdfView>
        </PdfView>

        {/* Bottom-small contact line */}
        <PdfView style={{ position: 'absolute', fontSize: 8.5, left: 18, right: 18, bottom: 6 }}>
          <PdfText>Call Centre Phone number : +2206111222  ·  http://www.nicktcscangambia.gm  ·  Email: info@nicktcscangambia.com</PdfText>
        </PdfView>
      </Page>
    </Document>
  );
}

// ---------- Main page component (unchanged except small wiring to include logos in pdf generation) ----------
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

  // T1 modal functions
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

  // --- Helper: generate appointment numbers using pickupDate and existing count (avoids relying on numeric DB id) ---
  async function generateNumbersUsingSupabase(pickupDateValue) {
    try {
      const { count } = await supabase
        .from('appointments')
        .select('id', { head: true, count: 'exact' })
        .eq('pickup_date', pickupDateValue);

      const existing = count || 0;
      const seq = existing + 1;
      const d = new Date(pickupDateValue);
      const YY = String(d.getFullYear()).slice(-2);
      const MM = String(d.getMonth() + 1).padStart(2, '0');
      const DD = String(d.getDate()).padStart(2, '0');
      const appointmentNumber = `${YY}${MM}${DD}${pad(seq, 4)}`;
      const weighbridgeNumber = `WB${YY}${MM}${pad(seq, 5)}`;
      return { appointmentNumber, weighbridgeNumber };
    } catch (e) {
      // fallback to random
      const d = new Date(pickupDateValue);
      const YY = String(d.getFullYear()).slice(-2);
      const MM = String(d.getMonth() + 1).padStart(2, '0');
      const DD = String(d.getDate()).padStart(2, '0');
      const rand = Math.floor(Math.random() * 9999) + 1;
      return { appointmentNumber: `${YY}${MM}${DD}${pad(rand, 4)}`, weighbridgeNumber: `WB${YY}${MM}${pad(rand, 5)}` };
    }
  }

  // Direct Supabase create (DB-only saving)
  const createDirectlyInSupabase = async (payload) => {
    if (!supabase) throw new Error('Supabase client not available.');

    const { appointmentNumber, weighbridgeNumber } = await generateNumbersUsingSupabase(payload.pickupDate || new Date().toISOString().slice(0, 10));

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

    const { data: inserted, error: insertErr } = await supabase
      .from('appointments')
      .insert([appointmentInsert])
      .select()
      .maybeSingle();

    if (insertErr || !inserted) {
      throw insertErr || new Error('Failed to insert appointment.');
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
  };

  // Create appointment — DB-only (no external API)
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
      // Direct DB write only
      const result = await createDirectlyInSupabase(payload);
      const ticket = result.appointment;

      // Build richer ticket object to feed the PDF renderer (include some of the sample fields you requested)
      const ticketForPdf = {
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
        consolidated: ticket.consolidated,
        t1s: ticket.t1s || [],
        // sample fields mapped to your requested display fields
        dateTime: new Date().toLocaleString(), // actual creation time
        printDate: new Date().toLocaleString(),
        refCode: 'WCR3567C',
        gnswTruckNo: 'REPRINTED TICKET',
        printTimes: '2',
        manualTransaction: 'MANUAL TRANSACTION',
        trailerNo: 'unknown',
        wbRef: ticket.weighbridgeNumber || 'WB251006082',
        anpr: 'NO',
        weighbridgeId: ticket.weighbridgeNumber || 'WB251006082',
        gross: (ticket.totalDocumentedWeight ? `${ticket.totalDocumentedWeight} kg` : '88420 kg'),
        consignee: 'No Name',
        operation: 'Received',
        tare: '(PT) 20920 kg',
        net: '67500 kg',
        driver: ticket.driverName || 'DEMBA CEESAY',
        consolidated: ticket.consolidated || 'NO',
        truckOnWB: 'WCR3745D',
        sadNo: (ticket.t1s && ticket.t1s[0] && (ticket.t1s[0].sadNo || ticket.t1s[0].sad_no)) || '22867',
        containerNo: (ticket.t1s && ticket.t1s[0] && (ticket.t1s[0].containerNo || ticket.t1s[0].container_no)) || 'BULK',
        material: 'No Material',
        scaleName: 'Manual?',
        passDetails: [
          { passNumber: '1', dateTime: new Date().toLocaleString(), operator: 'Bella', weight: (ticket.totalDocumentedWeight ? `${ticket.totalDocumentedWeight} kg` : '88420 kg'), scale: 'WBRIDGE1', flagged: 'False' },
        ],
      };

      // Render PDF client-side for immediate download
      try {
        const doc = <AppointmentPdf ticket={ticketForPdf} />;
        const asPdf = pdfRender(doc);
        const blob = await asPdf.toBlob();
        downloadBlob(blob, `WeighbridgeTicket-${ticketForPdf.appointmentNumber || Date.now()}.pdf`);
      } catch (pdfErr) {
        console.error('PDF generation after DB create failed', pdfErr);
        toast({ title: 'Appointment created', description: 'Saved but PDF generation failed', status: 'warning' });
      }

      toast({ title: 'Appointment created', description: `Appointment ${ticket.appointmentNumber || ticket.appointment_number} saved`, status: 'success' });

      // confetti
      await triggerConfetti(160);

      // Reset form
      setAgentTin(''); setAgentName(''); setWarehouse(WAREHOUSES[0].value);
      setPickupDate(''); setConsolidated('N'); setTruckNumber(''); setDriverName(''); setDriverLicense(''); setT1s([]);
      setConfirmOpen(false);
      setOrbOpen(false);
    } catch (err) {
      console.error('Create appointment (DB) failed', err);
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
