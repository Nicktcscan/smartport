// src/components/TicketTable.jsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  Button,
  Box,
  Spinner,
  Text,
  Select,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Badge,
  Flex,
  Input,
  IconButton,
  Stack,
  Checkbox,
} from '@chakra-ui/react';
import { Link } from 'react-router-dom';
import { TriangleDownIcon, TriangleUpIcon } from '@chakra-ui/icons';
import { supabase } from '../supabaseClient';

function TicketTable({ tickets: externalTickets, onAction, actionLabel, actionLoadingId }) {
  // If tickets passed as prop, use those, else fetch internally
  const [tickets, setTickets] = useState(externalTickets || []);
  const [loading, setLoading] = useState(!externalTickets);
  const [visibleColumns, setVisibleColumns] = useState(() => {
    try {
      const saved = localStorage.getItem('visibleColumns');
      return saved
        ? JSON.parse(saved)
        : {
            id: true,
            ticket_id: true,
            gnsw_truck_no: true,
            container_no: true,
            gross: true,
            net: true,
            date: true,
            operation: true,
            actions: true,
          };
    } catch {
      return {
        id: true,
        ticket_id: true,
        gnsw_truck_no: true,
        container_no: true,
        gross: true,
        net: true,
        date: true,
        operation: true,
        actions: true,
      };
    }
  });

  useEffect(() => {
    if (!externalTickets) {
      async function fetchTickets() {
        setLoading(true);
        try {
          const { data, error } = await supabase
            .from('tickets')
            .select('*')
            .order('date', { ascending: false });
          if (error) throw error;
          setTickets(data || []);
        } catch (err) {
          console.error('Error fetching tickets:', err.message || err);
        }
        setLoading(false);
      }
      fetchTickets();
    }
  }, [externalTickets]);

  useEffect(() => {
    if (externalTickets) setTickets(externalTickets);
  }, [externalTickets]);

  useEffect(() => {
    try {
      localStorage.setItem('visibleColumns', JSON.stringify(visibleColumns));
    } catch {}
  }, [visibleColumns]);

  const [sortConfig, setSortConfig] = useState({ key: 'date', direction: 'desc' });
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const requestSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const toggleColumn = (key) => {
    setVisibleColumns((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const filteredAndSortedTickets = useMemo(() => {
    let filtered = [...tickets];

    if (filterStatus !== 'all') {
      filtered = filtered.filter(
        (t) => t.operation?.toLowerCase() === filterStatus.toLowerCase()
      );
    }

    if (searchTerm.trim() !== '') {
      filtered = filtered.filter((t) => {
        return (
          (t.gnsw_truck_no && t.gnsw_truck_no.toLowerCase().includes(searchTerm.toLowerCase())) ||
          (t.container_no && t.container_no.toLowerCase().includes(searchTerm.toLowerCase())) ||
          (t.ticket_id && t.ticket_id.toString().includes(searchTerm)) ||
          (t.id && t.id.toString().includes(searchTerm))
        );
      });
    }

    if (sortConfig.key) {
      filtered.sort((a, b) => {
        const aVal = a[sortConfig.key] ?? '';
        const bVal = b[sortConfig.key] ?? '';

        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
        }
        return sortConfig.direction === 'asc'
          ? String(aVal).localeCompare(String(bVal))
          : String(bVal).localeCompare(String(aVal));
      });
    }

    return filtered;
  }, [tickets, filterStatus, searchTerm, sortConfig]);

  const totalPages = Math.ceil(filteredAndSortedTickets.length / pageSize);
  const paginatedTickets = filteredAndSortedTickets.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const columnLabels = {
    id: 'ID',
    ticket_id: 'Ticket ID',
    gnsw_truck_no: 'Truck Number',
    container_no: 'Container Number',
    gross: 'Gross Weight',
    net: 'Net Weight',
    date: 'Date',
    operation: 'Status',
    actions: 'Actions',
  };

  const exportToCSV = () => {
    if (!filteredAndSortedTickets.length) return;

    const keysToExport = Object.keys(visibleColumns).filter(
      (key) => visibleColumns[key] && key !== 'actions'
    );

    const headers = keysToExport.map((key) => columnLabels[key]);
    const rows = filteredAndSortedTickets.map((t) =>
      keysToExport.map((key) => {
        if (key === 'gross' || key === 'net') return `${t[key]} kg`;
        if (key === 'date') return t.date ? new Date(t.date).toLocaleString() : '';
        return t[key];
      })
    );

    let csvContent = 'data:text/csv;charset=utf-8,';
    csvContent += headers.join(',') + '\n';
    rows.forEach((row) => {
      csvContent += row.map((item) => `"${item ?? ''}"`).join(',') + '\n';
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.href = encodedUri;
    link.download = 'tickets_export.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getSortIcon = (key) => {
    if (sortConfig.key !== key) return null;
    return sortConfig.direction === 'asc' ? (
      <TriangleUpIcon ml={1} />
    ) : (
      <TriangleDownIcon ml={1} />
    );
  };

  if (loading) {
    return (
      <Box textAlign="center" py={10}>
        <Spinner size="xl" />
      </Box>
    );
  }

  if (!tickets.length) {
    return (
      <Box textAlign="center" py={10}>
        <Text>No tickets found.</Text>
      </Box>
    );
  }

  return (
    <Box>
      {/* Controls: Filter, Search, Export, Page Size, Columns */}
      <Flex mb={4} flexWrap="wrap" gap={4} justify="space-between" align="center">
        <Stack direction="row" spacing={2} align="center" flexWrap="wrap">
          <Select
            size="sm"
            w="150px"
            value={filterStatus}
            onChange={(e) => {
              setFilterStatus(e.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="exited">Exited</option>
            <option value="flagged">Flagged</option>
            <option value="weighed">Weighed</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </Select>
          <Input
            size="sm"
            placeholder="Search tickets"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
            maxW="200px"
          />
          <Button size="sm" colorScheme="teal" onClick={exportToCSV}>
            Export CSV
          </Button>
          <Select
            size="sm"
            w="80px"
            value={pageSize}
            onChange={(e) => {
              setPageSize(parseInt(e.target.value, 10));
              setCurrentPage(1);
            }}
          >
            {[10, 25, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size} / page
              </option>
            ))}
          </Select>
        </Stack>

        {/* Toggle Columns */}
        <Stack direction="row" spacing={2} flexWrap="wrap">
          {Object.keys(visibleColumns).map((key) => (
            key !== 'actions' && (
              <Checkbox
                key={key}
                size="sm"
                isChecked={visibleColumns[key]}
                onChange={() => toggleColumn(key)}
              >
                {columnLabels[key]}
              </Checkbox>
            )
          ))}
        </Stack>
      </Flex>

      <Table variant="striped" size="sm" colorScheme="blue">
        <Thead bg="blue.600" color="white">
          <Tr>
            {visibleColumns.id && (
              <Th cursor="pointer" onClick={() => requestSort('id')} color="white">
                ID {getSortIcon('id')}
              </Th>
            )}
            {visibleColumns.ticket_id && (
              <Th cursor="pointer" onClick={() => requestSort('ticket_id')} color="white">
                Ticket ID {getSortIcon('ticket_id')}
              </Th>
            )}
            {visibleColumns.gnsw_truck_no && (
              <Th cursor="pointer" onClick={() => requestSort('gnsw_truck_no')} color="white">
                Truck Number {getSortIcon('gnsw_truck_no')}
              </Th>
            )}
            {visibleColumns.container_no && (
              <Th cursor="pointer" onClick={() => requestSort('container_no')} color="white">
                Container Number {getSortIcon('container_no')}
              </Th>
            )}
            {visibleColumns.gross && (
              <Th cursor="pointer" onClick={() => requestSort('gross')} color="white">
                Gross Weight {getSortIcon('gross')}
              </Th>
            )}
            {visibleColumns.net && (
              <Th cursor="pointer" onClick={() => requestSort('net')} color="white">
                Net Weight {getSortIcon('net')}
              </Th>
            )}
            {visibleColumns.date && (
              <Th cursor="pointer" onClick={() => requestSort('date')} color="white">
                Date {getSortIcon('date')}
              </Th>
            )}
            {visibleColumns.operation && (
              <Th cursor="pointer" onClick={() => requestSort('operation')} color="white">
                Status {getSortIcon('operation')}
              </Th>
            )}
            {visibleColumns.actions && <Th color="white">Actions</Th>}
          </Tr>
        </Thead>
        <Tbody>
          {paginatedTickets.map((ticket) => (
            <Tr key={ticket.id || ticket.ticket_id}>
              {visibleColumns.id && <Td>{ticket.id}</Td>}
              {visibleColumns.ticket_id && <Td>{ticket.ticket_id || ticket.id}</Td>}
              {visibleColumns.gnsw_truck_no && <Td>{ticket.gnsw_truck_no || '-'}</Td>}
              {visibleColumns.container_no && <Td>{ticket.container_no || '-'}</Td>}
              {visibleColumns.gross && <Td>{ticket.gross ? `${ticket.gross} kg` : '-'}</Td>}
              {visibleColumns.net && <Td>{ticket.net ? `${ticket.net} kg` : '-'}</Td>}
              {visibleColumns.date && (
                <Td>{ticket.date ? new Date(ticket.date).toLocaleString() : '-'}</Td>
              )}
              {visibleColumns.operation && (
                <Td>
                  <StatusBadge status={ticket.operation} />
                </Td>
              )}
              {visibleColumns.actions && (
                <Td>
                  {onAction && actionLabel ? (
                    <Button
                      size="sm"
                      colorScheme="orange"
                      onClick={() => onAction(ticket.ticket_id || ticket.id)}
                      isLoading={actionLoadingId === (ticket.ticket_id || ticket.id)}
                      loadingText="Processing"
                    >
                      {actionLabel}
                    </Button>
                  ) : (
                    <Button
                      as={Link}
                      to={`/tickets/${ticket.ticket_id || ticket.id}`}
                      size="sm"
                      colorScheme="blue"
                    >
                      View
                    </Button>
                  )}
                </Td>
              )}
            </Tr>
          ))}
        </Tbody>
      </Table>

      {/* Pagination Controls */}
      <Flex justify="space-between" align="center" mt={4} flexWrap="wrap" gap={2}>
        <Text>
          Page {currentPage} of {totalPages}
        </Text>
        <Stack direction="row" spacing={2} align="center">
          <Button
            size="sm"
            onClick={() => setCurrentPage(1)}
            isDisabled={currentPage === 1}
          >
            First
          </Button>
          <Button
            size="sm"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            isDisabled={currentPage === 1}
          >
            Prev
          </Button>
          <Button
            size="sm"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            isDisabled={currentPage === totalPages}
          >
            Next
          </Button>
          <Button
            size="sm"
            onClick={() => setCurrentPage(totalPages)}
            isDisabled={currentPage === totalPages}
          >
            Last
          </Button>
        </Stack>
      </Flex>
    </Box>
  );
}

function StatusBadge({ status }) {
  const statusLower = (status || '').toLowerCase();
  let colorScheme = 'gray';
  let text = status || 'Unknown';

  switch (statusLower) {
    case 'pending':
      colorScheme = 'yellow';
      text = 'Pending';
      break;
    case 'exited':
      colorScheme = 'green';
      text = 'Exited';
      break;
    case 'flagged':
      colorScheme = 'red';
      text = 'Flagged';
      break;
    case 'weighed':
      colorScheme = 'blue';
      text = 'Weighed';
      break;
    case 'approved':
      colorScheme = 'teal';
      text = 'Approved';
      break;
    case 'rejected':
      colorScheme = 'red';
      text = 'Rejected';
      break;
    default:
      colorScheme = 'gray';
      text = status || 'Unknown';
  }

  return (
    <Badge colorScheme={colorScheme} variant="solid" px={2} py={1} borderRadius="md" fontSize="sm">
      {text}
    </Badge>
  );
}

export default TicketTable;
