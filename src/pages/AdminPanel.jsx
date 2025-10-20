// src/pages/AdminPanel.jsx
import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  Box,
  Heading,
  Text,
  HStack,
  SimpleGrid,
  Stat,
  StatLabel,
  StatNumber,
  StatHelpText,
  Button,
  useToast,
  Divider,
  useColorModeValue,
  Spinner,
  VStack,
  Badge,
  Avatar,
  IconButton,
  Select,
  Tag,
  Tooltip,
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverArrow,
  PopoverBody,
  PopoverHeader,
  PopoverCloseButton,
  Input,
} from '@chakra-ui/react';
import { motion, useAnimation } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { FiRefreshCw, FiDownload, FiTruck, FiFileText, FiUsers } from 'react-icons/fi';
import { Line, Pie } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title as ChartTitle,
  Tooltip as ChartTooltip,
  Legend,
  ArcElement,
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ChartTitle,
  ChartTooltip,
  Legend,
  ArcElement
);

const MotionBox = motion(Box);
const MotionStatNumber = motion(StatNumber);

const shadows = { md: 'rgba(0,0,0,0.08) 0px 4px 12px', lg: 'rgba(0,0,0,0.12) 0px 10px 24px' };
const DEFAULT_CHART_DAYS = 7;

/* Small debounce hook (in-file) */
function useDebounce(value, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}


export default function AdminPanel() {
  const toast = useToast();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  // theme / UI tokens
  const statBg = useColorModeValue('white', 'gray.700');
  const activityItemBg = useColorModeValue('gray.50', 'gray.800');
  const activityBadgeBg = useColorModeValue('gray.100', 'gray.700');
  const userCardBg = useColorModeValue('white', 'gray.800');

  // state
  const [users, setUsers] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [outgates, setOutgates] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingData, setLoadingData] = useState(true);

  // analytics
  const [analytics, setAnalytics] = useState({
    gateOpsToday: 0,
    ticketsProcessed: 0,
    trucksExited: 0,
    reportsGenerated: 0,
    unreadNotifications: 0,
  });

  // UI controls
  const [chartDays, setChartDays] = useState(DEFAULT_CHART_DAYS);
  const [activityFilter, setActivityFilter] = useState('all');
  const [activityLimit, setActivityLimit] = useState(8);
  const [activitySearch, setActivitySearch] = useState('');
  const debouncedActivitySearch = useDebounce(activitySearch, 250);
  const activityRef = useRef(null);

  // trucksExited animation controller
  const trucksAnim = useAnimation();
  const prevTrucksExitedRef = useRef(analytics.trucksExited);

  // redirect non-admins
  useEffect(() => {
    if (!authLoading) {
      if (!user) navigate('/login');
      else if (user.role !== 'admin') navigate('/');
    }
  }, [authLoading, user, navigate]);

  // ---------- helpers ----------
  const isToday = (dateLike) => {
    if (!dateLike) return false;
    const d = new Date(dateLike);
    if (Number.isNaN(d.getTime())) return false;
    const today = new Date();
    return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  };

  const statusCountsAsGateOp = (status) => {
    if (!status) return false;
    const s = String(status).toLowerCase();
    return s === 'pending' || s === 'exited';
  };

  /* Build activity list (memoized below) -- limit rows and normalize */
  const buildActivityFromState = useCallback((ticketsArr = [], outgatesArr = [], usersArr = []) => {
    const items = [];

    // Only take recent N entries from each source to avoid huge arrays
    const take = (arr, n = 60) => (arr || []).slice(0, n);

    take(ticketsArr, 80).forEach((row) => {
      items.push({
        id: `ticket-${row.ticket_id ?? row.ticket_no ?? Math.random()}`,
        type: 'weighbridge',
        time: row.submitted_at || row.date || new Date().toISOString(),
        title: `Ticket ${row.ticket_no || row.ticket_id || '—'} recorded`,
        meta: { ticket_id: row.ticket_id, truck: row.gnsw_truck_no, sad: row.sad_no, driver: row.driver, gross: row.gross },
      });
    });

    take(outgatesArr, 80).forEach((row) => {
      items.push({
        id: `out-${row.id ?? Math.random()}`,
        type: 'outgate',
        time: row.created_at || new Date().toISOString(),
        title: `Exit confirmed for ${row.ticket_no || row.vehicle_number || '—'}`,
        meta: { outgate_id: row.id, ticket_id: row.ticket_id, truck: row.vehicle_number, driver: row.driver, sad: row.sad_no, net: row.net },
      });
    });

    take(usersArr, 80).forEach((u) => {
      items.push({
        id: `user-${u.id}`,
        type: 'users',
        time: u.updated_at || new Date().toISOString(),
        title: `User ${u.username} (${u.role})`,
        meta: { user_id: u.id, email: u.email },
      });
    });

    items.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
    return items;
  }, []);

  // ---------- payload resolvers ----------
  const resolveEventType = (payload) => {
    if (!payload) return null;
    return payload.eventType || payload.event || payload.type || (payload.payload && payload.payload.type) || null;
  };

  const resolveNewRecord = (payload) => {
    if (!payload) return null;
    return payload.new || payload.record || (payload.payload && payload.payload.new) || null;
  };

  const resolveOldRecord = (payload) => {
    if (!payload) return null;
    return payload.old || payload.oldRecord || (payload.payload && payload.payload.old) || null;
  };

  // ---------- analytics recompute (single source of truth) ----------
  const recomputeAnalytics = useCallback((ticketsArr = [], outgatesArr = []) => {
    // ticketsProcessed => count unique ticket numbers (fallback to ticket_id)
    const ticketIdSet = new Set();
    (ticketsArr || []).forEach((t) => {
      const tn = (t.ticket_no ?? t.ticketNo ?? '').toString().trim();
      if (tn) ticketIdSet.add(tn);
      else if (t.ticket_id) ticketIdSet.add(`__id_${String(t.ticket_id)}`);
      else ticketIdSet.add(`__row_${Math.random()}`);
    });
    const ticketsProcessed = ticketIdSet.size;

    // trucksExited: unique tickets that either have status 'exited' in tickets table or appear in outgate records
    const exitedSet = new Set();
    (ticketsArr || []).forEach((t) => {
      const st = (t.status ?? '').toString().toLowerCase();
      if (st === 'exited') {
        const tn = (t.ticket_no ?? t.ticketNo ?? '').toString().trim();
        if (tn) exitedSet.add(tn);
        else if (t.ticket_id) exitedSet.add(`__id_${String(t.ticket_id)}`);
      }
    });
    (outgatesArr || []).forEach((o) => {
      const on = (o.ticket_no ?? o.ticketNo ?? '').toString().trim();
      if (on) exitedSet.add(on);
      else if (o.ticket_id) exitedSet.add(`__id_${String(o.ticket_id)}`);
    });
    const trucksExited = exitedSet.size;

    const gateOpsToday = (ticketsArr || []).filter((r) =>
      isToday(r.date || r.submitted_at) && statusCountsAsGateOp(r.status)
    ).length;

    const reportsGenerated = (ticketsArr || []).filter((r) => !!r.file_url).length;

    // animate trucksExited if increasing
    if (trucksExited > (prevTrucksExitedRef.current ?? 0)) {
      trucksAnim.start({ scale: [1, 1.08, 1], transition: { duration: 0.6 } });
    }
    prevTrucksExitedRef.current = trucksExited;

    setAnalytics((prev) => ({
      gateOpsToday,
      ticketsProcessed,
      trucksExited,
      reportsGenerated,
      unreadNotifications: prev.unreadNotifications ?? 0,
    }));
  }, [trucksAnim]);

  // ---------- initial fetch ----------
  const fetchData = useCallback(async () => {
    setLoadingData(true);
    setLoadingUsers(true);
    try {
      const { data: usersData, error: usersError } = await supabase
        .from('users')
        .select('id, username, email, role, updated_at');
      if (usersError) throw usersError;
      setUsers(usersData || []);

      const { data: ticketsData, error: ticketsError } = await supabase
        .from('tickets')
        .select('ticket_id, ticket_no, gnsw_truck_no, date, submitted_at, sad_no, gross, tare, net, file_url, driver, status, operation')
        .order('submitted_at', { ascending: false })
        .limit(5000);
      if (ticketsError) throw ticketsError;
      setTickets(ticketsData || []);

      const { data: outData, error: outError } = await supabase
        .from('outgate')
        .select('id, ticket_id, ticket_no, vehicle_number, driver, sad_no, gross, tare, net, created_at')
        .order('created_at', { ascending: false })
        .limit(5000);
      if (outError) throw outError;
      setOutgates(outData || []);

      // recompute analytics & recent activity
      recomputeAnalytics(ticketsData || [], outData || []);
      // Recent activity built from arrays (memoized below)
    } catch (err) {
      console.error('Admin panel fetch error', err);
      toast({ title: 'Error fetching dashboard data', description: err?.message || 'Unexpected error', status: 'error', duration: 6000, isClosable: true });
      setUsers([]);
      setTickets([]);
      setOutgates([]);
      setAnalytics((prev) => ({ ...prev, ticketsProcessed: 0, trucksExited: 0, gateOpsToday: 0, reportsGenerated: 0 }));
    } finally {
      setLoadingData(false);
      setLoadingUsers(false);
    }
  }, [recomputeAnalytics, toast]);

  useEffect(() => {
    if (user && user.role === 'admin') fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchData, user]);

  // ---------- realtime subscriptions ----------
  useEffect(() => {
    if (!user || user.role !== 'admin') return;

    // tickets channel
    const ticketsChannel = supabase
      .channel('public:tickets')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tickets' },
        (payload) => {
          const eventType = resolveEventType(payload) || null;
          const newRec = resolveNewRecord(payload);
          const oldRec = resolveOldRecord(payload);

          setTickets((prev) => {
            const copy = [...prev];
            if (eventType === 'INSERT') {
              if (newRec) copy.unshift(newRec);
            } else if (eventType === 'UPDATE') {
              if (newRec) {
                const idx = copy.findIndex((r) => String(r.ticket_id) === String(newRec.ticket_id) || String(r.ticket_no) === String(newRec.ticket_no));
                if (idx !== -1) copy[idx] = { ...copy[idx], ...newRec };
                else copy.unshift(newRec);
              }
            } else if (eventType === 'DELETE') {
              if (oldRec) {
                const idToRemove = oldRec.ticket_id ?? oldRec.ticket_no;
                if (idToRemove) return copy.filter((r) => String(r.ticket_id ?? r.ticket_no) !== String(idToRemove));
              }
            }
            return copy;
          });
        }
      )
      .subscribe();

    // outgate channel
    const outChannel = supabase
      .channel('public:outgate')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'outgate' },
        (payload) => {
          const eventType = resolveEventType(payload) || null;
          const newRec = resolveNewRecord(payload);
          const oldRec = resolveOldRecord(payload);

          setOutgates((prev) => {
            const copy = [...prev];
            if (eventType === 'INSERT') {
              if (newRec) copy.unshift(newRec);
            } else if (eventType === 'UPDATE') {
              if (newRec) {
                const idx = copy.findIndex((r) => String(r.id) === String(newRec.id));
                if (idx !== -1) copy[idx] = { ...copy[idx], ...newRec };
                else copy.unshift(newRec);
              }
            } else if (eventType === 'DELETE') {
              if (oldRec) {
                const idToRemove = oldRec.id;
                if (idToRemove) return copy.filter((r) => String(r.id) !== String(idToRemove));
              }
            }
            return copy;
          });

          // show quick toast for an insert
          try {
            if (eventType === 'INSERT' && newRec) {
              const link = `/outgate/tickets/${newRec.ticket_id ?? newRec.ticket_no ?? ''}`;
              toast({
                duration: 8000,
                isClosable: true,
                position: 'top-right',
                render: ({ onClose }) => (
                  <Box color="white" bg="purple.500" p={3} borderRadius="md" boxShadow="md">
                    <HStack justify="space-between">
                      <Box>
                        <Text fontWeight="bold">Exit Confirmed</Text>
                        <Text fontSize="sm">Exit recorded for {newRec.vehicle_number ?? newRec.ticket_no ?? ''}.</Text>
                      </Box>
                      <HStack>
                        <Button size="sm" colorScheme="whiteAlpha" onClick={() => { onClose(); navigate(link); }}>Open</Button>
                        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
                      </HStack>
                    </HStack>
                  </Box>
                ),
              });
            }
          } catch (e) {
            console.warn('outgate toast error', e);
          }
        }
      )
      .subscribe();

    return () => {
      try { ticketsChannel.unsubscribe(); } catch (_) { /* ignore */ }
      try { outChannel.unsubscribe(); } catch (_) { /* ignore */ }
    };
  }, [user, toast, navigate]);

  // Whenever tickets or outgates arrays change, recompute analytics & recent activity (memoized)
  useEffect(() => {
    recomputeAnalytics(tickets, outgates);
    // recentActivity rebuilt via memo (below)
  }, [tickets, outgates, recomputeAnalytics]);

  // Recent activity memoized
  const recentActivity = useMemo(() => buildActivityFromState(tickets, outgates, users), [tickets, outgates, users, buildActivityFromState]);

  // CSV export for activity
  const exportActivityCsv = () => {
    const rows = (recentActivity || []).slice(0, activityLimit).map((r) => ({
      time: r.time,
      type: r.type,
      title: r.title,
      meta: JSON.stringify(r.meta || {}),
    }));
    if (!rows.length) {
      toast({ title: 'No activity to export', status: 'info', duration: 1800 });
      return;
    }
    const keys = Object.keys(rows[0]);
    const csv = [keys.join(','), ...rows.map((r) => keys.map((k) => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `activity-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); a.remove(); URL.revokeObjectURL(url);
    toast({ title: 'Activity exported', status: 'success', duration: 1500 });
  };

  // chart data
  const chartLineData = useMemo(() => {
    const days = [];
    const counts = [];
    for (let i = chartDays - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      days.push(d);
      counts.push(0);
    }
    const labels = days.map((d) => d.toLocaleDateString());
    (tickets || []).forEach((t) => {
      const dt = new Date(t.submitted_at || t.date || t.created_at || null);
      if (!dt || Number.isNaN(dt.getTime())) return;
      for (let i = 0; i < days.length; i++) {
        const start = days[i].getTime();
        const end = start + 24 * 60 * 60 * 1000 - 1;
        if (dt.getTime() >= start && dt.getTime() <= end) {
          counts[i] += 1;
          break;
        }
      }
    });
    return { labels, datasets: [{ label: 'Tickets', data: counts, tension: 0.3, fill: false, borderWidth: 2 }] };
  }, [tickets, chartDays]);

  const chartPieData = useMemo(() => {
    const counts = {};
    (users || []).forEach((u) => { const r = u.role || 'unknown'; counts[r] = (counts[r] || 0) + 1; });
    const labels = Object.keys(counts);
    const data = labels.map((l) => counts[l]);
    return { labels, datasets: [{ data, backgroundColor: labels.map((_, idx) => `hsl(${(idx * 60) % 360} 70% 60%)`) }] };
  }, [users]);

  // displayed activity with filter + debounced search
  const displayedActivity = useMemo(() => {
    const arr = recentActivity.filter((a) => (activityFilter === 'all' ? true : a.type === activityFilter));
    const q = (debouncedActivitySearch || '').trim().toLowerCase();
    if (!q) return arr.slice(0, activityLimit);
    const filtered = arr.filter((it) => {
      const hay = (it.title + ' ' + JSON.stringify(it.meta || {})).toLowerCase();
      return hay.includes(q);
    });
    return filtered.slice(0, activityLimit);
  }, [recentActivity, activityFilter, activityLimit, debouncedActivitySearch]);

  // ActivityItem
  const ActivityItem = ({ item }) => {
    const badgeColor = item.type === 'weighbridge' ? 'teal' : item.type === 'outgate' ? 'purple' : 'blue';
    const openDetail = () => {
      if (item.type === 'weighbridge') {
        const ticketId = item.meta?.ticket_id ?? String(item.id || '').replace(/^ticket-/, '');
        if (ticketId) navigate(`/tickets/${ticketId}`);
      } else if (item.type === 'outgate') {
        const ticketId = item.meta?.ticket_id;
        const outId = item.meta?.outgate_id;
        if (ticketId) navigate(`/outgate/tickets/${ticketId}`);
        else if (outId) navigate(`/outgate/tickets/${outId}`);
      } else if (item.type === 'users') {
        navigate('/users');
      }
    };

    const Icon = item.type === 'weighbridge' ? FiFileText : item.type === 'outgate' ? FiTruck : FiUsers;

    return (
      <Popover>
        <PopoverTrigger>
          <MotionBox
            p={3}
            borderRadius="md"
            bg={activityItemBg}
            boxShadow={shadows.md}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -3 }}
            cursor="pointer"
            role="group"
            aria-label={`${item.type} activity`}
          >
            <HStack justify="space-between" align="start">
              <VStack align="start" spacing={0}>
                <HStack>
                  <Box as={Icon} boxSize={4} color="gray.500" />
                  <Text fontSize="sm" fontWeight="semibold">{item.title}</Text>
                  {(item.type === 'weighbridge' || item.type === 'outgate') && (
                    <Button size="xs" onClick={(e) => { e.stopPropagation(); openDetail(); }} variant="ghost" colorScheme="blue">View</Button>
                  )}
                </HStack>
                <Text fontSize="xs" color="gray.500">{new Date(item.time).toLocaleString()}</Text>
                {item.meta && (
                  <HStack mt={2} spacing={2}>
                    {item.meta.truck && <Tag size="sm">Truck: {String(item.meta.truck)}</Tag>}
                    {item.meta.driver && <Tag size="sm">Driver: {String(item.meta.driver)}</Tag>}
                    {item.meta.sad && <Tag size="sm">SAD: {String(item.meta.sad)}</Tag>}
                  </HStack>
                )}
              </VStack>

              <Badge colorScheme={badgeColor} bg={activityBadgeBg} px={2} py={1} borderRadius="md" textTransform="capitalize">{item.type}</Badge>
            </HStack>
          </MotionBox>
        </PopoverTrigger>

        <PopoverContent>
          <PopoverArrow />
          <PopoverHeader fontWeight="bold">{item.title}</PopoverHeader>
          <PopoverCloseButton />
          <PopoverBody>
            <Text fontSize="sm" color="gray.600" mb={2}><b>When:</b> {new Date(item.time).toLocaleString()}</Text>
            {item.meta && (
              <>
                <Text fontSize="sm"><b>Truck:</b> {item.meta.truck ?? '—'}</Text>
                <Text fontSize="sm"><b>Driver:</b> {item.meta.driver ?? '—'}</Text>
                <Text fontSize="sm"><b>SAD:</b> {item.meta.sad ?? '—'}</Text>
                <Text fontSize="sm"><b>Ticket:</b> {item.meta.ticket_id ?? '—'}</Text>
                <Text fontSize="sm"><b>Gross/Net:</b> {(item.meta.gross ?? item.meta.net) ?? '—'}</Text>
              </>
            )}
            <HStack mt={3} justify="flex-end">
              <Button size="sm" onClick={openDetail} colorScheme="teal">Open</Button>
            </HStack>
          </PopoverBody>
        </PopoverContent>
      </Popover>
    );
  };

  // actions
  const handleLoadMoreActivity = () => setActivityLimit((p) => p + 8);
  const handleShowLessActivity = () => setActivityLimit((p) => Math.max(4, p - 8));
  const refreshData = async () => { await fetchData(); toast({ title: 'Data refreshed', status: 'success', duration: 1500 }); };

  // Loading skeleton UI while fetching
  if (authLoading || loadingData || loadingUsers) {
    return (
      <Box textAlign="center" mt="20">
        <Spinner size="xl" />
        <Text mt={4}>Loading dashboard...</Text>
      </Box>
    );
  }

  return (
    <Box mt={8} px={{ base: '4', md: '10' }} pb={8}>
      <Heading mb={6} textAlign="center" fontWeight="extrabold">Admin Panel</Heading>

      {/* Top Stats — use responsive minChildWidth for better scaling */}
      <SimpleGrid minChildWidth="220px" spacing={6} mb={6}>
        <Stat bg={statBg} p={4} borderRadius="md" boxShadow="sm">
          <StatLabel fontWeight="bold">Gate Ops (Today)</StatLabel>
          <StatNumber>{analytics.gateOpsToday ?? 0}</StatNumber>
          <StatHelpText>Entries & exits today (Pending + Exited)</StatHelpText>
        </Stat>

        <Stat bg={statBg} p={4} borderRadius="md" boxShadow="sm">
          <StatLabel fontWeight="bold">Tickets Processed</StatLabel>
          <StatNumber>{analytics.ticketsProcessed ?? 0}</StatNumber>
          <StatHelpText>Unique tickets processed (tickets table)</StatHelpText>
        </Stat>

        <Stat bg="linear-gradient(90deg, rgba(16,185,129,0.04), rgba(16,185,129,0.01))" p={4} borderRadius="md" boxShadow="sm" border="1px solid" borderColor="teal.300">
          <StatLabel fontWeight="bold">Trucks Exited</StatLabel>
          <MotionStatNumber fontSize="2xl" animate={trucksAnim} transition={{ type: 'spring', stiffness: 300, damping: 20 }}>
            {analytics.trucksExited ?? 0}
          </MotionStatNumber>
          <StatHelpText>Unique tickets with exit recorded (tickets or outgate)</StatHelpText>
        </Stat>

        <Stat bg={statBg} p={4} borderRadius="md" boxShadow="sm">
          <StatLabel fontWeight="bold">Reports Generated</StatLabel>
          <StatNumber>{analytics.reportsGenerated ?? 0}</StatNumber>
          <StatHelpText>Tickets with attachments</StatHelpText>
        </Stat>

      </SimpleGrid>

      <Divider mb={6} />

      {/* Charts + Actions */}
      <SimpleGrid columns={{ base: 1, md: 3 }} spacing={6} mb={6}>
        {/* Line chart */}
        <Box p={4} bg={statBg} borderRadius="md" boxShadow="sm">
          <HStack justify="space-between" align="center" mb={3}>
            <Heading size="sm">Recent Tickets</Heading>
            <HStack>
              <Select size="sm" value={chartDays} onChange={(e) => setChartDays(Number(e.target.value))}>
                {[7, 14, 30].map((n) => <option key={n} value={n}>{n} days</option>)}
              </Select>
              <IconButton aria-label="Refresh charts" icon={<FiRefreshCw />} size="sm" onClick={refreshData} />
            </HStack>
          </HStack>
          <Box minH="160px">
            <Line
              data={chartLineData}
              options={{
                responsive: true,
                plugins: { legend: { display: false }, title: { display: false } },
                scales: { x: { grid: { display: false } }, y: { ticks: { precision: 0 } } },
              }}
            />
          </Box>
        </Box>

        {/* Pie chart */}
        <Box p={4} bg={statBg} borderRadius="md" boxShadow="sm">
          <HStack justify="space-between" align="center" mb={3}>
            <Heading size="sm">User Roles</Heading>
            <Tooltip label="Export users CSV">
              <IconButton size="sm" icon={<FiDownload />} onClick={() => {
                const rows = (users || []).map(u => ({ id: u.id, username: u.username, email: u.email, role: u.role }));
                if (!rows.length) return toast({ title: 'No users', status: 'info', duration: 1500 });
                const keys = Object.keys(rows[0]);
                const csv = [keys.join(','), ...rows.map(r => keys.map(k => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = `users-${new Date().toISOString().slice(0,10)}.csv`; a.click(); a.remove(); URL.revokeObjectURL(url);
                toast({ title: 'Users exported', status: 'success', duration: 1500 });
              }} />
            </Tooltip>
          </HStack>
          <Box minH="160px" display="flex" alignItems="center" justifyContent="center">
            <Pie data={chartPieData} options={{ plugins: { legend: { position: 'bottom' } }, maintainAspectRatio: false }} />
          </Box>
        </Box>

        {/* Quick actions + activity filter */}
        <Box p={4} bg={statBg} borderRadius="md" boxShadow="sm">
          <Heading size="sm" mb={3}>Quick Actions</Heading>
          <VStack spacing={3} align="stretch">
            <Button colorScheme="blue" onClick={refreshData}>Refresh Data</Button>
            <Button colorScheme="purple" onClick={() => toast({ title: 'Report generation triggered', status: 'success', duration: 1500 })}>Generate System Report</Button>
            <Button variant="ghost" onClick={exportActivityCsv}>Export Activity</Button>

            <Divider />

            <Heading size="xs" mt={2}>Activity Filter</Heading>
            <Select size="sm" value={activityFilter} onChange={(e) => setActivityFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="weighbridge">Weighbridge</option>
              <option value="outgate">Outgate</option>
              <option value="users">Users</option>
            </Select>
            <Input size="sm" placeholder="Search activity (ticket/truck/driver/SAD)" value={activitySearch} onChange={(e) => setActivitySearch(e.target.value)} aria-label="Search activity" />
          </VStack>
        </Box>
      </SimpleGrid>

      {/* Activity Feed */}
      <Box bg={statBg} borderRadius="md" p={4} boxShadow="sm" mb={6}>
        <HStack justify="space-between" mb={3}>
          <Heading size="md">Recent Activity</Heading>
          <HStack>
            <Text fontSize="sm" color="gray.500">{displayedActivity.length} of {recentActivity.length}</Text>
            <Button size="sm" onClick={handleLoadMoreActivity}>Load more</Button>
            <Button size="sm" onClick={handleShowLessActivity}>Show less</Button>
          </HStack>
        </HStack>
        <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3} ref={activityRef}>
          {displayedActivity.length === 0 ? <Text color="gray.500">No activity yet.</Text> : displayedActivity.map(item => <ActivityItem key={item.id} item={item} />)}
        </SimpleGrid>
      </Box>

      <Divider mb={6} />

      {/* Recent users summary */}
      <Box bg={statBg} borderRadius="md" p={4} boxShadow="sm">
        <HStack justify="space-between" mb={3}>
          <Heading size="md">Users ({users.length})</Heading>
          <Button size="sm" onClick={() => navigate('/users')}>Manage Users</Button>
        </HStack>
        <SimpleGrid columns={{ base: 1, md: 3 }} spacing={3}>
          {(users || []).slice(0, 6).map((u) => (
            <HStack key={u.id} p={3} borderRadius="md" bg={userCardBg} boxShadow="sm" spacing={3}>
              <Avatar name={u.username || u.email} size="sm" />
              <VStack align="start" spacing={0}>
                <Text fontSize="sm" fontWeight="semibold">{u.username}</Text>
                <Text fontSize="xs" color="gray.500">{u.role}</Text>
              </VStack>
              <Badge ml="auto" colorScheme="gray">{u.role}</Badge>
            </HStack>
          ))}
        </SimpleGrid>
      </Box>
    </Box>
  );
}
