// src/pages/SADDeclaration.jsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Box, Button, Container, Heading, Input, SimpleGrid, FormControl, FormLabel, Select,
  Text, Table, Thead, Tbody, Tr, Th, Td, VStack, HStack, useToast, Modal, ModalOverlay,
  ModalContent, ModalHeader, ModalBody, ModalFooter, ModalCloseButton, IconButton, Badge, Flex,
  Spinner, Tag, TagLabel, Stat, StatLabel, StatNumber, StatHelpText, StatGroup,
  Menu, MenuButton, MenuList, MenuItem, MenuDivider
} from '@chakra-ui/react';
import {
  FaPlus, FaFileExport, FaEllipsisV, FaEdit, FaRedoAlt, FaTrashAlt, FaDownload, FaFilePdf
} from 'react-icons/fa';
import { supabase } from '../supabaseClient';
import { motion, AnimatePresence } from 'framer-motion';
import logo from '../assets/logo.png'; // ensure this file exists

const COMPANY_NAME = 'NICK TC-SCAN (GAMBIA) LTD';
const SAD_STATUS = ['In Progress', 'On Hold', 'Completed', 'Archived'];
const SAD_DOCS_BUCKET = 'sad-docs';
const MOTION_ROW = { initial: { opacity: 0, y: -6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 6 } };
const REGIME_OPTIONS = ['Import', 'Export'];

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

  // modal / detail
  const [selectedSad, setSelectedSad] = useState(null);
  const [detailTickets, setDetailTickets] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // edit modal (replaces inline editing)
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editModalSad, setEditModalSad] = useState(null);
  const [editForm, setEditForm] = useState({ regime: '', declared_weight: '', status: '' });

  // doc viewer
  const [docViewer, setDocViewer] = useState({ open: false, doc: null });

  // docs list modal (new)
  const [docsModal, setDocsModal] = useState({ open: false, docs: [], sad_no: null });

  // NL search + filters + sorting + pagination
  const [nlQuery, setNlQuery] = useState('');
  const [nlLoading, setNlLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [regimeFilter, setRegimeFilter] = useState('');
  const [sortBy, setSortBy] = useState('created_at'); // created_at, declared_weight, discrepancy
  const [sortDir, setSortDir] = useState('desc'); // asc/desc
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);

  // activity timeline (local + persisted)
  const [activity, setActivity] = useState([]);

  // realtime subscriptions refs
  const subRef = useRef(null);
  const ticketsSubRef = useRef(null);

  // track previously announced "discharge completed" SADs so we only toast once per session
  const prevDischargeRef = useRef(new Set());

  // pending refresh flag when fetchSADs call happens while editing - apply after editing if set
  const pendingRefreshRef = useRef(false);

  // ---------------------
  // load persisted activity from localStorage
  // ---------------------
  useEffect(() => {
    try {
      const raw = localStorage.getItem('sad_activity');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setActivity(parsed);
      }
    } catch (e) {
      // ignore parse errors
    }
  }, []);

  // persist activity when it changes
  useEffect(() => {
    try {
      localStorage.setItem('sad_activity', JSON.stringify(activity));
    } catch (e) {
      // ignore quota errors
    }
  }, [activity]);

  // ---------------------
  // fetchSADs (with correct recorded totals)
  // ---------------------
  const fetchSADs = async (filter = null) => {
    // If user is actively editing in the modal, don't apply immediate refresh to avoid focus loss.
    if (editModalOpen) {
      pendingRefreshRef.current = true;
      return;
    }

    setLoading(true);
    try {
      // first fetch SAD declarations
      let q = supabase.from('sad_declarations').select('*').order('created_at', { ascending: false });
      if (filter) {
        if (filter.status) q = q.eq('status', filter.status);
        if (filter.sad_no) q = q.eq('sad_no', filter.sad_no);
        if (filter.regime) q = q.ilike('regime', `%${filter.regime}%`);
      }
      const { data, error } = await q;
      if (error) throw error;

      // normalized SAD list
      const normalized = (data || []).map((r) => ({
        ...r,
        docs: Array.isArray(r.docs) ? JSON.parse(JSON.stringify(r.docs)) : [],
        total_recorded_weight: Number(r.total_recorded_weight ?? 0),
      }));

      // gather sad numbers to query tickets for sums
      const sadNos = normalized.map((s) => s.sad_no).filter(Boolean);
      if (sadNos.length) {
        // fetch tickets for these SADs and compute sum(net) per sad_no
        const { data: tickets, error: tErr } = await supabase
          .from('tickets')
          .select('sad_no, net, weight')
          .in('sad_no', sadNos);

        if (tErr) {
          console.warn('Could not fetch tickets to compute totals', tErr);
        } else {
          const totals = {};
          for (const t of tickets || []) {
            const n = Number(t.net ?? t.weight ?? 0);
            const key = t.sad_no;
            totals[key] = (totals[key] || 0) + (Number.isFinite(n) ? n : 0);
          }

          // apply computed totals to normalized list (prefer computed totals)
          for (let i = 0; i < normalized.length; i++) {
            const s = normalized[i];
            if (s.sad_no && totals[s.sad_no] != null) {
              normalized[i] = {
                ...s,
                total_recorded_weight: totals[s.sad_no],
              };
            }
          }
        }
      }

      // compute dischargeCompleted flag and set to state
      const enhanced = normalized.map((s) => {
        const declared = Number(s.declared_weight || 0);
        const recorded = Number(s.total_recorded_weight || 0);
        const dischargeCompleted = declared > 0 && recorded >= declared;
        return { ...s, total_recorded_weight: recorded, dischargeCompleted };
      });

      // detect newly completed (toast once per SAD per session)
      const newlyCompleted = enhanced.filter((s) => s.dischargeCompleted && !prevDischargeRef.current.has(s.sad_no));
      for (const s of newlyCompleted) {
        prevDischargeRef.current.add(s.sad_no);
        toast({
          title: 'Discharge Completed',
          description: `SAD ${s.sad_no} has met its declared weight (${Number(s.total_recorded_weight).toLocaleString()} / ${Number(s.declared_weight).toLocaleString()}).`,
          status: 'success',
          duration: 5000,
          isClosable: true,
          position: 'bottom-right',
          variant: 'subtle',
        });
        pushActivity(`Discharge met for ${s.sad_no}`, { sad_no: s.sad_no });
      }

      setSads(enhanced);
    } catch (err) {
      console.error('fetchSADs', err);
      toast({ title: 'Failed to load SADs', description: err?.message || 'Unexpected', status: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSADs();
    // realtime subscription to sad_declarations table
    let unsub = null;
    try {
      if (supabase.channel) {
        const ch = supabase.channel('public:sad_declarations')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'sad_declarations' }, (payload) => {
            // refresh list on changes - keep server ordering & computed fields
            fetchSADs();
            pushActivity(`Realtime: SAD ${payload.event} ${payload?.new?.sad_no || payload?.old?.sad_no || ''}`, { payloadEvent: payload.event });
          })
          .subscribe();
        subRef.current = ch;
        unsub = () => supabase.removeChannel(ch).catch(() => {});
      } else {
        const s = supabase.from('sad_declarations').on('*', () => {
          fetchSADs();
        }).subscribe();
        subRef.current = s;
        unsub = () => { try { s.unsubscribe(); } catch (e) {} };
      }
    } catch (e) {
      console.warn('Realtime subscribe failed', e);
    }

    // tickets subscription (keeps totals accurate)
    try {
      if (supabase.channel) {
        const tch = supabase.channel('public:tickets')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => {
            fetchSADs();
            pushActivity('Realtime: tickets changed', {});
          })
          .subscribe();
        ticketsSubRef.current = tch;
        const ticketsUnsub = () => supabase.removeChannel(tch).catch(() => {});
        const bothUnsub = () => { try { ticketsUnsub(); } catch (e) {}; if (unsub) unsub(); };
        return bothUnsub;
      }
    } catch (e) {
      console.warn('Tickets realtime subscribe failed', e);
    }

    return () => {
      try {
        if (subRef.current && supabase.removeChannel) supabase.removeChannel(subRef.current).catch(() => {});
      } catch (e) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // helper: activity push (local-only)
  const pushActivity = (text, meta = {}) => {
    const ev = { time: new Date().toISOString(), text, meta };
    setActivity(prev => [ev, ...prev].slice(0, 200));
    // Remote writes removed — activity persisted to localStorage only.
  };

  // Open document in viewer modal
  const openDocViewer = (doc) => {
    setDocViewer({ open: true, doc });
  };

  // Open docs modal for a SAD (new)
  const openDocsModal = (sad) => {
    setDocsModal({ open: true, docs: Array.isArray(sad.docs) ? sad.docs : [], sad_no: sad.sad_no });
  };

  // upload docs to storage and return array of URLs + tags (OCR removed)
  const uploadDocs = async (sad_no, files = []) => {
    if (!files || files.length === 0) return [];
    const uploaded = [];

    for (const f of files) {
      const key = `sad-${sad_no}/${Date.now()}-${f.name.replace(/\s+/g, '_')}`;

      const { data, error } = await supabase.storage.from(SAD_DOCS_BUCKET).upload(key, f, { cacheControl: '3600', upsert: false });
      if (error) {
        console.warn('upload doc failed', error);
        throw error;
      }
      const filePath = data?.path ?? data?.Key ?? key;

      let url = null;
      try {
        const getPublic = await supabase.storage.from(SAD_DOCS_BUCKET).getPublicUrl(filePath);
        const publicUrl =
          (getPublic?.data && (getPublic.data.publicUrl || getPublic.data.publicURL)) ??
          getPublic?.publicURL ??
          null;

        if (publicUrl) {
          url = publicUrl;
        } else {
          const signedResp = await supabase.storage.from(SAD_DOCS_BUCKET).createSignedUrl(filePath, 60 * 60 * 24 * 7);
          const signedUrl =
            (signedResp?.data && (signedResp.data.signedUrl || signedResp.data.signedURL)) ??
            signedResp?.signedUrl ??
            signedResp?.signedURL ??
            null;
          if (!signedUrl) throw new Error('Could not obtain public or signed URL for uploaded file.');
          url = signedUrl;
        }
      } catch (uErr) {
        console.warn('Getting URL failed', uErr);
        throw uErr;
      }

      uploaded.push({ name: f.name, path: filePath, url, tags: [], parsed: null });
      pushActivity(`Uploaded doc ${f.name} for SAD ${sad_no}`, { sad_no, file: f.name });
    }

    return uploaded;
  };

  // create SAD record
  const handleCreateSAD = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!sadNo || !declaredWeight) {
      toast({ title: 'Missing values', description: 'Provide SAD number and declared weight', status: 'warning' });
      return;
    }
    setLoading(true);
    try {
      const docRecords = await uploadDocs(sadNo, docs);

      const payload = {
        sad_no: sadNo,
        regime: regime || null,
        declared_weight: Number(declaredWeight),
        docs: docRecords,
        status: 'In Progress',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase.from('sad_declarations').insert([payload]);
      if (error) throw error;
      toast({ title: 'SAD registered', description: `SAD ${sadNo} created`, status: 'success' });
      pushActivity(`Created SAD ${sadNo}`);
      setSadNo(''); setRegime(''); setDeclaredWeight(''); setDocs([]);
      fetchSADs();
    } catch (err) {
      console.error('create SAD', err);
      toast({ title: 'Failed', description: err?.message || 'Could not create SAD', status: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // fetch tickets for SAD detail (and compute cumulative net properly)
  const openSadDetail = async (sad) => {
    setSelectedSad(sad);
    setIsModalOpen(true);
    setDetailLoading(true);
    try {
      const { data, error } = await supabase.from('tickets').select('*').eq('sad_no', sad.sad_no).order('date', { ascending: false });
      if (error) throw error;
      const tickets = data || [];
      setDetailTickets(tickets);

      // ensure selectedSad shows correct total recorded (cumulative net)
      const computedTotal = (tickets || []).reduce((s, r) => s + Number(r.net ?? r.weight ?? 0), 0);
      setSelectedSad((prev) => ({ ...prev, total_recorded_weight: computedTotal, dischargeCompleted: (Number(prev?.declared_weight || 0) > 0 && computedTotal >= Number(prev?.declared_weight || 0)) }));

      pushActivity(`Viewed SAD ${sad.sad_no} details`);
    } catch (err) {
      console.error('openSadDetail', err);
      toast({ title: 'Failed to load tickets', description: err?.message || 'Unexpected', status: 'error' });
      setDetailTickets([]);
    } finally {
      setDetailLoading(false);
    }
  };

  // Open edit modal
  const startEdit = (sad) => {
    setEditModalSad(sad);
    setEditForm({
      regime: sad.regime ?? '',
      declared_weight: String(sad.declared_weight ?? ''),
      status: sad.status ?? 'In Progress',
    });
    setEditModalOpen(true);
  };

  // Cancel edit modal
  const cancelEdit = () => {
    setEditModalOpen(false);
    setEditModalSad(null);
    setEditForm({ regime: '', declared_weight: '', status: '' });

    // if a refresh was queued while editing, apply it now
    if (pendingRefreshRef.current) {
      pendingRefreshRef.current = false;
      fetchSADs();
    }
  };

  // Save edit from modal
  const saveEdit = async () => {
    if (!editModalSad) {
      toast({ title: 'No SAD selected', status: 'warning' });
      return;
    }
    const confirm = window.confirm('Save changes to this SAD?');
    if (!confirm) return;

    const sad_no = editModalSad.sad_no;
    const before = (sadsRef.current || []).find(s => s.sad_no === sad_no) || {};
    const after = {
      ...before,
      regime: editForm.regime ?? before.regime,
      declared_weight: Number(editForm.declared_weight ?? before.declared_weight ?? 0),
      status: editForm.status ?? before.status,
      updated_at: new Date().toISOString()
    };

    // optimistic UI
    setSads(prev => prev.map(s => s.sad_no === sad_no ? { ...s, ...after } : s));
    setEditModalOpen(false);

    try {
      const payload = {
        regime: after.regime ?? null,
        declared_weight: Number(after.declared_weight ?? 0),
        status: after.status ?? null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('sad_declarations').update(payload).eq('sad_no', sad_no);
      if (error) throw error;

      // log to change logs table if desired (fail silently)
      try {
        await supabase.from('sad_change_logs').insert([{
          sad_no,
          changed_by: null,
          before: JSON.stringify(before),
          after: JSON.stringify(after),
          created_at: new Date().toISOString(),
        }]);
      } catch (e) {}

      pushActivity(`Edited SAD ${sad_no}`, { before, after });
      toast({ title: 'Saved', description: `SAD ${sad_no} updated`, status: 'success' });
      fetchSADs();
    } catch (err) {
      console.error('saveEdit', err);
      toast({ title: 'Save failed', description: err?.message || 'Could not save changes', status: 'error' });
      fetchSADs();
    } finally {
      // if a refresh was queued while editing, apply it now
      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        fetchSADs();
      }
      setEditModalSad(null);
      setEditForm({ regime: '', declared_weight: '', status: '' });
    }
  };

  // update SAD status (manual quick select)
  const updateSadStatus = async (sad_no, newStatus) => {
    try {
      const { error } = await supabase.from('sad_declarations').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('sad_no', sad_no);
      if (error) throw error;
      toast({ title: 'Status updated', description: `${sad_no} status set to ${newStatus}`, status: 'success' });
      pushActivity(`Status of ${sad_no} set to ${newStatus}`);
      fetchSADs();
      if (selectedSad && selectedSad.sad_no === sad_no) openSadDetail({ sad_no });
    } catch (err) {
      console.error('updateSadStatus', err);
      toast({ title: 'Update failed', description: err?.message || 'Unexpected', status: 'error' });
    }
  };

  // recalc totals (client fallback)
  const recalcTotalForSad = async (sad_no) => {
    try {
      const { data: tickets, error } = await supabase.from('tickets').select('net, weight').eq('sad_no', sad_no);
      if (error) throw error;
      const total = (tickets || []).reduce((s, r) => s + Number(r.net ?? r.weight ?? 0), 0);
      await supabase.from('sad_declarations').update({ total_recorded_weight: total, updated_at: new Date().toISOString() }).eq('sad_no', sad_no);
      pushActivity(`Recalculated total for ${sad_no}: ${total}`);
      fetchSADs();
      toast({ title: 'Recalculated', description: `Total recorded ${total.toLocaleString()}`, status: 'success' });
      const row = (await supabase.from('sad_declarations').select('declared_weight').eq('sad_no', sad_no)).data?.[0];
      if (row) {
        const declared = Number(row.declared_weight || 0);
        const diff = Math.abs(declared - total);
        if (declared > 0 && (diff / declared) < 0.01) {
          toast({
            title: 'Discharge Completed (suggestion)',
            description: `SAD ${sad_no} has met its declared weight — consider marking status as Completed.`,
            status: 'info',
            duration: 6000,
            isClosable: true,
          });
        }
      }
    } catch (err) {
      console.error('recalcTotalForSad', err);
      toast({ title: 'Could not recalc', description: err?.message || 'Unexpected', status: 'error' });
    }
  };

  // archive SAD (soft)
  const archiveSad = async (sad_no) => {
    try {
      const { error } = await supabase.from('sad_declarations').update({ status: 'Archived', updated_at: new Date().toISOString() }).eq('sad_no', sad_no);
      if (error) throw error;
      toast({ title: 'Archived', description: `SAD ${sad_no} archived`, status: 'info' });
      pushActivity(`Archived SAD ${sad_no}`);
      fetchSADs();
    } catch (err) {
      console.error('archiveSad', err);
      toast({ title: 'Archive failed', description: err?.message || 'Unexpected', status: 'error' });
    }
  };

  // export single SAD to CSV (basic)
  const exportSingleSAD = async (s) => {
    try {
      const rows = [{
        sad_no: s.sad_no,
        regime: s.regime,
        declared_weight: s.declared_weight,
        total_recorded_weight: s.total_recorded_weight,
        status: s.status,
        created_at: s.created_at,
        updated_at: s.updated_at,
        docs: (s.docs || []).map(d => d.name || d.path).join('; '),
      }];
      exportToCSV(rows, `sad_${s.sad_no}_export.csv`);
      toast({ title: 'Export started', description: `SAD ${s.sad_no} exported`, status: 'success' });
      pushActivity(`Exported SAD ${s.sad_no}`);
    } catch (err) {
      console.error('exportSingleSAD', err);
      toast({ title: 'Export failed', description: err?.message || 'Unexpected', status: 'error' });
    }
  };

  // try to set a DB flag to prevent new tickets (best-effort)
  const lockSADForNewTickets = async (sad_no) => {
    try {
      const { error } = await supabase.from('sad_declarations').update({ closed_to_tickets: true, updated_at: new Date().toISOString() }).eq('sad_no', sad_no);
      if (error) throw error;
      toast({ title: 'SAD locked', description: `SAD ${sad_no} is now locked for new tickets (DB flag set).`, status: 'success' });
      pushActivity(`Locked SAD ${sad_no} for new tickets`);
      fetchSADs();
    } catch (err) {
      console.warn('Could not set closed flag', err);
      toast({
        title: 'Could not lock at DB level',
        description: 'To fully prevent new tickets you need server-side enforcement (add a `closed_to_tickets` column or check on ticket creation). Showing UI block locally.',
        status: 'warning',
        duration: 7000,
        isClosable: true,
      });
    }
  };

  // indicator color by discrepancy
  const getIndicator = (declared, recorded) => {
    const d = Number(declared || 0);
    const r = Number(recorded || 0);
    if (!d) return 'gray';
    const ratio = r / d;
    if (Math.abs(r - d) / Math.max(1, d) < 0.01) return 'green';
    if (ratio > 1.15 || ratio < 0.85) return 'red';
    if (ratio > 1.05 || ratio < 0.95) return 'yellow';
    return 'orange';
  };

  // handle file change (OCR removed)
  const onFilesChange = async (fileList) => {
    try {
      const arr = Array.from(fileList || []);
      setDocs(arr);
      toast({ title: 'Files attached', description: `${arr.length} file(s) attached — OCR/analysis disabled`, status: 'info', duration: 4000 });
    } catch (e) {
      console.warn('onFilesChange', e);
      toast({ title: 'File attach error', description: e?.message || 'Could not attach files', status: 'error' });
    }
  };

  // NL search
  const runNlQuery = async () => {
    if (!nlQuery) {
      fetchSADs();
      return;
    }
    setNlLoading(true);
    try {
      const q = nlQuery.toLowerCase();
      const filter = {};

      if (/\bcompleted\b/.test(q)) filter.status = 'Completed';
      else if (/\bin progress\b/.test(q) || /\binprogress\b/.test(q)) filter.status = 'In Progress';
      else if (/\bon hold\b/.test(q)) filter.status = 'On Hold';

      const num = q.match(/\b(\d{1,10})\b/);
      if (num) filter.sad_no = num[1];

      if (!filter.sad_no && !filter.status) filter.regime = nlQuery;

      await fetchSADs(filter);
      pushActivity(`Search: "${nlQuery}"`, filter);
    } catch (e) {
      console.error('NL query failed', e);
      toast({ title: 'Search failed', description: e?.message || 'Unexpected', status: 'error' });
    } finally {
      setNlLoading(false);
    }
  };

  // Local explain discrepancy
  const handleExplainDiscrepancy = async (s) => {
    const recorded = Number(s.total_recorded_weight || 0);
    const declared = Number(s.declared_weight || 0);
    if (!declared) {
      toast({ title: 'No declared weight', description: `SAD ${s.sad_no} has no declared weight to compare.`, status: 'warning' });
      pushActivity(`Explain: no declared weight for ${s.sad_no}`);
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
    pushActivity(`Explained discrepancy for ${s.sad_no}: ${msg}`);
  };

  // Generate printable report (user prints -> Save as PDF)
  // IMPORTANT: open the popup synchronously to avoid blockers, then write content after fetching.
  const generatePdfReport = async (s) => {
    // open window synchronously on click to satisfy popup blocker rules
    const w = window.open('', '_blank');
    if (!w) {
      toast({ title: 'Blocked', description: 'Popup blocked — allow popups for this site to print PDF.', status: 'warning' });
      return;
    }

    // small placeholder while we fetch (prevents about:blank)
    try {
      w.document.open();
      w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Preparing report...</title></head><body><p>Preparing report... please wait.</p></body></html>');
      w.document.close();
    } catch (e) {
      // ignore
    }

    try {
      // fetch tickets to include in report
      const { data: tickets = [], error } = await supabase.from('tickets').select('*').eq('sad_no', s.sad_no).order('date', { ascending: false });
      if (error) {
        console.warn('Could not fetch tickets for PDF', error);
      }

      const declared = Number(s.declared_weight || 0);
      const recorded = Number(s.total_recorded_weight || 0);

      // A4 sized report and include logo + company name
      const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>SAD ${s.sad_no} Report</title>
          <style>
            @page { size: A4; margin: 20mm; }
            html, body { margin: 0; padding: 0; font-family: Arial, sans-serif; -webkit-print-color-adjust: exact; }
            .page { width: 170mm; margin: 0 auto; padding: 8mm 12mm; color: #111; }
            header { display: flex; align-items: center; gap: 12px; border-bottom: 1px solid #ddd; padding-bottom: 8px; margin-bottom: 12px; }
            header img { height: 56px; object-fit: contain; }
            header .company { font-size: 16px; font-weight: 700; }
            h1 { font-size: 18px; margin: 12px 0; }
            .meta { margin-bottom: 12px; }
            .meta p { margin: 4px 0; }
            table { width: 100%; border-collapse: collapse; margin-top: 8px; }
            th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; font-size: 12px; }
            th { background: #f4f4f4; font-weight: 600; }
            .small { font-size: 11px; color: #555; }
            .badge { display:inline-block; padding:4px 8px; border-radius:4px; background:#eee; font-size:12px; margin-left:8px; }
            footer { margin-top: 16px; font-size: 11px; color: #666; border-top: 1px solid #eee; padding-top: 8px; }
          </style>
        </head>
        <body>
          <div class="page">
            <header>
              <img src="${logo}" alt="logo" />
              <div>
                <div class="company">${COMPANY_NAME}</div>
                <div class="small">SAD Report — ${s.sad_no}</div>
              </div>
            </header>

            <h1>SAD ${s.sad_no} — Report</h1>
            <div class="meta">
              <p><strong>Regime:</strong> ${s.regime || '—'}</p>
              <p><strong>Declared weight:</strong> ${declared.toLocaleString()} kg</p>
              <p><strong>Recorded weight:</strong> ${recorded.toLocaleString()} kg ${s.dischargeCompleted ? '<span class="badge">Discharge Completed</span>' : ''}</p>
              <p class="small">Status: ${s.status || '—'} | Created: ${s.created_at || '—'} | Updated: ${s.updated_at || '—'}</p>
              <p class="small">Documents: ${(Array.isArray(s.docs) ? s.docs.map(d => d.name || d.path).join(', ') : '')}</p>
            </div>

            <h2>Tickets</h2>
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

            <footer>Generated by ${COMPANY_NAME} — ${new Date().toLocaleString()}</footer>
          </div>

          <script>
            // auto print when opened (user can choose Save as PDF)
            setTimeout(() => { window.print(); }, 300);
          </script>
        </body>
      </html>
      `;

      try {
        w.document.open();
        w.document.write(html);
        w.document.close();
      } catch (e) {
        console.error('Could not write PDF window', e);
        toast({ title: 'Report failed', description: 'Could not open report window content.', status: 'error' });
        try { w.close(); } catch (e2) {}
      }
    } catch (err) {
      console.error('generatePdfReport', err);
      try {
        w.document.open();
        w.document.write('<!doctype html><html><body><p>Failed to generate report. See console for details.</p></body></html>');
        w.document.close();
      } catch (e) {}
      toast({ title: 'Report failed', description: err?.message || 'Could not generate report', status: 'error' });
    }
  };

  // REGIME level aggregates
  const regimeAggregates = useMemo(() => {
    const map = {};
    for (const s of sads) {
      const r = s.regime || 'Unknown';
      if (!map[r]) map[r] = { count: 0, declared: 0, recorded: 0 };
      map[r].count += 1;
      map[r].declared += Number(s.declared_weight || 0);
      map[r].recorded += Number(s.total_recorded_weight || 0);
    }
    return map;
  }, [sads]);

  // Discrepancy / anomaly detection across entire dataset (z-score on ratio)
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

  // Derived dashboard stats — UPDATED to show status counts
  const dashboardStats = useMemo(() => {
    const totalSADs = sads.length;
    const totalCompleted = sads.filter(s => s.status === 'Completed').length;
    const totalInProgress = sads.filter(s => s.status === 'In Progress').length;
    const totalOnHold = sads.filter(s => s.status === 'On Hold').length;
    // keep 'completed' for percent calculation
    const completed = totalCompleted;
    return { totalSADs, totalCompleted, totalInProgress, totalOnHold, completed };
  }, [sads, anomalyResults]);

  // Pagination & filtering pipeline
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
    // sorting
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
      return (ta - tb) * -dir;
    });
    return arr;
  }, [sads, statusFilter, regimeFilter, nlQuery, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredSads.length / pageSize));
  useEffect(() => { if (page > totalPages) setPage(1); }, [totalPages]);
  const pagedSads = filteredSads.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

  // Export current filtered view
  const handleExportFilteredCSV = () => {
    const rows = filteredSads.map(s => ({
      sad_no: s.sad_no,
      regime: s.regime,
      declared_weight: s.declared_weight,
      total_recorded_weight: s.total_recorded_weight,
      status: s.status,
      created_at: s.created_at,
      updated_at: s.updated_at,
    }));
    exportToCSV(rows, `sad_declarations_export_${new Date().toISOString().slice(0,10)}.csv`);
    toast({ title: 'Export started', description: `${rows.length} rows exported`, status: 'success' });
  };

  // Manual backup to storage (client-triggered)
  const handleManualBackupToStorage = async () => {
    try {
      const rows = sads.map(s => ({
        sad_no: s.sad_no,
        regime: s.regime,
        declared_weight: s.declared_weight,
        total_recorded_weight: s.total_recorded_weight,
        status: s.status,
        created_at: s.created_at,
        updated_at: s.updated_at,
      }));
      const csv = [
        Object.keys(rows[0] || {}).join(','),
        ...rows.map(r => Object.values(r).map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')),
      ].join('\n');

      const filename = `backup/sad_declarations_backup_${new Date().toISOString().slice(0,10)}.csv`;
      const blob = new Blob([csv], { type: 'text/csv' });
      const { data, error } = await supabase.storage.from(SAD_DOCS_BUCKET).upload(filename, blob, { upsert: true });
      if (error) throw error;
      pushActivity('Manual backup uploaded', { path: filename });
      toast({ title: 'Backup uploaded', description: `Saved as ${filename}`, status: 'success' });
    } catch (err) {
      console.error('backup failed', err);
      toast({ title: 'Backup failed', description: err?.message || 'Unexpected', status: 'error' });
    }
  };

  // UI helpers: render docs cell as a compact button that opens the modal
  const renderDocsCell = (s) => {
    const count = Array.isArray(s.docs) ? s.docs.length : 0;
    if (!count) return <Text color="gray.500">—</Text>;
    return (
      <HStack>
        <Button size="xs" type="button" onClick={() => openDocsModal(s)}>
          View docs ({count})
        </Button>
      </HStack>
    );
  };

  // Framer motion row variants used in AnimatePresence
  const RowMotion = motion(Tr);

  // -----------------------
  // UI render
  // -----------------------
  return (
    <Container maxW="8xl" py={6}>
      <Heading mb={4}>SAD Declaration Panel</Heading>

      {/* Top cards */}
      <StatGroup mb={4}>
        <Stat bg="white" p={3} borderRadius="md" boxShadow="sm">
          <StatLabel>Total SADs</StatLabel>
          <StatNumber>{dashboardStats.totalSADs}</StatNumber>
          <StatHelpText>Today & overall</StatHelpText>
        </Stat>

        <Stat bg="white" p={3} borderRadius="md" boxShadow="sm">
          <StatLabel>Total Completed</StatLabel>
          <StatNumber>{dashboardStats.totalCompleted}</StatNumber>
          <StatHelpText>All SADs marked Completed</StatHelpText>
        </Stat>

        <Stat bg="white" p={3} borderRadius="md" boxShadow="sm">
          <StatLabel>Total In Progress</StatLabel>
          <StatNumber>{dashboardStats.totalInProgress}</StatNumber>
          <StatHelpText>Currently in progress</StatHelpText>
        </Stat>

        <Stat bg="white" p={3} borderRadius="md" boxShadow="sm">
          <StatLabel>Total On Hold</StatLabel>
          <StatNumber>{dashboardStats.totalOnHold}</StatNumber>
          <StatHelpText>Currently on hold</StatHelpText>
        </Stat>

        <Stat bg="white" p={3} borderRadius="md" boxShadow="sm">
          <StatLabel>% Completed</StatLabel>
          <StatNumber>{dashboardStats.totalSADs ? Math.round((dashboardStats.completed / dashboardStats.totalSADs) * 100) : 0}%</StatNumber>
          <StatHelpText>{dashboardStats.completed} completed</StatHelpText>
        </Stat>
      </StatGroup>

      {/* Create / controls - wrapped in a form to prevent enter from submitting/reloading */}
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
              {REGIME_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </Select>
          </FormControl>

          <FormControl>
            <FormLabel>Declared Weight (kg)</FormLabel>
            <Input type="number" value={declaredWeight} onChange={(e) => setDeclaredWeight(e.target.value)} placeholder="e.g. 100000" />
          </FormControl>

          <FormControl>
            <FormLabel>Attach Docs</FormLabel>
            <Input type="file" multiple onChange={(e) => onFilesChange(e.target.files)} />
            <Text fontSize="sm" color="gray.500" mt={1}>{docs.length} file(s) selected</Text>
          </FormControl>
        </SimpleGrid>

        <HStack mt={3}>
          <Button colorScheme="teal" leftIcon={<FaPlus />} onClick={handleCreateSAD} isLoading={loading} type="button">Register SAD</Button>
          <Button type="button" onClick={() => { setSadNo(''); setRegime(''); setDeclaredWeight(''); setDocs([]); }}>Reset</Button>

          <Box ml="auto" display="flex" gap={2}>
            <Button size="sm" leftIcon={<FaFileExport />} onClick={handleExportFilteredCSV} type="button">Export filtered CSV</Button>
            <Button size="sm" variant="ghost" onClick={handleManualBackupToStorage} type="button">Backup to storage</Button>
          </Box>
        </HStack>
      </Box>

      {/* Filters / search / sorting / pagination */}
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
            {REGIME_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </Select>

          <Select size="sm" value={sortBy} onChange={(e) => setSortBy(e.target.value)} maxW="200px">
            <option value="created_at">Newest</option>
            <option value="declared_weight">Declared weight</option>
            <option value="recorded">Recorded weight</option>
            <option value="discrepancy">Discrepancy</option>
          </Select>

          <Select size="sm" value={sortDir} onChange={(e) => setSortDir(e.target.value)} maxW="120px">
            <option value="desc">Desc</option>
            <option value="asc">Asc</option>
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
      <Box bg="white" p={4} borderRadius="md" boxShadow="sm" mb={6}>
        {loading ? <Spinner /> : (
          <Table size="sm" variant="striped">
            <Thead>
              <Tr>
                <Th>SAD</Th>
                <Th>Regime</Th>
                <Th isNumeric>Declared (kg)</Th>
                <Th isNumeric>Recorded (kg)</Th>
                <Th>Status</Th>
                <Th>Discrepancy</Th>
                <Th>Docs</Th>
                <Th>Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              <AnimatePresence>
                {pagedSads.map((s) => {
                  const discrepancy = Number(s.total_recorded_weight || 0) - Number(s.declared_weight || 0);
                  const indicator = getIndicator(s.declared_weight, s.total_recorded_weight);
                  const anomaly = anomalyResults.flagged.find(f => f.sad.sad_no === s.sad_no);

                  return (
                    <RowMotion key={s.sad_no} {...MOTION_ROW} style={{ background: 'transparent' }}>
                      <Td>
                        <Text fontWeight="bold">{s.sad_no}</Text>
                      </Td>

                      <Td>
                        <Text>{s.regime || '—'}</Text>
                      </Td>

                      <Td isNumeric>
                        <Text>{Number(s.declared_weight || 0).toLocaleString()}</Text>
                      </Td>

                      <Td isNumeric>
                        <Text>{Number(s.total_recorded_weight || 0).toLocaleString()}</Text>
                      </Td>

                      <Td>
                        <VStack align="start" spacing={1}>
                          <HStack>
                            <Box width="10px" height="10px" borderRadius="full" bg={indicator} />
                            <Text>{s.status}</Text>
                            {anomaly && <Badge colorScheme="red">Anomaly</Badge>}
                            {s.dischargeCompleted && s.status !== 'Completed' && <Badge colorScheme="green">Discharge Completed</Badge>}
                          </HStack>
                          {s.dischargeCompleted && s.status !== 'Completed' && (
                            <HStack spacing={2}>
                              <Text fontSize="xs" color="gray.600">Declared met — please mark as Completed</Text>
                              <Button size="xs" type="button" onClick={() => updateSadStatus(s.sad_no, 'Completed')}>Mark Completed</Button>
                              <Button size="xs" type="button" variant="outline" onClick={() => lockSADForNewTickets(s.sad_no)}>Lock to new tickets</Button>
                            </HStack>
                          )}
                        </VStack>
                      </Td>

                      <Td>
                        <Text color={discrepancy === 0 ? 'green.600' : (discrepancy > 0 ? 'red.600' : 'orange.600')}>
                          {discrepancy === 0 ? '0' : discrepancy.toLocaleString()}
                        </Text>
                      </Td>

                      <Td>{renderDocsCell(s)}</Td>

                      <Td>
                        <HStack>
                          <Menu>
                            <MenuButton as={IconButton} aria-label="Actions" icon={<FaEllipsisV />} size="sm" />
                            <MenuList>
                              <MenuItem icon={<FaEdit />} onClick={() => startEdit(s)}>Edit</MenuItem>
                              <MenuItem icon={<FaRedoAlt />} onClick={() => recalcTotalForSad(s.sad_no)}>Recalc Totals</MenuItem>
                              <MenuItem icon={<FaFilePdf />} onClick={() => generatePdfReport(s)}>Print / Save PDF</MenuItem>
                              <MenuItem icon={<FaFileExport />} onClick={() => exportSingleSAD(s)}>Export CSV</MenuItem>
                              <MenuDivider />
                              <MenuItem icon={<FaTrashAlt />} onClick={() => {
                                if (window.confirm(`Archive SAD ${s.sad_no}? This marks it as Archived.`)) {
                                  archiveSad(s.sad_no);
                                }
                              }}>Archive SAD</MenuItem>
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

      {/* SAD detail modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} size="xl" scrollBehavior="inside">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>SAD {selectedSad?.sad_no}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {selectedSad && (
              <>
                {selectedSad.dischargeCompleted && (
                  <Box mb={3} p={3} bg="green.50" borderRadius="md" border="1px solid" borderColor="green.100">
                    <HStack justify="space-between">
                      <Text fontSize="sm">
                        Discharge Completed — declared total met ({Number(selectedSad.total_recorded_weight || 0).toLocaleString()} / {Number(selectedSad.declared_weight || 0).toLocaleString()})
                      </Text>
                      <HStack>
                        {selectedSad.status !== 'Completed' && <Button size="sm" onClick={() => updateSadStatus(selectedSad.sad_no, 'Completed')} type="button">Mark Completed</Button>}
                        <Button size="sm" variant="outline" onClick={() => lockSADForNewTickets(selectedSad.sad_no)} type="button">Lock to new tickets</Button>
                        <Button size="sm" onClick={() => generatePdfReport(selectedSad)} type="button">Print / Save PDF</Button>
                      </HStack>
                    </HStack>
                  </Box>
                )}

                <Text mb={2}>Declared weight: <strong>{Number(selectedSad.declared_weight || 0).toLocaleString()} kg</strong></Text>
                <Text mb={2}>Recorded weight: <strong>{Number(selectedSad.total_recorded_weight || 0).toLocaleString()} kg</strong></Text>
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

      {/* Edit modal (replaces inline editing) */}
      <Modal isOpen={editModalOpen} onClose={cancelEdit} size="md" closeOnOverlayClick={false}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Edit SAD {editModalSad?.sad_no}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <SimpleGrid columns={1} spacing={3}>
              <FormControl>
                <FormLabel>Regime</FormLabel>
                <Select value={editForm.regime} onChange={(e) => setEditForm(f => ({ ...f, regime: e.target.value }))}>
                  <option value="">Select regime</option>
                  {REGIME_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </Select>
              </FormControl>

              <FormControl>
                <FormLabel>Declared weight (kg)</FormLabel>
                <Input type="number" value={editForm.declared_weight} onChange={(e) => setEditForm(f => ({ ...f, declared_weight: e.target.value }))} />
              </FormControl>

              <FormControl>
                <FormLabel>Status</FormLabel>
                <Select value={editForm.status} onChange={(e) => setEditForm(f => ({ ...f, status: e.target.value }))}>
                  {SAD_STATUS.map(st => <option key={st} value={st}>{st}</option>)}
                </Select>
              </FormControl>
            </SimpleGrid>
          </ModalBody>
          <ModalFooter>
            <Button colorScheme="green" mr={3} onClick={saveEdit} type="button">Save</Button>
            <Button onClick={cancelEdit} type="button">Cancel</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Docs modal (NEW) */}
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
                  <Tr>
                    <Th>Filename</Th>
                    <Th>Tags</Th>
                    <Th>Actions</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {docsModal.docs.map((d, i) => (
                    <Tr key={i}>
                      <Td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name || d.path || 'doc'}</Td>
                      <Td>
                        {(d.tags || []).length ? (d.tags.map((t, j) => <Tag key={j} size="sm" mr={1}><TagLabel>{t}</TagLabel></Tag>)) : <Text color="gray.500">—</Text>}
                      </Td>
                      <Td>
                        <HStack>
                          <Button size="xs" onClick={() => openDocViewer(d)} type="button">View</Button>
                          <IconButton
                            size="xs"
                            aria-label="Download"
                            icon={<FaDownload />}
                            onClick={() => { if (d.url) window.open(d.url, '_blank'); }}
                          />
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

      {/* Doc Viewer modal */}
      <Modal isOpen={docViewer.open} onClose={() => setDocViewer({ open: false, doc: null })} size="xl" scrollBehavior="inside">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Document Viewer</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {docViewer.doc ? (
              <>
                <Text mb={2}><strong>{docViewer.doc.name}</strong></Text>
                {/\.(jpe?g|png|gif|bmp|webp)$/i.test(docViewer.doc.url) ? (
                  <img src={docViewer.doc.url} alt={docViewer.doc.name} style={{ maxWidth: '100%' }} />
                ) : (
                  <iframe title="doc" src={docViewer.doc.url} style={{ width: '100%', height: '70vh' }} />
                )}
                <Box mt={3}>
                  {(docViewer.doc.tags || []).map((t, i) => <Tag key={i} mr={2}><TagLabel>{t}</TagLabel></Tag>)}
                </Box>
              </>
            ) : <Text>No doc</Text>}
          </ModalBody>
          <ModalFooter>
            <Button onClick={() => setDocViewer({ open: false, doc: null })} type="button">Close</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Activity timeline */}
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
    </Container>
  );
}
