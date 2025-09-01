// src/pages/customs/CustomsDashboard.jsx
import React, { useEffect, useState, useMemo } from 'react';
import {
  Box,
  Text,
  Heading,
  SimpleGrid,
  useColorModeValue,
  Badge,
  Skeleton,
  HStack,
  VStack,
  Icon,
  Select,
  Stack,
} from '@chakra-ui/react';
import {
  FaTruck,
  FaClipboardList,
  FaSearch,
  FaCheckCircle,
  FaClock,
} from 'react-icons/fa';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';

// Dummy fetch functions
const mockFetchStats = () =>
  new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        totalVehiclesToday: 32,
        inspectionsPending: 5,
        clearedToday: 25,
        lastUpdated: new Date().toISOString(),
      });
    }, 1200);
  });

const mockFetchSections = () =>
  new Promise((resolve) => {
    setTimeout(() => {
      resolve([
        {
          title: 'Vehicle Records',
          description: 'Review all incoming and outgoing vehicle activity.',
          icon: FaTruck,
          path: '/customs/vehicle-records',
        },
        {
          title: 'Cargo Inspection',
          description: 'Perform and track cargo inspections.',
          icon: FaSearch,
          path: '/customs/cargo-inspection',
        },
        {
          title: 'Clearance Actions',
          description: 'Approve or reject clearance requests.',
          icon: FaClipboardList,
          path: '/customs/clearance-actions',
        },
        {
          title: 'Digital Validation',
          description: 'Digitally validate cargo and documentation.',
          icon: FaCheckCircle,
          path: '/customs/validation',
        },
        {
          title: 'Movement Logs',
          description: 'Track all movements within the port.',
          icon: FaClock,
          path: '/customs/movement-logs',
        },
        {
          title: 'Audit Trail',
          description: 'Access audit logs of all activities.',
          icon: FaClipboardList,
          path: '/customs/audit-trail',
        },
      ]);
    }, 1400);
  });

// Mock data for chart - last 30 days processed vehicles
const fullLineChartData = [
  { day: 'Day 1', vehicles: 15 },
  { day: 'Day 2', vehicles: 20 },
  { day: 'Day 3', vehicles: 22 },
  { day: 'Day 4', vehicles: 30 },
  { day: 'Day 5', vehicles: 18 },
  { day: 'Day 6', vehicles: 25 },
  { day: 'Day 7', vehicles: 28 },
  { day: 'Day 8', vehicles: 23 },
  { day: 'Day 9', vehicles: 20 },
  { day: 'Day 10', vehicles: 19 },
  { day: 'Day 11', vehicles: 22 },
  { day: 'Day 12', vehicles: 27 },
  { day: 'Day 13', vehicles: 29 },
  { day: 'Day 14', vehicles: 30 },
  { day: 'Day 15', vehicles: 26 },
  { day: 'Day 16', vehicles: 23 },
  { day: 'Day 17', vehicles: 25 },
  { day: 'Day 18', vehicles: 28 },
  { day: 'Day 19', vehicles: 24 },
  { day: 'Day 20', vehicles: 21 },
  { day: 'Day 21', vehicles: 19 },
  { day: 'Day 22', vehicles: 22 },
  { day: 'Day 23', vehicles: 20 },
  { day: 'Day 24', vehicles: 18 },
  { day: 'Day 25', vehicles: 17 },
  { day: 'Day 26', vehicles: 15 },
  { day: 'Day 27', vehicles: 16 },
  { day: 'Day 28', vehicles: 18 },
  { day: 'Day 29', vehicles: 20 },
  { day: 'Day 30', vehicles: 22 },
];

// Mock data for BarChart - inspection counts per type per day (simplified for demo)
const fullBarChartData = [
  { type: 'Physical', count: 40 },
  { type: 'X-Ray', count: 25 },
  { type: 'Documentation', count: 15 },
  { type: 'Canine', count: 10 },
];

// Mock data for PieChart - clearance status (static for now)
const fullPieChartData = [
  { name: 'Approved', value: 60, color: '#38A169' },
  { name: 'Pending', value: 25, color: '#ED8936' },
  { name: 'Rejected', value: 15, color: '#E53E3E' },
];

export default function CustomsDashboard() {
  const [sections, setSections] = useState([]);
  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingSections, setLoadingSections] = useState(true);

  // Filters state
  const [lineChartRange, setLineChartRange] = useState('7'); // days to show: 7 or 30
  const [barChartFilter, setBarChartFilter] = useState('all'); // inspection type filter
  const [pieChartFilter, setPieChartFilter] = useState('all'); // clearance status filter (for demo, kept simple)

  const bgCard = useColorModeValue('white', 'gray.800');
  const textColor = useColorModeValue('gray.700', 'gray.200');
  const hoverBg = useColorModeValue('gray.50', 'gray.700');

  useEffect(() => {
    setLoadingStats(true);
    mockFetchStats().then((data) => {
      setStats(data);
      setLoadingStats(false);
    });

    setLoadingSections(true);
    mockFetchSections().then((data) => {
      setSections(data);
      setLoadingSections(false);
    });
  }, []);

  // Filter line chart data based on selected range
  const filteredLineChartData = useMemo(() => {
    const daysToShow = Number(lineChartRange);
    return fullLineChartData.slice(-daysToShow);
  }, [lineChartRange]);

  // Filter bar chart data by type if filter applied
  const filteredBarChartData = useMemo(() => {
    if (barChartFilter === 'all') return fullBarChartData;
    return fullBarChartData.filter((d) => d.type === barChartFilter);
  }, [barChartFilter]);

  // For PieChart, you could filter by clearance status; here we keep all for demo
  const filteredPieChartData = useMemo(() => fullPieChartData, []);

  return (
    <Box>
      <Heading mb={6} fontSize="2xl" color={textColor}>
        Customs Dashboard
      </Heading>

      {/* KPIs */}
      <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4} mb={8}>
        <Skeleton isLoaded={!loadingStats}>
          <StatBox
            label="Total Vehicles Today"
            value={stats?.totalVehiclesToday ?? '--'}
            icon={FaTruck}
          />
        </Skeleton>
        <Skeleton isLoaded={!loadingStats}>
          <StatBox
            label="Inspections Pending"
            value={stats?.inspectionsPending ?? '--'}
            icon={FaSearch}
          />
        </Skeleton>
        <Skeleton isLoaded={!loadingStats}>
          <StatBox
            label="Cleared Today"
            value={stats?.clearedToday ?? '--'}
            icon={FaCheckCircle}
          />
        </Skeleton>
      </SimpleGrid>

      {/* Last Updated */}
      {!loadingStats && stats?.lastUpdated && (
        <Text mb={6} fontSize="sm" color="gray.500">
          Last updated:{' '}
          <Badge colorScheme="blue">
            {new Date(stats.lastUpdated).toLocaleTimeString()}
          </Badge>
        </Text>
      )}

      {/* Sections */}
      <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={6} mb={10}>
        {(loadingSections ? Array(6).fill({}) : sections).map((section, index) => (
          <Skeleton key={index} isLoaded={!loadingSections}>
            <Box
              p={6}
              bg={bgCard}
              borderRadius="md"
              shadow="md"
              transition="all 0.2s"
              _hover={{
                transform: 'translateY(-4px)',
                shadow: 'lg',
                bg: hoverBg,
              }}
              cursor="pointer"
              onClick={() => {
                if (section.path) {
                  window.location.href = section.path;
                }
              }}
            >
              <VStack align="start" spacing={3}>
                <HStack spacing={3}>
                  <Icon as={section.icon ?? FaClipboardList} boxSize={6} color="teal.500" />
                  <Text fontWeight="bold" fontSize="lg">
                    {section.title ?? 'Loading...'}
                  </Text>
                </HStack>
                <Text color="gray.500" fontSize="sm">
                  {section.description ?? 'Please wait'}
                </Text>
              </VStack>
            </Box>
          </Skeleton>
        ))}
      </SimpleGrid>

      {/* Filters for Line Chart */}
      <Stack
        direction={{ base: 'column', md: 'row' }}
        spacing={4}
        maxW="800px"
        mx="auto"
        mb={4}
        align="center"
      >
        <Text fontWeight="bold">Show vehicles processed in last:</Text>
        <Select
          maxW="120px"
          value={lineChartRange}
          onChange={(e) => setLineChartRange(e.target.value)}
        >
          <option value="7">7 Days</option>
          <option value="30">30 Days</option>
        </Select>
      </Stack>

      {/* Line Chart visualization */}
      <Box
        p={6}
        bg={bgCard}
        borderRadius="md"
        shadow="md"
        maxW="800px"
        mx="auto"
        mb={10}
      >
        <Heading size="md" mb={4} color={textColor}>
          Vehicles Processed
        </Heading>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart
            data={filteredLineChartData}
            margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="day" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Line
              type="monotone"
              dataKey="vehicles"
              stroke="#319795"
              strokeWidth={3}
              activeDot={{ r: 8 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </Box>

      {/* Filters for Bar and Pie charts */}
      <SimpleGrid
        columns={{ base: 1, md: 2 }}
        spacing={10}
        maxW="900px"
        mx="auto"
        mb={2}
        alignItems="center"
      >
        {/* Bar Chart Filter */}
        <Box>
          <Text fontWeight="bold" mb={2}>
            Filter Inspections by Type:
          </Text>
          <Select
            maxW="200px"
            value={barChartFilter}
            onChange={(e) => setBarChartFilter(e.target.value)}
          >
            <option value="all">All Types</option>
            {fullBarChartData.map(({ type }) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </Select>
        </Box>

        {/* Pie Chart Filter (optional, no real effect in demo) */}
        <Box>
          <Text fontWeight="bold" mb={2}>
            Filter Clearance Status:
          </Text>
          <Select
            maxW="200px"
            value={pieChartFilter}
            onChange={(e) => setPieChartFilter(e.target.value)}
          >
            <option value="all">All Status</option>
            {fullPieChartData.map(({ name }) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </Box>
      </SimpleGrid>

      {/* Bar and Pie charts side by side */}
      <SimpleGrid columns={{ base: 1, md: 2 }} spacing={10} maxW="900px" mx="auto" mb={10}>
        {/* Bar Chart */}
        <Box
          p={6}
          bg={bgCard}
          borderRadius="md"
          shadow="md"
        >
          <Heading size="md" mb={4} color={textColor}>
            Inspections by Type
          </Heading>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={filteredBarChartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="type" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#3182CE" />
            </BarChart>
          </ResponsiveContainer>
        </Box>

        {/* Pie Chart */}
        <Box
          p={6}
          bg={bgCard}
          borderRadius="md"
          shadow="md"
        >
          <Heading size="md" mb={4} color={textColor}>
            Clearance Status Breakdown
          </Heading>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={
                  pieChartFilter === 'all'
                    ? filteredPieChartData
                    : filteredPieChartData.filter((item) => item.name === pieChartFilter)
                }
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={90}
                label={({ name, percent }) =>
                  `${name}: ${(percent * 100).toFixed(0)}%`
                }
              >
                {(pieChartFilter === 'all'
                  ? filteredPieChartData
                  : filteredPieChartData.filter((item) => item.name === pieChartFilter)
                ).map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
              <Legend verticalAlign="bottom" height={36} />
            </PieChart>
          </ResponsiveContainer>
        </Box>
      </SimpleGrid>
    </Box>
  );
}

function StatBox({ label, value, icon }) {
  const bg = useColorModeValue('white', 'gray.800');
  const color = useColorModeValue('gray.700', 'gray.200');
  return (
    <Box
      bg={bg}
      p={5}
      borderRadius="md"
      shadow="sm"
      border="1px solid"
      borderColor={useColorModeValue('gray.200', 'gray.700')}
    >
      <HStack spacing={4}>
        <Icon as={icon} boxSize={6} color="teal.500" />
        <VStack align="start" spacing={0}>
          <Text fontSize="sm" color="gray.500">
            {label}
          </Text>
          <Text fontSize="xl" fontWeight="bold" color={color}>
            {value}
          </Text>
        </VStack>
      </HStack>
    </Box>
  );
}
