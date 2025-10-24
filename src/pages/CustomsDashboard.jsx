// src/pages/CustomsDashboard.jsx
import React, { useEffect, useState } from 'react';
import {
  Box,
  Heading,
  Button,
  Textarea,
  VStack,
  Text,
  useToast,
} from '@chakra-ui/react';

import axios from 'axios';

function CustomsDashboard() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [remarks, setRemarks] = useState({});
  const toast = useToast();

  useEffect(() => {
    async function fetchTickets() {
      setLoading(true);
      try {
        const res = await axios.get('/api/tickets?status=Pending');
        setTickets(res.data);
      } catch (err) {
        console.error(err);
      }
      setLoading(false);
    }
    fetchTickets();
  }, []);

  const handleRemarkChange = (id, value) => {
    setRemarks((prev) => ({ ...prev, [id]: value }));
  };

  const approveTicket = async (id) => {
    try {
      await axios.post(`/api/tickets/${id}/approve`, {
        remarks: remarks[id] || '',
      });
      toast({
        title: 'Ticket approved',
        status: 'success',
        duration: 3000,
        isClosable: true,
      });
      setTickets((prev) => prev.filter((t) => t.ticket_id !== id));
    } catch (err) {
      toast({
        title: 'Approval failed',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
    }
  };

  return (
    <Box>
      <Heading mb={6}>Customs Dashboard</Heading>
      {loading ? (
        <Text>Loading tickets...</Text>
      ) : tickets.length === 0 ? (
        <Text>No tickets pending customs clearance.</Text>
      ) : (
        <VStack spacing={6} align="stretch">
          {tickets.map((ticket) => (
            <Box
              key={ticket.ticket_id}
              p={4}
              boxShadow="md"
              borderRadius="md"
              bg="white"
            >
              <Text>
                <strong>Ticket ID:</strong> {ticket.ticket_id}
              </Text>
              <Text>
                <strong>Vehicle:</strong> {ticket.vehicle_number}
              </Text>
              <Text>
                <strong>Container:</strong> {ticket.container_number}
              </Text>
              <Textarea
                mt={2}
                placeholder="Enter remarks"
                value={remarks[ticket.ticket_id] || ''}
                onChange={(e) =>
                  handleRemarkChange(ticket.ticket_id, e.target.value)
                }
              />
              <Button
                mt={2}
                colorScheme="blue"
                onClick={() => approveTicket(ticket.ticket_id)}
              >
                Approve
              </Button>
            </Box>
          ))}
        </VStack>
      )}
    </Box>
  );
}

export default CustomsDashboard;
