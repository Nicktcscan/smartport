/* eslint-disable no-useless-escape */
/* eslint-disable no-dupe-keys */
/* eslint-disable react/jsx-no-undef */
// pages/AgentAppt.jsx
import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Box, Button, Container, Heading, Input as ChakraInput, Select, Text, SimpleGrid,
  FormControl, FormLabel, HStack, Stack, Table, Thead, Tbody, Tr, Th, Td,
  useToast, Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalFooter, ModalCloseButton,
  IconButton, Badge, Divider, VStack, useBreakpointValue, Flex, InputGroup, InputRightElement, RadioGroup, Radio, Tooltip,
  Image as ChakraImage, Spinner
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
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext'; // capture creating user

// ---------- Assets ----------
import gralogo from '../assets/gralogo.png';
import gnswlogo from '../assets/gnswlogo.png';
import logo from '../assets/logo.png';
import MonoFont from '../assets/RobotoMono-Regular.ttf';
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

// ---------- PDF styles ----------
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

// ---------- Barcode generator helpers ----------
async function ensureJsBarcodeLoaded() {
  if (typeof window === 'undefined') return;
  if (window.JsBarcode) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load JsBarcode'));
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

async function generateFallbackDataUrl(payloadStr, width = 420, height = 48) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width);
    canvas.height = Math.round(height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    const pad = 6;
    ctx.fillRect(pad, pad, canvas.width - pad * 2, canvas.height - pad * 2);
    ctx.fillStyle = '#fff';
    const fontSize = Math.max(10, Math.floor((canvas.height - pad * 2) * 0.35));
    ctx.font = `${fontSize}px monospace`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const txt = String(payloadStr || '').toUpperCase();
    ctx.fillText(txt, canvas.width / 2, canvas.height / 2);
    return canvas.toDataURL('image/png');
  } catch (e) {
    console.warn('generateFallbackDataUrl failed', e);
    return null;
  }
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
    if (pngDataUrl) return pngDataUrl;
    return await generateFallbackDataUrl(payloadStr, width, height);
  } catch (e) {
    console.warn('generateCode39DataUrl failed, falling back', e);
    try {
      return await generateFallbackDataUrl(payloadStr, width, height);
    } catch (ee) {
      console.error('generateCode39DataUrl fallback failed', ee);
      return null;
    }
  }
}

// ---------- Utilities ----------
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

// ---------- Phone normalization helper (auto-saves +220) ----------
function normalizePhone(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  // remove non-digits except leading +
  let digits = s.replace(/[^\d+]/g, '');
  // if it begins with '+' keep it, else strip non-digits
  if (digits.startsWith('+')) {
    digits = digits.slice(1).replace(/\D/g, '');
  } else {
    digits = digits.replace(/\D/g, '');
  }
  if (!digits) return '';
  // handle various forms:
  if (digits.startsWith('00220')) return `+${digits.slice(2)}`; // 00220...
  if (digits.startsWith('220')) return `+${digits}`; // 220...
  if (digits.startsWith('0')) {
    // local form: 0xxxxxxx -> drop 0 and prefix +220
    return `+220${digits.slice(1)}`;
  }
  // if length looks local (<=8 or 7) assume local number without 0 -> prefix +220
  if (digits.length <= 8) return `+220${digits}`;
  // otherwise if already has country but missing plus:
  return `+${digits}`;
}

// Auto-format phone for display while typing (adds +220 and spacing for Gambian numbers)
function formatPhoneForDisplay(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  // if user already types plus, show normalized
  const normalized = normalizePhone(s);
  if (!normalized) return s;
  // format +220 NNN NNNN or +220 NNN NNN
  if (normalized.startsWith('+220')) {
    const rest = normalized.slice(4); // after +220
    if (rest.length <= 3) return `+220 ${rest}`;
    if (rest.length <= 6) return `+220 ${rest.slice(0,3)} ${rest.slice(3)}`;
    // if more, split into groups of 3/4
    return `+220 ${rest.slice(0,3)} ${rest.slice(3,7)}${rest.length>7 ? ` ${rest.slice(7)}` : ''}`;
  }
  // fallback simple grouping
  return normalized;
}

// ---------- Truck normalization helper ----------
function normalizeTruckNumber(raw) {
  if (!raw && raw !== '') return '';
  try {
    return String(raw || '').replace(/\s+/g, '').toUpperCase();
  } catch (e) {
    return String(raw || '');
  }
}

// ---------- PDF component ----------
function AppointmentPdf({ ticket }) {
  const t = ticket || {};
  const ticketData = {
    appointmentNumber: t.appointmentNumber || t.appointment_number || t.appointmentNo || t.appointment_no || '',
    weighbridgeNumber: t.weighbridgeNumber || t.weighbridge_number || '',
    agentTin: t.agentTin || t.agent_tin || '',
    agentName: t.agentName || t.agent_name || '',
    warehouse: t.warehouseLabel || t.warehouse || t.warehouse_label || '',
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

              <PdfText style={pdfStyles.label}>Discharge Date :</PdfText>
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
              <PdfText style={pdfStyles.label}>Driver's Phone:</PdfText>
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
            Appointment: {ticketData.appointmentNumber}
            {ticketData.weighbridgeNumber ? `  |  Weighbridge: ${ticketData.weighbridgeNumber}` : ''}
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
export default function AgentApptPage() {
  const toast = useToast();
  const { user } = useAuth() || {}; // capture user to set created_by and logs

  // form state
  const [agentTin, setAgentTin] = useState('');
  const [agentName, setAgentName] = useState('');
  const [warehouse, setWarehouse] = useState(WAREHOUSES[0].value);
  const [pickupDate, setPickupDate] = useState('');
  const [consolidated, setConsolidated] = useState('N');
  const [truckNumber, setTruckNumber] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverLicense, setDriverLicense] = useState(''); // visible phone input (user may enter local number)

  const [t1s, setT1s] = useState([]);
  const [isT1ModalOpen, setT1ModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [t1Sad, setT1Sad] = useState('');
  const [t1Packing, setT1Packing] = useState(PACKING_TYPES[0].value);
  const [t1Container, setT1Container] = useState('');

  const [isConfirmOpen, setConfirmOpen] = useState(false);
  const [loadingCreate, setLoadingCreate] = useState(false);

  // sms sending states
  const [smsSending, setSmsSending] = useState(false);
  const [smsAttempts, setSmsAttempts] = useState(0);
  const [smsResult, setSmsResult] = useState(null);

  // preview states for generated numbers (shown in confirm modal)
  const [previewAppointmentNumber, setPreviewAppointmentNumber] = useState('');
  const [previewWeighbridgeNumber, setPreviewWeighbridgeNumber] = useState('');

  // T1 SAD check state
  const [t1SadStatus, setT1SadStatus] = useState(null); // null | 'checking' | 'found' | 'missing' | 'completed'
  const t1CheckTimer = useRef(null);

  // block creation if any of the selected SADs are already Completed (client safety)
  const [blockedSads, setBlockedSads] = useState([]); // list of SADs that are completed among selected T1s

  // only need the setter (isOrbOpen was unused)
  const [, setOrbOpen] = useState(false);

  const recognitionRef = useRef(null);
  const [voiceActive, setVoiceActive] = useState(false);

  const containerRef = useRef(null);
  const isMobile = useBreakpointValue({ base: true, md: false });

  // subscription ref so we can unsubscribe
  const sadSubRef = useRef(null);

  // ---------- NEW: driver registration/check states ----------
  const [driverRegistered, setDriverRegistered] = useState(false);
  const [, setFoundDriver] = useState(null);
  const [driverCheckStatus, setDriverCheckStatus] = useState(null); // null|'checking'|'exists'|'not_found'|'phone_taken'
  const driverCheckTimerRef = useRef(null);

  const [isDriverRegModalOpen, setDriverRegModalOpen] = useState(false);
  const [regName, setRegName] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regLicense, setRegLicense] = useState('');
  const [regPhotoFile, setRegPhotoFile] = useState(null);
  const [isRegisteringDriver, setIsRegisteringDriver] = useState(false);

  // promise resolver ref so ensureDriverRegistered can await registration
  const regPromiseRef = useRef(null);

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
      .sms-loading-hint { display:flex; align-items:center; gap:8px; font-size:0.95rem; color:#4a5568; }
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

    // use normalized truck value for validation (auto-remove spaces)
    const normalizedTruckForValidation = normalizeTruckNumber(truckNumber).trim();
    if (!normalizedTruckForValidation) { toast({ status: 'error', title: 'Truck Number required' }); return false; }

    if (!driverName.trim()) { toast({ status: 'error', title: 'Driver Name required' }); return false; }
    if (!driverLicense.trim()) { toast({ status: 'error', title: 'Driver Phone required' }); return false; }
    if (t1s.length === 0) { toast({ status: 'error', title: 'Please add at least one T1 record' }); return false; }
    if (consolidated === 'N' && t1s.length > 1) { toast({ status: 'error', title: 'Consolidated = N allows only one T1 record' }); return false; }
    if (blockedSads.length > 0) {
      toast({ status: 'error', title: 'Closed SAD(s) present', description: `SAD(s) ${blockedSads.join(', ')} are Completed — cannot create appointment.` });
      return false;
    }
    // also ensure we believe driver is registered
    if (!driverRegistered) {
      toast({ status: 'error', title: 'Driver not registered', description: 'Please ensure the driver is registered (it will prompt if not).' });
      return false;
    }
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
  const closeT1Modal = () => {
    setT1ModalOpen(false);
    setEditingIndex(null);
    setT1Sad('');
    setT1Packing(PACKING_TYPES[0].value);
    setT1Container('');
    setT1SadStatus(null);
    if (t1CheckTimer.current) clearTimeout(t1CheckTimer.current);
  };

  // live SAD existence & status check (debounced)
  useEffect(() => {
    if (!isT1ModalOpen) return;
    if (!t1Sad || t1Sad.trim().length === 0) { setT1SadStatus(null); return; }
    setT1SadStatus('checking');
    if (t1CheckTimer.current) clearTimeout(t1CheckTimer.current);
    t1CheckTimer.current = setTimeout(async () => {
      try {
        const sadVal = t1Sad.trim();
        const { data, error } = await supabase.from('sad_declarations').select('sad_no, status').eq('sad_no', sadVal).maybeSingle();
        if (error) { setT1SadStatus(null); return; }
        if (!data) {
          setT1SadStatus('missing');
        } else if (String(data.status).toLowerCase() === 'completed') {
          setT1SadStatus('completed');
        } else {
          setT1SadStatus('found');
        }
      } catch (e) {
        setT1SadStatus(null);
      }
    }, 650);
    return () => {
      if (t1CheckTimer.current) clearTimeout(t1CheckTimer.current);
    };
  }, [t1Sad, isT1ModalOpen]);

  const handleT1Save = async () => {
    if (!t1Sad.trim()) { toast({ status: 'error', title: 'SAD No required' }); return; }
    if (!t1Packing) { toast({ status: 'error', title: 'Packing Type required' }); return; }

    // check the SAD status server-side (final check)
    try {
      const sadVal = t1Sad.trim();
      const { data: sadRow, error } = await supabase.from('sad_declarations').select('sad_no, status').eq('sad_no', sadVal).maybeSingle();
      if (error) {
        toast({ status: 'warning', title: 'Could not verify SAD status' });
        return;
      }
      if (!sadRow) {
        toast({ status: 'error', title: 'SAD not registered', description: 'This SAD must be registered before adding.' });
        return;
      }
      if (String(sadRow.status).toLowerCase() === 'completed') {
        toast({ status: 'error', title: 'SAD already Completed', description: `SAD ${sadVal} is Completed and cannot be used.` });
        setBlockedSads((p) => Array.from(new Set([...p, sadVal])));
        return;
      }
    } catch (e) {
      console.warn('SAD server check failed', e);
      toast({ status: 'warning', title: 'SAD check failed' });
      return;
    }

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

  // ---------- NEW: driver name & phone check logic (debounced) ----------
  useEffect(() => {
    // watch driverName and attempt to auto-fill phone when exact match exists
    const nm = String(driverName || '').trim();
    if (!nm) {
      setDriverCheckStatus(null);
      setFoundDriver(null);
      setDriverRegistered(false);
      return;
    }

    setDriverCheckStatus('checking');
    if (driverCheckTimerRef.current) clearTimeout(driverCheckTimerRef.current);
    driverCheckTimerRef.current = setTimeout(async () => {
      try {
        // case-insensitive exact-ish match (use ilike)
        const { data, error } = await supabase
          .from('drivers')
          .select('*')
          .ilike('name', nm)
          .limit(2);

        if (error) {
          console.warn('driver name check error', error);
          setDriverCheckStatus(null);
          setFoundDriver(null);
          setDriverRegistered(false);
          return;
        }

        if (Array.isArray(data) && data.length === 1) {
          const drv = data[0];
          setFoundDriver(drv);
          setDriverRegistered(true);
          if (drv.phone) {
            setDriverLicense(drv.phone); // show stored normalized phone
          }
          setDriverCheckStatus('exists');
        } else {
          setFoundDriver(null);
          setDriverRegistered(false);
          setDriverCheckStatus('not_found');
        }
      } catch (e) {
        console.warn('driver name check failed', e);
        setDriverCheckStatus(null);
      }
    }, 700);

    return () => {
      if (driverCheckTimerRef.current) clearTimeout(driverCheckTimerRef.current);
    };
  }, [driverName]);

  useEffect(() => {
    // watch driverLicense (phone)
    const ph = String(driverLicense || '').trim();
    if (!ph) {
      setDriverCheckStatus(null);
      return;
    }

    setDriverCheckStatus('checking');
    if (driverCheckTimerRef.current) clearTimeout(driverCheckTimerRef.current);
    driverCheckTimerRef.current = setTimeout(async () => {
      try {
        const normalized = normalizePhone(ph);
        if (!normalized) { setDriverCheckStatus(null); return; }

        const { data, error } = await supabase
          .from('drivers')
          .select('*')
          .eq('phone', normalized)
          .maybeSingle();

        if (error) {
          console.warn('driver phone check error', error);
          setDriverCheckStatus(null);
          return;
        }

        if (data) {
          // found by phone
          const drv = data;
          setFoundDriver(drv);

          // Auto-populate name when driverName is empty (symmetry)
          if (!driverName || String(driverName).trim().length === 0) {
            if (drv.name) setDriverName(drv.name);
            setDriverRegistered(true);
            setDriverCheckStatus('exists');
            // ensure visible phone shows normalized stored version
            setDriverLicense(drv.phone || normalized);
          } else {
            // if a name is already typed and doesn't match the record -> block & inform
            if (String((drv.name || '').trim()).toLowerCase() !== String((driverName || '').trim()).toLowerCase()) {
              setDriverRegistered(false);
              setDriverCheckStatus('phone_taken');
              toast({
                status: 'error',
                title: 'Phone already registered',
                description: `This phone number belongs to "${drv.name}". Please use the registered phone or select the registered driver.`,
                duration: 8000,
              });
            } else {
              // names match (case-insensitive) -> OK
              setDriverRegistered(true);
              setDriverCheckStatus('exists');
              setDriverLicense(drv.phone || normalized);
            }
          }
        } else {
          // no driver with that phone
          setFoundDriver(null);
          setDriverRegistered(false);
          setDriverCheckStatus('not_found');
        }
      } catch (e) {
        console.warn('driver phone check failed', e);
        setDriverCheckStatus(null);
      }
    }, 700);

    return () => {
      if (driverCheckTimerRef.current) clearTimeout(driverCheckTimerRef.current);
    };
  }, [driverLicense, driverName, toast]);

  // ---------- helper run before opening Confirm: ensure driver registration ----------
  async function ensureDriverRegistered() {
    const name = String(driverName || '').trim();
    const phoneRaw = String(driverLicense || '').trim();
    if (!name || !phoneRaw) {
      toast({ status: 'error', title: 'Driver name & phone required', description: 'Please fill both driver name and phone number' });
      return { ok: false, reason: 'missing' };
    }

    const phone = normalizePhone(phoneRaw);
    if (!phone) {
      toast({ status: 'error', title: 'Invalid phone', description: 'Please enter a valid phone number' });
      return { ok: false, reason: 'invalid_phone' };
    }

    try {
      // check by phone first (normalized)
      const { data: byPhone, error: phoneErr } = await supabase.from('drivers').select('*').eq('phone', phone).maybeSingle();
      if (phoneErr) console.warn('ensureDriverRegistered phoneErr', phoneErr);

      if (byPhone) {
        // phone exists
        if (String((byPhone.name || '').trim()).toLowerCase() === name.toLowerCase()) {
          setFoundDriver(byPhone);
          setDriverRegistered(true);
          // ensure visible phone shows normalized
          setDriverLicense(byPhone.phone || phone);
          return { ok: true, driver: byPhone };
        }
        // phone used by another driver -> block
        setDriverCheckStatus('phone_taken');
        toast({ status: 'error', title: 'Phone already exists', description: 'This phone number exists for another driver — please use the registered driver.' });
        return { ok: false, reason: 'phone_taken' };
      }

      // no driver by phone; check name
      const { error: nameErr } = await supabase.from('drivers').select('*').ilike('name', name).limit(5);
      if (nameErr) console.warn('ensureDriverRegistered nameErr', nameErr);

      // prepare quick-register modal with normalized phone prefilled
      setRegName(name);
      setRegPhone(phone);
      setRegLicense('');
      setRegPhotoFile(null);

      // open modal and return a Promise that will resolve when registration completes or modal closed
      return await new Promise((resolve) => {
        regPromiseRef.current = resolve;
        setDriverRegModalOpen(true);
      });
    } catch (e) {
      console.error('ensureDriverRegistered failed', e);
      toast({ status: 'error', title: 'Driver check failed', description: 'Could not verify driver registration. Try again.' });
      return { ok: false, reason: 'error' };
    }
  }

  // ---------- quick register driver (from modal) with photo upload and license number ----------
  const registerDriverQuick = async () => {
    const name = String(regName || '').trim();
    const phoneRaw = String(regPhone || '').trim();
    const licenseNum = String(regLicense || '').trim();

    if (!name || !phoneRaw) {
      toast({ status: 'error', title: 'Name and Phone required' });
      return;
    }

    const phone = normalizePhone(phoneRaw);
    if (!phone) {
      toast({ status: 'error', title: 'Invalid phone', description: 'Please enter a valid phone number' });
      return;
    }

    setIsRegisteringDriver(true);

    try {
      // Attempt to upload photo first (if provided)
      let photoUrl = null;
      if (regPhotoFile) {
        try {
          const safeName = name.replace(/[^a-z0-9\-_\s]/gi, '').replace(/\s+/g, '-').toLowerCase().slice(0, 40);
          const ext = (regPhotoFile.name || '').split('.').pop() || 'jpg';
          const path = `drivers/${Date.now()}-${safeName}.${ext}`;
          const { error: uploadErr } = await supabase.storage.from('drivers').upload(path, regPhotoFile, { upsert: true, contentType: regPhotoFile.type });
          if (uploadErr) {
            console.warn('driver photo upload failed', uploadErr);
            toast({ status: 'warning', title: 'Photo upload failed', description: 'Driver will be created without photo.' });
          } else {
            try {
              const { data: urlData } = supabase.storage.from('drivers').getPublicUrl(path);
              photoUrl = urlData?.publicUrl || null;
            } catch (ee) {
              try {
                const { data: signedData } = await supabase.storage.from('drivers').createSignedUrl(path, 60 * 60);
                photoUrl = signedData?.signedUrl || null;
              } catch (e2) { /* ignore */ }
            }
          }
        } catch (e) {
          console.warn('photo upload flow threw', e);
        }
      }

      // Insert driver row (phone saved normalized)
      const payload = { name, phone, license_number: licenseNum || null, photo_url: photoUrl || null };
      const { data, error } = await supabase.from('drivers').insert([payload]).select().maybeSingle();

      if (error) {
        const msg = (error.message || '').toLowerCase();
        if ((error.code && String(error.code).includes('23505')) || msg.includes('duplicate') || msg.includes('unique')) {
          toast({ status: 'error', title: 'Phone already exists', description: 'That phone is already used by another driver.' });
          setIsRegisteringDriver(false);
          if (regPromiseRef.current) {
            regPromiseRef.current({ ok: false, reason: 'phone_taken' });
            regPromiseRef.current = null;
          }
          return;
        }
        throw error;
      }

      // success: close modal, set driver fields and resolve registration promise if waiting
      const created = data || null;
      setFoundDriver(created);
      setDriverRegistered(true);
      setDriverName(created?.name || name);
      setDriverLicense(created?.phone || phone);

      toast({ status: 'success', title: 'Driver registered', description: `${name} saved.` });
      try { await triggerConfetti(120); } catch (_) {}

      setDriverRegModalOpen(false);

      // resolve awaiting promise (if any)
      if (regPromiseRef.current) {
        regPromiseRef.current({ ok: true, driver: created });
        regPromiseRef.current = null;
      }
    } catch (e) {
      console.error('registerDriverQuick failed', e);
      toast({ status: 'error', title: 'Registration failed', description: e?.message || String(e) });
      if (regPromiseRef.current) {
        regPromiseRef.current({ ok: false, reason: 'error' });
        regPromiseRef.current = null;
      }
    } finally {
      setIsRegisteringDriver(false);
    }
  };

  // when modal is closed/cancelled by user
  const handleDriverRegModalClose = () => {
    setDriverRegModalOpen(false);
    // if someone is awaiting registration, resolve as cancelled
    if (regPromiseRef.current) {
      regPromiseRef.current({ ok: false, reason: 'cancelled' });
      regPromiseRef.current = null;
    }
  };

  // ---------------- existing generateUniqueNumbers, createDirectlyInSupabase etc remain but with openConfirm calling ensureDriverRegistered -------------
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

  // ---------- createDirectlyInSupabase (unchanged semantics) ----------
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

      // Build a Code39-safe barcode_payload to persist server-side
      const cleanApptForBarcode = String(appointmentNumber || '').toUpperCase().replace(/[^A-Z0-9\-\.\$\+%\/ ]/g, '');
      const cleanWbForBarcode = String(weighbridgeNumber || '').toUpperCase().replace(/[^A-Z0-9\-\.\$\+%\/ ]/g, '');
      const barcodePayload = cleanWbForBarcode ? `APPT${cleanApptForBarcode}/WB${cleanWbForBarcode}` : `APPT${cleanApptForBarcode}`;

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
        created_by: user?.id || null, // capture owner
        barcode_payload: barcodePayload, // <-- persist server-side
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

        // insert T1 rows
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

        // fetch full appointment with t1s
        const { data: fullAppointment, error: fetchErr } = await supabase
          .from('appointments')
          .select('*, t1_records(*)')
          .eq('id', appointmentId)
          .maybeSingle();

        if (fetchErr || !fullAppointment) {
          // even if fetch failed, return data based on inserted values (including barcode_payload)
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
              createdAt: inserted?.created_at || new Date().toISOString(),
              id: appointmentId,
              barcode_payload: appointmentInsert.barcode_payload || '',
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
            id: fullAppointment.id,
            barcode_payload: fullAppointment.barcode_payload || appointmentInsert.barcode_payload || '',
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

  // ---------- buildPrintableTicketObject (unchanged) ----------
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

    // Prefer server-side stored barcode_payload if available (this ensures DB <-> PDF validation)
    let barcodePayload = (dbAppointment.barcode_payload || dbAppointment.barcodePayload || '').trim();

    if (!barcodePayload) {
      const cleanAppt = String(appointmentNum || '').toUpperCase().replace(/[^A-Z0-9\-\.\$\+%\/ ]/g, '');
      const cleanWb = String(weighbridgeNum || '').toUpperCase().replace(/[^A-Z0-9\-\.\$\+%\/ ]/g, '');
      barcodePayload = cleanWb ? `APPT${cleanAppt}/WB${cleanWb}` : `APPT${cleanAppt}`;
    }

    let barcodeDataUrl = null;
    try {
      barcodeDataUrl = await generateCode39DataUrl(barcodePayload, 420, 48);
    } catch (e) {
      console.warn('barcode generation failed', e);
      barcodeDataUrl = null;
    }

    if (!barcodeDataUrl) {
      try {
        barcodeDataUrl = await generateFallbackDataUrl(barcodePayload, 420, 48);
      } catch (e) {
        console.warn('final barcode fallback failed', e);
        barcodeDataUrl = null;
      }
    }

    ticket.barcodeImage = barcodeDataUrl;
    ticket.barcodePayload = barcodePayload;
    return ticket;
  }

  // ---------- uploadPdfToStorage (unchanged) ----------
  async function uploadPdfToStorage(blob, appointmentNumber) {
    if (!blob) return { publicUrl: null, path: null };

    const bucketName = 'appointments';

    const filename = `WeighbridgeTicket-${appointmentNumber || `appt-${Date.now()}`}.pdf`;
    const path = `tickets/${filename}`;

    try {
      let fileForUpload;
      try {
        fileForUpload = new File([blob], filename, { type: 'application/pdf' });
      } catch (e) {
        const arrayBuffer = await blob.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuffer);
        fileForUpload = uint8;
      }

      try {
        const { error: uploadError } = await supabase.storage
          .from(bucketName)
          .upload(path, fileForUpload, { upsert: true, contentType: 'application/pdf' });

        if (uploadError) {
          console.warn('uploadPdfToStorage upload error', uploadError);
        }
      } catch (e) {
        console.warn('uploadPdfToStorage upload threw', e);
      }

      try {
        const getPub = await supabase.storage.from(bucketName).getPublicUrl(path);
        const publicUrl = getPub?.data?.publicUrl || getPub?.public_url || null;
        if (publicUrl) {
          return { publicUrl, path };
        }
      } catch (e) { /* ignore */ }

      try {
        const signedSeconds = 60 * 60;
        const { data: signedData, error: signedErr } = await supabase.storage.from(bucketName).createSignedUrl(path, signedSeconds);
        if (!signedErr && signedData?.signedUrl) {
          return { publicUrl: signedData.signedUrl, path };
        }
      } catch (e) { /* ignore */ }

      return { publicUrl: null, path };
    } catch (e) {
      console.warn('uploadPdfToStorage failed', e);
      return { publicUrl: null, path: null };
    }
  }

  // ---------- Try to call notify-appointment function (tries supabase.functions.invoke then fetch) ----------
  async function callNotifyFunction(body) {
    // Try supabase.functions.invoke where available
    try {
      if (supabase && typeof supabase.functions?.invoke === 'function') {
        // Some supabase client versions accept an object body, others require string.
        // We'll send stringified body for maximum compatibility.
        const res = await supabase.functions.invoke('notify-appointment', { body: JSON.stringify(body) });
        // Normalize return shape: many versions return { data, error } or the raw Response-like
        if (res?.error) return { ok: false, error: res.error };
        // If res has status and not ok, treat as error
        if (typeof res?.status === 'number' && res.status >= 400) {
          return { ok: false, error: res?.data ?? ('status ' + res.status) };
        }
        return { ok: true, data: res?.data ?? res };
      }
    } catch (e) {
      // if invoke fails, we'll fallback to fetch below
      console.warn('supabase.functions.invoke error (will fallback):', e);
    }

    // Fallback: direct fetch to functions path (uses anon key)
    try {
      const base = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
      if (!base) throw new Error('Missing VITE_SUPABASE_URL');
      const functionsUrl = `${base}/functions/v1/notify-appointment`;
      const anon = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

      const headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      if (anon) {
        headers.apikey = anon;
        // also send Authorization Bearer for servers expecting it
        headers.Authorization = `Bearer ${anon}`;
      }

      const resp = await fetch(functionsUrl, {
        method: 'POST',
        headers,
        // note: this will trigger preflight if Authorization is present - ensure server allows it
        body: JSON.stringify(body),
      });

      const text = await resp.text();
      let parsed;
      try { parsed = text ? JSON.parse(text) : null; } catch (e) { parsed = text; }

      if (!resp.ok) {
        return { ok: false, error: parsed || `status ${resp.status}` };
      }
      return { ok: true, data: parsed };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  // ---------- Notify with retry/backoff (uses callNotifyFunction) ----------
  async function notifyWithRetries(notifyBody, maxAttempts = 3) {
    setSmsSending(true);
    setSmsAttempts(0);
    setSmsResult(null);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      setSmsAttempts(attempt);
      toast({
        status: 'info',
        title: attempt === 1 ? 'Sending SMS' : `Retrying SMS (attempt ${attempt})`,
        description: attempt === 1 ? 'Notifying driver — sending SMS now.' : `Attempt ${attempt} to send SMS.`,
        duration: 3000,
      });

      try {
        const resp = await callNotifyFunction(notifyBody);
        if (resp && resp.ok) {
          setSmsResult({ ok: true, data: resp.data });
          toast({ status: 'success', title: 'SMS sent', description: 'Driver will receive appointment details shortly.' });
          setSmsSending(false);
          return { ok: true, data: resp.data };
        } else {
          const err = resp?.error || 'Unknown error';
          toast({ status: 'warning', title: `SMS attempt ${attempt} failed`, description: String(err).slice(0, 140), duration: 4000 });
          // exponential backoff
          const wait = 800 * Math.pow(2, attempt - 1);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
      } catch (e) {
        console.warn('notify attempt error', e);
        toast({ status: 'warning', title: `SMS attempt ${attempt} error`, description: String(e?.message || e), duration: 4000 });
        const wait = 800 * Math.pow(2, attempt - 1);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
    }

    setSmsSending(false);
    setSmsResult({ ok: false, error: 'All attempts failed' });
    toast({ status: 'error', title: 'SMS sending failed', description: 'All retry attempts failed. You can retry from the appointment details page.' });
    return { ok: false, error: 'exhausted' };
  }

  // ---------- Modified openConfirm: generate numbers, set preview, but ensure driver registered first ----------
  const openConfirm = async () => {
    // first run the driver registration/verification step (this will open modal and resolve automatically if needed)
    const drvCheck = await ensureDriverRegistered();
    if (!drvCheck.ok) {
      // ensureDriverRegistered already opened modal or showed toast with reason — stop
      return;
    }

    // Normalize truck number before validation to avoid user entering spaces only
    const normalizedTruckAhead = normalizeTruckNumber(truckNumber);
    if (!normalizedTruckAhead) {
      toast({ status: 'error', title: 'Truck Number required' });
      return;
    }
    // update visible field (UX) so preview shows normalized
    setTruckNumber(normalizedTruckAhead);

    if (!validateMainForm()) return;

    // final check: ensure none of the selected SADs are Completed
    const rawSadList = (t1s || []).map(r => (r.sadNo || '').trim()).filter(Boolean);
    const uniqueSads = Array.from(new Set(rawSadList));
    if (uniqueSads.length === 0) {
      toast({ status: 'error', title: 'Please add at least one T1 record' });
      return;
    }
    try {
      const { data: rows, error } = await supabase.from('sad_declarations').select('sad_no, status').in('sad_no', uniqueSads).limit(1000);
      if (error) throw error;
      const completed = (rows || []).filter(r => String(r.status).toLowerCase() === 'completed').map(r => r.sad_no);
      if (completed.length) {
        setBlockedSads(completed);
        toast({ status: 'error', title: 'Cannot create appointment', description: `SAD(s) ${completed.join(', ')} are Completed.` });
        return;
      }
    } catch (e) {
      console.warn('Final SAD check failed', e);
      toast({ status: 'warning', title: 'Could not verify all SAD statuses, try again' });
      return;
    }

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

  // ---------- handleCreateAppointment (modified to call notify edge function with retries) ----------
  const handleCreateAppointment = async () => {
    if (!validateMainForm()) return;

    // verify all SADs exist and not Completed
    try {
      const rawSadList = (t1s || []).map(r => (r.sadNo || '').trim()).filter(Boolean);
      const uniqueSads = Array.from(new Set(rawSadList));
      if (uniqueSads.length === 0) {
        toast({ status: 'error', title: 'Please add at least one T1 record' });
        return;
      }

      const { data: existing, error: sadErr } = await supabase
        .from('sad_declarations')
        .select('sad_no, status')
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

      const completed = (existing || []).filter(r => String(r.status).toLowerCase() === 'completed').map(r => r.sad_no);
      if (completed.length > 0) {
        setBlockedSads(completed);
        toast({ status: 'error', title: 'Some SADs are Completed', description: `SAD(s) ${completed.join(', ')} are already Completed and cannot be used.` });
        return;
      }
    } catch (err) {
      console.error('SAD validation failed', err);
      toast({ status: 'error', title: 'Failed to verify SADs', description: err?.message || 'Unexpected error' });
      return;
    }

    setLoadingCreate(true);

    // Normalize driver phone
    const normalizedDriverPhone = normalizePhone(String(driverLicense || '').trim());

    // Normalize truck number (remove all spaces and uppercase) and update UI
    const normalizedTruckNumber = normalizeTruckNumber(truckNumber);
    if (normalizedTruckNumber) {
      setTruckNumber(normalizedTruckNumber);
    }

    const payload = {
      warehouse,
      warehouseLabel: (WAREHOUSES.find(w => w.value === warehouse) || {}).label || warehouse,
      pickupDate,
      agentName: agentName.trim(),
      agentTin: agentTin.trim(),
      consolidated,
      truckNumber: normalizedTruckNumber, // store normalized truck number
      driverName: driverName.trim(),
      driverLicense: normalizedDriverPhone, // store normalized +220...
      regime: '',
      totalDocumentedWeight: '',
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
        warehouse: dbAppointment.warehouseLabel || dbAppointment.warehouse_location || dbAppointment.warehouse,
        pickupDate: dbAppointment.pickupDate || dbAppointment.pickup_date,
        consolidated: dbAppointment.consolidated || dbAppointment.consolidated,
        truckNumber: dbAppointment.truckNumber || dbAppointment.truck_number,
        driverName: dbAppointment.driverName || dbAppointment.driver_name,
        driverLicense: dbAppointment.driverLicense || dbAppointment.driver_license_no,
        t1s: dbAppointment.t1s || dbAppointment.t1_records || [],
        createdAt: dbAppointment.createdAt || dbAppointment.created_at,
        barcode_payload: dbAppointment.barcode_payload || dbAppointment.barcodePayload || '',
      });

      // generate PDF & download & upload
      let uploadedPdfUrl = null;
      try {
        const doc = <AppointmentPdf ticket={printable} />;
        const asPdf = pdfRender(doc);
        const blob = await asPdf.toBlob();

        // Download client-side for user convenience
        try {
          const filename = `WeighbridgeTicket-${printable.appointmentNumber || Date.now()}.pdf`;
          downloadBlob(blob, filename);
        } catch (e) {
          console.warn('download client-side failed', e);
        }

        // Try upload to Supabase storage (appointments bucket) and update appointment.pdf_url
        try {
          const { publicUrl, path } = await uploadPdfToStorage(blob, printable.appointmentNumber);
          if (publicUrl && dbAppointment.id) {
            uploadedPdfUrl = publicUrl;
            await supabase.from('appointments').update({ pdf_url: publicUrl }).eq('id', dbAppointment.id);
          } else if (path && dbAppointment.id) {
            uploadedPdfUrl = path;
            await supabase.from('appointments').update({ pdf_url: path }).eq('id', dbAppointment.id);
          }
        } catch (e) {
          console.warn('PDF storage/update failed', e);
        }
      } catch (pdfErr) {
        console.error('PDF generation after DB create failed', pdfErr);
        toast({ title: 'Appointment created', description: 'Saved but PDF generation failed', status: 'warning' });
      }

      // write appointment log
      try {
        await supabase.from('appointment_logs').insert([{
          appointment_id: dbAppointment.id,
          changed_by: user?.id || null,
          action: 'create',
          message: `Created appointment ${dbAppointment.appointmentNumber || dbAppointment.appointment_number}`,
          created_at: new Date().toISOString(),
        }]);
      } catch (e) { console.warn('log write failed', e); }

      // Inform user DB created
      toast({ title: 'Appointment created', description: `Appointment saved`, status: 'success' });

      // ---------- NEW: send SMS via Edge function with retries ----------
      try {
        // Build notify body
        const notifyBody = {
          appointment: {
            appointmentNumber: dbAppointment.appointmentNumber || dbAppointment.appointment_number,
            weighbridgeNumber: dbAppointment.weighbridgeNumber || dbAppointment.weighbridge_number,
            pickupDate: dbAppointment.pickupDate || dbAppointment.pickup_date,
            truckNumber: dbAppointment.truckNumber || dbAppointment.truck_number,
            driverName: dbAppointment.driverName || dbAppointment.driver_name,
            agentName: dbAppointment.agentName || dbAppointment.agent_name,
            agentTin: dbAppointment.agentTin || dbAppointment.agent_tin,
            id: dbAppointment.id,
            pdfUrl: uploadedPdfUrl || dbAppointment.pdf_url || null,
          },
          pdfBase64: null,
          pdfFilename: null,
          pdfUrl: uploadedPdfUrl || null,
          recipients: {
            driverPhone: normalizedDriverPhone,
            agentName: agentName || dbAppointment.agentName || ''
          }
        };

        // show a toast and loading indicator
        toast({ status: 'info', title: 'Sending SMS', description: 'Attempting to notify the driver via SMS...', duration: 2500 });

        const notifyResp = await notifyWithRetries(notifyBody, 3);
        // notifyWithRetries already shows toasts for success/failure

        if (notifyResp && notifyResp.ok) {
          // optionally update appointment with notify status (non-blocking)
          try {
            await supabase.from('appointments').update({ last_notification_status: 'sent', last_notification_response: notifyResp.data }).eq('id', dbAppointment.id);
          } catch (e) { /* ignore update failure */ }
        } else {
          try {
            await supabase.from('appointments').update({ last_notification_status: 'failed' }).eq('id', dbAppointment.id);
          } catch (e) {}
        }
      } catch (notifyErr) {
        console.warn('Notification flow failed', notifyErr);
        toast({ status: 'warning', title: 'Notification error', description: 'Appointment created but sending SMS failed.' });
      }

      await triggerConfetti(160);

      // reset UI
      setAgentTin(''); setAgentName(''); setWarehouse(WAREHOUSES[0].value);
      setPickupDate(''); setConsolidated('N'); setTruckNumber(''); setDriverName(''); setDriverLicense(''); setT1s([]);
      setConfirmOpen(false);
      setPreviewAppointmentNumber('');
      setPreviewWeighbridgeNumber('');
      setOrbOpen(false);
      setBlockedSads([]);
      setFoundDriver(null);
      setDriverRegistered(false);
      setDriverCheckStatus(null);
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
      setSmsSending(false);
      setSmsAttempts(0);
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

  // ---------- Subscription: listen to sad_declarations updates and close appointments when SAD completed ----------
  useEffect(() => {
    const subscribe = async () => {
      try {
        if (supabase.channel) {
          const ch = supabase.channel('client:sad-declarations-appointment-sync')
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sad_declarations' }, async (payload) => {
              const newRow = payload?.new;
              if (!newRow) return;
              const sadNo = String(newRow.sad_no || '').trim();
              const status = String(newRow.status || '').toLowerCase();
              if (status === 'completed') {
                // find related appointment ids via t1_records
                try {
                  const { data: trows, error: terr } = await supabase.from('t1_records').select('appointment_id').eq('sad_no', sadNo).limit(1000);
                  if (terr) throw terr;
                  const apptIds = Array.from(new Set((trows || []).map(r => r.appointment_id).filter(Boolean)));
                  if (apptIds.length) {
                    // update appointments status to Completed
                    const { error: upErr } = await supabase.from('appointments').update({ status: 'Completed', updated_at: new Date().toISOString() }).in('id', apptIds).neq('status', 'Completed');
                    if (upErr) throw upErr;

                    // log for each appointment
                    const logs = apptIds.map(id => ({
                      appointment_id: id,
                      changed_by: null,
                      action: 'sad_auto_close',
                      message: `SAD ${sadNo} marked Completed — appointment closed`,
                      created_at: new Date().toISOString(),
                    }));
                    try {
                      for (let i = 0; i < logs.length; i += 50) {
                        const chunk = logs.slice(i, i + 50);
                        await supabase.from('appointment_logs').insert(chunk);
                      }
                    } catch (e) { /* ignore logging errors */ }

                    toast({ title: 'SAD Completed', description: `SAD ${sadNo} is Completed — ${apptIds.length} appointment(s) closed.`, status: 'info', duration: 7000 });
                  }
                } catch (e) {
                  console.warn('Error closing appointments for SAD update', e);
                }
              }

              // if this SAD is in the current t1s, mark as blocked client-side
              try {
                const mySads = new Set((t1s || []).map(x => String(x.sadNo).trim()));
                if (mySads.has(sadNo) && status === 'completed') {
                  setBlockedSads(prev => Array.from(new Set([...prev, sadNo])));
                  toast({ status: 'error', title: 'SAD completed', description: `SAD ${sadNo} included in this appointment is now Completed and cannot be used.` });
                }
              } catch (e) { /* ignore */ }
            })
            .subscribe();

          sadSubRef.current = ch;
        } else {
          // legacy realtime
          const s = supabase.from('sad_declarations').on('UPDATE', async (payload) => {
            const newRow = payload?.new;
            if (!newRow) return;
            const sadNo = String(newRow.sad_no || '').trim();
            const status = String(newRow.status || '').toLowerCase();
            if (status === 'completed') {
              try {
                const { data: trows } = await supabase.from('t1_records').select('appointment_id').eq('sad_no', sadNo).limit(1000);
                const apptIds = Array.from(new Set((trows || []).map(r => r.appointment_id).filter(Boolean)));
                if (apptIds.length) {
                  await supabase.from('appointments').update({ status: 'Completed', updated_at: new Date().toISOString() }).in('id', apptIds).neq('status', 'Completed');
                }
              } catch (e) { console.warn(e); }
            }
            const mySads = new Set((t1s || []).map(x => String(x.sadNo).trim()));
            if (mySads.has(sadNo) && status === 'completed') {
              setBlockedSads(prev => Array.from(new Set([...prev, sadNo])));
              toast({ status: 'error', title: 'SAD completed', description: `SAD ${sadNo} included in this appointment is now Completed and cannot be used.` });
            }
          }).subscribe();
          sadSubRef.current = s;
        }
      } catch (e) {
        console.warn('subscribe to sad_declarations failed', e);
      }
    };

    subscribe();

    return () => {
      try {
        if (sadSubRef.current && supabase.removeChannel) {
          supabase.removeChannel(sadSubRef.current).catch(() => {});
        } else if (sadSubRef.current && sadSubRef.current.unsubscribe) {
          sadSubRef.current.unsubscribe();
        }
      } catch (e) { /* ignore */ }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t1s, user]);

  // ---------- rest of UI rendering ----------
  return (
    <Container maxW="container.lg" py={8} ref={containerRef}>
      <Heading mb={4}>Create Appointment</Heading>

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
            <FormLabel>Discharge Date</FormLabel>
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
            <ChakraInput
              value={truckNumber}
              onChange={(e) => setTruckNumber(e.target.value)}
              onBlur={() => {
                // normalize UI display (remove whitespace, uppercase)
                const norm = normalizeTruckNumber(truckNumber);
                if (norm) setTruckNumber(norm);
              }}
              placeholder="Truck Plate / No. e.g. BJL8392H"
            />
          </FormControl>

           <FormControl isRequired>
            <FormLabel>Driver Phone Number</FormLabel>
            <ChakraInput
              value={driverLicense}
              onChange={(e) => {
                // auto-format while typing for user-friendly display
                const raw = e.target.value || '';
                const formatted = formatPhoneForDisplay(raw);
                // but keep original when formatting fails to avoid overwriting
                setDriverLicense(formatted || raw);
              }}
              onBlur={() => {
                // ensure saved display uses normalized (E.164)
                const norm = normalizePhone(driverLicense);
                if (norm) setDriverLicense(norm);
              }}
              placeholder="e.g. 7701234 (we save as +220...)"
            />
            {/* Inline driver check status messages */}
            {driverCheckStatus === 'checking' && <Text color="yellow.600" mt={1}>Checking driver info…</Text>}
            {driverCheckStatus === 'exists' && <Text color="green.600" mt={1}>Driver found, you may proceed now!</Text>}
            {driverCheckStatus === 'not_found' && <Text color="orange.600" mt={1}>Driver not found — you'll be prompted to register this driver when you continue.</Text>}
            {driverCheckStatus === 'phone_taken' && <Text color="red.600" mt={1}>This phone number already exists for another driver — please use the registered phone or update the driver record.</Text>}
          </FormControl>

          <FormControl isRequired>
            <FormLabel>Driver Name</FormLabel>
            <ChakraInput value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="Driver full name" />
            <Text className="muted" mt={1}>Enter the full name of the driver (registered drivers will appear automatically).</Text>
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
            setBlockedSads([]);
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
                  <Badge colorScheme={t1SadStatus === 'found' ? 'green' : t1SadStatus === 'checking' ? 'yellow' : t1SadStatus === 'missing' ? 'red' : t1SadStatus === 'completed' ? 'red' : 'gray'}>
                    {t1SadStatus === 'found' ? 'Registered' : t1SadStatus === 'checking' ? 'Checking...' : t1SadStatus === 'missing' ? 'Not found' : t1SadStatus === 'completed' ? 'Completed' : 'SAD status'}
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
                                  const { data } = await supabase.from('sad_declarations').select('sad_no, status').eq('sad_no', sadVal).maybeSingle();
                                  if (!data) { setT1SadStatus('missing'); toast({ status: 'warning', title: 'SAD not registered', description: 'This SAD does not exist in the declarations table.' }); }
                                  else if (String(data.status).toLowerCase() === 'completed') { setT1SadStatus('completed'); }
                                  else { setT1SadStatus('found'); }
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
                      {t1SadStatus === 'completed' && <Text color="red.600" mt={1}>This SAD is already Completed and cannot be used.</Text>}
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

              {/* SMS sending hint */}
              {smsSending && (
                <Box className="sms-loading-hint" mt={2}>
                  <Spinner size="sm" /> <Text>Sending SMS to driver (attempt {smsAttempts})…</Text>
                </Box>
              )}
            </Stack>
          </ModalBody>
          <ModalFooter>
            <Button onClick={closeConfirm} mr={3}>Cancel</Button>
            <Button colorScheme="blue" leftIcon={<DownloadIcon />} onClick={handleCreateAppointment} isLoading={loadingCreate}>
              Confirm & Download Ticket
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Quick Register Driver Modal */}
      <Modal isOpen={isDriverRegModalOpen} onClose={handleDriverRegModalClose} isCentered>
        <ModalOverlay />
        <ModalContent maxW="md" borderRadius="lg">
          <ModalHeader>Register Driver</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Stack spacing={3}>
              <FormControl isRequired>
                <FormLabel>Driver Name</FormLabel>
                <ChakraInput value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="Full name" />
              </FormControl>

              <FormControl isRequired>
                <FormLabel>Phone</FormLabel>
                <ChakraInput value={regPhone} onChange={(e) => setRegPhone(e.target.value)} placeholder="e.g. 7701234 (we will save as +220...)" />
              </FormControl>

              <FormControl>
                <FormLabel>Driver License Number</FormLabel>
                <ChakraInput value={regLicense} onChange={(e) => setRegLicense(e.target.value)} placeholder="Licence No (optional but recommended)" />
                <Text className="muted" mt={1}>Optional: capture driver license number for records.</Text>
              </FormControl>

              <FormControl>
                <FormLabel>Photo (optional)</FormLabel>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files && e.target.files[0];
                    setRegPhotoFile(f || null);
                  }}
                />
                {regPhotoFile && (
                  <Box mt={2}>
                    <Text fontSize="sm">Selected: {regPhotoFile.name}</Text>
                    <ChakraImage src={URL.createObjectURL(regPhotoFile)} boxSize="90px" objectFit="cover" borderRadius="md" mt={2} alt="preview" />
                  </Box>
                )}
              </FormControl>
            </Stack>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={handleDriverRegModalClose} mr={3}>Cancel</Button>
            <Button colorScheme="teal" onClick={registerDriverQuick} isLoading={isRegisteringDriver}>Register Driver & Continue</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

    </Container>
  );
}
