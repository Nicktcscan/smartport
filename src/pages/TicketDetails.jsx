// src/pages/TicketDetails.jsx
import React, { useEffect, useState } from 'react';
import { Box, Heading, Text, Spinner, VStack, Badge } from '@chakra-ui/react';
import { useParams } from 'react-router-dom';
import axios from 'axios';

function TicketDetails() {
  const { id } = useParams();
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchTicket() {
      setLoading(true);
      try {
        const res = await axios.get(`/api/tickets/${id}`);
        setTicket(res.data);
      } catch (err) {
        console.error(err);
      }
      setLoading(false);
    }
    fetchTicket();
  }, [id]);

  if (loading) {
    return (
      <Box textAlign="center" py={10}>
        <Spinner size="xl" />
      </Box>
    );
  }

  if (!ticket) {
    return (
      <Box textAlign="center" py={10}>
        <Text>Ticket not found.</Text>
      </Box>
    );
  }

  return (
    <Box maxW="lg" mx="auto" bg="white" p={6} borderRadius="md" boxShadow="md">
      <Heading mb={4}>Ticket Details</Heading>
      <VStack spacing={3} align="start">
        <Text>
          <strong>Ticket ID:</strong> {ticket.ticket_id}
        </Text>
        <Text>
          <strong>Vehicle Number:</strong> {ticket.vehicle_number}
        </Text>
        <Text>
          <strong>Container Number:</strong> {ticket.container_number}
        </Text>
        <Text>
          <strong>Gross Weight:</strong> {ticket.gross_weight} kg
        </Text>
        <Text>
          <strong>Tare Weight:</strong> {ticket.tare_weight} kg
        </Text>
        <Text>
          <strong>Net Weight:</strong> {ticket.net} kg
        </Text>
        <Text>
          <strong>Cargo Type:</strong> {ticket.cargo_type}
        </Text>
        <Text>
          <strong>Driver Name:</strong> {ticket.driver}
        </Text>
        <Text>
          <strong>Status:</strong>{' '}
          <Badge colorScheme={ticket.status === 'Cleared' ? 'green' : 'yellow'}>
            {ticket.status}
          </Badge>
        </Text>
      </VStack>
    </Box>
  );
}

export default TicketDetails;
