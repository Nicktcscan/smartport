// src/pages/WeightReports.jsx
import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Box,
  Heading,
  Input as ChakraInput,
  Button,
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
  FormControl,
  FormLabel,
  FormErrorMessage,
  AlertDialog,
  AlertDialogOverlay,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogBody,
  AlertDialogFooter,
  Tooltip,
  Spinner,
  Badge,
} from '@chakra-ui/react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowForwardIcon } from '@chakra-ui/icons';
import {
  FaFileInvoice,
  FaFilePdf,
  FaExternalLinkAlt,
  FaDownload,
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

// PDF styles
const pdfStyles = StyleSheet.create({
  page: {
    paddingTop: 18,
    paddingBottom: 36,
    paddingHorizontal: 18,
    fontSize: 10,
    fontFamily: 'Helvetica',
    display: 'flex',
    flexDirection: 'column',
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  companyBlock: { flexDirection: 'column', marginLeft: 8 },
  companyName: { fontSize: 14, fontWeight: 'bold' },
  reportTitle: { fontSize: 12, fontWeight: 'bold', marginBottom: 6, textAlign: 'center' },
  summaryBox: { marginBottom: 8, padding: 8, borderWidth: 1, borderColor: '#ddd' },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  tableHeader: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#333', paddingBottom: 6, marginBottom: 6 },
  tableRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4, alignItems: 'center' },
  colSad: { width: '10%', fontSize: 9 },
  colTicket: { width: '10%', fontSize: 9 },
  colTruck: { width: '14%', fontSize: 9 },
  colDate: { width: '14%', fontSize: 9 },
  colGross: { width: '10%', textAlign: 'right', fontSize: 9, paddingRight: 2 },
  colTare: { width: '10%', textAlign: 'left', fontSize: 9, paddingRight: 2 },
  colNet: { width: '10%', textAlign: 'left', fontSize: 9, paddingRight: 4 },
  colOperator: { width: '12%', fontSize: 9, textAlign: 'left', paddingLeft: 2 },
  colDriver: { width: '12%', fontSize: 9, textAlign: 'left', paddingLeft: 2 },
  footer: { position: 'absolute', bottom: 12, left: 18, right: 18, textAlign: 'center', fontSize: 9, color: '#666' },
  logo: { width: 64, height: 64, objectFit: 'contain' },
});

// helper numeric formatting/parsing
function numericValue(v) {
  if (v === null || v === undefined || v === '') return null;
  const cleaned = String(v).replace(/[,\s]+/g, '').replace(/kg/i, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
function formatNumber(v) {
  const n = numericValue(v);
  if (n === null) return '';
  return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(2).toLocaleString('en-US');
}

function computeWeightsFromObj({ gross, tare, net }) {
  let G = numericValue(gross);
  let T = numericValue(tare);
  let N = numericValue(net);

  if ((G === null || G === undefined) && T !== null && N !== null) G = T + N;
  if ((N === null || N === undefined) && G !== null && T !== null) N = G - T;
  if ((T === null || T === undefined) && G !== null && N !== null) T = G - N;

  return {
    grossValue: G !== null ? G : null,
    tareValue: T !== null ? T : null,
    netValue: N !== null ? N : null,
    grossDisplay: G !== null ? formatNumber(G) : '',
    tareDisplay: T !== null ? formatNumber(T) : '',
    netDisplay: N !== null ? formatNumber(N) : '',
  };
}

function parseTicketDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date) return raw;
  if (typeof raw === 'number') return new Date(raw);
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00');
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  const maybeNum = Number(s);
  return !Number.isNaN(maybeNum) ? new Date(maybeNum) : null;
}

// PDF ticket row
function PdfTicketRow({ ticket, operatorName }) {
  const d = ticket.data || {};
  const computed = computeWeightsFromObj({ gross: d.gross, tare: d.tare, net: d.net });

  return (
    <PdfView style={pdfStyles.tableRow}>
      <PdfText style={pdfStyles.colSad}>{d.sadNo ?? 'N/A'}</PdfText>
      <PdfText style={pdfStyles.colTicket}>{d.ticketNo ?? ticket.ticketId ?? 'N/A'}</PdfText>
      <PdfText style={pdfStyles.colTruck}>{d.gnswTruckNo ?? d.anpr ?? 'N/A'}</PdfText>
      <PdfText style={pdfStyles.colDate}>{d.date ? new Date(d.date).toLocaleString() : 'N/A'}</PdfText>
      <PdfText style={pdfStyles.colGross}>{computed.grossDisplay || '0'}</PdfText>
      <PdfText style={pdfStyles.colTare}>{computed.tareDisplay || '0'}</PdfText>
      <PdfText style={pdfStyles.colNet}>{computed.netDisplay || '0'}</PdfText>
      <PdfText style={pdfStyles.colDriver}>{d.driver ?? 'N/A'}</PdfText>
      <PdfText style={pdfStyles.colOperator}>{operatorName ?? 'N/A'}</PdfText>
    </PdfView>
  );
}

// Combined PDF document
function CombinedDocument({ tickets = [], reportMeta = {}, operatorName = 'N/A' }) {
  const totalNet = tickets.reduce((sum, t) => {
    const c = computeWeightsFromObj({ gross: t.data.gross, tare: t.data.tare, net: t.data.net });
    return sum + (c.netValue || 0);
  }, 0);

  const numberOfTransactions = tickets.length;
  const logoUrl = (typeof window !== 'undefined' && window.location ? `${window.location.origin}/logo.png` : '/logo.png');

  // Manual entries
  const manualEntries = tickets.filter(t => t.data.ticketNo?.startsWith('M-'));
  const totalManualEntries = manualEntries.length;
  const cumulativeManualNetWeight = manualEntries.reduce((sum, t) => {
    const c = computeWeightsFromObj({ gross: t.data.gross, tare: t.data.tare, net: t.data.net });
    return sum + (c.netValue || 0);
  }, 0);

  // Pagination
  const rowsPerSubsequentPage = 20;
  const firstPageCapacity = 14;
  const firstPageTickets = tickets.slice(0, firstPageCapacity);
  const remainingTickets = tickets.slice(firstPageCapacity);

  const remainingPages = [];
  for (let i = 0; i < remainingTickets.length; i += rowsPerSubsequentPage) {
    remainingPages.push(remainingTickets.slice(i, i + rowsPerSubsequentPage));
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
      <Page size="A4" style={pdfStyles.page}>
        <PdfView style={pdfStyles.header}>
          <PdfImage src={logoUrl} style={pdfStyles.logo} />
          <PdfView style={pdfStyles.companyBlock}>
            <PdfText style={pdfStyles.companyName}>NICK TC-SCAN (GAMBIA) LTD</PdfText>
            <PdfText>WEIGHBRIDGE SITUATION REPORT</PdfText>
          </PdfView>
        </PdfView>

        <PdfText style={pdfStyles.reportTitle}>WEIGHBRIDGE SITUATION REPORT</PdfText>

        <PdfView style={pdfStyles.summaryBox}>
          <PdfView style={pdfStyles.metaRow}>
            <PdfText>SAD: {reportMeta.sad || 'N/A'}</PdfText>
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
            <PdfText>TOTAL MANUAL ENTRIES: {totalManualEntries}</PdfText>
            <PdfText>CUMULATIVE NET (MANUAL) KG: {formatNumber(String(cumulativeManualNetWeight))}</PdfText>
          </PdfView>

          <PdfView style={pdfStyles.metaRow}>
            <PdfText>Operator: {operatorName || 'N/A'}</PdfText>
            <PdfText />
          </PdfView>
        </PdfView>

        {firstPageTickets.length > 0 && (
          <>
            <TableHeader />
            {firstPageTickets.map(t => (
              <PdfTicketRow key={t.ticketId || t.data.ticketNo || Math.random()} ticket={t} operatorName={operatorName} />
            ))}
          </>
        )}

        <PdfText style={pdfStyles.footer} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
      </Page>

      {remainingPages.map((pageTickets, idx) => (
        <Page key={`rem-${idx}`} size="A4" style={pdfStyles.page}>
          <PdfText style={{ fontSize: 12, fontWeight: 'bold', marginBottom: 8 }}>Ticket List</PdfText>
          <TableHeader />
          {pageTickets.map(t => (
            <PdfTicketRow key={t.ticketId || t.data.ticketNo || Math.random()} ticket={t} operatorName={operatorName} />
          ))}
          <PdfText style={pdfStyles.footer} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </Page>
      ))}
    </Document>
  );
}

 
export default function WeightReports() {
  const [searchSAD, setSearchSAD] = useState('');
  const [filteredTickets, setFilteredTickets] = useState([]);
  const [originalTickets, setOriginalTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const toast = useToast();
  const modalRef = useRef();

  // operator username and current user id
  const [operatorName, setOperatorName] = useState('');
  const [currentUserId, setCurrentUserId] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [editErrors, setEditErrors] = useState({});
  const [savingEdit, setSavingEdit] = useState(false);

  // delete confirmation AlertDialog
  const {
    isOpen: isDeleteOpen,
    onOpen: onDeleteOpen,
    onClose: onDeleteClose,
  } = useDisclosure();
  const cancelRef = useRef(); // for AlertDialog focus
  const [deleting, setDeleting] = useState(false);

  // pending delete (optimistic undo)
  const [pendingDelete, setPendingDelete] = useState(null);

  // audit logs
  const [auditLogs, setAuditLogs] = useState([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

  // Date/time filter state
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');
  const [reportMeta, setReportMeta] = useState({});

  // fetch current user info to derive username and role
  useEffect(() => {
    let mounted = true;
    const loadUser = async () => {
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

        // fetch username + role from users table
        const { data: userRow, error: userErr } = await supabase.from('users').select('username, role').eq('id', currentUser.id).maybeSingle();
        const uname = userRow?.username || currentUser.email || currentUser.user_metadata?.full_name || '';
        const role = (userRow && userRow.role) || '';
        if (mounted) {
          setOperatorName(uname);
          setIsAdmin(String(role).toLowerCase() === 'admin');
        }
      } catch (err) {
        console.warn('Failed to fetch current user info', err);
      }
    };
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
        console.warn('audit fetch error', error);
        setAuditLogs([]);
      } else {
        setAuditLogs(data || []);
      }
    } catch (err) {
      console.warn('audit fetch error', err);
      setAuditLogs([]);
    } finally {
      setLoadingAudit(false);
    }
  };

  const handleGenerateReport = async () => {
    if (!searchSAD.trim()) {
      toast({ title: 'SAD No Required', description: 'Please type a SAD number to generate the report.', status: 'warning', duration: 3000, isClosable: true });
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('tickets')
      .select('*')
      .ilike('sad_no', `%${searchSAD.trim()}%`)
      .order('date', { ascending: true });

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
        date: ticket.date,
        gnswTruckNo: ticket.gnsw_truck_no,
        net: ticket.net ?? ticket.net_weight ?? null,
        tare: ticket.tare ?? ticket.tare_pt ?? null,
        gross: ticket.gross ?? null,
        driver: ticket.driver || ticket.driver || 'N/A',
        consignee: ticket.consignee,
        operator: ticket.operator,
        status: ticket.status,
        consolidated: ticket.consolidated,
        containerNo: ticket.container_no,
        passNumber: ticket.pass_number,
        scaleName: ticket.scale_name,
        anpr: ticket.truck_on_wb,
        fileUrl: ticket.file_url || null,
      },
    }));

    setOriginalTickets(mappedTickets);
    setFilteredTickets(mappedTickets);
    setDateFrom('');
    setDateTo('');
    setTimeFrom('');
    setTimeTo('');
    setReportMeta({
      dateRangeText: mappedTickets.length > 0 ? (mappedTickets[0].data.date ? new Date(mappedTickets[0].data.date).toLocaleDateString() : '') : '',
      startTimeLabel: '',
      endTimeLabel: '',
      sad: searchSAD.trim(),
    });
    setLoading(false);
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

  const parseTimeToMinutes = (timeStr) => {
    if (!timeStr) return null;
    const parts = timeStr.split(':');
    if (parts.length < 2) return null;
    const hh = parseInt(parts[0], 10);
    const mm = parseInt(parts[1], 10);
    if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
    return hh * 60 + mm;
  };

  const startOfDay = (d) => {
    const dt = new Date(d);
    dt.setHours(0, 0, 0, 0);
    return dt;
  };
  const endOfDay = (d) => {
    const dt = new Date(d);
    dt.setHours(23, 59, 59, 999);
    return dt;
  };

  const applyRange = () => {
    if (!originalTickets || originalTickets.length === 0) return;
    const tfMinutes = parseTimeToMinutes(timeFrom);
    const ttMinutes = parseTimeToMinutes(timeTo);
    const hasDateRange = !!(dateFrom || dateTo);
    const hasTimeRangeOnly = !hasDateRange && (timeFrom || timeTo);
    const startDate = dateFrom ? new Date(dateFrom + 'T00:00:00') : null;
    const endDate = dateTo ? new Date(dateTo + 'T23:59:59.999') : null;

    const filtered = originalTickets.filter((ticket) => {
      const raw = ticket.data.date;
      const ticketDate = parseTicketDate(raw);
      if (!ticketDate) return false;

      if (hasDateRange) {
        let start = startDate ? startOfDay(startDate) : new Date(-8640000000000000);
        let end = endDate ? endOfDay(endDate) : new Date(8640000000000000);

        if (timeFrom) {
          const tf = parseTimeToMinutes(timeFrom);
          if (tf !== null) start.setHours(Math.floor(tf / 60), tf % 60, 0, 0);
        }
        if (timeTo) {
          const tt = parseTimeToMinutes(timeTo);
          if (tt !== null) end.setHours(Math.floor(tt / 60), tt % 60, 59, 999);
        }

        return ticketDate >= start && ticketDate <= end;
      }

      if (hasTimeRangeOnly) {
        const ticketMinutes = ticketDate.getHours() * 60 + ticketDate.getMinutes();
        const fromM = tfMinutes !== null ? tfMinutes : 0;
        const toM = ttMinutes !== null ? ttMinutes : 24 * 60 - 1;
        return ticketMinutes >= fromM && ticketMinutes <= toM;
      }

      return true;
    });

    setFilteredTickets(filtered);

    const startLabel = dateFrom ? `${timeFrom || '00:00'} (${dateFrom})` : timeFrom ? `${timeFrom}` : '';
    const endLabel = dateTo ? `${timeTo || '23:59'} (${dateTo})` : timeTo ? `${timeTo}` : '';

    let dateRangeText = '';
    if (dateFrom && dateTo) dateRangeText = `${dateFrom} → ${dateTo}`;
    else if (dateFrom) dateRangeText = dateFrom;
    else if (dateTo) dateRangeText = dateTo;

    setReportMeta({
      dateRangeText: dateRangeText || (originalTickets.length > 0 && originalTickets[0].data.date ? new Date(originalTickets[0].data.date).toLocaleDateString() : ''),
      startTimeLabel: startLabel || '',
      endTimeLabel: endLabel || '',
      sad: searchSAD.trim(),
    });
  };

  const resetRange = () => {
    setDateFrom('');
    setDateTo('');
    setTimeFrom('');
    setTimeTo('');
    setFilteredTickets(originalTickets);
    setReportMeta((prev) => ({ ...prev, startTimeLabel: '', endTimeLabel: '', dateRangeText: '' }));
  };

  // PDF utilities
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

  // ---------- Edit / Delete with server-side RPC attempt & audit ----------
  const isTicketEditable = (ticket) => {
    const status = String(ticket?.data?.status || '').toLowerCase();
    return status !== 'exited';
  };

  const startEditing = () => {
    if (!selectedTicket) return;
    if (!isAdmin) {
      toast({ title: 'Permission denied', description: 'Only admins can edit tickets', status: 'warning', duration: 3000 });
      return;
    }
    if (!isTicketEditable(selectedTicket)) {
      toast({ title: 'Cannot edit', description: "This ticket has status 'Exited' and cannot be edited", status: 'warning', duration: 3000 });
      return;
    }
const d = selectedTicket.data || {};

// Optional: clean up driver/operator names
const operator = d.operator ? d.operator.replace(/^-+/, "").trim() : '';
const driverName = d.driver ? d.driver.replace(/^-+/, "").trim() : '';

setEditData({
  consignee: d.consignee ?? '',
  containerNo: d.containerNo ?? '',
  operator: operator || '',
  driver: driverName || '',
  gross: d.gross ?? '',
  tare: d.tare ?? '',
  net: d.net ?? '',
});
setEditErrors({});
setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditErrors({});
    setEditData({});
  };

  const handleEditChange = (field, val) => {
    setEditData((p) => ({ ...p, [field]: val }));
    setEditErrors((p) => {
      const cp = { ...p };
      delete cp[field];
      return cp;
    });
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

    // enforce gross > tare
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

      // === Attempt RPC first (server-side enforced) ===
      let usedRpc = false;
      try {
        // RPC function expected: admin_update_ticket(p_ticket_id text, p_gross numeric, p_tare numeric, p_net numeric, p_consignee text, p_container_no text, p_operator text)
        const { data: rpcData, error: rpcErr } = await supabase.rpc('admin_update_ticket', {
          p_ticket_id: ticketIdValue,
          p_gross: payload.gross,
          p_tare: payload.tare,
          p_net: payload.net,
          p_consignee: payload.consignee,
          p_container_no: payload.container_no,
          p_operator: payload.operator,
          p_driver: payload.driver,
        });
        if (rpcErr) {
          // If RPC not found or rejected, we'll fall back.
          console.debug('admin_update_ticket rpc error / not available:', rpcErr.message || rpcErr);
        } else {
          usedRpc = true;
        }
      } catch (rpcCallErr) {
        console.debug('RPC call failed (maybe function not defined)', rpcCallErr);
      }

      if (!usedRpc) {
        // As a safety belt, re-check role on server-side (read users table) to make sure client isn't spoofing
        const { data: roleRow, error: roleErr } = await supabase.from('users').select('role').eq('id', currentUserId).maybeSingle();
        if (roleErr) throw roleErr;
        const role = (roleRow && roleRow.role) || '';
        if (String(role).toLowerCase() !== 'admin') {
          throw new Error('Server role check failed — only admins may edit tickets');
        }

        // perform update via direct update (fallback)
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
          // fallback to ticket_no update
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

      // Update local arrays and selectedTicket
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
      setFilteredTickets((prev) => prev.map((t) => (String(t.ticketId) === String(selectedTicket.ticketId) ? updatedTicket : t)));
      setSelectedTicket(updatedTicket);
      setIsEditing(false);

      // Insert audit log
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
        console.warn('Audit log insertion failed', auditErr);
      }

      toast({ title: 'Saved', description: 'Ticket updated', status: 'success', duration: 2500 });
    } catch (err) {
      console.error('Update failed', err);
      toast({ title: 'Update failed', description: err?.message || 'Unexpected error', status: 'error', duration: 5000 });
    } finally {
      setSavingEdit(false);
    }
  };

  // delete flow: schedule deletion with undo (server RPC preferred)
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

    // Remove from UI immediately (optimistic)
    const ticketToDelete = selectedTicket;
    setOriginalTickets((prev) => prev.filter((t) => String(t.ticketId) !== String(ticketToDelete.ticketId)));
    setFilteredTickets((prev) => prev.filter((t) => String(t.ticketId) !== String(ticketToDelete.ticketId)));
    setSelectedTicket(null);

    // schedule actual DB delete after delay (allow undo)
    const DELAY = 8000;
    const timeoutId = setTimeout(async () => {
      // finalize delete -> remove from DB & insert audit entry (RPC preferred)
      try {
        const ticketIdValue = ticketToDelete.ticketId ?? ticketToDelete.data.ticketNo ?? null;
        if (!ticketIdValue) throw new Error('Missing ticket identifier');

        let usedRpc = false;
        try {
          const { data: rpcData, error: rpcErr } = await supabase.rpc('admin_delete_ticket', {
            p_ticket_id: ticketIdValue,
          });
          if (rpcErr) {
            console.debug('admin_delete_ticket rpc error / not available:', rpcErr.message || rpcErr);
          } else {
            usedRpc = true;
          }
        } catch (rpcCallErr) {
          console.debug('RPC delete call failed (maybe function not defined)', rpcCallErr);
        }

        if (!usedRpc) {
          // server role check
          const { data: roleRow, error: roleErr } = await supabase.from('users').select('role').eq('id', currentUserId).maybeSingle();
          if (roleErr) throw roleErr;
          const role = (roleRow && roleRow.role) || '';
          if (String(role).toLowerCase() !== 'admin') {
            throw new Error('Server role check failed — only admins may delete tickets');
          }

          // delete by ticket_id fallback to ticket_no
          let { error } = await supabase.from('tickets').delete().eq('ticket_id', ticketIdValue);
          if (error) {
            const fallback = await supabase.from('tickets').delete().eq('ticket_no', ticketIdValue);
            if (fallback.error) throw fallback.error;
          }
        }

        // write audit log
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
          console.warn('Audit log insertion failed (delete finalize)', auditErr);
        }

        setPendingDelete((pd) => (pd && pd.ticket && String(pd.ticket.ticketId) === String(ticketToDelete.ticketId) ? null : pd));
        fetchAuditLogs();
        toast({ title: 'Deleted', description: `Ticket ${ticketToDelete.ticketId} deleted`, status: 'success', duration: 3000 });
      } catch (err) {
        console.error('Final delete failed', err);
        // If DB deletion failed, restore item into UI
        setOriginalTickets((prev) => [ticketToDelete, ...prev]);
        setFilteredTickets((prev) => [ticketToDelete, ...prev]);
        setPendingDelete(null);
        toast({ title: 'Delete failed', description: err?.message || 'Could not delete ticket from server', status: 'error', duration: 6000 });
      }
    }, DELAY);

    // store pending delete info for potential undo
    setPendingDelete({ ticket: ticketToDelete, timeoutId });

    // show undo toast
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
              <Button
                size="sm"
                colorScheme="whiteAlpha"
                onClick={() => {
                  // undo: cancel timeout and restore
                  clearTimeout(timeoutId);
                  setOriginalTickets((prev) => [ticketToDelete, ...prev]);
                  setFilteredTickets((prev) => [ticketToDelete, ...prev]);
                  setPendingDelete(null);
                  onClose();
                  toast({ title: 'Restored', description: `Ticket ${ticketToDelete.ticketId} restored`, status: 'info', duration: 3000 });
                }}
              >
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

  // ---------- UI ----------
  return (
    <Box p={6} maxW="1400px" mx="auto">
      <Flex align="center" gap={4} mb={6}>
        <Heading> SAD Report Generator </Heading>
        {isAdmin && <Badge colorScheme="green">You are an admin</Badge>}
      </Flex>

      <Box mb={4}>
        <ChakraInput
          placeholder="Type SAD No"
          value={searchSAD}
          onChange={(e) => setSearchSAD(e.target.value)}
          mb={3}
          isDisabled={loading || pdfGenerating}
        />
        <Button colorScheme="teal" onClick={handleGenerateReport} isLoading={loading} loadingText="Loading">
          Generate Report
        </Button>
        <Button ml={3} size="sm" leftIcon={<FaRedo />} onClick={() => { setSearchSAD(''); setOriginalTickets([]); setFilteredTickets([]); setReportMeta({}); }}>
          Clear
        </Button>
      </Box>

      {filteredTickets.length > 0 ? (
        <Box mt={6}>
          <Text fontSize="lg" fontWeight="bold" mb={2}>
            Report for SAD: {searchSAD}
          </Text>

          <Box mb={4} border="1px solid" borderColor="gray.100" p={3} borderRadius="md">
            <Text fontWeight="semibold" mb={2}>Filter by Date & Time Range</Text>
            <SimpleGrid columns={[1, 4]} spacing={3} alignItems="end">
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

              <HStack ml="auto" spacing={2}>
                <Button leftIcon={<FaDownload />} colorScheme="gray" size="sm" onClick={handleDownloadPdf} isLoading={pdfGenerating}>
                  Download PDF
                </Button>

                <Button leftIcon={<FaShareAlt />} colorScheme="blue" size="sm" onClick={handleNativeShare} isLoading={pdfGenerating}>
                  Share (Native)
                </Button>

                <Button leftIcon={<FaEnvelope />} colorScheme="green" size="sm" onClick={handleEmailComposer} isLoading={pdfGenerating}>
                  Email (Composer)
                </Button>
              </HStack>
            </Flex>

            <Text ml={2} mt={2} fontSize="sm" color="gray.600">
              Tip: Use the date/time range to narrow your shift; then download or share the PDF.
            </Text>
          </Box>

          <Table variant="striped" colorScheme="teal" size="sm">
            <Thead>
              <Tr>
                <Th>SAD No</Th>
                <Th>Ticket No</Th>
                <Th>Date & Time</Th>
                <Th>Truck No</Th>
                <Th>Gross (kg)</Th>
                <Th>Tare (kg)</Th>
                <Th>Net (kg)</Th>
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

    // Correct driver reference
    const displayDriver = ticket.data.driver || 'N/A';

    return (
      <Tr key={ticket.ticketId} _hover={{ bg: 'teal.50', cursor: 'pointer' }}>
        <Td>{ticket.data.sadNo}</Td>
        <Td>{ticket.data.ticketNo}</Td>
        <Td>{ticket.data.date ? new Date(ticket.data.date).toLocaleString() : 'N/A'}</Td>
        <Td>{ticket.data.gnswTruckNo}</Td>
        <Td>{computed.grossDisplay || '0'}</Td>
        <Td>{computed.tareDisplay || '0'}</Td>
        <Td>{computed.netDisplay || '0'}</Td>
        <Td>{displayDriver}</Td>
        <Td>
          <Flex gap={2} align="center">
            <Button
              size="sm"
              colorScheme="teal"
              variant="outline"
              onClick={() => openModalWithTicket(ticket)}
              leftIcon={<ArrowForwardIcon />}
            >
              View More
            </Button>

            {ticket.data.fileUrl ? (
              <Button size="sm" variant="ghost" colorScheme="red" leftIcon={<FaFilePdf />} onClick={() => window.open(ticket.data.fileUrl, '_blank', 'noopener')}>
                Open Ticket
              </Button>
            ) : null}
          </Flex>
        </Td>
      </Tr>
    );
  })}
  <Tr fontWeight="bold" bg="teal.100">
    <Td colSpan={6}>Cumulative Net Weight</Td>
    <Td>{formatNumber(cumulativeNetWeight) || '0'} kg</Td>
    <Td colSpan={2}></Td>
  </Tr>
</Tbody>

          </Table>

          {/* Audit logs panel */}
          <Box mt={6} p={4} borderRadius="md" border="1px solid" borderColor="gray.100" bg="white">
            <Flex align="center" mb={3}>
              <Heading size="sm">Recent Audit Logs</Heading>
              {/* Hide fetch button for non-admins */}
              {isAdmin && (
                <Button size="sm" ml="auto" onClick={fetchAuditLogs} leftIcon={<FaRedo />}>
                  Refresh
                </Button>
              )}
            </Flex>

            {loadingAudit ? (
              <Flex align="center" justify="center" p={4}><Spinner /></Flex>
            ) : auditLogs.length === 0 ? (
              <Text fontSize="sm" color="gray.500">No audit logs yet.</Text>
            ) : (
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
            )}
          </Box>
        </Box>
      ) : (
        !loading &&
        searchSAD && (
          <Text mt={6} fontStyle="italic">
            No records found for SAD: {searchSAD}
          </Text>
        )
      )}

{/* Ticket Details Modal */}
<Modal
  isOpen={isOpen}
  onClose={() => {
    onClose();
    setIsEditing(false);
    setEditData({});
    setEditErrors({});
  }}
  size="lg"
  scrollBehavior="inside"
  isCentered
>
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
              <Text fontSize="sm" fontWeight="normal" color="gray.500">
                {selectedTicket?.ticketId} •{' '}
                {selectedTicket?.data?.date
                  ? new Date(selectedTicket.data.date).toLocaleString()
                  : ''}
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
                <Text>
                  <b>Truck No:</b> {selectedTicket.data.gnswTruckNo}
                </Text>
              </HStack>

              {isEditing ? (
                <>
                  <FormControl isInvalid={!!editErrors.operator}>
                    <FormLabel>
                      <Icon as={FaUserTie} mr={2} /> Operator
                    </FormLabel>
                    <ChakraInput
                      value={editData.operator ?? ''}
                      onChange={(e) => handleEditChange('operator', e.target.value)}
                    />
                    <FormErrorMessage>{editErrors.operator}</FormErrorMessage>
                  </FormControl>

                  <FormControl>
                    <FormLabel>
                      <Icon as={FaBox} mr={2} /> Consignee
                    </FormLabel>
                    <ChakraInput
                      value={editData.consignee ?? ''}
                      onChange={(e) => handleEditChange('consignee', e.target.value)}
                    />
                  </FormControl>

                  <FormControl>
                    <FormLabel>
                      <Icon as={FaBox} mr={2} /> Container No
                    </FormLabel>
                    <ChakraInput
                      value={editData.containerNo ?? ''}
                      onChange={(e) => handleEditChange('containerNo', e.target.value)}
                    />
                  </FormControl>

                  <SimpleGrid columns={[1, 3]} spacing={3}>
                    <FormControl isInvalid={!!editErrors.gross}>
                      <FormLabel>
                        <Icon as={FaBalanceScale} mr={2} /> Gross (kg)
                      </FormLabel>
                      <ChakraInput
                        value={editData.gross ?? ''}
                        onChange={(e) => handleEditChange('gross', e.target.value)}
                      />
                      <FormErrorMessage>{editErrors.gross}</FormErrorMessage>
                    </FormControl>
                    <FormControl isInvalid={!!editErrors.tare}>
                      <FormLabel>
                        <Icon as={FaBalanceScale} mr={2} /> Tare (kg)
                      </FormLabel>
                      <ChakraInput
                        value={editData.tare ?? ''}
                        onChange={(e) => handleEditChange('tare', e.target.value)}
                      />
                      <FormErrorMessage>{editErrors.tare}</FormErrorMessage>
                    </FormControl>
                    <FormControl isInvalid={!!editErrors.net}>
                      <FormLabel>
                        <Icon as={FaBalanceScale} mr={2} /> Net (kg)
                      </FormLabel>
                      <ChakraInput
                        value={
                          editData.net ??
                          (numericValue(editData.gross) !== null &&
                          numericValue(editData.tare) !== null
                            ? String(
                                numericValue(editData.gross) - numericValue(editData.tare)
                              )
                            : '')
                        }
                        onChange={(e) => handleEditChange('net', e.target.value)}
                      />
                      <FormErrorMessage>{editErrors.net}</FormErrorMessage>
                    </FormControl>
                  </SimpleGrid>
                </>
              ) : (
                <>
                  <HStack>
                    <Icon as={FaUserTie} />
                    <Text>
                      <b>Operator:</b> {operatorName || selectedTicket.data.operator || 'N/A'}
                    </Text>
                  </HStack>

                  <HStack>
                    <Icon as={FaBox} />
                    <Text>
                      <b>Consignee:</b> {selectedTicket.data.consignee}
                    </Text>
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
                          <Text>
                            <b>Gross Weight:</b> {computed.grossDisplay || '0'} kg
                          </Text>
                        </HStack>
                        <HStack>
                          <Icon as={FaBalanceScale} />
                          <Text>
                            <b>Tare Weight:</b> {computed.tareDisplay || '0'} kg
                          </Text>
                        </HStack>
                        <HStack>
                          <Icon as={FaBalanceScale} />
                          <Text>
                            <b>Net Weight:</b> {computed.netDisplay || '0'} kg
                          </Text>
                        </HStack>
                      </>
                    );
                  })()}
                </>
              )}

              <HStack>
                <Icon as={FaBox} />
                <Text>
                  <b>Container No:</b> {selectedTicket.data.containerNo || 'N/A'}
                </Text>
              </HStack>
              <HStack>
                <Text>
                  <b>Pass Number:</b> {selectedTicket.data.passNumber || 'N/A'}
                </Text>
              </HStack>
              <HStack>
                <Text>
                  <b>Scale Name:</b> {selectedTicket.data.scaleName || 'N/A'}
                </Text>
              </HStack>
              <HStack>
                <Text>
                  <b>ANPR:</b> {selectedTicket.data.anpr || 'N/A'}
                </Text>
              </HStack>
              <HStack>
                <Text>
                  <b>Consolidated:</b> {selectedTicket.data.consolidated ? 'Yes' : 'No'}
                </Text>
              </HStack>

              {/* Open Ticket PDF Button */}
              {selectedTicket.data.fileUrl && (
                <Box pt={2}>
                  <Button
                    size="sm"
                    colorScheme="blue"
                    onClick={() =>
                      window.open(selectedTicket.data.fileUrl, '_blank', 'noopener')
                    }
                    leftIcon={<FaExternalLinkAlt />}
                  >
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
          {/* Admin-only Edit/Delete controls */}
          {selectedTicket && !isEditing && (
            <>
              {isAdmin ? (
                isTicketEditable(selectedTicket) ? (
                  <Button
                    leftIcon={<FaEdit />}
                    colorScheme="yellow"
                    mr={2}
                    onClick={startEditing}
                  >
                    Edit
                  </Button>
                ) : (
                  <Tooltip label="Cannot edit tickets with status 'Exited'">
                    <Button leftIcon={<FaEdit />} colorScheme="yellow" mr={2} isDisabled>
                      Edit
                    </Button>
                  </Tooltip>
                )
              ) : (
                <Tooltip label="Admin only">
                  <Button leftIcon={<FaEdit />} colorScheme="yellow" mr={2} isDisabled>
                    Edit
                  </Button>
                </Tooltip>
              )}

              {isAdmin ? (
                <Button
                  leftIcon={<FaTrashAlt />}
                  colorScheme="red"
                  mr={2}
                  onClick={confirmDelete}
                >
                  Delete
                </Button>
              ) : (
                <Tooltip label="Admin only">
                  <Button leftIcon={<FaTrashAlt />} colorScheme="red" mr={2} isDisabled>
                    Delete
                  </Button>
                </Tooltip>
              )}
            </>
          )}

          {isEditing && (
            <>
              <Button
                leftIcon={<FaCheck />}
                colorScheme="green"
                mr={2}
                onClick={saveEdits}
                isLoading={savingEdit}
              >
                Save
              </Button>
              <Button variant="ghost" mr={2} onClick={cancelEditing}>
                Cancel
              </Button>
            </>
          )}

          <Button
            onClick={() => {
              onClose();
              setIsEditing(false);
              setEditData({});
              setEditErrors({});
            }}
          >
            Close
          </Button>
        </ModalFooter>
      </MotionModalContent>
    )}
  </AnimatePresence>
</Modal>

{/* Delete confirmation AlertDialog */}
<AlertDialog
  isOpen={isDeleteOpen}
  leastDestructiveRef={cancelRef}
  onClose={onDeleteClose}
  isCentered
>
  <AlertDialogOverlay>
    <AlertDialogContent>
      <AlertDialogHeader fontSize="lg" fontWeight="bold">
        Delete Ticket
      </AlertDialogHeader>

      <AlertDialogBody>
        Are you sure you want to delete ticket <b>{selectedTicket?.ticketId}</b>? It will be
        removed from the list and scheduled for deletion. You can undo for a few seconds.
      </AlertDialogBody>

      <AlertDialogFooter>
        <Button ref={cancelRef} onClick={onDeleteClose} isDisabled={deleting}>
          Cancel
        </Button>
        <Button colorScheme="red" onClick={performDelete} ml={3} isLoading={deleting}>
          Delete
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialogOverlay>
</AlertDialog>

    </Box>
  );
}
