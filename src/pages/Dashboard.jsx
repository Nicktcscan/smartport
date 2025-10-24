// src/pages/Dashboard.jsx
import React, { useEffect, useState, useCallback } from 'react';
import {
  Box,
  Flex,
  SimpleGrid,
  Stat,
  StatLabel,
  StatNumber,
  Text,
  useToast,
  Icon,
} from '@chakra-ui/react';
import { FaClipboardList, FaClock, FaSignOutAlt, FaFlag } from 'react-icons/fa';
import { supabase } from '../supabaseClient';
import { Pie, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
} from 'chart.js';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, Title);

function Dashboard() {
  const [tickets, setTickets] = useState([]);
  const [filteredTickets, setFilteredTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus] = useState('');
  const [searchTerm] = useState('');
  const [dateFrom] = useState('');
  const [dateTo] = useState('');
  const toast = useToast();

  // Fetch tickets
  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      let { data, error } = await supabase.from('tickets').select('*').order('date', { ascending: false });
      if (error) throw error;
      setTickets(data || []);
      setFilteredTickets(data || []);
    } catch (err) {
      toast({
        title: 'Error loading tickets',
        description: err.message || 'Failed to load tickets',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Live subscription
  useEffect(() => {
    fetchTickets(); // Initial load

    const channel = supabase
      .channel('tickets-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tickets' },
        payload => {
          setTickets(prevTickets => {
            if (payload.eventType === 'INSERT') {
              return [payload.new, ...prevTickets];
            }
            if (payload.eventType === 'UPDATE') {
              return prevTickets.map(ticket =>
                ticket.id === payload.new.id ? payload.new : ticket
              );
            }
            if (payload.eventType === 'DELETE') {
              return prevTickets.filter(ticket => ticket.id !== payload.old.id);
            }
            return prevTickets;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchTickets]);

  // Filtering
  useEffect(() => {
    let tempTickets = [...tickets];

    if (filterStatus) {
      tempTickets = tempTickets.filter(t => t.status === filterStatus);
    }

    if (searchTerm.trim()) {
      tempTickets = tempTickets.filter(ticket =>
        (ticket.ticket_no || '').toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    if (dateFrom) {
      tempTickets = tempTickets.filter(t => {
        const d = t.date ? new Date(t.date) : null;
        return d ? d >= new Date(dateFrom) : false;
      });
    }
    if (dateTo) {
      tempTickets = tempTickets.filter(t => {
        const d = t.date ? new Date(t.date) : null;
        return d ? d <= new Date(dateTo) : false;
      });
    }

    setFilteredTickets(tempTickets);
  }, [tickets, filterStatus, searchTerm, dateFrom, dateTo]);

  // Stats
  const totalTickets = tickets.length;

  // COUNT DISTINCT SAD numbers (non-empty, trimmed)
  const totalSADs = (() => {
    try {
      const set = new Set(
        tickets
          .map(t => (t.sad_no || '').trim())
          .filter(sad => sad !== '')
      );
      return set.size;
    } catch (e) {
      // fallback: if anything weird, return simple count of non-empty
      return tickets.filter(t => t.sad_no && t.sad_no.trim() !== '').length;
    }
  })();

  const exitedTickets = tickets.filter(t => t.status === 'Exited').length;
  const pendingTickets = tickets.filter(t => t.status === 'Pending').length;

  // Manual entries count: ticket_no starting with 'M-'
  const manualEntries = tickets.filter(t => (t.ticket_no || '').startsWith('M-')).length;

  // Pie chart data
  const pieData = {
    labels: ['Pending', 'Exited'],
    datasets: [
      {
        data: [pendingTickets, exitedTickets],
        backgroundColor: ['#ECC94B', '#48BB78'],
        hoverBackgroundColor: ['#D69E2E', '#38A169'],
      },
    ],
  };

  // Bar chart data (last 7 days)
  const last7Days = [...Array(7)].map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().split('T')[0];
  });

  const barData = {
    labels: last7Days,
    datasets: [
      {
        label: 'Tickets per Day',
        data: last7Days.map(
          date => tickets.filter(t => typeof t.date === 'string' ? t.date.startsWith(date) : (t.date instanceof Date ? t.date.toISOString().startsWith(date) : false)).length
        ),
        backgroundColor: '#3182CE',
      },
    ],
  };

  const StatCard = ({ icon, label, value, color }) => (
    <Stat bg={color} p={4} borderRadius="md" boxShadow="md" color="white">
      <Flex align="center" gap={3}>
        <Icon as={icon} boxSize={6} />
        <Box>
          <StatLabel>{label}</StatLabel>
          <StatNumber>{value}</StatNumber>
        </Box>
      </Flex>
    </Stat>
  );

  // New data for second bar chart: total tickets count by status (all time)
  const statusCategories = ['Pending', 'Exited'];
  const statusCounts = statusCategories.map(
    (status) => tickets.filter(t => t.status === status).length
  );

  const barDataStatus = {
    labels: statusCategories,
    datasets: [
      {
        label: 'Tickets by Status',
        data: statusCounts,
        backgroundColor: ['#ECC94B', '#48BB78'],
      },
    ],
  };


  return (
    <Box p={4}>
      <SimpleGrid columns={{ base: 1, md: 4 }} spacing={4} mb={6}>
        <StatCard icon={FaClipboardList} label="Total Tickets" value={totalTickets} color="gray.700" />
        <StatCard icon={FaClock} label="Total SADs" value={totalSADs} color="yellow.600" />
        <StatCard icon={FaSignOutAlt} label="Exited" value={exitedTickets} color="green.600" />
        <StatCard icon={FaFlag} label="Manual Entries" value={manualEntries} color="purple.600" />
      </SimpleGrid>

      {/* Charts */}
      <SimpleGrid columns={{ base: 1, md: 2 }} spacing={6} mb={6}>
        <Box bg="white" p={4} borderRadius="md" boxShadow="sm">
          <Text fontSize="lg" mb={4} fontWeight="bold">Ticket Status Breakdown</Text>
          <Pie data={pieData} />
        </Box>

        <Box bg="white" p={4} borderRadius="md" boxShadow="sm">
          <Text fontSize="lg" mb={4} fontWeight="bold">Tickets in Last 7 Days</Text>
          <Bar data={barData} />

          {/* New Bar chart added below */}
          <Box mt={8}>
            <Text fontSize="lg" mb={4} fontWeight="bold">Tickets by Status</Text>
            <Bar data={barDataStatus} />
          </Box>
        </Box>
      </SimpleGrid>

      {/* Ticket Table (omitted in this view) */}
    </Box>
  );
}

export default Dashboard;
