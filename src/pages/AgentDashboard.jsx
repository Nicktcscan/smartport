// src/pages/OutgateReports.jsx
import React, { useState, useMemo, useEffect, useCallback } from 'react';
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
  useToast,
  SimpleGrid,
  FormLabel,
  Select,
  HStack,
  Stat,
  StatLabel,
  StatNumber,
  StatHelpText,
} from '@chakra-ui/react';
import { SearchIcon, DownloadIcon } from '@chakra-ui/icons';
import { FaFilePdf, FaShareAlt, FaEnvelope } from 'react-icons/fa';
import { supabase } from '../supabaseClient';

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
  const toast = useToast();

  // SAD search workflow
  const [sadQuery, setSadQuery] = useState('');
  const [sadOriginal, setSadOriginal] = useState([]); // mapped raw results
  const [sadTickets, setSadTickets] = useState([]); // filtered after range/status
  const [sadDateFrom, setSadDateFrom] = useState('');
  const [sadDateTo, setSadDateTo] = useState('');
  const [sadTimeFrom, setSadTimeFrom] = useState('');
  const [sadTimeTo, setSadTimeTo] = useState('');
  const [sadLoading, setSadLoading] = useState(false);
  const [sadMeta, setSadMeta] = useState({});

  // status/sort controls
  const [sadSortStatus, setSadSortStatus] = useState(''); // '', 'Pending', 'Exited'
  const [sadSortOrder, setSadSortOrder] = useState('none'); // 'none' | 'pending_first' | 'exited_first'

  const parseTimeToMinutes = (timeStr) => {
    if (!timeStr) return null;
    const [hh, mm] = String(timeStr).split(':').map((n) => Number(n));
    if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
    return hh * 60 + mm;
  };

  // Helper: compute filtered SAD tickets from a given original array, honoring date/time/status/sort
  const computeSadFiltered = useCallback(
    (originalArr = []) => {
      let arr = Array.isArray(originalArr) ? originalArr.slice() : [];

      // Date/time filtering
      const tf = parseTimeToMinutes(sadTimeFrom);
      const tt = parseTimeToMinutes(sadTimeTo);
      const hasDateRange = !!(sadDateFrom || sadDateTo);
      const startDate = sadDateFrom ? new Date(sadDateFrom + 'T00:00:00') : null;
      const endDate = sadDateTo ? new Date(sadDateTo + 'T23:59:59.999') : null;

      arr = arr.filter((t) => {
        const dRaw = t.data.date;
        const d = dRaw ? new Date(dRaw) : null;
        if (!d) {
          // If there's a date filter, exclude rows with no date
          if (hasDateRange || sadTimeFrom || sadTimeTo) return false;
          return true;
        }
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
          if (d < start || d > end) return false;
        } else if (sadTimeFrom || sadTimeTo) {
          const minutes = d.getHours() * 60 + d.getMinutes();
          const from = tf != null ? tf : 0;
          const to = tt != null ? tt : 24 * 60 - 1;
          if (minutes < from || minutes > to) return false;
        }
        return true;
      });

      // Filter by status if requested
      if (sadSortStatus) {
        arr = arr.filter((t) => (t.data.status || 'Pending') === sadSortStatus);
      }

      // Sort by requested status ordering (but keep newest-first within groups)
      if (sadSortOrder === 'pending_first') {
        arr.sort((a, b) => {
          const aIsPending = (a.data.status || 'Pending') === 'Pending' ? 0 : 1;
          const bIsPending = (b.data.status || 'Pending') === 'Pending' ? 0 : 1;
          if (aIsPending !== bIsPending) return aIsPending - bIsPending;
          // same group: newest first
          const da = a.data.date ? new Date(a.data.date).getTime() : 0;
          const db = b.data.date ? new Date(b.data.date).getTime() : 0;
          return db - da;
        });
      } else if (sadSortOrder === 'exited_first') {
        arr.sort((a, b) => {
          const aIsExited = (a.data.status || 'Pending') === 'Exited' ? 0 : 1;
          const bIsExited = (b.data.status || 'Pending') === 'Exited' ? 0 : 1;
          if (aIsExited !== bIsExited) return aIsExited - bIsExited;
          // same group: newest first
          const da = a.data.date ? new Date(a.data.date).getTime() : 0;
          const db = b.data.date ? new Date(b.data.date).getTime() : 0;
          return db - da;
        });
      } else {
        // Default: newest first (date descending)
        arr.sort((a, b) => {
          const da = a.data.date ? new Date(a.data.date).getTime() : 0;
          const db = b.data.date ? new Date(b.data.date).getTime() : 0;
          return db - da;
        });
      }

      return arr;
    },
    [sadDateFrom, sadDateTo, sadTimeFrom, sadTimeTo, sadSortStatus, sadSortOrder]
  );

  const handleGenerateSad = async () => {
    if (!sadQuery.trim()) {
      toast({ title: 'SAD No Required', description: 'Type a SAD number to search', status: 'warning', duration: 2500 });
      return;
    }
    try {
      setSadLoading(true);
      // Fetch newest first (date descending)
      const { data, error } = await supabase
        .from('tickets')
        .select('*')
        .ilike('sad_no', `%${sadQuery.trim()}%`)
        .order('date', { ascending: false }); // NEW: newest first

      if (error) throw error;

      const mapped = (data || []).map((ticket) => {
        const exitCandidate = ticket.status === 'Exited'
          ? ticket.date
          : (ticket.exit_date || ticket.outgate_date || ticket.outgate_at || ticket.exited_at || null);

        const inferredStatus = ticket.status ? String(ticket.status) : (exitCandidate ? 'Exited' : 'Pending');

        return {
          ticketId: ticket.ticket_id || (ticket.id ? String(ticket.id) : `${Math.random()}`),
          data: {
            sadNo: ticket.sad_no ?? ticket.sadNo ?? '',
            ticketNo: ticket.ticket_no ?? '',
            date: ticket.date || ticket.submitted_at || exitCandidate || null,
            gnswTruckNo: ticket.gnsw_truck_no || ticket.vehicle_number || ticket.truck_no || '',
            gross: ticket.gross ?? null,
            tare: ticket.tare ?? null,
            net: ticket.net ?? null,
            driver: ticket.driver ?? 'N/A',
            consignee: ticket.consignee ?? '',
            operator: ticket.operator ?? '',
            containerNo: ticket.container_no ?? '',
            fileUrl: ticket.file_url ?? null,
            status: inferredStatus,
          },
        };
      });

      // Ensure initial mapped list is sorted newest-first (safety)
      const sortedMapped = mapped.slice().sort((a, b) => {
        const da = a.data.date ? new Date(a.data.date).getTime() : 0;
        const db = b.data.date ? new Date(b.data.date).getTime() : 0;
        return db - da;
      });

      setSadOriginal(sortedMapped);
      // compute filtered version (honor any existing filters)
      setSadTickets(computeSadFiltered(sortedMapped));
      setSadDateFrom('');
      setSadDateTo('');
      setSadTimeFrom('');
      setSadTimeTo('');
      setSadMeta({
        sad: sadQuery.trim(),
        dateRangeText: sortedMapped.length > 0 && sortedMapped[0].data.date ? new Date(sortedMapped[0].data.date).toLocaleDateString() : 'All',
        startTimeLabel: '',
        endTimeLabel: '',
      });

      if ((sortedMapped || []).length === 0) {
        toast({ title: 'No tickets found', status: 'info', duration: 2500 });
      } else {
        toast({ title: `Found ${sortedMapped.length} ticket(s)`, status: 'success', duration: 1500 });
      }
    } catch (err) {
      console.error(err);
      toast({ title: 'Search failed', description: err?.message || 'Could not fetch tickets', status: 'error', duration: 4000 });
    } finally {
      setSadLoading(false);
    }
  };

  // Recompute filtered tickets whenever original data or filter controls change
  useEffect(() => {
    setSadTickets(computeSadFiltered(sadOriginal));
  }, [sadOriginal, computeSadFiltered]);

  const applySadRange = () => {
    setSadTickets(computeSadFiltered(sadOriginal));
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
    setSadTickets(computeSadFiltered(sadOriginal));
    setSadMeta((m) => ({ ...m, startTimeLabel: '', endTimeLabel: '', dateRangeText: '' }));
  };

  const resetSearch = () => {
    setSadQuery('');
    setSadOriginal([]);
    setSadTickets([]);
    setSadMeta({});
    setSadDateFrom('');
    setSadDateTo('');
    setSadTimeFrom('');
    setSadTimeTo('');
    setSadSortOrder('none');
    setSadSortStatus('');
  };

  // subscription for realtime new tickets for the current SAD
  useEffect(() => {
    // no subscription unless there is a query
    const q = (sadQuery || '').trim();
    if (!q) return undefined;

    // Build supabase subscription filtered by sad_no equals the query string
    // Using `.from('tickets:sad_no=eq.<value>')` pattern supported by supabase-js v1
    let sub;
    try {
      sub = supabase
        .from(`tickets:sad_no=eq.${q}`)
        .on('INSERT', (payload) => {
          const ticket = payload.new;
          // map incoming ticket to the same shape
          const exitCandidate = ticket.status === 'Exited'
            ? ticket.date
            : (ticket.exit_date || ticket.outgate_date || ticket.outgate_at || ticket.exited_at || null);

          const inferredStatus = ticket.status ? String(ticket.status) : (exitCandidate ? 'Exited' : 'Pending');

          const newMapped = {
            ticketId: ticket.ticket_id || (ticket.id ? String(ticket.id) : `${Math.random()}`),
            data: {
              sadNo: ticket.sad_no ?? ticket.sadNo ?? '',
              ticketNo: ticket.ticket_no ?? '',
              date: ticket.date || ticket.submitted_at || exitCandidate || null,
              gnswTruckNo: ticket.gnsw_truck_no || ticket.vehicle_number || ticket.truck_no || '',
              gross: ticket.gross ?? null,
              tare: ticket.tare ?? null,
              net: ticket.net ?? null,
              driver: ticket.driver ?? 'N/A',
              consignee: ticket.consignee ?? '',
              operator: ticket.operator ?? '',
              containerNo: ticket.container_no ?? '',
              fileUrl: ticket.file_url ?? null,
              status: inferredStatus,
            },
          };

          // merge into original (avoid duplicates)
          setSadOriginal((prev) => {
            const exists = prev.some((p) => p.ticketId === newMapped.ticketId || (p.data.ticketNo && newMapped.data.ticketNo && p.data.ticketNo === newMapped.data.ticketNo));
            if (exists) {
              // update existing if desired (here we replace)
              const updated = prev.map((p) => (p.ticketId === newMapped.ticketId || (p.data.ticketNo && newMapped.data.ticketNo && p.data.ticketNo === newMapped.data.ticketNo) ? newMapped : p));
              // ensure newest-first order
              updated.sort((a, b) => {
                const da = a.data.date ? new Date(a.data.date).getTime() : 0;
                const db = b.data.date ? new Date(b.data.date).getTime() : 0;
                return db - da;
              });
              // propagate
              // also update visible filtered list using computeSadFiltered
              setSadTickets(computeSadFiltered(updated));
              return updated;
            } else {
              // prepend so new records appear on top
              const next = [newMapped, ...prev];
              // ensure newest-first order (in case incoming date is older)
              next.sort((a, b) => {
                const da = a.data.date ? new Date(a.data.date).getTime() : 0;
                const db = b.data.date ? new Date(b.data.date).getTime() : 0;
                return db - da;
              });
              // compute filtered tickets from new original
              setSadTickets(computeSadFiltered(next));
              toast({ title: 'New ticket received', description: `Ticket ${newMapped.data.ticketNo || newMapped.ticketId} for SAD ${q}`, status: 'info', duration: 4000, isClosable: true });
              return next;
            }
          });
        })
        .subscribe();
    } catch (e) {
      console.warn('Realtime subscription failed to init', e);
    }

    // cleanup on change / unmount
    return () => {
      try {
        if (sub) supabase.removeSubscription(sub);
      } catch (e) {
        // newer supabase client versions use removeChannel; attempt both might be needed.
        try {
          if (sub) supabase.removeChannel(sub);
        } catch (_) {
          // ignore
        }
      }
    };
    // Only subscribe/unsubscribe when sadQuery changes
  }, [sadQuery, computeSadFiltered, toast]);

  // derived filtered & sorted SAD list based on status and order is handled in computeSadFiltered -> sadTickets already honors it.

  const cumulativeNet = useMemo(() => {
    return sadTickets.reduce((sum, t) => {
      const { net } = computeWeights({ gross: t.data.gross, tare: t.data.tare, net: t.data.net });
      return sum + (net || 0);
    }, 0);
  }, [sadTickets]);

  const handleDownloadSadPdf = async () => {
    if (!sadTickets || sadTickets.length === 0) {
      toast({ title: 'No tickets', description: 'Nothing to export', status: 'info', duration: 2500 });
      return;
    }

    const rowsHtml = sadTickets
      .map((t) => {
        const { gross, tare, net } = computeWeights({ gross: t.data.gross, tare: t.data.tare, net: t.data.net });
        return `<tr>
        <td>${t.data.sadNo ?? ''}</td>
        <td>${t.data.ticketNo ?? ''}</td>
        <td>${t.data.date ? new Date(t.data.date).toLocaleString() : ''}</td>
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
    const body = encodeURIComponent(`Please find Weighbridge report for SAD ${sadMeta.sad}.\n\nTransactions: ${sadTickets.length}\nCumulative Net: ${Number(cumulativeNet || 0).toLocaleString()} kg\n\n(Please attach the downloaded PDF if it wasn't attached automatically)`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const handleExportSadCsv = () => {
    if (!sadTickets.length) {
      toast({ title: 'No rows to export', status: 'info', duration: 2000 });
      return;
    }
    const rows = sadTickets.map(t => {
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
        <Box>
          <Text fontSize="2xl" fontWeight="bold">SAD Report</Text>
          <Text color="gray.500">Search SAD → filter by date/time or status → export or print.</Text>
        </Box>

        <HStack spacing={4}>
          <Stat bg="white" p={3} borderRadius="md" boxShadow="sm">
            <StatLabel>Total Transactions</StatLabel>
            <StatNumber>{sadTickets.length}</StatNumber>
            <StatHelpText>{sadOriginal.length > 0 ? `of ${sadOriginal.length} returned` : ''}</StatHelpText>
          </Stat>

          <Stat bg="white" p={3} borderRadius="md" boxShadow="sm">
            <StatLabel>Cumulative Net (kg)</StatLabel>
            <StatNumber>{Number(cumulativeNet || 0).toLocaleString()}</StatNumber>
            <StatHelpText>From current filtered results</StatHelpText>
          </Stat>
        </HStack>
      </Flex>

      <Box bg="white" p={4} borderRadius="md" boxShadow="sm" mb={6}>
        <Text fontWeight="semibold" mb={2}>SAD Report (Search by SAD No)</Text>
        <Flex gap={3} align="center" mb={3} flexWrap="wrap">
          <Input
            placeholder="Type SAD number (partial allowed)"
            value={sadQuery}
            onChange={(e) => setSadQuery(e.target.value)}
            maxW="360px"
          />
          <Button colorScheme="teal" leftIcon={<SearchIcon />} onClick={handleGenerateSad} isLoading={sadLoading}>
            Generate
          </Button>

          <Box ml="auto" display="flex" gap={2}>
            <Button size="sm" variant="ghost" onClick={() => { resetSearch(); }}>
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

      {sadTickets.length > 0 && (
        <Box mb={6} bg="white" p={4} borderRadius="md" boxShadow="sm">
          <Text fontWeight="semibold" mb={3}>SAD Results — {sadMeta.sad} ({sadTickets.length} records)</Text>
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
              {sadTickets.map((t) => {
                const { gross, tare, net } = computeWeights({ gross: t.data.gross, tare: t.data.tare, net: t.data.net });
                return (
                  <Tr key={t.ticketId}>
                    <Td>{t.data.sadNo}</Td>
                    <Td>{t.data.ticketNo}</Td>
                    <Td>{t.data.date ? new Date(t.data.date).toLocaleString() : 'N/A'}</Td>
                    <Td>{t.data.gnswTruckNo}</Td>
                    <Td isNumeric>{gross != null ? Number(gross).toLocaleString() : '—'} KG</Td>
                    <Td isNumeric>{tare != null ? Number(tare).toLocaleString() : '—'} KG</Td>
                    <Td isNumeric>{net != null ? Number(net).toLocaleString() : '—'} KG</Td>
                    <Td>{t.data.status}</Td>
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
                <Td colSpan={2} />
              </Tr>
            </Tbody>
          </Table>
        </Box>
      )}
    </Box>
  );
}
