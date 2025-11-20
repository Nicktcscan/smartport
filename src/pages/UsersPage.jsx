// src/pages/UsersPage.jsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Box,
  Heading,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Input,
  InputGroup,
  InputLeftElement,
  InputRightElement,
  Icon,
  Button,
  Flex,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  FormControl,
  FormLabel,
  FormErrorMessage,
  Select,
  useDisclosure,
  useToast,
  Spinner,
  Fade,
  useBoolean,
  Avatar,
  Checkbox,
  Tooltip,
  HStack,
  Text,
  Stack,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
} from '@chakra-ui/react';
import {
  SearchIcon,
  ViewIcon,
  ViewOffIcon,
  DeleteIcon,
  EditIcon,
  DownloadIcon,
  ChevronDownIcon,
} from '@chakra-ui/icons';
import { supabase } from '../supabaseClient';

/**
 * UsersPage — enhanced user management with single-delete confirmation
 *
 * Notes:
 * - Admin actions that require the Supabase service_role key must be executed from
 *   a server-side endpoint (we use a Supabase Edge Function here).
 *
 * Environment variables:
 * - REACT_APP_SUPABASE_FUNCTION_URL (optional) — overrides the function url
 * - REACT_APP_SUPABASE_ANON_KEY (optional) — anon key to call Supabase function if you prefer
 */

function useDebounced(value, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export default function UsersPage() {
  // ---- Config for Supabase function ----
  const DEFAULT_FUNCTION_URL = 'https://cgyjradpttmdancexdem.supabase.co/functions/v1/hyper-responder';
  const SUPABASE_FUNCTION_URL =
    (typeof process !== 'undefined' && process.env && process.env.REACT_APP_SUPABASE_FUNCTION_URL)
      ? String(process.env.REACT_APP_SUPABASE_FUNCTION_URL).replace(/\/+$/,'')
      : DEFAULT_FUNCTION_URL;
  const SUPABASE_ANON_KEY =
    (typeof process !== 'undefined' && process.env && process.env.REACT_APP_SUPABASE_ANON_KEY)
      ? String(process.env.REACT_APP_SUPABASE_ANON_KEY)
      : null;
  // --------------------------------------

  // helper: attempt to retrieve a user access token from the client-side supabase instance.
  // This token is preferred because the Edge Function typically expects an Authorization header (Bearer <token>)
  // If you can't obtain a token, we will fall back to REACT_APP_SUPABASE_ANON_KEY if provided.
  const getClientAccessToken = async () => {
    try {
      // supabase-js v2: auth.getSession()
      if (supabase && supabase.auth && typeof supabase.auth.getSession === 'function') {
        const { data } = await supabase.auth.getSession();
        const token = data?.session?.access_token;
        if (token) return token;
      }
      // supabase-js v1: auth.session()
      if (supabase && supabase.auth && typeof supabase.auth.session === 'function') {
        const s = supabase.auth.session();
        const token = s?.access_token || s?.accessToken;
        if (token) return token;
      }
      // supabase-js may expose user with access_token in some setups
      if (supabase && supabase.auth && supabase.auth.user) {
        // older shapes
        const u = supabase.auth.user();
        if (u && u.access_token) return u.access_token;
      }
    } catch (err) {
      console.warn('Unable to read client access token from supabase client', err);
    }
    return null;
  };

  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 300);
  const [roleFilter, setRoleFilter] = useState('');
  const [loading, { on, off }] = useBoolean(true);

  // Add/Edit modal
  const { isOpen, onOpen, onClose } = useDisclosure();
  // Single delete confirmation modal
  const {
    isOpen: isConfirmOpen,
    onOpen: onConfirmOpen,
    onClose: onConfirmClose,
  } = useDisclosure();

  const toast = useToast();
  const initialRef = useRef();

  const [form, setForm] = useState({ id: null, full_name: '', email: '', role: '', password: '' });
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // store target for single delete confirmation { id, email }
  const [confirmTarget, setConfirmTarget] = useState(null);

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [selectAllOnPage, setSelectAllOnPage] = useState(false);

  // Sorting
  const [sortKey, setSortKey] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc'); // 'asc' | 'desc'

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // local UI state for modal mode (add/edit)
  const [isEditMode, setIsEditMode] = useState(false);

  // skeleton loading on first mount
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        on();
        const { data, error } = await supabase.from('users').select('*').order('created_at', { ascending: false }).limit(2000);
        if (error) {
          toast({ title: 'Error loading users', description: error.message || String(error), status: 'error', duration: 5000, isClosable: true });
        } else if (mounted) {
          setUsers(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        console.error('fetch users', err);
        toast({ title: 'Error', description: 'Could not fetch users', status: 'error' });
      } finally {
        off();
      }
    };
    load();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // derived filtered and sorted users (memoized)
  const filteredSorted = useMemo(() => {
    const q = (debouncedSearch || '').trim().toLowerCase();
    let arr = users.filter((u) => {
      const matchesSearch =
        !q ||
        (u.full_name || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.username || '').toLowerCase().includes(q);
      const matchesRole = !roleFilter || (u.role === roleFilter);
      return matchesSearch && matchesRole;
    });

    const compare = (a, b) => {
      let va = a[sortKey];
      let vb = b[sortKey];
      if (va === undefined) va = '';
      if (vb === undefined) vb = '';
      // attempt date numeric compare if looks like date
      const da = new Date(va);
      const db = new Date(vb);
      if (!isNaN(da) && !isNaN(db)) {
        return da.getTime() - db.getTime();
      }
      // fallback to string
      return String(va).localeCompare(String(vb));
    };

    arr.sort((a, b) => {
      const cmp = compare(a, b);
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return arr;
  }, [users, debouncedSearch, roleFilter, sortKey, sortDir]);

  // pagination
  const total = filteredSorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [totalPages, page]);

  const pageItems = filteredSorted.slice((page - 1) * pageSize, page * pageSize);

  // helpers
  const validate = () => {
    const errs = {};
    if (!form.full_name || !form.full_name.trim()) errs.full_name = 'Full name is required';
    if (!form.email || !form.email.trim()) errs.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(form.email)) errs.email = 'Invalid email';
    if (!form.role) errs.role = 'Role is required';
    if (form.id === null && (!form.password || form.password.length < 6)) errs.password = 'Password is required (min 6 chars)';
    if (form.password && form.password.length > 0 && form.password.length < 6) errs.password = 'Password must be at least 6 characters';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: undefined }));
  };

  // modal openers
  const openAddUser = () => {
    setIsEditMode(false);
    setForm({ id: null, full_name: '', email: '', role: '', password: '' });
    setErrors({});
    setShowPassword(false);
    onOpen();
  };

  const openEditUser = (user) => {
    setIsEditMode(true);
    setForm({ id: user.id, full_name: user.full_name || '', email: user.email || '', role: user.role || '', password: '' });
    setErrors({});
    setShowPassword(false);
    onOpen();
  };

  const resetModal = () => {
    setForm({ id: null, full_name: '', email: '', role: '', password: '' });
    setErrors({});
    setShowPassword(false);
    onClose();
  };

  // create / update user
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setIsSubmitting(true);

    try {
      if (form.id === null) {
        // create user via client signup (this requires auth settings to allow it)
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email: form.email,
          password: form.password,
        });

        if (signUpError) {
          toast({ title: 'Signup failed', description: signUpError.message || String(signUpError), status: 'error' });
          setIsSubmitting(false);
          return;
        }

        const newUserId = signUpData?.user?.id || signUpData?.session?.user?.id;
        const newId = newUserId || `pending-${Date.now()}`;

        const username = generateUsername(form.full_name || '');

        const { data: profileRow, error: insertError } = await supabase.from('users').insert([{
          id: newId,
          full_name: form.full_name,
          email: form.email,
          role: form.role,
          username,
        }]).select().single();

        if (insertError) {
          toast({ title: 'Failed to add user profile', description: insertError.message || String(insertError), status: 'error' });
          setIsSubmitting(false);
          return;
        }

        setUsers((prev) => [profileRow, ...prev]);
        toast({ title: 'User created', description: `${profileRow.full_name} added. Confirmation email may be required.`, status: 'success' });
        resetModal();
      } else {
        // update profile row in custom users table
        const payload = { full_name: form.full_name, email: form.email, role: form.role };
        const { data: updated, error: updateErr } = await supabase.from('users').update(payload).eq('id', form.id).select().single();
        if (updateErr) {
          toast({ title: 'Update failed', description: updateErr.message || String(updateErr), status: 'error' });
          setIsSubmitting(false);
          return;
        }

        // If a new password is provided, call the Supabase Edge Function
        if (form.password && form.password.length >= 6) {
          try {
            // Build function URL (already configured at top)
            const apiUrl = SUPABASE_FUNCTION_URL;

            // Prepare headers. Try to include the logged-in user's access token first (recommended).
            const headers = {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            };

            const clientToken = await getClientAccessToken();
            if (clientToken) {
              headers['Authorization'] = `Bearer ${clientToken}`;
            } else if (SUPABASE_ANON_KEY) {
              // fallback to anon key if developer provided it in env — less ideal but acceptable for some setups
              headers['Authorization'] = `Bearer ${SUPABASE_ANON_KEY}`;
              console.warn('Using REACT_APP_SUPABASE_ANON_KEY as Authorization header fallback.');
            } else {
              // No token available — surface actionable message to developer/admin
              toast({
                title: 'Password update blocked',
                description: 'No client access token or anon key available. Sign in or set REACT_APP_SUPABASE_ANON_KEY to call the function.',
                status: 'error',
                duration: 8000,
                isClosable: true,
              });
              throw new Error('Missing authorization token for function call');
            }

            const resp = await fetch(apiUrl, {
              method: 'POST',
              headers,
              // For Supabase functions a CORS request is expected, do not send cookies by default
              body: JSON.stringify({ userId: form.id, password: form.password }),
            });

            // read text then parse JSON safely
            const text = await resp.text();
            let parsed = null;
            try { parsed = text ? JSON.parse(text) : null; } catch (err) { parsed = null; }

            if (!resp.ok) {
              console.error('Password update failed.', {
                url: apiUrl,
                status: resp.status,
                statusText: resp.statusText,
                responseText: text,
                parsed,
              });

              if (resp.status === 401) {
                // common cause: missing/invalid Authorization header or token expired
                toast({
                  title: 'Password update failed (401)',
                  description: `Function rejected the request: missing/invalid authorization. Ensure user is signed in and token is valid or set REACT_APP_SUPABASE_ANON_KEY if appropriate.`,
                  status: 'error',
                  duration: 10000,
                });
              } else if (resp.status === 405) {
                toast({
                  title: 'Password update failed (405)',
                  description: `Server rejected method when calling ${apiUrl}. Ensure the function accepts POST and OPTIONS.`,
                  status: 'error',
                  duration: 10000,
                });
              } else if (resp.status === 404) {
                toast({
                  title: 'Password update failed (404)',
                  description: `Function not found at ${apiUrl}. Verify REACT_APP_SUPABASE_FUNCTION_URL or that the function is deployed.`,
                  status: 'error',
                  duration: 10000,
                });
              } else {
                const errMsg = (parsed && (parsed.error || parsed.message)) || `Password update failed (status ${resp.status})`;
                toast({ title: 'Password update failed', description: errMsg, status: 'warning', duration: 7000 });
              }

              throw new Error(`Password update failed (status ${resp.status})`);
            }

            // success
            toast({ title: 'Password updated', status: 'success' });
          } catch (pwErr) {
            console.error('password update error', pwErr);
            // If we already showed a helpful toast above for 401/405/404, avoid duplicating; otherwise show fallback
            if (!pwErr.message || (!pwErr.message.includes('401') && !pwErr.message.includes('405') && !pwErr.message.includes('404'))) {
              toast({ title: 'Password update failed', description: pwErr.message || String(pwErr), status: 'warning' });
            }
          }
        }

        setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
        toast({ title: 'User updated', description: `${updated.full_name} updated.`, status: 'success' });
        resetModal();
      }
    } catch (err) {
      console.error('submit user', err);
      toast({ title: 'Error', description: err.message || String(err), status: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // delete single user with optimistic UI + undo; this performs the actual deletion scheduling
  const pendingDeleteRef = useRef(null);
  const performDeleteSingle = async (userId, email) => {
    // optimistic UI: remove from list & show undo toast
    const previous = users.slice();
    setUsers((prev) => prev.filter((u) => u.id !== userId));
    toast({
      title: 'User deleted',
      description: `Deleted user ${email}. Undo?`,
      status: 'info',
      duration: 6000,
      isClosable: true,
    });

    // schedule actual deletion after timeout unless undone (you could wire Undo to clear this timer)
    pendingDeleteRef.current = setTimeout(async () => {
      try {
        // delete from custom users table
        const { error: userErr } = await supabase.from('users').delete().eq('id', userId);
        if (userErr) throw userErr;

        // delete from auth via admin API if available (requires service role)
        if (supabase.auth?.admin?.deleteUserById) {
          try {
            await supabase.auth.admin.deleteUserById(userId);
          } catch (authErr) {
            console.warn('Auth delete failed', authErr);
          }
        }
        toast({ title: 'User removal completed', status: 'success', duration: 3000 });
      } catch (err) {
        console.error('delete user', err);
        toast({ title: 'Delete failed', description: err.message || String(err), status: 'error' });
        // restore on error
        setUsers(previous);
      } finally {
        pendingDeleteRef.current = null;
      }
    }, 4000);
  };

  // cleanup pending delete timer on unmount
  useEffect(() => {
    return () => {
      if (pendingDeleteRef.current) {
        clearTimeout(pendingDeleteRef.current);
        pendingDeleteRef.current = null;
      }
    };
  }, []);

  // wrapper invoked after confirmation modal "Confirm"
  const handleConfirmDelete = async () => {
    if (!confirmTarget) {
      onConfirmClose();
      return;
    }
    const { id, email } = confirmTarget;
    onConfirmClose();
    setConfirmTarget(null);
    // call performDeleteSingle which does optimistic removal + actual deletion
    await performDeleteSingle(id, email);
  };

  // Start single-delete confirmation flow (open modal)
  const startDeleteFlow = (userId, email) => {
    setConfirmTarget({ id: userId, email });
    onConfirmOpen();
  };

  // bulk delete (keeps existing optimistic undo behavior)
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) {
      toast({ title: 'No users selected', status: 'info' });
      return;
    }

    const ids = Array.from(selectedIds);
    // optimistic remove
    const previous = users.slice();
    setUsers((prev) => prev.filter((u) => !selectedIds.has(u.id)));
    setSelectedIds(new Set());
    setSelectAllOnPage(false);

    toast({
      title: 'Users deleted',
      description: `Deleting ${ids.length} users — undo?`,
      status: 'info',
      duration: 6000,
      isClosable: true,
    });

    // process actual delete (non-blocking)
    setTimeout(async () => {
      try {
        // delete from users table
        const { error: delErr } = await supabase.from('users').delete().in('id', ids);
        if (delErr) throw delErr;

        // delete auth users if admin API available (attempt sequentially)
        if (supabase.auth?.admin?.deleteUserById) {
          for (const id of ids) {
            try {
              await supabase.auth.admin.deleteUserById(id);
            } catch (e) {
              console.warn('auth delete failed for', id, e);
            }
          }
        }

        toast({ title: 'Bulk delete completed', status: 'success' });
      } catch (err) {
        console.error('bulk delete', err);
        toast({ title: 'Bulk delete failed', description: err.message || String(err), status: 'error' });
        setUsers(previous);
      }
    }, 3500);
  };

  // inline role update (fast inline edit)
  const handleInlineRoleChange = async (userId, newRole) => {
    try {
      const { data, error } = await supabase.from('users').update({ role: newRole }).eq('id', userId).select().single();
      if (error) throw error;
      setUsers((prev) => prev.map((u) => (u.id === userId ? data : u)));
      toast({ title: 'Role updated', status: 'success' });
    } catch (err) {
      console.error('inline role update', err);
      toast({ title: 'Update failed', description: err.message || String(err), status: 'error' });
    }
  };

  // CSV export for current filteredSorted set
  const downloadCSV = (rows = []) => {
    if (!rows || rows.length === 0) {
      toast({ title: 'No users to export', status: 'info' });
      return;
    }
    const headers = ['id', 'full_name', 'email', 'role', 'username', 'created_at'];
    const csv = [
      headers.join(','),
      ...rows.map((r) =>
        headers.map((h) => {
          let v = r[h] ?? '';
          if (v === null || v === undefined) v = '';
          // escape quotes
          const s = String(v).replace(/"/g, '""');
          return `"${s}"`;
        }).join(',')
      ),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `users-export-${Date.now()}.csv`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast({ title: 'CSV download started', status: 'success' });
  };

  // helper generate username (simple)
  const generateUsername = (fullName) => {
    if (!fullName) return '';
    const parts = fullName.trim().split(/\s+/);
    const firstInitial = parts[0] ? parts[0][0].toUpperCase() : '';
    const last = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
    return `${firstInitial}${last}`.replace(/[^a-z0-9_]/gi, '');
  };

  // select toggles
  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  };

  const handleSelectAllOnPage = () => {
    if (selectAllOnPage) {
      // unselect all on page
      setSelectedIds((prev) => {
        const s = new Set(prev);
        pageItems.forEach((r) => s.delete(r.id));
        return s;
      });
      setSelectAllOnPage(false);
    } else {
      // select all on page
      setSelectedIds((prev) => {
        const s = new Set(prev);
        pageItems.forEach((r) => s.add(r.id));
        return s;
      });
      setSelectAllOnPage(true);
    }
  };

  // header sort toggle
  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  // UI helpers
  const roleOptions = [
    { value: '', label: 'All roles' },
    { value: 'admin', label: 'Admin' },
    { value: 'weighbridge', label: 'Weighbridge' },
    { value: 'outgate', label: 'Outgate' },
    { value: 'customs', label: 'Customs' },
    { value: 'agent', label: 'Agent' },
    { value: 'finance', label: 'Finance' },
  ];

  // computed UI states
  const isAllSelectedOnPage = pageItems.every((r) => selectedIds.has(r.id)) && pageItems.length > 0;

  // render
  return (
    <Box p={6}>
      <Flex justify="space-between" align="center" mb={6}>
        <Heading size="lg">User Management</Heading>
        <HStack spacing={3}>
          <Button leftIcon={<DownloadIcon />} size="sm" onClick={() => downloadCSV(filteredSorted)}>Export CSV</Button>
          <Button colorScheme="teal" onClick={openAddUser}>Add User</Button>
        </HStack>
      </Flex>

      <Flex gap={4} mb={4} align="center" flexWrap="wrap">
        <InputGroup maxW="480px">
          <InputLeftElement pointerEvents="none"><Icon as={SearchIcon} color="gray.400" /></InputLeftElement>
          <Input placeholder="Search by name, email or username" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </InputGroup>

        <Select maxW="220px" value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}>
          {roleOptions.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </Select>

        <Box flex="1" />

        <Select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} width="120px">
          <option value={10}>10 / page</option>
          <option value={15}>15 / page</option>
          <option value={25}>25 / page</option>
          <option value={50}>50 / page</option>
        </Select>
      </Flex>

      <Box borderWidth="1px" borderRadius="md" overflow="hidden">
        {loading ? (
          <Flex justify="center" align="center" h="200px"><Spinner size="xl" color="teal.500" /></Flex>
        ) : (
          <Fade in={!loading}>
            <Table variant="simple" size="sm">
              <Thead bg="gray.50">
                <Tr>
                  <Th px={3}>
                    <Checkbox
                      isChecked={isAllSelectedOnPage}
                      onChange={handleSelectAllOnPage}
                      aria-label="Select all visible users"
                    />
                  </Th>
                  <Th cursor="pointer" onClick={() => toggleSort('full_name')}>
                    <Flex align="center" gap={2}>
                      Full name
                      {sortKey === 'full_name' && <ChevronDownIcon transform={sortDir === 'asc' ? 'rotate(180deg)' : 'none'} />}
                    </Flex>
                  </Th>
                  <Th cursor="pointer" onClick={() => toggleSort('email')}>
                    <Flex align="center" gap={2}>
                      Email
                      {sortKey === 'email' && <ChevronDownIcon transform={sortDir === 'asc' ? 'rotate(180deg)' : 'none'} />}
                    </Flex>
                  </Th>
                  <Th cursor="pointer" onClick={() => toggleSort('role')}>
                    <Flex align="center" gap={2}>
                      Role
                      {sortKey === 'role' && <ChevronDownIcon transform={sortDir === 'asc' ? 'rotate(180deg)' : 'none'} />}
                    </Flex>
                  </Th>
                  <Th cursor="pointer" onClick={() => toggleSort('created_at')}>
                    <Flex align="center" gap={2}>
                      Created
                      {sortKey === 'created_at' && <ChevronDownIcon transform={sortDir === 'asc' ? 'rotate(180deg)' : 'none'} />}
                    </Flex>
                  </Th>
                  <Th>Actions</Th>
                </Tr>
              </Thead>

              <Tbody>
                {pageItems.length === 0 ? (
                  <Tr>
                    <Td colSpan={6} textAlign="center" py={8}>
                      <Text>No users found.</Text>
                    </Td>
                  </Tr>
                ) : pageItems.map((u) => (
                  <Tr key={u.id}>
                    <Td px={3}>
                      <Checkbox isChecked={selectedIds.has(u.id)} onChange={() => toggleSelect(u.id)} />
                    </Td>

                    <Td>
                      <Flex align="center" gap={3}>
                        <Avatar name={u.full_name || u.email || 'User'} size="sm" />
                        <Stack spacing={0}>
                          <Text fontWeight="semibold">{u.full_name || '—'}</Text>
                          <Text fontSize="xs" color="gray.500">{u.username || ''}</Text>
                        </Stack>
                      </Flex>
                    </Td>

                    <Td>{u.email}</Td>

                    <Td>
                      <Select
                        size="sm"
                        value={u.role || ''}
                        onChange={(e) => handleInlineRoleChange(u.id, e.target.value)}
                        width="160px"
                      >
                        <option value="admin">Admin</option>
                        <option value="weighbridge">Weighbridge</option>
                        <option value="outgate">Outgate</option>
                        <option value="customs">Customs</option>
                        <option value="agent">Agent</option>
                        <option value="finance">Finance</option>
                      </Select>
                    </Td>

                    <Td>{u.created_at ? new Date(u.created_at).toLocaleString() : '—'}</Td>

                    <Td>
                      <HStack spacing={2}>
                        <Tooltip label="Edit">
                          <Button size="sm" leftIcon={<EditIcon />} onClick={() => openEditUser(u)}>Edit</Button>
                        </Tooltip>

                        <Tooltip label="Delete">
                          <Button
                            size="sm"
                            colorScheme="red"
                            leftIcon={<DeleteIcon />}
                            onClick={() => startDeleteFlow(u.id, u.email)} // open confirmation modal
                          >
                            Delete
                          </Button>
                        </Tooltip>
                      </HStack>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </Fade>
        )}
      </Box>

      {/* bottom controls: bulk actions, pagination */}
      <Flex justify="space-between" align="center" mt={4} gap={3} flexWrap="wrap">
        <HStack spacing={2}>
          <Button size="sm" colorScheme="red" onClick={handleBulkDelete} isDisabled={selectedIds.size === 0} leftIcon={<DeleteIcon />}>
            Delete Selected ({selectedIds.size})
          </Button>

          <Menu>
            <MenuButton as={Button} size="sm">
              Change role...
            </MenuButton>
            <MenuList>
              {['admin', 'weighbridge', 'outgate', 'customs', 'agent', 'finance'].map((r) => (
                <MenuItem key={r} onClick={async () => {
                  if (selectedIds.size === 0) {
                    toast({ title: 'No users selected', status: 'info' });
                    return;
                  }
                  const ids = Array.from(selectedIds);
                  try {
                    const { error } = await supabase.from('users').update({ role: r }).in('id', ids);
                    if (error) throw error;
                    setUsers((prev) => prev.map((u) => (selectedIds.has(u.id) ? { ...u, role: r } : u)));
                    setSelectedIds(new Set());
                    toast({ title: 'Roles updated', status: 'success' });
                  } catch (err) {
                    console.error('bulk role update', err);
                    toast({ title: 'Update failed', description: err.message || String(err), status: 'error' });
                  }
                }}>{r}</MenuItem>
              ))}
            </MenuList>
          </Menu>

          <Button size="sm" onClick={() => downloadCSV(filteredSorted)} leftIcon={<DownloadIcon />}>Export filtered</Button>
        </HStack>

        <HStack spacing={2} align="center">
          <Button size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} isDisabled={page === 1}>Previous</Button>

          <Text>Page {page} of {totalPages}</Text>

          <Button size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} isDisabled={page === totalPages}>Next</Button>
        </HStack>
      </Flex>

      {/* Add / Edit modal */}
      <Modal isOpen={isOpen} onClose={resetModal} initialFocusRef={initialRef} isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>{isEditMode ? 'Edit user' : 'Add user'}</ModalHeader>
          <ModalCloseButton disabled={isSubmitting} />
          <form id="user-form" onSubmit={handleSubmit}>
            <ModalBody pb={6}>
              <FormControl isInvalid={!!errors.full_name} mb={3} isRequired>
                <FormLabel>Full Name</FormLabel>
                <Input ref={initialRef} name="full_name" value={form.full_name} onChange={handleChange} disabled={isSubmitting} />
                <FormErrorMessage>{errors.full_name}</FormErrorMessage>
              </FormControl>

              <FormControl isInvalid={!!errors.email} mb={3} isRequired>
                <FormLabel>Email</FormLabel>
                <Input name="email" type="email" value={form.email} onChange={handleChange} disabled={isSubmitting} />
                <FormErrorMessage>{errors.email}</FormErrorMessage>
              </FormControl>

              <FormControl isInvalid={!!errors.role} mb={3} isRequired>
                <FormLabel>Role</FormLabel>
                <Select name="role" value={form.role} onChange={handleChange} disabled={isSubmitting}>
                  <option value="">Select role</option>
                  <option value="admin">Admin</option>
                  <option value="weighbridge">Weighbridge</option>
                  <option value="outgate">Outgate</option>
                  <option value="customs">Customs</option>
                  <option value="agent">Agent</option>
                  <option value="finance">Finance</option>
                </Select>
                <FormErrorMessage>{errors.role}</FormErrorMessage>
              </FormControl>

              <FormControl isInvalid={!!errors.password} mb={3} isRequired={form.id === null}>
                <FormLabel>Password</FormLabel>
                <InputGroup>
                  <Input name="password" type={showPassword ? 'text' : 'password'} value={form.password} onChange={handleChange} disabled={isSubmitting} placeholder={isEditMode ? 'Leave blank to keep current' : 'Password'} />
                  <InputRightElement width="3rem">
                    <Button h="1.75rem" size="sm" onClick={() => setShowPassword((s) => !s)} tabIndex={-1}>
                      {showPassword ? <ViewOffIcon /> : <ViewIcon />}
                    </Button>
                  </InputRightElement>
                </InputGroup>
                <FormErrorMessage>{errors.password}</FormErrorMessage>
              </FormControl>
            </ModalBody>

            <ModalFooter>
              <Button onClick={resetModal} mr={3} disabled={isSubmitting}>Cancel</Button>
              <Button colorScheme="teal" type="submit" isLoading={isSubmitting}>
                {isEditMode ? 'Update' : 'Add user'}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>

      {/* Confirm Delete Modal (single user) */}
      <Modal isOpen={isConfirmOpen} onClose={() => { setConfirmTarget(null); onConfirmClose(); }} isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Confirm deletion</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Text>
              {confirmTarget ? `Are you sure you want to delete user "${confirmTarget.email}"? This action can be undone within a few seconds via the undo toast.` : 'Are you sure you want to delete this user?'}
            </Text>
          </ModalBody>

          <ModalFooter>
            <Button onClick={() => { setConfirmTarget(null); onConfirmClose(); }} mr={3}>Cancel</Button>
            <Button colorScheme="red" onClick={handleConfirmDelete}>Confirm Delete</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
}
