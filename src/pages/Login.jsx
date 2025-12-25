// src/pages/Login.jsx
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
  Flex,
  VisuallyHidden,
  Icon,
  Center,
} from "@chakra-ui/react";
import { useAuth } from "../context/AuthContext";
import { ViewIcon, ViewOffIcon, SunIcon, MoonIcon } from "@chakra-ui/icons";
import { motion } from "framer-motion";
import logo from "../assets/logo.png";
import { supabase } from "../supabaseClient";
import { FaSnowflake, FaGift, FaStar, FaLeaf } from "react-icons/fa";

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
      // Use Supabase client (signInWithPassword)
      const { data, error } = await supabase.auth.signInWithPassword({
        email: String(form.email).trim(),
        password: form.password,
      });

      if (error) {
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

      const user = data?.user ?? null;

      if (!user) {
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

      toast({
        title: "Login successful",
        status: "success",
        duration: 2500,
        isClosable: true,
      });

      try {
        login(user);
      } catch (ctxErr) {
        console.warn("Auth context login handler threw:", ctxErr);
      }

      if (rememberMe) {
        localStorage.setItem("rememberedEmail", String(form.email).trim());
      } else {
        localStorage.removeItem("rememberedEmail");
      }
    } catch (err) {
      console.error("Unexpected login error:", err);
      if (isLikelyCorsOrNetworkError(err)) {
        toast({
          title: "Network / CORS issue",
          description:
            "Browser blocked the request (CORS). Whitelist your frontend origin in Supabase Dashboard → Project Settings → API → Allowed URLs, then retry.",
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

  // theme-safe colors (keeps feel across light/dark)
  const bgGradient = useColorModeValue(
    "linear(to-tr, #ffefef 0%, #fff9f0 40%, #f0fcf4 100%)",
    "linear(to-tr, #07192b 0%, #0b2536 40%, #052225 100%)"
  );
  const cardBg = useColorModeValue("rgba(255,255,255,0.9)", "rgba(6,10,14,0.78)");
  const border = useColorModeValue("rgba(200, 200, 200, 0.2)", "rgba(255,255,255,0.06)");
  const accentColor = useColorModeValue("red.600", "red.400");
  const accentAlt = useColorModeValue("green.600", "green.300");

  // small decorative snow nodes (rendered absolutely)
  const Snow = () => (
    <>
      {/* 8 decorative snowflakes */}
      {Array.from({ length: 8 }).map((_, i) => (
        <Box
          key={`snow-${i}`}
          className={`snowflake snow-${i}`}
          as="span"
          aria-hidden
          position="absolute"
          top={`${-10 - i * 3}%`}
          left={`${(i * 13) % 100}%`}
          transform={`translateY(-10vh)`}
        >
          <Icon as={FaSnowflake} boxSize={3 + (i % 3)} opacity={0.85} />
        </Box>
      ))}
    </>
  );

  return (
    <Box
      bgGradient={bgGradient}
      minH="100vh"
      display="flex"
      justifyContent="center"
      alignItems="center"
      px={4}
      position="relative"
      fontFamily="'Poppins', Inter, system-ui, -apple-system, 'Segoe UI', Roboto"
      overflow="hidden"
    >
      {/* Snow / confetti decorative layer */}
      <style>
        {`
        /* falling snow animation */
        @keyframes fall {
          0% { transform: translateY(-10vh) rotate(0deg); opacity: 0; }
          10% { opacity: 1; }
          100% { transform: translateY(110vh) rotate(360deg); opacity: 0.9; }
        }
        /* twinkle */
        @keyframes twinkle {
          0% { opacity: 0.6; transform: scale(0.98); }
          50% { opacity: 1; transform: scale(1.05); }
          100% { opacity: 0.6; transform: scale(0.98); }
        }
        .snowflake {
          pointer-events: none;
          will-change: transform, opacity;
        }
        /* distribute durations & delays for variety */
        .snow-0 { animation: fall 12s linear infinite; left: 6%; animation-delay: 0s; opacity: 0.9; }
        .snow-1 { animation: fall 14s linear infinite; left: 22%; animation-delay: 1s; opacity: 0.85; }
        .snow-2 { animation: fall 10s linear infinite; left: 36%; animation-delay: 0.5s; opacity: 0.88; }
        .snow-3 { animation: fall 13s linear infinite; left: 52%; animation-delay: 0.2s; opacity: 0.8; }
        .snow-4 { animation: fall 11s linear infinite; left: 68%; animation-delay: 0.7s; opacity: 0.9; }
        .snow-5 { animation: fall 15s linear infinite; left: 80%; animation-delay: 1.6s; opacity: 0.85; }
        .snow-6 { animation: fall 13s linear infinite; left: 40%; animation-delay: 2s; opacity: 0.9; }
        .snow-7 { animation: fall 16s linear infinite; left: 92%; animation-delay: 0.4s; opacity: 0.82; }

        /* little star twinkle near logo */
        .twinkle-star { animation: twinkle 2.6s ease-in-out infinite; transform-origin: center; }

        /* subtle vignette */
        .vignette::after {
          content: "";
          position: absolute;
          inset: 0;
          pointer-events: none;
          background: radial-gradient(ellipse at center, rgba(0,0,0,0) 50%, rgba(0,0,0,0.06) 100%);
          mix-blend-mode: multiply;
        }

        /* responsive adjustments */
        @media (max-width: 480px) {
          .logo-box { max-height: 92px; }
        }
        `}
      </style>

      <Snow />

      {/* Theme toggle */}
      <IconButton
        aria-label="Toggle color mode"
        icon={colorMode === "light" ? <MoonIcon /> : <SunIcon />}
        position="absolute"
        top={6}
        right={6}
        size="md"
        bg={useColorModeValue("whiteAlpha.900", "blackAlpha.600")}
        _hover={{ bg: useColorModeValue("whiteAlpha.950", "blackAlpha.700") }}
        onClick={toggleColorMode}
        transition="background-color 0.3s"
      />

      <MotionBox
        bg={cardBg}
        p={{ base: 6, md: 10 }}
        rounded="3xl"
        boxShadow={useColorModeValue("0 20px 60px rgba(99,102,241,0.08)", "0 18px 50px rgba(2,6,23,0.6)")}
        w="full"
        maxW="md"
        border="1px solid"
        borderColor={border}
        backdropFilter="blur(8px) saturate(120%)"
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        position="relative"
        aria-labelledby="login-heading"
      >
        {/* Garland + small holly & star */}
        <Flex justify="center" align="center" mb={4} gap={3} flexDirection="column">
          <Box position="relative" display="inline-block" className="logo-box">
            {/* small ribbon on logo (decorative) */}
            <Box position="absolute" top="-10px" left="-14px" zIndex={5} transform="rotate(-18deg)">
              <Icon as={FaStar} boxSize={6} color={accentAlt} className="twinkle-star" />
            </Box>

            <Box
              as="img"
              src={logo}
              alt="Nick TC-Scan (Gambia) Ltd Logo"
              maxH={{ base: "78px", md: "110px" }}
              objectFit="contain"
              loading="lazy"
              draggable={false}
              style={{ filter: colorMode === "dark" ? "brightness(1.02) contrast(1.05)" : undefined }}
            />

            {/* small gift badge */}
            <Box position="absolute" bottom="-8px" right="-8px" bg={accentColor} color="white" borderRadius="full" p={2} boxShadow="sm">
              <Icon as={FaGift} boxSize={3.5} />
            </Box>
          </Box>

          <Box textAlign="center">
            <Text id="login-heading" fontSize={{ base: "lg", md: "xl" }} fontWeight="700" color={useColorModeValue("gray.700", "gray.100")}>
              Merry Christmas — Welcome
            </Text>
            <Text fontSize="sm" color={useColorModeValue("gray.600", "gray.300")}>
              Warm wishes from NICK TC-SCAN — safe journeys and peaceful holidays.
            </Text>
          </Box>
        </Flex>

        <VStack spacing={5} align="stretch" as="form" onSubmit={handleSubmit}>
          <FormControl isInvalid={!!errors.email} isRequired>
            <FormLabel fontWeight="semibold" color={useColorModeValue("gray.700", "gray.300")}>
              Email
            </FormLabel>
            <Input
              name="email"
              value={form.email}
              onChange={handleChange}
              placeholder="you@company.com"
              size="lg"
              focusBorderColor={accentAlt}
              autoComplete="email"
              type="email"
              bg={useColorModeValue("white", "blackAlpha.300")}
            />
            {errors.email && <FormErrorMessage>{errors.email}</FormErrorMessage>}
          </FormControl>

          <FormControl isInvalid={!!errors.password} isRequired>
            <FormLabel fontWeight="semibold" color={useColorModeValue("gray.700", "gray.300")}>
              Password
            </FormLabel>
            <InputGroup>
              <Input
                name="password"
                type={showPassword ? "text" : "password"}
                value={form.password}
                onChange={handleChange}
                placeholder="••••••••"
                size="lg"
                focusBorderColor={accentAlt}
                autoComplete="current-password"
                bg={useColorModeValue("white", "blackAlpha.300")}
              />
              <InputRightElement>
                <IconButton
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  _hover={{ bg: "transparent" }}
                >
                  {showPassword ? <ViewOffIcon boxSize={5} color={accentAlt} /> : <ViewIcon boxSize={5} color="gray.400" />}
                </IconButton>
              </InputRightElement>
            </InputGroup>
            {errors.password && <FormErrorMessage>{errors.password}</FormErrorMessage>}
          </FormControl>

          <Flex align="center" justify="space-between">
            <Checkbox
              isChecked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              colorScheme="green"
              fontWeight="medium"
            >
              Remember me
            </Checkbox>

            <Button variant="link" size="sm" onClick={() => toast({ title: "Forgot password", description: "Use your organization's password reset flow.", status: "info" })}>
              Forgot password?
            </Button>
          </Flex>

          <Button
            colorScheme="red"
            size="lg"
            w="full"
            fontWeight="bold"
            boxShadow="lg"
            _hover={{ bg: "red.600", boxShadow: "xl" }}
            _active={{ bg: "red.700" }}
            type="submit"
            transition="all 0.2s"
            isLoading={isSubmitting}
            loadingText="Signing in..."
            leftIcon={isSubmitting ? <Spinner size="sm" /> : <FaLeaf />}
          >
            Sign in
          </Button>

          {/* Small decorative message row */}
          <Center>
            <Text fontSize="sm" color={useColorModeValue("gray.600", "gray.400")}>
              <Icon as={FaStar} color={accentAlt} mr={2} /> Season's greetings — stay safe & blessed.
            </Text>
          </Center>

          {/* COPYRIGHT FOOTER */}
          <Text
            mt={2}
            fontSize="xs"
            color={useColorModeValue("gray.600", "gray.400")}
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
