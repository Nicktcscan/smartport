// src/pages/SADDeclaration.jsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Box, Button, Container, Heading, Input, SimpleGrid, FormControl, FormLabel, Select,
  Text, Table, Thead, Tbody, Tr, Th, Td, VStack, HStack, useToast, Modal, ModalOverlay,
  ModalContent, ModalHeader, ModalBody, ModalFooter, ModalCloseButton, IconButton, Badge, Flex,
  Spinner, Tag, TagLabel, InputGroup, InputRightElement, Stat, StatLabel, StatNumber, StatHelpText, StatGroup,
  Menu, MenuButton, MenuList, MenuItem, MenuDivider, Tooltip
} from '@chakra-ui/react';
import {
  FaPlus, FaMicrophone, FaSearch, FaEye, FaFileExport, FaEllipsisV, FaEdit, FaRedoAlt, FaTrashAlt, FaDownload
} from 'react-icons/fa';
import { supabase } from '../supabaseClient';
import { motion, AnimatePresence } from 'framer-motion';

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

  // inline editing
  const [editingSadId, setEditingSadId] = useState(null);
  const [editData, setEditData] = useState({});

  // activity timeline (local)
  const [activity, setActivity] = useState([]);

  // realtime subscriptions refs
  const subRef = useRef(null);
  const ticketsSubRef = useRef(null);

  // voice
  const recognitionRef = useRef(null);
  const [listening, setListening] = useState(false);

  // basic load / fetch
  const fetchSADs = async (filter = null) => {
    setLoading(true);
    try {
      let q = supabase.from('sad_declarations').select('*').order('created_at', { ascending: false });
      if (filter) {
        if (filter.status) q = q.eq('status', filter.status);
        if (filter.sad_no) q = q.eq('sad_no', filter.sad_no);
        if (filter.regime) q = q.ilike('regime', `%${filter.regime}%`);
      }
      const { data, error } = await q;
      if (error) throw error;

      const normalized = (data || []).map((r) => ({
        ...r,
        docs: Array.isArray(r.docs) ? JSON.parse(JSON.stringify(r.docs)) : [],
        total_recorded_weight: r.total_recorded_weight ?? 0,
      }));

      setSads(normalized);
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
            // refresh list on changes - light strategy: fetchSADs -> preserves server ordering & computed fields
            fetchSADs();
            pushActivity(`Realtime: SAD ${payload.event} ${payload?.new?.sad_no || payload?.old?.sad_no || ''}`, { payloadEvent: payload.event });
          })
          .subscribe();
        subRef.current = ch;
        unsub = () => supabase.removeChannel(ch).catch(() => {});
      } else {
        // legacy subscribe
        const s = supabase.from('sad_declarations').on('*', () => {
          fetchSADs();
        }).subscribe();
        subRef.current = s;
        unsub = () => { try { s.unsubscribe(); } catch (e) {} };
      }
    } catch (e) {
      console.warn('Realtime subscribe failed', e);
    }

    // also subscribe to tickets (to keep totals up-to-date)
    try {
      if (supabase.channel) {
        const tch = supabase.channel('public:tickets')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => {
            fetchSADs(); // recalc displayed totals
            pushActivity('Realtime: tickets changed', {});
          })
          .subscribe();
        ticketsSubRef.current = tch;
        const ticketsUnsub = () => supabase.removeChannel(tch).catch(() => {});
        // ensure both get unsubscribed
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

  // helper: activity push (local + optional DB)
  const pushActivity = async (text, meta = {}) => {
    const ev = { time: new Date().toISOString(), text, meta };
    setActivity(prev => [ev, ...prev].slice(0, 200));
    try {
      await supabase.from('sad_activity').insert([{ text, meta }]);
    } catch (e) {
      // ignore DB errors
    }
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

      // upload
      const { data, error } = await supabase.storage.from(SAD_DOCS_BUCKET).upload(key, f, { cacheControl: '3600', upsert: false });
      if (error) {
        console.warn('upload doc failed', error);
        throw error;
      }
      const filePath = data?.path ?? data?.Key ?? key;

      // get URL (tolerant to SDK shapes)
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
      await pushActivity(`Uploaded doc ${f.name} for SAD ${sad_no}`, { sad_no, file: f.name });
    }

    return uploaded;
  };

  // create SAD record
  const handleCreateSAD = async () => {
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
      await pushActivity(`Created SAD ${sadNo}`);
      setSadNo(''); setRegime(''); setDeclaredWeight(''); setDocs([]);
      fetchSADs();
    } catch (err) {
      console.error('create SAD', err);
      toast({ title: 'Failed', description: err?.message || 'Could not create SAD', status: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // fetch tickets for SAD detail -> FIX: compute recorded weight as SUM of all ticket.net values
  const openSadDetail = async (sad) => {
    setSelectedSad(sad);
    setIsModalOpen(true);
    setDetailLoading(true);
    try {
      const { data, error } = await supabase.from('tickets').select('*').eq('sad_no', sad.sad_no).order('date', { ascending: false });
      if (error) throw error;
      const tickets = data || [];

      // SUM net (or weight) across all tickets for this SAD
      const totalRecorded = tickets.reduce((acc, t) => acc + Number(t.net ?? t.weight ?? 0), 0);

      // update detail tickets and selectedSad so modal shows cumulative total
      setDetailTickets(tickets);
      setSelectedSad(prev => ({ ...sad, total_recorded_weight: totalRecorded }));

      // update local sads list so table immediately reflects summation (UI-only; DOES NOT persist)
      setSads(prev => prev.map(x => x.sad_no === sad.sad_no ? { ...x, total_recorded_weight: totalRecorded } : x));

      await pushActivity(`Viewed SAD ${sad.sad_no} details`);
    } catch (err) {
      console.error('openSadDetail', err);
      toast({ title: 'Failed to load tickets', description: err?.message || 'Unexpected', status: 'error' });
      setDetailTickets([]);
    } finally {
      setDetailLoading(false);
    }
  };

  // update SAD status or other fields (inline edit -> persist)
  const startEdit = (sad) => {
    setEditingSadId(sad.sad_no);
    setEditData({
      regime: sad.regime ?? '',
      declared_weight: sad.declared_weight ?? 0,
      status: sad.status ?? 'In Progress',
    });
  };

  const cancelEdit = () => {
    setEditingSadId(null);
    setEditData({});
  };

  const saveEdit = async (sad_no) => {
    const before = (sadsRef.current || []).find(s => s.sad_no === sad_no) || {};
    const after = { ...before, ...editData, updated_at: new Date().toISOString() };

    // optimistic UI
    setSads(prev => prev.map(s => s.sad_no === sad_no ? { ...s, ...after } : s));
    setEditingSadId(null);
    setEditData({});

    try {
      const payload = {
        regime: after.regime ?? null,
        declared_weight: Number(after.declared_weight ?? 0),
        status: after.status ?? null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('sad_declarations').update(payload).eq('sad_no', sad_no);
      if (error) throw error;

      // log change to change log table (if present)
      try {
        await supabase.from('sad_change_logs').insert([{
          sad_no,
          changed_by: null,
          before: JSON.stringify(before),
          after: JSON.stringify(after),
          created_at: new Date().toISOString(),
        }]);
      } catch (e) {
        // ignore if table not present
      }

      await pushActivity(`Edited SAD ${sad_no}`, { before, after });
      toast({ title: 'Saved', description: `SAD ${sad_no} updated`, status: 'success' });
      fetchSADs();
    } catch (err) {
      console.error('saveEdit', err);
      toast({ title: 'Save failed', description: err?.message || 'Could not save changes', status: 'error' });
      // roll back UI
      fetchSADs();
    }
  };

  // update SAD status (manual quick select)
  const updateSadStatus = async (sad_no, newStatus) => {
    try {
      const { error } = await supabase.from('sad_declarations').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('sad_no', sad_no);
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

  // recalc totals (client fallback)
  const recalcTotalForSad = async (sad_no) => {
    try {
      const { data: tickets, error } = await supabase.from('tickets').select('net, weight').eq('sad_no', sad_no);
      if (error) throw error;
      const total = (tickets || []).reduce((s, r) => s + Number(r.net ?? r.weight ?? 0), 0);
      await supabase.from('sad_declarations').update({ total_recorded_weight: total, updated_at: new Date().toISOString() }).eq('sad_no', sad_no);
      await pushActivity(`Recalculated total for ${sad_no}: ${total}`);
      fetchSADs();
      toast({ title: 'Recalculated', description: `Total recorded ${total.toLocaleString()}`, status: 'success' });
      const row = (await supabase.from('sad_declarations').select('declared_weight').eq('sad_no', sad_no)).data?.[0];
      if (row) {
        const declared = Number(row.declared_weight || 0);
        const diff = Math.abs(declared - total);
        if (declared > 0 && (diff / declared) < 0.01) {
          await updateSadStatus(sad_no, 'Completed');
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
      await pushActivity(`Archived SAD ${sad_no}`);
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
      await pushActivity(`Exported SAD ${s.sad_no}`);
    } catch (err) {
      console.error('exportSingleSAD', err);
      toast({ title: 'Export failed', description: err?.message || 'Unexpected', status: 'error' });
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
    if (!nlQuery) return fetchSADs();
    setNlLoading(true);
    try {
      const q = nlQuery.toLowerCase();
      const filter = {};

      if (/\bcompleted\b/.test(q)) filter.status = 'Completed';
      else if (/\bin progress\b/.test(q) || /\binprogress\b/.test(q)) filter.status = 'In Progress';
      else if (/\bon hold\b/.test(q)) filter.status = 'On Hold';

      // if query contains a number, treat as SAD number
      const num = q.match(/\b(\d{1,10})\b/);
      if (num) filter.sad_no = num[1];

      if (!filter.sad_no && !filter.status) filter.regime = nlQuery;

      await fetchSADs(filter);
      await pushActivity(`Search: "${nlQuery}"`, filter);
    } catch (e) {
      console.error('NL query failed', e);
      toast({ title: 'Search failed', description: e?.message || 'Unexpected', status: 'error' });
    } finally {
      setNlLoading(false);
    }
  };

  // voice commands (Web Speech API)
  const startListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast({ title: 'Voice not supported', description: 'Your browser does not have SpeechRecognition', status: 'warning' });
      return;
    }
    const rec = new SpeechRecognition();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = async (e) => {
      const text = e.results[0][0].transcript;
      setNlQuery(text);
      await runNlQuery();
      setListening(false);
      rec.stop();
    };
    rec.onerror = (err) => {
      console.warn('Voice err', err);
      toast({ title: 'Voice error', description: err.error || 'Failed to record', status: 'error' });
      setListening(false);
    };
    rec.onend = () => setListening(false);
    rec.start();
    recognitionRef.current = rec;
    setListening(true);
  };

  // Local explain discrepancy
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
      // flag if ratio deviates more than 2 std devs or ratio outside 0.8..1.2
      if (Math.abs(z) > 2 || ratio < 0.8 || ratio > 1.2) flagged.push({ sad: s, z, ratio });
    }
    return { mean, std, flagged };
  }, [sads]);

  // Derived dashboard stats
  const dashboardStats = useMemo(() => {
    const totalSADs = sads.length;
    const totalDeclared = sads.reduce((a, b) => a + Number(b.declared_weight || 0), 0);
    const totalRecorded = sads.reduce((a, b) => a + Number(b.total_recorded_weight || 0), 0);
    const completed = sads.filter(s => s.status === 'Completed').length;
    const activeDiscreps = anomalyResults.flagged.length;
    return { totalSADs, totalDeclared, totalRecorded, completed, activeDiscreps };
  }, [sads, anomalyResults]);

  // Pagination & filtering pipeline
  const filteredSads = useMemo(() => {
    let arr = Array.isArray(sads) ? sads.slice() : [];
    if (statusFilter) arr = arr.filter(s => (s.status || '').toLowerCase() === statusFilter.toLowerCase());
    if (regimeFilter) arr = arr.filter(s => String(s.regime || '').toLowerCase().includes(String(regimeFilter).toLowerCase()));
    if (nlQuery) {
      const q = nlQuery.toLowerCase();
      arr = arr.filter(s =>
        (String(s.sad_no || '').toLowerCase().includes(q)) ||
        (String(s.regime || '').toLowerCase().includes(q)) ||
        (String(s.docs || []).join(' ').toLowerCase().includes(q))
      );
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
      // default created_at
      const ta = new Date(a.created_at || a.updated_at || 0).getTime();
      const tb = new Date(b.created_at || b.updated_at || 0).getTime();
      return (ta - tb) * -dir; // newest first by default
    });
    return arr;
  }, [sads, statusFilter, regimeFilter, nlQuery, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredSads.length / pageSize));
  useEffect(() => { if (page > totalPages) setPage(1); }, [totalPages]); // reset if needed
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

  // Manual backup to storage (client-triggered). For weekly scheduling use a server job.
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
      // Supabase storage requires file, we need to upload via put - SDK accepts Blob in browser
      const { data, error } = await supabase.storage.from(SAD_DOCS_BUCKET).upload(filename, blob, { upsert: true });
      if (error) throw error;
      await pushActivity('Manual backup uploaded', { path: filename });
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
        <Button size="xs" onClick={() => openDocsModal(s)}>
          View docs ({count})
        </Button>
        <Tooltip label="Quick preview first doc">
          <IconButton
            aria-label="Preview first doc"
            size="xs"
            icon={<FaEye />}
            onClick={() => {
              const docsArr = Array.isArray(s.docs) ? s.docs : [];
              if (docsArr.length) openDocViewer(docsArr[0]);
            }} />
        </Tooltip>
      </HStack>
    );
  };

  // Framer motion row variants used in AnimatePresence
  const RowMotion = motion(Tr);

  // Simple small controls for quick filtering/sorting
  // Note: you can move these controls into a separate toolbar component later
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
          <StatLabel>Declared (kg)</StatLabel>
          <StatNumber>{dashboardStats.totalDeclared.toLocaleString()}</StatNumber>
          <StatHelpText>Sum declared weight</StatHelpText>
        </Stat>

        <Stat bg="white" p={3} borderRadius="md" boxShadow="sm">
          <StatLabel>Recorded (kg)</StatLabel>
          <StatNumber>{dashboardStats.totalRecorded.toLocaleString()}</StatNumber>
          <StatHelpText>Sum recorded weight</StatHelpText>
        </Stat>

        <Stat bg="white" p={3} borderRadius="md" boxShadow="sm">
          <StatLabel>Active discrepancies</StatLabel>
          <StatNumber>{dashboardStats.activeDiscreps}</StatNumber>
          <StatHelpText>{((dashboardStats.activeDiscreps / Math.max(1, dashboardStats.totalSADs)) * 100).toFixed(1)}% of SADs</StatHelpText>
        </Stat>

        <Stat bg="white" p={3} borderRadius="md" boxShadow="sm">
          <StatLabel>% Completed</StatLabel>
          <StatNumber>{dashboardStats.totalSADs ? Math.round((dashboardStats.completed / dashboardStats.totalSADs) * 100) : 0}%</StatNumber>
          <StatHelpText>{dashboardStats.completed} completed</StatHelpText>
        </Stat>
      </StatGroup>

      {/* Create / controls */}
      <Box bg="white" p={4} borderRadius="md" boxShadow="sm" mb={6}>
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
          <Button colorScheme="teal" leftIcon={<FaPlus />} onClick={handleCreateSAD} isLoading={loading}>Register SAD</Button>
          <Button onClick={() => { setSadNo(''); setRegime(''); setDeclaredWeight(''); setDocs([]); }}>Reset</Button>

          <Box ml="auto" display="flex" gap={2}>
            <Button size="sm" leftIcon={<FaFileExport />} onClick={handleExportFilteredCSV}>Export filtered CSV</Button>
            <Button size="sm" variant="ghost" onClick={handleManualBackupToStorage}>Backup to storage</Button>
          </Box>
        </HStack>
      </Box>

      {/* Filters / search / sorting / pagination */}
      <Box bg="white" p={4} borderRadius="md" boxShadow="sm" mb={6}>
        <Flex gap={3} align="center" wrap="wrap">
          <Input placeholder="Search (SAD, Regime, docs...)" value={nlQuery} onChange={(e) => setNlQuery(e.target.value)} maxW="360px" />
          <Button size="sm" onClick={runNlQuery} isLoading={nlLoading}>Search</Button>

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
                        {editingSadId === s.sad_no ? (
                          <Select size="sm" value={editData.regime ?? ''} onChange={(e) => setEditData(d => ({ ...d, regime: e.target.value }))}>
                            <option value="">Select regime</option>
                            {REGIME_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                          </Select>
                        ) : (
                          <Text>{s.regime || '—'}</Text>
                        )}
                      </Td>

                      <Td isNumeric>
                        {editingSadId === s.sad_no ? (
                          <Input size="sm" type="number" value={editData.declared_weight ?? 0} onChange={(e) => setEditData(d => ({ ...d, declared_weight: e.target.value }))} />
                        ) : (
                          <Text>{Number(s.declared_weight || 0).toLocaleString()}</Text>
                        )}
                      </Td>

                      <Td isNumeric>
                        <Text>{Number(s.total_recorded_weight || 0).toLocaleString()}</Text>
                      </Td>

                      <Td>
                        {editingSadId === s.sad_no ? (
                          <Select size="sm" value={editData.status ?? s.status} onChange={(e) => setEditData(d => ({ ...d, status: e.target.value }))}>
                            {SAD_STATUS.map(st => <option key={st} value={st}>{st}</option>)}
                          </Select>
                        ) : (
                          <HStack>
                            <Box width="10px" height="10px" borderRadius="full" bg={indicator} />
                            <Text>{s.status}</Text>
                            {anomaly && <Badge colorScheme="red">Anomaly</Badge>}
                          </HStack>
                        )}
                      </Td>

                      <Td>
                        <Text color={discrepancy === 0 ? 'green.600' : (discrepancy > 0 ? 'red.600' : 'orange.600')}>
                          {discrepancy === 0 ? '0' : discrepancy.toLocaleString()}
                        </Text>
                      </Td>

                      <Td>{renderDocsCell(s)}</Td>

                      <Td>
                        <HStack>
                          {editingSadId === s.sad_no ? (
                            <>
                              <Button size="xs" colorScheme="green" onClick={() => saveEdit(s.sad_no)}>Save</Button>
                              <Button size="xs" onClick={cancelEdit}>Cancel</Button>
                            </>
                          ) : (
                            <Menu>
                              <MenuButton as={IconButton} aria-label="Actions" icon={<FaEllipsisV />} size="sm" />
                              <MenuList>
                                <MenuItem icon={<FaEye />} onClick={() => openSadDetail(s)}>View Details</MenuItem>
                                <MenuItem icon={<FaEdit />} onClick={() => startEdit(s)}>Edit</MenuItem>
                                <MenuItem icon={<FaRedoAlt />} onClick={() => recalcTotalForSad(s.sad_no)}>Recalc Totals</MenuItem>
                                <MenuDivider />
                                <MenuItem icon={<FaFileExport />} onClick={() => exportSingleSAD(s)}>Export SAD</MenuItem>
                                <MenuDivider />
                                <MenuItem icon={<FaTrashAlt />} onClick={() => {
                                  if (window.confirm(`Archive SAD ${s.sad_no}? This marks it as Archived.`)) {
                                    archiveSad(s.sad_no);
                                  }
                                }}>Archive SAD</MenuItem>
                              </MenuList>
                            </Menu>
                          )}
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
            <Button onClick={() => setIsModalOpen(false)}>Close</Button>
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
                          <Button size="xs" onClick={() => openDocViewer(d)}>View</Button>
                          <IconButton
                            size="xs"
                            aria-label="Download"
                            icon={<FaDownload />}
                            onClick={() => {
                              // open in new tab to allow user to download
                              if (d.url) window.open(d.url, '_blank');
                            }}
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
            <Button onClick={() => setDocsModal({ open: false, docs: [], sad_no: null })}>Close</Button>
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
            <Button onClick={() => setDocViewer({ open: false, doc: null })}>Close</Button>
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
