// src/pages/WeightReports.jsx
import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Box,
  Container,
  Heading,
  Input as ChakraInput,
  Button,
  IconButton,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Text,
  useToast,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  useDisclosure,
  ModalFooter,
  Stack,
  Flex,
  Icon,
  SimpleGrid,
  HStack,
  VStack,
  FormControl,
  FormLabel,
  FormErrorMessage,
  AlertDialog,
  AlertDialogOverlay,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogBody,
  AlertDialogFooter,
  Spinner,
  Stat,
  StatLabel,
  StatNumber,
  StatHelpText,
  StatGroup,
  useBreakpointValue,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
} from '@chakra-ui/react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowForwardIcon } from '@chakra-ui/icons';
import {
  FaFileInvoice,
  FaFilePdf,
  FaExternalLinkAlt,
  FaShareAlt,
  FaEnvelope,
  FaUserTie,
  FaTruck,
  FaBox,
  FaBalanceScale,
  FaTrashAlt,
  FaEdit,
  FaCheck,
  FaRedo,
  FaFilter,
  FaSearch,
  FaTimes,
  FaEllipsisV,
  FaFileCsv,
  FaSort,
  FaSortUp,
  FaSortDown,
  FaMicrophone,
  FaMicrophoneSlash,
} from 'react-icons/fa';

import { supabase } from '../supabaseClient';
import {
  Document,
  Page,
  Text as PdfText,
  View as PdfView,
  StyleSheet,
  pdf as pdfRender,
  Image as PdfImage,
} from '@react-pdf/renderer';

const MotionModalContent = motion.create(ModalContent);

// =======================================
// PDF styles (with borders for vertical + horizontal lines)
// =======================================
const pdfStyles = StyleSheet.create({
  page: {
    paddingTop: 18,
    paddingBottom: 36,
    paddingHorizontal: 18,
    fontSize: 9,
    fontFamily: 'Helvetica',
    display: 'flex',
    flexDirection: 'column',
    color: '#071126',
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  companyBlock: { flexDirection: 'column', marginLeft: 8 },
  companyName: { fontSize: 13, fontWeight: 'bold', color: '#071126' },
  reportTitle: {
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
    color: '#071126',
  },
  summaryBox: {
    marginBottom: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#e6eef8',
    backgroundColor: '#fbfdff',
    borderRadius: 6,
  },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },

  tableOuter: { borderWidth: 1, borderColor: '#dbeafe', borderRadius: 4, overflow: 'hidden', marginBottom: 6 },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#eef2ff',
    borderBottomWidth: 1,
    borderBottomColor: '#dbeafe',
    alignItems: 'center',
    paddingVertical: 6,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    alignItems: 'center',
    paddingVertical: 6,
  },

  cellBase: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRightWidth: 1,
    borderRightColor: '#e6eef8',
  },

  // Adjusted columns to include Created By
  colTicket: { width: '12%', fontSize: 8 },
  colTruck: { width: '14%', fontSize: 8 },
  colDate: { width: '16%', fontSize: 8 },
  colGross: { width: '10%', textAlign: 'right', fontSize: 8, paddingRight: 4 },
  colTare: { width: '10%', textAlign: 'right', fontSize: 8, paddingRight: 4 },
  colNet: { width: '10%', textAlign: 'right', fontSize: 8, paddingRight: 4 },
  colDriver: { width: '14%', fontSize: 8, paddingLeft: 4 },
  colCreated: { width: '14%', fontSize: 8, paddingLeft: 4 },

  footer: { position: 'absolute', bottom: 12, left: 18, right: 18, textAlign: 'center', fontSize: 9, color: '#666' },
  logo: { width: 64, height: 64, objectFit: 'contain' },
});

// =======================================
// Helpers
// =======================================
function numericValue(v) {
  if (v === null || v === undefined || v === '') return null;
  const cleaned = String(v).replace(/[,\s]+/g, '').replace(/kg/i, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
function formatNumber(v) {
  const n = numericValue(v);
  if (n === null) return '';
  return Number.isInteger(n) ? n.toLocaleString('en-US') : Number(n.toFixed(2)).toLocaleString('en-US');
}
function computeWeightsFromObj({ gross, tare, net }) {
  let G = numericValue(gross);
  let T = numericValue(tare);
  let N = numericValue(net);

  if ((G === null || G === undefined) && T !== null && N !== null) G = T + N;
  if ((N === null || N === undefined) && G !== null && T !== null) N = G - T;
  if ((T === null || T === undefined) && G !== null && N !== null) T = G - N;

  return {
    grossValue: G !== null && G !== undefined ? G : null,
    tareValue: T !== null && T !== undefined ? T : null,
    netValue: N !== null && N !== undefined ? N : null,
    grossDisplay: G !== null && G !== undefined ? formatNumber(G) : '',
    tareDisplay: T !== null && T !== undefined ? formatNumber(T) : '',
    netDisplay: N !== null && N !== undefined ? formatNumber(N) : '',
  };
}

/**
 * parseTicketDate (robust)
 */
function parseTicketDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === 'number') {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }
  const s0 = String(raw).trim();
  if (s0 === '') return null;

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s0)) {
    const d = new Date(`${s0}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }

  // ISO-like with time 'YYYY-MM-DD HH:MM:SS' or with milliseconds
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s0)) {
    // convert ' ' to 'T' for Date parsing
    const iso = s0.replace(' ', 'T');
    const d = new Date(iso);
    if (!isNaN(d.getTime())) return d;

    // fallback: remove milliseconds and parse
    const withoutMs = s0.replace(/\.\d+$/, '');
    const iso2 = withoutMs.replace(' ', 'T');
    const d2 = new Date(iso2);
    if (!isNaN(d2.getTime())) return d2;
  }

  // Detect DD/MM/YYYY or DD/MM/YY with optional time e.g. "15/11/25 20:00" or "15/11/2025 20:00:00"
  const dmRegex = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
  const m = s0.match(dmRegex);
  if (m) {
    let day = parseInt(m[1], 10);
    let month = parseInt(m[2], 10);
    let year = parseInt(m[3], 10);
    let hh = m[4] ? parseInt(m[4], 10) : 0;
    let mm = m[5] ? parseInt(m[5], 10) : 0;
    let ss = m[6] ? parseInt(m[6], 10) : 0;
    if (year < 100) {
      // two-digit year -> map to 2000+
      year += 2000;
    }
    const dd = new Date(year, month - 1, day, hh, mm, ss);
    if (!isNaN(dd.getTime())) return dd;
  }

  // Generic JS date parse
  const d0 = new Date(s0);
  if (!isNaN(d0.getTime())) return d0;

  // If raw is numeric string representing timestamp
  const maybeNum = Number(s0);
  if (!Number.isNaN(maybeNum)) {
    const d2 = new Date(maybeNum);
    if (!isNaN(d2.getTime())) return d2;
  }

  return null;
}

function sortTicketsByDateDesc(arr) {
  return (arr || []).slice().sort((a, b) => {
    const da = parseTicketDate(a?.data?.submitted_at);
    const db = parseTicketDate(b?.data?.submitted_at);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return db.getTime() - da.getTime();
  });
}

function removeDuplicatesByTicketNo(tickets = []) {
  const map = new Map();
  for (const t of tickets) {
    const rawKey =
      (t.data && (t.data.ticketNo ?? t.data.ticketId)) ||
      t.ticketId ||
      (t.data && t.data.ticket_no) ||
      '';
    const key = String(rawKey || '').trim().toUpperCase();
    if (!key) {
      const fallbackKey = `__NO_TICKET__${Math.random().toString(36).slice(2, 9)}`;
      map.set(fallbackKey, t);
      continue;
    }
    const existing = map.get(key);
    if (!existing) {
      map.set(key, t);
      continue;
    }
    const da = parseTicketDate(existing.data?.submitted_at);
    const db = parseTicketDate(t.data?.submitted_at);
    if (db && (!da || db.getTime() > da.getTime())) {
      map.set(key, t);
      continue;
    }
    if (!da && !db) {
      if ((t.data?.fileUrl) && !existing.data?.fileUrl) {
        map.set(key, t);
      }
    }
  }
  return Array.from(map.values());
}

// =======================================
// PDF components (SAD column removed)
function PdfTicketRow({ ticket }) {
  const d = ticket.data || {};
  const computed = computeWeightsFromObj({ gross: d.gross, tare: d.tare, net: d.net });
  const ticketNo = d.ticketNo ?? ticket.ticketId ?? 'N/A';
  const truckText = d.gnswTruckNo ?? d.anpr ?? d.truckOnWb ?? d.truckNo ?? 'N/A';
  const dateText = d.submitted_at ? new Date(d.submitted_at).toLocaleString() : 'N/A';
  const driverText = d.driver ?? 'N/A';
  const createdByText = d.createdBy ?? d.operator ?? 'N/A';

  const cell = (style, content, rightAlign = false) => (
    <PdfView style={[pdfStyles.cellBase, style]}>
      <PdfText style={{ fontSize: 8, textAlign: rightAlign ? 'right' : 'left' }}>{content}</PdfText>
    </PdfView>
  );

  return (
    <PdfView style={pdfStyles.tableRow} wrap={false}>
      {cell(pdfStyles.colTicket, ticketNo)}
      {cell(pdfStyles.colTruck, truckText)}
      {cell(pdfStyles.colDate, dateText)}
      {cell(pdfStyles.colGross, computed.grossDisplay || '0', true)}
      {cell(pdfStyles.colTare, computed.tareDisplay || '0', true)}
      {cell(pdfStyles.colNet, computed.netDisplay || '0', true)}
      {cell(pdfStyles.colDriver, driverText)}
      {cell(pdfStyles.colCreated, createdByText)}
    </PdfView>
  );
}

function CombinedDocument({ tickets = [], reportMeta = {}, generatedBy = 'N/A' }) {
  const totalNet = tickets.reduce((sum, t) => {
    const c = computeWeightsFromObj({ gross: t.data.gross, tare: t.data.tare, net: t.data.net });
    return sum + (c.netValue || 0);
  }, 0);

  const numberOfTransactions = tickets.length;
  const logoUrl = (typeof window !== 'undefined' && window.location ? `${window.location.origin}/logo.png` : '/logo.png');
  const declaredWeight = reportMeta?.declaredWeight ?? null;
  const sadStatus = reportMeta?.sadStatus ?? 'Unknown';

  const rowsPerPage = 30;
  const pages = [];
  for (let i = 0; i < tickets.length; i += rowsPerPage) {
    pages.push(tickets.slice(i, i + rowsPerPage));
  }

  const headerCell = (style, title) => (
    <PdfView style={[pdfStyles.cellBase, style]}>
      <PdfText style={{ fontSize: 8, fontWeight: 'bold', textAlign: 'left' }}>{title}</PdfText>
    </PdfView>
  );

  return (
    <Document>
      {pages.map((pageTickets, idx) => (
        <Page key={`page-${idx}`} size="A4" style={pdfStyles.page}>
          <PdfView style={pdfStyles.header}>
            <PdfView style={{ flexDirection: 'row', alignItems: 'center' }}>
              <PdfImage src={logoUrl} style={pdfStyles.logo} />
              <PdfView style={pdfStyles.companyBlock}>
                <PdfText style={pdfStyles.companyName}>NICK TC-SCAN (GAMBIA) LTD</PdfText>
                <PdfText style={{ fontSize: 10, color: '#6b7280' }}>WEIGHBRIDGE SITUATION REPORT</PdfText>
              </PdfView>
            </PdfView>

            <PdfView>
              <PdfText style={{ fontSize: 10, textAlign: 'right', color: '#374151' }}>{new Date().toLocaleString()}</PdfText>
            </PdfView>
          </PdfView>

          {idx === 0 && (
            <>
              <PdfText style={pdfStyles.reportTitle}>WEIGHBRIDGE SITUATION REPORT</PdfText>

              <PdfView style={pdfStyles.summaryBox}>
                <PdfView style={pdfStyles.metaRow}>
                  <PdfText>SAD: {reportMeta?.sad ?? 'N/A'}</PdfText>
                  <PdfText>DATE RANGE: {reportMeta.dateRangeText || 'All'}</PdfText>
                </PdfView>

                <PdfView style={pdfStyles.metaRow}>
                  <PdfText>Declared Weight: {declaredWeight != null ? `${formatNumber(String(declaredWeight))} KG` : 'N/A'}</PdfText>
                  <PdfText>Total Discharged (KG): {formatNumber(String(totalNet))} KG</PdfText>
                </PdfView>

                <PdfView style={pdfStyles.metaRow}>
                  <PdfText>Start: {reportMeta.startTimeLabel || 'N/A'}</PdfText>
                  <PdfText>End: {reportMeta.endTimeLabel || 'N/A'}</PdfText>
                </PdfView>

                <PdfView style={pdfStyles.metaRow}>
                  <PdfText>Transactions: {numberOfTransactions}</PdfText>
                  <PdfText>SAD Status: {sadStatus}</PdfText>
                </PdfView>

                <PdfView style={pdfStyles.metaRow}>
                  <PdfText>Generated by: {generatedBy || 'N/A'}</PdfText>
                  <PdfText />
                </PdfView>
              </PdfView>
            </>
          )}

          <PdfView style={pdfStyles.tableOuter}>
            <PdfView style={pdfStyles.tableHeader}>
              {headerCell(pdfStyles.colTicket, 'Ticket No')}
              {headerCell(pdfStyles.colTruck, 'Truck No')}
              {headerCell(pdfStyles.colDate, 'Date')}
              {headerCell(pdfStyles.colGross, 'Gross')}
              {headerCell(pdfStyles.colTare, 'Tare')}
              {headerCell(pdfStyles.colNet, 'Net')}
              {headerCell(pdfStyles.colDriver, 'Driver')}
              {headerCell(pdfStyles.colCreated, 'Created By')}
            </PdfView>

            {pageTickets.map((t) => <PdfTicketRow key={t.ticketId || t.data.ticketNo || Math.random()} ticket={t} />)}
          </PdfView>

          <PdfText style={pdfStyles.footer} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </Page>
      ))}
    </Document>
  );
}

// =======================================
// Main React component
// =======================================
export default function WeightReports() {
  // Filters & state
  const [searchSAD, setSearchSAD] = useState('');
  const [searchDriver, setSearchDriver] = useState('');
  const [searchTruck, setSearchTruck] = useState('');

  const [originalTickets, setOriginalTickets] = useState([]);
  const [filteredTickets, setFilteredTickets] = useState([]);

  const [sortBy, setSortBy] = useState('date');
  const [sortDir, setSortDir] = useState('desc');

  const [selectedTicket, setSelectedTicket] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const toast = useToast();
  const modalRef = useRef();

  // loggedInUsername = the user who is signed in (used for "Generated by" in PDF)
  const [loggedInUsername, setLoggedInUsername] = useState('');
  const [currentUserId, setCurrentUserId] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [editErrors, setEditErrors] = useState({});
  const [savingEdit, setSavingEdit] = useState(false);

  const { isOpen: isDeleteOpen, onOpen: onDeleteOpen, onClose: onDeleteClose } = useDisclosure();
  const cancelRef = useRef();
  const [deleting] = useState(false);
  const [, setPendingDelete] = useState(null);

  const [auditLogs, setAuditLogs] = useState([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');
  const [reportMeta, setReportMeta] = useState({});

  const [voiceActive, setVoiceActive] = useState(false);
  const recognitionRef = useRef(null);

  const isMobile = useBreakpointValue({ base: true, md: false });
  const headingSize = useBreakpointValue({ base: 'md', md: 'lg' });
  const modalSize = useBreakpointValue({ base: 'full', md: 'lg' });

  const searchDebounceRef = useRef(null);

  // Style injection (glassmorphism + orb + 3D panels)
  useEffect(() => {
    const css = `
      .wr-container { --muted: rgba(7,17,25,0.55); --text-dark:#071126; background: radial-gradient(circle at 10% 10%, rgba(99,102,241,0.03), transparent 10%), linear-gradient(180deg,#eaf5ff 0%, #ffffff 60%); padding-bottom: 60px; }
      .glass-card { background: linear-gradient(180deg, rgba(255,255,255,0.75), rgba(255,255,255,0.6)); border-radius: 14px; border: 1px solid rgba(2,6,23,0.06); box-shadow: 0 10px 40px rgba(2,6,23,0.06); backdrop-filter: blur(6px); padding: 16px; }
      .neon-btn { background: linear-gradient(135deg,#6D28D9 0%, #06B6D4 100%); color: white; box-shadow: 0 8px 30px rgba(6,182,212,0.14); }
      .orb { width:72px;height:72px;border-radius:999px;display:flex;align-items:center;justify-content:center;box-shadow: 0 8px 40px rgba(109,40,217,0.18), inset 0 -6px 18px rgba(6,182,212,0.08); cursor:pointer; transform: translateY(0); transition: transform 0.24s ease; }
      .orb:hover{ transform: translateY(-6px) rotate(-6deg); }
      .orb .spark { width:34px;height:34px;border-radius:999px;background: radial-gradient(circle at 30% 30%, #fff, rgba(255,255,255,0.08)); box-shadow: 0 8px 24px rgba(6,182,212,0.12); }
      .floating-orb { position: fixed; right: 28px; bottom: 28px; z-index: 2200; }
      .highlight-flash { box-shadow: 0 0 0 3px rgba(96,165,250,0.18) !important; transition: box-shadow 0.5s ease; }
      @media (min-width:1600px) {
        .panel-3d { perspective: 1400px; }
        .panel-3d .glass-card { transform-style: preserve-3d; transition: transform 0.8s ease; }
        .panel-3d:hover .glass-card { transform: rotateY(6deg) rotateX(3deg) translateZ(8px); box-shadow: 0 30px 80px rgba(2,6,23,0.12); }
      }
    `;
    const styleEl = document.createElement('style');
    styleEl.setAttribute('id', 'wr-styles');
    styleEl.innerHTML = css;
    document.head.appendChild(styleEl);
    return () => {
      const el = document.getElementById('wr-styles');
      if (el) el.remove();
    };
  }, []);

  // load user & audit logs + set currentUserId & loggedInUsername
  useEffect(() => {
    let mounted = true;
    async function loadUser() {
      try {
        let currentUser = null;
        if (supabase.auth?.getUser) {
          const { data, error } = await supabase.auth.getUser();
          if (!error) currentUser = data?.user ?? null;
        } else if (supabase.auth?.user) {
          currentUser = supabase.auth.user();
        }
        if (!currentUser) return;
        if (mounted) setCurrentUserId(currentUser.id);

        const { data: userRow } = await supabase.from('users').select('username, role').eq('id', currentUser.id).maybeSingle();
        const uname = userRow?.username || currentUser.email || (currentUser.user_metadata && currentUser.user_metadata.full_name) || '';
        const role = (userRow && userRow.role) || '';
        if (mounted) {
          setLoggedInUsername(uname);
          setIsAdmin(String(role).toLowerCase() === 'admin');
        }
      } catch (err) {
        console.warn('Failed to load user', err);
      }
    }
    loadUser();
    fetchAuditLogs();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAuditLogs = async () => {
    setLoadingAudit(true);
    try {
      const { data, error } = await supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(20);
      if (error) {
        console.debug('audit fetch error', error);
        setAuditLogs([]);
      } else {
        setAuditLogs(data || []);
      }
    } catch (err) {
      console.debug('audit fetch error', err);
      setAuditLogs([]);
    } finally {
      setLoadingAudit(false);
    }
  };

  const parseTimeToMinutes = (timeStr) => {
    if (!timeStr) return null;
    const parts = String(timeStr).split(':');
    if (parts.length < 2) return null;
    const hh = parseInt(parts[0], 10);
    const mm = parseInt(parts[1], 10);
    if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
    return hh * 60 + mm;
  };

  const toggleSort = (key) => {
    if (sortBy === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDir('desc');
    }
  };

  // computeFilteredTickets
  const computeFilteredTickets = (baseArr = null) => {
    if (!baseArr && (!originalTickets || originalTickets.length === 0)) {
      setFilteredTickets([]);
      return;
    }
    let arr = (baseArr || originalTickets).slice();

    // driver filter
    if (searchDriver && searchDriver.trim()) {
      const q = searchDriver.trim().toLowerCase();
      arr = arr.filter((t) => (t.data.driver || '').toString().toLowerCase().includes(q));
    }

    // truck filter
    if (searchTruck && searchTruck.trim()) {
      const q = searchTruck.trim().toLowerCase();
      arr = arr.filter((t) => {
        const trucks = [
          (t.data.gnswTruckNo || ''),
          (t.data.truckOnWb || ''),
          (t.data.anpr || ''),
          (t.data.truckNo || ''),
        ].map((s) => s.toString().toLowerCase());
        return trucks.some((s) => s.includes(q));
      });
    }

    const hasDateRange = !!(dateFrom || dateTo);
    const hasTimeRangeOnly = !hasDateRange && (timeFrom || timeTo);

    let start = null;
    let end = null;
    if (dateFrom) {
      const fullTime = timeFrom ? (timeFrom.length <= 5 ? `${timeFrom}:00` : timeFrom) : '00:00:00';
      start = new Date(`${dateFrom}T${fullTime}`);
    }
    if (dateTo) {
      const fullTime = timeTo ? (timeTo.length <= 5 ? `${timeTo}:00` : timeTo) : '23:59:59.999';
      end = new Date(`${dateTo}T${fullTime}`);
    }

    // If both start and end exist but end is before or equal to start (wrap-around/time overlap),
    // advance end forward by whole days until it is after start.
    if (start && end && end.getTime() <= start.getTime()) {
      let e = new Date(end);
      const DAY_MS = 24 * 60 * 60 * 1000;
      // Avoid infinite loops; limit to adding up to 7 days just in case user input was wildly off.
      let attempts = 0;
      while (e.getTime() <= start.getTime() && attempts < 7) {
        e = new Date(e.getTime() + DAY_MS);
        attempts += 1;
      }
      end = e;
    }

    const tfMinutes = parseTimeToMinutes(timeFrom);
    const ttMinutes = parseTimeToMinutes(timeTo);

    // Helper: choose ticket date for filtering.
    // If a date range is supplied, prefer ticket.data.date (DB field) first, then fallback to submitted_at, created_at, submittedAt.
    // Otherwise keep the original preferred order starting with submitted_at.
    function getTicketDateForFiltering(ticket) {
      const d = ticket?.data || {};
      const candidatesDateFirst = ['date', 'submitted_at', 'created_at', 'submittedAt', 'createdAt'];
      const candidatesDefault = ['submitted_at', 'created_at', 'date', 'submittedAt', 'createdAt'];
      const candidates = (dateFrom || dateTo) ? candidatesDateFirst : candidatesDefault;
      for (const k of candidates) {
        const val = d[k];
        const parsed = parseTicketDate(val);
        if (parsed) return parsed;
      }
      // final fallback: try parsing some common raw fields concatenated (rare)
      const fallbackStrings = [
        d.submitted_at,
        d.date,
        d.created_at,
        d.submittedAt,
        d.createdAt,
        d.ticketNo,
        d.ticket_no,
      ];
      for (const s of fallbackStrings) {
        const parsed = parseTicketDate(s);
        if (parsed) return parsed;
      }
      return null;
    }

    arr = arr.filter((ticket) => {
      const ticketDate = getTicketDateForFiltering(ticket);
      if (!ticketDate) {
        // If the ticket has no parseable date, do not exclude it if user didn't apply a strict date filter.
        // But if the user DID specify a date range, fallback to trying submitted_at explicitly once more:
        if (dateFrom || dateTo) {
          const fallback = parseTicketDate(ticket.data?.submitted_at);
          if (!fallback) return false;
          // use fallback
          if (dateFrom || dateTo) {
            const s = start ? new Date(start) : new Date(-8640000000000000);
            const e = end ? new Date(end) : new Date(8640000000000000);
            return fallback >= s && fallback <= e;
          }
          return true;
        }
        return true;
      }

      if (dateFrom || dateTo) {
        const s = start ? new Date(start) : new Date(-8640000000000000);
        const e = end ? new Date(end) : new Date(8640000000000000);
        return ticketDate >= s && ticketDate <= e;
      }

      if (hasTimeRangeOnly) {
        const ticketMinutes = ticketDate.getHours() * 60 + ticketDate.getMinutes();
        const fromM = tfMinutes !== null ? tfMinutes : 0;
        const toM = ttMinutes !== null ? ttMinutes : 24 * 60 - 1;

        if (fromM <= toM) {
          return ticketMinutes >= fromM && ticketMinutes <= toM;
        }
        return ticketMinutes >= fromM || ticketMinutes <= toM;
      }

      return true;
    });

    const comparator = (a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortBy === 'date') {
        const da = getPreferredDateForSort(a);
        const db = getPreferredDateForSort(b);
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return (da.getTime() - db.getTime()) * dir;
      }
      if (sortBy === 'gross' || sortBy === 'tare' || sortBy === 'net') {
        const ka = numericValue(a.data[sortBy]) ?? 0;
        const kb = numericValue(b.data[sortBy]) ?? 0;
        return (ka - kb) * dir;
      }
      if (sortBy === 'ticketNo' || sortBy === 'ticketno') {
        return String(a.data.ticketNo || '').localeCompare(String(b.data.ticketNo || '')) * dir;
      }
      if (sortBy === 'truck') {
        const ta = (a.data.gnswTruckNo || a.data.truckOnWb || a.data.anpr || a.data.truckNo || '').toString().toLowerCase();
        const tb = (b.data.gnswTruckNo || b.data.truckOnWb || b.data.anpr || b.data.truckNo || '').toString().toLowerCase();
        return ta.localeCompare(tb) * dir;
      }
      return 0;
    };

    // helper for sorting: try to get the most reliable date for sorting (prefer date then submitted_at)
    function getPreferredDateForSort(ticket) {
      const d = ticket?.data || {};
      const tryOrder = ['submitted_at', 'date', 'created_at', 'submittedAt'];
      for (const k of tryOrder) {
        const p = parseTicketDate(d[k]);
        if (p) return p;
      }
      return null;
    }

    arr.sort(comparator);
    setFilteredTickets(arr);

    const startLabel = dateFrom ? `${timeFrom || '00:00'} (${dateFrom})` : timeFrom ? `${timeFrom}` : '';
    const endLabel = dateTo ? `${timeTo || '23:59'} (${dateTo})` : timeTo ? `${timeTo}` : '';
    let dateRangeText = '';
    if (dateFrom && dateTo) dateRangeText = `${dateFrom} → ${dateTo}`;
    else if (dateFrom) dateRangeText = dateFrom;
    else if (dateTo) dateRangeText = dateTo;

    setReportMeta((prev) => ({
      ...prev,
      dateRangeText: dateRangeText || prev.dateRangeText || (originalTickets.length > 0 && originalTickets[0].data.submitted_at ? new Date(originalTickets[0].data.submitted_at).toLocaleDateString() : ''),
      startTimeLabel: startLabel || prev.startTimeLabel || '',
      endTimeLabel: endLabel || prev.endTimeLabel || '',
    }));
  };

  // -------------------------------------------
  // handleGenerateReport - fetch tickets + keep operator in ticket rows only
  // -------------------------------------------
  const handleGenerateReport = async () => {
    if (!searchSAD.trim()) {
      toast({ title: 'SAD Required', description: 'Please type a SAD number to generate the report.', status: 'warning', duration: 3000, isClosable: true });
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('tickets')
        .select('*')
        .ilike('sad_no', `%${searchSAD.trim()}%`);

      if (error) {
        toast({ title: 'Error fetching tickets', description: error.message, status: 'error', duration: 4000, isClosable: true });
        setLoading(false);
        return;
      }

      const mappedTickets = (data || []).map((ticket) => ({
        ticketId: ticket.ticket_id || ticket.id?.toString() || `${Math.random()}`,
        data: {
          sadNo: ticket.sad_no,
          ticketNo: ticket.ticket_no,
          submitted_at: ticket.submitted_at ?? ticket.submittedAt ?? ticket.created_at ?? ticket.date ?? null,
          gnswTruckNo: ticket.gnsw_truck_no,
          truckOnWb: ticket.truck_on_wb,
          net: ticket.net ?? ticket.net_weight ?? null,
          tare: ticket.tare ?? ticket.tare_pt ?? null,
          gross: ticket.gross ?? null,
          driver: ticket.driver || 'N/A',
          consignee: ticket.consignee,
          operator: ticket.operator || '',
          createdBy: ticket.created_by || null, // prefer created_by (text) if present
          user_id: ticket.user_id || null, // we'll fetch username for user_id if present
          status: ticket.status,
          consolidated: ticket.consolidated,
          containerNo: ticket.container_no,
          passNumber: ticket.pass_number,
          scaleName: ticket.scale_name,
          anpr: ticket.truck_on_wb,
          truckNo: ticket.truck_no,
          fileUrl: ticket.file_url || null,
          // Also preserve raw DB date field if present:
          date: ticket.date ?? null,
        },
      }));

      // Deduplicate by ticket number
      const dedupedTickets = removeDuplicatesByTicketNo(mappedTickets);
      if (dedupedTickets.length < mappedTickets.length) {
        const removed = mappedTickets.length - dedupedTickets.length;
        toast({ title: 'Duplicates removed', description: `${removed} duplicate(s) removed by ticket number`, status: 'info', duration: 3500, isClosable: true });
      }

      // --- NEW: Build list of candidate user ids and emails to resolve to usernames ---
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const userIdsSet = new Set();
      const emailsSet = new Set();

      dedupedTickets.forEach((t) => {
        const d = t.data || {};
        if (d.user_id && typeof d.user_id === 'string' && uuidRegex.test(d.user_id)) {
          userIdsSet.add(d.user_id);
        }
        // createdBy could be uuid, email, username, or text
        const cb = d.createdBy;
        if (cb && typeof cb === 'string') {
          const v = cb.trim();
          if (uuidRegex.test(v)) {
            userIdsSet.add(v);
          } else if (v.includes('@')) {
            // simple email detection
            emailsSet.add(v.toLowerCase());
          }
        }
      });

      const userIds = Array.from(userIdsSet);
      const emails = Array.from(emailsSet);

      // Fetch users by id and by email (if any)
      let userMap = {};   // id -> displayName
      let emailMap = {};  // email -> displayName

      try {
        if (userIds.length > 0) {
          const { data: usersById, error: usersByIdErr } = await supabase
            .from('users')
            .select('id, username, email, full_name')
            .in('id', userIds);
          if (!usersByIdErr && Array.isArray(usersById)) {
            usersById.forEach((u) => {
              const display = u.username || u.full_name || u.email || u.id;
              if (u.id) userMap[u.id] = display;
              if (u.email) emailMap[u.email.toLowerCase()] = display;
            });
          } else if (usersByIdErr) {
            console.debug('usersByIdErr', usersByIdErr);
          }
        }

        if (emails.length > 0) {
          const { data: usersByEmail, error: usersByEmailErr } = await supabase
            .from('users')
            .select('id, username, email, full_name')
            .in('email', emails);
          if (!usersByEmailErr && Array.isArray(usersByEmail)) {
            usersByEmail.forEach((u) => {
              const display = u.username || u.full_name || u.email || u.id;
              if (u.id) userMap[u.id] = display;
              if (u.email) emailMap[u.email.toLowerCase()] = display;
            });
          } else if (usersByEmailErr) {
            console.debug('usersByEmailErr', usersByEmailErr);
          }
        }
      } catch (e) {
        console.debug('Failed to fetch users for created_by mapping', e);
      }

      // Attach createdBy usernames (prefer createdBy text field, but map UUID/email where possible)
      const enriched = dedupedTickets.map((t) => {
        const d = t.data || {};
        const rawCreatedByText = d.createdBy ? String(d.createdBy).trim() : null;

        // If rawCreatedByText is a UUID and exists in userMap, use mapped display
        let createdByFromText = null;
        if (rawCreatedByText) {
          if (uuidRegex.test(rawCreatedByText) && userMap[rawCreatedByText]) {
            createdByFromText = userMap[rawCreatedByText];
          } else if (rawCreatedByText.includes('@') && emailMap[rawCreatedByText.toLowerCase()]) {
            createdByFromText = emailMap[rawCreatedByText.toLowerCase()];
          } else {
            // If the text looks like a UUID but we couldn't map, show a shortened UUID for readability
            if (uuidRegex.test(rawCreatedByText)) {
              createdByFromText = `${rawCreatedByText.slice(0, 8)}...`;
            } else {
              createdByFromText = rawCreatedByText; // probably a username or operator name; keep as-is
            }
          }
        }

        // createdBy from user_id (if present)
        const createdByFromUser = d.user_id && userMap[d.user_id] ? userMap[d.user_id] : null;

        // final preference: explicit createdBy text (mapped), then user_id mapping, then operator, then fallback to raw user_id or empty
        const finalCreatedBy = createdByFromText || createdByFromUser || (d.operator ? String(d.operator).trim() : '') || (d.user_id ? String(d.user_id) : '');

        return {
          ...t,
          data: {
            ...d,
            createdBy: finalCreatedBy,
          },
        };
      });

      const sortedOriginal = sortTicketsByDateDesc(enriched);
      setOriginalTickets(sortedOriginal);

      const totalNet = (sortedOriginal || []).reduce((sum, t) => {
        const val = Number(t.data.net ?? t.data.net_weight ?? 0);
        return sum + (Number.isFinite(val) ? val : 0);
      }, 0);

      // fetch SAD declaration row (optional)
      let sadRow = null;
      try {
        const { data: sadData, error: sadError } = await supabase
          .from('sad_declarations')
          .select('sad_no, declared_weight, total_recorded_weight, status')
          .ilike('sad_no', `${searchSAD.trim()}`)
          .maybeSingle();
        if (!sadError) sadRow = sadData || null;
      } catch (e) {
        console.debug('sad fetch failed', e);
      }

      setReportMeta({
        dateRangeText: sortedOriginal.length > 0 ? (sortedOriginal[0].data.submitted_at ? new Date(sortedOriginal[0].data.submitted_at).toLocaleDateString() : '') : '',
        startTimeLabel: '',
        endTimeLabel: '',
        sad: `${searchSAD.trim()}`,
        declaredWeight: sadRow ? Number(sadRow.declared_weight ?? 0) : null,
        dischargedWeight: Number(totalNet || 0),
        sadStatus: sadRow ? (sadRow.status ?? 'In Progress') : 'Unknown',
        sadExists: !!sadRow,
      });

      // compute filtered
      computeFilteredTickets(sortedOriginal);

      // Provide nice success UX:
      toast({ title: `Found ${sortedOriginal.length} ticket(s)`, status: 'success', duration: 2200 });
    } catch (err) {
      console.error('fetch error', err);
      toast({ title: 'Error', description: err?.message || 'Unexpected error', status: 'error', duration: 4000 });
    } finally {
      setLoading(false);
    }
  };

  // ---------------------------------------
  // Dynamic behavior: debounce SAD input to auto-search
  useEffect(() => {
    // Clear previous timer
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    // If empty, clear lists (user wants nothing)
    if (!searchSAD || !searchSAD.trim()) {
      setOriginalTickets([]);
      setFilteredTickets([]);
      setReportMeta({});
      return;
    }
    // Debounce call to handleGenerateReport
    searchDebounceRef.current = setTimeout(() => {
      void handleGenerateReport();
    }, 400);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchSAD]);

  // ---------------------------------------
  // Whenever original tickets or filter inputs change, recompute filtered tickets live
  useEffect(() => {
    computeFilteredTickets(originalTickets);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originalTickets, searchDriver, searchTruck, dateFrom, dateTo, timeFrom, timeTo, sortBy, sortDir]);

  // ---------------------------------------
  const applyRange = () => computeFilteredTickets();
  const resetRange = () => {
    setDateFrom('');
    setDateTo('');
    setTimeFrom('');
    setTimeTo('');
    computeFilteredTickets();
    setReportMeta((p) => ({ ...p, startTimeLabel: '', endTimeLabel: '', dateRangeText: '' }));
  };

  const applyDriverTruckFilter = () => {
    computeFilteredTickets();
    const driverSummary = searchDriver ? `, Driver: ${searchDriver}` : '';
    const truckSummary = searchTruck ? `, Truck: ${searchTruck}` : '';
    setReportMeta((prev) => ({ ...prev, sad: `${searchSAD}${driverSummary}${truckSummary}` }));
  };
  const clearDriverTruckFilters = () => { setSearchDriver(''); setSearchTruck(''); computeFilteredTickets(); setReportMeta((prev) => ({ ...prev, sad: `${searchSAD}` })); };

  const clearAll = () => {
    setSearchSAD('');
    setSearchDriver('');
    setSearchTruck('');
    setOriginalTickets([]);
    setFilteredTickets([]);
    setReportMeta({});
    setDateFrom('');
    setDateTo('');
    setTimeFrom('');
    setTimeTo('');
  };

  // ---------- NEW: recordReportGenerated helper ----------
  const recordReportGenerated = async ({
    blob = null,
    reportType = 'PDF',
    fileNameHint = null,
    reportName = null,
    status = 'Success',
    remarks = null,
  } = {}) => {
    const ALLOWED_TYPES = ['CSV', 'PDF', 'Excel', 'Dashboard', 'Other'];
    const chosenType = ALLOWED_TYPES.includes(String(reportType)) ? reportType : 'Other';
    const safeHint = (fileNameHint || reportMeta?.sad || searchSAD || 'report').toString().slice(0, 120);
    const generatedName = reportName || `${chosenType} ${safeHint} ${new Date().toISOString()}`;

    let file_url = null;
    let file_size = blob && blob.size ? Number(blob.size) : null;

    // Try to upload to storage if available
    if (blob && supabase?.storage && typeof supabase.storage.from === 'function') {
      try {
        const safePart = safeHint.replace(/[^a-zA-Z0-9_.-]/g, '_') || 'report';
        const ext = chosenType === 'PDF' ? '.pdf' : chosenType === 'CSV' ? '.csv' : '.bin';
        const path = `${chosenType}/${Date.now()}-${safePart}${ext}`;

        const { data: uploadData, error: uploadErr } = await supabase.storage.from('reports').upload(path, blob, {
          cacheControl: '3600',
          contentType: chosenType === 'PDF' ? 'application/pdf' : chosenType === 'CSV' ? 'text/csv' : 'application/octet-stream',
          upsert: true,
        });

        if (!uploadErr && uploadData) {
          try {
            const publicRes = supabase.storage.from('reports').getPublicUrl(uploadData.path || path);
            file_url = publicRes?.publicURL || publicRes?.data?.publicUrl || publicRes?.data?.publicURL || null;
          } catch (uerr) {
            console.debug('getPublicUrl error', uerr);
          }
        } else {
          console.debug('reports storage upload failed', uploadErr);
        }
      } catch (e) {
        console.debug('reports storage attempt failed', e);
      }
    }

    const parameters = {
      sad_no: reportMeta?.sad || searchSAD || null,
      selectedCount: filteredTickets?.length ?? 0,
      dateRangeText: reportMeta?.dateRangeText ?? null,
      startTimeLabel: reportMeta?.startTimeLabel ?? null,
      endTimeLabel: reportMeta?.endTimeLabel ?? null,
    };

    const payload = {
      report_name: generatedName,
      report_type: chosenType,
      generated_by: currentUserId || null,
      sad_no: parameters.sad_no || null,
      parameters,
      file_url: file_url || null,
      file_size: file_size !== null ? Number(file_size) : null,
      generated_at: new Date().toISOString(),
      status: status || 'Success',
      remarks: remarks || null,
    };

    try {
      const { data: inserted, error: insertErr } = await supabase
        .from('reports_generated')
        .insert([payload])
        .select()
        .maybeSingle();

      if (insertErr) {
        console.debug('reports_generated insert error', insertErr);
        return { success: false, error: insertErr };
      }

      return { success: true, row: inserted || null };
    } catch (err) {
      console.debug('recordReportGenerated unexpected error', err);
      return { success: false, error: err };
    }
  };

  // ---------- PDF / CSV generation + recording ----------
  const generatePdfBlob = async (ticketsToRender = [], meta = {}, generatedBy = '') => {
    const doc = <CombinedDocument tickets={ticketsToRender} reportMeta={meta} generatedBy={generatedBy} />;
    const asPdf = pdfRender(doc);
    const blob = await asPdf.toBlob();
    return blob;
  };

  const handleDownloadPdf = async () => {
    if (!filteredTickets || filteredTickets.length === 0) {
      toast({ title: 'No tickets', description: 'No tickets to export', status: 'info', duration: 3000 });
      return;
    }
    try {
      setPdfGenerating(true);
      const blob = await generatePdfBlob(filteredTickets, reportMeta, loggedInUsername);

      // record generated report
      try {
        await recordReportGenerated({
          blob,
          reportType: 'PDF',
          fileNameHint: searchSAD || reportMeta?.sad || 'weighbridge',
          reportName: `SAD-${searchSAD || reportMeta?.sad || 'report'}`,
        });
        toast({ title: 'Report recorded', status: 'success', duration: 1500 });
      } catch (e) {
        console.debug('recording report failed', e);
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `SAD-${searchSAD || 'report'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: 'Download started', status: 'success', duration: 3000 });

      // small celebration
      triggerConfetti();
    } catch (err) {
      console.error('PDF generation failed', err);
      toast({ title: 'PDF generation failed', description: err?.message || 'Unexpected error', status: 'error', duration: 5000 });
    } finally {
      setPdfGenerating(false);
    }
  };

  const handleNativeShare = async () => {
    if (!filteredTickets || filteredTickets.length === 0) {
      toast({ title: 'No tickets', description: 'No tickets to share', status: 'info', duration: 3000 });
      return;
    }
    if (!navigator || !navigator.canShare) {
      toast({ title: 'Not supported', description: 'Native file sharing is not supported on this device/browser', status: 'warning', duration: 4000 });
      return;
    }
    try {
      setPdfGenerating(true);
      const blob = await generatePdfBlob(filteredTickets, reportMeta, loggedInUsername);

      try {
        await recordReportGenerated({
          blob,
          reportType: 'PDF',
          fileNameHint: searchSAD || reportMeta?.sad || 'weighbridge',
          reportName: `SAD-${searchSAD || reportMeta?.sad || 'report'}`,
        });
      } catch (e) {
        console.debug('recording report failed', e);
      }

      const file = new File([blob], `SAD-${searchSAD || 'report'}.pdf`, { type: 'application/pdf' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `SAD ${searchSAD} Report`,
          text: `Weighbridge report for SAD ${searchSAD} — ${filteredTickets.length} transactions.`,
        });
        toast({ title: 'Shared', status: 'success', duration: 3000 });
      } else {
        toast({ title: 'Share failed', description: 'Device does not support sharing files', status: 'warning', duration: 4000 });
      }
    } catch (err) {
      console.error('Share error', err);
      toast({ title: 'Share failed', description: err?.message || 'Unexpected error', status: 'error', duration: 5000 });
    } finally {
      setPdfGenerating(false);
    }
  };

  const handleEmailComposer = async () => {
    if (!filteredTickets || filteredTickets.length === 0) {
      toast({ title: 'No tickets', description: 'No tickets to email', status: 'info', duration: 3000 });
      return;
    }
    try {
      setPdfGenerating(true);
      const blob = await generatePdfBlob(filteredTickets, reportMeta, loggedInUsername);

      try {
        await recordReportGenerated({
          blob,
          reportType: 'PDF',
          fileNameHint: searchSAD || reportMeta?.sad || 'weighbridge',
          reportName: `SAD-${searchSAD || reportMeta?.sad || 'report'}`,
        });
      } catch (e) {
        console.debug('recording report failed', e);
      }

      const url = URL.createObjectURL(blob);
      const filename = `SAD-${searchSAD || 'report'}.pdf`;
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      const subject = encodeURIComponent(`Weighbridge Report for SAD ${searchSAD}`);
      const body = encodeURIComponent(`Please find (or attach) the Weighbridge report for SAD ${searchSAD}.\n\nNumber of transactions: ${filteredTickets.length}\nTotal Discharged (KG): ${formatNumber(String(reportMeta?.dischargedWeight || 0))}\n\n(If your mail client does not auto-attach the PDF, please attach the downloaded file: ${filename})`);
      window.location.href = `mailto:?subject=${subject}&body=${body}`;

      toast({ title: 'Composer opened', description: 'PDF downloaded — attach to your email if not auto-attached', status: 'info', duration: 5000 });
    } catch (err) {
      console.error('Email/Download error', err);
      toast({ title: 'Failed', description: err?.message || 'Unexpected error', status: 'error', duration: 5000 });
    } finally {
      setPdfGenerating(false);
    }
  };

  // ----------------- CSV export (unchanged columns; operator included if present) -----------------
  const exportCsv = async () => {
    if (!filteredTickets || filteredTickets.length === 0) {
      toast({ title: 'No data', description: 'No tickets to export as CSV', status: 'info', duration: 3000 });
      return;
    }
    // include createdBy column — use submitted_at column name for date
    const header = ['sadNo', 'ticketNo', 'submitted_at', 'truck', 'driver', 'gross', 'tare', 'net', 'consignee', 'operator', 'createdBy', 'containerNo', 'passNumber', 'scaleName'];
    const rows = filteredTickets.map((t) => {
      const d = t.data || {};
      const truck = d.gnswTruckNo || d.truckOnWb || d.anpr || d.truckNo || '';
      return [
        d.sadNo ?? '',
        d.ticketNo ?? t.ticketId ?? '',
        d.submitted_at ? new Date(d.submitted_at).toISOString() : '',
        truck,
        d.driver ?? '',
        d.gross ?? '',
        d.tare ?? '',
        d.net ?? '',
        d.consignee ?? '',
        d.operator ?? '',
        d.createdBy ?? '',
        d.containerNo ?? '',
        d.passNumber ?? '',
        d.scaleName ?? '',
      ];
    });

    const csv = [header, ...rows].map((r) => r.map((cell) => {
      if (cell === null || cell === undefined) return '';
      const s = String(cell).replace(/"/g, '""');
      return `"${s}"`;
    }).join(',')).join('\n');

    try {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });

      try {
        await recordReportGenerated({
          blob,
          reportType: 'CSV',
          fileNameHint: searchSAD || reportMeta?.sad || 'weighbridge',
          reportName: `SAD-${searchSAD || reportMeta?.sad || 'report'}`,
        });
      } catch (e) {
        console.debug('recording CSV failed', e);
      }

      exportToCSV(rows, `SAD-${searchSAD || 'report'}.csv`);
      toast({ title: `Export started (${rows.length} rows)`, status: 'success', duration: 2500 });

      // confetti as delight
      triggerConfetti();
    } catch (err) {
      console.error('CSV export error', err);
      toast({ title: 'Export failed', description: err?.message || 'Unexpected', status: 'error', duration: 4000 });
    }
  };

  function exportToCSV(rows = [], filename = 'export.csv') {
    if (!rows || rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(','),
      ...rows.map((r) =>
        headers
          .map((h) => {
            const v = r[h] ?? '';
            const s = typeof v === 'string' ? v : String(v);
            return `"${s.replace(/"/g, '""')}"`;
          })
          .join(',')
      ),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---------- Edit / Delete logic (kept intact) ----------
  const isTicketEditable = (ticket) => {
    const status = String(ticket?.data?.status || '').toLowerCase();
    return status !== 'exited';
  };

  const startEditing = (ticketParam = null) => {
    const ticket = ticketParam || selectedTicket;
    if (!ticket) return;

    if (!isAdmin) {
      toast({ title: 'Permission denied', description: 'Only admins can edit tickets', status: 'warning', duration: 3000 });
      return;
    }

    const d = ticket.data || {};
    const operator = d.operator ? d.operator.replace(/^-+/, '').trim() : '';
    const driverName = d.driver ? d.driver.replace(/^-+/, '').trim() : '';

    const initialEditData = {
      consignee: d.consignee ?? '',
      containerNo: d.containerNo ?? '',
      operator: operator || '',
      driver: driverName || '',
      gross: d.gross ?? '',
      tare: d.tare ?? '',
      net: d.net ?? '',
    };

    setSelectedTicket(ticket);
    setEditData(initialEditData);
    setEditErrors({});
    setIsEditing(true);

    onOpen();
  };

  const cancelEditing = () => { setIsEditing(false); setEditErrors({}); setEditData({}); };

  const handleEditChange = (field, val) => {
    setEditData((p) => ({ ...p, [field]: val }));
    setEditErrors((p) => { const cp = { ...p }; delete cp[field]; return cp; });
  };

  const validateEdit = () => {
    const errs = {};
    const g = numericValue(editData.gross);
    const t = numericValue(editData.tare);
    let n = numericValue(editData.net);

    if (g === null) errs.gross = 'Invalid gross';
    if (t === null) errs.tare = 'Invalid tare';
    if (n === null) {
      if (g !== null && t !== null) {
        const computedNet = g - t;
        if (!Number.isFinite(computedNet)) errs.net = 'Invalid net';
        else n = computedNet;
      } else {
        errs.net = 'Invalid net';
      }
    }

    if (g !== null && t !== null && !(g > t)) {
      errs.gross = 'Gross must be greater than Tare';
      errs.tare = 'Tare must be less than Gross';
    }

    setEditErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const saveEdits = async () => {
    if (!selectedTicket) return;
    if (!isAdmin) {
      toast({ title: 'Permission denied', description: 'Only admins can save edits', status: 'warning', duration: 3000 });
      return;
    }
    if (!validateEdit()) {
      toast({ title: 'Validation error', description: 'Please correct fields before saving', status: 'error', duration: 3500 });
      return;
    }

    setSavingEdit(true);
    const before = selectedTicket;
    const payload = {
      consignee: editData.consignee || null,
      container_no: editData.containerNo || null,
      operator: editData.operator || null,
      driver: editData.driver || null,
    };

    const g = numericValue(editData.gross);
    const t = numericValue(editData.tare);
    let n = numericValue(editData.net);
    if ((n === null || n === undefined) && g !== null && t !== null) n = g - t;

    payload.gross = g !== null ? g : null;
    payload.tare = t !== null ? t : null;
    payload.net = n !== null ? n : null;

    try {
      const ticketIdValue = selectedTicket.ticketId ?? selectedTicket.data.ticketNo ?? null;
      if (!ticketIdValue) throw new Error('Missing ticket identifier');

      let usedRpc = false;
      try {
        const { error: rpcErr } = await supabase.rpc('admin_update_ticket', {
          p_ticket_id: ticketIdValue,
          p_gross: payload.gross,
          p_tare: payload.tare,
          p_net: payload.net,
          p_consignee: payload.consignee,
          p_container_no: payload.container_no,
          p_operator: payload.operator,
          p_driver: payload.driver,
        });
        if (!rpcErr) usedRpc = true;
      } catch (rpcErr) {
        console.debug('RPC update failed', rpcErr);
      }

      if (!usedRpc) {
        const { data: roleRow, error: roleErr } = await supabase.from('users').select('role').eq('id', currentUserId).maybeSingle();
        if (roleErr) throw roleErr;
        const role = (roleRow && roleRow.role) || '';
        if (String(role).toLowerCase() !== 'admin') throw new Error('Server role check failed — only admins may edit tickets');

        let { error } = await supabase.from('tickets').update({
          gross: payload.gross,
          tare: payload.tare,
          net: payload.net,
          consignee: payload.consignee,
          container_no: payload.container_no,
          driver: payload.driver,
          operator: payload.operator,
        }).eq('ticket_id', ticketIdValue);

        if (error) {
          const fallback = await supabase.from('tickets').update({
            gross: payload.gross,
            tare: payload.tare,
            net: payload.net,
            consignee: payload.consignee,
            container_no: payload.container_no,
            driver: payload.driver,
            operator: payload.operator,
          }).eq('ticket_no', ticketIdValue);
          if (fallback.error) throw fallback.error;
        }
      }

      const updatedTicket = {
        ...selectedTicket,
        data: {
          ...selectedTicket.data,
          consignee: payload.consignee,
          containerNo: payload.container_no,
          operator: payload.operator,
          driver: payload.driver,
          gross: payload.gross,
          tare: payload.tare,
          net: payload.net,
        },
      };

      setOriginalTickets((prev) => prev.map((t) => (String(t.ticketId) === String(selectedTicket.ticketId) ? updatedTicket : t)));
      setTimeout(() => computeFilteredTickets(), 0);

      setSelectedTicket(updatedTicket);
      setIsEditing(false);

      try {
        const auditEntry = {
          action: 'update',
          ticket_id: ticketIdValue,
          ticket_no: selectedTicket.data?.ticketNo ?? null,
          user_id: currentUserId || null,
          username: loggedInUsername || null,
          details: JSON.stringify({ before: before.data || null, after: updatedTicket.data || null }),
          created_at: new Date().toISOString(),
        };
        await supabase.from('audit_logs').insert([auditEntry]);
        fetchAuditLogs();
      } catch (auditErr) {
        console.debug('Audit log insertion failed', auditErr);
      }

      toast({ title: 'Saved', description: 'Ticket updated', status: 'success', duration: 2500 });
    } catch (err) {
      console.error('Update failed', err);
      toast({ title: 'Update failed', description: err?.message || 'Unexpected error', status: 'error', duration: 5000 });
    } finally {
      setSavingEdit(false);
    }
  };

  const confirmDelete = () => {
    if (!selectedTicket) return;
    if (!isAdmin) {
      toast({ title: 'Permission denied', description: 'Only admins can delete tickets', status: 'warning', duration: 3000 });
      return;
    }
    onDeleteOpen();
  };

  const performDelete = async () => {
    if (!selectedTicket) return;
    if (!isAdmin) {
      toast({ title: 'Permission denied', description: 'Only admins can delete tickets', status: 'warning', duration: 3000 });
      onDeleteClose();
      return;
    }
    onDeleteClose();

    const ticketToDelete = selectedTicket;
    setOriginalTickets((prev) => prev.filter((t) => String(t.ticketId) !== String(ticketToDelete.ticketId)));
    setFilteredTickets((prev) => prev.filter((t) => String(t.ticketId) !== String(ticketToDelete.ticketId)));
    setSelectedTicket(null);

    const DELAY = 8000;
    const timeoutId = setTimeout(async () => {
      try {
        const ticketIdValue = ticketToDelete.ticketId ?? ticketToDelete.data.ticketNo ?? null;
        if (!ticketIdValue) throw new Error('Missing ticket identifier');

        let usedRpc = false;
        try {
          const { error: rpcErr } = await supabase.rpc('admin_delete_ticket', { p_ticket_id: ticketIdValue });
          if (!rpcErr) usedRpc = true;
        } catch (rpcErr) {
          console.debug('RPC delete failed', rpcErr);
        }

        if (!usedRpc) {
          const { data: roleRow, error: roleErr } = await supabase.from('users').select('role').eq('id', currentUserId).maybeSingle();
          if (roleErr) throw roleErr;
          const role = (roleRow && roleRow.role) || '';
          if (String(role).toLowerCase() !== 'admin') throw new Error('Server role check failed — only admins may delete tickets');

          let { error } = await supabase.from('tickets').delete().eq('ticket_id', ticketIdValue);
          if (error) {
            const fallback = await supabase.from('tickets').delete().eq('ticket_no', ticketIdValue);
            if (fallback.error) throw fallback.error;
          }
        }

        try {
          const auditEntry = {
            action: 'delete',
            ticket_id: ticketIdValue,
            ticket_no: ticketToDelete.data?.ticketNo ?? null,
            user_id: currentUserId || null,
            username: loggedInUsername || null,
            details: JSON.stringify({ before: ticketToDelete.data || null }),
            created_at: new Date().toISOString(),
          };
          await supabase.from('audit_logs').insert([auditEntry]);
        } catch (auditErr) {
          console.debug('Audit log insertion failed (delete)', auditErr);
        }

        setPendingDelete((pd) => (pd && pd.ticket && String(pd.ticket.ticketId) === String(ticketToDelete.ticketId) ? null : pd));
        fetchAuditLogs();
        toast({ title: 'Deleted', description: `Ticket ${ticketToDelete.ticketId} deleted`, status: 'success', duration: 3000 });
      } catch (err) {
        console.error('Final delete failed', err);
        setOriginalTickets((prev) => [ticketToDelete, ...prev]);
        setFilteredTickets((prev) => [ticketToDelete, ...prev]);
        setPendingDelete(null);
        toast({ title: 'Delete failed', description: err?.message || 'Could not delete ticket from server', status: 'error', duration: 6000 });
      }
    }, DELAY);

    setPendingDelete({ ticket: ticketToDelete, timeoutId });

    toast({
      duration: DELAY,
      isClosable: true,
      position: 'top-right',
      render: ({ onClose }) => (
        <Box color="white" bg="red.500" p={3} borderRadius="md" boxShadow="md">
          <HStack justify="space-between" align="center">
            <Box>
              <Text fontWeight="bold">Ticket deleted</Text>
              <Text fontSize="sm">Ticket {ticketToDelete.ticketId} scheduled for deletion — <Text as="span" fontWeight="bold">Undo</Text> to restore.</Text>
            </Box>
            <HStack>
              <Button size="sm" colorScheme="whiteAlpha" onClick={() => {
                clearTimeout(timeoutId);
                setOriginalTickets((prev) => [ticketToDelete, ...prev]);
                setFilteredTickets((prev) => [ticketToDelete, ...prev]);
                setPendingDelete(null);
                onClose();
                toast({ title: 'Restored', description: `Ticket ${ticketToDelete.ticketId} restored`, status: 'info', duration: 3000 });
              }}>
                Undo
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { clearTimeout(timeoutId); setPendingDelete(null); onClose(); }}>
                Close
              </Button>
            </HStack>
          </HStack>
        </Box>
      ),
    });
  };

  // ------------- Confetti helper (dynamically loads canvas-confetti) -------------
  const triggerConfetti = async (count = 120) => {
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
          particleCount: Math.min(count, 300),
          spread: 160,
          origin: { y: 0.6 },
        });
      }
    } catch (e) {
      console.debug('confetti load failed', e);
    }
  };

  // ------------- Voice commands (Web Speech API) -------------
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      recognitionRef.current = null;
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;

    recognition.onresult = (ev) => {
      const text = ev.results?.[0]?.[0]?.transcript ?? '';
      handleVoiceCommand(text);
    };
    recognition.onend = () => {
      setVoiceActive(false);
    };
    recognition.onerror = (err) => {
      console.debug('Speech error', err);
      setVoiceActive(false);
    };

    recognitionRef.current = recognition;
    return () => {
      recognition.stop && recognition.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startVoice = () => {
    const r = recognitionRef.current;
    if (!r) {
      toast({ title: 'Voice not supported', description: 'Your browser does not support the Web Speech API', status: 'warning' });
      return;
    }
    setVoiceActive(true);
    try {
      r.start();
    } catch (e) {
      console.debug('recognition start failed', e);
    }
  };
  const stopVoice = () => {
    const r = recognitionRef.current;
    if (!r) return;
    try {
      r.stop();
    } catch (e) { /* ignore */ }
    setVoiceActive(false);
  };

  const handleVoiceCommand = (text = '') => {
    const t = String(text || '').toLowerCase().trim();
    toast({ title: 'Voice command', description: `"${t}"`, status: 'info', duration: 2200 });
    if (t.includes('promote all')) {
      highlightAllRows();
      return;
    }
    if (t.includes('demote row')) {
      const m = t.match(/demote row (\d+)/);
      const digits = m ? Number(m[1]) : null;
      if (digits) {
        pulseRow(digits - 1);
        return;
      }
    }
    if (t.includes('generate report')) {
      handleGenerateReport();
      return;
    }
    toast({ title: 'Voice', description: 'Command not recognized', status: 'warning', duration: 2200 });
  };

  const highlightAllRows = () => {
    const el = document.querySelectorAll('.glass-card');
    el.forEach((e) => e.classList.add('highlight-flash'));
    setTimeout(() => {
      el.forEach((e) => e.classList.remove('highlight-flash'));
    }, 2200);
  };

  const pulseRow = (index) => {
    const rows = document.querySelectorAll('tbody tr');
    if (!rows || rows.length === 0) {
      toast({ title: 'No rows', description: 'No table rows to pulse', status: 'info' });
      return;
    }
    const idx = Math.max(0, Math.min(index, rows.length - 1));
    const row = rows[idx];
    if (!row) {
      toast({ title: 'No row', description: `Row ${index + 1} not found`, status: 'warning' });
      return;
    }
    row.classList.add('highlight-flash');
    setTimeout(() => row.classList.remove('highlight-flash'), 2200);
  };

  // ---------- Magic Orb Generate (playful modal + confetti + stardust)
  const handleMagicGenerate = async () => {
    await triggerConfetti(160);
    setTimeout(async () => {
      await handleGenerateReport();
      if (filteredTickets && filteredTickets.length > 0) {
        await handleDownloadPdf();
      }
    }, 300);
  };

  // -------------- UI helpers --------------
  const cumulativeNetWeight = useMemo(() => {
    return filteredTickets.reduce((total, ticket) => {
      const computed = computeWeightsFromObj({
        gross: ticket.data.gross,
        tare: ticket.data.tare,
        net: ticket.data.net,
      });
      const net = computed.netValue || 0;
      return total + net;
    }, 0);
  }, [filteredTickets]);

  const openModalWithTicket = (ticket) => {
    setSelectedTicket(ticket);
    setIsEditing(false);
    setEditData({});
    setEditErrors({});
    onOpen();
  };

  // ---------- Render ----------
  return (
    <Container maxW="8xl" py={{ base: 4, md: 8 }} className="wr-container">
      <Box mb={6} className="panel-3d">
        <Flex direction={{ base: 'column', md: 'row' }} align={{ base: 'stretch', md: 'center' }} gap={4}>
          <Box flex="1">
            <Heading size={headingSize} mb={1}>SAD Report Generator</Heading>
            <Text mt={2} color="gray.500">Search SAD → then filter by driver or truck. Generated by uses your logged-in username.</Text>
          </Box>
          <Flex ml="auto" gap={4} align="center" wrap="wrap">
            <StatGroup display="flex" alignItems="center" gap={4}>
              <Stat className="glass-card">
                <StatLabel>Total Transactions</StatLabel>
                <StatNumber fontSize="lg">{filteredTickets.length}</StatNumber>
                <StatHelpText>{originalTickets.length > 0 ? `of ${originalTickets.length} returned` : ''}</StatHelpText>
              </Stat>

              <Stat className="glass-card">
                <StatLabel>Total Discharged (KG)</StatLabel>
                <StatNumber fontSize="lg">{formatNumber(String(cumulativeNetWeight)) || '0'}</StatNumber>
              </Stat>
            </StatGroup>
          </Flex>
        </Flex>
      </Box>

      <Box className="glass-card" mb={6}>
        <SimpleGrid columns={{ base: 1, md: 3 }} gap={3} mb={3} alignItems="end">
          <ChakraInput
            placeholder="Type SAD No (required)"
            value={searchSAD}
            onChange={(e) => setSearchSAD(e.target.value)}
            isDisabled={loading || pdfGenerating}
            borderRadius="md"
            size="md"
            aria-label="Search SAD"
          />

          {originalTickets.length > 0 ? (
            <>
              <ChakraInput
                placeholder="Driver Name (filter)"
                value={searchDriver}
                onChange={(e) => setSearchDriver(e.target.value)}
                isDisabled={loading || pdfGenerating}
                borderRadius="md"
                size="md"
                aria-label="Filter by driver"
              />
              <ChakraInput
                placeholder="Truck No (filter)"
                value={searchTruck}
                onChange={(e) => setSearchTruck(e.target.value)}
                isDisabled={loading || pdfGenerating}
                borderRadius="md"
                size="md"
                aria-label="Filter by truck"
              />
            </>
          ) : (
            <>
              <Box />
              <Box />
            </>
          )}
        </SimpleGrid>

        <Flex gap={3} wrap="wrap" align="center" mb={4}>
          <Button
            colorScheme="teal"
            size="md"
            leftIcon={<FaSearch />}
            onClick={handleGenerateReport}
            isLoading={loading}
            loadingText="Searching..."
            minW="160px"
            aria-label="Generate report"
            className="neon-btn"
          >
            Generate Report
          </Button>

          {originalTickets.length > 0 && (
            <>
              <Button size="md" leftIcon={<FaFilter />} onClick={applyDriverTruckFilter} isDisabled={loading || pdfGenerating}>Apply Filters</Button>
              <Button size="md" variant="ghost" leftIcon={<FaTimes />} onClick={clearDriverTruckFilters} isDisabled={loading || pdfGenerating}>Clear Filters</Button>
            </>
          )}

          <Button size="md" variant="ghost" leftIcon={<FaRedo />} onClick={clearAll} minW="120px">Clear All</Button>

          <HStack spacing={2} ml="auto" wrap="wrap">
            <Button leftIcon={<FaFilePdf />} onClick={handleDownloadPdf} isLoading={pdfGenerating} size="sm" colorScheme="gray">
              Download PDF
            </Button>
            <Button leftIcon={<FaShareAlt />} onClick={handleNativeShare} isLoading={pdfGenerating} size="sm" colorScheme="blue">
              Share
            </Button>
            <Button leftIcon={<FaEnvelope />} onClick={handleEmailComposer} isLoading={pdfGenerating} size="sm" colorScheme="green">
              Email
            </Button>

            <Menu>
              <MenuButton as={IconButton} aria-label="more" icon={<FaEllipsisV />} variant="ghost" />
              <MenuList>
                <MenuItem icon={<FaFilePdf />} onClick={handleDownloadPdf}>Export PDF</MenuItem>
                <MenuItem icon={<FaFileCsv />} onClick={() => exportCsv()}>Export CSV</MenuItem>
                <MenuItem icon={<FaShareAlt />} onClick={handleNativeShare}>Share</MenuItem>
                <MenuItem icon={<FaEnvelope />} onClick={handleEmailComposer}>Email</MenuItem>
                <MenuItem onClick={fetchAuditLogs}>Refresh Audit Logs</MenuItem>
              </MenuList>
            </Menu>
          </HStack>
        </Flex>

        <Box border="1px solid" borderColor="rgba(2,6,23,0.04)" p={3} borderRadius="md" mb={4}>
          <Text fontWeight="semibold" mb={2}>Filter by Date & Time Range</Text>
          <SimpleGrid columns={{ base: 1, md: 4 }} spacing={3} alignItems="end">
            <Box>
              <Text fontSize="sm" mb={1}>Date From</Text>
              <ChakraInput type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </Box>
            <Box>
              <Text fontSize="sm" mb={1}>Date To</Text>
              <ChakraInput type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </Box>
            <Box>
              <Text fontSize="sm" mb={1}>Time From</Text>
              <ChakraInput type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} />
            </Box>
            <Box>
              <Text fontSize="sm" mb={1}>Time To</Text>
              <ChakraInput type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} />
            </Box>
          </SimpleGrid>

          <Flex mt={3} gap={2} align="center">
            <Button size="sm" colorScheme="blue" onClick={applyRange}>Apply Range</Button>
            <Button size="sm" variant="ghost" onClick={resetRange}>Reset Range</Button>

            <Text ml="auto" fontSize="sm" color="gray.600">Tip: Narrow by date/time, then export.</Text>
          </Flex>
        </Box>

        {/* Re-introduced SAD stat cards (Declared / Discharged / SAD Status) */}
        {(reportMeta?.sad || originalTickets.length > 0) && (
          <SimpleGrid columns={{ base: 1, md: 3 }} gap={3} mb={4}>
            <Stat bg="gray.50" px={4} py={3} borderRadius="md" boxShadow="sm">
              <StatLabel>Declared Weight</StatLabel>
              <StatNumber>{reportMeta.declaredWeight != null ? formatNumber(String(reportMeta.declaredWeight)) : 'N/A'}</StatNumber>
              <StatHelpText>From SAD Declaration</StatHelpText>
            </Stat>

            <Stat bg="gray.50" px={4} py={3} borderRadius="md" boxShadow="sm">
              <StatLabel>Discharged Weight</StatLabel>
              <StatNumber>{reportMeta.dischargedWeight != null ? formatNumber(String(reportMeta.dischargedWeight)) : (formatNumber(String(cumulativeNetWeight)) || '0')}</StatNumber>
              <StatHelpText>Sum of ticket nets (fetched)</StatHelpText>
            </Stat>

            <Stat bg="gray.50" px={4} py={3} borderRadius="md" boxShadow="sm">
              <StatLabel>SAD Status</StatLabel>
              <StatNumber>{reportMeta.sadStatus || (reportMeta.sadExists ? 'In Progress' : 'Unknown')}</StatNumber>
              <StatHelpText>{reportMeta.sadExists ? 'Declaration exists in DB' : 'No declaration found'}</StatHelpText>
            </Stat>
          </SimpleGrid>
        )}

        {/* voice commands */}
        <Flex align="center" gap={3} mb={2}>
          <Box fontSize="sm" color="gray.600">Voice commands:</Box>
          <Button size="sm" leftIcon={voiceActive ? <FaMicrophoneSlash /> : <FaMicrophone />} onClick={() => (voiceActive ? stopVoice() : startVoice())} colorScheme={voiceActive ? 'red' : 'teal'}>
            {voiceActive ? 'Listening...' : 'Start Voice'}
          </Button>
        </Flex>
      </Box>

      <Box className="panel-3d">
        {filteredTickets.length > 0 ? (
          <>
            <Flex align="center" justify="space-between" mb={3} gap={4} wrap="wrap">
              <Text fontSize={{ base: 'md', md: 'lg' }} fontWeight="bold">{reportMeta?.sad ? `SAD: ${reportMeta.sad}` : `SAD: ${searchSAD}`}</Text>

              <HStack spacing={3}>
                <Box textAlign="right">
                  <Text fontSize="sm" color="gray.500">Showing</Text>
                  <Text fontWeight="bold">{filteredTickets.length} / {originalTickets.length}</Text>
                </Box>
                <Box textAlign="right" minW="140px">
                  <Text fontSize="sm" color="gray.500">Total Discharged (KG)</Text>
                  <Text fontWeight="bold">{formatNumber(String(cumulativeNetWeight)) || '0'} kg</Text>
                </Box>
              </HStack>
            </Flex>

            {isMobile ? (
              <VStack spacing={3} align="stretch">
                {filteredTickets.map((t, idx) => {
                  const computed = computeWeightsFromObj({ gross: t.data.gross, tare: t.data.tare, net: t.data.net });
                  const displayTruck = t.data.gnswTruckNo || t.data.truckOnWb || t.data.anpr || t.data.truckNo || 'N/A';
                  const displayDriver = t.data.driver || 'N/A';
                  const displayCreated = t.data.createdBy || t.data.operator || 'N/A';
                  return (
                    <Box key={t.ticketId} className="glass-card" p={3}>
                      <Flex justify="space-between" align="start" gap={3} wrap="wrap">
                        <Box>
                          <Text fontSize="sm" color="gray.500">Ticket</Text>
                          <HStack>
                            <Text fontWeight="bold">{t.data.ticketNo || t.ticketId}</Text>
                          </HStack>
                          <Text fontSize="sm" color="gray.500">{t.data.submitted_at ? new Date(t.data.submitted_at).toLocaleString() : 'N/A'}</Text>
                        </Box>

                        <Box textAlign="right">
                          <Text fontSize="sm" color="gray.500">Truck</Text>
                          <HStack justify="flex-end">
                            <Text fontWeight="semibold">{displayTruck}</Text>
                          </HStack>
                          <Text fontSize="sm" color="gray.500">Driver</Text>
                          <HStack justify="flex-end">
                            <Text>{displayDriver}</Text>
                          </HStack>
                          <Text fontSize="sm" color="gray.500">Operator</Text>
                          <HStack justify="flex-end">
                            <Text>{displayCreated}</Text>
                          </HStack>
                        </Box>
                      </Flex>

                      <Flex mt={3} gap={3} justify="space-between" align="center" wrap="wrap">
                        <HStack spacing={3}>
                          <Box>
                            <Text fontSize="xs" color="gray.500">Gross</Text>
                            <Text fontWeight="bold">{computed.grossDisplay || '0'}</Text>
                          </Box>
                          <Box>
                            <Text fontSize="xs" color="gray.500">Tare</Text>
                            <Text fontWeight="bold">{computed.tareDisplay || '0'}</Text>
                          </Box>
                          <Box>
                            <Text fontSize="xs" color="gray.500">Net</Text>
                            <Text fontWeight="bold">{computed.netDisplay || '0'}</Text>
                          </Box>
                        </HStack>

                        <HStack spacing={2} ml="auto">
                          <Button size="sm" variant="outline" leftIcon={<ArrowForwardIcon />} onClick={() => openModalWithTicket(t)}>View</Button>
                          <Button size="sm" variant="ghost" leftIcon={<FaEdit />} onClick={() => startEditing(t)} isDisabled={!isAdmin || !isTicketEditable(t)}>Edit</Button>
                          {t.data.fileUrl && (
                            <Button size="sm" variant="ghost" colorScheme="red" leftIcon={<FaFilePdf />} onClick={() => window.open(t.data.fileUrl, '_blank', 'noopener')}>
                              Open PDF
                            </Button>
                          )}
                        </HStack>
                      </Flex>
                    </Box>
                  );
                })}
              </VStack>
            ) : (
              <Box overflowX="auto" borderRadius="md" className="glass-card">
                <Table variant="simple" size="sm" sx={{
                  'th': { position: 'sticky', top: 0, background: 'linear-gradient(90deg,#b02a37,#8a1f27)', color: '#fff', zIndex: 2 },
                  'td, th': { border: '1px solid rgba(2,6,23,0.06)', verticalAlign: 'middle' }
                }}>
                  <Thead>
                    <Tr>
                      <Th onClick={() => toggleSort('ticketNo')} cursor="pointer">
                        <HStack spacing={2}><Text>Ticket No</Text> {sortBy === 'ticketNo' ? (sortDir === 'asc' ? <FaSortUp /> : <FaSortDown />) : <FaSort />}</HStack>
                      </Th>
                      <Th onClick={() => toggleSort('date')} cursor="pointer">
                        <HStack spacing={2}><Text>Date & Time</Text> {sortBy === 'date' ? (sortDir === 'asc' ? <FaSortUp /> : <FaSortDown />) : <FaSort />}</HStack>
                      </Th>
                      <Th onClick={() => toggleSort('truck')} cursor="pointer">
                        <HStack spacing={2}><Text>Truck No</Text> {sortBy === 'truck' ? (sortDir === 'asc' ? <FaSortUp /> : <FaSortDown />) : <FaSort />}</HStack>
                      </Th>
                      <Th isNumeric onClick={() => toggleSort('gross')} cursor="pointer">
                        <HStack spacing={2} justify="flex-end"><Text>Gross (kg)</Text> {sortBy === 'gross' ? (sortDir === 'asc' ? <FaSortUp /> : <FaSortDown />) : <FaSort />}</HStack>
                      </Th>
                      <Th isNumeric onClick={() => toggleSort('tare')} cursor="pointer">
                        <HStack spacing={2} justify="flex-end"><Text>Tare (kg)</Text> {sortBy === 'tare' ? (sortDir === 'asc' ? <FaSortUp /> : <FaSortDown />) : <FaSort />}</HStack>
                      </Th>
                      <Th isNumeric onClick={() => toggleSort('net')} cursor="pointer">
                        <HStack spacing={2} justify="flex-end"><Text>Net (kg)</Text> {sortBy === 'net' ? (sortDir === 'asc' ? <FaSortUp /> : <FaSortDown />) : <FaSort />}</HStack>
                      </Th>
                      <Th>Driver</Th>
                      <Th>Operator</Th>
                      <Th>Actions</Th>
                    </Tr>
                  </Thead>

                  <Tbody>
                    {filteredTickets.map((ticket, idx) => {
                      const computed = computeWeightsFromObj({
                        gross: ticket.data.gross,
                        tare: ticket.data.tare,
                        net: ticket.data.net,
                      });
                      const displayDriver = ticket.data.driver || 'N/A';
                      const displayTruck = ticket.data.gnswTruckNo || ticket.data.truckOnWb || ticket.data.anpr || ticket.data.truckNo || 'N/A';
                      const displayCreated = ticket.data.createdBy || ticket.data.operator || 'N/A';

                      return (
                        <Tr key={ticket.ticketId}>
                          <Td>{ticket.data.ticketNo}</Td>
                          <Td>{ticket.data.submitted_at ? new Date(ticket.data.submitted_at).toLocaleString() : 'N/A'}</Td>
                          <Td>{displayTruck}</Td>
                          <Td isNumeric>{computed.grossDisplay || '0'}</Td>
                          <Td isNumeric>{computed.tareDisplay || '0'}</Td>
                          <Td isNumeric>{computed.netDisplay || '0'}</Td>
                          <Td>{displayDriver}</Td>
                          <Td>{displayCreated}</Td>
                          <Td>
                            <HStack spacing={2} flexWrap="wrap">
                              <Button size="sm" colorScheme="teal" variant="outline" leftIcon={<ArrowForwardIcon />} onClick={() => openModalWithTicket(ticket)}>View</Button>
                              <Button size="sm" variant="ghost" leftIcon={<FaEdit />} onClick={() => startEditing(ticket)} isDisabled={!isAdmin || !isTicketEditable(ticket)}>
                                Edit
                              </Button>
                              {ticket.data.fileUrl && (
                                <Button size="sm" variant="ghost" colorScheme="red" leftIcon={<FaFilePdf />} onClick={() => window.open(ticket.data.fileUrl, '_blank', 'noopener')}>
                                  Open
                                </Button>
                              )}
                            </HStack>
                          </Td>
                        </Tr>
                      );
                    })}

                    <Tr fontWeight="bold" bg="teal.50">
                      <Td colSpan={4}>Total Discharged (KG)</Td>
                      <Td isNumeric>{formatNumber(cumulativeNetWeight) || '0'} kg</Td>
                      <Td colSpan={3} />
                    </Tr>
                  </Tbody>
                </Table>
              </Box>
            )}
          </>
        ) : (
          !loading && (searchSAD || searchDriver || searchTruck) && (
            <Text mt={6} fontStyle="italic">
              No records found for: <Text as="span" fontWeight="bold"> {reportMeta?.sad || [searchSAD, searchDriver, searchTruck].filter(Boolean).join(', ')}</Text>
            </Text>
          )
        )}
      </Box>

      {/* Audit logs */}
      <Box mt={6} p={4} borderRadius="md" className="glass-card">
        <Flex align="center" mb={3}>
          <Heading size="sm">Recent Audit Logs</Heading>
          <Button size="sm" ml="auto" onClick={fetchAuditLogs} leftIcon={<FaRedo />}>Refresh</Button>
        </Flex>

        {loadingAudit ? (
          <Flex align="center" justify="center" p={4}><Spinner /></Flex>
        ) : auditLogs.length === 0 ? (
          <Text fontSize="sm" color="gray.500">No audit logs yet.</Text>
        ) : (
          <Box overflowX="auto">
            <Table size="sm" variant="simple">
              <Thead>
                <Tr>
                  <Th>When</Th>
                  <Th>User</Th>
                  <Th>Action</Th>
                  <Th>Ticket</Th>
                  <Th>Details</Th>
                </Tr>
              </Thead>
              <Tbody>
                {auditLogs.map((a) => (
                  <Tr key={a.id || `${a.ticket_id}-${a.created_at}`}>
                    <Td>{a.created_at ? new Date(a.created_at).toLocaleString() : '—'}</Td>
                    <Td>{a.username ?? a.user_id ?? '—'}</Td>
                    <Td>{a.action}</Td>
                    <Td>{a.ticket_no ?? a.ticket_id ?? '—'}</Td>
                    <Td style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.details ? a.details : '—'}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </Box>
        )}
      </Box>

      {/* Ticket modal */}
      <Modal isOpen={isOpen} onClose={() => { onClose(); setIsEditing(false); setEditData({}); setEditErrors({}); }} size={modalSize} isCentered scrollBehavior="inside">
        <ModalOverlay />
        <AnimatePresence>
          {isOpen && (
            <MotionModalContent
              ref={modalRef}
              borderRadius="lg"
              p={4}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 30 }}
              transition={{ duration: 0.25 }}
            >
              <ModalHeader>
                <Flex align="center" gap={3}>
                  <Icon as={FaFileInvoice} color="teal.500" boxSize={5} />
                  <Box>
                    <Text fontWeight="bold">Ticket Details</Text>
                    <Text fontSize="sm" color="gray.500">
                      {selectedTicket?.ticketId} • {selectedTicket?.data?.submitted_at ? new Date(selectedTicket.data.submitted_at).toLocaleDateString() : ''}
                    </Text>
                  </Box>
                </Flex>
              </ModalHeader>
              <ModalCloseButton />
              <ModalBody>
                {selectedTicket ? (
                  <Stack spacing={3} fontSize="sm">
                    <HStack>
                      <Icon as={FaTruck} />
                      <Text><b>Truck No:</b> {selectedTicket.data.gnswTruckNo || selectedTicket.data.truckOnWb || selectedTicket.data.anpr || selectedTicket.data.truckNo || 'N/A'}</Text>
                      {isAdmin && isTicketEditable(selectedTicket) && <IconButton size="xs" aria-label="Edit" icon={<FaEdit />} onClick={() => startEditing(selectedTicket)} variant="ghost" />}
                    </HStack>

                    {isEditing ? (
                      <>
                        <FormControl isInvalid={!!editErrors.operator}>
                          <FormLabel><Icon as={FaUserTie} mr={2} /> Operator</FormLabel>
                          <ChakraInput value={editData.operator ?? ''} onChange={(e) => handleEditChange('operator', e.target.value)} />
                          <FormErrorMessage>{editErrors.operator}</FormErrorMessage>
                        </FormControl>

                        <FormControl>
                          <FormLabel><Icon as={FaBox} mr={2} /> Consignee</FormLabel>
                          <ChakraInput value={editData.consignee ?? ''} onChange={(e) => handleEditChange('consignee', e.target.value)} />
                        </FormControl>

                        <FormControl>
                          <FormLabel><Icon as={FaBox} mr={2} /> Container No</FormLabel>
                          <ChakraInput value={editData.containerNo ?? ''} onChange={(e) => handleEditChange('containerNo', e.target.value)} />
                        </FormControl>

                        <SimpleGrid columns={[1, 3]} spacing={3}>
                          <FormControl isInvalid={!!editErrors.gross}>
                            <FormLabel><Icon as={FaBalanceScale} mr={2} /> Gross (kg)</FormLabel>
                            <ChakraInput value={editData.gross ?? ''} onChange={(e) => handleEditChange('gross', e.target.value)} />
                            <FormErrorMessage>{editErrors.gross}</FormErrorMessage>
                          </FormControl>
                          <FormControl isInvalid={!!editErrors.tare}>
                            <FormLabel><Icon as={FaBalanceScale} mr={2} /> Tare (kg)</FormLabel>
                            <ChakraInput value={editData.tare ?? ''} onChange={(e) => handleEditChange('tare', e.target.value)} />
                            <FormErrorMessage>{editErrors.tare}</FormErrorMessage>
                          </FormControl>
                          <FormControl isInvalid={!!editErrors.net}>
                            <FormLabel><Icon as={FaBalanceScale} mr={2} /> Net (kg)</FormLabel>
                            <ChakraInput value={editData.net ?? (numericValue(editData.gross) !== null && numericValue(editData.tare) !== null ? String(numericValue(editData.gross) - numericValue(editData.tare)) : '')} onChange={(e) => handleEditChange('net', e.target.value)} />
                            <FormErrorMessage>{editErrors.net}</FormErrorMessage>
                          </FormControl>
                        </SimpleGrid>
                      </>
                    ) : (
                      <>
                        <HStack>
                          <Icon as={FaUserTie} />
                          <Text><b>Operator:</b> {selectedTicket.data.operator || loggedInUsername || 'N/A'}</Text>
                          {isAdmin && isTicketEditable(selectedTicket) && <IconButton size="xs" aria-label="Edit operator" icon={<FaEdit />} onClick={() => startEditing(selectedTicket)} variant="ghost" />}
                        </HStack>

                        <HStack>
                          <Icon as={FaUserTie} />
                          <Text><b>Operator:</b> {selectedTicket.data.createdBy || selectedTicket.data.operator || 'N/A'}</Text>
                        </HStack>

                        <HStack>
                          <Icon as={FaBox} />
                          <Text><b>Consignee:</b> {selectedTicket.data.consignee || 'N/A'}</Text>
                          {isAdmin && isTicketEditable(selectedTicket) && <IconButton size="xs" aria-label="Edit consignee" icon={<FaEdit />} onClick={() => startEditing(selectedTicket)} variant="ghost" />}
                        </HStack>

                        {(() => {
                          const computed = computeWeightsFromObj({
                            gross: selectedTicket.data.gross,
                            tare: selectedTicket.data.tare,
                            net: selectedTicket.data.net,
                          });
                          return (
                            <>
                              <HStack>
                                <Icon as={FaBalanceScale} />
                                <Text><b>Gross Weight:</b> {computed.grossDisplay || '0'} kg</Text>
                                {isAdmin && isTicketEditable(selectedTicket) && <IconButton size="xs" aria-label="Edit gross" icon={<FaEdit />} onClick={() => startEditing(selectedTicket)} variant="ghost" />}
                              </HStack>
                              <HStack>
                                <Icon as={FaBalanceScale} />
                                <Text><b>Tare Weight:</b> {computed.tareDisplay || '0'} kg</Text>
                                {isAdmin && isTicketEditable(selectedTicket) && <IconButton size="xs" aria-label="Edit tare" icon={<FaEdit />} onClick={() => startEditing(selectedTicket)} variant="ghost" />}
                              </HStack>
                              <HStack>
                                <Icon as={FaBalanceScale} />
                                <Text><b>Net Weight:</b> {computed.netDisplay || '0'} kg</Text>
                                {isAdmin && isTicketEditable(selectedTicket) && <IconButton size="xs" aria-label="Edit net" icon={<FaEdit />} onClick={() => startEditing(selectedTicket)} variant="ghost" />}
                              </HStack>
                            </>
                          );
                        })()}
                      </>
                    )}

                    <HStack>
                      <Icon as={FaBox} />
                      <Text><b>Container No:</b> {selectedTicket.data.containerNo || 'N/A'}</Text>
                      {isAdmin && isTicketEditable(selectedTicket) && <IconButton size="xs" aria-label="Edit container" icon={<FaEdit />} onClick={() => startEditing(selectedTicket)} variant="ghost" />}
                    </HStack>
                    <HStack>
                      <Text><b>Pass Number:</b> {selectedTicket.data.passNumber || 'N/A'}</Text>
                      {isAdmin && isTicketEditable(selectedTicket) && <IconButton size="xs" aria-label="Edit pass number" icon={<FaEdit />} onClick={() => startEditing(selectedTicket)} variant="ghost" />}
                    </HStack>
                    <HStack>
                      <Text><b>Scale Name:</b> {selectedTicket.data.scaleName || 'N/A'}</Text>
                      {isAdmin && isTicketEditable(selectedTicket) && <IconButton size="xs" aria-label="Edit scale" icon={<FaEdit />} onClick={() => startEditing(selectedTicket)} variant="ghost" />}
                    </HStack>
                    <HStack>
                      <Text><b>ANPR:</b> {selectedTicket.data.anpr || 'N/A'}</Text>
                      {isAdmin && isTicketEditable(selectedTicket) && <IconButton size="xs" aria-label="Edit anpr" icon={<FaEdit />} onClick={() => startEditing(selectedTicket)} variant="ghost" />}
                    </HStack>
                    <HStack>
                      <Text><b>Consolidated:</b> {selectedTicket.data.consolidated ? 'Yes' : 'No'}</Text>
                    </HStack>

                    {selectedTicket.data.fileUrl && (
                      <Box pt={2}>
                        <Button size="sm" colorScheme="red" leftIcon={<FaExternalLinkAlt />} onClick={() => window.open(selectedTicket.data.fileUrl, '_blank', 'noopener')}>
                          Open Stored Ticket PDF
                        </Button>
                      </Box>
                    )}
                  </Stack>
                ) : (
                  <Text>No data</Text>
                )}
              </ModalBody>

              <ModalFooter>
                {selectedTicket && !isEditing && (
                  <>
                    {isAdmin ? (
                      <Button leftIcon={<FaEdit />} colorScheme="yellow" mr={2} onClick={() => startEditing(selectedTicket)} isDisabled={!isTicketEditable(selectedTicket)}>
                        Edit
                      </Button>
                    ) : (
                      <Button leftIcon={<FaEdit />} colorScheme="yellow" mr={2} isDisabled>Edit</Button>
                    )}

                    {isAdmin ? (
                      <Button leftIcon={<FaTrashAlt />} colorScheme="red" mr={2} onClick={confirmDelete}>Delete</Button>
                    ) : (
                      <Button leftIcon={<FaTrashAlt />} colorScheme="red" mr={2} isDisabled>Delete</Button>
                    )}
                  </>
                )}

                {isEditing && (
                  <>
                    <Button leftIcon={<FaCheck />} colorScheme="green" mr={2} onClick={saveEdits} isLoading={savingEdit}>Save</Button>
                    <Button variant="ghost" mr={2} onClick={cancelEditing}>Cancel</Button>
                  </>
                )}

                <Button onClick={() => { onClose(); setIsEditing(false); setEditData({}); setEditErrors({}); }}>Close</Button>
              </ModalFooter>
            </MotionModalContent>
          )}
        </AnimatePresence>
      </Modal>

      {/* Delete confirmation */}
      <AlertDialog isOpen={isDeleteOpen} leastDestructiveRef={cancelRef} onClose={onDeleteClose} isCentered>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">Delete Ticket</AlertDialogHeader>
            <AlertDialogBody>
              Are you sure you want to delete ticket <b>{selectedTicket?.ticketId}</b>? It will be removed from the list and scheduled for deletion. You can undo for a few seconds.
            </AlertDialogBody>
            <AlertDialogFooter>
              <Button ref={cancelRef} onClick={onDeleteClose} isDisabled={deleting}>Cancel</Button>
              <Button colorScheme="red" onClick={performDelete} ml={3} isLoading={deleting}>Delete</Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

      {/* Crystal Orb (floating) */}
      <Box className="floating-orb" onClick={handleMagicGenerate} role="button" aria-label="Magic Generate">
        <Box className="orb" title="Magic Generate">
          <Box className="spark" />
        </Box>
      </Box>
    </Container>
  );
}
