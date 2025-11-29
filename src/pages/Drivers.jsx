// src/pages/Drivers.jsx
import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  Box, Container, Heading, Input, Button, IconButton, Text, SimpleGrid,
  VStack, HStack, FormControl, FormLabel, Modal, ModalOverlay, ModalContent,
  ModalHeader, ModalBody, ModalFooter, ModalCloseButton, useDisclosure,
  Avatar, Table, Thead, Tbody, Tr, Th, Td, Select, Spinner, useToast,
  Badge, Flex, Stack, Tooltip, Image
} from '@chakra-ui/react';
import { motion, AnimatePresence } from 'framer-motion';
import { AddIcon, SearchIcon, DeleteIcon, EditIcon } from '@chakra-ui/icons';
import { FaCamera, FaUpload, FaChevronLeft, FaChevronRight } from 'react-icons/fa';
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

  // modal / form state
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', license_number: '' });
  const [pictureFile, setPictureFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const fileInputRef = useRef();

  // edit
  const [editingId, setEditingId] = useState(null);

  // responsive / styling
  useEffect(() => {
    // css injection to match sample styling (glassmorphism + orb + 3d)
    const css = `
      .drivers-container { background: radial-gradient(circle at 10% 10%, rgba(99,102,241,0.03), transparent 10%), linear-gradient(180deg,#f0f9ff 0%, #ffffff 60%); padding-bottom: 80px; }
      .glass-card { background: linear-gradient(180deg, rgba(255,255,255,0.88), rgba(255,255,255,0.7)); border-radius: 14px; border: 1px solid rgba(2,6,23,0.06); box-shadow: 0 10px 40px rgba(2,6,23,0.06); padding: 14px; }
      .panel-3d { perspective: 1400px; }
      .panel-3d .card { transform-style: preserve-3d; transition: transform 0.6s ease, box-shadow 0.6s ease; border-radius: 12px; }
      @media (min-width:1600px) {
        .panel-3d .card:hover { transform: rotateY(6deg) rotateX(3deg) translateZ(8px); box-shadow: 0 30px 80px rgba(2,6,23,0.12); }
      }
      .floating-orb { position: fixed; right: 28px; bottom: 28px; z-index: 2200; cursor: pointer; }
      .orb { width:72px;height:72px;border-radius:999px;display:flex;align-items:center;justify-content:center; box-shadow: 0 10px 30px rgba(59,130,246,0.18), inset 0 -6px 18px rgba(62,180,200,0.08); background: linear-gradient(90deg,#7b61ff,#3ef4d0); color: #fff; font-weight:700; }
      .spark { width:24px; height:24px; border-radius:999px; background: radial-gradient(circle at 30% 30%, #fff, rgba(255,255,255,0.12)); }
      .muted { color: #6b7280; }
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

  // create or update driver
  const saveDriver = async () => {
    if (!form.name.trim()) return toast({ status: 'warning', title: 'Name required' });
    if (!form.phone.trim()) return toast({ status: 'warning', title: 'Phone required' });
    if (!form.license_number.trim()) return toast({ status: 'warning', title: 'License number required' });

    setIsSaving(true);
    try {
      // prepare payload
      const payload = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        license_number: form.license_number.trim(),
      };

      if (editingId) {
        // update flow
        const { data: updated, error: updateErr } = await supabase.from('drivers').update(payload).eq('id', editingId).select().maybeSingle();
        if (updateErr) throw updateErr;
        let pictureUrl = null;
        if (pictureFile) {
          pictureUrl = await uploadDriverPicture(pictureFile, editingId);
          if (pictureUrl) {
            await supabase.from('drivers').update({ picture_url: pictureUrl }).eq('id', editingId);
          }
        }
        toast({ status: 'success', title: 'Driver updated' });
      } else {
        // insert
        const { data, error } = await supabase.from('drivers').insert([payload]).select().maybeSingle();
        if (error) {
          // unique constraint handling
          const msg = (error.message || '').toLowerCase();
          if (msg.includes('duplicate') || msg.includes('unique')) {
            throw new Error(error.message || 'Unique constraint violation');
          }
          throw error;
        }
        const driverId = data?.id;
        let pictureUrl = null;
        if (pictureFile && driverId) {
          pictureUrl = await uploadDriverPicture(pictureFile, driverId);
          if (pictureUrl) {
            await supabase.from('drivers').update({ picture_url: pictureUrl }).eq('id', driverId);
          }
        }
        toast({ status: 'success', title: 'Driver registered' });
        // confetti
        triggerConfetti(180);
      }

      // cleanup + refresh
      setForm({ name: '', phone: '', license_number: '' });
      setPictureFile(null); setPreviewUrl(null); setEditingId(null);
      onClose();
      // refetch first page (or keep current)
      fetchDrivers(1, pageSize);
      setPage(1);
    } catch (err) {
      console.error('saveDriver error', err);
      toast({ status: 'error', title: 'Save failed', description: err?.message || String(err) });
    } finally {
      setIsSaving(false);
    }
  };

  // delete driver (soft delete not implemented; this removes)
  const deleteDriver = async (id) => {
    if (!id) return;
    if (!confirm('Delete driver? This cannot be undone.')) return;
    try {
      const { error } = await supabase.from('drivers').delete().eq('id', id);
      if (error) throw error;
      toast({ status: 'success', title: 'Driver deleted' });
      // refresh
      fetchDrivers(page, pageSize);
    } catch (err) {
      console.error('deleteDriver error', err);
      toast({ status: 'error', title: 'Delete failed', description: err?.message || String(err) });
    }
  };

  // open modal for create
  const openCreate = () => {
    setEditingId(null);
    setForm({ name: '', phone: '', license_number: '' });
    setPictureFile(null);
    setPreviewUrl(null);
    onOpen();
  };

  // open modal for edit
  const openEdit = (driver) => {
    setEditingId(driver.id);
    setForm({ name: driver.name || '', phone: driver.phone || '', license_number: driver.license_number || '' });
    setPreviewUrl(driver.picture_url || null);
    setPictureFile(null);
    onOpen();
  };

  // file change handler (upload or camera)
  const onFileChange = (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    setPictureFile(f);
    const url = URL.createObjectURL(f);
    setPreviewUrl(url);
  };

  // quick capture via device camera: just trigger file input with capture attribute
  const triggerCamera = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  };

  // pagination calculations
  const totalPages = Math.max(1, Math.ceil((totalCount || 0) / pageSize));

  // render rows/cards
  const DriversGrid = () => {
    // mobile cards
    return (
      <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={4}>
        {drivers.map((d) => (
          <Box key={d.id} className="card glass-card panel-3d" p={3}>
            <Flex justify="space-between" align="start">
              <HStack>
                <Avatar name={d.name} src={d.picture_url || undefined} size="md" />
                <Box>
                  <Text fontWeight="bold">{d.name}</Text>
                  <Text fontSize="sm" className="muted">{d.license_number}</Text>
                  <Text fontSize="sm" className="muted">{d.phone}</Text>
                </Box>
              </HStack>

              <VStack spacing={2}>
                <IconButton size="sm" icon={<EditIcon />} aria-label="Edit" onClick={() => openEdit(d)} />
                <IconButton size="sm" colorScheme="red" icon={<DeleteIcon />} aria-label="Delete" onClick={() => deleteDriver(d.id)} />
              </VStack>
            </Flex>
          </Box>
        ))}
      </SimpleGrid>
    );
  };

  const DriversTable = () => (
    <Box overflowX="auto" className="glass-card p-2">
      <Table variant="simple" size="sm">
        <Thead>
          <Tr>
            <Th>Photo</Th>
            <Th>Name</Th>
            <Th>Phone</Th>
            <Th>License</Th>
            <Th>Registered</Th>
            <Th>Actions</Th>
          </Tr>
        </Thead>
        <Tbody>
          {drivers.map((d) => (
            <Tr key={d.id} className="panel-3d card">
              <Td>
                <Image src={d.picture_url || undefined} alt={d.name} boxSize="48px" objectFit="cover" borderRadius="md" />
              </Td>
              <Td>{d.name}</Td>
              <Td>{d.phone}</Td>
              <Td>{d.license_number}</Td>
              <Td>{d.created_at ? new Date(d.created_at).toLocaleString() : '—'}</Td>
              <Td>
                <HStack>
                  <Button size="sm" leftIcon={<EditIcon />} onClick={() => openEdit(d)}>Edit</Button>
                  <Button size="sm" colorScheme="red" leftIcon={<DeleteIcon />} onClick={() => deleteDriver(d.id)}>Delete</Button>
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
          <Box flex="1">
            <Heading size="lg">Drivers</Heading>
            <Text className="muted" mt={1}>Register, search and manage drivers. Pictures stored in <b>drivers</b> storage.</Text>
          </Box>

          <HStack spacing={3}>
            <Input placeholder="Search name..." value={qName} onChange={(e) => setQName(e.target.value)} />
            <Input placeholder="Search phone..." value={qPhone} onChange={(e) => setQPhone(e.target.value)} />
            <Input placeholder="Search license..." value={qLicense} onChange={(e) => setQLicense(e.target.value)} />
            <Select w="120px" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
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
      <Flex align="center" justify="space-between" className="glass-card" p={3} mb={8}>
        <HStack>
          <Text fontWeight="bold">{totalCount}</Text>
          <Text className="muted">drivers</Text>
          <Badge colorScheme="purple">{pageSize} / page</Badge>
        </HStack>

        <HStack>
          <IconButton icon={<FaChevronLeft />} onClick={() => goPage(page - 1)} aria-label="Prev" />
          <Text>Page</Text>
          <Input value={page} onChange={(e) => goPage(Number(e.target.value || 1))} w="64px" />
          <Text>of {totalPages}</Text>
          <IconButton icon={<FaChevronRight />} onClick={() => goPage(page + 1)} aria-label="Next" />
        </HStack>
      </Flex>

      {/* Floating crystal orb */}
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

      {/* cinematic modal */}
      <Modal isOpen={isOpen} onClose={() => { onClose(); setEditingId(null); setPictureFile(null); setPreviewUrl(null); }}>
        <ModalOverlay bg="rgba(2,6,23,0.6)" />
        <AnimatePresence>
          {isOpen && (
            <MotionBox
              initial={{ opacity: 0, y: 40, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 40, scale: 0.98 }}
            >
              <ModalContent borderRadius="2xl" bg="linear-gradient(180deg, rgba(255,255,255,0.98), rgba(250,250,255,0.98))" p={4}>
                <ModalHeader>
                  <Flex align="center" justify="space-between">
                    <Text fontWeight="bold">{editingId ? 'Edit Driver' : 'Register New Driver'}</Text>
                    <Badge colorScheme="cyan">{editingId ? 'Edit Mode' : 'New'}</Badge>
                  </Flex>
                </ModalHeader>
                <ModalCloseButton />

                <ModalBody>
                  {/* holographic inputs area */}
                  <Stack spacing={4}>
                    <FormControl isRequired>
                      <FormLabel>Driver's Name</FormLabel>
                      <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="Full name" />
                    </FormControl>

                    <FormControl isRequired>
                      <FormLabel>Phone</FormLabel>
                      <Input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} placeholder="+220 1234 567" />
                    </FormControl>

                    <FormControl isRequired>
                      <FormLabel>License Number</FormLabel>
                      <Input value={form.license_number} onChange={(e) => setForm((p) => ({ ...p, license_number: e.target.value }))} placeholder="License No" />
                    </FormControl>

                    <FormControl>
                      <FormLabel>Picture</FormLabel>
                      <HStack spacing={3}>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={onFileChange}
                          style={{ display: 'none' }}
                        />
                        <Button leftIcon={<FaCamera />} onClick={() => fileInputRef.current && fileInputRef.current.click()}>Snap / Upload</Button>
                        <Button variant="ghost" leftIcon={<FaUpload />} onClick={() => fileInputRef.current && fileInputRef.current.click()}>Choose file</Button>
                        {previewUrl ? <AvatarPreview src={previewUrl} /> : <Text className="muted">No picture selected</Text>}
                      </HStack>
                    </FormControl>
                  </Stack>
                </ModalBody>

                <ModalFooter>
                  {editingId ? (
                    <Button colorScheme="teal" mr={3} isLoading={isSaving} onClick={saveDriver}>{isSaving ? 'Saving...' : 'Save changes'}</Button>
                  ) : (
                    <Button colorScheme="teal" mr={3} isLoading={isSaving} onClick={saveDriver}>{isSaving ? 'Creating...' : 'Create Driver'}</Button>
                  )}
                  <Button variant="ghost" onClick={() => { onClose(); setEditingId(null); setPictureFile(null); setPreviewUrl(null); }}>Cancel</Button>
                </ModalFooter>
              </ModalContent>
            </MotionBox>
          )}
        </AnimatePresence>
      </Modal>
    </Container>
  );
}

// small Avatar preview component
function AvatarPreview({ src }) {
  return (
    <Box borderRadius="md" overflow="hidden" boxShadow="sm">
      <Image src={src} alt="preview" boxSize="72px" objectFit="cover" />
    </Box>
  );
}

export default DriversPage;
