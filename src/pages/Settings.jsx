// src/pages/SystemSettings.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box, Flex, Heading, Text, Button, IconButton, Input, Select, FormControl, FormLabel,
  Table, Thead, Tbody, Tr, Th, Td, VStack, HStack, Badge, Switch, Modal, ModalOverlay,
  ModalContent, ModalHeader, ModalBody, ModalFooter, ModalCloseButton, useDisclosure,
  useToast, SimpleGrid, Tabs, TabList, TabPanels, Tab, TabPanel, Slider, SliderTrack, SliderFilledTrack,
  SliderThumb, Tooltip, Avatar, Menu, MenuButton, MenuList, MenuItem, Checkbox,
  Textarea, Divider, Spinner, Progress, Spacer, AvatarGroup
} from "@chakra-ui/react";
import { motion } from "framer-motion";
import {
  AddIcon, EditIcon, DeleteIcon, SettingsIcon, DownloadIcon, RepeatIcon, SearchIcon, ViewIcon, StarIcon, CheckIcon
} from "@chakra-ui/icons";
import confetti from "canvas-confetti";
import { supabase } from "../supabaseClient";

/**
 * SystemSettings.jsx - Cyber Panels Dashboard (2-column layout)
 *
 * Clean, responsive panels layout; glassmorphism + neon accents.
 * Key features:
 * - Users & Roles management
 * - Permissions Matrix
 * - Feature Toggles
 * - Integrations (API keys/webhooks) preview
 * - Audit / Notifications
 * - Floating crystal orb + holographic modal
 * - Voice command console (examples)
 *
 * Notes:
 * - This is one-file implementation for quick drop-in.
 * - For real production: split components, secure server endpoints for sensitive ops.
 */

// --------------------------- Styling utilities ---------------------------
const NeonCard = ({ children, sx = {}, ...props }) => (
  <Box
    p={4}
    borderRadius="12px"
    border="1px solid"
    borderColor="rgba(255,255,255,0.04)"
    bg="linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0.18))"
    boxShadow="0 8px 28px rgba(4,8,20,0.5)"
    {...props}
    style={{ backfaceVisibility: "hidden", ...sx }}
  >
    {children}
  </Box>
);

const OrbButton = ({ onClick }) => (
  <Box position="fixed" bottom={20} right={20} zIndex={1400}>
    <motion.div animate={{ scale: [1, 1.06, 1] }} transition={{ duration: 3, repeat: Infinity }}>
      <Box
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter") onClick(); }}
        onClick={onClick}
        width="88px" height="88px" borderRadius="50%"
        display="flex" alignItems="center" justifyContent="center"
        sx={{
          background: "radial-gradient(circle at 30% 30%, rgba(72,187,120,0.45), rgba(88,24,139,0.6))",
          boxShadow: "0 14px 40px rgba(88,24,139,0.25)",
          cursor: "pointer",
        }}
        aria-label="Open quick create modal"
      >
        <svg width="46" height="46" viewBox="0 0 24 24" fill="none" style={{ filter: "drop-shadow(0 6px 12px rgba(88,24,139,0.18))" }}>
          <path d="M12 2L15.5 8L22 9L17 14L18.5 21L12 18L5.5 21L7 14L2 9L8.5 8L12 2Z" stroke="white" strokeOpacity="0.95" strokeWidth="0.8" fill="rgba(255,255,255,0.06)"/>
        </svg>
      </Box>
    </motion.div>
  </Box>
);

// --------------------------- Helper functions ---------------------------
const formatDate = (d) => (d ? new Date(d).toLocaleString() : "-");
const blastConfetti = () => confetti({ particleCount: 100, spread: 140, origin: { y: 0.6 } });

function sanitizeForDb(obj = {}) {
  const out = { ...obj };
  Object.keys(out).forEach((k) => {
    if (out[k] === "") out[k] = null;
    if (typeof out[k] === "string") {
      const trimmed = out[k].trim();
      if (/^[0-9,.\s]+$/.test(trimmed)) {
        const num = Number(trimmed.replace(/,/g, ""));
        if (!Number.isNaN(num)) out[k] = num;
      } else {
        out[k] = trimmed;
      }
    }
  });
  return out;
}

// --------------------------- Main component ---------------------------
export default function SystemSettings() {
  const toast = useToast();

  // layout/responsive
  const [isMobile, setIsMobile] = useState(false);
  const [isUltraWide, setIsUltraWide] = useState(false);
  useEffect(() => {
    const mqMobile = window.matchMedia("(max-width: 900px)");
    const mqUltra = window.matchMedia("(min-width: 1600px)");
    const onMobile = () => setIsMobile(mqMobile.matches);
    const onUltra = () => setIsUltraWide(mqUltra.matches);
    mqMobile.addEventListener?.("change", onMobile);
    mqUltra.addEventListener?.("change", onUltra);
    onMobile(); onUltra();
    return () => {
      try { mqMobile.removeEventListener?.("change", onMobile); } catch {}
      try { mqUltra.removeEventListener?.("change", onUltra); } catch {}
    };
  }, []);

  // data state
  const [users, setUsers] = useState([]);
  const [profilesMap, setProfilesMap] = useState({});
  const [roles, setRoles] = useState([
    { id: "weighbridge", label: "Weighbridge" },
    { id: "customs", label: "Customs" },
    { id: "outgate", label: "Outgate" },
    { id: "admin", label: "Administrator" },
    { id: "agent", label: "Agent" },
  ]);
  const [permissionsMatrix, setPermissionsMatrix] = useState({}); // module -> role -> set
  const [featureToggles, setFeatureToggles] = useState({
    can_confirm_exit: true, can_edit_sad: false, can_export_reports: true, can_view_financials: false,
    maintenance_mode: false, confetti_enabled: true
  });
  const [apiKeys, setApiKeys] = useState([]);
  const [webhooks, setWebhooks] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [notificationsList, setNotificationsList] = useState([]);
  const [loading, setLoading] = useState(false);

  // modals/drawer
  const { isOpen: isUserModalOpen, onOpen: openUserModal, onClose: closeUserModal } = useDisclosure();
  const { isOpen: isRoleModalOpen, onOpen: openRoleModal, onClose: closeRoleModal } = useDisclosure();
  const { isOpen: isOrbOpen, onOpen: openOrb, onClose: closeOrb } = useDisclosure();

  // local forms
  const [newUser, setNewUser] = useState({ email: "", full_name: "", role: "weighbridge", password: "" });
  const [selectedRole, setSelectedRole] = useState(null);
  const [newRole, setNewRole] = useState({ id: "", label: "", description: "", perms: {} });

  // voice
  const recognitionRef = useRef(null);
  const [listening, setListening] = useState(false);
  const [lastVoice, setLastVoice] = useState("");

  // modules list (for permission matrix)
  const MODULES = useMemo(() => [
    "SAD Declarations", "Confirm Exits", "Tickets", "Weight Reports", "Outgate Reports", "Admin Dashboard", "System Settings",
    "Vessel & Voyage", "Agent Registration", "Payments", "Notifications", "Container Tracking"
  ], []);

  const PERMISSIONS = ["view", "create", "edit", "delete", "export", "confirm_exit", "edit_sad", "view_financials"];

  // --------------------------- Data fetching ---------------------------
  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      const { data: usersData, error: usersErr } = await supabase.from("users").select("*").order("created_at", { ascending: false });
      if (usersErr) throw usersErr;
      setUsers(usersData || []);

      const { data: pfData } = await supabase.from("profiles").select("*");
      const map = {};
      (pfData || []).forEach(p => { map[p.id] = p; });
      setProfilesMap(map);

      const { data: auditData } = await supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(200);
      setAuditLogs(auditData || []);

      const { data: notifData } = await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(200);
      setNotificationsList(notifData || []);

      // integration tables may or may not exist
      try {
        const { data: keys } = await supabase.from("integration_keys").select("*");
        setApiKeys(keys || []);
      } catch { setApiKeys([]); }
      try {
        const { data: hooks } = await supabase.from("webhooks").select("*");
        setWebhooks(hooks || []);
      } catch { setWebhooks([]); }

      // initialize permission matrix if empty
      setPermissionsMatrix((prev) => {
        if (Object.keys(prev).length) return prev;
        const pm = {};
        MODULES.forEach(mod => {
          pm[mod] = {};
          roles.forEach(r => {
            // default basic perms
            pm[mod][r.id] = new Set(PERMISSIONS.filter((p) => p === "view" || (r.id === "admin")));
          });
        });
        return pm;
      });
    } catch (err) {
      console.error("refreshAll", err);
      toast({ title: "Load failed", description: String(err.message || err), status: "error" });
    } finally {
      setLoading(false);
    }
  }, [MODULES, roles, toast]);

  useEffect(() => { refreshAll(); }, [refreshAll]);

  // --------------------------- Permission helpers ---------------------------
  const togglePermission = (moduleName, roleId, permission) => {
    setPermissionsMatrix(prev => {
      const next = { ...prev };
      if (!next[moduleName]) next[moduleName] = {};
      if (!next[moduleName][roleId]) next[moduleName][roleId] = new Set();
      const setPerm = new Set(next[moduleName][roleId]);
      if (setPerm.has(permission)) setPerm.delete(permission);
      else setPerm.add(permission);
      next[moduleName][roleId] = setPerm;
      return next;
    });
  };

  const exportPermissions = () => {
    const payload = {};
    Object.entries(permissionsMatrix).forEach(([mod, roleMap]) => {
      payload[mod] = {};
      Object.entries(roleMap).forEach(([rid, setP]) => {
        payload[mod][rid] = Array.from(setP);
      });
    });
    const blob = new Blob([JSON.stringify({ generated_at: new Date().toISOString(), data: payload }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "permissions-profile.json"; a.click(); URL.revokeObjectURL(url);
    toast({ title: "Exported", description: "Permissions profile downloaded", status: "success" });
  };

  const importPermissions = async (file) => {
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const data = json.data || json.profile || json;
      const next = {};
      Object.entries(data).forEach(([mod, roleMap]) => {
        next[mod] = {};
        Object.entries(roleMap).forEach(([rid, arr]) => {
          next[mod][rid] = new Set(Array.isArray(arr) ? arr : []);
        });
      });
      setPermissionsMatrix(next);
      toast({ title: "Imported", status: "success" });
    } catch (err) {
      console.error("import err", err);
      toast({ title: "Import failed", description: err.message || String(err), status: "error" });
    }
  };

  // --------------------------- Users CRUD ---------------------------
  const createUser = async (payload) => {
    setLoading(true);
    try {
      const sanitized = sanitizeForDb(payload);
      const { data, error } = await supabase.from("users").insert([sanitized]).select().single();
      if (error) throw error;
      // upsert profile
      await supabase.from("profiles").upsert([{ id: data.id, role: data.role, full_name: payload.full_name }]);
      await refreshAll();
      if (featureToggles.confetti_enabled) blastConfetti();
      toast({ title: "User created", description: data.email, status: "success" });
      await supabase.from("audit_logs").insert([{ action: `Created user ${data.email}`, user_id: null }]);
    } catch (err) {
      console.error("createUser", err);
      toast({ title: "Create failed", description: String(err.message || err), status: "error" });
    } finally {
      setLoading(false);
    }
  };

  const updateUser = async (id, payload) => {
    setLoading(true);
    try {
      const sanitized = sanitizeForDb(payload);
      const { error } = await supabase.from("users").update(sanitized).eq("id", id);
      if (error) throw error;
      if (payload.full_name || payload.role) {
        await supabase.from("profiles").upsert([{ id, role: payload.role, full_name: payload.full_name }]);
      }
      await refreshAll();
      toast({ title: "User updated", status: "success" });
      await supabase.from("audit_logs").insert([{ action: `Updated user ${id}` }]);
    } catch (err) {
      console.error("updateUser", err);
      toast({ title: "Update failed", description: String(err.message || err), status: "error" });
    } finally {
      setLoading(false);
    }
  };

  const deactivateUser = async (id) => {
    setLoading(true);
    try {
      // simple soft-deactivate: set role to agent (or implement disabled flag)
      const { error } = await supabase.from("users").update({ role: "agent" }).eq("id", id);
      if (error) throw error;
      await refreshAll();
      toast({ title: "User deactivated", status: "success" });
      await supabase.from("audit_logs").insert([{ action: `Deactivated user ${id}` }]);
    } catch (err) {
      console.error("deactivateUser", err);
      toast({ title: "Deactivate failed", description: String(err.message || err), status: "error" });
    } finally {
      setLoading(false);
    }
  };

  // --------------------------- Integrations helpers (client-side stubs) ---------------------------
  const createApiKey = (name) => {
    const key = Math.random().toString(36).slice(2, 18) + "-" + Date.now().toString(36);
    const item = { id: Math.random().toString(36).slice(2, 8), name, key_masked: `****${key.slice(-6)}`, created_at: new Date().toISOString(), raw_key: key };
    setApiKeys(prev => [item, ...prev]);
    toast({ title: "API key created", description: "Copy raw key now (masked later)", status: "success" });
    supabase.from("audit_logs").insert([{ action: `Created API Key ${name}` }]).catch(()=>{});
  };

  const createWebhook = (payload) => {
    const item = { id: Math.random().toString(36).slice(2, 8), ...payload, created_at: new Date().toISOString() };
    setWebhooks(prev => [item, ...prev]);
    toast({ title: "Webhook added", status: "success" });
    supabase.from("audit_logs").insert([{ action: `Added webhook ${payload.name}` }]).catch(()=>{});
  };

  // --------------------------- Voice console ---------------------------
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;
    if (!SpeechRecognition) {
      recognitionRef.current = null;
      return;
    }
    const rec = new SpeechRecognition();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = "en-US";
    rec.onresult = (ev) => {
      const text = ev.results[0][0].transcript.trim();
      setLastVoice(text);
      parseVoiceCommand(text.toLowerCase());
    };
    rec.onerror = (e) => {
      toast({ title: "Speech error", description: e.error || "Recognition error", status: "error" });
    };
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    return () => { try { rec.stop(); } catch {} };
    // eslint-disable-next-line
  }, [users]);

  const toggleListening = () => {
    if (!recognitionRef.current) { toast({ title: "No voice support", status: "warning" }); return; }
    if (listening) {
      recognitionRef.current.stop(); setListening(false);
    } else {
      try { recognitionRef.current.start(); setListening(true); } catch (err) { toast({ title: "Start failed" }); }
    }
  };

  const parseVoiceCommand = async (txt) => {
    toast({ title: "Voice command", description: txt, status: "info" });
    // "promote john doe to administrator"
    if (txt.startsWith("promote ")) {
      const m = txt.match(/promote\s+(.+?)\s+to\s+(.+)/);
      if (m) {
        const name = m[1].trim();
        const targetRole = m[2].trim();
        const user = users.find(u => (u.email || "").toLowerCase().includes(name) || (profilesMap[u.id]?.full_name || "").toLowerCase().includes(name));
        const role = roles.find(r => r.id.toLowerCase() === targetRole || r.label.toLowerCase() === targetRole);
        if (!user) { toast({ title: "User not found", status: "warning" }); return; }
        if (!role) { toast({ title: "Role not found", status: "warning" }); return; }
        await updateUser(user.id, { role: role.id });
        toast({ title: "Promoted", description: `${user.email} → ${role.label}`, status: "success" });
        return;
      }
    }
    // "disable user sarah"
    if (txt.startsWith("disable user") || txt.startsWith("deactivate user")) {
      const m = txt.match(/(?:disable|deactivate) user\s+(.+)/);
      if (m) {
        const name = m[1].trim();
        const user = users.find(u => (u.email || "").toLowerCase().includes(name) || (profilesMap[u.id]?.full_name || "").toLowerCase().includes(name));
        if (!user) { toast({ title: "User not found", status: "warning" }); return; }
        await deactivateUser(user.id);
        toast({ title: "User disabled", description: user.email, status: "success" });
        return;
      }
    }
    // other commands
    toast({ title: "Unknown command", description: txt, status: "info" });
  };

  // --------------------------- UI small components ---------------------------
  const PanelHeader = ({ title, subtitle, actions }) => (
    <Flex align="center" mb={3}>
      <Box>
        <Text fontSize="sm" color="gray.300">{subtitle}</Text>
        <Heading size="md" letterSpacing="-0.5px">{title}</Heading>
      </Box>
      <Spacer />
      <HStack spacing={2}>
        {actions}
      </HStack>
    </Flex>
  );

  const UserRow = ({ u }) => {
    const profile = profilesMap[u.id] || {};
    return (
      <Tr key={u.id}>
        <Td>
          <HStack>
            <Avatar size="sm" name={profile.full_name || u.email} />
            <Box>
              <Text fontWeight="bold">{profile.full_name || "-"}</Text>
              <Text fontSize="sm" color="gray.400">{u.email}</Text>
            </Box>
          </HStack>
        </Td>
        <Td>{u.role}</Td>
        <Td>{u.created_at ? new Date(u.created_at).toLocaleString() : "-"}</Td>
        <Td>
          <HStack>
            <IconButton size="sm" aria-label="Edit" icon={<EditIcon />} onClick={() => { setNewUser({ email: u.email, full_name: profile.full_name || "", role: u.role }); openUserModal(); }} />
            <IconButton size="sm" aria-label="Deactivate" icon={<DeleteIcon />} onClick={() => deactivateUser(u.id)} />
          </HStack>
        </Td>
      </Tr>
    );
  };

  // --------------------------- Render ---------------------------
  return (
    <Box p={[3, 4, 6]} maxW="1400px" mx="auto">
      {/* Header */}
      <Flex align="center" gap={4} mb={6}>
        <Box>
          <Heading size="lg" color="teal.200">System Settings</Heading>
          <Text color="gray.400">Centralized configuration & admin tools — Cyber Panels Dashboard</Text>
        </Box>
        <Spacer />
        <HStack spacing={2}>
          <Button size="sm" leftIcon={<DownloadIcon />} onClick={exportPermissions}>Export Permissions</Button>
          <Button size="sm" leftIcon={<RepeatIcon />} onClick={() => refreshAll()}>Refresh</Button>
          <IconButton aria-label="voice" size="sm" icon={<StarIcon color={listening ? "red.300" : "yellow.300"} />} onClick={() => toggleListening()} />
        </HStack>
      </Flex>

      {loading && <Progress size="xs" isIndeterminate mb={4} />}

      {/* Grid of panels - 2 columns on wider screens */}
      <SimpleGrid columns={[1, 1, 2]} spacing={5}>

        {/* Users panel */}
        <NeonCard>
          <PanelHeader title="Users" subtitle="Create, edit, and deactivate users" actions={<Button size="sm" leftIcon={<AddIcon />} onClick={() => { setNewUser({ email: "", full_name: "", role: "weighbridge", password: "" }); openUserModal(); }}>New User</Button>} />
          <Box maxH="320px" overflowY="auto">
            <Table size="sm" variant="simple">
              <Thead>
                <Tr><Th>User</Th><Th>Role</Th><Th>Created</Th><Th>Actions</Th></Tr>
              </Thead>
              <Tbody>
                {users.map(u => <UserRow key={u.id} u={u} />)}
              </Tbody>
            </Table>
            {users.length === 0 && <Text mt={2} color="gray.400">No users yet</Text>}
          </Box>
        </NeonCard>

        {/* Roles panel */}
        <NeonCard>
          <PanelHeader title="Roles" subtitle="Role and permission quick editor" actions={<Button size="sm" leftIcon={<AddIcon />} onClick={() => { setNewRole({ id: "", label: "", description: "", perms: {} }); openRoleModal(); }}>New Role</Button>} />
          <Box>
            <SimpleGrid columns={[1, 2]} spacing={3}>
              {roles.map(r => (
                <Box key={r.id} p={3} borderRadius={10} border="1px solid rgba(255,255,255,0.03)" bg="rgba(0,0,0,0.12)">
                  <Flex align="center">
                    <Avatar name={r.label} size="sm" />
                    <Box ml={3}><Text fontWeight="bold">{r.label}</Text><Text fontSize="sm" color="gray.400">{r.id}</Text></Box>
                    <Spacer />
                    <HStack>
                      <IconButton size="sm" aria-label="edit" icon={<EditIcon />} onClick={() => { setSelectedRole(r); setNewRole({ ...r }); openRoleModal(); }} />
                    </HStack>
                  </Flex>
                </Box>
              ))}
            </SimpleGrid>
          </Box>
        </NeonCard>

        {/* Permission Matrix panel */}
        <NeonCard>
          <PanelHeader title="Permissions Matrix" subtitle="Modules × Roles" actions={<HStack><Button size="sm" onClick={exportPermissions}>Download</Button><input id="permImport" type="file" accept="application/json" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) importPermissions(f); }} /><Button size="sm" onClick={() => document.getElementById("permImport")?.click()}>Import</Button></HStack>} />
          <Box overflowX="auto" maxH="420px">
            <Table size="sm" variant="striped">
              <Thead>
                <Tr>
                  <Th>Module</Th>
                  {roles.map(r => <Th key={r.id}>{r.label}</Th>)}
                </Tr>
              </Thead>
              <Tbody>
                {MODULES.map(mod => (
                  <Tr key={mod}>
                    <Td>{mod}</Td>
                    {roles.map(r => (
                      <Td key={`${mod}-${r.id}`}>
                        <HStack wrap="wrap">
                          {PERMISSIONS.map(p => {
                            const has = permissionsMatrix[mod] && permissionsMatrix[mod][r.id] && permissionsMatrix[mod][r.id].has(p);
                            return (
                              <Button key={p} size="xs" variant={has ? "solid" : "outline"} onClick={() => togglePermission(mod, r.id, p)}>{p}</Button>
                            );
                          })}
                        </HStack>
                      </Td>
                    ))}
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </Box>
        </NeonCard>

        {/* Feature toggles */}
        <NeonCard>
          <PanelHeader title="Feature Toggles" subtitle="Global application controls" />
          <VStack align="stretch" spacing={3} mt={2}>
            {Object.entries(featureToggles).map(([k, v]) => (
              <Flex key={k} align="center" justify="space-between" p={2} borderRadius="8px" bg="rgba(255,255,255,0.01)">
                <Box>
                  <Text fontWeight="semibold">{k.replace(/_/g, " ")}</Text>
                  <Text fontSize="sm" color="gray.400">Toggle global {k}</Text>
                </Box>
                <Switch isChecked={v} onChange={(e) => setFeatureToggles(ft => ({ ...ft, [k]: e.target.checked }))} />
              </Flex>
            ))}
            <HStack pt={2}><Button size="sm" onClick={() => { supabase.from("audit_logs").insert([{ action: "Feature toggles saved" }]).catch(()=>{}); toast({ title: "Saved" }); if (featureToggles.confetti_enabled) blastConfetti(); }}>Save</Button></HStack>
          </VStack>
        </NeonCard>

        {/* Integrations panel */}
        <NeonCard>
          <PanelHeader title="Integrations" subtitle="API Keys & Webhooks" actions={<Button size="sm" leftIcon={<AddIcon />} onClick={() => { const name = `key-${Date.now()}`; createApiKey(name); }}>New API Key</Button>} />
          <Box>
            <Text fontSize="sm" color="gray.400">API Keys</Text>
            <VStack align="stretch" mt={2}>
              {apiKeys.length === 0 ? <Text color="gray.400">No API keys</Text> : apiKeys.map(k => (
                <Flex key={k.id} align="center" justify="space-between" p={2} borderRadius="8px" bg="rgba(255,255,255,0.02)">
                  <Box><Text fontWeight="bold">{k.name}</Text><Text fontSize="sm" color="gray.400">{k.created_at}</Text></Box>
                  <Box><Text fontSize="sm" color="gray.400">{k.key_masked}</Text></Box>
                </Flex>
              ))}
            </VStack>

            <Divider my={3} />

            <Text fontSize="sm" color="gray.400">Webhooks</Text>
            <VStack align="stretch" mt={2}>
              {webhooks.length === 0 ? <Text color="gray.400">No webhooks</Text> : webhooks.map(w => (
                <Flex key={w.id} align="center" justify="space-between" p={2} borderRadius="8px" bg="rgba(255,255,255,0.02)">
                  <Box><Text fontWeight="bold">{w.name}</Text><Text fontSize="sm" color="gray.400">{w.url}</Text></Box>
                </Flex>
              ))}
            </VStack>
            <HStack mt={3}><Input placeholder="Webhook name" size="sm" id="hookName" /><Input placeholder="https://..." size="sm" id="hookUrl" /><Button size="sm" onClick={() => { const name = document.getElementById("hookName").value || `hook-${Date.now()}`; const url = document.getElementById("hookUrl").value; if (!url) return toast({ title: "URL required", status: "warning" }); createWebhook({ name, url }); }}>Add</Button></HStack>
          </Box>
        </NeonCard>

        {/* Audit panel */}
        <NeonCard>
          <PanelHeader title="Audit Logs" subtitle="Recent actions" actions={<Button size="sm" onClick={() => { downloadJson("audit.json", auditLogs); }}>Export</Button>} />
          <Box maxH="260px" overflowY="auto">
            <VStack align="start" spacing={3}>
              {auditLogs.length === 0 ? <Text color="gray.400">No logs</Text> : auditLogs.slice(0, 80).map(a => (
                <Box key={a.id} p={2} borderRadius="8px" bg="rgba(0,0,0,0.06)" w="100%">
                  <Text fontSize="sm">{a.action}</Text>
                  <Text fontSize="xs" color="gray.400">{formatDate(a.created_at)}</Text>
                </Box>
              ))}
            </VStack>
          </Box>
        </NeonCard>

        {/* Notifications panel */}
        <NeonCard>
          <PanelHeader title="Notifications" subtitle="Recent notifications" actions={<Button size="sm" onClick={() => { downloadJson("notifs.json", notificationsList); }}>Export</Button>} />
          <Box maxH="260px" overflowY="auto">
            <VStack align="start" spacing={3}>
              {notificationsList.length === 0 ? <Text color="gray.400">No notifications</Text> : notificationsList.slice(0, 80).map(n => (
                <Box key={n.id} p={2} borderRadius="8px" bg="rgba(0,0,0,0.06)" w="100%">
                  <Text fontSize="sm">{n.message}</Text>
                  <Text fontSize="xs" color="gray.400">{n.role} • {formatDate(n.created_at)}</Text>
                </Box>
              ))}
            </VStack>
          </Box>
        </NeonCard>

      </SimpleGrid>

      {/* Floating Orb */}
      <OrbButton onClick={() => openOrb()} />

      {/* Orb Modal - quick create */}
      <Modal isOpen={isOrbOpen} onClose={() => closeOrb()} isCentered size="lg">
        <ModalOverlay />
        <ModalContent style={{ backdropFilter: "blur(8px)" }}>
          <ModalHeader>Quick Create</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack spacing={3} align="stretch">
              <Text fontSize="sm" color="gray.400">Create a role or a quick setting — holographic form</Text>
              <FormControl>
                <FormLabel>Role ID</FormLabel>
                <Input value={newRole.id} onChange={(e) => setNewRole(n => ({ ...n, id: e.target.value }))} />
              </FormControl>
              <FormControl>
                <FormLabel>Role Label</FormLabel>
                <Input value={newRole.label} onChange={(e) => setNewRole(n => ({ ...n, label: e.target.value }))} />
              </FormControl>
              <FormControl>
                <FormLabel>Description</FormLabel>
                <Input value={newRole.description} onChange={(e) => setNewRole(n => ({ ...n, description: e.target.value }))} />
              </FormControl>
              <HStack>
                <Button onClick={() => { if (!newRole.id || !newRole.label) return toast({ title: "Provide id & label", status: "warning" }); setRoles(r => [{ id: newRole.id, label: newRole.label }, ...r]); closeOrb(); if (featureToggles.confetti_enabled) blastConfetti(); toast({ title: "Role created" }); }}>Create Role</Button>
                <Button variant="ghost" onClick={() => closeOrb()}>Cancel</Button>
              </HStack>
            </VStack>
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* User Modal */}
      <Modal isOpen={isUserModalOpen} onClose={() => closeUserModal()} isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Create / Edit User</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack spacing={3} align="stretch">
              <FormControl><FormLabel>Email</FormLabel><Input value={newUser.email} onChange={(e) => setNewUser(n => ({ ...n, email: e.target.value }))} /></FormControl>
              <FormControl><FormLabel>Full name</FormLabel><Input value={newUser.full_name} onChange={(e) => setNewUser(n => ({ ...n, full_name: e.target.value }))} /></FormControl>
              <FormControl><FormLabel>Role</FormLabel><Select value={newUser.role} onChange={(e) => setNewUser(n => ({ ...n, role: e.target.value }))}>{roles.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</Select></FormControl>
              <FormControl><FormLabel>Temporary password</FormLabel><Input type="password" value={newUser.password} onChange={(e) => setNewUser(n => ({ ...n, password: e.target.value }))} /></FormControl>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button onClick={() => closeUserModal()}>Cancel</Button>
            <Button colorScheme="teal" ml={3} onClick={() => { if (!newUser.email) return toast({ title: "Email required", status: "warning" }); createUser(newUser); closeUserModal(); }}>Save</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

    </Box>
  );
}

/* helper: download JSON */
function downloadJson(name, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
