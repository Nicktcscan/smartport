// pages/appointment.jsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
Box, Button, Container, Heading, Input as ChakraInput, Select, Text, SimpleGrid,
FormControl, FormLabel, HStack, Stack, Table, Thead, Tbody, Tr, Th, Td,
useToast, Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalFooter, ModalCloseButton,
IconButton, Badge, Divider, VStack, useBreakpointValue, Flex
} from '@chakra-ui/react';
import { AddIcon, DeleteIcon, EditIcon, DownloadIcon, RepeatIcon, SearchIcon, SmallCloseIcon } from '@chakra-ui/icons';
import { motion, AnimatePresence } from 'framer-motion';
import { pdf as pdfRender, Document, Page, Text as PdfText, View as PdfView, StyleSheet, Image as PdfImage } from '@react-pdf/renderer';
import { supabase } from '../supabaseClient'; // ensure this file exists and exports a configured supabase client


// ----------------- Import logos (place your files in src/assets) -----------------
import gralogo from '/assets/gralogo.png';
import gpalogo from '/assets/gpalogo.png';
import gnswlogo from '/assets/gnswlogo.png';


// ---------- Config ----------
const WAREHOUSES = [
{ value: 'WTGMBJLCON', label: 'WTGMBJLCON - GAMBIA PORTS AUTHORITY - P.O BOX 617 BANJUL BJ' },
];


const PACKING_TYPES = [
{ value: 'container', label: 'Container' },
{ value: 'bulk', label: 'Bulk' },
{ value: 'loose', label: 'Loose Cargo' },
];


const MotionBox = motion(Box);


// ---------- PDF styles (react-pdf) ----------
const pdfStyles = StyleSheet.create({
page: { padding: 18, fontSize: 10, fontFamily: 'Helvetica' },
headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
headerLeft: { width: '25%' },
headerCenter: { width: '50%', alignItems: 'center' },
headerRight: { width: '25%', alignItems: 'flex-end' },
title: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
subtitle: { fontSize: 9, color: '#333', marginBottom: 2 },
section: { marginBottom: 8 },
twoCol: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
colLeft: { width: '48%' },
colRight: { width: '48%' },
infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
label: { fontSize: 9, color: '#444', width: '48%' },
value: { fontSize: 10, fontWeight: '600', width: '48%', textAlign: 'right' },
tableHeader: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#bbb', paddingBottom: 4, marginTop: 4 },
tableRow: { flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 0.3, borderBottomColor: '#eee' },
tableCellSmall: { width: '20%' },
tableCellMedium: { width: '40%' },
barcodeImg: { width: 220, height: 44, marginTop: 6 },
watermark: { position: 'absolute', opacity: 0.06 },
footer: { position: 'absolute', bottom: 22, left: 18, right: 18, textAlign: 'center', fontSize: 9, color: '#222' },
signRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 18 },
signBox: { width: '48%', borderTopWidth: 0.8, borderTopColor: '#999', paddingTop: 6, textAlign: 'left' }
});


// ---------- Helpers ----------
function pad(num, length = 4) {
const s = String(num || 0);
return s.padStart(length, '0');
}


function generateBarcodeSvgDataUrl(value, width = 400, height = 80) {
const chars = String(value || '').split('');
let bits = [];
for (let i = 0; i < chars.length; i++) {
const code = chars[i].charCodeAt(0);
for (let b = 0; b < 8; b++) bits.push((code >> b) & 1);
}
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="#fff"/>
  <g transform="scale(${width / 400}, ${height / 80})">
    ${bits.map((bit, i) => `
      <rect x="${i * 10}" y="${bit ? 0 : 40}" width="10" height="${bit ? 40 : 20}" fill="${bit ? '#000' : '#fff'}"/>
    `).join('')}
  </g>
</svg>
`;
return `data:image/svg+xml;base64,${btoa(svg)}`;
}

// ---------- Confirm Modal ----------
function ConfirmModal({
  isOpen,
  onClose,
  agentName,
  agentTin,
  warehouse,
  pickupDate,
  truckNumber,
  driverName,
  driverLicense,
  consolidated,
  t1s,
  handleConfirm,
  loading
}) {
  const warehouseLabel = (WAREHOUSES.find(w => w.value === warehouse) || {}).label || warehouse;

  return (
    <Modal isOpen={isOpen} onClose={onClose} isCentered size="lg">
      <ModalOverlay />
      <ModalContent maxW="lg" borderRadius="lg" className="appt-glass">
        <ModalHeader>Confirm Appointment</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Stack spacing={3}>
            <Text><b>Agent:</b> {agentName} ({agentTin})</Text>
            <Text><b>Warehouse:</b> {warehouseLabel}</Text>
            <Text><b>Pick-up Date:</b> {pickupDate}</Text>
            <Text><b>Truck:</b> {truckNumber}</Text>
            <Text><b>Driver:</b> {driverName} — {driverLicense}</Text>
            <Text><b>Consolidated:</b> {consolidated}</Text>

            <Box mt={2}>
              <Text fontWeight="semibold">T1 Records ({t1s.length})</Text>
              <Box overflowX="auto" mt={2}>
                <Table size="sm">
                  <Thead>
                    <Tr>
                      <Th>#</Th>
                      <Th>SAD</Th>
                      <Th>Packing</Th>
                      <Th>Container</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {t1s.map((r, i) => (
                      <Tr key={i}>
                        <Td>{i + 1}</Td>
                        <Td>{r.sadNo}</Td>
                        <Td>{r.packingType}</Td>
                        <Td>{r.containerNo || '—'}</Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </Box>
            </Box>
          </Stack>
        </ModalBody>
        <ModalFooter>
          <Button onClick={onClose} mr={3}>Cancel</Button>
          <Button
            colorScheme="blue"
            leftIcon={<DownloadIcon />}
            onClick={handleConfirm}
            isLoading={loading}
          >
            Confirm & Download Ticket
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
