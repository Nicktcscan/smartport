import { useState, useEffect } from "react";
import {
  Box,
  Input,
  Button,
  VStack,
  FormControl,
  FormLabel,
  FormErrorMessage,
  Checkbox,
  useToast,
  IconButton,
  InputGroup,
  InputRightElement,
  useColorMode,
  useColorModeValue,
  Text,
  Spinner,
} from "@chakra-ui/react";
import { useAuth } from "../context/AuthContext";
import { ViewIcon, ViewOffIcon, SunIcon, MoonIcon } from "@chakra-ui/icons";
import { motion } from "framer-motion";
import logo from "../assets/logo.png";
import { supabase } from "../supabaseClient";

const MotionBox = motion(Box);

function Login() {
  const [form, setForm] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const toast = useToast();
  const { login } = useAuth();
  const { colorMode, toggleColorMode } = useColorMode();

  useEffect(() => {
    const savedEmail = localStorage.getItem("rememberedEmail");
    if (savedEmail) {
      setForm((f) => ({ ...f, email: savedEmail }));
      setRememberMe(true);
    }
  }, []);

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const validate = () => {
    const newErrors = {};
    if (!form.email || !String(form.email).trim()) newErrors.email = "Email is required";
    if (!form.password) newErrors.password = "Password is required";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const isLikelyCorsOrNetworkError = (err) => {
    if (!err) return false;
    const msg = String(err?.message || err).toLowerCase();
    return (
      msg.includes("failed to fetch") ||
      msg.includes("networkerror") ||
      msg.includes("cors") ||
      msg.includes("preflight") ||
      msg.includes("access-control-allow-origin")
    );
  };

    const currentYear = new Date().getFullYear();


  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      // Use Supabase client (signInWithPassword) — this avoids direct manual fetch to /auth/v1/token
      const { data, error } = await supabase.auth.signInWithPassword({
        email: String(form.email).trim(),
        password: form.password,
      });

      // Handle Supabase SDK errors
      if (error) {
        // If it looks like a network/CORS issue give a clearer actionable message
        if (isLikelyCorsOrNetworkError(error)) {
          toast({
            title: "Network / CORS error",
            description:
              "Login request failed due to a network or CORS issue. Make sure your frontend origin is whitelisted in Supabase (Project → Settings → API → Allowed URLs).",
            status: "error",
            duration: 9000,
            isClosable: true,
          });
        } else {
          toast({
            title: error.message || "Login failed",
            status: "error",
            duration: 4000,
            isClosable: true,
          });
        }
        return;
      }

      // SDK sometimes returns null user for various flows (e.g., MFA or magic link).
      const user = data?.user ?? null;

      if (!user) {
        // If no user but no error, show generic guidance
        toast({
          title: "Login incomplete",
          description:
            "Authentication did not return a user object. Check your credentials or auth settings (e.g., magic link / OTP flows).",
          status: "warning",
          duration: 6000,
          isClosable: true,
        });
        return;
      }

      // success
      toast({
        title: "Login successful",
        status: "success",
        duration: 2500,
        isClosable: true,
      });

      // call auth context login handler
      try {
        login(user);
      } catch (ctxErr) {
        console.warn("Auth context login handler threw:", ctxErr);
      }

      // remember email if requested
      if (rememberMe) {
        localStorage.setItem("rememberedEmail", String(form.email).trim());
      } else {
        localStorage.removeItem("rememberedEmail");
      }
    } catch (err) {
      // Unexpected errors (fetch failures, CORS)
      console.error("Unexpected login error:", err);
      if (isLikelyCorsOrNetworkError(err)) {
        toast({
          title: "Network / CORS issue",
          description:
            "Browser blocked the request (CORS). Whitelist your frontend origin in Supabase Dashboard → Project Settings → API → Allowed URLs, then retry. If you run a proxy/backend, ensure it forwards CORS headers.",
          status: "error",
          duration: 10000,
          isClosable: true,
        });
      } else {
        toast({
          title: "Unexpected error",
          description: "An unexpected error occurred. Check console and try again.",
          status: "error",
          duration: 5000,
          isClosable: true,
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const bgColor = useColorModeValue(
    "rgba(255, 255, 255, 0.85)",
    "rgba(26, 32, 44, 0.85)"
  );
  const boxShadow = useColorModeValue(
    "0 8px 32px 0 rgba(31, 38, 135, 0.37)",
    "0 8px 32px 0 rgba(0, 0, 0, 0.7)"
  );
  const borderColor = useColorModeValue(
    "rgba(255, 255, 255, 0.3)",
    "rgba(255, 255, 255, 0.1)"
  );

  return (
    <Box
      bgGradient={useColorModeValue(
        "linear(to-tr, teal.100, blue.300)",
        "linear(to-tr, blue.900, teal.800)"
      )}
      minH="100vh"
      display="flex"
      justifyContent="center"
      alignItems="center"
      px={4}
      position="relative"
      fontFamily="'Poppins', sans-serif"
    >
      <IconButton
        aria-label="Toggle color mode"
        icon={colorMode === "light" ? <MoonIcon /> : <SunIcon />}
        position="absolute"
        top={6}
        right={6}
        size="md"
        bg={useColorModeValue("whiteAlpha.800", "blackAlpha.600")}
        _hover={{ bg: useColorModeValue("whiteAlpha.900", "blackAlpha.800") }}
        onClick={toggleColorMode}
        transition="background-color 0.3s"
      />

      <MotionBox
        bg={bgColor}
        p={10}
        rounded="3xl"
        boxShadow={boxShadow}
        w="full"
        maxW="md"
        border="1px solid"
        borderColor={borderColor}
        backdropFilter="blur(10px)"
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      >
        <Box mb={4} display="flex" justifyContent="center" userSelect="none">
          <Box
            as="img"
            src={logo}
            alt="Nick TC-Scan (Gambia) Ltd Logo"
            maxH={{ base: "100px", md: "140px" }}
            objectFit="contain"
            loading="lazy"
            draggable={false}
          />
        </Box>

        <Text
          mb={6}
          textAlign="center"
          fontWeight="medium"
          color={useColorModeValue("gray.700", "gray.300")}
          fontSize="lg"
          userSelect="none"
        >
          SmartPort Ai-Powered WBM System
        </Text>

        <VStack spacing={6} align="stretch" as="form" onSubmit={handleSubmit}>
          <FormControl isInvalid={!!errors.email} isRequired>
            <FormLabel
              fontWeight="semibold"
              color={useColorModeValue("gray.600", "gray.400")}
            >
              Email
            </FormLabel>
            <Input
              name="email"
              value={form.email}
              onChange={handleChange}
              placeholder="Enter email"
              size="lg"
              focusBorderColor="teal.400"
              _placeholder={{ opacity: 0.7 }}
              autoComplete="email"
              type="email"
            />
            {errors.email && (
              <FormErrorMessage>{errors.email}</FormErrorMessage>
            )}
          </FormControl>

          <FormControl isInvalid={!!errors.password} isRequired>
            <FormLabel
              fontWeight="semibold"
              color={useColorModeValue("gray.600", "gray.400")}
            >
              Password
            </FormLabel>
            <InputGroup>
              <Input
                name="password"
                type={showPassword ? "text" : "password"}
                value={form.password}
                onChange={handleChange}
                placeholder="Enter password"
                size="lg"
                focusBorderColor="teal.400"
                _placeholder={{ opacity: 0.7 }}
                autoComplete="current-password"
              />
              <InputRightElement>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  _hover={{ bg: "transparent" }}
                >
                  {showPassword ? (
                    <ViewOffIcon boxSize={5} color="teal.500" />
                  ) : (
                    <ViewIcon boxSize={5} color="gray.400" />
                  )}
                </Button>
              </InputRightElement>
            </InputGroup>
            {errors.password && (
              <FormErrorMessage>{errors.password}</FormErrorMessage>
            )}
          </FormControl>

          <Checkbox
            isChecked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            colorScheme="teal"
            fontWeight="medium"
          >
            Remember Me
          </Checkbox>

          <Button
            colorScheme="teal"
            size="lg"
            w="full"
            fontWeight="bold"
            boxShadow="lg"
            _hover={{ bg: "teal.600", boxShadow: "xl" }}
            _active={{ bg: "teal.700" }}
            type="submit"
            transition="all 0.3s"
            isLoading={isSubmitting}
            loadingText="Logging in..."
            leftIcon={isSubmitting ? <Spinner size="sm" /> : undefined}
          >
            Log in
          </Button>

{/* COPYRIGHT FOOTER */}
      <Text
        mt={10}
        mb={4}
        fontSize="sm"
        color={useColorModeValue("gray.700", "gray.400")}
        textAlign="center"
        userSelect="none"
      >
        {currentYear} © NICK TC-SCAN (GAMBIA) LTD. All rights reserved.
      </Text>

        </VStack>
      </MotionBox>
    </Box>
  );
}

export default Login;
