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

  qrArea: { marginTop: 14, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
  qrBox: { width: '34%', alignItems: 'center', marginRight: 28 },

  footerText: { fontSize: 8.5, textAlign: 'center', marginTop: 12, color: '#6b7280' },

  infoPill: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, backgroundColor: '#eef2ff', color: '#4338ca', fontSize: 9 },

  watermarkCenter: {
    position: 'absolute',
    left: '12.5%',   // shift slightly left so increased width remains centered
    top: '18%',      // moved slightly up
    width: '75%',    // increased by ~25% (from 60% -> 75%)
    opacity: 0.06,
  },
});

// ---------- Code128 patterns (widths) ----------
const CODE128_WIDTHS = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
  "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
  "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
  "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
  "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
  "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
  "314111","221411","431111","111224","111422","121224","121422","141122","141221","112214",
  "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
  "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
  "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
  "114131","311141","411131","211412"
];
const CODE128_STOP = "2331112";

// ---------- Helpers for Code128 ----------
function charCodeForCode128B(ch) {
  const code = ch.charCodeAt(0);
  if (code >= 32 && code <= 127) return code - 32;
  return '?'.charCodeAt(0) - 32;
}
function buildCode128CodesB(text) {
  const codes = [];
  const START_B = 104;
  codes.push(START_B);
  for (let i = 0; i < text.length; i++) {
    const cv = charCodeForCode128B(text[i]);
    codes.push(cv);
  }
  let sum = START_B;
  for (let i = 0; i < text.length; i++) {
    sum += (i + 1) * charCodeForCode128B(text[i]);
  }
  const check = sum % 103;
  codes.push(check);
  codes.push(106);
  return codes;
}
function codesToModuleWidths(codes) {
  const widths = [];
  const quiet = 10;
  widths.push(quiet);
  for (let i = 0; i < codes.length; i++) {
    const cv = codes[i];
    let wstr;
    if (cv === 106) {
      wstr = CODE128_STOP;
    } else {
      wstr = CODE128_WIDTHS[cv];
      if (!wstr) wstr = "111111";
    }
    for (let j = 0; j < wstr.length; j++) widths.push(Number(wstr.charAt(j)));
  }
  widths.push(10);
  const total = widths.reduce((s, v) => s + v, 0);
  return { widths, totalModules: total };
}

// ---------- Generate Code128 barcode as PNG data URL (draw to canvas) ----------
async function generateCode128DataUrl(payloadStr, width = 420, height = 72) {
  try {
    const codes = buildCode128CodesB(payloadStr);
    const { widths: moduleWidths, totalModules } = codesToModuleWidths(codes);
    const modulePx = width / totalModules;

    // create canvas
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width);
    canvas.height = Math.round(height);
    const ctx = canvas.getContext('2d');
    // white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // draw bars
    let x = 0;
    for (let i = 0; i < moduleWidths.length; i++) {
      const runUnits = moduleWidths[i];
      const runPx = runUnits * modulePx;
      const isBar = (i % 2) === 1;
      if (isBar) {
        ctx.fillStyle = '#000000';
        // draw full-height bar with a small top/bottom padding so it looks nice on paper
        const pad = Math.max(1, Math.floor(height * 0.06));
        ctx.fillRect(Math.round(x), pad, Math.ceil(runPx), Math.max(1, Math.floor(height - pad * 2)));
      }
      x += runPx;
    }

    // return PNG data URL
    return canvas.toDataURL('image/png');
  } catch (e) {
    console.error('generateCode128DataUrl failed', e);
    return null;
  }
}

// ---------- Utility functions (ensure defined to avoid ESLint no-undef) ----------
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

// ---------- PDF component (Barcode + watermark + beautiful layout) ----------
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
        {/* Watermark centered (moved up and increased size by 25%) */}
        <PdfImage src={logo} style={pdfStyles.watermarkCenter} />

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

          {/* Barcode area: moved slightly left by changing filler width and adding right margin on qrBox */}
          <PdfView style={pdfStyles.qrArea}>
            <PdfView style={{ width: '56%' }} />

            <PdfView style={pdfStyles.qrBox}>
              {t.barcodeImage ? (
                <PdfImage src={t.barcodeImage} style={{ width: 300, height: 68 }} />
              ) : (
                <PdfText style={{ fontSize: 9, color: '#6b7280' }}>Barcode not available</PdfText>
              )}
              <PdfText style={{ fontSize: 9, marginTop: 8, color: '#374151' }}>Scan barcode to read Appointment number</PdfText>
            </PdfView>
          </PdfView>
        </PdfView>

        <PdfView>
          <PdfText style={pdfStyles.footerText}>Generated by NICK TC-SCAN (GAMBIA) LTD. — Keep this ticket for audits. Scan the barcode for the appointment identifier.</PdfText>
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

  // T1 SAD check state
  const [t1SadStatus, setT1SadStatus] = useState(null); // null | 'checking' | 'found' | 'missing'
  const t1CheckTimer = useRef(null);

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
    setT1SadStatus(null);
    setT1ModalOpen(true);
  };
  const closeT1Modal = () => { setT1ModalOpen(false); setEditingIndex(null); setT1Sad(''); setT1Packing(PACKING_TYPES[0].value); setT1Container(''); setT1SadStatus(null); if (t1CheckTimer.current) clearTimeout(t1CheckTimer.current); };

  // live SAD existence check (debounced)
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

  // helper to assemble the full payload used for barcode and generate barcode image that encodes text
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

    // Build the payload text to encode in the barcode
    // **Changed**: encode ONLY the Appointment Number (plain text) so scanners show only that.
    const barcodePayload = String(ticket.appointmentNumber || '');

    // Generate Code128 barcode data URL (PNG)
    let barcodeDataUrl = null;
    try {
      barcodeDataUrl = await generateCode128DataUrl(barcodePayload, 420, 72);
    } catch (e) {
      console.warn('barcode generation failed', e);
      barcodeDataUrl = null;
    }

    ticket.barcodeImage = barcodeDataUrl;
    ticket.barcodePayload = barcodePayload; // optional for debugging
    return ticket;
  }

  // helpers for HTML escaping and base64 (not used for barcode but kept)

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

      // build printable ticket (includes barcode image)
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

      {/* T1 Modal — upgraded */}
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
