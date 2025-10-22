// src/pages/OutgateDashboard.jsx
import React, { useEffect, useState, useCallback } from 'react';
import {
  Box,
  Heading,
  useToast,
  Text,
  Spinner,
  Button,
  Flex,
  SimpleGrid,
  Stat,
  StatLabel,
  StatNumber,
  Icon,
  Center,
} from '@chakra-ui/react';
import {
  ViewIcon,
  AttachmentIcon,
  CheckCircleIcon,
  InfoIcon,
} from '@chakra-ui/icons';
import { supabase } from '../supabaseClient';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';

const outgateNavItems = [
  { path: '/outgate', label: 'Dashboard', icon: ViewIcon },
  { path: '/outgate/search', label: 'Processed Tickets', icon: AttachmentIcon },
  { path: '/outgate/confirm-exit', label: 'Confirmed Exit', icon: CheckCircleIcon },
  { path: '/outgate/reports', label: 'Reports', icon: InfoIcon },
];

const COLORS = ['#3182CE', '#63B3ED', '#4299E1', '#90CDF4'];

function OutgateDashboard() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    pendingTickets: 0,
    processedTickets: 0,
    confirmExit: 0,
    reports: 0,
  });
  const toast = useToast();

  const fetchTicketsAndStats = useCallback(async () => {
    setLoading(true);
    try {
      // Pending tickets (operation = 'Pending')
      const { data: pendingTickets, error: pendingError } = await supabase
        .from('tickets')
        .select('*')
        .eq('operation', 'Pending');
      if (pendingError) throw pendingError;

      // Total tickets count (all tickets, for Processed Tickets stat)
      const { count: totalTicketsCount, error: totalCountError } = await supabase
        .from('tickets')
        .select('id', { count: 'exact', head: true });
      if (totalCountError) throw totalCountError;

      // Confirm Exit count from outgate table
      const { count: confirmExitCount, error: confirmExitError } = await supabase
        .from('outgate')
        .select('id', { count: 'exact', head: true });
      if (confirmExitError) throw confirmExitError;

      // Reports count — placeholder using total tickets count
      const reportsCount = totalTicketsCount || 0;

      setStats({
        pendingTickets: pendingTickets?.length || 0,
        processedTickets: totalTicketsCount || 0,
        confirmExit: confirmExitCount || 0,
        reports: reportsCount,
      });
    } catch (err) {
      console.error(err);
      toast({
        title: 'Failed to fetch dashboard data',
        status: 'error',
        duration: 4000,
        isClosable: true,
      });
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    fetchTicketsAndStats();
  }, [fetchTicketsAndStats]);

  // Prepare data for charts
  const barChartData = [
    { name: 'Pending Tickets', value: stats.pendingTickets },
    { name: 'Processed Tickets', value: stats.processedTickets },
    { name: 'Confirmed Exit', value: stats.confirmExit },
    { name: 'Reports', value: stats.reports },
  ];

  const pieChartData = [
    { name: 'Pending', value: stats.pendingTickets },
    { name: 'Processed', value: stats.processedTickets - stats.pendingTickets },
    { name: 'Confirmed Exit', value: stats.confirmExit },
  ];

  return (
    <Box p={6}>
      <Heading mb={6}>Outgate Dashboard</Heading>

      {/* Analytics Cards */}
      <SimpleGrid columns={{ base: 1, sm: 2, md: 4 }} spacing={6} mb={8}>
        {outgateNavItems.map(({ label, icon }) => {
          let statValue = 0;
          switch (label) {
            case 'Dashboard':
              statValue = stats.pendingTickets;
              break;
            case 'Processed Tickets':
              statValue = stats.processedTickets;
              break;
            case 'Confirmed Exit':
              statValue = stats.confirmExit;
              break;
            case 'Reports':
              statValue = stats.reports;
              break;
            default:
              statValue = 0;
          }

          return (
            <Stat
              key={label}
              p={4}
              borderWidth={1}
              borderRadius="md"
              boxShadow="sm"
              cursor="default"
              _hover={{ boxShadow: 'md' }}
            >
              <Flex align="center" mb={2} color="blue.500">
                <Icon as={icon} boxSize={5} mr={2} />
                <StatLabel>{label}</StatLabel>
              </Flex>
              <StatNumber fontSize="2xl">{statValue}</StatNumber>
            </Stat>
          );
        })}
      </SimpleGrid>

      {/* Refresh Button */}
      <Flex justifyContent="flex-end" mb={6}>
        <Button onClick={fetchTicketsAndStats} isLoading={loading} colorScheme="blue" size="sm">
          Refresh
        </Button>
      </Flex>

      {/* Loading */}
      {loading && (
        <Flex justifyContent="center" p={8}>
          <Spinner size="xl" />
        </Flex>
      )}

      {/* No Data */}
      {!loading && barChartData.every((item) => item.value === 0) && (
        <Text>No analytics data available.</Text>
      )}

      {/* Charts */}
      {!loading && barChartData.some((item) => item.value > 0) && (
        <SimpleGrid columns={{ base: 1, md: 2 }} spacing={8}>
          <Box
            borderWidth={1}
            borderRadius="md"
            p={4}
            boxShadow="sm"
            bg="white"
            height="300px"
          >
            <Heading size="md" mb={4}>
              Tickets Overview
            </Heading>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barChartData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" fill="#3182CE" />
              </BarChart>
            </ResponsiveContainer>
          </Box>

          <Box
            borderWidth={1}
            borderRadius="md"
            p={4}
            boxShadow="sm"
            bg="white"
            height="300px"
          >
            <Heading size="md" mb={4}>
              Operation Distribution
            </Heading>
            <Center height="100%">
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={pieChartData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    fill="#3182CE"
                    label
                  >
                    {pieChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend verticalAlign="bottom" height={36} />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </Center>
          </Box>
        </SimpleGrid>
      )}
    </Box>
  );
}

export default OutgateDashboard;
