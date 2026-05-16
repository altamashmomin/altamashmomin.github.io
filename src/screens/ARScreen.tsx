/**
 * ARScreen.tsx
 * Camera passthrough + Tesla auth state machine + adaptive polling loop.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  Linking,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
} from 'react-native-vision-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import HUDOverlay from '../components/HUDOverlay';
import { TeslaAPI, TeslaVehicleData } from '../services/TeslaAPI';
import { sf, s } from '../utils/responsive';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type AuthState =
  | 'unauthenticated'
  | 'authenticating'
  | 'connecting'
  | 'active'
  | 'error';

const POLL_DRIVING_MS = 5000;   // driving — responsive but not excessive
const POLL_PARKED_MS  = 30000;  // parked/idle — minimal API usage
const POLL_ASLEEP_MS  = 60000;  // car asleep (408s) — very conservative
const SLEEP_THRESHOLD = 3;      // consecutive 408s before backing off

const COLORS = {
  bg: 'rgba(5, 8, 15, 0.82)',
  cyan: '#00d4ff',
  red: '#ff3b30',
  muted: '#2e4a64',
  white: '#ffffff',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function ARScreen() {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const insets = useSafeAreaInsets();

  const [authState, setAuthState] = useState<AuthState>('unauthenticated');
  const [vehicleData, setVehicleData] = useState<TeslaVehicleData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [vehicleId, setVehicleId] = useState<string | null>(null);

  const api = useRef(new TeslaAPI());
  const pollTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sleepStreak = useRef(0);   // consecutive 408 count
  const polling     = useRef(false); // guard against double-starts
  const lastShift   = useRef<string | null>(null); // track drive state for cadence
  const activeVid   = useRef<string | null>(null); // vehicle id for resume

  // -------------------------------------------------------------------------
  // Camera permission
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  // -------------------------------------------------------------------------
  // Polling — recursive setTimeout so we can adjust cadence each tick
  // -------------------------------------------------------------------------
  const stopPolling = useCallback(() => {
    polling.current = false;
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = null;
  }, []);

  const startPolling = useCallback((vid: string) => {
    stopPolling();
    polling.current = true;
    activeVid.current = vid;
    sleepStreak.current = 0;

    const tick = async () => {
      if (!polling.current) return;

      let nextDelay = POLL_DRIVING_MS;

      try {
        const data = await api.current.getVehicleData(vid);
        sleepStreak.current = 0;
        lastShift.current = data.shiftState;
        setVehicleData(data);

        // Adaptive cadence based on driving state
        const isDriving = data.shiftState === 'D' || data.shiftState === 'R';
        nextDelay = isDriving ? POLL_DRIVING_MS : POLL_PARKED_MS;
      } catch (e: any) {
        const status = e?.response?.status ?? 0;
        if (status === 408) {
          sleepStreak.current += 1;
          if (sleepStreak.current >= SLEEP_THRESHOLD) {
            nextDelay = POLL_ASLEEP_MS;
          } else {
            nextDelay = POLL_PARKED_MS;
          }
        } else {
          console.log('[TeslaHUD] poll error — status:', status, e?.message);
          nextDelay = POLL_PARKED_MS;
        }
      }

      if (polling.current) {
        pollTimer.current = setTimeout(tick, nextDelay);
      }
    };

    pollTimer.current = setTimeout(tick, 0);
  }, [stopPolling]);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  // -------------------------------------------------------------------------
  // AppState — pause polling when backgrounded, resume when foregrounded
  // -------------------------------------------------------------------------
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && activeVid.current && !polling.current) {
        startPolling(activeVid.current);
      } else if (state !== 'active' && polling.current) {
        stopPolling();
      }
    });
    return () => sub.remove();
  }, [startPolling, stopPolling]);

  // -------------------------------------------------------------------------
  // Vehicle init (called after successful auth or token restore)
  // -------------------------------------------------------------------------
  const initVehicle = useCallback(async () => {
    setAuthState('connecting');
    try {
      console.log('[TeslaHUD] initVehicle: calling getVehicles...');
      const vehicles = await api.current.getVehicles();
      console.log('[TeslaHUD] initVehicle: getVehicles success, count:', vehicles.length);
      if (vehicles.length === 0) {
        setErrorMsg('No vehicles found on this account.');
        setAuthState('error');
        return;
      }
      const vid = vehicles[0].id_s;
      console.log('[TeslaHUD] initVehicle: vehicle id:', vid, 'state:', vehicles[0].state);
      setVehicleId(vid);
      setAuthState('active');
      startPolling(vid);
    } catch (e: any) {
      const body = e?.response?.data ? JSON.stringify(e.response.data) : '(no body)';
      const status = e?.response?.status ?? 'N/A';
      console.log(`[TeslaHUD] initVehicle error — status: ${status}, body: ${body}, msg: ${e?.message}`);
      setErrorMsg(`${e?.message ?? 'Could not connect to vehicle.'} (${status})`);
      setAuthState('error');
    }
  }, [startPolling]);

  // -------------------------------------------------------------------------
  // Restore stored tokens on mount
  // -------------------------------------------------------------------------
  useEffect(() => {
    (async () => {
      const found = await api.current.loadStoredTokens();
      if (found) {
        await initVehicle();
      }
    })();
  }, [initVehicle]);

  // -------------------------------------------------------------------------
  // Deep-link handler (OAuth callback)
  // -------------------------------------------------------------------------
  useEffect(() => {
    let handled = false; // prevent double-processing in React dev/StrictMode

    const handleUrl = async ({ url }: { url: string }) => {
      console.log('[TeslaHUD] Incoming URL:', url);
      if (!url.startsWith('teslahud://')) return;
      if (handled) return;
      handled = true;
      try {
        const qs = url.split('?')[1] ?? '';
        const params = new URLSearchParams(qs);
        const code = params.get('code');
        console.log('[TeslaHUD] OAuth code:', code);
        if (!code) throw new Error('No code in callback URL.');
        console.log('[TeslaHUD] Calling exchangeCode...');
        await api.current.exchangeCode(code);
        console.log('[TeslaHUD] exchangeCode success, calling initVehicle...');
        await initVehicle();
        console.log('[TeslaHUD] initVehicle done');
      } catch (e: any) {
        console.log('[TeslaHUD] OAuth error:', e?.message);
        setErrorMsg(e?.message ?? 'OAuth exchange failed.');
        setAuthState('error');
        handled = false; // allow retry
      }
    };

    // Foreground URL events (app was already running)
    const sub = Linking.addListener('url', handleUrl);

    // Cold-launch URL (app was opened directly from the callback)
    Linking.getInitialURL().then(url => {
      console.log('[TeslaHUD] Initial URL:', url);
      if (url) handleUrl({ url });
    });

    return () => sub.remove();
  }, [initVehicle]);

  // -------------------------------------------------------------------------
  // Login action
  // -------------------------------------------------------------------------
  const handleLogin = async () => {
    setAuthState('authenticating');
    const url = api.current.getAuthUrl();
    await Linking.openURL(url);
  };

  // -------------------------------------------------------------------------
  // Render guards
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // Main render
  // -------------------------------------------------------------------------
  const cameraAvailable = hasPermission && !!device;

  return (
    <View style={styles.root}>
      <StatusBar hidden />

      {/* AR camera passthrough — real device only */}
      {cameraAvailable && (
        <Camera
          style={StyleSheet.absoluteFill}
          device={device!}
          isActive={true}
          photo={false}
          video={false}
          audio={false}
        />
      )}

      {/* HUD (only when active) */}
      {authState === 'active' && <HUDOverlay data={vehicleData} />}

      {/* Auth overlay (all non-active states) */}
      {authState !== 'active' && (
        <View
          style={[
            styles.authOverlay,
            { paddingTop: insets.top + s(20), paddingBottom: insets.bottom + s(20) },
          ]}
        >
          <Text style={styles.appTitle}>TESLA HUD</Text>

          {authState === 'unauthenticated' && (
            <>
              <Text style={styles.subtitle}>
                Mount your phone, then connect your Tesla.
              </Text>
              <TouchableOpacity style={styles.connectBtn} onPress={handleLogin}>
                <Text style={styles.connectBtnText}>CONNECT TESLA</Text>
              </TouchableOpacity>
            </>
          )}

          {authState === 'authenticating' && (
            <Text style={styles.statusText}>Opening Tesla login…</Text>
          )}

          {authState === 'connecting' && (
            <Text style={styles.statusText}>Connecting…</Text>
          )}

          {authState === 'error' && (
            <>
              <Text style={[styles.statusText, { color: COLORS.red }]}>
                {errorMsg}
              </Text>
              <TouchableOpacity
                style={[styles.connectBtn, { borderColor: COLORS.red }]}
                onPress={() => setAuthState('unauthenticated')}
              >
                <Text style={[styles.connectBtnText, { color: COLORS.red }]}>
                  RETRY
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#05080f',
    padding: s(24),
  },
  authOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.bg,
    gap: s(16),
  },
  appTitle: {
    fontFamily: 'Orbitron-Black',
    fontSize: sf(32),
    color: COLORS.cyan,
    letterSpacing: 6,
  },
  subtitle: {
    fontFamily: 'ShareTechMono-Regular',
    fontSize: sf(13),
    color: COLORS.muted,
    textAlign: 'center',
  },
  statusText: {
    fontFamily: 'ShareTechMono-Regular',
    fontSize: sf(14),
    color: COLORS.muted,
    letterSpacing: 1,
  },
  infoText: {
    fontFamily: 'ShareTechMono-Regular',
    fontSize: sf(14),
    textAlign: 'center',
    lineHeight: sf(22),
  },
  connectBtn: {
    borderWidth: 1,
    borderColor: COLORS.cyan,
    paddingHorizontal: s(32),
    paddingVertical: s(12),
    marginTop: s(8),
  },
  connectBtnText: {
    fontFamily: 'Orbitron-Bold',
    fontSize: sf(13),
    color: COLORS.cyan,
    letterSpacing: 4,
  },
});
