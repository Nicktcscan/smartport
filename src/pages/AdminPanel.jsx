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
  useBreakpointValue,
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
import { FiRefreshCw, FiDownload } from 'react-icons/fi';
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

function friendlyKeyLabel(key) {
  if (key === 'ticketsProcessed') return 'Tickets Processed';
  if (key === 'trucksExited') return 'Trucks Exited';
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
}

export default function AdminPanel() {
  const toast = useToast();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  // theme / UI tokens (hooks at top-level)
  const statBg = useColorModeValue('white', 'gray.700');
  const activityItemBg = useColorModeValue('gray.50', 'gray.800');
  const activityBadgeBg = useColorModeValue('gray.100', 'gray.700');
  const userCardBg = useColorModeValue('white', 'gray.800');

  // data/state
  const [users, setUsers] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [outgates, setOutgates] = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingData, setLoadingData] = useState(true);

  // analytics (note new keys)
  const [analytics, setAnalytics] = useState({
    gateOpsToday: 0,
    ticketsProcessed: 0,
    trucksExited: 0,
    reportsGenerated: 0,
    unreadNotifications: 0,
  });

  const statsColumns = useBreakpointValue({ base: 1, sm: 2, md: 3, lg: 5 }) || 4;

  // UI controls
  const [chartDays, setChartDays] = useState(DEFAULT_CHART_DAYS);
  const [activityFilter, setActivityFilter] = useState('all');
  const [activityLimit, setActivityLimit] = useState(8);
  const [activitySearch, setActivitySearch] = useState('');
  const activityRef = useRef(null);

  // trucksExited animation controller + prev ref
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

  const buildActivityFromState = useCallback((ticketsArr = [], outgatesArr = [], usersArr = []) => {
    const activity = [];

    (ticketsArr || []).slice(0, 40).forEach((row) => {
      activity.push({
        id: `ticket-${row.ticket_id ?? row.ticket_no ?? Math.random()}`,
        type: 'weighbridge',
        time: row.submitted_at || row.date || new Date().toISOString(),
        title: `Ticket ${row.ticket_no || row.ticket_id || '—'} recorded`,
        meta: { ticket_id: row.ticket_id, truck: row.gnsw_truck_no, sad: row.sad_no, driver: row.driver, gross: row.gross },
      });
    });

    (outgatesArr || []).slice(0, 40).forEach((row) => {
      activity.push({
        id: `out-${row.id ?? Math.random()}`,
        type: 'outgate',
        time: row.created_at || new Date().toISOString(),
        title: `Exit confirmed for ${row.ticket_no || row.vehicle_number || '—'}`,
        meta: { outgate_id: row.id, ticket_id: row.ticket_id, truck: row.vehicle_number, driver: row.driver, sad: row.sad_no, net: row.net },
      });
    });

    (usersArr || []).slice(0, 40).forEach((u) => {
      activity.push({
        id: `user-${u.id}`,
        type: 'users',
        time: u.updated_at || new Date().toISOString(),
        title: `User ${u.username} (${u.role})`,
        meta: { user_id: u.id, email: u.email },
      });
    });

    activity.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
    return activity;
  }, []);

  // ---------- simple resolvers to avoid mixing || and ?? ----------
  const resolveEventType = (payload) => {
    if (!payload) return null;
    if (payload.eventType) return payload.eventType;
    if (payload.event) return payload.event;
    if (payload.type) return payload.type;
    if (payload.payload && payload.payload.type) return payload.payload.type;
    return null;
  };

  const resolveNewRecord = (payload) => {
    if (!payload) return null;
    if (payload.new) return payload.new;
    if (payload.record) return payload.record;
    if (payload.payload && payload.payload.new) return payload.payload.new;
    return null;
  };

  const resolveOldRecord = (payload) => {
    if (!payload) return null;
    if (payload.old) return payload.old;
    if (payload.oldRecord) return payload.oldRecord;
    if (payload.payload && payload.payload.old) return payload.payload.old;
    return null;
  };

  // ---------- initial fetch (one-time) ----------
  const fetchData = useCallback(async () => {
    setLoadingData(true);
    setLoadingUsers(true);
    try {
      // users
      const { data: usersData, error: usersError } = await supabase
        .from('users')
        .select('id, username, email, role, updated_at');
      if (usersError) throw usersError;
      setUsers(usersData || []);

      // tickets
      const { data: ticketsData, error: ticketsError } = await supabase
        .from('tickets')
        .select('ticket_id, ticket_no, gnsw_truck_no, date, submitted_at, sad_no, gross, tare, net, file_url, driver, status, operation')
        .order('submitted_at', { ascending: false })
        .limit(1000);
      if (ticketsError) throw ticketsError;
      setTickets(ticketsData || []);

      // outgate
      const { data: outData, error: outError } = await supabase
        .from('outgate')
        .select('id, ticket_id, ticket_no, vehicle_number, driver, sad_no, gross, tare, net, created_at')
        .order('created_at', { ascending: false })
        .limit(1000);
      if (outError) throw outError;
      setOutgates(outData || []);

      // analytics: gateOpsToday counts tickets for today with status Pending or Exited
      const gateOpsToday = (ticketsData || []).filter((r) =>
        isToday(r.date || r.submitted_at) && statusCountsAsGateOp(r.status)
      ).length;

      const ticketsProcessed = (ticketsData || []).length;
      const trucksExited = (ticketsData || []).filter((r) => String(r.status || '').toLowerCase() === 'exited').length;
      const reportsGenerated = (ticketsData || []).filter((r) => !!r.file_url).length;

      setAnalytics({
        gateOpsToday,
        ticketsProcessed,
        trucksExited,
        reportsGenerated,
        unreadNotifications: 0,
      });

      // build recent activity
      const activity = buildActivityFromState(ticketsData || [], outData || [], usersData || []);
      setRecentActivity(activity);
    } catch (err) {
      console.error('Admin panel fetch error', err);
      toast({ title: 'Error fetching dashboard data', description: err?.message || 'Unexpected error', status: 'error', duration: 6000, isClosable: true });
    } finally {
      setLoadingData(false);
      setLoadingUsers(false);
    }
  }, [buildActivityFromState, toast]);

  useEffect(() => {
    if (user && user.role === 'admin') fetchData();
  }, [fetchData, user]);

  // ---------- delta updates helper ----------
  const adjustAnalyticsDeltaForTicketChange = useCallback((eventType, newRec, oldRec) => {
    setAnalytics((prev) => {
      let {
        gateOpsToday: prevGate,
        ticketsProcessed: prevTickets,
        trucksExited: prevTrucks,
        reportsGenerated: prevReports,
        unreadNotifications: prevUnread,
      } = prev;

      const newStatus = newRec ? String(newRec.status || '').toLowerCase() : null;
      const oldStatus = oldRec ? String(oldRec.status || '').toLowerCase() : null;

      const newIsGateOp = newRec ? isToday(newRec.date || newRec.submitted_at) && statusCountsAsGateOp(newRec.status) : false;
      const oldIsGateOp = oldRec ? isToday(oldRec.date || oldRec.submitted_at) && statusCountsAsGateOp(oldRec.status) : false;

      const newHasFile = !!(newRec && newRec.file_url);
      const oldHasFile = !!(oldRec && oldRec.file_url);

      if (eventType === 'INSERT') {
        prevTickets = prevTickets + 1;
        if (newHasFile) prevReports = prevReports + 1;
        if (newIsGateOp) prevGate = prevGate + 1;
        if (newStatus === 'exited') prevTrucks = prevTrucks + 1;
      } else if (eventType === 'UPDATE') {
        // reportsGenerated delta
        if (!oldHasFile && newHasFile) prevReports += 1;
        if (oldHasFile && !newHasFile) prevReports = Math.max(0, prevReports - 1);

        // gateOpsToday delta
        if (!oldIsGateOp && newIsGateOp) prevGate += 1;
        if (oldIsGateOp && !newIsGateOp) prevGate = Math.max(0, prevGate - 1);

        // trucksExited delta
        if (oldStatus !== 'exited' && newStatus === 'exited') prevTrucks += 1;
        if (oldStatus === 'exited' && newStatus !== 'exited') prevTrucks = Math.max(0, prevTrucks - 1);
      } else if (eventType === 'DELETE') {
        if (oldHasFile) prevReports = Math.max(0, prevReports - 1);
        if (oldIsGateOp) prevGate = Math.max(0, prevGate - 1);
        prevTickets = Math.max(0, prevTickets - 1);
        if (oldStatus === 'exited') prevTrucks = Math.max(0, prevTrucks - 1);
      }

      // Animate trucksExited if changed upward
      if (prevTrucks > (prevTrucksExitedRef.current ?? 0)) {
        trucksAnim.start({ scale: [1, 1.08, 1], transition: { duration: 0.6 } });
      }
      prevTrucksExitedRef.current = prevTrucks;

      return {
        gateOpsToday: prevGate,
        ticketsProcessed: prevTickets,
        trucksExited: prevTrucks,
        reportsGenerated: prevReports,
        unreadNotifications: prevUnread,
      };
    });
  }, [trucksAnim]);

  // ---------- realtime subscriptions (Supabase v2 channels) ----------
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

          // Apply to local tickets array
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

          // Delta adjust analytics
          try {
            adjustAnalyticsDeltaForTicketChange(eventType, newRec, oldRec);
          } catch (e) {
            console.warn('analytics delta error', e);
          }

          // Exit toast (ticket status change to 'exited')
          try {
            const newStatus = newRec ? String(newRec.status || '').toLowerCase() : null;
            const oldStatus = oldRec ? String(oldRec.status || '').toLowerCase() : null;
            if ((eventType === 'INSERT' && newStatus === 'exited') || (eventType === 'UPDATE' && oldStatus !== 'exited' && newStatus === 'exited')) {
              const link = `/outgate/tickets/${newRec?.ticket_id ?? newRec?.ticket_no ?? ''}`;
              toast({
                duration: 8000,
                isClosable: true,
                position: 'top-right',
                render: ({ onClose }) => (
                  <Box color="white" bg="teal.500" p={3} borderRadius="md" boxShadow="md">
                    <HStack justify="space-between">
                      <Box>
                        <Text fontWeight="bold">Truck Exit</Text>
                        <Text fontSize="sm">Truck {newRec?.gnsw_truck_no ?? newRec?.ticket_no ?? ''} has exited.</Text>
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
            console.warn('toast on exit error', e);
          }
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

          // If outgate inserted, show toast linking to outgate
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
      try { ticketsChannel.unsubscribe(); } catch (e) { /* ignore */ }
      try { outChannel.unsubscribe(); } catch (e) { /* ignore */ }
    };
  }, [user, adjustAnalyticsDeltaForTicketChange, toast, navigate]);

  // When tickets/outgates/users arrays change, rebuild recentActivity list (we compute merged list)
  useEffect(() => {
    const activity = buildActivityFromState(tickets, outgates, users);
    setRecentActivity(activity);
  }, [tickets, outgates, users, buildActivityFromState]);

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

  // activity filter + search applied
  const displayedActivity = useMemo(() => {
    const arr = recentActivity.filter((a) => (activityFilter === 'all' ? true : a.type === activityFilter));
    const q = (activitySearch || '').trim().toLowerCase();
    if (!q) return arr.slice(0, activityLimit);
    const filtered = arr.filter((it) => {
      const hay = (it.title + ' ' + JSON.stringify(it.meta || {})).toLowerCase();
      return hay.includes(q);
    });
    return filtered.slice(0, activityLimit);
  }, [recentActivity, activityFilter, activityLimit, activitySearch]);

  // ActivityItem component w/ popover & navigation
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
          >
            <HStack justify="space-between" align="start">
              <VStack align="start" spacing={0}>
                <HStack>
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

              <Badge colorScheme={badgeColor} bg={activityBadgeBg} px={2} py={1} borderRadius="md">{item.type}</Badge>
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

      {/* Top Stats */}
      <SimpleGrid columns={statsColumns} spacing={6} mb={6}>
        {Object.entries(analytics).map(([key, value]) => {
          const isTrucksExited = key === 'trucksExited';
          return (
            <MotionBox
              key={key}
              p={5}
              boxShadow={shadows.md}
              borderRadius="lg"
              bg={isTrucksExited ? 'linear-gradient(90deg, rgba(16,185,129,0.04), rgba(16,185,129,0.01))' : statBg}
              border={isTrucksExited ? '1px solid' : undefined}
              borderColor={isTrucksExited ? 'teal.300' : undefined}
              whileHover={{ scale: 1.03, boxShadow: shadows.lg }}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Stat>
                <StatLabel fontWeight="bold" fontSize="sm" color="gray.600">{friendlyKeyLabel(key)}</StatLabel>
                {isTrucksExited ? (
                  <MotionStatNumber
                    fontSize="2xl"
                    animate={trucksAnim}
                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  >
                    {value ?? 0}
                  </MotionStatNumber>
                ) : (
                  <StatNumber fontSize="2xl">{value ?? 0}</StatNumber>
                )}
                <StatHelpText fontSize="xs" color="gray.500">
                  {key === 'gateOpsToday' && 'Entries & exits today (Pending + Exited)'}
                  {key === 'ticketsProcessed' && 'All tickets processed'}
                  {key === 'trucksExited' && 'Tickets marked Exited'}
                  {key === 'reportsGenerated' && 'Tickets with attachments'}
                  {key === 'unreadNotifications' && 'Pending alerts'}
                </StatHelpText>
              </Stat>
            </MotionBox>
          );
        })}
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
            <Input size="sm" placeholder="Search activity (ticket/truck/driver/SAD)" value={activitySearch} onChange={(e) => setActivitySearch(e.target.value)} />
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
              <Badge ml="auto">{u.role}</Badge>
            </HStack>
          ))}
        </SimpleGrid>
      </Box>
    </Box>
  );
}
