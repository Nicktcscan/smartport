/* eslint-disable no-unused-vars */
/* eslint-disable no-loop-func */
// src/pages/ManualEntry.jsx
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  Box,
  Button,
  FormControl,
  FormLabel,
  Input,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  useDisclosure,
  Heading,
  Text,
  SimpleGrid,
  useToast,
  FormErrorMessage,
  IconButton,
  Select,
  Flex,
  Badge,
  HStack,
  Checkbox,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  VStack,
  useBreakpointValue,
  InputGroup,
  InputRightElement,
  Spacer,
  Stat,
  StatLabel,
  StatNumber,
  StatHelpText,
  Tooltip,
} from '@chakra-ui/react';
import { ViewIcon, ExternalLinkIcon, EditIcon, CheckIcon, CloseIcon, DeleteIcon } from '@chakra-ui/icons';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../supabaseClient';

/* -----------------------
   Top-level constants (stable references)
   ----------------------- */
const REQUIRED_FIELDS = ['truckOnWb', 'operation', 'gross', 'tare', 'net', 'sadNo'];
const OUT_OF_RANGE_THRESHOLD = 100000;

/* -----------------------
   Helpers: formatting + parsing
   ----------------------- */
function unformatNumberString(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[,\s]+/g, '').trim();
}
function numericValue(v) {
  if (v === null || v === undefined || v === '') return null;
  const cleaned = unformatNumberString(String(v)).replace(/kg/i, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
function formatNumber(v) {
  const n = numericValue(v);
  if (n === null) return '';
  if (Number.isInteger(n)) return n.toLocaleString('en-US');
  return Number(n.toFixed(2)).toLocaleString('en-US');
}

/* Compute missing weights given gross/tare/net */
function computeWeights(rowData) {
  const g0 = numericValue(rowData.gross);
  const t0 = numericValue(rowData.tare);
  const n0 = numericValue(rowData.net);

  let G = Number.isFinite(g0) ? g0 : null;
  let T = Number.isFinite(t0) ? t0 : null;
  let N = Number.isFinite(n0) ? n0 : null;

  if ((G === null || G === undefined) && T !== null && N !== null) {
    G = N + T;
  }
  if ((N === null || N === undefined) && G !== null && T !== null) {
    N = G - T;
  }
  if ((T === null || T === undefined) && G !== null && N !== null) {
    T = G - N;
  }

  return {
    grossValue: G !== null && G !== undefined ? G : null,
    tareValue: T !== null && T !== undefined ? T : null,
    netValue: N !== null && N !== undefined ? N : null,
    grossDisplay: G !== null && G !== undefined ? formatNumber(G) : '',
    tareDisplay: T !== null && T !== undefined ? formatNumber(T) : '',
    netDisplay: N !== null && N !== undefined ? formatNumber(N) : '',
  };
}

/* NumericInput */
function NumericInput({
  name,
  rawValue,
  onRawChange,
  placeholder,
  isReadOnly = false,
  isDisabled = false,
  inputProps = {},
}) {
  const ref = useRef(null);
  const desiredDigitsRef = useRef(null);

  const displayValue = formatNumber(rawValue);

  const handleChange = (e) => {
    if (isReadOnly || isDisabled) return;
    const inputVal = e.target.value;
    const selectionStart = e.target.selectionStart ?? inputVal.length;
    const left = inputVal.slice(0, selectionStart);
    const digitsLeft = (left.match(/[0-9]/g) || []).length;
    desiredDigitsRef.current = digitsLeft;
    const unformatted = inputVal.replace(/[^\d.-]/g, '');
    onRawChange(unformatted);
  };

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const desiredDigits = desiredDigitsRef.current;
    if (desiredDigits === null || desiredDigits === undefined) return;

    let digitsSeen = 0;
    let targetIndex = displayValue.length;
    for (let i = 0; i < displayValue.length; i++) {
      if (/[0-9]/.test(displayValue[i])) digitsSeen++;
      if (digitsSeen >= desiredDigits) {
        targetIndex = i + 1;
        break;
      }
    }
    requestAnimationFrame(() => {
      try {
        el.setSelectionRange(targetIndex, targetIndex);
      } catch (e) {
        // ignore
      }
    });
    desiredDigitsRef.current = null;
  }, [displayValue]);

  return (
    <Input
      name={name}
      ref={ref}
      value={displayValue}
      onChange={handleChange}
      placeholder={placeholder}
      autoComplete="off"
      isReadOnly={isReadOnly}
      isDisabled={isDisabled}
      bg={isReadOnly ? 'gray.50' : undefined}
      _hover={isReadOnly ? { cursor: 'default' } : undefined}
      {...inputProps}
    />
  );
}

/* -----------------------
   utilities
   ----------------------- */
async function insertTicketWithRetry(insertData, historyRef = [], retryLimit = 7) {
  let attempt = 0;
  while (attempt < retryLimit) {
    attempt += 1;
    try {
      if (!insertData.ticket_no) {
        const suggested = await getNextTicketNoFromDB(historyRef);
        insertData.ticket_no = suggested.nextTicketNo;
      }
      const { data, error } = await supabase.from('tickets').insert([insertData]).select();
      if (!error && data && data.length) return { data, error: null, ticketNo: insertData.ticket_no };
      const msg = String(error?.message || '').toLowerCase();
      if (msg.includes('duplicate') || msg.includes('unique') || error?.status === 409) {
        await new Promise((res) => setTimeout(res, 200 * attempt));
        insertData.ticket_no = null;
        continue;
      }
      return { data: null, error, ticketNo: null };
    } catch (err) {
      console.warn('insertTicketWithRetry attempt failed', err);
      await new Promise((res) => setTimeout(res, 200 * attempt));
      continue;
    }
  }
  return { data: null, error: new Error('Too many retries'), ticketNo: null };
}

async function getNextTicketNoFromDB(localHistory = []) {
  try {
    const { data, error } = await supabase
      .from('tickets')
      .select('ticket_no')
      .ilike('ticket_no', 'M-%')
      .order('submitted_at', { ascending: false })
      .limit(1000);

    if (error) {
      console.warn('Could not fetch ticket_no from DB; falling back to local history', error);
    }

    const candidates = (data && data.map((r) => r.ticket_no).filter(Boolean)) || localHistory.map((h) => h.data?.ticketNo).filter(Boolean);

    let maxNum = 0;
    const re = /^M-(\d+)$/i;
    for (const t of candidates) {
      if (!t) continue;
      const m = String(t).trim().match(re);
      if (m && m[1]) {
        const n = parseInt(m[1].replace(/^0+/, '') || m[1], 10);
        if (!isNaN(n) && n > maxNum) maxNum = n;
      }
    }

    const next = maxNum + 1;
    return { nextTicketNo: `M-${String(next).padStart(4, '0')}`, maxNum };
  } catch (err) {
    console.error('getNextTicketNoFromDB error', err);
    return { nextTicketNo: `M-0001`, maxNum: 0 };
  }
}

function dedupeByTicketNo(tickets = []) {
  const seen = new Set();
  const out = [];
  for (const t of tickets) {
    const tn = String(t?.data?.ticketNo ?? t?.ticketId ?? '').trim();
    if (!tn) {
      out.push(t);
      continue;
    }
    if (seen.has(tn)) continue;
    seen.add(tn);
    out.push(t);
  }
  return out;
}

function isUUID(val) {
  if (!val || typeof val !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
}

async function updateTicketsRow(payload, ticketIdentifier, originalTicketNo = null) {
  if (!ticketIdentifier) throw new Error('Missing ticket identifier');
  if (isUUID(ticketIdentifier)) {
    const res = await supabase.from('tickets').update(payload).eq('ticket_id', ticketIdentifier).select();
    if (res.error) throw res.error;
    if (res.data && res.data.length) return res.data;
    if (originalTicketNo) {
      const fb = await supabase.from('tickets').update(payload).eq('ticket_no', originalTicketNo).select();
      if (fb.error) throw fb.error;
      if (fb.data && fb.data.length) return fb.data;
    }
  } else {
    const res = await supabase.from('tickets').update(payload).eq('ticket_no', ticketIdentifier).select();
    if (res.error) throw res.error;
    if (res.data && res.data.length) return res.data;
    if (isUUID(originalTicketNo)) {
      const fb = await supabase.from('tickets').update(payload).eq('ticket_id', originalTicketNo).select();
      if (fb.error) throw fb.error;
      if (fb.data && fb.data.length) return fb.data;
    }
  }
  throw new Error(`No rows updated for identifier=${ticketIdentifier}`);
}

/* -----------------------
   Motion helpers & confetti
   ----------------------- */
const MotionBox = motion(Box);

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

/* -----------------------
   Main Component
   ----------------------- */
export default function ManualEntry() {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const {
    isOpen: isViewOpen,
    onOpen: onViewOpen,
    onClose: onViewClose,
  } = useDisclosure();

  const toast = useToast();
  const firstInputRef = useRef(null);

  const [formData, setFormData] = useState({
    truckOnWb: '',
    consignee: '',
    operation: '',
    driver: '',
    sadNo: '',
    containerNo: '',
    gross: '',
    tare: '',
    net: '',
  });

  const formDataRef = useRef(formData);
  useEffect(() => { formDataRef.current = formData; }, [formData]);

  const [errors, setErrors] = useState({});
  const [history, setHistory] = useState([]);
  const [viewTicket, setViewTicket] = useState(null);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [operatorName, setOperatorName] = useState('');
  const [operatorId, setOperatorId] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const [isTareAuto, setIsTareAuto] = useState(false);
  const [tareRecordExists, setTareRecordExists] = useState(false);
  const [saveTare, setSaveTare] = useState(false);
  const [fetchingTare, setFetchingTare] = useState(false);
  const truckFetchTimerRef = useRef(null);

  const [vehicleSummary, setVehicleSummary] = useState(null);
  const [lastTares, setLastTares] = useState([]);
  const [selectedSuggestedTare, setSelectedSuggestedTare] = useState('');

  const lastAutoFilledTruckRef = useRef('');

  // Admin inline editing state
  const [editingRowId, setEditingRowId] = useState(null);
  const [editRowData, setEditRowData] = useState({});
  // view modal edit state
  const [viewIsEditing, setViewIsEditing] = useState(false);
  const [viewEditData, setViewEditData] = useState({});

  // authoritative manual count (tickets table where ticket_no starts with M-)
  const [manualCount, setManualCount] = useState(0);

  // authoritative totals for manual tickets (server-wide)
  const [manualTotals, setManualTotals] = useState({ count: 0, totalGross: 0, totalNet: 0 });

  const [deletingTicketId, setDeletingTicketId] = useState(null);

  const validateAll = useCallback((nextForm = null) => {
    const fd = nextForm || formDataRef.current;
    const newErrors = {};

    REQUIRED_FIELDS.forEach((f) => {
      if (!fd[f] || String(fd[f]).trim() === '') {
        newErrors[f] = 'This field is required';
      }
    });

    const computed = computeWeights({ gross: fd.gross, tare: fd.tare, net: fd.net });

    if (computed.grossValue === null) newErrors.gross = newErrors.gross || 'Invalid or missing gross';
    if (computed.tareValue === null) newErrors.tare = newErrors.tare || 'Invalid or missing tare';
    if (computed.netValue === null) newErrors.net = newErrors.net || 'Invalid or missing net';

    if (computed.grossValue !== null && computed.tareValue !== null) {
      if (!(computed.grossValue > computed.tareValue)) {
        newErrors.gross = 'Gross must be greater than Tare';
        newErrors.tare = 'Tare must be less than Gross';
      }
    }

    setErrors((prev) => {
      const prevKeys = Object.keys(prev).sort();
      const newKeys = Object.keys(newErrors).sort();
      if (prevKeys.length === newKeys.length && prevKeys.every((k, i) => k === newKeys[i] && String(prev[k]) === String(newErrors[k]))) {
        return prev;
      }
      return newErrors;
    });

    return Object.keys(newErrors).length === 0;
  }, []);

  const handleChange = (field, value) => {
    const next = { ...formDataRef.current, [field]: value };
    setFormData(next);
    validateAll(next);
  };

  const updateNumericField = (fieldName, rawString) => {
    setFormData((prev) => {
      const next = { ...prev, [fieldName]: rawString };

      if (fieldName === 'gross' || fieldName === 'tare') {
        const g = numericValue(fieldName === 'gross' ? rawString : prev.gross);
        const t = numericValue(fieldName === 'tare' ? rawString : prev.tare);
        if (g !== null && t !== null) {
          const liveNet = g - t;
          next.net = String(Number.isFinite(liveNet) ? liveNet : '');
        } else {
          next.net = '';
        }
      }

      if (fieldName === 'tare') {
        if (!tareRecordExists) setSaveTare(true);
        if (isTareAuto) setIsTareAuto(false);
      }

      setTimeout(() => validateAll(next), 0);
      return next;
    });
  };

  /* Fetch tare for truck (debounced) - extended to fetch last ticket gross/tare as well */
  const fetchTareForTruck = useCallback(async (truckNo) => {
    if (!truckNo) return;
    setFetchingTare(true);
    try {
      // 1) vehicle_tares summary + history
      const { data: summaryData, error: summaryErr } = await supabase
        .from('vehicle_tares')
        .select('truck_no, tare, avg_tare, entry_count, updated_at')
        .eq('truck_no', truckNo)
        .maybeSingle();

      if (summaryErr) {
        console.warn('Error fetching vehicle_tares summary', summaryErr);
      }

      const { data: histData, error: histErr } = await supabase
        .from('vehicle_tare_history')
        .select('tare, recorded_at')
        .eq('truck_no', truckNo)
        .order('recorded_at', { ascending: false })
        .limit(5);

      if (histErr) {
        console.warn('Error fetching vehicle_tare_history', histErr);
      }

      // 2) last ticket for this vehicle (to fetch last gross & tare if present)
      let lastTicket = null;
      try {
        // search either gnsw_truck_no or truck_on_wb
        const orFilter = `gnsw_truck_no.eq.${truckNo},truck_on_wb.eq.${truckNo}`;
        const { data: lastData, error: lastErr } = await supabase
          .from('tickets')
          .select('gross, tare, net, submitted_at')
          .or(orFilter)
          .order('submitted_at', { ascending: false })
          .limit(1);
        if (lastErr) {
          console.warn('Error fetching last ticket for truck', lastErr);
        } else if (Array.isArray(lastData) && lastData.length > 0) {
          lastTicket = lastData[0];
        }
      } catch (e) {
        console.warn('lookup last ticket failed', e);
      }

      setVehicleSummary((prev) => {
        const newSummary = summaryData || null;
        if (JSON.stringify(prev) === JSON.stringify(newSummary)) return prev;
        return newSummary;
      });

      setLastTares((prev) => {
        const arr = Array.isArray(histData) ? histData.map((r) => ({ tare: r.tare, recorded_at: r.recorded_at })) : [];
        if (JSON.stringify(prev) === JSON.stringify(arr)) return prev;
        return arr;
      });

      // Auto-fill logic (do not overwrite if user already entered a value)
      if (lastTicket && (lastTicket.gross !== null || lastTicket.tare !== null)) {
        if (lastAutoFilledTruckRef.current !== truckNo) {
          setFormData((prev) => {
            const next = { ...prev };
            // only auto-fill gross if empty
            if ((!prev.gross || String(prev.gross).trim() === '') && (lastTicket.gross !== null && lastTicket.gross !== undefined)) {
              next.gross = String(lastTicket.gross);
            }
            // only auto-fill tare if empty
            if ((!prev.tare || String(prev.tare).trim() === '') && (lastTicket.tare !== null && lastTicket.tare !== undefined)) {
              next.tare = String(lastTicket.tare);
            }
            // compute net if possible
            const g = numericValue(next.gross);
            const t = numericValue(next.tare);
            if (g !== null && t !== null) {
              next.net = String(g - t);
            }
            setTimeout(() => validateAll(next), 0);
            return next;
          });

          setIsTareAuto(true);
          setTareRecordExists(true);
          setSaveTare(false);
          lastAutoFilledTruckRef.current = truckNo;

          toast({
            title: 'Auto-filled weights',
            description: `Populated gross/tare from last record for ${truckNo}`,
            status: 'info',
            duration: 4200,
            isClosable: true,
          });
        }
      } else {
        if (summaryData && summaryData.tare !== undefined && summaryData.tare !== null) {
          if (lastAutoFilledTruckRef.current !== truckNo) {
            const newTareStr = String(summaryData.tare);
            setFormData((prev) => {
              if (prev.tare === newTareStr) return prev;
              const next = { ...prev, tare: newTareStr };
              const g = numericValue(next.gross);
              const t = numericValue(next.tare);
              if (g !== null && t !== null) next.net = String(g - t);
              setTimeout(() => validateAll(next), 0);
              return next;
            });

            setIsTareAuto(true);
            setTareRecordExists(true);
            setSaveTare(false);
            lastAutoFilledTruckRef.current = truckNo;

            toast({
              title: 'Tare auto-filled',
              description: `Last tare: ${formatNumber(String(summaryData.tare))} kg${summaryData.avg_tare ? ` | Avg: ${formatNumber(String(summaryData.avg_tare))} (${summaryData.entry_count || 1} entries)` : ''}`,
              status: 'info',
              duration: 4000,
              isClosable: true,
            });
          }
        } else if (Array.isArray(histData) && histData.length > 0) {
          setIsTareAuto(false);
          setTareRecordExists(true);
        } else {
          setIsTareAuto(false);
          setTareRecordExists(false);
        }
      }
    } catch (err) {
      console.error('fetchTareForTruck error', err);
      setIsTareAuto(false);
      setTareRecordExists(false);
    } finally {
      setFetchingTare(false);
    }
  }, [validateAll, toast]);

  useEffect(() => {
    lastAutoFilledTruckRef.current = '';
  }, [formData.truckOnWb]);

  useEffect(() => {
    if (truckFetchTimerRef.current) clearTimeout(truckFetchTimerRef.current);
    const truck = (formData.truckOnWb || '').trim();
    if (!truck) {
      setIsTareAuto(false);
      setTareRecordExists(false);
      setSaveTare(false);
      setVehicleSummary(null);
      setLastTares([]);
      setSelectedSuggestedTare('');
      lastAutoFilledTruckRef.current = '';
      return;
    }

    truckFetchTimerRef.current = setTimeout(() => {
      fetchTareForTruck(truck);
    }, 600);

    return () => {
      if (truckFetchTimerRef.current) clearTimeout(truckFetchTimerRef.current);
    };
  }, [formData.truckOnWb, fetchTareForTruck]);

  const predictedTare = useMemo(() => {
    if (vehicleSummary && vehicleSummary.avg_tare) return Number(vehicleSummary.avg_tare);
    if (lastTares && lastTares.length > 0) return Number(lastTares[0].tare);
    return null;
  }, [vehicleSummary, lastTares]);

  const enteredTareNumeric = useMemo(() => numericValue(formData.tare), [formData.tare]);
  const isTareAnomaly = useMemo(() => {
    const pred = predictedTare;
    const entered = enteredTareNumeric;
    if (!pred || entered === null) return false;
    return Math.abs(entered - pred) / pred > 0.05;
  }, [predictedTare, enteredTareNumeric]);

  const handlePickSuggestedTare = useCallback((val) => {
    setSelectedSuggestedTare(val || '');
    if (!val) return;

    if (val.startsWith('avg:')) {
      const raw = val.slice(4);
      const num = Number(raw);
      if (!Number.isNaN(num)) {
        setFormData((prev) => {
          const newTareStr = String(num);
          if (prev.tare === newTareStr) return prev;
          const next = { ...prev, tare: newTareStr };
          const g = numericValue(next.gross);
          if (g !== null) next.net = String(g - num);
          setTimeout(() => validateAll(next), 0);
          return next;
        });
        setIsTareAuto(true);
        setSaveTare(true);
      }
    } else if (val.startsWith('hist:')) {
      try {
        const payload = JSON.parse(decodeURIComponent(val.slice(5)));
        const num = Number(payload.tare);
        if (!Number.isNaN(num)) {
          setFormData((prev) => {
            const newTareStr = String(num);
            if (prev.tare === newTareStr) return prev;
            const next = { ...prev, tare: newTareStr };
            const g = numericValue(next.gross);
            if (g !== null) next.net = String(g - num);
            setTimeout(() => validateAll(next), 0);
            return next;
          });
          setIsTareAuto(true);
          setSaveTare(true);
        }
      } catch (e) {
        console.warn('Could not parse selected historical tare', e);
      }
    }
  }, [validateAll]);

  /* -----------------------
     Load tickets and operator at mount (and expose as fetchHistory to refresh after edits)
  ----------------------- */

  // New: batched aggregator for all manual tickets -> computes authoritative manualCount, totalGross, totalNet
  const computeManualTotalsFromDB = useCallback(async () => {
    try {
      const batchSize = 1000;
      let from = 0;
      let hasMore = true;
      let count = 0;
      let totalGross = 0;
      let totalNet = 0;

      while (hasMore) {
        const to = from + batchSize - 1;
        const { data, error } = await supabase
          .from('tickets')
          .select('ticket_no, gross, net')
          .range(from, to);

        if (error) {
          // If there's an error, bail and keep previous totals
          console.warn('computeManualTotalsFromDB fetch error', error);
          break;
        }

        if (!data || data.length === 0) {
          break;
        }

        for (const r of data) {
          const tn = (r.ticket_no ?? '').toString();
          if (/^M-/i.test(tn)) {
            count += 1;
            const g = numericValue(r.gross);
            const n = numericValue(r.net);
            if (g !== null) totalGross += g;
            if (n !== null) totalNet += n;
          }
        }

        if (data.length < batchSize) {
          hasMore = false;
        } else {
          from += batchSize;
        }
      }

      setManualTotals({ count, totalGross, totalNet });
      setManualCount(count);
    } catch (err) {
      console.error('computeManualTotalsFromDB error', err);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('tickets')
        .select('*')
        .order('submitted_at', { ascending: false })
        .limit(2000);

      if (error) {
        console.warn('Error loading tickets', error);
        toast({ title: 'Error loading tickets', description: error.message || String(error), status: 'error', duration: 5000, isClosable: true });
        return;
      }

      if (!Array.isArray(data)) {
        setHistory([]);
        setManualCount(0);
        setManualTotals({ count: 0, totalGross: 0, totalNet: 0 });
        return;
      }

      const mapped = data.map((item, idx) => {
        const ticketId = item.ticket_id ?? item.id ?? item.ticket_no ?? `unknown-${idx}-${Date.now()}`;

        const truck =
          (item.gnsw_truck_no && String(item.gnsw_truck_no).trim()) ||
          (item.truck_on_wb && String(item.truck_on_wb).trim()) ||
          (item.truckOnWb && String(item.truckOnWb).trim()) ||
          '';

        const grossVal = (item.gross !== null && item.gross !== undefined) ? String(item.gross) : '';
        const tareVal = (item.tare !== null && item.tare !== undefined) ? String(item.tare) : '';
        const netVal = (item.net !== null && item.net !== undefined) ? String(item.net) : '';

        // manual should only be Yes when ticket_no starts with M-
        const manualFlag = (item.manual !== undefined && item.manual !== null)
          ? item.manual
          : ((item.ticket_no && /^M-/i.test(String(item.ticket_no))) ? 'Yes' : 'No');

        return {
          ticketId,
          data: {
            ticketNo: item.ticket_no ?? ticketId,
            truckOnWb: truck,
            consignee: item.consignee ?? '',
            operation: item.operation ?? '',
            driver: item.driver ?? '',
            sadNo: item.sad_no ?? item.sadNo ?? '',
            containerNo: item.container_no ?? '',
            gross: grossVal,
            tare: tareVal,
            net: netVal,
            manual: manualFlag,
            operator: item.operator ?? '',
            status: item.status ?? '',
            fileUrl: item.file_url ?? null,
            created_by: item.created_by ?? null,
            created_at: item.created_at ?? item.submitted_at ?? null,
          },
          submittedAt: item.submitted_at ?? new Date().toISOString(),
        };
      });

      const deduped = dedupeByTicketNo(mapped);
      setHistory(deduped);
      setPage(1);

      // compute authoritative manual totals in background (batched)
      computeManualTotalsFromDB().catch((e) => console.warn('computeManualTotalsFromDB error', e));
    } catch (err) {
      console.error('fetchHistory error', err);
    }
  }, [toast, computeManualTotalsFromDB]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      await fetchHistory();

      try {
        let currentUser = null;
        if (supabase.auth?.getUser) {
          const { data: userData, error: userErr } = await supabase.auth.getUser();
          if (!userErr) currentUser = userData?.user || null;
        } else if (supabase.auth?.user) {
          currentUser = supabase.auth.user();
        }

        if (currentUser && mounted) {
          const { data: userRow } = await supabase.from('users').select('full_name, username, role').eq('id', currentUser.id).maybeSingle();
          setOperatorName((userRow && (userRow.full_name || userRow.username)) || currentUser.email || '');
          setOperatorId(currentUser.id);
          setIsAdmin(Boolean(userRow && String(userRow.role || '').toLowerCase() === 'admin'));
        }
      } catch (e) {
        console.warn('Could not determine operator', e);
      }
    })();

    return () => { mounted = false; };
  }, [fetchHistory, computeManualTotalsFromDB]);

  /* Submit form (optimistic UI + DB) */
  const handleSubmit = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    const ok = validateAll();
    if (!ok) {
      toast({
        title: 'Validation error',
        description: 'Please correct highlighted fields.',
        status: 'error',
        duration: 3500,
        isClosable: true,
      });
      setIsSubmitting(false);
      return;
    }

    const computed = computeWeights({
      gross: formDataRef.current.gross,
      tare: formDataRef.current.tare,
      net: formDataRef.current.net,
    });

    // optimistic row
    const tempId = `tmp-${Date.now()}`;
    const tempTicket = {
      ticketId: tempId,
      data: {
        ticketNo: tempId,
        truckOnWb: formDataRef.current.truckOnWb || '',
        consignee: formDataRef.current.consignee || '',
        operation: formDataRef.current.operation || '',
        driver: formDataRef.current.driver || '',
        sadNo: formDataRef.current.sadNo || '',
        containerNo: formDataRef.current.containerNo || '',
        gross: computed.grossDisplay,
        tare: computed.tareDisplay,
        net: computed.netDisplay,
        manual: null, // unknown until final ticket_no
        operator: operatorName || '',
        status: 'Pending',
        fileUrl: null,
      },
      submittedAt: new Date().toISOString(),
      __optimistic: true,
    };

    setHistory((prev) => [tempTicket, ...prev]);

    const truck = formDataRef.current.truckOnWb || null;

    const insertData = {
      ticket_no: null,
      gnsw_truck_no: truck,
      truck_on_wb: null,
      consignee: formDataRef.current.consignee || null,
      operation: formDataRef.current.operation || null,
      driver: formDataRef.current.driver || null,
      sad_no: formDataRef.current.sadNo || null,
      container_no: formDataRef.current.containerNo || null,
      material: null,
      pass_number: null,
      date: new Date().toISOString(),
      scale_name: 'WBRIDGE1',
      weight: numericValue(formDataRef.current.gross) !== null ? numericValue(formDataRef.current.gross) : null,
      manual: null,
      operator: operatorName || null,
      operator_id: operatorId || null,
      created_by: operatorId || null, // record who created the ticket
      created_at: new Date().toISOString(), // ensure created_at timestamp is recorded
      gross: computed.grossValue !== null ? computed.grossValue : null,
      tare: computed.tareValue !== null ? computed.tareValue : null,
      net: computed.netValue !== null ? computed.netValue : null,
      status: 'Pending',
      submitted_at: new Date().toISOString(),
    };

    try {
      const { data, error, ticketNo } = await insertTicketWithRetry(insertData, history, 7);
      if (error) {
        setHistory((prev) => prev.filter((r) => r.ticketId !== tempId));
        toast({ title: 'Submit failed', description: error.message || String(error), status: 'error', duration: 5000, isClosable: true });
        setIsSubmitting(false);
        return;
      }

      const newTicketNo = ticketNo || (data && data[0] && data[0].ticket_no) || 'M-0001';
      const newTicketId = (data && data[0] && (data[0].ticket_id || data[0].id)) || newTicketNo;

      // If the created ticket_no is M-*, set manual flag on the persisted row.
      try {
        if (/^M-/i.test(String(newTicketNo))) {
          await supabase.from('tickets').update({ manual: 'Yes' }).eq('ticket_no', newTicketNo);
        } else {
          await supabase.from('tickets').update({ manual: null }).eq('ticket_no', newTicketNo);
        }
      } catch (mErr) {
        console.warn('Could not set manual flag after insert', mErr);
      }

      if (truck && computed.tareValue !== null && saveTare) {
        try {
          await supabase.from('vehicle_tare_history').insert([
            {
              truck_no: truck,
              tare: computed.tareValue,
              recorded_at: new Date().toISOString(),
            },
          ]);
        } catch (err) {
          console.warn('Failed to insert into vehicle_tare_history', err);
        }

        try {
          const { data: allHist, error: allErr } = await supabase
            .from('vehicle_tare_history')
            .select('tare')
            .eq('truck_no', truck);

          if (!allErr && Array.isArray(allHist) && allHist.length > 0) {
            const tares = allHist.map((r) => Number(r.tare)).filter((n) => !Number.isNaN(n));
            const sum = tares.reduce((a, b) => a + b, 0);
            const avg = tares.length ? sum / tares.length : computed.tareValue;
            const entryCount = tares.length;

            await supabase.from('vehicle_tares').upsert(
              [
                {
                  truck_no: truck,
                  tare: computed.tareValue,
                  avg_tare: avg,
                  entry_count: entryCount,
                  updated_at: new Date().toISOString(),
                },
              ],
              { onConflict: 'truck_no' }
            );
          } else {
            await supabase.from('vehicle_tares').upsert(
              [
                {
                  truck_no: truck,
                  tare: computed.tareValue,
                  avg_tare: computed.tareValue,
                  entry_count: 1,
                  updated_at: new Date().toISOString(),
                },
              ],
              { onConflict: 'truck_no' }
            );
          }
        } catch (err) {
          console.warn('Failed to update vehicle_tares summary', err);
        }
      }

      // replace temp with persisted entry in UI; then refresh full history from DB
      await fetchHistory();

      // recalc authoritative manual totals
      computeManualTotalsFromDB().catch((e) => console.warn('computeManualTotalsFromDB error', e));

      toast({ title: 'Ticket saved', description: `Ticket ${newTicketNo} created`, status: 'success', duration: 3000, isClosable: true });

      // Reset form after success
      setFormData({
        truckOnWb: '',
        consignee: '',
        operation: '',
        driver: '',
        sadNo: '',
        containerNo: '',
        gross: '',
        tare: '',
        net: '',
      });
      setErrors({});
      setIsTareAuto(false);
      setTareRecordExists(false);
      setSaveTare(false);
      setVehicleSummary(null);
      setLastTares([]);
      setSelectedSuggestedTare('');
      lastAutoFilledTruckRef.current = '';

      onClose();

      // celebratory confetti
      await runConfetti();
    } catch (err) {
      setHistory((prev) => prev.filter((r) => r.ticketId !== tempId));
      console.error(err);
      toast({ title: 'Submit error', description: err?.message || 'Unexpected error', status: 'error', duration: 5000, isClosable: true });
    } finally {
      setIsSubmitting(false);
    }
  };

  /* View ticket */
  const handleView = (ticket) => {
    setViewTicket(ticket);
    setViewIsEditing(false);
    setViewEditData({});
    onViewOpen();
  };

  /* Filter & pagination for history */
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const filteredHistory = useMemo(() => {
    const q = (searchQuery || '').toLowerCase();
    const arr = history.filter((r) => {
      const matchesSearch =
        (r.data.ticketNo || '').toLowerCase().includes(q) ||
        (r.data.truckOnWb || '').toLowerCase().includes(q) ||
        (r.data.driver || '').toLowerCase().includes(q) ||
        (r.data.sadNo || '').toLowerCase().includes(q);
      const matchesStatus = statusFilter ? r.data.status === statusFilter : true;
      return matchesSearch && matchesStatus;
    });

    arr.sort((a, b) => {
      const da = new Date(a.submittedAt).getTime ? new Date(a.submittedAt).getTime() : 0;
      const db = new Date(b.submittedAt).getTime ? new Date(b.submittedAt).getTime() : 0;
      return db - da;
    });

    return arr;
  }, [history, searchQuery, statusFilter]);

  useEffect(() => setPage(1), [searchQuery, statusFilter, history, pageSize]);

  const totalTickets = filteredHistory.length;
  const totalPages = Math.max(1, Math.ceil(totalTickets / pageSize));
  const startIndex = (page - 1) * pageSize;
  const pagedHistory = filteredHistory.slice(startIndex, startIndex + pageSize);

  function getCondensedPages(current, total, edge = 1, around = 2) {
    const pages = new Set();
    for (let i = 1; i <= Math.min(edge, total); i++) pages.add(i);
    for (let i = Math.max(1, current - around); i <= Math.min(total, current + around); i++) pages.add(i);
    for (let i = Math.max(1, total - edge + 1); i <= total; i++) pages.add(i);
    const arr = Array.from(pages).sort((a,b) => a-b);

    const out = [];
    for (let i = 0; i < arr.length; i++) {
      if (i > 0 && arr[i] !== arr[i-1] + 1) out.push("...");
      out.push(arr[i]);
    }
    return out;
  }
  const pageItems = getCondensedPages(page, totalPages);

  const handlePageClick = (n) => {
    if (n === '...') return;
    setPage(n);
  };

  // Stats: TOTAL GROSS and TOTAL NET for manual tickets — now authoritative from manualTotals
  const stats = useMemo(() => {
    return {
      count: manualTotals.count || 0,
      totalGross: manualTotals.totalGross || null,
      totalNet: manualTotals.totalNet || null,
    };
  }, [manualTotals]);

  const isMobile = useBreakpointValue({ base: true, md: false });

  /* -----------------------
     Inline edit helpers (admin)
  ----------------------- */

  const startRowEdit = (ticket) => {
    if (!isAdmin) {
      toast({ title: 'Permission denied', description: 'Only admins can edit', status: 'warning', duration: 2500 });
      return;
    }
    setEditingRowId(ticket.ticketId);
    setEditRowData({ ...ticket.data });
  };

  const cancelRowEdit = () => {
    setEditingRowId(null);
    setEditRowData({});
  };

  const handleRowFieldChange = (field, value) => {
    setEditRowData((p) => ({ ...p, [field]: value }));
  };

  const saveRowEdit = async (ticket) => {
    if (!isAdmin) {
      toast({ title: 'Permission denied', description: 'Only admins can save edits', status: 'warning', duration: 2500 });
      return;
    }
    if (!ticket) return;

    const g = numericValue(editRowData.gross);
    const t = numericValue(editRowData.tare);
    let n = numericValue(editRowData.net);
    if ((n === null || n === undefined) && g !== null && t !== null) n = g - t;

    const errs = {};
    if (g === null) errs.gross = 'Invalid gross';
    if (t === null) errs.tare = 'Invalid tare';
    if (n === null) errs.net = 'Invalid net';
    if (g !== null && t !== null && !(g > t)) {
      errs.gross = 'Gross must be greater than Tare';
      errs.tare = 'Tare must be less than Gross';
    }
    if (Object.keys(errs).length) {
      toast({ title: 'Validation error', description: 'Please correct fields before saving', status: 'error', duration: 3500 });
      return;
    }

    const before = ticket.data;
    const afterData = {
      ...ticket.data,
      ...editRowData,
      gross: formatNumber(String(g)),
      tare: formatNumber(String(t)),
      net: formatNumber(String(n)),
    };

    setHistory((prev) => prev.map((r) => (r.ticketId === ticket.ticketId ? { ...r, data: { ...afterData } } : r)));

    if (String(ticket.ticketId || '').startsWith('tmp-')) {
      setEditingRowId(null);
      setEditRowData({});
      toast({ title: 'Saved (local only)', status: 'success', duration: 2500 });
      return;
    }

    try {
      const ticketIdValue = ticket.ticketId ?? ticket.data.ticketNo ?? null;
      if (!ticketIdValue) throw new Error('Missing ticket identifier');

      const payload = {
        gross: g !== null ? g : null,
        tare: t !== null ? t : null,
        net: n !== null ? n : null,
        consignee: afterData.consignee || null,
        container_no: afterData.containerNo || null,
        driver: afterData.driver || null,
        operator: afterData.operator || null,
        sad_no: afterData.sadNo || null,
        truck_on_wb: afterData.truckOnWb || null,
        gnsw_truck_no: afterData.truckOnWb || null,
        ticket_no: afterData.ticketNo || null,
      };

      await updateTicketsRow(payload, ticketIdValue, ticket.data.ticketNo);

      try {
        const auditEntry = {
          action: 'update',
          ticket_id: ticketIdValue,
          ticket_no: ticket.data?.ticketNo ?? null,
          user_id: operatorId || null,
          username: operatorName || null,
          details: JSON.stringify({ before: before || null, after: afterData || null }),
          created_at: new Date().toISOString(),
        };
        await supabase.from('audit_logs').insert([auditEntry]);
      } catch (auditErr) {
        console.debug('Audit log insertion failed', auditErr);
      }

      // propagate to outgate (best-effort)
      try {
        const oldTicketNo = ticket.data?.ticketNo ?? null;
        const newTicketNo = afterData?.ticketNo ?? oldTicketNo;

        const outPayload = {
          vehicle_number: afterData.truckOnWb || null,
          container_id: afterData.containerNo || null,
          sad_no: afterData.sadNo || null,
          gross: g !== null ? g : null,
          tare: t !== null ? t : null,
          net: n !== null ? n : null,
          driver: afterData.driver || null,
          ticket_no: newTicketNo || null,
        };

        if (isUUID(ticketIdValue)) {
          const byId = await supabase.from('outgate').update(outPayload).eq('ticket_id', ticketIdValue).select();
          if (byId.error) {
            console.warn('Failed to update outgate by ticket_id', byId.error);
          } else if (!byId.data || byId.data.length === 0) {
            if (oldTicketNo) {
              const byOldNo = await supabase.from('outgate').update(outPayload).eq('ticket_no', oldTicketNo).select();
              if (byOldNo.error) console.warn('Failed to update outgate by old ticket_no', byOldNo.error);
              else if (!byOldNo.data || byOldNo.data.length === 0) {
                try {
                  await supabase.from('outgate').insert([{
                    ticket_no: newTicketNo || oldTicketNo,
                    ticket_id: ticketIdValue,
                    vehicle_number: afterData.truckOnWb || null,
                    container_id: afterData.containerNo || null,
                    sad_no: afterData.sadNo || null,
                    gross: g !== null ? g : null,
                    tare: t !== null ? t : null,
                    net: n !== null ? n : null,
                    driver: afterData.driver || null,
                    created_at: new Date().toISOString(),
                  }]);
                } catch (insErr) {
                  console.warn('Failed to insert outgate row after update returned no rows', insErr);
                }
              }
            }
          }
        } else {
          const byNo = await supabase.from('outgate').update(outPayload).eq('ticket_no', ticketIdValue).select();
          if (byNo.error) console.warn('Failed to update outgate by ticket_no', byNo.error);
          else if (!byNo.data || byNo.data.length === 0) {
            if (oldTicketNo) {
              const byOldNo = await supabase.from('outgate').update(outPayload).eq('ticket_no', oldTicketNo).select();
              if (byOldNo.error) console.warn('Failed to update outgate by old ticket_no', byOldNo.error);
              else if (!byOldNo.data || byOldNo.data.length === 0) {
                try {
                  await supabase.from('outgate').insert([{
                    ticket_no: newTicketNo || oldTicketNo,
                    ticket_id: ticketIdValue,
                    vehicle_number: afterData.truckOnWb || null,
                    container_id: afterData.containerNo || null,
                    sad_no: afterData.sadNo || null,
                    gross: g !== null ? g : null,
                    tare: t !== null ? t : null,
                    net: n !== null ? n : null,
                    driver: afterData.driver || null,
                    created_at: new Date().toISOString(),
                  }]);
                } catch (insErr) {
                  console.warn('Failed to insert outgate row after update returned no rows', insErr);
                }
              }
            }
          }
        }
      } catch (outErrGeneral) {
        console.error('Outgate update/insert error', outErrGeneral);
      }

      await fetchHistory();

      // recalc authoritative manual totals
      computeManualTotalsFromDB().catch((e) => console.warn('computeManualTotalsFromDB error', e));

      toast({ title: 'Saved', description: `Ticket updated`, status: 'success', duration: 2500 });
      setEditingRowId(null);
      setEditRowData({});
    } catch (err) {
      console.error('Update failed', err);
      setHistory((prev) => prev.map((r) => (r.ticketId === ticket.ticketId ? { ...r, data: { ...before } } : r)));
      toast({ title: 'Update failed', description: err?.message || 'Could not update ticket', status: 'error', duration: 5000 });
    }
  };

  /* -----------------------
     View modal editing (admin)
  ----------------------- */
  const startViewEdit = () => {
    if (!isAdmin) {
      toast({ title: 'Permission denied', description: 'Only admins can edit', status: 'warning', duration: 2500 });
      return;
    }
    if (!viewTicket) return;
    setViewIsEditing(true);
    setViewEditData({ ...viewTicket.data });
  };

  const cancelViewEdit = () => {
    setViewIsEditing(false);
    setViewEditData({});
  };

  const handleViewEditChange = (field, val) => {
    setViewEditData((p) => ({ ...p, [field]: val }));
  };

  const saveViewEdit = async () => {
    if (!viewTicket) return;
    const ticket = viewTicket;
    const g = numericValue(viewEditData.gross);
    const t = numericValue(viewEditData.tare);
    let n = numericValue(viewEditData.net);
    if ((n === null || n === undefined) && g !== null && t !== null) n = g - t;

    const errs = {};
    if (g === null) errs.gross = 'Invalid gross';
    if (t === null) errs.tare = 'Invalid tare';
    if (n === null) errs.net = 'Invalid net';
    if (g !== null && t !== null && !(g > t)) {
      errs.gross = 'Gross must be greater than Tare';
      errs.tare = 'Tare must be less than Gross';
    }
    if (Object.keys(errs).length) {
      toast({ title: 'Validation error', description: 'Please correct fields before saving', status: 'error', duration: 3500 });
      return;
    }

    const before = ticket.data;
    const afterData = {
      ...ticket.data,
      ...viewEditData,
      gross: formatNumber(String(g)),
      tare: formatNumber(String(t)),
      net: formatNumber(String(n)),
    };

    setHistory((prev) => prev.map((r) => (r.ticketId === ticket.ticketId ? { ...r, data: { ...afterData } } : r)));
    setViewTicket((v) => ({ ...v, data: afterData }));

    if (!String(ticket.ticketId || '').startsWith('tmp-')) {
      try {
        const ticketIdValue = ticket.ticketId ?? ticket.data.ticketNo ?? null;
        if (!ticketIdValue) throw new Error('Missing ticket identifier');

        const payload = {
          gross: g !== null ? g : null,
          tare: t !== null ? t : null,
          net: n !== null ? n : null,
          consignee: afterData.consignee || null,
          container_no: afterData.containerNo || null,
          driver: afterData.driver || null,
          operator: afterData.operator || null,
          sad_no: afterData.sadNo || null,
          truck_on_wb: afterData.truckOnWb || null,
          gnsw_truck_no: afterData.truckOnWb || null,
          ticket_no: afterData.ticketNo || null,
        };

        await updateTicketsRow(payload, ticketIdValue, ticket.data.ticketNo);

        try {
          const auditEntry = {
            action: 'update',
            ticket_id: ticket.ticketId ?? ticket.data?.ticketNo ?? null,
            ticket_no: ticket.data?.ticketNo ?? null,
            user_id: operatorId || null,
            username: operatorName || null,
            details: JSON.stringify({ before: before || null, after: afterData || null }),
            created_at: new Date().toISOString(),
          };
          await supabase.from('audit_logs').insert([auditEntry]);
        } catch (auditErr) {
          console.debug('Audit log insertion failed', auditErr);
        }

        // propagate to outgate
        try {
          const oldTicketNo = ticket.data?.ticketNo ?? null;
          const newTicketNo = afterData?.ticketNo ?? oldTicketNo;
          const outPayload = {
            vehicle_number: afterData.truckOnWb || null,
            container_id: afterData.containerNo || null,
            sad_no: afterData.sadNo || null,
            gross: g !== null ? g : null,
            tare: t !== null ? t : null,
            net: n !== null ? n : null,
            driver: afterData.driver || null,
            ticket_no: newTicketNo || null,
          };

          if (isUUID(ticketIdValue)) {
            const byId = await supabase.from('outgate').update(outPayload).eq('ticket_id', ticketIdValue).select();
            if (byId.error) {
              console.warn('Failed to update outgate by ticket_id', byId.error);
            } else if (!byId.data || byId.data.length === 0) {
              if (oldTicketNo) {
                const byOldNo = await supabase.from('outgate').update(outPayload).eq('ticket_no', oldTicketNo).select();
                if (byOldNo.error) console.warn('Failed to update outgate by old ticket_no', byOldNo.error);
                else if (!byOldNo.data || byOldNo.data.length === 0) {
                  try {
                    await supabase.from('outgate').insert([{
                      ticket_no: newTicketNo || oldTicketNo,
                      ticket_id: ticketIdValue,
                      vehicle_number: afterData.truckOnWb || null,
                      container_id: afterData.containerNo || null,
                      sad_no: afterData.sadNo || null,
                      gross: g !== null ? g : null,
                      tare: t !== null ? t : null,
                      net: n !== null ? n : null,
                      driver: afterData.driver || null,
                      created_at: new Date().toISOString(),
                    }]);
                  } catch (insErr) {
                    console.warn('Failed to insert outgate row after update returned no rows', insErr);
                  }
                }
              }
            }
          } else {
            const byNo = await supabase.from('outgate').update(outPayload).eq('ticket_no', ticketIdValue).select();
            if (byNo.error) console.warn('Failed to update outgate by ticket_no', byNo.error);
            else if (!byNo.data || byNo.data.length === 0) {
              if (oldTicketNo) {
                const byOldNo = await supabase.from('outgate').update(outPayload).eq('ticket_no', oldTicketNo).select();
                if (byOldNo.error) console.warn('Failed to update outgate by old ticket_no', byOldNo.error);
                else if (!byOldNo.data || byOldNo.data.length === 0) {
                  try {
                    await supabase.from('outgate').insert([{
                      ticket_no: newTicketNo || oldTicketNo,
                      ticket_id: ticketIdValue,
                      vehicle_number: afterData.truckOnWb || null,
                      container_id: afterData.containerNo || null,
                      sad_no: afterData.sadNo || null,
                      gross: g !== null ? g : null,
                      tare: t !== null ? t : null,
                      net: n !== null ? n : null,
                      driver: afterData.driver || null,
                      created_at: new Date().toISOString(),
                    }]);
                  } catch (insErr) {
                    console.warn('Failed to insert outgate row after update returned no rows', insErr);
                  }
                }
              }
            }
          }
        } catch (outErrGeneral) {
          console.error('Outgate update/insert error', outErrGeneral);
        }

        await fetchHistory();

        // recompute authoritative manual totals after edits
        computeManualTotalsFromDB().catch((e) => console.warn('computeManualTotalsFromDB error', e));
      } catch (err) {
        console.error('Save view edit failed', err);
        toast({ title: 'Save failed', description: err?.message || 'Unexpected', status: 'error', duration: 5000 });
        setHistory((prev) => prev.map((r) => (r.ticketId === ticket.ticketId ? { ...r, data: { ...before } } : r)));
        setViewTicket((v) => ({ ...v, data: before }));
        setViewIsEditing(false);
        setViewEditData({});
        return;
      }
    }

    setViewIsEditing(false);
    setViewEditData({});
    toast({ title: 'Saved', status: 'success', duration: 2500 });
  };

  // ---------- NEW: Delete ticket (admin-only) ----------
  const handleDelete = async (ticket) => {
    if (!isAdmin) {
      toast({ title: 'Permission denied', description: 'Only admins can delete tickets', status: 'warning', duration: 2500 });
      return;
    }

    const ticketObj = ticket && ticket.ticketId ? ticket : null;
    if (!ticketObj) {
      toast({ title: 'Invalid ticket', description: 'Could not determine ticket to delete', status: 'error', duration: 3000 });
      return;
    }

    const confirmMsg = `Delete ticket ${ticketObj.data?.ticketNo || ticketObj.ticketId || ''} ? This will remove the ticket from the tickets table and attempt to remove matching outgate rows. This action is irreversible. Continue?`;
    // simple confirmation — replace with a nicer modal if you'd like
    if (!window.confirm(confirmMsg)) return;

    setDeletingTicketId(ticketObj.ticketId);
    try {
      // If it's an optimistic temp row, just remove client-side
      if (String(ticketObj.ticketId || '').startsWith('tmp-')) {
        setHistory((prev) => prev.filter((r) => r.ticketId !== ticketObj.ticketId));
        toast({ title: 'Ticket removed', description: 'Local (unsaved) ticket removed.', status: 'success' });
        setDeletingTicketId(null);
        return;
      }

      const ticketIdentifier = ticketObj.ticketId ?? ticketObj.data.ticketNo ?? null;
      if (!ticketIdentifier) throw new Error('Missing ticket identifier');

      // best-effort delete outgate rows first (to keep DB consistent)
      try {
        if (isUUID(ticketIdentifier)) {
          const del1 = await supabase.from('outgate').delete().eq('ticket_id', ticketIdentifier);
          if (del1.error) console.warn('Failed to delete outgate by ticket_id', del1.error);
          if (ticketObj.data?.ticketNo) {
            const del2 = await supabase.from('outgate').delete().eq('ticket_no', ticketObj.data.ticketNo);
            if (del2.error) console.warn('Failed to delete outgate by ticket_no', del2.error);
          }
        } else {
          const del1 = await supabase.from('outgate').delete().eq('ticket_no', ticketIdentifier);
          if (del1.error) console.warn('Failed to delete outgate by ticket_no', del1.error);
          if (ticketObj.data?.ticketNo && isUUID(ticketObj.data.ticketNo)) {
            const del2 = await supabase.from('outgate').delete().eq('ticket_id', ticketObj.data.ticketNo);
            if (del2.error) console.warn('Failed to delete outgate by ticket_id for data.ticketNo', del2.error);
          }
        }
      } catch (oute) {
        console.warn('Outgate deletion attempt failed', oute);
      }

      // delete tickets row
      let delRes;
      if (isUUID(ticketIdentifier)) {
        delRes = await supabase.from('tickets').delete().eq('ticket_id', ticketIdentifier);
      } else {
        delRes = await supabase.from('tickets').delete().eq('ticket_no', ticketIdentifier);
      }
      if (delRes && delRes.error) {
        throw delRes.error;
      }

      // write audit log
      try {
        const auditEntry = {
          action: 'delete',
          ticket_id: ticketIdentifier,
          ticket_no: ticketObj.data?.ticketNo ?? null,
          user_id: operatorId || null,
          username: operatorName || null,
          details: JSON.stringify(ticketObj.data || null),
          created_at: new Date().toISOString(),
        };
        await supabase.from('audit_logs').insert([auditEntry]);
      } catch (auditErr) {
        console.debug('Audit log insertion failed', auditErr);
      }

      // refresh UI
      await fetchHistory();
      computeManualTotalsFromDB().catch((e) => console.warn('computeManualTotalsFromDB error', e));

      toast({ title: 'Deleted', description: `Ticket ${ticketObj.data?.ticketNo || ticketObj.ticketId} deleted.`, status: 'success', duration: 4000 });
    } catch (err) {
      console.error('Delete failed', err);
      toast({ title: 'Delete failed', description: err?.message || String(err), status: 'error', duration: 6000 });
    } finally {
      setDeletingTicketId(null);
    }
  };

  const renderOutOfRangeBadge = (val) => {
    const n = numericValue(val);
    if (n === null) return null;
    if (Math.abs(n) >= OUT_OF_RANGE_THRESHOLD) {
      return <Badge colorScheme="red" ml={2}>Value out of range</Badge>;
    }
    return null;
  };

  /* -----------------------
     Voice recognition (simple)
  ----------------------- */
  const recognitionRef = useRef(null);
  const [listening, setListening] = useState(false);

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
      if (text.includes('new ticket') || text.includes('create ticket') || text.includes('new manual')) {
        onOpen();
      } else if (text.includes('submit ticket') || text.includes('submit') || text.includes('save ticket')) {
        handleSubmit();
      } else if (text.includes('reset form')) {
        setFormData({
          truckOnWb: '',
          consignee: '',
          operation: '',
          driver: '',
          sadNo: '',
          containerNo: '',
          gross: '',
          tare: '',
          net: '',
        });
        toast({ title: 'Form reset', status: 'info' });
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
    toast({ title: 'Listening', description: 'Say a command: "New ticket", "Submit ticket", "Reset form"', status: 'info' });
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

  /* -----------------------
     Floating orb + styling + cube animation (pure CSS)
  ----------------------- */

  const Orb = ({ onClick }) => {
    return (
      <MotionBox
        onClick={onClick}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.96 }}
        cursor="pointer"
        width="64px"
        height="64px"
        borderRadius="999px"
        display="flex"
        alignItems="center"
        justifyContent="center"
        boxShadow="0 12px 30px rgba(59,130,246,0.16)"
        style={{
          background: 'linear-gradient(90deg,#7b61ff,#3ef4d0)',
          color: '#fff',
          position: 'relative',
          overflow: 'visible',
        }}
        title="New manual ticket"
      >
        <span style={{ fontSize: 26, fontWeight: 700 }}>✺</span>
        {/* subtle glow */}
        <Box as="span" className="orb-glow" />
        <style>{`
          .orb-glow {
            position: absolute;
            width: 120px;
            height: 120px;
            border-radius: 50%;
            filter: blur(18px);
            opacity: 0.18;
            background: radial-gradient(circle at 30% 30%, rgba(255,255,255,0.18), rgba(0,0,0,0));
            transform: translate(-10px,-10px);
            pointer-events: none;
          }
        `}</style>
      </MotionBox>
    );
  };

  /* small card view component */
  const HistoryCard = ({ item }) => {
    const computed = computeWeights({ gross: item.data.gross, tare: item.data.tare, net: item.data.net });
    return (
      <MotionBox
        whileHover={{ y: -6 }}
        p={4}
        borderRadius="12px"
        border="1px solid"
        borderColor="rgba(2,6,23,0.06)"
        bg="linear-gradient(180deg, rgba(255,255,255,0.98), rgba(255,255,255,0.96))"
        boxShadow="0 8px 24px rgba(2,6,23,0.04)"
      >
        <Flex justify="space-between" align="center">
          <Box>
            <Text fontWeight="bold">{item.data.ticketNo}</Text>
            <Text fontSize="sm" color="gray.500">{item.data.truckOnWb || 'N/A'} • SAD: {item.data.sadNo || 'N/A'}</Text>
          </Box>
          <Box textAlign="right">
            {item.data.manual && String(item.data.manual).toLowerCase() === 'yes' && <Badge colorScheme="purple">Manual</Badge>}
            <Text fontSize="xs" color="gray.500">{new Date(item.submittedAt).toLocaleString()}</Text>
          </Box>
        </Flex>

        <Flex mt={3} justify="space-between">
          <Box>
            <Text fontSize="xs" color="gray.500">Gross</Text>
            <Text fontWeight="semibold">{computed.grossDisplay || '—'}</Text>
          </Box>
          <Box>
            <Text fontSize="xs" color="gray.500">Tare</Text>
            <Text fontWeight="semibold">{computed.tareDisplay || '—'}</Text>
          </Box>
          <Box>
            <Text fontSize="xs" color="gray.500">Net</Text>
            <Text fontWeight="semibold">{computed.netDisplay || '—'}</Text>
          </Box>
        </Flex>

        <Flex mt={3} justify="flex-end" gap={2}>
          {item.data.fileUrl && (
            <Button size="sm" variant="outline" onClick={() => window.open(item.data.fileUrl, '_blank', 'noopener')}>Open PDF</Button>
          )}
          <Button size="sm" colorScheme="teal" onClick={() => handleView(item)}>View</Button>
          {isAdmin && <Button size="sm" variant="ghost" leftIcon={<EditIcon />} onClick={() => startRowEdit(item)}>Edit</Button>}
          {isAdmin && (
            <Button
              size="sm"
              variant="ghost"
              leftIcon={<DeleteIcon />}
              colorScheme="red"
              onClick={() => handleDelete(item)}
              isLoading={deletingTicketId === item.ticketId}
            >
              Delete
            </Button>
          )}
        </Flex>
      </MotionBox>
    );
  };

  /* -----------------------
     Render
  ----------------------- */
  return (
    <Box p={{ base: 4, md: 6 }} maxW="1200px" mx="auto" style={{ fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial' }}>
      <Flex align="center" mb={6} gap={4} wrap="wrap">
        <Box>
          <Heading size="lg">Manual Ticket Entry</Heading>
          <Text color="gray.500">Create manual tickets quickly — improved UI & ergonomics.</Text>
        </Box>

        <Spacer />

        <HStack spacing={3}>
          <Tooltip label={listening ? 'Stop voice' : 'Start voice commands'}>
            <Button size="sm" variant={listening ? 'solid' : 'outline'} colorScheme={listening ? 'purple' : 'gray'} onClick={() => (listening ? stopVoice() : startVoice())}>
              {listening ? 'Listening...' : 'Voice'}
            </Button>
          </Tooltip>

          <Button size="sm" colorScheme="teal" onClick={onOpen}>New Manual Ticket</Button>
        </HStack>
      </Flex>

      {/* Stats cards (neon gradients + glassmorphism) */}
      <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4} mb={6}>
        <Stat
          p={4}
          borderRadius="md"
          boxShadow="lg"
          style={{
            background: 'linear-gradient(135deg,#fff8f0, #fff2e6)',
            border: '1px solid rgba(255,255,255,0.6)',
            backdropFilter: 'blur(6px)',
          }}
        >
          <StatLabel>Total Manual Tickets</StatLabel>
          <StatNumber>{manualTotals.count ?? manualCount ?? 0}</StatNumber>
          <StatHelpText>Tickets with ticket_no starting with "M-"</StatHelpText>
        </Stat>

        <Stat
          p={4}
          borderRadius="md"
          boxShadow="lg"
          style={{
            background: 'linear-gradient(135deg,#E0FCFF,#E8FDF6)',
            border: '1px solid rgba(255,255,255,0.6)',
            backdropFilter: 'blur(6px)',
          }}
        >
          <StatLabel>Total Gross</StatLabel>
          <StatNumber>{(manualTotals.totalGross !== null && manualTotals.totalGross !== undefined) ? `${formatNumber(String(manualTotals.totalGross))} kg` : '—'}</StatNumber>
          <StatHelpText>Sum of gross weights for manual tickets</StatHelpText>
        </Stat>

        <Stat
          p={4}
          borderRadius="md"
          boxShadow="lg"
          style={{
            background: 'linear-gradient(135deg,#F5F3FF,#EEF2FF)',
            border: '1px solid rgba(255,255,255,0.6)',
            backdropFilter: 'blur(6px)',
          }}
        >
          <StatLabel>Total Net</StatLabel>
          <StatNumber>{(manualTotals.totalNet !== null && manualTotals.totalNet !== undefined) ? `${formatNumber(String(manualTotals.totalNet))} kg` : '—'}</StatNumber>
          <StatHelpText>Sum of net weights for manual tickets</StatHelpText>
        </Stat>
      </SimpleGrid>

      <Flex mb={4} gap={4} align="center" wrap="wrap">
        <Input placeholder="Search by SAD, Truck on WB, Ticket No..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} maxW="480px" />
        <FormControl maxW="200px">
          <FormLabel mb={1} fontSize="sm">Status</FormLabel>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} size="sm">
            <option value="">All</option>
            <option value="Pending">Pending</option>
            <option value="Exited">Exited</option>
          </Select>
        </FormControl>

        <Spacer />

        <Text fontSize="sm" color="gray.500">Showing {filteredHistory.length} tickets</Text>
      </Flex>

      {/* History */}
      {filteredHistory.length === 0 ? (
        <Text color="gray.600">No tickets found.</Text>
      ) : (
        <>
          {isMobile ? (
            <VStack spacing={3} align="stretch">
              {pagedHistory.map((t) => <HistoryCard key={t.ticketId} item={t} />)}
            </VStack>
          ) : (
            <Box borderRadius="md" overflowX="auto" bg="white" p={2} boxShadow="sm">
              <Table variant="striped" colorScheme="teal" size="sm">
                <Thead>
                  <Tr>
                    <Th>Ticket No</Th>
                    <Th>Truck No</Th>
                    <Th>SAD No</Th>
                    <Th>Gross (KG)</Th>
                    <Th>Tare (KG)</Th>
                    <Th>Net (KG)</Th>
                    <Th>Actions</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {pagedHistory.map(({ ticketId, data, submittedAt }) => {
                    const computed = computeWeights({ gross: data.gross, tare: data.tare, net: data.net });
                    const anomaly = (computed.grossValue !== null && computed.tareValue !== null && computed.netValue !== null && !(computed.grossValue > computed.tareValue));
                    const isEditingThis = editingRowId === ticketId;
                    return (
                      <Tr key={ticketId}>
                        <Td>
                          <Flex align="center" gap={2}>
                            {isEditingThis ? (
                              <Input value={editRowData.ticketNo ?? data.ticketNo} onChange={(e) => handleRowFieldChange('ticketNo', e.target.value)} size="sm" />
                            ) : (
                              <Box>
                                <Text>{data.ticketNo}</Text>
                                {data.manual && String(data.manual).toLowerCase() === 'yes' && <Badge ml={2} colorScheme="purple">Manual</Badge>}
                              </Box>
                            )}
                          </Flex>
                        </Td>

                        <Td>
                          {isEditingThis ? (
                            <Input value={editRowData.truckOnWb ?? data.truckOnWb} onChange={(e) => handleRowFieldChange('truckOnWb', e.target.value)} size="sm" />
                          ) : (
                            <Text>{data.truckOnWb}</Text>
                          )}
                        </Td>

                        <Td>
                          {isEditingThis ? (
                            <Input value={editRowData.sadNo ?? data.sadNo} onChange={(e) => handleRowFieldChange('sadNo', e.target.value)} size="sm" />
                          ) : (
                            <Text>{data.sadNo}</Text>
                          )}
                        </Td>

                        <Td>
                          <Box display="flex" alignItems="center" gap={2}>
                            {isEditingThis ? (
                              <InputGroup size="sm">
                                <Input value={editRowData.gross ?? data.gross} onChange={(e) => handleRowFieldChange('gross', e.target.value)} />
                                <InputRightElement width="3rem">
                                  <Text fontSize="xs">{renderOutOfRangeBadge(editRowData.gross ?? data.gross)}</Text>
                                </InputRightElement>
                              </InputGroup>
                            ) : (
                              <Text>{computed.grossDisplay}</Text>
                            )}
                          </Box>
                        </Td>

                        <Td>
                          <Box display="flex" alignItems="center" gap={2}>
                            {isEditingThis ? (
                              <InputGroup size="sm">
                                <Input value={editRowData.tare ?? data.tare} onChange={(e) => handleRowFieldChange('tare', e.target.value)} />
                                <InputRightElement width="3rem">
                                  <Text fontSize="xs">{renderOutOfRangeBadge(editRowData.tare ?? data.tare)}</Text>
                                </InputRightElement>
                              </InputGroup>
                            ) : (
                              <Box display="flex" alignItems="center" gap={2}>
                                <Text>{computed.tareDisplay}</Text>
                                {isTareAnomaly && data.truckOnWb && String(data.truckOnWb).trim() === String(formData.truckOnWb).trim() && (
                                  <Badge colorScheme="red">Tare anomaly</Badge>
                                )}
                              </Box>
                            )}
                          </Box>
                        </Td>

                        <Td>
                          <Box display="flex" alignItems="center" gap={2}>
                            {isEditingThis ? (
                              <InputGroup size="sm">
                                <Input value={editRowData.net ?? data.net} onChange={(e) => handleRowFieldChange('net', e.target.value)} />
                                <InputRightElement width="3rem">
                                  <Text fontSize="xs">{renderOutOfRangeBadge(editRowData.net ?? data.net)}</Text>
                                </InputRightElement>
                              </InputGroup>
                            ) : (
                              <Box display="flex" alignItems="center" gap={2}>
                                <Text>{computed.netDisplay}</Text>
                                {anomaly && <Badge colorScheme="red">Check</Badge>}
                                {renderOutOfRangeBadge(data.net)}
                              </Box>
                            )}
                          </Box>
                        </Td>

                        <Td>
                          <HStack>
                            {data.fileUrl && (
                              <IconButton icon={<ExternalLinkIcon />} aria-label="Open file" size="sm" colorScheme="blue" onClick={() => window.open(data.fileUrl, '_blank', 'noopener')} />
                            )}

                            {isEditingThis ? (
                              <>
                                <IconButton icon={<CheckIcon />} aria-label="Save" size="sm" colorScheme="green" onClick={() => saveRowEdit({ ticketId, data })} />
                                <IconButton icon={<CloseIcon />} aria-label="Cancel" size="sm" onClick={cancelRowEdit} />
                              </>
                            ) : (
                              <>
                                <IconButton icon={<ViewIcon />} aria-label="View" size="sm" colorScheme="teal" onClick={() => handleView({ ticketId, data, submittedAt })} />
                                {isAdmin && <IconButton icon={<EditIcon />} aria-label="Edit" size="sm" onClick={() => startRowEdit({ ticketId, data })} />}
                                {isAdmin && (
                                  <IconButton
                                    icon={<DeleteIcon />}
                                    aria-label="Delete"
                                    size="sm"
                                    colorScheme="red"
                                    onClick={() => handleDelete({ ticketId, data })}
                                    isLoading={deletingTicketId === ticketId}
                                  />
                                )}
                              </>
                            )}
                          </HStack>
                        </Td>
                      </Tr>
                    );
                  })}
                </Tbody>
              </Table>
            </Box>
          )}

          {/* Pagination */}
          <Flex justify="space-between" align="center" mt={4} gap={3} flexWrap="wrap">
            <Flex gap={2} align="center" flexWrap="wrap">
              <Button size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} isDisabled={page === 1}>Previous</Button>

              <HStack spacing={1} ml={2} wrap="wrap">
                {pageItems.map((it, idx) => (
                  <Button
                    key={`${it}-${idx}`}
                    size="sm"
                    onClick={() => handlePageClick(it)}
                    colorScheme={it === page ? 'teal' : 'gray'}
                    variant={it === page ? 'solid' : 'outline'}
                    isDisabled={it === '...'}
                  >
                    {it}
                  </Button>
                ))}
              </HStack>

              <Button size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} isDisabled={page === totalPages}>Next</Button>
            </Flex>

            <Text>Page {page} of {totalPages} ({totalTickets} tickets)</Text>

            <Box>
              <Text fontSize="sm" color="gray.600">{/* placeholder */}</Text>
            </Box>
          </Flex>

          <Box mt={3} display="flex" justifyContent="flex-end" gap={2} alignItems="center">
            <Text>Rows per page:</Text>
            <Select size="sm" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} width="80px">
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </Select>
          </Box>
        </>
      )}

      {/* New Manual Ticket Modal (glassmorphism + 3D cubes), modal background set to white per request */}
      <Modal
        isOpen={isOpen}
        onClose={isSubmitting ? () => {} : onClose}
        size="xl"
        scrollBehavior="inside"
        initialFocusRef={firstInputRef}
        isCentered
      >
        <ModalOverlay />
        <AnimatePresence>
          {isOpen && (
            <ModalContent
              as={MotionBox}
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10 }}
              style={{
                /* background white as requested (holographic elements still present) */
                background: 'linear-gradient(180deg,#ffffff,#fbfbff)',
                border: '1px solid rgba(255,255,255,0.6)',
                backdropFilter: 'blur(6px) saturate(120%)',
                boxShadow: '0 12px 40px rgba(2,6,23,0.12)',
              }}
            >
              <ModalHeader>
                <Flex align="center" gap={3}>
                  <Box
                    width="56px"
                    height="56px"
                    borderRadius="12px"
                    style={{
                      background: 'linear-gradient(135deg,#7b61ff,#3ef4d0)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#fff',
                      boxShadow: '0 8px 24px rgba(62,244,208,0.12)',
                    }}
                  >
                    ✺
                  </Box>
                  <Box>
                    <Text fontSize="lg" fontWeight="bold">Manual Ticket Submission</Text>
                    <Text fontSize="sm" color="gray.600">Crystal orb → holographic modal ✨</Text>
                  </Box>
                </Flex>
              </ModalHeader>

              <ModalCloseButton isDisabled={isSubmitting} />

              <ModalBody>
                {/* floating cubes / 3D effect (CSS) */}
                <Box mb={4}>
                  <div style={{ position: 'relative', height: 72 }}>
                    <div style={{
                      position: 'absolute',
                      right: 0,
                      top: 0,
                      width: 120,
                      height: 72,
                      pointerEvents: 'none',
                      opacity: 0.12,
                    }}>
                      {/* simple CSS cubes */}
                      <div style={{
                        width: 18, height: 18, background: 'linear-gradient(135deg,#fff,#e0f7ff)',
                        transform: 'rotateX(20deg) rotateY(8deg)', borderRadius: 3, boxShadow: '0 8px 20px rgba(0,0,0,0.06)',
                        position: 'absolute', right: 16, top: 6, animation: 'floaty 4s ease-in-out infinite',
                      }} />
                      <div style={{
                        width: 14, height: 14, background: 'linear-gradient(135deg,#FFF4F4,#ffe6f2)',
                        transform: 'rotateX(18deg) rotateY(6deg)', borderRadius: 3, boxShadow: '0 8px 20px rgba(0,0,0,0.06)',
                        position: 'absolute', right: 46, top: 22, animation: 'floaty 5s ease-in-out -1s infinite',
                      }} />
                      <style>{`
                        @keyframes floaty {
                          0% { transform: translateY(0) rotateX(10deg) rotateY(6deg) }
                          50% { transform: translateY(-8px) rotateX(10deg) rotateY(6deg) }
                          100% { transform: translateY(0) rotateX(10deg) rotateY(6deg) }
                        }
                      `}</style>
                    </div>
                  </div>
                </Box>

                <SimpleGrid columns={[1, 2]} spacing={4}>
                  <FormControl isRequired isInvalid={!!errors.truckOnWb}>
                    <FormLabel>Truck Number <Text as="span" color="red">*</Text></FormLabel>
                    <Input
                      ref={firstInputRef}
                      value={formData.truckOnWb}
                      onChange={(e) => handleChange('truckOnWb', e.target.value)}
                      placeholder="Enter Truck (GNSW plate)"
                      isDisabled={isSubmitting}
                    />
                    <FormErrorMessage>{errors.truckOnWb}</FormErrorMessage>
                  </FormControl>

                  <FormControl isRequired isInvalid={!!errors.sadNo}>
                    <FormLabel>SAD Number <Text as="span" color="red">*</Text></FormLabel>
                    <Input value={formData.sadNo} onChange={(e) => handleChange('sadNo', e.target.value)} placeholder="Enter SAD No" isDisabled={isSubmitting} />
                    <FormErrorMessage>{errors.sadNo}</FormErrorMessage>
                  </FormControl>

                  <FormControl isRequired isInvalid={!!errors.operation}>
                    <FormLabel>Operation <Text as="span" color="red">*</Text></FormLabel>
                    <Select placeholder="Select operation" value={formData.operation} onChange={(e) => handleChange('operation', e.target.value)} isDisabled={isSubmitting}>
                      <option value="Import">Import</option>
                      <option value="Export">Export</option>
                    </Select>
                    <FormErrorMessage>{errors.operation}</FormErrorMessage>
                  </FormControl>

                  <FormControl>
                    <FormLabel>Container Number</FormLabel>
                    <Input value={formData.containerNo} onChange={(e) => handleChange('containerNo', e.target.value)} placeholder="Container No (optional)" isDisabled={isSubmitting} />
                  </FormControl>

                  <FormControl>
                    <FormLabel>Consignee</FormLabel>
                    <Input value={formData.consignee} onChange={(e) => handleChange('consignee', e.target.value)} placeholder="Consignee (optional)" isDisabled={isSubmitting} />
                  </FormControl>

                  <FormControl>
                    <FormLabel>Driver Name</FormLabel>
                    <Input value={formData.driver} onChange={(e) => handleChange('driver', e.target.value)} placeholder="Driver name (optional)" isDisabled={isSubmitting} />
                  </FormControl>

                  <FormControl isRequired isInvalid={!!errors.gross}>
                    <FormLabel>Gross Weight<Text as="span" color="red">*</Text></FormLabel>
                    <NumericInput
                      name="gross"
                      rawValue={formData.gross}
                      onRawChange={(v) => updateNumericField('gross', v)}
                      placeholder="Enter gross (kg)"
                      isDisabled={isSubmitting}
                    />
                    <FormErrorMessage>{errors.gross}</FormErrorMessage>
                  </FormControl>

                  <FormControl isRequired isInvalid={!!errors.tare}>
                    <HStack justify="space-between">
                      <FormLabel>Tare (PT) <Text as="span" color="red">*</Text></FormLabel>
                      <HStack spacing={2}>
                        {isTareAuto && <Badge colorScheme="green">Auto-filled</Badge>}
                        {fetchingTare && <Text fontSize="sm" color="gray.500">Looking up tare…</Text>}
                        {isTareAuto && (
                          <Button size="xs" variant="link" onClick={() => { setIsTareAuto(false); setSaveTare(true); }} isDisabled={isSubmitting}>
                            Override
                          </Button>
                        )}
                      </HStack>
                    </HStack>

                    <NumericInput
                      name="tare"
                      rawValue={formData.tare}
                      onRawChange={(v) => updateNumericField('tare', v)}
                      placeholder="Enter tare (kg)"
                      isReadOnly={isTareAuto}
                      isDisabled={isSubmitting}
                      inputProps={{
                        borderColor: isTareAnomaly ? 'red.400' : undefined,
                        borderWidth: isTareAnomaly ? '2px' : undefined,
                      }}
                    />

                    {(vehicleSummary || (lastTares && lastTares.length > 0)) && (
                      <Box mt={2}>
                        <Text fontSize="sm" color="gray.600" mb={1}>
                          Suggestions:
                          {vehicleSummary && vehicleSummary.avg_tare ? ` Avg ${formatNumber(String(vehicleSummary.avg_tare))} kg (${vehicleSummary.entry_count || 1} entries)` : ''}
                          {vehicleSummary && vehicleSummary.updated_at ? ` • last: ${new Date(vehicleSummary.updated_at).toLocaleDateString()}` : ''}
                        </Text>

                        <HStack spacing={2} wrap="wrap">
                          {vehicleSummary && vehicleSummary.avg_tare && (
                            <Badge
                              cursor="pointer"
                              onClick={() => handlePickSuggestedTare(`avg:${vehicleSummary.avg_tare}`)}
                              colorScheme="green"
                              px={2}
                              py={1}
                            >
                              Avg: {formatNumber(String(vehicleSummary.avg_tare))} kg
                            </Badge>
                          )}

                          {lastTares && lastTares.slice(0, 3).map((h, idx) => (
                            <Badge
                              key={`b-${idx}`}
                              cursor="pointer"
                              onClick={() => handlePickSuggestedTare(`hist:${encodeURIComponent(JSON.stringify({ tare: h.tare, recorded_at: h.recorded_at }))}`)}
                              colorScheme="blue"
                              px={2}
                              py={1}
                            >
                              Recent: {formatNumber(String(h.tare))} kg — {new Date(h.recorded_at).toLocaleDateString()}
                            </Badge>
                          ))}
                        </HStack>

                        {isTareAnomaly && (
                          <Text mt={2} fontSize="sm" color="red.500">
                            Warning: entered tare differs from historical prediction by more than 5%.
                          </Text>
                        )}

                        <Text fontSize="xs" color="gray.500" mt={1}>
                          Click a suggestion to apply it. You can always override.
                        </Text>
                      </Box>
                    )}

                    {!isTareAuto && (formData.truckOnWb || '').trim() && !tareRecordExists && (
                      <HStack mt={2} align="center">
                        <Checkbox size="sm" isChecked={saveTare} onChange={(e) => setSaveTare(e.target.checked)} isDisabled={isSubmitting}>
                          Save this tare for {formData.truckOnWb}
                        </Checkbox>
                        <Text fontSize="sm" color="gray.500">(optional)</Text>
                      </HStack>
                    )}

                    <FormErrorMessage>{errors.tare}</FormErrorMessage>
                  </FormControl>

                  <FormControl isRequired isInvalid={!!errors.net}>
                    <FormLabel>Net Weight <Text as="span" color="red">*</Text></FormLabel>
                    <NumericInput
                      name="net"
                      rawValue={formData.net}
                      onRawChange={() => {}}
                      placeholder="Net (auto-calculated: Gross − Tare)"
                      isReadOnly={true}
                      isDisabled={isSubmitting}
                    />
                    <FormErrorMessage>{errors.net}</FormErrorMessage>
                  </FormControl>
                </SimpleGrid>
              </ModalBody>

              <ModalFooter>
                <HStack spacing={3}>
                  <Button colorScheme="teal" mr={3} onClick={handleSubmit} isLoading={isSubmitting} isDisabled={isSubmitting}>
                    Submit Ticket
                  </Button>
                  <Button variant="ghost" onClick={onClose} isDisabled={isSubmitting}>Cancel</Button>
                </HStack>
              </ModalFooter>
            </ModalContent>
          )}
        </AnimatePresence>
      </Modal>

      {/* View modal */}
      <Modal isOpen={isViewOpen} onClose={() => { onViewClose(); setViewIsEditing(false); setViewEditData({}); }} size="xl" scrollBehavior="inside" isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>View Ticket</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {viewTicket ? (
              <Box>
                <SimpleGrid columns={[1, 2]} spacing={4}>
                  {Object.entries(viewIsEditing ? viewEditData : viewTicket.data).map(([key, value]) => {
                    if (key === 'fileUrl') return null;
                    const computedKeys = ['gross', 'tare', 'net'];
                    if (computedKeys.includes(key)) {
                      const computed = computeWeights({
                        gross: (viewIsEditing ? viewEditData.gross : viewTicket.data.gross),
                        tare: (viewIsEditing ? viewEditData.tare : viewTicket.data.tare),
                        net: (viewIsEditing ? viewEditData.net : viewTicket.data.net),
                      });
                      const display = key === 'gross' ? computed.grossDisplay : key === 'tare' ? computed.tareDisplay : computed.netDisplay;
                      return (
                        <Box key={key} p={3} borderWidth="1px" borderRadius="md" bg="gray.50">
                          <Text fontWeight="semibold" color="teal.600" mb={1}>{key}</Text>
                          {viewIsEditing ? (
                            <Input value={viewEditData[key] ?? ''} onChange={(e) => handleViewEditChange(key, e.target.value)} />
                          ) : (
                            <Text>{display || 'N/A'}</Text>
                          )}
                          <Box mt={1}>{renderOutOfRangeBadge(viewIsEditing ? viewEditData[key] : viewTicket.data[key])}</Box>
                        </Box>
                      );
                    }

                    return (
                      <Box key={key} p={3} borderWidth="1px" borderRadius="md" bg="gray.50">
                        <Text fontWeight="semibold" color="teal.600" mb={1} textTransform="capitalize">{key}</Text>
                        {viewIsEditing ? (
                          <Input value={viewEditData[key] ?? ''} onChange={(e) => handleViewEditChange(key, e.target.value)} />
                        ) : (
                          <Text>{value ?? 'N/A'}</Text>
                        )}
                      </Box>
                    );
                  })}
                </SimpleGrid>

                {viewTicket.data && viewTicket.data.fileUrl && (
                  <Box mt={6}>
                    <Text fontWeight="bold" color="teal.600" mb={2}>Attached PDF:</Text>
                    <Box borderWidth="1px" borderRadius="md" overflow="hidden" height={{ base: '300px', md: '600px' }}>
                      <iframe src={viewTicket.data.fileUrl} width="100%" height="100%" title="Ticket PDF" style={{ border: 'none' }} />
                    </Box>
                    <Box mt={2}>
                      <Button size="sm" variant="outline" onClick={() => window.open(viewTicket.data.fileUrl, '_blank', 'noopener')}>Open in new tab</Button>
                    </Box>
                  </Box>
                )}

                <Box mt={6} p={3} borderTop="1px" borderColor="gray.200">
                  <Text fontWeight="bold" color="teal.600">Submitted At:</Text>
                  <Text>{new Date(viewTicket.submittedAt).toLocaleString()}</Text>
                </Box>
              </Box>
            ) : (
              <Text>No data</Text>
            )}
          </ModalBody>
          <ModalFooter>
            {!viewIsEditing && isAdmin && (
              <Button leftIcon={<EditIcon />} colorScheme="yellow" mr={2} onClick={startViewEdit}>Edit</Button>
            )}
            {viewIsEditing && (
              <>
                <Button leftIcon={<CheckIcon />} colorScheme="green" mr={2} onClick={saveViewEdit}>Save</Button>
                <Button leftIcon={<CloseIcon />} variant="ghost" mr={2} onClick={cancelViewEdit}>Cancel</Button>
              </>
            )}
            <Button onClick={() => { onViewClose(); setViewIsEditing(false); setViewEditData({}); }}>Close</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Floating orb CTA */}
      <Box position="fixed" bottom="28px" right="28px" zIndex={2200} display="flex" alignItems="center" gap={3}>
        <Orb onClick={onOpen} />
      </Box>
    </Box>
  );
}
