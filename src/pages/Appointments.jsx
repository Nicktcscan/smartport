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
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  Flex,
  IconButton,
  Badge,
  Divider,
} from '@chakra-ui/react';
import { FaFileExport, FaSearch, FaEye, FaRedoAlt } from 'react-icons/fa';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';

const MotionTr = motion(Tr);

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

  // inline status updating state map { [id]: boolean }
  const [statusUpdating, setStatusUpdating] = useState({});

  // modal
  const [viewing, setViewing] = useState(null);
  const [viewT1s, setViewT1s] = useState([]);
  const [viewLoading, setViewLoading] = useState(false);
  const [isViewOpen, setIsViewOpen] = useState(false);

  // refs to avoid stale closures
  const pageRef = useRef(page);
  pageRef.current = page;
  const pageSizeRef = useRef(pageSize);
  pageSizeRef.current = pageSize;

  // --- Fetch stats ---
  const fetchStats = async () => {
    setLoadingStats(true);
    try {
      // total appointments
      const totalResp = await supabase
        .from('appointments')
        .select('id', { count: 'exact', head: true });
      const total = Number(totalResp?.count || 0);
      setTotalAppointments(total);

      // total completed
      const compResp = await supabase
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'Completed');
      setTotalCompleted(Number(compResp?.count || 0));

      // total posted
      const postedResp = await supabase
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'Posted');
      setTotalPosted(Number(postedResp?.count || 0));

      // unique SADs from t1_records (client-side dedupe)
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
    } catch (err) {
      console.error('fetchStats', err);
      toast({ title: 'Failed to load stats', description: err?.message || 'Unexpected', status: 'error' });
    } finally {
      setLoadingStats(false);
    }
  };

  // --- Fetch appointments (paged, with optional server-side search/filter) ---
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

  // --- view details ---
  const openView = async (appointment) => {
    setViewing(appointment);
    setIsViewOpen(true);
    setViewLoading(true);
    try {
      const apptId = appointment.id;
      const { data: t1s, error } = await supabase.from('t1_records').select('*').eq('appointment_id', apptId).order('created_at', { ascending: true });
      if (error) throw error;
      setViewT1s(t1s || []);
    } catch (err) {
      console.error('openView', err);
      toast({ title: 'Failed to load T1s', description: err?.message || 'Unexpected', status: 'error' });
      setViewT1s([]);
    } finally {
      setViewLoading(false);
    }
  };

  const closeView = () => {
    setIsViewOpen(false);
    setViewing(null);
    setViewT1s([]);
  };

  // --- actions ---
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

  const exportSingleAppointment = async (appt) => {
    try {
      const payload = {
        appointment_number: appt.appointment_number,
        weighbridge_number: appt.weighbridge_number,
        agent_tin: appt.agent_tin,
        agent_name: appt.agent_name,
        pickup_date: appt.pickup_date,
        truck_number: appt.truck_number,
        driver_name: appt.driver_name,
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

  // change status inline (admin only)
  const handleChangeStatus = async (apptId, newStatus) => {
    if (!user || user.role !== 'admin') {
      toast({ title: 'Permission denied', description: 'Only admins can change appointment status', status: 'error' });
      return;
    }
    setStatusUpdating(prev => ({ ...prev, [apptId]: true }));
    // optimistic UI update
    setAppointments(prev => prev.map(a => (a.id === apptId ? { ...a, status: newStatus } : a)));
    try {
      const { error } = await supabase.from('appointments').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', apptId);
      if (error) throw error;
      toast({ title: 'Status updated', description: `Appointment status set to ${newStatus}`, status: 'success' });
      // refresh stats
      fetchStats();
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

  // simple refresh/recalc trigger
  const handleRefreshAll = async () => {
    await fetchStats();
    await fetchAppointments({ page: 1, size: pageSize, q: searchQ });
    toast({ title: 'Refreshed', status: 'success' });
  };

  // derived counts displayed in table header (client-side)
  const derivedCount = appointments.length;

  return (
    <Container maxW="8xl" py={6}>
      <Heading mb={4}>Manage Appointments</Heading>

      <SimpleGrid columns={{ base: 1, md: 4 }} spacing={4} mb={6}>
        <Stat p={4} borderRadius="md" boxShadow="sm" bg="linear-gradient(90deg,#7b61ff,#3ef4d0)" color="white">
          <StatLabel>Total Appointments</StatLabel>
          <StatNumber>{loadingStats ? <Spinner size="sm" color="white" /> : totalAppointments}</StatNumber>
          <StatHelpText>All appointments in the system</StatHelpText>
        </Stat>

        <Stat p={4} borderRadius="md" boxShadow="sm" bg="linear-gradient(90deg,#06b6d4,#0ea5a0)" color="white">
          <StatLabel>Total Completed</StatLabel>
          <StatNumber>{loadingStats ? <Spinner size="sm" color="white" /> : totalCompleted}</StatNumber>
          <StatHelpText>Appointments with status Completed</StatHelpText>
        </Stat>

        <Stat p={4} borderRadius="md" boxShadow="sm" bg="linear-gradient(90deg,#f97316,#f59e0b)" color="white">
          <StatLabel>Total Posted</StatLabel>
          <StatNumber>{loadingStats ? <Spinner size="sm" color="white" /> : totalPosted}</StatNumber>
          <StatHelpText>Appointments with status Posted</StatHelpText>
        </Stat>

        <Stat p={4} borderRadius="md" boxShadow="sm" bg="linear-gradient(90deg,#10b981,#06b6d4)" color="white">
          <StatLabel>Unique SADs</StatLabel>
          <StatNumber>{loadingStats ? <Spinner size="sm" color="white" /> : uniqueSADs}</StatNumber>
          <StatHelpText>Distinct SADs recorded in T1 records</StatHelpText>
        </Stat>
      </SimpleGrid>

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

        {loadingList ? <Flex justify="center" py={10}><Spinner /></Flex> : (
          <Table size="sm" variant="striped">
            <Thead>
              <Tr>
                <Th>Appointment</Th>
                <Th>Weighbridge #</Th>
                <Th>Agent</Th>
                <Th>Pickup</Th>
                <Th>Truck</Th>
                <Th isNumeric>T1s</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              <AnimatePresence>
                {appointments.map((a) => {
                  const t1count = Array.isArray(a.t1_records) ? a.t1_records.length : a.total_t1s || 0;
                  return (
                    <MotionTr key={a.id} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}>
                      <Td>
                        <Text fontWeight="bold">{a.appointment_number}</Text>
                        <Text fontSize="xs" color="gray.500">{a.weighbridge_number}</Text>
                      </Td>
                      <Td>{a.weighbridge_number}</Td>
                      <Td>{a.agent_name} <Badge ml={2} colorScheme="purple" variant="subtle">{a.agent_tin}</Badge></Td>
                      <Td>{a.pickup_date ? new Date(a.pickup_date).toLocaleDateString() : '—'}</Td>
                      <Td>{a.truck_number || '—'}</Td>
                      <Td isNumeric>{t1count}</Td>

                      <Td>
                        {/* Admins get inline dropdown to change status instantly; others see badge */}
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
                        <HStack>
                          <IconButton aria-label="View" size="sm" icon={<FaEye />} onClick={() => openView(a)} />
                          <Button size="sm" onClick={() => exportSingleAppointment(a)}>Export</Button>
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

      {/* View modal */}
      <Modal isOpen={isViewOpen} onClose={closeView} size="lg" scrollBehavior="inside">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Appointment — {viewing?.appointment_number}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {viewLoading ? <Spinner /> : (
              <>
                {viewing ? (
                  <>
                    <Text mb={2}><strong>Agent:</strong> {viewing.agent_name} ({viewing.agent_tin})</Text>
                    <Text mb={2}><strong>Pickup:</strong> {viewing.pickup_date || '—'}</Text>
                    <Text mb={2}><strong>Truck:</strong> {viewing.truck_number || '—'}</Text>
                    <Text mb={2}><strong>Driver:</strong> {viewing.driver_name || '—'}</Text>
                    <Divider my={3} />
                    <Heading size="sm" mb={2}>T1 Records</Heading>
                    {viewT1s && viewT1s.length ? (
                      <Table size="sm">
                        <Thead><Tr><Th>#</Th><Th>SAD</Th><Th>Packing</Th><Th>Container</Th></Tr></Thead>
                        <Tbody>
                          {viewT1s.map((t, i) => (
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
                  </>
                ) : <Text>No appointment to show.</Text>}
              </>
            )}
          </ModalBody>
          <ModalFooter>
            <Button onClick={closeView}>Close</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Container>
  );
}
