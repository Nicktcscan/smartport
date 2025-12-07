// src/pages/AgentSAD.jsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Box, Button, Container, Heading, Input, SimpleGrid, FormControl, FormLabel, Select,
  Text, Table, Thead, Tbody, Tr, Th, Td, VStack, HStack, useToast, Modal, ModalOverlay,
  ModalContent, ModalHeader, ModalBody, ModalFooter, ModalCloseButton, IconButton, Flex,
  Spinner, Tag, TagLabel, Stat, StatLabel, StatNumber, StatHelpText,
  Menu, MenuButton, MenuList, MenuItem, MenuDivider, AlertDialog, AlertDialogOverlay,
  AlertDialogContent, AlertDialogHeader, AlertDialogBody, AlertDialogFooter, useDisclosure,
  Tooltip, Box as ChakraBox, SimpleGrid as ChakraSimpleGrid, Spacer
} from '@chakra-ui/react';
import {
  FaPlus, FaFileExport, FaEllipsisV, FaRedoAlt, FaTrashAlt, FaDownload, FaFilePdf, FaCheck, FaEye, FaFileAlt,
  FaEnvelope, FaEdit, FaInfoCircle
} from 'react-icons/fa';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../supabaseClient';
import logoUrl from '../assets/logo.png';

const SAD_STATUS = ['In Progress', 'On Hold', 'Completed', 'Archived'];
const SAD_DOCS_BUCKET = 'sad-docs';
const MOTION_ROW = { initial: { opacity: 0, y: -6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 6 } };

// ---------- Regime configuration ----------
const REGIME_OPTIONS = ['IM4', 'EX1', 'IM7'];
const REGIME_LABEL_MAP = {
  IM4: 'Import',
  EX1: 'Export',
  IM7: 'Warehousing',
};
const WORD_TO_CODE = {
  import: 'IM4',
  export: 'EX1',
  warehousing: 'IM7',
  warehouse: 'IM7',
};

// ---------- helpers ----------
const formatNumber = (v) => {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(String(v).replace(/,/g, ''));
  if (!Number.isFinite(n)) return v;
  return n.toLocaleString();
};
const parseNumberString = (s) => {
  if (s === null || s === undefined) return '';
  const cleaned = String(s).replace(/[^\d.-]/g, '');
  if (cleaned === '') return '';
  return cleaned;
};
// Robust numeric parser: strips non-number chars and returns a finite number (fallback 0)
const toNumber = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const cleaned = String(v).replace(/[^\d.-]/g, '');
  if (cleaned === '' || cleaned === '.' || cleaned === '-' || cleaned === '-.' ) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
};

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

/* Helper to run promises in batches */
async function runInBatches(items = [], batchSize = 20, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const promises = chunk.map(fn);
    // eslint-disable-next-line no-await-in-loop
    const chunkRes = await Promise.all(promises);
    results.push(...chunkRes);
  }
  return results;
}

// parse "HH:MM" to minutes-from-midnight
function parseTimeToMinutes(timeStr) {
  if (!timeStr) return null;
  const [hh, mm] = String(timeStr).split(':').map((n) => Number(n));
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return hh * 60 + mm;
}

export default function SADDeclaration() {
  const toast = useToast();

  // form
  const [sadNo, setSadNo] = useState('');
  const [regime, setRegime] = useState('');
  const [declaredWeight, setDeclaredWeight] = useState('');
  const [docs, setDocs] = useState([]);

  // list + realtime
  const [sads, setSads] = useState([]);
  const [loading, setLoading] = useState(false);
  const sadsRef = useRef([]);
  sadsRef.current = sads;

  // detail modal & tickets
  const [selectedSad, setSelectedSad] = useState(null);
  const [detailTickets, setDetailTickets] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // docs modal
  const [docsModal, setDocsModal] = useState({ open: false, docs: [], sad_no: null });

  // details modal (AgentDashboard-like)
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsData, setDetailsData] = useState({ sad: null, tickets: [], created_by_username: null, completed_by_username: null, loading: false });

  // transactions mini-modal state (NEW)
  const [txModal, setTxModal] = useState({ open: false, sad_no: null, loading: false, total: 0, manual: 0, uploaded: 0, sample: [] });

  // filters / NL / paging / sorting
  const [nlQuery, setNlQuery] = useState('');
  const [nlLoading, setNlLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [regimeFilter, setRegimeFilter] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);

  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const archiveCancelRef = useRef();

  const [completeOpen, setCompleteOpen] = useState(false);
  const [completeTarget, setCompleteTarget] = useState(null);
  const completeCancelRef = useRef();

  const [activity, setActivity] = useState([]);

  // realtime
  const subRef = useRef(null);
  const ticketsSubRef = useRef(null);
  const detailTicketsSubRef = useRef(null); // subscription for details modal specific sad

  // orb CTA
  const { isOpen: orbOpen, onOpen: openOrb, onClose: closeOrb } = useDisclosure();

  // status edit modal
  const { isOpen: statusEditOpen, onOpen: openStatusEdit, onClose: closeStatusEdit } = useDisclosure();
  const [statusEditTarget, setStatusEditTarget] = useState(null);
  const [statusEditValue, setStatusEditValue] = useState('');

  // map of created_by -> username for showing who created SADs
  const createdByMapRef = useRef({});
  const createdByMap = createdByMapRef.current;

  // map of completed_by recorded by the UI (fallback if DB has no column)
  const completedByMapRef = useRef({});

  // current logged-in user (agent)
  const [currentUser, setCurrentUser] = useState(null);

  // details modal filters (search + date/time + type)
  const [detailFilters, setDetailFilters] = useState({
    q: '',
    truck: '',
    type: '', // '', 'manual', 'uploaded', 'other'
    dateFrom: '',
    dateTo: '',
    timeFrom: '',
    timeTo: ''
  });

  // ensure created_at sorting keeps newest first if sortBy is created_at
  useEffect(() => {
    if (sortBy === 'created_at' && sortDir !== 'asc') {
      setSortDir('asc');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy]);

  // ----- fetch current user on mount -----
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        let u = null;
        if (supabase.auth && supabase.auth.getUser) {
          const resp = await supabase.auth.getUser();
          u = resp?.data?.user ?? null;
        } else if (supabase.auth && supabase.auth.user) {
          u = supabase.auth.user();
        }
        if (mounted) {
          setCurrentUser(u);
          if (u && u.id) {
            const uname = (u.user_metadata && (u.user_metadata.full_name || u.user_metadata.fullName)) || u.email || u.id;
            createdByMapRef.current = { ...createdByMapRef.current, [u.id]: uname };
          }
        }
      } catch (e) {
        console.warn('Could not load current user', e);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // ----- fetchSADs: only SADs created by currentUser -----
  const fetchSADs = async (filter = null) => {
    setLoading(true);
    try {
      // Enforce per-agent visibility: if no current user, don't return global list
      if (!currentUser || !currentUser.id) {
        setSads([]);
        setLoading(false);
        return;
      }

      // base query: only SADs created by this agent
      let q = supabase.from('sad_declarations').select('*').order('created_at', { ascending: false }).eq('created_by', currentUser.id);

      if (filter) {
        if (filter.status) q = q.eq('status', filter.status);
        if (filter.sad_no) q = q.eq('sad_no', filter.sad_no);
        if (filter.regime) q = q.eq('regime', filter.regime);
      }

      const { data, error } = await q;
      if (error) throw error;

      const normalized = (data || []).map((r) => {
        const trimmed = r.sad_no != null ? String(r.sad_no).trim() : r.sad_no;
        return {
          ...r,
          sad_no: trimmed,
          _raw_sad_no: r.sad_no,
          docs: Array.isArray(r.docs) ? JSON.parse(JSON.stringify(r.docs)) : [],
          total_recorded_weight: toNumber(r.total_recorded_weight),
          ticket_count: 0,
          manual_update: r.manual_update ?? false,
        };
      });

      // get counts per sad (tickets across DB)
      const sadNos = Array.from(new Set(normalized.map((s) => (s.sad_no ? String(s.sad_no).trim() : null)).filter(Boolean)));
      let countsMap = {};
      if (sadNos.length) {
        const countResults = await runInBatches(sadNos, 25, async (sadKey) => {
          try {
            const { error: cErr, count } = await supabase
              .from('tickets')
              .select('id', { head: true, count: 'exact' })
              .eq('sad_no', sadKey);
            if (cErr) {
              console.warn('count query failed for', sadKey, cErr);
              return { sadKey, count: 0 };
            }
            return { sadKey, count: Number(count || 0) };
          } catch (e) {
            console.warn('count exception for', sadKey, e);
            return { sadKey, count: 0 };
          }
        });

        countsMap = {};
        for (const r of countResults) countsMap[String(r.sadKey)] = Number(r.count || 0);
      }

      // NEW: compute total recorded weight per SAD by summing tickets (ensures discharged weight equals sum of transactions)
      let totalsMap = {};
      if (sadNos.length) {
        const totalsResults = await runInBatches(sadNos, 25, async (sadKey) => {
          try {
            // fetch net/weight fields for tickets of this SAD and sum them
            const { data: ticketsData, error: tErr } = await supabase
              .from('tickets')
              .select('net, weight')
              .eq('sad_no', sadKey);
            if (tErr) {
              console.warn('ticket sum fetch failed for', sadKey, tErr);
              return { sadKey, total: 0 };
            }
            const total = (ticketsData || []).reduce((s, r) => s + toNumber(r.net ?? r.weight ?? 0), 0);
            return { sadKey, total };
          } catch (e) {
            console.warn('ticket sum exception for', sadKey, e);
            return { sadKey, total: 0 };
          }
        });

        totalsMap = {};
        for (const r of totalsResults) totalsMap[String(r.sadKey)] = Number(r.total || 0);
      }

      // apply counts and totals to normalized SADs
      for (let i = 0; i < normalized.length; i++) {
        const s = normalized[i];
        const key = s.sad_no != null ? String(s.sad_no).trim() : '';
        normalized[i] = {
          ...s,
          ticket_count: countsMap[key] || 0,
          // crucial: take the computed sum from tickets; fallback to stored DB value if no tickets
          total_recorded_weight: typeof totalsMap[key] === 'number' ? totalsMap[key] : toNumber(s.total_recorded_weight),
        };
      }

      // resolve created_by usernames (mostly will be currentUser)
      const creatorIds = Array.from(new Set(normalized.map((r) => r.created_by).filter(Boolean)));
      if (creatorIds.length) {
        const unresolved = creatorIds.filter((id) => !createdByMap[id]);
        if (unresolved.length) {
          try {
            const { data: usersData } = await supabase.from('users').select('id, username, email').in('id', unresolved);
            if (usersData && usersData.length) {
              for (const u of usersData) {
                createdByMapRef.current = { ...createdByMapRef.current, [u.id]: u.username || u.email || 'Unknown' };
              }
            }
            // also ensure we keep already-known map
          } catch (e) { /* ignore */ }
        }
      }

      const enhanced = normalized.map((s) => {
        const declared = toNumber(s.declared_weight);
        const recorded = toNumber(s.total_recorded_weight);
        const dischargeCompleted = declared > 0 && recorded >= declared;
        return { ...s, dischargeCompleted, created_by_username: createdByMapRef.current[s.created_by] || null };
      });

      setSads(enhanced);
    } catch (err) {
      console.error('fetchSADs', err);
      toast({ title: 'Failed to load SADs', description: err?.message || 'Unexpected', status: 'error' });
      setSads([]);
    } finally {
      setLoading(false);
    }
  };

  // lifecycle: load activity + fetchSADs only after currentUser known + setup realtime
  useEffect(() => {
    try {
      const raw = localStorage.getItem('sad_activity');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setActivity(parsed);
      }
    } catch (e) { /* ignore */ }
    // don't call fetchSADs here — wait until currentUser is resolved
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // when currentUser becomes available, fetch and subscribe
  useEffect(() => {
    if (!currentUser || !currentUser.id) return;

    // initial fetch for this agent
    fetchSADs();

    // realtime subscriptions: re-run fetchSADs when sads or tickets change for this agent
    try {
      if (supabase.channel) {
        const ch = supabase.channel(`public:sad_declarations:${currentUser.id}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'sad_declarations', filter: `created_by=eq.${currentUser.id}` }, () => fetchSADs())
          .subscribe();
        subRef.current = ch;
      } else {
        // fallback: generic subscription, but we'll re-filter on fetch
        const s = supabase.from('sad_declarations').on('*', () => { fetchSADs(); }).subscribe();
        subRef.current = s;
      }
    } catch (e) { /* ignore */ }

    try {
      if (supabase.channel) {
        const tch = supabase.channel(`public:tickets:sad:${currentUser.id}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => fetchSADs())
          .subscribe();
        ticketsSubRef.current = tch;
      } else {
        const t = supabase.from('tickets').on('*', () => { fetchSADs(); }).subscribe();
        ticketsSubRef.current = t;
      }
    } catch (e) { /* ignore */ }

    return () => {
      try { if (subRef.current && supabase.removeChannel) supabase.removeChannel(subRef.current).catch(() => {}); } catch (e) {}
      try { if (ticketsSubRef.current && supabase.removeChannel) supabase.removeChannel(ticketsSubRef.current).catch(() => {}); } catch (e) {}
    };
// eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  useEffect(() => {
    try { localStorage.setItem('sad_activity', JSON.stringify(activity)); } catch (e) { /* ignore */ }
  }, [activity]);

  const pushActivity = async (text, meta = {}) => {
    const ev = { time: new Date().toISOString(), text, meta };
    setActivity(prev => [ev, ...prev].slice(0, 200));
    try { await supabase.from('sad_activity').insert([{ text, meta }]); } catch (e) { /* ignore */ }
  };

  // open docs modal
  const openDocsModal = (sad) => {
    setDocsModal({ open: true, docs: Array.isArray(sad.docs) ? sad.docs : [], sad_no: sad.sad_no });
  };

  // upload docs
  const uploadDocs = async (sad_no, files = []) => {
    if (!files || files.length === 0) return [];
    const uploaded = [];
    for (const f of files) {
      const key = `sad-${sad_no}/${Date.now()}-${f.name.replace(/\s+/g, '_')}`;
      const { data, error } = await supabase.storage.from(SAD_DOCS_BUCKET).upload(key, f, { cacheControl: '3600', upsert: false });
      if (error) throw error;
      const filePath = data?.path ?? data?.Key ?? key;
      let url = null;
      try {
        const getPublic = await supabase.storage.from(SAD_DOCS_BUCKET).getPublicUrl(filePath);
        const publicUrl = (getPublic?.data && (getPublic.data.publicUrl || getPublic.data.publicURL)) ?? getPublic?.publicURL ?? null;
        if (publicUrl) url = publicUrl;
        else {
          const signedResp = await supabase.storage.from(SAD_DOCS_BUCKET).createSignedUrl(filePath, 60 * 60 * 24 * 7);
          const signedUrl = (signedResp?.data && (signedResp.data.signedUrl || signedResp.data.signedURL)) ?? signedResp?.signedUrl ?? signedResp?.signedURL ?? null;
          if (!signedUrl) throw new Error('Could not obtain public or signed URL for uploaded file.');
          url = signedUrl;
        }
      } catch (uErr) { throw uErr; }

      uploaded.push({ name: f.name, path: filePath, url, tags: [], parsed: null });
      await pushActivity(`Uploaded doc ${f.name} for SAD ${sad_no}`, { sad_no, file: f.name, uploaded_by: currentUser?.id || null });
    }
    return uploaded;
  };

  // create SAD - now storing regime as code (IM4/EX1/IM7)
  const handleCreateSAD = async (e) => {
    if (e && e.preventDefault) e.preventDefault();

    // Require all fields
    if (!sadNo || !declaredWeight || !regime || !docs || docs.length === 0) {
      toast({ title: 'Missing values', description: 'All fields are required (SAD, Regime, Declared Weight, at least one Document)', status: 'warning' });
      return;
    }

    setLoading(true);
    try {
      const currentUserObj = (supabase.auth && supabase.auth.getUser) ? (await supabase.auth.getUser()).data?.user : (supabase.auth && supabase.auth.user ? supabase.auth.user() : null);
      const docRecords = await uploadDocs(sadNo, docs);
      const trimmedSad = String(sadNo).trim();

      let regimeCode = regime;
      if (!regimeCode && typeof regime === 'string') {
        const low = regime.trim().toLowerCase();
        if (WORD_TO_CODE[low]) regimeCode = WORD_TO_CODE[low];
      }

      const payload = {
        sad_no: trimmedSad,
        regime: regimeCode || null,
        declared_weight: toNumber(parseNumberString(declaredWeight) || 0),
        docs: docRecords,
        status: 'In Progress',
        manual_update: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (currentUserObj && currentUserObj.id) payload.created_by = currentUserObj.id;

      const { error } = await supabase.from('sad_declarations').insert([payload]);
      if (error) throw error;

      if (currentUserObj && currentUserObj.id) {
        const uname = (currentUserObj.user_metadata && currentUserObj.user_metadata.full_name) || currentUserObj.email || '';
        if (uname) createdByMapRef.current = { ...createdByMapRef.current, [currentUserObj.id]: uname };
      }

      if (typeof window !== 'undefined' && window.confetti) {
        try { window.confetti({ particleCount: 120, spread: 160, origin: { y: 0.6 } }); } catch (e) { /* ignore */ }
      }

      toast({ title: 'SAD registered', description: `SAD ${trimmedSad} created`, status: 'success' });
      await pushActivity(`Created SAD ${trimmedSad}`, { created_by: currentUser?.id || null });
      setSadNo(''); setRegime(''); setDeclaredWeight(''); setDocs([]);
      fetchSADs();
      closeOrb();
    } catch (err) {
      console.error('create SAD', err);
      toast({ title: 'Failed', description: err?.message || 'Could not create SAD', status: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // open SAD detail (existing) - kept for backward compatibility (simple list)
  const openSadDetail = async (sad) => {
    setSelectedSad(sad);
    setIsModalOpen(true);
    setDetailLoading(true);
    try {
      const trimmed = sad.sad_no != null ? String(sad.sad_no).trim() : sad.sad_no;
      const { data, error } = await supabase.from('tickets').select('*').eq('sad_no', trimmed).order('date', { ascending: false });
      if (error) throw error;
      setDetailTickets(data || []);
      const computedTotal = (data || []).reduce((s, r) => s + toNumber(r.net ?? r.weight ?? 0), 0);
      setSelectedSad((prev) => ({ ...prev, total_recorded_weight: computedTotal, dischargeCompleted: (toNumber(prev?.declared_weight || 0) > 0 && computedTotal >= toNumber(prev?.declared_weight || 0)), ticket_count: (data || []).length }));
      await pushActivity(`Viewed SAD ${sad.sad_no} details`, { viewed_by: currentUser?.id || null });
    } catch (err) {
      console.error('openSadDetail', err);
      toast({ title: 'Failed to load tickets', description: err?.message || 'Unexpected', status: 'error' });
      setDetailTickets([]);
    } finally {
      setDetailLoading(false);
    }
  };

  // open details modal (AgentDashboard-like) - now fetch declaration row (to get completed_at)
  const openDetailsModal = async (sad) => {
    setDetailsData({ sad: null, tickets: [], created_by_username: sad.created_by_username || null, completed_by_username: null, loading: true });
    setDetailsOpen(true);
    try {
      const trimmed = sad.sad_no != null ? String(sad.sad_no).trim() : sad.sad_no;

      // fetch declaration row (to get most current fields including completed_at)
      let decl = sad;
      try {
        const { data: sadRow, error: sadErr } = await supabase.from('sad_declarations').select('*').eq('sad_no', trimmed).maybeSingle();
        if (!sadErr && sadRow) decl = { ...sadRow };
      } catch (e) { /* ignore */ }

      // fetch tickets
      const { data: tickets, error } = await supabase.from('tickets').select('*').eq('sad_no', trimmed).order('date', { ascending: false });
      if (error) {
        setDetailsData((d) => ({ ...d, tickets: [], loading: false }));
      } else {
        let createdByUsername = decl.created_by ? (createdByMapRef.current[decl.created_by] || null) : null;
        if (!createdByUsername && decl.created_by) {
          try {
            const { data: u } = await supabase.from('users').select('id, username, email').eq('id', decl.created_by).maybeSingle();
            if (u) {
              createdByMapRef.current = { ...createdByMapRef.current, [u.id]: u.username || u.email || null };
              createdByUsername = u.username || u.email || null;
            }
          } catch (e) { /* ignore */ }
        }

        // determine completed_by username: prefer decl.completed_by (if column exists), else local completedByMapRef
        let completedByUsername = null;
        if (decl.completed_by) {
          completedByUsername = createdByMapRef.current[decl.completed_by] || decl.completed_by;
        } else if (completedByMapRef.current[trimmed]) {
          completedByUsername = completedByMapRef.current[trimmed];
        }

        const computedTotal = (tickets || []).reduce((s, r) => s + toNumber(r.net ?? r.weight ?? 0), 0);
        // ensure the details modal uses computedTotal as authoritative discharged weight
        const sd = { ...decl, total_recorded_weight: computedTotal, ticket_count: (tickets || []).length };

        setDetailsData({ sad: sd, tickets: tickets || [], created_by_username: createdByUsername, completed_by_username: completedByUsername, loading: false });
      }
    } catch (err) {
      console.error('openDetailsModal', err);
      setDetailsData((d) => ({ ...d, tickets: [], loading: false }));
      toast({ title: 'Failed', description: 'Could not load details', status: 'error' });
    }
  };

  // subscribe to ticket changes for the currently open details modal (auto-refresh)
  useEffect(() => {
    // set up subscription if modal is open and we have a sad_no
    if (!detailsOpen) return undefined;
    const sadNo = detailsData?.sad?.sad_no;
    if (!sadNo) return undefined;

    let isUnmounted = false;

    const fetchTicketsForSad = async () => {
      try {
        const trimmed = sadNo != null ? String(sadNo).trim() : sadNo;
        const { data: tickets, error } = await supabase.from('tickets').select('*').eq('sad_no', trimmed).order('date', { ascending: false });
        if (!error && !isUnmounted) {
          const computedTotal = (tickets || []).reduce((s, r) => s + toNumber(r.net ?? r.weight ?? 0), 0);
          setDetailsData((prev) => ({
            ...prev,
            sad: prev.sad ? { ...prev.sad, total_recorded_weight: computedTotal, ticket_count: (tickets || []).length } : prev.sad,
            tickets: tickets || [],
          }));
        }
      } catch (e) {
        // ignore
      }
    };

    fetchTicketsForSad();

    // subscribe to tickets table changes for this sad
    let sub = null;
    try {
      if (supabase.channel) {
        sub = supabase.channel(`public:tickets:sad:${sadNo}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets', filter: `sad_no=eq.${sadNo}` }, (payload) => {
            // whenever tickets for this sad are inserted/updated/deleted, refetch for fresh totals
            fetchTicketsForSad();
          })
          .subscribe();
        detailTicketsSubRef.current = sub;
      } else {
        // legacy subscribe
        sub = supabase.from(`tickets:sad_no=eq.${sadNo}`).on('*', () => fetchTicketsForSad()).subscribe();
        detailTicketsSubRef.current = sub;
      }
    } catch (e) {
      // fallback - ignore
      console.warn('detail subscription failed', e);
      sub = null;
    }

    return () => {
      isUnmounted = true;
      try {
        if (sub && supabase.removeChannel) supabase.removeChannel(sub).catch(() => {});
        else if (sub && sub.unsubscribe) sub.unsubscribe();
      } catch (e) { /* ignore */ }
    };
  }, [detailsOpen, detailsData?.sad?.sad_no]);

  // TRANSACTIONS MINI-MODAL (NEW): open and fetch breakdown
  const openTransactionsModal = async (sad) => {
    const trimmed = sad.sad_no != null ? String(sad.sad_no).trim() : sad.sad_no;
    setTxModal({ open: true, sad_no: trimmed, loading: true, total: 0, manual: 0, uploaded: 0, sample: [] });
    try {
      // total count
      const { error: tErr, count: totalCount } = await supabase.from('tickets').select('id', { head: true, count: 'exact' }).eq('sad_no', trimmed);
      if (tErr) {
        console.warn('tx total count err', tErr);
      }
      const total = Number(totalCount || 0);

      // manual count (tickets whose ticket_no starts with M- or m-)
      const { error: mErr, count: manualCount } = await supabase.from('tickets').select('id', { head: true, count: 'exact' }).eq('sad_no', trimmed).ilike('ticket_no', 'M-%');
      if (mErr) console.warn('manual count err', mErr);
      const manual = Number(manualCount || 0);

      // sample tickets (last 12)
      const { data: sampleTickets, error: sErr } = await supabase.from('tickets').select('*').eq('sad_no', trimmed).order('date', { ascending: false }).limit(12);
      if (sErr) console.warn('sample tickets err', sErr);

      // uploaded numeric count = total - manual
      const uploaded = Math.max(0, total - manual);

      setTxModal({ open: true, sad_no: trimmed, loading: false, total, manual, uploaded, sample: sampleTickets || [] });
      await pushActivity(`Viewed transactions breakdown for ${trimmed}`, { sad_no: trimmed, by: currentUser?.id || null });
    } catch (err) {
      console.error('openTransactionsModal', err);
      setTxModal((t) => ({ ...t, loading: false }));
      toast({ title: 'Could not load transactions', description: err?.message || 'Unexpected', status: 'error' });
    }
  };

  const closeTransactionsModal = () => setTxModal({ open: false, sad_no: null, loading: false, total: 0, manual: 0, uploaded: 0, sample: [] });

  // update status quick action (simple)
  const updateSadStatus = async (sad_no, newStatus) => {
    // compatibility wrapper - uses advanced function
    return updateSadStatusWithCompletion(sad_no, newStatus);
  };

  // advanced status update that also sets completed_at and attempts to set completed_by
  const updateSadStatusWithCompletion = async (sad_no, newStatus) => {
    try {
      const trimmed = sad_no != null ? String(sad_no).trim() : sad_no;
      const payload = { status: newStatus, updated_at: new Date().toISOString(), manual_update: true };

      let setCompletedBy = false;
      if (newStatus === 'Completed') {
        payload.completed_at = new Date().toISOString();
        if (currentUser && currentUser.id) {
          payload.completed_by = currentUser.id; // try to set if column exists
          setCompletedBy = true;
        }
      } else {
        // if changing away from completed, clear completed_at (optional)
        payload.completed_at = null;
        payload.completed_by = null;
      }

      // attempt update
      const { error } = await supabase.from('sad_declarations').update(payload).eq('sad_no', trimmed);
      if (error) {
        // if error likely due to completed_by column missing, retry without completed_by
        console.warn('update error, retrying without completed_by if present', error);
        const fallbackPayload = { ...payload };
        if (!setCompletedBy) {
          delete fallbackPayload.completed_by;
        } else {
          delete fallbackPayload.completed_by;
        }
        const { error: err2 } = await supabase.from('sad_declarations').update(fallbackPayload).eq('sad_no', trimmed);
        if (err2) throw err2;
      }
    
      // if newStatus is completed, record who completed in local map (fallback)
      if (newStatus === 'Completed' && currentUser) {
        const uname = (currentUser.user_metadata && (currentUser.user_metadata.full_name || currentUser.user_metadata.fullName)) || currentUser.email || currentUser.id;
        completedByMapRef.current[trimmed] = uname;
      } else {
        // clear local map if uncompleting
        if (completedByMapRef.current[trimmed]) delete completedByMapRef.current[trimmed];
      }

      toast({ title: 'Status updated', description: `${trimmed} set to ${newStatus}`, status: 'success' });
      await pushActivity(`Status of ${trimmed} set to ${newStatus}`, { sad_no: trimmed, newStatus, by: currentUser?.id || null });
      fetchSADs();

      // if details modal open for this sad, refresh it
      if (detailsData?.sad?.sad_no === trimmed) openDetailsModal({ sad_no: trimmed });

      return true;
    } catch (err) {
      console.error('updateSadStatusWithCompletion', err);
      toast({ title: 'Update failed', description: err?.message || 'Unexpected', status: 'error' });
      return false;
    }
  };

  const requestMarkCompleted = (sad_no) => { setCompleteTarget(sad_no); setCompleteOpen(true); };
  const confirmMarkCompleted = async () => {
    const target = completeTarget; setCompleteOpen(false); setCompleteTarget(null);
    if (!target) return;
    try { setLoading(true); await updateSadStatusWithCompletion(target, 'Completed'); } catch (e) { console.error('confirmMarkCompleted', e); } finally { setLoading(false); }
  };

  const recalcTotalForSad = async (sad_no) => {
    try {
      const trimmed = sad_no != null ? String(sad_no).trim() : sad_no;
      const { data: tickets, error } = await supabase.from('tickets').select('net, weight').eq('sad_no', trimmed);
      if (error) throw error;
      const total = (tickets || []).reduce((s, r) => s + toNumber(r.net ?? r.weight ?? 0), 0);
      // update DB persisted total (optional), keep UI consistent by re-fetching
      const { error: updateErr } = await supabase.from('sad_declarations').update({ total_recorded_weight: total, updated_at: new Date().toISOString() }).eq('sad_no', trimmed);
      if (updateErr) console.warn('could not persist recalc total', updateErr);
      await pushActivity(`Recalculated total for ${trimmed}: ${total}`, { sad_no: trimmed, by: currentUser?.id || null });
      fetchSADs();
      toast({ title: 'Recalculated', description: `Total recorded ${total.toLocaleString()}`, status: 'success' });
    } catch (err) {
      console.error('recalcTotalForSad', err);
      toast({ title: 'Could not recalc', description: err?.message || 'Unexpected', status: 'error' });
    }
  };

  const archiveSadConfirmed = async (sad_no) => {
    try {
      const { error } = await supabase.from('sad_declarations').update({ status: 'Archived', updated_at: new Date().toISOString() }).eq('sad_no', sad_no);
      if (error) throw error;
      toast({ title: 'Archived', description: `SAD ${sad_no} archived`, status: 'info' });
      await pushActivity(`Archived SAD ${sad_no}`, { by: currentUser?.id || null });
      fetchSADs();
    } catch (err) {
      console.error('archiveSad', err);
      toast({ title: 'Archive failed', description: err?.message || 'Unexpected', status: 'error' });
    } finally {
      setArchiveOpen(false); setArchiveTarget(null);
    }
  };

  const exportSingleSAD = async (s) => {
    try {
      const rows = [{
        sad_no: s.sad_no,
        regime: s.regime,
        regime_label: REGIME_LABEL_MAP[s.regime] || '',
        declared_weight: toNumber(s.declared_weight),
        total_recorded_weight: toNumber(s.total_recorded_weight),
        status: s.status,
        created_at: s.created_at,
        updated_at: s.updated_at,
        docs: (s.docs || []).map(d => d.name || d.path).join('; '),
      }];
      exportToCSV(rows, `sad_${s.sad_no}_export.csv`);
      toast({ title: 'Export started', description: `SAD ${s.sad_no} exported`, status: 'success' });
      await pushActivity(`Exported SAD ${s.sad_no}`, { by: currentUser?.id || null });
    } catch (err) {
      console.error('exportSingleSAD', err);
      toast({ title: 'Export failed', description: err?.message || 'Unexpected', status: 'error' });
    }
  };

  // NL search
  const runNlQuery = async () => {
    if (!nlQuery) { fetchSADs(); return; }
    setNlLoading(true);
    try {
      const q = nlQuery.trim();
      const lower = q.toLowerCase();
      const filter = {};
      if (/\bcompleted\b/.test(lower)) filter.status = 'Completed';
      else if (/\bin progress\b/.test(lower) || /\binprogress\b/.test(lower)) filter.status = 'In Progress';
      else if (/\bon hold\b/.test(lower)) filter.status = 'On Hold';
      const num = q.match(/\b(\d{1,10})\b/);
      if (num) filter.sad_no = num[1];

      if (!filter.sad_no && !filter.status) {
        const up = q.toUpperCase();
        if (REGIME_OPTIONS.includes(up)) {
          filter.regime = up;
        } else if (WORD_TO_CODE[lower]) {
          filter.regime = WORD_TO_CODE[lower];
        } else {
          filter.regime = null;
        }
      }

      await fetchSADs(filter);
      await pushActivity(`Search: "${nlQuery}"`, { by: currentUser?.id || null, filter });
    } catch (e) {
      console.error('NL query failed', e);
      toast({ title: 'Search failed', description: e?.message || 'Unexpected', status: 'error' });
    } finally { setNlLoading(false); }
  };

  // discrepancy helper
  const handleExplainDiscrepancy = async (s) => {
    const recorded = toNumber(s.total_recorded_weight);
    const declared = toNumber(s.declared_weight);
    if (!declared) {
      toast({ title: 'No declared weight', description: `SAD ${s.sad_no} has no declared weight to compare.`, status: 'warning' });
      await pushActivity(`Explain: no declared weight for ${s.sad_no}`, { by: currentUser?.id || null });
      return;
    }
    const diff = recorded - declared;
    const pct = ((diff / (declared || 1)) * 100).toFixed(2);
    let msg = '';
    if (Math.abs(diff) / Math.max(1, declared) < 0.01) {
      msg = `Recorded matches declared within 1% (${recorded} kg vs ${declared} kg).`;
    } else if (diff > 0) {
      msg = `Recorded is ${diff.toLocaleString()} kg (${pct}%) higher than declared — investigate extra tickets or duplicates.`;
    } else {
      msg = `Recorded is ${Math.abs(diff).toLocaleString()} kg (${Math.abs(pct)}%) lower than declared — check missing tickets or document mismatch.`;
    }
    toast({ title: `Discrepancy for ${s.sad_no}`, description: msg, status: 'info', duration: 10000 });
    await pushActivity(`Explained discrepancy for ${s.sad_no}: ${msg}`, { by: currentUser?.id || null });
  };

  // generate printable report (iframe-based) - reused by modal
  const generatePdfReport = async (s) => {
    try {
      const trimmed = s.sad_no != null ? String(s.sad_no).trim() : s.sad_no;
      const { data: tickets = [], error } = await supabase.from('tickets').select('*').eq('sad_no', trimmed).order('date', { ascending: false });
      if (error) console.warn('Could not fetch tickets for PDF', error);
      const declared = toNumber(s.declared_weight);
      const recorded = toNumber(s.total_recorded_weight);
      const regimeLabel = REGIME_LABEL_MAP[s.regime] ? `${REGIME_LABEL_MAP[s.regime]} (${s.regime})` : (s.regime || '—');
      const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>SAD ${s.sad_no} Report</title>
          <style>
            @page { size: A4; margin: 20mm; }
            body { font-family: Inter, Arial, Helvetica, sans-serif; padding: 0; color: #071126; }
            header { display:flex; align-items:center; gap:12px; padding:12px 0; }
            .logo { width:72px; height:auto; }
            .company { font-size:16px; font-weight:700; color:#071126; }
            .meta { margin: 12px 0; }
            .meta p { margin: 2px 0; color:#333; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size:12px; }
            th, td { border: 1px solid #bbb; padding: 6px 8px; text-align: left; }
            th { background: linear-gradient(90deg,#6D28D9,#06B6D4); color: #fff; font-weight:700; }
            .small { font-size: 11px; color: #555; }
          </style>
        </head>
        <body>
          <header>
            <img class="logo" src="${logoUrl}" alt="Logo" />
            <div>
              <div class="company">NICK TC-SCAN (GAMBIA) LTD</div>
              <div class="small">SAD Report — ${s.sad_no}</div>
            </div>
          </header>

          <div class="meta">
            <p><strong>Regime:</strong> ${regimeLabel}</p>
            <p><strong>Declared weight:</strong> ${declared.toLocaleString()} kg</p>
            <p><strong>Discharged weight:</strong> ${recorded.toLocaleString()} kg</p>
            <p class="small">Status: ${s.status || '—'} | Created: ${s.created_at || '—'} | Created by: ${s.created_by ? (createdByMap[s.created_by] || '') : '—'}</p>
            <p class="small">Documents: ${(Array.isArray(s.docs) ? s.docs.map(d => d.name || d.path).join(', ') : '')}</p>
          </div>

          <h3>Tickets</h3>
          ${tickets.length ? `
            <table>
              <thead><tr><th>Ticket</th><th>Truck</th><th style="text-align:right">Net (kg)</th><th>Date</th></tr></thead>
              <tbody>
                ${tickets.map(t => `<tr>
                  <td>${t.ticket_no || ''}</td>
                  <td>${t.gnsw_truck_no || ''}</td>
                  <td style="text-align:right">${toNumber(t.net ?? t.weight ?? 0).toLocaleString()}</td>
                  <td>${t.date ? new Date(t.date).toLocaleString() : '—'}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          ` : '<p class="small">No tickets recorded.</p>'}

          <script>
            setTimeout(() => { window.print(); }, 300);
          </script>
        </body>
      </html>
      `;

      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      document.body.appendChild(iframe);

      try {
        iframe.srcdoc = html;
        iframe.onload = () => {
          try { iframe.contentWindow.focus(); iframe.contentWindow.print(); setTimeout(() => { document.body.removeChild(iframe); }, 1000); }
          catch (e) { document.body.removeChild(iframe); toast({ title: 'Print failed', description: 'Could not print report from iframe.', status: 'error' }); }
        };
      } catch (e) {
        iframe.contentWindow.document.open();
        iframe.contentWindow.document.write(html);
        iframe.contentWindow.document.close();
        iframe.onload = () => {
          try { iframe.contentWindow.focus(); iframe.contentWindow.print(); setTimeout(() => { document.body.removeChild(iframe); }, 1000); }
          catch (err) { document.body.removeChild(iframe); toast({ title: 'Print failed', description: 'Could not generate report.', status: 'error' }); }
        };
      }
    } catch (err) {
      console.error('generatePdfReport', err);
      toast({ title: 'Report failed', description: err?.message || 'Could not generate report', status: 'error' });
    }
  };

  // UI derived values
  const anomalyResults = useMemo(() => {
    const ratios = sads.map(s => {
      const d = toNumber(s.declared_weight);
      const r = toNumber(s.total_recorded_weight);
      if (!d) return null;
      return r / d;
    }).filter(Boolean);
    if (!ratios.length) return { mean: 1, std: 0, flagged: [] };
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const variance = ratios.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / ratios.length;
    const std = Math.sqrt(variance);
    const flagged = [];
    for (const s of sads) {
      const d = toNumber(s.declared_weight);
      const r = toNumber(s.total_recorded_weight);
      if (!d) continue;
      const ratio = r / d;
      const z = std > 0 ? (ratio - mean) / std : 0;
      if (Math.abs(z) > 2 || ratio < 0.8 || ratio > 1.2) flagged.push({ sad: s, z, ratio });
    }
    return { mean, std, flagged };
  }, [sads]);

  const dashboardStats = useMemo(() => {
    const totalSADs = sads.length;
    const totalDeclared = sads.reduce((a, b) => a + toNumber(b.declared_weight), 0);
    const totalRecorded = sads.reduce((a, b) => a + toNumber(b.total_recorded_weight), 0);
    const completed = sads.filter(s => s.status === 'Completed').length;
    const pending = sads.filter(s => s.status === 'In Progress').length;
    const onHold = sads.filter(s => s.status === 'On Hold').length;
    const activeDiscreps = anomalyResults.flagged.length;
    return { totalSADs, totalDeclared, totalRecorded, completed, activeDiscreps, pending, onHold };
  }, [sads, anomalyResults]);

  const filteredSads = useMemo(() => {
    let arr = Array.isArray(sads) ? sads.slice() : [];
    if (statusFilter) arr = arr.filter(s => (s.status || '').toLowerCase() === statusFilter.toLowerCase());
    if (regimeFilter) arr = arr.filter(s => String(s.regime || '').toLowerCase().includes(String(regimeFilter).toLowerCase()));
    if (nlQuery) {
      const q = nlQuery.toLowerCase();
      arr = arr.filter(s => {
        if ((String(s.sad_no || '')).toLowerCase().includes(q)) return true;
        if ((String(s.regime || '')).toLowerCase().includes(q)) return true;
        const docsText = Array.isArray(s.docs) ? s.docs.map(d => (d && (d.name || d.path || d.url || '') )).join(' ') : String(s.docs || '');
        if (docsText.toLowerCase().includes(q)) return true;
        return false;
      });
    }
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      if (sortBy === 'declared_weight') return (toNumber(a.declared_weight) - toNumber(b.declared_weight)) * dir;
      if (sortBy === 'recorded') return (toNumber(a.total_recorded_weight) - toNumber(b.total_recorded_weight)) * dir;
      if (sortBy === 'discrepancy') {
        const da = toNumber(a.total_recorded_weight) - toNumber(a.declared_weight);
        const db = toNumber(b.total_recorded_weight) - toNumber(b.declared_weight);
        return (da - db) * dir;
      }
      const ta = new Date(a.created_at || a.updated_at || 0).getTime();
      const tb = new Date(b.created_at || b.updated_at || 0).getTime();
      // keep inversion so 'asc' yields newest-first for created_at
      return (ta - tb) * -dir;
    });
    return arr;
  }, [sads, statusFilter, regimeFilter, nlQuery, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredSads.length / pageSize));
  useEffect(() => { setPage((p) => (p > totalPages ? 1 : p)); }, [totalPages]);
  const pagedSads = filteredSads.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

  const handleExportFilteredCSV = () => {
    const rows = filteredSads.map(s => ({
      sad_no: s.sad_no,
      regime: s.regime,
      regime_label: REGIME_LABEL_MAP[s.regime] || '',
      declared_weight: toNumber(s.declared_weight),
      total_recorded_weight: toNumber(s.total_recorded_weight),
      status: s.status,
      created_at: s.created_at,
      updated_at: s.updated_at,
    }));
    exportToCSV(rows, `sad_declarations_export_${new Date().toISOString().slice(0,10)}.csv`);
    toast({ title: 'Export started', description: `${rows.length} rows exported`, status: 'success' });
  };

  const handleManualBackupToStorage = async () => {
    try {
      const rows = sads.map(s => ({
        sad_no: s.sad_no,
        regime: s.regime,
        regime_label: REGIME_LABEL_MAP[s.regime] || '',
        declared_weight: toNumber(s.declared_weight),
        total_recorded_weight: toNumber(s.total_recorded_weight),
        status: s.status,
        created_at: s.created_at,
        updated_at: s.updated_at,
      }));
      if (!rows.length) { toast({ title: 'No data', description: 'Nothing to backup', status: 'info' }); return; }
      const csv = [
        Object.keys(rows[0] || {}).join(','),
        ...rows.map(r => Object.values(r).map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')),
      ].join('\n');
      const filename = `backup/sad_declarations_backup_${new Date().toISOString().slice(0,10)}.csv`;
      const blob = new Blob([csv], { type: 'text/csv' });
      const { error } = await supabase.storage.from(SAD_DOCS_BUCKET).upload(filename, blob, { upsert: true });
      if (error) throw error;
      await pushActivity('Manual backup uploaded', { path: filename, by: currentUser?.id || null });
      toast({ title: 'Backup uploaded', description: `Saved as ${filename}`, status: 'success' });
    } catch (err) {
      console.error('backup failed', err);
      toast({ title: 'Backup failed', description: err?.message || 'Unexpected', status: 'error' });
    }
  };

  // styles and render
  const pageCss = `
:root{
  --muted: rgba(7,17,25,0.55);
  --text-dark: #071126;
  --text-light: #ffffff;
  --neon-1: linear-gradient(135deg,#6D28D9 0%, #06B6D4 100%);
  --radius: 14px;
  --glass-border: rgba(2,6,23,0.06);
}
.sad-container { font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial; color:var(--text-dark); background: radial-gradient(circle at 10% 10%, rgba(99,102,241,0.03), transparent 10%), linear-gradient(180deg,#eaf5ff 0%, #ffffff 60%); padding: 12px 0; }
.stat-group-custom { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:18px; }
.table-responsive { margin-top:18px; }
.table thead th { background: linear-gradient(90deg,#b02a37,#8a1f27); color:var(--text-light); border:none; padding:12px 8px; font-weight:700; text-align:center; }
.table tbody td { background: #fff; padding:12px 8px; border-radius:8px; vertical-align:middle; text-align:center; color:var(--text-dark); border: 1px solid rgba(2,6,23,0.06) }
.sad-link {
  background: linear-gradient(90deg,#6D28D9,#06B6D4);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  font-weight:700;
  text-decoration: none;
  border-bottom: 2px dotted rgba(0,0,0,0.06);
}
.sad-link:hover { filter: brightness(1.05); transform: translateY(-1px); text-decoration: underline; }
.tx-badge {
  background: linear-gradient(90deg,#7b61ff,#06b6d4);
  color: white;
  border-radius: 999px;
  padding: 6px 10px;
  font-weight: 700;
  font-size: 13px;
  box-shadow: 0 6px 20px rgba(99,102,241,0.12);
}
.tx-sub { font-size: 11px; opacity: 0.9; display:block; margin-top:2px; color: rgba(255,255,255,0.95); font-weight:500; }
@media (max-width:780px) {
  .table thead { display:none; }
  .table tbody tr { display:block; background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(255,255,255,0.96)); margin-bottom:14px; border-radius:14px; padding:12px; box-shadow: 0 8px 24px rgba(2,6,23,0.04);}
  .table tbody td { display:block; text-align:left; padding:8px 0; border: none; }
  .table tbody td::before { content: attr(data-label); display:inline-block; width:130px; font-weight:700; color:var(--muted); }
}
.orb-cta {
  position:fixed; right:28px; bottom:28px; z-index:2400;
  width:72px;height:72px;border-radius:999px;background:linear-gradient(90deg,#7b61ff,#3ef4d0); color:#fff; cursor:pointer;
  display:flex;align-items:center;justify-content:center;font-size:20px; box-shadow: 0 12px 30px rgba(63,94,251,0.18);
}
.orb-cta:hover { transform: translateY(-4px) scale(1.03); transition: transform .18s ease; }
`;

  const RowMotion = motion(Tr);

  // validation for create
  const canCreate = !!(sadNo && sadNo.toString().trim() && declaredWeight && regime && docs && docs.length > 0);

  // helper to email modal SAD summary (simple mailto)
  const emailSad = (s) => {
    try {
      const subject = encodeURIComponent(`SAD ${s.sad_no} Report`);
      const bodyLines = [
        `SAD: ${s.sad_no}`,
        `Declared weight: ${toNumber(s.declared_weight).toLocaleString()} kg`,
        `Discharged weight: ${toNumber(s.total_recorded_weight).toLocaleString()} kg`,
        `Status: ${s.status || '—'}`,
        '',
        'Tickets attached in exported report (if generated).'
      ];
      const body = encodeURIComponent(bodyLines.join('\n'));
      window.location.href = `mailto:?subject=${subject}&body=${body}`;
    } catch (e) {
      console.warn('email failed', e);
    }
  };

  // open status edit modal
  const openStatusEditorFor = (s) => {
    setStatusEditTarget(s);
    setStatusEditValue(s.status || 'In Progress');
    openStatusEdit();
  };

  const confirmStatusEdit = async () => {
    if (!statusEditTarget) return;
    const sad_no = statusEditTarget.sad_no;
    closeStatusEdit();
    await updateSadStatusWithCompletion(sad_no, statusEditValue);
  };

  // ---------- DETAILS MODAL: filtering logic ----------
  const applyDetailFilterChange = (k, v) => {
    setDetailFilters((d) => ({ ...d, [k]: v }));
  };

  // compute filtered tickets inside details modal
  const filteredDetailTickets = useMemo(() => {
    const tickets = Array.isArray(detailsData.tickets) ? detailsData.tickets.slice() : [];
    if (!tickets.length) return [];
    const q = (detailFilters.q || '').trim().toLowerCase();
    const truckQ = (detailFilters.truck || '').trim().toLowerCase();
    const type = detailFilters.type || '';
    const hasDateRange = !!(detailFilters.dateFrom || detailFilters.dateTo);
    const startDate = detailFilters.dateFrom ? new Date(detailFilters.dateFrom + 'T00:00:00') : null;
    const endDate = detailFilters.dateTo ? new Date(detailFilters.dateTo + 'T23:59:59.999') : null;
    const tfMinutes = parseTimeToMinutes(detailFilters.timeFrom);
    const ttMinutes = parseTimeToMinutes(detailFilters.timeTo);

    const out = tickets.filter((t) => {
      // basic q against ticket_no or driver or material or file_name
      if (q) {
        const combined = `${t.ticket_no || ''} ${t.gnsw_truck_no || t.truck_no || ''} ${t.driver || ''} ${t.material || ''} ${t.file_name || ''}`.toLowerCase();
        if (!combined.includes(q)) return false;
      }
      if (truckQ) {
        const truckVal = (t.gnsw_truck_no || t.truck_no || '').toString().toLowerCase();
        if (!truckVal.includes(truckQ)) return false;
      }

      // type
      if (type) {
        const tno = String(t.ticket_no || '');
        const isManual = /^M-/i.test(tno);
        const isUploaded = /^\d+/.test(tno);
        if (type === 'manual' && !isManual) return false;
        if (type === 'uploaded' && !isUploaded) return false;
        if (type === 'other' && (isManual || isUploaded)) return false;
      }

      // date/time filtering (use t.date)
      const dRaw = t.date || t.submitted_at || t.created_at || null;
      const d = dRaw ? new Date(dRaw) : null;
      if (hasDateRange) {
        let start = startDate ? new Date(startDate) : new Date(-8640000000000000);
        let end = endDate ? new Date(endDate) : new Date(8640000000000000);
        if (detailFilters.timeFrom) {
          const mins = parseTimeToMinutes(detailFilters.timeFrom);
          if (mins != null) start.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
        }
        if (detailFilters.timeTo) {
          const mins = parseTimeToMinutes(detailFilters.timeTo);
          if (mins != null) end.setHours(Math.floor(mins / 60), mins % 60, 59, 999);
        }
        if (!d) return false;
        if (d < start || d > end) return false;
      } else if (detailFilters.timeFrom || detailFilters.timeTo) {
        if (!d) return false;
        const minutes = d.getHours() * 60 + d.getMinutes();
        const from = tfMinutes != null ? tfMinutes : 0;
        const to = ttMinutes != null ? ttMinutes : 24 * 60 - 1;
        if (minutes < from || minutes > to) return false;
      }

      return true;
    });

    // newest first
    out.sort((a, b) => {
      const da = new Date(a.date || a.submitted_at || 0).getTime();
      const db = new Date(b.date || b.submitted_at || 0).getTime();
      return db - da;
    });

    return out;
  }, [detailsData.tickets, detailFilters]);

  // derived stats inside details modal based on filteredDetailTickets
  const detailDerived = useMemo(() => {
    const t = filteredDetailTickets || [];
    const cumulativeNet = t.reduce((s, r) => s + toNumber(r.net ?? r.weight ?? 0), 0);
    const total = t.length;
    const manual = t.filter(r => /^M-/i.test(String(r.ticket_no || ''))).length;
    const uploaded = t.filter(r => /^\d+/.test(String(r.ticket_no || ''))).length;
    return { cumulativeNet, total, manual, uploaded };
  }, [filteredDetailTickets]);

  // export filtered tickets from details modal
  const exportFilteredTicketsCsv = () => {
    if (!filteredDetailTickets.length) {
      toast({ title: 'No tickets', status: 'info' });
      return;
    }
    const rows = filteredDetailTickets.map(t => ({
      'Ticket No': t.ticket_no,
      'Truck': t.gnsw_truck_no || t.truck_no || '',
      'Net (kg)': toNumber(t.net ?? t.weight ?? 0),
      'Date': t.date ? new Date(t.date).toLocaleString() : '',
      'Type': /^M-/i.test(String(t.ticket_no || '')) ? 'Manual' : (/^\d+/.test(String(t.ticket_no || '')) ? 'Uploaded' : 'Other'),
    }));
    exportToCSV(rows, `sad_${detailsData.sad?.sad_no || 'report'}_tickets_${new Date().toISOString().slice(0,10)}.csv`);
    toast({ title: 'Export started', description: `${rows.length} rows exported`, status: 'success' });
  };

  // styles and main render happen below (kept your UI, added filter controls within details modal)
  return (
    <Container maxW="8xl" py={6} className="sad-container">
      <style>{pageCss}</style>

      <Heading mb={4}>SAD Declaration Panel</Heading>

      {/* Stats */}
      <div className="stat-group-custom">
        <Stat bg="linear-gradient(90deg,#7b61ff,#3ef4d0)" color="white" p={3} borderRadius="md" boxShadow="sm" style={{ minWidth: 180 }}>
          <StatLabel style={{ color: 'rgba(255,255,255,0.95)' }}>Total SADs</StatLabel>
          <StatNumber style={{ color: '#fff' }}>{dashboardStats.totalSADs}</StatNumber>
          <StatHelpText style={{ color: 'rgba(255,255,255,0.9)' }}>Today & overall</StatHelpText>
        </Stat>

        <Stat bg="linear-gradient(90deg,#06b6d4,#0ea5a0)" color="white" p={3} borderRadius="md" boxShadow="sm" style={{ minWidth: 180 }}>
          <StatLabel style={{ color: 'rgba(255,255,255,0.95)' }}>Total Completed</StatLabel>
          <StatNumber style={{ color: '#fff' }}>{dashboardStats.completed}</StatNumber>
          <StatHelpText style={{ color: 'rgba(255,255,255,0.9)' }}>Number of completed SADs</StatHelpText>
        </Stat>

        <Stat bg="linear-gradient(90deg,#f97316,#f59e0b)" color="white" p={3} borderRadius="md" boxShadow="sm" style={{ minWidth: 180 }}>
          <StatLabel style={{ color: 'rgba(255,255,255,0.95)' }}>Total Pending</StatLabel>
          <StatNumber style={{ color: '#fff' }}>{dashboardStats.pending}</StatNumber>
          <StatHelpText style={{ color: 'rgba(255,255,255,0.9)' }}>In-Progress SADs</StatHelpText>
        </Stat>

        <Stat bg="linear-gradient(90deg,#ef4444,#fb7185)" color="white" p={3} borderRadius="md" boxShadow="sm" style={{ minWidth: 180 }}>
          <StatLabel style={{ color: 'rgba(255,255,255,0.95)' }}>Total On Hold</StatLabel>
          <StatNumber style={{ color: '#fff' }}>{dashboardStats.onHold}</StatNumber>
          <StatHelpText style={{ color: 'rgba(255,255,255,0.9)' }}>SADs on hold</StatHelpText>
        </Stat>

        <Stat bg="linear-gradient(90deg,#10b981,#06b6d4)" color="white" p={3} borderRadius="md" boxShadow="sm" style={{ minWidth: 180 }}>
          <StatLabel style={{ color: 'rgba(255,255,255,0.95)' }}>% Completed</StatLabel>
          <StatNumber style={{ color: '#fff' }}>{dashboardStats.totalSADs ? Math.round((dashboardStats.completed / dashboardStats.totalSADs) * 100) : 0}%</StatNumber>
          <StatHelpText style={{ color: 'rgba(255,255,255,0.9)' }}>{dashboardStats.completed} completed</StatHelpText>
        </Stat>
      </div>

      {/* Inline create form */}
      <Box as="form" onSubmit={(e) => { e.preventDefault(); handleCreateSAD(); }} bg="white" p={4} borderRadius="md" boxShadow="sm" mb={6}>
        <Text fontWeight="semibold" mb={2}>Register a new SAD</Text>
        <Text fontSize="sm" color="gray.600" mb={2}><FaInfoCircle style={{ marginRight: 8 }} />All fields are required.</Text>
        <SimpleGrid columns={{ base: 1, md: 4 }} spacing={3}>
          <FormControl isRequired>
            <FormLabel>SAD Number</FormLabel>
            <Input value={sadNo} onChange={(e) => setSadNo(e.target.value)} placeholder="e.g. 25" />
          </FormControl>

          <FormControl isRequired>
            <FormLabel>Regime</FormLabel>
            <Select placeholder="Select regime" value={regime} onChange={(e) => setRegime(e.target.value)}>
              {REGIME_OPTIONS.map(code => (
                <option key={code} value={code}>
                  {REGIME_LABEL_MAP[code] ? `${REGIME_LABEL_MAP[code]} (${code})` : code}
                </option>
              ))}
            </Select>
          </FormControl>

          <FormControl isRequired>
            <FormLabel>Declared Weight (kg)</FormLabel>
            <Input type="text" value={formatNumber(declaredWeight)} onChange={(e) => setDeclaredWeight(parseNumberString(e.target.value))} placeholder="e.g. 100000" />
          </FormControl>

          <FormControl isRequired>
            <FormLabel>Attach Docs</FormLabel>
            <Input type="file" multiple onChange={(e) => { const arr = Array.from(e.target.files || []); setDocs(arr); toast({ title: 'Files attached', description: `${arr.length} file(s) attached`, status: 'info' }); }} />
            <Text fontSize="sm" color="gray.500" mt={1}>{docs.length} file(s) selected — at least one required</Text>
          </FormControl>
        </SimpleGrid>

        <HStack mt={3}>
          <Button colorScheme="teal" leftIcon={<FaPlus />} onClick={handleCreateSAD} isLoading={loading} type="button" isDisabled={!canCreate}>Register SAD</Button>
          <Button type="button" onClick={() => { setSadNo(''); setRegime(''); setDeclaredWeight(''); setDocs([]); }}>Reset</Button>

          <Box ml="auto" display="flex" gap={2}>
            <Button size="sm" leftIcon={<FaFileExport />} onClick={handleExportFilteredCSV} type="button">Export filtered CSV</Button>
            <Button size="sm" variant="ghost" onClick={async () => { try { await handleManualBackupToStorage(); } catch (e) {} }} type="button">Backup to storage</Button>
          </Box>
        </HStack>
      </Box>

      {/* Filters */}
      <Box bg="white" p={4} borderRadius="md" boxShadow="sm" mb={6}>
        <Flex gap={3} align="center" wrap="wrap">
          <Input placeholder="Search (SAD, Regime, docs...)" value={nlQuery} onChange={(e) => setNlQuery(e.target.value)} maxW="360px" />
          <Button size="sm" onClick={runNlQuery} isLoading={nlLoading} type="button">Search</Button>
          <Button size="sm" variant="ghost" onClick={() => { setNlQuery(''); fetchSADs(); }} type="button">Reset</Button>

          <Select placeholder="Filter by status" size="sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} maxW="160px">
            <option value="">All</option>
            {SAD_STATUS.map(st => <option key={st} value={st}>{st}</option>)}
          </Select>

          <Select placeholder="Filter by regime" size="sm" value={regimeFilter} onChange={(e) => setRegimeFilter(e.target.value)} maxW="200px">
            <option value="">All</option>
            {REGIME_OPTIONS.map(code => (
              <option key={code} value={code}>
                {REGIME_LABEL_MAP[code] ? `${REGIME_LABEL_MAP[code]} (${code})` : code}
              </option>
            ))}
          </Select>

          <Select size="sm" value={sortBy} onChange={(e) => setSortBy(e.target.value)} maxW="200px">
            <option value="created_at">Newest</option>
            <option value="declared_weight">Declared weight</option>
            <option value="recorded">Recorded weight</option>
            <option value="discrepancy">Discrepancy</option>
          </Select>

          <Select size="sm" value={sortDir} onChange={(e) => setSortDir(e.target.value)} maxW="120px">
            <option value="asc">Asc</option>
            <option value="desc">Desc</option>
          </Select>

          <Box ml="auto" display="flex" gap={3} alignItems="center">
            <Text fontSize="sm" color="gray.600">Page</Text>
            <Select size="sm" value={page} onChange={(e) => setPage(Number(e.target.value))} maxW="120px">
              {Array.from({ length: totalPages }).map((_, i) => <option key={i+1} value={i+1}>{i+1}</option>)}
            </Select>
            <Select size="sm" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} maxW="120px">
              <option value={6}>6</option>
              <option value={12}>12</option>
              <option value={24}>24</option>
              <option value={50}>50</option>
            </Select>
          </Box>
        </Flex>
      </Box>

      {/* Table */}
      <Box bg="white" p={4} borderRadius="md" boxShadow="sm" mb={6} className="table-responsive">
        {loading ? <Spinner /> : (
          <Box overflowX="auto">
            <Table size="sm" variant="striped" className="table">
              <Thead>
                <Tr>
                  <Th>SAD</Th>
                  <Th>Regime</Th>
                  <Th isNumeric>Declared (kg)</Th>
                  <Th isNumeric>Discharged (kg)</Th>
                  <Th isNumeric>No. of Transactions</Th>
                  <Th>Status</Th>
                  <Th>Discrepancy</Th>
                  <Th>Actions</Th>
                </Tr>
              </Thead>
              <Tbody>
                <AnimatePresence>
                  {pagedSads.map((s) => {
                    const declaredNum = toNumber(s.declared_weight);
                    const recordedNum = toNumber(s.total_recorded_weight);
                    const discrepancy = recordedNum - declaredNum;

                    let discColor = 'green.600';
                    if (discrepancy > 0) discColor = 'red.600';
                    else if (discrepancy < 0) discColor = 'blue.600';
                    else discColor = 'green.600';

                    const statusDotColor = (s.status === 'Completed' ? 'green.400' : s.status === 'In Progress' ? 'red.400' : s.status === 'On Hold' ? 'yellow.400' : 'gray.400');
                    const readyToComplete = recordedNum >= declaredNum && s.status !== 'Completed';
                    const regimeDisplay = REGIME_LABEL_MAP[s.regime] ? `${s.regime}` : (s.regime || '—');

                    const declared = declaredNum.toLocaleString();
                    const recorded = recordedNum.toLocaleString();
                    const discrepancyText = Number.isFinite(discrepancy) ? (discrepancy === 0 ? '0' : discrepancy.toLocaleString()) : '0';
                    const creator = s.created_by_username || (s.created_by ? (createdByMap[s.created_by] || s.created_by) : '—');

                    const tooltipNode = (
                      <ChakraBox p={2}>
                        <Text fontSize="sm"><strong>Declared:</strong> {declared} kg</Text>
                        <Text fontSize="sm"><strong>Discharged:</strong> {recorded} kg</Text>
                        <Text fontSize="sm"><strong>Status:</strong> {s.status || '—'}</Text>
                        <Text fontSize="sm"><strong>Discrepancy:</strong> {discrepancyText} kg</Text>
                        <Text fontSize="sm"><strong>Created by:</strong> {creator}</Text>
                        <Text fontSize="xs" color="gray.500" mt={1}>Click the transactions badge to see manual vs uploaded breakdown.</Text>
                      </ChakraBox>
                    );

                    return (
                      <RowMotion key={s.sad_no || Math.random()} {...MOTION_ROW} style={{ background: 'transparent' }}>
                        <Td data-label="SAD" style={{ maxWidth: 220, overflowWrap: 'break-word' }}>
                          <Tooltip label={tooltipNode} placement="top" hasArrow openDelay={180}>
                            <Button
                              variant="ghost"
                              onClick={() => openDetailsModal(s)}
                              aria-label={`Open details for SAD ${s.sad_no}`}
                              title={`Open details for ${s.sad_no}`}
                              className="sad-link"
                              style={{ padding: 0 }}
                            >
                              {s.sad_no}
                            </Button>
                          </Tooltip>
                        </Td>
                        <Td data-label="Regime"><Text>{regimeDisplay}</Text></Td>
                        <Td data-label="Declared" isNumeric><Text>{declaredNum.toLocaleString()}</Text></Td>
                        <Td data-label="Discharged" isNumeric><Text>{recordedNum.toLocaleString()}</Text></Td>

                        {/* Transactions: styled badge + tooltip + clickable to open mini modal */}
                        <Td data-label="No. of Transactions" isNumeric>
                          <Tooltip label="Click to view manual vs uploaded breakdown" placement="top" hasArrow>
                            <Button
                              variant="ghost"
                              onClick={() => openTransactionsModal(s)}
                              aria-label={`View transactions for ${s.sad_no}`}
                              title="View transactions breakdown"
                              style={{ padding: 0 }}
                            >
                              <Box className="tx-badge">
                                {Number(s.ticket_count || 0).toLocaleString()}
                                <span className="tx-sub">transactions</span>
                              </Box>
                            </Button>
                          </Tooltip>
                        </Td>

                        <Td data-label="Status">
                          <VStack align="start" spacing={1}>
                            <HStack>
                              <Box width="10px" height="10px" borderRadius="full" bg={statusDotColor} />
                              <Text color={statusDotColor} fontWeight="medium">{s.status}</Text>
                            </HStack>
                          </VStack>
                        </Td>
                        <Td data-label="Discrepancy">
                          <Text color={discColor}>
                            {discrepancy === 0 ? '0' : discrepancy.toLocaleString()}
                          </Text>
                        </Td>
                        <Td data-label="Actions">
                          <HStack>
                            <Menu>
                              <MenuButton as={IconButton} aria-label="Actions" icon={<FaEllipsisV />} size="sm" />
                              <MenuList>
                                <MenuItem icon={<FaEye />} onClick={() => openDetailsModal(s)}>View Details</MenuItem>
                                <MenuItem icon={<FaEdit />} onClick={() => openStatusEditorFor(s)}>Edit SAD status</MenuItem>
                                <MenuItem icon={<FaFileAlt />} onClick={() => openDocsModal(s)}>View Docs</MenuItem>
                                <MenuItem icon={<FaRedoAlt />} onClick={() => recalcTotalForSad(s.sad_no)}>Recalc Totals</MenuItem>
                                {readyToComplete && <MenuItem icon={<FaCheck />} onClick={() => requestMarkCompleted(s.sad_no)}>Mark as Completed</MenuItem>}
                                <MenuItem onClick={() => handleExplainDiscrepancy(s)}>Explain discrepancy</MenuItem>
                                <MenuItem icon={<FaFilePdf />} onClick={() => generatePdfReport(s)}>Print / Save PDF</MenuItem>
                                <MenuItem icon={<FaFileExport />} onClick={() => exportSingleSAD(s)}>Export CSV</MenuItem>
                                <MenuDivider />
                                <MenuItem icon={<FaTrashAlt />} onClick={() => { setArchiveTarget(s.sad_no); setArchiveOpen(true); }}>Archive SAD</MenuItem>
                              </MenuList>
                            </Menu>
                          </HStack>
                        </Td>
                      </RowMotion>
                    );
                  })}
                </AnimatePresence>
              </Tbody>
            </Table>
          </Box>
        )}
      </Box>

      {/* Transactions mini-modal (NEW) */}
      <Modal isOpen={txModal.open} onClose={closeTransactionsModal} isCentered size="md" motionPreset="scale">
        <ModalOverlay />
        <ModalContent borderRadius="12px" padding={0}>
          <ModalHeader>Transactions — {txModal.sad_no}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {txModal.loading ? (
              <Flex align="center" justify="center" py={8}><Spinner /></Flex>
            ) : (
              <>
                <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3} mb={4}>
                  <Box p={4} borderRadius="md" bg="linear-gradient(90deg,#111827,#6d28d9)" color="white" boxShadow="sm">
                    <Text fontSize="sm" opacity={0.9}>Manual tickets</Text>
                    <Text fontSize="2xl" fontWeight="700" mt={2}>{txModal.manual.toLocaleString()}</Text>
                    <Text fontSize="xs" mt={1} opacity={0.85}>Start with <code>M-</code></Text>
                  </Box>

                  <Box p={4} borderRadius="md" bg="linear-gradient(90deg,#06b6d4,#0ea5a0)" color="white" boxShadow="sm">
                    <Text fontSize="sm" opacity={0.9}>Uploaded (numeric)</Text>
                    <Text fontSize="2xl" fontWeight="700" mt={2}>{txModal.uploaded.toLocaleString()}</Text>
                    <Text fontSize="xs" mt={1} opacity={0.85}>Starts with numbers</Text>
                  </Box>
                </SimpleGrid>

                <Box mb={3}>
                  <Text fontSize="sm" color="gray.600">Total transactions: <strong>{txModal.total.toLocaleString()}</strong></Text>
                </Box>

                <Box mb={2}>
                  <Text fontSize="sm" mb={2} fontWeight="semibold">Recent / sample tickets</Text>
                  {txModal.sample && txModal.sample.length ? (
                    <Box maxH="220px" overflowY="auto" border="1px solid" borderColor="gray.100" borderRadius="md" p={2}>
                      <Table size="sm">
                        <Thead>
                          <Tr><Th>Ticket</Th><Th>Truck</Th><Th isNumeric>Net</Th></Tr>
                        </Thead>
                        <Tbody>
                          {txModal.sample.map((t) => (
                            <Tr key={t.ticket_id || t.ticket_no}>
                              <Td style={{ maxWidth: 160, overflowWrap: 'break-word' }}>{t.ticket_no}</Td>
                              <Td>{t.gnsw_truck_no || t.truck_no || '—'}</Td>
                              <Td isNumeric>{toNumber(t.net ?? t.weight ?? 0).toLocaleString()}</Td>
                            </Tr>
                          ))}
                        </Tbody>
                      </Table>
                    </Box>
                  ) : <Text color="gray.500">No tickets to show.</Text>}
                </Box>

                <Text fontSize="xs" color="gray.500">Tip: manual tickets are those created by manual entry and start with <code>M-</code>. Uploaded tickets are typically numeric IDs.</Text>
              </>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={closeTransactionsModal}>Close</Button>
            <Button colorScheme="teal" ml={3} onClick={() => { /* maybe future: export list */ }}>Export</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Details modal (AgentDashboard-like) - heavier width so content fits */}
      <Modal isOpen={detailsOpen} onClose={() => setDetailsOpen(false)} size="6xl" scrollBehavior="inside">
        <ModalOverlay />
        <ModalContent
          // increase width by about 50% of typical xl (responsive)
          maxW={{ base: '95vw', md: '90vw', lg: '1200px' }}
          width={{ base: '95vw', md: '90vw', lg: '1200px' }}
          margin="24px auto"
        >
          <ModalHeader>Details — SAD {detailsData?.sad?.sad_no}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {detailsData?.loading ? <Spinner /> : (
              <>
                {detailsData.sad ? (
                  <>
                    {/* Stats cards — same appearance as AgentDashboard (responsive) */}
                    <ChakraSimpleGrid columns={{ base: 1, md: 4 }} spacing={3} mb={4}>
                      <Box>
                        <Stat bg="blue.50" px={4} py={3} borderRadius="md" boxShadow="sm">
                          <StatLabel>Declared Weight</StatLabel>
                          <StatNumber>{toNumber(detailsData.sad.declared_weight).toLocaleString()}</StatNumber>
                          <StatHelpText>From SAD Declaration</StatHelpText>
                        </Stat>
                      </Box>

                      <Box>
                        <Stat bg="green.50" px={4} py={3} borderRadius="md" boxShadow="sm">
                          <StatLabel>Discharged Weight</StatLabel>
                          <StatNumber>{toNumber(detailsData.sad.total_recorded_weight != null ? detailsData.sad.total_recorded_weight : (detailsData.tickets || []).reduce((s, r) => s + toNumber(r.net ?? r.weight ?? 0), 0)).toLocaleString()}</StatNumber>
                          <StatHelpText>Sum of tickets</StatHelpText>
                        </Stat>
                      </Box>

                      <Box>
                        <Stat bg="gray.50" px={4} py={3} borderRadius="md" boxShadow="sm">
                          <StatLabel>SAD Status</StatLabel>
                          <StatNumber>{detailsData.sad.status || 'Unknown'}</StatNumber>
                          <StatHelpText>{detailsData.sad.total_recorded_weight != null ? 'Declaration exists in DB' : 'No declaration found'}</StatHelpText>
                        </Stat>
                      </Box>

                      <Box>
                        {(() => {
                          // NEW: always show the real difference (signed), with helpful label and color
                          const recorded = toNumber(detailsData.sad.total_recorded_weight || (detailsData.tickets || []).reduce((s, r) => s + toNumber(r.net ?? r.weight ?? 0), 0));
                          const declared = toNumber(detailsData.sad.declared_weight);
                          if (!declared) {
                            return (
                              <Stat bg="gray.25" px={4} py={3} borderRadius="md" boxShadow="sm">
                                <StatLabel>Discrepancy</StatLabel>
                                <StatNumber>—</StatNumber>
                                <StatHelpText>No declared weight</StatHelpText>
                              </Stat>
                            );
                          }

                          const diff = recorded - declared;
                          const abs = Math.abs(diff);
                          const pct = declared > 0 ? ((abs / declared) * 100).toFixed(1) : null;

                          if (diff > 0) {
                            return (
                              <Stat bg="red.50" px={4} py={3} borderRadius="md" boxShadow="sm">
                                <StatLabel>Discrepancy</StatLabel>
                                <StatNumber>{abs.toLocaleString()} kg</StatNumber>
                                <StatHelpText>{pct != null ? `${pct}% over declared` : 'Over declared weight'}</StatHelpText>
                              </Stat>
                            );
                          } else if (diff < 0) {
                            return (
                              <Stat bg="blue.50" px={4} py={3} borderRadius="md" boxShadow="sm">
                                <StatLabel>Discrepancy</StatLabel>
                                <StatNumber>{abs.toLocaleString()} kg</StatNumber>
                                <StatHelpText>{pct != null ? `${pct}% under declared` : 'Below declared weight'}</StatHelpText>
                              </Stat>
                            );
                          } else {
                            return (
                              <Stat bg="green.50" px={4} py={3} borderRadius="md" boxShadow="sm">
                                <StatLabel>Discrepancy</StatLabel>
                                <StatNumber>0 kg</StatNumber>
                                <StatHelpText>Matches declared</StatHelpText>
                              </Stat>
                            );
                          }
                        })()}
                      </Box>
                    </ChakraSimpleGrid>

                    {/* Action buttons like AgentDashboard */}
                    <Flex gap={3} align="center" mb={3} wrap="wrap">
                      <Button size="sm" colorScheme="blue" onClick={() => { generatePdfReport(detailsData.sad); }}>Print / Save PDF</Button>
                      <Button size="sm" onClick={() => exportSingleSAD(detailsData.sad)}>Export CSV</Button>
                      <Button size="sm" onClick={() => recalcTotalForSad(detailsData.sad.sad_no)}>Recalc Totals</Button>
                      <Button size="sm" onClick={() => handleExplainDiscrepancy(detailsData.sad)}>Explain discrepancy</Button>
                      <Button size="sm" leftIcon={<FaEnvelope />} onClick={() => emailSad(detailsData.sad)}>Email</Button>
                    </Flex>

                    <Text mb={1}>Created At: <strong>{detailsData.sad.created_at ? new Date(detailsData.sad.created_at).toLocaleDateString() : '—'}</strong></Text>
                    <Text mb={1}>Created By: <strong>{detailsData.created_by_username || (detailsData.sad && detailsData.sad.created_by ? (createdByMap[detailsData.sad.created_by] || detailsData.sad.created_by) : '—')}</strong></Text>

                    {/* Completed fields */}
                    <Text mb={3}>Completed At: <strong>{detailsData.sad.completed_at ? new Date(detailsData.sad.completed_at).toLocaleDateString() : '—'}</strong></Text>
                    <Text mb={4}>Completed By: <strong>{detailsData.completed_by_username || (detailsData.sad && detailsData.sad.completed_by ? (createdByMap[detailsData.sad.completed_by] || detailsData.sad.completed_by) : (completedByMapRef.current[detailsData.sad?.sad_no] || '—'))}</strong></Text>

                    {/* --- NEW: search & filter controls for tickets inside modal --- */}
                    <Box mb={3} p={3} borderRadius="md" bg="gray.50">
                      <Flex gap={3} wrap="wrap" align="center">
                        <Input placeholder="Search ticket no, driver, material..." size="sm" value={detailFilters.q} onChange={(e) => applyDetailFilterChange('q', e.target.value)} maxW="360px" />
                        <Input placeholder="Truck number" size="sm" value={detailFilters.truck} onChange={(e) => applyDetailFilterChange('truck', e.target.value)} maxW="220px" />
                        <Select size="sm" value={detailFilters.type} onChange={(e) => applyDetailFilterChange('type', e.target.value)} maxW="160px">
                          <option value="">All types</option>
                          <option value="manual">Manual (M-)</option>
                          <option value="uploaded">Uploaded (numeric)</option>
                          <option value="other">Other</option>
                        </Select>

                        <Box>
                          <Text fontSize="xs" mb={1}>Date from</Text>
                          <Input type="date" size="sm" value={detailFilters.dateFrom} onChange={(e) => applyDetailFilterChange('dateFrom', e.target.value)} />
                        </Box>
                        <Box>
                          <Text fontSize="xs" mb={1}>Date to</Text>
                          <Input type="date" size="sm" value={detailFilters.dateTo} onChange={(e) => applyDetailFilterChange('dateTo', e.target.value)} />
                        </Box>

                        <Box>
                          <Text fontSize="xs" mb={1}>Time from</Text>
                          <Input type="time" size="sm" value={detailFilters.timeFrom} onChange={(e) => applyDetailFilterChange('timeFrom', e.target.value)} />
                        </Box>
                        <Box>
                          <Text fontSize="xs" mb={1}>Time to</Text>
                          <Input type="time" size="sm" value={detailFilters.timeTo} onChange={(e) => applyDetailFilterChange('timeTo', e.target.value)} />
                        </Box>

                        <Spacer />

                        <HStack>
                          <Button size="sm" onClick={() => setDetailFilters({ q: '', truck: '', type: '', dateFrom: '', dateTo: '', timeFrom: '', timeTo: '' })}>Reset</Button>
                          <Button size="sm" colorScheme="teal" onClick={exportFilteredTicketsCsv}>Export filtered CSV</Button>
                        </HStack>
                      </Flex>

                      {/* small inline derived stats */}
                      <Flex mt={3} gap={4} align="center" wrap="wrap">
                        <Text fontSize="sm">Showing <strong>{detailDerived.total}</strong> tickets • Net <strong>{detailDerived.cumulativeNet.toLocaleString()}</strong> kg</Text>
                        <Text fontSize="sm">Manual <strong>{detailDerived.manual}</strong> • Uploaded <strong>{detailDerived.uploaded}</strong></Text>
                      </Flex>
                    </Box>

                    <Heading size="sm" mb={2}>Tickets for this SAD</Heading>

                    <Box overflowX="auto" mb={4}>
                      {filteredDetailTickets && filteredDetailTickets.length ? (
                        <Table size="sm">
                          <Thead><Tr><Th>Ticket</Th><Th>Truck</Th><Th isNumeric>Net (kg)</Th><Th>Date</Th></Tr></Thead>
                          <Tbody>
                            {filteredDetailTickets.map(t => (
                              <Tr key={t.ticket_id || t.ticket_no}>
                                <Td style={{ maxWidth: 200, overflowWrap: 'break-word' }}>{t.ticket_no}</Td>
                                <Td>{t.gnsw_truck_no || t.truck_no || '—'}</Td>
                                <Td isNumeric>{toNumber(t.net ?? t.weight ?? 0).toLocaleString()}</Td>
                                <Td>{t.date ? new Date(t.date).toLocaleString() : '—'}</Td>
                              </Tr>
                            ))}
                          </Tbody>
                        </Table>
                      ) : <Text>No tickets recorded.</Text>}
                    </Box>

                  </>
                ) : <Text>No data</Text>}
              </>
            )}
          </ModalBody>
          <ModalFooter>
            <Button onClick={() => setDetailsOpen(false)}>Close</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Status Edit modal */}
      <Modal isOpen={statusEditOpen} onClose={closeStatusEdit} isCentered>
        <ModalOverlay />
        <ModalContent maxW={{ base: '90vw', md: '480px' }}>
          <ModalHeader>Edit SAD Status</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <FormControl>
              <FormLabel>Select Status</FormLabel>
              <Select value={statusEditValue} onChange={(e) => setStatusEditValue(e.target.value)}>
                <option value="In Progress">In Progress</option>
                <option value="On Hold">On Hold</option>
                <option value="Completed">Completed</option>
              </Select>
            </FormControl>
            {statusEditValue === 'Completed' && (
              <Text mt={3} fontSize="sm" color="gray.600">Marking as Completed will set Completed At to now and record who completed it.</Text>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={closeStatusEdit}>Cancel</Button>
            <Button colorScheme="teal" ml={3} onClick={confirmStatusEdit}>Save</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* SAD detail modal (existing) */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} size="xl" scrollBehavior="inside">
        <ModalOverlay />
        <ModalContent maxW={{ base: '95vw', md: '800px' }}>
          <ModalHeader>SAD {selectedSad?.sad_no}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {selectedSad && (
              <>
                <Text mb={2}>Declared weight: <strong>{toNumber(selectedSad.declared_weight).toLocaleString()} kg</strong></Text>
                <Text mb={2}>Discharged weight: <strong>{toNumber(selectedSad.total_recorded_weight).toLocaleString()}</strong></Text>

                {/* discrepancy colored */}
                {(() => {
                  const recorded = toNumber(selectedSad.total_recorded_weight);
                  const declared = toNumber(selectedSad.declared_weight);
                  const diff = recorded - declared;
                  let color = 'green.600';
                  if (diff > 0) color = 'red.600';
                  else if (diff < 0) color = 'blue.600';
                  else color = 'green.600';
                  const abs = Math.abs(diff);
                  return (
                    <Text mb={3} color={color}>
                      Discrepancy: {Number.isFinite(diff) ? (diff === 0 ? '0' : abs.toLocaleString()) : '0'} kg {diff > 0 ? '(over declared)' : diff < 0 ? '(under declared)' : '(matches)'}
                    </Text>
                  );
                })()}

                <Text mb={2}># Transactions: <strong>{Number(selectedSad.ticket_count || 0).toLocaleString()}</strong></Text>
                <Text mb={4}>Status: <strong>{selectedSad.status}</strong></Text>

                <Heading size="sm" mb={2}>Tickets for this SAD</Heading>
                {detailLoading ? <Text>Loading...</Text> : (
                  <Box overflowX="auto">
                    <Table size="sm">
                      <Thead>
                        <Tr><Th>Ticket</Th><Th>Truck</Th><Th isNumeric>Net (kg)</Th><Th>Date</Th></Tr>
                      </Thead>
                      <Tbody>
                        {detailTickets.map(t => (
                          <Tr key={t.ticket_id || t.ticket_no}>
                            <Td>{t.ticket_no}</Td>
                            <Td>{t.gnsw_truck_no}</Td>
                            <Td isNumeric>{toNumber(t.net ?? t.weight ?? 0).toLocaleString()}</Td>
                            <Td>{t.date ? new Date(t.date).toLocaleDateString() : '—'}</Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  </Box>
                )}
              </>
            )}
          </ModalBody>
          <ModalFooter>
            <Button onClick={() => setIsModalOpen(false)} type="button">Close</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Archive confirm */}
      <AlertDialog isOpen={archiveOpen} leastDestructiveRef={archiveCancelRef} onClose={() => setArchiveOpen(false)}>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">Archive SAD</AlertDialogHeader>
            <AlertDialogBody>Are you sure you want to archive SAD {archiveTarget}? Archiving marks it as Archived (soft).</AlertDialogBody>
            <AlertDialogFooter>
              <Button ref={archiveCancelRef} onClick={() => setArchiveOpen(false)} type="button">Cancel</Button>
              <Button colorScheme="red" onClick={() => archiveSadConfirmed(archiveTarget)} ml={3} type="button">Archive</Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

      {/* Complete confirm */}
      <AlertDialog isOpen={completeOpen} leastDestructiveRef={completeCancelRef} onClose={() => setCompleteOpen(false)}>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">Mark as Completed</AlertDialogHeader>
            <AlertDialogBody>Are you sure you want to mark SAD {completeTarget} as Completed? This action must be done manually.</AlertDialogBody>
            <AlertDialogFooter>
              <Button ref={completeCancelRef} onClick={() => setCompleteOpen(false)} type="button">Cancel</Button>
              <Button colorScheme="green" onClick={confirmMarkCompleted} ml={3} type="button">Yes, mark Completed</Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

      {/* Docs modal */}
      <Modal isOpen={docsModal.open} onClose={() => setDocsModal({ open: false, docs: [], sad_no: null })} size="lg" scrollBehavior="inside">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Attached Documents{docsModal.sad_no ? ` — SAD ${docsModal.sad_no}` : ''}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {(!docsModal.docs || !docsModal.docs.length) ? (
              <Text color="gray.500">No documents attached</Text>
            ) : (
              <Box overflowX="auto">
                <Table size="sm">
                  <Thead>
                    <Tr><Th>Filename</Th><Th>Tags</Th><Th>Actions</Th></Tr>
                  </Thead>
                  <Tbody>
                    {docsModal.docs.map((d, i) => (
                      <Tr key={i}>
                        <Td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name || d.path || 'doc'}</Td>
                        <Td>{(d.tags || []).length ? (d.tags.map((t, j) => <Tag key={j} size="sm" mr={1}><TagLabel>{t}</TagLabel></Tag>)) : <Text color="gray.500">—</Text>}</Td>
                        <Td>
                          <HStack>
                            <Button size="xs" onClick={() => { window.open(d.url, '_blank', 'noopener'); }}>Open</Button>
                            <IconButton size="xs" aria-label="Download" icon={<FaDownload />} onClick={() => { if (d.url) window.open(d.url, '_blank'); }} />
                          </HStack>
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </Box>
            )}
          </ModalBody>
          <ModalFooter>
            <Button onClick={() => setDocsModal({ open: false, docs: [], sad_no: null })} type="button">Close</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Activity */}
      <Box mt={6} bg="white" p={4} borderRadius="md" boxShadow="sm">
        <Heading size="sm">Activity (recent)</Heading>
        <VStack align="start" mt={3}>
          {activity.length ? activity.map((a, i) => (
            <Box key={i} width="100%" borderBottom="1px solid" borderColor="gray.100" py={2}>
              <Text fontSize="sm">{a.text}</Text>
              <Text fontSize="xs" color="gray.500">{new Date(a.time).toLocaleString()}</Text>
            </Box>
          )) : <Text color="gray.500">No activity yet</Text>}
        </VStack>
      </Box>

      {/* Floating orb CTA */}
      <div className="orb-cta" role="button" aria-label="New SAD" onClick={() => openOrb()}>
        <FaPlus />
      </div>

      {/* Orb holographic modal */}
      <Modal isOpen={orbOpen} onClose={closeOrb} isCentered size="lg" motionPreset="scale">
        <ModalOverlay />
        <ModalContent style={{ background: 'linear-gradient(180deg,#fff,#f8fbff)', borderRadius: 12, padding: 12 }}>
          <ModalHeader>
            <Flex align="center" gap={3}>
              <Box style={{ width: 48, height: 48, borderRadius: 12, background: 'linear-gradient(90deg,#7b61ff,#3ef4d0)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                ✨
              </Box>
              <Box><Text fontWeight="bold">Create New SAD</Text><Text fontSize="sm" color="gray.500">Holographic registration (all fields required)</Text></Box>
            </Flex>
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
              <FormControl isRequired><FormLabel>SAD Number</FormLabel><Input value={sadNo} onChange={(e) => setSadNo(e.target.value)} /></FormControl>
              <FormControl isRequired><FormLabel>Regime</FormLabel><Select placeholder="Select regime" value={regime} onChange={(e) => setRegime(e.target.value)}>{REGIME_OPTIONS.map(code => <option key={code} value={code}>{REGIME_LABEL_MAP[code] ? `${REGIME_LABEL_MAP[code]} (${code})` : code}</option>)}</Select></FormControl>
              <FormControl isRequired><FormLabel>Declared Weight (kg)</FormLabel><Input type="text" value={formatNumber(declaredWeight)} onChange={(e) => setDeclaredWeight(parseNumberString(e.target.value))} /></FormControl>
              <FormControl isRequired><FormLabel>Attach Documents</FormLabel><Input type="file" multiple onChange={(e) => { const arr = Array.from(e.target.files || []); setDocs(arr); toast({ title: 'Files attached', description: `${arr.length} file(s) attached`, status: 'info' }); }} /><Text fontSize="sm" color="gray.500" mt={1}>{docs.length} file(s) selected — at least one required</Text></FormControl>
            </SimpleGrid>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={closeOrb}>Cancel</Button>
            <Button colorScheme="teal" ml={3} onClick={handleCreateSAD} isLoading={loading} isDisabled={!canCreate}>Create SAD</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Container>
  );
}
