// src/pages/OutgateReports.jsx
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
  Box as ChakraBox,
} from '@chakra-ui/react';
import {
  SearchIcon,
  RepeatIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
} from '@chakra-ui/icons';
import { FaFilePdf, FaShareAlt, FaEnvelope } from 'react-icons/fa';
import { supabase } from '../supabaseClient';

const ITEMS_PER_PAGE = 5;

// --- small helpers ---
function parseNumber(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(String(val).toString().replace(/[, ]+/g, ''));
  return Number.isFinite(n) ? n : null;
}

function computeWeights(row) {
  const gross = parseNumber(row.gross);
  const tare = parseNumber(row.tare);
  const net = parseNumber(row.net);

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
  return Number(v).toLocaleString();
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
          table{ border-collapse: collapse; width: 100% }
          th, td{ border: 1px solid #ddd; padding: 6px; font-size: 12px }
          th{ background: #f7fafc; text-align: left }
        </style>
      </head>
      <body>
        ${html}
      </body>
    </html>
  `);
  w.document.close();
  w.focus();
  setTimeout(() => {
    w.print();
  }, 300);
}

export default function OutgateReports() {
  const [reports, setReports] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');
  const [sortField, setSortField] = useState('outgateDateTime');
  const [sortDirection, setSortDirection] = useState('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(ITEMS_PER_PAGE);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  // details modal
  const { isOpen: isDetailsOpen, onOpen: onDetailsOpen, onClose: onDetailsClose } = useDisclosure();
  const [selectedReport, setSelectedReport] = useState(null);

  // SAD search workflow
  const [sadQuery, setSadQuery] = useState('');
  const [sadTickets, setSadTickets] = useState([]); // base after search / date filtering
  const [sadOriginal, setSadOriginal] = useState([]); // original mapped results
  const [sadDateFrom, setSadDateFrom] = useState('');
  const [sadDateTo, setSadDateTo] = useState('');
  const [sadTimeFrom, setSadTimeFrom] = useState('');
  const [sadTimeTo, setSadTimeTo] = useState('');
  const [sadLoading, setSadLoading] = useState(false);
  const [sadMeta, setSadMeta] = useState({});

  // NEW: status filter + sort order for SAD results
  const [sadSortStatus, setSadSortStatus] = useState(''); // '', 'Pending', 'Exited'
  const [sadSortOrder, setSadSortOrder] = useState('none'); // 'none' | 'pending_first' | 'exited_first'

  const sadRef = useRef(null);

  // load outgate records on mount
  useEffect(() => {
    let mounted = true;
    const fetchReports = async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('outgate')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) throw error;
        if (!mounted) return;
        const mapped = (data || []).map((og) => {
          const computed = computeWeights(og);
          return {
            id: og.id,
            ticketId: og.ticket_id,
            ticketNo: og.ticket_no || null,
            vehicleNumber: og.vehicle_number || '',
            outgateDateTime: og.created_at || og.created_at || null,
            driverName: og.driver || og.driver || null,
            destination: og.consignee || og.destination || null,
            remarks: og.remarks || '',
            declaredWeight: og.declared_weight ?? null,
            gross: computed.gross,
            tare: computed.tare,
            net: computed.net,
            fileUrl: og.file_url || null,
            containerId: og.container_id || null,
            sadNo: og.sad_no || null,
            rawRow: og,
          };
        });

        setReports(mapped);
      } catch (err) {
        toast({
          title: 'Error loading reports',
          description: err?.message || 'Failed to fetch reports',
          status: 'error',
          duration: 4000,
        });
      } finally {
        setLoading(false);
      }
    };

    fetchReports();
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

  // Generate SAD tickets from tickets table and inject status
  const handleGenerateSad = async () => {
    if (!sadQuery.trim()) {
      toast({ title: 'SAD No Required', description: 'Type a SAD number to search', status: 'warning', duration: 2500 });
      return;
    }
    try {
      setSadLoading(true);
      const { data, error } = await supabase
        .from('tickets')
        .select('*')
        .ilike('sad_no', `%${sadQuery.trim()}%`)
        .order('date', { ascending: true });

      if (error) throw error;

      const mapped = (data || []).map((ticket) => {
        // Try to infer whether this ticket has exited — look for explicit status or exit-like timestamp
        const exitCandidate = ticket.status === 'Exited'
          ? ticket.date // if status explicitly says Exited, use ticket.date as exit indicator
          : (ticket.exit_date || ticket.outgate_date || ticket.outgate_at || ticket.exited_at || null);

        const inferredStatus = ticket.status ? String(ticket.status) : (exitCandidate ? 'Exited' : 'Pending');

        return {
          ticketId: ticket.ticket_id || (ticket.id ? String(ticket.id) : `${Math.random()}`),
          data: {
            sadNo: ticket.sad_no,
            ticketNo: ticket.ticket_no,
            date: ticket.date || ticket.submitted_at || exitCandidate || null,
            gnswTruckNo: ticket.gnsw_truck_no || ticket.vehicle_number || ticket.truck_no || null,
            net: ticket.net ?? ticket.net ?? null,
            tare: ticket.tare ?? ticket.tare ?? null,
            gross: ticket.gross ?? null,
            driver: ticket.driver || ticket.driver || 'N/A',
            consignee: ticket.consignee,
            operator: ticket.operator,
            containerNo: ticket.container_no || ticket.container_no_supp || null,
            fileUrl: ticket.file_url || null,
            // IMPORTANT: add inferred status here
            status: inferredStatus,
          },
        };
      });

      setSadOriginal(mapped);
      setSadTickets(mapped);
      setSadDateFrom('');
      setSadDateTo('');
      setSadTimeFrom('');
      setSadTimeTo('');
      setSadMeta({
        sad: sadQuery.trim(),
        dateRangeText: mapped.length > 0 && mapped[0].data.date ? new Date(mapped[0].data.date).toLocaleDateString() : 'All',
        startTimeLabel: '',
        endTimeLabel: '',
      });

      if ((mapped || []).length === 0) {
        toast({ title: 'No tickets found', status: 'info', duration: 2500 });
      }
    } catch (err) {
      console.error(err);
      toast({ title: 'Search failed', description: err?.message || 'Could not fetch tickets', status: 'error', duration: 4000 });
    } finally {
      setSadLoading(false);
    }
  };

  const applySadRange = () => {
    if (!sadOriginal || sadOriginal.length === 0) return;
    const tf = parseTimeToMinutes(sadTimeFrom);
    const tt = parseTimeToMinutes(sadTimeTo);
    const hasDateRange = !!(sadDateFrom || sadDateTo);
    const startDate = sadDateFrom ? new Date(sadDateFrom + 'T00:00:00') : null;
    const endDate = sadDateTo ? new Date(sadDateTo + 'T23:59:59.999') : null;

    const filtered = sadOriginal.filter((t) => {
      const dRaw = t.data.date;
      const d = dRaw ? new Date(dRaw) : null;
      if (!d) return false;
      if (hasDateRange) {
        let start = startDate ? new Date(startDate) : new Date(-8640000000000000);
        let end = endDate ? new Date(endDate) : new Date(8640000000000000);
        if (sadTimeFrom) {
          const mins = parseTimeToMinutes(sadTimeFrom);
          if (mins != null) start.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
        }
        if (sadTimeTo) {
          const mins = parseTimeToMinutes(sadTimeTo);
          if (mins != null) end.setHours(Math.floor(mins / 60), mins % 60, 59, 999);
        }
        return d >= start && d <= end;
      } else if (sadTimeFrom || sadTimeTo) {
        const minutes = d.getHours() * 60 + d.getMinutes();
        const from = tf != null ? tf : 0;
        const to = tt != null ? tt : 24 * 60 - 1;
        return minutes >= from && minutes <= to;
      }
      return true;
    });

    setSadTickets(filtered);

    const startLabel = sadDateFrom ? `${sadTimeFrom || '00:00'} (${sadDateFrom})` : sadTimeFrom ? `${sadTimeFrom}` : '';
    const endLabel = sadDateTo ? `${sadTimeTo || '23:59'} (${sadDateTo})` : sadTimeTo ? `${sadTimeTo}` : '';
    let dateRangeText = '';
    if (sadDateFrom && sadDateTo) dateRangeText = `${sadDateFrom} → ${sadDateTo}`;
    else if (sadDateFrom) dateRangeText = sadDateFrom;
    else if (sadDateTo) dateRangeText = sadDateTo;

    setSadMeta((s) => ({ ...s, dateRangeText: dateRangeText || (sadOriginal[0]?.data?.date ? new Date(sadOriginal[0].data.date).toLocaleDateString() : ''), startTimeLabel: startLabel, endTimeLabel: endLabel }));
  };

  const resetSadRange = () => {
    setSadDateFrom('');
    setSadDateTo('');
    setSadTimeFrom('');
    setSadTimeTo('');
    setSadTickets(sadOriginal);
    setSadMeta((m) => ({ ...m, startTimeLabel: '', endTimeLabel: '', dateRangeText: '' }));
  };

  // derived filtered & sorted SAD list based on status and order
  const filteredSadTickets = useMemo(() => {
    let arr = Array.isArray(sadTickets) ? sadTickets.slice() : [];

    if (sadSortStatus) {
      arr = arr.filter((t) => (t.data.status || 'Pending') === sadSortStatus);
    }

    if (sadSortOrder === 'pending_first') {
      arr.sort((a, b) => {
        const aIsPending = (a.data.status || 'Pending') === 'Pending' ? 0 : 1;
        const bIsPending = (b.data.status || 'Pending') === 'Pending' ? 0 : 1;
        return aIsPending - bIsPending; // pending first
      });
    } else if (sadSortOrder === 'exited_first') {
      arr.sort((a, b) => {
        const aIsExited = (a.data.status || 'Pending') === 'Exited' ? 0 : 1;
        const bIsExited = (b.data.status || 'Pending') === 'Exited' ? 0 : 1;
        return aIsExited - bIsExited; // exited first
      });
    }

    return arr;
  }, [sadTickets, sadSortStatus, sadSortOrder]);

  const cumulativeNet = useMemo(() => {
    return filteredSadTickets.reduce((sum, t) => {
      const { net } = computeWeights({ gross: t.data.gross, tare: t.data.tare, net: t.data.net });
      return sum + (net || 0);
    }, 0);
  }, [filteredSadTickets]);

  const handleDownloadSadPdf = async () => {
    if (!filteredSadTickets || filteredSadTickets.length === 0) {
      toast({ title: 'No tickets', description: 'Nothing to export', status: 'info', duration: 2500 });
      return;
    }

    const rowsHtml = filteredSadTickets
      .map((t) => {
        const { gross, tare, net } = computeWeights({ gross: t.data.gross, tare: t.data.tare, net: t.data.net });
        return `<tr>
        <td>${t.data.sadNo ?? ''}</td>
        <td>${t.data.ticketNo ?? ''}</td>
        <td>${t.data.created_at ? new Date(t.data.created_at).toLocaleString() : ''}</td>
        <td>${t.data.gnswTruckNo ?? ''}</td>
        <td style="text-align:right">${gross != null ? Number(gross).toLocaleString() : ''}</td>
        <td style="text-align:right">${tare != null ? Number(tare).toLocaleString() : ''}</td>
        <td style="text-align:right">${net != null ? Number(net).toLocaleString() : ''}</td>
        <td>${t.data.status ?? ''}</td>
      </tr>`;
      })
      .join('');

    const html = `
      <h2>Weighbridge SAD Report — ${sadMeta.sad || ''}</h2>
      <p>Date range: ${sadMeta.dateRangeText || 'All'} ${sadMeta.startTimeLabel ? `• ${sadMeta.startTimeLabel}` : ''} ${sadMeta.endTimeLabel ? `• ${sadMeta.endTimeLabel}` : ''}</p>
      <table>
        <thead>
          <tr>
            <th>SAD</th><th>Ticket</th><th>Date & Time</th><th>Truck</th><th>Gross</th><th>Tare</th><th>Net</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
          <tr style="font-weight:bold;background:#f0f8ff">
            <td colspan="7">Cumulative Net</td>
            <td style="text-align:right">${Number(cumulativeNet || 0).toLocaleString()}</td>
          </tr>
        </tbody>
      </table>
    `;

    openPrintableWindow(html, `SAD-${sadMeta.sad || 'report'}`);
  };

  const handleShareSad = async () => {
    await handleDownloadSadPdf();
    toast({ title: 'PDF window opened', status: 'info', duration: 3000 });
  };

  const handleEmailSad = async () => {
    await handleDownloadSadPdf();
    const subject = encodeURIComponent(`Weighbridge SAD ${sadMeta.sad} Report`);
    const body = encodeURIComponent(`Please find Weighbridge report for SAD ${sadMeta.sad}.\n\nTransactions: ${filteredSadTickets.length}\nCumulative Net: ${Number(cumulativeNet || 0).toLocaleString()} kg\n\n(Please attach the downloaded PDF if it wasn't attached automatically)`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  // ---- filters, sorting and pagination for main outgate table ----
  const filteredReports = useMemo(() => {
    const term = (searchTerm || '').trim().toLowerCase();
    const df = dateFrom ? new Date(dateFrom) : null;
    const dtRaw = dateTo ? new Date(dateTo) : null;
    const dt = dtRaw ? new Date(dtRaw.setHours(23, 59, 59, 999)) : null;
    const tFrom = parseTimeToMinutes(timeFrom);
    const tTo = parseTimeToMinutes(timeTo);

    return reports.filter((r) => {
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
  }, [reports, searchTerm, dateFrom, dateTo, timeFrom, timeTo]);

  const sortedReports = useMemo(() => {
    const arr = filteredReports.slice();
    arr.sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];
      if (sortField === 'outgateDateTime' || sortField === 'date') {
        aVal = a.outgateDateTime ? new Date(a.outgateDateTime).getTime() : 0;
        bVal = b.outgateDateTime ? new Date(b.outgateDateTime).getTime() : 0;
      } else {
        aVal = (aVal ?? '').toString().toLowerCase();
        bVal = (bVal ?? '').toString().toLowerCase();
      }
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [filteredReports, sortField, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(sortedReports.length / itemsPerPage));
  const paginatedReports = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return sortedReports.slice(start, start + itemsPerPage);
  }, [sortedReports, currentPage, itemsPerPage]);

  const toggleSort = (field) => {
    if (sortField === field) setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

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
    setSortField('outgateDateTime');
    setSortDirection('desc');
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
    const uniqueTickets = new Set(reports.filter(Boolean).map(r => r.ticketNo).filter(Boolean));
    return {
      reportsCount: filteredReports.length,
      totalGross: grossCount ? gross : null,
      totalTare: tareCount ? tare : null,
      totalNet: netCount ? net : null,
      totalSads: uniqueSads.size,
      totalExits: reports.length,
      totalTickets: uniqueTickets.size,
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
      };
    });
    if (!rows.length) {
      toast({ title: 'No rows to export', status: 'info', duration: 2000 });
      return;
    }
    exportToCSV(rows, 'outgate-reports.csv');
    toast({ title: `Export started (${rows.length} rows)`, status: 'success', duration: 2500 });
  };

  const handleExportSadCsv = () => {
    if (!filteredSadTickets.length) {
      toast({ title: 'No rows to export', status: 'info', duration: 2000 });
      return;
    }
    const rows = filteredSadTickets.map(t => {
      const { gross, tare, net } = computeWeights({ gross: t.data.gross, tare: t.data.tare, net: t.data.net });
      return {
        'SAD No': t.data.sadNo ?? '',
        'Ticket No': t.data.ticketNo ?? '',
        'Date': t.data.date ? new Date(t.data.date).toLocaleString() : '',
        'Truck': t.data.gnswTruckNo ?? '',
        'Gross (kg)': gross ?? '',
        'Tare (kg)': tare ?? '',
        'Net (kg)': net ?? '',
        'Driver': t.data.driver ?? '',
        'Status': t.data.status ?? '',
      };
    });
    exportToCSV(rows, `SAD-${sadMeta.sad || 'report'}.csv`);
    toast({ title: `Export started (${rows.length} rows)`, status: 'success', duration: 2500 });
  };

  return (
    <Box p={{ base: 4, md: 8 }}>
      <Flex justify="space-between" align="center" mb={6} gap={4} flexWrap="wrap">
        <Stack spacing={1}>
          <Text fontSize="2xl" fontWeight="bold">Outgate Reports</Text>
          <Text color="gray.500">Clean, sortable, and exportable list of all confirmed exits.</Text>
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
          <StatHelpText>distinct SAD numbers</StatHelpText>
        </Stat>
        <Stat bg="white" p={4} borderRadius="md" boxShadow="sm">
          <StatLabel>Total Exits</StatLabel>
          <StatNumber>{totals.totalExits}</StatNumber>
          <StatHelpText>outgate rows</StatHelpText>
        </Stat>
        <Stat bg="white" p={4} borderRadius="md" boxShadow="sm">
          <StatLabel>Total Tickets</StatLabel>
          <StatNumber>{totals.totalTickets}</StatNumber>
          <StatHelpText>tickets referenced</StatHelpText>
        </Stat>
        <Stat bg="white" p={4} borderRadius="md" boxShadow="sm">
          <StatLabel>Filtered Results</StatLabel>
          <StatNumber>{totals.reportsCount}</StatNumber>
          <StatHelpText>matching current filters</StatHelpText>
        </Stat>
      </SimpleGrid>

      <Box bg="white" p={4} borderRadius="md" boxShadow="sm" mb={6}>
        <Text fontWeight="semibold" mb={2}>SAD Report (Search by SAD No)</Text>
        <Flex gap={3} align="center" mb={3} flexWrap="wrap">
          <Input placeholder="Type SAD number (partial allowed)" value={sadQuery} onChange={(e) => setSadQuery(e.target.value)} maxW="360px" />
          <Button colorScheme="teal" leftIcon={<SearchIcon />} onClick={handleGenerateSad} isLoading={sadLoading}>
            Generate
          </Button>

          <Box ml="auto" display="flex" gap={2}>
            <Button size="sm" variant="ghost" onClick={() => { setSadQuery(''); setSadTickets([]); setSadOriginal([]); setSadMeta({}); }}>
              Clear
            </Button>
          </Box>
        </Flex>

        {sadOriginal.length > 0 && (
          <Box mt={2}>
            <SimpleGrid columns={{ base: 1, md: 4 }} spacing={3}>
              <Box>
                <FormLabel>Date From</FormLabel>
                <Input type="date" value={sadDateFrom} onChange={(e) => setSadDateFrom(e.target.value)} />
              </Box>
              <Box>
                <FormLabel>Date To</FormLabel>
                <Input type="date" value={sadDateTo} onChange={(e) => setSadDateTo(e.target.value)} />
              </Box>
              <Box>
                <FormLabel>Time From</FormLabel>
                <Input type="time" value={sadTimeFrom} onChange={(e) => setSadTimeFrom(e.target.value)} />
              </Box>
              <Box>
                <FormLabel>Time To</FormLabel>
                <Input type="time" value={sadTimeTo} onChange={(e) => setSadTimeTo(e.target.value)} />
              </Box>
            </SimpleGrid>

            <Flex mt={3} gap={2} align="center">
              <Button size="sm" colorScheme="blue" onClick={applySadRange}>Apply Range</Button>
              <Button size="sm" variant="ghost" onClick={resetSadRange}>Reset Range</Button>

              <Flex gap={4} mt={2} align="center">
                <Box>
                  <FormLabel mb={1} fontSize="sm">Filter by Status</FormLabel>
                  <Select size="sm" value={sadSortStatus} onChange={(e) => setSadSortStatus(e.target.value)}>
                    <option value="">All</option>
                    <option value="Pending">Pending</option>
                    <option value="Exited">Exited</option>
                  </Select>
                </Box>

                <Box>
                  <FormLabel mb={1} fontSize="sm">Sort by Status</FormLabel>
                  <Select size="sm" value={sadSortOrder} onChange={(e) => setSadSortOrder(e.target.value)}>
                    <option value="none">None</option>
                    <option value="pending_first">Pending first</option>
                    <option value="exited_first">Exited first</option>
                  </Select>
                </Box>
              </Flex>

              <HStack ml="auto" spacing={2}>
                <Button size="sm" leftIcon={<DownloadIcon />} onClick={handleExportSadCsv}>Export CSV</Button>
                <Button size="sm" leftIcon={<FaFilePdf />} onClick={handleDownloadSadPdf}>Download PDF</Button>
                <Button size="sm" leftIcon={<FaShareAlt />} onClick={handleShareSad}>Share</Button>
                <Button size="sm" leftIcon={<FaEnvelope />} onClick={handleEmailSad}>Email</Button>
              </HStack>
            </Flex>

            <Text mt={2} fontSize="sm" color="gray.600">Tip: Use date/time to narrow results before exporting. You can also filter or sort by Ticket Status.</Text>
          </Box>
        )}
      </Box>

      {filteredSadTickets.length > 0 && (
        <Box mb={6} bg="white" p={4} borderRadius="md" boxShadow="sm">
          <Text fontWeight="semibold" mb={3}>SAD Results — {sadMeta.sad} ({filteredSadTickets.length} records)</Text>
          <Table variant="striped" size="sm">
            <Thead>
              <Tr>
                <Th>SAD No</Th>
                <Th>Ticket No</Th>
                <Th>Date & Time</Th>
                <Th>Truck No</Th>
                <Th isNumeric>Gross (KG)</Th>
                <Th isNumeric>Tare (KG)</Th>
                <Th isNumeric>Net (KG)</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {filteredSadTickets.map((t) => {
                const { gross, tare, net } = computeWeights({ gross: t.data.gross, tare: t.data.tare, net: t.data.net });
                return (
                  <Tr key={t.ticketId}>
                    <Td>{t.data.sadNo}</Td>
                    <Td>{t.data.ticketNo}</Td>
                    <Td>{t.data.created_at ? new Date(t.data.date).toLocaleString() : 'N/A'}</Td>
                    <Td>{t.data.gnswTruckNo}</Td>
                    <Td isNumeric>{gross != null ? Number(gross).toLocaleString() : '—'} KG</Td>
                    <Td isNumeric>{tare != null ? Number(tare).toLocaleString() : '—'} KG</Td>
                    <Td isNumeric>{net != null ? Number(net).toLocaleString() : '—'} KG</Td>
                    <Td>
                      <Badge colorScheme={(t.data.status === 'Exited') ? 'green' : (t.data.status === 'Pending') ? 'yellow' : 'gray'}>
                        {t.data.status}
                      </Badge>
                    </Td>
                    <Td>
                      <HStack spacing={2}>
                        <Button size="sm" variant="outline" onClick={() => { if (t.data.fileUrl) window.open(t.data.fileUrl, '_blank', 'noopener'); }}>
                          Open Ticket
                        </Button>
                      </HStack>
                    </Td>
                  </Tr>
                );
              })}
              <Tr fontWeight="bold" bg="gray.50">
                <Td colSpan={6}>Cumulative Net</Td>
                <Td isNumeric>{Number(cumulativeNet || 0).toLocaleString()}</Td>
                <Td />
              </Tr>
            </Tbody>
          </Table>
        </Box>
      )}

      <Box bg="white" p={4} borderRadius="md" boxShadow="sm" mb={6}>
        <SimpleGrid columns={{ base: 1, md: 4 }} spacing={4}>
          <Box>
            <FormLabel>Search</FormLabel>
            <Input placeholder="vehicle, ticket, driver, SAD, container..." value={searchTerm} onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }} />
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
            <FormLabel>Page size / Sort</FormLabel>
            <HStack>
              <Select value={itemsPerPage} onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}>
                {[5, 10, 20, 50].map(n => <option key={n} value={n}>{n} / page</option>)}
              </Select>
              <Select value={sortField} onChange={(e) => { setSortField(e.target.value); }}>
                <option value="outgateDateTime">Exit Date</option>
                <option value="ticketNo">Ticket No</option>
                <option value="vehicleNumber">Truck No</option>
              </Select>
              <Select value={sortDirection} onChange={(e) => setSortDirection(e.target.value)}>
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </Select>
            </HStack>
          </Box>
        </SimpleGrid>
      </Box>

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
                  return (
                    <Tr key={report.id}>
                      <Td>{report.ticketNo ?? <Badge>Manual</Badge>}</Td>
                      <Td>{report.sadNo ?? '—'}</Td>
                      <Td>{report.vehicleNumber || '—'}</Td>
                      <Td>{report.outgateDateTime ? new Date(report.outgateDateTime).toLocaleString() : '—'}</Td>
                      <Td>{report.driver ?? '—'}</Td>
                      <Td isNumeric>{gross != null ? Number(gross).toLocaleString() : '—'}</Td>
                      <Td isNumeric>{tare != null ? Number(tare).toLocaleString() : '—'}</Td>
                      <Td isNumeric>{net != null ? Number(net).toLocaleString() : '—'}</Td>
                      <Td>{report.Satus ?? '—'}</Td>
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

            <Text color="gray.600" fontSize="sm">Showing {paginatedReports.length} of {filteredReports.length} results</Text>
          </Flex>
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
