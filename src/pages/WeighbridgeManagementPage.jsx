// src/pages/WeighbridgeManagementPage.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box, Heading, Button, Input, FormControl, FormLabel, Table,
  Thead, Tbody, Tr, Th, Td, useToast, Modal, ModalOverlay,
  ModalContent, ModalHeader, ModalBody, ModalFooter, ModalCloseButton,
  useDisclosure, Text, SimpleGrid, IconButton, Flex, Select, Progress, HStack,
  useColorModeValue, Badge, Grid, Spacer, Avatar, Divider, VStack as VStack2, Tooltip,
} from "@chakra-ui/react";
import {
  ViewIcon, EditIcon, CheckIcon, CloseIcon, InfoOutlineIcon,
} from "@chakra-ui/icons";
import { motion, AnimatePresence } from "framer-motion";
import confetti from "canvas-confetti";

import { supabase } from "../supabaseClient";
import Tesseract from "tesseract.js";
import { pdfPageToBlobPdfjs } from "../utils/pdfUtils";

// ------------------------ Constants ------------------------
const VOICE_CONFIDENCE_THRESHOLD = 0.28;
const DEFAULT_PAGE_SIZE = 5;
const ORB_SIZE = 72;

// ------------------------ Helpers ------------------------
export function generateTicketId(existingIds = []) {
  const prefix = "TICKET-";
  const s = new Set(existingIds);
  let i = 1;
  while (s.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

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

function useDebounce(value, delay) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

function getCondensedPages(current, total, edge = 1, around = 2) {
  const pages = new Set();
  for (let i = 1; i <= Math.min(edge, total); i++) pages.add(i);
  for (let i = Math.max(1, current - around); i <= Math.min(total, current + around); i++) pages.add(i);
  for (let i = Math.max(1, total - edge + 1); i <= total; i++) pages.add(i);
  const arr = Array.from(pages).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    if (i > 0 && arr[i] !== arr[i - 1] + 1) out.push("...");
    out.push(arr[i]);
  }
  return out;
}

// Numeric helpers
const isNumeric = (v) => {
  if (v === '' || v === null || v === undefined) return false;
  const n = Number(String(v).replace(/,/g, ""));
  return !Number.isNaN(n);
};
const numericValue = (v) => {
  if (!isNumeric(v)) return null;
  return Number(String(v).replace(/,/g, ""));
};
const formatNumber = (val) => {
  if (val === null || val === undefined || val === '') return '';
  const n = numericValue(val);
  if (n === null || Number.isNaN(n)) return String(val);
  if (Number.isInteger(n)) return n.toLocaleString('en-US');
  return Number(n.toFixed(2)).toLocaleString('en-US');
};
const computeWeightsFromObj = (obj) => {
  const rawGross = obj.gross ?? obj.total_weight ?? null;
  const rawTare = obj.tare ?? null;
  const rawNet = obj.net ?? null;
  let G = numericValue(rawGross);
  let T = numericValue(rawTare);
  let N = numericValue(rawNet);
  if ((G === null || G === undefined) && T !== null && N !== null) G = T + N;
  if ((N === null || N === undefined) && G !== null && T !== null) N = G - T;
  if ((T === null || T === undefined) && G !== null && N !== null) T = G - N;
  return {
    grossValue: Number.isFinite(G) ? G : null,
    tareValue: Number.isFinite(T) ? T : null,
    netValue: Number.isFinite(N) ? N : null,
    grossDisplay: G === null ? '' : formatNumber(G),
    tareDisplay: T === null ? '' : formatNumber(T),
    netDisplay: N === null ? '' : formatNumber(N),
  };
};

// tokens to exclude from ticket candidates
const JUNK_TOKENS = new Set(['print', 'printdate', 'print date', 'no', 'unknown', 'operator', 'auto', '?', '-', 'n/a']);
function isJunkToken(tok) {
  if (!tok) return true;
  const s = String(tok).trim().toLowerCase();
  if (!s) return true;
  if (JUNK_TOKENS.has(s)) return true;
  if (/^[A-Za-z]$/.test(s)) return true;
  if (/^(net|gross|tare|weight|date|time|pass|sad|container|consignee)$/i.test(s)) return true;
  if (/^0+$/.test(s)) return true;
  return false;
}

// normalize ticket number to digits-only, remove commas, anything like "Ticket No.: 52512" -> "52512"
function normalizeTicketFormat(val) {
  if (!val && val !== 0) return "";
  const s = String(val);
  const digits = (s.match(/\d+/g) || []).join("");
  if (digits) return digits.replace(/^0+/, "") || "0";
  // fallback: remove any non word/dash
  return s.replace(/[^\w-]/g, "");
}

// ------------------------ Empty form ------------------------
const EMPTY_FORM = {
  ticket_no: '',
  gnsw_truck_no: '',
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
  date: '',
  weight: '',
  operator: '',
};

// ------------------------ OCRComponent ------------------------
export function OCRComponent({ onComplete }) {
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  const handleFileChange = (e) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setProgress(0);
    onComplete?.(null, null);
  };

  const trimTextBeforeNotes = (text) => {
    const idx = (text || "").toLowerCase().indexOf("note");
    return idx !== -1 ? text.substring(0, idx).trim() : text.trim();
  };

  const handleOCR = async () => {
    if (!file) return alert("Please upload a file first");
    setLoading(true);
    setProgress(2);
    try {
      let ocrFile = file;
      if (file.type === "application/pdf") {
        ocrFile = await pdfPageToBlobPdfjs(file);
      }
      const result = await Tesseract.recognize(ocrFile, 'eng', {
        logger: (m) => { if (m.status === 'recognizing text' && m.progress) setProgress(Math.round(m.progress * 100)); }
      });
      setProgress(100);
      const trimmed = trimTextBeforeNotes(result.data?.text || "");
      onComplete?.(file, trimmed);
    } catch (err) {
      console.error("Ticket Reader error", err);
      alert("Extraction failed: " + (err.message || err));
      onComplete?.(file, null);
    } finally {
      setLoading(false);
    }
  };

  const clear = () => {
    setFile(null);
    setProgress(0);
    if (inputRef.current) inputRef.current.value = "";
    onComplete?.(null, null);
  };

  return (
    <Box border="1px" borderColor="gray.700" borderRadius="12px" p={4} mb={4} bg="rgba(255,255,255,0.02)" style={{ backdropFilter: "blur(6px)" }}>
      <FormControl>
        <FormLabel>Upload image or PDF</FormLabel>
        <Input type="file" accept="image/*,application/pdf" onChange={handleFileChange} ref={inputRef} />
      </FormControl>
      <HStack mt={3}>
        <Button onClick={handleOCR} isLoading={loading} size="sm" colorScheme="teal">Run Ticket Reader</Button>
        <Button onClick={clear} size="sm" variant="ghost">Clear</Button>
        <Box flex="1" />
        <Text fontSize="sm" color="black.300">Extraction Progress: {progress}%</Text>
      </HStack>
      <Progress mt={3} value={progress} size="xs" />
    </Box>
  );
}

// ------------------------ Candidate generation with confidence ------------------------
function generateTicketCandidates(rawText = '', found = {}) {
  // returns ordered array of objects: { value, confidence, reason }
  if (!rawText) return [];
  const lines = String(rawText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, " ")
    .replace(/\u00A0/g, " ")
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);

  const full = lines.join("\n");
  const seen = new Set();
  const candidates = [];

  const pushCandidate = (value, confidence = 0.5, reason = '') => {
    if (!value) return;
    let v = String(value).trim().replace(/[:.,;]+$/g, "");
    if (!v) return;
    if (isJunkToken(v)) return;
    // normalize display value (but keep original if alnum+)
    v = v.replace(/[^\w-]/g, "");
    if (seen.has(v)) return;
    seen.add(v);
    candidates.push({ value: v, confidence: Math.max(0, Math.min(1, confidence)), reason });
  };

  // 1) Patterns labeled explicitly (high confidence)
  const labelRegex = /\b(?:Ticket|Tkt|Ticket#|Pass(?:\sNumber)?|Pass No|Pass#)\b[^\n]*[:#\-\s]\s*([A-Z0-9-]{3,20})/i;
  for (const ln of lines) {
    const m = ln.match(labelRegex);
    if (m && m[1]) {
      const cand = m[1].trim().replace(/[^A-Z0-9-]/ig, "");
      pushCandidate(cand, 0.95, 'labeled');
    }
  }

  // 2) Context lines that mention ticket/tkt/pass and contain a token (good confidence)
  for (const ln of lines) {
    if (/\b(ticket|tkt|pass)\b/i.test(ln)) {
      const afterMatch = ln.match(/\b(?:ticket|tkt|pass(?:\snumber)?)(?:[:#\-\s]{0,4})([A-Z0-9-]{3,20})\b/i);
      if (afterMatch && afterMatch[1]) {
        const cand = afterMatch[1].trim().replace(/[^A-Z0-9-]/ig, "");
        pushCandidate(cand, 0.88, 'context-labeled');
      }
      const num = ln.match(/\b(\d{4,8})\b/);
      if (num && num[1]) pushCandidate(num[1], 0.78, 'context-numeric');
    }
  }

  // 3) Inline TICKET-123 patterns
  const inlineMatches = Array.from(full.matchAll(/\b[Tt]icket[-\s]*[:#]?([A-Z0-9-]{3,20})\b/g));
  for (const im of inlineMatches) {
    if (im[1]) {
      const cand = im[1].trim().replace(/[^A-Z0-9-]/ig, "");
      pushCandidate(cand, 0.9, 'inline');
    }
  }

  // 4) Numeric fallbacks: prefer 5-digit numbers, then 4-6 digits (lower confidence)
  const allNums = Array.from(full.matchAll(/\b(\d{3,8})\b/g)).map(m => m[1]);
  const excludeSet = new Set([
    String(found.sad_no || ""),
    String(found.tare || ""),
    String(found.net || ""),
    String(found.gross || ""),
    (found.wb_id || "").replace(/^WB/i, ""),
  ].filter(Boolean).map(x => String(x)));
  for (const n of allNums) {
    if (excludeSet.has(n)) continue;
    if (/^(?:[01]?\d|2[0-3])[0-5]\d(?:[0-5]\d)?$/.test(n)) continue;
    if (/^\d{5}$/.test(n)) pushCandidate(n, 0.85, '5-digit');
  }
  for (const n of allNums) {
    if (excludeSet.has(n)) continue;
    if (/^(?:[01]?\d|2[0-3])[0-5]\d(?:[0-5]\d)?$/.test(n)) continue;
    if (/^\d{4,6}$/.test(n)) pushCandidate(n, 0.72, '4-6-digit');
  }

  // 5) Any short alnum token 3-12 chars that isn't junk (very low confidence)
  const anyTokens = Array.from(full.matchAll(/\b([A-Z0-9-]{3,12})\b/ig)).map(m => m[1]);
  for (const t of anyTokens) {
    pushCandidate(t, 0.45, 'token-fallback');
  }

  // Final: sort by confidence desc, then length desc (prefer longer clearer tokens)
  candidates.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.value.length - a.value.length;
  });

  // return top 8
  return candidates.slice(0, 8);
}

// ------------------------ Main Component ------------------------
function WeighbridgeManagementPage() {
  const toast = useToast();

  // Top-level color-mode values
  const gradientBg = useColorModeValue(
    "linear-gradient(135deg, rgba(12,102,124,0.08), rgba(88,24,139,0.06))",
    "linear-gradient(135deg, rgba(12,102,124,0.06), rgba(88,24,139,0.12))"
  );
  const cardBg = useColorModeValue("whiteAlpha.800", "whiteAlpha.030");
  const textColor = useColorModeValue("gray.800", "gray.100");
  const neonBorder = useColorModeValue("rgba(12,102,124,0.18)", "rgba(88,24,139,0.25)");
  const panelBg = useColorModeValue("rgba(255,255,255,0.02)", "rgba(0,0,0,0.24)");

  // Modal disclosures
  const { isOpen: isViewOpen, onOpen: onViewOpen, onClose: onViewClose } = useDisclosure();
  const { isOpen: isConfirmOpen, onOpen: onConfirmOpen, onClose: onConfirmClose } = useDisclosure();
  const { isOpen: isOrbOpen, onOpen: onOrbOpen, onClose: onOrbClose } = useDisclosure();

  // Data state
  const [formData, setFormData] = useState({ ...EMPTY_FORM });
  const [ocrFile, setOcrFile] = useState(null);
  const [ocrText, setOcrText] = useState("");
  const [extractedPairs, setExtractedPairs] = useState([]); // array of { key, value, confidence }
  const [tickets, setTickets] = useState([]);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [useClientSidePagination] = useState(false);
  const [totalTickets, setTotalTickets] = useState(0);
  const [viewTicket, setViewTicket] = useState(null);
  const [ticketToSubmit, setTicketToSubmit] = useState(null);

  // ticket candidates & verify UI state (now objects with confidence/reason)
  const [ticketCandidates, setTicketCandidates] = useState([]); // [{value, confidence, reason}]
  const [selectedTicketCandidate, setSelectedTicketCandidate] = useState("");

  // inline editing
  const [editingRowId, setEditingRowId] = useState(null);
  const [editFormData, setEditFormData] = useState({});

  // search & debounce
  const [searchTicketNo, setSearchTicketNo] = useState("");
  const debouncedSearchTicket = useDebounce(searchTicketNo, 300);

  // responsive states
  const [isWide3D, setIsWide3D] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mqWide = window.matchMedia("(min-width: 1600px)");
    const handleWide = (e) => setIsWide3D(e.matches);
    setIsWide3D(mqWide.matches);
    mqWide.addEventListener?.("change", handleWide);
    const mqMobile = window.matchMedia("(max-width: 900px)");
    const handleMobile = (e) => setIsMobile(e.matches);
    setIsMobile(mqMobile.matches);
    mqMobile.addEventListener?.("change", handleMobile);

    return () => {
      try { mqWide.removeEventListener?.("change", handleWide); } catch {}
      try { mqMobile.removeEventListener?.("change", handleMobile); } catch {}
    };
  }, []);

  const totalPages = Math.max(1, Math.ceil(totalTickets / pageSize));
  const pageItems = useMemo(() => getCondensedPages(currentPage, totalPages), [currentPage, totalPages]);

  // -----------------------
  // Helper: sanitize time tokens inside a date string to avoid out-of-range values
  // - clamps minutes/seconds to 0-59
  // - clamps hours to 0-23 (24h) or 1-12 (12h with AM/PM)
  // - supports formats like "11:63:00 PM", "2025-11-07 25:05:00", "9:5:3 AM", "11:63 PM"
  // -----------------------
  function sanitizeTimeInDateString(s) {
    if (!s || typeof s !== "string") return s;
    let out = String(s);

    // Normalize common separators and excessive spaces
    out = out.replace(/\s+/g, " ").trim();

    // 1) HH:MM:SS [AM|PM] or H:MM:SSAM (with optional space)
    out = out.replace(/(\b\d{1,2}):(\d{1,2}):(\d{1,2})(\s*[AP]M\b)?/gi, (m, hh, mm, ss, ampmRaw) => {
      const ampm = ampmRaw ? ampmRaw.trim().toUpperCase() : "";
      let H = parseInt(hh, 10);
      let M = parseInt(mm, 10);
      let S = parseInt(ss, 10);

      // clamp seconds/minutes
      if (!Number.isFinite(S) || S < 0) S = 0;
      if (S > 59) S = 59;
      if (!Number.isFinite(M) || M < 0) M = 0;
      if (M > 59) M = 59;

      if (ampm) {
        // 12-hour clock: clamp to 1..12
        if (!Number.isFinite(H) || H < 1) H = 1;
        if (H > 12) H = ((H - 1) % 12) + 1;
        if (H < 1) H = 1;
      } else {
        // 24-hour clock: clamp to 0..23
        if (!Number.isFinite(H) || H < 0) H = 0;
        if (H > 23) H = 23;
      }

      const hh2 = String(H).padStart(2, "0");
      const mm2 = String(M).padStart(2, "0");
      const ss2 = String(S).padStart(2, "0");
      return `${hh2}:${mm2}:${ss2}${ampm ? " " + ampm : ""}`;
    });

    // 2) HH:MM [AM|PM] (no seconds)
    out = out.replace(/(\b\d{1,2}):(\d{1,2})(\s*[AP]M\b)?/gi, (m, hh, mm, ampmRaw) => {
      // Avoid reprocessing HH:MM:SS matches (they've been normalized above)
      if (/\d{1,2}:\d{1,2}:\d{1,2}/.test(m)) return m;
      const ampm = ampmRaw ? ampmRaw.trim().toUpperCase() : "";
      let H = parseInt(hh, 10);
      let M = parseInt(mm, 10);

      if (!Number.isFinite(M) || M < 0) M = 0;
      if (M > 59) M = 59;

      if (ampm) {
        if (!Number.isFinite(H) || H < 1) H = 1;
        if (H > 12) H = ((H - 1) % 12) + 1;
        if (H < 1) H = 1;
      } else {
        if (!Number.isFinite(H) || H < 0) H = 0;
        if (H > 23) H = 23;
      }

      const hh2 = String(H).padStart(2, "0");
      const mm2 = String(M).padStart(2, "0");
      return `${hh2}:${mm2}${ampm ? " " + ampm : ""}`;
    });

    // 3) ISO like "YYYY-MM-DD HH:MM:SS" (ensure 24-hour clamp)
    out = out.replace(/(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})/g, (m, datePart, hh, mm, ss) => {
      let H = parseInt(hh, 10);
      let M = parseInt(mm, 10);
      let S = parseInt(ss, 10);
      if (!Number.isFinite(S) || S < 0) S = 0;
      if (S > 59) S = 59;
      if (!Number.isFinite(M) || M < 0) M = 0;
      if (M > 59) M = 59;
      if (!Number.isFinite(H) || H < 0) H = 0;
      if (H > 23) H = 23;
      return `${datePart} ${String(H).padStart(2, "0")}:${String(M).padStart(2, "0")}:${String(S).padStart(2, "0")}`;
    });

    return out;
  }

  /**
   * Parse a human-friendly/sanitized date string into ISO timestamp (UTC).
   * Returns ISO string (e.g. 2025-11-07T13:45:00.000Z) or null if parsing fails.
   *
   * Heuristics:
   *  - Try new Date(sanitized)
   *  - Support DD-MMM-YY / DD-MMM-YYYY with optional time and AM/PM
   *  - For two-digit years, assume 2000+
   */
  function parseDateStringToISO(s) {
    if (!s || typeof s !== "string") return null;
    const sanitized = sanitizeTimeInDateString(s.trim());
    // Quick attempt
    const d1 = new Date(sanitized);
    if (!Number.isNaN(d1.getTime())) return d1.toISOString();

    // Try common pattern: DD-MMM-YY(YY) [HH:MM(:SS)] [AM/PM]
    const m = sanitized.match(/(\d{1,2})[-/]([A-Za-z]{3,9})[-/](\d{2,4})(?:\s+(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*([AP]M))?)?/i);
    if (m) {
      const day = Number(m[1]);
      const monStr = m[2].slice(0,3).toLowerCase();
      const yearRaw = m[3];
      let year = Number(yearRaw);
      if (yearRaw.length === 2) {
        year = 2000 + year;
      }
      const months = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
      const month = months[monStr] ?? null;
      if (month === null) return null;
      let H = 0, M = 0, S = 0;
      if (m[4]) {
        const parts = m[4].split(':').map(x => Number(x));
        H = parts[0] || 0;
        M = parts[1] || 0;
        S = parts[2] || 0;
        if (m[5]) {
          const ampm = (m[5] || "").toUpperCase();
          if (ampm === 'PM' && H < 12) H = (H % 12) + 12;
          if (ampm === 'AM' && H === 12) H = 0;
        }
      }
      try {
        const dt = new Date(Date.UTC(year, month, day, H, M, S));
        if (!Number.isNaN(dt.getTime())) return dt.toISOString();
      } catch (e) {
        // ignore
      }
    }

    // Try ISO-ish extraction (first {...} or [...]) - less likely for date but keep
    const isoMatch = sanitized.match(/(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}))?/);
    if (isoMatch) {
      try {
        const dt = new Date(sanitized);
        if (!Number.isNaN(dt.getTime())) return dt.toISOString();
      } catch (e) {}
    }

    return null;
  }

  // GNSW Truck No
  const handleExtract = (rawText) => {
    if (!rawText) {
      setExtractedPairs([]);
      setTicketCandidates([]);
      setSelectedTicketCandidate("");
      return;
    }

    // Normalize lines and whitespace
    const lines = String(rawText || "")
      .replace(/\r\n/g, "\n")
      .replace(/\t/g, " ")
      .replace(/\u00A0/g, " ")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const full = lines.join("\n");
    const found = {};

    const extractLabelLine = (labelRegex) =>
      lines.find((l) => labelRegex.test(l)) || null;

    // parseWeightFromLine: prefer distinct 4-6 digit tokens and reasonable bounds
    const parseWeightFromLine = (line) => {
      if (!line) return null;
      const matches = Array.from(line.matchAll(/\b(\d{4,6})\b/g)).map((m) => m[1]);
      if (matches.length === 0) return null;
      for (let i = 0; i < matches.length; i++) {
        const num = Number(matches[i].replace(/,/g, ""));
        if (!Number.isFinite(num)) continue;
        if (num >= 100 && num <= 200000) return num;
      }
      return null;
    };

    // -----------------------
    // GNSW Truck No
    // -----------------------
    const gnswLine =
      extractLabelLine(/GNSW\s*Truck\s*No/i) || extractLabelLine(/\bTruck\s*No\b/i);
    if (gnswLine) {
      const m =
        gnswLine.match(/GNSW\s*Truck\s*No\.?\s*(?::|-)?\s*([A-Z0-9/-]{3,15})/i) ||
        gnswLine.match(/Truck\s*No\.?\s*(?::|-)?\s*([A-Z0-9/-]{3,15})/i);
      if (m && m[1]) found.gnsw_truck_no = String(m[1]).trim().toUpperCase();
    } else {
      const plateMatch = full.match(/\b([A-Z]{1,3}\d{2,4}[A-Z]{0,2})\b/i);
      if (plateMatch && plateMatch[1]) {
        found.gnsw_truck_no = plateMatch[1].toUpperCase();
      }
    }

    // Trailer no
    const trailerLine = extractLabelLine(/\bTrailer\b.*\bNo\b/i) || extractLabelLine(/\bTrailer No\b/i);
    if (trailerLine) {
      const m = trailerLine.match(/Trailer\s*(?:No\.?|#)?\s*[:-]?\s*([A-Z0-9-]+)/i);
      if (m && m[1]) found.trailer_no = m[1].trim();
    }

    // Driver
    const driverLine = extractLabelLine(/\bDriver\b/i);
    if (driverLine) {
      let drv = driverLine.replace(/Driver\s*[:-]?\s*/i, "").trim();
      drv = drv.replace(/^[-:]+/, "").trim();
      drv = drv.replace(/\bTruck\b.*$/i, "").trim();
      drv = drv.replace(/\(.*?\)/g, "").trim();
      found.driver = drv || null;
    }

    // Scale Name / WB ID
    const scaleLine = extractLabelLine(/Scale\s*Name|ScaleName|Scale:/i);
    if (scaleLine) {
      const m = scaleLine.match(/Scale\s*Name\s*[:-]?\s*([A-Z0-9_-]+)/i) || scaleLine.match(/Scale\s*[:-]?\s*([A-Z0-9_-]+)/i);
      if (m && m[1]) {
        const cand = String(m[1]).toUpperCase();
        found.scale_name = cand;
      }
    }
    if (!found.scale_name) {
      const wb = full.match(/\b(WBRIDGE\d+)\b/i);
      if (wb && wb[1]) found.scale_name = wb[1].toUpperCase();
    }

    // Gross / Tare / Net
    const grossLine = extractLabelLine(/\bGross\b/i);
    if (grossLine) found.gross = parseWeightFromLine(grossLine);
    else {
      const mt = full.match(/Gross\s*[:-]?\s*(\d{4,6})/i);
      if (mt && mt[1]) found.gross = Number(mt[1]);
    }

    const tareLine = extractLabelLine(/\bTare\b/i);
    if (tareLine) found.tare = parseWeightFromLine(tareLine);
    else {
      const mt = full.match(/Tare\s*[:-]?\s*(?:\([A-Za-z]+\)\s*)?(\d{4,6})/i);
      if (mt && mt[1]) found.tare = Number(mt[1]);
    }

    const netLine = extractLabelLine(/\bNet\b/i);
    if (netLine) found.net = parseWeightFromLine(netLine);
    else {
      const mn = full.match(/Net\s*[:-]?\s*(\d{4,6})/i);
      if (mn && mn[1]) found.net = Number(mn[1]);
    }

    // SAD No
    const sadLine = extractLabelLine(/\bSAD\b.*\bNo\b/i) || extractLabelLine(/\bSAD\b/i);
    if (sadLine) {
      const m = sadLine.match(/SAD\s*No\.?\s*[:-]?\s*(\d{2,6})/i) || sadLine.match(/SAD\s*[:-]?\s*(\d{2,6})/i);
      if (m && m[1]) found.sad_no = m[1];
    } else {
      const sadFb = full.match(/\bSAD\s*No\.?\s*[:-]?\s*(\d{2,6})/i) || full.match(/\bSAD\s*[:-]?\s*(\d{2,6})/i);
      if (sadFb && sadFb[1]) found.sad_no = sadFb[1];
    }

    // other metadata (container/consignee/operator)
    const containerLine = extractLabelLine(/\bContainer\b/i) || extractLabelLine(/\bContainer\s*No\b/i);
    if (containerLine) {
      const m = containerLine.match(/Container\s*(?:No\.?|#)?\s*[:-]?\s*([A-Z0-9-]+)/i);
      if (m && m[1]) found.container_no = String(m[1]).trim();
      else {
        const bulkLine = lines.find((l) => /\bBULK\b/i.test(l));
        if (bulkLine) found.container_no = "BULK";
      }
    }

    const consigneeLine = extractLabelLine(/Consignee\b/i);
    if (consigneeLine) {
      let c = consigneeLine.replace(/Consignee\s*[:-]?\s*/i, "").trim();
      c = c.split(/\bTare\b/i)[0].trim();
      c = c.replace(/\b\d{2,6}\s*kg\b/i, "").trim();
      found.consignee = c || null;
    }

    const materialLine = extractLabelLine(/Material\b/i);
    if (materialLine) {
      const m = materialLine.match(/Material\s*[:-]?\s*(.+)/i);
      if (m && m[1]) found.material = m[1].trim();
    }

    const operatorLine = extractLabelLine(/\bOperator\b/i);
    if (operatorLine) {
      let op = operatorLine.replace(/Operator\s*[:-]?\s*/i, "").trim();
      op = op.replace(/\d{1,2}-[A-Za-z]{3}-\d{2,4}/g, "");
      op = op.replace(/\d{1,2}:\d{2}:\d{2}\s*[AP]M/gi, "");
      op = op.replace(/\bWBRIDGE\d+\b/gi, "");
      op = op.replace(/\b\d{2,6}\s*kg\b/gi, "");
      op = op.replace(/\b(true|false)\b/ig, "");
      op = op.replace(/\b(Pass|Number|Date|Scale|Weight|Manual)\b.*$/i, "").trim();
      if (op) {
        const opMatch = op.match(/[A-Za-z][A-Za-z.\s'-]{0,40}/);
        found.operator = opMatch ? opMatch[0].trim() : op;
      } else {
        found.operator = "Operator";
      }
    }

    // Date detection (common formats)
    const dateMatch = full.match(
      /(\d{1,2}[-/][A-Za-z]{3}[-/]\d{2,4}\s+\d{1,2}:\d{2}:\d{2}\s*[AP]M)|(\d{1,2}-[A-Za-z]{3}-\d{2,4}\s+\d{1,2}:\d{2}:\d{2}\s*[AP]M)|(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/i
    );
    if (dateMatch) {
      // sanitize the matched date/time to avoid out-of-range components
      const sanitized = sanitizeTimeInDateString(dateMatch[0].trim());
      found.date = sanitized;
      const iso = parseDateStringToISO(sanitized);
      if (iso) found.date_iso = iso;
    }

    // --- Ticket number: produce candidates with confidence ---
    const candidateList = generateTicketCandidates(rawText, found); // array of {value, confidence, reason}

    // Attempt to pick best candidate automatically only if it's clearly valid
    // Default selection rule: prefer 'context-numeric' candidate if present (as you requested)
    let defaultCandidate = null;
    const contextNumeric = candidateList.find(c => c.reason === 'context-numeric');
    if (contextNumeric) defaultCandidate = normalizeTicketFormat(contextNumeric.value);
    else if (candidateList.length > 0) defaultCandidate = normalizeTicketFormat(candidateList[0].value);

    // Build extractedPairs with confidence heuristics:
    const pairs = [];
    // helper to add pair with confidence
    const addPair = (key, value, confidence = 0.6) => {
      if (value === undefined || value === null) return;
      pairs.push({ key, value, confidence: Math.max(0, Math.min(1, confidence)) });
    };

    // Add many fields with reasonable confidence values
    if (found.ticket_no) addPair('ticket_no', found.ticket_no, 0.95);
    if (!found.ticket_no && defaultCandidate) addPair('ticket_no', defaultCandidate, candidateList.find(c => normalizeTicketFormat(c.value) === defaultCandidate)?.confidence ?? 0.75);
    if (found.gnsw_truck_no) addPair('gnsw_truck_no', found.gnsw_truck_no, 0.9);
    if (found.trailer_no) addPair('trailer_no', found.trailer_no, 0.85);
    if (found.driver) addPair('driver', found.driver, 0.82);
    if (found.scale_name) addPair('wb_id', found.scale_name, 0.8);
    if (found.gross !== undefined && found.gross !== null) addPair('gross', found.gross, found.gross ? 0.9 : 0.5);
    if (found.tare !== undefined && found.tare !== null) addPair('tare', found.tare, found.tare ? 0.9 : 0.5);
    if (found.net !== undefined && found.net !== null) addPair('net', found.net, found.net ? 0.9 : 0.5);
    if (found.sad_no) addPair('sad_no', found.sad_no, 0.88);
    if (found.container_no) addPair('container_no', found.container_no, 0.7);
    if (found.consignee) addPair('consignee', found.consignee, 0.65);
    if (found.material) addPair('material', found.material, 0.62);
    if (found.operator) addPair('operator', found.operator, 0.6);
    if (found.date) addPair('date', found.date, 0.6);
    if (found.date_iso) addPair('date_iso', found.date_iso, 0.8);
    if (found.weight) addPair('weight', found.weight, 0.55);

    setExtractedPairs(pairs);

    // Sort candidates by confidence (already sorted in generator, but ensure)
    const sortedCandidates = candidateList.slice().sort((a, b) => b.confidence - a.confidence || b.value.length - a.value.length);
    // ensure normalized values in candidates for display & selection
    const normalizedCandidates = sortedCandidates.map(c => ({ ...c, normalized: normalizeTicketFormat(c.value) }));
    setTicketCandidates(normalizedCandidates);

    // select default: prefer context-numeric normalized, else top normalized
    const selectedDefault = (normalizedCandidates.find(c => c.reason === 'context-numeric')?.normalized)
      || normalizedCandidates[0]?.normalized || "";
    setSelectedTicketCandidate(selectedDefault);

    // Merge into formData only if empty (but DO NOT overwrite ticket_no automatically if multiple candidates exist)
    setFormData((prev) => {
      const next = { ...prev };
      pairs.forEach(({ key, value }) => {
        const existing = next[key];
        const isEmpty = existing === null || existing === undefined || existing === "" || existing === false;
        if (key === "ticket_no") {
          const autoPickAllowed = (normalizedCandidates.length <= 1) || (/^\d{5}$/.test(String(value)));
          if (!autoPickAllowed) return;
          if (isEmpty) next[key] = value;
        } else {
          if (isEmpty) next[key] = value;
        }
      });
      return next;
    });

    toast({
      title: "Form populated from Ticket Reader",
      description: "Fields cleaned and normalized where possible. Verify ticket number if needed.",
      status: "success",
      duration: 3500,
      isClosable: true,
    });
  };

  // ------------------------ Apply chosen ticket candidate ------------------------
  const applySelectedTicketCandidate = () => {
    if (!selectedTicketCandidate) {
      toast({ title: "No candidate selected", status: "warning" });
      return;
    }
    const normalized = normalizeTicketFormat(selectedTicketCandidate);
    // update extractedPairs: replace or add ticket_no entry with confidence if known
    const matched = ticketCandidates.find(c => c.normalized === normalized);
    const confidence = matched?.confidence ?? 0.75;
    setExtractedPairs(prev => {
      const others = prev.filter(p => p.key !== 'ticket_no');
      return [{ key: 'ticket_no', value: normalized, confidence }, ...others];
    });
    // also merge into formData (overwrite)
    setFormData(prev => ({ ...prev, ticket_no: normalized }));
    toast({ title: "Ticket applied", description: `Using ${normalized}`, status: "success" });
  };

  // ------------------------ Auto-pick best (select context-numeric if present) ------------------------
  const handleAutoPickBest = () => {
    if (!ticketCandidates || ticketCandidates.length === 0) {
      toast({ title: "No candidates", status: "info" });
      return;
    }
    const contextNumeric = ticketCandidates.find(c => c.reason === 'context-numeric');
    if (contextNumeric) {
      setSelectedTicketCandidate(contextNumeric.normalized);
      applySelectedTicketCandidate();
      return;
    }
    // fallback: prefer 5-digit
    const five = ticketCandidates.find(c => /^\d{5}$/.test(c.normalized));
    if (five) {
      setSelectedTicketCandidate(five.normalized);
      applySelectedTicketCandidate();
      return;
    }
    // fallback: top candidate
    setSelectedTicketCandidate(ticketCandidates[0].normalized);
    applySelectedTicketCandidate();
  };

  // ------------------------ Fetch tickets ------------------------
  const fetchTickets = useCallback(async () => {
    setLoadingTickets(true);
    try {
      const search = String(debouncedSearchTicket || "").trim();
      if (useClientSidePagination) {
        const { data, error } = await supabase.from("tickets").select("*").order("date", { ascending: false });
        if (error) throw error;
        const all = data || [];
        const filtered = search ? all.filter(t => String(t.ticket_no || '').toLowerCase().includes(search.toLowerCase())) : all;
        setTickets(filtered);
        setTotalTickets(filtered.length);
        setCurrentPage((p) => {
          const tp = Math.max(1, Math.ceil(filtered.length / pageSize) || 1);
          return Math.min(p, tp);
        });
      } else {
        const start = (currentPage - 1) * pageSize;
        const end = currentPage * pageSize - 1;
        let query = supabase.from("tickets").select("*", { count: "exact" });
        if (search) query = query.ilike("ticket_no", `%${search}%`);
        const { data, error, count } = await query.order("submitted_at", { ascending: false }).range(start, end);
        if (error) throw error;
        setTickets(data || []);
        setTotalTickets(count || 0);
      }
    } catch (err) {
      console.error("Error fetching tickets:", err);
      toast({ title: "Error fetching tickets", description: String(err.message || err), status: "error", duration: 6000, isClosable: true });
    } finally {
      setLoadingTickets(false);
    }
  }, [currentPage, pageSize, useClientSidePagination, debouncedSearchTicket, toast]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  useEffect(() => {
    setCurrentPage(1);
    fetchTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize, useClientSidePagination]);

  const displayedTickets = useMemo(() => {
    if (useClientSidePagination) return tickets.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    return tickets;
  }, [tickets, currentPage, pageSize, useClientSidePagination]);

  // ------------------------ upload helper ------------------------
  const uploadFileToSupabase = async (file) => {
    // Accept Blob or File; if Blob convert to File
    let uploadFile = file;
    if (!(uploadFile instanceof File)) {
      try {
        uploadFile = new File([uploadFile], `upload-${Date.now()}.pdf`, { type: uploadFile?.type || "application/pdf" });
      } catch (err) {
        uploadFile = file;
      }
    }

    if (!(uploadFile instanceof File)) throw new Error("uploadFileToSupabase: file must be a File or Blob convertible to File");

    const fileExt = uploadFile.name.split(".").pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;
    const filePath = `uploads/${fileName}`;
    const { error: uploadError } = await supabase.storage.from("tickets").upload(filePath, uploadFile, { cacheControl: "3600", upsert: false });
    if (uploadError) throw uploadError;
    const { data: publicData } = supabase.storage.from("tickets").getPublicUrl(filePath);
    return { file_name: filePath, file_url: publicData.publicUrl };
  };

  // --------------------------- numeric fields to sanitize ---------------------------
  const NUMERIC_FIELDS = [
    'gross', 'tare', 'net', 'total_weight', 'weight', 'axles'
  ];

  // ------------------------ Save ticket (sanitizes payload before insert) ------------------------
  const saveTicket = async (data) => {
    const submissionData = { ...data };

    try {
      // sanitize empties
      Object.keys(submissionData).forEach((k) => {
        if (submissionData[k] === '') submissionData[k] = null;
        if (typeof submissionData[k] === 'string' && (submissionData[k].toLowerCase() === 'null' || submissionData[k].toLowerCase() === 'undefined')) {
          submissionData[k] = null;
        }
      });

      // ensure ticket_no is normalized digits-only (if present)
      if (submissionData.ticket_no) submissionData.ticket_no = normalizeTicketFormat(submissionData.ticket_no);

      // upload file
      if (ocrFile) {
        const { file_name, file_url } = await uploadFileToSupabase(ocrFile);
        submissionData.file_name = file_name;
        submissionData.file_url = file_url;
      } else {
        submissionData.file_name = submissionData.file_name ?? null;
        submissionData.file_url = submissionData.file_url ?? null;
      }

      // compute weights
      const computed = computeWeightsFromObj({
        gross: submissionData.gross,
        tare: submissionData.tare,
        net: submissionData.net,
        weight: submissionData.weight,
      });
      submissionData.gross = computed.grossValue ?? (submissionData.gross ?? null);
      submissionData.tare = computed.tareValue ?? (submissionData.tare ?? null);
      submissionData.net = computed.netValue ?? (submissionData.net ?? null);

      NUMERIC_FIELDS.forEach(field => {
        let val = submissionData[field];
        if (val === '' || val === null || val === undefined) {
          submissionData[field] = null;
          return;
        }
        if (typeof val === 'string') {
          const cleaned = val.replace(/,/g, '').trim();
          if (cleaned === '') { submissionData[field] = null; return; }
          const num = Number(cleaned);
          submissionData[field] = Number.isFinite(num) ? num : null;
          return;
        }
        if (typeof val === 'number') {
          submissionData[field] = Number.isFinite(val) ? val : null;
          return;
        }
        const coerced = Number(val);
        submissionData[field] = Number.isFinite(coerced) ? coerced : null;
      });

      if (typeof submissionData.gross === "number" && typeof submissionData.tare === "number") {
        submissionData.total_weight = submissionData.gross - submissionData.tare;
      } else {
        if (submissionData.total_weight !== null && submissionData.total_weight !== undefined) {
          if (typeof submissionData.total_weight === 'string') {
            const n = Number(submissionData.total_weight.replace(/,/g, '').trim());
            submissionData.total_weight = Number.isFinite(n) ? n : null;
          } else if (typeof submissionData.total_weight !== 'number') {
            const n = Number(submissionData.total_weight);
            submissionData.total_weight = Number.isFinite(n) ? n : null;
          }
        } else submissionData.total_weight = null;
      }

      // Normalize date field (if present) to ISO to avoid DB timestamp parsing errors
      if (submissionData.date && typeof submissionData.date === 'string') {
        // prefer date_iso extracted if user used the extractor
        let parsedISO = null;
        // if the value already looks like an ISO, try new Date
        try {
          const d = new Date(submissionData.date);
          if (!Number.isNaN(d.getTime())) parsedISO = d.toISOString();
        } catch {}
        if (!parsedISO) {
          // try sanitize + parse heuristics (reuse helper from above)
          parsedISO = (function tryParse(s) {
            if (!s) return null;
            const san = sanitizeTimeInDateString(s);
            // try direct Date
            const dd = new Date(san);
            if (!Number.isNaN(dd.getTime())) return dd.toISOString();
            // attempt dd-mmm parsing
            const m = san.match(/(\d{1,2})[-/]([A-Za-z]{3,9})[-/](\d{2,4})(?:\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*([AP]M)?)?/i);
            if (m) {
              // reuse logic from parseDateStringToISO above
              const day = Number(m[1]);
              const monStr = m[2].slice(0,3).toLowerCase();
              const yearRaw = m[3];
              let year = Number(yearRaw);
              if (yearRaw.length === 2) year = 2000 + year;
              const months = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
              const month = months[monStr] ?? null;
              if (month === null) return null;
              let H=0,M=0,S=0;
              if (m[4]) {
                const parts = m[4].split(':').map(x => Number(x));
                H = parts[0] || 0; M = parts[1] || 0; S = parts[2] || 0;
                if (m[5]) {
                  const ampm = (m[5] || "").toUpperCase();
                  if (ampm === 'PM' && H < 12) H = (H % 12) + 12;
                  if (ampm === 'AM' && H === 12) H = 0;
                }
              }
              try {
                const dt = new Date(Date.UTC(year, month, day, H, M, S));
                if (!Number.isNaN(dt.getTime())) return dt.toISOString();
              } catch {}
            }
            return null;
          })(submissionData.date);
        }
        if (parsedISO) {
          // For DB insert prefer a date-only string if no time was provided, but ISO is safe
          submissionData.date = parsedISO;
        } else {
          // keep original sanitized value if parse failed — DB may still accept a simple YYYY-MM-DD style, else validation will fail
          submissionData.date = sanitizeTimeInDateString(submissionData.date);
        }
      }

      // attach current user as created_by (and user_id fallback)
      let currentUserId = null;
      try {
        // supabase v2: getUser()
        const userRes = await supabase.auth.getUser();
        if (userRes && userRes.data && userRes.data.user) currentUserId = userRes.data.user.id;
      } catch (e) {
        // fallback for older SDK
        try { const u = supabase.auth.user(); if (u) currentUserId = u.id; } catch {}
      }
      if (currentUserId) {
        submissionData.created_by = currentUserId;
        if (!submissionData.user_id) submissionData.user_id = currentUserId;
      }

      // remove undefined keys
      Object.keys(submissionData).forEach((k) => {
        if (submissionData[k] === undefined) delete submissionData[k];
      });

      const { error } = await supabase.from("tickets").insert([submissionData]);

      if (error) {
        if (error.message?.toLowerCase().includes("tickets_ticket_no_key")) {
          toast({ title: "Duplicate Ticket", description: "This ticket already exists.", status: "error", duration: 7000 });
          return;
        }
        throw error;
      }

      confetti({ particleCount: 100, spread: 140, origin: { y: 0.35 } });
      await fetchTickets();
      setFormData({ ...EMPTY_FORM });
      setExtractedPairs([]);
      setOcrFile(null);
      setOcrText("");
      setTicketCandidates([]);
      setSelectedTicketCandidate("");
      toast({ title: "Saved", description: "Ticket saved successfully", status: "success", duration: 3000 });
    } catch (err) {
      console.error("Save failed", err);
      const msg = err?.message ?? JSON.stringify(err);
      toast({ title: "Save failed", description: msg, status: "error", duration: 8000 });
    }
  };

  // ------------------------ Confirm handlers ------------------------
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

  // ------------------------ Inline editing ------------------------
  const startEditingRow = (row) => {
    const rid = row.id ?? row.ticket_id;
    setEditingRowId(rid);
    setEditFormData({
      ticket_no: row.ticket_no ?? "",
      gnsw_truck_no: row.gnsw_truck_no ?? "",
      sad_no: row.sad_no ?? "",
      gross: row.gross != null ? String(row.gross) : "",
      tare: row.tare != null ? String(row.tare) : "",
      net: row.net != null ? String(row.net) : "",
    });
  };
  const cancelEditingRow = () => {
    setEditingRowId(null);
    setEditFormData({});
  };
  const saveEditingRow = async (originalRow) => {
    const rowId = originalRow.id ?? originalRow.ticket_id;
    if (!rowId) {
      toast({ title: "Cannot update", description: "Row has no identifier", status: "error" });
      return;
    }
    const ticketsPayload = {
      ticket_no: editFormData.ticket_no || null,
      gnsw_truck_no: editFormData.gnsw_truck_no || null,
      sad_no: editFormData.sad_no || null,
      gross: numericValue(editFormData.gross),
      tare: numericValue(editFormData.tare),
      net: numericValue(editFormData.net),
    };
    Object.keys(ticketsPayload).forEach(k => { if (ticketsPayload[k] === undefined) delete ticketsPayload[k]; });

    try {
      const ticketIdField = originalRow.id ? "id" : (originalRow.ticket_id ? "ticket_id" : null);
      const ticketIdValue = originalRow.id ?? originalRow.ticket_id;
      if (!ticketIdField) throw new Error("Primary key not found");
      const { error } = await supabase.from("tickets").update(ticketsPayload).eq(ticketIdField, ticketIdValue);
      if (error) throw error;
      toast({ title: "Updated", description: "Ticket updated", status: "success" });
      cancelEditingRow();
      await fetchTickets();
    } catch (err) {
      console.error("Update failed", err);
      toast({ title: "Update failed", description: String(err.message || err), status: "error" });
    }
  };

  // ------------------------ View handler ------------------------
  const handleView = (ticket) => {
    setViewTicket(ticket);
    onViewOpen();
  };

  // ------------------------ Voice (Web Speech API) ------------------------
  const recognitionRef = useRef(null);
  const [listening, setListening] = useState(false);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;
    if (!SpeechRecognition) {
      recognitionRef.current = null;
      return;
    }
    const rec = new SpeechRecognition();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = "en-US";
    rec.maxAlternatives = 1;

    rec.onresult = (ev) => {
      const transcript = ev.results[0][0].transcript.trim();
      const confidence = ev.results[0][0].confidence ?? 1;
      handleVoiceCommand(transcript, confidence);
    };

    rec.onend = () => setListening(false);
    rec.onerror = (e) => { setListening(false); console.error("Speech error", e); toast({ title: "Voice Error", description: String(e.error || "Recognition failed"), status: "error" }); };

    recognitionRef.current = rec;
    return () => {
      try { rec.stop(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayedTickets, tickets, currentPage]);

  const startListening = () => {
    const rec = recognitionRef.current;
    if (!rec) {
      toast({ title: "Voice Not Supported", description: "Web Speech API not available in this browser", status: "warning" });
      return;
    }
    try { rec.start(); setListening(true); } catch (e) { console.warn(e); setListening(false); }
  };
  const stopListening = () => {
    try { recognitionRef.current?.stop(); } catch {}
    setListening(false);
  };

  const handleVoiceCommand = async (text, confidence = 1) => {
    const cmd = String(text || "").toLowerCase();
    toast({ title: "Voice command", description: `"${text}" (confidence ${Math.round(confidence * 100)}%)`, status: "info", duration: 3000 });

    if (confidence < VOICE_CONFIDENCE_THRESHOLD) {
      toast({ title: "Low confidence", description: "I couldn't hear you clearly — try again.", status: "warning" });
      return;
    }

    if (/edit\s+row\s+(\d+)/.test(cmd)) {
      const m = cmd.match(/edit\s+row\s+(\d+)/);
      const idx = parseInt(m[1], 10) - 1;
      if (!Number.isFinite(idx) || idx < 0 || idx >= displayedTickets.length) { toast({ title: "Row out of range", status: "warning" }); return; }
      startEditingRow(displayedTickets[idx]);
      toast({ title: "Editing", description: `Row ${idx + 1} ready to edit`, status: "info" });
      return;
    }
    if (/save\s+row\s+(\d+)/.test(cmd)) {
      const m = cmd.match(/save\s+row\s+(\d+)/);
      const idx = parseInt(m[1], 10) - 1;
      if (!Number.isFinite(idx) || idx < 0 || idx >= displayedTickets.length) { toast({ title: "Row out of range", status: "warning" }); return; }
      await saveEditingRow(displayedTickets[idx]);
      return;
    }
    if (cmd.includes("next page")) { setCurrentPage(p => Math.min(totalPages, p + 1)); await new Promise(r => setTimeout(r, 300)); await fetchTickets(); return; }
    if (cmd.includes("previous page") || cmd.includes("prev page")) { setCurrentPage(p => Math.max(1, p - 1)); await new Promise(r => setTimeout(r, 300)); await fetchTickets(); return; }
    if (cmd.includes("submit extracted") || cmd.includes("submit ticket")) {
      handleSubmitClick({ ...formData, ...Object.fromEntries(extractedPairs.map(p => [p.key, p.value])) });
      toast({ title: "Preparing submission", status: "info" });
      return;
    }

    toast({ title: "Unknown command", description: `I heard: "${text}"`, status: "info" });
  };

  // ------------------------ Assistant suggestions ------------------------
  const [assistantOpen] = useState(false);
  const suggestedFixes = useMemo(() => {
    const out = [];
    if (extractedPairs.length === 0) {
      out.push({ id: "no-data", text: "No extracted data — run Extractor or upload file." });
    } else {
      const gross = extractedPairs.find(p => p.key === "gross")?.value;
      const tare = extractedPairs.find(p => p.key === "tare")?.value;
      if (gross && tare) {
        const g = numericValue(gross), t = numericValue(tare);
        if (g !== null && t !== null && g < t) out.push({ id: "swap-weights", text: "Gross < Tare — possible swap." });
      }
      if (!extractedPairs.find(p => p.key === "ticket_no")) out.push({ id: "missing-ticket", text: "Ticket number missing — pick a candidate." });
    }
    return out;
  }, [extractedPairs]);


  // ------------------------ Field labels ------------------------
  const fieldLabels = {
    ticket_no: "Ticket No", gnsw_truck_no: "Truck No",
     wb_id: "WB ID", consignee: "Consignee", operation: "Operation",
     driver: "Driver", truck_on_wb: "Truck on WB", gross: "Gross Weight",
    tare: "Tare Weight", net: "Net Weight", total_weight: "Total Weight", sad_no: "SAD No",
    container_no: "Container No", date: "Date", operator: "Operator",
     weight: "Weight",
  };

  // Orb keyboard helper
  const orbKeyDown = (e) => { if (e.key === "Enter" || e.key === " ") onOrbOpen(); };

  // ------------------------ Render ------------------------
  return (
    <Box p={[4, 6, 8]} maxW="1400px" mx="auto" style={{ background: gradientBg, borderRadius: 12 }}>
      {/* Header */}
      <Flex align="center" gap={4} mb={6}>
        <Heading size="lg" color="darkred">Weighbridge — Ticket Reader</Heading>
        <Badge ml={2} colorScheme="purple" variant="subtle">SmartPort</Badge>
        <Spacer />
      </Flex>

      {/* Assistant */}
      <AnimatePresence>
        {assistantOpen && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <Box p={3} mb={4} borderRadius="md" bg={panelBg} border={`1px solid ${neonBorder}`}>
              <Flex align="center" gap={4}>
                <Spacer />
                <HStack>
                  <Button size="sm" onClick={() => { setFormData({ ...EMPTY_FORM }); setExtractedPairs([]); setOcrFile(null); setOcrText(""); setTicketCandidates([]); setSelectedTicketCandidate(""); toast({ title: "Cleared", status: "info" }); }}>Clear</Button>
                  <Button size="sm" colorScheme="teal" onClick={() => { handleExtract(ocrText); }}>Re-run OCR</Button>
                </HStack>
              </Flex>
              <Divider my={3} />
              <SimpleGrid columns={[1, 2, 3]} spacing={3}>
                {suggestedFixes.map(s => (
                  <Box key={s.id} p={2} borderRadius="md" bg="rgba(255,255,255,0.02)" border={`1px solid ${neonBorder}`}>
                    <Text fontSize="sm">{s.text}</Text>
                    <Button size="xs" mt={2} onClick={() => {
                      if (s.id === "swap-weights") {
                        const g = extractedPairs.find(p => p.key === "gross")?.value;
                        const t = extractedPairs.find(p => p.key === "tare")?.value;
                        if (g && t) {
                          setExtractedPairs(prev => prev.map(p => {
                            if (p.key === "gross") return { ...p, value: t };
                            if (p.key === "tare") return { ...p, value: g };
                            return p;
                          }));
                          toast({ title: "Swapped", status: "success" });
                        } else toast({ title: "Swap not possible", status: "warning" });
                      } else if (s.id === "missing-ticket") onOrbOpen();
                      else toast({ title: "Applied", status: "info" });
                    }}>Apply</Button>
                  </Box>
                ))}
              </SimpleGrid>
            </Box>
          </motion.div>
        )}
      </AnimatePresence>

      {/* OCR */}
      <OCRComponent onComplete={(file, text) => { setOcrFile(file); setOcrText(text || ""); handleExtract(text || ""); }} />

      {/* Controls */}
      <Flex align="center" gap={4} mb={4} flexWrap="wrap">
        <FormControl maxW="160px">
          <FormLabel fontSize="sm" mb={1}>Page size</FormLabel>
          <Select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            size="sm"
            borderColor="rgba(0,0,0,0.65)"
            _focus={{ borderColor: "blackAlpha.800" }}
          >
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={20}>20</option>
          </Select>
        </FormControl>

        <FormControl maxW={["100%","420px","520px"]}>
          <FormLabel fontSize="sm" mb={1}>Search Tickets</FormLabel>
          <HStack>
            <Input
              placeholder="Ticket No"
              size="sm"
              value={searchTicketNo}
              onChange={(e) => setSearchTicketNo(e.target.value)}
              borderColor="rgba(0,0,0,0.65)"
              _focus={{ borderColor: "blackAlpha.800" }}
            />
            <IconButton size="sm" aria-label="Clear search" icon={<CloseIcon />} onClick={async () => { if (!searchTicketNo) return; setSearchTicketNo(""); setCurrentPage(1); await fetchTickets(); }} />
            <IconButton size="sm" aria-label="Voice" onClick={() => { if (listening) stopListening(); else startListening(); }} colorScheme={listening ? "red" : "blue"} icon={<ViewIcon />} />
          </HStack>
        </FormControl>
      </Flex>

      {/* Extracted preview with Verify ticket_no UI */}
      {extractedPairs.length > 0 && (
        <Box mb={4}>
          <Heading size="md" mb={2}>Extracted Data</Heading>
          <Box maxH="240px" overflowY="auto" borderRadius="md" p={2} border={`1px solid ${neonBorder}`} bg="rgba(0,0,0,0.12)">
            <Table size="sm" variant="striped">
              <Thead>
                <Tr><Th>Key</Th><Th>Value</Th><Th>Confidence</Th></Tr>
              </Thead>
              <Tbody>
                {extractedPairs.map(({ key, value, confidence }) => (
                  <Tr key={key}>
                    <Td>{key}</Td>
                    <Td>{value?.toString?.() ?? String(value)}</Td>
                    <Td><Badge colorScheme="purple">{Math.round((confidence ?? 0) * 100)}%</Badge></Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </Box>

          {/* Verify ticket_no UI */}
          <Box mt={2} display="flex" gap={2} alignItems="center" flexWrap="wrap">
            {ticketCandidates && ticketCandidates.length > 0 ? (
              <>
                <FormControl maxW={["100%","420px","520px"]} size="sm">
                  <FormLabel fontSize="xs" mb={1}>Verify Ticket No</FormLabel>
                  <Flex align="center" gap={2}>
                    <Select
                      size="sm"
                      value={selectedTicketCandidate}
                      onChange={(e) => setSelectedTicketCandidate(e.target.value)}
                      borderColor="rgba(0,0,0,0.65)"
                      _focus={{ borderColor: "blackAlpha.800" }}
                    >
                      <option value="">— select candidate —</option>
                      {ticketCandidates.map((c, i) => (
                        <option key={`${c.value}-${i}`} value={c.normalized}>
                          {`${c.normalized} — ${Math.round(c.confidence * 100)}% (${c.reason || 'auto'})`}
                        </option>
                      ))}
                    </Select>
                    <Tooltip label={(() => {
                      const sel = ticketCandidates.find(x => x.normalized === selectedTicketCandidate);
                      if (!sel) return "No candidate selected";
                      return `${sel.normalized} — ${Math.round(sel.confidence * 100)}% (${sel.reason})`;
                    })()} aria-label="Candidate info">
                      <Box as="button" display="inline-flex" alignItems="center" justifyContent="center" p={1}>
                        <InfoOutlineIcon />
                      </Box>
                    </Tooltip>
                  </Flex>
                </FormControl>

                <Button size="sm" colorScheme="teal" onClick={applySelectedTicketCandidate}>Apply</Button>
                <Button size="sm" variant="outline" onClick={() => handleAutoPickBest()}>Auto-pick best</Button>
                <Button size="sm" variant="ghost" onClick={() => { setTicketCandidates([]); setSelectedTicketCandidate(""); toast({ title: "Candidates cleared", status: "info" }); }}>Dismiss</Button>
                <Box flex="1" />
                <Button size="sm" colorScheme="blue" onClick={() =>
                  handleSubmitClick({ ...formData, ...Object.fromEntries(extractedPairs.map(p => [p.key, p.value])) })
                }>Submit Extracted Ticket</Button>
                <Button size="sm" variant="outline" onClick={() => { setExtractedPairs([]); setOcrText(""); setOcrFile(null); setTicketCandidates([]); setSelectedTicketCandidate(""); }}>Clear</Button>
              </>
            ) : (
              <Text fontSize="sm" color="gray.300">No ticket candidates detected — you can type one in the New Ticket orb.</Text>
            )}
          </Box>
        </Box>
      )}

      {/* Preview */}
      {ocrFile && (
        <Box mt={4} mb={6}>
          <Heading size="md" mb={2}>Ticket Preview</Heading>
          {ocrFile.type === "application/pdf" ? (
            <Box borderRadius="md" overflow="hidden" border={`1px solid ${neonBorder}`} boxShadow="sm">
              <embed src={URL.createObjectURL(ocrFile)} type="application/pdf" width="100%" height="420px" />
            </Box>
          ) : (
            <Box borderRadius="md" overflow="hidden" border={`1px solid ${neonBorder}`} p={2} bg="rgba(255,255,255,0.02)">
              <img src={URL.createObjectURL(ocrFile)} alt="uploaded" style={{ maxWidth: "100%", borderRadius: 8 }} />
            </Box>
          )}
        </Box>
      )}

      {/* Tickets list */}
      <Box mt={8}>
        <Heading size="md" mb={3}>Processed Tickets</Heading>

        {loadingTickets ? <Text>Loading tickets...</Text> :
          displayedTickets.length === 0 ? <Text>No tickets found.</Text> : (
            <>
              {/* Mobile: compact table/list (instead of cards) */}
              {isMobile ? (
                <Table variant="simple" size="sm" bg={cardBg} borderRadius="md" overflow="auto">
                  <Thead>
                    <Tr>
                      <Th>Ticket</Th><Th>Truck</Th><Th>SAD</Th><Th>Net (kg)</Th><Th>Actions</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {displayedTickets.map((t) => {
                      const computed = computeWeightsFromObj({ gross: t.gross, tare: t.tare, net: t.net });
                      const rowId = t.id ?? t.ticket_id;
                      return (
                        <Tr key={rowId}>
                          <Td>{t.ticket_no ?? "-"}</Td>
                          <Td>{t.gnsw_truck_no ?? "-"}</Td>
                          <Td>{t.sad_no ?? "-"}</Td>
                          <Td>{computed.netDisplay || "—"}</Td>
                          <Td>
                            <HStack spacing={2}>
                              <IconButton size="xs" icon={<EditIcon />} aria-label="Edit" onClick={() => startEditingRow(t)} />
                              <IconButton size="xs" icon={<ViewIcon />} aria-label="View" onClick={() => handleView(t)} colorScheme="teal" />
                            </HStack>
                          </Td>
                        </Tr>
                      );
                    })}
                  </Tbody>
                </Table>
              ) : isWide3D ? (
                <Grid templateColumns="repeat(auto-fit, minmax(260px, 1fr))" gap={4}>
                  {displayedTickets.map((t) => {
                    const computed = computeWeightsFromObj({ gross: t.gross, tare: t.tare, net: t.net });
                    return (
                      <motion.div key={t.id ?? t.ticket_id} whileHover={{ rotateY: 8, scale: 1.02 }} style={{ perspective: 1200 }}>
                        <Box p={4} borderRadius="lg" bg={panelBg} border={`1px solid ${neonBorder}`} boxShadow="lg">
                          <Flex align="center">
                            <VStack2 align="start">
                              <Text fontWeight="bold" fontSize="lg" color="teal.200">{t.ticket_no ?? "-"}</Text>
                              <Text fontSize="sm" color="gray.300">{t.gnsw_truck_no ?? "-"}</Text>
                            </VStack2>
                            <Spacer />
                            <VStack2 align="end">
                              <Text fontWeight="semibold">{computed.netDisplay || "—"}</Text>
                              <Text fontSize="xs" color="gray.400">Net (kg)</Text>
                            </VStack2>
                          </Flex>
                          <Flex mt={3} gap={2}>
                            <Button size="sm" onClick={() => startEditingRow(t)}>Edit</Button>
                            <Button size="sm" colorScheme="teal" onClick={() => handleView(t)}>View</Button>
                          </Flex>
                        </Box>
                      </motion.div>
                    );
                  })}
                </Grid>
              ) : (
                <Table variant="striped" colorScheme="teal" size="sm" bg={cardBg}>
                  <Thead>
                    <Tr>
                      <Th>Ticket No</Th><Th>Truck No</Th><Th>SAD No</Th><Th>Gross (KG)</Th><Th>Tare (KG)</Th><Th>Net (KG)</Th><Th>Actions</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {displayedTickets.map((t) => {
                      const computed = computeWeightsFromObj({ gross: t.gross, tare: t.tare, net: t.net });
                      const rowId = t.id ?? t.ticket_id;
                      const isEditing = editingRowId === rowId;
                      return (
                        <Tr key={rowId}>
                          <Td>
                            {isEditing ? <Input size="sm" value={editFormData.ticket_no || ""} onChange={(e) => setEditFormData(p => ({ ...p, ticket_no: e.target.value }))} width="120px" /> : <Text color={textColor}>{t.ticket_no ?? "-"}</Text>}
                          </Td>
                          <Td>
                            {isEditing ? <Input size="sm" value={editFormData.gnsw_truck_no || ""} onChange={(e) => setEditFormData(p => ({ ...p, gnsw_truck_no: e.target.value }))} width="140px" /> : <Text color={textColor}>{t.gnsw_truck_no ?? "-"}</Text>}
                          </Td>
                          <Td>{isEditing ? <Input size="sm" value={editFormData.sad_no || ""} onChange={(e) => setEditFormData(p => ({ ...p, sad_no: e.target.value }))} width="100px" /> : <Text color={textColor}>{t.sad_no ?? "-"}</Text>}</Td>
                          <Td>{isEditing ? <Input size="sm" value={editFormData.gross || ""} onChange={(e) => setEditFormData(p => ({ ...p, gross: e.target.value }))} width="110px" /> : <Text color={textColor}>{computed.grossDisplay || "—"}</Text>}</Td>
                          <Td>{isEditing ? <Input size="sm" value={editFormData.tare || ""} onChange={(e) => setEditFormData(p => ({ ...p, tare: e.target.value }))} width="110px" /> : <Text color={textColor}>{computed.tareDisplay || "—"}</Text>}</Td>
                          <Td>{isEditing ? <Input size="sm" value={editFormData.net || ""} onChange={(e) => setEditFormData(p => ({ ...p, net: e.target.value }))} width="110px" /> : <Text color={textColor}>{computed.netDisplay || "—"}</Text>}</Td>
                          <Td>
                            {isEditing ? (
                              <HStack spacing={2}>
                                <IconButton size="sm" colorScheme="green" icon={<CheckIcon />} aria-label="Save row" onClick={() => saveEditingRow(t)} />
                                <IconButton size="sm" colorScheme="red" icon={<CloseIcon />} aria-label="Cancel" onClick={cancelEditingRow} />
                              </HStack>
                            ) : (
                              <HStack spacing={2}>
                                <IconButton size="sm" icon={<EditIcon />} aria-label="Edit row" onClick={() => startEditingRow(t)} />
                                <IconButton icon={<ViewIcon />} aria-label={`View ${t.ticket_no}`} onClick={() => handleView(t)} size="sm" colorScheme="teal" />
                              </HStack>
                            )}
                          </Td>
                        </Tr>
                      );
                    })}
                  </Tbody>
                </Table>
              )}

              {/* Pagination */}
              <Flex justify="space-between" align="center" mt={4} gap={3} flexWrap="wrap">
                <Flex gap={2} align="center">
                  <Button size="sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} isDisabled={currentPage === 1}>Previous</Button>
                  <HStack spacing={1} ml={2}>
                    {pageItems.map((it, idx) => (
                      <Button key={`${it}-${idx}`} size="sm" onClick={() => { if (it === "...") return; setCurrentPage(it); }} colorScheme={it === currentPage ? "teal" : "gray"} variant={it === currentPage ? "solid" : "outline"} isDisabled={it === "..."}>{it}</Button>
                    ))}
                  </HStack>
                  <Button size="sm" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} isDisabled={currentPage === totalPages}>Next</Button>
                </Flex>
                <Text>Page {currentPage} of {totalPages} ({totalTickets} tickets)</Text>
                <Box>
                  <Text fontSize="sm" color="gray.400">{useClientSidePagination ? "Client-side" : "Server-side"} pagination</Text>
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
                    if (["gross", "tare", "net", "total_weight"].includes(key)) {
                      const computed = computeWeightsFromObj({ gross: viewTicket.gross, tare: viewTicket.tare, net: viewTicket.net });
                      let display = value;
                      if (key === "gross") display = computed.grossDisplay;
                      if (key === "tare") display = computed.tareDisplay;
                      if (key === "net") display = computed.netDisplay;
                      if (key === "total_weight") {
                        if (computed.grossValue !== null && computed.tareValue !== null) display = formatNumber(computed.grossValue - computed.tareValue);
                        else display = "";
                      }
                      return (
                        <Box key={key} p={3} borderWidth="1px" borderRadius="md" bg={cardBg} boxShadow="sm">
                          <Text fontWeight="semibold" color="teal.600" mb={1}>{fieldLabels[key]}</Text>
                          {key === "file_url" && value ? (
                            <Button as="a" href={value} target="_blank" rel="noopener noreferrer" colorScheme="teal" size="sm">Open PDF</Button>
                          ) : (
                            <Text fontSize="md" color={textColor}>{display !== null && display !== undefined && display !== '' ? display.toString() : "N/A"}</Text>
                          )}
                        </Box>
                      );
                    }
                    return (
                      <Box key={key} p={3} borderWidth="1px" borderRadius="md" bg={cardBg} boxShadow="sm">
                        <Text fontWeight="semibold" color="teal.600" mb={1}>{fieldLabels[key]}</Text>
                        {key === "file_url" && value ? (
                          <Button as="a" href={value} target="_blank" rel="noopener noreferrer" colorScheme="teal" size="sm">Open PDF</Button>
                        ) : (
                          <Text fontSize="md" color={textColor}>{value !== null && value !== undefined && value !== '' ? value.toString() : "N/A"}</Text>
                        )}
                      </Box>
                    );
                  })}
                </SimpleGrid>
                <Box mt={6} p={3} borderTop="1px" borderColor="gray.200">
                  <Text fontWeight="bold" color="teal.600">Submitted At:</Text>
                  <Text>{viewTicket.submitted_at ? new Date(viewTicket.submitted_at).toLocaleString() : "N/A"}</Text>
                </Box>
              </Box>
            ) : <Text>No data to display.</Text>}
          </ModalBody>
          <ModalFooter>
            {viewTicket?.file_url && (
              <Button
                as="a"
                href={viewTicket.file_url}
                target="_blank"
                rel="noopener noreferrer"
                variant="outline"
                mr={3}
                size="sm"
              >
                Open PDF
              </Button>
            )}
            <Button onClick={onViewClose}>Close</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Confirm Modal */}
      <Modal isOpen={isConfirmOpen} onClose={handleCancelSubmit} isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Confirm Submission</ModalHeader>
          <ModalCloseButton />
          <ModalBody>Kindly confirm if you would like to send this Ticket to Outgate.</ModalBody>
          <ModalFooter>
            <Button ref={cancelRef} onClick={handleCancelSubmit}>Cancel</Button>
            <Button colorScheme="red" ml={3} onClick={handleConfirmSubmit}>Confirm</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Floating orb */}
      <Box position="fixed" bottom={6} right={6} zIndex={1400}>
        <motion.div initial={{ scale: 0.9 }} animate={{ scale: [1, 1.06, 1] }} transition={{ repeat: Infinity, duration: 3 }}>
          <Box role="button" tabIndex={0} onKeyDown={orbKeyDown} onClick={onOrbOpen} aria-label="Create new ticket"
            width={`${ORB_SIZE}px`} height={`${ORB_SIZE}px`} borderRadius="50%" display="flex" alignItems="center" justifyContent="center"
            boxShadow="0 8px 30px rgba(88,24,139,0.35)" bgGradient="linear(to-br, teal.400, purple.600)" color="white" cursor="pointer" _hover={{ transform: "translateY(-6px)" }}>
            <Box width="64px" height="64px" borderRadius="50%" display="flex" alignItems="center" justifyContent="center" style={{ backdropFilter: "blur(6px)" }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
                <path d="M12 2 L15.5 8 L22 9 L17 14 L18.5 21 L12 18 L5.5 21 L7 14 L2 9 L8.5 8 L12 2 Z" fill="rgba(255,255,255,0.12)" stroke="white" strokeOpacity="0.85" strokeWidth="0.6"/>
              </svg>
            </Box>
          </Box>
        </motion.div>
      </Box>

      {/* Orb modal */}
      <Modal isOpen={isOrbOpen} onClose={onOrbClose} isCentered size="lg">
        <ModalOverlay />
        <ModalContent style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01))", backdropFilter: "blur(8px)", border: `1px solid ${neonBorder}` }}>
          <ModalHeader>
            <Flex align="center" gap={3}><Avatar size="sm" name="Orb" bg="teal.400" /> New Ticket — Holographic</Flex>
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <motion.div initial={{ opacity: 0.85, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.25 }}>
              <VStack2 spacing={3}>
                <FormControl><FormLabel>Ticket No</FormLabel><Input value={formData.ticket_no} onChange={(e) => setFormData(p => ({ ...p, ticket_no: e.target.value }))} /></FormControl>
                <SimpleGrid columns={[1, 2]} spacing={3} width="100%">
                  <FormControl><FormLabel>Truck No</FormLabel><Input value={formData.gnsw_truck_no} onChange={(e) => setFormData(p => ({ ...p, gnsw_truck_no: e.target.value }))} /></FormControl>
                  <FormControl><FormLabel>Driver</FormLabel><Input value={formData.driver} onChange={(e) => setFormData(p => ({ ...p, driver: e.target.value }))} /></FormControl>
                </SimpleGrid>

                <SimpleGrid columns={[1, 2, 3]} spacing={3} width="100%">
                  <FormControl><FormLabel>Gross (kg)</FormLabel><Input value={formData.gross} onChange={(e) => setFormData(p => ({ ...p, gross: e.target.value }))} /></FormControl>
                  <FormControl><FormLabel>Tare (kg)</FormLabel><Input value={formData.tare} onChange={(e) => setFormData(p => ({ ...p, tare: e.target.value }))} /></FormControl>
                  <FormControl><FormLabel>Net (kg)</FormLabel><Input value={formData.net} onChange={(e) => setFormData(p => ({ ...p, net: e.target.value }))} /></FormControl>
                </SimpleGrid>

                <FormControl>
                  <FormLabel>Attach PDF/Image</FormLabel>
                  <Input type="file" accept="image/*,application/pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) setOcrFile(f); }} />
                </FormControl>

                <Box width="100%" display="flex" justifyContent="space-between" pt={2}>
                  <Button variant="ghost" onClick={onOrbClose}>Cancel</Button>
                  <Button colorScheme="purple" onClick={() => { handleSubmitClick(formData); onOrbClose(); }}>Create Ticket</Button>
                </Box>
              </VStack2>
            </motion.div>
          </ModalBody>
        </ModalContent>
      </Modal>
    </Box>
  );
}

export default WeighbridgeManagementPage;
