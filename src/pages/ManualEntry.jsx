// ManualEntry.jsx
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

  // If gross missing but tare and net present -> gross = net + tare
  if ((G === null || G === undefined) && T !== null && N !== null) {
    G = N + T;
  }

  // If net missing but gross and tare present -> net = gross - tare
  if ((N === null || N === undefined) && G !== null && T !== null) {
    N = G - T;
  }

  // If tare missing but gross and net present -> tare = gross - net
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
   Accepts inputProps to allow custom Chakra Input props (e.g. borderColor).
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

  // raw numeric strings for numeric fields (gross/tare/net)
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

  // keep a ref to latest formData so stable callbacks can read it without depending on it
  const formDataRef = useRef(formData);
  useEffect(() => {
    formDataRef.current = formData;
  }, [formData]);

  const [errors, setErrors] = useState({});
  const [history, setHistory] = useState([]);
  const [viewTicket, setViewTicket] = useState(null);

  // pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // operator info
  const [operatorName, setOperatorName] = useState('');
  const [operatorId, setOperatorId] = useState(null);

  // submission guard
  const [isSubmitting, setIsSubmitting] = useState(false);

  // tare automation states
  const [isTareAuto, setIsTareAuto] = useState(false); // whether tare was auto-filled from DB
  const [tareRecordExists, setTareRecordExists] = useState(false); // whether a tare record exists for truck
  const [saveTare, setSaveTare] = useState(false); // whether user wants to save the current tare for the truck
  const [fetchingTare, setFetchingTare] = useState(false);
  const truckFetchTimerRef = useRef(null);

  // extended tare/history states
  const [vehicleSummary, setVehicleSummary] = useState(null); // {tare, avg_tare, entry_count, updated_at}
  const [lastTares, setLastTares] = useState([]); // [{tare, recorded_at}, ...]
  const [selectedSuggestedTare, setSelectedSuggestedTare] = useState('');

  // track which truck we've already auto-filled for, to avoid repeated auto-fill & toast loops
  const lastAutoFilledTruckRef = useRef('');

  /* Stable validateAll that reads latest formData via formDataRef */
  const validateAll = useCallback((nextForm = null) => {
    const fd = nextForm || formDataRef.current;
    const newErrors = {};

    // Required field presence
    REQUIRED_FIELDS.forEach((f) => {
      if (!fd[f] || String(fd[f]).trim() === '') {
        newErrors[f] = 'This field is required';
      }
    });

    // compute weights
    const computed = computeWeights({
      gross: fd.gross,
      tare: fd.tare,
      net: fd.net,
    });

    if (computed.grossValue === null) newErrors.gross = newErrors.gross || 'Invalid or missing gross';
    if (computed.tareValue === null) newErrors.tare = newErrors.tare || 'Invalid or missing tare';
    if (computed.netValue === null) newErrors.net = newErrors.net || 'Invalid or missing net';

    // gross must be strictly greater than tare
    if (computed.grossValue !== null && computed.tareValue !== null) {
      if (!(computed.grossValue > computed.tareValue)) {
        newErrors.gross = 'Gross must be greater than Tare';
        newErrors.tare = 'Tare must be less than Gross';
      }
    }

    // only update errors state if changed (shallow compare)
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
    // run validation against next
    validateAll(next);
  };

  /* updateNumericField: called by NumericInput with raw numeric string (digits and dot) */
  const updateNumericField = (fieldName, rawString) => {
    setFormData((prev) => {
      const next = { ...prev, [fieldName]: rawString };

      // Live recalculation: when gross or tare are changed, if both numeric then autocalc net = gross - tare
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

      // If user manually edits tare, we should allow them to save it
      if (fieldName === 'tare') {
        if (!tareRecordExists) setSaveTare(true);
        if (isTareAuto) setIsTareAuto(false);
      }

      // validate using the computed next object (live)
      setTimeout(() => validateAll(next), 0); // schedule after state update
      return next;
    });
  };

  /* -----------------------
     Ticket number generation (from ticket_no)
  ----------------------- */
  const getNextTicketNoFromDB = useCallback(async (localHistory = []) => {
    try {
      // fetch up to 1000 recent ticket_no that look like M-<digits>
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
      // fallback
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
  }, []);

  /* Insert with retry to reduce chance of duplicate ticket_no collisions */
  const insertTicketWithRetry = useCallback(async (insertData, retryLimit = 5) => {
    let attempt = 0;
    while (attempt < retryLimit) {
      attempt += 1;
      // compute next ticket number from DB (use current history snapshot as fallback)
      const nextTicketNo = await getNextTicketNoFromDB(history);
      insertData.ticket_no = nextTicketNo;
      insertData.ticket_id = nextTicketNo;

      const { data, error } = await supabase.from('tickets').insert([insertData]);
      if (!error) {
        return { data, error: null, ticketNo: nextTicketNo };
      }

      // if error appears to be unique-violation on ticket_no, retry (concurrent writer)
      const msg = String(error?.message || '').toLowerCase();
      if (msg.includes('duplicate') || msg.includes('unique')) {
        console.warn(`ticket_no collision on attempt ${attempt} (${nextTicketNo}), retrying...`);
        // small backoff
        await new Promise((res) => setTimeout(res, 120 * attempt));
        continue;
      }

      // non-duplicate error -> abort
      return { data: null, error, ticketNo: null };
    }

    return { data: null, error: new Error('Too many retries generating ticket number'), ticketNo: null };
  }, [getNextTicketNoFromDB, history]);

  /* Fetch tare for truck (debounced) - stable and avoids no-op setState.
     IMPORTANT: we only auto-fill & toast once per truck value (tracked by lastAutoFilledTruckRef)
  */
  const fetchTareForTruck = useCallback(async (truckNo) => {
    if (!truckNo) return;
    setFetchingTare(true);
    try {
      // fetch summary from vehicle_tares (may contain tare, avg_tare, entry_count, updated_at)
      const { data: summaryData, error: summaryErr } = await supabase
        .from('vehicle_tares')
        .select('truck_no, tare, avg_tare, entry_count, updated_at')
        .eq('truck_no', truckNo)
        .maybeSingle();

      if (summaryErr) {
        console.warn('Error fetching vehicle_tares summary', summaryErr);
      }

      // fetch last 5 history entries for this truck
      const { data: histData, error: histErr } = await supabase
        .from('vehicle_tare_history')
        .select('tare, recorded_at')
        .eq('truck_no', truckNo)
        .order('recorded_at', { ascending: false })
        .limit(5);

      if (histErr) {
        console.warn('Error fetching vehicle_tare_history', histErr);
      }

      // Set local states for UI (avoid no-op updates)
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

      // If we have a summary tare, auto-fill only if we haven't already auto-filled for this truck value
      if (summaryData && summaryData.tare !== undefined && summaryData.tare !== null) {
        // Prevent repeated auto-fill & toast for the same truck value
        if (lastAutoFilledTruckRef.current !== truckNo) {
          const newTareStr = String(summaryData.tare);

          // Only update formData.tare if it actually differs (prevents loops)
          setFormData((prev) => {
            if (prev.tare === newTareStr) return prev;
            const next = { ...prev, tare: newTareStr };
            const g = numericValue(next.gross);
            const t = numericValue(next.tare);
            if (g !== null && t !== null) next.net = String(g - t);
            // run validation after setting
            setTimeout(() => validateAll(next), 0);
            return next;
          });

          // set flags (only set if they change)
          setIsTareAuto(true);
          setTareRecordExists(true);
          setSaveTare(false);

          // mark that we've auto-filled for this truck so subsequent runs don't repeat
          lastAutoFilledTruckRef.current = truckNo;

          // show toast once
          toast({
            title: 'Tare auto-filled',
            description: `Last tare: ${formatNumber(String(summaryData.tare))} kg${summaryData.avg_tare ? ` | Avg: ${formatNumber(String(summaryData.avg_tare))} (${summaryData.entry_count || 1} entries)` : ''}`,
            status: 'info',
            duration: 4000,
            isClosable: true,
          });
        }
      } else if (Array.isArray(histData) && histData.length > 0) {
        // no summary row but history exists -> show history but don't auto-fill
        setIsTareAuto(false);
        setTareRecordExists(true);
      } else {
        // no record found
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

  // Clear lastAutoFilledTruckRef when truck input changes (so a new truck can be auto-filled)
  useEffect(() => {
    lastAutoFilledTruckRef.current = '';
  }, [formData.truckOnWb]);

  // debounce truck input and fetch tare
  useEffect(() => {
    if (truckFetchTimerRef.current) clearTimeout(truckFetchTimerRef.current);
    const truck = (formData.truckOnWb || '').trim();
    if (!truck) {
      // only update when necessary
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
      // pass current truck (capture value at debounce time)
      fetchTareForTruck(truck);
    }, 600);

    return () => {
      if (truckFetchTimerRef.current) clearTimeout(truckFetchTimerRef.current);
    };
  }, [formData.truckOnWb, fetchTareForTruck]);

  /* Suggested tare / anomaly detection */
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
    // anomaly threshold: 5% deviation (configurable)
    return Math.abs(entered - pred) / pred > 0.05;
  }, [predictedTare, enteredTareNumeric]);

  /* handle pick from suggested tares (avg or history) */
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
     (This was missing — explains empty table)
  ----------------------- */
  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        // load tickets history (large sample; adjust limit as needed)
        const { data, error } = await supabase
          .from('tickets')
          .select('*')
          .order('submitted_at', { ascending: false })
          .limit(2000);

        if (error) {
          console.warn('Error loading tickets', error);
          toast({ title: 'Error loading tickets', description: error.message || String(error), status: 'error', duration: 5000, isClosable: true });
        } else if (Array.isArray(data)) {
          // Map rows defensively in case column names differ
          const mapped = data.map((item, idx) => {
            // ticket id fallback: ticket_id || id || ticket_no || generated
            const ticketId = item.ticket_id ?? item.id ?? item.ticket_no ?? `unknown-${idx}-${Date.now()}`;

            return {
              ticketId,
              data: {
                ticketNo: item.ticket_no ?? ticketId,
                truckOnWb: item.truck_on_wb ?? item.gnsw_truck_no ?? item.truckOnWb ?? '',
                consignee: item.consignee ?? '',
                operation: item.operation ?? '',
                driver: item.driver ?? '',
                sadNo: item.sad_no ?? item.sadNo ?? '',
                containerNo: item.container_no ?? '',
                gross: item.gross !== null && item.gross !== undefined ? formatNumber(String(item.gross)) : '',
                tare: item.tare !== null && item.tare !== undefined ? formatNumber(String(item.tare)) : '',
                net: item.net !== null && item.net !== undefined ? formatNumber(String(item.net)) : '',
                manual: item.manual ?? '',
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

        // get logged-in user info
        try {
          let currentUser = null;
          if (supabase.auth?.getUser) {
            const { data: userData, error: userErr } = await supabase.auth.getUser();
            if (!userErr) currentUser = userData?.user || null;
          } else if (supabase.auth?.user) {
            currentUser = supabase.auth.user();
          }

          if (currentUser) {
            // try fetch from users table
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

    return () => {
      mounted = false;
    };
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Submit form (optimistic UI + DB) */
  const handleSubmit = async () => {
    if (isSubmitting) return; // guard against double clicks
    setIsSubmitting(true); // lock immediately

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

    // compute final numeric values from the ref snapshot
    const computed = computeWeights({
      gross: formDataRef.current.gross,
      tare: formDataRef.current.tare,
      net: formDataRef.current.net,
    });

    // create optimistic (temporary) ticket
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

    // add optimistic ticket immediately
    setHistory((prev) => [tempTicket, ...prev]);

    const insertData = {
      truck_on_wb: formDataRef.current.truckOnWb || null,
      gnsw_truck_no: formDataRef.current.truckOnWb || null,
      consignee: formDataRef.current.consignee || null,
      operation: formDataRef.current.operation || null,
      driver: formDataRef.current.driver || null,
      sad_no: formDataRef.current.sadNo || null,
      container_no: formDataRef.current.containerNo || null,
      material: 'No Material',
      pass_number: null,
      date: new Date().toISOString(),
      scale_name: 'WBRIDGE1',
      weight: computed.grossValue !== null ? computed.grossValue : null,
      manual: 'Yes',
      operator: operatorName || null,
      operator_id: operatorId || null,
      gross: computed.grossValue !== null ? computed.grossValue : null,
      tare: computed.tareValue !== null ? computed.tareValue : null,
      net: computed.netValue !== null ? computed.netValue : null,
      status: 'Pending',
    };

    try {
      const { data, error, ticketNo } = await insertTicketWithRetry(insertData, 5);
      if (error) {
        // rollback optimistic
        setHistory((prev) => prev.filter((r) => r.ticketId !== tempId));
        toast({ title: 'Submit failed', description: error.message || String(error), status: 'error', duration: 5000, isClosable: true });
        setIsSubmitting(false);
        return;
      }

      const newTicketNo = ticketNo || (data && data[0] && data[0].ticket_no) || 'M-0001';

      // === NEW: always record tare into vehicle_tare_history (if we have a measured tare)
      const truck = formDataRef.current.truckOnWb;
      if (truck && computed.tareValue !== null) {
        try {
          // 1) insert into history
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
          // 2) recompute summary avg and entry_count from history (could be optimized with a db view/function)
          const { data: allHist, error: allErr } = await supabase
            .from('vehicle_tare_history')
            .select('tare')
            .eq('truck_no', truck);

          if (!allErr && Array.isArray(allHist) && allHist.length > 0) {
            const tares = allHist.map((r) => Number(r.tare)).filter((n) => !Number.isNaN(n));
            const sum = tares.reduce((a, b) => a + b, 0);
            const avg = tares.length > 0 ? sum / tares.length : computed.tareValue;
            const entryCount = tares.length;

            // 3) upsert summary row (keeps your existing 'tare' column as last measured)
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
            // no history found? still upsert last-measured tare as a fallback
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

      // replace optimistic ticket with real ticket info
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
      // rollback optimistic
      setHistory((prev) => prev.filter((r) => r.ticketId !== tempId));
      console.error(err);
      toast({ title: 'Submit error', description: err?.message || 'Unexpected error', status: 'error', duration: 5000, isClosable: true });
    } finally {
      setIsSubmitting(false); // always unlock
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
    return history.filter((r) => {
      const matchesSearch =
        (r.data.ticketNo || '').toLowerCase().includes(q) ||
        (r.data.truckOnWb || '').toLowerCase().includes(q) ||
        (r.data.driver || '').toLowerCase().includes(q) ||
        (r.data.sadNo || '').toLowerCase().includes(q);
      const matchesStatus = statusFilter ? r.data.status === statusFilter : true;
      return matchesSearch && matchesStatus;
    });
  }, [history, searchQuery, statusFilter]);

  useEffect(() => setPage(1), [searchQuery, statusFilter, history, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredHistory.length / pageSize));
  const startIndex = (page - 1) * pageSize;
  const pagedHistory = filteredHistory.slice(startIndex, startIndex + pageSize);

  /* -----------------------
     Render
  ----------------------- */
  return (
    <Box p={6} maxW="1200px" mx="auto">
      <Heading mb={6}>Manual Ticket Entry</Heading>

      <Button onClick={onOpen} colorScheme="teal" mb={6}>
        New Manual Ticket
      </Button>

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
              {/* Truck on WB (required) */}
              <FormControl isRequired isInvalid={!!errors.truckOnWb}>
                <FormLabel>
                  Truck Number <Text as="span" color="red">*</Text>
                </FormLabel>
                <Input
                  ref={firstInputRef}
                  value={formData.truckOnWb}
                  onChange={(e) => handleChange('truckOnWb', e.target.value)}
                  placeholder="Enter Truck on WB"
                  isDisabled={isSubmitting}
                />
                <FormErrorMessage>{errors.truckOnWb}</FormErrorMessage>
              </FormControl>

              {/* SAD No (required) */}
              <FormControl isRequired isInvalid={!!errors.sadNo}>
                <FormLabel>
                  SAD Number <Text as="span" color="red">*</Text>
                </FormLabel>
                <Input value={formData.sadNo} onChange={(e) => handleChange('sadNo', e.target.value)} placeholder="Enter SAD No" isDisabled={isSubmitting} />
                <FormErrorMessage>{errors.sadNo}</FormErrorMessage>
              </FormControl>

              {/* Operation (required dropdown) */}
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

              {/* Container No (optional) */}
              <FormControl>
                <FormLabel>Container Number</FormLabel>
                <Input value={formData.containerNo} onChange={(e) => handleChange('containerNo', e.target.value)} placeholder="Container No (optional)" isDisabled={isSubmitting} />
              </FormControl>

              {/* Consignee (optional) */}
              <FormControl>
                <FormLabel>Consignee</FormLabel>
                <Input value={formData.consignee} onChange={(e) => handleChange('consignee', e.target.value)} placeholder="Consignee (optional)" isDisabled={isSubmitting} />
              </FormControl>

              {/* Driver (optional) */}
              <FormControl>
                <FormLabel>Driver Name</FormLabel>
                <Input value={formData.driver} onChange={(e) => handleChange('driver', e.target.value)} placeholder="Driver name (optional)" isDisabled={isSubmitting} />
              </FormControl>

              {/* Numeric fields row: Gross (required) */}
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

              {/* Tare (required) */}
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

                {/* Inline suggested tare badges (average + up to 3 recent) */}
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

                {/* If there is no tare record for this truck, offer to save it */}
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

              {/* Net (required, read-only) */}
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

      {/* History table (paginated) */}
      {filteredHistory.length === 0 ? (
        <Text>No tickets found.</Text>
      ) : (
        <>
          <Box borderWidth="1px" borderRadius="md" overflow="hidden">
            <Box display="grid" gridTemplateColumns="120px 140px 140px 1fr 120px 120px 100px" bg="gray.50" px={3} py={2} fontWeight="semibold">
              <Text>Ticket No</Text>
              <Text>Truck No</Text>
              <Text>SAD No</Text>
              <Text>Gross (kg)</Text>
              <Text>Tare (kg)</Text>
              <Text>Net (kg)</Text>
              <Text>Action</Text>
            </Box>

            {pagedHistory.map(({ ticketId, data, submittedAt }) => (
              <Box
                key={ticketId}
                display="grid"
                gridTemplateColumns="120px 140px 140px 1fr 120px 120px 100px"
                alignItems="center"
                px={3}
                py={2}
                borderBottom="1px solid"
                borderColor="gray.100"
                bg={data.__optimistic ? 'gray.50' : 'white'}
              >
                <Text isTruncated>{data.ticketNo}</Text>
                <Text isTruncated>{data.truckOnWb}</Text>
                <Text isTruncated>{data.sadNo}</Text>
                <Text isTruncated>{data.gross}</Text>
                <Text isTruncated>{data.tare}</Text>
                <Text isTruncated>{data.net}</Text>
                <Box>
                  {data.fileUrl && (
                    <IconButton icon={<ExternalLinkIcon />} aria-label="Open file" size="sm" colorScheme="blue" mr={2} onClick={() => window.open(data.fileUrl, '_blank', 'noopener')} />
                  )}
                  <IconButton icon={<ViewIcon />} aria-label="View" size="sm" colorScheme="teal" onClick={() => handleView({ ticketId, data, submittedAt })} />
                </Box>
              </Box>
            ))}
          </Box>

          {/* Pagination */}
          <Box mt={4} display="flex" alignItems="center" gap={3} flexWrap="wrap">
            <Button size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} isDisabled={page === 1}>Previous</Button>

            <Flex align="center" gap={2}>
              {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                const pageNum = i + 1;
                return (
                  <Button key={pageNum} size="sm" onClick={() => setPage(pageNum)} colorScheme={pageNum === page ? 'teal' : 'gray'} variant={pageNum === page ? 'solid' : 'outline'}>
                    {pageNum}
                  </Button>
                );
              })}
            </Flex>

            <Button size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} isDisabled={page === totalPages}>Next</Button>

            <Box ml="auto" display="flex" alignItems="center" gap={2}>
              <Text>Rows per page:</Text>
              <Select size="sm" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} width="80px">
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </Select>
            </Box>
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
