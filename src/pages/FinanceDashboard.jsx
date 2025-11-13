// src/pages/FinanceDashboard.jsx
import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  Container, Heading, Box, Stat, StatLabel, StatNumber, StatHelpText,
  SimpleGrid, HStack, VStack, Text, Button, Table, Thead, Tbody, Tr, Th, Td,
  Spinner, useToast, Flex, Badge,
} from '@chakra-ui/react';
import { FaFileExport, FaDownload, FaMoneyBillWave, FaTruck, FaClipboardList, FaChartLine } from 'react-icons/fa';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import logoUrl from '../assets/logo.png';

/**
 * FinanceDashboard (fixed)
 *
 * - Fixed Promise.all error (removed `.map(p => p.catch(...))` pattern)
 * - Added robust error checking per Supabase response
 * - Safer realtime subscription cleanup
 * - Same UI as previous: stats + recent tickets/outgates + top discrepancies
 */

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
  a.remove();
  URL.revokeObjectURL(url);
}

export default function FinanceDashboard() {
  const toast = useToast();
  const { user } = useAuth() || {};
  const [loading, setLoading] = useState(true);

  const [totalSADs, setTotalSADs] = useState(0);
  const [totalAppointments, setTotalAppointments] = useState(0);
  const [totalTickets, setTotalTickets] = useState(0);
  const [totalTrucksExited, setTotalTrucksExited] = useState(0);

  const [recentTickets, setRecentTickets] = useState([]);
  const [recentOutgates, setRecentOutgates] = useState([]);
  const [sads, setSads] = useState([]);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        // Run the 4 count queries in parallel and handle results individually
        const [
          sadRes,
          apptRes,
          ticketRes,
          outgateRes
        ] = await Promise.all([
          supabase.from('sad_declarations').select('sad_no', { head: true, count: 'exact' }),
          supabase.from('appointments').select('id', { head: true, count: 'exact' }),
          supabase.from('tickets').select('id', { head: true, count: 'exact' }),
          supabase.from('outgate').select('id', { head: true, count: 'exact' }),
        ]);

        if (mountedRef.current) {
          setTotalSADs(Number(sadRes?.count ?? 0));
          setTotalAppointments(Number(apptRes?.count ?? 0));
          setTotalTickets(Number(ticketRes?.count ?? 0));
          setTotalTrucksExited(Number(outgateRes?.count ?? 0));
        }

        // recent tickets (top 10 latest)
        const { data: ticketRows, error: tErr } = await supabase
          .from('tickets')
          .select('ticket_no, gnsw_truck_no, sad_no, net, gross, tare, date, status, ticket_id')
          .order('date', { ascending: false })
          .limit(10);

        if (tErr) {
          console.warn('Recent tickets fetch failed', tErr);
          if (mountedRef.current) setRecentTickets([]);
        } else if (mountedRef.current) {
          setRecentTickets(ticketRows || []);
        }

        // recent outgates (last 10)
        const { data: outRows, error: oErr } = await supabase
          .from('outgate')
          .select('ticket_no, vehicle_number, net, gross, tare, date, created_at')
          .order('created_at', { ascending: false })
          .limit(10);

        if (oErr) {
          console.warn('Recent outgates fetch failed', oErr);
          if (mountedRef.current) setRecentOutgates([]);
        } else if (mountedRef.current) {
          setRecentOutgates(outRows || []);
        }

        // fetch SADs for discrepancy table
        const { data: sadsData, error: sErr } = await supabase
          .from('sad_declarations')
          .select('sad_no, declared_weight, total_recorded_weight, status, created_at')
          .order('created_at', { ascending: false });

        if (sErr) {
          console.warn('SADs fetch failed', sErr);
          if (mountedRef.current) setSads([]);
        } else if (mountedRef.current) {
          setSads(Array.isArray(sadsData) ? sadsData : []);
        }
      } catch (err) {
        console.error('fetchAll error', err);
        toast({ title: 'Failed to load dashboard', description: err?.message || String(err), status: 'error' });
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };

    fetchAll();

    // realtime subscriptions (best-effort)
    const subs = [];
    try {
      if (supabase.channel) {
        subs.push(
          supabase.channel('finance:sad_declarations')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'sad_declarations' }, () => {
              supabase.from('sad_declarations').select('sad_no', { head: true, count: 'exact' }).then((r) => {
                if (!r?.error && mountedRef.current) setTotalSADs(Number(r.count || 0));
              }).catch(() => {});
              supabase.from('sad_declarations').select('sad_no, declared_weight, total_recorded_weight, status, created_at').then((r) => {
                if (!r?.error && mountedRef.current) setSads(r.data || []);
              }).catch(() => {});
            }).subscribe()
        );

        subs.push(
          supabase.channel('finance:tickets')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => {
              supabase.from('tickets').select('id', { head: true, count: 'exact' }).then((r) => {
                if (!r?.error && mountedRef.current) setTotalTickets(Number(r.count || 0));
              }).catch(() => {});
              supabase.from('tickets').select('ticket_no, gnsw_truck_no, sad_no, net, gross, tare, date, status, ticket_id').order('date', { ascending: false }).limit(10)
                .then((r) => { if (!r?.error && mountedRef.current) setRecentTickets(r.data || []); }).catch(() => {});
            }).subscribe()
        );

        subs.push(
          supabase.channel('finance:outgate')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'outgate' }, () => {
              supabase.from('outgate').select('id', { head: true, count: 'exact' }).then((r) => {
                if (!r?.error && mountedRef.current) setTotalTrucksExited(Number(r.count || 0));
              }).catch(() => {});
              supabase.from('outgate').select('ticket_no, vehicle_number, net, gross, tare, date, created_at').order('created_at', { ascending: false }).limit(10)
                .then((r) => { if (!r?.error && mountedRef.current) setRecentOutgates(r.data || []); }).catch(() => {});
            }).subscribe()
        );

        subs.push(
          supabase.channel('finance:appointments')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, () => {
              supabase.from('appointments').select('id', { head: true, count: 'exact' }).then((r) => {
                if (!r?.error && mountedRef.current) setTotalAppointments(Number(r.count || 0));
              }).catch(() => {});
            }).subscribe()
        );
      } else {
        // fallback older subscribe API (best-effort)
        try {
          const s1 = supabase.from('tickets').on('*', () => {
            supabase.from('tickets').select('id', { head: true, count: 'exact' }).then((r) => { if (!r?.error && mountedRef.current) setTotalTickets(Number(r.count || 0)); }).catch(() => {});
          }).subscribe?.();
          if (s1) subs.push(s1);
        } catch (e) { /* ignore */ }
      }
    } catch (e) {
      // ignore realtime creation errors
    }

    return () => {
      try {
        // remove channels/subscriptions if api available
        if (Array.isArray(subs) && subs.length && supabase.removeChannel) {
          subs.forEach((ch) => {
            try { supabase.removeChannel(ch).catch(() => {}); } catch (er) { /* ignore */ }
          });
        }
      } catch (e) { /* ignore */ }
    };
  }, [toast]);

  const topDiscrepancies = useMemo(() => {
    if (!Array.isArray(sads)) return [];
    return sads
      .map((s) => {
        const declared = Number(s.declared_weight || 0);
        const recorded = Number(s.total_recorded_weight || 0);
        const diff = recorded - declared;
        const pct = declared ? (diff / declared) * 100 : null;
        return { ...s, declared, recorded, diff, pct: pct === null ? null : Number(pct.toFixed(2)), absDiff: Math.abs(diff) };
      })
      .filter(s => (s.declared || s.recorded))
      .sort((a, b) => b.absDiff - a.absDiff)
      .slice(0, 8);
  }, [sads]);

  const handleExportTopDiscrepancies = () => {
    const rows = topDiscrepancies.map(d => ({
      sad_no: d.sad_no,
      declared_weight: d.declared,
      recorded_weight: d.recorded,
      difference: d.diff,
      percent_difference: d.pct,
      status: d.status,
    }));
    exportToCSV(rows, `top_sad_discrepancies_${new Date().toISOString().slice(0,10)}.csv`);
    toast({ title: 'Export started', description: `${rows.length} rows exported`, status: 'success' });
  };

  const handleExportRecentTickets = () => {
    const rows = recentTickets.map(t => ({
      ticket_no: t.ticket_no,
      truck: t.gnsw_truck_no,
      sad_no: t.sad_no,
      net: t.net,
      gross: t.gross,
      date: t.date,
      status: t.status,
    }));
    exportToCSV(rows, `recent_tickets_${new Date().toISOString().slice(0,10)}.csv`);
    toast({ title: 'Export started', description: `${rows.length} rows exported`, status: 'success' });
  };

  const pageCss = `
    :root{
      --muted: rgba(7,17,25,0.55);
      --text-dark: #071126;
      --glass: rgba(255,255,255,0.9);
    }
    .finance-root { font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial; min-height: 100vh; padding-top: 18px; }
    .stat-card { border-radius: 12px; padding: 18px; color: white; box-shadow: 0 10px 30px rgba(2,6,23,0.06); }
    .glass { background: linear-gradient(180deg, rgba(255,255,255,0.85), rgba(255,255,255,0.7)); border-radius: 12px; padding: 12px; box-shadow: 0 6px 20px rgba(2,6,23,0.04); }
    @media (max-width: 760px) { .stat-card { padding: 12px; } }
  `;

  return (
    <Container maxW="9xl" className="finance-root" py={6}>
      <style>{pageCss}</style>

      <Flex align="center" gap={4} mb={6}>
        <img src={logoUrl} alt="logo" style={{ width: 56, height: 56, borderRadius: 8 }} />
        <Box>
          <Heading size="lg">Finance Dashboard</Heading>
          <Text color="gray.600" fontSize="sm">NICK TC-SCAN (GAMBIA) LTD — Financial overview & exports</Text>
        </Box>
        <Box ml="auto">
          <HStack spacing={3}>
            <Button leftIcon={<FaFileExport />} size="sm" onClick={() => handleExportTopDiscrepancies()}>Export discrepancies</Button>
            <Button leftIcon={<FaDownload />} size="sm" variant="ghost" onClick={() => handleExportRecentTickets()}>Export recent</Button>
          </HStack>
        </Box>
      </Flex>

      {loading ? (
        <Flex align="center" justify="center" minH="220px"><Spinner size="xl" /></Flex>
      ) : (
        <>
          <SimpleGrid columns={{ base: 1, md: 4 }} spacing={4} mb={6}>
            <Box className="stat-card" style={{ background: 'linear-gradient(90deg,#7b61ff,#3ef4d0)' }}>
              <Stat>
                <StatLabel><HStack spacing={2}><FaClipboardList /> <Text>Total SADs</Text></HStack></StatLabel>
                <StatNumber fontSize="2xl">{totalSADs.toLocaleString()}</StatNumber>
                <StatHelpText>Declared & recorded SADs</StatHelpText>
              </Stat>
            </Box>

            <Box className="stat-card" style={{ background: 'linear-gradient(90deg,#06b6d4,#0ea5a0)' }}>
              <Stat>
                <StatLabel><HStack spacing={2}><FaMoneyBillWave /> <Text>Total Appointments</Text></HStack></StatLabel>
                <StatNumber fontSize="2xl">{totalAppointments.toLocaleString()}</StatNumber>
                <StatHelpText>Booked pickup appointments</StatHelpText>
              </Stat>
            </Box>

            <Box className="stat-card" style={{ background: 'linear-gradient(90deg,#f97316,#f59e0b)' }}>
              <Stat>
                <StatLabel><HStack spacing={2}><FaChartLine /> <Text>Total Tickets</Text></HStack></StatLabel>
                <StatNumber fontSize="2xl">{totalTickets.toLocaleString()}</StatNumber>
                <StatHelpText>All weighbridge tickets</StatHelpText>
              </Stat>
            </Box>

            <Box className="stat-card" style={{ background: 'linear-gradient(90deg,#ef4444,#fb7185)' }}>
              <Stat>
                <StatLabel><HStack spacing={2}><FaTruck /> <Text>Trucks Exited</Text></HStack></StatLabel>
                <StatNumber fontSize="2xl">{totalTrucksExited.toLocaleString()}</StatNumber>
                <StatHelpText>Outgate records (exits)</StatHelpText>
              </Stat>
            </Box>
          </SimpleGrid>

          <SimpleGrid columns={{ base: 1, md: 2 }} spacing={6}>
            <Box className="glass">
              <Flex align="center" justify="space-between" mb={3}>
                <Heading size="sm">Top SAD Discrepancies</Heading>
                <Badge colorScheme="purple">{topDiscrepancies.length} flagged</Badge>
              </Flex>

              {topDiscrepancies.length === 0 ? (
                <Text color="gray.500">No notable discrepancies found.</Text>
              ) : (
                <Table size="sm">
                  <Thead>
                    <Tr>
                      <Th>SAD</Th>
                      <Th isNumeric>Declared</Th>
                      <Th isNumeric>Recorded</Th>
                      <Th isNumeric>Diff</Th>
                      <Th isNumeric>%</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {topDiscrepancies.map(d => (
                      <Tr key={d.sad_no}>
                        <Td><Text fontWeight="bold">{d.sad_no}</Text></Td>
                        <Td isNumeric>{Number(d.declared).toLocaleString()}</Td>
                        <Td isNumeric>{Number(d.recorded).toLocaleString()}</Td>
                        <Td isNumeric style={{ color: d.diff === 0 ? 'green' : (d.diff > 0 ? '#c53030' : '#dd6b20') }}>{d.diff.toLocaleString()}</Td>
                        <Td isNumeric>{d.pct === null ? '—' : `${d.pct}%`}</Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              )}
            </Box>

            <VStack spacing={6} align="stretch">
              <Box className="glass">
                <Flex align="center" justify="space-between" mb={3}>
                  <Heading size="sm">Recent Tickets</Heading>
                  <Text fontSize="sm" color="gray.500">{recentTickets.length} latest</Text>
                </Flex>

                {recentTickets.length === 0 ? (
                  <Text color="gray.500">No recent tickets</Text>
                ) : (
                  <Table size="sm">
                    <Thead>
                      <Tr>
                        <Th>Ticket</Th>
                        <Th>Truck</Th>
                        <Th>SAD</Th>
                        <Th isNumeric>Net (kg)</Th>
                        <Th>Date</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {recentTickets.map(t => (
                        <Tr key={t.ticket_id || t.ticket_no}>
                          <Td>{t.ticket_no}</Td>
                          <Td>{t.gnsw_truck_no || '—'}</Td>
                          <Td>{t.sad_no || '—'}</Td>
                          <Td isNumeric>{Number(t.net ?? t.weight ?? 0).toLocaleString()}</Td>
                          <Td>{t.date ? new Date(t.date).toLocaleString() : '—'}</Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                )}
                <Flex justify="flex-end" mt={3}>
                  <Button size="sm" leftIcon={<FaFileExport />} onClick={handleExportRecentTickets}>Export recent</Button>
                </Flex>
              </Box>

              <Box className="glass">
                <Flex align="center" justify="space-between" mb={3}>
                  <Heading size="sm">Recent Outgate Exits</Heading>
                  <Text fontSize="sm" color="gray.500">{recentOutgates.length} latest</Text>
                </Flex>

                {recentOutgates.length === 0 ? (
                  <Text color="gray.500">No recent exits</Text>
                ) : (
                  <Table size="sm">
                    <Thead>
                      <Tr>
                        <Th>Ticket</Th>
                        <Th>Vehicle</Th>
                        <Th isNumeric>Net (kg)</Th>
                        <Th>Date</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {recentOutgates.map((o, i) => (
                        <Tr key={i}>
                          <Td>{o.ticket_no || '—'}</Td>
                          <Td>{o.vehicle_number || '—'}</Td>
                          <Td isNumeric>{Number(o.net ?? o.total_weight ?? 0).toLocaleString()}</Td>
                          <Td>{o.created_at ? new Date(o.created_at).toLocaleString() : (o.date ? new Date(o.date).toLocaleString() : '—')}</Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                )}
              </Box>
            </VStack>
          </SimpleGrid>

          <Box mt={6} p={4} className="glass">
            <Flex align="center" gap={3} wrap="wrap">
              <Text fontWeight="semibold">Quick Actions:</Text>
              <Button size="sm" leftIcon={<FaFileExport />} onClick={() => handleExportTopDiscrepancies()}>Export top discrepancies</Button>
              <Button size="sm" variant="ghost" leftIcon={<FaDownload />} onClick={() => handleExportRecentTickets()}>Export recent tickets</Button>

              <Box ml="auto">
                <Text fontSize="xs" color="gray.600">Logged in as <strong>{user?.email || user?.username || 'Finance'}</strong></Text>
              </Box>
            </Flex>
          </Box>
        </>
      )}
    </Container>
  );
}
