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
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverArrow,
  PopoverBody,
  PopoverHeader,
  PopoverCloseButton,
  Input,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  useDisclosure,
  Stack,
  Flex,
} from '@chakra-ui/react';
import { motion, useAnimation } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { FiRefreshCw, FiDownload, FiTruck, FiFileText, FiUsers, FiPlus } from 'react-icons/fi';
import { Line } from 'react-chartjs-2';
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

/* small debounce hook */
function useDebounce(value, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function AdminPanel() {
  const toast = useToast();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  // theme
  const statBg = useColorModeValue('white', 'gray.700');
  const activityItemBg = useColorModeValue('rgba(255,255,255,0.6)', 'rgba(255,255,255,0.03)');
  const activityBadgeBg = useColorModeValue('rgba(255,255,255,0.8)', 'rgba(255,255,255,0.06)');
  const userCardBg = useColorModeValue('white', 'gray.800');

  // data
  const [users, setUsers] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [outgates, setOutgates] = useState([]);
  const [reports, setReports] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingData, setLoadingData] = useState(true);
  const [loadingReports, setLoadingReports] = useState(true);

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
  const [activityFilter] = useState('all');
  const [activityLimit, setActivityLimit] = useState(8);
  const [activitySearch] = useState('');
  const debouncedActivitySearch = useDebounce(activitySearch, 250);

  // reports modal/popover + orb modal (generate)
  const { isOpen: isReportsOpen, onOpen: onReportsOpen, onClose: onReportsClose } = useDisclosure();
  const { isOpen: isNewReportOpen, onOpen: onNewReportOpen, onClose: onNewReportClose } = useDisclosure();
  const [reportSearch, setReportSearch] = useState('');
  const [reportSortDir, setReportSortDir] = useState('desc');
  const [reportLoadingExport, setReportLoadingExport] = useState(false);
  const debouncedReportSearch = useDebounce(reportSearch, 200);

  const activityRef = useRef(null);

  // animations & prev refs for pulse
  const trucksAnim = useAnimation();
  const reportsAnim = useAnimation();
  const prevTrucksExitedRef = useRef(0);
  const prevReportsRef = useRef(0);

  // mounted guard to ensure animation controls are started only after mount
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // voice recognition
  const recognitionRef = useRef(null);
  const [listening, setListening] = useState(false);

  // redirect non-admins
  useEffect(() => {
    if (!authLoading) {
      if (!user) navigate('/login');
      else if (user.role !== 'admin') navigate('/');
    }
  }, [authLoading, user, navigate]);

  // helpers
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

  // Build recent activity (includes reports)
  const buildActivityFromState = useCallback((ticketsArr = [], outgatesArr = [], usersArr = [], reportsArr = []) => {
    const items = [];
    const take = (arr, n = 80) => (arr || []).slice(0, n);

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

    // include recent reports (up to 40)
    if (reportsArr && reportsArr.length) {
      (reportsArr || []).slice(0, 40).forEach((r) => {
        items.push({
          id: `report-${r.id}`,
          type: 'report',
          time: r.generated_at || r.created_at || new Date().toISOString(),
          title: `${r.report_type || 'Report'} generated`,
          meta: { report_id: r.id, generated_by: r.generated_by, file_url: r.file_url, report_type: r.report_type },
        });
      });
    }

    items.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
    return items;
  }, []);

  // payload resolvers for realtime
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

  // recompute analytics single-source (tickets/outgates/reports)
  const recomputeAnalytics = useCallback((ticketsArr = [], outgatesArr = [], reportsArr = []) => {
    // ticketsProcessed: unique ticket_no or ticket_id
    const ticketIdSet = new Set();
    (ticketsArr || []).forEach((t) => {
      const tn = (t.ticket_no ?? t.ticketNo ?? '').toString().trim();
      if (tn) ticketIdSet.add(tn);
      else if (t.ticket_id) ticketIdSet.add(`__id_${String(t.ticket_id)}`);
      else ticketIdSet.add(`__row_${Math.random()}`);
    });
    const ticketsProcessed = ticketIdSet.size;

    // trucksExited: status 'exited' OR present in outgates
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

    // reportsGenerated derived from reportsArr length (single source)
    const reportsGenerated = (reportsArr || []).length;

    // animations for increases — only start animations if component mounted
    if (mountedRef.current) {
      try {
        if (trucksExited > (prevTrucksExitedRef.current ?? 0)) {
          trucksAnim.start({ scale: [1, 1.08, 1], transition: { duration: 0.6 } });
        }
      } catch (e) {
        // swallow if animation cannot start (safety)
        // console.debug('trucksAnim.start failed', e);
      }

      try {
        if (reportsGenerated > (prevReportsRef.current ?? 0)) {
          reportsAnim.start({ scale: [1, 1.06, 1], transition: { duration: 0.6 } });
        }
      } catch (e) {
        // console.debug('reportsAnim.start failed', e);
      }
    }

    prevTrucksExitedRef.current = trucksExited;
    prevReportsRef.current = reportsGenerated;

    setAnalytics((prev) => ({
      gateOpsToday,
      ticketsProcessed,
      trucksExited,
      reportsGenerated,
      unreadNotifications: prev.unreadNotifications ?? 0,
    }));
  }, [reportsAnim, trucksAnim]);

  // initial fetch (parallel)
  const fetchData = useCallback(async () => {
    setLoadingData(true);
    setLoadingUsers(true);
    setLoadingReports(true);
    try {
      // fetch in parallel to reduce time
      const [usersRes, ticketsRes, outRes, reportsRes] = await Promise.all([
        supabase.from('users').select('id, username, email, role, updated_at'),
        supabase.from('tickets').select('ticket_id, ticket_no, gnsw_truck_no, date, submitted_at, sad_no, gross, tare, net, file_url, driver, status, operation').order('submitted_at', { ascending: false }).limit(2000),
        supabase.from('outgate').select('id, ticket_id, ticket_no, vehicle_number, driver, sad_no, gross, tare, net, created_at').order('created_at', { ascending: false }).limit(2000),
        supabase.from('reports_generated').select('id, report_type, generated_by, generated_at, file_url').order('generated_at', { ascending: false }).limit(2000),
      ]);

      if (usersRes.error) throw usersRes.error;
      if (ticketsRes.error) throw ticketsRes.error;
      if (outRes.error) throw outRes.error;
      if (reportsRes.error) throw reportsRes.error;

      setUsers(usersRes.data || []);
      setTickets(ticketsRes.data || []);
      setOutgates(outRes.data || []);
      setReports(reportsRes.data || []);

      // recompute analytics
      recomputeAnalytics(ticketsRes.data || [], outRes.data || [], reportsRes.data || []);
    } catch (err) {
      console.error('Admin panel fetch error', err);
      toast({ title: 'Error fetching dashboard data', description: err?.message || 'Unexpected error', status: 'error', duration: 6000, isClosable: true });
      setUsers([]);
      setTickets([]);
      setOutgates([]);
      setReports([]);
      setAnalytics((prev) => ({ ...prev, ticketsProcessed: 0, trucksExited: 0, gateOpsToday: 0, reportsGenerated: 0 }));
    } finally {
      setLoadingData(false);
      setLoadingUsers(false);
      setLoadingReports(false);
    }
  }, [recomputeAnalytics, toast]);

  useEffect(() => {
    if (user && user.role === 'admin') fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchData, user]);

  // realtime subscriptions: update arrays & analytics
  useEffect(() => {
    if (!user || user.role !== 'admin') return;

    const ticketsChannel = supabase
      .channel('public:tickets')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, (payload) => {
        const evt = resolveEventType(payload);
        const newRec = resolveNewRecord(payload);
        const oldRec = resolveOldRecord(payload);

        setTickets((prev) => {
          const copy = [...prev];
          if (evt === 'INSERT') {
            if (newRec) copy.unshift(newRec);
          } else if (evt === 'UPDATE') {
            if (newRec) {
              const idx = copy.findIndex((r) => String(r.ticket_id) === String(newRec.ticket_id) || String(r.ticket_no) === String(newRec.ticket_no));
              if (idx !== -1) copy[idx] = { ...copy[idx], ...newRec };
              else copy.unshift(newRec);
            }
          } else if (evt === 'DELETE') {
            if (oldRec) {
              const idToRemove = oldRec.ticket_id ?? oldRec.ticket_no;
              if (idToRemove) return copy.filter((r) => String(r.ticket_id ?? r.ticket_no) !== String(idToRemove));
            }
          }
          return copy;
        });
      })
      .subscribe();

    const outChannel = supabase
      .channel('public:outgate')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'outgate' }, (payload) => {
        const evt = resolveEventType(payload);
        const newRec = resolveNewRecord(payload);
        const oldRec = resolveOldRecord(payload);

        setOutgates((prev) => {
          const copy = [...prev];
          if (evt === 'INSERT') {
            if (newRec) copy.unshift(newRec);
          } else if (evt === 'UPDATE') {
            if (newRec) {
              const idx = copy.findIndex((r) => String(r.id) === String(newRec.id));
              if (idx !== -1) copy[idx] = { ...copy[idx], ...newRec };
              else copy.unshift(newRec);
            }
          } else if (evt === 'DELETE') {
            if (oldRec) {
              const idToRemove = oldRec.id;
              if (idToRemove) return copy.filter((r) => String(r.id) !== String(idToRemove));
            }
          }
          return copy;
        });

        // quick toast for inserted outgate (optional)
        try {
          if (evt === 'INSERT' && newRec) {
            const link = `/outgate/tickets/${newRec.ticket_id ?? newRec.ticket_no ?? ''}`;
            toast({
              duration: 7000,
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
      })
      .subscribe();

    // reports channel
    const reportsChannel = supabase
      .channel('public:reports_generated')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reports_generated' }, (payload) => {
        const evt = resolveEventType(payload);
        const newRec = resolveNewRecord(payload);
        const oldRec = resolveOldRecord(payload);

        setReports((prev) => {
          const copy = [...prev];
          if (evt === 'INSERT') {
            if (newRec) copy.unshift(newRec);
          } else if (evt === 'UPDATE') {
            if (newRec) {
              const idx = copy.findIndex((r) => String(r.id) === String(newRec.id));
              if (idx !== -1) copy[idx] = { ...copy[idx], ...newRec };
              else copy.unshift(newRec);
            }
          } else if (evt === 'DELETE') {
            if (oldRec) {
              const idToRemove = oldRec.id;
              if (idToRemove) return copy.filter((r) => String(r.id) !== String(idToRemove));
            }
          }
          return copy;
        });

        // toast & animate on new report
        try {
          if (evt === 'INSERT' && newRec) {
            if (mountedRef.current) {
              try { reportsAnim.start({ scale: [1, 1.06, 1], transition: { duration: 0.6 } }); } catch (e) {}
            }

            const actorLabel = (newRec.generated_by && ((users.find(u => String(u.id) === String(newRec.generated_by))?.username) || newRec.generated_by)) || 'Unknown';

            toast({
              duration: 7000,
              isClosable: true,
              position: 'top-right',
              render: ({ onClose }) => (
                <Box color="white" bg="teal.500" p={3} borderRadius="md" boxShadow="md">
                  <HStack justify="space-between">
                    <Box>
                      <Text fontWeight="bold">New Report</Text>
                      <Text fontSize="sm">{newRec.report_type} generated by {actorLabel}</Text>
                    </Box>
                    <HStack>
                      <Button size="sm" colorScheme="whiteAlpha" onClick={() => { onClose(); onReportsOpen(); }}>Open</Button>
                      <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
                    </HStack>
                  </HStack>
                </Box>
              ),
            });
          }
        } catch (e) {
          console.warn('reports toast error', e);
        }
      })
      .subscribe();

    return () => {
      try { ticketsChannel.unsubscribe(); } catch (_) { /* ignore */ }
      try { outChannel.unsubscribe(); } catch (_) { /* ignore */ }
      try { reportsChannel.unsubscribe(); } catch (_) { /* ignore */ }
    };
  }, [user, navigate, toast, users, reportsAnim, onReportsOpen]);

  // Whenever underlying arrays change, recompute analytics
  useEffect(() => {
    recomputeAnalytics(tickets, outgates, reports);
    // rebuild recentActivity is memo below
  }, [tickets, outgates, reports, recomputeAnalytics]);

  // recent activity (memoized and includes reports)
  const recentActivity = useMemo(() => buildActivityFromState(tickets, outgates, users, reports), [tickets, outgates, users, reports, buildActivityFromState]);

  // displayed activity with filter + search
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

  // chart line data with subtle gradient fill
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
    return {
      labels,
      datasets: [
        {
          label: 'Tickets',
          data: counts,
          tension: 0.3,
          fill: true,
          borderWidth: 2,
          pointRadius: 3,
          backgroundColor: function(context) {
            const ctx = context.chart.ctx;
            const gradient = ctx.createLinearGradient(0, 0, 0, 220);
            gradient.addColorStop(0, 'rgba(99,102,241,0.28)');
            gradient.addColorStop(1, 'rgba(14,165,233,0.04)');
            return gradient;
          },
          borderColor: 'rgba(99,102,241,0.95)',
        },
      ],
    };
  }, [tickets, chartDays]);

  // pie chart for users

  // ActivityItem component (keeps popovers contained)
  const ActivityItem = ({ item }) => {
    const badgeColor = item.type === 'weighbridge' ? 'teal' : item.type === 'outgate' ? 'purple' : item.type === 'report' ? 'orange' : 'blue';
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
      } else if (item.type === 'report') {
        onReportsOpen();
      }
    };

    const Icon = item.type === 'weighbridge' ? FiFileText : item.type === 'outgate' ? FiTruck : item.type === 'report' ? FiFileText : FiUsers;

    return (
      <Popover>
        <PopoverTrigger>
          <MotionBox
            p={3}
            borderRadius="12px"
            bg={activityItemBg}
            boxShadow={shadows.md}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -6, boxShadow: shadows.lg }}
            cursor="pointer"
            role="group"
            aria-label={`${item.type} activity`}
            transition={{ type: 'spring', stiffness: 200, damping: 20 }}
            style={{
              backdropFilter: 'blur(6px)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <HStack justify="space-between" align="start">
              <VStack align="start" spacing={0}>
                <HStack>
                  <Box as={Icon} boxSize={4} color="gray.500" />
                  <Text fontSize="sm" fontWeight="semibold">{item.title}</Text>
                  {(item.type === 'weighbridge' || item.type === 'outgate') && (
                    <Button size="xs" onClick={(e) => { e.stopPropagation(); openDetail(); }} variant="ghost" colorScheme="blue">Open</Button>
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

              <Badge colorScheme={badgeColor} bg={activityBadgeBg} px={3} py={1} borderRadius="md" textTransform="capitalize">{item.type}</Badge>
            </HStack>
          </MotionBox>
        </PopoverTrigger>

        <PopoverContent>
          <PopoverArrow />
          <PopoverCloseButton />
          <PopoverHeader fontWeight="bold">{item.title}</PopoverHeader>
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

  // Reports filtering / export
  const filteredSortedReports = useMemo(() => {
    const q = (debouncedReportSearch || '').trim().toLowerCase();
    let arr = (reports || []).slice();
    if (q) {
      arr = arr.filter((r) => {
        const actor = String(r.generated_by ?? '').toLowerCase();
        const type = String(r.report_type ?? '').toLowerCase();
        const file = String(r.file_url ?? '').toLowerCase();
        return actor.includes(q) || type.includes(q) || file.includes(q);
      });
    }
    arr.sort((a, b) => {
      const da = new Date(a.generated_at || a.created_at || 0).getTime();
      const db = new Date(b.generated_at || b.created_at || 0).getTime();
      return reportSortDir === 'asc' ? da - db : db - da;
    });
    return arr;
  }, [reports, debouncedReportSearch, reportSortDir]);

  const exportReportsCsv = async () => {
    setReportLoadingExport(true);
    try {
      const rows = filteredSortedReports.map((r) => ({
        id: r.id,
        report_type: r.report_type,
        generated_by: r.generated_by,
        generated_at: r.generated_at ? new Date(r.generated_at).toISOString() : '',
        file_url: r.file_url || '',
      }));
      if (!rows.length) {
        toast({ title: 'No reports to export', status: 'info' });
        setReportLoadingExport(false);
        return;
      }
      const keys = Object.keys(rows[0]);
      const csv = [keys.join(','), ...rows.map((r) => keys.map((k) => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `reports-${new Date().toISOString().slice(0,10)}.csv`; a.click(); a.remove(); URL.revokeObjectURL(url);
      toast({ title: 'Reports exported', status: 'success' });
    } catch (err) {
      console.error('export reports', err);
      toast({ title: 'Export failed', description: err.message || String(err), status: 'error' });
    } finally {
      setReportLoadingExport(false);
    }
  };

  // resolve generated_by to nice label
  const resolveActorLabel = (generated_by) => {
    if (!generated_by) return 'Unknown';
    const byUser = users.find(u => String(u.id) === String(generated_by) || String(u.email) === String(generated_by) || String(u.username) === String(generated_by));
    if (byUser) return `${byUser.username || byUser.email}`;
    return String(generated_by);
  };

  // Voice recognition: simple commands
  const startVoice = () => {
    if (typeof window === 'undefined') {
      toast({ title: 'Voice not supported here', status: 'warning' });
      return;
    }
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      toast({ title: 'Voice not supported', description: 'This browser does not support SpeechRecognition', status: 'warning' });
      return;
    }
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recog = new Speech();
    recog.lang = 'en-US';
    recog.interimResults = false;
    recog.maxAlternatives = 1;

    recog.onresult = (ev) => {
      const text = (ev.results[0][0].transcript || '').toLowerCase();
      toast({ title: 'Heard', description: text, status: 'info', duration: 2500 });

      // commands
      if (text.includes('promote all')) {
        // NOTE: local UI update only to avoid accidental permission escalations
        setUsers((prev) => prev.map((u) => ({ ...u, role: 'admin' })));
        toast({ title: 'Promoted all (UI only)', description: 'All user roles set to admin locally (not persisted)', status: 'success' });
      } else if (text.includes('demote row three') || text.includes('demote row 3') || text.includes('demote third')) {
        setUsers((prev) => {
          if (!prev || prev.length < 3) {
            toast({ title: 'Not enough rows', status: 'warning' });
            return prev;
          }
          const copy = [...prev];
          copy[2] = { ...copy[2], role: 'user' };
          return copy;
        });
        toast({ title: 'Demoted row three (UI only)', status: 'success' });
      } else if (text.includes('generate report') || text.includes('create report') || text.includes('new report')) {
        onNewReportOpen();
      } else if (text.includes('refresh data')) {
        refreshData();
      } else {
        toast({ title: 'Command not recognized', description: text, status: 'warning' });
      }
    };

    recog.onend = () => setListening(false);
    recog.onerror = (e) => {
      setListening(false);
      toast({ title: 'Voice error', description: e?.error || 'Speech recognition error', status: 'error' });
    };

    recognitionRef.current = recog;
    try {
      recog.start();
      setListening(true);
      toast({ title: 'Listening', description: 'Say: "Promote all", "Demote row three", "Generate report"', status: 'info' });
    } catch (e) {
      setListening(false);
      toast({ title: 'Voice error', description: 'Could not start recognition', status: 'error' });
    }
  };

  const stopVoice = () => {
    try {
      if (recognitionRef.current) recognitionRef.current.stop();
    } catch (e) {}
    recognitionRef.current = null;
    setListening(false);
  };

  // confetti helper
  const runConfetti = async () => {
    if (typeof window === 'undefined') return;
    try {
      if (typeof window.confetti === 'function') {
        window.confetti({ particleCount: 140, spread: 70, origin: { y: 0.6 } });
        return;
      }
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.5.1/dist/confetti.browser.min.js';
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
      if (typeof window.confetti === 'function') {
        window.confetti({ particleCount: 140, spread: 70, origin: { y: 0.6 } });
      }
    } catch (e) {
      console.warn('Confetti load failed', e);
    }
  };

  // New report modal: form state
  const [newReportType, setNewReportType] = useState('System Summary');
  const [newReportFileUrl, setNewReportFileUrl] = useState('');
  const [creatingReport, setCreatingReport] = useState(false);

  const handleCreateReport = async () => {
    if (creatingReport) return;
    setCreatingReport(true);
    try {
      const payload = {
        report_type: newReportType,
        generated_by: (user && (user.id || user.email)) || 'unknown',
        generated_at: new Date().toISOString(),
        file_url: newReportFileUrl || null,
      };

      // optimistic UI: create a local temporary object
      const temp = { id: `tmp-${Date.now()}`, ...payload };
      setReports((p) => [temp, ...(p || [])]);

      // persist
      const { data, error } = await supabase.from('reports_generated').insert([payload]).select().single();
      if (error) {
        // rollback optimistic
        setReports((p) => (p || []).filter((r) => r.id !== temp.id));
        toast({ title: 'Failed to create report', description: error.message || String(error), status: 'error' });
      } else {
        // replace temp with actual response (safe)
        setReports((p) => {
          const copy = (p || []).filter((r) => r.id !== temp.id);
          return [data, ...copy];
        });

        await runConfetti();
        toast({ title: 'Report generated', description: `${data.report_type} created`, status: 'success' });
      }
    } catch (err) {
      console.error('create report', err);
      toast({ title: 'Error', description: err?.message || String(err), status: 'error' });
    } finally {
      setCreatingReport(false);
      onNewReportClose();
      setNewReportFileUrl('');
      setNewReportType('System Summary');
    }
  };

  // Loading skeleton UI while fetching
  if (authLoading || loadingData || loadingUsers || loadingReports) {
    return (
      <Box textAlign="center" mt="20">
        <Spinner size="xl" />
        <Text mt={4}>Loading dashboard...</Text>
      </Box>
    );
  }

  // resolveGeneratedBy for UI
  const resolveGeneratedByUI = (r) => {
    if (!r) return 'Unknown';
    try {
      return resolveActorLabel(r.generated_by);
    } catch (e) {
      return String(r.generated_by || 'Unknown');
    }
  };

  return (
    <Box mt={8} px={{ base: '6', md: '12' }} pb={12} fontFamily="Inter, system-ui, -apple-system, 'Segoe UI', Roboto, Arial" maxW="1600px" mx="auto">
      <Heading mb={6} textAlign="center" fontWeight="extrabold">Admin Panel</Heading>

      {/* Header controls */}
      <Flex justify="space-between" align="center" wrap="wrap" gap={4} mb={6}>
        <HStack spacing={3}>
          <Button leftIcon={<FiRefreshCw />} colorScheme="gray" variant="ghost" onClick={refreshData}>Refresh</Button>
          <Button leftIcon={<FiDownload />} colorScheme="blue" variant="ghost" onClick={exportReportsCsv} isLoading={reportLoadingExport}>Export Reports</Button>
          <Button onClick={() => { if (listening) stopVoice(); else startVoice(); }} colorScheme={listening ? 'purple' : 'gray'} variant={listening ? 'solid' : 'outline'}>
            {listening ? 'Listening...' : 'Voice Commands'}
          </Button>
        </HStack>

        <HStack spacing={3}>
          <Text fontSize="sm" color="gray.500">Signed in as</Text>
          <Avatar name={user?.email || user?.id} size="sm" />
          <Text fontWeight="semibold">{user?.email || user?.id}</Text>
        </HStack>
      </Flex>

      {/* Top Stats (neon + glass) */}
      <SimpleGrid minChildWidth="220px" spacing={6} mb={6}>
        <Stat
          p={4}
          borderRadius="12px"
          boxShadow="0 8px 30px rgba(2,6,23,0.06)"
          style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.85), rgba(255,255,255,0.6))',
            border: '1px solid rgba(124,58,237,0.08)',
          }}
        >
          <StatLabel fontWeight="bold" color="#6b21a8">Gate Ops (Today)</StatLabel>
          <StatNumber color="#111827">{analytics.gateOpsToday ?? 0}</StatNumber>
          <StatHelpText>Entries & exits today</StatHelpText>
        </Stat>

        <Stat
          p={4}
          borderRadius="12px"
          boxShadow="0 8px 30px rgba(2,6,23,0.06)"
          style={{
            background: 'linear-gradient(90deg, rgba(6,182,212,0.06), rgba(99,102,241,0.03))',
            border: '1px solid rgba(6,182,212,0.06)',
          }}
        >
          <StatLabel fontWeight="bold" color="#0891b2">Tickets Processed</StatLabel>
          <StatNumber color="#065f46">{analytics.ticketsProcessed ?? 0}</StatNumber>
          <StatHelpText>Unique tickets processed</StatHelpText>
        </Stat>

        <Stat
          p={4}
          borderRadius="12px"
          boxShadow="0 10px 30px rgba(14,165,233,0.06)"
          style={{
            background: 'linear-gradient(135deg, rgba(16,185,129,0.06), rgba(99,102,241,0.03))',
            border: '1px solid rgba(99,102,241,0.06)',
          }}
        >
          <StatLabel fontWeight="bold" color="#059669">Trucks Exited</StatLabel>
          <MotionStatNumber fontSize="2xl" animate={trucksAnim} transition={{ type: 'spring', stiffness: 300, damping: 20 }} color="#065f46">
            {analytics.trucksExited ?? 0}
          </MotionStatNumber>
          <StatHelpText>Unique tickets with exit recorded</StatHelpText>
        </Stat>

        <MotionBox
          as="button"
          textAlign="left"
          p={4}
          borderRadius="12px"
          boxShadow="0 8px 30px rgba(124,58,237,0.08)"
          bg="linear-gradient(90deg, rgba(124,58,237,0.08), rgba(99,102,241,0.02))"
          whileHover={{ scale: 1.01 }}
          animate={reportsAnim}
          style={{ border: '1px solid rgba(124,58,237,0.06)' }}
          onClick={onReportsOpen}
        >
          <Stat>
            <StatLabel fontWeight="bold" color="#7c3aed">Reports Generated</StatLabel>
            <StatNumber color="#6b21a8">{analytics.reportsGenerated ?? 0}</StatNumber>
            <StatHelpText>Reports from Weight & Outgate modules (click to view)</StatHelpText>
          </Stat>
        </MotionBox>
      </SimpleGrid>

      <Divider mb={6} />

      {/* Charts + Activity: improved layout */}
      <SimpleGrid columns={{ base: 1, md: 2 }} spacing={6} mb={6}>
        {/* Left column: line + actions */}
        <Box
          p={4}
          borderRadius="12px"
          boxShadow="0 8px 30px rgba(2,6,23,0.04)"
          style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.96), rgba(255,255,255,0.92))',
            border: '1px solid rgba(2,6,23,0.03)',
          }}
        >
          <HStack justify="space-between" mb={3}>
            <Heading size="md">Recent Tickets</Heading>
            <HStack spacing={2}>
              <Select size="sm" value={chartDays} onChange={(e) => setChartDays(Number(e.target.value))}>
                {[7, 14, 30].map((n) => <option key={n} value={n}>{n} days</option>)}
              </Select>
              <IconButton aria-label="Refresh charts" icon={<FiRefreshCw />} size="sm" onClick={refreshData} />
              <Button leftIcon={<FiPlus />} size="sm" colorScheme="purple" onClick={onNewReportOpen}>New Report</Button>
            </HStack>
          </HStack>

          <Box minH="220px" mb={3}>
            <Line
              data={chartLineData}
              options={{
                responsive: true,
                plugins: { legend: { display: false }, title: { display: false } },
                scales: {
                  x: { grid: { display: false }, ticks: { maxRotation: 0 } },
                  y: { ticks: { precision: 0 } },
                },
                interaction: { intersect: false, mode: 'index' },
                maintainAspectRatio: false,
              }}
            />
          </Box>

          <HStack spacing={4} mt={2} align="center">
            <Box p={3} borderRadius="md" boxShadow="sm" flex="1" bg="linear-gradient(90deg, rgba(124,58,237,0.04), rgba(99,102,241,0.02))">
              <Text fontSize="sm" color="gray.600">Active Tickets</Text>
              <Text fontWeight="bold" fontSize="lg">{analytics.ticketsProcessed}</Text>
            </Box>
            <Box p={3} borderRadius="md" boxShadow="sm" flex="1" bg="linear-gradient(90deg, rgba(16,185,129,0.04), rgba(16,185,129,0.02))">
              <Text fontSize="sm" color="gray.600">Today Ops</Text>
              <Text fontWeight="bold" fontSize="lg">{analytics.gateOpsToday}</Text>
            </Box>
          </HStack>
        </Box>

        {/* Right column: Activity feed (improved) */}
        <Box
          p={4}
          borderRadius="12px"
          boxShadow="0 8px 30px rgba(2,6,23,0.04)"
          style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.96), rgba(255,255,255,0.92))',
            border: '1px solid rgba(2,6,23,0.03)',
          }}
        >
          <HStack justify="space-between" mb={3}>
            <Heading size="md">Recent Activity</Heading>
            <HStack>
              <Text fontSize="sm" color="gray.500">{displayedActivity.length} of {recentActivity.length}</Text>
              <Button size="sm" onClick={handleLoadMoreActivity}>Load more</Button>
              <Button size="sm" onClick={handleShowLessActivity}>Show less</Button>
            </HStack>
          </HStack>

          <SimpleGrid columns={{ base: 1 }} spacing={3} ref={activityRef}>
            {displayedActivity.length === 0 ? <Text color="gray.500">No activity yet.</Text> : displayedActivity.map(item => (
              <ActivityItem key={item.id} item={item} />
            ))}
          </SimpleGrid>
        </Box>
      </SimpleGrid>

      <Divider mb={6} />

      {/* Users summary */}
      <Box bg={statBg} borderRadius="12px" p={4} boxShadow="0 10px 30px rgba(2,6,23,0.04)" mb={6}>
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
              <Badge ml="auto" colorScheme={u.role === 'admin' ? 'purple' : 'gray'}>{u.role}</Badge>
            </HStack>
          ))}
        </SimpleGrid>
      </Box>

      {/* Reports Modal (full) */}
      <Modal isOpen={isReportsOpen} onClose={onReportsClose} size="6xl" scrollBehavior="inside">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Reports Generated ({reports.length})</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <HStack mb={3} spacing={3} align="center">
              <Input placeholder="Search by type or user or file" value={reportSearch} onChange={(e) => setReportSearch(e.target.value)} />
              <Select value={reportSortDir} onChange={(e) => setReportSortDir(e.target.value)} maxW="160px">
                <option value="desc">Newest first</option>
                <option value="asc">Oldest first</option>
              </Select>
              <Button size="sm" leftIcon={<FiDownload />} onClick={exportReportsCsv} isLoading={reportLoadingExport}>Download CSV</Button>
            </HStack>

            <Box overflowX="auto">
              <Table size="sm" variant="striped">
                <Thead>
                  <Tr>
                    <Th>Type</Th>
                    <Th>Generated By</Th>
                    <Th>File</Th>
                    <Th>Generated At</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {filteredSortedReports.length === 0 ? (
                    <Tr><Td colSpan={4} textAlign="center">No reports</Td></Tr>
                  ) : filteredSortedReports.map((r) => (
                    <Tr key={r.id}>
                      <Td textTransform="capitalize">{r.report_type ?? '—'}</Td>
                      <Td>{resolveGeneratedByUI(r)}</Td>
                      <Td>
                        {r.file_url ? (
                          <Button size="xs" variant="link" onClick={() => window.open(r.file_url, '_blank')}>Open file</Button>
                        ) : '—'}
                      </Td>
                      <Td>{r.generated_at ? new Date(r.generated_at).toLocaleString() : '—'}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </Box>
          </ModalBody>
          <ModalFooter>
            <Button onClick={onReportsClose}>Close</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Floating Crystal Orb CTA */}
      <Box position="fixed" bottom="28px" right="28px" zIndex={2200} display="flex" alignItems="center" gap={3}>
        <MotionBox
          onClick={onNewReportOpen}
          whileHover={{ scale: 1.08, y: -4 }}
          whileTap={{ scale: 0.96 }}
          cursor="pointer"
          width="72px"
          height="72px"
          borderRadius="999px"
          display="flex"
          alignItems="center"
          justifyContent="center"
          boxShadow="0 14px 40px rgba(99,102,241,0.18)"
          style={{
            background: 'radial-gradient(circle at 30% 20%, #9f7aea, #7c3aed 40%, #06b6d4 100%)',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
          title="New report"
          aria-label="Create new report"
        >
          <Box fontSize="26px" fontWeight="700">✺</Box>
        </MotionBox>
      </Box>

      {/* New Report holographic modal with DOM 3D cube group (background white as requested) */}
      <Modal isOpen={isNewReportOpen} onClose={() => { if (!creatingReport) onNewReportClose(); }} isCentered size="lg">
        <ModalOverlay />
        <ModalContent
          style={{
            borderRadius: 18,
            overflow: 'hidden',
            background: '#fff', // white background per request
            boxShadow: '0 30px 80px rgba(12,18,63,0.28)',
            border: '1px solid rgba(124,58,237,0.08)',
            position: 'relative',
            maxWidth: '920px',
          }}
        >
          <ModalHeader>
            <HStack spacing={3}>
              <Box
                width="56px"
                height="56px"
                borderRadius="12px"
                display="flex"
                alignItems="center"
                justifyContent="center"
                style={{
                  background: 'linear-gradient(135deg,#7c3aed,#06b6d4)',
                  boxShadow: '0 10px 30px rgba(124,58,237,0.18)',
                  color: 'white',
                }}
              >
                ✸
              </Box>
              <Box>
                <Text fontSize="lg" fontWeight="bold">Create New Report</Text>
                <Text fontSize="sm" color="gray.500">Holographic generator — logs the creation</Text>
              </Box>
            </HStack>
          </ModalHeader>

          <ModalCloseButton isDisabled={creatingReport} />

          <ModalBody>
            {/* canvas-like holographic area with DOM cubes */}
            <Box mb={4} position="relative" height="180px" borderRadius="12px" overflow="visible">
              <Box
                aria-hidden
                style={{
                  position: 'absolute',
                  inset: 0,
                  zIndex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  pointerEvents: 'none',
                }}
              >
                {/* Cube group container */}
                <div className="cube-scene" style={{ width: 260, height: 140 }}>
                  <div className="cube-group">
                    <div className="cube cube-a"><div className="face"></div></div>
                    <div className="cube cube-b"><div className="face"></div></div>
                    <div className="cube cube-c"><div className="face"></div></div>
                  </div>
                </div>
              </Box>

              {/* subtle textual overlay */}
              <Box
                position="absolute"
                zIndex={2}
                left={6}
                top={6}
                bg="transparent"
                p={3}
                borderRadius="md"
                style={{ backdropFilter: 'blur(4px)' }}
              >
                <Text fontSize="sm" color="gray.600">Crystal core</Text>
                <Text fontSize="xs" color="gray.400">Light shards assemble the 3D form</Text>
              </Box>
            </Box>

            <Stack spacing={3}>
              <Box>
                <Text fontSize="sm" color="gray.600" mb={1}>Report Type</Text>
                <Select value={newReportType} onChange={(e) => setNewReportType(e.target.value)}>
                  <option>System Summary</option>
                  <option>Outgate Snapshot</option>
                  <option>Tickets Export</option>
                  <option>Custom</option>
                </Select>
              </Box>

              <Box>
                <Text fontSize="sm" color="gray.600" mb={1}>Attach File URL (optional)</Text>
                <Input placeholder="https://..." value={newReportFileUrl} onChange={(e) => setNewReportFileUrl(e.target.value)} />
              </Box>

              <Box>
                <Text fontSize="xs" color="gray.500">Tip: This modal is cinematic — press Generate to log the report and trigger confetti.</Text>
              </Box>
            </Stack>
          </ModalBody>

          <ModalFooter>
            <Button variant="ghost" onClick={() => { if (!creatingReport) onNewReportClose(); }} mr={3}>Cancel</Button>
            <Button colorScheme="purple" onClick={handleCreateReport} isLoading={creatingReport}>Generate</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* cube CSS (DOM 3D cubes) + ultra-wide 3D panel tweak */}
      <style>{`
        /* Ultra-wide subtle tilt */
        @media (min-width: 1600px) {
          .chakra-box[role="region"] {
            transform: perspective(1400px) rotateX(2deg) rotateY(-2deg);
            transition: transform 0.6s ease;
          }
        }

        /* Cube scene */
        .cube-scene {
          display: flex;
          align-items: center;
          justify-content: center;
          transform-style: preserve-3d;
          perspective: 900px;
        }

        .cube-group {
          width: 200px;
          height: 120px;
          position: relative;
          transform-style: preserve-3d;
        }

        .cube {
          width: 46px;
          height: 46px;
          position: absolute;
          top: 20px;
          left: 50%;
          margin-left: -23px;
          transform-style: preserve-3d;
          animation: floatRotate 5s cubic-bezier(.2,.9,.3,.95) infinite;
          filter: drop-shadow(0 8px 18px rgba(15,23,42,0.12));
        }

        .cube .face {
          position: absolute;
          width: 100%;
          height: 100%;
          border-radius: 6px;
          background: linear-gradient(135deg,#7c3aed, #06b6d4);
          opacity: 0.95;
          transform: translateZ(23px);
        }

        .cube-a { left: 40px; transform-origin: center; animation-delay: 0s; }
        .cube-b { left: 100px; transform-origin: center; animation-delay: 0.22s; transform: translateX(40px) translateZ(-12px) rotateY(18deg); }
        .cube-c { left: 160px; transform-origin: center; animation-delay: 0.45s; transform: translateX(80px) translateZ(-24px) rotateY(32deg); }

        /* different tints per cube */
        .cube-a .face { background: linear-gradient(135deg, rgba(124,58,237,0.95), rgba(99,102,241,0.9)); box-shadow: 0 6px 18px rgba(124,58,237,0.18); }
        .cube-b .face { background: linear-gradient(135deg, rgba(6,182,212,0.98), rgba(16,185,129,0.9)); box-shadow: 0 6px 18px rgba(6,182,212,0.12); }
        .cube-c .face { background: linear-gradient(135deg, rgba(244,63,94,0.95), rgba(249,115,22,0.88)); box-shadow: 0 6px 18px rgba(244,63,94,0.12); }

        @keyframes floatRotate {
          0% { transform: translateY(0px) rotateX(0deg) rotateY(0deg) translateZ(0px); }
          25% { transform: translateY(-8px) rotateX(18deg) rotateY(14deg) translateZ(8px); }
          50% { transform: translateY(0px) rotateX(360deg) rotateY(360deg) translateZ(0px); }
          75% { transform: translateY(-6px) rotateX(12deg) rotateY(6deg) translateZ(6px); }
          100% { transform: translateY(0px) rotateX(0deg) rotateY(0deg) translateZ(0px); }
        }

        /* subtle pulse when modal opens */
        .chakra-modal__content {
          animation: popIn 420ms cubic-bezier(.2,.9,.3,.95);
        }
        @keyframes popIn {
          0% { transform: scale(.985) translateY(8px); opacity: 0; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }
      `}</style>
    </Box>
  );
}
