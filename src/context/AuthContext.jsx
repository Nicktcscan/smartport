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
 * Responsibilities:
 * - determine current session / user & role (from Supabase session + users table)
 * - provide login/logout helpers
 * - maintain inactivity timeout (auto logout)
 * - expose `loading` so the app can avoid rendering routes until auth is resolved
 */
export const AuthProvider = ({ children }) => {
  const navigate = useNavigate();

  // Start with `null` to avoid trusting stale localStorage and causing route flicker.
  const [user, setUser] = useState(null);

  // loading indicates we're resolving the session / user information
  const [loading, setLoading] = useState(true);

  // inactivity timer + guard for intentional logout
  const timeoutRef = useRef(null);
  const justLoggedOutRef = useRef(false);

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
    localStorage.removeItem('user');

    try {
      // sign out at Supabase (this will also emit a SIGNED_OUT event)
      await supabase.auth.signOut();
    } catch (err) {
      console.error('Supabase signOut error:', err);
    }

    // navigate to login (replace so Back doesn't return to restricted page)
    navigate('/login', { replace: true });

    // allow future sign-outs to proceed
    justLoggedOutRef.current = false;
  }, [navigate]);

  // Resets the inactivity timer (30 minutes by default)
  const resetInactivityTimer = useCallback(() => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      // friendly alert then logout
      try {
        // keep UX simple for now
        // You can replace alert with a nicer Chakra modal if desired.
        alert('You have been logged out due to 30 minutes of inactivity.');
      } catch (e) {
        // ignore UI alert failures
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
        email: userObj.email,
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
        email: userObj.email,
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

  // On mount: resolve session -> user -> role. Also attach auth state change listener.
  useEffect(() => {
    let isMounted = true;

    const getSessionAndUser = async () => {
      setLoading(true);
      try {
        const { data } = await supabase.auth.getSession();
        const session = data?.session ?? null;
        const currentUser = session?.user ?? null;

        if (!isMounted) return;

        if (currentUser && currentUser.id) {
          // set a temporary minimal user while we fetch the role
          setUser({
            id: currentUser.id,
            email: currentUser.email ?? null,
            role: null,
          });

          // fetch role from users table (safer .maybeSingle())
          const { data: userData, error } = await supabase
            .from('users')
            .select('role')
            .eq('id', currentUser.id)
            .maybeSingle();

          if (error) {
            console.error('Error fetching role from users table:', error);
          }

          // if user not present, create a fallback profile row with default role
          if (!userData) {
            try {
              const { error: insertError } = await supabase.from('users').insert({
                id: currentUser.id,
                email: currentUser.email,
                role: 'agent',
              });
              if (insertError) {
                console.error('Error inserting default user row:', insertError);
                // still set local user with role 'agent' — best-effort
                setUserOnly({ id: currentUser.id, email: currentUser.email, role: 'agent' });
              } else {
                setUserOnly({ id: currentUser.id, email: currentUser.email, role: 'agent' });
              }
            } catch (e) {
              console.error('Insert fallback user failed:', e);
              // fallback to setting user with no role
              setUserOnly({ id: currentUser.id, email: currentUser.email, role: 'agent' });
            }
          } else if (userData?.role) {
            // success - set full user object
            setUserOnly({ id: currentUser.id, email: currentUser.email, role: userData.role });
          } else {
            // no role present -> set default
            setUserOnly({ id: currentUser.id, email: currentUser.email, role: 'agent' });
          }
        } else {
          // no session -> ensure logged out locally
          setUser(null);
          try {
            localStorage.removeItem('user');
          } catch (e) {}
        }
      } catch (err) {
        console.error('Session fetch error:', err);
        // in error cases, ensure user is null
        setUser(null);
        try {
          localStorage.removeItem('user');
        } catch (e) {}
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    // run initial resolution
    getSessionAndUser();

    // Subscribe to auth state changes
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      // NOTE: Do NOT call logout() here - that would call signOut again and risk loops.
      // Instead, perform lightweight local cleanup when the event originates outside the app.
      if (event === 'SIGNED_OUT') {
        // If this sign-out followed an intentional logout initiated by this app,
        // just clear the `justLoggedOut` flag and do nothing else (we already cleaned up).
        if (justLoggedOutRef.current) {
          justLoggedOutRef.current = false;
          return;
        }

        // External sign-out (e.g. session expired or signed out in another tab) — clean local state
        setUser(null);
        try {
          localStorage.removeItem('user');
        } catch (e) {}
        // navigate to login safely
        try {
          navigate('/login', { replace: true });
        } catch (e) {
          // ignore navigate errors during teardown
        }
        // clear inactivity timer
        clearTimeout(timeoutRef.current);
        return;
      }

      if (event === 'SIGNED_IN' && session?.user) {
        // when signed in, re-run session resolution to pick up possible role/profile updates
        getSessionAndUser();
      }

      // other events (TOKEN_REFRESH etc.) are ignored here (we can add handling if needed)
    });

    return () => {
      isMounted = false;
      // unsubscribe listener
      try {
        if (listener && listener.subscription && typeof listener.subscription.unsubscribe === 'function') {
          listener.subscription.unsubscribe();
        } else if (listener && typeof listener.unsubscribe === 'function') {
          // older SDK shapes
          listener.unsubscribe();
        }
      } catch (e) {
        // ignore unsubscribe errors
      }
      clearTimeout(timeoutRef.current);
    };
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
