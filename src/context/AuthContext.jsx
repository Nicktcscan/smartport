// src/context/AuthContext.jsx
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';

const AuthContext = createContext();

/**
 * AuthProvider
 *
 * - Resolves Supabase session -> local user object (id, email, role)
 * - Persists minimal user to localStorage
 * - Starts inactivity timer (auto-logout)
 * - Listens to auth state changes from Supabase while avoiding noisy re-resolves
 *
 * Key fix:
 * - Uses lastResolvedUserRef to avoid relying on `user` from a stale closure inside
 *   an async effect/listener. This prevents UI resets when the SDK refreshes tokens
 *   or when switching tabs.
 */
export const AuthProvider = ({ children }) => {
  const navigate = useNavigate();

  // application user object (null when unauthenticated)
  const [user, setUser] = useState(null);

  // loading indicates we're resolving the session / user information
  const [loading, setLoading] = useState(true);

  // inactivity timer + guard for intentional logout
  const timeoutRef = useRef(null);
  const justLoggedOutRef = useRef(false);

  // track last resolved user/role to avoid redundant fetches and avoid stale closures
  const lastResolvedUserRef = useRef({ id: null, role: null });

  // Helper: navigate to role's landing page (use replace to avoid polluting history)
  const redirectToDashboard = useCallback(
    (role) => {
      switch (role) {
        case 'admin':
          navigate('/admin', { replace: true });
          break;
        case 'customs':
          navigate('/customs', { replace: true });
          break;
        case 'agent':
          navigate('/agent', { replace: true });
          break;
        case 'outgate':
          navigate('/outgate', { replace: true });
          break;
        case 'weighbridge':
          navigate('/dashboard', { replace: true });
          break;
        default:
          navigate('/', { replace: true });
      }
    },
    [navigate]
  );

  // Logout helper: sets local cleanup, signs out at Supabase, and navigates to login.
  const logout = useCallback(async () => {
    if (justLoggedOutRef.current) return; // protect against repeated calls
    justLoggedOutRef.current = true;

    // clear local timers / state
    clearTimeout(timeoutRef.current);
    setUser(null);
    try {
      localStorage.removeItem('user');
    } catch (e) {
      // ignore localStorage errors
    }

    try {
      // sign out at Supabase (this will also emit a SIGNED_OUT event)
      if (supabase?.auth && typeof supabase.auth.signOut === 'function') {
        await supabase.auth.signOut();
      }
    } catch (err) {
      console.error('Supabase signOut error:', err);
    }

    // navigate to login (replace so Back doesn't return to restricted page)
    try {
      navigate('/login', { replace: true });
    } catch (e) {
      // ignore navigation errors
    }

    // allow future sign-outs to proceed
    justLoggedOutRef.current = false;
  }, [navigate]);

  // Resets the inactivity timer (30 minutes by default)
  const resetInactivityTimer = useCallback(() => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      try {
        // simple alert for now — swap with nicer UI if desired
        alert('You have been logged out due to 30 minutes of inactivity.');
      } catch (e) {
        // ignore UI errors
      }
      logout();
    }, 30 * 60 * 1000);
  }, [logout]);

  // Small helper to persist user locally and start inactivity timer
  const setUserOnly = useCallback(
    (userObj) => {
      if (!userObj) return;
      const authUser = {
        id: userObj.id,
        email: userObj.email ?? null,
        role: userObj.role ?? null,
      };
      setUser(authUser);
      try {
        localStorage.setItem('user', JSON.stringify(authUser));
      } catch (e) {
        // ignore localStorage errors in some environments
      }
      resetInactivityTimer();
    },
    [resetInactivityTimer]
  );

  // login helper used by your UI when sign-in finishes (e.g., after form)
  const login = useCallback(
    async (userObj) => {
      if (!userObj) return;
      const authUser = {
        id: userObj.id,
        email: userObj.email ?? null,
        role: userObj.role ?? null,
      };
      setUser(authUser);
      try {
        localStorage.setItem('user', JSON.stringify(authUser));
      } catch (e) {
        // ignore
      }
      // navigate to role-specific dashboard
      if (userObj.role) redirectToDashboard(userObj.role);
      resetInactivityTimer();
    },
    [redirectToDashboard, resetInactivityTimer]
  );

  // Effect: resolve session -> user -> role, and attach auth state change listener.
  useEffect(() => {
    let isMounted = true;

    const getSessionAndUser = async () => {
      // mark loading while we check session at least once
      setLoading(true);
      try {
        const resp = await supabase.auth.getSession();
        const session = resp?.data?.session ?? null;
        const currentUser = session?.user ?? null;

        if (!isMounted) return;

        // No session -> clear local user and lastResolved
        if (!currentUser) {
          setUser(null);
          lastResolvedUserRef.current = { id: null, role: null };
          try {
            localStorage.removeItem('user');
          } catch (e) {}
          return;
        }

        // If we've already resolved this user id and role, skip heavy fetch.
        if (
          lastResolvedUserRef.current.id === currentUser.id &&
          lastResolvedUserRef.current.role
        ) {
          // already resolved previously; ensure timers are active (but don't clobber user if present)
          // if local `user` is null for some reason, set it from lastResolvedRef
          if (!user) {
            setUser({
              id: currentUser.id,
              email: currentUser.email ?? null,
              role: lastResolvedUserRef.current.role,
            });
            try {
              localStorage.setItem(
                'user',
                JSON.stringify({
                  id: currentUser.id,
                  email: currentUser.email ?? null,
                  role: lastResolvedUserRef.current.role,
                })
              );
            } catch (e) {}
          }
          return;
        }

        // Otherwise, set minimal user immediately (role null while we fetch)
        setUser({
          id: currentUser.id,
          email: currentUser.email ?? null,
          role: null,
        });

        // Fetch role from users table
        try {
          const { data: userData, error } = await supabase
            .from('users')
            .select('role')
            .eq('id', currentUser.id)
            .maybeSingle();

          if (error) {
            console.error('Error fetching role from users table:', error);
          }

          if (!userData) {
            // create fallback row & set role to 'agent'
            try {
              const { error: insertError } = await supabase.from('users').insert({
                id: currentUser.id,
                email: currentUser.email,
                role: 'agent',
              });
              if (insertError) {
                console.error('Error inserting default user row:', insertError);
                setUserOnly({ id: currentUser.id, email: currentUser.email, role: 'agent' });
                lastResolvedUserRef.current = { id: currentUser.id, role: 'agent' };
              } else {
                setUserOnly({ id: currentUser.id, email: currentUser.email, role: 'agent' });
                lastResolvedUserRef.current = { id: currentUser.id, role: 'agent' };
              }
            } catch (e) {
              console.error('Insert fallback user failed:', e);
              setUserOnly({ id: currentUser.id, email: currentUser.email, role: 'agent' });
              lastResolvedUserRef.current = { id: currentUser.id, role: 'agent' };
            }
          } else if (userData?.role) {
            // set full user with role
            setUserOnly({ id: currentUser.id, email: currentUser.email, role: userData.role });
            lastResolvedUserRef.current = { id: currentUser.id, role: userData.role };
          } else {
            // no role -> default to 'agent'
            setUserOnly({ id: currentUser.id, email: currentUser.email, role: 'agent' });
            lastResolvedUserRef.current = { id: currentUser.id, role: 'agent' };
          }
        } catch (err) {
          console.error('Error resolving users row:', err);
          setUserOnly({ id: currentUser.id, email: currentUser.email, role: 'agent' });
          lastResolvedUserRef.current = { id: currentUser.id, role: 'agent' };
        }
      } catch (err) {
        console.error('Session fetch error:', err);
        setUser(null);
        lastResolvedUserRef.current = { id: null, role: null };
        try {
          localStorage.removeItem('user');
        } catch (e) {}
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    // Run the resolution once on mount
    getSessionAndUser();

    // Attach auth state listener
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      // Signed out: if initiated locally, skip extra handling; otherwise clean local state.
      if (event === 'SIGNED_OUT') {
        if (justLoggedOutRef.current) {
          justLoggedOutRef.current = false;
          return;
        }

        // External sign-out
        setUser(null);
        lastResolvedUserRef.current = { id: null, role: null };
        try {
          localStorage.removeItem('user');
        } catch (e) {}
        try {
          navigate('/login', { replace: true });
        } catch (e) {
          // ignore
        }
        clearTimeout(timeoutRef.current);
        return;
      }

      // Signed in: re-resolve only when necessary (getSessionAndUser checks lastResolvedUserRef)
      if (event === 'SIGNED_IN') {
        // call the same resolution helper to update role/state if needed
        getSessionAndUser();
      }

      // Ignore other events (TOKEN_REFRESH, USER_UPDATED, etc.) to avoid noisy re-resolves
    });

    return () => {
      isMounted = false;
      // unsubscribe listener (support different supabase SDK shapes)
      try {
        if (listener && listener.subscription && typeof listener.subscription.unsubscribe === 'function') {
          listener.subscription.unsubscribe();
        } else if (listener && typeof listener.unsubscribe === 'function') {
          listener.unsubscribe();
        }
      } catch (e) {
        // ignore unsubscribe errors
      }
      clearTimeout(timeoutRef.current);
    };
    // intentionally minimal dependency array; setUserOnly, logout and navigate are stable callbacks
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setUserOnly, logout, navigate]);

  // Activity listeners to reset inactivity timer
  useEffect(() => {
    if (!user) {
      // if not logged in, ensure timer cleared
      clearTimeout(timeoutRef.current);
      return;
    }

    const activityEvents = ['mousemove', 'keydown', 'scroll', 'click'];
    const handler = () => resetInactivityTimer();

    activityEvents.forEach((ev) => window.addEventListener(ev, handler));
    // start timer
    resetInactivityTimer();

    return () => {
      activityEvents.forEach((ev) => window.removeEventListener(ev, handler));
      clearTimeout(timeoutRef.current);
    };
  }, [user, resetInactivityTimer]);

  // Expose auth helpers and state
  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {/* Keep children hidden until we've resolved auth to avoid route flicker */}
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
