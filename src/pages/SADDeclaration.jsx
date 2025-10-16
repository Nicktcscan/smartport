// src/pages/SADDeclaration.jsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Box, Button, Container, Heading, Input, SimpleGrid, FormControl, FormLabel, Select,
  Text, Table, Thead, Tbody, Tr, Th, Td, VStack, HStack, useToast, Modal, ModalOverlay,
  ModalContent, ModalHeader, ModalBody, ModalFooter, ModalCloseButton, IconButton, Badge, Flex,
  Spinner, Tag, TagLabel, Stat, StatLabel, StatNumber, StatHelpText, StatGroup,
  Menu, MenuButton, MenuList, MenuItem, MenuDivider, Tooltip, AlertDialog, AlertDialogBody,
  AlertDialogFooter, AlertDialogHeader, AlertDialogContent, AlertDialogOverlay
} from '@chakra-ui/react';
import {
  FaPlus, FaFileExport, FaEllipsisV, FaEdit, FaRedoAlt, FaTrashAlt, FaDownload, FaFilePdf
} from 'react-icons/fa';
import { supabase } from '../supabaseClient';
import { motion, AnimatePresence } from 'framer-motion';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import logo from '../assets/logo.png';

const SAD_STATUS = ['In Progress', 'On Hold', 'Completed'];
const SAD_DOCS_BUCKET = 'sad-docs';
const MOTION_ROW = { initial: { opacity: 0, y: -6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 6 } };
const REGIME_OPTIONS = ['Import', 'Export'];

// map manual status to color
const STATUS_COLOR_MAP = {
  'In Progress': 'red',
  'Completed': 'green',
  'On Hold': 'yellow',
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

  // detail modal
  const [selectedSad, setSelectedSad] = useState(null);
  const [detailTickets, setDetailTickets] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // doc viewer
  const [docViewer, setDocViewer] = useState({ open: false, doc: null });

  // docs list modal
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

  // edit modal (replaces inline editing)
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editFormSad, setEditFormSad] = useState(null); // full SAD object being edited
  const [editForm, setEditForm] = useState({ regime: '', declared_weight: '', status: '' });

  // confirmation dialog for saving edits
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  const saveCancelRef = useRef();

  // archive confirmation (AlertDialog)
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const archiveCancelRef = useRef();

  // activity timeline (local + optional DB)
  const [activity, setActivity] = useState([]);

  // realtime subscriptions refs
  const subRef = useRef(null);
  const ticketsSubRef = useRef(null);

  // track previously announced "discharge completed" SADs so we only toast once per session (visual only)
  const prevDischargeRef = useRef(new Set());

  // ---------------------
  // load activity from localStorage on mount
  // ---------------------
  useEffect(() => {
    try {
      const raw = localStorage.getItem('sad_activity_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setActivity(parsed);
      }
    } catch (e) {
      // ignore
    }
  }, []);

  // persist activity to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem('sad_activity_v1', JSON.stringify(activity));
    } catch (e) {
      // ignore
    }
  }, [activity]);

  // ---------------------
  // fetchSADs (with correct discharged totals)
  // ---------------------
  const fetchSADs = async (filter = null) => {
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
        // keep existing total_recorded_weight (renamed semantics) as fallback (DB may already hold it)
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
          // keep DB totals if present
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

      // compute dischargeCompleted flag for information ONLY (do not auto-change status)
      const enhanced = normalized.map((s) => {
        const declared = Number(s.declared_weight || 0);
        const recorded = Number(s.total_recorded_weight || 0);
        const dischargeCompleted = declared > 0 && recorded >= declared;
        return { ...s, total_recorded_weight: recorded, dischargeCompleted };
      });

      // show toasts once for newly completed (informational only)
      const newlyCompleted = enhanced.filter((s) => s.dischargeCompleted && !prevDischargeRef.current.has(s.sad_no));
      for (const s of newlyCompleted) {
        prevDischargeRef.current.add(s.sad_no);
        toast({
          title: 'Discharge Completed (info)',
          description: `SAD ${s.sad_no} has met or exceeded its declared weight (${Number(s.total_recorded_weight).toLocaleString()} / ${Number(s.declared_weight).toLocaleString()}).`,
          status: 'info',
          duration: 6000,
          isClosable: true,
          position: 'bottom-right',
        });
        await pushActivity(`Discharge met for ${s.sad_no}`, { sad_no: s.sad_no });
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
    // realtime subscription to sad_declarations table (best-effort)
    try {
      if (supabase.channel) {
        const ch = supabase.channel('public:sad_declarations')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'sad_declarations' }, (payload) => {
            fetchSADs();
            pushActivity(`Realtime: SAD ${payload.event} ${payload?.new?.sad_no || payload?.old?.sad_no || ''}`, { payloadEvent: payload.event });
          })
          .subscribe();
        subRef.current = ch;
      } else {
        const s = supabase.from('sad_declarations').on('*', () => {
          fetchSADs();
        }).subscribe();
        subRef.current = s;
      }
    } catch (e) {
      console.warn('Realtime subscribe failed', e);
    }

    // subscribe to tickets changes to keep discharged totals up-to-date
    try {
      if (supabase.channel) {
        const tch = supabase.channel('public:tickets')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => {
            fetchSADs();
            pushActivity('Realtime: tickets changed', {});
          })
          .subscribe();
        ticketsSubRef.current = tch;
      }
    } catch (e) {
      console.warn('Tickets realtime subscribe failed', e);
    }

    return () => {
      try {
        if (subRef.current && supabase.removeChannel) supabase.removeChannel(subRef.current).catch(() => {});
      } catch (e) {}
      try {
        if (ticketsSubRef.current && supabase.removeChannel) supabase.removeChannel(ticketsSubRef.current).catch(() => {});
      } catch (e) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // helper: activity push (local + optional DB)
  const pushActivity = async (text, meta = {}) => {
    const ev = { time: new Date().toISOString(), text, meta };
    setActivity(prev => [ev, ...prev].slice(0, 200));
    // still try to write to DB but don't fail UX if table missing
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

  // Open docs modal for a SAD
  const openDocsModal = (sad) => {
    setDocsModal({ open: true, docs: Array.isArray(sad.docs) ? sad.docs : [], sad_no: sad.sad_no });
  };

  // upload docs to storage and return array of URLs + tags
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

      await pushActivity(`Viewed SAD ${sad.sad_no} details`);
    } catch (err) {
      console.error('openSadDetail', err);
      toast({ title: 'Failed to load tickets', description: err?.message || 'Unexpected', status: 'error' });
      setDetailTickets([]);
    } finally {
      setDetailLoading(false);
    }
  };

  // start edit (open modal)
  const openEditModal = (s) => {
    setEditFormSad(s);
    setEditForm({
      regime: s.regime ?? '',
      declared_weight: String(s.declared_weight ?? ''),
      status: s.status ?? 'In Progress',
    });
    setEditModalOpen(true);
  };

  // save edit - show confirmation dialog first
  const onRequestSaveEdit = () => {
    setSaveConfirmOpen(true);
  };

  const performSaveEdit = async () => {
    setSaveConfirmOpen(false);
    setEditModalOpen(false);
    if (!editFormSad) return;
    const sad_no = editFormSad.sad_no;
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

    try {
      const payload = {
        regime: after.regime ?? null,
        declared_weight: Number(after.declared_weight ?? 0),
        status: after.status ?? null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('sad_declarations').update(payload).eq('sad_no', sad_no);
      if (error) throw error;

      // optional change log
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
      console.error('performSaveEdit', err);
      toast({ title: 'Save failed', description: err?.message || 'Could not save changes', status: 'error' });
      fetchSADs();
    } finally {
      setEditFormSad(null);
      setEditForm({ regime: '', declared_weight: '', status: '' });
    }
  };

  // cancel edit
  const cancelEditModal = () => {
    setEditModalOpen(false);
    setEditFormSad(null);
    setEditForm({ regime: '', declared_weight: '', status: '' });
  };

  // update SAD status directly (not auto)
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
      toast({ title: 'Recalculated', description: `Discharged ${total.toLocaleString()}`, status: 'success' });
    } catch (err) {
      console.error('recalcTotalForSad', err);
      toast({ title: 'Could not recalc', description: err?.message || 'Unexpected', status: 'error' });
    }
  };

  // archive SAD via modal confirm
  const requestArchive = (sad_no) => {
    setArchiveTarget(sad_no);
    setArchiveConfirmOpen(true);
  };

  const confirmArchive = async () => {
    if (!archiveTarget) {
      setArchiveConfirmOpen(false);
      return;
    }
    try {
      const sad_no = archiveTarget;
      setArchiveConfirmOpen(false);
      setArchiveTarget(null);
      const { error } = await supabase.from('sad_declarations').update({ status: 'Archived', updated_at: new Date().toISOString() }).eq('sad_no', sad_no);
      if (error) throw error;
      toast({ title: 'Archived', description: `SAD ${sad_no} archived`, status: 'info' });
      await pushActivity(`Archived SAD ${sad_no}`);
      fetchSADs();
    } catch (err) {
      console.error('confirmArchive', err);
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
        discharged_weight: s.total_recorded_weight,
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

  // handle file change
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

  // Local explain discrepancy (now outputs Overdeclared/Underdeclared text)
  const handleExplainDiscrepancy = async (s) => {
    const discharged = Number(s.total_recorded_weight || 0);
    const declared = Number(s.declared_weight || 0);
    if (!declared) {
      toast({ title: 'No declared weight', description: `SAD ${s.sad_no} has no declared weight to compare.`, status: 'warning' });
      await pushActivity(`Explain: no declared weight for ${s.sad_no}`);
      return;
    }
    const diff = declared - discharged;
    const pct = ((Math.abs(diff) / Math.max(1, declared)) * 100).toFixed(2);
    let msg = '';
    if (discharged === declared) {
      msg = `Declared equals discharged (${declared.toLocaleString()} kg).`;
    } else if (declared > discharged) {
      msg = `Overdeclared by ${diff.toLocaleString()} kg (${pct}%).`;
    } else {
      msg = `Underdeclared by ${Math.abs(diff).toLocaleString()} kg (${pct}%).`;
    }
    toast({ title: `Discrepancy for ${s.sad_no}`, description: msg, status: 'info', duration: 10000 });
    await pushActivity(`Explained discrepancy for ${s.sad_no}: ${msg}`);
  };

  // -----------------------
  // PDF generation (no new window). Uses html2canvas + jsPDF to download directly.
  // -----------------------
  const generatePdfReport = async (s) => {
    try {
      // Build an off-screen container with the report HTML
      const container = document.createElement('div');
      container.style.position = 'fixed';
      container.style.left = '-10000px';
      container.style.top = '0';
      container.style.width = '794px'; // approx A4 width at 96dpi (for good rendering)
      container.style.padding = '24px';
      container.style.background = '#fff';
      container.innerHTML = `
        <div style="display:flex; align-items:center; gap:12px; margin-bottom:12px;">
          <img src="${logo}" style="height:48px; width:auto;" alt="logo" />
          <div>
            <div style="font-size:18px; font-weight:700;">NICK TC-SCAN (GAMBIA) LTD</div>
            <div style="font-size:13px; color:#555;">SAD ${s.sad_no} — Report</div>
          </div>
        </div>
        <div style="font-family: Arial, sans-serif; color:#111;">
          <div style="margin-bottom:8px;">
            <strong>Regime:</strong> ${s.regime || '—'}<br/>
            <strong>Declared weight:</strong> ${Number(s.declared_weight || 0).toLocaleString()} kg<br/>
            <strong>Discharged:</strong> ${Number(s.total_recorded_weight || 0).toLocaleString()} kg ${s.dischargeCompleted ? '<span style="background:#dff0d8;color:#3c763d;padding:3px 6px;border-radius:4px;font-size:12px;margin-left:8px;">Discharged met</span>' : ''}
            <div style="font-size:12px;color:#666;margin-top:6px;">
              Status: ${s.status || '—'} | Created: ${s.created_at || '—'} | Updated: ${s.updated_at || '—'}
            </div>
            <div style="font-size:12px;color:#666;margin-top:6px;">Documents: ${(Array.isArray(s.docs) ? s.docs.map(d => d.name || d.path).join(', ') : '')}</div>
          </div>
          <h3 style="margin-top:12px;margin-bottom:6px;">Tickets</h3>
      `;

      // fetch tickets
      const { data: tickets = [], error } = await supabase.from('tickets').select('*').eq('sad_no', s.sad_no).order('date', { ascending: false });
      if (error) {
        console.warn('Could not fetch tickets for PDF', error);
      }

      if ((tickets || []).length) {
        const rowsHtml = tickets.map(t => `
          <tr>
            <td style="border:1px solid #ccc;padding:6px;">${t.ticket_no || ''}</td>
            <td style="border:1px solid #ccc;padding:6px;">${t.gnsw_truck_no || ''}</td>
            <td style="border:1px solid #ccc;padding:6px;text-align:right;">${Number(t.net ?? t.weight ?? 0).toLocaleString()}</td>
            <td style="border:1px solid #ccc;padding:6px;">${t.date ? new Date(t.date).toLocaleString() : '—'}</td>
          </tr>
        `).join('');
        container.innerHTML += `
          <table style="width:100%;border-collapse:collapse;margin-top:8px;">
            <thead>
              <tr>
                <th style="border:1px solid #ccc;padding:6px;text-align:left">Ticket</th>
                <th style="border:1px solid #ccc;padding:6px;text-align:left">Truck</th>
                <th style="border:1px solid #ccc;padding:6px;text-align:right">Net (kg)</th>
                <th style="border:1px solid #ccc;padding:6px;text-align:left">Date</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        `;
      } else {
        container.innerHTML += `<p style="color:#666;">No tickets recorded.</p>`;
      }

      container.innerHTML += `</div>`;
      document.body.appendChild(container);

      // render to canvas
      const canvas = await html2canvas(container, { scale: 2, useCORS: true });
      const imgData = canvas.toDataURL('image/png');

      // create pdf (A4)
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      // calculate image dimensions in mm for A4 width
      const imgProps = pdf.getImageProperties(imgData);
      const imgWidthMm = pageWidth;
      const imgHeightMm = (imgProps.height * imgWidthMm) / imgProps.width;

      // If image fits single page, add and save; otherwise scale to fit pageHeight and add pages (simple scaling)
      if (imgHeightMm <= pageHeight) {
        pdf.addImage(imgData, 'PNG', 0, 0, imgWidthMm, imgHeightMm);
      } else {
        // scale height to fit page, keep aspect
        const scale = pageHeight / imgHeightMm;
        const adjustedHeight = imgHeightMm * scale;
        const adjustedWidth = imgWidthMm * scale;
        pdf.addImage(imgData, 'PNG', 0, 0, adjustedWidth, adjustedHeight);
      }

      pdf.save(`sad_${s.sad_no}_report.pdf`);

      // cleanup
      document.body.removeChild(container);
      await pushActivity(`Exported PDF for ${s.sad_no}`);
    } catch (err) {
      console.error('generatePdfReport', err);
      toast({ title: 'Report failed', description: err?.message || 'Could not generate report', status: 'error' });
    }
  };

  // REGIME level aggregates (for stats)
  const regimeAggregates = useMemo(() => {
    const map = {};
    for (const s of sads) {
      const r = s.regime || 'Unknown';
      if (!map[r]) map[r] = { count: 0, declared: 0, discharged: 0 };
      map[r].count += 1;
      map[r].declared += Number(s.declared_weight || 0);
      map[r].discharged += Number(s.total_recorded_weight || 0);
    }
    return map;
  }, [sads]);

  // Discrepancy classification (Overdeclared / Underdeclared)
  const classifyDiscrepancy = (declared = 0, discharged = 0) => {
    const d = Number(declared || 0);
    const r = Number(discharged || 0);
    if (d === r) return 'Matched';
    if (d > r) return 'Overdeclared';
    return 'Underdeclared';
  };

  // Derived dashboard stats: Total Completed, In Progress, On Hold
  const dashboardStats = useMemo(() => {
    const totalSADs = sads.length;
    const completed = sads.filter(s => s.status === 'Completed').length;
    const inProgress = sads.filter(s => s.status === 'In Progress').length;
    const onHold = sads.filter(s => s.status === 'On Hold').length;
    return { totalSADs, completed, inProgress, onHold };
  }, [sads]);

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
      if (sortBy === 'discharged') return (Number(a.total_recorded_weight || 0) - Number(b.total_recorded_weight || 0)) * dir;
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
  useEffect(() => { if (page > totalPages) setPage(1); }, [totalPages]); // reset if needed
  const pagedSads = filteredSads.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

  // Export current filtered view
  const handleExportFilteredCSV = () => {
    const rows = filteredSads.map(s => ({
      sad_no: s.sad_no,
      regime: s.regime,
      declared_weight: s.declared_weight,
      discharged_weight: s.total_recorded_weight,
      status: s.status,
      created_at: s.created_at,
      updated_at: s.updated_at,
    }));
    exportToCSV(rows, `sad_declarations_export_${new Date().toISOString().slice(0,10)}.csv`);
    toast({ title: 'Export started', description: `${rows.length} rows exported`, status: 'success' });
  };

  // Manual backup to storage
  const handleManualBackupToStorage = async () => {
    try {
      const rows = sads.map(s => ({
        sad_no: s.sad_no,
        regime: s.regime,
        declared_weight: s.declared_weight,
        discharged_weight: s.total_recorded_weight,
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
          <StatNumber>{dashboardStats.completed}</StatNumber>
          <StatHelpText>Manually marked</StatHelpText>
        </Stat>

        <Stat bg="white" p={3} borderRadius="md" boxShadow="sm">
          <StatLabel>Total In Progress</StatLabel>
          <StatNumber>{dashboardStats.inProgress}</StatNumber>
          <StatHelpText>Active SADs</StatHelpText>
        </Stat>

        <Stat bg="white" p={3} borderRadius="md" boxShadow="sm">
          <StatLabel>Total On Hold</StatLabel>
          <StatNumber>{dashboardStats.onHold}</StatNumber>
          <StatHelpText>Paused SADs</StatHelpText>
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
            <option value="discharged">Discharged weight</option>
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
                <Th isNumeric>Discharged (kg)</Th>
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
                  const discrepancyLabel = classifyDiscrepancy(s.declared_weight, s.total_recorded_weight);
                  const discColor = discrepancyLabel === 'Overdeclared' ? 'orange.600' : (discrepancyLabel === 'Underdeclared' ? 'red.600' : 'green.600');

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
                            <Box width="10px" height="10px" borderRadius="full" bg={STATUS_COLOR_MAP[s.status] || 'gray'} />
                            <Text color={STATUS_COLOR_MAP[s.status] ? `${STATUS_COLOR_MAP[s.status]}.600` : 'gray.600'}>{s.status}</Text>
                            {/* classification badge */}
                            {discrepancyLabel !== 'Matched' && <Badge colorScheme={discrepancyLabel === 'Overdeclared' ? 'orange' : 'red'}>{discrepancyLabel}</Badge>}
                            {/* If discharged met but status not Completed, show gentle badge (informational only) */}
                            {s.dischargeCompleted && s.status !== 'Completed' && <Badge colorScheme="green">Discharged met</Badge>}
                          </HStack>
                          {/* Suggestion row: only visible when discharged met but status not completed */}
                          {s.dischargeCompleted && s.status !== 'Completed' && (
                            <HStack spacing={2}>
                              <Text fontSize="xs" color="gray.600">Discharged met — change status manually if desired</Text>
                              <Button size="xs" type="button" onClick={() => openEditModal(s)}>Edit</Button>
                            </HStack>
                          )}
                        </VStack>
                      </Td>

                      <Td>
                        <Text color={discColor}>{discrepancy === 0 ? '0' : discrepancy.toLocaleString()}</Text>
                      </Td>

                      <Td>{renderDocsCell(s)}</Td>

                      <Td>
                        <HStack>
                          <Menu>
                            <MenuButton as={IconButton} aria-label="Actions" icon={<FaEllipsisV />} size="sm" />
                            <MenuList>
                              <MenuItem icon={<FaEdit />} onClick={() => openEditModal(s)}>Edit</MenuItem>
                              <MenuItem icon={<FaRedoAlt />} onClick={() => recalcTotalForSad(s.sad_no)}>Recalc Discharged</MenuItem>
                              <MenuItem icon={<FaFilePdf />} onClick={() => generatePdfReport(s)}>Print / Save PDF</MenuItem>
                              <MenuItem icon={<FaFileExport />} onClick={() => exportSingleSAD(s)}>Export CSV</MenuItem>
                              <MenuDivider />
                              <MenuItem icon={<FaTrashAlt />} onClick={() => requestArchive(s.sad_no)}>Archive SAD</MenuItem>
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
                        Discharged met ({Number(selectedSad.total_recorded_weight || 0).toLocaleString()} / {Number(selectedSad.declared_weight || 0).toLocaleString()})
                      </Text>
                      <HStack>
                        {selectedSad.status !== 'Completed' && <Button size="sm" onClick={() => updateSadStatus(selectedSad.sad_no, 'Completed')} type="button">Mark Completed</Button>}
                        <Button size="sm" variant="outline" onClick={() => recalcTotalForSad(selectedSad.sad_no)} type="button">Recalc Discharged</Button>
                        <Button size="sm" onClick={() => generatePdfReport(selectedSad)} type="button">Print / Save PDF</Button>
                      </HStack>
                    </HStack>
                  </Box>
                )}

                <Text mb={2}>Declared weight: <strong>{Number(selectedSad.declared_weight || 0).toLocaleString()} kg</strong></Text>
                <Text mb={2}>Discharged: <strong>{Number(selectedSad.total_recorded_weight || 0).toLocaleString()} kg</strong></Text>
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
      <Modal isOpen={editModalOpen} onClose={cancelEditModal} size="md" isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Edit SAD {editFormSad?.sad_no}</ModalHeader>
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
                <FormLabel>Declared Weight (kg)</FormLabel>
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
            <Button variant="ghost" onClick={cancelEditModal} type="button">Cancel</Button>
            <Button colorScheme="blue" ml={3} onClick={onRequestSaveEdit} type="button">Save</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Save confirmation dialog */}
      <AlertDialog isOpen={saveConfirmOpen} leastDestructiveRef={saveCancelRef} onClose={() => setSaveConfirmOpen(false)}>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              Confirm Save
            </AlertDialogHeader>

            <AlertDialogBody>
              Are you sure you want to save changes to SAD {editFormSad?.sad_no}? This will update the SAD record.
            </AlertDialogBody>

            <AlertDialogFooter>
              <Button ref={saveCancelRef} onClick={() => setSaveConfirmOpen(false)} type="button">
                Cancel
              </Button>
              <Button colorScheme="red" onClick={performSaveEdit} ml={3} type="button">
                Yes, Save
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

      {/* Archive confirmation dialog */}
      <AlertDialog isOpen={archiveConfirmOpen} leastDestructiveRef={archiveCancelRef} onClose={() => setArchiveConfirmOpen(false)}>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              Archive SAD
            </AlertDialogHeader>

            <AlertDialogBody>
              Are you sure you want to archive SAD {archiveTarget}? This marks it as Archived.
            </AlertDialogBody>

            <AlertDialogFooter>
              <Button ref={archiveCancelRef} onClick={() => setArchiveConfirmOpen(false)} type="button">Cancel</Button>
              <Button colorScheme="red" onClick={confirmArchive} ml={3} type="button">Archive</Button>
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
                            onClick={() => {
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
