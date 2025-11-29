// src/pages/Drivers.jsx
import React, { useEffect, useState, useRef } from 'react';
import {
  Box, Container, Heading, Input, Button, IconButton, Text, SimpleGrid,
  VStack, HStack, FormControl, FormLabel, Modal, ModalOverlay, ModalContent,
  ModalHeader, ModalBody, ModalFooter, ModalCloseButton, useDisclosure,
  Avatar, Table, Thead, Tbody, Tr, Th, Td, Select, Spinner, useToast,
  Badge, Flex, Stack, Tooltip, Image, AlertDialog, AlertDialogOverlay,
  AlertDialogContent, AlertDialogHeader, AlertDialogBody, AlertDialogFooter,
  useBreakpointValue, VisuallyHidden
} from '@chakra-ui/react';
import { motion, AnimatePresence } from 'framer-motion';
import { AddIcon, SearchIcon, DeleteIcon, EditIcon } from '@chakra-ui/icons';
import { FaCamera, FaUpload, FaChevronLeft, FaChevronRight, FaEye, FaBan } from 'react-icons/fa';
import { supabase } from '../supabaseClient';

const MotionBox = motion(Box);

function DriversPage() {
  const toast = useToast();

  // UI + data state
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  // search & filters
  const [qName, setQName] = useState('');
  const [qPhone, setQPhone] = useState('');
  const [qLicense, setQLicense] = useState('');

  // pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);

  // create modal / form state (floating orb)
  const { isOpen: isCreateOpen, onOpen: onCreateOpen, onClose: onCreateClose } = useDisclosure();
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '+220', license_number: '' });
  const [pictureFile, setPictureFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const createFileRef = useRef();

  // view modal (open from action)
  const { isOpen: isViewOpen, onOpen: onViewOpen, onClose: onViewClose } = useDisclosure();
  const [viewDriver, setViewDriver] = useState(null);
  const [isEditingInView, setIsEditingInView] = useState(false);
  const viewFileRef = useRef();
  const [viewPictureFile, setViewPictureFile] = useState(null);
  const [viewPreviewUrl, setViewPreviewUrl] = useState(null);
  const [isUpdatingView, setIsUpdatingView] = useState(false);

  // suspend confirmation dialog
  const { isOpen: isSuspendOpen, onOpen: onSuspendOpen, onClose: onSuspendClose } = useDisclosure();
  const suspendTargetRef = useRef(null);
  const suspendCancelRef = useRef();

  // update confirmation (for saving edits inside view modal)
  const { isOpen: isUpdateConfirmOpen, onOpen: onUpdateConfirmOpen, onClose: onUpdateConfirmClose } = useDisclosure();
  const updateCancelRef = useRef();

  // responsive values
  const modalSize = useBreakpointValue({ base: 'full', md: 'lg' });
  const avatarSize = useBreakpointValue({ base: 'lg', md: 'xl' });
  const gridCols = useBreakpointValue({ base: 1, md: 2, lg: 3 });
  const isMobile = useBreakpointValue({ base: true, md: false });

  // small style injection for visual polish (glass + orb)
  useEffect(() => {
    const css = `
      .drivers-container { background: radial-gradient(circle at 10% 10%, rgba(99,102,241,0.03), transparent 10%), linear-gradient(180deg,#f0f9ff 0%, #ffffff 60%); padding-bottom: 120px; }
      .glass-card { background: linear-gradient(180deg, rgba(255,255,255,0.88), rgba(255,255,255,0.7)); border-radius: 14px; border: 1px solid rgba(2,6,23,0.06); box-shadow: 0 10px 40px rgba(2,6,23,0.06); padding: 14px; }
      .panel-3d { perspective: 1400px; }
      .panel-3d .card { transform-style: preserve-3d; transition: transform 0.6s ease, box-shadow 0.6s ease; border-radius: 12px; }
      @media (min-width:1600px) {
        .panel-3d .card:hover { transform: rotateY(6deg) rotateX(3deg) translateZ(8px); box-shadow: 0 30px 80px rgba(2,6,23,0.12); }
      }
      .floating-orb { position: fixed; right: 20px; bottom: 20px; z-index: 2200; cursor: pointer; }
      .orb { width:64px;height:64px;border-radius:999px;display:flex;align-items:center;justify-content:center; box-shadow: 0 10px 30px rgba(59,130,246,0.18), inset 0 -6px 18px rgba(62,180,200,0.08); background: linear-gradient(90deg,#7b61ff,#3ef4d0); color: #fff; font-weight:700; }
      .spark { width:18px; height:18px; border-radius:999px; background: radial-gradient(circle at 30% 30%, #fff, rgba(255,255,255,0.12)); }
      .muted { color: #6b7280; }
      .suspended-badge { background: rgba(220,38,38,0.06); color: #dc2626; padding: 4px 8px; border-radius: 6px; font-weight: 600; font-size: 0.8rem; }
    `;
    const id = 'drivers-page-styles';
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('style');
      el.id = id;
      el.innerHTML = css;
      document.head.appendChild(el);
    } else {
      el.innerHTML = css;
    }
    return () => {
      const e = document.getElementById(id);
      if (e) e.remove();
    };
  }, []);

  // fetch drivers (server-side pagination + filters)
  const fetchDrivers = async (pageNum = page, size = pageSize) => {
    setLoading(true);
    try {
      const from = (pageNum - 1) * size;
      const to = from + size - 1;

      let query = supabase.from('drivers').select('*', { count: 'exact' });

      if (qName && qName.trim()) query = query.ilike('name', `%${qName.trim()}%`);
      if (qPhone && qPhone.trim()) query = query.ilike('phone', `%${qPhone.trim()}%`);
      if (qLicense && qLicense.trim()) query = query.ilike('license_number', `%${qLicense.trim()}%`);

      query = query.order('created_at', { ascending: false }).range(from, to);

      const { data, error, count } = await query;
      if (error) throw error;
      setDrivers(data || []);
      setTotalCount(Number(count || 0));
    } catch (err) {
      console.error('fetchDrivers error', err);
      toast({ status: 'error', title: 'Failed to fetch drivers', description: err?.message || String(err) });
    } finally {
      setLoading(false);
    }
  };

  // initial fetch & watch filters/pageSize
  useEffect(() => {
    fetchDrivers(1, pageSize);
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qName, qPhone, qLicense, pageSize]);

  useEffect(() => {
    fetchDrivers(page, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // helpers: upload picture to storage 'drivers' and return public URL or path
  async function uploadDriverPicture(file, driverId) {
    if (!file) return null;
    const ext = (file.name || '').split('.').pop() || 'jpg';
    const filename = `${driverId || Date.now()}-${Math.floor(Math.random() * 9000) + 1000}.${ext}`;
    const path = `photos/${filename}`;

    try {
      const uploadRes = await supabase.storage.from('drivers').upload(path, file, { upsert: true, contentType: file.type });
      if (uploadRes.error) {
        // if already exists due to race, continue
        console.warn('upload driver picture error', uploadRes.error);
      }
      // Attempt public URL
      try {
        const { data } = supabase.storage.from('drivers').getPublicUrl(path);
        if (data?.publicUrl) return data.publicUrl;
      } catch (e) {
        // fallback to signed url
      }
      try {
        const { data: signedData, error: signedErr } = await supabase.storage.from('drivers').createSignedUrl(path, 60 * 60);
        if (!signedErr && signedData?.signedUrl) return signedData.signedUrl;
      } catch (e) {
        console.warn('signed url failed', e);
      }
      // return path as fallback so server-side can resolve later
      return path;
    } catch (e) {
      console.error('uploadDriverPicture failed', e);
      return null;
    }
  }

  // confetti helper (load dynamically)
  async function triggerConfetti(count = 120) {
    try {
      if (typeof window !== 'undefined' && !window.confetti) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.5.1/dist/confetti.browser.min.js';
          s.onload = () => resolve();
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      if (window.confetti) {
        window.confetti({ particleCount: Math.min(count, 300), spread: 160, origin: { y: 0.6 } });
      }
    } catch (e) {
      console.debug('confetti load failed', e);
    }
  }

  // ---------- small helper to detect unique-phone DB errors ----------
  function isPhoneDuplicateError(err) {
    if (!err) return false;
    // supabase error object sometimes has `code`, `message`. For Postgres unique violation code is '23505'.
    const code = String(err?.code || '').toLowerCase();
    const msg = String(err?.message || err || '').toLowerCase();
    if (code === '23505') {
      // check if message references phone or drivers_phone_unique
      return msg.includes('phone') || msg.includes('drivers_phone_unique') || msg.includes('drivers_phone');
    }
    // fallback checks
    if (msg.includes('drivers_phone_unique') || msg.includes('phone') && msg.includes('duplicate')) return true;
    return false;
  }

  // ---------- openCreate helper (prefill + open) ----------
  const openCreate = () => {
    setForm({ name: '', phone: '+220', license_number: '' });
    setPictureFile(null);
    setPreviewUrl(null);
    onCreateOpen();
  };

  // create driver
  const createDriver = async () => {
    if (!form.name.trim()) return toast({ status: 'warning', title: 'Name required' });
    if (!form.phone.trim()) return toast({ status: 'warning', title: 'Phone required' });
    // license is optional now

    setIsSaving(true);
    try {
      const phoneToCheck = String(form.phone || '').trim();

      // check duplicate phone first (friendly UX)
      try {
        const { data: existingPhone, error: phoneErr } = await supabase.from('drivers').select('id').eq('phone', phoneToCheck).maybeSingle();
        if (phoneErr) {
          console.warn('phone uniqueness check failed', phoneErr);
        } else if (existingPhone && existingPhone.id) {
          setIsSaving(false);
          toast({ status: 'error', title: 'The Phone number is already used, try another one' });
          return;
        }
      } catch (e) {
        console.warn('phone check threw', e);
      }

      const payload = {
        name: form.name.trim(),
        phone: phoneToCheck,
        license_number: form.license_number.trim() || null,
      };

      const { data, error } = await supabase.from('drivers').insert([payload]).select().maybeSingle();
      if (error) {
        if (isPhoneDuplicateError(error)) {
          toast({ status: 'error', title: 'The Phone number is already used, try another one' });
          setIsSaving(false);
          return;
        }
        throw error;
      }

      const driverId = data?.id;
      if (pictureFile && driverId) {
        try {
          const pictureUrl = await uploadDriverPicture(pictureFile, driverId);
          if (pictureUrl) {
            await supabase.from('drivers').update({ picture_url: pictureUrl }).eq('id', driverId);
          }
        } catch (e) {
          console.warn('upload picture after create failed', e);
        }
      }

      toast({ status: 'success', title: 'Driver registered' });
      triggerConfetti(180);

      // reset & refresh
      setForm({ name: '', phone: '+220', license_number: '' });
      setPictureFile(null); setPreviewUrl(null);
      onCreateClose();
      fetchDrivers(1, pageSize);
      setPage(1);
    } catch (err) {
      console.error('createDriver error', err);
      if (isPhoneDuplicateError(err)) {
        toast({ status: 'error', title: 'The Phone number is already used, try another one' });
      } else {
        toast({ status: 'error', title: 'Save failed', description: err?.message || String(err) });
      }
    } finally {
      setIsSaving(false);
    }
  };

  // ---------- VIEW modal / editing logic ----------
  const openView = (driver) => {
    if (!driver) return;
    setViewDriver(driver);
    setIsEditingInView(false);
    setViewPreviewUrl(driver.picture_url || null);
    setViewPictureFile(null);
    onViewOpen();
  };

  // handle file change for create modal
  const onCreateFileChange = (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    setPictureFile(f);
    const url = URL.createObjectURL(f);
    setPreviewUrl(url);
  };

  // handle file change for view modal (editing)
  const onViewFileChange = (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    setViewPictureFile(f);
    const url = URL.createObjectURL(f);
    setViewPreviewUrl(url);
  };

  // update driver from view modal (after confirmation)
  const performUpdateViewDriver = async () => {
    if (!viewDriver) return;
    setIsUpdatingView(true);
    try {
      const phoneToCheck = String(viewDriver.phone || '').trim();

      // check uniqueness of phone excluding current driver
      try {
        const { data: dup, error: dupErr } = await supabase.from('drivers')
          .select('id')
          .eq('phone', phoneToCheck)
          .neq('id', viewDriver.id)
          .maybeSingle();
        if (dupErr) {
          console.warn('update phone uniqueness check failed', dupErr);
        } else if (dup && dup.id) {
          setIsUpdatingView(false);
          toast({ status: 'error', title: 'The Phone number is already used, try another one' });
          return;
        }
      } catch (e) {
        console.warn('update phone check threw', e);
      }

      const payload = {
        name: (viewDriver.name || '').trim(),
        phone: phoneToCheck,
        license_number: (viewDriver.license_number || '') ? viewDriver.license_number.trim() : null,
      };

      // server update
      const { data: updated, error: updErr } = await supabase.from('drivers').update(payload).eq('id', viewDriver.id).select().maybeSingle();
      if (updErr) {
        if (isPhoneDuplicateError(updErr)) {
          toast({ status: 'error', title: 'The Phone number is already used, try another one' });
          setIsUpdatingView(false);
          return;
        }
        throw updErr;
      }

      // upload picture if changed
      if (viewPictureFile && viewDriver.id) {
        try {
          const pictureUrl = await uploadDriverPicture(viewPictureFile, viewDriver.id);
          if (pictureUrl) {
            await supabase.from('drivers').update({ picture_url: pictureUrl }).eq('id', viewDriver.id);
          }
        } catch (e) {
          console.warn('upload picture during update failed', e);
        }
      }

      toast({ status: 'success', title: 'Driver updated' });
      // refresh UI
      fetchDrivers(page, pageSize);
      setIsEditingInView(false);
      onUpdateConfirmClose();
      onViewClose();
    } catch (err) {
      console.error('performUpdateViewDriver error', err);
      if (isPhoneDuplicateError(err)) {
        toast({ status: 'error', title: 'The Phone number is already used, try another one' });
      } else {
        toast({ status: 'error', title: 'Update failed', description: err?.message || String(err) });
      }
    } finally {
      setIsUpdatingView(false);
    }
  };

  // ---------- SUSPEND logic (uses AlertDialog confirmation) ----------
  const openSuspendConfirm = (driver) => {
    suspendTargetRef.current = driver;
    onSuspendOpen();
  };

  const performSuspend = async () => {
    const driver = suspendTargetRef.current;
    if (!driver) return onSuspendClose();
    try {
      // Try to update is_suspended boolean first
      const { error } = await supabase.from('drivers').update({ is_suspended: true }).eq('id', driver.id);
      if (error) {
        // fallback: try setting status = 'suspended'
        const { error: e2 } = await supabase.from('drivers').update({ status: 'suspended' }).eq('id', driver.id);
        if (e2) {
          // neither column available — inform admin
          toast({
            status: 'warning',
            title: 'Could not suspend driver server-side',
            description: 'No suspend column in DB. To persist suspensions add an "is_suspended boolean" or "status text" column to drivers table.',
            duration: 8000,
          });
          // still reflect client-side state
          setDrivers((prev) => prev.map((d) => (d.id === driver.id ? { ...d, _suspendedClient: true } : d)));
          onSuspendClose();
          return;
        }
      }

      toast({ status: 'success', title: 'Driver suspended' });
      fetchDrivers(page, pageSize);
    } catch (err) {
      console.error('performSuspend error', err);
      toast({ status: 'error', title: 'Suspend failed', description: err?.message || String(err) });
    } finally {
      onSuspendClose();
      suspendTargetRef.current = null;
    }
  };

  // ---------- Utility: detect suspended state ----------
  const isDriverSuspended = (d) => {
    if (!d) return false;
    if (d.is_suspended === true) return true;
    if (d.status && String(d.status).toLowerCase() === 'suspended') return true;
    if (d.suspended_at) return true;
    if (d._suspendedClient) return true;
    return false;
  };

  // small Avatar preview component
  const AvatarPreview = ({ src }) => (
    <Box borderRadius="md" overflow="hidden" boxShadow="sm">
      <Image src={src} alt="preview" boxSize="72px" objectFit="cover" />
    </Box>
  );

  // pagination calculations
  const totalPages = Math.max(1, Math.ceil((totalCount || 0) / pageSize));

  // render rows/cards
  const DriversGrid = () => (
    <SimpleGrid columns={gridCols} spacing={4}>
      {drivers.map((d) => (
        <Box key={d.id} className="card glass-card panel-3d" p={4}>
          <Flex direction={{ base: 'column', md: 'row' }} gap={3} align="start">
            <Avatar name={d.name} src={d.picture_url || undefined} size={avatarSize} />
            <Box flex="1" minW={0}>
              <Text fontWeight="bold" isTruncated maxW="100%">{d.name}</Text>
              <Text fontSize="sm" className="muted" isTruncated maxW="100%">{d.license_number}</Text>
              <Text fontSize="sm" className="muted" isTruncated maxW="100%">{d.phone}</Text>
              {isDriverSuspended(d) && <Box mt={2} className="suspended-badge">Suspended</Box>}
            </Box>

            <VStack spacing={2} align="stretch" minW={{ base: '100%', md: 'auto' }}>
              <HStack spacing={2} wrap="wrap" justify={{ base: 'flex-start', md: 'flex-end' }}>
                <Tooltip label="View">
                  <IconButton size="sm" icon={<FaEye />} aria-label="View" onClick={() => openView(d)} />
                </Tooltip>
                <Tooltip label="Suspend">
                  <IconButton size="sm" colorScheme="red" icon={<FaBan />} aria-label="Suspend" onClick={() => openSuspendConfirm(d)} />
                </Tooltip>
              </HStack>
            </VStack>
          </Flex>
        </Box>
      ))}
    </SimpleGrid>
  );

  const DriversTable = () => (
    <Box overflowX="auto" className="glass-card p-2">
      <Table variant="simple" size="sm" minW="720px">
        <Thead>
          <Tr>
            <Th minW="72px">Photo</Th>
            <Th minW="180px">Name</Th>
            <Th minW="140px">Phone</Th>
            <Th minW="160px">License</Th>
            <Th minW="180px">Registered</Th>
            <Th minW="160px">Actions</Th>
          </Tr>
        </Thead>
        <Tbody>
          {drivers.map((d) => (
            <Tr key={d.id} className="panel-3d card">
              <Td>
                <Image src={d.picture_url || undefined} alt={d.name} boxSize="56px" objectFit="cover" borderRadius="md" />
              </Td>
              <Td maxW="220px">
                <Text fontWeight="semibold" isTruncated>{d.name}</Text>
                {isDriverSuspended(d) && <Text fontSize="xs" color="red.500">Suspended</Text>}
              </Td>
              <Td><Text isTruncated maxW="140px">{d.phone}</Text></Td>
              <Td><Text isTruncated maxW="160px">{d.license_number}</Text></Td>
              <Td><Text isTruncated maxW="180px">{d.created_at ? new Date(d.created_at).toLocaleString() : '—'}</Text></Td>
              <Td>
                <HStack spacing={2} wrap="wrap">
                  <Button size="sm" leftIcon={<FaEye />} onClick={() => openView(d)}>View</Button>
                  <Button size="sm" colorScheme="red" leftIcon={<FaBan />} onClick={() => openSuspendConfirm(d)}>Suspend</Button>
                </HStack>
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </Box>
  );

  // small helper to change page safely
  const goPage = (p) => {
    if (p < 1) p = 1;
    if (p > totalPages) p = totalPages;
    setPage(p);
  };

  return (
    <Container maxW="8xl" py={{ base: 6, md: 10 }} className="drivers-container">
      <Box mb={6}>
        <Flex align="center" gap={4} wrap="wrap">
          <Box flex="1" minW="220px">
            <Heading size="lg">Drivers</Heading>
            <Text className="muted" mt={1}>Register, search and manage drivers. Pictures stored in <b>drivers</b> storage.</Text>
          </Box>

          <HStack spacing={2} flexWrap="wrap" align="center">
            <Input placeholder="Search name..." value={qName} onChange={(e) => setQName(e.target.value)} maxW={{ base: '100%', md: '220px' }} />
            <Input placeholder="Search phone..." value={qPhone} onChange={(e) => setQPhone(e.target.value)} maxW={{ base: '100%', md: '180px' }} />
            <Input placeholder="Search license..." value={qLicense} onChange={(e) => setQLicense(e.target.value)} maxW={{ base: '100%', md: '180px' }} />
            <Select w={{ base: '140px', md: '120px' }} value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
              <option value={6}>6</option>
              <option value={12}>12</option>
              <option value={24}>24</option>
              <option value={48}>48</option>
            </Select>

            <Button leftIcon={<SearchIcon />} colorScheme="teal" onClick={() => fetchDrivers(1, pageSize)}>Search</Button>
          </HStack>
        </Flex>
      </Box>

      <Box mb={4}>
        {loading ? (
          <Flex align="center" justify="center" p={8}><Spinner /></Flex>
        ) : (
          <>
            {/* responsive: show table on md+ else cards */}
            <Box display={{ base: 'block', md: 'none' }} mb={4}>
              <DriversGrid />
            </Box>
            <Box display={{ base: 'none', md: 'block' }}>
              <DriversTable />
            </Box>
          </>
        )}
      </Box>

      {/* pagination */}
      <Flex align="center" justify="space-between" className="glass-card" p={3} mb={8} direction={{ base: 'column', md: 'row' }} gap={3}>
        <HStack spacing={3} flexWrap="wrap">
          <Text fontWeight="bold">{totalCount}</Text>
          <Text className="muted">drivers</Text>
          <Badge colorScheme="purple">{pageSize} / page</Badge>
        </HStack>

        <HStack spacing={2} align="center" wrap="wrap">
          <IconButton icon={<FaChevronLeft />} onClick={() => goPage(page - 1)} aria-label="Prev" />
          <Text>Page</Text>
          <Input value={page} onChange={(e) => goPage(Number(e.target.value || 1))} w="64px" />
          <Text>of {totalPages}</Text>
          <IconButton icon={<FaChevronRight />} onClick={() => goPage(page + 1)} aria-label="Next" />
        </HStack>
      </Flex>

      {/* Floating crystal orb (create) */}
      <Box className="floating-orb" onClick={() => { openCreate(); }} role="button" aria-label="New Driver">
        <MotionBox
          className="orb"
          whileHover={{ scale: 1.06, rotate: 6 }}
          whileTap={{ scale: 0.96 }}
          animate={{ y: [0, -8, 0] }}
          transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
          title="Add Driver"
        >
          <Box className="spark" />
        </MotionBox>
      </Box>

      {/* ---------- Create Modal (floating orb) ---------- */}
      <Modal isOpen={isCreateOpen} onClose={() => { onCreateClose(); setForm({ name: '', phone: '+220', license_number: '' }); setPictureFile(null); setPreviewUrl(null); }} size={modalSize}>
        <ModalOverlay />
        <AnimatePresence>
          {isCreateOpen && (
            <MotionBox initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}>
              <ModalContent borderRadius="2xl" p={4} mx={{ base: 0, md: 4 }}>
                <ModalHeader>
                  <Flex align="center" justify="space-between">
                    <Text fontWeight="bold">Register New Driver</Text>
                    <Badge colorScheme="cyan">New</Badge>
                  </Flex>
                </ModalHeader>
                <ModalCloseButton />
                <ModalBody>
                  <Stack spacing={4}>
                    <FormControl isRequired>
                      <FormLabel>Driver's Name</FormLabel>
                      <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="Full name" />
                    </FormControl>

                    <FormControl isRequired>
                      <FormLabel>Phone</FormLabel>
                      <Input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} placeholder="+220 1234 567" />
                    </FormControl>

                    <FormControl>
                      <FormLabel>License Number (optional)</FormLabel>
                      <Input value={form.license_number} onChange={(e) => setForm((p) => ({ ...p, license_number: e.target.value }))} placeholder="License No" />
                    </FormControl>

                    <FormControl>
                      <FormLabel>Picture</FormLabel>
                      <HStack spacing={3} wrap="wrap">
                        <VisuallyHidden as="input">
                          {/* keep for a11y fallback */}
                        </VisuallyHidden>
                        <input
                          ref={createFileRef}
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={onCreateFileChange}
                          style={{ display: 'none' }}
                        />
                        <Button leftIcon={<FaCamera />} onClick={() => createFileRef.current && createFileRef.current.click()}>Snap / Upload</Button>
                        <Button variant="ghost" leftIcon={<FaUpload />} onClick={() => createFileRef.current && createFileRef.current.click()}>Choose file</Button>
                        {previewUrl ? <AvatarPreview src={previewUrl} /> : <Text className="muted">No picture selected</Text>}
                      </HStack>
                    </FormControl>
                  </Stack>
                </ModalBody>

                <ModalFooter>
                  <Button colorScheme="teal" mr={3} isLoading={isSaving} onClick={createDriver}>{isSaving ? 'Creating...' : 'Create Driver'}</Button>
                  <Button variant="ghost" onClick={() => { onCreateClose(); setForm({ name: '', phone: '+220', license_number: '' }); setPictureFile(null); setPreviewUrl(null); }}>Cancel</Button>
                </ModalFooter>
              </ModalContent>
            </MotionBox>
          )}
        </AnimatePresence>
      </Modal>

      {/* ---------- View Modal (with inline edit) ---------- */}
      <Modal isOpen={isViewOpen} onClose={() => { onViewClose(); setViewDriver(null); setIsEditingInView(false); setViewPictureFile(null); setViewPreviewUrl(null); }} size={modalSize}>
        <ModalOverlay />
        <AnimatePresence>
          {isViewOpen && viewDriver && (
            <MotionBox initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}>
              <ModalContent borderRadius="2xl" p={4} mx={{ base: 0, md: 4 }}>
                <ModalHeader>
                  <Flex align="center" justify="space-between">
                    <Text fontWeight="bold">Driver Details</Text>
                    <Badge colorScheme={isDriverSuspended(viewDriver) ? 'red' : 'green'}>{isDriverSuspended(viewDriver) ? 'Suspended' : 'Active'}</Badge>
                  </Flex>
                </ModalHeader>
                <ModalCloseButton />
                <ModalBody>
                  {!isEditingInView ? (
                    <Stack spacing={4}>
                      <Flex direction={{ base: 'column', md: 'row' }} gap={4}>
                        <Avatar size={avatarSize} name={viewDriver.name} src={viewPreviewUrl || viewDriver.picture_url || undefined} />
                        <Box minW={0}>
                          <Text fontWeight="bold" fontSize="lg" isTruncated>{viewDriver.name}</Text>
                          <Text className="muted" isTruncated>{viewDriver.license_number}</Text>
                          <Text mt={2} isTruncated>{viewDriver.phone}</Text>
                          <Text className="muted" mt={2}>{viewDriver.created_at ? new Date(viewDriver.created_at).toLocaleString() : '—'}</Text>
                        </Box>
                      </Flex>

                      <Box>
                        <Text fontSize="sm" color="gray.600">Picture</Text>
                        {viewPreviewUrl || viewDriver.picture_url ? (
                          <Image src={viewPreviewUrl || viewDriver.picture_url} alt="driver" boxSize={{ base: '100%', md: '240px' }} objectFit="cover" borderRadius="md" mt={2} />
                        ) : (
                          <Text className="muted" mt={2}>No picture available</Text>
                        )}
                      </Box>
                    </Stack>
                  ) : (
                    // edit fields
                    <Stack spacing={4}>
                      <FormControl isRequired>
                        <FormLabel>Name</FormLabel>
                        <Input value={viewDriver.name || ''} onChange={(e) => setViewDriver((p) => ({ ...p, name: e.target.value }))} />
                      </FormControl>
                      <FormControl isRequired>
                        <FormLabel>Phone</FormLabel>
                        <Input value={viewDriver.phone || ''} onChange={(e) => setViewDriver((p) => ({ ...p, phone: e.target.value }))} />
                      </FormControl>
                      <FormControl>
                        <FormLabel>License Number (optional)</FormLabel>
                        <Input value={viewDriver.license_number || ''} onChange={(e) => setViewDriver((p) => ({ ...p, license_number: e.target.value }))} />
                      </FormControl>
                      <FormControl>
                        <FormLabel>Picture</FormLabel>
                        <HStack wrap="wrap" spacing={3}>
                          <input ref={viewFileRef} type="file" accept="image/*" capture="environment" onChange={onViewFileChange} style={{ display: 'none' }} />
                          <Button leftIcon={<FaCamera />} onClick={() => viewFileRef.current && viewFileRef.current.click()}>Snap / Upload</Button>
                          <Button variant="ghost" leftIcon={<FaUpload />} onClick={() => viewFileRef.current && viewFileRef.current.click()}>Choose</Button>
                          {viewPreviewUrl ? <AvatarPreview src={viewPreviewUrl} /> : <Text className="muted">No picture selected</Text>}
                        </HStack>
                      </FormControl>
                    </Stack>
                  )}
                </ModalBody>

                <ModalFooter>
                  {!isEditingInView ? (
                    <>
                      <Button colorScheme="teal" mr={3} onClick={() => setIsEditingInView(true)} leftIcon={<EditIcon />}>Edit</Button>
                      <Button variant="ghost" mr={3} onClick={() => { onViewClose(); setViewDriver(null); }}>Close</Button>
                    </>
                  ) : (
                    <>
                      <Button colorScheme="green" mr={3} isLoading={isUpdatingView} onClick={() => onUpdateConfirmOpen()}>Save</Button>
                      <Button variant="ghost" onClick={() => { setIsEditingInView(false); setViewPictureFile(null); setViewPreviewUrl(viewDriver.picture_url || null); }}>Cancel</Button>
                    </>
                  )}
                </ModalFooter>
              </ModalContent>
            </MotionBox>
          )}
        </AnimatePresence>
      </Modal>

      {/* ---------- Suspend Confirmation AlertDialog ---------- */}
      <AlertDialog isOpen={isSuspendOpen} leastDestructiveRef={suspendCancelRef} onClose={onSuspendClose} isCentered>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">Suspend Driver</AlertDialogHeader>
            <AlertDialogBody>
              Are you sure you want to suspend <b>{suspendTargetRef.current?.name || 'this driver'}</b>? Suspended drivers will be prevented from receiving new assignments (if enforced server-side).
            </AlertDialogBody>
            <AlertDialogFooter>
              <Button ref={suspendCancelRef} onClick={onSuspendClose}>Cancel</Button>
              <Button colorScheme="red" onClick={performSuspend} ml={3}>Suspend</Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

      {/* ---------- Update Confirm (for saving edits in view modal) ---------- */}
      <AlertDialog isOpen={isUpdateConfirmOpen} leastDestructiveRef={updateCancelRef} onClose={onUpdateConfirmClose} isCentered>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">Confirm Update</AlertDialogHeader>
            <AlertDialogBody>
              Save changes to driver <b>{viewDriver?.name || ''}</b>?
            </AlertDialogBody>
            <AlertDialogFooter>
              <Button ref={updateCancelRef} onClick={onUpdateConfirmClose}>Cancel</Button>
              <Button colorScheme="green" onClick={performUpdateViewDriver} ml={3} isLoading={isUpdatingView}>Yes, save</Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </Container>
  );
}

export default DriversPage;
