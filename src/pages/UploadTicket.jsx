// src/pages/UploadTicket.jsx
import React, { useState } from 'react';
import {
  Box,
  Heading,
  Input,
  Button,
  FormControl,
  FormLabel,
  useToast,
} from '@chakra-ui/react';
import axios from 'axios';

function UploadTicket() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const toast = useToast();

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleUpload = async () => {
    if (!file) {
      toast({
        title: 'No file selected',
        status: 'warning',
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    const formData = new FormData();
    formData.append('ticket_file', file);

    setUploading(true);
    try {
      await axios.post('/api/tickets/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast({
        title: 'Ticket uploaded successfully',
        status: 'success',
        duration: 3000,
        isClosable: true,
      });
      setFile(null);
    } catch (err) {
      toast({
        title: 'Upload failed',
        description: err.response?.data?.message || 'Try again later',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    }
    setUploading(false);
  };

  return (
    <Box maxW="md" mx="auto">
      <Heading mb={6}>Upload Weighbridge Ticket</Heading>
      <FormControl>
        <FormLabel>Upload Ticket (Image or PDF)</FormLabel>
        <Input type="file" accept="image/*,.pdf" onChange={handleFileChange} />
      </FormControl>
      <Button
        mt={4}
        colorScheme="blue"
        onClick={handleUpload}
        isLoading={uploading}
        loadingText="Uploading"
      >
        Upload
      </Button>
    </Box>
  );
}

export default UploadTicket;
