/**
 * TeslaAPI.ts
 * OAuth 2.0 PKCE authentication + Tesla Fleet API integration.
 */

import axios, { AxiosInstance } from 'axios';
import * as Keychain from 'react-native-keychain';
import Config from 'react-native-config';
import { sha256 } from 'js-sha256';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const AUTH_BASE = 'https://auth.tesla.com/oauth2/v3';
const FLEET_BASE = 'https://fleet-api.prd.na.vn.cloud.tesla.com';
const REDIRECT_URI = Config.TESLA_REDIRECT_URI ?? 'teslahud://callback';
const CLIENT_ID = Config.TESLA_CLIENT_ID ?? '';
const SCOPES = 'openid offline_access vehicle_device_data vehicle_location vehicle_cmds vehicle_charging_cmds';
const KEYCHAIN_SERVICE = 'TeslaHUD';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface TeslaVehicle {
  id: number;
  id_s: string;
  display_name: string;
  state: string;
}

export interface TeslaVehicleData {
  // Drive
  speed: number;              // mph
  power: number;              // kW (negative = regen)
  efficiency: number;         // Wh/mi instantaneous
  isRegen: boolean;
  motorPct: number;           // 0–100 % of peak
  shiftState: string | null;  // P / D / R / N
  heading: number;            // degrees 0–359

  // Battery
  batteryLevel: number;       // 0–100 %
  batteryRange: number;       // rated miles
  estBatteryRange: number;    // est miles
  usableBatteryLevel: number; // 0–100 %

  // Charging
  chargingState: string | null; // Charging / Complete / Disconnected / Stopped
  chargeRate: number;           // mph (speed of charge)
  chargerPower: number;         // kW
  minutesToFullCharge: number;
  chargeLimitSoc: number;       // %

  // Climate
  outsideTemp: number | null;      // °F
  cabinTemp: number | null;        // °F
  driverTempSetting: number | null;// °F
  isClimateOn: boolean;
  seatHeaterLeft: number;          // 0–3
  seatHeaterRight: number;         // 0–3
  steeringWheelHeater: boolean;

  // Vehicle
  odometer: number;           // miles
  locked: boolean;
  sentryMode: boolean;
  dashcamState: string | null;
  frunkOpen: boolean;
  trunkOpen: boolean;
  tirePressures: {
    fl: number; fr: number; rl: number; rr: number; // PSI
  };
}

interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const base64urlEncode = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let str = '';
  bytes.forEach(b => { str += String.fromCharCode(b); });
  return btoa(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

const generateVerifier = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let result = '';
  for (let i = 0; i < 64; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
};

const generateChallenge = (verifier: string): string => {
  // js-sha256 returns a hex string; we need raw bytes as ArrayBuffer
  const hash = sha256.array(verifier);
  const buffer = new Uint8Array(hash).buffer;
  return base64urlEncode(buffer);
};

const celsiusToFahrenheit = (c: number): number =>
  Math.round((c * 9) / 5 + 32);

const barToPsi = (bar: number): number => Math.round(bar * 14.504);

const MAX_POWER_KW = 450;

// ---------------------------------------------------------------------------
// TeslaAPI class
// ---------------------------------------------------------------------------
export class TeslaAPI {
  private http: AxiosInstance;
  private tokens: TokenSet | null = null;
  private codeVerifier: string = '';

  constructor() {
    this.http = axios.create({ baseURL: FLEET_BASE, timeout: 10_000 });

    // Attach access token to every request
    this.http.interceptors.request.use(async config => {
      const token = await this.getValidAccessToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });
  }

  // -------------------------------------------------------------------------
  // OAuth PKCE
  // -------------------------------------------------------------------------

  /** Build the Tesla authorization URL. Call this before opening the browser. */
  getAuthUrl(): string {
    this.codeVerifier = generateVerifier();
    const challenge = generateChallenge(this.codeVerifier);
    const state = Math.random().toString(36).slice(2);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });

    return `${AUTH_BASE}/authorize?${params.toString()}`;
  }

  /** Exchange the auth code for tokens (call from deep-link handler). */
  async exchangeCode(code: string): Promise<void> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      code_verifier: this.codeVerifier,
      redirect_uri: REDIRECT_URI,
    });
    const resp = await axios.post(`${AUTH_BASE}/token`, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    await this.saveTokens({
      accessToken: resp.data.access_token,
      refreshToken: resp.data.refresh_token,
      expiresAt: Date.now() + resp.data.expires_in * 1000,
    });
  }

  /** Try to load stored tokens from Keychain. Returns true if found. */
  async loadStoredTokens(): Promise<boolean> {
    try {
      const creds = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
      if (!creds) return false;
      this.tokens = JSON.parse(creds.password) as TokenSet;
      return true;
    } catch {
      return false;
    }
  }

  private async saveTokens(tokens: TokenSet): Promise<void> {
    this.tokens = tokens;
    await Keychain.setGenericPassword('tokens', JSON.stringify(tokens), {
      service: KEYCHAIN_SERVICE,
    });
  }

  private async refreshTokens(): Promise<void> {
    if (!this.tokens?.refreshToken) throw new Error('No refresh token');
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: this.tokens.refreshToken,
    });
    const resp = await axios.post(`${AUTH_BASE}/token`, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    await this.saveTokens({
      accessToken: resp.data.access_token,
      refreshToken: resp.data.refresh_token ?? this.tokens.refreshToken,
      expiresAt: Date.now() + resp.data.expires_in * 1000,
    });
  }

  private async getValidAccessToken(): Promise<string | null> {
    if (!this.tokens) return null;
    // Refresh 60 s before expiry
    if (Date.now() > this.tokens.expiresAt - 60_000) {
      await this.refreshTokens();
    }
    return this.tokens!.accessToken;
  }

  async clearTokens(): Promise<void> {
    this.tokens = null;
    await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE });
  }

  // -------------------------------------------------------------------------
  // Vehicle API
  // -------------------------------------------------------------------------

  async getVehicles(): Promise<TeslaVehicle[]> {
    const resp = await this.http.get('/api/1/vehicles');
    return resp.data.response as TeslaVehicle[];
  }

  /** Wake a sleeping vehicle. Retries up to 10 × 3 s. */
  async wakeVehicle(vehicleId: string): Promise<void> {
    for (let i = 0; i < 10; i++) {
      try {
        const resp = await this.http.post(`/api/1/vehicles/${vehicleId}/wake_up`);
        if (resp.data.response?.state === 'online') return;
      } catch {
        // vehicle may be asleep — keep retrying
      }
      await new Promise(r => setTimeout(r, 3_000));
    }
    // Proceed anyway; vehicle may respond to data requests even if wake timed out
  }

  /**
   * Fetch live vehicle telemetry and normalize into TeslaVehicleData.
   */
  async getVehicleData(vehicleId: string): Promise<TeslaVehicleData> {
    const endpoints = [
      'drive_state',
      'charge_state',
      'climate_state',
      'vehicle_state',
    ].join(';');

    const resp = await this.http.get(
      `/api/1/vehicles/${vehicleId}/vehicle_data?endpoints=${endpoints}`,
    );
    const r = resp.data.response;

    const speedMph: number = r.drive_state?.speed ?? 0;
    const powerKw: number = r.drive_state?.power ?? 0;

    // Instantaneous efficiency: kW → W, divide by speed in miles/h → Wh/mi
    // Avoid division by zero at standstill
    const efficiency =
      speedMph > 2 ? Math.round((Math.abs(powerKw) * 1000) / speedMph) : 0;

    const tempF = (c: number | null | undefined): number | null =>
      c != null ? celsiusToFahrenheit(c) : null;

    return {
      // Drive
      speed: speedMph,
      power: powerKw,
      efficiency,
      isRegen: powerKw < 0,
      motorPct: Math.min(100, Math.round((Math.abs(powerKw) / MAX_POWER_KW) * 100)),
      shiftState: r.drive_state?.shift_state ?? null,
      heading: r.drive_state?.heading ?? 0,

      // Battery
      batteryLevel: r.charge_state?.battery_level ?? 0,
      batteryRange: r.charge_state?.battery_range ?? 0,
      estBatteryRange: r.charge_state?.est_battery_range ?? 0,
      usableBatteryLevel: r.charge_state?.usable_battery_level ?? 0,

      // Charging
      chargingState: r.charge_state?.charging_state ?? null,
      chargeRate: r.charge_state?.charge_rate ?? 0,
      chargerPower: r.charge_state?.charger_power ?? 0,
      minutesToFullCharge: r.charge_state?.minutes_to_full_charge ?? 0,
      chargeLimitSoc: r.charge_state?.charge_limit_soc ?? 0,

      // Climate
      outsideTemp: tempF(r.climate_state?.outside_temp),
      cabinTemp: tempF(r.climate_state?.inside_temp),
      driverTempSetting: tempF(r.climate_state?.driver_temp_setting),
      isClimateOn: r.climate_state?.is_climate_on ?? false,
      seatHeaterLeft: r.climate_state?.seat_heater_left ?? 0,
      seatHeaterRight: r.climate_state?.seat_heater_right ?? 0,
      steeringWheelHeater: r.climate_state?.steering_wheel_heater ?? false,

      // Vehicle
      odometer: Math.round(r.vehicle_state?.odometer ?? 0),
      locked: r.vehicle_state?.locked ?? false,
      sentryMode: r.vehicle_state?.sentry_mode ?? false,
      dashcamState: r.vehicle_state?.dashcam_state ?? null,
      frunkOpen: (r.vehicle_state?.ft ?? 0) > 0,
      trunkOpen: (r.vehicle_state?.rt ?? 0) > 0,
      tirePressures: {
        fl: barToPsi(r.vehicle_state?.tpms_pressure_fl ?? 0),
        fr: barToPsi(r.vehicle_state?.tpms_pressure_fr ?? 0),
        rl: barToPsi(r.vehicle_state?.tpms_pressure_rl ?? 0),
        rr: barToPsi(r.vehicle_state?.tpms_pressure_rr ?? 0),
      },
    };
  }
}
