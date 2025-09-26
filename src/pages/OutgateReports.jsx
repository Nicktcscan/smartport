// src/pages/OutgateReports.jsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Box,
  Button,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Input,
  Text,
  Flex,
  Spinner,
  useToast,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  useDisclosure,
  Stack,
  Divider,
  SimpleGrid,
  FormLabel,
  Select,
  IconButton,
  Badge,
  HStack,
  Stat,
  StatLabel,
  StatNumber,
  StatHelpText,
  Tooltip,
} from '@chakra-ui/react';
import {
  RepeatIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  SearchIcon,
} from '@chakra-ui/icons';
import { FaFilePdf } from 'react-icons/fa';
import { supabase } from '../supabaseClient';
import logoUrl from '../assets/logo.png';

const ITEMS_PER_PAGE = 5;

/* -----------------------
   Helpers
----------------------- */
function parseNumber(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(String(val).toString().replace(/[, ]+/g, ''));
  return Number.isFinite(n) ? n : null;
}

function computeWeights(row) {
  const gross = parseNumber(row.gross ?? row.gross_value ?? row.grossValue ?? row.gross_val);
  const tare = parseNumber(row.tare ?? row.tare_value ?? row.tareValue ?? row.tare_val);
  const net = parseNumber(row.net ?? row.net_value ?? row.netValue ?? row.net_val);

  let G = gross;
  let T = tare;
  let N = net;

  if ((G === null || G === undefined) && T != null && N != null) G = T + N;
  if ((T === null || T === undefined) && G != null && N != null) T = G - N;
  if ((N === null || N === undefined) && G != null && T != null) N = G - T;

  return { gross: G, tare: T, net: N };
}

function formatWeight(v) {
  if (v === null || v === undefined) return '—';
  if (Number.isInteger(v)) return Number(v).toLocaleString();
  return Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

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

function openPrintableWindow(html, title = 'Report') {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return;
  w.document.write(`
    <html>
      <head>
        <title>${title}</title>
        <style>
          body{ font-family: Arial, Helvetica, sans-serif; padding: 18px; color: #111 }
          .header{ display:flex; align-items:center; gap:12px; margin-bottom:18px }
          .logo{ height:60px; width:auto; }
          .company{ font-size:18px; font-weight:700; color:#0a6b63 }
          table{ border-collapse: collapse; width: 100% }
          th, td{ border: 1px solid #ddd; padding: 6px; font-size: 12px }
          th{ background: #f7fafc; text-align: left }
        </style>
      </head>
      <body>${html}</body>
    </html>
  `);
  w.document.close();
  w.focus();
  setTimeout(() => {
    w.print();
  }, 300);
}

/* Deduplicate outgate rows by ticket number.
   - If ticket_no exists, keep only one row per ticket_no (choose newest outgateDateTime).
   - If ticket_no is absent (manual rows), keep them (keyed by manual:id) — they are not deduplicated by ticket_no.
*/
function dedupeReportsByTicketNo(rows = []) {
  const map = new Map();
  const manualRows = [];

  for (const r of rows) {
    const tn = (r.ticketNo ?? r.ticket_no ?? r.rawRow?.ticket_no ?? '').toString().trim();
    if (tn) {
      const existing = map.get(tn);
      const rTime = r.outgateDateTime ? new Date(r.outgateDateTime).getTime() : 0;
      if (!existing) map.set(tn, r);
      else {
        const existingTime = existing.outgateDateTime ? new Date(existing.outgateDateTime).getTime() : 0;
        if (rTime >= existingTime) map.set(tn, r); // keep newest
      }
    } else {
      // keep manual rows as-is; they don't have ticketNo to dedupe by
      manualRows.push(r);
    }
  }

  // return combined: first ticket-based unique rows, then manual rows
  return [...Array.from(map.values()), ...manualRows];
}

/* -----------------------
   Component
----------------------- */
export default function OutgateReports() {
  const [reports, setReports] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(ITEMS_PER_PAGE);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  // details modal
  const { isOpen: isDetailsOpen, onOpen: onDetailsOpen, onClose: onDetailsClose } = useDisclosure();
  const [selectedReport, setSelectedReport] = useState(null);

  // SAD search results (deduped)
  const [sadResults, setSadResults] = useState([]);
  const [sadLoading, setSadLoading] = useState(false);
  const sadDebounceRef = useRef(null);

  // tickets mapping and total transactions (deduplicated)
  const [ticketStatusMap, setTicketStatusMap] = useState({}); // ticket_no -> status
  const [totalTransactions, setTotalTransactions] = useState(0); // unique ticket_no count across system

  useEffect(() => {
    let mounted = true;

    const fetchReportsAndTickets = async () => {
      try {
        setLoading(true);

        // fetch outgate rows
        const { data: outData, error: outErr } = await supabase
          .from('outgate')
          .select('*')
          .order('created_at', { ascending: false });

        if (outErr) throw outErr;

        const mapped = (outData || []).map((og) => {
          const computed = computeWeights(og);
          return {
            id: og.id,
            ticketId: og.ticket_id,
            ticketNo: og.ticket_no || og.ticketNo || null,
            vehicleNumber: og.vehicle_number || og.vehicleNo || '',
            outgateDateTime: og.created_at || og.outgate_at || null,
            driverName: og.driver || og.driverName || null,
            destination: og.consignee || og.destination || null,
            remarks: og.remarks || '',
            declaredWeight: og.declared_weight ?? null,
            gross: computed.gross,
            tare: computed.tare,
            net: computed.net,
            fileUrl: og.file_url || null,
            containerId: og.container_id ?? null,
            sadNo: og.sad_no ?? null,
            rawRow: og,
          };
        });

        if (!mounted) return;
        setReports(mapped);

        // fetch tickets statuses (Pending/Exited) to create map of ticket_no -> status
        const { data: ticketsData, error: ticketsErr } = await supabase
          .from('tickets')
          .select('ticket_no,status');

        if (ticketsErr) {
          console.warn('Failed to load tickets for status summary', ticketsErr);
          setTicketStatusMap({});
          setTotalTransactions(0);
        } else {
          const map = {};
          (ticketsData || []).forEach((t) => {
            const tn = (t.ticket_no ?? '').toString().trim();
            if (!tn) return;
            map[tn] = t.status ?? map[tn] ?? 'Pending';
          });

          // also include ticket_nos present in outgate that may not exist in tickets table
          for (const r of mapped) {
            if (r.ticketNo && !map[r.ticketNo]) map[r.ticketNo] = r.rawRow?.status ?? 'Exited';
          }

          if (!mounted) return;
          setTicketStatusMap(map);
          setTotalTransactions(Object.keys(map).length);
        }
      } catch (err) {
        toast({
          title: 'Error loading reports',
          description: err?.message || 'Failed to fetch reports',
          status: 'error',
          duration: 4000,
        });
        setReports([]);
        setTicketStatusMap({});
        setTotalTransactions(0);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchReportsAndTickets();
    return () => {
      mounted = false;
    };
  }, [toast]);

  const parseTimeToMinutes = (timeStr) => {
    if (!timeStr) return null;
    const [hh, mm] = String(timeStr).split(':').map((n) => Number(n));
    if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
    return hh * 60 + mm;
  };

  /* SAD search: dedupe by ticket_no, newest-first, compute cumulative net
     (this builds `sadResults` - deduplicated and newest-first by ticket date)
  */
  useEffect(() => {
    if (sadDebounceRef.current) {
      clearTimeout(sadDebounceRef.current);
      sadDebounceRef.current = null;
    }

    const q = (searchTerm || '').trim();
    if (!q) {
      setSadResults([]);
      return;
    }

    sadDebounceRef.current = setTimeout(async () => {
      setSadLoading(true);
      try {
        const { data: ticketsData, error } = await supabase
          .from('tickets')
          .select('*')
          .ilike('sad_no', `%${q}%`)
          .order('date', { ascending: false }); // newest first

        if (error) {
          console.warn('SAD lookup error', error);
          setSadResults([]);
          setSadLoading(false);
          return;
        }

        // Deduplicate by ticket_no: keep newest (by date/submitted_at)
        const dedupeMap = new Map();
        (ticketsData || []).forEach((t) => {
          const ticketNo = (t.ticket_no ?? t.ticketNo ?? t.ticket_id ?? '').toString().trim();
          if (!ticketNo) return;
          const thisDate = new Date(t.date ?? t.submitted_at ?? t.created_at ?? 0).getTime();
          const existing = dedupeMap.get(ticketNo);
          if (!existing) dedupeMap.set(ticketNo, t);
          else {
            const existingDate = new Date(existing.date ?? existing.submitted_at ?? existing.created_at ?? 0).getTime();
            if (thisDate >= existingDate) dedupeMap.set(ticketNo, t);
          }
        });

        const deduped = Array.from(dedupeMap.values());

        // Map to UI-friendly shape (net/gross/tare computed). Keep newest-first order.
        const mapped = deduped
          .sort((a, b) => {
            const aT = new Date(a.date ?? a.submitted_at ?? a.created_at ?? 0).getTime();
            const bT = new Date(b.date ?? b.submitted_at ?? b.created_at ?? 0).getTime();
            return bT - aT; // newest first
          })
          .map((t) => {
            const computed = computeWeights({
              gross: t.gross,
              tare: t.tare,
              net: t.net,
            });
            return {
              ticketId: t.ticket_id ?? t.id ?? t.ticket_no ?? `${Math.random()}`,
              ticketNo: t.ticket_no ?? t.ticketNo ?? (t.ticket_id ? String(t.ticket_id) : null),
              sadNo: t.sad_no ?? t.sadNo ?? null,
              date: t.date ?? t.submitted_at ?? t.created_at ?? null,
              truck: t.gnsw_truck_no ?? t.truck_on_wb ?? t.vehicle_number ?? null,
              gross: computed.gross,
              tare: computed.tare,
              net: computed.net,
              driver: t.driver ?? null,
              raw: t,
            };
          });

        setSadResults(mapped);
      } catch (err) {
        console.error('SAD search failed', err);
        setSadResults([]);
      } finally {
        setSadLoading(false);
      }
    }, 600);

    return () => {
      if (sadDebounceRef.current) clearTimeout(sadDebounceRef.current);
    };
  }, [searchTerm]);

  /* -----------------------
     Apply filters to deduplicated reports
     - First dedupe full reports by ticket_no
     - Then filter by search/date/time
     - Then sort newest-first and paginate
  ----------------------- */
  const dedupedReports = useMemo(() => dedupeReportsByTicketNo(reports), [reports]);

  const filteredReports = useMemo(() => {
    const term = (searchTerm || '').trim().toLowerCase();
    const df = dateFrom ? new Date(dateFrom) : null;
    const dtRaw = dateTo ? new Date(dateTo) : null;
    const dt = dtRaw ? new Date(dtRaw.setHours(23, 59, 59, 999)) : null;
    const tFrom = parseTimeToMinutes(timeFrom);
    const tTo = parseTimeToMinutes(timeTo);

    return dedupedReports.filter((r) => {
      if (term) {
        const hay = [
          r.vehicleNumber,
          r.ticketNo,
          r.driverName,
          r.sadNo,
          r.containerId,
          r.destination,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(term)) return false;
      }

      if (df || dt || tFrom !== null || tTo !== null) {
        if (!r.outgateDateTime) return false;
        const d = new Date(r.outgateDateTime);
        if (Number.isNaN(d.getTime())) return false;
        if (df && d < df) return false;
        if (dt && d > dt) return false;
        if (tFrom !== null || tTo !== null) {
          const mins = d.getHours() * 60 + d.getMinutes();
          if (tFrom !== null && mins < tFrom) return false;
          if (tTo !== null && mins > tTo) return false;
        }
      }

      return true;
    });
  }, [dedupedReports, searchTerm, dateFrom, dateTo, timeFrom, timeTo]);

  // newest-first sort
  const sortedReports = useMemo(() => {
    const arr = filteredReports.slice();
    arr.sort((a, b) => {
      const aT = a.outgateDateTime ? new Date(a.outgateDateTime).getTime() : 0;
      const bT = b.outgateDateTime ? new Date(b.outgateDateTime).getTime() : 0;
      return bT - aT;
    });
    return arr;
  }, [filteredReports]);

  /* -----------------------
     SAD filtered results that RESPECT date/time filters
     - sadResults is deduped by ticket_no already, but it was computed without date/time filtering.
     - sadFilteredResults applies the date/time filters (dateFrom/dateTo/timeFrom/timeTo)
       so the SAD totals and table respond to those inputs.
  ----------------------- */
  const sadFilteredResults = useMemo(() => {
    if (!sadResults || sadResults.length === 0) return [];

    const df = dateFrom ? new Date(dateFrom) : null;
    const dtRaw = dateTo ? new Date(dateTo) : null;
    const dt = dtRaw ? new Date(dtRaw.setHours(23, 59, 59, 999)) : null;
    const tFrom = parseTimeToMinutes(timeFrom);
    const tTo = parseTimeToMinutes(timeTo);

    return sadResults.filter((t) => {
      if (!t.date) return false;
      const d = new Date(t.date);
      if (Number.isNaN(d.getTime())) return false;

      if (df && d < df) return false;
      if (dt && d > dt) return false;

      if (tFrom !== null || tTo !== null) {
        const mins = d.getHours() * 60 + d.getMinutes();
        const from = tFrom != null ? tFrom : 0;
        const to = tTo != null ? tTo : 24 * 60 - 1;
        if (mins < from || mins > to) return false;
      }

      return true;
    });
  }, [sadResults, dateFrom, dateTo, timeFrom, timeTo]);

  const sadTotalsMemo = useMemo(() => {
    if (!sadFilteredResults || sadFilteredResults.length === 0) return { transactions: 0, cumulativeNet: 0 };
    let cumulativeNet = 0;
    for (const t of sadFilteredResults) {
      // t.net should already be numeric from mapping, but guard anyway
      const { net } = computeWeights({ gross: t.gross, tare: t.tare, net: t.net });
      cumulativeNet += (net || 0);
    }
    return { transactions: sadFilteredResults.length, cumulativeNet };
  }, [sadFilteredResults]);

  const displayedUniqueTicketCount = useMemo(() => {
    // Count unique ticketNo values present in sortedReports (excluding null/empty)
    const set = new Set();
    for (const r of sortedReports) {
      if (r.ticketNo) set.add(r.ticketNo);
    }
    return set.size;
  }, [sortedReports]);

  const totalPages = Math.max(1, Math.ceil(sortedReports.length / itemsPerPage));
  const paginatedReports = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return sortedReports.slice(start, start + itemsPerPage);
  }, [sortedReports, currentPage, itemsPerPage]);

  const openDetails = (report) => {
    setSelectedReport(report);
    onDetailsOpen();
  };

  const handleResetAll = () => {
    setSearchTerm('');
    setDateFrom('');
    setDateTo('');
    setTimeFrom('');
    setTimeTo('');
    setCurrentPage(1);
    toast({ title: 'Filters reset', status: 'info', duration: 1500 });
  };

  const totals = useMemo(() => {
    let gross = 0, tare = 0, net = 0;
    let grossCount = 0, tareCount = 0, netCount = 0;
    for (const r of filteredReports) {
      const w = computeWeights(r);
      if (w.gross != null) { gross += w.gross; grossCount++; }
      if (w.tare != null) { tare += w.tare; tareCount++; }
      if (w.net != null) { net += w.net; netCount++; }
    }
    const uniqueSads = new Set(reports.filter(Boolean).map(r => r.sadNo).filter(Boolean));
    return {
      reportsCount: filteredReports.length, // number of unique rows after dedupe (includes manuals)
      totalGross: grossCount ? gross : null,
      totalTare: tareCount ? tare : null,
      totalNet: netCount ? net : null,
      totalSads: uniqueSads.size,
    };
  }, [filteredReports, reports]);

  const handleExportCsv = () => {
    const rows = sortedReports.map(r => {
      return {
        'Ticket No': r.ticketNo ?? '',
        'Truck No': r.vehicleNumber ?? '',
        'SAD No': r.sadNo ?? '',
        'Container': r.containerId ?? '',
        'Exit Date': r.outgateDateTime ? new Date(r.outgateDateTime).toLocaleString() : '',
        'Gross (kg)': r.gross ?? '',
        'Tare (kg)': r.tare ?? '',
        'Net (kg)': r.net ?? '',
        'Driver': r.driverName ?? '',
        'Status': (r.ticketNo && ticketStatusMap[r.ticketNo]) ? ticketStatusMap[r.ticketNo] : (r.rawRow?.status ?? ''),
      };
    });
    if (!rows.length) {
      toast({ title: 'No rows to export', status: 'info', duration: 2000 });
      return;
    }
    exportToCSV(rows, 'outgate-reports.csv');
    toast({ title: `Export started (${rows.length} rows)`, status: 'success', duration: 2500 });
  };

  const handlePrintSad = () => {
    if (!sadFilteredResults || sadFilteredResults.length === 0) {
      toast({ title: 'No SAD results', status: 'info', duration: 2000 });
      return;
    }

    const rowsHtml = sadFilteredResults.map((t) => {
      return `<tr>
        <td>${t.sadNo ?? ''}</td>
        <td>${t.ticketNo ?? ''}</td>
        <td>${t.date ? new Date(t.date).toLocaleString() : ''}</td>
        <td>${t.truck ?? ''}</td>
        <td style="text-align:right">${t.gross != null ? formatWeight(t.gross) : ''}</td>
        <td style="text-align:right">${t.tare != null ? formatWeight(t.tare) : ''}</td>
        <td style="text-align:right">${t.net != null ? formatWeight(t.net) : ''}</td>
        <td>${t.driver ?? ''}</td>
      </tr>`;
    }).join('');

    const html = `
      <div class="header">
        <img src="${logoUrl}" class="logo" alt="Company logo" />
        <div>
          <div class="company">NICK TC-SCAN (GAMBIA) LTD.</div>
          <div style="font-size:13px;color:#666;margin-top:4px">Weighbridge SAD Report</div>
          <div style="font-size:12px;color:#666;margin-top:2px">SAD: ${searchTerm}</div>
        </div>
      </div>

      <p style="margin-top:6px;margin-bottom:6px">
        <strong>Total transactions:</strong> ${sadTotalsMemo.transactions} &nbsp; • &nbsp;
        <strong>Cumulative net:</strong> ${formatWeight(sadTotalsMemo.cumulativeNet)} kg
      </p>

      <table>
        <thead>
          <tr>
            <th>SAD</th><th>Ticket</th><th>Date & Time</th><th>Truck</th><th>Gross</th><th>Tare</th><th>Net</th><th>Driver</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    `;

    openPrintableWindow(html, `SAD-${searchTerm}`);
  };

  const handleExportSadCsv = () => {
    if (!sadFilteredResults || sadFilteredResults.length === 0) {
      toast({ title: 'No rows to export', status: 'info', duration: 2000 });
      return;
    }
    const rows = sadFilteredResults.map(t => ({
      'SAD No': t.sadNo ?? '',
      'Ticket No': t.ticketNo ?? '',
      'Date': t.date ? new Date(t.date).toLocaleString() : '',
      'Truck': t.truck ?? '',
      'Gross (kg)': t.gross ?? '',
      'Tare (kg)': t.tare ?? '',
      'Net (kg)': t.net ?? '',
      'Driver': t.driver ?? '',
    }));
    exportToCSV(rows, `SAD-${searchTerm || 'report'}.csv`);
    toast({ title: `Export started (${rows.length} rows)`, status: 'success', duration: 2500 });
  };

  // convenience flag: are we actively searching (SAD search)?
  const isSearching = Boolean((searchTerm || '').trim());

  return (
    <Box p={{ base: 4, md: 8 }}>
      <Flex justify="space-between" align="center" mb={6} gap={4} flexWrap="wrap">
        <Stack spacing={1}>
          <Text fontSize="2xl" fontWeight="bold">Outgate Reports</Text>
          <Text color="gray.500">Unique-ticket view. Newest first.</Text>
        </Stack>

        <HStack spacing={2}>
          <Tooltip label="Export current view as CSV">
            <Button leftIcon={<DownloadIcon />} colorScheme="teal" variant="ghost" onClick={handleExportCsv}>Export CSV</Button>
          </Tooltip>
          <Button leftIcon={<RepeatIcon />} variant="outline" onClick={handleResetAll} aria-label="Reset filters">
            Reset
          </Button>
        </HStack>
      </Flex>

      <SimpleGrid columns={{ base: 1, md: 4 }} spacing={3} mb={6}>
        <Stat bg="white" p={4} borderRadius="md" boxShadow="sm">
          <StatLabel>Total SADs</StatLabel>
          <StatNumber>{totals.totalSads}</StatNumber>
          <StatHelpText>Distinct SAD numbers</StatHelpText>
        </Stat>

        <Stat bg="white" p={4} borderRadius="md" boxShadow="sm">
          <StatLabel>Total Transactions</StatLabel>
          <StatNumber>{totalTransactions}</StatNumber>
          <StatHelpText>unique ticket numbers</StatHelpText>
        </Stat>

        <Stat bg="white" p={4} borderRadius="md" boxShadow="sm">
          <StatLabel>Displayed Unique Tickets</StatLabel>
          <StatNumber>{displayedUniqueTicketCount}</StatNumber>
          <StatHelpText>unique ticket numbers in current view</StatHelpText>
        </Stat>

        <Stat bg="white" p={4} borderRadius="md" boxShadow="sm">
          <StatLabel>Cumulative Net (view)</StatLabel>
          <StatNumber>{totals.totalNet ? formatWeight(totals.totalNet) + ' kg' : '—'}</StatNumber>
          <StatHelpText>From current filtered results</StatHelpText>
        </Stat>
      </SimpleGrid>

      <Box bg="white" p={4} borderRadius="md" boxShadow="sm" mb={6}>
        <SimpleGrid columns={{ base: 1, md: 4 }} spacing={3}>
          <Box>
            <FormLabel>Search</FormLabel>
            <Flex>
              <Input
                placeholder="vehicle, ticket_no, driver, SAD, container..."
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              />
              <IconButton aria-label="Search" icon={<SearchIcon />} ml={2} onClick={() => { setCurrentPage(1); }} />
            </Flex>
            <Text fontSize="xs" color="gray.500" mt={1}>Tip: type a SAD number to see total transactions below.</Text>
          </Box>

          <Box>
            <FormLabel>Date range</FormLabel>
            <Flex gap={2}>
              <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setCurrentPage(1); }} />
              <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setCurrentPage(1); }} />
            </Flex>
          </Box>

          <Box>
            <FormLabel>Time range</FormLabel>
            <Flex gap={2}>
              <Input type="time" value={timeFrom} onChange={(e) => { setTimeFrom(e.target.value); setCurrentPage(1); }} />
              <Input type="time" value={timeTo} onChange={(e) => { setTimeTo(e.target.value); setCurrentPage(1); }} />
            </Flex>
          </Box>

          <Box>
            <FormLabel>Page size</FormLabel>
            <HStack>
              <Select value={itemsPerPage} onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}>
                {[5, 10, 20, 50].map(n => <option key={n} value={n}>{n} / page</option>)}
              </Select>
            </HStack>
          </Box>
        </SimpleGrid>
      </Box>

      {/* SAD results table: shown when searching and results exist */}
      {sadLoading ? (
        <Flex justify="center" mb={4}><Spinner /></Flex>
      ) : (isSearching && sadFilteredResults && sadFilteredResults.length > 0) ? (
        <Box bg="white" p={4} borderRadius="md" boxShadow="sm" mb={6}>
          <Flex align="center" justify="space-between" mb={3} gap={3} wrap="wrap">
            <Box>
              <Text fontWeight="semibold">SAD Search: <Text as="span" fontWeight="bold">{searchTerm}</Text></Text>
              <Text fontSize="sm" color="gray.600">Transactions for this SAD (respecting date/time filters)</Text>
            </Box>

            <HStack spacing={4}>
              <Box textAlign="right">
                <Text fontSize="sm" color="gray.500">Transactions</Text>
                <Text fontWeight="bold">{sadTotalsMemo.transactions}</Text>
              </Box>
              <Box textAlign="right">
                <Text fontSize="sm" color="gray.500">Cumulative Net</Text>
                <Text fontWeight="bold">{formatWeight(sadTotalsMemo.cumulativeNet)} kg</Text>
              </Box>

              <Button size="sm" leftIcon={<FaFilePdf />} onClick={handlePrintSad}>Print PDF</Button>
              <Button size="sm" onClick={handleExportSadCsv}>Export CSV</Button>
            </HStack>
          </Flex>

          <Box overflowX="auto">
            <Table variant="striped" size="sm">
              <Thead>
                <Tr>
                  <Th>Ticket</Th>
                  <Th>Date & Time</Th>
                  <Th>Truck</Th>
                  <Th isNumeric>Gross</Th>
                  <Th isNumeric>Tare</Th>
                  <Th isNumeric>Net</Th>
                  <Th>Driver</Th>
                </Tr>
              </Thead>
              <Tbody>
                {sadFilteredResults.map((t) => (
                  <Tr key={t.ticketId}>
                    <Td>{t.ticketNo ?? '—'}</Td>
                    <Td>{t.date ? new Date(t.date).toLocaleString() : '—'}</Td>
                    <Td>{t.truck ?? '—'}</Td>
                    <Td isNumeric>{t.gross != null ? formatWeight(t.gross) : '—'}</Td>
                    <Td isNumeric>{t.tare != null ? formatWeight(t.tare) : '—'}</Td>
                    <Td isNumeric>{t.net != null ? formatWeight(t.net) : '—'}</Td>
                    <Td>{t.driver ?? '—'}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </Box>
        </Box>
      ) : null}

      {/* Main unique-ticket table: only shown when NOT searching.
          This prevents the table from appearing before a search as requested.
      */}
      {!isSearching && (
        <>
          {loading ? (
            <Flex justify="center" p={12}><Spinner size="xl" /></Flex>
          ) : (
            <>
              <Box overflowX="auto" borderRadius="md" border="1px solid" borderColor="gray.200" bg="white">
                <Table variant="striped" size="sm">
                  <Thead bg="gray.50">
                    <Tr>
                      <Th>Ticket</Th>
                      <Th>SAD</Th>
                      <Th>Truck</Th>
                      <Th>Exit Date & Time</Th>
                      <Th>Driver</Th>
                      <Th isNumeric>Gross (KG)</Th>
                      <Th isNumeric>Tare (KG)</Th>
                      <Th isNumeric>Net (KG)</Th>
                      <Th>Status</Th>
                      <Th>Actions</Th>
                    </Tr>
                  </Thead>

                  <Tbody>
                    {paginatedReports.map((report) => {
                      const { gross, tare, net } = computeWeights(report);
                      const status = (report.ticketNo && ticketStatusMap[report.ticketNo]) ? ticketStatusMap[report.ticketNo] : (report.rawRow?.status ?? '—');
                      return (
                        <Tr key={report.ticketNo ?? `manual-${report.id}`}>
                          <Td>{report.ticketNo ?? <Badge>Manual</Badge>}</Td>
                          <Td>{report.sadNo ?? '—'}</Td>
                          <Td>{report.vehicleNumber || '—'}</Td>
                          <Td>{report.outgateDateTime ? new Date(report.outgateDateTime).toLocaleString() : '—'}</Td>
                          <Td>{report.driverName ?? '—'}</Td>
                          <Td isNumeric>{gross != null ? formatWeight(gross) : '—'}</Td>
                          <Td isNumeric>{tare != null ? formatWeight(tare) : '—'}</Td>
                          <Td isNumeric>{net != null ? formatWeight(net) : '—'}</Td>
                          <Td>{status}</Td>
                          <Td>
                            <HStack spacing={2}>
                              <Button size="sm" colorScheme="blue" onClick={() => openDetails(report)}>Details</Button>
                              {report.fileUrl && (
                                <IconButton aria-label="Open attachment" icon={<FaFilePdf />} size="sm" variant="ghost" onClick={() => window.open(report.fileUrl, '_blank', 'noopener')} />
                              )}
                            </HStack>
                          </Td>
                        </Tr>
                      );
                    })}
                  </Tbody>
                </Table>
              </Box>

              <Flex justify="space-between" align="center" mt={4} gap={4} flexWrap="wrap">
                <Flex gap={2} align="center">
                  <IconButton aria-label="Previous" icon={<ChevronLeftIcon />} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} isDisabled={currentPage === 1} size="sm" />
                  <Text>Page {currentPage} of {totalPages}</Text>
                  <IconButton aria-label="Next" icon={<ChevronRightIcon />} onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))} isDisabled={currentPage === totalPages} size="sm" />
                </Flex>

                <Text color="gray.600" fontSize="sm">Showing {paginatedReports.length} of {sortedReports.length} unique rows</Text>
              </Flex>
            </>
          )}
        </>
      )}

      <Modal isOpen={isDetailsOpen} onClose={onDetailsClose} size="4xl" scrollBehavior="inside">
        <ModalOverlay />
        <ModalContent maxW="90vw">
          <ModalHeader>Report Details</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {selectedReport ? (
              <Stack spacing={3}>
                <Flex justify="space-between" align="center" gap={4} flexWrap="wrap">
                  <Stack>
                    <Text fontSize="lg" fontWeight="bold">{selectedReport.vehicleNumber || '—'}</Text>
                    <Text color="gray.600">{selectedReport.ticketNo ? `Ticket: ${selectedReport.ticketNo}` : 'No ticket'}</Text>
                    <Text color="gray.600">{selectedReport.destination}</Text>
                  </Stack>
                  <Stack textAlign="right">
                    <Text fontSize="sm" color="gray.500">Exit</Text>
                    <Text fontWeight="semibold">{selectedReport.outgateDateTime ? new Date(selectedReport.outgateDateTime).toLocaleString() : '—'}</Text>
                    <Badge colorScheme="teal">{selectedReport.sadNo ?? 'No SAD'}</Badge>
                  </Stack>
                </Flex>

                <Divider />

                <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                  <Box>
                    <Text fontWeight="semibold">Driver</Text>
                    <Text>{selectedReport.driverName ?? '—'}</Text>
                    <Text mt={3} fontWeight="semibold">Consignee</Text>
                    <Text>{selectedReport.destination ?? '—'}</Text>
                  </Box>

                  <Box>
                    <Text fontWeight="semibold">Container</Text>
                    <Text>{selectedReport.containerId ?? '—'}</Text>

                    <Text mt={3} fontWeight="semibold">Remarks</Text>
                    <Text>{selectedReport.remarks || '—'}</Text>
                  </Box>
                </SimpleGrid>

                <Divider />

                <Text fontWeight="semibold">Weight Details (kg)</Text>
                <Box>
                  {(() => {
                    const { gross, tare, net } = computeWeights(selectedReport);
                    return (
                      <>
                        <Text><b>Gross (KG):</b> {formatWeight(gross)}</Text>
                        <Text><b>Tare (KG):</b> {formatWeight(tare)}</Text>
                        <Text><b>Net (KG):</b> {formatWeight(net)}</Text>
                      </>
                    );
                  })()}
                </Box>

                {selectedReport.fileUrl && (
                  <>
                    <Divider />
                    <Text fontWeight="semibold">Attachment</Text>
                    <Box border="1px solid" borderColor="gray.200" borderRadius="md" overflow="hidden" minH="300px">
                      <iframe
                        src={selectedReport.fileUrl}
                        width="100%"
                        height="100%"
                        style={{ border: 'none', minHeight: 300 }}
                        title="Outgate attachment"
                      />
                    </Box>
                  </>
                )}
              </Stack>
            ) : (
              <Text>No report selected.</Text>
            )}
          </ModalBody>
          <ModalFooter>
            <Button onClick={onDetailsClose}>Close</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
}
