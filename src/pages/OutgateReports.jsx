/* eslint-disable no-unused-vars */
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
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  VStack,
} from '@chakra-ui/react';
import {
  RepeatIcon,
  DownloadIcon,
  SearchIcon,
} from '@chakra-ui/icons';
import { FaFilePdf, FaEllipsisV, FaEye, FaFileAlt } from 'react-icons/fa';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../supabaseClient';
import logoUrl from '../assets/logo.png';
import { useAuth } from '../context/AuthContext';

/* -----------------------
   Styling helpers + constants
----------------------- */
const MotionBox = motion(Box);
const ITEMS_PER_PAGE = 5;

/* -----------------------
   Utilities
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
        if (rTime >= existingTime) map.set(tn, r);
      }
    } else {
      manualRows.push(r);
    }
  }

  return [...Array.from(map.values()), ...manualRows];
}

/* -----------------------
   Supabase paged fetch helper
   - pages using .range(from, to) with pageSize = 1000
   - accepts an optional filterFn(query) to apply WHEREs / ORDERs before range
----------------------- */
async function fetchAllPagedSupabase(tableName, selectCols = '*', orderBy = null, ascending = false, filterFn = null) {
  const pageSize = 1000;
  let from = 0;
  const out = [];
  while (true) {
    const to = from + pageSize - 1;
    let baseQuery = supabase.from(tableName).select(selectCols);
    // if caller provided filterFn, let it set WHEREs and ORDERs
    if (typeof filterFn === 'function') {
      baseQuery = filterFn(baseQuery);
    } else if (orderBy) {
      baseQuery = baseQuery.order(orderBy, { ascending });
    }
    const { data, error } = await baseQuery.range(from, to);
    if (error) throw error;
    if (!data || data.length === 0) {
      break;
    }
    out.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

/* -----------------------
   Main component
----------------------- */
export default function OutgateReports() {
  const { user } = useAuth();
  const [reports, setReports] = useState([]);
  const [searchInput, setSearchInput] = useState(''); // typing buffer
  const [searchTerm, setSearchTerm] = useState(''); // actual executed search
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(ITEMS_PER_PAGE);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  // details modal & docs modal
  const { isOpen: isDetailsOpen, onOpen: onDetailsOpen, onClose: onDetailsClose } = useDisclosure();
  const { isOpen: isDocsOpen, onOpen: onDocsOpen, onClose: onDocsClose } = useDisclosure();
  const [selectedReport, setSelectedReport] = useState(null);
  const [docsForView, setDocsForView] = useState([]);

  // SAD search results (populated only when search is executed)
  const [sadResults, setSadResults] = useState([]);
  const [sadLoading, setSadLoading] = useState(false);

  const [ticketStatusMap, setTicketStatusMap] = useState({});
  const [totalTransactions, setTotalTransactions] = useState(0);

  const [sadDeclaration, setSadDeclaration] = useState({ declaredWeight: null, status: 'Unknown', exists: false, total_recorded_weight: null });

  // orb modal (generate report)
  const { isOpen: isOrbOpen, onOpen: onOrbOpen, onClose: onOrbClose } = useDisclosure();
  const [orbGenerating, setOrbGenerating] = useState(false);

  // voice recognition
  const recognitionRef = useRef(null);
  const [listening, setListening] = useState(false);

  // NEW stats values
  const [totalSADs, setTotalSADs] = useState(null);
  const [exitedCount, setExitedCount] = useState(0); // will be total rows in outgate
  const [totalTickets, setTotalTickets] = useState(null);
  const [totalDeclaredWeight, setTotalDeclaredWeight] = useState(null);
  const [totalDischargedWeight, setTotalDischargedWeight] = useState(null); // sum of total_recorded_weight

  // helper: convert date + time to Date
  const makeDateTime = (dateStr, timeStr, defaultTimeIsStart = true) => {
    if (!dateStr) return null;
    const time = timeStr ? timeStr : (defaultTimeIsStart ? '00:00:00' : '23:59:59.999');
    const fullTime = time.length <= 5 ? `${time}:00` : time;
    return new Date(`${dateStr}T${fullTime}`);
  };

  useEffect(() => {
    let mounted = true;

    const fetchReportsAndTickets = async () => {
      try {
        setLoading(true);

        // fetch outgate reports (all rows) using paging to avoid PostgREST caps
        const outData = await fetchAllPagedSupabase('outgate', '*', 'created_at', false);

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
            exitedBy: og.edited_by ?? og.editedBy ?? null,
            rawRow: og,
          };
        });

        if (!mounted) return;
        setReports(mapped);

        // Confirmed Exits = total rows in outgate
        setExitedCount(Array.isArray(outData) ? outData.length : mapped.length);

        // --- fetch ticket statuses for summary via paging
        const ticketsDataAll = await fetchAllPagedSupabase('tickets', 'ticket_no,status', 'ticket_no', true);

        if (!ticketsDataAll || ticketsDataAll.length === 0) {
          setTicketStatusMap({});
          setTotalTransactions(0);
        } else {
          const map = {};
          (ticketsDataAll || []).forEach((t) => {
            const tn = (t.ticket_no ?? '').toString().trim();
            if (!tn) return;
            map[tn] = t.status ?? map[tn] ?? 'Pending';
          });

          // ensure outgate rows are reflected too
          for (const r of mapped) {
            if (r.ticketNo && !map[r.ticketNo]) map[r.ticketNo] = r.rawRow?.status ?? 'Exited';
          }

          if (!mounted) return;
          setTicketStatusMap(map);
          setTotalTransactions(Object.keys(map).length);
        }

        // --- fetch total tickets count (exact)
        try {
          const { count: ticketsCount, error: countErr } = await supabase
            .from('tickets')
            .select('id', { count: 'exact', head: true });
          if (countErr) {
            console.warn('total tickets count failed', countErr);
            setTotalTickets(null);
          } else {
            setTotalTickets(typeof ticketsCount === 'number' ? ticketsCount : null);
          }
        } catch (e) {
          console.debug('tickets count fetch failed', e);
          setTotalTickets(null);
        }

        // --- fetch all sad_declarations and compute totals (unchanged)
        try {
          const { data: sadRows, error: sadErr } = await supabase
            .from('sad_declarations')
            .select('sad_no,declared_weight,total_recorded_weight');

          if (sadErr) {
            console.warn('failed to fetch sad declarations', sadErr);
            setTotalSADs(null);
            setTotalDeclaredWeight(null);
            setTotalDischargedWeight(null);
          } else if (Array.isArray(sadRows)) {
            // total number of declaration rows
            setTotalSADs(sadRows.length);

            // sum declared weights (coerce to Number; ignore null/non-numeric)
            const sumDeclared = sadRows.reduce((acc, r) => {
              const n = r && (r.declared_weight !== null && r.declared_weight !== undefined) ? Number(r.declared_weight) : 0;
              return acc + (Number.isFinite(n) ? n : 0);
            }, 0);
            setTotalDeclaredWeight(sumDeclared);

            // sum total_recorded_weight (discharged)
            const sumDischarged = sadRows.reduce((acc, r) => {
              const n = r && (r.total_recorded_weight !== null && r.total_recorded_weight !== undefined) ? Number(r.total_recorded_weight) : 0;
              return acc + (Number.isFinite(n) ? n : 0);
            }, 0);
            setTotalDischargedWeight(sumDischarged);
          } else {
            setTotalSADs(null);
            setTotalDeclaredWeight(null);
            setTotalDischargedWeight(null);
          }
        } catch (e) {
          console.debug('sad declarations fetch failed', e);
          setTotalSADs(null);
          setTotalDeclaredWeight(null);
          setTotalDischargedWeight(null);
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

  // ---------- NEW: perform exact SAD search only when triggered ----------
  const performSadSearch = async (q) => {
    const qtrim = (q || '').toString().trim();
    if (!qtrim) {
      setSadResults([]);
      setSadDeclaration({ declaredWeight: null, status: 'Unknown', exists: false, total_recorded_weight: null });
      setSearchTerm('');
      return;
    }

    setSadLoading(true);
    try {
      // Fetch tickets with exact sad_no (paged)
      const ticketsData = await fetchAllPagedSupabase(
        'tickets',
        '*',
        null,
        false,
        (qb) => qb.eq('sad_no', qtrim).order('date', { ascending: false })
      );

      // Deduplicate by ticket_no keeping latest by date
      const dedupeMap = new Map();
      (ticketsData || []).forEach((t) => {
        const ticketNo = (t.ticket_no ?? t.ticketId ?? t.id ?? '').toString().trim();
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

      const mapped = deduped.map((t) => {
        const ticketNo = t.ticket_no ?? (t.ticket_id ? String(t.ticket_id) : null);
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
          date: chosenOutgate ? chosenOutgate.outgateDateTime : (t.date ?? t.submitted_at ?? t.created_at ?? null),
          outgateRef: chosenOutgate ?? null,
          truck: t.gnsw_truck_no ?? t.truck_on_wb ?? t.vehicle_number ?? null,
          gross: computed.gross,
          tare: computed.tare,
          net: computed.net,
          driver: t.driver ?? null,
          raw: t,
        };
      });

      mapped.sort((a, b) => {
        const aT = a.date ? new Date(a.date).getTime() : 0;
        const bT = b.date ? new Date(b.date).getTime() : 0;
        return bT - aT;
      });

      setSadResults(mapped);

      // Fetch the SAD declaration row for exact SAD
      try {
        const { data: sadRow, error } = await supabase
          .from('sad_declarations')
          .select('sad_no,declared_weight,status,total_recorded_weight,created_at')
          .eq('sad_no', qtrim)
          .maybeSingle();

        if (!error && sadRow) {
          setSadDeclaration({
            declaredWeight: sadRow.declared_weight != null ? Number(sadRow.declared_weight) : null,
            status: sadRow.status ?? 'Unknown',
            exists: true,
            total_recorded_weight: sadRow.total_recorded_weight ?? null,
            created_at: sadRow.created_at ?? null,
          });
        } else {
          setSadDeclaration({ declaredWeight: null, status: 'Unknown', exists: false, total_recorded_weight: null });
        }
      } catch (err) {
        console.debug('Failed to fetch SAD declaration', err);
        setSadDeclaration({ declaredWeight: null, status: 'Unknown', exists: false, total_recorded_weight: null });
      }

      setSearchTerm(qtrim);
    } catch (err) {
      console.error('SAD search failed', err);
      toast({ title: 'SAD search failed', description: String(err), status: 'error', duration: 3000 });
      setSadResults([]);
      setSadDeclaration({ declaredWeight: null, status: 'Unknown', exists: false, total_recorded_weight: null });
    } finally {
      setSadLoading(false);
    }
  };

  // derived data
  const dedupedReports = useMemo(() => dedupeReportsByTicketNo(reports), [reports]);

  const { startDateTime, endDateTime } = useMemo(() => {
    let start = null;
    let end = null;

    if (dateFrom) {
      start = makeDateTime(dateFrom, timeFrom ? `${timeFrom}:00` : '00:00:00', true);
    }

    if (dateTo) {
      end = makeDateTime(dateTo, timeTo ? `${timeTo}:00` : '23:59:59.999', false);
    }

    return { startDateTime: start, endDateTime: end };
  }, [dateFrom, dateTo, timeFrom, timeTo]);

  const filteredReports = useMemo(() => {
    const term = (searchTerm || '').trim().toLowerCase();

    return dedupedReports.filter((r) => {
      if (term) {
        // when searchTerm is set, we are showing SAD-specific results elsewhere;
        // this filter is primarily for the unique-ticket view - keep behavior unchanged
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

      if (startDateTime || endDateTime) {
        if (!r.outgateDateTime) return false;
        const d = new Date(r.outgateDateTime);
        if (Number.isNaN(d.getTime())) return false;
        if (startDateTime && d < startDateTime) return false;
        if (endDateTime && d > endDateTime) return false;
      }

      return true;
    });
  }, [dedupedReports, searchTerm, startDateTime, endDateTime]);

  const sortedReports = useMemo(() => {
    const arr = filteredReports.slice();
    arr.sort((a, b) => {
      const aT = a.outgateDateTime ? new Date(a.outgateDateTime).getTime() : 0;
      const bT = b.outgateDateTime ? new Date(b.outgateDateTime).getTime() : 0;
      return bT - aT;
    });
    return arr;
  }, [filteredReports]);

  const uniqueFilteredReports = useMemo(() => {
    const map = new Map();
    const manual = [];
    for (const r of filteredReports) {
      const tn = r.ticketNo ? String(r.ticketNo).trim() : '';
      if (tn) {
        if (!map.has(tn)) map.set(tn, r);
        else {
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

  const sadFilteredResults = useMemo(() => {
    if (!sadResults || sadResults.length === 0) return [];
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

  const sadTotalsMemo = useMemo(() => {
    if (!sadFilteredResults || sadFilteredResults.length === 0) return { transactions: 0, cumulativeNet: 0 };
    let cumulativeNet = 0;
    for (const t of sadFilteredResults) {
      const { net } = computeWeights({ gross: t.gross, tare: t.tare, net: t.net });
      cumulativeNet += (net || 0);
    }
    return { transactions: sadFilteredResults.length, cumulativeNet };
  }, [sadFilteredResults]);

  const statsSource = useMemo(() => {
    return searchTerm ? sadFilteredResults : uniqueFilteredReports;
  }, [searchTerm, sadFilteredResults, uniqueFilteredReports]);

  const statsTotals = useMemo(() => {
    let cumulativeNet = 0;
    for (const r of statsSource) {
      const w = computeWeights(r);
      cumulativeNet += (w.net || 0);
    }
    return {
      rowsCount: statsSource.length,
      cumulativeNet,
    };
  }, [statsSource]);

  const statsUniqueTickets = useMemo(() => {
    const s = new Set();
    for (const r of statsSource) {
      if (r.ticketNo) s.add(String(r.ticketNo));
    }
    return s.size;
  }, [statsSource]);

  // --- NEW: Log report generation to reports_generated table (robust) ---
  const logReportGeneration = async (reportType, fileUrl = null, sadNo = null) => {
    try {
      const mapping = {
        'Outgate CSV': 'outgate_csv',
        'Outgate PDF': 'outgate_pdf',
        'SAD CSV': 'sad_csv',
        'SAD PDF': 'sad_pdf',
      };
      const safeReportType = mapping[reportType] ?? 'other';

      const generatedBy = user?.id ?? user?.email ?? null;
      const payload = {
        report_type: safeReportType,
        generated_by: generatedBy,
        generated_at: new Date().toISOString(),
        file_url: fileUrl,
        sad_no: sadNo ?? null,
        report_name: `Outgate ${reportType} ${new Date().toISOString()}`,
      };

      const { data, error } = await supabase.from('reports_generated').insert([payload]).select().single();
      if (error) {
        try {
          const fallback = {
            report_type: 'other',
            generated_by: generatedBy,
            generated_at: new Date().toISOString(),
            file_url: fileUrl,
          };
          await supabase.from('reports_generated').insert([fallback]);
        } catch (fallbackErr) {
          // ignore
        }
        toast({ title: 'Report log failed', description: error.message || String(error), status: 'warning', duration: 4000 });
        return null;
      }
      toast({ title: 'Report logged', status: 'success', duration: 1800 });
      return data;
    } catch (err) {
      console.error('logReportGeneration', err);
      toast({ title: 'Failed to log report', description: String(err), status: 'error', duration: 4000 });
      return null;
    }
  };

  // Export current unique/filtered view as CSV and log the generation
  const handleExportCsv = async () => {
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
        'Exited By': r.exitedBy ?? r.rawRow?.edited_by ?? (r.outgateRef?.rawRow?.edited_by ?? '') ?? '',
        'Status': (r.ticketNo && ticketStatusMap[r.ticketNo]) ? ticketStatusMap[r.ticketNo] : (r.rawRow?.status ?? ''),
      };
    });
    if (!rows.length) {
      toast({ title: 'No rows to export', status: 'info', duration: 2000 });
      return;
    }
    exportToCSV(rows, 'outgate-reports.csv');
    toast({ title: `Export started (${rows.length} rows)`, status: 'success', duration: 2500 });

    // Log generation
    await logReportGeneration('Outgate CSV', null);
  };

  const handlePrintSad = async () => {
    if (!sadFilteredResults || sadFilteredResults.length === 0) {
      toast({ title: 'No SAD results', status: 'info', duration: 2000 });
      return;
    }

    const rowsHtml = sadFilteredResults.map((t) => {
      const exitedBy = t.outgateRef?.rawRow?.edited_by ?? t.outgateRef?.exitedBy ?? '';
      return `<tr>
        <td>${t.sadNo ?? ''}</td>
        <td>${t.ticketNo ?? ''}</td>
        <td>${t.date ? new Date(t.date).toLocaleString() : ''}</td>
        <td>${t.truck ?? ''}</td>
        <td style="text-align:right">${t.gross != null ? formatWeight(t.gross) : ''}</td>
        <td style="text-align:right">${t.tare != null ? formatWeight(t.tare) : ''}</td>
        <td style="text-align:right">${t.net != null ? formatWeight(t.net) : ''}</td>
        <td>${t.driver ?? ''}</td>
        <td>${exitedBy ?? ''}</td>
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
            <th>SAD</th><th>Ticket</th><th>Date & Time</th><th>Truck</th><th>Gross</th><th>Tare</th><th>Net</th><th>Driver</th><th>Exited By</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    `;

    openPrintableWindow(html, `SAD-${searchTerm}`);

    await logReportGeneration('SAD PDF', null, searchTerm);
  };

  const handleExportSadCsv = async () => {
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
      'Exited By': t.outgateRef?.rawRow?.edited_by ?? '',
    }));
    exportToCSV(rows, `SAD-${searchTerm || 'report'}.csv`);
    toast({ title: `Export started (${rows.length} rows)`, status: 'success', duration: 2500 });

    await logReportGeneration('SAD CSV', null, searchTerm);
  };

  const handleResetAll = () => {
    setSearchInput('');
    setSearchTerm('');
    setSadResults([]);
    setSadDeclaration({ declaredWeight: null, status: 'Unknown', exists: false, total_recorded_weight: null });
    setDateFrom('');
    setDateTo('');
    setTimeFrom('');
    setTimeTo('');
    setCurrentPage(1);
    toast({ title: 'Filters reset', status: 'info', duration: 1500 });
  };

  // ------------------------
  // Confetti helper (loads CDN script if needed)
  // ------------------------
  const runConfetti = async () => {
    try {
      if (typeof window.confetti === 'function') {
        window.confetti({ particleCount: 140, spread: 70, origin: { y: 0.6 } });
        return;
      }
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.5.1/dist/confetti.browser.min.js';
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
      if (typeof window.confetti === 'function') {
        window.confetti({ particleCount: 140, spread: 70, origin: { y: 0.6 } });
      }
    } catch (e) {
      console.warn('Confetti load failed', e);
    }
  };

  // ------------------------
  // Voice commands
  // ------------------------
  const startVoice = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      toast({ title: 'Voice not supported', description: 'This browser does not support SpeechRecognition', status: 'warning' });
      return;
    }
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recog = new Speech();
    recog.lang = 'en-US';
    recog.interimResults = false;
    recog.maxAlternatives = 1;

    recog.onresult = (ev) => {
      const text = (ev.results[0][0].transcript || '').toLowerCase();
      toast({ title: 'Heard', description: text, status: 'info', duration: 2500 });
      if (text.includes('export csv')) {
        handleExportCsv();
      } else if (text.includes('reset filters') || text.includes('reset')) {
        handleResetAll();
      } else if (text.includes('print sad') || text.includes('print report')) {
        handlePrintSad();
      } else if (text.includes('export sad csv')) {
        handleExportSadCsv();
      } else {
        toast({ title: 'Command not recognized', description: text, status: 'warning' });
      }
    };

    recog.onend = () => {
      setListening(false);
    };

    recog.onerror = (e) => {
      console.warn('speech error', e);
      setListening(false);
      toast({ title: 'Voice error', description: e?.error || 'Speech recognition error', status: 'error' });
    };

    recognitionRef.current = recog;
    recog.start();
    setListening(true);
    toast({ title: 'Listening', description: 'Say a command: "Export CSV", "Reset filters", "Print SAD"', status: 'info' });
  };

  const stopVoice = () => {
    try {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
    } catch (e) {
      // ignore
    }
    setListening(false);
  };

  // ------------------------
  // Orb & generate-report flow
  // ------------------------
  const handleGenerateFromOrb = async ({ type = 'Outgate CSV', includeSad = false } = {}) => {
    try {
      setOrbGenerating(true);
      await new Promise((r) => setTimeout(r, 800));
      await runConfetti();
      toast({ title: `Generated ${type}`, status: 'success' });
      await logReportGeneration(type, null, includeSad ? searchTerm : null);
    } catch (e) {
      toast({ title: 'Failed to generate', description: e?.message || String(e), status: 'error' });
    } finally {
      setOrbGenerating(false);
      onOrbClose();
    }
  };

  // View details + docs actions
  const openDetailsFor = (r) => {
    setSelectedReport(r);
    onDetailsOpen();
  };
  const openDocsFor = (r) => {
    const files = [];
    if (r.fileUrl) files.push({ name: 'attachment', url: r.fileUrl });
    if (r.rawRow && Array.isArray(r.rawRow.docs)) {
      for (const d of r.rawRow.docs) {
        if (d && (d.url || d.path)) files.push({ name: d.name || d.path || 'doc', url: d.url || d.path });
      }
    }
    setDocsForView(files);
    onDocsOpen();
  };

  // small responsive helper: show "card" UI for each report on small screens
  const ReportCard = ({ r }) => {
    const { net } = computeWeights(r);
    return (
      <MotionBox
        whileHover={{ y: -6 }}
        p={3}
        borderRadius="12px"
        border="1px solid"
        borderColor="rgba(255,255,255,0.06)"
        bg="linear-gradient(180deg, rgba(255,255,255,0.98), rgba(255,255,255,0.96))"
        boxShadow="0 10px 30px rgba(124,58,237,0.06), inset 0 -8px 18px rgba(255,255,255,0.6)"
      >
        <Flex justify="space-between" align="center">
          <Box>
            <Text fontWeight="bold">{r.ticketNo ?? r.ticketId ?? '—'}</Text>
            <Text fontSize="sm" color="gray.500">{r.vehicleNumber || 'No vehicle'}</Text>
            <Text fontSize="xs" color="gray.500">{r.sadNo ? `SAD ${r.sadNo}` : 'No SAD'}</Text>
          </Box>
          <VStack align="end">
            <Text fontSize="sm">{r.outgateDateTime ? new Date(r.outgateDateTime).toLocaleString() : '—'}</Text>
            <HStack>
              <Button size="sm" onClick={() => openDetailsFor(r)}>View</Button>
              <Menu>
                <MenuButton as={IconButton} icon={<FaEllipsisV />} size="sm" />
                <MenuList>
                  <MenuItem icon={<FaEye />} onClick={() => openDetailsFor(r)}>View Details</MenuItem>
                  <MenuItem icon={<FaFileAlt />} onClick={() => openDocsFor(r)}>View Docs</MenuItem>
                </MenuList>
              </Menu>
            </HStack>
          </VStack>
        </Flex>

        <Divider my={2} />

        <Flex justify="space-between" fontSize="sm">
          <Box>
            <Text fontSize="xs" color="gray.500">Truck</Text>
            <Text>{r.vehicleNumber || r.truck || '—'}</Text>
          </Box>
          <Box textAlign="right">
            <Text fontSize="xs" color="gray.500">Net</Text>
            <Text fontWeight="bold">{net != null ? formatWeight(net) : '—'}</Text>
          </Box>
        </Flex>
      </MotionBox>
    );
  };

  // Pagination display helpers
  const totalPages = Math.max(1, Math.ceil(uniqueFilteredReports.length / itemsPerPage));
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalPages]);

  const pageStart = (currentPage - 1) * itemsPerPage;
  const pageEnd = pageStart + itemsPerPage;
  const pagedUniqueReports = uniqueFilteredReports.slice(pageStart, pageEnd);

  // --- neutral top stat card styles (avoid blue/red/green)
  const statCardStyle = {
    borderRadius: 12,
    p: 4,
    boxShadow: '0 8px 30px rgba(99,102,241,0.06), inset 0 -6px 18px rgba(255,255,255,0.06)',
    color: '#041124',
  };

  // changed to warm / neutral palettes (no blue/red/green)
  const topCards = {
    a: { bg: 'linear-gradient(135deg,#fffaf0 0%, #fff3d9 100%)', border: '1px solid rgba(160,120,40,0.06)' }, // warm cream
    b: { bg: 'linear-gradient(135deg,#fff8f2 0%, #fff0e0 100%)', border: '1px solid rgba(200,120,80,0.06)' }, // soft peach
    c: { bg: 'linear-gradient(135deg,#fff9f4 0%, #fff3e8 100%)', border: '1px solid rgba(180,120,60,0.06)' }, // soft sand
    d: { bg: 'linear-gradient(135deg,#fbf7ff 0%, #f7efff 100%)', border: '1px solid rgba(140,90,180,0.06)' }, // subtle lilac (not vivid blue/green/red)
  };

  // ---------------------------------------
  // DISCREPANCY: compute colors and text
  // ---------------------------------------
  const declared = sadDeclaration?.declaredWeight ?? null;
  const discharged = sadTotalsMemo?.cumulativeNet ?? 0;

  let discrepancyBg = 'white';
  let discrepancyBorder = '1px solid rgba(2,6,23,0.04)';
  let discrepancyLabelColor = '#041124';
  let discrepancyHelp = 'Discharged − Declared';
  let discrepancyDisplay = '—';

  if (declared === null || declared === undefined) {
    discrepancyBg = 'white';
    discrepancyBorder = '1px solid rgba(2,6,23,0.04)';
    discrepancyLabelColor = 'gray.600';
    discrepancyDisplay = 'No declaration';
    discrepancyHelp = 'No declared weight to compare';
  } else {
    const diff = Number(discharged || 0) - Number(declared || 0);
    const sign = diff > 0 ? '+' : (diff < 0 ? '-' : '');
    discrepancyDisplay = `${sign}${formatWeight(Math.abs(diff))} kg`;

    if (diff > 0) {
      // discharged > declared -> red
      discrepancyBg = 'linear-gradient(135deg,#fff1f2 0%, #fecaca 100%)';
      discrepancyBorder = '1px solid rgba(220,38,38,0.08)';
      discrepancyLabelColor = '#9f1239';
      discrepancyHelp = 'Discharged is higher than declared';
    } else if (diff < 0) {
      // discharged < declared -> blue
      discrepancyBg = 'linear-gradient(135deg,#eff6ff 0%, #dbeafe 100%)';
      discrepancyBorder = '1px solid rgba(59,130,246,0.08)';
      discrepancyLabelColor = '#1e3a8a';
      discrepancyHelp = 'Discharged is lower than declared';
    } else {
      // equal -> green
      discrepancyBg = 'linear-gradient(135deg,#ecfdf5 0%, #d1fae5 100%)';
      discrepancyBorder = '1px solid rgba(16,185,129,0.08)';
      discrepancyLabelColor = '#065f46';
      discrepancyHelp = 'Discharged equals declared';
    }
  }

  // -------------------------
  // Render
  // -------------------------
  return (
    <Box p={{ base: 4, md: 8 }} style={{ fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial' }}>
      {/* Header */}
      <Flex justify="space-between" align="center" mb={6} gap={4} flexWrap="wrap">
        <Stack spacing={1}>
          <Text fontSize="2xl" fontWeight="bold" color="#071126">Outgate Reports</Text>
          <Text color="gray.500">Unique-ticket view — polished UI.</Text>
        </Stack>

        <HStack spacing={2}>
          <Tooltip label="Toggle voice commands">
            <Button size="sm" variant={listening ? 'solid' : 'outline'} colorScheme={listening ? 'purple' : 'gray'} onClick={() => (listening ? stopVoice() : startVoice())}>
              {listening ? 'Listening...' : 'Voice'}
            </Button>
          </Tooltip>

          <Tooltip label="Generate quick report">
            <Button size="sm" leftIcon={<DownloadIcon />} colorScheme="teal" onClick={handleExportCsv}>Export CSV</Button>
          </Tooltip>

          <Button leftIcon={<RepeatIcon />} variant="outline" onClick={handleResetAll} aria-label="Reset filters">
            Reset
          </Button>
        </HStack>
      </Flex>

      {/* Stats — top cards use neutral/warm palette (avoid blue/red/green) */}
      <SimpleGrid columns={{ base: 1, md: 4 }} spacing={4} mb={6}>
        <Stat borderRadius="md" p={4} className="panel-3d" sx={{ background: topCards.a.bg, color: '#041124', border: topCards.a.border }}>
          <StatLabel>Total SADs</StatLabel>
          <StatNumber>{totalSADs != null ? totalSADs : '—'}</StatNumber>
          <StatHelpText>Total registered SAD declarations</StatHelpText>
        </Stat>

        <Stat borderRadius="md" p={4} className="panel-3d" sx={{ background: topCards.b.bg, color: '#041124', border: topCards.b.border }}>
          <StatLabel>Confirmed Exits</StatLabel>
          <StatNumber>{exitedCount}</StatNumber>
          <StatHelpText>Total Exited Trucks</StatHelpText>
        </Stat>

        <Stat borderRadius="md" p={4} className="panel-3d" sx={{ background: topCards.c.bg, color: '#041124', border: topCards.c.border }}>
          <StatLabel>Total Declared Weight</StatLabel>
          <StatNumber>{totalDeclaredWeight != null ? `${formatWeight(totalDeclaredWeight)} kg` : '—'}</StatNumber>
          <StatHelpText>Sum of all declared weights</StatHelpText>
        </Stat>

        <Stat borderRadius="md" p={4} className="panel-3d" sx={{ background: topCards.d.bg, color: '#041124', border: topCards.d.border }}>
          <StatLabel>Total Discharged Weight</StatLabel>
          <StatNumber>{totalDischargedWeight != null ? `${formatWeight(totalDischargedWeight)} kg` : '—'}</StatNumber>
          <StatHelpText>Sum of all discharged (Nets)</StatHelpText>
        </Stat>
      </SimpleGrid>

      {/* SAD mini-stats when searching */}
      { (searchTerm && (sadResults.length > 0 || sadDeclaration.exists)) && (
        <SimpleGrid columns={{ base: 1, md: 4 }} spacing={3} mb={6}>
          <Stat sx={{ p: 4, borderRadius: 12, boxShadow: '0 6px 20px rgba(0,0,0,0.03)', bg: 'white', border: '1px solid rgba(2,6,23,0.04)' }}>
            <StatLabel>Declared Weight</StatLabel>
            <StatNumber>{declared !== null ? `${formatWeight(declared)} kg` : '—'}</StatNumber>
            <StatHelpText>{sadDeclaration.exists ? 'From SAD declaration' : 'No declaration found'}</StatHelpText>
          </Stat>

          <Stat sx={{ p: 4, borderRadius: 12, boxShadow: '0 6px 20px rgba(0,0,0,0.03)', bg: 'white', border: '1px solid rgba(2,6,23,0.04)' }}>
            <StatLabel>Discharged Weight</StatLabel>
            <StatNumber>{`${formatWeight(sadTotalsMemo.cumulativeNet)} kg`}</StatNumber>
            <StatHelpText>Sum of Nets from all transactions</StatHelpText>
          </Stat>

          <Stat sx={{ p: 4, borderRadius: 12, boxShadow: '0 6px 20px rgba(0,0,0,0.03)', bg: 'white', border: '1px solid rgba(2,6,23,0.04)' }}>
            <StatLabel>SAD Status</StatLabel>
            <StatNumber>{sadDeclaration.status || (sadResults.length ? 'In Progress' : 'Unknown')}</StatNumber>
            <StatHelpText>{sadDeclaration.exists ? 'Declaration row found' : (sadResults.length ? 'No declaration - tickets found' : 'No data')}</StatHelpText>
          </Stat>

          {/* Discrepancy stat card */}
          <Stat sx={{ p: 4, borderRadius: 12, boxShadow: '0 6px 20px rgba(0,0,0,0.03)', bg: discrepancyBg, border: discrepancyBorder }}>
            <StatLabel>
              <Text color={discrepancyLabelColor}>Discrepancy</Text>
            </StatLabel>
            <StatNumber>
              <Text as="span" fontWeight="bold" color={discrepancyLabelColor}>
                {discrepancyDisplay}
              </Text>
            </StatNumber>
            <StatHelpText color={discrepancyLabelColor}>{discrepancyHelp}</StatHelpText>
          </Stat>
        </SimpleGrid>
      )}

      {/* Controls */}
      <Box bg="white" p={4} borderRadius="md" boxShadow="sm" mb={6}>
        <SimpleGrid columns={{ base: 1, md: 4 }} spacing={3}>
          <Box>
            <FormLabel>Search</FormLabel>
            <Flex>
              <Input
                placeholder="Search here (type exact SAD number, then click search)"
                value={searchInput}
                onChange={(e) => { setSearchInput(e.target.value); }}
              />
              <IconButton
                aria-label="Search"
                icon={<SearchIcon />}
                ml={2}
                onClick={() => performSadSearch(searchInput)}
                title="Search SAD (exact)"
              />
            </Flex>
            <Text fontSize="xs" color="gray.500" mt={1}>Tip: type an exact SAD number then click the search icon.</Text>
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

      {/* SAD results (if any) */}
      {sadLoading ? (
        <Flex justify="center" mb={4}><Spinner /></Flex>
      ) : (sadFilteredResults && sadFilteredResults.length > 0) ? (
        <Box bg="white" p={4} borderRadius="md" boxShadow="sm" mb={6}>
          <Flex align="center" justify="space-between" mb={3} gap={3} wrap="wrap">
            <Box>
              <Text fontWeight="semibold">SAD Search: <Text as="span" fontWeight="bold">{searchTerm}</Text></Text>
              <Text fontSize="sm" color="gray.600"></Text>
            </Box>

            <HStack spacing={4}>
              <Box textAlign="right">
                <Text fontSize="sm" color="gray.500">No. of Transacts</Text>
                <Text fontWeight="bold">{sadTotalsMemo.transactions}</Text>
              </Box>
              <Box textAlign="right">
                <Text fontSize="sm" color="gray.500">Total Discharged</Text>
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

      {/* Unique-ticket view */}
      <Box bg="white" p={4} borderRadius="md" boxShadow="sm" mb={6}>
        <Flex justify="space-between" align="center" mb={3} wrap="wrap">
          <Text fontWeight="semibold">Unique-ticket view</Text>
          <HStack>
            <Text fontSize="sm" color="gray.500">Showing {uniqueFilteredReports.length} items</Text>
            <Button size="sm" onClick={handleExportCsv}>Export CSV</Button>
          </HStack>
        </Flex>

        {loading ? (
          <Flex justify="center" p={8}><Spinner /></Flex>
        ) : (
          <>
            {/* responsive cards for small screens */}
            <Box display={{ base: 'block', md: 'none' }}>
              <Stack spacing={3}>
                {uniqueFilteredReports.map((r) => (
                  <ReportCard key={r.ticketNo ?? r.id ?? Math.random()} r={r} />
                ))}
              </Stack>
            </Box>

            {/* table for md+ */}
            <Box display={{ base: 'none', md: 'block' }} overflowX="auto">
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
                    <Th>Actions</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {pagedUniqueReports.map((r) => {
                    const { gross, tare, net } = computeWeights(r);
                    return (
                      <Tr key={r.ticketNo ?? r.id ?? Math.random()}>
                        <Td>{r.ticketNo ?? '—'}</Td>
                        <Td>{r.outgateDateTime ? new Date(r.outgateDateTime).toLocaleString() : '—'}</Td>
                        <Td>{r.vehicleNumber ?? r.truck ?? '—'}</Td>
                        <Td isNumeric>{gross != null ? formatWeight(gross) : '—'}</Td>
                        <Td isNumeric>{tare != null ? formatWeight(tare) : '—'}</Td>
                        <Td isNumeric>{net != null ? formatWeight(net) : '—'}</Td>
                        <Td>{r.driverName ?? '—'}</Td>
                        <Td>
                          <HStack>
                            <Button size="sm" onClick={() => openDetailsFor(r)}>View Details</Button>
                            <Menu>
                              <MenuButton as={IconButton} icon={<FaEllipsisV />} size="sm" />
                              <MenuList>
                                <MenuItem icon={<FaEye />} onClick={() => openDetailsFor(r)}>View Details</MenuItem>
                                <MenuItem icon={<FaFileAlt />} onClick={() => openDocsFor(r)}>View Docs</MenuItem>
                              </MenuList>
                            </Menu>
                          </HStack>
                        </Td>
                      </Tr>
                    );
                  })}
                </Tbody>
              </Table>

              {/* pagination */}
              <Flex justify="center" align="center" mt={4} gap={3}>
                <Button size="sm" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} isDisabled={currentPage === 1}>Prev</Button>
                <Text fontSize="sm">Page {currentPage} of {totalPages}</Text>
                <Button size="sm" onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} isDisabled={currentPage === totalPages}>Next</Button>
              </Flex>
            </Box>
          </>
        )}
      </Box>

      {/* Details modal */}
      <Modal isOpen={isDetailsOpen} onClose={() => { onDetailsClose(); setSelectedReport(null); }} size="4xl" scrollBehavior="inside">
        <ModalOverlay />
        <ModalContent>
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
                    <Text>{selectedReport.driverName ?? selectedReport.driver ?? '—'}</Text>
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

                <Divider />

                <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
                  <Box>
                    <Text fontWeight="semibold">Exited By</Text>
                    <Text>
                      {selectedReport.exitedBy
                        ?? selectedReport.outgateRef?.rawRow?.edited_by
                        ?? selectedReport.rawRow?.edited_by
                        ?? '—'}
                    </Text>
                  </Box>

                  <Box>
                    <Text fontWeight="semibold">Exit Time</Text>
                    <Text>{selectedReport.outgateDateTime ? new Date(selectedReport.outgateDateTime).toLocaleString() : '—'}</Text>
                  </Box>
                </SimpleGrid>

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
            <Button onClick={() => { onDetailsClose(); setSelectedReport(null); }}>Close</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Docs modal */}
      <Modal isOpen={isDocsOpen} onClose={() => { onDocsClose(); setDocsForView([]); }} size="lg" scrollBehavior="inside">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Documents</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {(!docsForView || !docsForView.length) ? (
              <Text color="gray.500">No documents attached</Text>
            ) : (
              <Stack spacing={3}>
                {docsForView.map((d, i) => (
                  <Box key={i} p={2} border="1px solid" borderColor="gray.100" borderRadius="md">
                    <Flex justify="space-between" align="center">
                      <Box>
                        <Text fontWeight="semibold">{d.name || `Doc ${i+1}`}</Text>
                        <Text fontSize="sm" color="gray.600">{d.url}</Text>
                      </Box>
                      <HStack>
                        <Button size="sm" onClick={() => window.open(d.url, '_blank')}>Open</Button>
                        <Button size="sm" variant="ghost" onClick={() => {
                          const a = document.createElement('a');
                          a.href = d.url;
                          a.download = d.name || '';
                          document.body.appendChild(a);
                          a.click();
                          a.remove();
                        }}>Download</Button>
                      </HStack>
                    </Flex>
                  </Box>
                ))}
              </Stack>
            )}
          </ModalBody>
          <ModalFooter>
            <Button onClick={() => { onDocsClose(); setDocsForView([]); }}>Close</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Floating crystal orb CTA */}
      <Box position="fixed" bottom="28px" right="28px" zIndex={2200} display="flex" alignItems="center" gap={3}>
        <MotionBox
          onClick={onOrbOpen}
          whileHover={{ scale: 1.07 }}
          whileTap={{ scale: 0.95 }}
          cursor="pointer"
          width="64px"
          height="64px"
          borderRadius="999px"
          display="flex"
          alignItems="center"
          justifyContent="center"
          boxShadow="0 10px 30px rgba(59,130,246,0.18)"
          style={{ background: 'linear-gradient(90deg,#7b61ff,#3ef4d0)', color: '#fff', transformOrigin: 'center' }}
          title="Quick generate"
          animate={{ y: [0, -6, 0] }}
          transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
        >
          <Box fontSize="24px" fontWeight="700">✺</Box>
        </MotionBox>
      </Box>

      {/* Orb holographic modal */}
      <Modal isOpen={isOrbOpen} onClose={onOrbClose} isCentered>
        <ModalOverlay />
        <ModalContent bg="transparent" boxShadow="none">
          <AnimatePresence>
            <MotionBox
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 40 }}
              borderRadius="xl"
              overflow="hidden"
              style={{
                background: 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
                border: '1px solid rgba(255,255,255,0.06)',
                backdropFilter: 'blur(8px)',
                padding: 18,
                width: 640,
                maxWidth: '94vw',
              }}
            >
              <MotionBox mb={3} initial={{ rotateY: 0 }} animate={{ rotateY: 4 }} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <Box width="72px" height="72px" borderRadius="12px" bg="#0ea5a0" display="flex" alignItems="center" justifyContent="center" color="#fff">
                  <img src={logoUrl} alt="logo" style={{ width: 48 }} />
                </Box>
                <Box>
                  <Text fontSize="lg" fontWeight="bold">Generate Quick Outgate Report</Text>
                  <Text fontSize="sm" color="gray.300">Create/export & log a quick summary — confetti included.</Text>
                </Box>
              </MotionBox>

              <Divider />

              <Box mt={3}>
                <FormLabel>Report type</FormLabel>
                <Select defaultValue="Outgate CSV" id="orb-report-type">
                  <option>Outgate CSV</option>
                  <option>Outgate PDF</option>
                  <option>SAD CSV</option>
                  <option>SAD PDF</option>
                </Select>

                <FormLabel mt={3}>Include current SAD search (if any)?</FormLabel>
                <Select id="orb-include-sad" defaultValue="no">
                  <option value="no">No</option>
                  <option value="yes">Yes (use search term)</option>
                </Select>
              </Box>

              <Flex mt={4} justify="flex-end" gap={2}>
                <Button variant="ghost" onClick={onOrbClose}>Cancel</Button>
                <Button
                  colorScheme="purple"
                  onClick={() => {
                    const type = (document.getElementById('orb-report-type')?.value) || 'Outgate CSV';
                    const includeSadVal = (document.getElementById('orb-include-sad')?.value) || 'no';
                    handleGenerateFromOrb({ type, includeSad: includeSadVal === 'yes' });
                  }}
                  isLoading={orbGenerating}
                >
                  Generate
                </Button>
              </Flex>
            </MotionBox>
          </AnimatePresence>
        </ModalContent>
      </Modal>
    </Box>
  );
}
