import React from 'react';
import {
  Box,
  Heading,
  Text,
  Table,
  Tbody,
  Tr,
  Td,
  Badge,
  Button,
  TableContainer,
} from '@chakra-ui/react';
import { useParams } from 'react-router-dom';

const OutgateTicketDetails = () => {
  const { id } = useParams();

  // Placeholder ticket data
  const ticket = {
    vehicleNumber: 'KBY 123A',
    containerId: 'CONT45678',
    status: 'Held',
    weight: '23,500 kg',
    driverName: 'John Doe',
    entryTime: '2025-07-31 09:12 AM',
    remarks: 'Requires customs clearance',
  };

  return (
    <Box p={6} bg="white" borderRadius="md" boxShadow="md">
      <Heading size="lg" mb={4}>Ticket Details</Heading>

      <TableContainer>
        <Table variant="simple">
          <Tbody>
            <Tr>
              <Td fontWeight="bold">Ticket ID</Td>
              <Td>{id}</Td>
            </Tr>
            <Tr>
              <Td fontWeight="bold">Vehicle Number</Td>
              <Td>{ticket.vehicleNumber}</Td>
            </Tr>
            <Tr>
              <Td fontWeight="bold">Container ID</Td>
              <Td>{ticket.containerId}</Td>
            </Tr>
            <Tr>
              <Td fontWeight="bold">Weight</Td>
              <Td>{ticket.weight}</Td>
            </Tr>
            <Tr>
              <Td fontWeight="bold">Status</Td>
              <Td>
                <Badge colorScheme={ticket.status === 'Held' ? 'red' : 'green'}>
                  {ticket.status}
                </Badge>
              </Td>
            </Tr>
            <Tr>
              <Td fontWeight="bold">Driver</Td>
              <Td>{ticket.driverName}</Td>
            </Tr>
            <Tr>
              <Td fontWeight="bold">Entry Time</Td>
              <Td>{ticket.entryTime}</Td>
            </Tr>
            <Tr>
              <Td fontWeight="bold">Remarks</Td>
              <Td>{ticket.remarks}</Td>
            </Tr>
          </Tbody>
        </Table>
      </TableContainer>

      <Button colorScheme="blue" mt={6}>Confirm Exit</Button>
    </Box>
  );
};

export default OutgateTicketDetails;
