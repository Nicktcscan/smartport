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
  Progress,
  VStack,
  useBreakpointValue,
  Stack,
} from '@chakra-ui/react';
import { ViewIcon, ExternalLinkIcon } from '@chakra-ui/icons';
import { supabase } from '../supabaseClient';

/* -----------------------
   Top-level constants (stable references)
   ----------------------- */
const REQUIRED_FIELDS = ['truckOnWb', 'operation', 'gross', 'tare', 'net', 'sadNo'];

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

/* Compute missing weights given gross/tare/net
   Standard weighbridge rules (Net = Gross - Tare)
*/
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

/* NumericInput: shows formatted value but reports unformatted (digits+dot) to parent.
   Implements caret preservation by counting numeric characters left of caret.
*/
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
   Condensed pagination helper (same as WeighbridgeManagementPage)
   ----------------------- */
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

/* -----------------------
   Ticket generation utility (keeps your M-#### pattern)
   ----------------------- */
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
      const m = String(t).trim().match(re);
      if (m && m[1]) {
        const n = parseInt(m[1].replace(/^0+/, '') || m[1], 10);
        if (!isNaN(n) && n > maxNum) maxNum = n;
      }
    }

    const next = maxNum + 1;
    return `M-${String(next).padStart(4, '0')}`;
  } catch (err) {
    console.error('getNextTicketNoFromDB error', err);
    let maxNum = 0;
    const re = /^M-(\d+)$/i;
    for (const h of localHistory) {
      const t = h.data?.ticketNo;
      const m = String(t).trim().match(re);
      if (m && m[1]) {
        const n = parseInt(m[1].replace(/^0+/, '') || m[1], 10);
        if (!isNaN(n) && n > maxNum) maxNum = n;
      }
    }
    return `M-${String(maxNum + 1).padStart(4, '0')}`;
  }
}

/* Insert with retry to reduce chance of duplicate ticket_no collisions */
async function insertTicketWithRetry(insertData, historyRef = [], retryLimit = 5) {
  let attempt = 0;
  while (attempt < retryLimit) {
    attempt += 1;
    const nextTicketNo = await getNextTicketNoFromDB(historyRef);
    insertData.ticket_no = nextTicketNo;
    insertData.ticket_id = nextTicketNo;

    const { data, error } = await supabase.from('tickets').insert([insertData]);
    if (!error) {
      return { data, error: null, ticketNo: nextTicketNo };
    }

    const msg = String(error?.message || '').toLowerCase();
    if (msg.includes('duplicate') || msg.includes('unique')) {
      console.warn(`ticket_no collision on attempt ${attempt} (${nextTicketNo}), retrying...`);
      await new Promise((res) => setTimeout(res, 120 * attempt));
      continue;
    }

    return { data: null, error, ticketNo: null };
  }

  return { data: null, error: new Error('Too many retries generating ticket number'), ticketNo: null };
}

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

  /* Fetch tare for truck (debounced) */
  const fetchTareForTruck = useCallback(async (truckNo) => {
    if (!truckNo) return;
    setFetchingTare(true);
    try {
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

      // update state only if changed
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
     Load tickets and operator at mount
  ----------------------- */
  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const { data, error } = await supabase
          .from('tickets')
          .select('*')
          .order('submitted_at', { ascending: false })
          .limit(2000);

        if (error) {
          console.warn('Error loading tickets', error);
          toast({ title: 'Error loading tickets', description: error.message || String(error), status: 'error', duration: 5000, isClosable: true });
        } else if (Array.isArray(data)) {
          const mapped = data.map((item, idx) => {
            const ticketId = item.ticket_id ?? item.id ?? item.ticket_no ?? `unknown-${idx}-${Date.now()}`;

            // canonical truck: gnsw_truck_no preferred, else truck_on_wb, else truckOnWb
            const truck =
              (item.gnsw_truck_no && String(item.gnsw_truck_no).trim()) ||
              (item.truck_on_wb && String(item.truck_on_wb).trim()) ||
              (item.truckOnWb && String(item.truckOnWb).trim()) ||
              '';

            // normalize numeric fields for display
            const grossVal = (item.gross !== null && item.gross !== undefined) ? String(item.gross) : '';
            const tareVal = (item.tare !== null && item.tare !== undefined) ? String(item.tare) : '';
            const netVal = (item.net !== null && item.net !== undefined) ? String(item.net) : '';

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
                manual: item.manual ?? 'Yes',
                operator: item.operator ?? '',
                status: item.status ?? '',
                fileUrl: item.file_url ?? null,
              },
              submittedAt: item.submitted_at ?? new Date().toISOString(),
            };
          });

          if (mounted) {
            setHistory(mapped);
            setPage(1);
          }
        }

        try {
          let currentUser = null;
          if (supabase.auth?.getUser) {
            const { data: userData, error: userErr } = await supabase.auth.getUser();
            if (!userErr) currentUser = userData?.user || null;
          } else if (supabase.auth?.user) {
            currentUser = supabase.auth.user();
          }

          if (currentUser) {
            const { data: userRow } = await supabase.from('users').select('full_name, username').eq('id', currentUser.id).maybeSingle();
            setOperatorName((userRow && (userRow.full_name || userRow.username)) || currentUser.email || '');
            setOperatorId(currentUser.id);
          }
        } catch (e) {
          console.warn('Could not determine operator', e);
        }
      } catch (err) {
        console.error('load error', err);
      }
    }

    load();
    return () => { mounted = false; };
  }, [toast]);

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
        manual: 'Yes',
        operator: operatorName || '',
        status: 'Pending',
        fileUrl: null,
      },
      submittedAt: new Date().toISOString(),
      __optimistic: true,
    };

    setHistory((prev) => [tempTicket, ...prev]);

    // canonical truck value (we store it to gnsw_truck_no)
    const truck = formDataRef.current.truckOnWb || null;

    // Build insert payload: prefer canonical names used elsewhere
    const insertData = {
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
      manual: 'Yes', // canonical manual flag
      operator: operatorName || null,
      operator_id: operatorId || null,
      gross: computed.grossValue !== null ? computed.grossValue : null,
      tare: computed.tareValue !== null ? computed.tareValue : null,
      net: computed.netValue !== null ? computed.netValue : null,
      status: 'Pending',
    };

    try {
      const { data, error, ticketNo } = await insertTicketWithRetry(insertData, history, 5);
      if (error) {
        setHistory((prev) => prev.filter((r) => r.ticketId !== tempId));
        toast({ title: 'Submit failed', description: error.message || String(error), status: 'error', duration: 5000, isClosable: true });
        setIsSubmitting(false);
        return;
      }

      const newTicketNo = ticketNo || (data && data[0] && data[0].ticket_no) || 'M-0001';

      // record tare history if requested
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
            const avg = tares.length > 0 ? sum / tares.length : computed.tareValue;
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

      const saved = {
        ticketId: newTicketNo,
        data: {
          ticketNo: newTicketNo,
          truckOnWb: formDataRef.current.truckOnWb || '',
          consignee: formDataRef.current.consignee || '',
          operation: formDataRef.current.operation || '',
          driver: formDataRef.current.driver || '',
          sadNo: formDataRef.current.sadNo || '',
          containerNo: formDataRef.current.containerNo || '',
          gross: computed.grossDisplay,
          tare: computed.tareDisplay,
          net: computed.netDisplay,
          manual: 'Yes',
          operator: operatorName || '',
          status: 'Pending',
          fileUrl: null,
        },
        submittedAt: new Date().toISOString(),
      };

      setHistory((prev) => prev.map((r) => (r.ticketId === tempId ? saved : r)));

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

    // explicit sort newest -> oldest by submittedAt
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

  // condensed pagination items
  const pageItems = getCondensedPages(page, totalPages);

  const handlePageClick = (n) => {
    if (n === '...') return;
    setPage(n);
  };

  // stats summary
  const stats = useMemo(() => {
    const manualOnly = history.filter((h) => h.data.manual && String(h.data.manual).toLowerCase() === 'yes');
    const count = manualOnly.length;
    if (count === 0) return { count: 0, avgGross: null, avgNet: null };
    const grossVals = manualOnly.map((m) => numericValue(m.data.gross)).filter((n) => n !== null);
    const netVals = manualOnly.map((m) => numericValue(m.data.net)).filter((n) => n !== null);
    const avgGross = grossVals.length ? grossVals.reduce((a, b) => a + b, 0) / grossVals.length : null;
    const avgNet = netVals.length ? netVals.reduce((a, b) => a + b, 0) / netVals.length : null;
    return { count, avgGross, avgNet };
  }, [history]);

  // responsive: mobile cards vs desktop table
  const isMobile = useBreakpointValue({ base: true, md: false });

  /* -----------------------
     Render
  ----------------------- */
  return (
    <Box p={6} maxW="1200px" mx="auto">
      <Heading mb={6}>Manual Ticket Entry</Heading>

      <Flex gap={4} align="center" mb={6} wrap="wrap">
        <Button onClick={onOpen} colorScheme="teal">New Manual Ticket</Button>

        <Box ml="auto" display="flex" gap={4} alignItems="center" flexWrap="wrap">
          <Box>
            <Text fontSize="sm" color="gray.600">Manual tickets</Text>
            <Text fontWeight="bold">{stats.count}</Text>
          </Box>
          <Box>
            <Text fontSize="sm" color="gray.600">Avg Gross</Text>
            <Text fontWeight="bold">{stats.avgGross ? formatNumber(String(stats.avgGross)) + ' kg' : '—'}</Text>
          </Box>
          <Box>
            <Text fontSize="sm" color="gray.600">Avg Net</Text>
            <Text fontWeight="bold">{stats.avgNet ? formatNumber(String(stats.avgNet)) + ' kg' : '—'}</Text>
          </Box>
        </Box>
      </Flex>

      <Modal
        isOpen={isOpen}
        onClose={isSubmitting ? () => {} : onClose}
        size="xl"
        scrollBehavior="inside"
        initialFocusRef={firstInputRef}
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Manual Ticket Submission</ModalHeader>
          <ModalCloseButton isDisabled={isSubmitting} />
          <ModalBody>
            <SimpleGrid columns={[1, 2]} spacing={4}>
              <FormControl isRequired isInvalid={!!errors.truckOnWb}>
                <FormLabel>
                  Truck Number <Text as="span" color="red">*</Text>
                </FormLabel>
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
                <FormLabel>
                  SAD Number <Text as="span" color="red">*</Text>
                </FormLabel>
                <Input value={formData.sadNo} onChange={(e) => handleChange('sadNo', e.target.value)} placeholder="Enter SAD No" isDisabled={isSubmitting} />
                <FormErrorMessage>{errors.sadNo}</FormErrorMessage>
              </FormControl>

              <FormControl isRequired isInvalid={!!errors.operation}>
                <FormLabel>
                  Operation <Text as="span" color="red">*</Text>
                </FormLabel>
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
                <FormLabel>
                  Gross Weight<Text as="span" color="red">*</Text>
                </FormLabel>
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
                  <FormLabel>
                    Tare (PT) <Text as="span" color="red">*</Text>
                  </FormLabel>
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
                <FormLabel>
                  Net Weight <Text as="span" color="red">*</Text>
                </FormLabel>
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
            <Button colorScheme="teal" mr={3} onClick={handleSubmit} isLoading={isSubmitting} isDisabled={isSubmitting}>
              Submit Ticket
            </Button>
            <Button variant="ghost" onClick={onClose} isDisabled={isSubmitting}>
              Cancel
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Search & filter */}
      <Box mb={4} display="flex" justifyContent="space-between" flexWrap="wrap" gap={4}>
        <Input placeholder="Search by SAD, Truck on WB, Ticket No..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} maxW="480px" />
        <FormControl maxW="200px">
          <FormLabel>Status Filter</FormLabel>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #CBD5E0' }}>
            <option value="">All</option>
            <option value="Pending">Pending</option>
            <option value="Exited">Exited</option>
          </select>
        </FormControl>
      </Box>

      {/* History table / cards */}
      {filteredHistory.length === 0 ? (
        <Text>No tickets found.</Text>
      ) : (
        <>
          {isMobile ? (
            <VStack spacing={3} align="stretch">
              {pagedHistory.map(({ ticketId, data, submittedAt }) => {
                const computed = computeWeights({ gross: data.gross, tare: data.tare, net: data.net });
                const anomaly = (computed.grossValue !== null && computed.tareValue !== null && computed.netValue !== null && !(computed.grossValue > computed.tareValue));
                return (
                  <Box key={ticketId} borderWidth="1px" borderRadius="md" p={3} bg="white" boxShadow="sm">
                    <Flex justify="space-between" align="center">
                      <Box>
                        <Text fontWeight="bold">{data.ticketNo}</Text>
                        <Text fontSize="sm" color="gray.500">{data.truckOnWb || 'N/A'} • SAD: {data.sadNo || 'N/A'}</Text>
                      </Box>
                      <Box textAlign="right">
                        {anomaly && <Badge colorScheme="red" mb={1}>Check weights</Badge>}
                        {data.manual && String(data.manual).toLowerCase() === 'yes' && <Badge colorScheme="purple">Manual</Badge>}
                      </Box>
                    </Flex>

                    <Stack direction="row" spacing={4} mt={3} justify="space-between">
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
                    </Stack>

                    <Flex mt={3} justify="flex-end" gap={2}>
                      {data.fileUrl && (
                        <Button size="sm" variant="outline" onClick={() => window.open(data.fileUrl, '_blank', 'noopener')}>Open PDF</Button>
                      )}
                      <Button size="sm" colorScheme="teal" onClick={() => handleView({ ticketId, data, submittedAt })}>View</Button>
                    </Flex>
                  </Box>
                );
              })}
            </VStack>
          ) : (
            <Table variant="striped" colorScheme="teal" size="sm">
              <Thead>
                <Tr>
                  <Th>Ticket No</Th>
                  <Th>Truck No</Th>
                  <Th>SAD No</Th>
                  <Th>Gross (KG)</Th>
                  <Th>Tare (KG)</Th>
                  <Th>Net (KG)</Th>
                  <Th>View</Th>
                </Tr>
              </Thead>
              <Tbody>
                {pagedHistory.map(({ ticketId, data, submittedAt }) => {
                  const computed = computeWeights({ gross: data.gross, tare: data.tare, net: data.net });
                  const anomaly = (computed.grossValue !== null && computed.tareValue !== null && computed.netValue !== null && !(computed.grossValue > computed.tareValue));
                  return (
                    <Tr key={ticketId}>
                      <Td>
                        <Box>
                          <Text>{data.ticketNo}</Text>
                          {data.manual && String(data.manual).toLowerCase() === 'yes' && <Badge ml={2} colorScheme="purple">Manual</Badge>}
                        </Box>
                      </Td>
                      <Td>{data.truckOnWb}</Td>
                      <Td>{data.sadNo}</Td>
                      <Td>{computed.grossDisplay}</Td>
                      <Td>
                        <Box display="flex" alignItems="center" gap={2}>
                          <Text>{computed.tareDisplay}</Text>
                          {isTareAnomaly && data.truckOnWb && String(data.truckOnWb).trim() === String(formData.truckOnWb).trim() && (
                            <Badge colorScheme="red">Tare anomaly</Badge>
                          )}
                        </Box>
                      </Td>
                      <Td>
                        <Box display="flex" alignItems="center" gap={2}>
                          <Text>{computed.netDisplay}</Text>
                          {anomaly && <Badge colorScheme="red">Check</Badge>}
                        </Box>
                      </Td>
                      <Td>
                        <HStack>
                          {data.fileUrl && (
                            <IconButton icon={<ExternalLinkIcon />} aria-label="Open file" size="sm" colorScheme="blue" onClick={() => window.open(data.fileUrl, '_blank', 'noopener')} />
                          )}
                          <IconButton icon={<ViewIcon />} aria-label="View" size="sm" colorScheme="teal" onClick={() => handleView({ ticketId, data, submittedAt })} />
                        </HStack>
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          )}

          {/* Pagination (condensed) */}
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
              <Text fontSize="sm" color="gray.600">{/* empty placeholder */}</Text>
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

      {/* View modal */}
      <Modal isOpen={isViewOpen} onClose={onViewClose} size="xl" scrollBehavior="inside">
        <ModalOverlay />
        <ModalContent maxW="90vw">
          <ModalHeader>View Ticket</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {viewTicket ? (
              <Box>
                <SimpleGrid columns={[1, 2]} spacing={4}>
                  {Object.entries(viewTicket.data).map(([key, value]) => {
                    if (key === 'fileUrl') return null;
                    const computedKeys = ['gross', 'tare', 'net'];
                    if (computedKeys.includes(key)) {
                      const computed = computeWeights({
                        gross: viewTicket.data.gross,
                        tare: viewTicket.data.tare,
                        net: viewTicket.data.net,
                      });
                      const display = key === 'gross' ? computed.grossDisplay : key === 'tare' ? computed.tareDisplay : computed.netDisplay;
                      return (
                        <Box key={key} p={3} borderWidth="1px" borderRadius="md" bg="gray.50">
                          <Text fontWeight="semibold" color="teal.600" mb={1}>{key}</Text>
                          <Text>{display || 'N/A'}</Text>
                        </Box>
                      );
                    }

                    return (
                      <Box key={key} p={3} borderWidth="1px" borderRadius="md" bg="gray.50">
                        <Text fontWeight="semibold" color="teal.600" mb={1} textTransform="capitalize">{key}</Text>
                        <Text>{value ?? 'N/A'}</Text>
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
            <Button onClick={onViewClose}>Close</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
}
