import React, { useState, useEffect, useMemo } from 'react';
import {
  Box, Heading, VStack, HStack, Select, Checkbox, Button,
  Table, Thead, Tbody, Tr, Th, Td, Tooltip, IconButton, Text,
  useColorModeValue, useDisclosure, Modal, ModalOverlay, ModalContent,
  ModalHeader, ModalBody, ModalFooter, ModalCloseButton, Skeleton,
  useToast, Input
} from '@chakra-ui/react';
import { FaFileExport, FaEye, FaCheck, FaTimes } from 'react-icons/fa';

const PAGE_SIZE = 10;
const sampleValidations = [
  {
    id: 'DV-2001',
    dateTime: '2025-08-02 08:30',
    status: 'Pending',
    officer: 'Alice',
    documents: 'Invoice.pdf, PackingList.pdf',
    cargoId: 'CI-001',
  },
  {
    id: 'DV-2002',
    dateTime: '2025-08-02 09:00',
    status: 'Validated',
    officer: 'Bob',
    documents: 'BL.pdf',
    cargoId: 'CI-002',
    signature: 'Bob Smith'
  },
  {
    id: 'DV-2003',
    dateTime: '2025-08-02 09:30',
    status: 'Rejected',
    officer: 'John Doe',
    documents: 'Empty',
    cargoId: 'CI-003',
  },
];

export default function DigitalValidation() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterOfficer, setFilterOfficer] = useState('all');
  const [sortKey, setSortKey] = useState(null);
  const [sortOrder, setSortOrder] = useState(null);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState([]);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [officerSignature, setOfficerSignature] = useState('');
  const toast = useToast();

  const bgRemarks = useColorModeValue('gray.100','gray.700');
  const tableBg = useColorModeValue('gray.50','gray.700');
  const theadBg = useColorModeValue('gray.100','gray.600');

  const statuses = useMemo(() => [...new Set(records.map(r=>r.status))], [records]);
  const officers = useMemo(() => [...new Set(records.map(r=>r.officer))], [records]);

  useEffect(() => {
    setLoading(true);
    setTimeout(()=>{
      setRecords(sampleValidations);
      setLoading(false);
    }, 800)
  }, []);

  const filtered = useMemo(()=>
    records.filter(r=>
      (filterStatus==='all'||r.status===filterStatus) &&
      (filterOfficer==='all'||r.officer===filterOfficer)
    ), [records,filterStatus,filterOfficer]);

  const sorted = useMemo(()=>{
    if (!sortKey) return filtered;
    const s = [...filtered].sort((a,b)=>{
      const aV=a[sortKey], bV=b[sortKey];
      if (aV < bV) return -1;
      if (aV > bV) return 1;
      return 0;
    });
    if (sortOrder==='desc') s.reverse();
    return s;
  }, [filtered,sortKey,sortOrder]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRecords = useMemo(()=>sorted.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE), [sorted,page]);

  const toggleSelectAll = () => {
    if (selectedIds.length===pageRecords.length) setSelectedIds([]);
    else setSelectedIds(pageRecords.map(r=>r.id));
  };
  const toggleSelectOne = id => {
    setSelectedIds(sel=>sel.includes(id)?sel.filter(x=>x!==id):[...sel,id])
  };

  const handleSort = key => {
    if (sortKey===key) {
      if (sortOrder==='asc') setSortOrder('desc');
      else if (sortOrder==='desc') {setSortKey(null); setSortOrder(null);}
      else setSortOrder('asc');
    } else { setSortKey(key); setSortOrder('asc'); }
  };
  const getSortDirection = key => sortKey===key?sortOrder:null;
  const renderSortIcon = key => getSortDirection(key)==='asc'?<FaCheck/>:getSortDirection(key)==='desc'?<FaTimes/>:null;

  const exportCSV = all => {
    const data = all? sorted : records.filter(r=>selectedIds.includes(r.id));
    if (!data.length) {toast({title:'No data',status:'info',duration:2000});return;}
    const header=['ID','Date/Time','Status','Officer','Cargo ID','Documents','Signature'];
    const rows = data.map(r=>[r.id,r.dateTime,r.status,r.officer,r.cargoId,r.documents,r.signature || '']);
    let csv='data:text/csv;charset=utf-8,'+[header.join(','),...rows.map(r=>r.join(','))].join('\n');
    const link=document.createElement('a');
    link.href=encodeURI(csv); link.download=all?'digital_validations_all.csv':'digital_validations_selected.csv';
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const handleViewDetails = r => {
    setSelectedRecord(r);
    setOfficerSignature(r.signature || '');
    onOpen();
  };

  const handleValidate = () => {
    if (!officerSignature.trim()) {
      toast({ title: 'Signature is required', status: 'warning', duration: 2000 });
      return;
    }

    setRecords(prev =>
      prev.map(r =>
        r.id === selectedRecord.id
          ? { ...r, status: 'Validated', signature: officerSignature }
          : r
      )
    );
    setSelectedRecord(r => ({ ...r, status: 'Validated', signature: officerSignature }));
    toast({ title: 'Validated with Signature', status: 'success', duration: 2000 });
  };

  const handleReject = () => {
    setRecords(prev =>
      prev.map(r =>
        r.id === selectedRecord.id
          ? { ...r, status: 'Rejected' }
          : r
      )
    );
    setSelectedRecord(r => ({ ...r, status: 'Rejected' }));
    toast({ title: 'Rejected', status: 'error', duration: 2000 });
  };

  return (
    <Box p={4}>
      <Heading as="h1" size="xl" mb={6}>Digital Validation</Heading>

      {/* Filters & bulk */}
      <VStack mb={4} align="stretch">
        <HStack justify="space-between" flexWrap="wrap">
          <HStack spacing={3}>
            <Select placeholder="Status" value={filterStatus} onChange={e=>{setFilterStatus(e.target.value);setPage(1)}}>
              <option value="all">All Statuses</option>
              {statuses.map(s=><option key={s} value={s}>{s}</option>)}
            </Select>
            <Select placeholder="Officer" value={filterOfficer} onChange={e=>{setFilterOfficer(e.target.value);setPage(1)}}>
              <option value="all">All Officers</option>
              {officers.map(o=><option key={o} value={o}>{o}</option>)}
            </Select>
          </HStack>
          <HStack spacing={3}>
            <Button size="sm" onClick={()=>exportCSV(true)} leftIcon={<FaFileExport/>}>Export All</Button>
            <Button size="sm" onClick={()=>exportCSV(false)} leftIcon={<FaFileExport/>} isDisabled={!selectedIds.length}>Export Selected</Button>
          </HStack>
        </HStack>
      </VStack>

      {/* Table */}
      <Box overflowX="auto" bg={tableBg} borderRadius="md">
        <Table variant="striped" size="sm" aria-label="Digital validation records table">
          <Thead bg={theadBg}>
            <Tr>
              <Th><Checkbox isChecked={selectedIds.length===pageRecords.length} isIndeterminate={selectedIds.length>0 && selectedIds.length<pageRecords.length} onChange={toggleSelectAll} aria-label="Select all"/></Th>
              {['id','dateTime','status','officer','cargoId','documents'].map(key=>(
                <Th key={key} cursor="pointer" onClick={()=>key==='id'||key==='dateTime'?handleSort(key):undefined} aria-sort={getSortDirection(key)||'none'}>
                  {key.charAt(0).toUpperCase()+key.slice(1)} {renderSortIcon(key)}
                </Th>
              ))}
              <Th>Actions</Th>
            </Tr>
          </Thead>
          <Tbody>
            {loading?
              Array(PAGE_SIZE).fill().map((_,i)=>(
                <Tr key={i}><Td colSpan={8}><Skeleton /></Td></Tr>
              )) :
              pageRecords.length? pageRecords.map(r=>(
                <Tr key={r.id}>
                  <Td><Checkbox isChecked={selectedIds.includes(r.id)} onChange={()=>toggleSelectOne(r.id)} aria-label={`Select ${r.id}`}/></Td>
                  <Td>{r.id}</Td><Td>{r.dateTime}</Td><Td>{r.status}</Td><Td>{r.officer}</Td><Td>{r.cargoId}</Td><Td><Box maxH="50px" overflowY="auto" p={1} bg={bgRemarks}>{r.documents}</Box></Td>
                  <Td><Tooltip label="View details"><IconButton aria-label="View" icon={<FaEye/>} size="sm" onClick={()=>handleViewDetails(r)}/></Tooltip></Td>
                </Tr>
              )) : (<Tr><Td colSpan={8} align="center">No records found.</Td></Tr>)
            }
          </Tbody>
        </Table>
      </Box>

      {/* Pagination */}
      <HStack mt={4} spacing={3} justify="center">
        <Button size="sm" onClick={()=>setPage(1)} isDisabled={page===1} aria-label="First">{'<<'}</Button>
        <Button size="sm" onClick={()=>setPage(p=>Math.max(1,p-1))} isDisabled={page===1} aria-label="Prev">{'<'}</Button>
        <Text>Page {page} of {totalPages}</Text>
        <Button size="sm" onClick={()=>setPage(p=>Math.min(totalPages,p+1))} isDisabled={page===totalPages} aria-label="Next">{'>'}</Button>
        <Button size="sm" onClick={()=>setPage(totalPages)} isDisabled={page===totalPages} aria-label="Last">{'>>'}</Button>
      </HStack>

      {/* Details Modal */}
      <Modal isOpen={isOpen} onClose={onClose} isCentered size="lg">
        <ModalOverlay/>
        <ModalContent>
          <ModalHeader>Validation Details</ModalHeader>
          <ModalCloseButton/>
          <ModalBody>
            {selectedRecord?(
              <VStack align="start" spacing={3}>
                <Text><b>ID:</b> {selectedRecord.id}</Text>
                <Text><b>Date/Time:</b> {selectedRecord.dateTime}</Text>
                <Text><b>Status:</b> {selectedRecord.status}</Text>
                <Text><b>Officer:</b> {selectedRecord.officer}</Text>
                <Text><b>Cargo ID:</b> {selectedRecord.cargoId}</Text>
                <Text><b>Documents:</b></Text>
                <Box bg={bgRemarks} p={2} borderRadius="md" w="100%" whiteSpace="pre-wrap">{selectedRecord.documents}</Box>
                {selectedRecord.signature && (
                  <Text><b>Signature:</b> {selectedRecord.signature}</Text>
                )}
              </VStack>
            ):<Text>No validation selected.</Text>}
          </ModalBody>
          <ModalFooter flexDirection="column" alignItems="stretch">
            <Box mb={3} w="100%">
              <Text mb={1}><strong>Officer Signature (name):</strong></Text>
              <Input
                placeholder="Enter your name"
                value={officerSignature}
                onChange={(e) => setOfficerSignature(e.target.value)}
              />
            </Box>
            <HStack justify="flex-end">
              <Button colorScheme="green" leftIcon={<FaCheck/>} onClick={handleValidate}
                isDisabled={!selectedRecord || selectedRecord.status === 'Validated'}>
                Validate
              </Button>
              <Button colorScheme="red" leftIcon={<FaTimes/>} onClick={handleReject}
                isDisabled={!selectedRecord || selectedRecord.status === 'Rejected'}>
                Reject
              </Button>
              <Button onClick={onClose}>Close</Button>
            </HStack>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
}
