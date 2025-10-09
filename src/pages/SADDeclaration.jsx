// src/pages/SADDeclaration.jsx
import React, { useState, useEffect, useRef } from 'react';
import {
  Box, Button, Container, Heading, Input, SimpleGrid, FormControl, FormLabel, Select,
  Text, Table, Thead, Tbody, Tr, Th, Td, VStack, HStack, useToast, Modal, ModalOverlay,
  ModalContent, ModalHeader, ModalBody, ModalFooter, ModalCloseButton, IconButton, Badge, Flex,
  Spinner, Tag, TagLabel, InputGroup, InputRightElement
} from '@chakra-ui/react';
import { FaPlus, FaMicrophone, FaSearch, FaEye } from 'react-icons/fa';
import { supabase } from '../supabaseClient';

const SAD_STATUS = ['In Progress', 'On Hold', 'Completed'];
const SAD_DOCS_BUCKET = 'sad-docs';

export default function SADDeclaration() {
  const toast = useToast();

  // form
  const [sadNo, setSadNo] = useState('');
  const [regime, setRegime] = useState('');
  const [declaredWeight, setDeclaredWeight] = useState('');
  const [docs, setDocs] = useState([]); // File objects

  // list
  const [sads, setSads] = useState([]);
  const [loading, setLoading] = useState(false);

  // modal / detail
  const [selectedSad, setSelectedSad] = useState(null);
  const [detailTickets, setDetailTickets] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // doc viewer
  const [docViewer, setDocViewer] = useState({ open: false, doc: null });

  // NL search
  const [nlQuery, setNlQuery] = useState('');
  const [nlLoading, setNlLoading] = useState(false);

  // voice
  const recognitionRef = useRef(null);
  const [listening, setListening] = useState(false);

  // activity timeline (local)
  const [activity, setActivity] = useState([]);

  // fetch declared SADs
  const fetchSADs = async (filter = null) => {
    setLoading(true);
    try {
      let q = supabase.from('sad_declarations').select('*').order('created_at', { ascending: false });
      if (filter) {
        if (filter.status) q = q.eq('status', filter.status);
        if (filter.sad_no) q = q.eq('sad_no', filter.sad_no);
        if (filter.regime) q = q.ilike('regime', `%${filter.regime}%`);
      }
      const { data, error } = await q;
      if (error) throw error;
      setSads(data || []);
    } catch (err) {
      console.error('fetchSADs', err);
      toast({ title: 'Failed to load SADs', description: err?.message || 'Unexpected', status: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSADs(); }, []);

  // helper: activity push (local + optional DB)
  const pushActivity = async (text, meta = {}) => {
    const ev = { time: new Date().toISOString(), text, meta };
    setActivity(prev => [ev, ...prev].slice(0, 100));
    try {
      await supabase.from('sad_activity').insert([{ text, meta }]);
    } catch (e) {
      // ignore DB errors
    }
  };

  // Open document in viewer modal
  const openDocViewer = (doc) => {
    setDocViewer({ open: true, doc });
  };

  // upload docs to storage and return array of URLs + tags (OCR removed)
  const uploadDocs = async (sad_no, files = []) => {
    if (!files || files.length === 0) return [];
    const uploaded = [];

    for (const f of files) {
      const key = `sad-${sad_no}/${Date.now()}-${f.name.replace(/\s+/g, '_')}`;

      // upload
      const { data, error } = await supabase.storage.from(SAD_DOCS_BUCKET).upload(key, f, { cacheControl: '3600', upsert: false });
      if (error) {
        console.warn('upload doc failed', error);
        throw error;
      }
      const filePath = data?.path ?? data?.Key ?? key;

      // get URL (tolerant to SDK shapes)
      let url = null;
      try {
        const getPublic = await supabase.storage.from(SAD_DOCS_BUCKET).getPublicUrl(filePath);
        const publicUrl =
          (getPublic?.data && (getPublic.data.publicUrl || getPublic.data.publicURL)) ??
          getPublic?.publicURL ??
          null;

        if (publicUrl) {
          url = publicUrl;
        } else {
          const signedResp = await supabase.storage.from(SAD_DOCS_BUCKET).createSignedUrl(filePath, 60 * 60 * 24 * 7);
          const signedUrl =
            (signedResp?.data && (signedResp.data.signedUrl || signedResp.data.signedURL)) ??
            signedResp?.signedUrl ??
            signedResp?.signedURL ??
            null;
          if (!signedUrl) throw new Error('Could not obtain public or signed URL for uploaded file.');
          url = signedUrl;
        }
      } catch (uErr) {
        console.warn('Getting URL failed', uErr);
        throw uErr;
      }

      // No OCR/analysis performed here (removed). Keep tags empty for now.
      uploaded.push({ name: f.name, path: filePath, url, tags: [], parsed: null });
      await pushActivity(`Uploaded doc ${f.name} for SAD ${sad_no}`, { sad_no, file: f.name });
    }

    return uploaded;
  };

  // create SAD record
  const handleCreateSAD = async () => {
    if (!sadNo || !declaredWeight) {
      toast({ title: 'Missing values', description: 'Provide SAD number and declared weight', status: 'warning' });
      return;
    }
    setLoading(true);
    try {
      const docRecords = await uploadDocs(sadNo, docs);

      const payload = {
        sad_no: sadNo,
        regime: regime || null,
        declared_weight: Number(declaredWeight),
        docs: docRecords,
        status: 'In Progress',
      };

      const { error } = await supabase.from('sad_declarations').insert([payload]);
      if (error) throw error;
      toast({ title: 'SAD registered', description: `SAD ${sadNo} created`, status: 'success' });
      await pushActivity(`Created SAD ${sadNo}`);
      setSadNo(''); setRegime(''); setDeclaredWeight(''); setDocs([]);
      fetchSADs();
    } catch (err) {
      console.error('create SAD', err);
      toast({ title: 'Failed', description: err?.message || 'Could not create SAD', status: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // fetch tickets for SAD detail
  const openSadDetail = async (sad) => {
    setSelectedSad(sad);
    setIsModalOpen(true);
    setDetailLoading(true);
    try {
      const { data, error } = await supabase.from('tickets').select('*').eq('sad_no', sad.sad_no).order('date', { ascending: false });
      if (error) throw error;
      setDetailTickets(data || []);
      await pushActivity(`Viewed SAD ${sad.sad_no} details`);
    } catch (err) {
      console.error('openSadDetail', err);
      toast({ title: 'Failed to load tickets', description: err?.message || 'Unexpected', status: 'error' });
      setDetailTickets([]);
    } finally {
      setDetailLoading(false);
    }
  };

  // update SAD status (manual)
  const updateSadStatus = async (sad_no, newStatus) => {
    try {
      const { error } = await supabase.from('sad_declarations').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('sad_no', sad_no);
      if (error) throw error;
      toast({ title: 'Status updated', description: `${sad_no} status set to ${newStatus}`, status: 'success' });
      await pushActivity(`Status of ${sad_no} set to ${newStatus}`);
      fetchSADs();
      if (selectedSad && selectedSad.sad_no === sad_no) openSadDetail({ sad_no });
    } catch (err) {
      console.error('updateSadStatus', err);
      toast({ title: 'Update failed', description: err?.message || 'Unexpected', status: 'error' });
    }
  };

  // recalc totals (client fallback)
  const recalcTotalForSad = async (sad_no) => {
    try {
      const { data: tickets, error } = await supabase.from('tickets').select('net, weight').eq('sad_no', sad_no);
      if (error) throw error;
      const total = (tickets || []).reduce((s, r) => s + Number(r.net ?? r.weight ?? 0), 0);
      await supabase.from('sad_declarations').update({ total_recorded_weight: total, updated_at: new Date().toISOString() }).eq('sad_no', sad_no);
      await pushActivity(`Recalculated total for ${sad_no}: ${total}`);
      fetchSADs();
      toast({ title: 'Recalculated', description: `Total recorded ${total.toLocaleString()}`, status: 'success' });
      const row = (await supabase.from('sad_declarations').select('declared_weight').eq('sad_no', sad_no)).data?.[0];
      if (row) {
        const declared = Number(row.declared_weight || 0);
        const diff = Math.abs(declared - total);
        if (declared > 0 && (diff / declared) < 0.01) {
          await updateSadStatus(sad_no, 'Completed');
        }
      }
    } catch (err) {
      console.error('recalcTotalForSad', err);
      toast({ title: 'Could not recalc', description: err?.message || 'Unexpected', status: 'error' });
    }
  };

  // indicator color by discrepancy
  const getIndicator = (declared, recorded) => {
    const d = Number(declared || 0);
    const r = Number(recorded || 0);
    if (!d) return 'gray';
    const ratio = r / d;
    if (Math.abs(r - d) / Math.max(1, d) < 0.01) return 'green';
    if (ratio > 1.15 || ratio < 0.85) return 'red';
    if (ratio > 1.05 || ratio < 0.95) return 'yellow';
    return 'orange';
  };

  // handle file change (OCR removed) — just attach files for upload
  const onFilesChange = async (fileList) => {
    try {
      const arr = Array.from(fileList || []);
      setDocs(arr);
      toast({ title: 'Files attached', description: `${arr.length} file(s) attached — OCR/analysis disabled`, status: 'info', duration: 4000 });
    } catch (e) {
      console.warn('onFilesChange', e);
      toast({ title: 'File attach error', description: e?.message || 'Could not attach files', status: 'error' });
    }
  };

  // Natural-language-ish search (local, simple rules)
  const runNlQuery = async () => {
    if (!nlQuery) return fetchSADs();
    setNlLoading(true);
    try {
      const q = nlQuery.toLowerCase();
      const filter = {};

      if (/\bcompleted\b/.test(q)) filter.status = 'Completed';
      else if (/\bin progress\b/.test(q) || /\binprogress\b/.test(q)) filter.status = 'In Progress';
      else if (/\bon hold\b/.test(q)) filter.status = 'On Hold';

      // if query contains a number, treat as SAD number
      const num = q.match(/\b(\d{1,10})\b/);
      if (num) filter.sad_no = num[1];

      // otherwise fallback to regime substring search
      if (!filter.sad_no && !filter.status) filter.regime = nlQuery;

      await fetchSADs(filter);
      await pushActivity(`Search: "${nlQuery}"`, filter);
    } catch (e) {
      console.error('NL query failed', e);
      toast({ title: 'Search failed', description: e?.message || 'Unexpected', status: 'error' });
    } finally {
      setNlLoading(false);
    }
  };

  // voice commands (Web Speech API)
  const startListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast({ title: 'Voice not supported', description: 'Your browser does not have SpeechRecognition', status: 'warning' });
      return;
    }
    const rec = new SpeechRecognition();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = async (e) => {
      const text = e.results[0][0].transcript;
      setNlQuery(text);
      await runNlQuery();
      setListening(false);
      rec.stop();
    };
    rec.onerror = (err) => {
      console.warn('Voice err', err);
      toast({ title: 'Voice error', description: err.error || 'Failed to record', status: 'error' });
      setListening(false);
    };
    rec.onend = () => setListening(false);
    rec.start();
    recognitionRef.current = rec;
    setListening(true);
  };

  // Local, non-AI explain discrepancy
  const handleExplainDiscrepancy = async (s) => {
    const recorded = Number(s.total_recorded_weight || 0);
    const declared = Number(s.declared_weight || 0);
    if (!declared) {
      toast({ title: 'No declared weight', description: `SAD ${s.sad_no} has no declared weight to compare.`, status: 'warning' });
      await pushActivity(`Explain: no declared weight for ${s.sad_no}`);
      return;
    }
    const diff = recorded - declared;
    const pct = ((diff / declared) * 100).toFixed(2);
    let msg = '';
    if (Math.abs(diff) / Math.max(1, declared) < 0.01) {
      msg = `Recorded matches declared within 1% (${recorded} kg vs ${declared} kg).`;
    } else if (diff > 0) {
      msg = `Recorded is ${diff.toLocaleString()} kg (${pct}%) higher than declared — investigate extra tickets or duplicates.`;
    } else {
      msg = `Recorded is ${Math.abs(diff).toLocaleString()} kg (${Math.abs(pct)}%) lower than declared — check missing tickets or document mismatch.`;
    }
    toast({ title: `Discrepancy for ${s.sad_no}`, description: msg, status: 'info', duration: 10000 });
    await pushActivity(`Explained discrepancy for ${s.sad_no}: ${msg}`);
  };

  // tiny predictive analytics: compute expected total by using average of past SADs in same regime
  const getPredictedTotal = (sad) => {
    if (!sads || !sad?.regime) return null;
    const peers = sads.filter(x => x.regime === sad.regime && x.total_recorded_weight).map(x => Number(x.total_recorded_weight));
    if (!peers.length) return null;
    const avg = peers.reduce((a, b) => a + b, 0) / peers.length;
    return Math.round(avg);
  };

  // UI render
  return (
    <Container maxW="7xl" py={6}>
      <Heading mb={4}>SAD Declaration</Heading>

      <Box bg="white" p={4} borderRadius="md" boxShadow="sm" mb={6}>
        <Text fontWeight="semibold" mb={2}>Register a new SAD</Text>
        <SimpleGrid columns={{ base: 1, md: 4 }} spacing={3}>
          <FormControl>
            <FormLabel>SAD Number</FormLabel>
            <InputGroup>
              <Input value={sadNo} onChange={(e) => setSadNo(e.target.value)} placeholder="e.g. 25" />
              <InputRightElement width="6rem">
                <Button size="sm" onClick={() => { setSadNo(''); setRegime(''); setDeclaredWeight(''); setDocs([]); }}>Clear</Button>
              </InputRightElement>
            </InputGroup>
          </FormControl>

          <FormControl>
            <FormLabel>Regime / Declaration Type</FormLabel>
            <Input value={regime} onChange={(e) => setRegime(e.target.value)} placeholder="e.g. Import" />
          </FormControl>

          <FormControl>
            <FormLabel>Declared Total Weight (kg)</FormLabel>
            <Input type="number" value={declaredWeight} onChange={(e) => setDeclaredWeight(e.target.value)} placeholder="e.g. 100000" />
          </FormControl>

          <FormControl>
            <FormLabel>Attach Docs</FormLabel>
            <Input type="file" multiple onChange={(e) => onFilesChange(e.target.files)} />
            <Text fontSize="sm" color="gray.500" mt={1}>{docs.length} file(s) selected</Text>
          </FormControl>
        </SimpleGrid>

        <HStack mt={3}>
          <Button colorScheme="teal" leftIcon={<FaPlus />} onClick={handleCreateSAD} isLoading={loading}>Register SAD</Button>
          <Button onClick={() => { setSadNo(''); setRegime(''); setDeclaredWeight(''); setDocs([]); }}>Reset</Button>
        </HStack>
      </Box>

      <Box bg="white" p={4} borderRadius="md" boxShadow="sm" mb={6}>
        <Flex justify="space-between" align="center" mb={3}>
          <Heading size="sm">SAD Dashboard</Heading>
          <HStack>
            <InputGroup size="sm" width="360px">
              <Input placeholder="Search e.g. 'completed imports last week' or SAD number" value={nlQuery} onChange={(e) => setNlQuery(e.target.value)} />
              <InputRightElement>
                <IconButton size="sm" icon={<FaSearch />} aria-label="Search" onClick={runNlQuery} isLoading={nlLoading} />
                <IconButton ml={2} size="sm" title="Voice" icon={<FaMicrophone />} onClick={startListening} isLoading={listening} />
              </InputRightElement>
            </InputGroup>
          </HStack>
        </Flex>

        {loading ? <Spinner /> : (
          <Table size="sm" variant="striped">
            <Thead>
              <Tr>
                <Th>SAD</Th>
                <Th>Regime</Th>
                <Th isNumeric>Declared (kg)</Th>
                <Th isNumeric>Recorded (kg)</Th>
                <Th>Status</Th>
                <Th>Docs</Th>
                <Th>Actions</Th>
                <Th>AI</Th>
              </Tr>
            </Thead>
            <Tbody>
              {sads.map((s) => {
                const predicted = getPredictedTotal(s);
                return (
                  <Tr key={s.sad_no}>
                    <Td>{s.sad_no}</Td>
                    <Td>{s.regime || '—'}</Td>
                    <Td isNumeric>{Number(s.declared_weight || 0).toLocaleString()}</Td>
                    <Td isNumeric>{Number(s.total_recorded_weight || 0).toLocaleString()}</Td>
                    <Td>
                      <HStack>
                        <Box width="10px" height="10px" borderRadius="full" bg={getIndicator(s.declared_weight, s.total_recorded_weight)} />
                        <Text>{s.status}</Text>
                        {predicted && <Badge colorScheme="purple">Pred: {predicted.toLocaleString()}</Badge>}
                      </HStack>
                    </Td>
                    <Td>
                      {(s.docs || []).length ? (
                        <VStack align="start">
                          {(s.docs || []).map((d, i) => (
                            <HStack key={i}>
                              <a href={d.url || '#'} target="_blank" rel="noreferrer">{d.name || d.path || 'doc'}</a>
                              {d.tags?.map((t, j) => <Tag size="sm" key={j}><TagLabel>{t}</TagLabel></Tag>)}
                              <IconButton size="xs" icon={<FaEye />} aria-label="view" onClick={() => openDocViewer(d)} />
                            </HStack>
                          ))}
                        </VStack>
                      ) : <Text color="gray.500">—</Text>}
                    </Td>
                    <Td>
                      <HStack>
                        <Button size="sm" onClick={() => openSadDetail(s)}>View</Button>
                        <Select size="sm" value={s.status} onChange={(e) => updateSadStatus(s.sad_no, e.target.value)}>
                          {SAD_STATUS.map(st => <option key={st} value={st}>{st}</option>)}
                        </Select>
                        <Button size="sm" onClick={() => recalcTotalForSad(s.sad_no)}>Recalc</Button>
                      </HStack>
                    </Td>
                    <Td>
                      <VStack align="start">
                        <Button size="xs" onClick={() => handleExplainDiscrepancy(s)}>Explain</Button>
                        <Button size="xs" onClick={() => pushActivity(`Manual check requested for ${s.sad_no}`)}>Log Check</Button>
                      </VStack>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        )}
      </Box>

      {/* SAD detail modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} size="xl" scrollBehavior="inside">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>SAD {selectedSad?.sad_no}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {selectedSad && (
              <>
                <Text mb={2}>Declared weight: <strong>{Number(selectedSad.declared_weight || 0).toLocaleString()} kg</strong></Text>
                <Text mb={2}>Recorded weight: <strong>{Number(selectedSad.total_recorded_weight || 0).toLocaleString()} kg</strong></Text>
                <Text mb={4}>Status: <strong>{selectedSad.status}</strong></Text>

                <Heading size="sm" mb={2}>Tickets for this SAD</Heading>
                {detailLoading ? <Text>Loading...</Text> : (
                  <Table size="sm">
                    <Thead>
                      <Tr><Th>Ticket</Th><Th>Truck</Th><Th isNumeric>Net (kg)</Th><Th>Date</Th></Tr>
                    </Thead>
                    <Tbody>
                      {detailTickets.map(t => (
                        <Tr key={t.ticket_id || t.ticket_no}>
                          <Td>{t.ticket_no}</Td>
                          <Td>{t.gnsw_truck_no}</Td>
                          <Td isNumeric>{Number(t.net ?? t.weight ?? 0).toLocaleString()}</Td>
                          <Td>{t.date ? new Date(t.date).toLocaleString() : '—'}</Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                )}
              </>
            )}
          </ModalBody>
          <ModalFooter>
            <Button onClick={() => setIsModalOpen(false)}>Close</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Doc Viewer modal */}
      <Modal isOpen={docViewer.open} onClose={() => setDocViewer({ open: false, doc: null })} size="xl" scrollBehavior="inside">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Document Viewer</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {docViewer.doc ? (
              <>
                <Text mb={2}><strong>{docViewer.doc.name}</strong></Text>
                {/\.(jpe?g|png|gif|bmp|webp)$/i.test(docViewer.doc.url) ? (
                  <img src={docViewer.doc.url} alt={docViewer.doc.name} style={{ maxWidth: '100%' }} />
                ) : (
                  <iframe title="doc" src={docViewer.doc.url} style={{ width: '100%', height: '70vh' }} />
                )}
                <Box mt={3}>
                  {(docViewer.doc.tags || []).map((t, i) => <Tag key={i} mr={2}><TagLabel>{t}</TagLabel></Tag>)}
                </Box>
              </>
            ) : <Text>No doc</Text>}
          </ModalBody>
          <ModalFooter>
            <Button onClick={() => setDocViewer({ open: false, doc: null })}>Close</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Activity timeline */}
      <Box mt={6} bg="white" p={4} borderRadius="md" boxShadow="sm">
        <Heading size="sm">Activity (recent)</Heading>
        <VStack align="start" mt={3}>
          {activity.length ? activity.map((a, i) => (
            <Box key={i} width="100%" borderBottom="1px solid" borderColor="gray.100" py={2}>
              <Text fontSize="sm">{a.text}</Text>
              <Text fontSize="xs" color="gray.500">{new Date(a.time).toLocaleString()}</Text>
            </Box>
          )) : <Text color="gray.500">No activity yet</Text>}
        </VStack>
      </Box>
    </Container>
  );
}
