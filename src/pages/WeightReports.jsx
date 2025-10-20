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

// ---------------- PDF styles ----------------
const pdfStyles = StyleSheet.create({
  page: {
    paddingTop: 18,
    paddingBottom: 36,
    paddingHorizontal: 18,
    fontSize: 9,
    fontFamily: 'Helvetica',
    display: 'flex',
    flexDirection: 'column',
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  companyBlock: { flexDirection: 'column', marginLeft: 8 },
  companyName: { fontSize: 13, fontWeight: 'bold' },
  reportTitle: { fontSize: 11, fontWeight: 'bold', marginBottom: 6, textAlign: 'center' },
  summaryBox: { marginBottom: 8, padding: 8, borderWidth: 1, borderColor: '#ddd' },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    paddingBottom: 6,
    marginBottom: 6,
    alignItems: 'center',
  },
  tableRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4, alignItems: 'center' },

  colSad: { width: '8%', fontSize: 8 },
  colTicket: { width: '10%', fontSize: 8 },
  colTruck: { width: '12%', fontSize: 8 },
  colDate: { width: '16%', fontSize: 8 },
  colGross: { width: '12%', textAlign: 'right', fontSize: 8, paddingRight: 4 },
  colTare: { width: '12%', textAlign: 'right', fontSize: 8, paddingRight: 4 },
  colNet: { width: '12%', textAlign: 'right', fontSize: 8, paddingRight: 4 },
  colDriver: { width: '9%', fontSize: 8, paddingLeft: 4 },
  colOperator: { width: '9%', fontSize: 8, paddingLeft: 4 },

  footer: { position: 'absolute', bottom: 12, left: 18, right: 18, textAlign: 'center', fontSize: 9, color: '#666' },
  logo: { width: 64, height: 64, objectFit: 'contain' },
});

// ---------------- Helpers ----------------
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
 * Robust parseTicketDate
 * Handles:
 *  - Date objects
 *  - numeric epoch
 *  - 'YYYY-MM-DD' (date only)
 *  - 'YYYY-MM-DD HH:MM:SS' or with milliseconds -> normalised to ISO by replacing space with 'T'
 *  - ISO strings
 *  - some 'DD-Mon-YYYY HH:MM:SS AM' style (fallback)
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

  // If it's a plain 'YYYY-MM-DD' (date only)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s0)) {
    const d = new Date(`${s0}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }

  // If it's 'YYYY-MM-DD HH:MM:SS' optionally with milliseconds, replace first space with 'T'
  // to make it ISO-compatible: '2025-09-30 07:38:49' -> '2025-09-30T07:38:49'
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(\.\d+)?/.test(s0)) {
    const iso = s0.replace(' ', 'T');
    const d = new Date(iso);
    if (!isNaN(d.getTime())) return d;
  }

  // Try native Date constructor for ISO strings and common formats
  const d0 = new Date(s0);
  if (!isNaN(d0.getTime())) return d0;

  // Try to parse formats like '29-Sep-2025 20:30:00' or '29-Sep-25 8:30:00 PM'
  const m = s0.match(/(\d{1,2}-[A-Za-z]{3}-\d{2,4})\s+(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?\s*([AP]M)?/i);
  if (m) {
    let [, datePart, hh, mm, ss, , ampm] = m;
    let secNum = parseInt(ss, 10);
    if (secNum > 59) secNum = 59;
    let yearPart = datePart.split('-')[2];
    if (yearPart.length === 2) {
      const y = Number(yearPart);
      yearPart = y >= 70 ? `19${String(y).padStart(2, '0')}` : `20${String(y).padStart(2, '0')}`;
      datePart = datePart.split('-').slice(0, 2).concat([yearPart]).join('-');
    }
    const fixed = `${datePart} ${String(hh).padStart(2, '0')}:${mm}:${String(secNum).padStart(2, '0')}${ampm ? ' ' + ampm : ''}`;
    const d1 = new Date(fixed);
    if (!isNaN(d1.getTime())) return d1;
  }

  // final attempt: numeric-like string -> epoch
  const maybeNum = Number(s0);
  if (!Number.isNaN(maybeNum)) {
    const d2 = new Date(maybeNum);
    if (!isNaN(d2.getTime())) return d2;
  }

  return null;
}

function sortTicketsByDateDesc(arr) {
  return (arr || []).slice().sort((a, b) => {
    const da = parseTicketDate(a?.data?.date);
    const db = parseTicketDate(b?.data?.date);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return db.getTime() - da.getTime();
  });
}

/**
 * removeDuplicatesByTicketNo
 * - Normalizes ticket key by trimming and uppercasing
 * - If multiple entries for same ticket, prefers one with later date
 * - If no date info, prefers one containing fileUrl (heuristic)
 */
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
      // fallback unique key for rows without ticket numbers: keep as-is but unique
      const fallbackKey = `__NO_TICKET__${Math.random().toString(36).slice(2, 9)}`;
      map.set(fallbackKey, t);
      continue;
    }
    const existing = map.get(key);
    if (!existing) {
      map.set(key, t);
      continue;
    }
    // prefer more recent record based on ticket.data.date
    const da = parseTicketDate(existing.data?.date);
    const db = parseTicketDate(t.data?.date);
    if (db && (!da || db.getTime() > da.getTime())) {
      map.set(key, t);
      continue;
    }
    // if neither have date, prefer the one with fileUrl
    if (!da && !db) {
      if ((t.data?.fileUrl) && !existing.data?.fileUrl) {
        map.set(key, t);
      }
    }
  }
  return Array.from(map.values());
}

// ---------------- PDF components ----------------
function PdfTicketRow({ ticket, operatorName }) {
  const d = ticket.data || {};
  const computed = computeWeightsFromObj({ gross: d.gross, tare: d.tare, net: d.net });
  const grossText = computed.grossDisplay || '0';
  const tareText = computed.tareDisplay || '0';
  const netText = computed.netDisplay || '0';
  const driverText = d.driver ?? 'N/A';
  const operatorText = operatorName ?? d.operator ?? 'N/A';
  const ticketNo = d.ticketNo ?? ticket.ticketId ?? 'N/A';
  const truckText = d.gnswTruckNo ?? d.anpr ?? d.truckNo ?? 'N/A';
  const dateText = d.date ? new Date(d.date).toLocaleString() : 'N/A';

  return (
    <PdfView style={pdfStyles.tableRow} wrap={false}>
      <PdfText style={pdfStyles.colSad}>{d.sadNo ?? 'N/A'}</PdfText>
      <PdfText style={pdfStyles.colTicket}>{ticketNo}</PdfText>
      <PdfText style={pdfStyles.colTruck}>{truckText}</PdfText>
      <PdfText style={pdfStyles.colDate}>{dateText}</PdfText>
      <PdfText style={pdfStyles.colGross}>{grossText}</PdfText>
      <PdfText style={pdfStyles.colTare}>{tareText}</PdfText>
      <PdfText style={pdfStyles.colNet}>{netText}</PdfText>
      <PdfText style={pdfStyles.colDriver}>{driverText}</PdfText>
      <PdfText style={pdfStyles.colOperator}>{operatorText}</PdfText>
    </PdfView>
  );
}

function CombinedDocument({ tickets = [], reportMeta = {}, operatorName = 'N/A' }) {
  const totalNet = tickets.reduce((sum, t) => {
    const c = computeWeightsFromObj({ gross: t.data.gross, tare: t.data.tare, net: t.data.net });
    return sum + (c.netValue || 0);
  }, 0);

  const numberOfTransactions = tickets.length;
  const logoUrl = (typeof window !== 'undefined' && window.location ? `${window.location.origin}/logo.png` : '/logo.png');
  const rawSad = reportMeta?.sad ?? '';
  const sadLabel = rawSad ? String(rawSad).replace(/^SAD:\s*/i, '') : 'N/A';
  const rowsPerPage = 30;
  const pages = [];
  for (let i = 0; i < tickets.length; i += rowsPerPage) {
    pages.push(tickets.slice(i, i + rowsPerPage));
  }

  const TableHeader = () => (
    <PdfView style={pdfStyles.tableHeader}>
      <PdfText style={pdfStyles.colSad}>SAD No</PdfText>
      <PdfText style={pdfStyles.colTicket}>Ticket No</PdfText>
      <PdfText style={pdfStyles.colTruck}>Truck No</PdfText>
      <PdfText style={pdfStyles.colDate}>Date</PdfText>
      <PdfText style={pdfStyles.colGross}>Gross</PdfText>
      <PdfText style={pdfStyles.colTare}>Tare</PdfText>
      <PdfText style={pdfStyles.colNet}>Net</PdfText>
      <PdfText style={pdfStyles.colDriver}>Driver</PdfText>
      <PdfText style={pdfStyles.colOperator}>Operator</PdfText>
    </PdfView>
  );

  return (
    <Document>
      {pages.map((pageTickets, idx) => (
        <Page key={`page-${idx}`} size="A4" style={pdfStyles.page}>
          <PdfView style={pdfStyles.header}>
            <PdfImage src={logoUrl} style={pdfStyles.logo} />
            <PdfView style={pdfStyles.companyBlock}>
              <PdfText style={pdfStyles.companyName}>NICK TC-SCAN (GAMBIA) LTD</PdfText>
              <PdfText>WEIGHBRIDGE SITUATION REPORT</PdfText>
            </PdfView>
          </PdfView>

          {idx === 0 && (
            <>
              <PdfText style={pdfStyles.reportTitle}>WEIGHBRIDGE SITUATION REPORT</PdfText>

              <PdfView style={pdfStyles.summaryBox}>
                <PdfView style={pdfStyles.metaRow}>
                  <PdfText>SAD: {sadLabel}</PdfText>
                  <PdfText>DATE RANGE: {reportMeta.dateRangeText || 'All'}</PdfText>
                </PdfView>

                <PdfView style={pdfStyles.metaRow}>
                  <PdfText>START: {reportMeta.startTimeLabel || 'N/A'}</PdfText>
                  <PdfText>END: {reportMeta.endTimeLabel || 'N/A'}</PdfText>
                </PdfView>

                <PdfView style={pdfStyles.metaRow}>
                  <PdfText>NUMBER OF TRANSACTIONS: {numberOfTransactions}</PdfText>
                  <PdfText>TOTAL CUMULATIVE NET (KG): {formatNumber(String(totalNet))} KG</PdfText>
                </PdfView>

                <PdfView style={pdfStyles.metaRow}>
                  <PdfText>Operator: {operatorName || 'N/A'}</PdfText>
                  <PdfText />
                </PdfView>
              </PdfView>
            </>
          )}

          <TableHeader />
          {pageTickets.map((t) => <PdfTicketRow key={t.ticketId || t.data.ticketNo || Math.random()} ticket={t} operatorName={operatorName} />)}

          <PdfText style={pdfStyles.footer} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </Page>
      ))}
    </Document>
  );
}

// ---------------- main React component ----------------
export default function WeightReports() {
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

  const [operatorName, setOperatorName] = useState('');
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

  const isMobile = useBreakpointValue({ base: true, md: false });
  const headingSize = useBreakpointValue({ base: 'md', md: 'lg' });
  const modalSize = useBreakpointValue({ base: 'full', md: 'lg' });

  // load user & audit logs
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
          setOperatorName(uname);
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

  /**
   * computeFilteredTickets:
   * - driver/truck filters applied first
   * - date/time filtering:
   *    - If dateFrom/dateTo provided: build explicit start/end datetimes and compare full ticket datetime
   *    - If only times provided: match time-of-day across all dates, supporting wrap-around (overnight) ranges
   */
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

    // Build datetime filters
    const hasDateRange = !!(dateFrom || dateTo);
    const hasTimeRangeOnly = !hasDateRange && (timeFrom || timeTo);

    // Build explicit start/end Date objects when date range present
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

    const tfMinutes = parseTimeToMinutes(timeFrom);
    const ttMinutes = parseTimeToMinutes(timeTo);

    arr = arr.filter((ticket) => {
      const raw = ticket.data.date;
      const ticketDate = parseTicketDate(raw);
      if (!ticketDate) return false;

      // If both dateFrom/dateTo present, use full range (start <= ticket <= end)
      if (dateFrom || dateTo) {
        // If start provided, use it; otherwise very early
        const s = start ? new Date(start) : new Date(-8640000000000000);
        // If end provided, use it; otherwise very late
        const e = end ? new Date(end) : new Date(8640000000000000);

        return ticketDate >= s && ticketDate <= e;
      }

      // If only time range provided (no dates) — do time-of-day matching across all dates (supports wrap-around)
      if (hasTimeRangeOnly) {
        const ticketMinutes = ticketDate.getHours() * 60 + ticketDate.getMinutes();
        const fromM = tfMinutes !== null ? tfMinutes : 0;
        const toM = ttMinutes !== null ? ttMinutes : 24 * 60 - 1;

        if (fromM <= toM) {
          return ticketMinutes >= fromM && ticketMinutes <= toM;
        }
        // wrap-around (e.g., 20:00 -> 02:00 next day)
        return ticketMinutes >= fromM || ticketMinutes <= toM;
      }

      // No date/time restrictions
      return true;
    });

    // Sorting
    const comparator = (a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortBy === 'date') {
        const da = parseTicketDate(a?.data?.date);
        const db = parseTicketDate(b?.data?.date);
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
      if (sortBy === 'sadNo' || sortBy === 'sadNo') {
        return String(a.data.sadNo || '').localeCompare(String(b.data.sadNo || '')) * dir;
      }
      if (sortBy === 'truck') {
        const ta = (a.data.gnswTruckNo || a.data.truckOnWb || a.data.anpr || a.data.truckNo || '').toString().toLowerCase();
        const tb = (b.data.gnswTruckNo || b.data.truckOnWb || b.data.anpr || b.data.truckNo || '').toString().toLowerCase();
        return ta.localeCompare(tb) * dir;
      }
      return 0;
    };

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
      dateRangeText: dateRangeText || prev.dateRangeText || (originalTickets.length > 0 && originalTickets[0].data.date ? new Date(originalTickets[0].data.date).toLocaleDateString() : ''),
      startTimeLabel: startLabel || prev.startTimeLabel || '',
      endTimeLabel: endLabel || prev.endTimeLabel || '',
    }));
  };

  const handleGenerateReport = async () => {
    if (!searchSAD.trim()) {
      toast({ title: 'SAD Required', description: 'Please type a SAD number to generate the report.', status: 'warning', duration: 3000, isClosable: true });
      return;
    }
    setLoading(true);
    try {
      // fetch tickets by SAD (use tickets.date for all date features)
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
          date: ticket.date, // <- use ticket.date exclusively
          gnswTruckNo: ticket.gnsw_truck_no,
          truckOnWb: ticket.truck_on_wb,
          net: ticket.net ?? ticket.net_weight ?? null,
          tare: ticket.tare ?? ticket.tare_pt ?? null,
          gross: ticket.gross ?? null,
          driver: ticket.driver || 'N/A',
          consignee: ticket.consignee,
          operator: ticket.operator,
          status: ticket.status,
          consolidated: ticket.consolidated,
          containerNo: ticket.container_no,
          passNumber: ticket.pass_number,
          scaleName: ticket.scale_name,
          anpr: ticket.truck_on_wb,
          truckNo: ticket.truck_no,
          fileUrl: ticket.file_url || null,
        },
      }));

      // Deduplicate by ticket number using ticket.date to keep newest
      const dedupedTickets = removeDuplicatesByTicketNo(mappedTickets);
      if (dedupedTickets.length < mappedTickets.length) {
        const removed = mappedTickets.length - dedupedTickets.length;
        toast({ title: 'Duplicates removed', description: `${removed} duplicate(s) removed by ticket number`, status: 'info', duration: 3500, isClosable: true });
      }

      // Sort newest-first (by ticket.data.date)
      const sortedOriginal = sortTicketsByDateDesc(dedupedTickets);
      setOriginalTickets(sortedOriginal);

      // compute discharged weight (sum of nets) from deduped/sorted set
      const totalNet = (sortedOriginal || []).reduce((sum, t) => {
        const val = Number(t.data.net ?? t.data.net_weight ?? 0);
        return sum + (Number.isFinite(val) ? val : 0);
      }, 0);

      // attempt to fetch the SAD declaration row for more accurate declared weight/status (optional)
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
        dateRangeText: sortedOriginal.length > 0 ? (sortedOriginal[0].data.date ? new Date(sortedOriginal[0].data.date).toLocaleDateString() : '') : '',
        startTimeLabel: '',
        endTimeLabel: '',
        sad: `${searchSAD.trim()}`,
        declaredWeight: sadRow ? Number(sadRow.declared_weight ?? 0) : null,
        dischargedWeight: Number(totalNet || 0),
        sadStatus: sadRow ? (sadRow.status ?? 'In Progress') : 'Unknown',
        sadExists: !!sadRow,
      });

      // compute initial filtered based on current filters (none by default)
      computeFilteredTickets(sortedOriginal);
    } catch (err) {
      console.error('fetch error', err);
      toast({ title: 'Error', description: err?.message || 'Unexpected error', status: 'error', duration: 4000 });
    } finally {
      setLoading(false);
    }
  };

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

  const exportCsv = () => {
    if (!filteredTickets || filteredTickets.length === 0) {
      toast({ title: 'No data', description: 'No tickets to export as CSV', status: 'info', duration: 3000 });
      return;
    }
    const header = ['sadNo', 'ticketNo', 'date', 'truck', 'driver', 'gross', 'tare', 'net', 'consignee', 'operator', 'containerNo', 'passNumber', 'scaleName'];
    const rows = filteredTickets.map((t) => {
      const d = t.data || {};
      const truck = d.gnswTruckNo || d.truckOnWb || d.anpr || d.truckNo || '';
      return [
        d.sadNo ?? '',
        d.ticketNo ?? t.ticketId ?? '',
        d.date ? new Date(d.date).toISOString() : '',
        truck,
        d.driver ?? '',
        d.gross ?? '',
        d.tare ?? '',
        d.net ?? '',
        d.consignee ?? '',
        d.operator ?? '',
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

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SAD-${searchSAD || 'report'}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast({ title: 'CSV exported', status: 'success', duration: 3000 });
  };

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

  const generatePdfBlob = async (ticketsToRender = [], meta = {}, opName = '') => {
    const doc = <CombinedDocument tickets={ticketsToRender} reportMeta={meta} operatorName={opName} />;
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
      const blob = await generatePdfBlob(filteredTickets, reportMeta, operatorName);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `SAD-${searchSAD || 'report'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: 'Download started', status: 'success', duration: 3000 });
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
      const blob = await generatePdfBlob(filteredTickets, reportMeta, operatorName);
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
      const blob = await generatePdfBlob(filteredTickets, reportMeta, operatorName);
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
      const body = encodeURIComponent(`Please find (or attach) the Weighbridge report for SAD ${searchSAD}.\n\nNumber of transactions: ${filteredTickets.length}\nCumulative net weight: ${formatNumber(String(cumulativeNetWeight))} KG\n\n(If your mail client does not auto-attach the PDF, please attach the downloaded file: ${filename})`);
      window.location.href = `mailto:?subject=${subject}&body=${body}`;

      toast({ title: 'Composer opened', description: 'PDF downloaded — attach to your email if not auto-attached', status: 'info', duration: 5000 });
    } catch (err) {
      console.error('Email/Download error', err);
      toast({ title: 'Failed', description: err?.message || 'Unexpected error', status: 'error', duration: 5000 });
    } finally {
      setPdfGenerating(false);
    }
  };

  // ---------- Edit / Delete logic ----------
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
          username: operatorName || null,
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
            username: operatorName || null,
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

  // -----------------------
  // UI render
  // -----------------------
  return (
    <Container maxW="8xl" py={{ base: 4, md: 8 }}>
      {/* Header */}
      <Flex direction={{ base: 'column', md: 'row' }} align={{ base: 'stretch', md: 'center' }} gap={4} mb={6}>
        <Box>
          <Heading size={headingSize}>SAD Report Generator</Heading>
          <Text mt={2} color="gray.600">Search SAD → then filter by driver or truck. Results persist until cleared.</Text>
        </Box>

        <Flex ml="auto" gap={4} align="center" wrap="wrap">
          <StatGroup display="flex" alignItems="center" gap={4}>
            <Box>
              <Stat bg="gray.50" px={4} py={3} borderRadius="md" boxShadow="sm">
                <StatLabel>Total Transactions</StatLabel>
                <StatNumber>{filteredTickets.length}</StatNumber>
                <StatHelpText>{originalTickets.length > 0 ? `of ${originalTickets.length} returned` : ''}</StatHelpText>
              </Stat>
            </Box>

            <Box>
              <Stat bg="gray.50" px={4} py={3} borderRadius="md" boxShadow="sm">
                <StatLabel>Cumulative Net (kg)</StatLabel>
                <StatNumber>{formatNumber(String(cumulativeNetWeight)) || '0'}</StatNumber>
                <StatHelpText>From current filtered results</StatHelpText>
              </Stat>
            </Box>
          </StatGroup>
        </Flex>
      </Flex>

      {/* Main card */}
      <Box bg="white" p={{ base: 4, md: 6 }} borderRadius="md" boxShadow="sm">
        {/* Search & filters */}
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

        {/* Buttons */}
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
                <MenuItem icon={<FaFileCsv />} onClick={exportCsv}>Export CSV</MenuItem>
                <MenuItem icon={<FaShareAlt />} onClick={handleNativeShare}>Share</MenuItem>
                <MenuItem icon={<FaEnvelope />} onClick={handleEmailComposer}>Email</MenuItem>
                <MenuItem onClick={fetchAuditLogs}>Refresh Audit Logs</MenuItem>
              </MenuList>
            </Menu>
          </HStack>
        </Flex>

        {/* Date/time filters */}
        <Box border="1px solid" borderColor="gray.100" p={3} borderRadius="md" mb={4}>
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

        {/* --- SAD stats cards (Declared, Discharged, Status) --- */}
        {reportMeta?.sad && (
          <SimpleGrid columns={{ base: 1, md: 3 }} gap={3} mb={4}>
            <Stat bg="gray.50" px={4} py={3} borderRadius="md" boxShadow="sm">
              <StatLabel>Declared Weight</StatLabel>
              <StatNumber>{reportMeta.declaredWeight != null ? formatNumber(String(reportMeta.declaredWeight)) : 'N/A'}</StatNumber>
              <StatHelpText>From SAD Declaration</StatHelpText>
            </Stat>

            <Stat bg="gray.50" px={4} py={3} borderRadius="md" boxShadow="sm">
              <StatLabel>Discharged Weight</StatLabel>
              <StatNumber>{reportMeta.dischargedWeight != null ? formatNumber(String(reportMeta.dischargedWeight)) : '0'}</StatNumber>
              <StatHelpText>Sum of ticket nets (fetched)</StatHelpText>
            </Stat>

            <Stat bg="gray.50" px={4} py={3} borderRadius="md" boxShadow="sm">
              <StatLabel>SAD Status</StatLabel>
              <StatNumber>{reportMeta.sadStatus || 'Unknown'}</StatNumber>
              <StatHelpText>{reportMeta.sadExists ? 'Declaration exists in DB' : 'No declaration found'}</StatHelpText>
            </Stat>
          </SimpleGrid>
        )}

        {/* Results */}
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
                  <Text fontSize="sm" color="gray.500">Cumulative Net</Text>
                  <Text fontWeight="bold">{formatNumber(String(cumulativeNetWeight)) || '0'} kg</Text>
                </Box>
              </HStack>
            </Flex>

            {/* Mobile */}
            {isMobile ? (
              <VStack spacing={3} align="stretch">
                {filteredTickets.map((t) => {
                  const computed = computeWeightsFromObj({ gross: t.data.gross, tare: t.data.tare, net: t.data.net });
                  const displayTruck = t.data.gnswTruckNo || t.data.truckOnWb || t.data.anpr || t.data.truckNo || 'N/A';
                  const displayDriver = t.data.driver || 'N/A';
                  return (
                    <Box key={t.ticketId} borderWidth="1px" borderColor="gray.100" borderRadius="md" p={3} bg="white" boxShadow="xs">
                      <Flex justify="space-between" align="start" gap={3} wrap="wrap">
                        <Box>
                          <Text fontSize="sm" color="gray.500">Ticket</Text>
                          <HStack>
                            <Text fontWeight="bold">{t.data.ticketNo || t.ticketId}</Text>
                          </HStack>
                          <Text fontSize="sm" color="gray.500">{t.data.date ? new Date(t.data.date).toLocaleString() : 'N/A'}</Text>
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
              // Desktop/table
              <Box overflowX="auto" borderRadius="md" bg="white" boxShadow="sm">
                <Table variant="striped" colorScheme="teal" size="sm" sx={{
                  'th': {
                    position: 'sticky',
                    top: 0,
                    background: 'white',
                    zIndex: 2,
                  }
                }}>
                  <Thead bg="gray.50">
                    <Tr>
                      <Th onClick={() => toggleSort('sadNo')} cursor="pointer">
                        <HStack spacing={2}><Text>SAD No</Text> {sortBy === 'sadNo' ? (sortDir === 'asc' ? <FaSortUp /> : <FaSortDown />) : <FaSort />}</HStack>
                      </Th>
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
                      <Th>Actions</Th>
                    </Tr>
                  </Thead>

                  <Tbody>
                    {filteredTickets.map((ticket) => {
                      const computed = computeWeightsFromObj({
                        gross: ticket.data.gross,
                        tare: ticket.data.tare,
                        net: ticket.data.net,
                      });
                      const displayDriver = ticket.data.driver || 'N/A';
                      const displayTruck = ticket.data.gnswTruckNo || ticket.data.truckOnWb || ticket.data.anpr || ticket.data.truckNo || 'N/A';

                      return (
                        <Tr key={ticket.ticketId}>
                          <Td>{ticket.data.sadNo}</Td>
                          <Td>{ticket.data.ticketNo}</Td>
                          <Td>{ticket.data.date ? new Date(ticket.data.date).toLocaleString() : 'N/A'}</Td>
                          <Td>{displayTruck}</Td>
                          <Td isNumeric>{computed.grossDisplay || '0'}</Td>
                          <Td isNumeric>{computed.tareDisplay || '0'}</Td>
                          <Td isNumeric>{computed.netDisplay || '0'}</Td>
                          <Td>{displayDriver}</Td>
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
                      <Td colSpan={6}>Cumulative Net Weight</Td>
                      <Td isNumeric>{formatNumber(cumulativeNetWeight) || '0'} kg</Td>
                      <Td colSpan={2} />
                    </Tr>
                  </Tbody>
                </Table>
              </Box>
            )}

            {/* Audit logs */}
            <Box mt={6} p={4} borderRadius="md" border="1px solid" borderColor="gray.100" bg="white">
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
          </>
        ) : (
          !loading && (searchSAD || searchDriver || searchTruck) && (
            <Text mt={6} fontStyle="italic">
              No records found for: <Text as="span" fontWeight="bold"> {reportMeta?.sad || [searchSAD, searchDriver, searchTruck].filter(Boolean).join(', ')}</Text>
            </Text>
          )
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
                      {selectedTicket?.ticketId} • {selectedTicket?.data?.date ? new Date(selectedTicket.data.date).toLocaleString() : ''}
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
                          <Text><b>Operator:</b> {operatorName || selectedTicket.data.operator || 'N/A'}</Text>
                          {isAdmin && isTicketEditable(selectedTicket) && <IconButton size="xs" aria-label="Edit operator" icon={<FaEdit />} onClick={() => startEditing(selectedTicket)} variant="ghost" />}
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
                {/* Admin-only Edit/Delete controls (single Edit button persists) */}
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
    </Container>
  );
}
