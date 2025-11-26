/* eslint-disable no-unused-vars */
/* eslint-disable react/jsx-no-undef */
// src/pages/AgentApptscreated.jsx
import { useEffect, useState, useRef } from 'react';
import {
  Box,
  Container,
  Heading,
  Stat,
  StatLabel,
  StatNumber,
  StatHelpText,
  SimpleGrid,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  VStack,
  Button,
  Input,
  Select,
  HStack,
  Text,
  useToast,
  Spinner,
  Flex,
  IconButton,
  Badge,
  Checkbox,
  Tooltip,
  Drawer,
  DrawerOverlay,
  DrawerContent,
  DrawerHeader,
  DrawerBody,
  DrawerFooter,
  DrawerCloseButton,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  MenuDivider,
  Textarea,
  Stack,
} from '@chakra-ui/react';
import {
  FaFileExport,
  FaSearch,
  FaEye,
  FaRedoAlt,
  FaEllipsisV,
  FaTrash,
  FaClone,
  FaFilePdf,
  FaListAlt,
  FaCheck,
  FaPrint,
} from 'react-icons/fa';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext'; // already present earlier

const MotionTr = motion(Tr);

function Sparkline({ data = [], width = 120, height = 28 }) {
  if (!Array.isArray(data) || data.length === 0) {
    return <svg width={width} height={height}><polyline points="" /></svg>;
  }
  const pad = 2;
  const w = Math.max(40, width);
  const h = Math.max(18, height);
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = (w - pad * 2) / Math.max(1, data.length - 1);
  const points = data.map((v, i) => {
    const x = pad + i * step;
    const y = pad + (1 - (v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  }).join(' ');
  const areaPath = `M ${pad} ${h - pad} L ${points.split(' ').map(p => p.split(',')[0] + ',' + p.split(',')[1]).join(' L ')} L ${w - pad} ${h - pad} Z`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path d={areaPath} fill="rgba(99,102,241,0.08)" stroke="none" />
      <polyline fill="none" stroke="rgba(99,102,241,0.95)" strokeWidth="1.6" points={points} />
    </svg>
  );
}

function exportToCSV(rows = [], filename = 'export.csv') {
  if (!rows || rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(','),
    ...rows.map((r) =>
      headers
        .map((h) => {
          let v = r[h];
          if (v === null || v === undefined) v = '';
          const s = String(v);
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
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

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

export default function AppointmentsPage() {
  const toast = useToast();
  const { user } = useAuth() || {};

  const [appointments, setAppointments] = useState([]);
  const [totalAppointments, setTotalAppointments] = useState(0);
  const [totalCompleted, setTotalCompleted] = useState(0);
  const [totalPosted, setTotalPosted] = useState(0);
  const [uniqueSADs, setUniqueSADs] = useState(0);

  const [loadingStats, setLoadingStats] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [searchQ, setSearchQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [pickupDateFilter, setPickupDateFilter] = useState('');
  const [totalPages, setTotalPages] = useState(1);

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [selectAllOnPage, setSelectAllOnPage] = useState(false);

  const [statusUpdating, setStatusUpdating] = useState({});

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeAppt, setActiveAppt] = useState(null);
  const [drawerT1s, setDrawerT1s] = useState([]);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [activityLogs, setActivityLogs] = useState([]);
  const [newComment, setNewComment] = useState('');

  const [alertsMap, setAlertsMap] = useState({});

  const [sparkAppointments, setSparkAppointments] = useState([]);
  const [sparkCompleted, setSparkCompleted] = useState([]);
  const [sparkPostedRatio, setSparkPostedRatio] = useState([]);

  const sadSubRef = useRef(null);

  const pageRef = useRef(page);
  pageRef.current = page;
  const pageSizeRef = useRef(pageSize);
  pageSizeRef.current = pageSize;
  const searchQRef = useRef(searchQ);
  searchQRef.current = searchQ;

  const formatDateISO = (d) => {
    if (!d) return null;
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return null;
    return dt.toISOString().slice(0, 10);
  };

  // Normalize status for display/logic: treat 'Imported' as 'Posted'
  const normalizeStatus = (s) => {
    if (!s) return s;
    const trimmed = String(s).trim();
    if (trimmed.toLowerCase() === 'imported') return 'Posted';
    return trimmed;
  };

  /* ---------- helper: verify SAD ownership ---------- */
  const verifyUserOwnsSads = async (sadNos = []) => {
    // Returns { ok: boolean, missing: string[] }
    const uniq = Array.from(new Set((sadNos || []).map(s => (s ? String(s).trim() : ''))).values()).filter(Boolean);
    if (!uniq.length) return { ok: true, missing: [] };
    try {
      const { data: rows, error } = await supabase
        .from('sad_declarations')
        .select('sad_no')
        .in('sad_no', uniq)
        .eq('created_by', user?.id || null)
        .limit(5000);
      if (error) {
        console.warn('verifyUserOwnsSads: db error', error);
        // fail-closed: do not permit if we can't verify
        return { ok: false, missing: uniq };
      }
      const ownedSet = new Set((rows || []).map(r => String(r.sad_no).trim()));
      const missing = uniq.filter(s => !ownedSet.has(s));
      return { ok: missing.length === 0, missing };
    } catch (e) {
      console.warn('verifyUserOwnsSads unexpected', e);
      return { ok: false, missing: uniq };
    }
  };

  const verifyUserOwnsSadsForAppointment = async (appointmentId) => {
    if (!appointmentId) return { ok: true, missing: [] };
    try {
      const { data: t1s, error } = await supabase.from('t1_records').select('sad_no').eq('appointment_id', appointmentId).limit(5000);
      if (error) {
        console.warn('verifyUserOwnsSadsForAppointment t1 fetch error', error);
        return { ok: false, missing: [] };
      }
      const sadNos = Array.from(new Set((t1s || []).map(r => r.sad_no).filter(Boolean)));
      return await verifyUserOwnsSads(sadNos);
    } catch (e) {
      console.warn('verifyUserOwnsSadsForAppointment unexpected', e);
      return { ok: false, missing: [] };
    }
  };

  // ---------- NEW: resolve PDF URL from appointments storage bucket ----------
  // Tries several common filename patterns inside bucket 'appointments' and returns a reachable public URL or null.
  const resolvePdfUrl = async (appt) => {
    if (!appt) return null;

    // 1) Already stored URL on record
    if (appt.pdf_url) return appt.pdf_url;

    // Candidate filenames / paths to try (common possibilities)
    const apptKey = appt.appointment_number || appt.appointmentNumber || appt.id || `${appt.id || Date.now()}`;
    const candidates = [
      // root level
      `${apptKey}.pdf`,
      `WeighbridgeTicket-${apptKey}.pdf`,
      `appointment-${apptKey}.pdf`,
      `appt-${apptKey}.pdf`,
      // tickets folder (some code used tickets/ previously)
      `tickets/${apptKey}.pdf`,
      `tickets/WeighbridgeTicket-${apptKey}.pdf`,
      `tickets/appointment-${apptKey}.pdf`,
    ];

    // also try with ID fallback
    if (appt.id && String(appt.id) !== String(apptKey)) {
      candidates.push(`${appt.id}.pdf`, `WeighbridgeTicket-${appt.id}.pdf`);
    }

    const bucket = 'appointments'; // per your instruction (NOT 'tickets' bucket)
    for (const path of candidates) {
      try {
        // get public URL via Supabase
        const { data } = supabase.storage.from(bucket).getPublicUrl(path);
        const publicUrl = data?.publicUrl || data?.public_url || null;
        if (!publicUrl) continue;

        // quick HEAD check to confirm file exists & is reachable
        try {
          // Try HEAD first
          const headResp = await fetch(publicUrl, { method: 'HEAD' });
          if (headResp && headResp.ok) {
            return publicUrl;
          }
          // Some hosts disallow HEAD; try GET but don't download body
          const getResp = await fetch(publicUrl, { method: 'GET' });
          if (getResp && getResp.ok) {
            return publicUrl;
          }
        } catch (e) {
          // fetch to publicUrl can fail due to CORS or being private; treat as miss
          // continue to next candidate
        }
      } catch (e) {
        // ignore and continue
        console.warn('resolvePdfUrl: candidate check failed for', path, e);
      }
    }

    // not found
    return null;
  };

  // Opens appointment PDF if available in record or storage; otherwise returns false
  const openPdfForAppointment = async (appt) => {
    if (!appt || !appt.id) {
      toast({ title: 'No appointment selected', status: 'info' });
      return false;
    }

    // fast path: pdf_url present
    if (appt.pdf_url) {
      window.open(appt.pdf_url, '_blank');
      return true;
    }

    // try to resolve using storage bucket
    try {
      const url = await resolvePdfUrl(appt);
      if (url) {
        // persist to DB for quick next time (best-effort)
        try {
          await supabase.from('appointments').update({ pdf_url: url }).eq('id', appt.id);
          // update local UI state
          setAppointments(prev => prev.map(p => p.id === appt.id ? { ...p, pdf_url: url } : p));
          setActiveAppt(prev => prev && prev.id === appt.id ? { ...prev, pdf_url: url } : prev);
        } catch (e) { /* ignore update failure */ }

        window.open(url, '_blank');
        return true;
      }
    } catch (e) {
      console.warn('openPdfForAppointment: resolve failed', e);
    }

    // nothing found
    toast({ title: 'No PDF found in storage', description: 'You can regenerate the PDF (Reprint) below', status: 'info' });
    return false;
  };

  /**
   * Reprint / regenerate PDF for an appointment
   * - If appt.pdf_url exists, just open it
   * - Otherwise, call backend endpoint to generate the PDF and stream/download it.
   * - This action is allowed even for Completed appointments (view/print)
   */
  const reprintAppointment = async (appt) => {
    if (!appt || !appt.id) {
      toast({ title: 'No appointment selected', status: 'info' });
      return;
    }

    // First try to open existing stored PDF (appointments bucket)
    try {
      const opened = await openPdfForAppointment(appt);
      if (opened) return;
    } catch (e) {
      // ignore - we'll attempt regeneration
    }

    setDrawerLoading(true);
    try {
      // call server endpoint to (re)generate PDF. Your server can upload into storage and return url.
      const res = await fetch(`/api/appointments/${appt.id}/pdf`, { method: 'POST' });

      if (!res.ok) {
        let msg = `${res.status} ${res.statusText}`;
        try { msg = await res.text(); } catch (e) {}
        throw new Error(msg);
      }

      const contentType = res.headers.get('content-type') || '';
      // endpoint may respond with JSON including a public URL (recommended)
      if (contentType.includes('application/json')) {
        const json = await res.json();
        if (json.url) {
          // persist URL locally & in DB
          try {
            await supabase.from('appointments').update({ pdf_url: json.url }).eq('id', appt.id);
            setActiveAppt(prev => prev ? { ...prev, pdf_url: json.url } : prev);
            setAppointments(prev => prev.map(p => p.id === appt.id ? { ...p, pdf_url: json.url } : p));
          } catch (e) { /* ignore persisting errors */ }
          window.open(json.url, '_blank');
          toast({ title: 'PDF ready', status: 'success' });
          return;
        }
      }

      // otherwise response is binary PDF; download it client-side
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `WeighbridgeTicket-${appt.appointment_number || appt.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      // server may include generated URL header
      const pubUrl = res.headers.get('x-generated-pdf-url');
      if (pubUrl) {
        try {
          await supabase.from('appointments').update({ pdf_url: pubUrl }).eq('id', appt.id);
          setActiveAppt(prev => prev ? { ...prev, pdf_url: pubUrl } : prev);
          setAppointments(prev => prev.map(p => p.id === appt.id ? { ...p, pdf_url: pubUrl } : p));
        } catch (e) { /* ignore */ }
      }

      toast({ title: 'PDF generated', status: 'success' });
    } catch (e) {
      console.error('reprintAppointment failed', e);
      toast({ title: 'Generate PDF failed', description: e?.message || String(e), status: 'error' });
    } finally {
      setDrawerLoading(false);
    }
  };

  /* ---------- Fetch stats + sparklines + uniqueSADs + alerts ---------- */
  const fetchStats = async () => {
    setLoadingStats(true);
    try {
      // restrict to user unless admin
      const restrictToUser = !(user && user.role === 'admin');
      // total appointments (for this user)
      let totalQ = supabase.from('appointments').select('id', { count: 'exact', head: true });
      if (restrictToUser && user?.id) totalQ = totalQ.eq('created_by', user.id);
      const totalResp = await totalQ;
      const total = Number(totalResp?.count || 0);
      setTotalAppointments(total);

      // completed
      let compQ = supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('status', 'Completed');
      if (restrictToUser && user?.id) compQ = compQ.eq('created_by', user.id);
      const compResp = await compQ;
      setTotalCompleted(Number(compResp?.count || 0));

      // posted (treat Imported as Posted -> include both)
      let postedQ = supabase.from('appointments').select('id', { count: 'exact', head: true }).in('status', ['Posted', 'Imported']);
      if (restrictToUser && user?.id) postedQ = postedQ.eq('created_by', user.id);
      const postedResp = await postedQ;
      setTotalPosted(Number(postedResp?.count || 0));

      // unique SADs from t1_records (user-restricted unless admin)
      try {
        if (restrictToUser && user?.id) {
          // Only count SADs for appointments created by this user
          const { data: myAppts, error: myApptsErr } = await supabase
            .from('appointments')
            .select('id')
            .eq('created_by', user.id)
            .limit(5000);
          if (myApptsErr) {
            console.warn('Could not fetch user appointments for unique SAD calc', myApptsErr);
            setUniqueSADs(0);
          } else {
            const apptIds = Array.isArray(myAppts) ? myAppts.map(r => r.id).filter(Boolean) : [];
            if (!apptIds.length) {
              setUniqueSADs(0);
            } else {
              const { data: t1rows, error: t1err } = await supabase
                .from('t1_records')
                .select('sad_no')
                .in('appointment_id', apptIds)
                .limit(5000);
              if (t1err) {
                console.warn('Could not fetch t1_records for unique SAD count (user)', t1err);
                setUniqueSADs(0);
              } else {
                const s = new Set((t1rows || []).map(r => (r.sad_no ? String(r.sad_no).trim() : null)).filter(Boolean));
                setUniqueSADs(s.size);
              }
            }
          }
        } else {
          // admin / system-wide count
          const { data: t1rows, error: t1err } = await supabase
            .from('t1_records')
            .select('sad_no')
            .limit(5000);
          if (t1err) {
            console.warn('Could not fetch t1_records for unique SAD count', t1err);
            setUniqueSADs(0);
          } else {
            const s = new Set((t1rows || []).map(r => (r.sad_no ? String(r.sad_no).trim() : null)).filter(Boolean));
            setUniqueSADs(s.size);
          }
        }
      } catch (innerErr) {
        console.warn('unique sad fetch err', innerErr);
        setUniqueSADs(0);
      }

      // KPIs last 7 days (only using created appointments for this user unless admin)
      try {
        const days = 7;
        const today = new Date();
        const dayStarts = [];
        for (let i = days - 1; i >= 0; i--) {
          const d = new Date(today);
          d.setDate(today.getDate() - i);
          dayStarts.push(formatDateISO(d));
        }

        const startDate = dayStarts[0] + 'T00:00:00Z';
        let q = supabase.from('appointments').select('id, created_at, status').gte('created_at', startDate).order('created_at', { ascending: true }).limit(5000);
        if (restrictToUser && user?.id) q = q.eq('created_by', user.id);

        const { data: recentAppts } = await q;

        const createdCounts = dayStarts.map(() => 0);
        const completedCounts = dayStarts.map(() => 0);
        const postedCounts = dayStarts.map(() => 0);

        if (Array.isArray(recentAppts)) {
          for (const a of recentAppts) {
            const dISO = formatDateISO(a.created_at);
            const idx = dayStarts.indexOf(dISO);
            if (idx >= 0) {
              createdCounts[idx] += 1;
            }
            const s = normalizeStatus(a.status);
            if (idx >= 0 && s === 'Completed') completedCounts[idx] += 1;
            if (idx >= 0 && s === 'Posted') postedCounts[idx] += 1;
          }
        }

        setSparkAppointments(createdCounts);
        setSparkCompleted(completedCounts);
        const postedRatio = dayStarts.map((_, i) => {
          const c = createdCounts[i] || 0;
          return c === 0 ? 0 : Math.round((postedCounts[i] / c) * 100);
        });
        setSparkPostedRatio(postedRatio);
      } catch (e) {
        console.warn('sparkline calc failed', e);
        setSparkAppointments([]);
        setSparkCompleted([]);
        setSparkPostedRatio([]);
      }

    } catch (err) {
      console.error('fetchStats', err);
      toast({ title: 'Failed to load stats', description: err?.message || 'Unexpected', status: 'error' });
    } finally {
      setLoadingStats(false);
    }
  };

  /**
   * fetchAppointments
   * - supports searching by SAD (searches t1_records.sad_no) and regular fields
   * - when searchQ matches SADs, we combine appointment ids found via t1_records with appointments found via direct fields
   * - implements pagination by slicing the resulting ids and fetching those appointment rows
   *
   * Important fixes:
   *  - When restricting to user (non-admin), ids discovered from t1_records are filtered to only appointment IDs created_by the user.
   *  - Default status options exclude 'Imported' visually; internally Imported is treated as Posted (counts & filter include it).
   */
  const fetchAppointments = async ({ page: p = pageRef.current, size = pageSizeRef.current, q = searchQRef.current, status = statusFilter, pickup = pickupDateFilter } = {}) => {
    setLoadingList(true);
    try {
      if (!user) {
        setAppointments([]);
        setTotalPages(1);
        setLoadingList(false);
        return;
      }

      const from = (p - 1) * size;
      const to = p * size - 1;

      const restrictToUser = !(user && user.role === 'admin');

      const qTrim = q && q.toString().trim();

      // If there is a free-text query, try to find matching appointment IDs from t1_records (SAD search)
      let idsFromT1 = [];
      if (qTrim) {
        try {
          const { data: t1Matches, error: t1Err } = await supabase
            .from('t1_records')
            .select('appointment_id')
            .ilike('sad_no', `%${qTrim}%`)
            .limit(2000);
          if (!t1Err && Array.isArray(t1Matches)) {
            idsFromT1 = Array.from(new Set(t1Matches.map(r => r.appointment_id).filter(Boolean)));
          }
        } catch (e) {
          console.warn('t1_records search failed', e);
          idsFromT1 = [];
        }

        // IMPORTANT: if restricting to user, filter these appointment ids to only those created_by = user.id
        if (restrictToUser && idsFromT1.length) {
          try {
            const { data: ownedRows, error: ownedErr } = await supabase
              .from('appointments')
              .select('id')
              .in('id', idsFromT1)
              .eq('created_by', user.id)
              .limit(2000);
            if (!ownedErr && Array.isArray(ownedRows)) {
              const allowed = new Set(ownedRows.map(r => r.id));
              idsFromT1 = idsFromT1.filter(id => allowed.has(id));
            } else {
              // if error, empty the list so we don't leak other user's appointments
              idsFromT1 = [];
            }
          } catch (e) {
            console.warn('filtering idsFromT1 by created_by failed', e);
            idsFromT1 = [];
          }
        }
      }

      // Next, find appointments that match the standard appointment fields (appointment_number, weighbridge_number, agent_name, truck_number, driver_name)
      let directAppointments = [];
      let directCount = 0;
      if (qTrim) {
        try {
          const escaped = qTrim.replace(/"/g, '\\"');
          const orFilter = `appointment_number.ilike.%${escaped}%,weighbridge_number.ilike.%${escaped}%,agent_name.ilike.%${escaped}%,truck_number.ilike.%${escaped}%,driver_name.ilike.%${escaped}%`;
          let directQ = supabase.from('appointments').select('id', { count: 'exact', head: true }).or(orFilter);
          if (restrictToUser && user?.id) directQ = directQ.eq('created_by', user.id);
          if (status) {
            if (status === 'Posted') directQ = directQ.in('status', ['Posted', 'Imported']);
            else directQ = directQ.eq('status', status);
          }
          if (pickup) directQ = directQ.eq('pickup_date', pickup);
          const resp = await directQ;
          if (!resp.error) {
            directCount = Number(resp.count || 0);
          }
          // fetch ids (we need actual ids list)
          let idRowsQ = supabase.from('appointments').select('id').or(orFilter).order('created_at', { ascending: false }).limit(2000);
          if (restrictToUser && user?.id) idRowsQ = idRowsQ.eq('created_by', user.id);
          if (status) {
            if (status === 'Posted') idRowsQ = idRowsQ.in('status', ['Posted', 'Imported']);
            else idRowsQ = idRowsQ.eq('status', status);
          }
          if (pickup) idRowsQ = idRowsQ.eq('pickup_date', pickup);
          const idRowsResp = await idRowsQ;
          if (!idRowsResp.error && Array.isArray(idRowsResp.data)) {
            directAppointments = Array.from(new Set(idRowsResp.data.map(r => r.id).filter(Boolean)));
          }
        } catch (e) {
          console.warn('direct appointment search failed', e);
          directAppointments = [];
          directCount = 0;
        }
      }

      // If there is no search term, use the standard paginated query
      if (!qTrim) {
        let baseQuery = supabase.from('appointments').select('*, t1_records(id, sad_no)', { count: 'exact' });
        if (restrictToUser) baseQuery = baseQuery.eq('created_by', user.id);
        if (status) {
          if (status === 'Posted') baseQuery = baseQuery.in('status', ['Posted', 'Imported']);
          else baseQuery = baseQuery.eq('status', status);
        }
        if (pickup) baseQuery = baseQuery.eq('pickup_date', pickup);
        baseQuery = baseQuery.order('created_at', { ascending: false }).range(from, to);
        const resp = await baseQuery;
        if (resp.error) throw resp.error;
        const dataRaw = resp.data || [];
        // normalize statuses locally so UI treats 'Imported' as 'Posted'
        const data = dataRaw.map(r => ({ ...r, status: normalizeStatus(r.status) }));
        const count = Number(resp.count || 0);
        setAppointments(data);
        setTotalPages(Math.max(1, Math.ceil(count / size)));

        // alerts calc (same as before, but treat Imported as Posted when checking)
        const alerts = {};
        const apptNumbers = data.map(a => a.appointment_number).filter(Boolean);
        const dupMap = {};
        for (const n of apptNumbers) dupMap[n] = (dupMap[n] || 0) + 1;
        const dupCandidates = Object.keys(dupMap).filter(k => dupMap[k] > 1);
        const globalDupCounts = {};
        if (dupCandidates.length) {
          try {
            for (const key of dupCandidates) {
              const { count } = await supabase.from('appointments').select('id', { head: true, count: 'exact' }).eq('appointment_number', key);
              globalDupCounts[key] = Number(count || 0);
            }
          } catch (e) { /* ignore */ }
        }
        for (const a of data) {
          const id = a.id;
          alerts[id] = [];
          if (a.pickup_date) {
            const pickupIso = formatDateISO(a.pickup_date);
            const todayIso = formatDateISO(new Date());
            if (pickupIso && todayIso && pickupIso < todayIso && (normalizeStatus(a.status) || '').toLowerCase() === 'posted') {
              alerts[id].push('pickup_overdue');
            }
          }
          const num = a.appointment_number;
          const globalCount = (num && globalDupCounts[num]) ? globalDupCounts[num] : (num && dupMap[num] ? dupMap[num] : 1);
          if (num && Number(globalCount) > 1) alerts[id].push('duplicate_booking');
          if (a.driver_license_expiry) {
            const expiry = new Date(a.driver_license_expiry);
            if (!isNaN(expiry.getTime())) {
              const now = new Date();
              const diffDays = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
              if (diffDays <= 30) alerts[id].push('driver_license_expiring');
            }
          }
          const t1count = Array.isArray(a.t1_records) ? a.t1_records.length : (a.total_t1s || 0);
          if (!t1count || Number(t1count) === 0) alerts[id].push('no_t1_records');
        }
        setAlertsMap(alerts);
        setLoadingList(false);
        return;
      }

      // When qTrim exists: combine idsFromT1 and directAppointments
      const combinedIdSet = new Set([...(idsFromT1 || []), ...(directAppointments || [])].filter(Boolean));

      // If there's no combined ids, show empty results
      if (combinedIdSet.size === 0) {
        setAppointments([]);
        setTotalPages(1);
        setAlertsMap({});
        setLoadingList(false);
        return;
      }

      // convert to array and sort by created_at desc by fetching small metadata (we'll fetch full rows later)
      const combinedIdsArr = Array.from(combinedIdSet);

      // total count is combined length
      const totalCount = combinedIdsArr.length;
      setTotalPages(Math.max(1, Math.ceil(totalCount / size)));

      // pick ids for the requested page
      const idsForPage = combinedIdsArr.slice(from, to + 1);
      // fetch those appointment rows with their T1 records
      let fetchQ = supabase.from('appointments').select('*, t1_records(id, sad_no)').in('id', idsForPage).order('created_at', { ascending: false });
      if (restrictToUser) fetchQ = fetchQ.eq('created_by', user.id);
      const fetchResp = await fetchQ;
      if (fetchResp.error) throw fetchResp.error;
      const fetchedRowsRaw = fetchResp.data || [];

      // Because .in doesn't guarantee order, sort fetchedRows using index in idsForPage
      const ordered = idsForPage.map(id => fetchedRowsRaw.find(r => r.id === id)).filter(Boolean)
        .map(r => ({ ...r, status: normalizeStatus(r.status) })); // normalize

      setAppointments(ordered);
      setTotalPages(Math.max(1, Math.ceil(totalCount / size)));

      // alerts calculation for page rows
      const alerts = {};
      const apptNumbers = ordered.map(a => a.appointment_number).filter(Boolean);
      const dupMap = {};
      for (const n of apptNumbers) dupMap[n] = (dupMap[n] || 0) + 1;
      const dupCandidates = Object.keys(dupMap).filter(k => dupMap[k] > 1);
      const globalDupCounts = {};
      if (dupCandidates.length) {
        try {
          for (const key of dupCandidates) {
            const { count } = await supabase.from('appointments').select('id', { head: true, count: 'exact' }).eq('appointment_number', key);
            globalDupCounts[key] = Number(count || 0);
          }
        } catch (e) { /* ignore */ }
      }
      for (const a of ordered) {
        const id = a.id;
        alerts[id] = [];
        if (a.pickup_date) {
          const pickupIso = formatDateISO(a.pickup_date);
          const todayIso = formatDateISO(new Date());
          if (pickupIso && todayIso && pickupIso < todayIso && (normalizeStatus(a.status) || '').toLowerCase() === 'posted') {
            alerts[id].push('pickup_overdue');
          }
        }
        const num = a.appointment_number;
        const globalCount = (num && globalDupCounts[num]) ? globalDupCounts[num] : (num && dupMap[num] ? dupMap[num] : 1);
        if (num && Number(globalCount) > 1) alerts[id].push('duplicate_booking');
        if (a.driver_license_expiry) {
          const expiry = new Date(a.driver_license_expiry);
          if (!isNaN(expiry.getTime())) {
            const now = new Date();
            const diffDays = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
            if (diffDays <= 30) alerts[id].push('driver_license_expiring');
          }
        }
        const t1count = Array.isArray(a.t1_records) ? a.t1_records.length : (a.total_t1s || 0);
        if (!t1count || Number(t1count) === 0) alerts[id].push('no_t1_records');
      }
      setAlertsMap(alerts);
    } catch (err) {
      console.error('fetchAppointments', err);
      toast({ title: 'Failed to load appointments', description: err?.message || 'Unexpected', status: 'error' });
      setAppointments([]);
      setTotalPages(1);
    } finally {
      setLoadingList(false);
    }
  };

  const handleSadDeclarationChange = async (newRow) => {
    try {
      if (!newRow || !newRow.sad_no) return;
      const sadNo = String(newRow.sad_no).trim();
      const newStatus = String(newRow.status || '').trim();

      let targetApptStatus = null;
      if (newStatus === 'In Progress') targetApptStatus = 'Posted';
      else if (newStatus === 'Completed') targetApptStatus = 'Completed';
      else return;

      const { data: t1s, error: t1err } = await supabase.from('t1_records').select('appointment_id').eq('sad_no', sadNo).limit(5000);
      if (t1err) {
        console.warn('finding appointment ids for sad sync failed', t1err);
        return;
      }
      const apptIds = Array.from(new Set((t1s || []).map(r => r.appointment_id).filter(Boolean)));
      if (!apptIds.length) return;

      if (targetApptStatus === 'Posted') {
        const { error: updErr } = await supabase.from('appointments')
          .update({ status: 'Posted', updated_at: new Date().toISOString() })
          .in('id', apptIds)
          .neq('status', 'Completed');
        if (updErr) throw updErr;
      } else {
        // mark related appointments Completed
        const { error: updErr } = await supabase.from('appointments')
          .update({ status: 'Completed', updated_at: new Date().toISOString() })
          .in('id', apptIds);
        if (updErr) throw updErr;
      }

      try {
        const logs = apptIds.map(id => ({
          appointment_id: id,
          changed_by: null,
          action: 'sad_status_sync',
          message: `SAD ${sadNo} status -> ${newStatus}`,
          created_at: new Date().toISOString(),
        }));
        await runInBatches(logs, 50, async (rec) => supabase.from('appointment_logs').insert([rec]));
      } catch (e) { /* ignore logging errors */ }

      await fetchStats();
      await fetchAppointments({ page: pageRef.current, size: pageSizeRef.current, q: searchQRef.current });
      toast({ title: `SAD ${sadNo} → ${newStatus}`, description: `Synced ${apptIds.length} appointment(s) to ${targetApptStatus}`, status: 'info' });
    } catch (err) {
      console.error('handleSadDeclarationChange', err);
    }
  };

  useEffect(() => {
    try {
      if (supabase.channel) {
        const ch = supabase.channel('public:sad_declarations')
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sad_declarations' }, (payload) => {
            const newRow = payload?.new;
            handleSadDeclarationChange(newRow);
          })
          .subscribe();
        sadSubRef.current = ch;
      } else {
        const s = supabase.from('sad_declarations').on('UPDATE', (payload) => {
          const newRow = payload?.new;
          handleSadDeclarationChange(newRow);
        }).subscribe();
        sadSubRef.current = s;
      }
    } catch (e) {
      console.warn('subscribe sadness', e);
    }

    return () => {
      try {
        if (sadSubRef.current && supabase.removeChannel) {
          supabase.removeChannel(sadSubRef.current).catch(() => {});
        } else if (sadSubRef.current && sadSubRef.current.unsubscribe) {
          sadSubRef.current.unsubscribe();
        }
      } catch (e) { /* ignore */ }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // once

  useEffect(() => {
    // whenever user changes (login), reload restricted data
    fetchStats();
    fetchAppointments({ page: 1, size: pageSize });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    fetchAppointments({ page, size: pageSize });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, statusFilter, pickupDateFilter]);

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      fetchAppointments({ page: 1, size: pageSize, q: searchQ });
    }, 380);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQ]);

  const openDrawer = async (appointment) => {
    setActiveAppt(appointment);
    setDrawerOpen(true);
    setDrawerLoading(true);
    try {
      const apptId = appointment.id;
      const [t1res, logsRes] = await Promise.allSettled([
        supabase.from('t1_records').select('*').eq('appointment_id', apptId).order('created_at', { ascending: true }),
        supabase.from('appointment_logs').select('*').eq('appointment_id', apptId).order('created_at', { ascending: false }),
      ]);
      const t1s = t1res.status === 'fulfilled' ? t1res.value.data || [] : [];
      const logs = logsRes.status === 'fulfilled' ? logsRes.value.data || [] : [];
      setDrawerT1s(t1s);
      setActivityLogs(logs);
    } catch (err) {
      console.error('openDrawer', err);
      toast({ title: 'Failed to open details', description: err?.message || 'Unexpected', status: 'error' });
      setDrawerT1s([]);
      setActivityLogs([]);
    } finally {
      setDrawerLoading(false);
    }
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setActiveAppt(null);
    setDrawerT1s([]);
    setActivityLogs([]);
    setNewComment('');
  };

  const addAppointmentComment = async (appointmentId, message) => {
    if (!message || !appointmentId) return;
    try {
      const payload = {
        appointment_id: appointmentId,
        changed_by: user?.id || null,
        action: 'comment',
        message,
        created_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('appointment_logs').insert([payload]);
      if (error) throw error;
      const { data: logs } = await supabase.from('appointment_logs').select('*').eq('appointment_id', appointmentId).order('created_at', { ascending: false });
      setActivityLogs(logs || []);
      setNewComment('');
      toast({ title: 'Comment added', status: 'success' });
    } catch (err) {
      console.error('add comment', err);
      toast({ title: 'Failed to add comment', description: err?.message || 'Unexpected', status: 'error' });
    }
  };

  // helper: show friendly closed message and return true if closed
  const isAppointmentClosed = (appt) => {
    if (!appt) return false;
    return normalizeStatus(appt.status) === 'Completed';
  };
  const closedMessage = () => {
    toast({
      title: 'This appointment has been closed',
      description: 'Contact App Support for guidance',
      status: 'info',
      duration: 6000,
      isClosable: true,
    });
  };

  const handleChangeStatus = async (apptId, newStatus) => {
    // disallow other statuses than Posted/Completed
    if (!['Posted', 'Completed'].includes(newStatus)) {
      toast({ title: 'Invalid status', description: 'Only Posted and Completed statuses are allowed', status: 'error' });
      return;
    }

    // Fetch appointment locally to check status before attempting update
    const before = (appointments.find(a => a.id === apptId)) || null;
    if (before && isAppointmentClosed(before) && String(newStatus).trim() !== 'Completed') {
      // prevented re-opening or other changes on closed appts
      closedMessage();
      return;
    }

    if (!user || user.role !== 'admin') {
      toast({ title: 'Permission denied', description: 'Only admins can change appointment status', status: 'error' });
      return;
    }
    setStatusUpdating(prev => ({ ...prev, [apptId]: true }));
    // optimistic update
    setAppointments(prev => prev.map(a => (a.id === apptId ? { ...a, status: newStatus } : a)));
    try {
      // try update on DB
      const { error } = await supabase.from('appointments').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', apptId);
      if (error) throw error;
      try {
        await supabase.from('appointment_logs').insert([{
          appointment_id: apptId,
          changed_by: user?.id || null,
          action: 'status_change',
          before: before ? JSON.stringify({ status: normalizeStatus(before.status) }) : null,
          after: JSON.stringify({ status: newStatus }),
          created_at: new Date().toISOString(),
        }]);
      } catch (e) { console.warn('log write failed', e); }
      toast({ title: 'Status updated', description: `Appointment status set to ${newStatus}`, status: 'success' });
      fetchStats();
      fetchAppointments({ page, size: pageSize, q: searchQ });
    } catch (err) {
      console.error('update status', err);
      toast({ title: 'Update failed', description: err?.message || 'Could not update status', status: 'error' });
      fetchAppointments({ page, size: pageSize, q: searchQ });
      fetchStats();
    } finally {
      setStatusUpdating(prev => ({ ...prev, [apptId]: false }));
    }
  };

  const markAsCompleted = async (appt) => {
    if (!appt || !appt.id) return;
    if (isAppointmentClosed(appt)) {
      closedMessage();
      return;
    }
    await handleChangeStatus(appt.id, 'Completed');
  };

  const cloneAppointment = async (appt) => {
    if (!appt) return;
    if (isAppointmentClosed(appt)) {
      closedMessage();
      return;
    }

    // verify ownership of all SADs in this appointment before allowing clone/create
    if (!(user && user.role === 'admin')) {
      const { ok, missing } = await verifyUserOwnsSadsForAppointment(appt.id);
      if (!ok) {
        toast({
          title: 'Forbidden: unauthorized SAD(s)',
          description: missing && missing.length ? `You did not register these SAD(s): ${missing.slice(0,6).join(', ')}${missing.length > 6 ? ` +${missing.length-6}` : ''}` : 'Unable to verify SAD ownership',
          status: 'error',
          duration: 8000,
        });
        return;
      }
    }

    try {
      const newApptNumber = `${appt.appointment_number}-CLONE-${Date.now()}`;
      const payload = {
        appointment_number: newApptNumber,
        weighbridge_number: appt.weighbridge_number,
        agent_tin: appt.agent_tin,
        agent_name: appt.agent_name,
        warehouse_location: appt.warehouse_location,
        pickup_date: appt.pickup_date,
        consolidated: appt.consolidated,
        truck_number: appt.truck_number,
        driver_name: appt.driver_name,
        driver_license_no: appt.driver_license_no,
        total_t1s: appt.total_t1s,
        total_documented_weight: appt.total_documented_weight,
        regime: appt.regime,
        pdf_url: appt.pdf_url,
        status: 'Posted', // cloned appt becomes Posted (not Imported)
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: user?.id || null, // clone belongs to the current user (important)
      };
      const { data: newRow, error } = await supabase.from('appointments').insert([payload]).select().single();
      if (error) throw error;

      // clone T1s: fetch original T1s and insert new rows pointing to newRow.id
      try {
        const { data: originalT1s } = await supabase.from('t1_records').select('sad_no, packing_type, container_no').eq('appointment_id', appt.id).order('created_at', { ascending: true });
        if (Array.isArray(originalT1s) && originalT1s.length) {
          const t1Rows = originalT1s.map(t => ({
            appointment_id: newRow.id,
            sad_no: t.sad_no,
            packing_type: t.packing_type,
            container_no: t.container_no ?? null,
            created_at: new Date().toISOString(),
          }));
          const { error: t1err } = await supabase.from('t1_records').insert(t1Rows);
          if (t1err) {
            console.warn('Failed to insert cloned T1s', t1err);
          }
        }
      } catch (e) { console.warn('clone t1 fetch/insert failed', e); }

      try { await supabase.from('appointment_logs').insert([{ appointment_id: newRow.id, changed_by: user?.id || null, action: 'clone', message: `Cloned from ${appt.appointment_number}`, created_at: new Date().toISOString(), before: JSON.stringify(appt), after: JSON.stringify(newRow) }]); } catch (e) { /* ignore */ }
      toast({ title: 'Cloned', description: `Appointment cloned as ${newRow.appointment_number}`, status: 'success' });
      fetchStats();
      fetchAppointments({ page: 1, size: pageSize, q: searchQ });
    } catch (err) {
      console.error('clone', err);
      toast({ title: 'Clone failed', description: err?.message || 'Unexpected', status: 'error' });
    }
  };

  const deleteAppointment = async (appt) => {
    if (!user || user.role !== 'admin') {
      toast({ title: 'Permission denied', description: 'Only admins can delete appointments', status: 'error' });
      return;
    }
    if (!appt || !appt.id) return;
    if (isAppointmentClosed(appt)) {
      closedMessage();
      return;
    }
    const ok = window.confirm(`Delete appointment ${appt.appointment_number}? This will remove the appointment and its T1 records (if cascade).`);
    if (!ok) return;
    try {
      const { error } = await supabase.from('appointments').delete().eq('id', appt.id);
      if (error) throw error;
      try { await supabase.from('appointment_logs').insert([{ appointment_id: appt.id, changed_by: user?.id || null, action: 'delete', message: `Deleted appointment ${appt.appointment_number}`, created_at: new Date().toISOString(), before: JSON.stringify(appt) }]); } catch (e) { /* ignore */ }
      toast({ title: 'Deleted', description: `Appointment ${appt.appointment_number} deleted`, status: 'success' });
      fetchStats();
      fetchAppointments({ page: 1, size: pageSize, q: searchQ });
    } catch (err) {
      console.error('delete', err);
      toast({ title: 'Delete failed', description: err?.message || 'Unexpected', status: 'error' });
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  };

  const handleSelectAllOnPage = () => {
    if (selectAllOnPage) {
      setSelectedIds(prev => {
        const s = new Set(prev);
        appointments.forEach(a => s.delete(a.id));
        return s;
      });
      setSelectAllOnPage(false);
    } else {
      setSelectedIds(prev => {
        const s = new Set(prev);
        appointments.forEach(a => s.add(a.id));
        return s;
      });
      setSelectAllOnPage(true);
    }
  };

  const bulkMarkCompleted = async () => {
    if (!selectedIds.size) { toast({ title: 'No appointments selected', status: 'info' }); return; }
    if (!user || user.role !== 'admin') { toast({ title: 'Permission denied', status: 'error' }); return; }
    const ids = Array.from(selectedIds);
    // filter out already closed
    const actionable = appointments.filter(a => ids.includes(a.id) && !isAppointmentClosed(a)).map(a => a.id);
    if (actionable.length === 0) {
      toast({ title: 'No selected appointments are actionable (already closed)', status: 'info' });
      return;
    }
    const ok = window.confirm(`Mark ${actionable.length} appointment(s) as Completed?`);
    if (!ok) return;
    try {
      const { error } = await supabase.from('appointments').update({ status: 'Completed', updated_at: new Date().toISOString() }).in('id', actionable);
      if (error) throw error;
      try {
        const logs = actionable.map(id => ({ appointment_id: id, changed_by: user?.id || null, action: 'status_change', before: null, after: JSON.stringify({ status: 'Completed' }), created_at: new Date().toISOString() }));
        await runInBatches(logs, 50, async (rec) => supabase.from('appointment_logs').insert([rec]));
      } catch (e) { /* ignore */ }
      toast({ title: 'Marked completed', status: 'success' });
      setSelectedIds(new Set());
      fetchStats();
      fetchAppointments({ page, size: pageSize, q: searchQ });
    } catch (err) {
      console.error('bulk complete', err);
      toast({ title: 'Bulk update failed', description: err?.message || 'Unexpected', status: 'error' });
    }
  };

  const bulkExportSelected = async () => {
    if (!selectedIds.size) { toast({ title: 'No appointments selected', status: 'info' }); return; }
    const ids = Array.from(selectedIds);
    const rows = appointments.filter(a => ids.includes(a.id)).map(a => ({
      appointment_number: a.appointment_number,
      weighbridge_number: a.weighbridge_number,
      agent_name: a.agent_name,
      pickup_date: a.pickup_date,
      truck_number: a.truck_number,
      total_t1s: Array.isArray(a.t1_records) ? a.t1_records.length : a.total_t1s,
      status: normalizeStatus(a.status),
      created_at: a.created_at,
    }));
    if (!rows.length) { toast({ title: 'No rows available to export', status: 'info' }); return; }
    exportToCSV(rows, `appointments_selected_${new Date().toISOString().slice(0,10)}.csv`);
    toast({ title: 'Export started', status: 'success' });
  };

  const bulkDeleteSelected = async () => {
    if (!selectedIds.size) { toast({ title: 'No appointments selected', status: 'info' }); return; }
    if (!user || user.role !== 'admin') { toast({ title: 'Permission denied', status: 'error' }); return; }
    const ids = Array.from(selectedIds);
    // filter out closed appointments
    const actionable = appointments.filter(a => ids.includes(a.id) && !isAppointmentClosed(a)).map(a => a.id);
    if (actionable.length === 0) {
      toast({ title: 'No selected appointments can be deleted (already closed)', status: 'info' });
      return;
    }
    const ok = window.confirm(`Delete ${actionable.length} selected appointments? This is destructive.`);
    if (!ok) return;
    try {
      const { error } = await supabase.from('appointments').delete().in('id', actionable);
      if (error) throw error;
      try {
        const logs = actionable.map(id => ({ appointment_id: id, changed_by: user?.id || null, action: 'bulk_delete', message: `Bulk delete by ${user?.id}`, created_at: new Date().toISOString() }));
        await runInBatches(logs, 50, async (rec) => supabase.from('appointment_logs').insert([rec]));
      } catch (e) { /* ignore */ }
      toast({ title: 'Deleted', description: `${actionable.length} appointment(s) deleted`, status: 'success' });
      setSelectedIds(new Set());
      fetchStats();
      fetchAppointments({ page: 1, size: pageSize, q: searchQ });
    } catch (err) {
      console.error('bulk delete', err);
      toast({ title: 'Bulk delete failed', description: err?.message || 'Unexpected', status: 'error' });
    }
  };

  const handleExportFilteredCSV = async () => {
    try {
      let q = supabase.from('appointments').select('id,appointment_number,weighbridge_number,agent_tin,agent_name,warehouse_location,pickup_date,consolidated,truck_number,driver_name,total_t1s,total_documented_weight,status,created_at,updated_at').order('created_at', { ascending: false }).limit(5000);

      const restrictToUser = !(user && user.role === 'admin');
      if (restrictToUser && user?.id) q = q.eq('created_by', user.id);

      if (searchQ && searchQ.trim()) {
        const escaped = searchQ.trim().replace(/"/g, '\\"');
        const orFilter = `appointment_number.ilike.%${escaped}%,weighbridge_number.ilike.%${escaped}%,agent_name.ilike.%${escaped}%,truck_number.ilike.%${escaped}%`;
        q = q.or(orFilter);
      }
      if (statusFilter) {
        if (statusFilter === 'Posted') q = q.in('status', ['Posted', 'Imported']);
        else q = q.eq('status', statusFilter);
      }
      if (pickupDateFilter) q = q.eq('pickup_date', pickupDateFilter);

      const { data, error } = await q;
      if (error) throw error;
      if (!data || !data.length) {
        toast({ title: 'No rows to export', status: 'info' });
        return;
      }
      // normalize statuses for CSV
      const normalized = data.map(r => ({ ...r, status: normalizeStatus(r.status) }));
      exportToCSV(normalized, `appointments_export_${new Date().toISOString().slice(0,10)}.csv`);
      toast({ title: 'Export started', status: 'success' });
    } catch (err) {
      console.error('exportFiltered', err);
      toast({ title: 'Export failed', description: err?.message || 'Unexpected', status: 'error' });
    }
  };

  const openView = (a) => openDrawer(a);

  const exportSingleAppointment = async (appt) => {
    try {
      const payload = {
        appointment_number: appt.appointment_number,
        weighbridge_number: appt.weighbridge_number,
        agent_tin: appt.agent_tin,
        agent_name: appt.agent_name,
        pickup_date: appt.pickup_date,
        truck_number: appt.truck_number,
        total_t1s: appt.total_t1s,
        status: normalizeStatus(appt.status),
        created_at: appt.created_at,
      };
      exportToCSV([payload], `appointment_${appt.appointment_number || Date.now()}.csv`);
      toast({ title: 'Export started', status: 'success' });
    } catch (err) {
      console.error('exportSingleAppointment', err);
      toast({ title: 'Export failed', description: err?.message || 'Unexpected', status: 'error' });
    }
  };

  const handleRefreshAll = async () => {
    await fetchStats();
    await fetchAppointments({ page: 1, size: pageSize, q: searchQ });
    toast({ title: 'Refreshed', status: 'success' });
  };

  const derivedCount = appointments.length;

  const alertTextForKey = (k) => {
    switch (k) {
      case 'pickup_overdue': return 'Pickup date passed but status is still Posted';
      case 'duplicate_booking': return 'Duplicate booking number detected';
      case 'driver_license_expiring': return 'Driver license expires within 30 days';
      case 'no_t1_records': return 'No T1 records linked to this appointment';
      default: return k;
    }
  };

  // render starts here (UI)
  return (
    <Container maxW="8xl" py={6}>
      <Heading mb={4}>Manage Appointments</Heading>

      <SimpleGrid columns={{ base: 1, md: 4 }} spacing={4} mb={6}>
        <Stat p={4} borderRadius="md" boxShadow="sm" bg="linear-gradient(90deg,#7b61ff,#3ef4d0)" color="white">
          <StatLabel>Total Appointments</StatLabel>
          <StatNumber>{loadingStats ? <Spinner size="sm" color="white" /> : totalAppointments}</StatNumber>
          <StatHelpText>All appointments in the system (restricted to your own if not admin)</StatHelpText>
          <Box mt={2}><Sparkline data={sparkAppointments} /></Box>
        </Stat>

        <Stat p={4} borderRadius="md" boxShadow="sm" bg="linear-gradient(90deg,#06b6d4,#0ea5a0)" color="white">
          <StatLabel>Total Completed</StatLabel>
          <StatNumber>{loadingStats ? <Spinner size="sm" color="white" /> : totalCompleted}</StatNumber>
          <StatHelpText>Appointments with status Completed</StatHelpText>
          <Box mt={2}><Sparkline data={sparkCompleted} /></Box>
        </Stat>

        <Stat p={4} borderRadius="md" boxShadow="sm" bg="linear-gradient(90deg,#f97316,#f59e0b)" color="white">
          <StatLabel>Total Posted</StatLabel>
          <StatNumber>{loadingStats ? <Spinner size="sm" color="white" /> : totalPosted}</StatNumber>
          <StatHelpText>Appointments with status Posted</StatHelpText>
          <Box mt={2}><Sparkline data={sparkPostedRatio} /></Box>
        </Stat>

        <Stat p={4} borderRadius="md" boxShadow="sm" bg="linear-gradient(90deg,#10b981,#06b6d4)" color="white">
          <StatLabel>Unique SADs</StatLabel>
          <StatNumber>{loadingStats ? <Spinner size="sm" color="white" /> : uniqueSADs}</StatNumber>
          <StatHelpText>Distinct SADs recorded in T1 records (your work only)</StatHelpText>
        </Stat>
      </SimpleGrid>

      <Box bg="white" p={4} borderRadius="md" boxShadow="sm" mb={4}>
        <Flex gap={3} wrap="wrap" align="center">
          <Input placeholder="Search by SAD, appointment#, weighbridge#, agent, truck, driver..." maxW="520px" value={searchQ} onChange={(e) => setSearchQ(e.target.value)} />
          <Select placeholder="Filter by status" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
            <option value="">All</option>
            <option value="Posted">Posted</option>
            <option value="Completed">Completed</option>
          </Select>
          <Input type="date" value={pickupDateFilter} onChange={(e) => { setPickupDateFilter(e.target.value); setPage(1); }} />
          <Button leftIcon={<FaSearch />} onClick={() => { setPage(1); fetchAppointments({ page: 1, size: pageSize, q: searchQ }); }}>Search</Button>
          <Button leftIcon={<FaRedoAlt />} variant="ghost" onClick={handleRefreshAll}>Refresh</Button>

          <Box ml="auto" display="flex" gap={2}>
            <Button leftIcon={<FaFileExport />} size="sm" onClick={handleExportFilteredCSV}>Export filtered CSV</Button>
          </Box>
        </Flex>
      </Box>

      <Box bg="white" p={4} borderRadius="md" boxShadow="sm" mb={6}>
        <Flex justify="space-between" align="center" mb={3}>
          <Text fontWeight="semibold">Appointments ({totalAppointments}) — Showing {derivedCount} on this page</Text>
          <HStack spacing={2}>
            <Text fontSize="sm" color="gray.600">Page</Text>
            <Select size="sm" value={page} onChange={(e) => setPage(Number(e.target.value))}>
              {Array.from({ length: totalPages }).map((_, i) => <option key={i+1} value={i+1}>{i+1}</option>)}
            </Select>
            <Select size="sm" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
              <option value={6}>6</option>
              <option value={12}>12</option>
              <option value={24}>24</option>
              <option value={50}>50</option>
            </Select>
          </HStack>
        </Flex>

        <Flex gap={3} mb={3} align="center" wrap="wrap">
          <Checkbox isChecked={selectAllOnPage} onChange={handleSelectAllOnPage}>Select all on page</Checkbox>

          <Button size="sm" onClick={bulkMarkCompleted} isDisabled={!selectedIds.size}>Mark selected Completed</Button>
          <Button size="sm" onClick={bulkExportSelected} isDisabled={!selectedIds.size}>Export selected</Button>
          <Button size="sm" colorScheme="red" onClick={bulkDeleteSelected} isDisabled={!selectedIds.size || !user || user.role !== 'admin'}>Delete selected</Button>
        </Flex>

        {loadingList ? <Flex justify="center" py={10}><Spinner /></Flex> : (
          <Table size="sm" variant="striped">
            <Thead>
              <Tr>
                <Th px={2}><Text /></Th>
                <Th>SAD(s)</Th>
                <Th>Weighbridge #</Th>
                <Th>Agent</Th>
                <Th>Pickup</Th>
                <Th>Truck</Th>
                <Th>Driver's Phone</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              <AnimatePresence>
                {appointments.map((a) => {
                  const t1s = Array.isArray(a.t1_records) ? a.t1_records : [];
                  const sadSet = new Set(t1s.map(t => t.sad_no).filter(Boolean));
                  const sadList = Array.from(sadSet);
                  const sadDisplay = sadList.length ? sadList.slice(0, 3).join(', ') : (a.appointment_number || '—');
                  const sadTooltip = sadList.length ? sadList.join(', ') : (a.appointment_number || '');
                  // driver_phone is displayed from driver_license_no per request
                  const driverPhone = a.driver_license_no || '—';
                  const rowAlerts = alertsMap[a.id] || [];
                  const closed = isAppointmentClosed(a);
                  return (
                    <MotionTr key={a.id} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}>
                      <Td px={2}>
                        <Checkbox isChecked={selectedIds.has(a.id)} onChange={() => toggleSelect(a.id)} />
                      </Td>

                      <Td>
                        {sadList.length ? (
                          <Tooltip label={sadTooltip}>
                            <Box>
                              <Text fontWeight="bold">{sadDisplay}{sadList.length > 3 ? ` +${sadList.length - 3}` : ''}</Text>
                              <Text fontSize="xs" color="gray.500">{a.appointment_number}</Text>
                            </Box>
                          </Tooltip>
                        ) : (
                          <Box>
                            <Text fontWeight="bold">{a.appointment_number}</Text>
                            <Text fontSize="xs" color="gray.500">No T1 SADs</Text>
                          </Box>
                        )}
                      </Td>

                      <Td>{a.weighbridge_number}</Td>
                      <Td>
                        {a.agent_name}
                        <Badge ml={2} colorScheme="purple" variant="subtle">{a.agent_tin}</Badge>
                      </Td>
                      <Td>{a.pickup_date ? new Date(a.pickup_date).toLocaleDateString() : '—'}</Td>
                      <Td>{a.truck_number || '—'}</Td>

                      <Td>{driverPhone}</Td>

                      <Td>
                        <Badge colorScheme={normalizeStatus(a.status) === 'Completed' ? 'green' : 'blue'}>{normalizeStatus(a.status) || '—'}</Badge>
                      </Td>

                      <Td>
                        <HStack>
                          <Menu>
                            <MenuButton as={IconButton} icon={<FaEllipsisV />} size="sm" aria-label="Actions" />
                            <MenuList>
                              <MenuItem icon={<FaEye />} onClick={() => openView(a)}>View</MenuItem>
                              <MenuItem icon={<FaFileExport />} onClick={() => exportSingleAppointment(a)}>Export</MenuItem>
                              <MenuItem icon={<FaCheck />} onClick={() => { if (closed) { closedMessage(); } else markAsCompleted(a); }} isDisabled={closed}>Mark Completed</MenuItem>
                              <MenuItem icon={<FaListAlt />} onClick={() => openDrawer(a)}>View T1s</MenuItem>
                              <MenuItem icon={<FaFilePdf />} onClick={async () => { 
                                // open from stored URL if possible
                                const ok = await openPdfForAppointment(a);
                                if (!ok) toast({ title: 'No PDF', status: 'info' });
                              }}>Open PDF</MenuItem>
                              <MenuItem icon={<FaPrint />} onClick={() => reprintAppointment(a)}>Reprint / Regenerate PDF</MenuItem>
                              <MenuDivider />
                              <MenuItem icon={<FaClone />} onClick={() => { if (closed) { closedMessage(); } else cloneAppointment(a); }} isDisabled={closed}>Clone</MenuItem>
                              <MenuItem icon={<FaTrash />} onClick={() => { if (closed) { closedMessage(); } else deleteAppointment(a); }} isDisabled={closed || !user || user.role !== 'admin'}>Delete</MenuItem>
                            </MenuList>
                          </Menu>
                        </HStack>
                      </Td>
                    </MotionTr>
                  );
                })}
              </AnimatePresence>
            </Tbody>
          </Table>
        )}
      </Box>

      <Drawer isOpen={drawerOpen} placement="right" onClose={closeDrawer} size="lg">
        <DrawerOverlay />
        <DrawerContent>
          <DrawerCloseButton />
          <DrawerHeader>
            <Flex align="center" gap={3}>
              <Box>
                <Text fontWeight="bold">{activeAppt?.appointment_number}</Text>
                <Text fontSize="sm" color="gray.500">{activeAppt?.weighbridge_number}</Text>
              </Box>
              <Box ml="auto">
                <Badge colorScheme={activeAppt && normalizeStatus(activeAppt.status) === 'Completed' ? 'green' : 'blue'}>{activeAppt ? normalizeStatus(activeAppt.status) : ''}</Badge>
              </Box>
            </Flex>
          </DrawerHeader>

          <DrawerBody>
            {drawerLoading ? <Spinner /> : (
              <Stack spacing={4}>
                <Box>
                  <Heading size="sm">Overview</Heading>
                  <Text><strong>Agent:</strong> {activeAppt?.agent_name} ({activeAppt?.agent_tin})</Text>
                  <Text><strong>Pickup:</strong> {activeAppt?.pickup_date ? new Date(activeAppt.pickup_date).toLocaleDateString() : '—'}</Text>
                  <Text><strong>Truck:</strong> {activeAppt?.truck_number || '—'}</Text>
                  <Text><strong>Driver:</strong> {activeAppt?.driver_name || '—'}</Text>
                </Box>

                <Box>
                  <Heading size="sm">Timeline</Heading>
                  <VStack align="start" spacing={2} mt={2}>
                    <Box>
                      <Text fontSize="sm"><strong>Created</strong></Text>
                      <Text fontSize="xs" color="gray.500">{activeAppt?.created_at ? new Date(activeAppt.created_at).toLocaleDateString() : '—'}</Text>
                    </Box>
                    <Box>
                      <Text fontSize="sm"><strong>Current status</strong></Text>
                      <Text fontSize="xs" color="gray.500">{activeAppt ? normalizeStatus(activeAppt.status) : '—'}</Text>
                    </Box>
                    {activityLogs && activityLogs.length ? (
                      <>
                        {activityLogs.filter(l => l.action === 'status_change').map((l, i) => (
                          <Box key={i}>
                            <Text fontSize="sm">{l.action} — {l.created_at ? new Date(l.created_at).toLocaleDateString() : '—'}</Text>
                            <Text fontSize="xs" color="gray.500">{l.changed_by ? `by ${l.changed_by}` : ''} {l.message ? ` — ${l.message}` : ''}</Text>
                          </Box>
                        ))}
                      </>
                    ) : null}
                  </VStack>
                </Box>

                <Box>
                  <Heading size="sm">T1 Records ({drawerT1s.length})</Heading>
                  {drawerT1s && drawerT1s.length ? (
                    <Table size="sm" mt={2}>
                      <Thead><Tr><Th>#</Th><Th>SAD</Th><Th>Packing</Th><Th>Container</Th></Tr></Thead>
                      <Tbody>
                        {drawerT1s.map((t, i) => (
                          <Tr key={t.id || i}>
                            <Td>{i + 1}</Td>
                            <Td>{t.sad_no}</Td>
                            <Td>{t.packing_type}</Td>
                            <Td>{t.container_no || '—'}</Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  ) : <Text>No T1 records</Text>}
                </Box>

                <Box>
                  <Heading size="sm">Files / PDF</Heading>
                  {activeAppt?.pdf_url ? (
                    <Box display="flex" gap={2}>
                      <Button leftIcon={<FaFilePdf />} size="sm" onClick={() => window.open(activeAppt.pdf_url, '_blank')}>Open PDF</Button>
                      <Button leftIcon={<FaPrint />} size="sm" onClick={() => reprintAppointment(activeAppt)}>Reprint / Regenerate</Button>
                    </Box>
                  ) : (
                    <Box display="flex" gap={2}>
                      <Text color="gray.500">No PDF attached</Text>
                      <Button leftIcon={<FaPrint />} size="sm" onClick={() => reprintAppointment(activeAppt)}>Generate PDF</Button>
                    </Box>
                  )}
                </Box>

                <Box>
                  <Heading size="sm">Activity / Audit (latest)</Heading>
                  <VStack align="start" spacing={2} mt={2}>
                    {activityLogs && activityLogs.length ? activityLogs.map((l, i) => (
                      <Box key={i} width="100%" borderBottom="1px solid" borderColor="gray.100" py={2}>
                        <Text fontSize="sm">{l.action}{l.message ? ` — ${l.message}` : ''}</Text>
                        <Text fontSize="xs" color="gray.500">{l.changed_by ? `By: ${l.changed_by} · ` : ''}{l.created_at ? new Date(l.created_at).toLocaleString() : ''}</Text>
                      </Box>
                    )) : <Text color="gray.500">No activity yet</Text>}
                  </VStack>
                </Box>

                <Box>
                  <Heading size="sm">Add comment</Heading>
                  <Textarea value={newComment} onChange={(e) => setNewComment(e.target.value)} placeholder="Add an internal comment / note" />
                  <HStack mt={2}>
                    <Button onClick={() => addAppointmentComment(activeAppt?.id, newComment)} isDisabled={!newComment}>Add Comment</Button>
                    <Button variant="ghost" onClick={() => setNewComment('')}>Clear</Button>
                  </HStack>
                </Box>
              </Stack>
            )}
          </DrawerBody>

          <DrawerFooter>
            <Button variant="ghost" onClick={closeDrawer}>Close</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </Container>
  );
}
