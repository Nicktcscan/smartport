// src/pages/ConfirmExit.jsx
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Box,
  Heading,
  Input,
  Button,
  SimpleGrid,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Flex,
  Text,
  useDisclosure,
  useToast,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  IconButton,
  Stack,
  Stat,
  StatLabel,
  StatNumber,
  StatHelpText,
  HStack,
  Select,
  Tooltip,
  Badge,
  VStack,
  Divider,
  useBreakpointValue,
  Spinner,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  Checkbox,
} from '@chakra-ui/react';
import {
  SearchIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  RepeatIcon,
  CopyIcon,
} from '@chakra-ui/icons';
import { FaFilePdf, FaPrint, FaMagic, FaBars, FaUser, FaEllipsisV, FaDownload } from 'react-icons/fa';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';

// If your setup needs pdfjs worker, set it:
// pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@2.16.105/build/pdf.worker.min.js';

const PAGE_SIZE = 5;

/* -----------------------
   Helpers
----------------------- */

function computeWeights(row) {
  const toNum = (val) => {
    if (val === null || val === undefined || val === '') return null;
    const n = Number(String(val).toString().replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  };

  let gross = toNum(row.gross);
  let tare = toNum(row.tare);
  let net = toNum(row.net);

  if (gross == null && tare != null && net != null) gross = tare + net;
  if (tare == null && gross != null && net != null) tare = gross - net;
  if (net == null && gross != null && tare != null) net = gross - tare;

  return { gross, tare, net };
}

function formatWeight(v) {
  if (v == null) return '—';
  return Number(v).toLocaleString();
}

function exportToCSV(rows = [], filename = 'confirm-exit.csv') {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const csv = [
    keys.join(','),
    ...rows.map((r) =>
      keys
        .map((k) => {
          const v = r[k] ?? '';
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

// Extract selectable text from a remote PDF URL (best-effort)
async function extractTextFromPdfUrl(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`Failed to fetch PDF (${resp.status})`);
    }
    const arrayBuffer = await resp.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item) => item.str).join(' ');
      fullText += ' ' + pageText;
    }
    await loadingTask.destroy?.();
    return fullText.trim();
  } catch (err) {
    console.warn('PDF text extraction failed', err);
    return '';
  }
}

// Try a few regex patterns to find driver name in text
function parseDriverNameFromText(text) {
  if (!text) return null;
  const patterns = [
    /Driver\s*Name\s*[:-]\s*(.+?)(?:\n|$)/i,
    /Driver\s*[:-]\s*(.+?)(?:\n|$)/i,
    /Name\s*of\s*Driver\s*[:-]\s*(.+?)(?:\n|$)/i,
    /Driver\s+[:]\s*([A-Z][A-Za-z'\-\s]+[A-Za-z])/m,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m && m[1]) {
      const candidate = m[1].trim();
      if (candidate.length > 2 && candidate.length < 80 && !/\d{5,}/.test(candidate)) {
        return candidate.replace(/\s{2,}/g, ' ').replace(/[\r\n]+/g, ' ').trim();
      }
    }
  }
  const fallback = text.match(/Driver\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,2})/);
  if (fallback && fallback[1]) return fallback[1].trim();
  return null;
}

function isPdfUrl(url) {
  if (!url) return false;
  const lower = url.split('?')[0].toLowerCase();
  return lower.endsWith('.pdf');
}
function isImageUrl(url) {
  if (!url) return false;
  const lower = url.split('?')[0].toLowerCase();
  return /\.(jpe?g|png|gif|bmp|webp|tiff?)$/.test(lower);
}

/* -----------------------
   Supabase utilities: retry + batching
----------------------- */

/**
 * Wrap a function returning a Supabase response `{ data, error, status }` with retry/backoff for transient failures.
 * Caller supplies a function that performs the supabase call and returns that response.
 */
async function supabaseWithRetry(fn, { retries = 4, initialDelay = 600, factor = 2 } = {}) {
  let attempt = 0;
  let delay = initialDelay;

  while (attempt <= retries) {
    try {
      const res = await fn();
      // PostgREST errors come back in `error` property
      if (res && res.error) {
        const err = res.error;
        // treat 503 / network-type errors as transient
        const status = err?.status ?? res.status;
        const transient = status === 503 || status === 502 || status === 504 || /timeout|temporar|insufficient/i.test(err?.message ?? '');
        if (!transient) {
          // non-transient, throw for caller to handle
          throw err;
        }
        // else fallthrough to retry
      } else {
        // success
        return res;
      }
    } catch (err) {
      // Network level or thrown error - check if transient
      const msg = String(err?.message ?? err).toLowerCase();
      const transient = /503|502|504|ecof|temporar|timeout|network|insufficient/i.test(msg);
      if (!transient) throw err;
      // else retry
    }

    // If we reached here, error considered transient — retry after delay
    attempt += 1;
    if (attempt > retries) break;
    await new Promise((res) => setTimeout(res, delay));
    delay *= factor;
  }
  // last attempt without wrapper to allow caller to get real error
  return fn();
}

/**
 * Fetch rows via `.in()` but chunk large arrays to avoid very long URLs.
 * Returns aggregated array of rows (deduped by primary key)
 */
async function fetchInBatches({ table = 'tickets', column, values = [], select = '*', batchSize = 60 }) {
  if (!Array.isArray(values) || values.length === 0) return [];
  const final = [];
  const seenIds = new Set();
  for (let i = 0; i < values.length; i += batchSize) {
    const chunk = values.slice(i, i + batchSize);
    const resp = await supabaseWithRetry(() => supabase.from(table).select(select).in(column, chunk).limit(1000));
    const { data, error } = resp;
    if (error) {
      console.warn(`fetchInBatches chunk failed for ${table}.${column}`, error);
      // continue; don't break entire operation
      continue;
    }
    if (Array.isArray(data)) {
      for (const r of data) {
        const key = r.id ?? r.ticket_id ?? JSON.stringify(r);
        if (!seenIds.has(key)) {
          seenIds.add(key);
          final.push(r);
        }
      }
    }
  }
  return final;
}

/* -----------------------
   Component
----------------------- */
export default function ConfirmExit() {
  // Auth
  const { user } = useAuth(); // returns supabase user object or custom auth object depending on your app
  const toast = useToast();

  // We'll resolve current logged in username from users table (best-effort).
  const [currentUsername, setCurrentUsername] = useState(null);

  useEffect(() => {
    const loadUsername = async () => {
      try {
        if (!user) return setCurrentUsername(null);
        // Prefer matching by id; fallback to email
        if (user.id) {
          const resp = await supabaseWithRetry(() => supabase.from('users').select('username').eq('id', user.id).maybeSingle());
          if (!resp.error && resp.data && resp.data.username) return setCurrentUsername(resp.data.username);
        }
        if (user.email) {
          const resp = await supabaseWithRetry(() => supabase.from('users').select('username').ilike('email', user.email).maybeSingle());
          if (!resp.error && resp.data && resp.data.username) return setCurrentUsername(resp.data.username);
        }
        // fallback
        setCurrentUsername(user.email || user.id || null);
      } catch (err) {
        console.warn('Could not load current username', err);
        setCurrentUsername(user?.email ?? user?.id ?? null);
      }
    };
    loadUsername();
  }, [user]);

  // search / filters
  const [searchParams, setSearchParams] = useState({
    vehicleNumber: '',
    ticketNo: '',
    sadNumber: '',
    containerId: '',
  });
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');

  // data lists
  const [allTickets, setAllTickets] = useState([]); // pending tickets (status = 'Pending')
  const [filteredResults, setFilteredResults] = useState([]); // pending tickets after excluding confirmed
  const [confirmedTickets, setConfirmedTickets] = useState([]); // deduped confirmed exits (unique by ticket_id)

  // modal + selection
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [actionType, setActionType] = useState(null);
  const { isOpen, onOpen, onClose } = useDisclosure();

  // paging / sorting
  const [currentPage, setCurrentPage] = useState(1);
  const [confirmedPage, setConfirmedPage] = useState(1);
  const [sortKey, setSortKey] = useState('ticket_no');
  const [sortOrder, setSortOrder] = useState('asc');
  const [pendingPageSize, setPendingPageSize] = useState(PAGE_SIZE);

  const printRef = useRef(null);

  // confirmed search (live) and small state
  const [confirmedQuery, setConfirmedQuery] = useState('');
  const [totalTickets, setTotalTickets] = useState(null);
  const [exitedCount, setExitedCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // UI/UX extras
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);

  // responsive: switch table → cards on small devices
  const isMobile = useBreakpointValue({ base: true, md: false });

  // selection state
  const [selectedPending, setSelectedPending] = useState(new Set()); // ticket_id values
  const [selectedConfirmed, setSelectedConfirmed] = useState(new Set());

  // keyboard navigation
  const [focusedPendingIndex, setFocusedPendingIndex] = useState(-1);
  const pendingRowRefs = useRef([]); // array of row DOM refs

  // users map for 'Exited By' lookup
  const [usersMap, setUsersMap] = useState({}); // { userId: {id, username, email} }

  // orb modal
  const [orbOpen, setOrbOpen] = useState(false);
  const openOrb = () => setOrbOpen(true);
  const closeOrb = () => setOrbOpen(false);

  // subscriptions refs to avoid duplicates
  const ticketSubRef = useRef(null);
  const outgateSubRef = useRef(null);
  const realtimeSetupRef = useRef(false);

  // ---------------------
  // Data fetching
  // ---------------------

  // Limit for pending fetch (guard against huge payloads)
  const PENDING_FETCH_LIMIT = 4000;

  const fetchTickets = useCallback(async () => {
    try {
      // fetch pending tickets only (server-side filtering)
      const resp = await supabaseWithRetry(() =>
        supabase
          .from('tickets')
          .select('id, ticket_id, ticket_no, gnsw_truck_no, container_no, date, sad_no, status, gross, tare, net, file_url, file_name, submitted_at, driver')
          .eq('status', 'Pending')
          .order('submitted_at', { ascending: false })
          .limit(PENDING_FETCH_LIMIT)
      );
      if (resp.error) throw resp.error;
      // ensure no Exited records are present
      const incoming = Array.isArray(resp.data) ? resp.data.filter((r) => (r.status !== 'Exited')) : [];
      setAllTickets(incoming);
    } catch (err) {
      console.warn('fetchTickets error', err);
      toast({ title: 'Error fetching tickets', description: err?.message || 'Could not fetch tickets', status: 'error', duration: 5000, isClosable: true });
    }
  }, [toast]);

  /**
   * Safely update tickets.status -> 'Exited' in batches (use id or ticket_id)
   */
  async function markTicketsExitedInBatches({ byId = [], byTicketId = [], chunkSize = 200 } = {}) {
    // prefer using DB id updates in chunks, then ticket_id updates in chunks.
    try {
      if (byId.length) {
        for (let i = 0; i < byId.length; i += chunkSize) {
          const chunk = byId.slice(i, i + chunkSize);
          try {
            await supabaseWithRetry(() => supabase.from('tickets').update({ status: 'Exited' }).in('id', chunk));
          } catch (e) {
            console.warn('Chunked mark Exited by id failed', e);
          }
        }
      }
      if (byTicketId.length) {
        for (let i = 0; i < byTicketId.length; i += chunkSize) {
          const chunk = byTicketId.slice(i, i + chunkSize);
          try {
            await supabaseWithRetry(() => supabase.from('tickets').update({ status: 'Exited' }).in('ticket_id', chunk));
          } catch (e) {
            console.warn('Chunked mark Exited by ticket_id failed', e);
          }
        }
      }
    } catch (e) {
      console.warn('markTicketsExitedInBatches overall failure', e);
    }
  }

  /**
   * fetchConfirmedExits: fetches outgate rows then attempts to enrich them with matching tickets
   */
  const fetchConfirmedExits = useCallback(async () => {
    try {
      const resp = await supabaseWithRetry(() =>
        supabase
          .from('outgate')
          .select(`
            id,
            ticket_id,
            ticket_no,
            vehicle_number,
            container_id,
            sad_no,
            gross,
            tare,
            net,
            created_at,
            file_url,
            file_name,
            driver,
            created_by,
            tickets ( id, ticket_id, ticket_no, date, submitted_at, gnsw_truck_no, status )
          `)
          .order('created_at', { ascending: false })
          .limit(2000)
      );
      if (resp.error) throw resp.error;
      const rows = resp.data || [];

      const mapped = rows.map((r) => {
        const ticketJoin = (r.tickets && Array.isArray(r.tickets) && r.tickets[0]) ? r.tickets[0] : null;
        const ticketDate = ticketJoin ? (ticketJoin.submitted_at || null) : null;
        const merged = { ...r, weighed_at: ticketDate, _joined_ticket: ticketJoin };
        if (!merged.vehicle_number && ticketJoin && ticketJoin.gnsw_truck_no) merged.vehicle_number = ticketJoin.gnsw_truck_no;
        return merged;
      });

      // collect keys to try to match missing joins
      const needByTicketId = Array.from(new Set(mapped.filter((r) => (!r._joined_ticket) && r.ticket_id).map((r) => r.ticket_id)));
      const needByTicketNo = Array.from(new Set(mapped.filter((r) => (!r._joined_ticket) && r.ticket_no).map((r) => r.ticket_no)));

      const ticketMapByTicketId = {};
      const ticketMapByTicketNo = {};

      if (needByTicketId.length) {
        try {
          const tById = await fetchInBatches({
            table: 'tickets',
            column: 'ticket_id',
            values: needByTicketId,
            select: 'id,ticket_id,ticket_no,gnsw_truck_no,date,submitted_at,status',
            batchSize: 60,
          });
          for (const t of tById) {
            if (t.ticket_id) ticketMapByTicketId[t.ticket_id] = t;
            if (t.ticket_no) ticketMapByTicketNo[t.ticket_no] = ticketMapByTicketNo[t.ticket_no] || t;
          }
        } catch (e) {
          console.warn('fetch confirmed: byTicketId failed', e);
        }
      }

      if (needByTicketNo.length) {
        try {
          const tByNo = await fetchInBatches({
            table: 'tickets',
            column: 'ticket_no',
            values: needByTicketNo,
            select: 'id,ticket_id,ticket_no,gnsw_truck_no,date,submitted_at,status',
            batchSize: 60,
          });
          for (const t of tByNo) {
            if (t.ticket_id) ticketMapByTicketId[t.ticket_id] = t;
            if (t.ticket_no) ticketMapByTicketNo[t.ticket_no] = t;
          }
        } catch (e) {
          console.warn('fetch confirmed: byTicketNo failed', e);
        }
      }

      // merge and schedule updates
      const outgateUpdates = [];
      const ticketDbIdsToMarkExited = new Set();
      const ticketTicketIdsToMarkExited = new Set();

      const finalArr = mapped.map((r) => {
        if (r._joined_ticket) {
          const jt = r._joined_ticket;
          if (jt.id) ticketDbIdsToMarkExited.add(jt.id);
          if (jt.ticket_id) ticketTicketIdsToMarkExited.add(jt.ticket_id);
          return { ...r };
        }

        let matched = null;
        if (r.ticket_id && ticketMapByTicketId[r.ticket_id]) matched = ticketMapByTicketId[r.ticket_id];
        else if (r.ticket_no && ticketMapByTicketNo[r.ticket_no]) matched = ticketMapByTicketNo[r.ticket_no];

        if (matched) {
          const merged = { ...r };
          merged.weighed_at = matched.submitted_at || merged.weighed_at;
          if (!merged.vehicle_number && matched.gnsw_truck_no) merged.vehicle_number = matched.gnsw_truck_no;
          if (!merged.ticket_id && matched.ticket_id) {
            merged.ticket_id = matched.ticket_id;
            outgateUpdates.push({ id: merged.id, ticket_id: matched.ticket_id });
          }
          if (matched.id) ticketDbIdsToMarkExited.add(matched.id);
          if (matched.ticket_id) ticketTicketIdsToMarkExited.add(matched.ticket_id);
          return merged;
        }

        return { ...r };
      });

      // Persist outgate.ticket_id fixes sequentially (small number expected)
      if (outgateUpdates.length) {
        for (const upd of outgateUpdates) {
          try {
            // attempt to set only if currently null (best effort). If provider fails, ignore.
            await supabaseWithRetry(() => supabase.from('outgate').update({ ticket_id: upd.ticket_id }).eq('id', upd.id));
          } catch (e) {
            console.warn('Failed to persist outgate.ticket_id for outgate id', upd.id, e);
          }
        }
      }

      // Mark tickets Exited in chunked batches (robust)
      try {
        const byDbIds = Array.from(ticketDbIdsToMarkExited);
        const byTicketIds = Array.from(ticketTicketIdsToMarkExited);
        await markTicketsExitedInBatches({ byId: byDbIds, byTicketId: byTicketIds, chunkSize: 200 });
      } catch (e) {
        console.warn('Failed to mark some tickets Exited during fetchConfirmedExits', e);
      }

      // Deduplicate final confirmed set (prefer one per ticket_id)
      const dedupeMap = new Map();
      for (const r of finalArr) {
        const key = r.ticket_id ?? `OUTGATE-${r.id}`;
        if (!dedupeMap.has(key)) dedupeMap.set(key, r);
      }
      const finalConfirmed = Array.from(dedupeMap.values());

      setConfirmedTickets(finalConfirmed);

      // load users who created these outgates (if created_by present)
      const creatorIds = Array.from(new Set(finalConfirmed.map((r) => r.created_by).filter(Boolean)));
      if (creatorIds.length) {
        try {
          const respUsers = await supabaseWithRetry(() => supabase.from('users').select('id,username,email').in('id', creatorIds).limit(1000));
          if (!respUsers.error && respUsers.data) {
            const m = {};
            respUsers.data.forEach(u => { m[u.id] = u; });
            setUsersMap((prev) => ({ ...prev, ...m }));
          }
        } catch (e) {
          console.warn('Could not fetch users map', e);
        }
      }
    } catch (err) {
      console.error('fetchConfirmedExits error', err);
      toast({ title: 'Error fetching confirmed exits', description: err?.message || 'Could not fetch confirmed exits', status: 'error', duration: 5000, isClosable: true });
    }
  }, [toast]);

  const fetchTotalTickets = useCallback(async () => {
    try {
      // keep this lightweight — head=true count only
      const respAll = await supabaseWithRetry(() => supabase.from('tickets').select('ticket_id', { head: true, count: 'exact' }));
      const total = respAll?.count ?? null;
      const respExited = await supabaseWithRetry(() => supabase.from('tickets').select('ticket_id', { head: true, count: 'exact' }).eq('status', 'Exited'));
      const exited = respExited?.count ?? 0;
      setTotalTickets(total);
      setExitedCount(exited);
    } catch (err) {
      console.warn('fetchTotalTickets failed', err);
      setTotalTickets(null);
      setExitedCount(0);
    }
  }, []);

  // initial load: run sequentially to avoid bursting the backend
  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        await fetchTickets();
        await fetchConfirmedExits();
        await fetchTotalTickets();
      } catch (e) {
        console.warn('Initial load error', e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchTickets, fetchConfirmedExits, fetchTotalTickets]);

  // Realtime subscriptions (debounced handlers)
  useEffect(() => {
    let ticketSub = null;
    let outgateSub = null;
    const debounce = (fn, delay = 300) => {
      let t = null;
      return () => {
        if (t) clearTimeout(t);
        t = setTimeout(() => { fn(); t = null; }, delay);
      };
    };

    const debFetchTickets = debounce(() => { fetchTickets(); fetchTotalTickets(); }, 400);
    const debFetchConfirmed = debounce(() => { fetchConfirmedExits(); fetchTickets(); fetchTotalTickets(); }, 400);

    const setup = async () => {
      if (realtimeSetupRef.current) return;
      try {
        if (typeof supabase.channel === 'function') {
          ticketSub = supabase
            .channel('public:tickets')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => {
              debFetchTickets();
            })
            .subscribe();
          ticketSubRef.current = ticketSub;

          outgateSub = supabase
            .channel('public:outgate')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'outgate' }, () => {
              debFetchConfirmed();
            })
            .subscribe();
          outgateSubRef.current = outgateSub;
          realtimeSetupRef.current = true;
        } else if (typeof supabase.from === 'function') {
          // legacy realtime
          ticketSub = supabase.from('tickets').on('*', debFetchTickets).subscribe();
          ticketSubRef.current = ticketSub;
          outgateSub = supabase.from('outgate').on('*', debFetchConfirmed).subscribe();
          outgateSubRef.current = outgateSub;
          realtimeSetupRef.current = true;
        }
      } catch (err) {
        console.warn('realtime setup failed', err);
      }
    };

    setup();

    return () => {
      try {
        if (ticketSubRef.current) {
          if (ticketSubRef.current.unsubscribe) ticketSubRef.current.unsubscribe();
          else if (typeof supabase.removeChannel === 'function') supabase.removeChannel(ticketSubRef.current).catch(() => {});
          ticketSubRef.current = null;
        }
        if (outgateSubRef.current) {
          if (outgateSubRef.current.unsubscribe) outgateSubRef.current.unsubscribe();
          else if (typeof supabase.removeChannel === 'function') supabase.removeChannel(outgateSubRef.current).catch(() => {});
          outgateSubRef.current = null;
        }
        realtimeSetupRef.current = false;
      } catch (e) {}
    };
  }, [fetchTickets, fetchConfirmedExits, fetchTotalTickets]);

  // Exclude confirmed/exited tickets from pending list
  useEffect(() => {
    const confirmedIds = new Set(confirmedTickets.filter((t) => t.ticket_id).map((t) => t.ticket_id));
    const confirmedNos = new Set(confirmedTickets.filter((t) => t.ticket_no).map((t) => t.ticket_no));

    const unconfirmed = allTickets.filter((t) =>
      (t.status !== 'Exited') &&
      !confirmedIds.has(t.ticket_id) &&
      !confirmedNos.has(t.ticket_no)
    );

    setFilteredResults(unconfirmed);
    setCurrentPage(1);
  }, [allTickets, confirmedTickets]);

  // Inputs
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setSearchParams((p) => ({ ...p, [name]: value }));
  };

  const parseTimeToMinutes = (timeStr) => {
    if (!timeStr) return null;
    const [hh, mm] = String(timeStr).split(':').map(Number);
    if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
    return hh * 60 + mm;
  };

  // Search & filter for pending tickets
  const handleSearch = () => {
    const confirmedIds = new Set(confirmedTickets.filter((t) => t.ticket_id).map((t) => t.ticket_id));
    const confirmedNos = new Set(confirmedTickets.filter((t) => t.ticket_no).map((t) => t.ticket_no));
    const df = dateFrom ? new Date(dateFrom) : null;
    const dt = dateTo ? new Date(dateTo) : null;
    if (dt) dt.setHours(23, 59, 59, 999);
    const tFrom = parseTimeToMinutes(timeFrom);
    const tTo = parseTimeToMinutes(timeTo);

    const filtered = allTickets.filter((ticket) => {
      const matchesVehicle = (ticket.gnsw_truck_no || '').toLowerCase().includes(searchParams.vehicleNumber.toLowerCase());
      const matchesTicket = (ticket.ticket_no || '').toLowerCase().includes(searchParams.ticketNo.toLowerCase());
      const matchesSAD = (ticket.sad_no || '').toLowerCase().includes(searchParams.sadNumber.toLowerCase());
      if (!(matchesVehicle && matchesTicket && matchesSAD)) return false;
      if (confirmedIds.has(ticket.ticket_id)) return false;
      if (confirmedNos.has(ticket.ticket_no)) return false;
      if (ticket.status === 'Exited') return false;

      const dateStr = ticket.submitted_at || ticket.date;
      if (df || dt || tFrom !== null || tTo !== null) {
        if (!dateStr) return false;
        const ticketDate = new Date(dateStr);
        if (Number.isNaN(ticketDate.getTime())) return false;
        if (df && ticketDate < df) return false;
        if (dt && ticketDate > dt) return false;
        if (tFrom !== null || tTo !== null) {
          const mins = ticketDate.getHours() * 60 + ticketDate.getMinutes();
          if (tFrom !== null && mins < tFrom) return false;
          if (tTo !== null && mins > tTo) return false;
        }
      }
      return true;
    });

    setFilteredResults(filtered);
    setCurrentPage(1);
    if (!filtered.length) toast({ title: 'No records found', status: 'info', duration: 3000, isClosable: true });
  };

  const handleReset = () => {
    setSearchParams({ vehicleNumber: '', ticketNo: '', sadNumber: '', containerId: '' });
    setDateFrom('');
    setDateTo('');
    setTimeFrom('');
    setTimeTo('');
    const confirmedIds = new Set(confirmedTickets.filter((t) => t.ticket_id).map((t) => t.ticket_id));
    const confirmedNos = new Set(confirmedTickets.filter((t) => t.ticket_no).map((t) => t.ticket_no));
    const unconfirmed = allTickets.filter((t) => t.status !== 'Exited' && !confirmedIds.has(t.ticket_id) && !confirmedNos.has(t.ticket_no));
    setFilteredResults(unconfirmed);
    setCurrentPage(1);
    setSortKey('ticket_no');
    setSortOrder('asc');
    toast({ title: 'Filters reset', status: 'info', duration: 1500 });
  };

  const isFilterActive = useMemo(() => {
    const sp = searchParams || {};
    return !!(sp.vehicleNumber || sp.ticketNo || sp.sadNumber || dateFrom || dateTo || timeFrom || timeTo);
  }, [searchParams, dateFrom, dateTo, timeFrom, timeTo]);

  // Sorting & pagination UI helpers

  const sortedResults = useMemo(() => {
    const arr = [...filteredResults];
    arr.sort((a, b) => {
      let va = a[sortKey];
      let vb = b[sortKey];
      if (sortKey === 'date') {
        va = new Date(a.submitted_at || a.date || 0);
        vb = new Date(b.submitted_at || b.date || 0);
      } else {
        va = (va ?? '').toString().toLowerCase();
        vb = (vb ?? '').toString().toLowerCase();
      }
      if (va < vb) return sortOrder === 'asc' ? -1 : 1;
      if (va > vb) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [filteredResults, sortKey, sortOrder]);

  const paginatedResults = useMemo(() => {
    const start = (currentPage - 1) * pendingPageSize;
    return sortedResults.slice(start, start + pendingPageSize);
  }, [sortedResults, currentPage, pendingPageSize]);

  const totalPages = Math.max(1, Math.ceil(sortedResults.length / pendingPageSize));

  // Confirmed list search + paging
  const filteredConfirmed = useMemo(() => {
    if (!confirmedQuery) return confirmedTickets;
    const q = confirmedQuery.toLowerCase();
    return confirmedTickets.filter((r) => {
      const truck = (r.vehicle_number || r.gnsw_truck_no || '').toString().toLowerCase();
      const driver = (r.driver || '').toString().toLowerCase();
      const sad = (r.sad_no || '').toString().toLowerCase();
      const ticketNo = (r.ticket_no || '').toString().toLowerCase();
      return truck.includes(q) || driver.includes(q) || sad.includes(q) || ticketNo.includes(q);
    });
  }, [confirmedTickets, confirmedQuery]);

  const paginatedConfirmed = useMemo(() => {
    const start = (confirmedPage - 1) * PAGE_SIZE;
    return filteredConfirmed.slice(start, start + PAGE_SIZE);
  }, [filteredConfirmed, confirmedPage]);

  const totalConfirmedPages = Math.max(1, Math.ceil(filteredConfirmed.length / PAGE_SIZE));

  // ---------------------
  // Modal actions (unchanged logic, but attach created_by & edited_by)
  // ---------------------
  const openActionModal = async (ticket, type) => {
    setActionType(type);
    if (type === 'view') {
      let resolved = { ...ticket };
      try {
        if (!resolved.driver && resolved.file_url && isPdfUrl(resolved.file_url)) {
          const text = await extractTextFromPdfUrl(resolved.file_url);
          const parsed = parseDriverNameFromText(text);
          if (parsed) {
            resolved.driver = parsed;
            if (resolved.id) {
              try {
                // update outgate driver (best-effort)
                await supabaseWithRetry(() => supabase.from('outgate').update({ driver: parsed }).eq('id', resolved.id));
              } catch (e) {
                console.warn('Could not update outgate driver field', e);
              }
            }
          }
        }
      } catch (err) {
        // swallow extraction errors
      }
      setSelectedTicket(resolved);
      onOpen();
    } else {
      setSelectedTicket(ticket);
      onOpen();
    }
  };

  const handleConfirmExit = async () => {
    if (!selectedTicket) return;
    try {
      let resolvedDriver = selectedTicket.driver || selectedTicket.driver_name || null;
      if (!resolvedDriver && selectedTicket.file_url && isPdfUrl(selectedTicket.file_url)) {
        const text = await extractTextFromPdfUrl(selectedTicket.file_url);
        const parsed = parseDriverNameFromText(text);
        if (parsed) resolvedDriver = parsed;
      }
      const { gross, tare, net } = computeWeights(selectedTicket);

      const payload = {
        ticket_id: selectedTicket.ticket_id || null,
        ticket_no: selectedTicket.ticket_no || null,
        vehicle_number: selectedTicket.gnsw_truck_no || selectedTicket.vehicle_number || null,
        container_id: selectedTicket.container_no || null,
        sad_no: selectedTicket.sad_no || null,
        gross,
        tare,
        net,
        date: selectedTicket.date || null,
        file_url: selectedTicket.file_url || null,
        file_name: selectedTicket.file_name || null,
        driver: resolvedDriver || null,
      };

      if (user && user.id) payload.created_by = user.id;
      if (currentUsername) payload.edited_by = currentUsername;

      // Check if an outgate already exists for this ticket (by ticket_id OR ticket_no)
      try {
        const orParts = [];
        if (payload.ticket_id) orParts.push(`ticket_id.eq.${payload.ticket_id}`);
        if (payload.ticket_no) orParts.push(`ticket_no.eq.${payload.ticket_no}`);
        let existing = null;
        if (orParts.length) {
          const resp = await supabaseWithRetry(() => supabase.from('outgate').select('id,created_at').or(orParts.join(',')));
          if (resp.error) console.warn('check existing outgate error', resp.error);
          existing = resp.data;
        }
        if (existing && existing.length) {
          toast({
            title: 'Already confirmed',
            description: `Ticket ${payload.ticket_no || payload.ticket_id} already has a confirmed exit.`,
            status: 'warning',
            duration: 4000,
            isClosable: true,
          });

          // Ensure tickets row is marked Exited using best available identifier (id -> ticket_id -> ticket_no)
          try {
            if (selectedTicket.id) {
              await supabaseWithRetry(() => supabase.from('tickets').update({ status: 'Exited' }).eq('id', selectedTicket.id));
            } else if (selectedTicket.ticket_id) {
              await supabaseWithRetry(() => supabase.from('tickets').update({ status: 'Exited' }).eq('ticket_id', selectedTicket.ticket_id));
            } else if (selectedTicket.ticket_no) {
              await supabaseWithRetry(() => supabase.from('tickets').update({ status: 'Exited' }).eq('ticket_no', selectedTicket.ticket_no));
            }

            // Reflect change in UI so row disappears
            setFilteredResults((prev) => prev.filter((t) => t.id !== selectedTicket.id && t.ticket_id !== selectedTicket.ticket_id && t.ticket_no !== selectedTicket.ticket_no));
            setAllTickets((prev) => prev.filter((t) => t.id !== selectedTicket.id && t.ticket_id !== selectedTicket.ticket_id && t.ticket_no !== selectedTicket.ticket_no));
            setSelectedPending((prev) => {
              const next = new Set(prev);
              if (selectedTicket.ticket_id) next.delete(selectedTicket.ticket_id);
              return next;
            });

            // refresh counts/list in background (sequential small calls)
            await fetchTickets();
            await fetchConfirmedExits();
            await fetchTotalTickets();
          } catch (e) {
            console.warn('mark exited after existing outgate failed', e);
          }

          onClose();
          return;
        }
      } catch (e) {
        console.warn('existing outgate check failed', e);
      }

      // Insert outgate
      const insertResp = await supabaseWithRetry(() => supabase.from('outgate').insert([payload]));
      if (insertResp.error) {
        toast({ title: 'Error confirming exit', description: insertResp.error.message || 'DB error', status: 'error', duration: 5000, isClosable: true });
        return;
      }

      // Update tickets.status -> 'Exited' robustly (use id when present, else ticket_id, else ticket_no)
      try {
        if (selectedTicket.id) {
          await supabaseWithRetry(() => supabase.from('tickets').update({ status: 'Exited' }).eq('id', selectedTicket.id));
        } else if (selectedTicket.ticket_id) {
          await supabaseWithRetry(() => supabase.from('tickets').update({ status: 'Exited' }).eq('ticket_id', selectedTicket.ticket_id));
        } else if (selectedTicket.ticket_no) {
          await supabaseWithRetry(() => supabase.from('tickets').update({ status: 'Exited' }).eq('ticket_no', selectedTicket.ticket_no));
        }
      } catch (e) {
        console.warn('Error updating tickets status', e);
      }

      toast({ title: `Exit confirmed for ${selectedTicket.gnsw_truck_no}`, status: 'success', duration: 3000, isClosable: true });

      // Instantly remove from UI
      setFilteredResults((prev) => prev.filter((t) => t.id !== selectedTicket.id && t.ticket_id !== selectedTicket.ticket_id && t.ticket_no !== selectedTicket.ticket_no));
      setAllTickets((prev) => prev.filter((t) => t.id !== selectedTicket.id && t.ticket_id !== selectedTicket.ticket_id && t.ticket_no !== selectedTicket.ticket_no));
      setSelectedPending((prev) => {
        const next = new Set(prev);
        if (selectedTicket.ticket_id) next.delete(selectedTicket.ticket_id);
        return next;
      });

      // Re-fetch to ensure confirmed list and counts are fresh
      await fetchTickets();
      await fetchConfirmedExits();
      await fetchTotalTickets();
      onClose();
    } catch (err) {
      console.error('Confirm exit error:', err);
      toast({ title: 'Error', description: err?.message || 'Failed to confirm exit', status: 'error', duration: 5000, isClosable: true });
    }
  };

  // Bulk confirm selected
  const bulkConfirmSelected = async () => {
    if (!selectedPending.size) {
      toast({ title: 'No selection', status: 'info' });
      return;
    }
    const ids = Array.from(selectedPending);
    try {
      toast({ title: `Processing ${ids.length} selected...`, status: 'info', duration: 2000 });
      for (const tId of ids) {
        try {
          // first try to fetch by ticket_id, if not found try by id
          let ticketRow = null;
          if (tId) {
            const resp = await supabaseWithRetry(() => supabase.from('tickets').select('*').eq('ticket_id', tId).limit(1).maybeSingle());
            if (!resp.error) ticketRow = resp.data;
            if (!ticketRow) {
              const resp2 = await supabaseWithRetry(() => supabase.from('tickets').select('*').eq('id', tId).limit(1).maybeSingle());
              if (!resp2.error) ticketRow = resp2.data;
            }
          }
          if (!ticketRow) continue;
          const { gross, tare, net } = computeWeights(ticketRow);
          const payload = {
            ticket_id: ticketRow.ticket_id,
            ticket_no: ticketRow.ticket_no || null,
            vehicle_number: ticketRow.gnsw_truck_no || null,
            container_id: ticketRow.container_no || null,
            sad_no: ticketRow.sad_no || null,
            gross,
            tare,
            net,
            date: ticketRow.date || ticketRow.submitted_at || null,
            file_url: ticketRow.file_url || null,
            file_name: ticketRow.file_name || null,
            driver: ticketRow.driver || null,
          };
          if (user && user.id) payload.created_by = user.id;
          if (currentUsername) payload.edited_by = currentUsername;

          // check existing outgate by ticket_id or ticket_no
          const orParts = [];
          if (payload.ticket_id) orParts.push(`ticket_id.eq.${payload.ticket_id}`);
          if (payload.ticket_no) orParts.push(`ticket_no.eq.${payload.ticket_no}`);
          let exists = null;
          if (orParts.length) {
            const resp = await supabaseWithRetry(() => supabase.from('outgate').select('id').or(orParts.join(',')).limit(1));
            exists = resp.data;
          }
          if (!(exists && exists.length)) {
            await supabaseWithRetry(() => supabase.from('outgate').insert([payload]));
          }

          // Update ticket row status: prefer id if available in ticketRow
          if (ticketRow.id) {
            await supabaseWithRetry(() => supabase.from('tickets').update({ status: 'Exited' }).eq('id', ticketRow.id));
          } else if (ticketRow.ticket_id) {
            await supabaseWithRetry(() => supabase.from('tickets').update({ status: 'Exited' }).eq('ticket_id', ticketRow.ticket_id));
          } else if (ticketRow.ticket_no) {
            await supabaseWithRetry(() => supabase.from('tickets').update({ status: 'Exited' }).eq('ticket_no', ticketRow.ticket_no));
          }

          // Remove from UI immediately
          setFilteredResults((prev) => prev.filter((t) => t.id !== ticketRow.id && t.ticket_id !== ticketRow.ticket_id && t.ticket_no !== ticketRow.ticket_no));
          setAllTickets((prev) => prev.filter((t) => t.id !== ticketRow.id && t.ticket_id !== ticketRow.ticket_id && t.ticket_no !== ticketRow.ticket_no));
        } catch (e) {
          console.warn('bulk confirm per-ticket failed', tId, e);
        }
      }

      // Re-fetch once after loop
      await fetchTickets();
      await fetchConfirmedExits();
      await fetchTotalTickets();

      try {
        let confetti = null;
        if (window && window.confetti) confetti = window.confetti;
        else {
          const mod = await import('canvas-confetti').catch(() => null);
          if (mod && mod.default) confetti = mod.default;
        }
        if (confetti) confetti({ particleCount: Math.min(240, ids.length * 8), spread: 140, origin: { y: 0.6 } });
      } catch (e) {}

      toast({ title: `Bulk confirmed ${ids.length}`, status: 'success' });
      setSelectedPending(new Set());
    } catch (err) {
      console.error('bulk confirm failed', err);
      toast({ title: 'Bulk confirm failed', description: err?.message || 'Unexpected', status: 'error' });
    }
  };

  // Bulk export selected confirmed
  const bulkExportConfirmedSelected = () => {
    if (!selectedConfirmed.size) {
      toast({ title: 'No selection', status: 'info' });
      return;
    }
    const rows = filteredConfirmed
      .filter((r) => selectedConfirmed.has(r.id ?? r.ticket_id))
      .map((r) => {
        const w = computeWeights(r);
        return {
          'Ticket No': r.ticket_no ?? '',
          'Truck': r.vehicle_number ?? r.gnsw_truck_no ?? '',
          'SAD No': r.sad_no ?? '',
          'Container': r.container_id ?? '',
          'Exit Date': r.created_at ? new Date(r.created_at).toLocaleString() : '',
          'Weighed At': r.weighed_at ? new Date(r.weighed_at).toLocaleString() : '',
          'Gross (KG)': w.gross ?? '',
          'Tare (KG)': w.tare ?? '',
          'Net (KG)': w.net ?? '',
          'Driver': r.driver ?? '',
        };
      });
    exportToCSV(rows, `confirmed-exits-selected_${new Date().toISOString().slice(0,10)}.csv`);
    toast({ title: `Exported ${rows.length} rows`, status: 'success' });
    setSelectedConfirmed(new Set());
  };

  // ----- handleExportConfirmed (existing full export) -----
  const handleExportConfirmed = () => {
    const rows = filteredConfirmed.map((r) => {
      const w = computeWeights(r);
      return {
        'Ticket No': r.ticket_no ?? '',
        'Truck': r.vehicle_number ?? r.gnsw_truck_no ?? '',
        'SAD No': r.sad_no ?? '',
        'Container': r.container_id ?? '',
        'Exit Date': r.created_at ? new Date(r.created_at).toLocaleString() : '',
        'Weighed At': r.weighed_at ? new Date(r.weighed_at).toLocaleString() : '',
        'Gross (KG)': w.gross ?? '',
        'Tare (KG)': w.tare ?? '',
        'Net (KG)': w.net ?? '',
        'Driver': r.driver ?? '',
      };
    });
    if (!rows.length) {
      toast({ title: 'No rows to export', status: 'info', duration: 2000 });
      return;
    }
    exportToCSV(rows, `confirmed-exits_${new Date().toISOString().slice(0,10)}.csv`);
    toast({ title: `Export started (${rows.length} rows)`, status: 'success', duration: 2500 });
  };

  // Modal helpers
  const copyModalToClipboard = async () => {
    if (!selectedTicket) return;
    const w = computeWeights(selectedTicket);
    const lines = [
      `Ticket: ${selectedTicket.ticket_no || '-'}`,
      `Truck: ${selectedTicket.gnsw_truck_no || selectedTicket.vehicle_number || '-'}`,
      `SAD: ${selectedTicket.sad_no || '-'}`,
      `Container: ${selectedTicket.container_no || selectedTicket.container_id || '-'}`,
      `Driver: ${selectedTicket.driver || '-'}`,
      `Gross (KG): ${formatWeight(w.gross)} kg`,
      `Tare (KG): ${formatWeight(w.tare)} kg`,
      `Net (KG): ${formatWeight(w.net)} kg`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(lines);
      toast({ title: 'Copied to clipboard', status: 'success', duration: 1500 });
    } catch {
      toast({ title: 'Unable to copy', status: 'error', duration: 1500 });
    }
  };

  const printModal = () => {
    if (!printRef.current) return;
    const content = printRef.current.innerHTML;
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) return;
    w.document.write(`<html><head><title>Ticket</title></head><body>${content}</body></html>`);
    w.document.close();
    w.focus();
    w.print();
    w.close();
  };

  // keyboard navigation handlers for pending table
  useEffect(() => {
    const onKey = (e) => {
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedPendingIndex((i) => Math.min(paginatedResults.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedPendingIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        const idx = focusedPendingIndex;
        if (idx >= 0 && idx < paginatedResults.length) {
          openActionModal(paginatedResults[idx], 'exit');
        }
      } else if (e.key === ' ') {
        const idx = focusedPendingIndex;
        if (idx >= 0 && idx < paginatedResults.length) {
          e.preventDefault();
          const id = paginatedResults[idx].ticket_id;
          setSelectedPending((s) => {
            const next = new Set(s);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          });
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        const ids = paginatedResults.map((r) => r.ticket_id).filter(Boolean);
        setSelectedPending(new Set(ids));
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paginatedResults, focusedPendingIndex]);

  useEffect(() => {
    const idx = focusedPendingIndex;
    const ref = pendingRowRefs.current?.[idx];
    if (ref && ref.focus) {
      ref.focus();
    }
  }, [focusedPendingIndex]);

  // Bulk orb confirm (visible page)
  const handleOrbConfirmAll = async () => {
    try {
      const ids = paginatedResults.map((t) => t.ticket_id).filter(Boolean);
      if (!ids.length) {
        toast({ title: 'Nothing to confirm', status: 'info' });
        return;
      }
      toast({ title: `Bulk confirming ${ids.length} tickets...`, status: 'info', duration: 2000 });
      for (const id of ids) {
        try {
          let ticketRow = null;
          if (id) {
            const resp = await supabaseWithRetry(() => supabase.from('tickets').select('*').eq('ticket_id', id).limit(1).maybeSingle());
            ticketRow = resp?.data || null;
            if (!ticketRow) {
              const resp2 = await supabaseWithRetry(() => supabase.from('tickets').select('*').eq('id', id).limit(1).maybeSingle());
              ticketRow = resp2?.data || ticketRow;
            }
          }
          if (!ticketRow) continue;
          const { gross, tare, net } = computeWeights(ticketRow);
          const payload = {
            ticket_id: ticketRow.ticket_id,
            ticket_no: ticketRow.ticket_no || null,
            vehicle_number: ticketRow.gnsw_truck_no || null,
            container_id: ticketRow.container_no || null,
            sad_no: ticketRow.sad_no || null,
            gross,
            tare,
            net,
            date: ticketRow.date || ticketRow.submitted_at || null,
            file_url: ticketRow.file_url || null,
            file_name: ticketRow.file_name || null,
            driver: ticketRow.driver || null,
          };
          if (user && user.id) payload.created_by = user.id;
          if (currentUsername) payload.edited_by = currentUsername;

          // check existing outgate
          const orParts = [];
          if (payload.ticket_id) orParts.push(`ticket_id.eq.${payload.ticket_id}`);
          if (payload.ticket_no) orParts.push(`ticket_no.eq.${payload.ticket_no}`);
          if (orParts.length) {
            const respEx = await supabaseWithRetry(() => supabase.from('outgate').select('id').or(orParts.join(',')).limit(1));
            if (!(respEx.data && respEx.data.length)) {
              await supabaseWithRetry(() => supabase.from('outgate').insert([payload]));
            }
          } else {
            await supabaseWithRetry(() => supabase.from('outgate').insert([payload]));
          }

          // update tickets.status
          if (ticketRow.id) {
            await supabaseWithRetry(() => supabase.from('tickets').update({ status: 'Exited' }).eq('id', ticketRow.id));
          } else if (ticketRow.ticket_id) {
            await supabaseWithRetry(() => supabase.from('tickets').update({ status: 'Exited' }).eq('ticket_id', ticketRow.ticket_id));
          } else if (ticketRow.ticket_no) {
            await supabaseWithRetry(() => supabase.from('tickets').update({ status: 'Exited' }).eq('ticket_no', ticketRow.ticket_no));
          }

          // remove from UI immediately
          setFilteredResults((prev) => prev.filter((t) => t.id !== ticketRow.id && t.ticket_id !== ticketRow.ticket_id && t.ticket_no !== ticketRow.ticket_no));
          setAllTickets((prev) => prev.filter((t) => t.id !== ticketRow.id && t.ticket_id !== ticketRow.ticket_id && t.ticket_no !== ticketRow.ticket_no));
        } catch (e) {
          console.warn('orb confirm per-ticket failed', id, e);
        }
      }
      await fetchTickets(); await fetchConfirmedExits(); await fetchTotalTickets();
      try {
        const mod = await import('canvas-confetti').catch(() => null);
        const confetti = mod?.default ?? window.confetti;
        if (confetti) confetti({ particleCount: 140, spread: 140, origin: { y: 0.6 } });
      } catch (e) {}
      toast({ title: `Marked ${ids.length} as Exited`, status: 'success' });
      closeOrb();
    } catch (err) {
      console.error('Orb bulk confirm failed', err);
      toast({ title: 'Bulk action failed', description: err?.message || 'Unexpected', status: 'error' });
    }
  };

  // Voice commands (simple)
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;
    if (!SpeechRecognition) return undefined;
    const r = new SpeechRecognition();
    r.lang = 'en-US';
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (evt) => {
      try {
        const text = (evt.results[0] && evt.results[0][0] && evt.results[0][0].transcript) ? evt.results[0][0].transcript.toLowerCase() : '';
        if (text.includes('promote all')) {
          toast({ title: 'Voice: Promote all', description: 'Focusing first pending page', status: 'info' });
          setCurrentPage(1);
        } else if (text.includes('demote row') || text.includes('demote')) {
          const m = text.match(/demote (?:row )?(\d+)/);
          if (m && m[1]) {
            const n = Number(m[1]) - 1;
            toast({ title: `Voice: Demote row ${m[1]}`, description: `Would demote row index ${n} in UI (demo)`, status: 'info' });
            const per = pendingPageSize;
            const desiredPage = Math.floor(n / per) + 1;
            setCurrentPage(Math.max(1, Math.min(totalPages, desiredPage)));
          } else {
            toast({ title: 'Voice command not recognized', status: 'warning' });
          }
        } else if (text.includes('confirm all')) {
          toast({ title: 'Voice: Confirm all (opens orb)', status: 'info' });
          openOrb();
        } else {
          toast({ title: `Voice: "${text}"`, status: 'info' });
        }
      } catch (e) {
        console.warn('voice handler problem', e);
      }
    };
    r.onerror = (e) => {
      console.warn('Speech recognition error', e);
      setIsListening(false);
    };
    recognitionRef.current = r;
    return () => {
      try {
        if (recognitionRef.current) {
          recognitionRef.current.onresult = null;
          recognitionRef.current.onerror = null;
          recognitionRef.current.stop?.();
        }
      } catch (e) {}
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPageSize, totalPages]);

  const toggleListening = () => {
    if (!recognitionRef.current) {
      toast({ title: 'Voice not supported', description: 'Your browser does not support Web Speech API', status: 'warning' });
      return;
    }
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
      toast({ title: 'Voice listening stopped', status: 'info' });
      return;
    }
    try {
      recognitionRef.current.start();
      setIsListening(true);
      toast({ title: 'Voice listening started', status: 'success' });
    } catch (err) {
      console.warn('start recognition failed', err);
      setIsListening(false);
      toast({ title: 'Voice start failed', status: 'error' });
    }
  };

  // small helper to format date in the page
  const formatDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  };

  // Render pending card (mobile)
  const renderPendingCard = (ticket, idx) => {
    const { gross, tare, net } = computeWeights(ticket);
    // Per request: pending tickets should use submitted_at instead of date
    const ticketDate = ticket.submitted_at ? formatDate(ticket.submitted_at) : (ticket.date ? formatDate(ticket.date) : '—');
    const checked = selectedPending.has(ticket.ticket_id);
    return (
      <Box key={ticket.ticket_id || ticket.ticket_no} p={4}
        borderRadius="14px" boxShadow="0 10px 30px rgba(2,6,23,0.06)" mb={3} border="1px solid rgba(2,6,23,0.06)"
        tabIndex={0}>
        <Flex justify="space-between" align="center" mb={2}>
          <Box>
            <Text fontWeight="bold">Ticket {ticket.ticket_no || '—'}</Text>
            <Text fontSize="sm" color="gray.500">{ticket.gnsw_truck_no || '—'}</Text>
          </Box>
          <Box textAlign="right">
            <Badge colorScheme="teal">{ticket.sad_no ?? 'No SAD'}</Badge>
            <Text fontSize="xs" color="gray.500">{ticketDate}</Text>
          </Box>
        </Flex>

        <SimpleGrid columns={3} spacing={2} mb={3}>
          <Box textAlign="center"><Text fontSize="xs" color="gray.600">Gross</Text><Text fontWeight="bold">{formatWeight(gross)}</Text></Box>
          <Box textAlign="center"><Text fontSize="xs" color="gray.600">Tare</Text><Text fontWeight="bold">{formatWeight(tare)}</Text></Box>
          <Box textAlign="center"><Text fontSize="xs" color="gray.600">Net</Text><Text fontWeight="bold">{formatWeight(net)}</Text></Box>
        </SimpleGrid>

        <HStack spacing={2}>
          <Checkbox isChecked={checked} onChange={(e) => {
            const id = ticket.ticket_id;
            setSelectedPending((s) => {
              const next = new Set(s);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
          }} aria-label={`Select ticket ${ticket.ticket_no}`} />
          <Button size="sm" colorScheme="green" leftIcon={<CheckIcon />} onClick={() => openActionModal(ticket, 'exit')}>Confirm Exit</Button>
          <IconButton size="sm" variant="outline" aria-label="View" icon={<FaFilePdf />} onClick={() => openActionModal(ticket, 'view')} />
        </HStack>
      </Box>
    );
  };

  // Fancy stat card styles
  const statStyles = [
    { bg: 'linear-gradient(135deg,#6D28D9 0%, #06B6D4 100%)', color: 'white' },
    { bg: 'linear-gradient(135deg,#0ea5a4 0%, #60a5fa 100%)', color: 'white' },
    { bg: 'linear-gradient(135deg,#f97316 0%, #fb7185 100%)', color: 'white' },
    { bg: 'linear-gradient(135deg,#06b6d4 0%, #7c3aed 100%)', color: 'white' },
  ];

  // ---------------------
  // Render
  // ---------------------
  return (
    <Box p={{ base: 4, md: 8 }}>
      <style>{`
        :root{
          --muted: rgba(7,17,25,0.55);
          --text-dark: #071126;
          --text-light: #ffffff;
          --radius: 14px;
          --glass-border: rgba(2,6,23,0.06);
        }
        .fancy-table {
          width:100%;
          border-collapse: separate;
          border-spacing: 0;
          background: transparent;
        }
        .fancy-table thead th {
          background: linear-gradient(90deg,#b02a37,#8a1f27);
          color: var(--text-light);
          padding: 12px 10px;
          font-weight: 700;
          text-align: left;
          border-right: 1px solid rgba(255,255,255,0.06);
        }
        .fancy-table tbody td {
          background: linear-gradient(180deg,#ffffff,#fbfdff);
          padding: 10px;
          border-bottom: 1px solid #e6edf6;
          border-right: 1px solid #f0f4f8;
          vertical-align: middle;
          color: var(--text-dark);
        }
        .fancy-table tbody tr:last-child td { border-bottom: none; }
        .fancy-table thead th:first-child, .fancy-table tbody td:first-child { border-left: 1px solid rgba(0,0,0,0.03); }
        .table-wrapper { overflow-x:auto; border-radius:12px; border:1px solid var(--glass-border); box-shadow: 0 8px 24px rgba(2,6,23,0.04); padding:6px;}
        @media (max-width:780px) {
          .fancy-table thead { display:none; }
          .fancy-table tbody tr { display:block; background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(255,255,255,0.96)); margin-bottom:14px; border-radius:14px; padding:12px; box-shadow: 0 8px 24px rgba(2,6,23,0.04); }
          .fancy-table tbody td { display:block; text-align:left; padding:8px 0; border:none; }
          .fancy-table tbody td::before { content: attr(data-label); display:inline-block; width:130px; font-weight:700; color:var(--muted); }
        }
        @media (min-width:1400px) {
          .panel-3d { transform-style: preserve-3d; perspective:1200px; transition: transform 0.6s cubic-bezier(.2,.8,.2,1); }
          .panel-3d:hover { transform: rotateY(6deg) rotateX(2deg) translateZ(6px); box-shadow: 0 30px 60px rgba(2,6,23,0.12); }
        }
        .row-focus {
          outline: 2px solid rgba(99,102,241,0.24);
          box-shadow: 0 6px 18px rgba(99,102,241,0.06);
        }
        /* small visual niceties */
        .orb-cta { transition: transform 0.22s; }
        .orb-cta:hover { transform: translateY(-4px) scale(1.03); }
      `}</style>

      <Flex justify="space-between" align="center" mb={6} flexWrap="wrap" gap={4}>
        <Stack spacing={1}>
          <Heading size="lg">Confirm Vehicle Exit</Heading>
          <Text color="gray.600">Search pending tickets, confirm exits, and review recent exits.</Text>
        </Stack>

        <HStack spacing={2}>
          <Tooltip label="Export pending (filtered) to CSV"><Button leftIcon={<DownloadIcon />} colorScheme="teal" variant="ghost" onClick={() => {
            const rows = sortedResults.map((t) => {
              const w = computeWeights(t);
              return {
                'Ticket No': t.ticket_no || '',
                'Truck': t.gnsw_truck_no || '',
                'SAD No': t.sad_no || '',
                'Container': t.container_no || '',
                'Entry Date': t.submitted_at ? formatDate(t.submitted_at) : (t.date ? formatDate(t.date) : ''),
                'Gross (KG)': w.gross ?? '',
                'Tare (KG)': w.tare ?? '',
                'Net (KG)': w.net ?? '',
              };
            });
            if (!rows.length) return toast({ title: 'No rows to export', status: 'info' });
            exportToCSV(rows, 'pending-tickets.csv');
            toast({ title: `Export started (${rows.length} rows)`, status: 'success' });
          }}>Export CSV</Button></Tooltip>

          <Button leftIcon={<DownloadIcon />} variant="outline" onClick={handleExportConfirmed}>Export Confirmed</Button>

          <Button leftIcon={<RepeatIcon />} variant="ghost" onClick={handleReset}>Reset</Button>

          <Tooltip label={isListening ? 'Stop voice' : 'Start voice'}>
            <Button onClick={toggleListening} colorScheme={isListening ? 'red' : 'purple'} leftIcon={<FaMagic />}>{isListening ? 'Listening…' : 'Voice'}</Button>
          </Tooltip>
        </HStack>
      </Flex>

      {/* Stats */}
      <SimpleGrid columns={{ base: 1, md: 4 }} spacing={3} mb={6}>
        <Stat borderRadius="md" p={4} className="panel-3d" sx={{ background: statStyles[0].bg, color: statStyles[0].color }}>
          <StatLabel>Total Pending</StatLabel>
          <StatNumber>{filteredResults.length}</StatNumber>
          <StatHelpText>Tickets awaiting exit</StatHelpText>
        </Stat>

        <Stat borderRadius="md" p={4} className="panel-3d" sx={{ background: statStyles[1].bg, color: statStyles[1].color }}>
          <StatLabel>Confirmed Exits</StatLabel>
          <StatNumber>{exitedCount}</StatNumber>
          <StatHelpText>All tickets with status Exited</StatHelpText>
        </Stat>

        <Stat borderRadius="md" p={4} className="panel-3d" sx={{ background: statStyles[2].bg, color: statStyles[2].color }}>
          <StatLabel>Total Tickets</StatLabel>
          <StatNumber>{totalTickets != null ? totalTickets : '—'}</StatNumber>
          <StatHelpText>All tickets</StatHelpText>
        </Stat>

        <Stat borderRadius="md" p={4} className="panel-3d" sx={{ background: statStyles[3].bg, color: statStyles[3].color }}>
          <StatLabel>Page Size</StatLabel>
          <StatNumber>{pendingPageSize}</StatNumber>
          <StatHelpText>
            <Select size="sm" value={pendingPageSize} onChange={(e) => { setPendingPageSize(Number(e.target.value)); setCurrentPage(1); }}>
              {[5, 10, 20, 50].map((n) => <option key={n} value={n}>{n} / page</option>)}
            </Select>
          </StatHelpText>
        </Stat>
      </SimpleGrid>

      {/* Filters */}
      <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4} mb={4}>
        <Input name="vehicleNumber" placeholder="Vehicle Number" value={searchParams.vehicleNumber} onChange={handleInputChange} />
        <Input name="ticketNo" placeholder="Ticket No" value={searchParams.ticketNo} onChange={handleInputChange} />
        <Input name="sadNumber" placeholder="SAD Number" value={searchParams.sadNumber} onChange={handleInputChange} />
      </SimpleGrid>

      <SimpleGrid columns={{ base: 1, md: 4 }} spacing={4} mb={4}>
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        <Input type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} />
        <Input type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} />
      </SimpleGrid>

      <Flex mb={6} gap={4}>
        <Button leftIcon={<SearchIcon />} colorScheme="blue" onClick={handleSearch}>Search</Button>
        {isFilterActive && <Button variant="outline" onClick={handleReset}>Reset</Button>}

        <HStack ml="auto" spacing={2}>
          <Button variant="ghost" size="sm" onClick={() => {
            if (!selectedPending.size) return toast({ title: 'No selection', status: 'info' });
            bulkConfirmSelected();
          }}>Confirm Selected ({selectedPending.size})</Button>

          <Button variant="ghost" size="sm" onClick={() => {
            if (!selectedConfirmed.size) return toast({ title: 'No selection', status: 'info' });
            bulkExportConfirmedSelected();
          }}>Export Confirmed Selected ({selectedConfirmed.size})</Button>
        </HStack>
      </Flex>

      {/* Pending */}
      {loading ? (
        <Flex justify="center" mb={6}><Spinner /></Flex>
      ) : isMobile ? (
        <VStack align="stretch" spacing={3} mb={6}>
          {paginatedResults.map((ticket, idx) => renderPendingCard(ticket, idx))}
        </VStack>
      ) : (
        <Box className="table-wrapper mb-6">
          <Table className="fancy-table" size="sm">
            <Thead>
              <Tr>
                <Th><Checkbox isChecked={selectedPending.size > 0 && selectedPending.size === paginatedResults.filter(r => r.ticket_id).length} onChange={(e) => {
                  if (e.target.checked) {
                    const ids = new Set(selectedPending);
                    paginatedResults.forEach(r => { if (r.ticket_id) ids.add(r.ticket_id); });
                    setSelectedPending(ids);
                  } else {
                    const ids = new Set(selectedPending);
                    paginatedResults.forEach(r => { if (r.ticket_id) ids.delete(r.ticket_id); });
                    setSelectedPending(ids);
                  }
                }} aria-label="Select all visible" /></Th>
                <Th>SAD/Ticket</Th>
                <Th>Truck</Th>
                <Th isNumeric>Gross (kg)</Th>
                <Th isNumeric>Tare (kg)</Th>
                <Th isNumeric>Net (kg)</Th>
                <Th>Date</Th>
                <Th>Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {paginatedResults.map((ticket, idx) => {
                const { gross, tare, net } = computeWeights(ticket);
                // Per request: pending tickets should use submitted_at instead of date
                const ticketDate = ticket.submitted_at ? formatDate(ticket.submitted_at) : (ticket.date ? formatDate(ticket.date) : '—');
                const checked = selectedPending.has(ticket.ticket_id);
                return (
                  <Tr
                    key={ticket.ticket_id || ticket.ticket_no || ticket.id}
                    tabIndex={0}
                    ref={(el) => (pendingRowRefs.current[idx] = el)}
                    className={focusedPendingIndex === idx ? 'row-focus' : undefined}
                    onClick={() => setFocusedPendingIndex(idx)}
                    onDoubleClick={() => openActionModal(ticket, 'exit')}
                  >
                    <Td data-label="Select">
                      <Checkbox isChecked={checked} onChange={(e) => {
                        const id = ticket.ticket_id;
                        setSelectedPending((s) => {
                          const next = new Set(s);
                          if (next.has(id)) next.delete(id);
                          else next.add(id);
                          return next;
                        });
                      }} aria-label={`Select ticket ${ticket.ticket_no}`} />
                    </Td>

                    <Td data-label="SAD/Ticket">
                      <Text fontWeight="bold">{ticket.sad_no ?? '—'}</Text>
                      <Text fontSize="sm" color="gray.500">{ticket.ticket_no ?? '—'}</Text>
                    </Td>
                    <Td data-label="Truck">{ticket.gnsw_truck_no ?? '—'}</Td>
                    <Td isNumeric data-label="Gross">{formatWeight(gross)}</Td>
                    <Td isNumeric data-label="Tare">{formatWeight(tare)}</Td>
                    <Td isNumeric data-label="Net">{formatWeight(net)}</Td>
                    <Td data-label="Date">{ticketDate}</Td>
                    <Td data-label="Actions">
                      <HStack spacing={2}>
                        <Button size="sm" colorScheme="green" leftIcon={<CheckIcon />} onClick={() => openActionModal(ticket, 'exit')}>Confirm</Button>
                        <IconButton aria-label="View" icon={<FaFilePdf />} size="sm" variant="outline" onClick={() => openActionModal(ticket, 'view')} />
                      </HStack>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        </Box>
      )}

      {/* Pending pagination */}
      <Flex justify="center" align="center" gap={4} mb={8}>
        <IconButton icon={<ChevronLeftIcon />} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} isDisabled={currentPage === 1} />
        <Text>Page {currentPage} of {totalPages}</Text>
        <IconButton icon={<ChevronRightIcon />} onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} isDisabled={currentPage === totalPages} />
      </Flex>

      {/* Action Modal (view/confirm) */}
      <Modal isOpen={isOpen} onClose={onClose} isCentered size={actionType === 'view' ? 'xl' : 'md'}>
        <ModalOverlay />
        <ModalContent borderRadius="16px" bg="linear-gradient(180deg, #fff, #fbfdff)" boxShadow="0 30px 60px rgba(2,6,23,0.08)">
          <ModalHeader>{actionType === 'exit' ? 'Confirm Exit' : 'View/Details'}</ModalHeader>
          <ModalCloseButton />
          <ModalBody ref={printRef}>
            {actionType === 'exit' && selectedTicket && (
              <Stack spacing={4}>
                <Text>Confirm exit for <strong>{selectedTicket.gnsw_truck_no}</strong> — container <strong>{selectedTicket.container_no || '—'}</strong>?</Text>
                <Box>
                  <Text fontSize="sm" color="gray.600">Ticket No: {selectedTicket.ticket_no || '—'}</Text>
                  <Text fontSize="sm" color="gray.600">SAD No: {selectedTicket.sad_no || '—'}</Text>
                  {/* Use submitted_at for pending tickets as requested */}
                  <Text fontSize="sm" color="gray.600">Entry Date: {selectedTicket.submitted_at ? formatDate(selectedTicket.submitted_at) : (selectedTicket.date ? formatDate(selectedTicket.date) : '—')}</Text>
                </Box>
                <Box>
                  <Text fontWeight="semibold">Weight Summary</Text>
                  {(() => {
                    const { gross, tare, net } = computeWeights(selectedTicket);
                    return (
                      <SimpleGrid columns={3} spacing={2} mt={2}>
                        <Box textAlign="center"><Text fontSize="sm" color="gray.600">Gross</Text><Text fontWeight="bold">{formatWeight(gross)} kg</Text></Box>
                        <Box textAlign="center"><Text fontSize="sm" color="gray.600">Tare</Text><Text fontWeight="bold">{formatWeight(tare)} kg</Text></Box>
                        <Box textAlign="center"><Text fontSize="sm" color="gray.600">Net</Text><Text fontWeight="bold">{formatWeight(net)} kg</Text></Box>
                      </SimpleGrid>
                    );
                  })()}
                </Box>
              </Stack>
            )}

            {actionType === 'view' && selectedTicket && (
              <>
                <Flex justify="space-between" mb={3}>
                  <Box>
                    <Text fontWeight="bold">{selectedTicket.vehicle_number || selectedTicket.gnsw_truck_no || '—'}</Text>
                    <Text fontSize="sm" color="gray.600">{selectedTicket.ticket_no ? `Ticket: ${selectedTicket.ticket_no}` : 'No ticket'}</Text>
                    <Text fontSize="sm" color="gray.600">{selectedTicket.destination}</Text>
                  </Box>
                  <Box textAlign="right">
                    <Text fontSize="sm" color="gray.500">Exited At</Text>
                    <Text fontWeight="semibold">{selectedTicket.created_at ? formatDate(selectedTicket.created_at) : '—'}</Text>
                    <Badge colorScheme="teal" mt={1}>{selectedTicket.sad_no ?? 'No SAD'}</Badge>
                  </Box>
                </Flex>

                <Divider mb={3} />

                <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                  <Box>
                    <Text fontWeight="semibold">Driver</Text>
                    <Text>{selectedTicket.driver ?? '—'}</Text>
                    <Text mt={3} fontWeight="semibold">Container</Text>
                    <Text>{selectedTicket.container_id ?? selectedTicket.container_no ?? '—'}</Text>
                  </Box>

                  <Box>
                    <Text fontWeight="semibold">Weight Details (kg)</Text>
                    {(() => {
                      const { gross, tare, net } = computeWeights(selectedTicket);
                      return (
                        <>
                          <Text><b>Gross (KG):</b> {formatWeight(gross)}</Text>
                          <Text><b>Tare (KG):</b> {formatWeight(tare)}</Text>
                          <Text><b>Net (KG):</b> {formatWeight(net)}</Text>
                        </>
                      );
                    })()}

                    <Box mt={3}>
                      <Text fontWeight="semibold">More Info</Text>
                      <Text>Weighed at: {selectedTicket.weighed_at ? formatDate(selectedTicket.weighed_at) : '—'}</Text>
                      <Text>File: {selectedTicket.file_name ?? (selectedTicket.file_url ? 'Attachment' : '—')}</Text>
                      <Text>Exited by: {
                        (selectedTicket.created_by && usersMap[selectedTicket.created_by]) ?
                          (usersMap[selectedTicket.created_by].username || usersMap[selectedTicket.created_by].email) : 'Unknown / System'
                      }</Text>
                    </Box>
                  </Box>
                </SimpleGrid>

                {selectedTicket.file_url && (
                  <>
                    <Divider mt={4} mb={3} />
                    <Box border="1px solid" borderColor="gray.200" borderRadius="md" overflow="hidden" minH="300px">
                      {isPdfUrl(selectedTicket.file_url) ? (
                        <iframe src={selectedTicket.file_url} width="100%" height="100%" style={{ border: 'none', minHeight: 300 }} title="file" />
                      ) : isImageUrl(selectedTicket.file_url) ? (
                        <Box textAlign="center" p={3}>
                          <img src={selectedTicket.file_url} alt="attachment" style={{ maxWidth: '100%', maxHeight: '60vh', borderRadius: 6 }} />
                        </Box>
                      ) : (
                        <iframe src={selectedTicket.file_url} width="100%" height="100%" style={{ border: 'none', minHeight: 300 }} title="file" />
                      )}
                    </Box>
                  </>
                )}
              </>
            )}
          </ModalBody>

          {actionType === 'exit' ? (
            <ModalFooter>
              <Button mr={3} onClick={onClose}>Cancel</Button>
              <Button colorScheme="green" onClick={handleConfirmExit}>Confirm Exit</Button>
            </ModalFooter>
          ) : (
            <ModalFooter>
              <Tooltip label="Copy details"><IconButton icon={<CopyIcon />} aria-label="Copy" mr={2} onClick={copyModalToClipboard} /></Tooltip>
              <Tooltip label="Print"><IconButton icon={<FaPrint />} aria-label="Print" mr={2} onClick={printModal} /></Tooltip>
              <Button onClick={onClose}>Close</Button>
            </ModalFooter>
          )}
        </ModalContent>
      </Modal>

      {/* Confirmed exits */}
      <Flex align="center" justify="space-between" mt={10} mb={4} gap={4} flexWrap="wrap">
        <Heading size="md">Confirmed Exits</Heading>
        <HStack spacing={2}>
          <Input placeholder="Search confirmed by Truck, Driver, SAD, or Ticket No (live)" value={confirmedQuery} onChange={(e) => { setConfirmedQuery(e.target.value); setConfirmedPage(1); }} size="sm" maxW="380px" />
          <Button size="sm" onClick={() => { setConfirmedQuery(''); setConfirmedPage(1); }}>Clear</Button>
          <Button size="sm" variant="ghost" onClick={() => {
            if (!selectedConfirmed.size) return toast({ title: 'No selection', status: 'info' });
            bulkExportConfirmedSelected();
          }}>Export Selected ({selectedConfirmed.size})</Button>
        </HStack>
      </Flex>

      <Box className="table-wrapper" mb={6}>
        <Table className="fancy-table" size="sm">
          <Thead>
            <Tr>
              <Th><Checkbox isChecked={selectedConfirmed.size > 0 && selectedConfirmed.size === paginatedConfirmed.length} onChange={(e) => {
                if (e.target.checked) {
                  const ids = new Set(selectedConfirmed);
                  paginatedConfirmed.forEach(r => ids.add(r.id ?? r.ticket_id));
                  setSelectedConfirmed(ids);
                } else {
                  const ids = new Set(selectedConfirmed);
                  paginatedConfirmed.forEach(r => ids.delete(r.id ?? r.ticket_id));
                  setSelectedConfirmed(ids);
                }
              }} aria-label="Select all confirmed visible" /></Th>
              <Th>Ticket</Th>
              <Th>SAD</Th>
              <Th>Truck</Th>
              <Th isNumeric>Gross</Th>
              <Th isNumeric>Tare</Th>
              <Th isNumeric>Net</Th>
              <Th>Driver</Th>
              <Th>Exit At</Th>
              <Th>Weighed</Th>
              <Th>Actions</Th>
            </Tr>
          </Thead>
          <Tbody>
            {paginatedConfirmed.map((ticket) => {
              const { gross, tare, net } = computeWeights(ticket);
              const idKey = ticket.id ?? ticket.ticket_id ?? `outgate-${ticket.id}`;
              const checked = selectedConfirmed.has(idKey);
              return (
                <Tr key={idKey}>
                  <Td><Checkbox isChecked={checked} onChange={(e) => {
                    setSelectedConfirmed((s) => {
                      const next = new Set(s);
                      if (next.has(idKey)) next.delete(idKey);
                      else next.add(idKey);
                      return next;
                    });
                  }} aria-label={`Select confirmed ${ticket.ticket_no}`} /></Td>
                  <Td data-label="Ticket">{ticket.ticket_no ?? '-'}</Td>
                  <Td data-label="SAD">{ticket.sad_no ?? '—'}</Td>
                  <Td data-label="Truck">{ticket.vehicle_number ?? ticket.gnsw_truck_no ?? '—'}</Td>
                  <Td isNumeric data-label="Gross">{formatWeight(gross)}</Td>
                  <Td isNumeric data-label="Tare">{formatWeight(tare)}</Td>
                  <Td isNumeric data-label="Net">{formatWeight(net)}</Td>
                  <Td data-label="Driver">{ticket.driver ?? '—'}</Td>
                  <Td data-label="Exit At">{ticket.created_at ? formatDate(ticket.created_at) : '—'}</Td>
                  <Td data-label="Weighed">{ticket.weighed_at ? formatDate(ticket.weighed_at) : '—'}</Td>
                  <Td data-label="Actions">
                    <Menu>
                      <MenuButton as={IconButton} icon={<FaBars />} size="sm" aria-label="Actions" />
                      <MenuList>
                        <MenuItem icon={<FaFilePdf />} onClick={() => { setSelectedTicket(ticket); setActionType('view'); onOpen(); }}>View PDF</MenuItem>
                        <MenuItem icon={<FaUser />} onClick={async () => {
                          const by = ticket.created_by;
                          if (!by) return toast({ title: 'No creator info', description: 'This record has no created_by', status: 'info' });
                          try {
                            if (!usersMap[by]) {
                              const resp = await supabaseWithRetry(() => supabase.from('users').select('id,username,email').eq('id', by).maybeSingle());
                              if (!resp.error && resp.data) setUsersMap((p) => ({ ...p, [resp.data.id]: resp.data }));
                            }
                            const info = usersMap[by] ? (usersMap[by].username || usersMap[by].email) : 'Unknown';
                            toast({ title: `Exited by: ${info}`, status: 'info', duration: 3500 });
                          } catch (e) {
                            console.warn('user lookup failed', e);
                            toast({ title: 'Lookup failed', status: 'error' });
                          }
                        }}>Show Exited By</MenuItem>
                        <MenuItem icon={<FaEllipsisV />} onClick={() => { setSelectedTicket(ticket); setActionType('view'); onOpen(); }}>More Info</MenuItem>
                        <MenuItem icon={<FaDownload />} onClick={() => {
                          if (ticket.file_url) window.open(ticket.file_url, '_blank');
                          else toast({ title: 'No file', status: 'info' });
                        }}>Open Attachment</MenuItem>
                      </MenuList>
                    </Menu>
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      </Box>

      <Flex mt={4} justify="center" gap={2}>
        <IconButton icon={<ChevronLeftIcon />} onClick={() => setConfirmedPage((p) => Math.max(1, p - 1))} isDisabled={confirmedPage === 1} />
        <Text>Page {confirmedPage} of {totalConfirmedPages}</Text>
        <IconButton icon={<ChevronRightIcon />} onClick={() => setConfirmedPage((p) => Math.min(totalConfirmedPages, p + 1))} isDisabled={confirmedPage === totalConfirmedPages} />
      </Flex>

      {/* Crystal orb CTA */}
      <div
        style={{
          position: 'fixed',
          right: 22,
          bottom: 22,
          width: 74,
          height: 74,
          borderRadius: 999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2200,
          boxShadow: '0 10px 30px rgba(2,6,23,0.18)',
          cursor: 'pointer',
          background: 'radial-gradient(circle at 30% 20%, rgba(255,255,255,0.18), transparent 10%), linear-gradient(90deg,#7b61ff,#3ef4d0)',
          border: '1px solid rgba(255,255,255,0.18)',
        }}
        role="button"
        aria-label="Orb"
        onClick={openOrb}
        title="Magic Orb — bulk actions and voice goodies"
        className="orb-cta"
      >
        <FaMagic color="white" size={22} />
      </div>

      {/* Orb holographic modal */}
      <Modal isOpen={orbOpen} onClose={closeOrb} isCentered>
        <ModalOverlay backdropFilter="blur(6px) hue-rotate(10deg)" />
        <ModalContent borderRadius="16px" bg="linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,253,255,0.98))" boxShadow="0 40px 80px rgba(2,6,23,0.18)">
          <ModalHeader>Crystal Orb — Bulk Actions</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Text mb={3} color="gray.600">Holographic bulk actions. Use carefully — marking visible tickets as Exited will update DB status and create outgate rows.</Text>
            <Divider mb={3} />
            <VStack spacing={3} align="stretch">
              <Box>
                <Text fontWeight="semibold">Bulk Confirm Visible</Text>
                <Text fontSize="sm" color="gray.500">Marks currently visible pending tickets (current page) as <em>Exited</em>.</Text>
              </Box>

              <HStack>
                <Button colorScheme="teal" onClick={handleOrbConfirmAll}>Confirm Visible ({paginatedResults.length})</Button>
                <Button variant="outline" onClick={() => { toast({ title: 'Orb: Demo action', description: 'This is a safe demo action.', status: 'info' }); }}>Demo</Button>
                <Button onClick={async () => {
                  try {
                    const mod = await import('canvas-confetti').catch(() => null);
                    const confetti = mod?.default ?? window.confetti;
                    if (confetti) confetti({ particleCount: 120, spread: 160, origin: { y: 0.6 } });
                  } catch (e) {}
                  toast({ title: 'Stardust!', status: 'success' });
                }}>Stardust</Button>
              </HStack>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button onClick={closeOrb}>Close</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
}
