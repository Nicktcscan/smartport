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

  // Keep `currentPage` referenced so it's considered used by linters/compilers until pagination is implemented.
  useEffect(() => {
    // This effect intentionally does nothing; it only reads currentPage to avoid "assigned but never used".
    void currentPage;
  }, [currentPage]);

  // details modal
  const { isOpen: isDetailsOpen, onClose: onDetailsClose } = useDisclosure();
  const [selectedReport] = useState(null);

  // SAD search results (deduped from tickets table)
  const [sadResults, setSadResults] = useState([]);
  const [sadLoading, setSadLoading] = useState(false);
  const sadDebounceRef = useRef(null);

  // tickets mapping and total transactions (deduplicated)
  const [ticketStatusMap, setTicketStatusMap] = useState({}); // ticket_no -> status
  const [totalTransactions, setTotalTransactions] = useState(0); // unique ticket_no count across system

  // SAD declaration metadata (declared weight / status)
  const [sadDeclaration, setSadDeclaration] = useState({ declaredWeight: null, status: 'Unknown', exists: false });

  useEffect(() => {
    let mounted = true;

    const fetchReportsAndTickets = async () => {
      try {
        setLoading(true);

        // fetch outgate rows (includes created_at)
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
            // IMPORTANT: use created_at as the timestamp for filters
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

  // small helper to produce Date object from a date string ("YYYY-MM-DD") and optional time "HH:MM"
      const makeDateTime = (dateStr, timeStr, defaultTimeIsStart = true) => {
        if (!dateStr) return null;
        const time = timeStr ? timeStr : (defaultTimeIsStart ? '00:00:00' : '23:59:59.999');
        // Normalize time format:
        const fullTime = time.length <= 5 ? `${time}:00` : time;
        return new Date(`${dateStr}T${fullTime}`);
      };

  /* SAD search: dedupe by ticket_no, newest-first
     Now: when mapping ticket -> UI row, try to attach the matching outgate row (if any)
     and use that outgate.created_at as the timestamp for filtering (so SAD views use outgate timestamps).
  */
  useEffect(() => {
    if (sadDebounceRef.current) {
      clearTimeout(sadDebounceRef.current);
      sadDebounceRef.current = null;
    }

    const q = (searchTerm || '').trim();
    if (!q) {
      setSadResults([]);
      // clear declaration when search cleared
      setSadDeclaration({ declaredWeight: null, status: 'Unknown', exists: false });
      return;
    }

    // Fetch SAD declaration whenever a search term exists (so the SAD stats card can show declared weight/status)
    const fetchSadDeclaration = async () => {
      try {
        const { data: sadRow, error } = await supabase
          .from('sad_declarations')
          .select('sad_no,declared_weight,status,total_recorded_weight')
          .ilike('sad_no', `${q}`)
          .maybeSingle();
        if (!error && sadRow) {
          setSadDeclaration({
            declaredWeight: sadRow.declared_weight != null ? Number(sadRow.declared_weight) : null,
            status: sadRow.status ?? 'Unknown',
            exists: true,
            total_recorded_weight: sadRow.total_recorded_weight ?? null,
          });
        } else {
          setSadDeclaration({ declaredWeight: null, status: 'Unknown', exists: false });
        }
      } catch (err) {
        console.debug('Failed to fetch SAD declaration', err);
        setSadDeclaration({ declaredWeight: null, status: 'Unknown', exists: false });
      }
    };

    // Debounced ticket search
    sadDebounceRef.current = setTimeout(async () => {
      setSadLoading(true);

      try {
        // fetch tickets for matching SAD
        const { data: ticketsData, error } = await supabase
          .from('tickets')
          .select('*')
          .ilike('sad_no', `%${q}%`)
          .order('date', { ascending: false }); // newest-first by ticket date

        if (error) {
          console.warn('SAD lookup error', error);
          setSadResults([]);
          setSadLoading(false);
          // still try to fetch declaration
          await fetchSadDeclaration();
          return;
        }

        // Deduplicate by ticket_no: keep newest (by ticket date/submitted_at)
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

        // Map to UI-friendly shape:
        // - For each ticket, try to find the latest outgate report that matches the ticket_no (from `reports` state).
        // - Use outgateDateTime for date/time filtering and display when present.
        const mapped = deduped
          .map((t) => {
            const ticketNo = t.ticket_no ?? t.ticketNo ?? (t.ticket_id ? String(t.ticket_id) : null);
            // find matching outgate rows for this ticketNo (if any) — pick newest
            const matchingOutgates = reports.filter((r) => r.ticketNo && String(r.ticketNo) === String(ticketNo));
            let chosenOutgate = null;
            if (matchingOutgates.length > 0) {
              chosenOutgate = matchingOutgates.reduce((best, cur) => {
                const bestT = best?.outgateDateTime ? new Date(best.outgateDateTime).getTime() : 0;
                const curT = cur?.outgateDateTime ? new Date(cur.outgateDateTime).getTime() : 0;
                return curT >= bestT ? cur : best;
              }, matchingOutgates[0]);
            }

            const computed = computeWeights({
              gross: t.gross,
              tare: t.tare,
              net: t.net,
            });

            return {
              ticketId: t.ticket_id ?? t.id ?? ticketNo ?? `${Math.random()}`,
              ticketNo,
              sadNo: t.sad_no ?? t.sadNo ?? null,
              // prefer the outgate timestamp when available (so filters use outgate.created_at)
              date: chosenOutgate ? chosenOutgate.outgateDateTime : (t.date ?? t.submitted_at ?? t.created_at ?? null),
              // also keep a reference to any found outgate row
              outgateRef: chosenOutgate ?? null,
              truck: t.gnsw_truck_no ?? t.truck_on_wb ?? t.vehicle_number ?? null,
              gross: computed.gross,
              tare: computed.tare,
              net: computed.net,
              driver: t.driver ?? null,
              raw: t,
            };
          });

        // keep newest-first by the chosen date (outgate or ticket date)
        mapped.sort((a, b) => {
          const aT = a.date ? new Date(a.date).getTime() : 0;
          const bT = b.date ? new Date(b.date).getTime() : 0;
          return bT - aT;
        });

        setSadResults(mapped);

        // fetch SAD declaration too
        await fetchSadDeclaration();
      } catch (err) {
        console.error('SAD search failed', err);
        setSadResults([]);
        // still try to fetch declaration
        await fetchSadDeclaration();
      } finally {
        setSadLoading(false);
      }
    }, 600);

    return () => {
      if (sadDebounceRef.current) clearTimeout(sadDebounceRef.current);
    };
    // include `reports` so we can attach outgate timestamps when mapping SAD -> outgate
  }, [searchTerm, reports]);

  /* -----------------------
     Apply filters to deduplicated outgate reports
     - dedupe full reports by ticket_no earlier with dedupeReportsByTicketNo
     - Then filter by search/date/time (based on outgate.created_at)
  ----------------------- */
  const dedupedReports = useMemo(() => dedupeReportsByTicketNo(reports), [reports]);

  // Build explicit start/end Date objects from the user inputs.
  // Time From only applied if Date From is provided; Time To only applied if Date To is provided.
  const { startDateTime, endDateTime } = useMemo(() => {
    let start = null;
    let end = null;

    if (dateFrom) {
      // If dateFrom provided, attach timeFrom if present, else start of day
      start = makeDateTime(dateFrom, timeFrom ? `${timeFrom}:00` : '00:00:00', true);
    }

    if (dateTo) {
      // If dateTo provided, attach timeTo if present, else end of day
      // NOTE: timeTo only used if dateTo provided (per your request).
      end = makeDateTime(dateTo, timeTo ? `${timeTo}:00` : '23:59:59.999', false);
    }

    return { startDateTime: start, endDateTime: end };
  }, [dateFrom, dateTo, timeFrom, timeTo]);

  const filteredReports = useMemo(() => {
    const term = (searchTerm || '').trim().toLowerCase();

    return dedupedReports.filter((r) => {
      // search term matches (vehicle, ticket, driver, sad, container, destination)
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

      // date/time range: we use outgateDateTime (which was set from created_at)
      if (startDateTime || endDateTime) {
        if (!r.outgateDateTime) return false;
        const d = new Date(r.outgateDateTime);
        if (Number.isNaN(d.getTime())) return false;

        // startDateTime/endDateTime are full Date objects. If only start provided, we only check >= start.
        if (startDateTime && d < startDateTime) return false;
        if (endDateTime && d > endDateTime) return false;
      }

      return true;
    });
  }, [dedupedReports, searchTerm, startDateTime, endDateTime]);

  // newest-first sort (for export / pagination if needed)
  const sortedReports = useMemo(() => {
    const arr = filteredReports.slice();
    arr.sort((a, b) => {
      const aT = a.outgateDateTime ? new Date(a.outgateDateTime).getTime() : 0;
      const bT = b.outgateDateTime ? new Date(b.outgateDateTime).getTime() : 0;
      return bT - aT;
    });
    return arr;
  }, [filteredReports]);

  // Ensure dedupe-by-ticketNo once more for totals (guard - filteredReports should already be deduped,
  // but this makes intention explicit and ensures no ticket counted twice).
  const uniqueFilteredReports = useMemo(() => {
    const map = new Map();
    const manual = [];
    for (const r of filteredReports) {
      const tn = r.ticketNo ? String(r.ticketNo).trim() : '';
      if (tn) {
        if (!map.has(tn)) map.set(tn, r);
        else {
          // keep newest (by outgateDateTime)
          const existing = map.get(tn);
          const a = existing.outgateDateTime ? new Date(existing.outgateDateTime).getTime() : 0;
          const b = r.outgateDateTime ? new Date(r.outgateDateTime).getTime() : 0;
          if (b > a) map.set(tn, r);
        }
      } else {
        manual.push(r);
      }
    }
    return [...map.values(), ...manual];
  }, [filteredReports]);

  // ------ SAD: apply date/time filters to SAD results (so SAD totals respect filters)
  // We filter `sadResults` using the mapped `date` property; that property prefers the outgate.created_at timestamp
  // if an outgate exists for the ticket (so SAD totals reflect outgate timestamps)
  const sadFilteredResults = useMemo(() => {
    if (!sadResults || sadResults.length === 0) return [];

    // Build start/end datetimes same as above (we only filter using the same startDateTime/endDateTime)
    const s = startDateTime;
    const e = endDateTime;

    return sadResults.filter((t) => {
      if (!t.date) return false;
      const d = new Date(t.date);
      if (Number.isNaN(d.getTime())) return false;

      if (s && d < s) return false;
      if (e && d > e) return false;

      return true;
    });
  }, [sadResults, startDateTime, endDateTime]);

  // sad totals used by SAD section
  const sadTotalsMemo = useMemo(() => {
    if (!sadFilteredResults || sadFilteredResults.length === 0) return { transactions: 0, cumulativeNet: 0 };
    let cumulativeNet = 0;
    for (const t of sadFilteredResults) {
      const { net } = computeWeights({ gross: t.gross, tare: t.tare, net: t.net });
      cumulativeNet += (net || 0);
    }
    return { transactions: sadFilteredResults.length, cumulativeNet };
  }, [sadFilteredResults]);

  // Choose which source to show top 'Filtered Rows' & 'Cumulative Net (view)' from:
  // - If a SAD search is active, base those cards on the SAD filtered results (so they match the SAD table).
  // - Otherwise, base those cards on the deduped outgate filtered results.
  const statsSource = useMemo(() => {
    return searchTerm ? sadFilteredResults : uniqueFilteredReports;
  }, [searchTerm, sadFilteredResults, uniqueFilteredReports]);

  const statsTotals = useMemo(() => {
    let cumulativeNet = 0;
    for (const r of statsSource) {
      // for SAD rows, use r.net/gross etc; for outgate rows the same fields exist
      const w = computeWeights(r);
      cumulativeNet += (w.net || 0);
    }
    return {
      rowsCount: statsSource.length,
      cumulativeNet,
    };
  }, [statsSource]);

  // small helper to count unique tickets in the current statsSource (should be deduped by ticket)
  const statsUniqueTickets = useMemo(() => {
    const s = new Set();
    for (const r of statsSource) {
      if (r.ticketNo) s.add(String(r.ticketNo));
    }
    return s.size;
  }, [statsSource]);

  // Removed unused `paginatedReports` variable to avoid lint/compile warning.
  // If you need pagination in the UI later, use `sortedReports.slice(...)` where rendering happens
  // or reintroduce a pagination helper and ensure it's used by the component.

  // Export current (unique) view as CSV (uses sortedReports / filteredReports)
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

  // openDetails removed — selection/modal can be triggered inline when needed

  const handleResetAll = () => {
    setSearchTerm('');
    setDateFrom('');
    setDateTo('');
    setTimeFrom('');
    setTimeTo('');
    setCurrentPage(1);
    toast({ title: 'Filters reset', status: 'info', duration: 1500 });
  };

  return (
    <Box p={{ base: 4, md: 8 }}>
      <Flex justify="space-between" align="center" mb={6} gap={4} flexWrap="wrap">
        <Stack spacing={1}>
          <Text fontSize="2xl" fontWeight="bold">Outgate Reports</Text>
          <Text color="gray.500">Unique-ticket view.</Text>
        </Stack>

        <HStack spacing={2}>
          <Tooltip label="Export current (filtered) view as CSV">
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
          <StatNumber>{(new Set(reports.filter(Boolean).map(r => r.sadNo).filter(Boolean))).size}</StatNumber>
          <StatHelpText>Distinct SAD numbers</StatHelpText>
        </Stat>

        <Stat bg="white" p={4} borderRadius="md" boxShadow="sm">
          <StatLabel>Total Transactions</StatLabel>
          <StatNumber>{totalTransactions}</StatNumber>
          <StatHelpText>unique ticket numbers</StatHelpText>
        </Stat>

        {/* Replaced "Filtered Rows" with "Unique Tickets in View" */}
        <Stat bg="white" p={4} borderRadius="md" boxShadow="sm">
          <StatLabel>Unique Tickets in View</StatLabel>
          <StatNumber>{statsUniqueTickets}</StatNumber>
          <StatHelpText>{searchTerm ? 'Tickets from SAD search' : 'Unique tickets after filters'}</StatHelpText>
        </Stat>

        <Stat bg="white" p={4} borderRadius="md" boxShadow="sm">
          <StatLabel>Cumulative Net (view)</StatLabel>
          <StatNumber>{statsTotals.cumulativeNet ? formatWeight(statsTotals.cumulativeNet) + ' kg' : '—'}</StatNumber>
          <StatHelpText>From current filtered results</StatHelpText>
        </Stat>
      </SimpleGrid>

      {/* SAD detail stats cards (shown when a SAD search is active) */}
      { (searchTerm && (sadResults.length > 0 || sadDeclaration.exists)) && (
        <SimpleGrid columns={{ base: 1, md: 3 }} spacing={3} mb={6}>
          <Stat bg="gray.50" px={4} py={3} borderRadius="md" boxShadow="sm">
            <StatLabel>Declared Weight</StatLabel>
            <StatNumber>{formatWeight(sadDeclaration.declaredWeight)}</StatNumber>
            <StatHelpText>{sadDeclaration.exists ? 'From SAD declaration' : 'No declaration found'}</StatHelpText>
          </Stat>

          <Stat bg="gray.50" px={4} py={3} borderRadius="md" boxShadow="sm">
            <StatLabel>Discharged Weight</StatLabel>
            <StatNumber>{formatWeight(sadTotalsMemo.cumulativeNet)} kg</StatNumber>
            <StatHelpText>Sum of nets (respecting date/time filters)</StatHelpText>
          </Stat>

          <Stat bg="gray.50" px={4} py={3} borderRadius="md" boxShadow="sm">
            <StatLabel>SAD Status</StatLabel>
            <StatNumber>{sadDeclaration.status || (sadResults.length ? 'In Progress' : 'Unknown')}</StatNumber>
            <StatHelpText>{sadDeclaration.exists ? 'Declaration row found' : (sadResults.length ? 'No declaration - tickets found' : 'No data')}</StatHelpText>
          </Stat>
        </SimpleGrid>
      )}

      <Box bg="white" p={4} borderRadius="md" boxShadow="sm" mb={6}>
        <SimpleGrid columns={{ base: 1, md: 4 }} spacing={3}>
          <Box>
            <FormLabel>Search</FormLabel>
            <Flex>
              <Input
                placeholder="Search Here..."
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
            <Text fontSize="xs" color="gray.500" mt={1}>
              Time From is applied to Date From; Time To is applied to Date To. Use different dates for cross-midnight ranges (e.g. 27/09 20:30 → 28/09 08:00).
            </Text>
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

      {/* SAD results (only shown when SAD search is active) */}
      {sadLoading ? (
        <Flex justify="center" mb={4}><Spinner /></Flex>
      ) : (sadFilteredResults && sadFilteredResults.length > 0) ? (
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

      {/* When no search & no SAD results, show friendly message */}
      {!searchTerm && !sadFilteredResults?.length && !loading && (
        <Box bg="white" p={6} borderRadius="md" boxShadow="sm" textAlign="center" color="gray.600">
          <Text>No table to display. Type a SAD number (or other search) to see filtered transactions.</Text>
        </Box>
      )}

      {loading && (
        <Flex justify="center" p={12}><Spinner size="xl" /></Flex>
      )}

      {/* Details modal (kept for any future per-row details) */}
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