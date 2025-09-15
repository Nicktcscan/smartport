// src/pages/UsersPage.jsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Box, Heading, Table, Thead, Tbody, Tr, Th, Td, Input, InputGroup,
  InputLeftElement, Icon, Button, Flex, Modal, ModalOverlay, ModalContent,
  ModalHeader, ModalFooter, ModalBody, ModalCloseButton, FormControl,
  FormLabel, FormErrorMessage, Select, useDisclosure, useToast, Spinner,
  Fade, Avatar, Checkbox, HStack, Text, Tooltip, Menu, MenuButton, MenuItem, MenuList
} from '@chakra-ui/react';
import { supabase } from '../supabaseClient';
import { SearchIcon, ViewIcon, ViewOffIcon, DownloadIcon } from '@chakra-ui/icons';

/**
 * UsersPage with enhanced management features:
 * - bulk actions
 * - role filter
 * - pagination and sorting
 * - CSV export
 * - password reset/resend confirmation (best-effort)
 * - activity log display
 * - optimistic updates + undo for delete
 * - permission gating (admin-only actions)
 *
 * NOTE: adapt admin auth calls to your Supabase SDK version if necessary:
 * - supabase.auth.admin.* methods may require service role key or server side functions.
 */

function UsersPage() {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const { isOpen, onOpen, onClose } = useDisclosure(); // modal for add/edit
  const { isOpen: isActivityOpen, onOpen: onActivityOpen, onClose: onActivityClose } = useDisclosure(); // activity modal
  const toast = useToast();
  const initialRef = useRef();

  // form state for add/edit
  const [form, setForm] = useState({ id: null, full_name: '', email: '', role: '', password: '' });
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);

  // selection & bulk
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [selectAllOnPage, setSelectAllOnPage] = useState(false);

  // sorting
  const [sortBy, setSortBy] = useState('created_at'); // default
  const [sortDir, setSortDir] = useState('desc');

  // pagination (server-side)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalCount, setTotalCount] = useState(0);

  // current user / permissions
  const [currentUserProfile, setCurrentUserProfile] = useState(null);

  // activity log
  const [activityRows, setActivityRows] = useState([]);
  const [activityUser, setActivityUser] = useState(null);

  // local cache for undo after delete
  const deletedCacheRef = useRef([]);

  // fetch current user profile to know role (permission)
  useEffect(() => {
    let mounted = true;
    async function fetchProfile() {
      try {
        // Try to get auth user
        let currentUser = null;
        if (supabase.auth?.getUser) {
          const { data: ud } = await supabase.auth.getUser();
          currentUser = ud?.user ?? null;
        } else if (supabase.auth?.user) {
          currentUser = supabase.auth.user();
        }
        if (!currentUser) return;

        // fetch profile from 'users' table
        const { data: profile } = await supabase.from('users').select('id, full_name, role').eq('id', currentUser.id).maybeSingle();
        if (mounted) setCurrentUserProfile(profile || null);
      } catch (err) {
        console.warn('Could not fetch current user profile', err);
      }
    }
    fetchProfile();
    return () => { mounted = false; };
  }, []);

  // fetch users page
  useEffect(() => {
    let mounted = true;
    async function loadPage() {
      setLoading(true);
      try {
        // server side: use range and count
        const start = (page - 1) * pageSize;
        const end = page * pageSize - 1;

        // Build base query
        let query = supabase.from('users').select('*', { count: 'exact' }).order(sortBy || 'created_at', { ascending: sortDir === 'asc' });

        // filter by role on server if provided
        if (roleFilter) query = query.eq('role', roleFilter);

        // apply search server-side by ilike on multiple fields
        if (search && search.trim() !== '') {
          const s = `%${search.trim()}%`;
          // Supabase doesn't support OR across columns easily with client api in a single call; use filter via or
          query = query.or(`full_name.ilike.${s},email.ilike.${s},username.ilike.${s}`, { foreignTable: null });
        }

        const { data, error, count } = await query.range(start, end);

        if (error) {
          throw error;
        }
        const rows = data || [];
        // Map fields defensively
        const mapped = rows.map((u) => ({
          id: u.id,
          full_name: u.full_name,
          email: u.email,
          role: u.role,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at ?? u.last_login ?? null,
          username: u.username ?? null,
          status: u.status ?? null,
        }));

        if (mounted) {
          setUsers(mapped);
          setTotalCount(Number.isFinite(count) ? count : mapped.length);
          // clear selection when page changes
          setSelectedIds(new Set());
          setSelectAllOnPage(false);
        }
      } catch (err) {
        console.error('Error loading users', err);
        toast({ title: 'Error loading users', description: err.message || String(err), status: 'error', duration: 6000 });
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, roleFilter, search, sortBy, sortDir]);

  const validate = () => {
    const errs = {};
    if (!form.full_name.trim()) errs.full_name = 'Full name is required';
    if (!form.email.trim()) errs.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(form.email)) errs.email = 'Email is invalid';
    if (!form.role) errs.role = 'Role is required';
    if (!form.password && form.id === null) errs.password = 'Password is required';
    else if (form.password && form.password.length < 6) errs.password = 'Password must be at least 6 characters';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const isAdmin = currentUserProfile?.role === 'admin';

  const openAddUser = () => {
    setForm({ id: null, full_name: '', email: '', role: '', password: '' });
    setErrors({});
    setShowPassword(false);
    onOpen();
  };

  const openEditUser = (user) => {
    setForm({ id: user.id, full_name: user.full_name || '', email: user.email || '', role: user.role || '', password: '' });
    setErrors({});
    setShowPassword(false);
    onOpen();
  };

  const handleCloseModal = () => {
    if (isSubmitting) return;
    setForm({ id: null, full_name: '', email: '', role: '', password: '' });
    setErrors({});
    setShowPassword(false);
    onClose();
  };

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    setErrors(prev => ({ ...prev, [e.target.name]: undefined }));
  };

  // Create or update user
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setIsSubmitting(true);

    try {
      if (!form.id) {
        // create user via auth.signUp
        const { data: signupData, error: signupError } = await supabase.auth.signUp({
          email: form.email,
          password: form.password,
        });

        if (signupError) {
          throw signupError;
        }

        const userId = signupData?.user?.id || signupData?.session?.user?.id;
        if (!userId) {
          // Email confirmation flow could be in effect; in that case profile must be created after email confirm
          toast({ title: 'Signup initiated', description: 'Confirmation required. Please confirm via email before profile is active.', status: 'info', duration: 6000 });
        }

        // create profile row
        const generatedUsername = (form.full_name || '').split(/\s+/).map(Boolean).map((p,i)=> i===0? p[0].toUpperCase():p.toLowerCase()).join('').slice(0,12);
        const { data, error } = await supabase.from('users').insert([{ id: userId, full_name: form.full_name, email: form.email, role: form.role, username: generatedUsername }]).select().single();

        if (error) throw error;

        // optimistic: append to table and refetch total
        setUsers((prev) => [data, ...prev]);
        toast({ title: 'User added', description: `${data.full_name} was added`, status: 'success', duration: 4000 });
        handleCloseModal();
      } else {
        // update user profile
        const payload = { full_name: form.full_name, email: form.email, role: form.role };
        const { data, error } = await supabase.from('users').update(payload).eq('id', form.id).select().single();
        if (error) throw error;

        // if password provided, update via admin (best-effort)
        if (form.password) {
          try {
            if (supabase.auth?.admin?.updateUserById) {
              const { error: pwError } = await supabase.auth.admin.updateUserById(form.id, { password: form.password });
              if (pwError) throw pwError;
            } else {
              // fallback: not possible from browser client - show toast
              toast({ title: 'Password update pending', description: 'Password update requires admin privileges (server).', status: 'info', duration: 6000 });
            }
          } catch (pwErr) {
            toast({ title: 'Failed to update password', description: pwErr.message || String(pwErr), status: 'error', duration: 6000 });
          }
        }

        setUsers((prev) => prev.map(u => (u.id === data.id ? data : u)));
        toast({ title: 'User updated', description: `${data.full_name} updated`, status: 'success', duration: 4000 });
        handleCloseModal();
      }
    } catch (err) {
      console.error('User save error', err);
      toast({ title: 'Error', description: err.message || String(err), status: 'error', duration: 6000 });
    } finally {
      setIsSubmitting(false);
    }
  };

  // checkbox selection
  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelectAllOnPage(false);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    if (selectAllOnPage) {
      setSelectedIds(new Set());
      setSelectAllOnPage(false);
    } else {
      const next = new Set(selectedIds);
      users.forEach((u) => next.add(u.id));
      setSelectedIds(next);
      setSelectAllOnPage(true);
    }
  };

  // Bulk delete with optimistic update and undo
  const handleBulkDelete = async () => {
    if (!isAdmin) {
      toast({ title: 'Permission denied', description: 'Only admins can delete users', status: 'error', duration: 4000 });
      return;
    }
    if (selectedIds.size === 0) {
      toast({ title: 'No selection', description: 'Select users to delete', status: 'info', duration: 3000 });
      return;
    }

    const idsToDelete = Array.from(selectedIds);
    // optimistic remove from UI
    const removed = users.filter(u => idsToDelete.includes(u.id));
    deletedCacheRef.current = removed; // cache for undo
    setUsers(prev => prev.filter(u => !idsToDelete.includes(u.id)));
    setSelectedIds(new Set());
    setSelectAllOnPage(false);

    const undoToastId = `delete-undo-${Date.now()}`;
    toast({
      id: undoToastId,
      title: `${idsToDelete.length} user(s) deleted`,
      description: 'You can undo this action for a short time.',
      status: 'warning',
      duration: 7000,
      isClosable: true,
      position: 'top-right',
      // add undo button via onClose? Chakra toasts do not have actions built-in, so we show another toast with button
    });

    // show an action toast with undo button (simulate)
    toast({
      title: 'Undo available',
      description: (
        <Box>
          <Text mb={2}>{idsToDelete.length} user(s) will be permanently deleted unless undone</Text>
          <Button size="sm" onClick={() => {
            // Undo: restore cache
            setUsers(prev => [...deletedCacheRef.current, ...prev]);
            deletedCacheRef.current = [];
            toast({ title: 'Delete undone', status: 'info', duration: 3000 });
          }}>
            Undo
          </Button>
        </Box>
      ),
      status: 'info',
      duration: 7000,
      isClosable: true,
      position: 'top-right'
    });

    // After a short delay, perform server-side deletes (if not undone)
    setTimeout(async () => {
      if (deletedCacheRef.current.length === 0) {
        // undone
        return;
      }
      try {
        // delete from users table
        const { error } = await supabase.from('users').delete().in('id', idsToDelete);
        if (error) throw error;

        // optionally delete from auth (admin call)
        for (const id of idsToDelete) {
          try {
            if (supabase.auth?.admin?.deleteUserById) {
              // server-side admin delete (may not be available from browser)
              await supabase.auth.admin.deleteUserById(id);
            }
          } catch (e) {
            console.warn('Failed to delete from Auth:', e);
          }
        }

        deletedCacheRef.current = []; // clear cache
        toast({ title: 'Users permanently deleted', status: 'success', duration: 4000 });
        // refresh current page
        setPage(1);
      } catch (err) {
        console.error('Bulk delete error', err);
        toast({ title: 'Error deleting users', description: err.message || String(err), status: 'error', duration: 6000 });
        // attempt rollback by restoring cached users if any
        if (deletedCacheRef.current.length) {
          setUsers(prev => [...deletedCacheRef.current, ...prev]);
          deletedCacheRef.current = [];
        }
      }
    }, 3500);
  };

  // Bulk role change (optimistic)
  const handleBulkChangeRole = async (newRole) => {
    if (!isAdmin) {
      toast({ title: 'Permission denied', description: 'Only admins can change roles', status: 'error', duration: 4000 });
      return;
    }
    if (selectedIds.size === 0) {
      toast({ title: 'No selection', description: 'Select users to change role', status: 'info', duration: 3000 });
      return;
    }
    const ids = Array.from(selectedIds);
    const prevUsers = [...users];
    setUsers(prev => prev.map(u => ids.includes(u.id) ? { ...u, role: newRole } : u));
    setSelectedIds(new Set());
    setSelectAllOnPage(false);

    try {
      const { error } = await supabase.from('users').update({ role: newRole }).in('id', ids);
      if (error) throw error;
      toast({ title: 'Roles updated', status: 'success', duration: 3000 });
    } catch (err) {
      console.error('Bulk role update error', err);
      setUsers(prevUsers); // rollback
      toast({ title: 'Error updating roles', description: err.message || String(err), status: 'error', duration: 6000 });
    }
  };

  // single user delete with confirm (two-step)
  const handleDelete = async (userId) => {
    if (!isAdmin) {
      toast({ title: 'Permission denied', description: 'Only admins can delete users', status: 'error', duration: 4000 });
      return;
    }
    if (pendingDeleteId !== userId) {
      setPendingDeleteId(userId);
      setTimeout(() => setPendingDeleteId(null), 4000);
      return;
    }

    // optimistic remove
    const removed = users.find(u => u.id === userId);
    deletedCacheRef.current = [removed];
    setUsers(prev => prev.filter(u => u.id !== userId));
    setPendingDeleteId(null);

    const { error } = await supabase.from('users').delete().eq('id', userId);
    if (error) {
      // rollback
      setUsers(prev => [removed, ...prev]);
      toast({ title: 'Delete failed', description: error.message || String(error), status: 'error', duration: 5000 });
      return;
    }
    // Attempt to delete from Auth
    try {
      if (supabase.auth?.admin?.deleteUserById) {
        await supabase.auth.admin.deleteUserById(userId);
      }
    } catch (e) {
      console.warn('Auth deletion failed', e);
    }
    toast({ title: 'User deleted', status: 'success', duration: 3000 });
  };

  // Send password reset (best-effort)
  const handleSendReset = async (email) => {
    try {
      // Many supabase client methods differ by version. Try best-effort:
      if (supabase.auth?.api?.resetPasswordForEmail) {
        await supabase.auth.api.resetPasswordForEmail(email);
        toast({ title: 'Password reset sent', description: `Reset email sent to ${email}`, status: 'success', duration: 4000 });
      } else if (supabase.auth?.resetPasswordForEmail) {
        await supabase.auth.resetPasswordForEmail(email);
        toast({ title: 'Password reset sent', description: `Reset email sent to ${email}`, status: 'success', duration: 4000 });
      } else {
        // fallback: inform admin to use server-side
        toast({ title: 'Action required', description: 'Password reset must be performed from the server (service role).', status: 'info', duration: 6000 });
      }
    } catch (err) {
      console.error('Password reset error', err);
      toast({ title: 'Reset failed', description: err.message || String(err), status: 'error', duration: 6000 });
    }
  };

  // View activity log for a user
  const handleViewActivity = async (user) => {
    setActivityUser(user);
    onActivityOpen();
    try {
      const { data, error } = await supabase.from('user_activity').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(200);
      if (error) {
        throw error;
      }
      setActivityRows(data || []);
    } catch (err) {
      console.warn('Could not load activity', err);
      setActivityRows([]);
      toast({ title: 'Activity load failed', description: err.message || String(err), status: 'error', duration: 5000 });
    }
  };

  // CSV export of filtered users (current page)
  const exportCsv = () => {
    const rows = users.map(u => ({
      id: u.id,
      full_name: u.full_name,
      email: u.email,
      role: u.role,
      username: u.username,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      status: u.status,
    }));
    const header = Object.keys(rows[0] || {}).join(',');
    const csv = [
      header,
      ...rows.map(r => Object.values(r).map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `users-export-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast({ title: 'CSV exported', status: 'success', duration: 2500 });
  };

  // change sorting
  const handleSort = (field) => {
    if (sortBy === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDir('asc');
    }
    setPage(1);
  };

  // pagination controls
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  // helper: render avatar with initials
  const AvatarOrInitials = ({ name }) => {
    const initials = (name || '').split(/\s+/).filter(Boolean).slice(0,2).map(n => n[0]).join('').toUpperCase() || '?';
    return <Avatar size="sm" name={name} src={null} bg="teal.500" color="white" />;
  };

  return (
    <Box p={6}>
      <Flex justify="space-between" align="center" mb={4}>
        <Heading size="lg">User Management</Heading>

        <HStack spacing={2}>
          <Button colorScheme="teal" onClick={openAddUser}>Add User</Button>
          <Button onClick={exportCsv} leftIcon={<DownloadIcon />}>Export CSV</Button>
        </HStack>
      </Flex>

      <Flex gap={3} align="center" mb={4} flexWrap="wrap">
        <InputGroup maxW="420px">
          <InputLeftElement pointerEvents="none"><Icon as={SearchIcon} color="gray.400" /></InputLeftElement>
          <Input placeholder="Search name, email or username" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search users" />
        </InputGroup>

        <Select placeholder="Filter by role" value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }} maxW="220px">
          <option value="">All roles</option>
          <option value="admin">Admin</option>
          <option value="weighbridge">Weighbridge</option>
          <option value="outgate">Outgate</option>
          <option value="customs">Customs</option>
          <option value="agent">Agent</option>
        </Select>

        <Box flex="1" />

        <Box>
          <Text fontSize="sm" color="gray.600" textAlign="right">Page size</Text>
          <Select size="sm" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} width="100px">
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </Select>
        </Box>
      </Flex>

      <Box borderRadius="md" overflow="hidden" borderWidth="1px">
        {loading ? (
          <Flex justify="center" align="center" py={12}><Spinner size="lg" color="teal.500" /></Flex>
        ) : (
          <Fade in={!loading}>
            <Box overflowX="auto">
              <Table variant="simple" size="sm">
                <Thead bg="gray.100">
                  <Tr>
                    <Th width="48px">
                      <Checkbox isChecked={selectAllOnPage} onChange={toggleSelectAllOnPage} />
                    </Th>
                    <Th onClick={() => handleSort('full_name')} cursor="pointer">Name {sortBy === 'full_name' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</Th>
                    <Th onClick={() => handleSort('email')} cursor="pointer">Email {sortBy === 'email' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</Th>
                    <Th onClick={() => handleSort('role')} cursor="pointer">Role {sortBy === 'role' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</Th>
                    <Th onClick={() => handleSort('created_at')} cursor="pointer">Created {sortBy === 'created_at' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</Th>
                    <Th>Last Login</Th>
                    <Th isNumeric>Actions</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {users.length ? users.map((user) => (
                    <Tr key={user.id}>
                      <Td>
                        <Checkbox isChecked={selectedIds.has(user.id)} onChange={() => toggleSelect(user.id)} />
                      </Td>
                      <Td>
                        <Flex align="center" gap={3}>
                          <AvatarOrInitials name={user.full_name} />
                          <Box>
                            <Text fontWeight="semibold">{user.full_name}</Text>
                            <Text fontSize="xs" color="gray.500">{user.username || ''}</Text>
                          </Box>
                        </Flex>
                      </Td>
                      <Td>{user.email}</Td>
                      <Td>
                        <Menu>
                          <MenuButton as={Button} size="sm" variant="outline">{user.role || '—'}</MenuButton>
                          <MenuList>
                            {['admin','weighbridge','outgate','customs','agent'].map(r => (
                              <MenuItem key={r} onClick={async () => {
                                if (!isAdmin) { toast({ title: 'Permission denied', status: 'error', duration: 3000 }); return; }
                                const prev = users.slice();
                                setUsers(prevU => prevU.map(u => u.id === user.id ? { ...u, role: r } : u));
                                try {
                                  const { error } = await supabase.from('users').update({ role: r }).eq('id', user.id);
                                  if (error) throw error;
                                  toast({ title: 'Role updated', status: 'success', duration: 3000 });
                                } catch (err) {
                                  setUsers(prev);
                                  toast({ title: 'Error', description: err.message || String(err), status: 'error', duration: 5000 });
                                }
                              }}>{r}</MenuItem>
                            ))}
                          </MenuList>
                        </Menu>
                      </Td>
                      <Td>{user.created_at ? new Date(user.created_at).toLocaleString() : '—'}</Td>
                      <Td>{user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : '—'}</Td>
                      <Td isNumeric>
                        <HStack justify="flex-end">
                          <Button size="sm" onClick={() => openEditUser(user)}>Edit</Button>
                          <Button size="sm" variant="ghost" onClick={() => handleViewActivity(user)}>Activity</Button>
                          <Button size="sm" colorScheme="blue" onClick={() => handleSendReset(user.email)}>Reset PW</Button>
                          {isAdmin && <Button size="sm" colorScheme={pendingDeleteId === user.id ? 'red' : 'gray'} onClick={() => handleDelete(user.id)}>{pendingDeleteId === user.id ? 'Confirm' : 'Delete'}</Button>}
                        </HStack>
                      </Td>
                    </Tr>
                  )) : (
                    <Tr><Td colSpan={7} textAlign="center" py={10}>No users found.</Td></Tr>
                  )}
                </Tbody>
              </Table>
            </Box>

            {/* Bulk actions & pagination footer */}
            <Flex justify="space-between" align="center" p={3} borderTop="1px solid" borderColor="gray.100" gap={3} flexWrap="wrap">
              <HStack spacing={2}>
                <Button size="sm" onClick={() => handleBulkChangeRole('weighbridge')} isDisabled={!isAdmin || selectedIds.size === 0}>Make Weighbridge</Button>
                <Button size="sm" onClick={() => handleBulkChangeRole('outgate')} isDisabled={!isAdmin || selectedIds.size === 0}>Make Outgate</Button>
                <Button size="sm" colorScheme="red" onClick={handleBulkDelete} isDisabled={!isAdmin || selectedIds.size === 0}>Delete Selected</Button>
              </HStack>

              <HStack spacing={3}>
                <Text fontSize="sm">Page {page} / {totalPages} ({totalCount} users)</Text>
                <Button size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} isDisabled={page === 1}>Prev</Button>
                <Button size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} isDisabled={page === totalPages}>Next</Button>
              </HStack>
            </Flex>
          </Fade>
        )}
      </Box>

      {/* Add/Edit Modal */}
      <Modal isOpen={isOpen} onClose={handleCloseModal} initialFocusRef={initialRef} isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>{form.id ? 'Edit User' : 'Add User'}</ModalHeader>
          <ModalCloseButton disabled={isSubmitting} />
          <ModalBody pb={6}>
            <form id="user-form" onSubmit={handleSubmit}>
              <FormControl isInvalid={!!errors.full_name} mb={3} isRequired>
                <FormLabel>Full Name</FormLabel>
                <Input ref={initialRef} name="full_name" placeholder="Full name" value={form.full_name} onChange={handleChange} disabled={isSubmitting} />
                <FormErrorMessage>{errors.full_name}</FormErrorMessage>
              </FormControl>

              <FormControl isInvalid={!!errors.email} mb={3} isRequired>
                <FormLabel>Email</FormLabel>
                <Input name="email" type="email" placeholder="Email address" value={form.email} onChange={handleChange} disabled={isSubmitting} />
                <FormErrorMessage>{errors.email}</FormErrorMessage>
              </FormControl>

              <FormControl isInvalid={!!errors.role} mb={3} isRequired>
                <FormLabel>Role</FormLabel>
                <Select name="role" placeholder="Select role" value={form.role} onChange={handleChange} disabled={isSubmitting}>
                  <option value="admin">Admin</option>
                  <option value="weighbridge">Weighbridge</option>
                  <option value="outgate">Outgate</option>
                  <option value="customs">Customs</option>
                  <option value="agent">Agent</option>
                </Select>
                <FormErrorMessage>{errors.role}</FormErrorMessage>
              </FormControl>

              <FormControl isInvalid={!!errors.password} mb={3} isRequired={form.id === null}>
                <FormLabel>Password</FormLabel>
                <Input name="password" type={showPassword ? 'text' : 'password'} placeholder={form.id ? 'Leave blank to keep current password' : 'Password'} value={form.password} onChange={handleChange} disabled={isSubmitting} />
                <FormErrorMessage>{errors.password}</FormErrorMessage>
                <Button size="sm" variant="link" onClick={() => setShowPassword(s => !s)} mt={2}>{showPassword ? 'Hide' : 'Show'}</Button>
              </FormControl>
            </form>
          </ModalBody>
          <ModalFooter>
            <Button onClick={handleCloseModal} mr={3} disabled={isSubmitting}>Cancel</Button>
            <Button colorScheme="teal" type="submit" form="user-form" isLoading={isSubmitting} isDisabled={isSubmitting || !form.full_name || !form.email || !form.role || (form.id === null && !form.password)}>
              {form.id ? 'Update' : 'Add'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Activity modal */}
      <Modal isOpen={isActivityOpen} onClose={() => { setActivityRows([]); onActivityClose(); }} size="xl">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Activity — {activityUser?.full_name ?? ''}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {activityRows.length === 0 ? (
              <Text>No activity logged for this user.</Text>
            ) : (
              <Box>
                {activityRows.map((r) => (
                  <Box key={r.id} borderBottom="1px solid" borderColor="gray.100" py={2}>
                    <Text fontWeight="semibold">{r.action}</Text>
                    <Text fontSize="sm" color="gray.600">{r.details}</Text>
                    <Text fontSize="xs" color="gray.400">{new Date(r.created_at).toLocaleString()}</Text>
                  </Box>
                ))}
              </Box>
            )}
          </ModalBody>
          <ModalFooter>
            <Button onClick={() => { setActivityRows([]); onActivityClose(); }}>Close</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
}

export default UsersPage;
