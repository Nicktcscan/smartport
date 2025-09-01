// src/components/NotificationPanel.jsx
import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Box,
  VStack,
  HStack,
  Text,
  Badge,
  Button,
  IconButton,
  Spinner,
  Switch,
  Select,
  useToast,
  Tooltip,
  Divider,
  Stack,
} from '@chakra-ui/react';
import { CloseIcon, BellIcon } from '@chakra-ui/icons';
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';

/* Helper: small relative time string */
function timeSince(iso) {
  if (!iso) return 'just now';
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/* Sound generation (multiple simple tones) */
function playTone({ type = 'beep', volume = 0.05, duration = 160 } = {}) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.value = volume;

    if (type === 'beep') {
      o.type = 'sine';
      o.frequency.value = 880;
    } else if (type === 'alert') {
      o.type = 'square';
      o.frequency.value = 740;
    } else if (type === 'ping') {
      o.type = 'triangle';
      o.frequency.value = 1200;
    } else {
      o.type = 'sine';
      o.frequency.value = 880;
    }

    o.connect(g);
    g.connect(ctx.destination);
    o.start();

    setTimeout(() => {
      try {
        o.stop();
      } catch (e) {}
      try {
        g.disconnect();
        o.disconnect();
        if (ctx.close) ctx.close();
      } catch (e) {}
    }, duration);
  } catch (e) {
    // ignore
  }
}

export default function NotificationPanel() {
  const toast = useToast();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [userId, setUserId] = useState(null);

  const [notifications, setNotifications] = useState([]);
  const channelRef = useRef(null);

  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem('notif_muted') === 'true';
    } catch (e) {
      return false;
    }
  });
  const [sound, setSound] = useState(() => {
    try {
      return localStorage.getItem('notif_sound') || 'beep';
    } catch (e) {
      return 'beep';
    }
  });

  useEffect(() => {
    try { localStorage.setItem('notif_muted', muted ? 'true' : 'false'); } catch(e){}
  }, [muted]);
  useEffect(() => {
    try { localStorage.setItem('notif_sound', sound); } catch(e){}
  }, [sound]);

  const getAuthUser = async () => {
    try {
      if (supabase.auth?.getUser) {
        const { data, error } = await supabase.auth.getUser();
        if (error) return null;
        return data?.user || null;
      } else if (supabase.auth?.user) {
        return supabase.auth.user();
      }
      return null;
    } catch (err) {
      console.error('getAuthUser error', err);
      return null;
    }
  };

  const detectRole = async (u) => {
    if (!u) return null;
    try {
      const { data, error } = await supabase.from('users').select('role').eq('id', u.id).maybeSingle();
      if (!error && data?.role) return String(data.role).toLowerCase();
    } catch (e) {}
    try {
      const { data: eData, error: eErr } = await supabase.from('users').select('role').eq('email', u.email).maybeSingle();
      if (!eErr && eData?.role) return String(eData.role).toLowerCase();
    } catch (e) {}
    const fallback = u?.user_metadata?.role || u?.role || null;
    return fallback ? String(fallback).toLowerCase() : null;
  };

  const fetchPersistedNotifications = useCallback(async (resolvedUserId, resolvedRole) => {
    try {
      const { data: noteRows, error: noteErr } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);

      if (noteErr) {
        return [];
      }

      const notifs = noteRows || [];

      const { data: reads, error: readsErr } = await supabase
        .from('notification_reads')
        .select('*')
        .eq('user_id', resolvedUserId)
        .in('notification_id', notifs.map((n) => n.id).filter(Boolean));

      const readsByNotif = {};
      if (!readsErr && reads) {
        reads.forEach((r) => {
          readsByNotif[r.notification_id] = r;
        });
      }

      const merged = notifs.map((n) => {
        const r = readsByNotif[n.id];
        return {
          id: `db-${n.id}`,
          notifId: n.id,
          ticketId: (n.ticket_id && String(n.ticket_id)) || (n.meta?.ticket_id && String(n.meta.ticket_id)) || null,
          message: n.message,
          level: n.level || 'info',
          meta: n.meta || null,
          created_at: n.created_at,
          is_read: r ? !!r.is_read : false,
          dismissed: r ? !!r.dismissed : false,
          flagged: (n.meta && n.meta.flagged) || false,
        };
      });

      return merged;
    } catch (err) {
      console.error('fetchPersistedNotifications error', err);
      return [];
    }
  }, []);

  const pushLocalNotification = useCallback(async (payload, { persist = true, fromRealtime = false } = {}) => {
    const idKey = payload.notifId ? `db-${payload.notifId}` : `live-${payload.ticketId || Math.random().toString(36).slice(2)}`;

    setNotifications((prev) => {
      const exists = prev.some((p) => p.notifId === payload.notifId || (p.message === payload.message && p.ticketId === payload.ticketId));
      if (exists) {
        return prev.map((p) =>
          (p.notifId === payload.notifId || (p.ticketId === payload.ticketId && p.message === payload.message))
            ? { ...p, is_read: p.is_read || false, dismissed: p.dismissed || false, flagged: p.flagged || false }
            : p
        );
      }
      const next = [
        {
          id: idKey,
          notifId: payload.notifId || null,
          ticketId: payload.ticketId || null,
          message: payload.message,
          level: payload.level || 'info',
          meta: payload.meta || null,
          created_at: payload.created_at || new Date().toISOString(),
          is_read: false,
          dismissed: false,
          flagged: !!payload.flagged,
        },
        ...prev,
      ];
      return next.slice(0, 200);
    });

    if (fromRealtime) {
      toast({
        title: payload.message,
        description: payload.ticketId ? `Ticket: ${payload.ticketId}` : undefined,
        status: payload.level === 'critical' ? 'error' : 'info',
        duration: 6000,
        isClosable: true,
      });

      if (!muted) {
        playTone({ type: sound, volume: 0.06, duration: 220 });
      }
    }

    if (persist) {
      try {
        if (!payload.notifId) {
          const insertPayload = {
            ticket_id: payload.ticketId || null,
            message: payload.message,
            level: payload.level || 'info',
            meta: payload.meta ? payload.meta : null,
          };

          const { data: inserted, error: insertErr } = await supabase
            .from('notifications')
            .insert([insertPayload])
            .select()
            .limit(1)
            .single();

          if (!insertErr && inserted?.id) {
            if (userId) {
              await supabase.from('notification_reads').insert([
                {
                  notification_id: inserted.id,
                  user_id: userId,
                  is_read: false,
                  dismissed: false,
                },
              ]);
            }

            setNotifications((prev) =>
              prev.map((n) => {
                if (n.message === payload.message && n.ticketId === payload.ticketId && !n.notifId) {
                  return { ...n, notifId: inserted.id, id: `db-${inserted.id}` };
                }
                return n;
              })
            );
          }
        } else {
          if (userId) {
            await supabase.from('notification_reads').upsert(
              {
                notification_id: payload.notifId,
                user_id: userId,
                is_read: false,
                dismissed: false,
              },
              { onConflict: ['notification_id', 'user_id'] }
            );
          }
        }
      } catch (err) {
        console.warn('persist notification error', err?.message || err);
      }
    }
  }, [muted, sound, toast, userId]);

  const markAsRead = async (notif) => {
    try {
      setNotifications((prev) => prev.map((n) => (n.id === notif.id ? { ...n, is_read: true } : n)));

      if (!notif.notifId || !userId) return;

      const { error } = await supabase.from('notification_reads').upsert(
        {
          notification_id: notif.notifId,
          user_id: userId,
          is_read: true,
          dismissed: false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: ['notification_id', 'user_id'] }
      );
      if (error) console.warn('markAsRead error', error);
    } catch (err) {
      console.error('markAsRead', err);
    }
  };

  const dismissNotification = async (notif) => {
    try {
      setNotifications((prev) => prev.filter((n) => n.id !== notif.id));

      if (!notif.notifId || !userId) return;

      const { error } = await supabase.from('notification_reads').upsert(
        {
          notification_id: notif.notifId,
          user_id: userId,
          is_read: false,
          dismissed: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: ['notification_id', 'user_id'] }
      );
      if (error) console.warn('dismiss error', error);
    } catch (err) {
      console.error('dismissNotification', err);
    }
  };

  const clearAll = async () => {
    try {
      setNotifications([]);

      if (!userId) return;

      const { data: rows, error } = await supabase.from('notifications').select('id');
      if (!error && rows && rows.length) {
        const upserts = rows.map((r) => ({
          notification_id: r.id,
          user_id: userId,
          is_read: true,
          dismissed: true,
          updated_at: new Date().toISOString(),
        }));
        await supabase.from('notification_reads').upsert(upserts, { onConflict: ['notification_id', 'user_id'] });
      }
    } catch (err) {
      console.error('clearAll', err);
    }
  };

  const setupRealtime = useCallback((resolvedRole) => {
    try {
      if (channelRef.current) {
        if (channelRef.current.unsubscribe) channelRef.current.unsubscribe();
        else {
          if (channelRef.current.insertSub?.unsubscribe) channelRef.current.insertSub.unsubscribe();
          if (channelRef.current.updateSub?.unsubscribe) channelRef.current.updateSub.unsubscribe();
        }
        channelRef.current = null;
      }
    } catch (e) {}

    const handleIncoming = async (newRow) => {
      if (!newRow) return;
      const status = newRow.status;
      const flagged = !!newRow.flagged;
      const ticketId = newRow.ticket_id || newRow.ticket_no || String(newRow.id);
      const truck = newRow.gnsw_truck_no || 'Unknown';

      if (resolvedRole === 'admin') {
        if (status === 'Pending') {
          await pushLocalNotification(
            {
              ticketId,
              message: `New Pending Ticket: ${truck}${newRow.ticket_no ? ` (${newRow.ticket_no})` : ''}`,
              level: flagged ? 'critical' : 'info',
              meta: { ticket_id: ticketId, flagged },
              flagged,
            },
            { persist: true, fromRealtime: true }
          );
        }
        if (status === 'Exited') {
          await pushLocalNotification(
            {
              ticketId,
              message: `Vehicle Exited: ${truck}${newRow.ticket_no ? ` (${newRow.ticket_no})` : ''}`,
              level: flagged ? 'warning' : 'info',
              meta: { ticket_id: ticketId, flagged },
              flagged,
            },
            { persist: true, fromRealtime: true }
          );
        }
        return;
      }

      if (resolvedRole === 'weighbridge') {
        if (status === 'Exited') {
          await pushLocalNotification(
            {
              ticketId,
              message: `Vehicle Exited: ${truck}${newRow.ticket_no ? ` (${newRow.ticket_no})` : ''}`,
              level: flagged ? 'warning' : 'info',
              meta: { ticket_id: ticketId, flagged },
              flagged,
            },
            { persist: true, fromRealtime: true }
          );
        }
        return;
      }

      if (resolvedRole === 'outgate') {
        if (status === 'Pending') {
          await pushLocalNotification(
            {
              ticketId,
              message: `New Pending Ticket: ${truck}${newRow.ticket_no ? ` (${newRow.ticket_no})` : ''}`,
              level: flagged ? 'critical' : 'info',
              meta: { ticket_id: ticketId, flagged },
              flagged,
            },
            { persist: true, fromRealtime: true }
          );
        }
        return;
      }
    };

    if (supabase.channel) {
      try {
        const ch = supabase.channel(`realtime-notifs-${resolvedRole || 'general'}`);

        ch.on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'tickets' },
          (payload) => { handleIncoming(payload?.new).catch(console.error); }
        );

        ch.on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'tickets' },
          (payload) => {
            const n = payload?.new;
            const o = payload?.old;
            if (!n) return;
            if (n.status !== o?.status) handleIncoming(n).catch(console.error);
          }
        );

        ch.subscribe();
        channelRef.current = ch;
        return;
      } catch (err) {
        console.warn('channel setup error; falling back to legacy realtime', err);
      }
    }

    try {
      const insertSub = supabase
        .from('tickets')
        .on('INSERT', (payload) => { handleIncoming(payload.new).catch(console.error); })
        .subscribe();

      const updateSub = supabase
        .from('tickets')
        .on('UPDATE', (payload) => {
          const n = payload.new;
          const o = payload.old;
          if (!n) return;
          if (n.status !== o?.status) handleIncoming(n).catch(console.error);
        })
        .subscribe();

      channelRef.current = { insertSub, updateSub };
    } catch (err) {
      console.warn('legacy realtime failed', err);
    }
  }, [pushLocalNotification]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const u = await getAuthUser();
        if (!mounted) return;
        setUser(u);
        setUserId(u?.id || null);
        const resolvedRole = await detectRole(u);
        setRole(resolvedRole);

        const persisted = await fetchPersistedNotifications(u?.id, resolvedRole);
        if (persisted && persisted.length > 0) {
          setNotifications(persisted.filter((p) => !p.dismissed));
        } else {
          try {
            if (resolvedRole === 'weighbridge') {
              const { data } = await supabase
                .from('tickets')
                .select('id, ticket_id, ticket_no, gnsw_truck_no, status, submitted_at, flagged')
                .eq('status', 'Exited')
                .order('submitted_at', { ascending: false })
                .limit(25);
              const items = (data || []).map((t) => ({
                id: `live-exited-${t.id}`,
                notifId: null,
                ticketId: t.ticket_id || t.ticket_no || String(t.id),
                message: `Vehicle Exited: ${t.gnsw_truck_no || 'Unknown'}${t.ticket_no ? ` (${t.ticket_no})` : ''}`,
                level: t.flagged ? 'warning' : 'info',
                meta: { ticket_id: t.ticket_id || t.ticket_no, flagged: !!t.flagged },
                created_at: t.submitted_at,
                is_read: false,
                dismissed: false,
                flagged: !!t.flagged,
              }));
              setNotifications(items);
            } else if (resolvedRole === 'outgate') {
              const { data } = await supabase
                .from('tickets')
                .select('id, ticket_id, ticket_no, gnsw_truck_no, status, submitted_at, flagged')
                .eq('status', 'Pending')
                .order('submitted_at', { ascending: false })
                .limit(25);
              const items = (data || []).map((t) => ({
                id: `live-pending-${t.id}`,
                notifId: null,
                ticketId: t.ticket_id || t.ticket_no || String(t.id),
                message: `New Pending Ticket: ${t.gnsw_truck_no || 'Unknown'}${t.ticket_no ? ` (${t.ticket_no})` : ''}`,
                level: t.flagged ? 'critical' : 'info',
                meta: { ticket_id: t.ticket_id || t.ticket_no, flagged: !!t.flagged },
                created_at: t.submitted_at,
                is_read: false,
                dismissed: false,
                flagged: !!t.flagged,
              }));
              setNotifications(items);
            } else if (resolvedRole === 'admin') {
              const { data: pending } = await supabase
                .from('tickets')
                .select('id, ticket_id, ticket_no, gnsw_truck_no, status, submitted_at, flagged')
                .eq('status', 'Pending')
                .order('submitted_at', { ascending: false })
                .limit(25);
              const { data: exited } = await supabase
                .from('tickets')
                .select('id, ticket_id, ticket_no, gnsw_truck_no, status, submitted_at, flagged')
                .eq('status', 'Exited')
                .order('submitted_at', { ascending: false })
                .limit(25);
              const items = [
                ...(pending || []).map((t) => ({
                  id: `live-pending-${t.id}`,
                  notifId: null,
                  ticketId: t.ticket_id || t.ticket_no || String(t.id),
                  message: `New Pending Ticket: ${t.gnsw_truck_no || 'Unknown'}${t.ticket_no ? ` (${t.ticket_no})` : ''}`,
                  level: t.flagged ? 'critical' : 'info',
                  meta: { ticket_id: t.ticket_id || t.ticket_no, flagged: !!t.flagged },
                  created_at: t.submitted_at,
                  is_read: false,
                  dismissed: false,
                  flagged: !!t.flagged,
                })),
                ...(exited || []).map((t) => ({
                  id: `live-exited-${t.id}`,
                  notifId: null,
                  ticketId: t.ticket_id || t.ticket_no || String(t.id),
                  message: `Vehicle Exited: ${t.gnsw_truck_no || 'Unknown'}${t.ticket_no ? ` (${t.ticket_no})` : ''}`,
                  level: t.flagged ? 'warning' : 'info',
                  meta: { ticket_id: t.ticket_id || t.ticket_no, flagged: !!t.flagged },
                  created_at: t.submitted_at,
                  is_read: false,
                  dismissed: false,
                  flagged: !!t.flagged,
                })),
              ];
              items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
              setNotifications(items.slice(0, 200));
            }
          } catch (e) {
            console.warn('fallback initial snapshot failed', e);
          }
        }

        setupRealtime(resolvedRole);
      } catch (err) {
        console.error('NotificationPanel init error', err);
        toast({ title: 'Notifications error', description: 'Failed to initialize notifications', status: 'error' });
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
      try {
        if (channelRef.current) {
          if (channelRef.current.unsubscribe) channelRef.current.unsubscribe();
          else {
            if (channelRef.current.insertSub?.unsubscribe) channelRef.current.insertSub.unsubscribe();
            if (channelRef.current.updateSub?.unsubscribe) channelRef.current.updateSub.unsubscribe();
          }
        }
      } catch (e) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchPersistedNotifications, setupRealtime]);

  const newCount = notifications.filter((n) => !n.is_read && !n.dismissed).length;

  // When user clicks a notification: mark read and navigate to ticket detail
  const openNotification = async (notif, e) => {
    // clicking the row
    try {
      // prevent double-handling if inside a button, but caller should ensure they stopped propagation
      await markAsRead(notif);
    } catch (err) {
      console.warn('openNotification markAsRead failed', err);
    }

    if (notif.ticketId) {
      // navigate to ticket detail route - change path if your app uses a different route
      navigate(`/tickets/${encodeURIComponent(notif.ticketId)}`);
    } else {
      // if no ticket id, maybe show toast
      toast({ title: 'No ticket info', description: 'This notification is not linked to a ticket.', status: 'info' });
    }
  };

  // UI
  return (
    <Box
      as="aside"
      bg="white"
      borderTop="1px"
      borderColor="gray.200"
      p={4}
      maxHeight="380px"
      overflowY="auto"
      fontSize="sm"
      boxShadow="sm"
      width="100%"
    >
      <HStack justify="space-between" align="center" mb={3}>
        <HStack spacing={2}>
          <BellIcon />
          <Text fontWeight="bold">Notifications</Text>
          <Badge colorScheme={newCount > 0 ? 'green' : 'gray'}>{newCount} New</Badge>
        </HStack>

        <HStack spacing={2}>
          <Tooltip label={muted ? 'Unmute' : 'Mute'}>
            <HStack spacing={1}>
              <Text fontSize="xs">Sound</Text>
              <Switch size="sm" isChecked={!muted} onChange={() => setMuted((m) => !m)} />
            </HStack>
          </Tooltip>

          <Select
            size="sm"
            value={sound}
            onChange={(e) => setSound(e.target.value)}
            width="110px"
            title="Pick alert sound"
          >
            <option value="beep">Beep</option>
            <option value="ping">Ping</option>
            <option value="alert">Alert</option>
          </Select>

          <Button size="xs" variant="ghost" onClick={() => {
            if (!muted) playTone({ type: sound, volume: 0.06, duration: 220 });
            toast({ title: 'Test notification', description: 'This is a test', status: 'info', duration: 1500 });
          }}>
            Test
          </Button>

          <Button size="xs" variant="ghost" onClick={clearAll}>Clear</Button>
        </HStack>
      </HStack>

      <VStack align="stretch" spacing={2}>
        {loading && (
          <HStack justify="center" py={6}>
            <Spinner size="sm" />
            <Text fontSize="sm">Loading notifications…</Text>
          </HStack>
        )}

        {!loading && notifications.length === 0 && (
          <Text color="gray.600">No notifications</Text>
        )}

        {notifications.map((n) => {
          const bg = n.flagged ? 'red.50' : 'gray.50';
          const border = n.flagged ? 'red.300' : 'gray.100';
          return (
            <Box
              key={n.id}
              p={3}
              borderRadius="md"
              borderWidth="1px"
              borderColor={border}
              bg={bg}
              cursor="pointer"
              onClick={(e) => {
                // row click should navigate/open ticket
                // be careful: inner controls must stopPropagation
                openNotification(n, e);
              }}
            >
              <HStack justify="space-between" align="start">
                <Box>
                  <Text fontSize="sm" fontWeight="semibold">
                    {n.message} {n.flagged && <Badge ml={2} colorScheme="red">Flagged</Badge>}
                  </Text>
                  <Text fontSize="xs" color="gray.500">{timeSince(n.created_at)}</Text>
                </Box>

                <Stack spacing={1} align="end">
                  {!n.is_read && (
                    <Button
                      size="xs"
                      colorScheme="green"
                      onClick={(e) => {
                        e.stopPropagation();
                        markAsRead(n);
                      }}
                    >
                      Mark read
                    </Button>
                  )}
                  <HStack spacing={1}>
                    <IconButton
                      aria-label="Mark as read"
                      icon={<CloseIcon />}
                      size="xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        markAsRead(n);
                      }}
                      title="Mark as read"
                    />
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        dismissNotification(n);
                      }}
                    >
                      Dismiss
                    </Button>
                  </HStack>
                </Stack>
              </HStack>
            </Box>
          );
        })}
      </VStack>

      <Divider my={3} />

      <Box>
        <Text fontSize="xs" color="gray.500">Role: <strong>{role || 'unknown'}</strong></Text>
        <Text fontSize="xs" color="gray.400">Realtime events: tickets → Pending / Exited (role-specific)</Text>
      </Box>
    </Box>
  );
}
