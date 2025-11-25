// src/pages/SADDeclaration.jsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Box, Button, Container, Heading, Input, SimpleGrid, FormControl, FormLabel, Select,
  Text, Table, Thead, Tbody, Tr, Th, Td, VStack, HStack, useToast, Modal, ModalOverlay,
  ModalContent, ModalHeader, ModalBody, ModalFooter, ModalCloseButton, IconButton, Flex,
  Spinner, Tag, TagLabel, Stat, StatLabel, StatNumber, StatHelpText,
  Menu, MenuButton, MenuList, MenuItem, MenuDivider, AlertDialog, AlertDialogOverlay,
  AlertDialogContent, AlertDialogHeader, AlertDialogBody, AlertDialogFooter, useDisclosure,
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
  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);
  const confirmSaveCancelRef = useRef();

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

  // orb CTA
  const { isOpen: orbOpen, onOpen: openOrb, onClose: closeOrb } = useDisclosure();

  // map of created_by -> username for showing who created SADs
  const createdByMapRef = useRef({});
  const createdByMap = createdByMapRef.current;

  // ensure created_at sorting keeps newest first if sortBy is created_at
  useEffect(() => {
    if (sortBy === 'created_at' && sortDir !== 'asc') {
      setSortDir('asc');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy]);

  // ----- fetchSADs -----
  const fetchSADs = async (filter = null) => {
    setLoading(true);
    try {
      // when talking to DB, regime values are the codes (IM4/EX1/IM7)
      let q = supabase.from('sad_declarations').select('*').order('created_at', { ascending: false });
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
          total_recorded_weight: Number(r.total_recorded_weight ?? 0),
          ticket_count: 0,
          manual_update: r.manual_update ?? false,
          completed_at: r.completed_at ?? null, // include completed_at here
        };
      });

      // get counts per sad
      const sadNos = Array.from(new Set(normalized.map((s) => (s.sad_no ? String(s.sad_no).trim() : null)).filter(Boolean)));
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
            const { data: usersData } = await supabase.from('users').select('id, username, email').in('id', unresolved);
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

      setSads(enhanced);
    } catch (err) {
      console.error('fetchSADs', err);
      toast({ title: 'Failed to load SADs', description: err?.message || 'Unexpected', status: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // lifecycle: load + realtime
  useEffect(() => {
    try {
      const raw = localStorage.getItem('sad_activity');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setActivity(parsed);
      }
    } catch (e) { /* ignore */ }

    fetchSADs();

    try {
      if (supabase.channel) {
        const ch = supabase.channel('public:sad_declarations')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'sad_declarations' }, () => fetchSADs())
          .subscribe();
        subRef.current = ch;
      } else {
        const s = supabase.from('sad_declarations').on('*', () => { fetchSADs(); }).subscribe();
        subRef.current = s;
      }
    } catch (e) { /* ignore */ }

    try {
      if (supabase.channel) {
        const tch = supabase.channel('public:tickets')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => fetchSADs())
          .subscribe();
        ticketsSubRef.current = tch;
      }
    } catch (e) { /* ignore */ }

    return () => {
      try { if (subRef.current && supabase.removeChannel) supabase.removeChannel(subRef.current).catch(() => {}); } catch (e) {}
      try { if (ticketsSubRef.current && supabase.removeChannel) supabase.removeChannel(ticketsSubRef.current).catch(() => {}); } catch (e) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      await pushActivity(`Uploaded doc ${f.name} for SAD ${sad_no}`, { sad_no, file: f.name });
    }
    return uploaded;
  };

  // create SAD - now storing regime as code (IM4/EX1/IM7)
  const handleCreateSAD = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!sadNo || !declaredWeight) {
      toast({ title: 'Missing values', description: 'Provide SAD number and declared weight', status: 'warning' });
      return;
    }
    setLoading(true);
    try {
      const currentUser = (supabase.auth && supabase.auth.getUser) ? (await supabase.auth.getUser()).data?.user : (supabase.auth && supabase.auth.user ? supabase.auth.user() : null);
      const docRecords = await uploadDocs(sadNo, docs);
      const trimmedSad = String(sadNo).trim();

      // regime conversion if user typed a word
      let regimeCode = regime;
      if (!regimeCode && typeof regime === 'string') {
        const low = regime.trim().toLowerCase();
        if (WORD_TO_CODE[low]) regimeCode = WORD_TO_CODE[low];
      }

      const payload = {
        sad_no: trimmedSad,
        regime: regimeCode || null,
        declared_weight: Number(parseNumberString(declaredWeight) || 0),
        docs: docRecords,
        status: 'In Progress',
        manual_update: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        completed_at: null, // ensure created with null completed_at
      };
      if (currentUser && currentUser.id) payload.created_by = currentUser.id;

      const { error } = await supabase.from('sad_declarations').insert([payload]);
      if (error) throw error;

      if (currentUser && currentUser.id) {
        const uname = (currentUser.user_metadata && currentUser.user_metadata.full_name) || currentUser.email || '';
        if (uname) createdByMapRef.current = { ...createdByMapRef.current, [currentUser.id]: uname };
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
      const { data: sadRow, error: sadErr } = await supabase.from('sad_declarations').select('*').eq('sad_no', trimmed).maybeSingle();
      if (sadErr) console.warn('could not fetch sad_row for openSadDetail', sadErr);

      const { data, error } = await supabase.from('tickets').select('*').eq('sad_no', trimmed).order('date', { ascending: false });
      if (error) throw error;
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
      const { data: sadRow, error: sadErr } = await supabase.from('sad_declarations').select('*').eq('sad_no', trimmed).maybeSingle();
      if (sadErr) {
        console.warn('openDetailsModal: could not fetch sad row', sadErr);
      }

      const { data: tickets, error } = await supabase.from('tickets').select('*').eq('sad_no', trimmed).order('date', { ascending: false });
      if (!error) {
        let createdByUsername = sad.created_by_username || null;
        if (!createdByUsername && sadRow && sadRow.created_by) {
          try {
            const { data: u } = await supabase.from('users').select('id, username, email').eq('id', sadRow.created_by).maybeSingle();
            if (u) {
              createdByMapRef.current = { ...createdByMapRef.current, [u.id]: u.username || u.email || null };
              createdByUsername = u.username || u.email || null;
            }
          } catch (e) { /* ignore */ }
        }

        setDetailsData({ sad: sadRow || sad, tickets: tickets || [], created_by_username: createdByUsername, loading: false });
      } else {
        setDetailsData((d) => ({ ...d, tickets: [], loading: false }));
      }
    } catch (err) {
      console.error('openDetailsModal', err);
      setDetailsData((d) => ({ ...d, tickets: [], loading: false }));
      toast({ title: 'Failed', description: 'Could not load details', status: 'error' });
    }
  };

  // edit modal open
  const openEditModal = (sad) => {
    setEditModalData({
      original_sad_no: sad.sad_no,
      sad_no: sad.sad_no,
      regime: sad.regime ?? '',
      declared_weight: String(sad.declared_weight ?? ''),
      status: sad.status ?? 'In Progress',
    });
    setEditModalOpen(true);
  };
  const closeEditModal = () => { setEditModalOpen(false); setEditModalData(null); };

  // save edit modal (handles renaming and regime/code changes) - ensure completed_at is set/cleared appropriately
  const saveEditModal = async () => {
    if (!editModalData || !editModalData.original_sad_no) return;
    const originalSad = editModalData.original_sad_no;
    const newSad = String(editModalData.sad_no ?? '').trim();
    const before = (sadsRef.current || []).find(s => s.sad_no === originalSad) || {};
    const declaredParsed = Number(parseNumberString(editModalData.declared_weight) || 0);

    // optimistic UI update
    const optimisticCompletedAt = editModalData.status === 'Completed' ? (before.completed_at || new Date().toISOString()) : null;
    setSads(prev => prev.map(s => (s.sad_no === originalSad ? { ...s, sad_no: newSad, regime: editModalData.regime, declared_weight: declaredParsed, status: editModalData.status, updated_at: new Date().toISOString(), completed_at: optimisticCompletedAt } : s)));
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

      if (newSad !== originalSad) {
        const { data: conflict } = await supabase.from('sad_declarations').select('sad_no').eq('sad_no', newSad).maybeSingle();
        if (conflict) {
          throw new Error(`SAD number "${newSad}" already exists. Choose another.`);
        }

        // update child tables first: tickets, reports_generated
        const { error: tErr } = await supabase.from('tickets').update({ sad_no: newSad }).eq('sad_no', originalSad);
        if (tErr) console.warn('tickets update returned error', tErr);

        const { error: rErr } = await supabase.from('reports_generated').update({ sad_no: newSad }).eq('sad_no', originalSad);
        if (rErr) console.warn('reports_generated update returned error', rErr);

        // now update the parent SAD row
        const { error: parentErr } = await supabase.from('sad_declarations').update({
          sad_no: newSad,
          regime: regimeToSave ?? null,
          declared_weight: declaredParsed,
          status: editModalData.status ?? null,
          updated_at: new Date().toISOString(),
          manual_update: true,
          completed_at: completedAtValue,
        }).eq('sad_no', originalSad);
        if (parentErr) {
          // attempt rollback children updates to originalSad (best-effort)
          try { await supabase.from('tickets').update({ sad_no: originalSad }).eq('sad_no', newSad); } catch (e) { /* ignore */ }
          try { await supabase.from('reports_generated').update({ sad_no: originalSad }).eq('sad_no', newSad); } catch (e) { /* ignore */ }
          throw parentErr;
        }
      } else {
        // same sad_no -> simple update
        const { error } = await supabase.from('sad_declarations').update({
          regime: regimeToSave ?? null,
          declared_weight: declaredParsed,
          status: editModalData.status ?? null,
          updated_at: new Date().toISOString(),
          manual_update: true,
          completed_at: completedAtValue,
        }).eq('sad_no', originalSad);
        if (error) throw error;
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
        };
        await supabase.from('sad_change_logs').insert([{ sad_no: newSad, changed_by: null, before: JSON.stringify(before), after: JSON.stringify(after), created_at: new Date().toISOString() }]);
      } catch (e) { /* ignore */ }

      await pushActivity(`Edited SAD ${originalSad} → ${newSad}`, { before, after: { sad_no: newSad } });
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

      const { error } = await supabase.from('sad_declarations').update(payload).eq('sad_no', sad_no);
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
      const { data: tickets, error } = await supabase.from('tickets').select('net, weight').eq('sad_no', trimmed);
      if (error) throw error;
      const total = (tickets || []).reduce((s, r) => s + Number(r.net ?? r.weight ?? 0), 0);
      await supabase.from('sad_declarations').update({ total_recorded_weight: total, updated_at: new Date().toISOString() }).eq('sad_no', trimmed);
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
      const { error } = await supabase.from('sad_declarations').update({ status: 'Archived', updated_at: new Date().toISOString() }).eq('sad_no', sad_no);
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
      const { data: tickets = [], error } = await supabase.from('tickets').select('*').eq('sad_no', trimmed).order('date', { ascending: false });
      if (error) console.warn('Could not fetch tickets for PDF', error);
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
      const { error } = await supabase.storage.from(SAD_DOCS_BUCKET).upload(filename, blob, { upsert: true });
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
        <SimpleGrid columns={{ base: 1, md: 4 }} spacing={3}>
          <FormControl>
            <FormLabel>SAD Number</FormLabel>
            <Input value={sadNo} onChange={(e) => setSadNo(e.target.value)} placeholder="e.g. 25" />
          </FormControl>

          <FormControl>
            <FormLabel>Regime</FormLabel>
            <Select placeholder="Select regime" value={regime} onChange={(e) => setRegime(e.target.value)}>
              {REGIME_OPTIONS.map(code => (
                <option key={code} value={code}>
                  {REGIME_LABEL_MAP[code] ? `${REGIME_LABEL_MAP[code]} (${code})` : code}
                </option>
              ))}
            </Select>
          </FormControl>

          <FormControl>
            <FormLabel>Declared Weight (kg)</FormLabel>
            <Input type="text" value={formatNumber(declaredWeight)} onChange={(e) => setDeclaredWeight(parseNumberString(e.target.value))} placeholder="e.g. 100000" />
          </FormControl>

          <FormControl>
            <FormLabel>Attach Docs</FormLabel>
            <Input type="file" multiple onChange={(e) => { const arr = Array.from(e.target.files || []); setDocs(arr); toast({ title: 'Files attached', description: `${arr.length} file(s) attached`, status: 'info' }); }} />
            <Text fontSize="sm" color="gray.500" mt={1}>{docs.length} file(s) selected</Text>
          </FormControl>
        </SimpleGrid>

        <HStack mt={3}>
          <Button colorScheme="teal" leftIcon={<FaPlus />} onClick={handleCreateSAD} isLoading={loading} type="button">Register SAD</Button>
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
                  // discrepancy color rules required:
                  // red when discharged > declared (discrepancy > 0)
                  // blue when discharged < declared (discrepancy < 0)
                  // green when equal (discrepancy === 0)
                  let discColor = 'green.600';
                  if (discrepancy > 0) discColor = 'red.600';
                  else if (discrepancy < 0) discColor = 'blue.600';
                  else discColor = 'green.600';

                  const color = (s.status === 'Completed' ? 'green.400' : s.status === 'In Progress' ? 'red.400' : s.status === 'On Hold' ? 'yellow.400' : 'gray.400');
                  const readyToComplete = Number(s.total_recorded_weight || 0) >= Number(s.declared_weight || 0) && s.status !== 'Completed';
                  const regimeDisplay = REGIME_LABEL_MAP[s.regime] ? `${s.regime}` : (s.regime || '—'); // show code (IM4/EX1/IM7)

                  return (
                    <RowMotion key={s.sad_no || Math.random()} {...MOTION_ROW} style={{ background: 'transparent' }}>
                      <Td data-label="SAD"><Text fontWeight="bold">{s.sad_no}</Text></Td>
                      <Td data-label="Regime"><Text>{regimeDisplay}</Text></Td>
                      <Td data-label="Declared" isNumeric><Text>{Number(s.declared_weight || 0).toLocaleString()}</Text></Td>
                      <Td data-label="Discharged" isNumeric><Text>{Number(s.total_recorded_weight || 0).toLocaleString()}</Text></Td>
                      <Td data-label="No. of Transactions" isNumeric><Text>{Number(s.ticket_count || 0).toLocaleString()}</Text></Td>
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
                              <MenuItem icon={<FaEdit />} onClick={() => openEditModal(s)}>Edit</MenuItem>
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
        )}
      </Box>

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

      {/* Edit modal */}
      <Modal isOpen={editModalOpen} onClose={closeEditModal} size="md" isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Edit SAD</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {editModalData ? (
              <Box>
                <FormControl mb={3}>
                  <FormLabel>SAD Number</FormLabel>
                  <Input value={editModalData.sad_no} onChange={(e) => setEditModalData(d => ({ ...d, sad_no: e.target.value }))} />
                  <Text fontSize="xs" color="gray.500">Changing SAD number will update child tickets and generated reports (best-effort).</Text>
                </FormControl>

                <FormControl mb={3}>
                  <FormLabel>Regime</FormLabel>
                  <Select value={editModalData.regime} onChange={(e) => setEditModalData(d => ({ ...d, regime: e.target.value }))}>
                    <option value="">Select regime</option>
                    {REGIME_OPTIONS.map(code => (
                      <option key={code} value={code}>
                        {REGIME_LABEL_MAP[code] ? `${REGIME_LABEL_MAP[code]} (${code})` : code}
                      </option>
                    ))}
                  </Select>
                </FormControl>

                <FormControl mb={3}>
                  <FormLabel>Declared Weight (kg)</FormLabel>
                  <Input type="text" value={formatNumber(editModalData.declared_weight)} onChange={(e) => setEditModalData(d => ({ ...d, declared_weight: parseNumberString(e.target.value) }))} />
                </FormControl>

                <FormControl mb={3}>
                  <FormLabel>Status</FormLabel>
                  <Select value={editModalData.status} onChange={(e) => setEditModalData(d => ({ ...d, status: e.target.value }))}>
                    {SAD_STATUS.map(st => <option key={st} value={st}>{st}</option>)}
                  </Select>
                </FormControl>
              </Box>
            ) : <Text>Loading...</Text>}
          </ModalBody>

          <ModalFooter>
            <Button variant="ghost" onClick={closeEditModal} type="button">Cancel</Button>
            <Button colorScheme="blue" ml={3} onClick={() => setConfirmSaveOpen(true)} type="button">Save</Button>
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
              <Box><Text fontWeight="bold">Create New SAD</Text><Text fontSize="sm" color="gray.500">Holographic registration</Text></Box>
            </Flex>
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
              <FormControl><FormLabel>SAD Number</FormLabel><Input value={sadNo} onChange={(e) => setSadNo(e.target.value)} /></FormControl>
              <FormControl><FormLabel>Regime</FormLabel><Select placeholder="Select regime" value={regime} onChange={(e) => setRegime(e.target.value)}>{REGIME_OPTIONS.map(code => <option key={code} value={code}>{REGIME_LABEL_MAP[code] ? `${REGIME_LABEL_MAP[code]} (${code})` : code}</option>)}</Select></FormControl>
              <FormControl><FormLabel>Declared Weight (kg)</FormLabel><Input type="text" value={formatNumber(declaredWeight)} onChange={(e) => setDeclaredWeight(parseNumberString(e.target.value))} /></FormControl>
              <FormControl><FormLabel>Attach Documents</FormLabel><Input type="file" multiple onChange={(e) => { const arr = Array.from(e.target.files || []); setDocs(arr); toast({ title: 'Files attached', description: `${arr.length} file(s) attached`, status: 'info' }); }} /><Text fontSize="sm" color="gray.500" mt={1}>{docs.length} file(s) selected</Text></FormControl>
            </SimpleGrid>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={closeOrb}>Cancel</Button>
            <Button colorScheme="teal" ml={3} onClick={handleCreateSAD} isLoading={loading}>Create SAD</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Container>
  );
}
