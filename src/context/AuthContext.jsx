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

export const AuthProvider = ({ children }) => {
  const navigate = useNavigate();
  const [user, setUser] = useState(() => {
    const storedUser = localStorage.getItem('user');
    return storedUser ? JSON.parse(storedUser) : null;
  });
  const [loading, setLoading] = useState(true);
  const timeoutRef = useRef(null);
  const justLoggedOutRef = useRef(false);

  const redirectToDashboard = useCallback(
    (role) => {
      switch (role) {
        case 'admin':
          navigate('/admin');
          break;
        case 'customs':
          navigate('/customs');
          break;
        case 'outgate':
          navigate('/outgate');
          break;
        case 'weighbridge':
          navigate('/dashboard');
          break;
        default:
          navigate('/');
      }
    },
    [navigate]
  );

  const logout = useCallback(async () => {
    if (justLoggedOutRef.current) return; // prevent double logout
    justLoggedOutRef.current = true;
    clearTimeout(timeoutRef.current);

    setUser(null);
    localStorage.removeItem('user');

    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error('Supabase signOut error:', err);
    }

    navigate('/login', { replace: true });
    justLoggedOutRef.current = false;
  }, [navigate]);

  const resetInactivityTimer = useCallback(() => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      alert('You have been logged out due to 30 minutes of inactivity.');
      logout();
    }, 30 * 60 * 1000);
  }, [logout]);

  const login = useCallback(
    async (userObj) => {
      try {
        const authUser = {
          id: userObj.id,
          email: userObj.email,
          role: userObj.role,
        };
        setUser(authUser);
        localStorage.setItem('user', JSON.stringify(authUser));
        redirectToDashboard(userObj.role);
        resetInactivityTimer();
      } catch (error) {
        console.error('Login error:', error);
      }
    },
    [redirectToDashboard, resetInactivityTimer]
  );

  const setUserOnly = useCallback(
    (userObj) => {
      const authUser = {
        id: userObj.id,
        email: userObj.email,
        role: userObj.role,
      };
      setUser(authUser);
      localStorage.setItem('user', JSON.stringify(authUser));
      resetInactivityTimer();
    },
    [resetInactivityTimer]
  );

  useEffect(() => {
    const getSession = async () => {
      setLoading(true);
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const currentUser = session?.user;

        if (currentUser?.id) {
          // ✅ Set temporary user right away
          setUser({
            id: currentUser.id,
            email: currentUser.email,
            role: null,
          });

          // Fetch role from users table
          const { data: userData, error } = await supabase
            .from('users')
            .select('role')
            .eq('id', currentUser.id)
            .maybeSingle(); // 👈 safer than .single()

          if (error) {
            console.error('Error fetching role from users table:', error.message);
          }

          if (!userData) {
            // ✅ User not in custom users table → insert them
            const { error: insertError } = await supabase.from('users').insert({
              id: currentUser.id,
              email: currentUser.email,
              role: 'user', // default role
            });

            if (insertError) {
              console.error('Error inserting user into users table:', insertError.message);
            } else {
              setUserOnly({ ...currentUser, role: 'user' });
            }
          } else if (userData?.role) {
            setUserOnly({ ...currentUser, role: userData.role });
          }
        } else {
          // ✅ No session means truly logged out
          setUser(null);
          localStorage.removeItem('user');
        }
      } catch (err) {
        console.error('Session fetch error:', err.message);
      } finally {
        setLoading(false);
      }
    };

    getSession();

    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'SIGNED_OUT') {
          if (!justLoggedOutRef.current) {
            logout();
          } else {
            justLoggedOutRef.current = false;
          }
        }

        if (event === 'SIGNED_IN' && session?.user) {
          getSession(); // Refresh user info
        }
      }
    );

    return () => {
      listener?.subscription.unsubscribe();
    };
  }, [setUserOnly, logout]);

  useEffect(() => {
    if (!user) return;

    const activityEvents = ['mousemove', 'keydown', 'scroll', 'click'];
    const handleActivity = () => resetInactivityTimer();

    activityEvents.forEach((event) =>
      window.addEventListener(event, handleActivity)
    );

    resetInactivityTimer();

    return () => {
      activityEvents.forEach((event) =>
        window.removeEventListener(event, handleActivity)
      );
      clearTimeout(timeoutRef.current);
    };
  }, [user, resetInactivityTimer]);

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
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
