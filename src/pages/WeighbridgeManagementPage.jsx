// src/pages/WeighbridgeManagementPage.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box, Heading, Button, Input, FormControl, FormLabel, Table,
  Thead, Tbody, Tr, Th, Td, useToast, Modal, ModalOverlay,
  ModalContent, ModalHeader, ModalBody, ModalFooter, ModalCloseButton,
  useDisclosure, Text, SimpleGrid, IconButton, Flex, Select, Progress, Switch, HStack
} from '@chakra-ui/react';
import { ViewIcon, EditIcon, CheckIcon, CloseIcon } from '@chakra-ui/icons';

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
      let [, key, value] = match;
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


// --------------------------
// Condensed pagination helper (added)
// --------------------------
function getCondensedPages(current, total, edge = 1, around = 2) {
  // show first `edge`, last `edge`, and `around` pages around current
  const pages = new Set();
  for (let i = 1; i <= Math.min(edge, total); i++) pages.add(i);
  for (let i = Math.max(1, current - around); i <= Math.min(total, current + around); i++) pages.add(i);
  for (let i = Math.max(1, total - edge + 1); i <= total; i++) pages.add(i);
  const arr = Array.from(pages).sort((a,b) => a-b);

  const out = [];
  for (let i = 0; i < arr.length; i++) {
    if (i > 0 && arr[i] !== arr[i-1] + 1) out.push("...");
    out.push(arr[i]);
  }
  return out;
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
  const [editingTicket, setEditingTicket] = useState(null); // unused but retained
  const [viewTicket, setViewTicket] = useState(null);
  const [ticketToSubmit, setTicketToSubmit] = useState(null);

  // New state for inline editing of ticket_no
  const [editingTicketId, setEditingTicketId] = useState(null);
  const [editingTicketNo, setEditingTicketNo] = useState('');

  // New state for live search
  const [searchTicketNo, setSearchTicketNo] = useState('');
  const debouncedSearchTicket = useDebounce(searchTicketNo, 300);

  const debouncedOcrText = useDebounce(ocrText, 500);
  const totalPages = Math.max(1, Math.ceil(totalTickets / pageSize));

/**
 * Updated handleExtract: stricter label-first extraction with safer fallbacks,
 * numeric heuristics, and normalization (fixed to pick up ticket_no, correct scale,
 * avoid concatenated weight numbers, and keep driver/operator clean).
 */
function handleExtract(rawText) {
  if (!rawText) {
    setExtractedPairs([]);
    return;
  }

  // Normalize and split lines
  const lines = String(rawText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, " ")
    .replace(/\u00A0/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const full = lines.join("\n");
  const found = {};

  const onlyDigits = (s) => {
    const m = String(s || "").match(/\d+/);
    return m ? m[0] : null;
  };

  const extractLabelLine = (labelRegex) =>
    lines.find((l) => labelRegex.test(l)) || null;

  // Parse a sensible weight from a line:
  // - prefer the first 3-6 digit chunk (common for weights)
  // - return null if none found
  const parseWeightFromLine = (line) => {
    if (!line) return null;
    const matches = Array.from(line.matchAll(/\b(\d{3,6})\b/g)).map((m) => m[1]);
    if (matches.length === 0) return null;
    // Choose the first reasonable one (usually the first 3-6 digit number on the line)
    const num = Number(matches[0].replace(/,/g, ""));
    return Number.isFinite(num) ? num : null;
  };

  // Helper: find all distinct 3-6 digit numbers in doc (used for ticket fallback)
  const allSmallNumbers = () =>
    Array.from(full.matchAll(/\b(\d{3,6})\b/g)).map((m) => m[1]);

  // 1) Ticket No — look for many label variants (Ticket No, Ticket#, Tkt, Pass Number)
  const ticketLine =
    extractLabelLine(/\bTicket\s*(?:No\.?|#)?\b/i) ||
    extractLabelLine(/\bTkt\b/i) ||
    extractLabelLine(/\bTicket#\b/i) ||
    extractLabelLine(/\bPass\s*Number\b/i);

  if (ticketLine) {
    const m =
      ticketLine.match(/\b(?:Ticket|Tkt|Pass\s*Number)\s*(?:No\.?|#)?\s*[:\-]?\s*(\d{3,6})/i) ||
      ticketLine.match(/\b(\d{3,6})\b/);
    if (m && m[1]) {
      found.ticket_no = m[1];
    }
  }
  // fallback: prefer the first 4-6 digit number that is not SAD (we'll capture SAD later)
  if (!found.ticket_no) {
    const numbers = allSmallNumbers();
    if (numbers.length) {
      // We'll postpone final choice until we know SAD / weights; tentatively pick first:
      found._ticket_candidates = numbers;
    }
  }

  // 2) GNSW Truck No — prefer explicit label, else plate-like pattern
  const gnswLine =
    extractLabelLine(/GNSW\s*Truck\s*No/i) || extractLabelLine(/\bTruck\s*No\b/i);
  if (gnswLine) {
    const m =
      gnswLine.match(/GNSW\s*Truck\s*No\.?\s*[:\-]?\s*([A-Z0-9\-\/]{3,15})/i) ||
      gnswLine.match(/Truck\s*No\.?\s*[:\-]?\s*([A-Z0-9\-\/]{3,15})/i);
    if (m && m[1]) found.gnsw_truck_no = String(m[1]).trim().toUpperCase();
  } else {
    // fallback: plate-like pattern (letters+digits). Avoid picking pure numeric tokens.
    const plateMatch = full.match(/\b([A-Z]{1,3}\d{2,4}[A-Z]{0,2})\b/i);
    if (plateMatch && plateMatch[1]) {
      found.gnsw_truck_no = plateMatch[1].toUpperCase();
    }
  }

  // 3) Driver — label-first, strip leading dashes and trailing "Truck..." junk
  const driverLine = extractLabelLine(/\bDriver\b/i);
  if (driverLine) {
    let drv = driverLine.replace(/Driver\s*[:\-]?\s*/i, "").trim();
    drv = drv.replace(/^[-:]+/, "").trim();
    drv = drv.replace(/\bTruck\b.*$/i, "").trim();
    // remove parentheses content like (PT) etc
    drv = drv.replace(/\(.*?\)/g, "").trim();
    found.driver = drv || null;
  }

  // 4) Scale Name — explicit label else WBRIDGE\d fallback
  const scaleLine = extractLabelLine(/Scale\s*Name|ScaleName|Scale:/i);
  if (scaleLine) {
    const m = scaleLine.match(/Scale\s*Name\s*[:\-]?\s*([A-Z0-9\-_]+)/i) || scaleLine.match(/Scale\s*[:\-]?\s*([A-Z0-9\-_]+)/i);
    if (m && m[1]) {
      const cand = String(m[1]).toUpperCase();
      // ignore generic "WEIGHT" if possible — prefer WBRIDGE if present later
      if (!/WEIGHT/i.test(cand)) found.scale_name = cand;
      else found.scale_name = cand; // keep for now, may be overridden by WBRIDGE below
    }
  }
  if (!found.scale_name || /WEIGHT/i.test(found.scale_name)) {
    const wb = full.match(/\b(WBRIDGE\d+)\b/i);
    if (wb && wb[1]) found.scale_name = wb[1].toUpperCase();
  }

  // 5) Gross / Tare / Net — strict label parsing; parse only 3-6 digit groups per line
  const grossLine = extractLabelLine(/\bGross\b/i);
  if (grossLine) found.gross = parseWeightFromLine(grossLine);

  const tareLine = extractLabelLine(/\bTare\b/i);
  if (tareLine) found.tare = parseWeightFromLine(tareLine);
  else {
    // sometimes "Tare: (PT) 20740 kg" sits on same line as consignee — check full
    const mt = full.match(/Tare\s*[:\-]?\s*(?:\([A-Za-z]+\)\s*)?(\d{3,6})/i);
    if (mt && mt[1]) found.tare = Number(mt[1]);
  }

  const netLine = extractLabelLine(/\bNet\b/i);
  if (netLine) found.net = parseWeightFromLine(netLine);
  else {
    const mn = full.match(/Net\s*[:\-]?\s*(\d{3,6})/i);
    if (mn && mn[1]) found.net = Number(mn[1]);
  }

  // 6) SAD No
  const sadLine = extractLabelLine(/\bSAD\b.*\bNo\b/i) || extractLabelLine(/\bSAD\b/i);
  if (sadLine) {
    const m = sadLine.match(/SAD\s*No\.?\s*[:\-]?\s*(\d{3,6})/i) || sadLine.match(/SAD\s*[:\-]?\s*(\d{3,6})/i);
    if (m && m[1]) found.sad_no = m[1];
  } else {
    const sadFb = full.match(/\bSAD\s*No\.?\s*[:\-]?\s*(\d{3,6})/i) || full.match(/\bSAD\s*[:\-]?\s*(\d{3,6})/i);
    if (sadFb && sadFb[1]) found.sad_no = sadFb[1];
  }

  // 7) Container / Consignee / Material
  const containerLine = extractLabelLine(/\bContainer\b/i) || extractLabelLine(/\bContainer\s*No\b/i);
  if (containerLine) {
    const m = containerLine.match(/Container\s*(?:No\.?|#)?\s*[:\-]?\s*([A-Z0-9\-]+)/i);
    if (m && m[1]) found.container_no = String(m[1]).trim();
  } else {
    // fallback: look for known tokens like BULK on its own line
    const bulkLine = lines.find((l) => /\bBULK\b/i.test(l));
    if (bulkLine) found.container_no = "BULK";
  }

  const consigneeLine = extractLabelLine(/Consignee\b/i);
  if (consigneeLine) {
    let c = consigneeLine.replace(/Consignee\s*[:\-]?\s*/i, "").trim();
    c = c.split(/\bTare\b/i)[0].trim();
    c = c.replace(/\b\d{3,6}\s*kg\b/i, "").trim();
    found.consignee = c || null;
  }

  const materialLine = extractLabelLine(/Material\b/i);
  if (materialLine) {
    const m = materialLine.match(/Material\s*[:\-]?\s*(.+)/i);
    if (m && m[1]) found.material = m[1].trim();
  }

  // 8) WB ID
  const wbIdLine = extractLabelLine(/\bWB\s*(?:Id|ID)\b/i);
  if (wbIdLine) {
    const m = wbIdLine.match(/\b(WB\d{1,9})\b/i);
    if (m && m[1]) found.wb_id = m[1].toUpperCase();
  }

  // 9) Date
  const dateMatch = full.match(
    /(\d{1,2}-[A-Za-z]{3}-\d{2,4}\s+\d{1,2}:\d{2}:\d{2}\s*[AP]M)/i
  );
  if (dateMatch && dateMatch[1]) found.date = dateMatch[1].trim();

  // 10) Operator — prefer label; if label present but no clean name afterwards, fall back to literal "Operator"
  const opLine = extractLabelLine(/\bOperator\b/i);
  if (opLine) {
    let op = opLine.replace(/Operator\s*[:\-]?\s*/i, "").trim();
    // strip timestamps / WB / weight tokens and boolean flags
    op = op.replace(/\d{1,2}-[A-Za-z]{3}-\d{2,4}/g, "");
    op = op.replace(/\d{1,2}:\d{2}:\d{2}\s*[AP]M/gi, "");
    op = op.replace(/\bWBRIDGE\d+\b/gi, "");
    op = op.replace(/\b\d{3,6}\s*kg\b/gi, "");
    op = op.replace(/\b(true|false)\b/ig, "");
    op = op.replace(/\b(Pass|Number|Date|Scale|Weight|Manual)\b.*$/i, "").trim();
    if (op) {
      const opMatch = op.match(/[A-Za-z][A-Za-z\.\s'\-]{0,40}/);
      found.operator = opMatch ? opMatch[0].trim() : op;
    } else {
      // label existed but no clear name — keep the label as placeholder
      found.operator = "Operator";
    }
  }

  // --- Post-processing heuristics ---

  // If we have tare AND net, compute gross = tare + net (this is the most reliable)
  if (Number.isFinite(found.tare) && Number.isFinite(found.net)) {
    found.gross = Number(found.tare) + Number(found.net);
  } else {
    // If gross is parsed but extremely large or clearly concatenated ( > 1e6 ), discard it
    if (found.gross && Number(found.gross) > 1_000_000) {
      found.gross = null;
    }
  }

  // If ticket_no not set, pick a candidate from small numbers that isn't SAD or weights or WB id
  if (!found.ticket_no && found._ticket_candidates && found._ticket_candidates.length) {
    const exclude = new Set([
      String(found.sad_no || ""),
      String(found.tare || ""),
      String(found.net || ""),
      String(found.gross || ""),
      (found.wb_id || "").replace(/^WB/i, ""),
    ].filter(Boolean));

    // Refined fallback:
    // - Exclude candidates that are equal to known fields (SAD/weights/WB)
    // - Exclude candidates that appear inside a "Print Date" / "Date Time" line
    // - Exclude candidates that occur inside the parsed date substring (if present)
    // - Exclude time-like fragments (hhmm or hhmmss)
    // - Prefer 5-digit candidates (typical ticket numbers)
    const candidate = found._ticket_candidates.find((n) => {
      // Exclude SAD/weights/WB
      if (exclude.has(n)) return false;

      // Exclude if number appears inside a Print Date / Date Time line
      const badLine = lines.find((l) => /Print\s*Date|Date\s*Time/i.test(l) && l.includes(n));
      if (badLine) return false;

      // Exclude numbers that are clearly part of the parsed date substring
      if (found.date) {
        const dateIdx = full.indexOf(found.date);
        if (dateIdx >= 0) {
          let pos = full.indexOf(n, 0);
          while (pos !== -1) {
            if (pos >= dateIdx && pos < dateIdx + found.date.length) return false;
            pos = full.indexOf(n, pos + 1);
          }
        }
      }

      // Exclude numbers that look like time-only values (hhmm or hhmmss)
      if (/^(?:[01]?\d|2[0-3])[0-5]\d(?:[0-5]\d)?$/.test(n)) return false;

      // Prefer 5-digit ticket numbers — reject other lengths
      if (!/^\d{5}$/.test(n)) return false;

      return true;
    });

    if (candidate) found.ticket_no = candidate;
    delete found._ticket_candidates;
  }

  // Normalize: ticket numeric-only
  if (found.ticket_no) found.ticket_no = onlyDigits(found.ticket_no);

  // Normalize scale_name uppercase & avoid noisy "WEIGHT" if we found a valid WBRIDGE
  if (found.scale_name) {
    const s = String(found.scale_name).toUpperCase();
    if (/WEIGHT/i.test(s) && full.match(/\b(WBRIDGE\d+)\b/i)) {
      const wb = full.match(/\b(WBRIDGE\d+)\b/i);
      if (wb && wb[1]) found.scale_name = wb[1].toUpperCase();
      else found.scale_name = s;
    } else {
      found.scale_name = s;
    }
  }

  // Trim and remove stray leading characters from driver
  if (found.driver) {
    found.driver = String(found.driver).replace(/^[-:\s]+/, "").trim();
    if (found.driver === "") found.driver = null;
  }

  // Ensure weights are numbers or null
  ["gross", "tare", "net"].forEach((k) => {
    if (found[k] !== undefined && found[k] !== null) {
      const n = Number(found[k]);
      found[k] = Number.isFinite(n) ? n : null;
    } else {
      found[k] = null;
    }
  });

  // Build ordered pairs for UI
  const orderedKeys = [
    "ticket_no",
    "gnsw_truck_no",
    "container_no",
    "driver",
    "scale_name",
    "gross",
    "tare",
    "net",
    "sad_no",
    "consignee",
    "material",
    "date",
    "operator",
    "wb_id",
  ];

  const pairs = [];
  orderedKeys.forEach((k) => {
    if (found[k] !== undefined && found[k] !== null) pairs.push({ key: k, value: found[k] });
  });

  // Set state
  setExtractedPairs(pairs);

  // Merge into formData only if empty
  const nextForm = { ...formData };
  pairs.forEach(({ key, value }) => {
    const existing = nextForm[key];
    const isEmpty = existing === null || existing === undefined || existing === "" || existing === false;
    if (isEmpty) nextForm[key] = value;
  });
  setFormData(nextForm);

  toast({
    title: "Form populated from OCR",
    description: "Fields cleaned and normalized where possible.",
    status: "success",
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
      const search = String(debouncedSearchTicket || '').trim();

      if (useClientSidePagination) {
        // Fetch all tickets and page locally, then apply search filter locally
        const { data, error } = await supabase
          .from("tickets")
          .select("*")
          .order("submitted_at", { ascending: false });

        if (error) {
          throw error;
        }
        const all = data || [];

        // apply local search filter if provided
        const filtered = search
          ? all.filter((t) => String(t.ticket_no ?? '').toLowerCase().includes(search.toLowerCase()))
          : all;

        setTickets(filtered);
        setTotalTickets(filtered.length);
        // ensure current page is within bounds
        setCurrentPage((p) => {
          const tp = Math.max(1, Math.ceil(filtered.length / pageSize) || 1);
          return Math.min(p, tp);
        });
      } else {
        // Server-side pagination using range, with optional search filter
        const start = (currentPage - 1) * pageSize;
        const end = currentPage * pageSize - 1;

        let query = supabase
          .from("tickets")
          .select("*", { count: "exact" });

        if (search) {
          // Use ilike for case-insensitive partial match
          query = query.ilike("ticket_no", `%${search}%`);
        }

        // apply ordering and range after filters
        const { data, error, count } = await query
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
  }, [currentPage, pageSize, useClientSidePagination, toast, debouncedSearchTicket]);

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

  // number buttons array (left for compatibility; not used in condensed UI)
  const pageNumbers = [];
  for (let i = 1; i <= Math.max(1, Math.ceil(totalTickets / pageSize)); i++) {
    pageNumbers.push(i);
  }

  // condensed pagination items (added)
  const pageItems = getCondensedPages(currentPage, totalPages);

  // simple click handler for condensed buttons
  const handlePageClick = (n) => {
    if (n === "...") return;
    setCurrentPage(n);
  };

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


  // Inline-edit helpers for ticket_no
  const startEditingTicketNo = (ticket) => {
    const idValue = ticket.id ?? ticket.ticket_id;
    setEditingTicketId(idValue);
    setEditingTicketNo(ticket.ticket_no ?? '');
  };

  const cancelEditingTicketNo = () => {
    setEditingTicketId(null);
    setEditingTicketNo('');
  };

  const saveEditingTicketNo = async (ticket) => {
    const idField = ticket.id ? 'id' : 'ticket_id';
    const idValue = ticket.id ?? ticket.ticket_id;
    try {
      const { error } = await supabase
        .from('tickets')
        .update({ ticket_no: editingTicketNo })
        .eq(idField, idValue);

      if (error) throw error;

      toast({
        title: "Ticket updated",
        description: `Ticket No updated successfully to ${editingTicketNo}`,
        status: "success",
        duration: 3000,
        isClosable: true,
      });

      // Refresh the list (server or client mode)
      await fetchTickets();

      cancelEditingTicketNo();
    } catch (err) {
      toast({
        title: "Update failed",
        description: err?.message || "Could not update ticket number.",
        status: "error",
        duration: 5000,
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

        <FormControl maxW="160px">
          <FormLabel fontSize="sm" mb={1}>Page size</FormLabel>
          <Select value={pageSize} onChange={handlePageSizeChange} size="sm">
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={20}>20</option>
          </Select>
        </FormControl>

        {/* Search input for live Ticket Number search */}
        <FormControl maxW="240px">
          <FormLabel fontSize="sm" mb={1}>Search Here!</FormLabel>
          <HStack>
            <Input
              placeholder="Search by Ticket Number"
              size="sm"
              value={searchTicketNo}
              onChange={(e) => setSearchTicketNo(e.target.value)}
            />
            <IconButton
              aria-label="Clear search"
              size="sm"
              icon={<CloseIcon />}
              onClick={async () => {
                if (!searchTicketNo) return;
                setSearchTicketNo('');
                setCurrentPage(1);
                await fetchTickets();
              }}
            />
          </HStack>
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
                    <Td>{value?.toString?.() ?? String(value)}</Td>
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
            <Button size="sm" variant="outline" onClick={clearExtractedData}>Clear</Button>
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

                  const rowId = t.id ?? t.ticket_id;

                  return (
                    <Tr key={rowId}>
                      <Td>
                        {editingTicketId === rowId ? (
                          <HStack spacing={2}>
                            <Input
                              size="sm"
                              value={editingTicketNo}
                              onChange={(e) => setEditingTicketNo(e.target.value)}
                              width="120px"
                            />
                            <IconButton
                              size="sm"
                              colorScheme="green"
                              icon={<CheckIcon />}
                              aria-label="Save ticket no"
                              onClick={() => saveEditingTicketNo(t)}
                            />
                            <IconButton
                              size="sm"
                              colorScheme="red"
                              icon={<CloseIcon />}
                              aria-label="Cancel edit"
                              onClick={cancelEditingTicketNo}
                            />
                          </HStack>
                        ) : (
                          <HStack spacing={2}>
                            <Text>{t.ticket_no ?? '-'}</Text>
                            <IconButton
                              size="sm"
                              icon={<EditIcon />}
                              aria-label="Edit Ticket No"
                              onClick={() => startEditingTicketNo(t)}
                            />
                          </HStack>
                        )}
                      </Td>
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

            {/* Pagination controls - responsive */}
            <Flex justifyContent="space-between" alignItems="center" mt={4} gap={3} flexWrap="wrap">
              <Flex gap={2} align="center" flexWrap="wrap">
                <Button
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  isDisabled={currentPage === 1 || loadingTickets}
                >
                  Previous
                </Button>

                {/* Condensed numbered page buttons */}
                <HStack spacing={1} ml={2} wrap="wrap">
                  {pageItems.map((it, idx) => (
                    <Button
                      key={`${it}-${idx}`}
                      size="sm"
                      onClick={() => handlePageClick(it)}
                      colorScheme={it === currentPage ? 'teal' : 'gray'}
                      variant={it === currentPage ? 'solid' : 'outline'}
                      isDisabled={it === "..."}
                    >
                      {it}
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
