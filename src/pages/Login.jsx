import React, { useState, useEffect } from "react";
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
  Link,
} from "@chakra-ui/react";
import { useAuth } from "../context/AuthContext";
import { ViewIcon, ViewOffIcon, SunIcon, MoonIcon } from "@chakra-ui/icons";
import { motion } from "framer-motion";
import { Link as RouterLink } from "react-router-dom";
import logo from "../assets/logo.png";
import { supabase } from "../supabaseClient";

const MotionBox = motion(Box);

function Login() {
  const [form, setForm] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
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
    if (!form.email) newErrors.email = "Email is required";
    if (!form.password) newErrors.password = "Password is required";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: form.email.trim(),
        password: form.password,
      });

      if (error) {
        toast({
          title: error.message || "Login failed",
          status: "error",
          duration: 4000,
          isClosable: true,
        });
        return;
      }

      // User is logged in successfully
      toast({
        title: "Login successful",
        status: "success",
        duration: 3000,
        isClosable: true,
      });

      // Call your auth context login handler with user object
      login(data.user);

      // Store email if rememberMe checked, else remove
      if (rememberMe) {
        localStorage.setItem("rememberedEmail", form.email);
      } else {
        localStorage.removeItem("rememberedEmail");
      }
    } catch (error) {
      console.error("Unexpected login error:", error);
      toast({
        title: "Unexpected error, please try again.",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
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
          >
            Log in
          </Button>

        </VStack>
      </MotionBox>
    </Box>
  );
}

export default Login;
