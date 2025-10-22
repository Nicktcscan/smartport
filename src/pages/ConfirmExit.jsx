// src/pages/ConfirmExit.jsx
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Box,
  Heading,
  Input,
  Button,
  SimpleGrid,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Flex,
  Text,
  useDisclosure,
  useToast,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  IconButton,
  Stack,
  Stat,
  StatLabel,
  StatNumber,
  StatHelpText,
  HStack,
  Select,
  Tooltip,
  Badge,
  VStack,
  Divider,
  useBreakpointValue,
  Spinner,
} from '@chakra-ui/react';
import {
  SearchIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  RepeatIcon,
  CopyIcon,
} from '@chakra-ui/icons';
import { FaFilePdf, FaPrint, FaMagic } from 'react-icons/fa';
import { supabase } from '../supabaseClient';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';

// Optional worker config for pdfjs if required
// pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@2.16.105/build/pdf.worker.min.js';

const PAGE_SIZE = 5;

/* -----------------------
   Helpers (unchanged behaviour)
----------------------- */
function parseNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[,\s]+/g, ''));
  return Number.isFinite(n) ? n : null;
}

function computeWeights(row) {
  const toNum = (val) => {
    if (val === null || val === undefined || val === '') return null;
    const n = Number(String(val).toString().replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  };

  let gross = toNum(row.gross);
  let tare = toNum(row.tare);
  let net = toNum(row.net);

  if (gross == null && tare != null && net != null) gross = tare + net;
  if (tare == null && gross != null && net != null) tare = gross - net;
  if (net == null && gross != null && tare != null) net = gross - tare;

  return { gross, tare, net };
}

function formatWeight(v) {
  if (v == null) return '—';
  return Number(v).toLocaleString();
}

function exportToCSV(rows = [], filename = 'confirm-exit.csv') {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const csv = [
    keys.join(','),
    ...rows.map((r) =>
      keys
        .map((k) => {
          const v = r[k] ?? '';
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

// Extract selectable text from a remote PDF URL (best-effort)
async function extractTextFromPdfUrl(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`Failed to fetch PDF (${resp.status})`);
    }
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

// Try a few regex patterns to find driver name in text
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
export default function ConfirmExit() {
  // search / filters
  const [searchParams, setSearchParams] = useState({
    vehicleNumber: '',
    ticketNo: '',
    sadNumber: '',
    containerId: '',
  });
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');

  // data lists
  const [allTickets, setAllTickets] = useState([]); // pending tickets (status = 'Pending')
  const [filteredResults, setFilteredResults] = useState([]); // pending tickets after excluding confirmed
  const [confirmedTickets, setConfirmedTickets] = useState([]); // deduped confirmed exits (unique by ticket_id)

  // modal + selection
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [actionType, setActionType] = useState(null);
  const { isOpen, onOpen, onClose } = useDisclosure();

  // paging / sorting
  const [currentPage, setCurrentPage] = useState(1);
  const [confirmedPage, setConfirmedPage] = useState(1);
  const [sortKey, setSortKey] = useState('ticket_no');
  const [sortOrder, setSortOrder] = useState('asc');
  const [pendingPageSize, setPendingPageSize] = useState(PAGE_SIZE);

  const toast = useToast();
  const printRef = useRef(null);

  // confirmed search (live) and small state
  const [confirmedQuery, setConfirmedQuery] = useState('');
  const [totalTickets, setTotalTickets] = useState(null);
  const [exitedCount, setExitedCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // UI/UX extras
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);

  // responsive: switch table → cards on small devices
  const isMobile = useBreakpointValue({ base: true, md: false });

  // ---------------------
  // Data fetching
  // ---------------------
  const fetchTickets = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('tickets')
        .select('ticket_id, ticket_no, gnsw_truck_no, container_no, date, sad_no, status, gross, tare, net, file_url, file_name, submitted_at, driver')
        .eq('status', 'Pending')
        .order('date', { ascending: false });

      if (error) throw error;
      setAllTickets(data || []);
    } catch (err) {
      toast({ title: 'Error fetching tickets', description: err?.message || 'Could not fetch tickets', status: 'error', duration: 5000, isClosable: true });
    }
  }, [toast]);

  const fetchConfirmedExits = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('outgate')
        .select(`
          id,
          ticket_id,
          ticket_no,
          vehicle_number,
          container_id,
          sad_no,
          gross,
          tare,
          net,
          created_at,
          file_url,
          file_name,
          driver,
          tickets ( date )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const rows = data || [];

      const mapped = rows.map((r) => {
        const ticketDate = (r.tickets && Array.isArray(r.tickets) && r.tickets[0] && r.tickets[0].date) ? r.tickets[0].date : null;
        const { tickets: _tickets, ...rest } = r;
        return { ...rest, weighed_at: ticketDate };
      });

      // Deduplicate by ticket_id keeping newest
      const dedupeMap = new Map();
      for (const r of mapped) {
        if (r.ticket_id) {
          if (!dedupeMap.has(r.ticket_id)) dedupeMap.set(r.ticket_id, r);
        }
      }
      const deduped = Array.from(dedupeMap.values());
      const noTicketIdRows = mapped.filter((r) => !r.ticket_id);
      const finalConfirmed = [...deduped, ...noTicketIdRows];

      // Best-effort extract driver name from PDF if missing (non-blocking)
      const needsDriver = finalConfirmed.filter((r) => (!r.driver || r.driver === '') && r.file_url && isPdfUrl(r.file_url));
      if (needsDriver.length) {
        for (const r of needsDriver) {
          try {
            const text = await extractTextFromPdfUrl(r.file_url);
            const parsed = parseDriverNameFromText(text);
            if (parsed) {
              r.driver = parsed;
              try {
                await supabase.from('outgate').update({ driver: parsed }).eq('id', r.id);
              } catch (e) {
                console.warn('Failed to persist driver to outgate', e);
              }
            }
          } catch (err) {
            console.warn('driver extraction failed for outgate id', r.id, err);
          }
        }
      }

      setConfirmedTickets(finalConfirmed);
    } catch (err) {
      toast({ title: 'Error fetching confirmed exits', description: err?.message || 'Could not fetch confirmed exits', status: 'error', duration: 5000, isClosable: true });
    }
  }, [toast]);

  const fetchTotalTickets = useCallback(async () => {
    try {
      const respAll = await supabase.from('tickets').select('ticket_id', { head: true, count: 'exact' });
      const total = respAll?.count ?? null;
      const respExited = await supabase.from('tickets').select('ticket_id', { head: true, count: 'exact' }).eq('status', 'Exited');
      const exited = respExited?.count ?? 0;
      setTotalTickets(total);
      setExitedCount(exited);
    } catch (err) {
      console.warn('fetchTotalTickets failed', err);
      setTotalTickets(null);
      setExitedCount(0);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchTickets(), fetchConfirmedExits(), fetchTotalTickets()]).finally(() => setLoading(false));
  }, [fetchTickets, fetchConfirmedExits, fetchTotalTickets]);

  // Realtime subscriptions
  useEffect(() => {
    let ticketSub = null;
    let outgateSub = null;

    const setup = async () => {
      try {
        if (typeof supabase.channel === 'function') {
          ticketSub = supabase
            .channel('public:tickets')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => {
              fetchTickets();
              fetchTotalTickets();
            })
            .subscribe();

          outgateSub = supabase
            .channel('public:outgate')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'outgate' }, () => {
              fetchConfirmedExits();
            })
            .subscribe();
        } else if (typeof supabase.from === 'function') {
          ticketSub = supabase.from('tickets').on('*', () => {
            fetchTickets(); fetchTotalTickets();
          }).subscribe();
          outgateSub = supabase.from('outgate').on('*', () => fetchConfirmedExits()).subscribe();
        }
      } catch (err) {
        console.warn('realtime setup failed', err);
      }
    };

    setup();

    return () => {
      try {
        if (ticketSub) {
          if (ticketSub.unsubscribe) ticketSub.unsubscribe();
          else if (typeof supabase.removeChannel === 'function') supabase.removeChannel(ticketSub);
        }
        if (outgateSub) {
          if (outgateSub.unsubscribe) outgateSub.unsubscribe();
          else if (typeof supabase.removeChannel === 'function') supabase.removeChannel(outgateSub);
        }
      } catch (e) {}
    };
  }, [fetchTickets, fetchConfirmedExits, fetchTotalTickets]);

  // Exclude confirmed tickets from pending list
  useEffect(() => {
    const confirmedIds = new Set(confirmedTickets.filter((t) => t.ticket_id).map((t) => t.ticket_id));
    const unconfirmed = allTickets.filter((t) => !confirmedIds.has(t.ticket_id));
    setFilteredResults(unconfirmed);
    setCurrentPage(1);
  }, [allTickets, confirmedTickets]);

  // Input handlers
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setSearchParams((p) => ({ ...p, [name]: value }));
  };

  const parseTimeToMinutes = (timeStr) => {
    if (!timeStr) return null;
    const [hh, mm] = String(timeStr).split(':').map(Number);
    if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
    return hh * 60 + mm;
  };

  // Search & filters for pending tickets
  const handleSearch = () => {
    const confirmedIds = new Set(confirmedTickets.filter((t) => t.ticket_id).map((t) => t.ticket_id));
    const df = dateFrom ? new Date(dateFrom) : null;
    const dt = dateTo ? new Date(dateTo) : null;
    if (dt) dt.setHours(23, 59, 59, 999);
    const tFrom = parseTimeToMinutes(timeFrom);
    const tTo = parseTimeToMinutes(timeTo);

    const filtered = allTickets.filter((ticket) => {
      const matchesVehicle = (ticket.gnsw_truck_no || '').toLowerCase().includes(searchParams.vehicleNumber.toLowerCase());
      const matchesTicket = (ticket.ticket_no || '').toLowerCase().includes(searchParams.ticketNo.toLowerCase());
      const matchesSAD = (ticket.sad_no || '').toLowerCase().includes(searchParams.sadNumber.toLowerCase());
      if (!(matchesVehicle && matchesTicket && matchesSAD)) return false;
      if (confirmedIds.has(ticket.ticket_id)) return false;

      const dateStr = ticket.date || ticket.submitted_at;
      if (df || dt || tFrom !== null || tTo !== null) {
        if (!dateStr) return false;
        const ticketDate = new Date(dateStr);
        if (Number.isNaN(ticketDate.getTime())) return false;
        if (df && ticketDate < df) return false;
        if (dt && ticketDate > dt) return false;
        if (tFrom !== null || tTo !== null) {
          const mins = ticketDate.getHours() * 60 + ticketDate.getMinutes();
          if (tFrom !== null && mins < tFrom) return false;
          if (tTo !== null && mins > tTo) return false;
        }
      }
      return true;
    });

    setFilteredResults(filtered);
    setCurrentPage(1);
    if (!filtered.length) toast({ title: 'No records found', status: 'info', duration: 3000, isClosable: true });
  };

  const handleReset = () => {
    setSearchParams({ vehicleNumber: '', ticketNo: '', sadNumber: '', containerId: '' });
    setDateFrom('');
    setDateTo('');
    setTimeFrom('');
    setTimeTo('');
    const confirmedIds = new Set(confirmedTickets.filter((t) => t.ticket_id).map((t) => t.ticket_id));
    const unconfirmed = allTickets.filter((t) => !confirmedIds.has(t.ticket_id));
    setFilteredResults(unconfirmed);
    setCurrentPage(1);
    setSortKey('ticket_no');
    setSortOrder('asc');
    toast({ title: 'Filters reset', status: 'info', duration: 1500 });
  };

  const isFilterActive = useMemo(() => {
    const sp = searchParams || {};
    return !!(sp.vehicleNumber || sp.ticketNo || sp.sadNumber || dateFrom || dateTo || timeFrom || timeTo);
  }, [searchParams, dateFrom, dateTo, timeFrom, timeTo]);

  // Sorting & pagination UI helpers
  const handleSortClick = (key) => {
    if (sortKey === key) setSortOrder((s) => (s === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortOrder('asc');
    }
  };
  const getSortIndicator = (key) => (sortKey === key ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : '');

  const sortedResults = useMemo(() => {
    const arr = [...filteredResults];
    arr.sort((a, b) => {
      let va = a[sortKey];
      let vb = b[sortKey];
      if (sortKey === 'date') {
        va = new Date(a.date || a.submitted_at || 0);
        vb = new Date(b.date || b.submitted_at || 0);
      } else {
        va = (va ?? '').toString().toLowerCase();
        vb = (vb ?? '').toString().toLowerCase();
      }
      if (va < vb) return sortOrder === 'asc' ? -1 : 1;
      if (va > vb) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [filteredResults, sortKey, sortOrder]);

  const paginatedResults = useMemo(() => {
    const start = (currentPage - 1) * pendingPageSize;
    return sortedResults.slice(start, start + pendingPageSize);
  }, [sortedResults, currentPage, pendingPageSize]);

  const totalPages = Math.max(1, Math.ceil(sortedResults.length / pendingPageSize));

  // Confirmed list search + paging
  const filteredConfirmed = useMemo(() => {
    if (!confirmedQuery) return confirmedTickets;
    const q = confirmedQuery.toLowerCase();
    return confirmedTickets.filter((r) => {
      const truck = (r.vehicle_number || r.gnsw_truck_no || '').toString().toLowerCase();
      const driver = (r.driver || '').toString().toLowerCase();
      const sad = (r.sad_no || '').toString().toLowerCase();
      const ticketNo = (r.ticket_no || '').toString().toLowerCase();
      return truck.includes(q) || driver.includes(q) || sad.includes(q) || ticketNo.includes(q);
    });
  }, [confirmedTickets, confirmedQuery]);

  const paginatedConfirmed = useMemo(() => {
    const start = (confirmedPage - 1) * PAGE_SIZE;
    return filteredConfirmed.slice(start, start + PAGE_SIZE);
  }, [filteredConfirmed, confirmedPage]);

  const totalConfirmedPages = Math.max(1, Math.ceil(filteredConfirmed.length / PAGE_SIZE));

  // ---------------------
  // Modal actions (unchanged logic)
  // ---------------------
  const isPdfUrl = (url) => {
    if (!url) return false;
    const lower = url.split('?')[0].toLowerCase();
    return lower.endsWith('.pdf');
  };
  const isImageUrl = (url) => {
    if (!url) return false;
    const lower = url.split('?')[0].toLowerCase();
    return /\.(jpe?g|png|gif|bmp|webp|tiff?)$/.test(lower);
  };

  const openActionModal = async (ticket, type) => {
    setActionType(type);
    if (type === 'view') {
      let resolved = { ...ticket };
      try {
        if (!resolved.driver && resolved.file_url && isPdfUrl(resolved.file_url)) {
          const text = await extractTextFromPdfUrl(resolved.file_url);
          const parsed = parseDriverNameFromText(text);
          if (parsed) {
            resolved.driver = parsed;
            if (resolved.id) {
              try {
                await supabase.from('outgate').update({ driver: parsed }).eq('id', resolved.id);
              } catch (e) {
                console.warn('Could not update outgate driver field', e);
              }
            }
          }
        }
      } catch (err) {
        // swallow extraction errors
      }
      setSelectedTicket(resolved);
      onOpen();
    } else {
      setSelectedTicket(ticket);
      onOpen();
    }
  };

  const handleConfirmExit = async () => {
    if (!selectedTicket) return;
    try {
      let resolvedDriver = selectedTicket.driver || selectedTicket.driver_name || null;
      if (!resolvedDriver && selectedTicket.file_url && isPdfUrl(selectedTicket.file_url)) {
        const text = await extractTextFromPdfUrl(selectedTicket.file_url);
        const parsed = parseDriverNameFromText(text);
        if (parsed) resolvedDriver = parsed;
      }
      const { gross, tare, net } = computeWeights(selectedTicket);

      const payload = {
        ticket_id: selectedTicket.ticket_id,
        ticket_no: selectedTicket.ticket_no || null,
        vehicle_number: selectedTicket.gnsw_truck_no,
        container_id: selectedTicket.container_no,
        sad_no: selectedTicket.sad_no,
        gross,
        tare,
        net,
        date: selectedTicket.date || null,
        file_url: selectedTicket.file_url || null,
        file_name: selectedTicket.file_name || null,
        driver: resolvedDriver || null,
      };

      if (payload.ticket_id) {
        const { data: existing, error: existingErr } = await supabase
          .from('outgate')
          .select('id, created_at')
          .eq('ticket_id', payload.ticket_id)
          .limit(1);
        if (existingErr) console.warn('check existing outgate error', existingErr);
        if (existing && existing.length) {
          toast({
            title: 'Already confirmed',
            description: `Ticket ${payload.ticket_id} already has a confirmed exit.`,
            status: 'warning',
            duration: 4000,
            isClosable: true,
          });
          try {
            await supabase.from('tickets').update({ status: 'Exited' }).eq('ticket_id', payload.ticket_id);
            await fetchTickets(); await fetchConfirmedExits(); await fetchTotalTickets();
          } catch (e) {}
          onClose();
          return;
        }
      }

      const { error: insertErr } = await supabase.from('outgate').insert([payload]);
      if (insertErr) {
        toast({ title: 'Error confirming exit', description: insertErr.message, status: 'error', duration: 5000, isClosable: true });
        return;
      }

      if (selectedTicket.ticket_id) {
        await supabase.from('tickets').update({ status: 'Exited' }).eq('ticket_id', selectedTicket.ticket_id);
      }

      toast({ title: `Exit confirmed for ${selectedTicket.gnsw_truck_no}`, status: 'success', duration: 3000, isClosable: true });

      await fetchTickets(); await fetchConfirmedExits(); await fetchTotalTickets();
      onClose();
    } catch (err) {
      console.error('Confirm exit error:', err);
      toast({ title: 'Error', description: err?.message || 'Failed to confirm exit', status: 'error', duration: 5000, isClosable: true });
    }
  };

  // Export handlers
  const handleExportPending = () => {
    const rows = sortedResults.map((t) => {
      const w = computeWeights(t);
      return {
        'Ticket No': t.ticket_no || '',
        'Truck': t.gnsw_truck_no || '',
        'SAD No': t.sad_no || '',
        'Container': t.container_no || '',
        'Entry Date': t.date ? (new Date(t.date).toLocaleString()) : t.submitted_at ? (new Date(t.submitted_at).toLocaleString()) : '',
        'Gross (KG)': w.gross ?? '',
        'Tare (KG)': w.tare ?? '',
        'Net (KG)': w.net ?? '',
      };
    });
    if (!rows.length) {
      toast({ title: 'No rows to export', status: 'info', duration: 2000 });
      return;
    }
    exportToCSV(rows, 'pending-tickets.csv');
    toast({ title: 'Export started', status: 'success', duration: 2000 });
  };

  const handleExportConfirmed = () => {
    const rows = filteredConfirmed.map((r) => {
      const w = computeWeights(r);
      return {
        'Ticket No': r.ticket_no ?? '',
        'Truck': r.vehicle_number ?? r.gnsw_truck_no ?? '',
        'SAD No': r.sad_no ?? '',
        'Container': r.container_id ?? '',
        'Exit Date': r.created_at ? new Date(r.created_at).toLocaleString() : '',
        'Weighed At': r.weighed_at ? new Date(r.weighed_at).toLocaleString() : '',
        'Gross (KG)': w.gross ?? '',
        'Tare (KG)': w.tare ?? '',
        'Net (KG)': w.net ?? '',
        'Driver': r.driver ?? '',
      };
    });
    if (!rows.length) {
      toast({ title: 'No confirmed rows', status: 'info', duration: 2000 });
      return;
    }
    exportToCSV(rows, 'confirmed-exits.csv');
    toast({ title: 'Export started', status: 'success', duration: 2000 });
  };

  // Modal helpers
  const copyModalToClipboard = async () => {
    if (!selectedTicket) return;
    const w = computeWeights(selectedTicket);
    const lines = [
      `Ticket: ${selectedTicket.ticket_no || '-'}`,
      `Truck: ${selectedTicket.gnsw_truck_no || selectedTicket.vehicle_number || '-'}`,
      `SAD: ${selectedTicket.sad_no || '-'}`,
      `Container: ${selectedTicket.container_no || selectedTicket.container_id || '-'}`,
      `Driver: ${selectedTicket.driver || '-'}`,
      `Gross (KG): ${formatWeight(w.gross)} kg`,
      `Tare (KG): ${formatWeight(w.tare)} kg`,
      `Net (KG): ${formatWeight(w.net)} kg`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(lines);
      toast({ title: 'Copied to clipboard', status: 'success', duration: 1500 });
    } catch {
      toast({ title: 'Unable to copy', status: 'error', duration: 1500 });
    }
  };

  const printModal = () => {
    if (!printRef.current) return;
    const content = printRef.current.innerHTML;
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) return;
    w.document.write(`<html><head><title>Ticket</title></head><body>${content}</body></html>`);
    w.document.close();
    w.focus();
    w.print();
    w.close();
  };

  // Derived counts for stats
  const pendingCount = filteredResults.length;
  const confirmedUniqueCount = confirmedTickets.filter((t) => t.ticket_id).length;
  const noTicketIdConfirmedCount = confirmedTickets.filter((t) => !t.ticket_id).length;

  // ---------------------
  // UI ENHANCEMENTS: Orb Modal, confetti, voice commands
  // ---------------------
  // confetti launcher (dynamic import)
  const launchConfetti = async (particleCount = 80) => {
    try {
      let confetti = null;
      if (window && window.confetti) confetti = window.confetti;
      else {
        const mod = await import('canvas-confetti').catch(() => null);
        if (mod && mod.default) confetti = mod.default;
      }
      if (!confetti) return;
      confetti({
        particleCount,
        spread: 160,
        origin: { y: 0.6 },
        scalar: 1.1,
      });
    } catch (err) {
      console.debug('Confetti not available:', err);
    }
  };

  // orb behaviour
  const [orbOpen, setOrbOpen] = useState(false);
  const openOrb = () => setOrbOpen(true);
  const closeOrb = () => setOrbOpen(false);

  const handleOrbConfirmAll = async () => {
    try {
      const toConfirm = paginatedResults.filter(Boolean).map((t) => t.ticket_id).filter(Boolean);
      if (!toConfirm.length) {
        toast({ title: 'Nothing to confirm', status: 'info' });
        return;
      }
      toast({ title: `Bulk confirming ${toConfirm.length} tickets...`, status: 'info', duration: 2000 });
      for (const id of toConfirm) {
        try {
          await supabase.from('tickets').update({ status: 'Exited' }).eq('ticket_id', id);
        } catch (e) {
          console.warn('bulk set exited failed', id, e);
        }
      }
      await fetchTickets(); await fetchConfirmedExits(); await fetchTotalTickets();
      launchConfetti(160);
      toast({ title: `Marked ${toConfirm.length} as Exited`, status: 'success' });
      closeOrb();
    } catch (err) {
      console.error('Orb bulk confirm failed', err);
      toast({ title: 'Bulk action failed', description: err?.message || 'Unexpected', status: 'error' });
    }
  };

  // Voice commands
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;
    if (!SpeechRecognition) return undefined;

    const r = new SpeechRecognition();
    r.lang = 'en-US';
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (evt) => {
      try {
        const text = (evt.results[0] && evt.results[0][0] && evt.results[0][0].transcript) ? evt.results[0][0].transcript.toLowerCase() : '';
        if (text.includes('promote all')) {
          toast({ title: 'Voice: Promote all', description: 'Focusing first pending page', status: 'info' });
          setCurrentPage(1);
        } else if (text.includes('demote row') || text.includes('demote')) {
          const m = text.match(/demote (?:row )?(\d+)/);
          if (m && m[1]) {
            const n = Number(m[1]) - 1;
            toast({ title: `Voice: Demote row ${m[1]}`, description: `Would demote row index ${n} in UI (demo)`, status: 'info' });
            const per = pendingPageSize;
            const desiredPage = Math.floor(n / per) + 1;
            setCurrentPage(Math.max(1, Math.min(totalPages, desiredPage)));
          } else {
            toast({ title: 'Voice command not recognized', status: 'warning' });
          }
        } else if (text.includes('confirm all')) {
          toast({ title: 'Voice: Confirm all (opens orb)', status: 'info' });
          openOrb();
        } else {
          toast({ title: `Voice: "${text}"`, status: 'info' });
        }
      } catch (e) {
        console.warn('voice handler problem', e);
      }
    };
    r.onerror = (e) => {
      console.warn('Speech recognition error', e);
      setIsListening(false);
    };
    recognitionRef.current = r;
    return () => {
      try {
        if (recognitionRef.current) {
          recognitionRef.current.onresult = null;
          recognitionRef.current.onerror = null;
          recognitionRef.current.stop?.();
        }
      } catch (e) {}
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPageSize, totalPages]);

  const toggleListening = () => {
    if (!recognitionRef.current) {
      toast({ title: 'Voice not supported', description: 'Your browser does not support Web Speech API', status: 'warning' });
      return;
    }
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
      toast({ title: 'Voice listening stopped', status: 'info' });
      return;
    }
    try {
      recognitionRef.current.start();
      setIsListening(true);
      toast({ title: 'Voice listening started', status: 'success' });
    } catch (err) {
      console.warn('start recognition failed', err);
      setIsListening(false);
      toast({ title: 'Voice start failed', status: 'error' });
    }
  };

  // small helper to format date in the page
  const formatDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  };

  // Responsive card rendering for mobile
  const renderPendingCard = (ticket) => {
    const { gross, tare, net } = computeWeights(ticket);
    const ticketDate = ticket.date ? formatDate(ticket.date) : ticket.submitted_at ? formatDate(ticket.submitted_at) : '—';
    return (
      <Box key={ticket.ticket_id || ticket.ticket_no} p={4}
        borderRadius="14px" boxShadow="0 10px 30px rgba(2,6,23,0.06)" mb={3} border="1px solid rgba(2,6,23,0.06)"
        bg="linear-gradient(180deg, rgba(255,255,255,0.98), rgba(255,255,255,0.96))">
        <Flex justify="space-between" align="center" mb={2}>
          <Box>
            <Text fontWeight="bold">Ticket {ticket.ticket_no || '—'}</Text>
            <Text fontSize="sm" color="gray.500">{ticket.gnsw_truck_no || '—'}</Text>
          </Box>
          <Box textAlign="right">
            <Badge colorScheme="teal">{ticket.sad_no ?? 'No SAD'}</Badge>
            <Text fontSize="xs" color="gray.500">{ticketDate}</Text>
          </Box>
        </Flex>

        <SimpleGrid columns={3} spacing={2} mb={3}>
          <Box textAlign="center"><Text fontSize="xs" color="gray.500">Gross</Text><Text fontWeight="bold">{formatWeight(gross)}</Text></Box>
          <Box textAlign="center"><Text fontSize="xs" color="gray.500">Tare</Text><Text fontWeight="bold">{formatWeight(tare)}</Text></Box>
          <Box textAlign="center"><Text fontSize="xs" color="gray.500">Net</Text><Text fontWeight="bold">{formatWeight(net)}</Text></Box>
        </SimpleGrid>

        <HStack spacing={2}>
          <Button size="sm" colorScheme="green" leftIcon={<CheckIcon />} onClick={() => openActionModal(ticket, 'exit')}>Confirm Exit</Button>
          <IconButton size="sm" variant="outline" aria-label="View" icon={<FaFilePdf />} onClick={() => openActionModal(ticket, 'view')} />
        </HStack>
      </Box>
    );
  };

  // fancy stat card styles
  const statStyles = [
    { bg: 'linear-gradient(135deg,#6D28D9 0%, #06B6D4 100%)', color: 'white' },
    { bg: 'linear-gradient(135deg,#0ea5a4 0%, #60a5fa 100%)', color: 'white' },
    { bg: 'linear-gradient(135deg,#f97316 0%, #fb7185 100%)', color: 'white' },
    { bg: 'linear-gradient(135deg,#06b6d4 0%, #7c3aed 100%)', color: 'white' },
  ];

  // ---------------------
  // Render
  // ---------------------
  return (
    <Box p={{ base: 4, md: 8 }}>
      {/* Local page CSS for fancy table styling (vertical and horizontal lines, responsive cards, 3D on wide) */}
      <style>
        {`
        :root{
          --muted: rgba(7,17,25,0.55);
          --text-dark: #071126;
          --text-light: #ffffff;
          --neon-1: linear-gradient(135deg,#6D28D9 0%, #06B6D4 100%);
          --radius: 14px;
          --glass-border: rgba(2,6,23,0.06);
        }
        .fancy-table {
          width:100%;
          border-collapse: separate;
          border-spacing: 0;
          background: transparent;
        }
        .fancy-table thead th {
          background: linear-gradient(90deg,#b02a37,#8a1f27);
          color: var(--text-light);
          padding: 12px 10px;
          font-weight: 700;
          text-align: left;
          border-right: 1px solid rgba(255,255,255,0.06);
        }
        .fancy-table tbody td {
          background: linear-gradient(180deg,#ffffff,#fbfdff);
          padding: 10px;
          border-bottom: 1px solid #e6edf6;
          border-right: 1px solid #f0f4f8;
          vertical-align: middle;
          color: var(--text-dark);
        }
        .fancy-table tbody tr:last-child td { border-bottom: none; }
        .fancy-table thead th:first-child, .fancy-table tbody td:first-child { border-left: 1px solid rgba(0,0,0,0.03); }
        .table-wrapper { overflow-x:auto; border-radius:12px; border:1px solid var(--glass-border); box-shadow: 0 8px 24px rgba(2,6,23,0.04); padding:6px;}
        @media (max-width:780px) {
          .fancy-table thead { display:none; }
          .fancy-table tbody tr { display:block; background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(255,255,255,0.96)); margin-bottom:14px; border-radius:14px; padding:12px; box-shadow: 0 8px 24px rgba(2,6,23,0.04); }
          .fancy-table tbody td { display:block; text-align:left; padding:8px 0; border:none; }
          .fancy-table tbody td::before { content: attr(data-label); display:inline-block; width:130px; font-weight:700; color:var(--muted); }
        }
        @media (min-width:1400px) {
          .panel-3d { transform-style: preserve-3d; perspective:1200px; transition: transform 0.6s cubic-bezier(.2,.8,.2,1); }
          .panel-3d:hover { transform: rotateY(6deg) rotateX(2deg) translateZ(6px); box-shadow: 0 30px 60px rgba(2,6,23,0.12); }
        }
        /* subtle hover */
        .fancy-table tbody tr:hover td { transform: translateY(-2px); transition: transform 0.18s ease; }
        `}
      </style>

      <Flex justify="space-between" align="center" mb={6} flexWrap="wrap" gap={4}>
        <Stack spacing={1}>
          <Heading size="lg">Confirm Vehicle Exit</Heading>
          <Text color="gray.600">Search pending tickets, confirm exits, and review recent exits.</Text>
        </Stack>

        <HStack spacing={2}>
          <Tooltip label="Export pending (filtered) to CSV"><Button leftIcon={<DownloadIcon />} colorScheme="teal" variant="ghost" onClick={handleExportPending}>Export Pending</Button></Tooltip>
          <Tooltip label="Export confirmed exits to CSV"><Button leftIcon={<DownloadIcon />} variant="outline" onClick={handleExportConfirmed}>Export Confirmed</Button></Tooltip>
          <Tooltip label="Reset filters"><Button leftIcon={<RepeatIcon />} variant="ghost" onClick={handleReset}>Reset</Button></Tooltip>
          <Tooltip label={isListening ? 'Stop voice' : 'Start voice'}><Button onClick={toggleListening} colorScheme={isListening ? 'red' : 'purple'} leftIcon={<FaMagic />}>{isListening ? 'Listening…' : 'Voice'}</Button></Tooltip>
        </HStack>
      </Flex>

      {/* Stats */}
      <SimpleGrid columns={{ base: 1, md: 4 }} spacing={3} mb={6}>
        <Stat borderRadius="md" p={4} className="panel-3d" sx={{ background: statStyles[0].bg, color: statStyles[0].color }}>
          <StatLabel>Total Pending</StatLabel>
          <StatNumber>{pendingCount}</StatNumber>
          <StatHelpText>Tickets awaiting exit</StatHelpText>
        </Stat>

        <Stat borderRadius="md" p={4} className="panel-3d" sx={{ background: statStyles[1].bg, color: statStyles[1].color }}>
          <StatLabel>Confirmed Exits</StatLabel>
          <StatNumber>{exitedCount}</StatNumber>
          <StatHelpText>All tickets with status Exited</StatHelpText>
        </Stat>

        <Stat borderRadius="md" p={4} className="panel-3d" sx={{ background: statStyles[2].bg, color: statStyles[2].color }}>
          <StatLabel>Total Tickets</StatLabel>
          <StatNumber>{totalTickets != null ? totalTickets : '—'}</StatNumber>
          <StatHelpText>All tickets</StatHelpText>
        </Stat>

        <Stat borderRadius="md" p={4} className="panel-3d" sx={{ background: statStyles[3].bg, color: statStyles[3].color }}>
          <StatLabel>Page Size</StatLabel>
          <StatNumber>{pendingPageSize}</StatNumber>
          <StatHelpText>
            <Select size="sm" value={pendingPageSize} onChange={(e) => { setPendingPageSize(Number(e.target.value)); setCurrentPage(1); }}>
              {[5, 10, 20, 50].map((n) => <option key={n} value={n}>{n} / page</option>)}
            </Select>
          </StatHelpText>
        </Stat>
      </SimpleGrid>

      {/* Filters */}
      <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4} mb={4}>
        <Input name="vehicleNumber" placeholder="Vehicle Number" value={searchParams.vehicleNumber} onChange={handleInputChange} />
        <Input name="ticketNo" placeholder="Ticket No" value={searchParams.ticketNo} onChange={handleInputChange} />
        <Input name="sadNumber" placeholder="SAD Number" value={searchParams.sadNumber} onChange={handleInputChange} />
      </SimpleGrid>

      <SimpleGrid columns={{ base: 1, md: 4 }} spacing={4} mb={4}>
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        <Input type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} />
        <Input type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} />
      </SimpleGrid>

      <Flex mb={6} gap={4}>
        <Button leftIcon={<SearchIcon />} colorScheme="blue" onClick={handleSearch}>Search</Button>
        {isFilterActive && <Button variant="outline" onClick={handleReset}>Reset</Button>}
      </Flex>

      {/* Pending table / cards */}
      {loading ? (
        <Flex justify="center" mb={6}><Spinner /></Flex>
      ) : isMobile ? (
        <VStack align="stretch" spacing={3} mb={6}>
          {paginatedResults.map((ticket) => renderPendingCard(ticket))}
        </VStack>
      ) : (
        <Box className="table-wrapper mb-6">
          <Table className="fancy-table" size="sm">
            <Thead>
              <Tr>
                <Th>SAD/Ticket</Th>
                <Th>Truck</Th>
                <Th isNumeric>Gross (kg)</Th>
                <Th isNumeric>Tare (kg)</Th>
                <Th isNumeric>Net (kg)</Th>
                <Th>Date</Th>
                <Th>Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {paginatedResults.map((ticket) => {
                const { gross, tare, net } = computeWeights(ticket);
                const ticketDate = ticket.date ? formatDate(ticket.date) : ticket.submitted_at ? formatDate(ticket.submitted_at) : '—';
                return (
                  <Tr key={ticket.ticket_id || ticket.ticket_no}>
                    <Td data-label="SAD/Ticket">
                      <Text fontWeight="bold">{ticket.sad_no ?? '—'}</Text>
                      <Text fontSize="sm" color="gray.500">{ticket.ticket_no ?? '—'}</Text>
                    </Td>
                    <Td data-label="Truck">{ticket.gnsw_truck_no ?? '—'}</Td>
                    <Td isNumeric data-label="Gross">{formatWeight(gross)}</Td>
                    <Td isNumeric data-label="Tare">{formatWeight(tare)}</Td>
                    <Td isNumeric data-label="Net">{formatWeight(net)}</Td>
                    <Td data-label="Date">{ticketDate}</Td>
                    <Td data-label="Actions">
                      <HStack spacing={2}>
                        <Button size="sm" colorScheme="green" leftIcon={<CheckIcon />} onClick={() => openActionModal(ticket, 'exit')}>Confirm</Button>
                        <IconButton aria-label="View" icon={<FaFilePdf />} size="sm" variant="outline" onClick={() => openActionModal(ticket, 'view')} />
                      </HStack>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        </Box>
      )}

      {/* Pending pagination */}
      <Flex justify="center" align="center" gap={4} mb={8}>
        <IconButton icon={<ChevronLeftIcon />} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} isDisabled={currentPage === 1} />
        <Text>Page {currentPage} of {totalPages}</Text>
        <IconButton icon={<ChevronRightIcon />} onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} isDisabled={currentPage === totalPages} />
      </Flex>

      {/* Action Modal */}
      <Modal isOpen={isOpen} onClose={onClose} isCentered size={actionType === 'view' ? 'xl' : 'md'}>
        <ModalOverlay />
        <ModalContent borderRadius="16px" bg="linear-gradient(180deg, #fff, #fbfdff)" boxShadow="0 30px 60px rgba(2,6,23,0.08)">
          <ModalHeader>{actionType === 'exit' ? 'Confirm Exit' : 'View Ticket File'}</ModalHeader>
          <ModalCloseButton />
          <ModalBody ref={printRef}>
            {actionType === 'exit' && selectedTicket && (
              <Stack spacing={4}>
                <Text>Confirm exit for <strong>{selectedTicket.gnsw_truck_no}</strong> — container <strong>{selectedTicket.container_no || '—'}</strong>?</Text>
                <Box>
                  <Text fontSize="sm" color="gray.600">Ticket No: {selectedTicket.ticket_no || '—'}</Text>
                  <Text fontSize="sm" color="gray.600">SAD No: {selectedTicket.sad_no || '—'}</Text>
                  <Text fontSize="sm" color="gray.600">Entry Date: {selectedTicket.date ? formatDate(selectedTicket.date) : (selectedTicket.submitted_at ? formatDate(selectedTicket.submitted_at) : '—')}</Text>
                </Box>
                <Box>
                  <Text fontWeight="semibold">Weight Summary</Text>
                  {(() => {
                    const { gross, tare, net } = computeWeights(selectedTicket);
                    return (
                      <SimpleGrid columns={3} spacing={2} mt={2}>
                        <Box textAlign="center"><Text fontSize="sm" color="gray.600">Gross</Text><Text fontWeight="bold">{formatWeight(gross)} kg</Text></Box>
                        <Box textAlign="center"><Text fontSize="sm" color="gray.600">Tare</Text><Text fontWeight="bold">{formatWeight(tare)} kg</Text></Box>
                        <Box textAlign="center"><Text fontSize="sm" color="gray.600">Net</Text><Text fontWeight="bold">{formatWeight(net)} kg</Text></Box>
                      </SimpleGrid>
                    );
                  })()}
                </Box>
              </Stack>
            )}

            {actionType === 'view' && selectedTicket && (
              <>
                {selectedTicket.file_url ? (
                  isPdfUrl(selectedTicket.file_url) ? (
                    <iframe src={selectedTicket.file_url} width="100%" height="600px" title={`Ticket ${selectedTicket.ticket_id || selectedTicket.id || ''}`} style={{ border: '1px solid #e2e8f0', borderRadius: 6 }} />
                  ) : isImageUrl(selectedTicket.file_url) ? (
                    <Box textAlign="center">
                      <img src={selectedTicket.file_url} alt={`Ticket ${selectedTicket.ticket_id || ''}`} style={{ maxWidth: '100%', maxHeight: '70vh', borderRadius: 6, border: '1px solid #e2e8f0' }} />
                    </Box>
                  ) : (
                    <Box>
                      <iframe src={selectedTicket.file_url} width="100%" height="600px" title={`Ticket ${selectedTicket.ticket_id || ''}`} style={{ border: '1px solid #e2e8f0', borderRadius: 6 }} />
                      <Text mt={2}>If the file doesn't render, <a href={selectedTicket.file_url} target="_blank" rel="noreferrer">open in a new tab</a>.</Text>
                    </Box>
                  )
                ) : (
                  <Box>
                    <Text mb={2}>No Attachment Found</Text>
                    <Text fontSize="sm" color="gray.600">This appears to be a manual entry without an attachment.</Text>
                  </Box>
                )}
              </>
            )}
          </ModalBody>

          {actionType === 'exit' ? (
            <ModalFooter>
              <Button mr={3} onClick={onClose}>Cancel</Button>
              <Button colorScheme="green" onClick={handleConfirmExit}>Confirm Exit</Button>
            </ModalFooter>
          ) : (
            <ModalFooter>
              <Tooltip label="Copy details"><IconButton icon={<CopyIcon />} aria-label="Copy" mr={2} onClick={copyModalToClipboard} /></Tooltip>
              <Tooltip label="Print"><IconButton icon={<FaPrint />} aria-label="Print" mr={2} onClick={printModal} /></Tooltip>
              <Button onClick={onClose}>Close</Button>
            </ModalFooter>
          )}
        </ModalContent>
      </Modal>

      {/* Confirmed exits */}
      <Flex align="center" justify="space-between" mt={10} mb={4} gap={4} flexWrap="wrap">
        <Heading size="md">Confirmed Exits</Heading>
        <HStack spacing={2}>
          <Input placeholder="Search confirmed by Truck, Driver, SAD, or Ticket No (live)" value={confirmedQuery} onChange={(e) => { setConfirmedQuery(e.target.value); setConfirmedPage(1); }} size="sm" maxW="380px" />
          <Button size="sm" onClick={() => { setConfirmedQuery(''); setConfirmedPage(1); }}>Clear</Button>
        </HStack>
      </Flex>

      <Box className="table-wrapper" mb={6}>
        <Table className="fancy-table" size="sm">
          <Thead>
            <Tr>
              <Th>Ticket</Th>
              <Th>SAD</Th>
              <Th>Truck</Th>
              <Th isNumeric>Gross</Th>
              <Th isNumeric>Tare</Th>
              <Th isNumeric>Net</Th>
              <Th>Driver</Th>
              <Th>Exit At</Th>
              <Th>Weighed</Th>
              <Th>View</Th>
            </Tr>
          </Thead>
          <Tbody>
            {paginatedConfirmed.map((ticket) => {
              const { gross, tare, net } = computeWeights(ticket);
              return (
                <Tr key={ticket.ticket_id || ticket.id}>
                  <Td data-label="Ticket">{ticket.ticket_no ?? '-'}</Td>
                  <Td data-label="SAD">{ticket.sad_no ?? '—'}</Td>
                  <Td data-label="Truck">{ticket.vehicle_number ?? ticket.gnsw_truck_no ?? '—'}</Td>
                  <Td isNumeric data-label="Gross">{formatWeight(gross)}</Td>
                  <Td isNumeric data-label="Tare">{formatWeight(tare)}</Td>
                  <Td isNumeric data-label="Net">{formatWeight(net)}</Td>
                  <Td data-label="Driver">{ticket.driver ?? '—'}</Td>
                  <Td data-label="Exit At">{ticket.created_at ? formatDate(ticket.created_at) : '—'}</Td>
                  <Td data-label="Weighed">{ticket.weighed_at ? formatDate(ticket.weighed_at) : '—'}</Td>
                  <Td data-label="View"><IconButton aria-label="View File" icon={<FaFilePdf color="red" />} size="sm" variant="outline" onClick={() => openActionModal(ticket, 'view')} /></Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      </Box>

      <Flex mt={4} justify="center" gap={2}>
        <IconButton icon={<ChevronLeftIcon />} onClick={() => setConfirmedPage((p) => Math.max(1, p - 1))} isDisabled={confirmedPage === 1} />
        <Text>Page {confirmedPage} of {totalConfirmedPages}</Text>
        <IconButton icon={<ChevronRightIcon />} onClick={() => setConfirmedPage((p) => Math.min(totalConfirmedPages, p + 1))} isDisabled={confirmedPage === totalConfirmedPages} />
      </Flex>

      {/* Crystal orb CTA */}
      <div
        style={{
          position: 'fixed',
          right: 22,
          bottom: 22,
          width: 74,
          height: 74,
          borderRadius: 999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2200,
          boxShadow: '0 10px 30px rgba(2,6,23,0.18)',
          cursor: 'pointer',
          background: 'radial-gradient(circle at 30% 20%, rgba(255,255,255,0.18), transparent 10%), linear-gradient(90deg,#7b61ff,#3ef4d0)',
          border: '1px solid rgba(255,255,255,0.18)',
        }}
        role="button"
        aria-label="Orb"
        onClick={openOrb}
        title="Magic Orb — bulk actions and voice goodies"
      >
        <FaMagic color="white" size={22} />
      </div>

      {/* Orb holographic modal */}
      <Modal isOpen={orbOpen} onClose={closeOrb} isCentered>
        <ModalOverlay backdropFilter="blur(6px) hue-rotate(10deg)" />
        <ModalContent borderRadius="16px" bg="linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,253,255,0.98))" boxShadow="0 40px 80px rgba(2,6,23,0.18)">
          <ModalHeader>Crystal Orb — Bulk Actions</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Text mb={3} color="gray.600">Holographic bulk actions. Use carefully — marking visible tickets as Exited will update DB status.</Text>
            <Divider mb={3} />
            <VStack spacing={3} align="stretch">
              <Box>
                <Text fontWeight="semibold">Bulk Confirm Visible</Text>
                <Text fontSize="sm" color="gray.500">Marks currently visible pending tickets (current page) as <em>Exited</em> in the tickets table. This is a convenience helper; normal insert flows are separate.</Text>
              </Box>

              <HStack>
                <Button colorScheme="teal" onClick={handleOrbConfirmAll}>Confirm Visible ({paginatedResults.length})</Button>
                <Button variant="outline" onClick={() => { toast({ title: 'Orb: Demo action', description: 'This is a safe demo action.', status: 'info' }); }}>Demo</Button>
                <Button onClick={() => { launchConfetti(120); toast({ title: 'Stardust!', status: 'success' }); }}>Stardust</Button>
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

/* Small helpers for reuse */
function isPdfUrl(url) {
  if (!url) return false;
  const lower = url.split('?')[0].toLowerCase();
  return lower.endsWith('.pdf');
}
function isImageUrl(url) {
  if (!url) return false;
  const lower = url.split('?')[0].toLowerCase();
  return /\.(jpe?g|png|gif|bmp|webp|tiff?)$/.test(lower);
}
