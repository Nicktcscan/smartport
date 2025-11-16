// src/pages/WeightReports.jsx
/* eslint-disable no-unused-vars */
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
   Robust date parsing helpers
----------------------- */

/**
 * parseTicketDate accepts:
 * - Date objects
 * - epoch numbers
 * - "YYYY-MM-DD", "YYYY-MM-DD HH:MM:SS(.mmm)"
 * - "DD/MM/YYYY" and "DD/MM/YYYY HH:MM[:SS]"
 * - ISO strings
 */
function parseTicketDate(raw) {
  if (!raw && raw !== 0) return null;
  if (raw instanceof Date) {
    return isNaN(raw.getTime()) ? null : raw;
  }
  // numbers / epoch
  if (typeof raw === 'number') {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }
  let s = String(raw).trim();
  if (!s) return null;

  // normalize common separators
  // handle "YYYY-MM-DD HH:MM:SS(.mmm)" -> safe ISO
  const ymdHms = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
  if (ymdHms.test(s)) {
    const iso = s.replace(' ', 'T');
    const d = new Date(iso);
    if (!isNaN(d.getTime())) return d;
  }

  // handle "YYYY-MM-DD" (date only)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T00:00:00`);
    if (!isNaN(d.getTime())) return d;
  }

  // handle "DD/MM/YYYY" or "D/M/YY" with optional time
  const dmRegex = /^(\d{1,2})[/-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?)?$/;
  const m = s.match(dmRegex);
  if (m) {
    let day = parseInt(m[1], 10);
    let month = parseInt(m[2], 10);
    let year = parseInt(m[3], 10);
    let hh = m[4] ? parseInt(m[4], 10) : 0;
    let mm = m[5] ? parseInt(m[5], 10) : 0;
    let ss = m[6] ? parseInt(m[6], 10) : 0;
    let ms = m[7] ? Number((m[7] + '000').slice(0, 3)) : 0;
    if (year < 100) year += 2000;
    const d = new Date(year, month - 1, day, hh, mm, ss, ms);
    if (!isNaN(d.getTime())) return d;
  }

  // last resort: Date constructor (ISO or other)
  let d0 = new Date(s);
  if (!isNaN(d0.getTime())) return d0;

  // numeric string epoch?
  const maybeNum = Number(s);
  if (!Number.isNaN(maybeNum)) {
    const d1 = new Date(maybeNum);
    if (!isNaN(d1.getTime())) return d1;
  }

  return null;
}

/**
 * makeDateTime(dateStr, timeStr, defaultTimeIsStart)
 * dateStr can be "DD/MM/YYYY" or "YYYY-MM-DD" (or Date-like string)
 * timeStr: "HH:MM" or "HH:MM:SS"
 *
 * Returns a local Date object.
 */
function makeDateTime(dateStr, timeStr, defaultTimeIsStart = true) {
  if (!dateStr) return null;

  // If dateStr is already an ISO or parseable date, parse it first
  const parsedDate = parseTicketDate(dateStr);
  if (!parsedDate) return null;

  const Y = parsedDate.getFullYear();
  const M = parsedDate.getMonth();
  const D = parsedDate.getDate();

  let hh = defaultTimeIsStart ? 0 : 23;
  let mm = defaultTimeIsStart ? 0 : 59;
  let ss = defaultTimeIsStart ? 0 : 59;
  let ms = defaultTimeIsStart ? 0 : 999;

  if (timeStr && String(timeStr).trim()) {
    const parts = String(timeStr).split(':');
    hh = Number(parts[0] || 0);
    mm = Number(parts[1] || 0);
    ss = Number(parts[2] || 0);
    if (!Number.isFinite(hh)) hh = defaultTimeIsStart ? 0 : 23;
    if (!Number.isFinite(mm)) mm = defaultTimeIsStart ? 0 : 59;
    if (!Number.isFinite(ss)) ss = defaultTimeIsStart ? 0 : 59;
    ms = defaultTimeIsStart ? 0 : 999;
  }

  return new Date(Y, M, D, hh, mm, ss, ms);
}

/* -----------------------
   Main component
----------------------- */
export default function WeightReports() {
  const { user } = useAuth();
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

  // details modal & docs modal
  const { isOpen: isDetailsOpen, onOpen: onDetailsOpen, onClose: onDetailsClose } = useDisclosure();
  const { isOpen: isDocsOpen, onOpen: onDocsOpen, onClose: onDocsClose } = useDisclosure();
  const [selectedReport, setSelectedReport] = useState(null);
  const [docsForView, setDocsForView] = useState([]);

  // SAD search results
  const [sadResults, setSadResults] = useState([]);
  const [sadLoading, setSadLoading] = useState(false);
  const sadDebounceRef = useRef(null);

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

  // helper: convert date + time to Date - kept as wrapper but uses robust makeDateTime above
  // (Time From -> Date From; Time To -> Date To)
  useEffect(() => {
    // nothing here — leave compute in memo below
  }, []);

  useEffect(() => {
    let mounted = true;

    const fetchReportsAndTickets = async () => {
      try {
        setLoading(true);

        // fetch outgate reports (all rows)
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
            exitedBy: og.edited_by ?? og.editedBy ?? null,
            rawRow: og,
          };
        });

        if (!mounted) return;
        setReports(mapped);

        // Confirmed Exits = total rows in outgate
        setExitedCount(Array.isArray(outData) ? outData.length : mapped.length);

        // --- fetch ticket statuses for summary & compute totalTransactions via map
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

        // --- fetch all sad_declarations and compute total count + total declared weight + total recorded (discharged) weight
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

  // Debounced SAD search - auto search after user stops typing (600ms)
  useEffect(() => {
    if (sadDebounceRef.current) clearTimeout(sadDebounceRef.current);
    const q = (searchTerm || '').trim();
    if (!q) {
      setSadResults([]);
      setSadDeclaration({ declaredWeight: null, status: 'Unknown', exists: false, total_recorded_weight: null });
      return;
    }

    sadDebounceRef.current = setTimeout(async () => {
      setSadLoading(true);
      try {
        const { data: ticketsData, error } = await supabase
          .from('tickets')
          .select('*')
          .ilike('sad_no', `%${q}%`)
          .order('date', { ascending: false });

        if (error) {
          console.warn('SAD lookup error', error);
          setSadResults([]);
          setSadLoading(false);
          // still try to fetch declaration
          try {
            const { data: sadRow, error: sadErr } = await supabase
              .from('sad_declarations')
              .select('sad_no,declared_weight,status,total_recorded_weight,created_at')
              .ilike('sad_no', `${q}`)
              .maybeSingle();
            if (!sadErr && sadRow) {
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
          } catch (e) {
            setSadDeclaration({ declaredWeight: null, status: 'Unknown', exists: false, total_recorded_weight: null });
          }
          return;
        }

        // Deduplicate tickets by ticket_no keeping latest by date/submitted_at/created_at
        const dedupeMap = new Map();
        (ticketsData || []).forEach((t) => {
          const ticketNo = (t.ticket_no ?? t.ticketNo ?? t.ticket_id ?? '').toString().trim();
          if (!ticketNo) return;
          const thisDate = parseTicketDate(t.date ?? t.submitted_at ?? t.created_at ?? 0);
          const thisTime = thisDate ? thisDate.getTime() : 0;
          const existing = dedupeMap.get(ticketNo);
          if (!existing) dedupeMap.set(ticketNo, t);
          else {
            const existingDate = parseTicketDate(existing.date ?? existing.submitted_at ?? existing.created_at ?? 0);
            const existingTime = existingDate ? existingDate.getTime() : 0;
            if (thisTime >= existingTime) dedupeMap.set(ticketNo, t);
          }
        });

        const deduped = Array.from(dedupeMap.values());

        // Map each ticket to structure and prefer outgate timestamp if exists (matching reports array)
        const mapped = deduped.map((t) => {
          const ticketNo = t.ticket_no ?? t.ticketNo ?? (t.ticket_id ? String(t.ticket_id) : null);
          // find outgate row for this ticketNo
          const matchingOutgates = reports.filter((r) => r.ticketNo && String(r.ticketNo) === String(ticketNo));
          let chosenOutgate = null;
          if (matchingOutgates.length > 0) {
            chosenOutgate = matchingOutgates.reduce((best, cur) => {
              const bestT = parseTicketDate(best?.outgateDateTime)?.getTime() ?? 0;
              const curT = parseTicketDate(cur?.outgateDateTime)?.getTime() ?? 0;
              return curT >= bestT ? cur : best;
            }, matchingOutgates[0]);
          }

          const computed = computeWeights({
            gross: t.gross,
            tare: t.tare,
            net: t.net,
          });

          // choose display date preference: chosenOutgate.outgateDateTime else t.date/submitted_at/created_at
          let displayDate = null;
          if (chosenOutgate && chosenOutgate.outgateDateTime) displayDate = chosenOutgate.outgateDateTime;
          else displayDate = t.date ?? t.submitted_at ?? t.created_at ?? null;

          return {
            ticketId: t.ticket_id ?? t.id ?? ticketNo ?? `${Math.random()}`,
            ticketNo,
            sadNo: t.sad_no ?? t.sadNo ?? null,
            date: displayDate,
            outgateRef: chosenOutgate ?? null,
            truck: t.gnsw_truck_no ?? t.truck_on_wb ?? t.vehicle_number ?? null,
            gross: computed.gross,
            tare: computed.tare,
            net: computed.net,
            driver: t.driver ?? null,
            raw: t,
          };
        });

        // Sort newest first using parsed date heuristics
        mapped.sort((a, b) => {
          const aT = parseTicketDate(a.date)?.getTime() ?? 0;
          const bT = parseTicketDate(b.date)?.getTime() ?? 0;
          return bT - aT;
        });

        setSadResults(mapped);

        // Fetch SAD declaration metadata (if any)
        try {
          const { data: sadRow, error: sadErr } = await supabase
            .from('sad_declarations')
            .select('sad_no,declared_weight,status,total_recorded_weight,created_at')
            .ilike('sad_no', `${q}`)
            .maybeSingle();
          if (!sadErr && sadRow) {
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
        } catch (e) {
          setSadDeclaration({ declaredWeight: null, status: 'Unknown', exists: false, total_recorded_weight: null });
        }
      } catch (err) {
        console.error('SAD search failed', err);
        setSadResults([]);
        setSadDeclaration({ declaredWeight: null, status: 'Unknown', exists: false, total_recorded_weight: null });
      } finally {
        setSadLoading(false);
      }
    }, 600);

    return () => {
      if (sadDebounceRef.current) clearTimeout(sadDebounceRef.current);
    };
  }, [searchTerm, reports]);

  const dedupedReports = useMemo(() => dedupeReportsByTicketNo(reports), [reports]);

  // Build start/end Date objects (Time From -> Date From; Time To -> Date To)
  const { startDateTime, endDateTime } = useMemo(() => {
    let start = null;
    let end = null;

    if (dateFrom) {
      start = makeDateTime(dateFrom, timeFrom ? `${timeFrom}` : '00:00:00', true);
    }

    if (dateTo) {
      end = makeDateTime(dateTo, timeTo ? `${timeTo}` : '23:59:59.999', false);
    }

    return { startDateTime: start, endDateTime: end };
  }, [dateFrom, dateTo, timeFrom, timeTo]);

  // Helper: check any candidate date fields for a row/ticket and return first that parses
  function getFirstCandidateDate(obj, keys = []) {
    for (const k of keys) {
      const v = obj?.[k];
      const p = parseTicketDate(v);
      if (p) return p;
    }
    return null;
  }

  // Filtered reports: when date range is provided, check multiple candidate fields (outgateDateTime, rawRow.date, rawRow.submitted_at, rawRow.created_at)
  const filteredReports = useMemo(() => {
    const term = (searchTerm || '').trim().toLowerCase();
    const s = startDateTime;
    const e = endDateTime;

    let results = dedupedReports.filter((r) => {
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

      if (s || e) {
        // try candidate timestamps (priority: outgateDateTime, rawRow.date, rawRow.submitted_at, rawRow.created_at)
        const candidates = [
          r.outgateDateTime,
          r.rawRow?.date,
          r.rawRow?.submitted_at,
          r.rawRow?.created_at,
          r.rawRow?.outgate_at,
        ];
        let matched = false;
        for (const c of candidates) {
          const parsed = parseTicketDate(c);
          if (!parsed) continue;
          if (s && parsed < s) continue;
          if (e && parsed > e) continue;
          matched = true;
          break;
        }
        return matched;
      }

      return true;
    });

    // If the caller searched (term present) and results are empty, try looser fallback: ignore outgateDateTime preference and check other timestamps more permissively
    if ((startDateTime || endDateTime) && results.length === 0) {
      // fallback: include rows where submitted_at or created_at falls in range
      results = dedupedReports.filter((r) => {
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
        const fallbackCandidates = [r.rawRow?.submitted_at, r.rawRow?.created_at, r.rawRow?.date];
        for (const c of fallbackCandidates) {
          const parsed = parseTicketDate(c);
          if (!parsed) continue;
          if (startDateTime && parsed < startDateTime) continue;
          if (endDateTime && parsed > endDateTime) continue;
          return true;
        }
        return false;
      });
    }

    return results;
  }, [dedupedReports, searchTerm, startDateTime, endDateTime]);

  const sortedReports = useMemo(() => {
    const arr = filteredReports.slice();
    arr.sort((a, b) => {
      const aT = parseTicketDate(a.outgateDateTime)?.getTime() ?? 0;
      const bT = parseTicketDate(b.outgateDateTime)?.getTime() ?? 0;
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
          const a = parseTicketDate(existing.outgateDateTime)?.getTime() ?? 0;
          const b = parseTicketDate(r.outgateDateTime)?.getTime() ?? 0;
          if (b > a) map.set(tn, r);
        }
      } else {
        manual.push(r);
      }
    }
    return [...map.values(), ...manual];
  }, [filteredReports]);

  // SAD filtered results similarly check multiple candidate fields and fallback
  const sadFilteredResults = useMemo(() => {
    if (!sadResults || sadResults.length === 0) return [];
    const s = startDateTime;
    const e = endDateTime;

    let filtered = sadResults.filter((t) => {
      // for each ticket's date, consider several candidates
      const candidates = [
        t.date,
        t.raw?.date,
        t.raw?.submitted_at,
        t.raw?.created_at,
        t.outgateRef?.outgateDateTime,
        t.outgateRef?.rawRow?.created_at,
      ];
      for (const c of candidates) {
        const parsed = parseTicketDate(c);
        if (!parsed) continue;
        if (s && parsed < s) continue;
        if (e && parsed > e) continue;
        return true;
      }
      return false;
    });

    // fallback: if date filtering returned zero, be tolerant and try other fields
    if ((s || e) && filtered.length === 0) {
      filtered = sadResults.filter((t) => {
        const fallbackCandidates = [
          t.raw?.submitted_at,
          t.raw?.created_at,
          t.raw?.date,
        ];
        for (const c of fallbackCandidates) {
          const parsed = parseTicketDate(c);
          if (!parsed) continue;
          if (s && parsed < s) continue;
          if (e && parsed > e) continue;
          return true;
        }
        return false;
      });
    }

    // Normalize date field for display (choose first candidate that fits or any parsed date)
    const normalized = filtered.map((t) => {
      const candidates = [
        t.date,
        t.raw?.date,
        t.raw?.submitted_at,
        t.raw?.created_at,
        t.outgateRef?.outgateDateTime,
        t.outgateRef?.rawRow?.created_at,
      ];
      let chosen = null;
      for (const c of candidates) {
        const parsed = parseTicketDate(c);
        if (parsed) {
          chosen = c;
          break;
        }
      }
      return { ...t, date: chosen ?? t.date };
    });

    return normalized;
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
    setSearchTerm('');
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
  // Voice commands (unchanged)
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

  // --- vivid stat card styles (reusable)
  const statCardStyle = {
    borderRadius: 12,
    p: 4,
    boxShadow: '0 8px 30px rgba(99,102,241,0.12), inset 0 -6px 18px rgba(255,255,255,0.18)',
    color: '#041124',
  };

  const vividCards = {
    a: { bg: 'linear-gradient(135deg,#fff7ed 0%, #ffe0b2 100%)', border: '1px solid rgba(255,165,64,0.12)' },
    b: { bg: 'linear-gradient(135deg,#ecfeff 0%, #c7fff6 100%)', border: '1px solid rgba(16,185,129,0.08)' },
    c: { bg: 'linear-gradient(135deg,#f0fdf4 0%, #b9f6d0 100%)', border: '1px solid rgba(34,197,94,0.06)' },
    d: { bg: 'linear-gradient(135deg,#f5f3ff 0%, #dbeafe 100%)', border: '1px solid rgba(124,58,237,0.08)' },
  };

  // Render UI (kept similar to your sample, minimal changes)
  return (
    <Box p={4}>
      <Box mb={4}>
        <Text fontSize="xl" fontWeight="bold">Weight Reports</Text>
        <Text color="gray.600">Unique-ticket view — polished UI.</Text>
      </Box>

      <Box mb={4}>
        <SimpleGrid columns={{ base: 1, md: 4 }} spacing={3}>
          <Input placeholder="SAD Search" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          <Box>
            <FormLabel>Date From</FormLabel>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </Box>
          <Box>
            <FormLabel>Date To</FormLabel>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </Box>
          <Box>
            <FormLabel>Time From</FormLabel>
            <Input type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} />
          </Box>
          <Box>
            <FormLabel>Time To</FormLabel>
            <Input type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} />
          </Box>
        </SimpleGrid>

        <Flex mt={3} gap={2}>
          <Button colorScheme="teal" onClick={() => { /* manual generate can just set searchTerm to trigger effect above */ }}>Search</Button>
          <Button onClick={handleResetAll}>Reset</Button>
          <Text ml="auto" color="gray.500">Tip: Narrow by date/time, then export.</Text>
        </Flex>
      </Box>

      <Box className="glass-card" p={3}>
        {loading ? (
          <Flex align="center" justify="center"><Spinner /></Flex>
        ) : (
          <>
            <Flex justify="space-between" align="center" mb={3}>
              <Text fontWeight="bold">Results</Text>
              <HStack>
                <Button onClick={handleExportCsv} leftIcon={<DownloadIcon />}>Export CSV</Button>
                <Button onClick={handlePrintSad} leftIcon={<FaFilePdf />}>Print SAD</Button>
              </HStack>
            </Flex>

            {statsSource.length === 0 ? (
              <Text>No records found for: {searchTerm}</Text>
            ) : (
              <>
                <Text mb={2}>No. of Transacts: {statsSource.length}</Text>
                <Text mb={2}>Total Discharged: {formatWeight(statsTotals.cumulativeNet)} kg</Text>

                <Table size="sm">
                  <Thead>
                    <Tr>
                      <Th>Ticket No</Th>
                      <Th>Truck</Th>
                      <Th>Date & Time</Th>
                      <Th isNumeric>Net (kg)</Th>
                      <Th>Actions</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {statsSource.slice(pageStart, pageEnd).map((r) => {
                      const w = computeWeights(r);
                      const d = r.outgateDateTime || r.rawRow?.submitted_at || r.rawRow?.date || r.rawRow?.created_at || null;
                      const parsed = parseTicketDate(d);
                      return (
                        <Tr key={r.ticketId || r.ticketNo}>
                          <Td>{r.ticketNo}</Td>
                          <Td>{r.vehicleNumber}</Td>
                          <Td>{parsed ? parsed.toLocaleString() : '—'}</Td>
                          <Td isNumeric>{formatWeight(w.net)}</Td>
                          <Td>
                            <Button size="sm" onClick={() => openDetailsFor(r)}>View</Button>
                          </Td>
                        </Tr>
                      );
                    })}
                  </Tbody>
                </Table>

                <Flex justify="space-between" align="center" mt={3}>
                  <Text>Page {currentPage} / {totalPages}</Text>
                  <HStack>
                    <Button size="sm" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}>Prev</Button>
                    <Button size="sm" onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
                  </HStack>
                </Flex>
              </>
            )}
          </>
        )}
      </Box>
    </Box>
  );
}
