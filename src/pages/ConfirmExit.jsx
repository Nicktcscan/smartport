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
import { FaFilePdf, FaPrint } from 'react-icons/fa';
import { supabase } from '../supabaseClient';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';

// If your app requires a worker for pdfjs (some setups), you may need to set workerSrc:
// pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@2.16.105/build/pdf.worker.min.js';

const PAGE_SIZE = 5;

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
  // Common patterns
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

export default function ConfirmExit() {
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

  const [allTickets, setAllTickets] = useState([]); // pending tickets (status = 'Pending')
  const [filteredResults, setFilteredResults] = useState([]); // pending tickets after excluding confirmed
  const [confirmedTickets, setConfirmedTickets] = useState([]); // deduped confirmed exits (unique by ticket_id)
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [actionType, setActionType] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [confirmedPage, setConfirmedPage] = useState(1);
  const [sortKey, setSortKey] = useState('ticket_no');
  const [sortOrder, setSortOrder] = useState('asc');
  const [pendingPageSize, setPendingPageSize] = useState(PAGE_SIZE);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const toast = useToast();

  const [totalTickets, setTotalTickets] = useState(null);
  const [exitedCount, setExitedCount] = useState(0); // count of tickets.status === 'Exited'
  const printRef = useRef(null);

  // Confirmed search (live)
  const [confirmedQuery, setConfirmedQuery] = useState('');

  // Helpers
  const formatDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

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

  // Fetch pending tickets (status = 'Pending')
  const fetchTickets = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('tickets')
        .select('ticket_id, ticket_no, gnsw_truck_no, container_no, date, sad_no, status, gross, tare, net, file_url, file_name, submitted_at, driver')
        .eq('status', 'Pending')
        .order('date', { ascending: false });

      if (error) throw error;
      // IMPORTANT: don't set filteredResults here to avoid UI flash — let the dedupe effect compute the "unconfirmed" list
      setAllTickets(data || []);
    } catch (err) {
      toast({ title: 'Error fetching tickets', description: err?.message || 'Could not fetch tickets', status: 'error', duration: 5000, isClosable: true });
    }
  }, [toast]);

  // Fetch confirmed exits and dedupe (keep latest per ticket_id)
  const fetchConfirmedExits = useCallback(async () => {
    try {
      // include weighed_at in select
      const { data, error } = await supabase
        .from('outgate')
        .select('id, ticket_id, ticket_no, vehicle_number, container_id, sad_no, gross, tare, net, created_at, weighed_at, file_url, file_name, driver')
        .order('created_at', { ascending: false }); // newest first

      if (error) throw error;

      const rows = data || [];

      // Deduplicate by ticket_id: keep the first (newest) row per ticket_id
      const dedupeMap = new Map();
      for (const r of rows) {
        if (r.ticket_id) {
          if (!dedupeMap.has(r.ticket_id)) {
            dedupeMap.set(r.ticket_id, r);
          }
        }
      }

      const deduped = Array.from(dedupeMap.values());
      const noTicketIdRows = rows.filter((r) => !r.ticket_id);
      const finalConfirmed = [...deduped, ...noTicketIdRows];

      // best-effort: extract driver names for missing driver fields from PDFs (non-blocking)
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

  // Fetch totals: total tickets and exited tickets count
  const fetchTotalTickets = useCallback(async () => {
    try {
      // total count
      const respAll = await supabase.from('tickets').select('ticket_id', { head: true, count: 'exact' });
      const total = respAll?.count ?? null;

      // exited count
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

  // initial load
  useEffect(() => {
    fetchTickets();
    fetchConfirmedExits();
    fetchTotalTickets();
  }, [fetchTickets, fetchConfirmedExits, fetchTotalTickets]);

  // Realtime subscriptions: when tickets/outgate change refresh lists
  useEffect(() => {
    let ticketSub = null;
    let outgateSub = null;

    const setup = async () => {
      try {
        // Newer client (v2) — channel-based realtime (if available)
        if (typeof supabase.channel === 'function') {
          try {
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
          } catch (e) {
            ticketSub = null;
            outgateSub = null;
          }
        }

        // Older client fallback
        if (!ticketSub && typeof supabase.from === 'function' && typeof supabase.from('').on === 'function') {
          try {
            ticketSub = supabase
              .from('tickets')
              .on('*', () => {
                fetchTickets();
                fetchTotalTickets();
              })
              .subscribe();

            outgateSub = supabase
              .from('outgate')
              .on('*', () => {
                fetchConfirmedExits();
              })
              .subscribe();
          } catch (e) {
            ticketSub = null;
            outgateSub = null;
          }
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
          else if (typeof supabase.removeSubscription === 'function') supabase.removeSubscription(ticketSub);
        }
        if (outgateSub) {
          if (outgateSub.unsubscribe) outgateSub.unsubscribe();
          else if (typeof supabase.removeChannel === 'function') supabase.removeChannel(outgateSub);
          else if (typeof supabase.removeSubscription === 'function') supabase.removeSubscription(outgateSub);
        }
      } catch (e) {
        // ignore cleanup failures
      }
    };
  }, [fetchTickets, fetchConfirmedExits, fetchTotalTickets]);

  // Exclude confirmed tickets from pending list (use deduped confirmed ticket_ids)
  useEffect(() => {
    const confirmedIds = new Set(confirmedTickets.filter((t) => t.ticket_id).map((t) => t.ticket_id));
    const unconfirmed = allTickets.filter((t) => !confirmedIds.has(t.ticket_id));
    setFilteredResults(unconfirmed);
    setCurrentPage(1);
  }, [allTickets, confirmedTickets]);

  // Inputs
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

  // Search & filter for pending tickets
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
    return !!(
      sp.vehicleNumber ||
      sp.ticketNo ||
      sp.sadNumber ||
      dateFrom ||
      dateTo ||
      timeFrom ||
      timeTo
    );
  }, [searchParams, dateFrom, dateTo, timeFrom, timeTo]);

  // Sorting & pagination
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

  // Confirmed search + pagination: filter confirmedTickets (deduped)
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

  // Open modal for view or confirm
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
        // ignore extraction errors for modal open
      }

      setSelectedTicket(resolved);
      onOpen();
    } else {
      setSelectedTicket(ticket);
      onOpen();
    }
  };

  // Confirm exit: insert outgate row (prevents duplicates)
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
        // date represents entry date; outgate uses created_at for exit time
        date: selectedTicket.date || null,
        file_url: selectedTicket.file_url || null,
        file_name: selectedTicket.file_name || null,
        driver: resolvedDriver || null,
      };

      // Prevent duplicate outgate insert for same ticket_id
      if (payload.ticket_id) {
        const { data: existing, error: existingErr } = await supabase
          .from('outgate')
          .select('id, created_at')
          .eq('ticket_id', payload.ticket_id)
          .limit(1);
        if (existingErr) {
          console.warn('check existing outgate error', existingErr);
        }
        if (existing && existing.length) {
          toast({
            title: 'Already confirmed',
            description: `Ticket ${payload.ticket_id} already has a confirmed exit.`,
            status: 'warning',
            duration: 4000,
            isClosable: true,
          });

          // ensure ticket status is Exited
          try {
            await supabase.from('tickets').update({ status: 'Exited' }).eq('ticket_id', payload.ticket_id);
            await fetchTickets();
            await fetchConfirmedExits();
            await fetchTotalTickets();
          } catch (e) {
            // ignore
          }

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

      // refresh lists
      await fetchTickets();
      await fetchConfirmedExits();
      await fetchTotalTickets();

      onClose();
    } catch (err) {
      console.error('Confirm exit error:', err);
      toast({ title: 'Error', description: err?.message || 'Failed to confirm exit', status: 'error', duration: 5000, isClosable: true });
    }
  };

  // Export helpers
  const handleExportPending = () => {
    const rows = sortedResults.map((t) => {
      const w = computeWeights(t);
      return {
        'Ticket No': t.ticket_no || '',
        'Truck': t.gnsw_truck_no || '',
        'SAD No': t.sad_no || '',
        'Container': t.container_no || '',
        'Entry Date': t.date ? formatDate(t.date) : t.submitted_at ? formatDate(t.submitted_at) : '',
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
        'Exit Date': r.created_at ? formatDate(r.created_at) : '',
        'Weighed At': r.weighed_at ? formatDate(r.weighed_at) : '',
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
  // FIX: show the number of tickets currently visible in pending list (after excluding confirmed)
  const pendingCount = filteredResults.length;
  const confirmedUniqueCount = confirmedTickets.filter((t) => t.ticket_id).length;
  const noTicketIdConfirmedCount = confirmedTickets.filter((t) => !t.ticket_id).length;

  return (
    <Box p={{ base: 4, md: 8 }}>
      <Flex justify="space-between" align="center" mb={6} flexWrap="wrap" gap={4}>
        <Stack spacing={1}>
          <Heading size="lg">Confirm Vehicle Exit</Heading>
          <Text color="gray.600">Search pending tickets, confirm exits, and review recent exits.</Text>
        </Stack>

        <HStack spacing={2}>
          <Tooltip label="Export pending (filtered) to CSV">
            <Button leftIcon={<DownloadIcon />} colorScheme="teal" variant="ghost" onClick={handleExportPending}>Export Pending</Button>
          </Tooltip>
          <Tooltip label="Export confirmed exits to CSV">
            <Button leftIcon={<DownloadIcon />} variant="outline" onClick={handleExportConfirmed}>Export Confirmed</Button>
          </Tooltip>
          <Tooltip label="Reset filters">
            <Button leftIcon={<RepeatIcon />} variant="ghost" onClick={handleReset}>Reset</Button>
          </Tooltip>
        </HStack>
      </Flex>

      {/* Stats */}
      <SimpleGrid columns={{ base: 1, md: 4 }} spacing={3} mb={6}>
        <Stat bg="white" p={4} borderRadius="md" boxShadow="sm" border="1px solid" borderColor="gray.200">
          <StatLabel>Pending</StatLabel>
          <StatNumber>{pendingCount}</StatNumber>
          <StatHelpText>Tickets awaiting exit</StatHelpText>
        </Stat>

        <Stat bg="white" p={4} borderRadius="md" boxShadow="sm" border="1px solid" borderColor="gray.200">
          <StatLabel>Confirmed Exits</StatLabel>
          <StatNumber>{exitedCount}</StatNumber>
          <StatHelpText>All tickets with status Exited</StatHelpText>
        </Stat>

        <Stat bg="white" p={4} borderRadius="md" boxShadow="sm" border="1px solid" borderColor="gray.200">
          <StatLabel>Total Tickets</StatLabel>
          <StatNumber>{totalTickets != null ? totalTickets : '—'}</StatNumber>
          <StatHelpText>All tickets</StatHelpText>
        </Stat>

        <Stat bg="white" p={4} borderRadius="md" boxShadow="sm" border="1px solid" borderColor="gray.200">
          <StatLabel>Page Size</StatLabel>
          <StatNumber>{pendingPageSize}</StatNumber>
          <StatHelpText>
            <Select size="sm" value={pendingPageSize} onChange={(e) => { setPendingPageSize(Number(e.target.value)); setCurrentPage(1); }}>
              {[5, 10, 20, 50].map((n) => <option key={n} value={n}>{n} / page</option>)}
            </Select>
          </StatHelpText>
        </Stat>
      </SimpleGrid>

      {/* Search */}
      <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4} mb={4}>
        <Input name="vehicleNumber" placeholder="Vehicle Number" value={searchParams.vehicleNumber} onChange={handleInputChange} />
        <Input name="ticketNo" placeholder="Ticket No" value={searchParams.ticketNo} onChange={handleInputChange} />
        <Input name="sadNumber" placeholder="SAD Number" value={searchParams.sadNumber} onChange={handleInputChange} />
      </SimpleGrid>

      <SimpleGrid columns={{ base: 1, md: 4 }} spacing={4} mb={4}>
        <Input type="date" placeholder="Date From" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <Input type="date" placeholder="Date To" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        <Input type="time" placeholder="Time From" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} />
        <Input type="time" placeholder="Time To" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} />
      </SimpleGrid>

      <Flex mb={6} gap={4}>
        <Button leftIcon={<SearchIcon />} colorScheme="blue" onClick={handleSearch}>Search</Button>
        {isFilterActive && <Button variant="outline" onClick={handleReset}>Reset</Button>}
      </Flex>

      {/* Pending */}
      <Box bg="white" borderRadius="md" boxShadow="sm" overflowX="auto" mb={6}>
        <Table variant="simple" size="sm">
          <Thead bg="gray.100">
            <Tr>
              <Th cursor="pointer" onClick={() => handleSortClick('ticket_no')}>TICKET NO{getSortIndicator('ticket_no')}</Th>
              <Th cursor="pointer" onClick={() => handleSortClick('sad_no')}>SAD NUMBER{getSortIndicator('sad_no')}</Th>
              <Th cursor="pointer" onClick={() => handleSortClick('gnsw_truck_no')}>TRUCK NO{getSortIndicator('gnsw_truck_no')}</Th>
              <Th isNumeric cursor="pointer" onClick={() => handleSortClick('gross')}>Gross(kg){getSortIndicator('gross')}</Th>
              <Th isNumeric cursor="pointer" onClick={() => handleSortClick('tare')}>Tare(kg){getSortIndicator('tare')}</Th>
              <Th isNumeric cursor="pointer" onClick={() => handleSortClick('net')}>Net(kg){getSortIndicator('net')}</Th>
              <Th cursor="pointer" onClick={() => handleSortClick('date')}>Ticket Date{getSortIndicator('date')}</Th>
              <Th>Action</Th>
            </Tr>
          </Thead>
          <Tbody>
            {paginatedResults.map((ticket) => {
              const { gross, tare, net } = computeWeights(ticket);
              const ticketDate = ticket.date ? formatDate(ticket.date) : ticket.submitted_at ? formatDate(ticket.submitted_at) : '—';
              return (
                <Tr key={ticket.ticket_id}>
                  <Td>{ticket.ticket_no}</Td>
                  <Td>{ticket.sad_no ?? '—'}</Td>
                  <Td>{ticket.gnsw_truck_no ?? '—'}</Td>
                  <Td isNumeric>{formatWeight(gross)}</Td>
                  <Td isNumeric>{formatWeight(tare)}</Td>
                  <Td isNumeric>{formatWeight(net)}</Td>
                  <Td>{ticketDate}</Td>
                  <Td>
                    <HStack spacing={2}>
                      <Button size="sm" colorScheme="green" leftIcon={<CheckIcon />} onClick={() => openActionModal(ticket, 'exit')}>
                        Confirm Exit
                      </Button>
                      <IconButton aria-label="View File" icon={<FaFilePdf color="red" />} size="sm" variant="outline" onClick={() => openActionModal(ticket, 'view')} />
                    </HStack>
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      </Box>

      {/* Pending pagination */}
      <Flex justify="center" align="center" gap={4} mb={8}>
        <IconButton icon={<ChevronLeftIcon />} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} isDisabled={currentPage === 1} />
        <Text>Page {currentPage} of {totalPages}</Text>
        <IconButton icon={<ChevronRightIcon />} onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} isDisabled={currentPage === totalPages} />
      </Flex>

      {/* Modal */}
      <Modal isOpen={isOpen} onClose={onClose} isCentered size={actionType === 'view' ? 'xl' : 'md'}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>{actionType === 'exit' ? 'Confirm Exit' : 'View Ticket File'}</ModalHeader>
          <ModalCloseButton />
          <ModalBody ref={printRef}>
            {actionType === 'exit' && selectedTicket && (
              <Stack spacing={4}>
                <Text>
                  Confirm exit for <strong>{selectedTicket.gnsw_truck_no}</strong> — container <strong>{selectedTicket.container_no || '—'}</strong>?
                </Text>

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
              <Tooltip label="Copy details">
                <IconButton icon={<CopyIcon />} aria-label="Copy" mr={2} onClick={copyModalToClipboard} />
              </Tooltip>
              <Tooltip label="Print">
                <IconButton icon={<FaPrint />} aria-label="Print" mr={2} onClick={printModal} />
              </Tooltip>
              <Button onClick={onClose}>Close</Button>
            </ModalFooter>
          )}
        </ModalContent>
      </Modal>

      {/* Confirmed exits header + live search */}
      <Flex align="center" justify="space-between" mt={10} mb={4} gap={4} flexWrap="wrap">
        <Heading size="md">Confirmed Exits</Heading>
        <HStack spacing={2}>
          <Input
            placeholder="Search confirmed by Truck, Driver, SAD, or Ticket No (live)"
            value={confirmedQuery}
            onChange={(e) => { setConfirmedQuery(e.target.value); setConfirmedPage(1); }}
            size="sm"
            maxW="380px"
          />
          <Button size="sm" onClick={() => { setConfirmedQuery(''); setConfirmedPage(1); }}>Clear</Button>
        </HStack>
      </Flex>

      <Box bg="white" borderRadius="md" boxShadow="sm" overflowX="auto">
        <Table variant="simple" size="sm">
          <Thead bg="gray.100">
            <Tr>
              <Th>TICKET NO</Th>
              <Th>SAD Number</Th>
              <Th>TRUCK NO</Th>
              <Th isNumeric>GROSS(KG)</Th>
              <Th isNumeric>TARE(KG)</Th>
              <Th isNumeric>NET(KG)</Th>
              <Th>DRIVER</Th>
              <Th>EXIT DATE</Th>
              <Th>WEIGHED AT</Th>
              <Th>Action</Th>
            </Tr>
          </Thead>
          <Tbody>
            {paginatedConfirmed.map((ticket) => {
              const { gross, tare, net } = computeWeights(ticket);
              return (
                <Tr key={ticket.ticket_id || ticket.id}>
                  <Td>{ticket.ticket_no ?? '-'}</Td>
                  <Td>{ticket.sad_no ?? '—'}</Td>
                  <Td>{ticket.vehicle_number ?? ticket.gnsw_truck_no ?? '—'}</Td>
                  <Td isNumeric>{formatWeight(gross)}</Td>
                  <Td isNumeric>{formatWeight(tare)}</Td>
                  <Td isNumeric>{formatWeight(net)}</Td>
                  <Td>{ticket.driver ?? '—'}</Td>
                  <Td>{ticket.created_at ? formatDate(ticket.created_at) : '—'}</Td>
                  <Td>{ticket.weighed_at ? formatDate(ticket.weighed_at) : '—'}</Td>
                  <Td>
                    <IconButton aria-label="View File" icon={<FaFilePdf color="red" />} size="sm" variant="outline" onClick={() => openActionModal(ticket, 'view')} />
                  </Td>
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
    </Box>
  );
}
