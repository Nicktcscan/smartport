// src/pages/UsersPage.jsx
import React, { useState, useEffect, useRef } from 'react';
import {
  Box, Heading, Table, Thead, Tbody, Tr, Th, Td, Input, InputGroup,
  InputLeftElement, InputRightElement, Icon, Button, Flex, Modal,
  ModalOverlay, ModalContent, ModalHeader, ModalFooter, ModalBody,
  ModalCloseButton, FormControl, FormLabel, FormErrorMessage, Select,
  useDisclosure, useToast, Spinner, Fade, useBoolean,
} from '@chakra-ui/react';
import { supabase } from '../supabaseClient';
import { SearchIcon, ViewIcon, ViewOffIcon } from '@chakra-ui/icons';

function UsersPage() {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [filteredUsers, setFilteredUsers] = useState([]);
  const [loading, { on, off }] = useBoolean(true);

  const { isOpen, onOpen, onClose } = useDisclosure();
  const toast = useToast();
  const initialRef = useRef();

  const [form, setForm] = useState({ id: null, full_name: '', email: '', role: '', password: '' });
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);

  // fetch users
  useEffect(() => {
    const fetchUsers = async () => {
      on();
      const { data, error } = await supabase.from('users').select('*').order('created_at', { ascending: false });
      if (error) {
        toast({ title: 'Error loading users', description: error.message, status: 'error', duration: 4000, isClosable: true });
      } else {
        setUsers(data || []);
        setFilteredUsers(data || []);
      }
      off();
    };
    fetchUsers();
  }, [on, off, toast]);

  // filter users based on search
  useEffect(() => {
    setFilteredUsers(users.filter(u => 
      (u.full_name || '').toLowerCase().includes(search.toLowerCase()) ||
      (u.email || '').toLowerCase().includes(search.toLowerCase())
    ));
  }, [search, users]);

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

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    setErrors(prev => ({ ...prev, [e.target.name]: undefined }));
  };

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

  // delete user from both tables
  const handleDelete = async (userId, email) => {
    if (pendingDeleteId !== userId) {
      setPendingDeleteId(userId);
      setTimeout(() => setPendingDeleteId(null), 4000);
    } else {
      try {
        // 1️⃣ delete from custom users table
        const { error: userError } = await supabase.from('users').delete().eq('id', userId);
        if (userError) throw userError;

        // 2️⃣ delete from Supabase Auth (requires service role key)
        const { error: authError } = await supabase.auth.admin.deleteUserById(userId);
        if (authError) throw authError;

        setUsers(users.filter(u => u.id !== userId));
        toast({ title: 'User deleted from Auth & Users table', status: 'info', duration: 3000, isClosable: true });
      } catch (err) {
        toast({ title: 'Delete failed', description: err.message, status: 'error', duration: 4000 });
      } finally {
        setPendingDeleteId(null);
      }
    }
  };

  const generateUsername = (fullName) => {
    if (!fullName.trim()) return '';
    const parts = fullName.trim().split(/\s+/);
    const firstInitial = parts[0][0].toUpperCase();
    const lastName = parts[parts.length - 1].toLowerCase();
    return `${firstInitial}${lastName}`;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setIsSubmitting(true);

    if (form.id === null) {
      // check if email exists in Auth
      const { data: existingAuth, error: authCheckError } = await supabase.auth.admin.listUsers({ email: form.email });
      if (authCheckError) console.error(authCheckError.message);

      if (existingAuth?.length) {
        // delete old auth user first
        await supabase.auth.admin.deleteUserById(existingAuth[0].id);
      }

      // create new auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
      });

      if (authError) {
        toast({ title: 'Failed to add user', description: authError.message, status: 'error', duration: 4000 });
        setIsSubmitting(false);
        return;
      }

      const userId = authData?.user?.id || authData?.session?.user?.id;
      if (!userId) {
        toast({ title: 'Signup requires email confirmation', description: 'Please verify your email before login.', status: 'info', duration: 4000 });
        setIsSubmitting(false);
        return;
      }

      const generatedUsername = generateUsername(form.full_name);

      const { data, error } = await supabase.from('users')
        .insert([{ id: userId, full_name: form.full_name, email: form.email, role: form.role, username: generatedUsername }])
        .select().single();

      if (error) {
        toast({ title: 'Failed to add user profile', description: error.message, status: 'error', duration: 4000 });
        setIsSubmitting(false);
        return;
      }

      setUsers([...users, data]);
      toast({ title: 'User added', description: `${data.full_name} was added successfully. Confirmation email sent.`, status: 'success', duration: 4000 });
      handleCloseModal();
    } else {
      // update existing user
      const payload = { full_name: form.full_name, email: form.email, role: form.role };
      const { data, error } = await supabase.from('users').update(payload).eq('id', form.id).select().single();

      if (error) toast({ title: 'Failed to update user', description: error.message, status: 'error', duration: 4000 });
      else {
        if (form.password) {
          const { error: pwError } = await supabase.auth.admin.updateUserById(form.id, { password: form.password });
          if (pwError) toast({ title: 'Failed to update password', description: pwError.message, status: 'error', duration: 4000 });
        }
        setUsers(users.map(u => (u.id === form.id ? data : u)));
        toast({ title: 'User updated', description: `${data.full_name}'s info was updated successfully.`, status: 'success', duration: 4000 });
        handleCloseModal();
      }
    }

    setIsSubmitting(false);
  };

  const isSubmitDisabled = isSubmitting || !form.full_name || !form.email || !form.role || (form.id === null && !form.password);

  return (
    <Box p={6}>
      <Flex justify="space-between" align="center" mb={6}>
        <Heading size="lg">User Management</Heading>
        <Button colorScheme="teal" onClick={openAddUser}>Add User</Button>
      </Flex>

      <InputGroup mb={4} maxW="400px">
        <InputLeftElement pointerEvents="none"><Icon as={SearchIcon} color="gray.400" /></InputLeftElement>
        <Input placeholder="Search by name or email" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search users by name or email" />
      </InputGroup>

      <Box overflowX="auto" minH="200px">
        {loading ? (
          <Flex justify="center" align="center" h="200px"><Spinner size="xl" color="teal.500" /></Flex>
        ) : (
          <Fade in={!loading}>
            <Table variant="simple" size="md">
              <Thead bg="gray.100">
                <Tr>
                  <Th>ID</Th>
                  <Th>Full Name</Th>
                  <Th>Email</Th>
                  <Th>Role</Th>
                  <Th isNumeric>Actions</Th>
                </Tr>
              </Thead>
              <Tbody>
                {filteredUsers.length ? filteredUsers.map((user) => (
                  <Tr key={user.id}>
                    <Td>{user.id}</Td>
                    <Td>{user.full_name}</Td>
                    <Td>{user.email}</Td>
                    <Td>{user.role}</Td>
                    <Td isNumeric>
                      <Button size="sm" colorScheme="blue" mr={2} onClick={() => openEditUser(user)}>Edit</Button>
                      <Button size="sm" colorScheme={pendingDeleteId === user.id ? 'red' : 'gray'} onClick={() => handleDelete(user.id, user.email)}>
                        {pendingDeleteId === user.id ? 'Confirm Delete' : 'Delete'}
                      </Button>
                    </Td>
                  </Tr>
                )) : (
                  <Tr><Td colSpan={5} textAlign="center" py={10}>No users found.</Td></Tr>
                )}
              </Tbody>
            </Table>
          </Fade>
        )}
      </Box>

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
                <InputGroup>
                  <Input name="password" type={showPassword ? 'text' : 'password'} placeholder={form.id ? 'Leave blank to keep current password' : 'Password'} value={form.password} onChange={handleChange} disabled={isSubmitting} />
                  <InputRightElement width="3rem">
                    <Button h="1.75rem" size="sm" onClick={() => setShowPassword(!showPassword)} tabIndex={-1} disabled={isSubmitting} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                      {showPassword ? <ViewOffIcon /> : <ViewIcon />}
                    </Button>
                  </InputRightElement>
                </InputGroup>
                <FormErrorMessage>{errors.password}</FormErrorMessage>
              </FormControl>
            </form>
          </ModalBody>
          <ModalFooter>
            <Button onClick={handleCloseModal} mr={3} disabled={isSubmitting}>Cancel</Button>
            <Button colorScheme="teal" type="submit" form="user-form" isLoading={isSubmitting} isDisabled={isSubmitDisabled}>
              {form.id ? 'Update' : 'Add'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
}

export default UsersPage;
