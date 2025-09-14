// src/pages/WeighbridgeManagementPage.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box, Heading, Button, Input, FormControl, FormLabel, Table,
  Thead, Tbody, Tr, Th, Td, useToast, Modal, ModalOverlay,
  ModalContent, ModalHeader, ModalBody, ModalFooter, ModalCloseButton,
  useDisclosure, Text, SimpleGrid, IconButton, Flex, Select, Progress, Switch, HStack
} from '@chakra-ui/react';
import { ViewIcon } from '@chakra-ui/icons';

import { supabase } from '../supabaseClient';
import Tesseract from 'tesseract.js';
import { pdfPageToBlobPdfjs } from '../utils/pdfUtils';

const OCR_FUNCTION_URL = 'https://cgyjradpttmdancexdem.functions.supabase.co/ocr';
const DEFAULT_PAGE_SIZE = 5;

/**
 * Generate a unique ticket ID
 */
export function generateTicketId(existingIds = []) {
  const prefix = "TICKET-";
  const existingSet = new Set(existingIds);
  let num = 1;
  while (existingSet.has(`${prefix}${num}`)) {
    num++;
  }
  return `${prefix}${num}`;
}

/**
 * Local OCR using Tesseract.js
 */
export async function extractWithTesseract(file, progressCallback = () => {}) {
  const { createWorker } = Tesseract;
  const worker = await createWorker({
    logger: (m) => {
      if (m.status === "recognizing text" && m.progress) {
        progressCallback(m.progress);
      }
    },
  });

  await worker.loadLanguage("eng");
  await worker.initialize("eng");

  const { data: { text } } = await worker.recognize(file);
  await worker.terminate();

  return text;
}

/**
 * Main function to extract ticket data from a PDF or image
 */
export async function extractTicketDataFromFile(
  file,
  progressCallback = () => {},
  options = { useCloudOCR: true, useAlternativePdfConversion: false }
) {
  if (!file) throw new Error("No file provided for OCR");

  progressCallback(0.05);
  let text = "";

  const convertPdf = async (pdfFile) => {
    return await pdfPageToBlobPdfjs(pdfFile); // always use pdfPageToBlobPdfjs
  };

  if (options.useCloudOCR) {
    const formData = new FormData();
    let uploadFile = file;

    if (file.type === "application/pdf") {
      progressCallback(0.1);
      uploadFile = await convertPdf(file);
    }

    formData.append("file", uploadFile, "ticket-page-1.png");

    const resp = await fetch(OCR_FUNCTION_URL, { method: "POST", body: formData });
    const json = await resp.json().catch(() => null);

    if (!resp.ok) {
      const msg = (json && (json.error || json.message)) || `OCR function returned status ${resp.status}`;
      throw new Error(msg);
    }

    progressCallback(0.95);
    text = json?.text || "";
  } else {
    let ocrFile = file;
    if (file.type === "application/pdf") {
      progressCallback(0.1);
      ocrFile = await convertPdf(file);
    }
    text = await extractWithTesseract(ocrFile, progressCallback);
  }

  progressCallback(1);
  return parseTicketText(text);
}

/**
 * Dummy parser function (replace with your real parsing logic)
 */
function parseTicketText(text) {
  return text.split("\n").map((line) => line.trim()).filter(Boolean);
}

/**
 * Debounce hook
 */
export function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

/**
 * OCR Component
 */
export function OCRComponent({ onComplete }) {
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  const reset = () => {
    setFile(null);
    setProgress(0);
    onComplete?.(null, null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setFile(selectedFile || null);
    setProgress(0);
    onComplete?.(null, null);
  };

  const trimTextBeforeNotes = (text) => {
    const noteIndex = text.toLowerCase().indexOf('note');
    return noteIndex !== -1 ? text.substring(0, noteIndex).trim() : text.trim();
  };

  const handleOCR = async () => {
    if (!file) return alert('Please upload an image or PDF first.');
    setLoading(true);
    setProgress(0);

    try {
      let ocrFile = file;

      if (file.type === "application/pdf") {
        ocrFile = await pdfPageToBlobPdfjs(file); // use pdfPageToBlobPdfjs
      }

      const result = await Tesseract.recognize(ocrFile, 'eng', {
        logger: (m) => m.status === 'recognizing text' && setProgress(Math.round(m.progress * 100)),
      });

      setProgress(100);
      setLoading(false);
      const trimmedText = trimTextBeforeNotes(result.data.text || '');
      onComplete?.(file, trimmedText);
    } catch (err) {
      console.error('OCR error:', err);
      alert(`Failed to extract text: ${err.message}`);
      setLoading(false);
      setProgress(0);
      onComplete?.(file, null);
    }
  };

  

  return (
    <Box border="1px" borderColor="gray.300" borderRadius="md" p={4} mb={4}>
      <FormControl>
        <FormLabel>Upload Image or PDF to Extract</FormLabel>
        <Input type="file" accept="image/*,application/pdf" onChange={handleFileChange} ref={inputRef} />
      </FormControl>
      <Button mt={2} onClick={handleOCR} isLoading={loading} colorScheme="teal">
        Run OCR Extractor
      </Button>
      {loading && <Progress mt={2} value={progress} />}
    </Box>
  );
}

/**
 * Helper to normalize key-value pairs
 */
function parseExtractedText(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.+?)\s*:\s*(.+)$/);
      if (!match) return null;
      let [key, value] = match;
      key = key
        .toLowerCase()
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
      value = value.replace(/\s+kg/i, 'kg').replace(/\s{2,}/g, ' ');
      return { key, value };
    })
    .filter(Boolean);
}


// Main Page
function WeighbridgeManagementPage() {
  const toast = useToast();

  // view modal disclosure for ticket viewing
  const { isOpen: isViewOpen, onOpen: onViewOpen, onClose: onViewClose } = useDisclosure();
  // confirm modal disclosure for submit confirmation
  const { isOpen: isConfirmOpen, onOpen: onConfirmOpen, onClose: onConfirmClose } = useDisclosure();

  const [formData, setFormData] = useState({
    ticket_no: '', trailer_no: '', gnsw_truck_no: '', manual: '', anpr: '', wb_id: '', consignee: '', operation: '',
    consolidated: '', driver: '', truck_on_wb: '', gross: '', tare: '', net: '', weight: '', sad_no: '',
    container_no: '', material: '', pass_number: '', date: '', scale_name: '', operator: '', axles: ''
  });

  const [ocrFile, setOcrFile] = useState(null);
  const [ocrText, setOcrText] = useState('');
  const [extractedPairs, setExtractedPairs] = useState([]);
  const [tickets, setTickets] = useState([]); // holds either page (server-side) or all tickets (client-side)
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [useClientSidePagination, setUseClientSidePagination] = useState(false);
  const [totalTickets, setTotalTickets] = useState(0);
  const [editingTicket, setEditingTicket] = useState(null);
  const [viewTicket, setViewTicket] = useState(null);
  const [ticketToSubmit, setTicketToSubmit] = useState(null);

  const debouncedOcrText = useDebounce(ocrText, 500);
  const totalPages = Math.max(1, Math.ceil(totalTickets / pageSize));

function handleExtract(rawText) {
  if (!rawText) {
    setExtractedPairs([]);
    return;
  }

  // --- Pre-clean OCR noise ---
  rawText = rawText
    .replace(/[\|~]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\r?\n/g, '\n');

  const patterns = {
    ticket_no: /Ticket\s*(?:No\.?|#)?\s*[:\-]?\s*([\w\d\s]+)/i,
    manual: /MANUAL\s*[:\-]?\s*([FALSEfalse]+)/i,
    gnsw_truck_no: /GNSW\s*Truck\s*No\.?\s*[:\-]?\s*([A-Z0-9]+)/i,
    anpr: /ANPR\s*[:\-]?\s*([YESNOyesno]+)/i,
    wb_id: /(?:WB|Weighbridge)\s*Id\s*[:\-]?\s*(WB\d+)/i,
    consignee: /Consignee\s*[:\-]?\s*([\s\S]*?)(?=\s*Tare:|$)/i,
    operation: /Operation\s*[:\-]?\s*([A-Z]+)/i,
    consolidated: /Consolidated\s*[:\-]?\s*([YESNOyesno]+)/i,
    driver: /Driver\s*[:\-]?\s*([^\n\r]+)/i,
    truck_on_wb: /Truck\s*on\s*WB\s*[:\-]?\s*([\w\d]+)/i,
    gross: /Gross\s*[:\-]?\s*([\d\s\w,]+)/i,
    tare: /Tare:\s*\(PT\)\s*([\d,]+)\s*kg/i,
    net: /Net\s*[:\-]?\s*([\d,]+)\s*kg/i,
    sad_no: /SAD\s*No\.?\s*[:\-]?\s*(\d+)/i,
    container_no: /Container\s*(?:No\.?|#)?\s*[:\-]?\s*([\w\d]+)/i,
    material: /Material\s*[:\-]?\s*([^\n\r]+)/i,
    pass_number: /Pass\s*Number\s*[:\-]?\s*(\d*)/i,
    date: /(\d{1,2}-[A-Za-z]{3}-\d{2,4}\s+\d{1,2}:\d{2}:\d{2}\s*[AP]M)/i,
    scale_name: /Scale\s*Name\s*[:\-]?\s*([A-Z0-9]+)/i,
    operator: /Operator\s*[:\-]?\s*([^\n\r]+)/i,
    axles: /Axles\s*[:\-]?\s*([\d.,\s]+kg)/i,
  };

  const extractedPairs = [];

  for (const [key, regex] of Object.entries(patterns)) {
    let val;
    const match = rawText.match(regex);

    if (match && match[1]) {
      val = match[1].trim();

      // --- Clean up messy OCR for weights ---
    if (['gross', 'tare', 'net', 'weight'].includes(key)) {
  const numMatch = String(val).match(/[\d,.]+/);
  if (numMatch) val = parseFloat(numMatch[0].replace(/,/g, ''));
}

if (key === 'operator') {
  // Grab last word only, which should be the operator's name
  const parts = val.split(/\s+/);
  val = parts[parts.length - 1].trim();
}

extractedPairs.forEach(pair => {
  if (pair.key === 'scale_name') {
    pair.value = 'WBRIDGE1'; // override whatever was detected
  }
});

// Force manual to always be false
const manualIndex = extractedPairs.findIndex(p => p.key === 'manual');
if (manualIndex > -1) {
  extractedPairs[manualIndex].value = false;
} else {
  extractedPairs.push({ key: 'manual', value: false });
}

// After extracting all fields
const grossPair = extractedPairs.find(p => p.key === 'gross');
if (grossPair) {
  const weightPairIndex = extractedPairs.findIndex(p => p.key === 'weight');
  if (weightPairIndex > -1) {
    extractedPairs[weightPairIndex].value = grossPair.value;
  } else {
    extractedPairs.push({ key: 'weight', value: grossPair.value });
  }
}

      // --- Clean up ticket_no specifically ---
      if (key === 'ticket_no') {
        const fallback = rawText.match(/Ticket\s*(?:No\.?|#)?\s*[:\-]?\s*(.*)\nDate\s*Time/i);
        if (fallback && fallback[1]) {
          const numMatch = fallback[1].trim().match(/\d+/); // only first number
          if (numMatch) val = numMatch[0];
        }
      }

// --- Guaranteed Date extraction ---
if (!extractedPairs.find(p => p.key === 'date')) {
  const fallback = rawText.match(
    /Date\s*Time\s*[:\-]?\s*[\r\n]*\s*([\d]{1,2}-[A-Za-z]{3}-\d{2,4}\s+\d{1,2}:\d{2}:\d{2}\s*[AP]M)/i
  );
  if (fallback && fallback[1]) {
    extractedPairs.push({ key: 'date', value: fallback[1].trim() });
  }
}

      // --- Clean up driver specifically ---
      if (key === 'driver') {
        val = val.replace(/\s*Truck\s*on\s*WB:.*$/i, '').trim();
      }

      // --- Clean up messy OCR for other text fields ---
      if (['consignee', 'container_no', 'material', 'operator', 'scale_name', 'wb_id'].includes(key)) {
        val = String(val).split(/~~|\n/)[0].trim();
      }

      // Automatic numeric normalization
      const numericVal = val.toString().replace(/,/g, '').replace(/\s*kg/i, '').trim();
      if (!isNaN(numericVal) && numericVal !== '') val = parseFloat(numericVal);

      // Automatic boolean normalization
      const boolCandidate = val.toString().toUpperCase();
      if (['YES', 'NO'].includes(boolCandidate)) val = boolCandidate;

      if (val !== '') extractedPairs.push({ key, value: val });
    }

    // --- Fallbacks for critical fields ---
    if (!match || val === '' || val == null) {
      if (key === 'ticket_no') {
        const fallback = rawText.match(/Ticket\s*(?:No\.?|#)?\s*[:\-]?\s*(.*)\nDate\s*Time/i);
        if (fallback && fallback[1]) {
          const numMatch = fallback[1].trim().match(/\d+/);
          if (numMatch) extractedPairs.push({ key, value: numMatch[0] });
        }
      }
      if (key === 'driver') {
        const fallback = rawText.match(/Driver\s*[:\-]?\s*([^\n]+)/i);
        if (fallback && fallback[1]) extractedPairs.push({ key, value: fallback[1].trim().replace(/\s*Truck\s*on\s*WB:.*$/i, '') });
      }
    }
  }

  setExtractedPairs(extractedPairs);

  // Fully adaptive form filling
  const newFormData = { ...formData };
  extractedPairs.forEach(({ key, value }) => {
    newFormData[key] = value;
  });
  setFormData(newFormData);

  toast({
    title: 'Form populated from OCR',
    status: 'success',
    duration: 3000,
    isClosable: true,
  });
}

  // Initial empty form
  const EMPTY_FORM = {
    ticket_no: '',
    trailer_no: '',
    gnsw_truck_no: '',
    manual: '',
    anpr: '',
    wb_id: '',
    consignee: '',
    operation: '',
    consolidated: '',
    driver: '',
    truck_on_wb: '',
    gross: '',
    tare: '',
    net: '',
    total_weight: '',
    sad_no: '',
    container_no: '',
    material: '',
    pass_number: '',
    date: '',
    weight: '',
    scale_name: '',
    operator: '',
    axles: '',
  };

  const numericFields = ['gross', 'tare', 'net', 'weight', 'total_weight'];

  const normalizeEmpty = (val) => (val === '' || val === undefined || val === null ? null : val);

  const uploadFileToSupabase = async (file) => {
  if (!(file instanceof File)) {
    throw new Error("uploadFileToSupabase: file must be a File object");
  }

  // Generate unique file name
  const fileExt = file.name.split(".").pop();
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;
  const filePath = `uploads/${fileName}`;

  // Upload file to Supabase storage
  const { error: uploadError } = await supabase
    .storage
    .from("tickets")
    .upload(filePath, file, {
      cacheControl: "3600",
      upsert: false, // prevent overwriting existing files
    });

  if (uploadError) throw uploadError;

// Remove the erroneous insert here; file upload should not insert into "tickets"
// The actual ticket insert is handled in saveTicket

// No insert here; just upload file and return file info


    const { data: publicData } = supabase
      .storage
      .from('tickets')
      .getPublicUrl(filePath);

    // store file_path so it's easy to reference later
    return { file_name: filePath, file_url: publicData.publicUrl };
  };

  // ---------------------------
  // Helpers for numeric formatting and computing weights
  // ---------------------------
  const isNumeric = (v) => {
    if (v === '' || v === null || v === undefined) return false;
    return !Number.isNaN(Number(String(v).toString().replace(/,/g, '')));
  };

  const numericValue = (v) => {
    if (!isNumeric(v)) return null;
    return Number(String(v).toString().replace(/,/g, ''));
  };

  const formatNumber = (val) => {
    if (val === null || val === undefined || val === '') return '';
    const n = numericValue(val);
    if (n === null || Number.isNaN(n)) return String(val);
    if (Number.isInteger(n)) {
      return n.toLocaleString('en-US');
    }
    return Number(n.toFixed(2)).toLocaleString('en-US');
  };

  const computeWeightsFromObj = (obj) => {
    // accepts object with gross, tare, net (may be under alternate names)
    const rawGross = obj.gross ?? obj.gross_value ?? obj.total_weight ?? null;
    const rawTare = obj.tare ?? obj.tare ?? obj.tare_value ?? null;
    const rawNet = obj.net ?? obj.net ?? obj.net_value ?? null;

    let G = numericValue(rawGross);
    let T = numericValue(rawTare);
    let N = numericValue(rawNet);

    // compute missing field if two present
    if ((G === null || G === undefined) && T !== null && N !== null) {
      G = T + N;
    }
    if ((N === null || N === undefined) && G !== null && T !== null) {
      N = G - T;
    }
    if ((T === null || T === undefined) && G !== null && N !== null) {
      T = G - N;
    }

    return {
      grossValue: Number.isFinite(G) ? G : null,
      tareValue: Number.isFinite(T) ? T : null,
      netValue: Number.isFinite(N) ? N : null,
      grossDisplay: G === null || G === undefined ? '' : formatNumber(G),
      tareDisplay: T === null || T === undefined ? '' : formatNumber(T),
      netDisplay: N === null || N === undefined ? '' : formatNumber(N),
    };
  };

  // ---------------------------
  // Fetch tickets - supports both server-side and client-side pagination
  // ---------------------------
  const fetchTickets = useCallback(async () => {
    setLoadingTickets(true);
    try {
      if (useClientSidePagination) {
        // Fetch all tickets and page locally
        const { data, error } = await supabase
          .from("tickets")
          .select("*")
          .order("submitted_at", { ascending: false });

        if (error) {
          throw error;
        }
        const all = data || [];
        setTickets(all);
        setTotalTickets(all.length);
        // ensure current page is within bounds
        setCurrentPage((p) => {
          const tp = Math.max(1, Math.ceil(all.length / pageSize) || 1);
          return Math.min(p, tp);
        });
      } else {
        // Server-side pagination using range
        const start = (currentPage - 1) * pageSize;
        const end = currentPage * pageSize - 1;
        const { data, error, count } = await supabase
          .from("tickets")
          .select("*", { count: "exact" })
          .order("submitted_at", { ascending: false })
          .range(start, end);

        if (error) {
          throw error;
        }
        setTickets(data || []);
        setTotalTickets(count || 0);
      }
    } catch (err) {
      console.error("Error fetching tickets:", err);
      toast({
        title: "Error fetching tickets",
        description: err.message || String(err),
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setLoadingTickets(false);
    }
  }, [currentPage, pageSize, useClientSidePagination, toast]);

  // Fetch when relevant dependencies change
  useEffect(() => {
    fetchTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchTickets]);

  // When page size changes, reset to page 1 and refetch (both modes)
  useEffect(() => {
    setCurrentPage(1);
    fetchTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize, useClientSidePagination]);

  // displayedTickets: slice locally if using client-side pagination
  const displayedTickets = useClientSidePagination
    ? tickets.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    : tickets;

  // handle changing page size
  const handlePageSizeChange = (e) => {
    const newSize = Number(e.target.value);
    setPageSize(newSize);
  };

  // toggle pagination mode
  const handleTogglePaginationMode = (e) => {
    setUseClientSidePagination(e.target.checked);
    setCurrentPage(1);
  };

  // number buttons array
  const pageNumbers = [];
  for (let i = 1; i <= Math.max(1, Math.ceil(totalTickets / pageSize)); i++) {
    pageNumbers.push(i);
  }

  // Handle view ticket modal
  const handleView = (ticket) => {
    setViewTicket(ticket);
    onViewOpen();
  };

  const fieldLabels = {
    ticket_no: "Ticket No",
    gnsw_truck_no: "Truck No",
    driver: "Driver",
    sad_no: "SAD No",
    consignee: "Consignee",
    gross: "Gross Weight",
    tare: "Tare Weight",
    net: "Net Weight",
    status: "Status",
    date: "Date",
    file_url: "Attached PDF",
  };


  // ---------------------------
  // Save ticket (computes missing weights before insert and maps fields)
  // (kept unchanged — existing implementation)
  // ---------------------------

  const normalizeEmptyLocal = (val) => (val === '' || val === undefined || val === null ? null : val);

const saveTicket = async (data) => {
  // define submissionData right at the top
  const submissionData = { ...data };

  try {
    // --- Step 1: Upload PDF if exists ---
    if (ocrFile) {
      const { file_name, file_url } = await uploadFileToSupabase(
        ocrFile instanceof File ? ocrFile : new File([ocrFile], 'ticket.pdf', { type: 'application/pdf' })
      );
      submissionData.file_name = file_name;
      submissionData.file_url = file_url;
    } else {
      submissionData.file_name = null;
      submissionData.file_url = null;
    }

    // --- Step 2: Compute weights ---
    const computed = computeWeightsFromObj({
      gross: submissionData.gross,
      tare: submissionData.tare ?? submissionData.tare,
      net: submissionData.net ?? submissionData.net,
      weight: submissionData.weight,
    });

    submissionData.gross = computed.grossValue ?? normalizeEmptyLocal(submissionData.gross);
    submissionData.tare = computed.tareValue ?? normalizeEmptyLocal(submissionData.tare ?? submissionData.tare);
    submissionData.net = computed.netValue ?? normalizeEmptyLocal(submissionData.net ?? submissionData.net);

    submissionData.gross = normalizeEmptyLocal(submissionData.gross) ?? normalizeEmptyLocal(submissionData.weight);

    numericFields.forEach((field) => {
      let value = normalizeEmptyLocal(submissionData[field]);
      if (value !== null) {
        const num = Number(value);
        value = isNaN(num) ? null : num;
      }
      submissionData[field] = value;
    });

    const gross = submissionData.gross;
    const tare = submissionData.tare;
    submissionData.total_weight =
      typeof gross === "number" && typeof tare === "number" ? gross - tare : null;

    // --- Step 3: Insert into Supabase ---
    const { error } = await supabase.from("tickets").insert([submissionData]);

    if (error) {
      if (error.message?.toLowerCase().includes('tickets_ticket_no_key')) {
        toast({
          title: "Duplicate Ticket",
          description: "This Ticket has already been processed. Kindly upload a new one, or contact App Support Team.",
          status: "error",
          duration: 7000,
          isClosable: true,
        });
        return;
      }

      if (error.message?.toLowerCase().includes('row-level')) {
        throw new Error(`${error.message}. Check your RLS policy or insert using a service role key.`);
      }

      throw error;
    }

    // --- Step 4: Refresh & reset ---
    await fetchTickets();
    setFormData(EMPTY_FORM);
    setExtractedPairs([]);
    setOcrText('');
    setOcrFile(null);

    toast({
      title: "Ticket saved",
      description: "Your extracted ticket was saved successfully.",
      status: "success",
      duration: 3000,
      isClosable: true,
    });
  } catch (err) {
    toast({
      title: "Error saving ticket",
      description: err?.message || "An unexpected error occurred.",
      status: "error",
      duration: 7000,
      isClosable: true,
    });
  }
};


  const clearExtractedData = () => {
    setExtractedPairs([]);
    setOcrText('');
    setOcrFile(null);
  };

  // confirmation modal handlers (kept)
  const cancelRef = useRef();

  const handleSubmitClick = (data) => {
    setTicketToSubmit(data);
    onConfirmOpen();
  };

  const handleConfirmSubmit = async () => {
    onConfirmClose();
    if (ticketToSubmit) {
      await saveTicket(ticketToSubmit);
      setTicketToSubmit(null);
    }
  };

  const handleCancelSubmit = () => {
    setTicketToSubmit(null);
    onConfirmClose();
  };

  return (
    <Box p={6} maxWidth="1200px" mx="auto">
      <Heading mb={4} textAlign="center">
        OCR Ticket Reader
      </Heading>

      {/* OCR Extraction Section */}
      <OCRComponent
        onComplete={(file, text) => {
          setOcrFile(file);
          setOcrText(text || '');
          handleExtract(text || '');
        }}
      />

      {/* Controls: pagination mode and page size */}
      <Flex align="center" gap={4} mb={4} flexWrap="wrap">
        <HStack spacing={2}>
          <FormLabel htmlFor="client-side-switch" mb={0} fontSize="sm">Client-side pagination</FormLabel>
          <Switch id="client-side-switch" isChecked={useClientSidePagination} onChange={handleTogglePaginationMode} />
        </HStack>

        <FormControl maxW="160px">
          <FormLabel fontSize="sm" mb={1}>Page size</FormLabel>
          <Select value={pageSize} onChange={handlePageSizeChange} size="sm">
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={20}>20</option>
          </Select>
        </FormControl>

        <Box flex="1" />

        <Button colorScheme="blue" onClick={() => fetchTickets()} isLoading={loadingTickets} size="sm">
          Refresh
        </Button>
      </Flex>

      {/* Extracted Data Table */}
      {extractedPairs.length > 0 && (
        <Box mb={4}>
          <Heading size="md" mb={2}>
            Extracted Data
          </Heading>
          <Box
            maxHeight="200px"
            overflowY="auto"
            border="1px solid"
            borderColor="gray.200"
            borderRadius="md"
            p={2}
          >
            <Table size="sm" variant="striped">
              <Thead>
                <Tr>
                  <Th>Key</Th>
                  <Th>Value</Th>
                </Tr>
              </Thead>
              <Tbody>
                {extractedPairs.map(({ key, value }) => (
                  <Tr key={key}>
                    <Td>{key}</Td>
                    <Td>{value}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </Box>
          <Flex mt={2} gap={2}>
            <Button
              size="sm"
              colorScheme="blue"
              onClick={() =>
                handleSubmitClick({
                  ...formData,
                  ...Object.fromEntries(extractedPairs.map(({ key, value }) => [key, value])),
                })
              }
            >
              Submit Extracted Ticket
            </Button>
          </Flex>
        </Box>
      )}

      {/* PDF / Image Preview */}
      {ocrFile && (
        <Box mt={4}>
          <Heading size="md" mb={2}>
            Ticket Preview
          </Heading>
          {ocrFile.type === "application/pdf" ? (
            <embed
              src={URL.createObjectURL(ocrFile)}
              type="application/pdf"
              width="100%"
              height="400px"
            />
          ) : (
            <img
              src={URL.createObjectURL(ocrFile)}
              alt="Uploaded File"
              style={{ maxWidth: "100%", borderRadius: "6px", border: "1px solid #ccc" }}
            />
          )}
        </Box>
      )}

      {/* Confirmation Modal */}
      <Modal isOpen={isConfirmOpen} onClose={handleCancelSubmit} isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Confirm Submission</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            Kindly confirm if you would like to send this Ticket to Outgate.
          </ModalBody>
          <ModalFooter>
            <Button ref={cancelRef} onClick={handleCancelSubmit}>
              Cancel
            </Button>
            <Button colorScheme="red" ml={3} onClick={handleConfirmSubmit}>
              Confirm
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Tickets History Table */}
      <Box mt={8}>
        <Heading size="md" mb={3}>Processed Tickets</Heading>

        {loadingTickets ? (
          <Text>Loading tickets...</Text>
        ) : displayedTickets.length === 0 ? (
          <Text>No tickets found.</Text>
        ) : (
          <>
            <Table variant="striped" colorScheme="teal" size="sm">
              <Thead>
                <Tr>
                  <Th>Ticket No</Th>
                  <Th>Truck No</Th>
                  <Th>SAD No</Th>
                  <Th>Gross (KG)</Th>
                  <Th>Tare (KG)</Th>
                  <Th>Net (KG)</Th>
                  <Th>View</Th>
                </Tr>
              </Thead>
              <Tbody>
                {displayedTickets.map((t) => {
                  // compute values using possible field names from DB
                  const computed = computeWeightsFromObj({
                    gross: t.gross,
                    tare: t.tare ?? t.tare_pt ?? t.tare,
                    net: t.net ?? t.net_weight ?? t.net,
                  });

                  return (
                    <Tr key={t.id || t.ticket_id}>
                      <Td>{t.ticket_no}</Td>
                      <Td>{t.gnsw_truck_no}</Td>
                      <Td>{t.sad_no}</Td>
                      <Td>{computed.grossDisplay}</Td>
                      <Td>{computed.tareDisplay}</Td>
                      <Td>{computed.netDisplay}</Td>
                      <Td>
                        <IconButton
                          icon={<ViewIcon />}
                          aria-label={`View details of ticket ${t.ticket_no}`}
                          onClick={() => handleView(t)}
                          size="sm"
                          colorScheme="teal"
                        />
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>

            {/* Pagination controls */}
            <Flex justifyContent="space-between" alignItems="center" mt={4} gap={3} flexWrap="wrap">
              <Flex gap={2} align="center">
                <Button
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  isDisabled={currentPage === 1 || loadingTickets}
                >
                  Previous
                </Button>

                {/* Numbered page buttons */}
                <HStack spacing={1} ml={2}>
                  {pageNumbers.map((n) => (
                    <Button
                      key={n}
                      size="sm"
                      onClick={() => setCurrentPage(n)}
                      colorScheme={n === currentPage ? 'teal' : 'gray'}
                      variant={n === currentPage ? 'solid' : 'outline'}
                    >
                      {n}
                    </Button>
                  ))}
                </HStack>

                <Button
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  isDisabled={currentPage === totalPages || loadingTickets}
                >
                  Next
                </Button>
              </Flex>

              <Text>
                Page {currentPage} of {totalPages} ({totalTickets} tickets)
              </Text>

              <Box>
                <Text fontSize="sm" color="gray.600" textAlign="right">
                  {useClientSidePagination ? 'Client-side' : 'Server-side'} pagination
                </Text>
              </Box>
            </Flex>
          </>
        )}
      </Box>

      {/* View Ticket Modal */}
      <Modal isOpen={isViewOpen} onClose={onViewClose} size="lg" scrollBehavior="inside">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>View Ticket</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {viewTicket ? (
              <Box>
                <SimpleGrid columns={[1, 2]} spacing={4}>
                  {Object.entries(viewTicket).map(([key, value]) => {
                    if (!fieldLabels[key]) return null;

                    // Format weight fields for display and compute missing values
                    if (key === 'gross' || key === 'tare' || key === 'net' || key === 'total_weight') {
                      const computed = computeWeightsFromObj({
                        gross: viewTicket.gross,
                        tare: viewTicket.tare ?? viewTicket.tare_pt ?? viewTicket.tare,
                        net: viewTicket.net ?? viewTicket.net_weight ?? viewTicket.net,
                      });

                      let display = value;
                      if (key === 'gross') display = computed.grossDisplay;
                      if (key === 'tare') display = computed.tareDisplay;
                      if (key === 'net') display = computed.netDisplay;
                      if (key === 'total_weight') {
                        if (viewTicket.netValue !== undefined && viewTicket.netValue !== null) {
                          display = formatNumber(viewTicket.total_weight);
                        } else if (computed.grossValue !== null && computed.tareValue !== null) {
                          display = formatNumber(computed.grossValue - computed.tareValue);
                        } else {
                          display = '';
                        }
                      }

                      return (
                        <Box
                          key={key}
                          p={3}
                          borderWidth="1px"
                          borderRadius="md"
                          bg="gray.50"
                          boxShadow="sm"
                        >
                          <Text fontWeight="semibold" color="teal.600" mb={1}>
                            {fieldLabels[key]}
                          </Text>
                          {key === "file_url" && value ? (
                            <Button
                              as="a"
                              href={value}
                              target="_blank"
                              rel="noopener noreferrer"
                              colorScheme="teal"
                              size="sm"
                            >
                              Open PDF
                            </Button>
                          ) : (
                            <Text fontSize="md" color="gray.700">
                              {display !== null && display !== undefined && display !== '' ? display.toString() : 'N/A'}
                            </Text>
                          )}
                        </Box>
                      );
                    }

                    return (
                      <Box
                        key={key}
                        p={3}
                        borderWidth="1px"
                        borderRadius="md"
                        bg="gray.50"
                        boxShadow="sm"
                      >
                        <Text fontWeight="semibold" color="teal.600" mb={1}>
                          {fieldLabels[key]}
                        </Text>
                        {key === "file_url" && value ? (
                          <Button
                            as="a"
                            href={value}
                            target="_blank"
                            rel="noopener noreferrer"
                            colorScheme="teal"
                            size="sm"
                          >
                            Open PDF
                          </Button>
                        ) : (
                          <Text fontSize="md" color="gray.700">
                            {value !== null && value !== undefined && value !== '' ? value.toString() : 'N/A'}
                          </Text>
                        )}
                      </Box>
                    );
                  })}
                </SimpleGrid>
                <Box mt={6} p={3} borderTop="1px" borderColor="gray.200">
                  <Text fontWeight="bold" color="teal.600">
                    Submitted At:
                  </Text>
                  <Text>
                    {viewTicket.submitted_at ? new Date(viewTicket.submitted_at).toLocaleString() : 'N/A'}
                  </Text>
                </Box>
              </Box>
            ) : (
              <Text>No data to display.</Text>
            )}
          </ModalBody>
          <ModalFooter>
            <Button onClick={onViewClose}>Close</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

    </Box>
  );
}

export default WeighbridgeManagementPage;
