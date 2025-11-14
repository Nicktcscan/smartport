// src/pages/Appointments.jsx
import React, { useEffect, useState, useRef } from 'react';
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
  VStack,
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
} from 'react-icons/fa';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';

const MotionTr = motion(Tr);

// Simple sparkline component (SVG) — light-weight, no external libs
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
  // area path for subtle fill
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

export default function AppointmentsPage() {
  const toast = useToast();
  const { user } = useAuth() || {};

  // data
  const [appointments, setAppointments] = useState([]);
  const [totalAppointments, setTotalAppointments] = useState(0);
  const [totalCompleted, setTotalCompleted] = useState(0);
  const [totalPosted, setTotalPosted] = useState(0);
  const [uniqueSADs, setUniqueSADs] = useState(0);

  // UI controls
  const [loadingStats, setLoadingStats] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [searchQ, setSearchQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [pickupDateFilter, setPickupDateFilter] = useState('');
  const [totalPages, setTotalPages] = useState(1);

  // selection/bulk
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [selectAllOnPage, setSelectAllOnPage] = useState(false);

  // inline status updating state map { [id]: boolean }
  const [statusUpdating, setStatusUpdating] = useState({});

  // drawer (drill-down)
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeAppt, setActiveAppt] = useState(null);
  const [drawerT1s, setDrawerT1s] = useState([]);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [activityLogs, setActivityLogs] = useState([]);
  const [newComment, setNewComment] = useState('');

  // alerts map: { [id]: [ 'pickup_overdue', 'duplicate_booking', ... ] }
  const [alertsMap, setAlertsMap] = useState({});

  // sparkline data (7 days)
  const [sparkAppointments, setSparkAppointments] = useState([]);
  const [sparkCompleted, setSparkCompleted] = useState([]);
  const [sparkPostedRatio, setSparkPostedRatio] = useState([]);

  // refs to avoid stale closures
  const pageRef = useRef(page);
  pageRef.current = page;
  const pageSizeRef = useRef(pageSize);
  pageSizeRef.current = pageSize;

  // utility: format date only (yyyy-mm-dd)
  const formatDateISO = (d) => {
    if (!d) return null;
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return null;
    return dt.toISOString().slice(0, 10);
  };

  // --- Fetch stats + sparklines + uniqueSADs + alerts ---
  const fetchStats = async () => {
    setLoadingStats(true);
    try {
      // total appointments
      const totalResp = await supabase
        .from('appointments')
        .select('id', { count: 'exact', head: true });
      const total = Number(totalResp?.count || 0);
      setTotalAppointments(total);

      // completed
      const compResp = await supabase
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'Completed');
      setTotalCompleted(Number(compResp?.count || 0));

      // posted
      const postedResp = await supabase
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'Posted');
      setTotalPosted(Number(postedResp?.count || 0));

      // unique SADs from t1_records
      try {
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
      } catch (innerErr) {
        console.warn('unique sad fetch err', innerErr);
        setUniqueSADs(0);
      }

      // KPIs - last 7 days: appointments created per day, completed per day, posted ratio (completed/created or posted ratio)
      try {
        const days = 7;
        const today = new Date();
        const dayStarts = [];
        for (let i = days - 1; i >= 0; i--) {
          const d = new Date(today);
          d.setDate(today.getDate() - i);
          dayStarts.push(formatDateISO(d));
        }

        // fetch created counts by day
        // We'll pull appointments created in last 8 days and aggregate client-side
        const startDate = dayStarts[0] + 'T00:00:00Z';
        const { data: recentAppts } = await supabase
          .from('appointments')
          .select('id, created_at, status')
          .gte('created_at', startDate)
          .order('created_at', { ascending: true })
          .limit(5000);

        const createdCounts = dayStarts.map(d => 0);
        const completedCounts = dayStarts.map(d => 0);
        const postedCounts = dayStarts.map(d => 0);

        if (Array.isArray(recentAppts)) {
          for (const a of recentAppts) {
            const dISO = formatDateISO(a.created_at);
            const idx = dayStarts.indexOf(dISO);
            if (idx >= 0) {
              createdCounts[idx] += 1;
            }
            // also count status-date: if status was created as Completed on same day? We don't have status timestamps.
            // For simplicity count a.status === 'Completed' assigned to created date as an approximation (not perfect).
            if (idx >= 0 && a.status === 'Completed') completedCounts[idx] += 1;
            if (idx >= 0 && a.status === 'Posted') postedCounts[idx] += 1;
          }
        }

        setSparkAppointments(createdCounts);
        setSparkCompleted(completedCounts);
        // posted ratio: posted / created (0..1) scaled to counts for sparkline
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

  // --- Fetch appointments (paged, with t1_records) and compute alerts ---
  const fetchAppointments = async ({ page: p = pageRef.current, size = pageSizeRef.current, q = searchQ, status = statusFilter, pickup = pickupDateFilter } = {}) => {
    setLoadingList(true);
    try {
      const from = (p - 1) * size;
      const to = p * size - 1;

      let baseQuery = supabase.from('appointments').select('*, t1_records(id, sad_no)', { count: 'exact' });

      if (q && q.trim()) {
        const escaped = q.trim().replace(/"/g, '\\"');
        const orFilter = `appointment_number.ilike.%${escaped}%,weighbridge_number.ilike.%${escaped}%,agent_name.ilike.%${escaped}%,truck_number.ilike.%${escaped}%,driver_name.ilike.%${escaped}%`;
        baseQuery = baseQuery.or(orFilter);
      }

      if (status) baseQuery = baseQuery.eq('status', status);
      if (pickup) baseQuery = baseQuery.eq('pickup_date', pickup);

      baseQuery = baseQuery.order('created_at', { ascending: false }).range(from, to);

      const resp = await baseQuery;
      if (resp.error) throw resp.error;

      const data = resp.data || [];
      const count = Number(resp.count || 0);
      setAppointments(data);
      setTotalPages(Math.max(1, Math.ceil(count / size)));

      // compute alerts
      const alerts = {};
      // detect duplicate appointment_number across returned set and overall (we'll check server count per appointment_number)
      const apptNumbers = data.map(a => a.appointment_number).filter(Boolean);
      const dupMap = {};
      for (const n of apptNumbers) dupMap[n] = (dupMap[n] || 0) + 1;

      // But duplicates may exist beyond current page: query counts for any appointment_number that occurs more than once locally
      const dupCandidates = Object.keys(dupMap).filter(k => dupMap[k] > 1);
      const globalDupCounts = {};
      if (dupCandidates.length) {
        try {
          // fetch counts for each candidate
          // Using batches to avoid long queries
          for (const key of dupCandidates) {
            const { count } = await supabase.from('appointments').select('id', { head: true, count: 'exact' }).eq('appointment_number', key);
            globalDupCounts[key] = Number(count || 0);
          }
        } catch (e) {
          console.warn('dup count failed', e);
        }
      }

      for (const a of data) {
        const id = a.id;
        alerts[id] = [];
        // pickup overdue: pickup_date < today && status is Posted
        if (a.pickup_date) {
          const pickupIso = formatDateISO(a.pickup_date);
          const todayIso = formatDateISO(new Date());
          if (pickupIso && todayIso && pickupIso < todayIso && (a.status || '').toLowerCase() === 'posted') {
            alerts[id].push('pickup_overdue');
          }
        }

        // duplicate booking
        const num = a.appointment_number;
        const globalCount = (num && globalDupCounts[num]) ? globalDupCounts[num] : (num && dupMap[num] ? dupMap[num] : 1);
        if (num && Number(globalCount) > 1) {
          alerts[id].push('duplicate_booking');
        }

        // driver license expiry < 30 days -> requires appointment.driver_license_expiry (ISO date)
        if (a.driver_license_expiry) {
          const expiry = new Date(a.driver_license_expiry);
          if (!isNaN(expiry.getTime())) {
            const now = new Date();
            const diffDays = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
            if (diffDays <= 30) alerts[id].push('driver_license_expiring');
          }
        }

        // No T1 records linked
        const t1count = Array.isArray(a.t1_records) ? a.t1_records.length : (a.total_t1s || 0);
        if (!t1count || Number(t1count) === 0) {
          alerts[id].push('no_t1_records');
        }
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

  // initial load
  useEffect(() => {
    fetchStats();
    fetchAppointments({ page: 1, size: pageSize });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // when page or pageSize or filters change, refetch list
  useEffect(() => {
    fetchAppointments({ page, size: pageSize });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, statusFilter, pickupDateFilter]);

  // search handler (debounce basic)
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      fetchAppointments({ page: 1, size: pageSize, q: searchQ });
    }, 380);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQ]);

  // --- Drawer open (drill-down) ---
  const openDrawer = async (appointment) => {
    setActiveAppt(appointment);
    setDrawerOpen(true);
    setDrawerLoading(true);
    try {
      // fetch t1_records and activity logs for this appointment
      const apptId = appointment.id;
      const [{ data: t1s }, { data: logs }] = await Promise.allSettled([
        supabase.from('t1_records').select('*').eq('appointment_id', apptId).order('created_at', { ascending: true }),
        supabase.from('appointment_logs').select('*').eq('appointment_id', apptId).order('created_at', { ascending: false }),
      ]).then(results =>
        results.map(r => (r.status === 'fulfilled' ? r.value : { data: [], error: r.reason }))
      );

      setDrawerT1s(t1s || []);
      setActivityLogs(logs || []);
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

  // post an activity/comment to appointment_logs
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
      // refresh activity list
      const { data: logs } = await supabase.from('appointment_logs').select('*').eq('appointment_id', appointmentId).order('created_at', { ascending: false });
      setActivityLogs(logs || []);
      setNewComment('');
      toast({ title: 'Comment added', status: 'success' });
    } catch (err) {
      console.error('add comment', err);
      toast({ title: 'Failed to add comment', description: err?.message || 'Unexpected', status: 'error' });
    }
  };

  // change status inline (admin only) with audit log
  const handleChangeStatus = async (apptId, newStatus) => {
    if (!user || user.role !== 'admin') {
      toast({ title: 'Permission denied', description: 'Only admins can change appointment status', status: 'error' });
      return;
    }
    setStatusUpdating(prev => ({ ...prev, [apptId]: true }));
    // optimistic UI update
    const before = (appointments.find(a => a.id === apptId)) || null;
    setAppointments(prev => prev.map(a => (a.id === apptId ? { ...a, status: newStatus } : a)));
    try {
      const { error } = await supabase.from('appointments').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', apptId);
      if (error) throw error;
      // write appointment_logs audit
      try {
        await supabase.from('appointment_logs').insert([{
          appointment_id: apptId,
          changed_by: user?.id || null,
          action: 'status_change',
          before: before ? JSON.stringify({ status: before.status }) : null,
          after: JSON.stringify({ status: newStatus }),
          created_at: new Date().toISOString(),
        }]);
      } catch (e) { console.warn('log write failed', e); }
      toast({ title: 'Status updated', description: `Appointment status set to ${newStatus}`, status: 'success' });
      // refresh stats & alerts
      fetchStats();
      fetchAppointments({ page, size: pageSize, q: searchQ });
    } catch (err) {
      console.error('update status', err);
      toast({ title: 'Update failed', description: err?.message || 'Could not update status', status: 'error' });
      // rollback (refetch list to be safe)
      fetchAppointments({ page, size: pageSize, q: searchQ });
      fetchStats();
    } finally {
      setStatusUpdating(prev => ({ ...prev, [apptId]: false }));
    }
  };

  // quick action: mark single appointment completed
  const markAsCompleted = async (appt) => {
    if (!appt || !appt.id) return;
    await handleChangeStatus(appt.id, 'Completed');
  };

  // quick action: clone appointment
  const cloneAppointment = async (appt) => {
    if (!appt) return;
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
        status: 'Posted',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const { data: newRow, error } = await supabase.from('appointments').insert([payload]).select().single();
      if (error) throw error;
      // log
      try { await supabase.from('appointment_logs').insert([{ appointment_id: newRow.id, changed_by: user?.id || null, action: 'clone', message: `Cloned from ${appt.appointment_number}`, created_at: new Date().toISOString(), before: JSON.stringify(appt), after: JSON.stringify(newRow) }]); } catch (e) { /* ignore */ }
      toast({ title: 'Cloned', description: `Appointment cloned as ${newRow.appointment_number}`, status: 'success' });
      // refresh listing
      fetchStats();
      fetchAppointments({ page: 1, size: pageSize, q: searchQ });
    } catch (err) {
      console.error('clone', err);
      toast({ title: 'Clone failed', description: err?.message || 'Unexpected', status: 'error' });
    }
  };

  // quick action: delete appointment (admin only)
  const deleteAppointment = async (appt) => {
    if (!user || user.role !== 'admin') {
      toast({ title: 'Permission denied', description: 'Only admins can delete appointments', status: 'error' });
      return;
    }
    if (!appt || !appt.id) return;
    const ok = window.confirm(`Delete appointment ${appt.appointment_number}? This will remove the appointment and its T1 records (if cascade).`);
    if (!ok) return;
    try {
      const { error } = await supabase.from('appointments').delete().eq('id', appt.id);
      if (error) throw error;
      // log
      try { await supabase.from('appointment_logs').insert([{ appointment_id: appt.id, changed_by: user?.id || null, action: 'delete', message: `Deleted appointment ${appt.appointment_number}`, created_at: new Date().toISOString(), before: JSON.stringify(appt) }]); } catch (e) { /* ignore */ }
      toast({ title: 'Deleted', description: `Appointment ${appt.appointment_number} deleted`, status: 'success' });
      fetchStats();
      fetchAppointments({ page: 1, size: pageSize, q: searchQ });
    } catch (err) {
      console.error('delete', err);
      toast({ title: 'Delete failed', description: err?.message || 'Unexpected', status: 'error' });
    }
  };

  // bulk actions
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
      // unselect all on page
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
    const ok = window.confirm(`Mark ${ids.length} appointment(s) as Completed?`);
    if (!ok) return;
    try {
      const { error } = await supabase.from('appointments').update({ status: 'Completed', updated_at: new Date().toISOString() }).in('id', ids);
      if (error) throw error;
      // log for each (best-effort)
      try {
        const logs = ids.map(id => ({ appointment_id: id, changed_by: user?.id || null, action: 'status_change', before: null, after: JSON.stringify({ status: 'Completed' }), created_at: new Date().toISOString() }));
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
    // get selected rows data from current appointments list (if not present, fetch server)
    const ids = Array.from(selectedIds);
    const rows = appointments.filter(a => ids.includes(a.id)).map(a => ({
      appointment_number: a.appointment_number,
      weighbridge_number: a.weighbridge_number,
      agent_name: a.agent_name,
      pickup_date: a.pickup_date,
      truck_number: a.truck_number,
      total_t1s: Array.isArray(a.t1_records) ? a.t1_records.length : a.total_t1s,
      status: a.status,
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
    const ok = window.confirm(`Delete ${ids.length} selected appointments? This is destructive.`);
    if (!ok) return;
    try {
      const { error } = await supabase.from('appointments').delete().in('id', ids);
      if (error) throw error;
      // log best-effort
      try {
        const logs = ids.map(id => ({ appointment_id: id, changed_by: user?.id || null, action: 'bulk_delete', message: `Bulk delete by ${user?.id}`, created_at: new Date().toISOString() }));
        await runInBatches(logs, 50, async (rec) => supabase.from('appointment_logs').insert([rec]));
      } catch (e) { /* ignore */ }
      toast({ title: 'Deleted', description: `${ids.length} appointment(s) deleted`, status: 'success' });
      setSelectedIds(new Set());
      fetchStats();
      fetchAppointments({ page: 1, size: pageSize, q: searchQ });
    } catch (err) {
      console.error('bulk delete', err);
      toast({ title: 'Bulk delete failed', description: err?.message || 'Unexpected', status: 'error' });
    }
  };

  // small helper to run things in batches
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

  // export filtered CSV
  const handleExportFilteredCSV = async () => {
    try {
      let q = supabase.from('appointments').select('id,appointment_number,weighbridge_number,agent_tin,agent_name,warehouse_location,pickup_date,consolidated,truck_number,driver_name,total_t1s,total_documented_weight,status,created_at,updated_at').order('created_at', { ascending: false }).limit(5000);
      if (searchQ && searchQ.trim()) {
        const escaped = searchQ.trim().replace(/"/g, '\\"');
        const orFilter = `appointment_number.ilike.%${escaped}%,weighbridge_number.ilike.%${escaped}%,agent_name.ilike.%${escaped}%,truck_number.ilike.%${escaped}%`;
        q = q.or(orFilter);
      }
      if (statusFilter) q = q.eq('status', statusFilter);
      if (pickupDateFilter) q = q.eq('pickup_date', pickupDateFilter);

      const { data, error } = await q;
      if (error) throw error;
      if (!data || !data.length) {
        toast({ title: 'No rows to export', status: 'info' });
        return;
      }
      exportToCSV(data, `appointments_export_${new Date().toISOString().slice(0,10)}.csv`);
      toast({ title: 'Export started', status: 'success' });
    } catch (err) {
      console.error('exportFiltered', err);
      toast({ title: 'Export failed', description: err?.message || 'Unexpected', status: 'error' });
    }
  };

  // open view in drawer (will fetch T1s + logs)
  const openView = (a) => openDrawer(a);

  // export single appt
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
        status: appt.status,
        created_at: appt.created_at,
      };
      exportToCSV([payload], `appointment_${appt.appointment_number || Date.now()}.csv`);
      toast({ title: 'Export started', status: 'success' });
    } catch (err) {
      console.error('exportSingleAppointment', err);
      toast({ title: 'Export failed', description: err?.message || 'Unexpected', status: 'error' });
    }
  };

  // refresh
  const handleRefreshAll = async () => {
    await fetchStats();
    await fetchAppointments({ page: 1, size: pageSize, q: searchQ });
    toast({ title: 'Refreshed', status: 'success' });
  };

  // derived counts displayed in table header (client-side)
  const derivedCount = appointments.length;

  // helper for alert badge tooltip text
  const alertTextForKey = (k) => {
    switch (k) {
      case 'pickup_overdue': return 'Pickup date passed but status is still Posted';
      case 'duplicate_booking': return 'Duplicate booking number detected';
      case 'driver_license_expiring': return 'Driver license expires within 30 days';
      case 'no_t1_records': return 'No T1 records linked to this appointment';
      default: return k;
    }
  };

  return (
    <Container maxW="8xl" py={6}>
      <Heading mb={4}>Manage Appointments</Heading>

      {/* KPI row + sparklines */}
      <SimpleGrid columns={{ base: 1, md: 4 }} spacing={4} mb={6}>
        <Stat p={4} borderRadius="md" boxShadow="sm" bg="linear-gradient(90deg,#7b61ff,#3ef4d0)" color="white">
          <StatLabel>Total Appointments</StatLabel>
          <StatNumber>{loadingStats ? <Spinner size="sm" color="white" /> : totalAppointments}</StatNumber>
          <StatHelpText>All appointments in the system</StatHelpText>
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
          <StatHelpText>Distinct SADs recorded in T1 records</StatHelpText>
        </Stat>
      </SimpleGrid>

      {/* Controls */}
      <Box bg="white" p={4} borderRadius="md" boxShadow="sm" mb={4}>
        <Flex gap={3} wrap="wrap" align="center">
          <Input placeholder="Search by appointment, weighbridge, agent, truck, driver..." maxW="420px" value={searchQ} onChange={(e) => setSearchQ(e.target.value)} />
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

      {/* Bulk actions + paging */}
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
                <Th>Appointment</Th>
                <Th>Weighbridge #</Th>
                <Th>Agent</Th>
                <Th>Pickup</Th>
                <Th>Truck</Th>
                <Th isNumeric>T1s</Th>
                <Th>Status</Th>
                <Th>Alerts</Th>
                <Th>Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              <AnimatePresence>
                {appointments.map((a) => {
                  const t1count = Array.isArray(a.t1_records) ? a.t1_records.length : a.total_t1s || 0;
                  const rowAlerts = alertsMap[a.id] || [];
                  return (
                    <MotionTr key={a.id} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}>
                      <Td px={2}>
                        <Checkbox isChecked={selectedIds.has(a.id)} onChange={() => toggleSelect(a.id)} />
                      </Td>

                      <Td>
                        <Text fontWeight="bold">{a.appointment_number}</Text>
                        <Text fontSize="xs" color="gray.500">{a.weighbridge_number}</Text>
                      </Td>
                      <Td>{a.weighbridge_number}</Td>
                      <Td>
                        {a.agent_name}
                        <Badge ml={2} colorScheme="purple" variant="subtle">{a.agent_tin}</Badge>
                      </Td>
                      <Td>{a.pickup_date ? new Date(a.pickup_date).toLocaleDateString() : '—'}</Td>
                      <Td>{a.truck_number || '—'}</Td>
                      <Td isNumeric>{t1count}</Td>

                      <Td>
                        {user && user.role === 'admin' ? (
                          <Select
                            size="sm"
                            value={a.status || 'Posted'}
                            onChange={(e) => handleChangeStatus(a.id, e.target.value)}
                            isDisabled={!!statusUpdating[a.id]}
                            maxW="160px"
                          >
                            <option value="Posted">Posted</option>
                            <option value="Completed">Completed</option>
                          </Select>
                        ) : (
                          <Badge colorScheme={a.status === 'Completed' ? 'green' : 'blue'}>{a.status}</Badge>
                        )}
                      </Td>

                      <Td>
                        {rowAlerts.length ? (
                          <Tooltip label={rowAlerts.map(k => alertTextForKey(k)).join('\n')}>
                            <HStack spacing={2}>
                              <Badge colorScheme="red">{rowAlerts.length}</Badge>
                              <Text fontSize="xs" color="gray.600">{rowAlerts.map(k => k.replace('_',' ')).join(', ')}</Text>
                            </HStack>
                          </Tooltip>
                        ) : (
                          <Text fontSize="xs" color="green.600">OK</Text>
                        )}
                      </Td>

                      <Td>
                        <HStack>
                          <Menu>
                            <MenuButton as={IconButton} icon={<FaEllipsisV />} size="sm" aria-label="Actions" />
                            <MenuList>
                              <MenuItem icon={<FaEye />} onClick={() => openView(a)}>View</MenuItem>
                              <MenuItem icon={<FaFileExport />} onClick={() => exportSingleAppointment(a)}>Export</MenuItem>
                              <MenuItem icon={<FaCheck />} onClick={() => markAsCompleted(a)}>Mark Completed</MenuItem>
                              <MenuItem icon={<FaListAlt />} onClick={() => openDrawer(a)}>View T1s</MenuItem>
                              <MenuItem icon={<FaFilePdf />} onClick={() => { if (a.pdf_url) window.open(a.pdf_url, '_blank'); else toast({ title: 'No PDF', status: 'info' }); }}>Download PDF</MenuItem>
                              <MenuDivider />
                              <MenuItem icon={<FaClone />} onClick={() => cloneAppointment(a)}>Clone</MenuItem>
                              <MenuItem icon={<FaTrash />} onClick={() => deleteAppointment(a)}>Delete</MenuItem>
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

      {/* Drawer (drill-down) */}
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
                <Badge colorScheme={activeAppt?.status === 'Completed' ? 'green' : 'blue'}>{activeAppt?.status}</Badge>
              </Box>
            </Flex>
          </DrawerHeader>

          <DrawerBody>
            {drawerLoading ? <Spinner /> : (
              <Stack spacing={4}>
                <Box>
                  <Heading size="sm">Overview</Heading>
                  <Text><strong>Agent:</strong> {activeAppt?.agent_name} ({activeAppt?.agent_tin})</Text>
                  <Text><strong>Pickup:</strong> {activeAppt?.pickup_date ? new Date(activeAppt.pickup_date).toLocaleString() : '—'}</Text>
                  <Text><strong>Truck:</strong> {activeAppt?.truck_number || '—'}</Text>
                  <Text><strong>Driver:</strong> {activeAppt?.driver_name || '—'}</Text>
                </Box>

                <Box>
                  <Heading size="sm">Timeline</Heading>
                  <VStack align="start" spacing={2} mt={2}>
                    <Box>
                      <Text fontSize="sm"><strong>Created</strong></Text>
                      <Text fontSize="xs" color="gray.500">{activeAppt?.created_at ? new Date(activeAppt.created_at).toLocaleString() : '—'}</Text>
                    </Box>
                    <Box>
                      <Text fontSize="sm"><strong>Current status</strong></Text>
                      <Text fontSize="xs" color="gray.500">{activeAppt?.status}</Text>
                    </Box>
                    {/* derive Completed date from logs if available */}
                    {activityLogs && activityLogs.length ? (
                      <>
                        {activityLogs.filter(l => l.action === 'status_change').map((l, i) => (
                          <Box key={i}>
                            <Text fontSize="sm">{l.action} — {l.created_at ? new Date(l.created_at).toLocaleString() : '—'}</Text>
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
                    <Box>
                      <Button leftIcon={<FaFilePdf />} size="sm" onClick={() => window.open(activeAppt.pdf_url, '_blank')}>Open PDF</Button>
                    </Box>
                  ) : <Text color="gray.500">No PDF attached</Text>}
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
