// src/context/PersistedStateContext.jsx
import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from 'react';

const PersistedStateContext = createContext(null);

const STORAGE_KEY = 'APP_STATE_V1';
const WRITE_DEBOUNCE_MS = 300;

export const PersistedStateProvider = ({ children }) => {
  // Load initial state from localStorage
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch (e) {
      // If parse fails, clear bad value and return empty object
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (err) {
        // ignore
      }
      return {};
    }
  });

  // Ref for debounced write
  const writeTimerRef = useRef(null);
  const pendingStateRef = useRef(state);
  pendingStateRef.current = state;

  // Save the current whole state to localStorage (debounced)
  const schedulePersist = useCallback(() => {
    if (writeTimerRef.current) {
      clearTimeout(writeTimerRef.current);
    }
    writeTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(pendingStateRef.current || {}));
      } catch (e) {
        // ignore storage write errors (quota, privacy mode, etc.)
        // Optionally you could fallback to in-memory only
        // console.warn('PersistedState write failed', e);
      } finally {
        writeTimerRef.current = null;
      }
    }, WRITE_DEBOUNCE_MS);
  }, []);

  // Helper: set a single persisted key
  const setPersisted = useCallback((key, value) => {
    setState((prev) => {
      const next = { ...(prev || {}) };
      // support updater function
      const newVal = typeof value === 'function' ? value(next[key]) : value;
      next[key] = newVal;
      return next;
    });
    // schedule persist
    schedulePersist();
  }, [schedulePersist]);

  // Helper: clear a single key (or clear all if no key)
  const clearPersisted = useCallback((key) => {
    if (typeof key === 'undefined') {
      setState({});
      schedulePersist();
      return;
    }
    setState((prev) => {
      const next = { ...(prev || {}) };
      delete next[key];
      return next;
    });
    schedulePersist();
  }, [schedulePersist]);

  // Expose value and helpers
  const ctxValue = {
    state,
    setPersisted,
    clearPersisted,
  };

  // Listen for storage events (in case another tab deliberately updates UI state)
  useEffect(() => {
    const onStorage = (e) => {
      if (!e || e.key !== STORAGE_KEY) return;
      try {
        const newState = e.newValue ? JSON.parse(e.newValue) : {};
        // Only update if different (shallow compare)
        const a = state || {};
        const b = newState || {};
        const aKeys = Object.keys(a);
        const bKeys = Object.keys(b);
        if (aKeys.length !== bKeys.length || aKeys.some((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))) {
          setState(b);
        }
      } catch (err) {
        // ignore parse errors
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [state]);

  // Persist when `state` changes (this will schedule a debounced write)
  useEffect(() => {
    schedulePersist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (writeTimerRef.current) {
        clearTimeout(writeTimerRef.current);
        writeTimerRef.current = null;
      }
    };
  }, []);

  return (
    <PersistedStateContext.Provider value={ctxValue}>
      {children}
    </PersistedStateContext.Provider>
  );
};

/**
 * usePersistedState
 * - key: string key to persist under
 * - defaultValue: returned when no persisted value exists
 *
 * returns [value, setValue]
 */
export const usePersistedState = (key, defaultValue = undefined) => {
  const ctx = useContext(PersistedStateContext);
  if (!ctx) {
    throw new Error('usePersistedState must be used within a PersistedStateProvider');
  }
  const { state, setPersisted } = ctx;

  // current persisted value for key (or default)
  const value = state && Object.prototype.hasOwnProperty.call(state, key) ? state[key] : defaultValue;

  // setter: allows value or updater function
  const setValue = useCallback(
    (valOrUpdater) => {
      setPersisted(key, (prev) => {
        // if caller passed updater, call with previous
        if (typeof valOrUpdater === 'function') {
          try {
            return valOrUpdater(prev);
          } catch (e) {
            return prev;
          }
        }
        return valOrUpdater;
      });
    },
    [key, setPersisted]
  );

  return [value, setValue];
};

export default PersistedStateContext;
