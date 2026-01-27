// src/pages/Albayrak.jsx
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Box,
  Button,
  Flex,
  SimpleGrid,
  Stat,
  StatLabel,
  StatNumber,
  StatHelpText,
  Text,
  Input,
  Select,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Badge,
  Spinner,
  useToast,
  HStack,
  IconButton,
  Tooltip,
  Progress,
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
  Divider,
} from '@chakra-ui/react';
import {
  DownloadIcon,
  RepeatIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@chakra-ui/icons';
import { supabase } from '../supabaseClient';

const DEFAULT_PAGE_SIZE = 10;

// ---------- helpers ----------
const safeLower = (v) => (v ?? '').toString().toLowerCase();

function parseNumber(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(String(val).replace(/[, ]+/g, ''));
  return Number.isFinite(n) ? n : null;
}

function computeWeights(row) {
  const gross = parseNumber(row.gross);
  const tare = parseNumber(row.tare);
  const net = parseNumber(row.net);

  let G = gross;
  let T = tare;
  let N = net;

  if (G == null && T != null && N != null) G = T + N;
  if (T == null && G != null && N != null) T = G - N;
  if (N == null && G != null && T != null) N = G - T;

  return { gross: G, tare: T, net: N };
}

function exportToCSV(rows = [], filename = 'export.csv') {
  if (!rows.length) return;
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

const StatCard = ({ label, value, help, bg }) => (
  <Stat
    bg={bg}
    color="white"
    p={{ base: 4, md: 5 }}
    borderRadius="2xl"
    boxShadow="lg"
    minH={{ base: '98px', md: '120px' }}
    display="flex"
    flexDirection="column"
    justifyContent="center"
    transition="transform 160ms ease, box-shadow 160ms ease"
    _hover={{ transform: 'translateY(-2px)', boxShadow: 'xl' }}
  >
    <StatLabel fontSize={{ base: 'xs', md: 'sm' }} opacity={0.92}>
      {label}
    </StatLabel>
    <StatNumber fontSize={{ base: '2xl', md: '3xl' }} lineHeight={1.1}>
      {value}
    </StatNumber>
    {help ? (
      <StatHelpText
        mt={1}
        opacity={0.92}
        fontSize={{ base: 'xs', md: 'sm' }}
        color="whiteAlpha.900"
      >
        {help}
      </StatHelpText>
    ) : null}
  </Stat>
);

// Best “wow + useful” features implemented:
// ✅ Real-time updates (Supabase realtime)
// ✅ Anomalies / Data quality panel (missing SAD, missing ticket, invalid weights)
// ✅ Today / Yesterday comparison (quick ops insight)
// ✅ “Today preset” + range filters + export of current view

export default function Albayrak() {
  const toast = useToast();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  // filters
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [hasSad, setHasSad] = useState(''); // '' | 'yes' | 'no'
  const [hasTicket, setHasTicket] = useState(''); // '' | 'yes' | 'no'
  const [anomalyFilter, setAnomalyFilter] = useState(''); // ''|'missing_sad'|'missing_ticket'|'bad_weights'

  // sorting
  const [sortField, setSortField] = useState('outgateDateTime');
  const [sortDir, setSortDir] = useState('desc');

  // pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const mapOutgateRow = useCallback((og) => {
    const w = computeWeights(og);
    const outgateDateTime = og.created_at || og.date || null;

    const ticketNo = og.ticket_no || null;
    const sadNo = og.sad_no || null;

    const hasSadOk = !!(sadNo && String(sadNo).trim());
    const hasTicketOk = !!(ticketNo && String(ticketNo).trim());

    const gross = w.gross;
    const tare = w.tare;
    const net = w.net;

    const grossN = gross != null ? Number(gross) : null;
    const tareN = tare != null ? Number(tare) : null;
    const netN = net != null ? Number(net) : null;

    const badWeights =
      (grossN != null && tareN != null && grossN < tareN) ||
      (netN != null && netN < 0) ||
      (grossN != null && tareN != null && netN != null && Math.abs((grossN - tareN) - netN) > 2); // tolerance

    return {
      id: og.id,
      ticketNo,
      sadNo,
      containerNo: og.container_id || og.container_no || null,
      truckNo: og.vehicle_number || og.truck_no || og.gnsw_truck_no || null,
      driver: og.driver || og.driver_name || null,
      destination: og.destination || og.consignee || null,
      outgateDateTime,
      gross: grossN,
      tare: tareN,
      net: netN,
      fileUrl: og.file_url || null,

      // derived flags
      hasSadOk,
      hasTicketOk,
      badWeights,
      // quick anomaly label
      anomaly:
        !hasSadOk ? 'missing_sad' : !hasTicketOk ? 'missing_ticket' : badWeights ? 'bad_weights' : '',
    };
  }, []);

  const fetchOutgate = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('outgate')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const mapped = (data || []).map(mapOutgateRow);

      setRows(mapped);
      setPage(1);
    } catch (err) {
      toast({
        title: 'Failed to load Albayrak dashboard data',
        description: err?.message || 'Could not fetch outgate rows',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setLoading(false);
    }
  }, [mapOutgateRow, toast]);

  useEffect(() => {
    fetchOutgate();
  }, [fetchOutgate]);

  // ✅ Real-time updates
  useEffect(() => {
    const channel = supabase
      .channel('albayrak-outgate-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'outgate' },
        (payload) => {
          setRows((prev) => {
            if (payload.eventType === 'INSERT') {
              const mapped = mapOutgateRow(payload.new);
              return [mapped, ...prev];
            }

            if (payload.eventType === 'UPDATE') {
              const mapped = mapOutgateRow(payload.new);
              return prev.map((r) => (r.id === mapped.id ? mapped : r));
            }

            if (payload.eventType === 'DELETE') {
              return prev.filter((r) => r.id !== payload.old.id);
            }

            return prev;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [mapOutgateRow]);

  const filtered = useMemo(() => {
    const q = safeLower(search).trim();
    const df = dateFrom ? new Date(dateFrom + 'T00:00:00') : null;
    const dt = dateTo ? new Date(dateTo + 'T23:59:59.999') : null;

    return rows.filter((r) => {
      if (q) {
        const hay = [r.ticketNo, r.sadNo, r.containerNo, r.truckNo, r.driver, r.destination]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      if (df || dt) {
        if (!r.outgateDateTime) return false;
        const d = new Date(r.outgateDateTime);
        if (Number.isNaN(d.getTime())) return false;
        if (df && d < df) return false;
        if (dt && d > dt) return false;
      }

      if (hasSad) {
        if (hasSad === 'yes' && !r.hasSadOk) return false;
        if (hasSad === 'no' && r.hasSadOk) return false;
      }

      if (hasTicket) {
        if (hasTicket === 'yes' && !r.hasTicketOk) return false;
        if (hasTicket === 'no' && r.hasTicketOk) return false;
      }

      if (anomalyFilter) {
        if (r.anomaly !== anomalyFilter) return false;
      }

      return true;
    });
  }, [rows, search, dateFrom, dateTo, hasSad, hasTicket, anomalyFilter]);

  const sorted = useMemo(() => {
    const arr = filtered.slice();
    arr.sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];

      if (sortField === 'outgateDateTime') {
        aVal = a.outgateDateTime ? new Date(a.outgateDateTime).getTime() : 0;
        bVal = b.outgateDateTime ? new Date(b.outgateDateTime).getTime() : 0;
      } else if (sortField === 'gross' || sortField === 'tare' || sortField === 'net') {
        aVal = aVal ?? -Infinity;
        bVal = bVal ?? -Infinity;
      } else {
        aVal = safeLower(aVal);
        bVal = safeLower(bVal);
      }

      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [filtered, sortField, sortDir]);

  // ✅ Stats (based on filtered view)
  const stats = useMemo(() => {
    const ticketSet = new Set();
    const sadSet = new Set();
    let totalNet = 0;

    let missingSad = 0;
    let missingTicket = 0;
    let badWeights = 0;

    for (const r of sorted) {
      if (r.ticketNo && String(r.ticketNo).trim()) ticketSet.add(String(r.ticketNo).trim());
      if (r.sadNo && String(r.sadNo).trim()) sadSet.add(String(r.sadNo).trim());
      if (r.net != null) totalNet += Number(r.net) || 0;

      if (!r.hasSadOk) missingSad += 1;
      if (!r.hasTicketOk) missingTicket += 1;
      if (r.badWeights) badWeights += 1;
    }

    const totalRows = sorted.length || 0;

    // quality score: fewer anomalies => higher score
    const anomalyCount = missingSad + missingTicket + badWeights;
    const qualityScore =
      totalRows === 0 ? 100 : Math.max(0, Math.round((1 - anomalyCount / (totalRows * 3)) * 100)); // normalize

    return {
      totalTicketsProcessed: ticketSet.size, // distinct ticket_no
      totalTrucksExited: sorted.length, // NOT distinct (count all exits)
      totalSadsProcessed: sadSet.size, // distinct sad_no
      totalDischargedNets: totalNet, // sum net
      rowsCount: totalRows,
      missingSad,
      missingTicket,
      badWeights,
      qualityScore,
    };
  }, [sorted]);

  // ✅ Today / Yesterday quick compare (based on ALL rows, not filtered — operational baseline)
  const dayCompare = useMemo(() => {
    const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);

    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    const yStart = startOfDay(y);
    const yEnd = endOfDay(y);

    const agg = (from, to) => {
      const ticketSet = new Set();
      const sadSet = new Set();
      let exits = 0;
      let net = 0;

      for (const r of rows) {
        if (!r.outgateDateTime) continue;
        const t = new Date(r.outgateDateTime);
        if (Number.isNaN(t.getTime())) continue;
        if (t < from || t > to) continue;

        exits += 1;
        if (r.ticketNo) ticketSet.add(String(r.ticketNo).trim());
        if (r.sadNo) sadSet.add(String(r.sadNo).trim());
        if (r.net != null) net += Number(r.net) || 0;
      }

      return {
        exits,
        tickets: ticketSet.size,
        sads: sadSet.size,
        net,
      };
    };

    const today = agg(todayStart, todayEnd);
    const yesterday = agg(yStart, yEnd);

    const diff = (a, b) => a - b;

    return {
      today,
      yesterday,
      delta: {
        exits: diff(today.exits, yesterday.exits),
        tickets: diff(today.tickets, yesterday.tickets),
        sads: diff(today.sads, yesterday.sads),
        net: diff(today.net, yesterday.net),
      },
      todayLabel: todayStart.toLocaleDateString(),
      yesterdayLabel: yStart.toLocaleDateString(),
    };
  }, [rows]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, page, pageSize]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [totalPages, page]);

  const resetFilters = () => {
    setSearch('');
    setDateFrom('');
    setDateTo('');
    setHasSad('');
    setHasTicket('');
    setAnomalyFilter('');
    setSortField('outgateDateTime');
    setSortDir('desc');
    setPageSize(DEFAULT_PAGE_SIZE);
    setPage(1);
    toast({ title: 'Reset done', status: 'info', duration: 1200 });
  };

  const presetToday = () => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const iso = `${yyyy}-${mm}-${dd}`;
    setDateFrom(iso);
    setDateTo(iso);
    setPage(1);
    toast({ title: 'Showing today', status: 'success', duration: 1000 });
  };

  const exportCurrent = () => {
    if (!sorted.length) {
      toast({ title: 'Nothing to export', status: 'info', duration: 1500 });
      return;
    }

    const out = sorted.map((r) => ({
      'Exit Date': r.outgateDateTime ? new Date(r.outgateDateTime).toLocaleString() : '',
      'Ticket No': r.ticketNo ?? '',
      'SAD No': r.sadNo ?? '',
      Container: r.containerNo ?? '',
      'Truck No': r.truckNo ?? '',
      Driver: r.driver ?? '',
      Destination: r.destination ?? '',
      'Gross (kg)': r.gross ?? '',
      'Tare (kg)': r.tare ?? '',
      'Net (kg)': r.net ?? '',
      'Anomaly': r.anomaly || '',
    }));

    exportToCSV(out, `albayrak_dashboard_${new Date().toISOString().slice(0, 10)}.csv`);
    toast({ title: `Exported ${out.length} rows`, status: 'success', duration: 2000 });
  };

  const deltaBadge = (n) => {
    if (n === 0) return <Badge colorScheme="gray">0</Badge>;
    if (n > 0) return <Badge colorScheme="green">+{n.toLocaleString()}</Badge>;
    return <Badge colorScheme="red">{n.toLocaleString()}</Badge>;
  };

  const anomalyBadge = (type) => {
    if (type === 'missing_sad') return <Badge colorScheme="orange">Missing SAD</Badge>;
    if (type === 'missing_ticket') return <Badge colorScheme="purple">Missing Ticket</Badge>;
    if (type === 'bad_weights') return <Badge colorScheme="red">Bad Weights</Badge>;
    return <Badge colorScheme="green">OK</Badge>;
  };

  return (
    <Box p={{ base: 4, md: 8 }}>
      {/* ✅ Hero Title (centered, enlarged, gradient, animated) */}
      <Box
        textAlign="center"
        mb={{ base: 5, md: 7 }}
        py={{ base: 5, md: 6 }}
        px={{ base: 3, md: 6 }}
        borderRadius="2xl"
        bgGradient="linear(to-r, blue.600, purple.600, pink.500)"
        color="white"
        boxShadow="xl"
        animation="albayrakFloat 5.5s ease-in-out infinite"
        sx={{
          '@keyframes albayrakFloat': {
            '0%': { transform: 'translateY(0px)' },
            '50%': { transform: 'translateY(-4px)' },
            '100%': { transform: 'translateY(0px)' },
          },
        }}
      >
        <Text
          fontSize={{ base: '2xl', sm: '3xl', md: '4xl' }}
          fontWeight="extrabold"
          letterSpacing="-0.5px"
          bgGradient="linear(to-r, whiteAlpha.900, white, whiteAlpha.900)"
          bgClip="text"
          animation="albayrakTitle 800ms ease-out both"
          sx={{
            '@keyframes albayrakTitle': {
              '0%': { opacity: 0, transform: 'translateY(6px)' },
              '100%': { opacity: 1, transform: 'translateY(0px)' },
            },
          }}
        >
          Albayrak Dashboard
        </Text>

        <Text mt={2} fontSize={{ base: 'sm', md: 'md' }} opacity={0.95} maxW="920px" mx="auto">
          Real-time operations view — Tickets, Exits, SADs, and Discharged net weights, plus automatic anomaly detection.
        </Text>

        <Flex justify="center" mt={4} gap={3} flexWrap="wrap">
          <Tooltip label="Export current filtered view">
            <Button leftIcon={<DownloadIcon />} colorScheme="blackAlpha" variant="solid" onClick={exportCurrent}>
              Export CSV
            </Button>
          </Tooltip>
          <Button
            leftIcon={<RepeatIcon />}
            variant="outline"
            color="white"
            borderColor="whiteAlpha.700"
            _hover={{ bg: 'whiteAlpha.200' }}
            onClick={resetFilters}
          >
            Reset
          </Button>
          <Button
            variant="solid"
            colorScheme="teal"
            onClick={presetToday}
          >
            Today
          </Button>
        </Flex>
      </Box>

      {/* ✅ Today vs Yesterday quick compare */}
      <Box bg="white" p={{ base: 4, md: 5 }} borderRadius="2xl" boxShadow="sm" mb={6}>
        <Flex justify="space-between" align="center" gap={3} flexWrap="wrap">
          <Box>
            <Text fontWeight="bold">Daily Comparison</Text>
            <Text fontSize="sm" color="gray.600">
              {dayCompare.yesterdayLabel} → {dayCompare.todayLabel}
            </Text>
          </Box>
          <HStack spacing={3} flexWrap="wrap">
            <Badge colorScheme="blue">Exits {deltaBadge(dayCompare.delta.exits)}</Badge>
            <Badge colorScheme="purple">Tickets {deltaBadge(dayCompare.delta.tickets)}</Badge>
            <Badge colorScheme="orange">SADs {deltaBadge(dayCompare.delta.sads)}</Badge>
            <Badge colorScheme="green">Net {deltaBadge(Math.round(dayCompare.delta.net))}</Badge>
          </HStack>
        </Flex>

        <Divider my={4} />

        <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
          <Box>
            <Text fontSize="sm" color="gray.600" mb={2}>Today</Text>
            <HStack spacing={3} flexWrap="wrap">
              <Badge colorScheme="blue">Exits: {dayCompare.today.exits.toLocaleString()}</Badge>
              <Badge colorScheme="purple">Tickets: {dayCompare.today.tickets.toLocaleString()}</Badge>
              <Badge colorScheme="orange">SADs: {dayCompare.today.sads.toLocaleString()}</Badge>
              <Badge colorScheme="green">Net: {Math.round(dayCompare.today.net).toLocaleString()} kg</Badge>
            </HStack>
          </Box>
          <Box>
            <Text fontSize="sm" color="gray.600" mb={2}>Yesterday</Text>
            <HStack spacing={3} flexWrap="wrap">
              <Badge colorScheme="blue" variant="subtle">Exits: {dayCompare.yesterday.exits.toLocaleString()}</Badge>
              <Badge colorScheme="purple" variant="subtle">Tickets: {dayCompare.yesterday.tickets.toLocaleString()}</Badge>
              <Badge colorScheme="orange" variant="subtle">SADs: {dayCompare.yesterday.sads.toLocaleString()}</Badge>
              <Badge colorScheme="green" variant="subtle">Net: {Math.round(dayCompare.yesterday.net).toLocaleString()} kg</Badge>
            </HStack>
          </Box>
        </SimpleGrid>
      </Box>

      {/* ✅ Data Quality / Anomalies panel */}
      <Box bg="white" p={{ base: 4, md: 5 }} borderRadius="2xl" boxShadow="sm" mb={6}>
        <Flex justify="space-between" align="center" gap={3} flexWrap="wrap">
          <Box>
            <Text fontWeight="bold">Data Quality</Text>
            <Text fontSize="sm" color="gray.600">
              Based on current filtered view
            </Text>
          </Box>
          <Badge colorScheme={stats.qualityScore >= 90 ? 'green' : stats.qualityScore >= 75 ? 'yellow' : 'red'}>
            Quality Score: {stats.qualityScore}%
          </Badge>
        </Flex>

        <Progress
          mt={3}
          value={stats.qualityScore}
          borderRadius="md"
          size="sm"
        />

        <SimpleGrid columns={{ base: 1, md: 3 }} spacing={3} mt={4}>
          <Alert status={stats.missingSad ? 'warning' : 'success'} borderRadius="xl" variant="subtle">
            <AlertIcon />
            <Box>
              <AlertTitle fontSize="sm">Missing SAD</AlertTitle>
              <AlertDescription fontSize="sm">{stats.missingSad.toLocaleString()} record(s)</AlertDescription>
            </Box>
          </Alert>

          <Alert status={stats.missingTicket ? 'warning' : 'success'} borderRadius="xl" variant="subtle">
            <AlertIcon />
            <Box>
              <AlertTitle fontSize="sm">Missing Ticket</AlertTitle>
              <AlertDescription fontSize="sm">{stats.missingTicket.toLocaleString()} record(s)</AlertDescription>
            </Box>
          </Alert>

          <Alert status={stats.badWeights ? 'error' : 'success'} borderRadius="xl" variant="subtle">
            <AlertIcon />
            <Box>
              <AlertTitle fontSize="sm">Bad Weights</AlertTitle>
              <AlertDescription fontSize="sm">{stats.badWeights.toLocaleString()} record(s)</AlertDescription>
            </Box>
          </Alert>
        </SimpleGrid>

        <Flex mt={4} gap={3} align="center" flexWrap="wrap">
          <Text fontSize="sm" color="gray.600">Quick filter anomalies:</Text>
          <Select
            value={anomalyFilter}
            onChange={(e) => { setAnomalyFilter(e.target.value); setPage(1); }}
            maxW="260px"
            placeholder="All"
          >
            <option value="missing_sad">Missing SAD</option>
            <option value="missing_ticket">Missing Ticket</option>
            <option value="bad_weights">Bad Weights</option>
          </Select>
          <Button size="sm" variant="ghost" onClick={() => { setAnomalyFilter(''); setPage(1); }}>
            Clear anomaly filter
          </Button>
        </Flex>
      </Box>

      {/* ✅ Stats (responsive + distinct colors) */}
      <SimpleGrid columns={{ base: 1, sm: 2, lg: 4 }} spacing={{ base: 3, md: 4 }} mb={6}>
        <StatCard
          label="Total Tickets Processed"
          value={stats.totalTicketsProcessed.toLocaleString()}
          help={`Based on ${stats.rowsCount.toLocaleString()} outgate rows`}
          bg="blue.600"
        />
        <StatCard
          label="Total Trucks Exited"
          value={stats.totalTrucksExited.toLocaleString()}
          help="All exits counted"
          bg="green.600"
        />
        <StatCard
          label="Total SADs Processed"
          value={stats.totalSadsProcessed.toLocaleString()}
          help="Distinct SAD numbers"
          bg="purple.600"
        />
        <StatCard
          label="Total Discharged Weight"
          value={`${Math.round(Number(stats.totalDischargedNets || 0)).toLocaleString()} kg`}
          help="sum of net weights"
          bg="orange.500"
        />
      </SimpleGrid>

      {/* Filters */}
      <Box bg="white" p={{ base: 3, md: 4 }} borderRadius="2xl" boxShadow="sm" mb={6}>
        <SimpleGrid columns={{ base: 1, md: 5 }} spacing={4}>
          <Box>
            <Text fontSize="sm" mb={1} color="gray.600">
              Search
            </Text>
            <Input
              placeholder="Ticket, SAD, Container, Truck, Driver..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </Box>

          <Box>
            <Text fontSize="sm" mb={1} color="gray.600">
              Date From
            </Text>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
            />
          </Box>

          <Box>
            <Text fontSize="sm" mb={1} color="gray.600">
              Date To
            </Text>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
            />
          </Box>

          <Box>
            <Text fontSize="sm" mb={1} color="gray.600">
              Has SAD
            </Text>
            <Select
              value={hasSad}
              onChange={(e) => {
                setHasSad(e.target.value);
                setPage(1);
              }}
              placeholder="All"
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </Select>
          </Box>

          <Box>
            <Text fontSize="sm" mb={1} color="gray.600">
              Has Ticket
            </Text>
            <Select
              value={hasTicket}
              onChange={(e) => {
                setHasTicket(e.target.value);
                setPage(1);
              }}
              placeholder="All"
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </Select>
          </Box>
        </SimpleGrid>

        <Flex mt={4} justify="space-between" align="center" gap={4} flexWrap="wrap">
          <HStack>
            <Text fontSize="sm" color="gray.600">
              Sort
            </Text>
            <Select value={sortField} onChange={(e) => setSortField(e.target.value)} maxW="220px">
              <option value="outgateDateTime">Exit Date</option>
              <option value="ticketNo">Ticket No</option>
              <option value="sadNo">SAD No</option>
              <option value="containerNo">Container</option>
              <option value="truckNo">Truck No</option>
              <option value="net">Net (kg)</option>
            </Select>
            <Select value={sortDir} onChange={(e) => setSortDir(e.target.value)} maxW="160px">
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </Select>
          </HStack>

          <HStack>
            <Text fontSize="sm" color="gray.600">
              Page size
            </Text>
            <Select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              maxW="120px"
            >
              {[5, 10, 20, 50].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </HStack>
        </Flex>
      </Box>

      {/* Table */}
      {loading ? (
        <Flex justify="center" p={12}>
          <Spinner size="xl" />
        </Flex>
      ) : (
        <Box bg="white" borderRadius="2xl" boxShadow="sm" overflowX="auto" border="1px solid" borderColor="gray.200">
          <Table variant="striped" size="sm">
            <Thead bg="gray.50">
              <Tr>
                <Th>Exit Date</Th>
                <Th>Ticket</Th>
                <Th>SAD</Th>
                <Th>Anomaly</Th>
                <Th>Container</Th>
                <Th>Truck</Th>
                <Th isNumeric>Gross (kg)</Th>
                <Th isNumeric>Tare (kg)</Th>
                <Th isNumeric>Net (kg)</Th>
                <Th>Attachment</Th>
              </Tr>
            </Thead>
            <Tbody>
              {pageRows.length ? (
                pageRows.map((r) => (
                  <Tr key={r.id}>
                    <Td>{r.outgateDateTime ? new Date(r.outgateDateTime).toLocaleString() : '—'}</Td>
                    <Td>{r.ticketNo ?? <Badge>Manual</Badge>}</Td>
                    <Td>{r.sadNo ?? '—'}</Td>
                    <Td>{anomalyBadge(r.anomaly)}</Td>
                    <Td>{r.containerNo ?? '—'}</Td>
                    <Td>{r.truckNo ?? '—'}</Td>
                    <Td isNumeric>{r.gross != null ? Number(r.gross).toLocaleString() : '—'}</Td>
                    <Td isNumeric>{r.tare != null ? Number(r.tare).toLocaleString() : '—'}</Td>
                    <Td isNumeric>{r.net != null ? Number(r.net).toLocaleString() : '—'}</Td>
                    <Td>
                      {r.fileUrl ? (
                        <Button size="xs" onClick={() => window.open(r.fileUrl, '_blank', 'noopener')}>
                          Open
                        </Button>
                      ) : (
                        <Text fontSize="xs" color="gray.500">
                          —
                        </Text>
                      )}
                    </Td>
                  </Tr>
                ))
              ) : (
                <Tr>
                  <Td colSpan={10} textAlign="center" py={10}>
                    No records match your filters.
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>

          {/* Pagination */}
          <Flex
            justify="space-between"
            align="center"
            p={3}
            borderTop="1px solid"
            borderColor="gray.200"
            flexWrap="wrap"
            gap={3}
          >
            <Text fontSize="sm" color="gray.600">
              Showing {pageRows.length} of {sorted.length}
            </Text>

            <HStack spacing={2}>
              <IconButton
                aria-label="Previous"
                icon={<ChevronLeftIcon />}
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                isDisabled={page === 1}
              />
              <Text fontSize="sm">
                Page {page} / {totalPages}
              </Text>
              <IconButton
                aria-label="Next"
                icon={<ChevronRightIcon />}
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                isDisabled={page === totalPages}
              />
            </HStack>
          </Flex>
        </Box>
      )}
    </Box>
  );
}
