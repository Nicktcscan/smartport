import { useState, useRef, useEffect } from "react";
import { createWorker } from "tesseract.js";
import { Box, Text, Button, Progress } from "@chakra-ui/react";


function OCRComponent({ onComplete }) {
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [workerReady, setWorkerReady] = useState(false);

  const workerRef = useRef(null);

  useEffect(() => {
    let isMounted = true;

    const handleLogger = (m) => {
      if (m.status === "recognizing text") {
        setProgress(Math.round(m.progress * 100));
      }
    };

    async function initWorker() {
      try {
        const worker = createWorker();
        workerRef.current = worker;

        await worker.load();
        await worker.loadLanguage("eng");
        await worker.initialize("eng");

        // Set any parameters if needed (optional)
        await worker.setParameters({
          tessedit_char_whitelist:
            "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:-/ ",
        });

        // Assign logger AFTER initialization to avoid DataCloneError
        workerRef.current.logger = handleLogger;

        if (isMounted) setWorkerReady(true);
      } catch (err) {
        console.error("Failed to initialize Tesseract worker:", err);
        if (isMounted) setWorkerReady(false);
      }
    }

    initWorker();

    return () => {
      isMounted = false;
      if (workerRef.current && workerRef.current.terminate) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    setProgress(0);
    if (onComplete) onComplete(null, null);
  };

  const handleOCR = async () => {
    if (!file) {
      alert("Please upload an image file first.");
      return;
    }
    if (!workerReady) {
      alert("OCR engine is not ready yet. Please wait.");
      return;
    }
    if (!workerRef.current) {
      alert("Worker instance is missing.");
      return;
    }
    if (loading) {
      alert("OCR is already running. Please wait.");
      return;
    }

    setLoading(true);
    setProgress(0);

    try {
      const { data } = await workerRef.current.recognize(file);
      setProgress(100);
      setLoading(false);

      const extractedText = data.text || "";

      if (onComplete) {
        onComplete(file, extractedText);
      }
    } catch (err) {
      console.error("OCR error:", err);
      alert("OCR failed: " + err.message);
      setProgress(0);
      setLoading(false);

      if (onComplete) onComplete(file, null);
    }
  };

  return (
    <Box
      borderWidth={1}
      borderRadius="md"
      p={4}
      maxWidth="400px"
      margin="auto"
      textAlign="center"
    >
      <Text fontSize="xl" fontWeight="semibold" mb={4}>
        Weighbridge OCR Extractor
      </Text>
      <input
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        style={{ marginBottom: 16 }}
      />
      <Button
        colorScheme="blue"
        onClick={handleOCR}
        isLoading={loading}
        loadingText={`Processing (${progress}%)`}
        disabled={!workerReady || loading}
        size="md"
        width="100%"
        borderRadius="md"
        boxShadow="md"
        _hover={{ bg: "blue.600" }}
      >
        Extract Text
      </Button>

      {loading && (
        <Box mt={4}>
          <Progress value={progress} size="sm" colorScheme="blue" borderRadius="sm" />
          <Text mt={2}>{`Processing... ${progress}%`}</Text>
        </Box>
      )}
    </Box>
  );
}

export default OCRComponent;