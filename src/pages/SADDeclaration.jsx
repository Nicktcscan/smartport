// src/pages/SADDeclaration.jsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Box, Button, Container, Heading, Input, SimpleGrid, FormControl, FormLabel, Select,
  Text, Table, Thead, Tbody, Tr, Th, Td, VStack, HStack, useToast, Modal, ModalOverlay,
  ModalContent, ModalHeader, ModalBody, ModalFooter, ModalCloseButton, IconButton, Flex,
  Spinner, Tag, TagLabel, Stat, StatLabel, StatNumber, StatHelpText,
  Menu, MenuButton, MenuList, MenuItem, MenuDivider, AlertDialog, AlertDialogOverlay,
  AlertDialogContent, AlertDialogHeader, AlertDialogBody, AlertDialogFooter, useDisclosure,
  Tooltip, Badge, Grid, Spacer, Image, Avatar
} from '@chakra-ui/react';
import {
  FaPlus, FaFileExport, FaEllipsisV, FaEdit, FaRedoAlt, FaTrashAlt, FaDownload, FaFilePdf, FaCheck, FaEye, FaFileAlt,
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

/* -----------------------
   Supabase helper: retries + backoff on transient (5xx/503) errors
   Use by passing a function that returns a Supabase-style result object ( { data, error } )
----------------------- */
async function withRetries(fn, { attempts = 3, baseDelay = 450 } = {}) {
  let i = 0;
  while (i < attempts) {
    try {
      const res = await fn();
      // Supabase returns { data, error } objects; also some calls may throw
      if (res && typeof res === 'object' && 'error' in res && res.error) {
        const err = res.error;
        const status = err?.status ?? err?.statusCode ?? null;
        const isTransient = status === 502 || status === 503 || status === 504 || /503|504|502/.test(String(err?.message || ''));
        if (isTransient && i < attempts - 1) {
          const delay = baseDelay * Math.pow(2, i);
          // tiny jitter
          await new Promise((r) => setTimeout(r, delay + Math.round(Math.random() * 100)));
          i += 1;
          continue;
        }
        // non-transient or exhausted -> return res so caller can handle error
        return res;
      }
      // success case (no error field or error is null)
      return res;
    } catch (err) {
      const isTransient = /503|504|502/.test(String(err?.message || ''));
      if (isTransient && i < attempts - 1) {
        const delay = baseDelay * Math.pow(2, i);
        await new Promise((r) => setTimeout(r, delay + Math.round(Math.random() * 100)));
        i += 1;
        continue;
      }
      // if non-transient or exhausted, rethrow
      throw err;
    }
  }
  // fallback - shouldn't reach
  return fn();
}

export default function SADDeclaration() {
  const toast = useToast();

  // form
  const [sadNo, setSadNo] = useState('');
  const [regime, setRegime] = useState(''); // codes like IM4/EX1/IM7
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

  // details modal (shows declared/discharged/status/createdAt/createdBy + tickets)
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsData, setDetailsData] = useState({ sad: null, tickets: [], created_by_username: null, loading: false });

  // transaction breakdown modal (NEW: uses AgentSAD styling)
  const [txnModalOpen, setTxnModalOpen] = useState(false);
  const [txnModalLoading, setTxnModalLoading] = useState(false);
  const [txnModalSadNo, setTxnModalSadNo] = useState(null);
  const [txnModalTickets, setTxnModalTickets] = useState([]);
  const [txnCounts, setTxnCounts] = useState({ manual: 0, uploaded: 0, total: 0, others: 0 });

  // filters / NL / paging / sorting
  const [nlQuery, setNlQuery] = useState('');
  const [nlLoading, setNlLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [regimeFilter, setRegimeFilter] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);

  // edit / confirmations
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editModalData, setEditModalData] = useState(null);
  // NEW: editable docs state inside edit modal
  const [editModalDocs, setEditModalDocs] = useState([]);
  const [editModalNewFiles, setEditModalNewFiles] = useState([]);
  const [editUploading, setEditUploading] = useState(false);

  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);
  const confirmSaveCancelRef = useRef();

  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const archiveCancelRef = useRef();

  const [completeOpen, setCompleteOpen] = useState(false);
  const [completeTarget, setCompleteTarget] = useState(null);
  const completeCancelRef = useRef();

  // delete confirm
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const deleteCancelRef = useRef();

  const [activity, setActivity] = useState([]);

  // realtime
  const subRef = useRef(null);
  const ticketsSubRef = useRef(null);
  const refreshTimerRef = useRef(null);
  const isMountedRef = useRef(true);
  useEffect(() => { return () => { isMountedRef.current = false; }; }, []);

  // orb CTA
  const { isOpen: orbOpen, onOpen: openOrb, onClose: closeOrb } = useDisclosure();

  // map of created_by -> username for showing who created SADs
  const createdByMapRef = useRef({});
  const createdByMap = createdByMapRef.current;

  // admin detection
  const [currentUser, setCurrentUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // file input ref + drag/drop helpers for edit modal
  const editFileInputRef = useRef(null);
  const handleEditDrop = (ev) => {
    ev.preventDefault();
    const dt = ev.dataTransfer;
    if (!dt) return;
    const files = Array.from(dt.files || []);
    onEditFilesSelected(files);
  };
  const handleEditDragOver = (ev) => { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; };

  // detect current user and admin status on mount
  useEffect(() => {
    const detect = async () => {
      try {
        let user = null;
        // try new getUser
        if (supabase.auth && supabase.auth.getUser) {
          const res = await supabase.auth.getUser();
          user = res?.data?.user ?? null;
        } else if (supabase.auth && supabase.auth.user) {
          user = supabase.auth.user();
        }

        if (!user) {
          setCurrentUser(null);
          setIsAdmin(false);
          return;
        }
        setCurrentUser(user);

        // quick check in metadata
        const meta = user.user_metadata || {};
        if (meta.role === 'admin' || meta.is_admin === true) {
          setIsAdmin(true);
          return;
        }

        // fallback: query users table for role/is_admin columns
        try {
          const { data } = await withRetries(() => supabase.from('users').select('id, role, is_admin').eq('id', user.id).maybeSingle());
          if (data && (data.role === 'admin' || data.is_admin === true)) {
            setIsAdmin(true);
          } else {
            setIsAdmin(false);
          }
        } catch (e) {
          // if anything fails, default to non-admin
          setIsAdmin(false);
        }
      } catch (err) {
        console.warn('admin detect err', err);
        setIsAdmin(false);
      }
    };
    detect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ensure created_at sorting keeps newest first if sortBy is created_at
  useEffect(() => {
    if (sortBy === 'created_at' && sortDir !== 'asc') {
      setSortDir('asc');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy]);

  // small helper to schedule a (debounced) refresh from realtime events so we don't spam
  const scheduleFetchSADs = (delay = 700) => {
    clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      fetchSADs().catch(() => {});
    }, delay);
  };

  // ----- fetchSADs (hardened) -----
  const fetchSADs = async (filter = null) => {
    // ensure only one in-flight fetchSADs at a time to avoid request storms
    if (!isMountedRef.current) return;
    setLoading(true);
    try {
      // when talking to DB, regime values are the codes (IM4/EX1/IM7)
      let q = supabase.from('sad_declarations').select('*').order('created_at', { ascending: false });
      if (filter) {
        if (filter.status) q = q.eq('status', filter.status);
        if (filter.sad_no) q = q.eq('sad_no', filter.sad_no);
        if (filter.regime) q = q.eq('regime', filter.regime);
      }

      const { data, error } = await withRetries(() => q);
      if (error) throw error;

      const normalized = (data || []).map((r) => {
        const trimmed = r.sad_no != null ? String(r.sad_no).trim() : r.sad_no;
        return {
          ...r,
          sad_no: trimmed,
          _raw_sad_no: r.sad_no,
          docs: Array.isArray(r.docs) ? JSON.parse(JSON.stringify(r.docs)) : [],
          total_recorded_weight: Number(r.total_recorded_weight ?? 0),
          ticket_count: 0,
          manual_update: r.manual_update ?? false,
          completed_at: r.completed_at ?? null, // include completed_at here
        };
      });

      // get counts per sad - but do this in batches with retries to avoid many concurrent head calls
      const sadNos = Array.from(new Set(normalized.map((s) => (s.sad_no ? String(s.sad_no).trim() : null)).filter(Boolean)));
      if (sadNos.length) {
        const countResults = await runInBatches(sadNos, 25, async (sadKey) => {
          try {
            const res = await withRetries(() =>
              supabase
                .from('tickets')
                .select('id', { head: true, count: 'exact' })
                .eq('sad_no', sadKey)
            );
            const count = res?.count ?? 0;
            return { sadKey, count: Number(count || 0) };
          } catch (e) {
            console.warn('count exception for', sadKey, e);
            return { sadKey, count: 0 };
          }
        });

        const countsMap = {};
        for (const r of countResults) countsMap[String(r.sadKey)] = Number(r.count || 0);

        for (let i = 0; i < normalized.length; i++) {
          const s = normalized[i];
          const key = s.sad_no != null ? String(s.sad_no).trim() : '';
          normalized[i] = {
            ...s,
            ticket_count: countsMap[key] || 0,
            total_recorded_weight: Number(s.total_recorded_weight || 0),
          };
        }
      }

      // resolve created_by usernames
      const creatorIds = Array.from(new Set(normalized.map((r) => r.created_by).filter(Boolean)));
      if (creatorIds.length) {
        const unresolved = creatorIds.filter((id) => !createdByMap[id]);
        if (unresolved.length) {
          try {
            const { data: usersData } = await withRetries(() => supabase.from('users').select('id, username, email').in('id', unresolved));
            if (usersData && usersData.length) {
              for (const u of usersData) {
                createdByMap[u.id] = u.username || u.email || 'Unknown';
              }
              createdByMapRef.current = { ...createdByMap };
            }
          } catch (e) { /* ignore */ }
        }
      }

      const enhanced = normalized.map((s) => {
        const declared = Number(s.declared_weight || 0);
        const recorded = Number(s.total_recorded_weight || 0);
        const dischargeCompleted = declared > 0 && recorded >= declared;
        return { ...s, dischargeCompleted, created_by_username: createdByMap[s.created_by] || null };
      });

      if (!isMountedRef.current) return;
      setSads(enhanced);
    } catch (err) {
      console.error('fetchSADs', err);
      if (isMountedRef.current) {
        toast({ title: 'Failed to load SADs', description: err?.message || 'Unexpected', status: 'error' });
      }
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  };

  // lifecycle: load + realtime (with guarded subscriptions)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('sad_activity');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setActivity(parsed);
      }
    } catch (e) { /* ignore */ }

    // initial load
    fetchSADs().catch(() => {});

    // realtime subscriptions (guarded)
    try {
      // remove any existing channel references if present (avoid duplicate subscriptions)
      const safeSubscribeSad = async () => {
        try {
          if (subRef.current && supabase.removeChannel) {
            try { await supabase.removeChannel(subRef.current); } catch (e) { /* ignore */ }
            subRef.current = null;
          }
        } catch (e) {}

        try {
          if (supabase.channel) {
            const ch = supabase.channel('public:sad_declarations')
              .on('postgres_changes', { event: '*', schema: 'public', table: 'sad_declarations' }, () => {
                // debounce refreshes to avoid storms
                scheduleFetchSADs(600);
              })
              .subscribe();
            subRef.current = ch;
          } else {
            const s = supabase.from('sad_declarations').on('*', () => { scheduleFetchSADs(600); }).subscribe();
            subRef.current = s;
          }
        } catch (e) {
          console.warn('failed to subscribe sad_declarations', e);
        }
      };

      const safeSubscribeTickets = async () => {
        try {
          if (ticketsSubRef.current && supabase.removeChannel) {
            try { await supabase.removeChannel(ticketsSubRef.current); } catch (e) { /* ignore */ }
            ticketsSubRef.current = null;
          }
        } catch (e) {}

        try {
          if (supabase.channel) {
            const tch = supabase.channel('public:tickets')
              .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => {
                // tickets changed -> refresh counts but debounce
                scheduleFetchSADs(800);
              })
              .subscribe();
            ticketsSubRef.current = tch;
          } else {
            const s = supabase.from('tickets').on('*', () => { scheduleFetchSADs(800); }).subscribe();
            ticketsSubRef.current = s;
          }
        } catch (e) {
          console.warn('failed to subscribe tickets', e);
        }
      };

      safeSubscribeSad();
      safeSubscribeTickets();
    } catch (e) { /* ignore */ }

    return () => {
      try { if (subRef.current && supabase.removeChannel) supabase.removeChannel(subRef.current).catch(() => {}); } catch (e) {}
      try { if (ticketsSubRef.current && supabase.removeChannel) supabase.removeChannel(ticketsSubRef.current).catch(() => {}); } catch (e) {}
      clearTimeout(refreshTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try { localStorage.setItem('sad_activity', JSON.stringify(activity)); } catch (e) { /* ignore */ }
  }, [activity]);

  const pushActivity = async (text, meta = {}) => {
    const ev = { time: new Date().toISOString(), text, meta };
    setActivity(prev => [ev, ...prev].slice(0, 200));
    try { await withRetries(() => supabase.from('sad_activity').insert([{ text, meta }])); } catch (e) { /* ignore */ }
  };

  // open docs modal
  const openDocsModal = (sad) => {
    setDocsModal({ open: true, docs: Array.isArray(sad.docs) ? sad.docs : [], sad_no: sad.sad_no });
  };

  // upload docs (hardened with retries)
  const uploadDocs = async (sad_no, files = []) => {
    if (!files || files.length === 0) return [];
    const uploaded = [];
    for (const f of files) {
      const key = `sad-${sad_no}/${Date.now()}-${f.name.replace(/\s+/g, '_')}`;
      // attempt upload with retries (wrap as function returning { data, error })
      try {
        const uploadRes = await withRetries(() => supabase.storage.from(SAD_DOCS_BUCKET).upload(key, f, { cacheControl: '3600', upsert: false }));
        if (uploadRes?.error) throw uploadRes.error;
        const filePath = uploadRes?.data?.path ?? uploadRes?.data?.Key ?? key;

        let url = null;
        try {
          // prefer public URL, fallback to signed
          const getPublic = await withRetries(() => supabase.storage.from(SAD_DOCS_BUCKET).getPublicUrl(filePath));
          const publicUrl = (getPublic?.data && (getPublic.data.publicUrl || getPublic.data.publicURL)) ?? getPublic?.publicURL ?? null;
          if (publicUrl) url = publicUrl;
          else {
            const signedResp = await withRetries(() => supabase.storage.from(SAD_DOCS_BUCKET).createSignedUrl(filePath, 60 * 60 * 24 * 7));
            const signedUrl = (signedResp?.data && (signedResp.data.signedUrl || signedResp.data.signedURL)) ?? signedResp?.signedUrl ?? signedResp?.signedURL ?? null;
            if (!signedUrl) throw new Error('Could not obtain public or signed URL for uploaded file.');
            url = signedUrl;
          }
        } catch (uErr) {
          throw uErr;
        }

        uploaded.push({ name: f.name, path: filePath, url, tags: [], parsed: null });
        await pushActivity(`Uploaded doc ${f.name} for SAD ${sad_no}`, { sad_no, file: f.name });
      } catch (e) {
        console.error('uploadDocs failure for', f.name, e);
        // don't abort entire upload; continue to next file but notify
        toast({ title: `Upload failed: ${f.name}`, description: e?.message || 'Error uploading', status: 'warning' });
      }
    }
    return uploaded;
  };

  // --- validation for registration form (all mandatory) ---
  const isRegistrationValid = () => {
    const sadNoTrim = String(sadNo || '').trim();
    if (!sadNoTrim) return false;
    if (!regime) return false;
    const declStr = parseNumberString(declaredWeight);
    if (!declStr) return false;
    const declNum = Number(declStr);
    if (!Number.isFinite(declNum) || declNum <= 0) return false;
    if (!docs || docs.length === 0) return false;
    return true;
  };

  // create SAD - now storing regime as code (IM4/EX1/IM7)
  const handleCreateSAD = async (e) => {
    if (e && e.preventDefault) e.preventDefault();

    // enforce mandatory fields
    const sadNoTrim = String(sadNo || '').trim();
    const declStr = parseNumberString(declaredWeight);
    const declNum = declStr === '' ? NaN : Number(declStr);

    if (!sadNoTrim) {
      toast({ title: 'Missing SAD number', description: 'SAD Number is required', status: 'warning' });
      return;
    }
    if (!regime) {
      toast({ title: 'Missing regime', description: 'Regime is required', status: 'warning' });
      return;
    }
    if (!declStr || !Number.isFinite(declNum) || declNum <= 0) {
      toast({ title: 'Invalid declared weight', description: 'Declared Weight (kg) must be a number greater than 0', status: 'warning' });
      return;
    }
    if (!docs || docs.length === 0) {
      toast({ title: 'Missing documents', description: 'Attach at least one document', status: 'warning' });
      return;
    }

    setLoading(true);
    try {
      const currentUserRes = (supabase.auth && supabase.auth.getUser) ? (await supabase.auth.getUser()).data?.user : (supabase.auth && supabase.auth.user ? supabase.auth.user() : null);
      const docRecords = await uploadDocs(sadNoTrim, docs);
      const trimmedSad = sadNoTrim;

      // regime conversion if user typed a word (shouldn't be necessary since select forces codes)
      let regimeCode = regime;
      if (!regimeCode && typeof regime === 'string') {
        const low = regime.trim().toLowerCase();
        if (WORD_TO_CODE[low]) regimeCode = WORD_TO_CODE[low];
      }

      const payload = {
        sad_no: trimmedSad,
        regime: regimeCode || null,
        declared_weight: Number(declNum || 0),
        docs: docRecords,
        status: 'In Progress',
        manual_update: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        completed_at: null, // ensure created with null completed_at
      };
      if (currentUserRes && currentUserRes.id) payload.created_by = currentUserRes.id;

      const insertRes = await withRetries(() => supabase.from('sad_declarations').insert([payload]));
      if (insertRes?.error) throw insertRes.error;

      if (currentUserRes && currentUserRes.id) {
        const uname = (currentUserRes.user_metadata && currentUserRes.user_metadata.full_name) || currentUserRes.email || '';
        if (uname) createdByMapRef.current = { ...createdByMapRef.current, [currentUserRes.id]: uname };
      }

      if (typeof window !== 'undefined' && window.confetti) {
        try { window.confetti({ particleCount: 120, spread: 160, origin: { y: 0.6 } }); } catch (e) { /* ignore */ }
      }

      toast({ title: 'SAD registered', description: `SAD ${trimmedSad} created`, status: 'success' });
      await pushActivity(`Created SAD ${trimmedSad}`);
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

  // open SAD detail (existing) - updated to fetch the SAD row to include completed_at
  const openSadDetail = async (sad) => {
    setSelectedSad(null);
    setIsModalOpen(true);
    setDetailLoading(true);
    try {
      const trimmed = sad.sad_no != null ? String(sad.sad_no).trim() : sad.sad_no;

      // fetch latest SAD row to include completed_at
      const sadRowRes = await withRetries(() => supabase.from('sad_declarations').select('*').eq('sad_no', trimmed).maybeSingle());
      if (sadRowRes?.error) console.warn('could not fetch sad_row for openSadDetail', sadRowRes.error);
      const sadRow = sadRowRes?.data ?? null;

      const ticketsRes = await withRetries(() => supabase.from('tickets').select('*').eq('sad_no', trimmed).order('date', { ascending: false }));
      if (ticketsRes?.error) throw ticketsRes.error;
      const data = ticketsRes?.data ?? [];
      const computedTotal = (data || []).reduce((s, r) => s + Number(r.net ?? r.weight ?? 0), 0);

      const base = sadRow || sad || {};
      const updatedSelected = {
        ...base,
        total_recorded_weight: computedTotal,
        dischargeCompleted: (Number(base?.declared_weight || 0) > 0 && computedTotal >= Number(base?.declared_weight || 0)),
        ticket_count: (data || []).length,
      };
      setSelectedSad(updatedSelected);
      setDetailTickets(data || []);
      await pushActivity(`Viewed SAD ${trimmed} details`);
    } catch (err) {
      console.error('openSadDetail', err);
      toast({ title: 'Failed to load tickets', description: err?.message || 'Unexpected', status: 'error' });
      setDetailTickets([]);
      setSelectedSad(sad);
    } finally {
      setDetailLoading(false);
    }
  };

  // open details modal - updated to fetch the SAD row (fresh) including completed_at
  const openDetailsModal = async (sad) => {
    setDetailsData({ sad: null, tickets: [], created_by_username: sad.created_by_username || null, loading: true });
    setDetailsOpen(true);
    try {
      const trimmed = sad.sad_no != null ? String(sad.sad_no).trim() : sad.sad_no;

      // fetch the latest SAD row
      const sadRowRes = await withRetries(() => supabase.from('sad_declarations').select('*').eq('sad_no', trimmed).maybeSingle());
      if (sadRowRes?.error) console.warn('openDetailsModal: could not fetch sad row', sadRowRes.error);
      const sadRow = sadRowRes?.data ?? null;

      const ticketsRes = await withRetries(() => supabase.from('tickets').select('*').eq('sad_no', trimmed).order('date', { ascending: false }));
      if (ticketsRes?.error) {
        setDetailsData((d) => ({ ...d, tickets: [], loading: false }));
      } else {
        let createdByUsername = sad.created_by_username || null;
        if (!createdByUsername && sadRow && sadRow.created_by) {
          try {
            const uRes = await withRetries(() => supabase.from('users').select('id, username, email').eq('id', sadRow.created_by).maybeSingle());
            const u = uRes?.data ?? null;
            if (u) {
              createdByMapRef.current = { ...createdByMapRef.current, [u.id]: u.username || u.email || null };
              createdByUsername = u.username || u.email || null;
            }
          } catch (e) { /* ignore */ }
        }

        setDetailsData({ sad: sadRow || sad, tickets: ticketsRes?.data || [], created_by_username: createdByUsername, loading: false });
      }
    } catch (err) {
      console.error('openDetailsModal', err);
      setDetailsData((d) => ({ ...d, tickets: [], loading: false }));
      toast({ title: 'Failed', description: 'Could not load details', status: 'error' });
    }
  };

  // edit modal open (guarded: only admin allowed to edit Completed SADs)
  const openEditModal = (sad) => {
    // If SAD is Completed and current user is not admin -> prevent
    if (sad.status === 'Completed' && !isAdmin) {
      toast({
        title: 'Edit locked',
        description: 'Only admins can edit a SAD marked as Completed. Change status back to "In Progress" to allow editing.',
        status: 'warning',
        duration: 6000,
      });
      return;
    }

    setEditModalData({
      original_sad_no: sad.sad_no,
      sad_no: sad.sad_no,
      regime: sad.regime ?? '',
      declared_weight: String(sad.declared_weight ?? ''),
      status: sad.status ?? 'In Progress',
    });
    // initialize editable docs with a cloned array; keep existing docs visible/editable
    setEditModalDocs(Array.isArray(sad.docs) ? JSON.parse(JSON.stringify(sad.docs)) : []);
    setEditModalNewFiles([]);
    setEditModalOpen(true);
  };
  const closeEditModal = () => {
    setEditModalOpen(false);
    setEditModalData(null);
    setEditModalDocs([]);
    setEditModalNewFiles([]);
    setEditUploading(false);
  };

  // remove a doc from edit modal (only removes reference from docs array — does not delete storage)
  const removeDocFromEditModal = (index) => {
    setEditModalDocs((prev) => {
      const next = prev.slice();
      const removed = next.splice(index, 1);
      // NOTE: We intentionally do NOT delete from storage here.
      pushActivity(`Removed doc ${removed?.[0]?.name || removed?.[0]?.path || 'file'} from edit modal`, { sad_no: editModalData?.original_sad_no || null });
      return next;
    });
  };

  // handle new files selected in edit modal
  const onEditFilesSelected = (filesArr) => {
    const arr = Array.from(filesArr || []);
    if (!arr.length) return;
    setEditModalNewFiles((prev) => [...prev, ...arr]);
    toast({ title: 'Files attached', description: `${arr.length} file(s) attached to edit`, status: 'info' });
  };

  // save edit modal (handles renaming and regime/code changes) - ensure completed_at is set/cleared appropriately
  const saveEditModal = async () => {
    if (!editModalData || !editModalData.original_sad_no) return;

    // extra guard: if this is locked (completed + non-admin) block server update as well
    if (editModalData.status === 'Completed' && !isAdmin) {
      toast({ title: 'Edit blocked', description: 'You are not permitted to save changes to a Completed SAD.', status: 'error' });
      return;
    }

    const originalSad = editModalData.original_sad_no;
    const newSad = String(editModalData.sad_no ?? '').trim();
    const before = (sadsRef.current || []).find(s => s.sad_no === originalSad) || {};
    const declaredParsed = Number(parseNumberString(editModalData.declared_weight) || 0);

    // optimistic UI update
    const optimisticCompletedAt = editModalData.status === 'Completed' ? (before.completed_at || new Date().toISOString()) : null;
    setSads(prev => prev.map(s => (s.sad_no === originalSad ? { ...s, sad_no: newSad, regime: editModalData.regime, declared_weight: declaredParsed, status: editModalData.status, updated_at: new Date().toISOString(), completed_at: optimisticCompletedAt, docs: editModalDocs } : s)));
    setConfirmSaveOpen(false);
    closeEditModal();

    try {
      if (!newSad) throw new Error('SAD Number cannot be empty');

      // ensure regime is a code; if user entered a word, convert
      let regimeToSave = editModalData.regime;
      if (regimeToSave && typeof regimeToSave === 'string') {
        const low = regimeToSave.trim().toLowerCase();
        if (WORD_TO_CODE[low]) regimeToSave = WORD_TO_CODE[low];
      }

      // prepare completed_at logic
      const completedAtValue = editModalData.status === 'Completed' ? new Date().toISOString() : null;

      // Build the final docs array:
      let finalDocs = Array.isArray(editModalDocs) ? JSON.parse(JSON.stringify(editModalDocs)) : [];
      if (editModalNewFiles && editModalNewFiles.length) {
        setEditUploading(true);
        toast({ title: 'Uploading files', description: `Uploading ${editModalNewFiles.length} file(s)...`, status: 'info' });
        try {
          const uploadedRecords = await uploadDocs(newSad, editModalNewFiles);
          finalDocs = [...finalDocs, ...uploadedRecords];
          toast({ title: 'Uploads complete', description: `${uploadedRecords.length} file(s) uploaded`, status: 'success' });
        } catch (upErr) {
          console.error('upload during edit failed', upErr);
          toast({ title: 'Upload failed', description: upErr?.message || 'Could not upload files', status: 'error' });
        } finally {
          setEditUploading(false);
        }
      }

      if (newSad !== originalSad) {
        const conflictRes = await withRetries(() => supabase.from('sad_declarations').select('sad_no').eq('sad_no', newSad).maybeSingle());
        if (conflictRes?.data) {
          throw new Error(`SAD number "${newSad}" already exists. Choose another.`);
        }

        // update child tables first: tickets, reports_generated
        const { error: tErr } = (await withRetries(() => supabase.from('tickets').update({ sad_no: newSad }).eq('sad_no', originalSad))) || {};
        if (tErr) console.warn('tickets update returned error', tErr);

        const { error: rErr } = (await withRetries(() => supabase.from('reports_generated').update({ sad_no: newSad }).eq('sad_no', originalSad))) || {};
        if (rErr) console.warn('reports_generated update returned error', rErr);

        // now update the parent SAD row — include docs field
        const parentRes = await withRetries(() => supabase.from('sad_declarations').update({
          sad_no: newSad,
          regime: regimeToSave ?? null,
          declared_weight: declaredParsed,
          status: editModalData.status ?? null,
          updated_at: new Date().toISOString(),
          manual_update: true,
          completed_at: completedAtValue,
          docs: finalDocs,
        }).eq('sad_no', originalSad));
        if (parentRes?.error) {
          // attempt rollback children updates to originalSad (best-effort)
          try { await withRetries(() => supabase.from('tickets').update({ sad_no: originalSad }).eq('sad_no', newSad)); } catch (e) { /* ignore */ }
          try { await withRetries(() => supabase.from('reports_generated').update({ sad_no: originalSad }).eq('sad_no', newSad)); } catch (e) { /* ignore */ }
          throw parentRes.error;
        }
      } else {
        // same sad_no -> simple update (include docs field)
        const updRes = await withRetries(() => supabase.from('sad_declarations').update({
          regime: regimeToSave ?? null,
          declared_weight: declaredParsed,
          status: editModalData.status ?? null,
          updated_at: new Date().toISOString(),
          manual_update: true,
          completed_at: completedAtValue,
          docs: finalDocs,
        }).eq('sad_no', originalSad));
        if (updRes?.error) throw updRes.error;
      }

      // log change
      try {
        const after = {
          ...before,
          sad_no: newSad,
          regime: regimeToSave,
          declared_weight: declaredParsed,
          status: editModalData.status,
          updated_at: new Date().toISOString(),
          completed_at: editModalData.status === 'Completed' ? new Date().toISOString() : null,
          docs: finalDocs,
        };
        await withRetries(() => supabase.from('sad_change_logs').insert([{ sad_no: newSad, changed_by: null, before: JSON.stringify(before), after: JSON.stringify(after), created_at: new Date().toISOString() }]));
      } catch (e) { /* ignore */ }

      await pushActivity(`Edited SAD ${originalSad} → ${newSad}`, { before, after: { sad_no: newSad, docs_count: (finalDocs || []).length } });
      toast({ title: 'Saved', description: `SAD ${originalSad} updated${newSad !== originalSad ? ` → ${newSad}` : ''}`, status: 'success' });
      fetchSADs();
    } catch (err) {
      console.error('saveEditModal', err);
      toast({ title: 'Save failed', description: err?.message || 'Could not save changes', status: 'error' });
      fetchSADs(); // refresh to ensure UI consistency
    }
  };

  // update status quick action - sets completed_at when marking Completed, clears otherwise
  const updateSadStatus = async (sad_no, newStatus) => {
    try {
      const payload = { status: newStatus, updated_at: new Date().toISOString(), manual_update: true };
      if (newStatus === 'Completed') {
        payload.completed_at = new Date().toISOString();
      } else {
        payload.completed_at = null;
      }

      const { error } = await withRetries(() => supabase.from('sad_declarations').update(payload).eq('sad_no', sad_no));
      if (error) throw error;
      toast({ title: 'Status updated', description: `${sad_no} status set to ${newStatus}`, status: 'success' });
      await pushActivity(`Status of ${sad_no} set to ${newStatus}`);
      fetchSADs();
      if (selectedSad && selectedSad.sad_no === sad_no) openSadDetail({ sad_no });
    } catch (err) {
      console.error('updateSadStatus', err);
      toast({ title: 'Update failed', description: err?.message || 'Unexpected', status: 'error' });
    }
  };

  const requestMarkCompleted = (sad_no) => { setCompleteTarget(sad_no); setCompleteOpen(true); };
  const confirmMarkCompleted = async () => {
    const target = completeTarget; setCompleteOpen(false); setCompleteTarget(null);
    if (!target) return;
    try { setLoading(true); await updateSadStatus(target, 'Completed'); } catch (e) {} finally { setLoading(false); }
  };

  const recalcTotalForSad = async (sad_no) => {
    try {
      const trimmed = sad_no != null ? String(sad_no).trim() : sad_no;
      const ticketsRes = await withRetries(() => supabase.from('tickets').select('net, weight').eq('sad_no', trimmed));
      if (ticketsRes?.error) throw ticketsRes.error;
      const tickets = ticketsRes?.data ?? [];
      const total = (tickets || []).reduce((s, r) => s + Number(r.net ?? r.weight ?? 0), 0);
      const updRes = await withRetries(() => supabase.from('sad_declarations').update({ total_recorded_weight: total, updated_at: new Date().toISOString() }).eq('sad_no', trimmed));
      if (updRes?.error) throw updRes.error;
      await pushActivity(`Recalculated total for ${trimmed}: ${total}`);
      fetchSADs();
      toast({ title: 'Recalculated', description: `Total recorded ${total.toLocaleString()}`, status: 'success' });
    } catch (err) {
      console.error('recalcTotalForSad', err);
      toast({ title: 'Could not recalc', description: err?.message || 'Unexpected', status: 'error' });
    }
  };

  const archiveSadConfirmed = async (sad_no) => {
    try {
      const { error } = await withRetries(() => supabase.from('sad_declarations').update({ status: 'Archived', updated_at: new Date().toISOString() }).eq('sad_no', sad_no));
      if (error) throw error;
      toast({ title: 'Archived', description: `SAD ${sad_no} archived`, status: 'info' });
      await pushActivity(`Archived SAD ${sad_no}`);
      fetchSADs();
    } catch (err) {
      console.error('archiveSad', err);
      toast({ title: 'Archive failed', description: err?.message || 'Unexpected', status: 'error' });
    } finally {
      setArchiveOpen(false); setArchiveTarget(null);
    }
  };

  // --- DELETE SAD (admin) ---
  const requestDeleteSad = (sad_no) => { setDeleteTarget(sad_no); setDeleteOpen(true); };

  const confirmDeleteSad = async () => {
    const target = deleteTarget;
    setDeleteOpen(false);
    setDeleteTarget(null);
    if (!target) return;

    setLoading(true);
    try {
      // 1) Attempt to fetch the SAD row to get docs paths (best-effort)
      let sadRow = null;
      try {
        const res = await withRetries(() => supabase.from('sad_declarations').select('*').eq('sad_no', target).maybeSingle());
        if (!res?.error && res?.data) sadRow = res.data;
      } catch (e) {
        console.warn('could not fetch sad row before delete', e);
      }

      // 2) Remove attached documents from storage (best-effort)
      try {
        if (sadRow && Array.isArray(sadRow.docs) && sadRow.docs.length) {
          const paths = sadRow.docs.map(d => d.path).filter(Boolean);
          if (paths.length) {
            // Supabase storage remove expects array of paths
            const { error: rmErr } = await withRetries(() => supabase.storage.from(SAD_DOCS_BUCKET).remove(paths));
            if (rmErr) console.warn('could not remove some docs from storage', rmErr);
          }
        }
      } catch (e) {
        console.warn('error removing docs from storage', e);
      }

      // 3) Delete child tickets and reports_generated (best-effort)
      try {
        const { error: tErr } = await withRetries(() => supabase.from('tickets').delete().eq('sad_no', target));
        if (tErr) console.warn('could not delete tickets for sad', tErr);
      } catch (e) { console.warn('tickets delete error', e); }

      try {
        const { error: rErr } = await withRetries(() => supabase.from('reports_generated').delete().eq('sad_no', target));
        if (rErr) console.warn('could not delete reports_generated for sad', rErr);
      } catch (e) { console.warn('reports_generated delete error', e); }

      // 4) Delete the sad_declarations row
      const delRes = await withRetries(() => supabase.from('sad_declarations').delete().eq('sad_no', target));
      if (delRes?.error) throw delRes.error;

      await pushActivity(`Deleted SAD ${target}`);
      toast({ title: 'Deleted', description: `SAD ${target} has been deleted`, status: 'success' });
      fetchSADs();
    } catch (err) {
      console.error('confirmDeleteSad', err);
      toast({ title: 'Delete failed', description: err?.message || 'Could not delete SAD', status: 'error' });
      fetchSADs();
    } finally {
      setLoading(false);
    }
  };

  const exportSingleSAD = async (s) => {
    try {
      const rows = [{
        sad_no: s.sad_no,
        regime: s.regime,
        regime_label: REGIME_LABEL_MAP[s.regime] || '',
        declared_weight: s.declared_weight,
        total_recorded_weight: s.total_recorded_weight,
        status: s.status,
        created_at: s.created_at,
        updated_at: s.updated_at,
        completed_at: s.completed_at ?? '',
        docs: (s.docs || []).map(d => d.name || d.path).join('; '),
      }];
      exportToCSV(rows, `sad_${s.sad_no}_export.csv`);
      toast({ title: 'Export started', description: `SAD ${s.sad_no} exported`, status: 'success' });
      await pushActivity(`Exported SAD ${s.sad_no}`);
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
      await pushActivity(`Search: "${nlQuery}"`, filter);
    } catch (e) {
      console.error('NL query failed', e);
      toast({ title: 'Search failed', description: e?.message || 'Unexpected', status: 'error' });
    } finally { setNlLoading(false); }
  };

  // discrepancy helper
  const handleExplainDiscrepancy = async (s) => {
    const recorded = Number(s.total_recorded_weight || 0);
    const declared = Number(s.declared_weight || 0);
    if (!declared) {
      toast({ title: 'No declared weight', description: `SAD ${s.sad_no} has no declared weight to compare.`, status: 'warning' });
      await pushActivity(`Explain: no declared weight for ${s.sad_no}`);
      return;
    }
    const diff = recorded - declared;
    const pct = ((diff / declared) * 100).toFixed(2);
    let msg = '';
    if (Math.abs(diff) / Math.max(1, declared) < 0.01) {
      msg = `Recorded matches declared within 1% (${recorded} kg vs ${declared} kg).`;
    } else if (diff > 0) {
      msg = `Recorded is ${diff.toLocaleString()} kg (${pct}%) higher than declared — investigate extra tickets or duplicates.`;
    } else {
      msg = `Recorded is ${Math.abs(diff).toLocaleString()} kg (${Math.abs(pct)}%) lower than declared — check missing tickets or document mismatch.`;
    }
    toast({ title: `Discrepancy for ${s.sad_no}`, description: msg, status: 'info', duration: 10000 });
    await pushActivity(`Explained discrepancy for ${s.sad_no}: ${msg}`);
  };

  // generate printable report (iframe-based)
  const generatePdfReport = async (s) => {
    try {
      const trimmed = s.sad_no != null ? String(s.sad_no).trim() : s.sad_no;
      const ticketsRes = await withRetries(() => supabase.from('tickets').select('*').eq('sad_no', trimmed).order('date', { ascending: false }));
      const tickets = ticketsRes?.data ?? [];
      const declared = Number(s.declared_weight || 0);
      const recorded = Number(s.total_recorded_weight || 0);
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
            <p class="small">Status: ${s.status || '—'} | Created: ${s.created_at || '—'} | Completed: ${s.completed_at || '—'} | Created by: ${s.created_by ? (createdByMap[s.created_by] || '') : '—'}</p>
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
                  <td style="text-align:right">${Number(t.net ?? t.weight ?? 0).toLocaleString()}</td>
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
          catch (err) { document.body.removeChild(iframe); toast({ title: 'Print failed', description: 'Could not print report.', status: 'error' }); }
        };
      }
    } catch (err) {
      console.error('generatePdfReport', err);
      toast({ title: 'Report failed', description: err?.message || 'Could not generate report', status: 'error' });
    }
  };

  // ------------------- Transaction modal helpers -------------------
  const openTxnModal = async (sad) => {
    const trimmed = sad.sad_no != null ? String(sad.sad_no).trim() : sad.sad_no;
    setTxnModalSadNo(trimmed);
    setTxnModalLoading(true);
    setTxnModalOpen(true);
    try {
      const res = await withRetries(() =>
        supabase
          .from('tickets')
          .select('ticket_no, net, weight, gnsw_truck_no, date')
          .eq('sad_no', trimmed)
          .order('date', { ascending: false })
          .limit(1000)
      );

      if (res?.error) throw res.error;
      const tickets = res?.data ?? [];

      // classify manual vs uploaded
      const manual = (tickets || []).filter(t => /^M-/i.test(String(t.ticket_no || ''))).length;
      const uploaded = (tickets || []).filter(t => /^\d+/.test(String(t.ticket_no || ''))).length;
      const others = (tickets || []).length - manual - uploaded;

      setTxnCounts({ manual, uploaded, total: (tickets || []).length, others });
      setTxnModalTickets(tickets || []);
      await pushActivity(`Viewed transactions breakdown for ${trimmed}`);
    } catch (e) {
      console.error('openTxnModal failed', e);
      toast({ title: 'Could not load transactions', description: e?.message || 'Unexpected', status: 'error' });
      setTxnCounts({ manual: 0, uploaded: 0, total: 0, others: 0 });
      setTxnModalTickets([]);
    } finally {
      setTxnModalLoading(false);
    }
  };

  const closeTxnModal = () => {
    setTxnModalOpen(false);
    setTxnModalTickets([]);
    setTxnModalSadNo(null);
    setTxnCounts({ manual: 0, uploaded: 0, total: 0, others: 0 });
  };

  // UI derived values
  const anomalyResults = useMemo(() => {
    const ratios = sads.map(s => {
      const d = Number(s.declared_weight || 0);
      const r = Number(s.total_recorded_weight || 0);
      if (!d) return null;
      return r / d;
    }).filter(Boolean);
    if (!ratios.length) return { mean: 1, std: 0, flagged: [] };
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const variance = ratios.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / ratios.length;
    const std = Math.sqrt(variance);
    const flagged = [];
    for (const s of sads) {
      const d = Number(s.declared_weight || 0);
      const r = Number(s.total_recorded_weight || 0);
      if (!d) continue;
      const ratio = r / d;
      const z = std > 0 ? (ratio - mean) / std : 0;
      if (Math.abs(z) > 2 || ratio < 0.8 || ratio > 1.2) flagged.push({ sad: s, z, ratio });
    }
    return { mean, std, flagged };
  }, [sads]);

  const dashboardStats = useMemo(() => {
    const totalSADs = sads.length;
    const totalDeclared = sads.reduce((a, b) => a + Number(b.declared_weight || 0), 0);
    const totalRecorded = sads.reduce((a, b) => a + Number(b.total_recorded_weight || 0), 0);
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
      if (sortBy === 'declared_weight') return (Number(a.declared_weight || 0) - Number(b.declared_weight || 0)) * dir;
      if (sortBy === 'recorded') return (Number(a.total_recorded_weight || 0) - Number(b.total_recorded_weight || 0)) * dir;
      if (sortBy === 'discrepancy') {
        const da = Number(a.total_recorded_weight || 0) - Number(a.declared_weight || 0);
        const db = Number(b.total_recorded_weight || 0) - Number(b.declared_weight || 0);
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
      declared_weight: s.declared_weight,
      total_recorded_weight: s.total_recorded_weight,
      status: s.status,
      created_at: s.created_at,
      updated_at: s.updated_at,
      completed_at: s.completed_at ?? '',
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
        declared_weight: s.declared_weight,
        total_recorded_weight: s.total_recorded_weight,
        status: s.status,
        created_at: s.created_at,
        updated_at: s.updated_at,
        completed_at: s.completed_at ?? '',
      }));
      if (!rows.length) { toast({ title: 'No data', description: 'Nothing to backup', status: 'info' }); return; }
      const csv = [
        Object.keys(rows[0] || {}).join(','),
        ...rows.map(r => Object.values(r).map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')),
      ].join('\n');
      const filename = `backup/sad_declarations_backup_${new Date().toISOString().slice(0,10)}.csv`;
      const blob = new Blob([csv], { type: 'text/csv' });
      const { error } = await withRetries(() => supabase.storage.from(SAD_DOCS_BUCKET).upload(filename, blob, { upsert: true }));
      if (error) throw error;
      await pushActivity('Manual backup uploaded', { path: filename });
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

/* reuse the AgentSAD tx-badge look */
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
  display:inline-flex;
  flex-direction:column;
  align-items:center;
  gap:4px;
}
.tx-sub { font-size: 11px; opacity: 0.95; display:block; margin-top:2px; color: rgba(255,255,255,0.95); font-weight:600; }

/* fallback txn-pill (kept for any places still referencing it) */
.txn-pill {
  display:inline-flex;
  align-items:center;
  gap:8px;
  padding:6px 10px;
  border-radius:999px;
  background: linear-gradient(90deg,#0ea5a0, #06b6d4);
  color: #fff;
  font-weight: 700;
  box-shadow: 0 8px 24px rgba(6,182,212,0.12);
  cursor: pointer;
  transition: transform .12s ease, box-shadow .12s ease, opacity .12s ease;
}
.txn-pill:hover { transform: translateY(-2px); box-shadow: 0 16px 40px rgba(6,182,212,0.18); opacity: 0.98; }

/* luxury modal style override (kept mostly for other modals) */
.lux-modal .chakra-modal__content {
  border-radius: 16px;
  padding: 0;
  overflow: hidden;
  background: linear-gradient(180deg, #ffffff, #fbfdff);
  box-shadow: 0 30px 80px rgba(2,6,23,0.12);
}
.lux-modal .modal-header {
  padding: 18px 20px;
  background: linear-gradient(90deg,#7b61ff,#3ef4d0);
  color: white;
  display:flex;
  align-items:center;
  gap:12px;
}
.lux-modal .modal-body {
  padding: 18px;
}
.lux-modal .modal-footer { padding: 12px 18px; }

/* pill badges inside modal */
.txn-badge {
  border-radius: 10px;
  padding: 8px 12px;
  display:inline-flex;
  align-items:center;
  gap:8px;
  box-shadow: 0 6px 20px rgba(2,6,23,0.06);
  background: #fff;
}

/* small dashed dropzone look for edit modal */
.edit-dropzone {
  border: 2px dashed rgba(7,17,25,0.08);
  border-radius: 10px;
  padding: 12px;
  display:flex;
  gap:12px;
  align-items:center;
  justify-content:space-between;
  background: linear-gradient(90deg, rgba(99,102,241,0.02), rgba(6,182,212,0.02));
}

/* file thumbnail row */
.file-thumb {
  display:flex;
  gap:8px;
  align-items:center;
}

/* responsive */
@media (max-width:780px) {
  .table thead { display:none; }
  .table tbody tr { display:block; background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(255,255,255,0.96)); margin-bottom:14px; border-radius:14px; padding:12px; box-shadow: 0 8px 24px rgba(2,6,23,0.04);}
  .table tbody td { display:block; text-align:left; padding:8px 0; border: none; }
  .table tbody td::before { content: attr(data-label); display:inline-block; width:130px; font-weight:700; color:var(--muted); }
}

/* orb CTA */
.orb-cta {
  position:fixed; right:28px; bottom:28px; z-index:2400;
  width:72px;height:72px;border-radius:999px;background:linear-gradient(90deg,#7b61ff,#3ef4d0); color:#fff; cursor:pointer;
  display:flex;align-items:center;justify-content:center;font-size:20px; box-shadow: 0 12px 30px rgba(63,94,251,0.18);
}
.orb-cta:hover { transform: translateY(-4px) scale(1.03); transition: transform .18s ease; }
`;

  const RowMotion = motion(Tr);
  const createDisabled = !isRegistrationValid();

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
        <Text fontWeight="semibold" mb={2}>Register a new SAD (all fields mandatory)</Text>
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
            <Text fontSize="sm" color="gray.500" mt={1}>{docs.length} file(s) selected</Text>
          </FormControl>
        </SimpleGrid>

        <HStack mt={3}>
          <Button colorScheme="teal" leftIcon={<FaPlus />} onClick={handleCreateSAD} isLoading={loading} type="button" isDisabled={createDisabled}>Register SAD</Button>
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
                  const discrepancy = Number(s.total_recorded_weight || 0) - Number(s.declared_weight || 0);
                  let discColor = 'green.600';
                  if (discrepancy > 0) discColor = 'red.600';
                  else if (discrepancy < 0) discColor = 'blue.600';
                  else discColor = 'green.600';

                  const color = (s.status === 'Completed' ? 'green.400' : s.status === 'In Progress' ? 'red.400' : s.status === 'On Hold' ? 'yellow.400' : 'gray.400');
                  const readyToComplete = Number(s.total_recorded_weight || 0) >= Number(s.declared_weight || 0) && s.status !== 'Completed';
                  const regimeDisplay = REGIME_LABEL_MAP[s.regime] ? `${s.regime}` : (s.regime || '—'); // show code

                  const editLocked = s.status === 'Completed' && !isAdmin;

                  return (
                    <RowMotion key={s.sad_no || Math.random()} {...MOTION_ROW} style={{ background: 'transparent' }}>
                      <Td data-label="SAD"><Text fontWeight="bold">{s.sad_no}</Text></Td>
                      <Td data-label="Regime"><Text>{regimeDisplay}</Text></Td>
                      <Td data-label="Declared" isNumeric><Text>{Number(s.declared_weight || 0).toLocaleString()}</Text></Td>
                      <Td data-label="Discharged" isNumeric><Text>{Number(s.total_recorded_weight || 0).toLocaleString()}</Text></Td>

                      {/* Upgraded Number of Transactions cell (AgentSAD look) */}
                      <Td data-label="No. of Transactions" isNumeric>
                        <Tooltip label="Click to view breakdown (manual vs uploaded)" placement="top" openDelay={150}>
                          <Button
                            variant="ghost"
                            onClick={() => openTxnModal(s)}
                            aria-label={`View transactions for ${s.sad_no}`}
                            title="View transactions breakdown"
                            style={{ padding: 0 }}
                          >
                            <Box className="tx-badge">
                              <span style={{ fontSize: 14 }}>{Number(s.ticket_count || 0).toLocaleString()}</span>
                              <span className="tx-sub">transactions</span>
                            </Box>
                          </Button>
                        </Tooltip>
                      </Td>

                      <Td data-label="Status">
                        <VStack align="start" spacing={1}>
                          <HStack>
                            <Box width="10px" height="10px" borderRadius="full" bg={color} />
                            <Text color={color} fontWeight="medium">{s.status}</Text>
                          </HStack>
                        </VStack>
                      </Td>
                      <Td data-label="Discrepancy">
                        <Text color={discColor} fontWeight="bold">
                          {discrepancy === 0 ? '0' : discrepancy.toLocaleString()}
                        </Text>
                      </Td>
                      <Td data-label="Actions">
                        <HStack>
                          <Menu>
                            <MenuButton as={IconButton} aria-label="Actions" icon={<FaEllipsisV />} size="sm" />
                            <MenuList>
                              <MenuItem icon={<FaEye />} onClick={() => openDetailsModal(s)}>View Details</MenuItem>
                              <MenuItem icon={<FaFileAlt />} onClick={() => openDocsModal(s)}>View Docs</MenuItem>

                              <Tooltip label={editLocked ? 'Only admins can edit completed SADs' : 'Edit SAD'} placement="left" closeOnClick={false}>
                                <Box>
                                  <MenuItem
                                    icon={<FaEdit />}
                                    onClick={() => openEditModal(s)}
                                    isDisabled={editLocked}
                                  >
                                    Edit
                                  </MenuItem>
                                </Box>
                              </Tooltip>

                              <MenuItem icon={<FaRedoAlt />} onClick={() => recalcTotalForSad(s.sad_no)}>Recalc Totals</MenuItem>
                              {readyToComplete && <MenuItem icon={<FaCheck />} onClick={() => requestMarkCompleted(s.sad_no)}>Mark as Completed</MenuItem>}
                              <MenuItem onClick={() => handleExplainDiscrepancy(s)}>Explain discrepancy</MenuItem>
                              <MenuItem icon={<FaFilePdf />} onClick={() => generatePdfReport(s)}>Print / Save PDF</MenuItem>
                              <MenuItem icon={<FaFileExport />} onClick={() => exportSingleSAD(s)}>Export CSV</MenuItem>
                              <MenuDivider />
                              <MenuItem icon={<FaTrashAlt />} onClick={() => { setArchiveTarget(s.sad_no); setArchiveOpen(true); }}>Archive SAD</MenuItem>
                              <MenuItem icon={<FaTrashAlt />} onClick={() => requestDeleteSad(s.sad_no)} style={{ color: '#b91c1c' }}>Delete SAD</MenuItem>
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
        )}
      </Box>

      {/* Transactions modal — matches AgentSAD style */}
      <Modal isOpen={txnModalOpen} onClose={closeTxnModal} isCentered size="md" motionPreset="scale">
        <ModalOverlay />
        <ModalContent borderRadius="12px" padding={0}>
          <ModalHeader>Transactions — {txnModalSadNo}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {txnModalLoading ? (
              <Flex align="center" justify="center" py={8}><Spinner /></Flex>
            ) : (
              <>
                <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3} mb={4}>
                  <Box p={4} borderRadius="md" bg="linear-gradient(90deg,#111827,#6d28d9)" color="white" boxShadow="sm">
                    <Text fontSize="sm" opacity={0.9}>Manual tickets</Text>
                    <Text fontSize="2xl" fontWeight="700" mt={2}>{txnCounts.manual.toLocaleString()}</Text>
                    <Text fontSize="xs" mt={1} opacity={0.85}>Start with <code>M-</code></Text>
                  </Box>

                  <Box p={4} borderRadius="md" bg="linear-gradient(90deg,#06b6d4,#0ea5a0)" color="white" boxShadow="sm">
                    <Text fontSize="sm" opacity={0.9}>Uploaded (numeric)</Text>
                    <Text fontSize="2xl" fontWeight="700" mt={2}>{txnCounts.uploaded.toLocaleString()}</Text>
                    <Text fontSize="xs" mt={1} opacity={0.85}>Starts with numbers</Text>
                  </Box>
                </SimpleGrid>

                <Box mb={3}>
                  <Text fontSize="sm" color="gray.600">Total transactions: <strong>{txnCounts.total.toLocaleString()}</strong></Text>
                </Box>

                <Box mb={2}>
                  <Text fontSize="sm" mb={2} fontWeight="semibold">Recent / sample tickets</Text>
                  {txnModalTickets && txnModalTickets.length ? (
                    <Box maxH="260px" overflowY="auto" border="1px solid" borderColor="gray.100" borderRadius="md" p={2}>
                      <Table size="sm">
                        <Thead>
                          <Tr><Th>Ticket</Th><Th>Truck</Th><Th isNumeric>Net</Th></Tr>
                        </Thead>
                        <Tbody>
                          {txnModalTickets.slice(0, 200).map((t, i) => (
                            <Tr key={`${t.ticket_no || 't'}-${i}`}>
                              <Td style={{ maxWidth: 160, overflowWrap: 'break-word' }}>{t.ticket_no}</Td>
                              <Td>{t.gnsw_truck_no || '—'}</Td>
                              <Td isNumeric>{Number(t.net ?? t.weight ?? 0).toLocaleString()}</Td>
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
            <Button variant="ghost" onClick={closeTxnModal}>Close</Button>
            <Button colorScheme="teal" ml={3} onClick={() => {
              // convenience: open details modal for the same SAD
              if (txnModalSadNo) {
                const match = sads.find(x => x.sad_no === txnModalSadNo);
                if (match) openDetailsModal(match);
                closeTxnModal();
              }
            }}>Open SAD Details</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Details modal */}
      <Modal isOpen={detailsOpen} onClose={() => setDetailsOpen(false)} size="xl" scrollBehavior="inside">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Details — SAD {detailsData?.sad?.sad_no}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {detailsData?.loading ? <Spinner /> : (
              <>
                {detailsData.sad ? (
                  <>
                    <Text mb={2}>Declared weight: <strong>{Number(detailsData.sad.declared_weight || 0).toLocaleString()} kg</strong></Text>
                    <Text mb={2}>Discharged weight: <strong>{Number(detailsData.sad.total_recorded_weight || 0).toLocaleString()} kg</strong></Text>

                    {/* show colored discrepancy */}
                    {(() => {
                      const recorded = Number(detailsData.sad.total_recorded_weight || 0);
                      const declared = Number(detailsData.sad.declared_weight || 0);
                      const diff = recorded - declared;
                      let color = 'green.600';
                      if (diff > 0) color = 'red.600';
                      else if (diff < 0) color = 'blue.600';
                      else color = 'green.600';
                      return (
                        <Text mb={3} color={color} fontWeight="bold">
                          Discrepancy: {diff === 0 ? '0' : diff.toLocaleString()} kg
                        </Text>
                      );
                    })()}

                    <Text mb={2}>Status: <strong>{detailsData.sad.status}</strong></Text>
                    <Text mb={2}>Created At: <strong>{detailsData.sad.created_at ? new Date(detailsData.sad.created_at).toLocaleString() : '—'}</strong></Text>
                    <Text mb={2}>Completed At: <strong>{detailsData.sad.completed_at ? new Date(detailsData.sad.completed_at).toLocaleString() : 'Not recorded'}</strong></Text>
                    <Text mb={4}>Created By: <strong>{detailsData.created_by_username || (detailsData.sad && detailsData.sad.created_by ? (createdByMap[detailsData.sad.created_by] || detailsData.sad.created_by) : '—')}</strong></Text>

                    <Heading size="sm" mb={2}>Tickets for this SAD</Heading>
                    {detailsData.tickets && detailsData.tickets.length ? (
                      <Table size="sm">
                        <Thead><Tr><Th>Ticket</Th><Th>Truck</Th><Th isNumeric>Net (kg)</Th><Th>Date</Th></Tr></Thead>
                        <Tbody>
                          {detailsData.tickets.map(t => (
                            <Tr key={t.ticket_id || t.ticket_no}>
                              <Td>{t.ticket_no}</Td>
                              <Td>{t.gnsw_truck_no || t.truck_no || '—'}</Td>
                              <Td isNumeric>{Number(t.net ?? t.weight ?? 0).toLocaleString()}</Td>
                              <Td>{t.date ? new Date(t.date).toLocaleString() : '—'}</Td>
                            </Tr>
                          ))}
                        </Tbody>
                      </Table>
                    ) : <Text>No tickets recorded.</Text>}
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

      {/* SAD detail modal (existing) */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} size="xl" scrollBehavior="inside">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>SAD {selectedSad?.sad_no}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {selectedSad && (
              <>
                <Text mb={2}>Declared weight: <strong>{Number(selectedSad.declared_weight || 0).toLocaleString()} kg</strong></Text>
                <Text mb={2}>Discharged weight: <strong>{Number(selectedSad.total_recorded_weight || 0).toLocaleString()}</strong></Text>

                {/* discrepancy colored */}
                {(() => {
                  const recorded = Number(selectedSad.total_recorded_weight || 0);
                  const declared = Number(selectedSad.declared_weight || 0);
                  const diff = recorded - declared;
                  let color = 'green.600';
                  if (diff > 0) color = 'red.600';
                  else if (diff < 0) color = 'blue.600';
                  else color = 'green.600';
                  return (
                    <Text mb={3} color={color} fontWeight="bold">
                      Discrepancy: {diff === 0 ? '0' : diff.toLocaleString()} kg
                    </Text>
                  );
                })()}

                <Text mb={2}># Transactions: <strong>{Number(selectedSad.ticket_count || 0).toLocaleString()}</strong></Text>
                <Text mb={4}>Status: <strong>{selectedSad.status}</strong></Text>

                <Heading size="sm" mb={2}>Tickets for this SAD</Heading>
                {detailLoading ? <Text>Loading...</Text> : (
                  <Table size="sm">
                    <Thead>
                      <Tr><Th>Ticket</Th><Th>Truck</Th><Th isNumeric>Net (kg)</Th><Th>Date</Th></Tr>
                    </Thead>
                    <Tbody>
                      {detailTickets.map(t => (
                        <Tr key={t.ticket_id || t.ticket_no}>
                          <Td>{t.ticket_no}</Td>
                          <Td>{t.gnsw_truck_no}</Td>
                          <Td isNumeric>{Number(t.net ?? t.weight ?? 0).toLocaleString()}</Td>
                          <Td>{t.date ? new Date(t.date).toLocaleString() : '—'}</Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                )}
              </>
            )}
          </ModalBody>
          <ModalFooter>
            <Button onClick={() => setIsModalOpen(false)} type="button">Close</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Edit modal (enhanced & restyled to match AgentSAD) */}
      <Modal isOpen={editModalOpen} onClose={closeEditModal} size="lg" isCentered>
        <ModalOverlay />
        <ModalContent borderRadius="12px" maxW="900px" overflow="hidden">
          <ModalHeader>Edit SAD — {editModalData?.original_sad_no}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {editModalData ? (
              <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                {/* LEFT: Regime, Declared weight, Existing docs */}
                <Box>
                  <FormControl>
                    <FormLabel>SAD Number</FormLabel>
                    <Input
                      value={editModalData.sad_no}
                      onChange={(e) => setEditModalData(d => ({ ...d, sad_no: e.target.value }))}
                      isDisabled={!!(editModalData.status === 'Completed' && !isAdmin)}
                    />
                    <Text fontSize="xs" color="gray.500" mt={2}>Changing SAD number will update child tickets and generated reports (best-effort).</Text>
                  </FormControl>

                  <FormControl mt={3}>
                    <FormLabel>Regime</FormLabel>
                    <Select value={editModalData.regime} onChange={(e) => setEditModalData(d => ({ ...d, regime: e.target.value }))} isDisabled={!!(editModalData.status === 'Completed' && !isAdmin)}>
                      <option value="">Select regime</option>
                      {REGIME_OPTIONS.map(code => (
                        <option key={code} value={code}>
                          {REGIME_LABEL_MAP[code] ? `${REGIME_LABEL_MAP[code]} (${code})` : code}
                        </option>
                      ))}
                    </Select>
                  </FormControl>

                  <FormControl mt={3}>
                    <FormLabel>Declared Weight (kg)</FormLabel>
                    <Input type="text" value={formatNumber(editModalData.declared_weight)} onChange={(e) => setEditModalData(d => ({ ...d, declared_weight: parseNumberString(e.target.value) }))} isDisabled={!!(editModalData.status === 'Completed' && !isAdmin)} />
                  </FormControl>

                  <FormControl mt={3}>
                    <FormLabel>Status</FormLabel>
                    <Select value={editModalData.status} onChange={(e) => setEditModalData(d => ({ ...d, status: e.target.value }))} isDisabled={!!(editModalData.status === 'Completed' && !isAdmin)}>
                      {SAD_STATUS.map(st => <option key={st} value={st}>{st}</option>)}
                    </Select>
                  </FormControl>

                  <Box mt={4}>
                    <Text fontSize="sm" mb={2}>Existing documents</Text>
                    {editModalDocs && editModalDocs.length ? (
                      <Box mb={2} borderRadius="md" p={2} border="1px solid" borderColor="gray.100">
                        <VStack align="stretch" spacing={2}>
                          {editModalDocs.map((d, i) => (
                            <HStack key={i} className="file-thumb" justifyContent="space-between" bg="gray.50" p={2} borderRadius="md">
                              <HStack>
                                {d.url && /\.(png|jpe?g|gif|webp|svg)$/i.test(d.name || d.path || d.url) ? (
                                  <Avatar size="sm" src={d.url} name={d.name || 'file'} />
                                ) : (
                                  <Box width="36px" height="36px" borderRadius="6px" display="flex" alignItems="center" justifyContent="center" bg="gray.200"><FaFileAlt /></Box>
                                )}
                                <Box>
                                  <Text fontSize="sm" fontWeight="semibold" maxW="280px" isTruncated>{d.name || d.path}</Text>
                                  <Text fontSize="xs" color="gray.500">{d.path || ''}</Text>
                                </Box>
                              </HStack>

                              <HStack>
                                <Button size="sm" onClick={() => { if (d.url) window.open(d.url, '_blank'); else toast({ title: 'No URL', status: 'info' }); }} isDisabled={!!(editModalData.status === 'Completed' && !isAdmin)}>Open</Button>
                                <Button size="sm" variant="ghost" onClick={() => removeDocFromEditModal(i)} isDisabled={!!(editModalData.status === 'Completed' && !isAdmin)}>Remove</Button>
                              </HStack>
                            </HStack>
                          ))}
                        </VStack>
                      </Box>
                    ) : <Text color="gray.500">No attached documents.</Text>}
                  </Box>
                </Box>

                {/* RIGHT: Upload dropzone + queued files */}
                <Box>
                  <FormControl>
                    <FormLabel>Attach / Upload documents</FormLabel>

                    <Box
                      className="edit-dropzone"
                      onDrop={handleEditDrop}
                      onDragOver={handleEditDragOver}
                      onClick={() => {
                        if (editModalData.status === 'Completed' && !isAdmin) {
                          toast({ title: 'Upload blocked', description: 'Only admins can add files to a Completed SAD.', status: 'warning' });
                          return;
                        }
                        editFileInputRef.current && editFileInputRef.current.click();
                      }}
                      role="button"
                    >
                      <Box>
                        <Text fontWeight="semibold">Drag & drop files here, or click to browse</Text>
                        <Text fontSize="sm" color="gray.500" mt={1}>PDF, JPG, PNG — each file will be uploaded to storage and attached to this SAD.</Text>
                      </Box>

                      <Box>
                        <Badge variant="subtle" colorScheme="purple" mr={2}>Fast upload</Badge>
                        <Badge variant="subtle" colorScheme="green">{editModalNewFiles.length} queued</Badge>
                      </Box>

                      {/* hidden input */}
                      <input
                        ref={editFileInputRef}
                        type="file"
                        multiple
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          if (editModalData.status === 'Completed' && !isAdmin) {
                            toast({ title: 'Upload blocked', description: 'Only admins can add files to a Completed SAD.', status: 'warning' });
                            return;
                          }
                          const arr = Array.from(e.target.files || []);
                          onEditFilesSelected(arr);
                        }}
                        aria-label="Upload files for SAD"
                      />
                    </Box>

                    {/* preview of newly selected files */}
                    {editModalNewFiles && editModalNewFiles.length > 0 && (
                      <Box mt={3} border="1px solid" borderColor="gray.100" borderRadius="md" p={2}>
                        <Text fontSize="sm" mb={2}>Files to upload</Text>
                        <VStack align="stretch" spacing={2}>
                          {editModalNewFiles.map((f, idx) => (
                            <HStack key={`${f.name}-${idx}`} justifyContent="space-between" bg="gray.50" p={2} borderRadius="md">
                              <HStack>
                                {/\.(png|jpe?g|gif|webp|svg)$/i.test(f.name) ? (
                                  <Avatar size="sm" src={URL.createObjectURL(f)} name={f.name} />
                                ) : (
                                  <Box width="36px" height="36px" borderRadius="6px" display="flex" alignItems="center" justifyContent="center" bg="gray.200"><FaFileAlt /></Box>
                                )}
                                <Box>
                                  <Text fontSize="sm" fontWeight="semibold" maxW="280px" isTruncated>{f.name}</Text>
                                  <Text fontSize="xs" color="gray.500">{(f.size / 1024).toFixed(1)} KB • {f.type || 'file'}</Text>
                                </Box>
                              </HStack>
                              <HStack>
                                <Button size="sm" variant="ghost" onClick={() => setEditModalNewFiles(prev => prev.filter((_, i) => i !== idx))}>Remove</Button>
                              </HStack>
                            </HStack>
                          ))}
                        </VStack>
                      </Box>
                    )}
                  </FormControl>
                </Box>
              </SimpleGrid>
            ) : <Text>Loading...</Text>}
          </ModalBody>

          <ModalFooter>
            <Button variant="ghost" onClick={closeEditModal} type="button">Cancel</Button>
            <Button
              colorScheme="teal"
              ml={3}
              onClick={() => setConfirmSaveOpen(true)}
              type="button"
              isLoading={editUploading}
              isDisabled={!!(editModalData?.status === 'Completed' && !isAdmin)}
              title={editModalData?.status === 'Completed' && !isAdmin ? 'Only admins can save changes to a Completed SAD' : 'Save changes'}
            >
              Save changes
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Confirm Save */}
      <AlertDialog isOpen={confirmSaveOpen} leastDestructiveRef={confirmSaveCancelRef} onClose={() => setConfirmSaveOpen(false)}>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">Confirm Save</AlertDialogHeader>
            <AlertDialogBody>Are you sure you want to save changes to SAD {editModalData?.original_sad_no}?</AlertDialogBody>
            <AlertDialogFooter>
              <Button ref={confirmSaveCancelRef} onClick={() => setConfirmSaveOpen(false)} type="button">Cancel</Button>
              <Button colorScheme="red" onClick={saveEditModal} ml={3} type="button">Yes, Save</Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

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

      {/* Delete confirm */}
      <AlertDialog isOpen={deleteOpen} leastDestructiveRef={deleteCancelRef} onClose={() => setDeleteOpen(false)}>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">Delete SAD</AlertDialogHeader>
            <AlertDialogBody>Are you absolutely sure you want to permanently delete SAD {deleteTarget}? This will remove the SAD row and associated tickets/reports (best-effort). This action cannot be undone.</AlertDialogBody>
            <AlertDialogFooter>
              <Button ref={deleteCancelRef} onClick={() => setDeleteOpen(false)} type="button">Cancel</Button>
              <Button colorScheme="red" onClick={confirmDeleteSad} ml={3} type="button">Yes, delete</Button>
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
              <Box><Text fontWeight="bold">Create New SAD</Text><Text fontSize="sm" color="gray.500">Holographic registration (all fields mandatory)</Text></Box>
            </Flex>
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
              <FormControl isRequired><FormLabel>SAD Number</FormLabel><Input value={sadNo} onChange={(e) => setSadNo(e.target.value)} /></FormControl>
              <FormControl isRequired><FormLabel>Regime</FormLabel><Select placeholder="Select regime" value={regime} onChange={(e) => setRegime(e.target.value)}>{REGIME_OPTIONS.map(code => <option key={code} value={code}>{REGIME_LABEL_MAP[code] ? `${REGIME_LABEL_MAP[code]} (${code})` : code}</option>)}</Select></FormControl>
              <FormControl isRequired><FormLabel>Declared Weight (kg)</FormLabel><Input type="text" value={formatNumber(declaredWeight)} onChange={(e) => setDeclaredWeight(parseNumberString(e.target.value))} /></FormControl>
              <FormControl isRequired><FormLabel>Attach Documents</FormLabel><Input type="file" multiple onChange={(e) => { const arr = Array.from(e.target.files || []); setDocs(arr); toast({ title: 'Files attached', description: `${arr.length} file(s) attached`, status: 'info' }); }} /><Text fontSize="sm" color="gray.500" mt={1}>{docs.length} file(s) selected</Text></FormControl>
            </SimpleGrid>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={closeOrb}>Cancel</Button>
            <Button colorScheme="teal" ml={3} onClick={handleCreateSAD} isLoading={loading} isDisabled={createDisabled}>Create SAD</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Container>
  );
}
