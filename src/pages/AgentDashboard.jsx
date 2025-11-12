// src/pages/AgentDashboard.jsx
import React, { useState, useMemo, useEffect } from 'react';
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
  Spacer,
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

/**
 * Deduplicate an array of mapped rows by ticket number or ticketId.
 * Keeps the first occurrence (assumes array sorted newest-first where appropriate).
 */
function dedupeByTicket(arr = []) {
  const seen = new Set();
  const out = [];
  const noKeyRows = [];

  const normalizeKey = (item) => {
    const ticketNo = item?.data?.ticketNo;
    if (ticketNo !== undefined && ticketNo !== null) {
      const t = String(ticketNo).trim();
      if (t !== '') return t;
    }
    const id = item?.ticketId;
    if (id !== undefined && id !== null) return String(id).trim();
    return null;
  };

  for (const item of arr) {
    const key = normalizeKey(item);
    if (!key) {
      noKeyRows.push(item);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return [...out, ...noKeyRows];
}

export default function OutgateReports() {
  const toast = useToast();

  // SAD search workflow
  const [sadQuery, setSadQuery] = useState('');
  const [sadOriginal, setSadOriginal] = useState([]); // raw results mapped from outgate
  const [sadTickets, setSadTickets] = useState([]); // filtered after range/status
  const [sadDateFrom, setSadDateFrom] = useState('');
  const [sadDateTo, setSadDateTo] = useState('');
  const [sadTimeFrom, setSadTimeFrom] = useState('');
  const [sadTimeTo, setSadTimeTo] = useState('');
  const [sadLoading, setSadLoading] = useState(false);
  const [sadMeta, setSadMeta] = useState({});

  // truck filter (new)
  const [truckFilter, setTruckFilter] = useState(''); // exact pick from list
  const [truckQuery, setTruckQuery] = useState(''); // free-text partial filter

  // status/sort controls (kept for UI compatibility)
  const [sadSortStatus, setSadSortStatus] = useState(''); // '', 'Pending', 'Exited'
  const [sadSortOrder, setSadSortOrder] = useState('none');

  const parseTimeToMinutes = (timeStr) => {
    if (!timeStr) return null;
    const [hh, mm] = String(timeStr).split(':').map((n) => Number(n));
    if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
    return hh * 60 + mm;
  };

  // Helper: map an outgate row to the UI shape used in this component
  const mapOutgateRow = (row) => {
    // Important: keep weighed_at separate from exitTime
    // weighed_at => row.date (timestamp from tickets when weighed)
    // exitTime => row.created_at (when outgate record was created / exit confirmed)
    return {
      ticketId: row.ticket_id || (row.id ? String(row.id) : `${Math.random()}`),
      data: {
        sadNo: row.sad_no ?? '',
        ticketNo: row.ticket_no ?? '',
        weighed_at: row.date ?? null, // weighbridge timestamp
        exitTime: row.created_at ?? null, // outgate created_at (exit time)
        gnswTruckNo: row.vehicle_number ?? '',
        gross: row.gross ?? null,
        tare: row.tare ?? null,
        net: row.net ?? null,
        driver: row.driver ?? 'N/A',
        containerNo: row.container_id ?? '',
        fileUrl: row.file_url ?? null,
        status: 'Exited',
        // keep created_at for sorting/filtering if needed
        created_at: row.created_at ?? null,
        date: row.date ?? null,
      },
    };
  };

  // Utility that returns the filtered tickets from an original array given current date/time filters
  // Filters are applied against the WEIGHED_AT (row.date) as before (so date/time range filters control weighed_at)
  const computeFilteredFromOriginal = (originalArr) => {
    if (!originalArr) return [];

    const tfMinutes = parseTimeToMinutes(sadTimeFrom);
    const ttMinutes = parseTimeToMinutes(sadTimeTo);
    const hasDateRange = !!(sadDateFrom || sadDateTo);
    const startDate = sadDateFrom ? new Date(sadDateFrom + 'T00:00:00') : null;
    const endDate = sadDateTo ? new Date(sadDateTo + 'T23:59:59.999') : null;

    const qLower = (truckQuery || '').trim().toLowerCase();
    const truckFilterLower = (truckFilter || '').trim().toLowerCase();

    const filtered = originalArr.filter((t) => {
      const dRaw = t.data.weighed_at; // filter by weighed_at
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
        if (d < start || d > end) return false;
      } else if (sadTimeFrom || sadTimeTo) {
        const minutes = d.getHours() * 60 + d.getMinutes();
        const from = tfMinutes != null ? tfMinutes : 0;
        const to = ttMinutes != null ? ttMinutes : 24 * 60 - 1;
        if (minutes < from || minutes > to) return false;
      }

      if (sadSortStatus) {
        if ((t.data.status || 'Exited') !== sadSortStatus) return false;
      }

      // truck filter logic:
      const truckVal = (t.data.gnswTruckNo || '').toString().toLowerCase();
      if (truckFilterLower) {
        // exact selected pick must match (or contain)
        if (!truckVal.includes(truckFilterLower)) return false;
      }
      if (qLower) {
        if (!truckVal.includes(qLower)) return false;
      }

      return true;
    });

    // Sort newest first by exitTime (created_at) if present, else weighed_at
    filtered.sort((a, b) => {
      const da = new Date(a.data.exitTime ?? a.data.weighed_at ?? 0).getTime();
      const db = new Date(b.data.exitTime ?? b.data.weighed_at ?? 0).getTime();
      return db - da; // newest first
    });

    return filtered;
  };

  // Helper: compute discharged net sum from an array of mapped rows
  const computeTotalNetFromArray = (arr = []) => {
    if (!Array.isArray(arr)) return 0;
    return arr.reduce((sum, t) => {
      const { net } = computeWeights({ gross: t.data.gross, tare: t.data.tare, net: t.data.net });
      return sum + (net || 0);
    }, 0);
  };

  // Generate SAD results by querying the outgate table (new behavior)
  const handleGenerateSad = async () => {
    if (!sadQuery.trim()) {
      toast({ title: 'SAD No Required', description: 'Type a SAD number to search', status: 'warning', duration: 2500 });
      return;
    }
    try {
      setSadLoading(true);

      // Query outgate table (confirmed exits). Sort newest first by created_at.
      const { data, error } = await supabase
        .from('outgate')
        .select('*')
        .ilike('sad_no', `%${sadQuery.trim()}%`)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const mapped = (data || []).map(mapOutgateRow);

      // ensure newest first (by exitTime / created_at)
      mapped.sort((a, b) => {
        const da = new Date(a.data.exitTime ?? a.data.weighed_at ?? 0).getTime();
        const db = new Date(b.data.exitTime ?? b.data.weighed_at ?? 0).getTime();
        return db - da;
      });

      // dedupe by ticket number (keeps first occurrence which is newest-first)
      const uniqueMapped = dedupeByTicket(mapped);

      setSadOriginal(uniqueMapped);

      // compute filtered view (filters apply to weighed_at, also applies truck filters if set)
      const filtered = computeFilteredFromOriginal(uniqueMapped);
      setSadTickets(filtered);

      // reset range controls (we keep truck filters so user can further narrow)
      setSadDateFrom('');
      setSadDateTo('');
      setSadTimeFrom('');
      setSadTimeTo('');

      // compute discharged weight from the mapped result (all rows found)
      const totalNet = computeTotalNetFromArray(uniqueMapped);

      // attempt to fetch the SAD declaration row for more accurate declared weight/status (optional)
      let sadRow = null;
      try {
        const { data: sadData, error: sadError } = await supabase
          .from('sad_declarations')
          .select('sad_no, declared_weight, total_recorded_weight, status')
          .ilike('sad_no', `${sadQuery.trim()}`)
          .maybeSingle();
        if (!sadError) sadRow = sadData || null;
      } catch (e) {
        console.debug('sad fetch failed', e);
      }

      const declared = sadRow ? Number(sadRow.declared_weight ?? 0) : null;
      const discharged = Number(totalNet || 0);
      const discrepancy = (declared !== null && declared >= 0) ? Math.max(0, discharged - declared) : 0;
      const discrepancyPercent = (declared && declared > 0) ? (discrepancy / declared) * 100 : null;

      setSadMeta({
        sad: sadQuery.trim(),
        dateRangeText:
          uniqueMapped.length > 0 && uniqueMapped[0].data.weighed_at
            ? new Date(uniqueMapped[0].data.weighed_at).toLocaleDateString()
            : 'All',
        startTimeLabel: '',
        endTimeLabel: '',
        declaredWeight: declared,
        dischargedWeight: discharged,
        sadStatus: sadRow ? (sadRow.status ?? 'In Progress') : 'Unknown',
        sadExists: !!sadRow,
        discrepancy,
        discrepancyPercent,
      });

      if ((uniqueMapped || []).length === 0) {
        toast({ title: 'No records found for that SAD', status: 'info', duration: 2500 });
      }
    } catch (err) {
      console.error(err);
      toast({ title: 'Search failed', description: err?.message || 'Could not fetch outgate rows', status: 'error', duration: 4000 });
    } finally {
      setSadLoading(false);
    }
  };

  const applySadRange = () => {
    const newFiltered = computeFilteredFromOriginal(sadOriginal);
    setSadTickets(newFiltered);
    setSadMeta((m) => ({ ...m, dischargedWeight: computeTotalNetFromArray(newFiltered) }));
  };

  const resetSadRange = () => {
    setSadDateFrom('');
    setSadDateTo('');
    setSadTimeFrom('');
    setSadTimeTo('');
    setTruckFilter('');
    setTruckQuery('');
    const newFiltered = computeFilteredFromOriginal(sadOriginal);
    setSadTickets(newFiltered);
    setSadMeta((m) => ({ ...m, startTimeLabel: '', endTimeLabel: '', dateRangeText: '', dischargedWeight: computeTotalNetFromArray(newFiltered), discrepancy: 0, discrepancyPercent: null }));
  };

  const filteredSadTickets = useMemo(() => {
    return Array.isArray(sadTickets) ? sadTickets.slice() : [];
  }, [sadTickets]);

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
        <td>${t.data.weighed_at ? new Date(t.data.weighed_at).toLocaleString() : ''}</td>
        <td>${t.data.exitTime ? new Date(t.data.exitTime).toLocaleString() : ''}</td>
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
            <th>SAD</th><th>Ticket</th><th>Weighed At</th><th>Exit Time</th><th>Truck</th><th>Gross</th><th>Tare</th><th>Net</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
          <tr style="font-weight:bold;background:#f0f8ff">
            <td colspan="8">Cumulative Net</td>
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
        'Weighed At': t.data.weighed_at ? new Date(t.data.weighed_at).toLocaleString() : '',
        'Exit Time': t.data.exitTime ? new Date(t.data.exitTime).toLocaleString() : '',
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

  // compute unique truck options from sadOriginal for the select dropdown
  const truckOptions = useMemo(() => {
    const set = new Set();
    (sadOriginal || []).forEach((r) => {
      const v = (r?.data?.gnswTruckNo || '').toString().trim();
      if (v) set.add(v);
    });
    return Array.from(set).sort();
  }, [sadOriginal]);

  // Real-time subscription: when a SAD search is active, subscribe to outgate inserts & updates
  useEffect(() => {
    if (!sadQuery || !sadQuery.trim()) return;

    const queryLower = sadQuery.trim().toLowerCase();

    let isUnsubscribed = false;
    let subscription = null;

    const handleIncomingRow = (payload) => {
      if (!payload) return;
      const row = payload.new ?? payload;
      if (!row) return;
      const rowSad = (row.sad_no || '').toString().toLowerCase();
      if (!rowSad.includes(queryLower)) return;

      const mapped = mapOutgateRow(row);

      // Insert into sadOriginal (newest-first), dedupe and recompute filtered results centrally
      setSadOriginal((prev) => {
        const next = [mapped, ...prev];
        next.sort((a, b) => {
          const da = new Date(a.data.exitTime ?? a.data.weighed_at ?? 0).getTime();
          const db = new Date(b.data.exitTime ?? b.data.weighed_at ?? 0).getTime();
          return db - da;
        });
        const deduped = dedupeByTicket(next);

        // update discharged weight from the full original list
        setSadMeta((m) => ({ ...m, dischargedWeight: computeTotalNetFromArray(deduped) }));

        // recompute filtered tickets using the centralized filter function (which includes truck filters)
        const filtered = computeFilteredFromOriginal(deduped);
        setSadTickets(filtered);

        return deduped;
      });

      // update some meta fields
      setSadMeta((m) => ({
        ...m,
        dateRangeText: m.dateRangeText || (mapped.data.weighed_at ? new Date(mapped.data.weighed_at).toLocaleDateString() : m.dateRangeText),
        dischargedWeight: computeTotalNetFromArray([mapped, ...sadOriginal]),
      }));
    };

    if (supabase.channel) {
      try {
        subscription = supabase
          .channel('public:outgate')
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'outgate' },
            (payload) => {
              if (!isUnsubscribed) handleIncomingRow(payload);
            }
          )
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'outgate' },
            (payload) => {
              if (!isUnsubscribed) handleIncomingRow(payload);
            }
          )
          .subscribe();
      } catch (err) {
        console.warn('Realtime channel subscribe failed, will try legacy subscribe', err);
        subscription = null;
      }
    }

    if (!subscription) {
      try {
        subscription = supabase
          .from('outgate')
          .on('INSERT', (payload) => {
            if (!isUnsubscribed) handleIncomingRow(payload);
          })
          .on('UPDATE', (payload) => {
            if (!isUnsubscribed) handleIncomingRow(payload);
          })
          .subscribe();
      } catch (err) {
        console.warn('Legacy realtime subscribe failed', err);
        subscription = null;
      }
    }

    return () => {
      isUnsubscribed = true;
      try {
        if (!subscription) return;
        if (supabase.removeChannel && typeof subscription === 'object') {
          try {
            supabase.removeChannel(subscription);
          } catch (e) {
            // ignore
          }
        } else if (subscription.unsubscribe) {
          try {
            subscription.unsubscribe();
          } catch (e) {
            // ignore
          }
        } else if (supabase.removeSubscription) {
          try {
            supabase.removeSubscription(subscription);
          } catch (e) {
            // ignore
          }
        }
      } catch (e) {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sadQuery, sadDateFrom, sadDateTo, sadTimeFrom, sadTimeTo, sadSortStatus, truckFilter, truckQuery]);

  const resetSearch = () => {
    setSadQuery('');
    setSadOriginal([]);
    setSadTickets([]);
    setSadDateFrom('');
    setSadDateTo('');
    setSadTimeFrom('');
    setSadTimeTo('');
    setSadMeta({});
    setTruckFilter('');
    setTruckQuery('');
  };

  return (
    <Box p={{ base: 4, md: 8 }}>
      <Flex justify="space-between" align="center" mb={6} gap={4} flexWrap="wrap">
        <Box>
          <Text fontSize="2xl" fontWeight="bold">SAD Report - Agent Dashboard</Text>
          <Text color="gray.500">Search outgate (confirmed exits) by SAD → filter by date/time/truck → export or print.</Text>
        </Box>

        <HStack spacing={4}>
          <Stat bg="purple.50" p={3} borderRadius="md" boxShadow="sm">
            <StatLabel>Total Transactions</StatLabel>
            <StatNumber>{filteredSadTickets.length}</StatNumber>
            <StatHelpText>{sadOriginal.length > 0 ? `of ${sadOriginal.length} returned` : ''}</StatHelpText>
          </Stat>

          <Stat bg="cyan.50" p={3} borderRadius="md" boxShadow="sm">
            <StatLabel>Cumulative Net (kg)</StatLabel>
            <StatNumber>{Number(cumulativeNet || 0).toLocaleString()}</StatNumber>
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
            <Button size="sm" variant="ghost" onClick={resetSearch}>
              Clear
            </Button>
          </Box>
        </Flex>

        {sadOriginal.length > 0 && (
          <Box mt={2}>
            {/* Truck filter - appears after SAD search */}
            <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3} mb={3}>
              <Box>
                <FormLabel>Search / Filter by Truck No</FormLabel>
                <Input placeholder="e.g. BJLO068Z or part of plate" size="sm" value={truckQuery} onChange={(e) => setTruckQuery(e.target.value)} />
              </Box>
              <Box>
                <FormLabel>Pick Detected Truck</FormLabel>
                <Select size="sm" value={truckFilter} onChange={(e) => setTruckFilter(e.target.value)}>
                  <option value="">All Trucks</option>
                  {truckOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
              </Box>
            </SimpleGrid>

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

            {/* SAD detail stats cards - different bg colors for attractiveness */}
            {sadMeta?.sad && (
              <SimpleGrid columns={{ base: 1, md: 4 }} spacing={3} mt={3} mb={3}>
                <Stat bg="blue.50" px={4} py={3} borderRadius="md" boxShadow="sm">
                  <StatLabel>Declared Weight</StatLabel>
                  <StatNumber>{formatWeight(sadMeta.declaredWeight)}</StatNumber>
                  <StatHelpText>From SAD Declaration</StatHelpText>
                </Stat>

                <Stat bg="green.50" px={4} py={3} borderRadius="md" boxShadow="sm">
                  <StatLabel>Discharged Weight</StatLabel>
                  <StatNumber>{formatWeight(sadMeta.dischargedWeight != null ? sadMeta.dischargedWeight : computeTotalNetFromArray(sadOriginal))}</StatNumber>
                  <StatHelpText>Sum of nets (current results)</StatHelpText>
                </Stat>

                <Stat bg="gray.50" px={4} py={3} borderRadius="md" boxShadow="sm">
                  <StatLabel>SAD Status</StatLabel>
                  <StatNumber>{sadMeta.sadStatus || 'Unknown'}</StatNumber>
                  <StatHelpText>{sadMeta.sadExists ? 'Declaration exists in DB' : 'No declaration found'}</StatHelpText>
                </Stat>

                {/* Discrepancy card: appears only when dischargedWeight > declaredWeight */}
                {(sadMeta.declaredWeight != null && sadMeta.dischargedWeight > sadMeta.declaredWeight) ? (
                  <Stat bg="red.50" px={4} py={3} borderRadius="md" boxShadow="sm">
                    <StatLabel>Discrepancy</StatLabel>
                    <StatNumber>{formatWeight(sadMeta.dischargedWeight - sadMeta.declaredWeight)} KG</StatNumber>
                    <StatHelpText>
                      {sadMeta.discrepancyPercent != null ? `${sadMeta.discrepancyPercent.toFixed(1)}% over declared` : 'Over declared weight'}
                    </StatHelpText>
                  </Stat>
                ) : (
                  // Show a calming card when no discrepancy
                  <Stat bg="gray.25" px={4} py={3} borderRadius="md" boxShadow="sm">
                    <StatLabel>Discrepancy</StatLabel>
                    <StatNumber>{sadMeta.declaredWeight != null ? `${formatWeight(Math.max(0, (sadMeta.dischargedWeight || 0) - (sadMeta.declaredWeight || 0)))} KG` : '—'}</StatNumber>
                    <StatHelpText>{sadMeta.declaredWeight != null ? 'Within declared limits' : 'No declared weight'}</StatHelpText>
                  </Stat>
                )}
              </SimpleGrid>
            )}

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
                  <FormLabel mb={1} fontSize="sm">Sort by</FormLabel>
                  <Select size="sm" value={sadSortOrder} onChange={(e) => setSadSortOrder(e.target.value)}>
                    <option value="none">Newest first</option>
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

            <Text mt={2} fontSize="sm" color="gray.600">Tip: Use date/time and truck filters to narrow results before exporting. New outgate rows for the current SAD appear automatically below.</Text>
          </Box>
        )}
      </Box>

      {filteredSadTickets.length > 0 && (
        <Box mb={6} bg="white" p={4} borderRadius="md" boxShadow="sm">
          <Flex align="center" mb={3}>
            <Text fontWeight="semibold">SAD Results — {sadMeta.sad} ({filteredSadTickets.length} records)</Text>
            <Spacer />
            <Text fontSize="sm" color="gray.500">Truck filter: {truckFilter || truckQuery || 'None'}</Text>
          </Flex>

          <Table variant="striped" size="sm">
            <Thead>
              <Tr>
                <Th>SAD No</Th>
                <Th>Ticket No</Th>
                <Th>Weighed At</Th>
                <Th>Exit Time</Th>
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
                    <Td>{t.data.weighed_at ? new Date(t.data.weighed_at).toLocaleString() : 'N/A'}</Td>
                    <Td>{t.data.exitTime ? new Date(t.data.exitTime).toLocaleString() : 'N/A'}</Td>
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
                <Td colSpan={7}>Cumulative Net</Td>
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
