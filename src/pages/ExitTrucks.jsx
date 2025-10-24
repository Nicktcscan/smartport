// src/pages/ExitTrucks.jsx
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Box,
  Heading,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Text,
  Input,
  Select,
  useToast,
  Badge,
  HStack,
  Spacer,
  IconButton,
  Button,
  Modal,
  ModalOverlay,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  useDisclosure,
  ModalFooter,
  Stack,
  Flex,
  Divider,
  Icon,
  usePrefersReducedMotion,
  ModalContent,
  SimpleGrid,
  VStack,
  Checkbox,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  Tooltip,
  useBreakpointValue,
} from '@chakra-ui/react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DownloadIcon,
  ArrowForwardIcon,
  InfoOutlineIcon,
} from '@chakra-ui/icons';
import {
  FaTruck,
  FaWeightHanging,
  FaUserTie,
  FaBoxes,
  FaRoute,
  FaCalendarAlt,
  FaFileInvoice,
  FaFilePdf,
  FaMagic,
  FaBars,
  FaCopy,
  FaExternalLinkAlt,
  FaDownload,
} from 'react-icons/fa';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext'; // adjust if your context file path differs

const MotionModalContent = motion.create(ModalContent);

/* -----------------------
   Helpers (numbers, weights)
   ----------------------- */
function numericValue(v) {
  if (v === null || v === undefined || v === '') return null;
  const cleaned = String(v).replace(/[,\s]+/g, '').replace(/kg/i, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function formatNumber(v) {
  if (v === null || v === undefined || v === '') return '-';
  const n = numericValue(v);
  if (n === null) return '-';
  return Number.isInteger(n)
    ? n.toLocaleString('en-US')
    : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    grossDisplay: G !== null ? formatNumber(G) : '-',
    tareDisplay: T !== null ? formatNumber(T) : '-',
    netDisplay: N !== null ? formatNumber(N) : '-',
  };
}

function exportToCSV(data, filename = 'exited-trucks.csv') {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const rows = data.map((row) =>
    headers
      .map((h) => {
        const v = row[h] ?? '';
        const s = typeof v === 'string' ? v : String(v);
        return `"${s.replace(/"/g, '""')}"`;
      })
      .join(',')
  );
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* -----------------------
   PDF text extraction + driver parsing (best-effort)
   ----------------------- */
async function extractTextFromPdfUrl(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to fetch PDF (${resp.status})`);
    const arrayBuffer = await resp.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item) => item.str).join(' ');
      fullText += ' ' + pageText;
    }
    await loadingTask.destroy?.();
    return fullText.trim();
  } catch (err) {
    console.warn('PDF text extraction failed', err);
    return '';
  }
}

function parseDriverNameFromText(text) {
  if (!text) return null;
  const patterns = [
    /Driver\s*Name\s*[:\-]\s*(.+?)(?:\n|$)/i,
    /Driver\s*[:\-]\s*(.+?)(?:\n|$)/i,
    /Name\s*of\s*Driver\s*[:\-]\s*(.+?)(?:\n|$)/i,
    /Driver\s+[:]\s*([A-Z][A-Za-z'’\-\s]+[A-Za-z])/m,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m && m[1]) {
      const candidate = m[1].trim();
      if (candidate.length > 2 && candidate.length < 80 && !/\d{5,}/.test(candidate)) {
        return candidate.replace(/\s{2,}/g, ' ').replace(/[\r\n]+/g, ' ').trim();
      }
    }
  }
  const fallback = text.match(/Driver\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,2})/);
  if (fallback && fallback[1]) return fallback[1].trim();
  return null;
}

/* -----------------------
   Component
   ----------------------- */
export default function ExitTrucks() {
  const toast = useToast();
  const prefersReducedMotion = usePrefersReducedMotion();
  const isMobile = useBreakpointValue({ base: true, md: false });
  const { user } = useAuth(); // used for optimistic audit fields when inserting outgate (if needed)

  // data and UI state
  const [exitedTrucks, setExitedTrucks] = useState([]);
  const [loading, setLoading] = useState(true);

  // filters/paging
  const [filterText, setFilterText] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');
  const [pageSize, setPageSize] = useState(8);
  const [currentPage, setCurrentPage] = useState(1);

  // modal / selection / keyboard nav
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [selectedRowIndex, setSelectedRowIndex] = useState(-1);
  const rowRefs = useRef([]);
  const [selectedSet, setSelectedSet] = useState(new Set());

  // orb/hologram
  const [orbOpen, setOrbOpen] = useState(false);
  const openOrb = () => setOrbOpen(true);
  const closeOrb = () => setOrbOpen(false);

  // voice
  const recognitionRef = useRef(null);
  const [isListening, setIsListening] = useState(false);

  // stat styles (different backgrounds)
  const statStyles = [
    { bg: 'linear-gradient(135deg,#7c3aed 0%,#06b6d4 100%)', color: 'white' },
    { bg: 'linear-gradient(135deg,#f97316 0%,#fb7185 100%)', color: 'white' },
    { bg: 'linear-gradient(135deg,#06b6d4 0%,#7c3aed 100%)', color: 'white' },
    { bg: 'linear-gradient(135deg,#ef9a9a 0%,#f48fb1 100%)', color: 'white' },
  ];

  // fetch exited trucks from tickets table where status='Exited'
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('tickets')
          .select('*')
          .eq('status', 'Exited')
          .order('submitted_at', { ascending: false });
        if (error) throw error;
        if (!mounted) return;

        const mapped = (data || []).map((item) => ({
          ticketId: item.ticket_id ?? item.id ?? `${Math.random()}`,
          ticketNo: item.ticket_no ?? '',
          gnswTruckNo: item.gnsw_truck_no ?? item.vehicle_number ?? '',
          sadNo: item.sad_no ?? '',
          exitTime: item.created_at ?? item.exit_time ?? null,
          driver: item.driver ?? '',
          gross: item.gross ?? item.gross_weight ?? null,
          tare: item.tare ?? null,
          net: item.net ?? null,
          date: item.date ?? item.submitted_at ?? null,
          containerNo: item.container_no ?? null,
          operator: item.operator ?? null,
          passNumber: item.pass_number ?? null,
          scaleName: item.scale_name ?? null,
          anpr: item.wb_id ?? null,
          fileUrl: item.file_url ?? null,
          raw: item,
        }));

        setExitedTrucks(mapped);
      } catch (err) {
        console.error(err);
        toast({ title: 'Failed to load exited trucks', description: err?.message || String(err), status: 'error' });
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => { mounted = false; };
  }, [toast]);

  /* Filtering pipeline */
  const parseTimeToMinutes = (timeStr) => {
    if (!timeStr) return null;
    const parts = timeStr.split(':');
    if (parts.length < 2) return null;
    const hh = parseInt(parts[0], 10);
    const mm = parseInt(parts[1], 10);
    if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
    return hh * 60 + mm;
  };

  const filtered = useMemo(() => {
    const q = (filterText || '').toLowerCase().trim();
    const tf = parseTimeToMinutes(timeFrom);
    const tt = parseTimeToMinutes(timeTo);
    const hasDateRange = !!(dateFrom || dateTo);

    const startDate = dateFrom ? new Date(dateFrom) : null;
    const endDate = dateTo ? new Date(dateTo) : null;

    return exitedTrucks.filter((row) => {
      if (q) {
        const hay = [row.ticketNo, row.gnswTruckNo, row.driver, row.sadNo].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }

      const raw = row.date ?? row.exitTime;
      if (!raw) return !(hasDateRange || tf !== null || tt !== null);
      const d = new Date(raw);
      if (isNaN(d.getTime())) return false;

      if (hasDateRange) {
        let start = startDate ? new Date(startDate) : new Date(-8640000000000000);
        let end = endDate ? new Date(endDate) : new Date(8640000000000000);
        if (tf !== null) start.setHours(Math.floor(tf / 60), tf % 60, 0, 0);
        if (tt !== null) end.setHours(Math.floor(tt / 60), tt % 60, 59, 999);
        return d >= start && d <= end;
      }

      if (tf !== null || tt !== null) {
        const minutes = d.getHours() * 60 + d.getMinutes();
        const fromM = tf !== null ? tf : 0;
        const toM = tt !== null ? tt : 24 * 60 - 1;
        return minutes >= fromM && minutes <= toM;
      }

      return true;
    });
  }, [exitedTrucks, filterText, dateFrom, dateTo, timeFrom, timeTo]);

  // paging
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [totalPages, currentPage]);
  const pageItems = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // CSV for current page
  const csvData = pageItems.map((r) => {
    const c = computeWeightsFromObj({ gross: r.gross, tare: r.tare, net: r.net });
    return {
      'Ticket ID': r.ticketId,
      'Ticket No': r.ticketNo,
      'Truck No': r.gnswTruckNo,
      'SAD No': r.sadNo,
      'Driver': r.driver,
      'Gross (kg)': c.grossValue ?? '',
      'Tare (kg)': c.tareValue ?? '',
      'Net (kg)': c.netValue ?? '',
      'Entry Date': r.date ? new Date(r.date).toLocaleString() : '',
      'Exit Date': r.exitTime ? new Date(r.exitTime).toLocaleString() : '',
    };
  });

  /* Keyboard navigation & row selection */
  useEffect(() => {
    const onKey = (e) => {
      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
      if (!pageItems.length) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedRowIndex((i) => Math.min(pageItems.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedRowIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        const idx = selectedRowIndex;
        if (idx >= 0 && idx < pageItems.length) openDetailModal(pageItems[idx]);
      } else if (e.key === ' ') {
        const idx = selectedRowIndex;
        if (idx >= 0 && idx < pageItems.length) {
          e.preventDefault();
          const id = pageItems[idx].ticketId;
          setSelectedSet((s) => {
            const next = new Set(s);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
          });
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        const ids = pageItems.map((p) => p.ticketId);
        setSelectedSet(new Set(ids));
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pageItems, selectedRowIndex]);

  useEffect(() => {
    if (selectedRowIndex >= 0 && rowRefs.current[selectedRowIndex]) {
      try { rowRefs.current[selectedRowIndex].focus(); } catch (e) {}
    }
  }, [selectedRowIndex]);

  /* Voice recognition (basic commands) */
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;
    if (!SpeechRecognition) return undefined;
    const rec = new SpeechRecognition();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (evt) => {
      const txt = (evt.results?.[0]?.[0]?.transcript || '').toLowerCase();
      if (txt.includes('confirm visible')) {
        openOrb();
        toast({ title: 'Voice command: opened orb', status: 'info' });
      } else if (txt.includes('select all')) {
        const ids = filtered.map((r) => r.ticketId);
        setSelectedSet(new Set(ids));
        toast({ title: `Voice: selected ${ids.length}`, status: 'info' });
      } else {
        toast({ title: `Voice: ${txt}`, status: 'info' });
      }
    };
    rec.onerror = (e) => { console.warn('speech error', e); setIsListening(false); };
    recognitionRef.current = rec;
    return () => {
      try { recognitionRef.current?.stop(); } catch (e) {}
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered]);

  const toggleListening = () => {
    if (!recognitionRef.current) return toast({ title: 'Voice not supported', status: 'warning' });
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
      toast({ title: 'Voice stopped', status: 'info' });
    } else {
      try {
        recognitionRef.current.start();
        setIsListening(true);
        toast({ title: 'Voice listening', status: 'success' });
      } catch (e) {
        console.warn(e);
        setIsListening(false);
        toast({ title: 'Voice failed', status: 'error' });
      }
    }
  };

  /* Open detail modal and attempt driver extraction for PDFs (best-effort) */
  const openDetailModal = async (r) => {
    const row = { ...r };
    if ((!row.driver || row.driver === '') && row.fileUrl && /\.pdf(\?.*)?$/i.test(row.fileUrl)) {
      try {
        const txt = await extractTextFromPdfUrl(row.fileUrl);
        const parsed = parseDriverNameFromText(txt);
        if (parsed) {
          row.driver = parsed;
          // persist best-effort
          try {
            await supabase.from('tickets').update({ driver: parsed }).eq('ticket_id', row.ticketId);
          } catch (e) {
            console.warn('persist driver failed', e);
          }
        }
      } catch (e) {
        console.warn('pdf parse error', e);
      }
    }
    setSelectedTicket(row);
    onOpen();
  };

  /* Optimistic confirm exit flow (in detail modal) */
  const handleConfirmExit = async () => {
    if (!selectedTicket) return;
    // build payload for outgate table
    const { ticketId, ticketNo, gnswTruckNo, containerNo, sadNo, gross, tare, net, date, fileUrl } = selectedTicket;
    const payload = {
      ticket_id: ticketId,
      ticket_no: ticketNo || null,
      vehicle_number: gnswTruckNo || null,
      container_id: containerNo || null,
      sad_no: sadNo || null,
      gross: numericValue(gross),
      tare: numericValue(tare),
      net: numericValue(net),
      date: date || null,
      file_url: fileUrl || null,
      driver: selectedTicket.driver || null,
      created_at: new Date().toISOString(),
      // optional audit: include edited_by as user id if desired
      edited_by: user?.id ?? null,
    };

    // optimistic UI update
    const existingTickets = [...exitedTrucks];
    const optimisticRow = {
      ...selectedTicket,
      exitTime: new Date().toISOString(),
    };
    setExitedTrucks((prev) => [optimisticRow, ...prev.filter((p) => p.ticketId !== optimisticRow.ticketId)]);

    // attempt to insert outgate and mark ticket as Exited
    try {
      // prevent duplicate outgate for same ticket_id
      if (payload.ticket_id) {
        const { data: existing, error: checkErr } = await supabase
          .from('outgate')
          .select('id')
          .eq('ticket_id', payload.ticket_id)
          .limit(1);
        if (checkErr) console.warn('existing outgate check failed', checkErr);
        if (existing && existing.length) {
          toast({ title: 'Already confirmed', description: 'This ticket already has an outgate row', status: 'warning' });
          // ensure ticket status set to Exited
          try {
            await supabase.from('tickets').update({ status: 'Exited' }).eq('ticket_id', payload.ticket_id);
          } catch (e) {}
          onClose();
          return;
        }
      }

      const { error: insertErr } = await supabase.from('outgate').insert([payload]);
      if (insertErr) throw insertErr;

      if (payload.ticket_id) {
        const { error: updErr } = await supabase.from('tickets').update({ status: 'Exited' }).eq('ticket_id', payload.ticket_id);
        if (updErr) console.warn('could not update ticket status', updErr);
      }

      // confetti
      try {
        const confettiModule = await import('canvas-confetti').catch(() => null);
        const confetti = confettiModule?.default ?? window.confetti;
        if (confetti) confetti({ particleCount: 140, spread: 120, origin: { y: 0.6 } });
      } catch (e) {}

      toast({ title: 'Exit confirmed', status: 'success' });
      onClose();
    } catch (err) {
      console.error('confirm exit failed', err);
      toast({ title: 'Failed to confirm exit', description: err?.message || String(err), status: 'error' });
      // rollback optimistic
      setExitedTrucks(existingTickets);
    } finally {
      // refresh lists (best-effort)
      try {
        const { data } = await supabase.from('tickets').select('*').eq('status', 'Exited').order('submitted_at', { ascending: false });
        if (data) {
          const mapped = (data || []).map((item) => ({
            ticketId: item.ticket_id ?? item.id ?? `${Math.random()}`,
            ticketNo: item.ticket_no ?? '',
            gnswTruckNo: item.gnsw_truck_no ?? item.vehicle_number ?? '',
            sadNo: item.sad_no ?? '',
            exitTime: item.created_at ?? item.exit_time ?? null,
            driver: item.driver ?? '',
            gross: item.gross ?? item.gross_weight ?? null,
            tare: item.tare ?? null,
            net: item.net ?? null,
            date: item.date ?? item.submitted_at ?? null,
            containerNo: item.container_no ?? null,
            operator: item.operator ?? null,
            passNumber: item.pass_number ?? null,
            scaleName: item.scale_name ?? null,
            anpr: item.wb_id ?? null,
            fileUrl: item.file_url ?? null,
            raw: item,
          }));
          setExitedTrucks(mapped);
        }
      } catch (_) {}
    }
  };

  /* Bulk demo confirm (orb) */
  const handleOrbConfirmVisible = async () => {
    if (!pageItems.length) return toast({ title: 'No visible items', status: 'info' });
    // this demo triggers confetti and shows success — real bulk insert logic could be added here
    try {
      const confettiModule = await import('canvas-confetti').catch(() => null);
      const confetti = confettiModule?.default ?? window.confetti;
      if (confetti) confetti({ particleCount: 180, spread: 160, origin: { y: 0.6 } });
    } catch (e) {}
    toast({ title: `Bulk confirm (demo) for ${pageItems.length} items`, status: 'success' });
    closeOrb();
  };

  /* Export & bulk actions */
  const handleExportSelected = () => {
    if (!selectedSet.size) return toast({ title: 'No selection', status: 'info' });
    const rows = filtered.filter((r) => selectedSet.has(r.ticketId)).map((r) => {
      const c = computeWeightsFromObj({ gross: r.gross, tare: r.tare, net: r.net });
      return {
        'Ticket ID': r.ticketId,
        'Ticket No': r.ticketNo,
        'Truck No': r.gnswTruckNo,
        'SAD No': r.sadNo,
        'Driver': r.driver,
        'Gross (kg)': c.grossValue ?? '',
        'Tare (kg)': c.tareValue ?? '',
        'Net (kg)': c.netValue ?? '',
        'Exit Date': r.exitTime ? new Date(r.exitTime).toLocaleString() : '',
      };
    });
    exportToCSV(rows, `exited-selected-${new Date().toISOString().slice(0,10)}.csv`);
    toast({ title: `Export started (${rows.length} rows)`, status: 'success' });
    setSelectedSet(new Set());
  };

  /* UI render */
  return (
    <Box p={{ base: 4, md: 8 }} maxW="1200px" mx="auto">
      <style>{`
        :root{
          --glass-border: rgba(2,6,23,0.06);
          --muted: rgba(16,24,40,0.6);
          --card-shadow: 0 10px 30px rgba(2,6,23,0.06);
        }
        .table-wrapper { border-radius: 12px; padding: 8px; border: 1px solid var(--glass-border); box-shadow: var(--card-shadow); background: linear-gradient(180deg, rgba(255,255,255,0.6), rgba(255,255,255,0.4)); }
        .fancy-table { width:100%; border-collapse: separate; border-spacing: 0; }
        .fancy-table thead th {
          background: linear-gradient(90deg,#0ea5a4,#7c3aed);
          color: white;
          padding: 12px 10px;
          font-weight:700;
          border-right: 1px solid rgba(255,255,255,0.06);
        }
        .fancy-table tbody td { background: linear-gradient(180deg,#ffffff,#fbfdff); padding:10px; border-bottom: 1px solid #eef6fb; color: #071126; }
        .fancy-card { border-radius:14px; padding:14px; background: linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,253,255,0.98)); box-shadow: 0 10px 30px rgba(2,6,23,0.06); border:1px solid var(--glass-border); }
        @media (max-width:900px) {
          .fancy-table thead { display:none; }
          .fancy-table tbody tr { display:block; margin-bottom:14px; border-radius:14px; background: linear-gradient(180deg, #fff, #fbfdff); padding:12px; box-shadow: 0 6px 20px rgba(2,6,23,0.04); }
          .fancy-table tbody td { display:block; padding:6px 0; border:none; }
          .fancy-table tbody td::before { content: attr(data-label); display:inline-block; width:120px; font-weight:700; color:var(--muted); }
        }
        @media (min-width:1400px) {
          .panel-3d { transform-style: preserve-3d; perspective:1400px; transition: transform 0.6s cubic-bezier(.2,.8,.2,1); }
          .panel-3d:hover { transform: rotateY(6deg) rotateX(2deg) translateZ(6px); box-shadow: 0 40px 80px rgba(2,6,23,0.12); }
        }
        .orb-cta { transition: transform 0.2s; border-radius: 999px; padding:10px; display:flex; align-items:center; justify-content:center; cursor:pointer; }
        .orb-cta:hover { transform: translateY(-6px) scale(1.03); }
        /* holographic cubes */
        .holo-cubes { display:flex; gap:6px; justify-content:center; margin-top:10px; }
        .cube { width: 48px; height: 48px; transform-style: preserve-3d; animation: floaty 4s ease-in-out infinite; border-radius:6px; }
        .cube .face { position:absolute; inset:0; border-radius:6px; opacity:0.95; }
        .cube-1 { animation-delay: 0s; }
        .cube-2 { animation-delay: 0.2s; transform: translateY(6px); }
        .cube-3 { animation-delay: 0.4s; transform: translateY(-4px); }
        @keyframes floaty {
          0% { transform: translateY(0) rotateX(0) rotateY(0); }
          50% { transform: translateY(-10px) rotateX(12deg) rotateY(12deg); }
          100% { transform: translateY(0) rotateX(0) rotateY(0); }
        }
      `}</style>

      <Flex justify="space-between" align="center" mb={6} gap={4} wrap="wrap">
        <Stack spacing={1}>
          <Heading size="lg">Exited Trucks</Heading>
          <Text color="gray.600">Beautiful, responsive view of exited trucks. Cards on mobile, 3D panels on wide screens.</Text>
        </Stack>

        <HStack spacing={2}>
          <Button leftIcon={<DownloadIcon />} variant="ghost" onClick={() => {
            if (!csvData.length) return toast({ title: 'No rows', status: 'info' });
            exportToCSV(csvData, `exited-page-${currentPage}.csv`);
            toast({ title: `Exported ${csvData.length} rows`, status: 'success' });
          }}>Export Page CSV</Button>

          <Button leftIcon={<FaMagic />} colorScheme="purple" onClick={toggleListening}>
            {isListening ? 'Voice: On' : 'Voice'}
          </Button>

          <Button onClick={openOrb} leftIcon={<FaMagic />} colorScheme="teal">Orb</Button>
        </HStack>
      </Flex>

      {/* Stats */}
      <SimpleGrid columns={{ base: 1, md: 4 }} spacing={3} mb={6}>
        <Box className="panel-3d" borderRadius="md" p={4} sx={{ ...statStyles[0] }}>
          <Text fontSize="sm" color="rgba(255,255,255,0.9)">Total Exited</Text>
          <Text fontSize="2xl" fontWeight="bold" color="white">{exitedTrucks.length}</Text>
          <Text fontSize="sm" color="rgba(255,255,255,0.85)">All-time exited trucks</Text>
        </Box>

        <Box className="panel-3d" borderRadius="md" p={4} sx={{ ...statStyles[1] }}>
          <Text fontSize="sm" color="rgba(255,255,255,0.9)">Visible</Text>
          <Text fontSize="2xl" fontWeight="bold" color="white">{filtered.length}</Text>
          <Text fontSize="sm" color="rgba(255,255,255,0.85)">After filters</Text>
        </Box>

        <Box className="panel-3d" borderRadius="md" p={4} sx={{ ...statStyles[2] }}>
          <Text fontSize="sm" color="rgba(255,255,255,0.9)">Page Size</Text>
          <Text fontSize="2xl" fontWeight="bold" color="white">{pageSize}</Text>
          <Text fontSize="sm" color="rgba(255,255,255,0.85)"><Select size="sm" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }} bg="transparent" color="white" border="none" _focus={{ boxShadow: 'none' }}>
            {[5,8,10,20,50].map(n => <option key={n} value={n}>{n}</option>)}
          </Select></Text>
        </Box>

        <Box className="panel-3d" borderRadius="md" p={4} sx={{ ...statStyles[3] }}>
          <Text fontSize="sm" color="rgba(255,255,255,0.9)">Selected</Text>
          <Text fontSize="2xl" fontWeight="bold" color="white">{selectedSet.size}</Text>
          <Text fontSize="sm" color="rgba(255,255,255,0.85)">Selected rows for bulk</Text>
        </Box>
      </SimpleGrid>

      {/* Controls */}
      <HStack mb={4} spacing={3}>
        <Input placeholder="Filter by Ticket / Truck / Driver / SAD" value={filterText} onChange={(e) => { setFilterText(e.target.value); setCurrentPage(1); }} size="sm" maxW="420px" />
        <Spacer />
        <Select size="sm" maxW="120px" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}>
          {[5,8,10,20,50].map(n => <option key={n} value={n}>{n}/page</option>)}
        </Select>
        <IconButton aria-label="Export selected" icon={<FaDownload />} size="sm" onClick={handleExportSelected} />
        <Button size="sm" colorScheme="green" onClick={() => {
          // quick demo bulk action
          if (!selectedSet.size) return toast({ title: 'No selection', status: 'info' });
          toast({ title: `Demo confirm for ${selectedSet.size} rows`, status: 'success' });
          try { (async () => { const mod = await import('canvas-confetti'); mod?.default?.({ particleCount: 100, spread: 140 }); })(); } catch (e) {}
          setSelectedSet(new Set());
        }}>Confirm Selected (Demo)</Button>
      </HStack>

      {/* Date/time range */}
      <Box mb={4} className="fancy-card">
        <SimpleGrid columns={{ base: 1, md: 4 }} spacing={3} alignItems="end">
          <Box>
            <Text fontSize="sm" mb={1}>Date From</Text>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </Box>
          <Box>
            <Text fontSize="sm" mb={1}>Date To</Text>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </Box>
          <Box>
            <Text fontSize="sm" mb={1}>Time From</Text>
            <Input type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} />
          </Box>
          <Box>
            <Text fontSize="sm" mb={1}>Time To</Text>
            <Input type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} />
          </Box>
        </SimpleGrid>
        <Flex mt={3} gap={2}>
          <Button size="sm" colorScheme="blue" onClick={() => setCurrentPage(1)}>Apply</Button>
          <Button size="sm" variant="ghost" onClick={() => { setDateFrom(''); setDateTo(''); setTimeFrom(''); setTimeTo(''); setCurrentPage(1); }}>Reset</Button>
          <Text ml={4} color="gray.600" fontSize="sm" alignSelf="center">Tip: Add times to refine daily ranges</Text>
        </Flex>
      </Box>

      {/* Table or cards */}
      {loading ? (
        <Text>Loading exited trucks…</Text>
      ) : pageItems.length === 0 ? (
        <Box className="fancy-card" textAlign="center"><Text>No exited trucks found for current filters.</Text></Box>
      ) : isMobile ? (
        <VStack spacing={3}>
          {pageItems.map((r) => {
            const c = computeWeightsFromObj({ gross: r.gross, tare: r.tare, net: r.net });
            const checked = selectedSet.has(r.ticketId);
            return (
              <Box key={r.ticketId} className="fancy-card">
                <Flex justify="space-between" align="center" mb={2}>
                  <Box>
                    <Text fontWeight="bold">{r.gnswTruckNo || '—'}</Text>
                    <Text fontSize="sm" color="gray.500">{r.ticketNo || r.ticketId}</Text>
                  </Box>
                  <Box textAlign="right">
                    <Badge colorScheme="teal">Exited</Badge>
                    <Text fontSize="xs" color="gray.500">{r.exitTime ? new Date(r.exitTime).toLocaleString() : '-'}</Text>
                  </Box>
                </Flex>

                <SimpleGrid columns={3} spacing={2} mb={3}>
                  <Box textAlign="center"><Text fontSize="xs" color="gray.600">Gross</Text><Text fontWeight="bold">{c.grossDisplay}</Text></Box>
                  <Box textAlign="center"><Text fontSize="xs" color="gray.600">Tare</Text><Text fontWeight="bold">{c.tareDisplay}</Text></Box>
                  <Box textAlign="center"><Text fontSize="xs" color="gray.600">Net</Text><Text fontWeight="bold">{c.netDisplay}</Text></Box>
                </SimpleGrid>

                <HStack spacing={2}>
                  <Checkbox isChecked={checked} onChange={() => {
                    setSelectedSet((s) => {
                      const next = new Set(s);
                      if (next.has(r.ticketId)) next.delete(r.ticketId); else next.add(r.ticketId);
                      return next;
                    });
                  }} />
                  <Button size="sm" variant="outline" onClick={() => openDetailModal(r)}>View</Button>
                  <Menu>
                    <MenuButton as={IconButton} icon={<FaBars />} size="sm" aria-label="More" />
                    <MenuList>
                      <MenuItem icon={<FaFilePdf />} onClick={() => r.fileUrl ? window.open(r.fileUrl, '_blank') : toast({ title: 'No file', status: 'info' })}>Open Attachment</MenuItem>
                      <MenuItem icon={<FaCopy />} onClick={() => {
                        const text = `Ticket ${r.ticketNo || r.ticketId} — ${r.gnswTruckNo} — Net: ${c.netDisplay}`;
                        navigator.clipboard?.writeText(text);
                        toast({ title: 'Copied', description: 'Row summary copied to clipboard', status: 'success' });
                      }}>Copy summary</MenuItem>
                    </MenuList>
                  </Menu>
                </HStack>
              </Box>
            );
          })}
        </VStack>
      ) : (
        <Box className="table-wrapper" mb={4}>
          <Table className="fancy-table" size="sm">
            <Thead>
              <Tr>
                <Th><Checkbox isChecked={selectedSet.size > 0 && pageItems.every(p => selectedSet.has(p.ticketId))} onChange={(e) => {
                  if (e.target.checked) {
                    const ids = new Set(selectedSet);
                    pageItems.forEach(p => ids.add(p.ticketId));
                    setSelectedSet(ids);
                  } else {
                    const ids = new Set(selectedSet);
                    pageItems.forEach(p => ids.delete(p.ticketId));
                    setSelectedSet(ids);
                  }
                }} /></Th>
                <Th>Ticket No</Th>
                <Th>Truck No</Th>
                <Th>Gross (kg)</Th>
                <Th>Tare (kg)</Th>
                <Th>Net (kg)</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {pageItems.map((r, idx) => {
                const c = computeWeightsFromObj({ gross: r.gross, tare: r.tare, net: r.net });
                const checked = selectedSet.has(r.ticketId);
                return (
                  <Tr
                    key={r.ticketId}
                    ref={(el) => (rowRefs.current[idx] = el)}
                    tabIndex={0}
                    onClick={() => setSelectedRowIndex(idx)}
                    onDoubleClick={() => openDetailModal(r)}
                  >
                    <Td data-label="Select">
                      <Checkbox isChecked={checked} onChange={() => {
                        setSelectedSet((s) => {
                          const next = new Set(s);
                          if (next.has(r.ticketId)) next.delete(r.ticketId); else next.add(r.ticketId);
                          return next;
                        });
                      }} />
                    </Td>
                    <Td data-label="Ticket">{r.ticketNo || r.ticketId}</Td>
                    <Td data-label="Truck">{r.gnswTruckNo || '-'}</Td>
                    <Td data-label="Gross">{c.grossDisplay}</Td>
                    <Td data-label="Tare">{c.tareDisplay}</Td>
                    <Td data-label="Net">{c.netDisplay}</Td>
                    <Td data-label="Status"><Badge colorScheme="teal">Exited</Badge></Td>
                    <Td data-label="Actions">
                      <HStack>
                        <Button size="sm" onClick={() => openDetailModal(r)} leftIcon={<ArrowForwardIcon />}>View</Button>
                        <Menu>
                          <MenuButton as={IconButton} aria-label="More actions" icon={<FaBars />} size="sm" />
                          <MenuList>
                            <MenuItem icon={<FaFilePdf />} onClick={() => r.fileUrl ? window.open(r.fileUrl, '_blank') : toast({ title: 'No file', status: 'info' })}>Open Attachment</MenuItem>
                            <MenuItem icon={<FaExternalLinkAlt />} onClick={() => window.open(`/tickets/${r.ticketId}`, '_blank')}>Open Ticket (new tab)</MenuItem>
                            <MenuItem icon={<FaCopy />} onClick={() => {
                              const txt = `Ticket ${r.ticketNo || r.ticketId}\nTruck: ${r.gnswTruckNo}\nNet: ${c.netDisplay}`;
                              navigator.clipboard?.writeText(txt);
                              toast({ title: 'Copied', status: 'success' });
                            }}>Copy Summary</MenuItem>
                            <MenuItem icon={<FaDownload />} onClick={() => {
                              exportToCSV([{
                                'Ticket ID': r.ticketId,
                                'Ticket No': r.ticketNo,
                                'Truck No': r.gnswTruckNo,
                                'SAD No': r.sadNo,
                                'Driver': r.driver,
                                'Gross (kg)': c.grossValue ?? '',
                                'Tare (kg)': c.tareValue ?? '',
                                'Net (kg)': c.netValue ?? '',
                                'Exit Date': r.exitTime ? new Date(r.exitTime).toLocaleString() : '',
                              }], `ticket-${r.ticketId}.csv`);
                              toast({ title: 'Exported single row', status: 'success' });
                            }}>Export Row</MenuItem>
                          </MenuList>
                        </Menu>
                      </HStack>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        </Box>
      )}

      {/* pagination */}
      <HStack justify="center" spacing={4} mt={2}>
        <Button size="sm" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1}>‹</Button>
        <Text>Page {currentPage} of {totalPages}</Text>
        <Button size="sm" onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>›</Button>
      </HStack>

      {/* Detail Modal */}
      <Modal isOpen={isOpen} onClose={onClose} size="lg" isCentered>
        <ModalOverlay />
        <AnimatePresence>
          {isOpen && selectedTicket && (
            <MotionModalContent
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.28 }}
              borderRadius="lg"
              overflow="hidden"
            >
              <ModalHeader>
                <Flex align="center" gap={3}>
                  <Icon as={FaFileInvoice} color="teal.500" />
                  <Box>
                    <Text fontWeight="bold">Ticket {selectedTicket.ticketNo || selectedTicket.ticketId}</Text>
                    <Text fontSize="sm" color="gray.500">{selectedTicket.gnswTruckNo || '—'}</Text>
                  </Box>
                </Flex>
              </ModalHeader>
              <ModalCloseButton />
              <ModalBody>
                <Stack spacing={4}>
                  <Box>
                    <Text fontWeight="semibold">General</Text>
                    <Divider mb={2} />
                    <SimpleGrid columns={2} spacing={2}>
                      <Box><Text fontSize="sm" color="gray.600">Ticket No</Text><Text>{selectedTicket.ticketNo || '-'}</Text></Box>
                      <Box><Text fontSize="sm" color="gray.600">Truck</Text><Text>{selectedTicket.gnswTruckNo || '-'}</Text></Box>
                      <Box><Text fontSize="sm" color="gray.600">SAD</Text><Text>{selectedTicket.sadNo || '-'}</Text></Box>
                      <Box><Text fontSize="sm" color="gray.600">Driver</Text><Text>{selectedTicket.driver || '-'}</Text></Box>
                      <Box><Text fontSize="sm" color="gray.600">Entry</Text><Text>{selectedTicket.date ? new Date(selectedTicket.date).toLocaleString() : '-'}</Text></Box>
                      <Box><Text fontSize="sm" color="gray.600">Exit</Text><Text>{selectedTicket.exitTime ? new Date(selectedTicket.exitTime).toLocaleString() : '-'}</Text></Box>
                    </SimpleGrid>
                  </Box>

                  <Box>
                    <Text fontWeight="semibold">Weights</Text>
                    <Divider mb={2} />
                    {(() => {
                      const c = computeWeightsFromObj({ gross: selectedTicket.gross, tare: selectedTicket.tare, net: selectedTicket.net });
                      return (
                        <SimpleGrid columns={3} spacing={3}>
                          <Box><Text fontSize="sm" color="gray.600">Gross</Text><Text fontWeight="bold">{c.grossDisplay} kg</Text></Box>
                          <Box><Text fontSize="sm" color="gray.600">Tare</Text><Text fontWeight="bold">{c.tareDisplay} kg</Text></Box>
                          <Box><Text fontSize="sm" color="gray.600">Net</Text><Text fontWeight="bold">{c.netDisplay} kg</Text></Box>
                        </SimpleGrid>
                      );
                    })()}
                  </Box>

                  <Box>
                    <Text fontWeight="semibold">Actions</Text>
                    <Divider mb={2} />
                    <HStack spacing={2}>
                      <Button size="sm" leftIcon={<FaFilePdf />} onClick={() => selectedTicket.fileUrl ? window.open(selectedTicket.fileUrl, '_blank') : toast({ title: 'No file', status: 'info' })}>Open Attachment</Button>
                      <Button size="sm" variant="outline" leftIcon={<FaCopy />} onClick={() => {
                        const c = computeWeightsFromObj({ gross: selectedTicket.gross, tare: selectedTicket.tare, net: selectedTicket.net });
                        const text = `Ticket ${selectedTicket.ticketNo || selectedTicket.ticketId}\nTruck: ${selectedTicket.gnswTruckNo}\nNet: ${c.netDisplay}`;
                        navigator.clipboard?.writeText(text);
                        toast({ title: 'Copied', status: 'success' });
                      }}>Copy</Button>
                      <Button size="sm" variant="ghost" leftIcon={<FaExternalLinkAlt />} onClick={() => window.open(`/tickets/${selectedTicket.ticketId}`, '_blank')}>Open Ticket</Button>
                      <Button size="sm" colorScheme="green" onClick={handleConfirmExit}>Confirm Exit</Button>
                    </HStack>
                  </Box>
                </Stack>
              </ModalBody>
              <ModalFooter>
                <Button onClick={onClose}>Close</Button>
              </ModalFooter>
            </MotionModalContent>
          )}
        </AnimatePresence>
      </Modal>

      {/* Orb CTA */}
      <div style={{
        position: 'fixed',
        right: 22,
        bottom: 22,
        zIndex: 2200,
      }}>
        <div
          className="orb-cta"
          onClick={openOrb}
          title="Crystal Orb — bulk actions"
          style={{
            background: 'radial-gradient(circle at 30% 20%, rgba(255,255,255,0.18), transparent 10%), linear-gradient(90deg,#7b61ff,#3ef4d0)',
            width: 76,
            height: 76,
            boxShadow: '0 12px 40px rgba(2,6,23,0.18)',
            borderRadius: 999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            border: '1px solid rgba(255,255,255,0.18)',
          }}
        >
          <FaMagic color="white" size={22} />
        </div>
      </div>

      {/* Orb Modal (holographic) */}
      <Modal isOpen={orbOpen} onClose={closeOrb} isCentered>
        <ModalOverlay backdropFilter="blur(6px) saturate(120%)" />
        <ModalContent borderRadius="16px" bg="linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,253,255,0.98))" boxShadow="0 40px 80px rgba(2,6,23,0.18)">
          <ModalHeader>Crystal Orb — Bulk Actions</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Text color="gray.600" mb={3}>Use the orb to run holographic bulk actions. This demo includes confetti/stardust and sample actions. You can wire real bulk ops here (insert into <code>outgate</code>, update ticket statuses).</Text>

            {/* Holographic cubes */}
            <div className="holo-cubes" role="img" aria-label="holographic cubes">
              <div className="cube cube-1" style={{ background: 'linear-gradient(135deg,#7c3aed,#06b6d4)' }} />
              <div className="cube cube-2" style={{ background: 'linear-gradient(135deg,#f97316,#fb7185)' }} />
              <div className="cube cube-3" style={{ background: 'linear-gradient(135deg,#06b6d4,#7c3aed)' }} />
            </div>

            <VStack spacing={4} mt={4} align="stretch">
              <Box>
                <Text fontWeight="semibold">Confirm Visible (Demo)</Text>
                <Text fontSize="sm" color="gray.500">Pretend-mark the currently visible page items as Exited (demo only). To implement true bulk confirm, perform batch inserts to <code>outgate</code> and update <code>tickets</code> table accordingly.</Text>
              </Box>

              <HStack>
                <Button colorScheme="teal" onClick={handleOrbConfirmVisible}>Confirm Visible ({pageItems.length})</Button>
                <Button variant="outline" onClick={() => { setSelectedSet(new Set()); toast({ title: 'Selection cleared', status: 'info' }); }}>Clear Selection</Button>
              </HStack>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button onClick={closeOrb}>Close</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
}
