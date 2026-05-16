/**
 * HUDOverlay.tsx
 * Three switchable HUD modes rendered over the AR camera feed.
 *
 * Modes:
 *   minimal — speed, battery %, range
 *   drive   — speed, power, efficiency, motor %, temps, regen, battery bar
 *   tech    — everything + power gauge, 30-sample efficiency chart, tire PSI, odometer
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { TeslaVehicleData } from '../services/TeslaAPI';
import { s, sf, sh, sw, W, H } from '../utils/responsive';

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------
const C = {
  bg:       'rgba(5, 8, 15, 0.60)',
  panel:    'rgba(5, 8, 15, 0.72)',
  border:   'rgba(0, 212, 255, 0.18)',
  cyan:     '#4ee0ff',
  amber:    '#ffb340',
  green:    '#50ffa0',
  red:      '#ff5a50',
  muted:    '#6a8fad',
  white:    '#ffffff',
  dimWhite: 'rgba(255,255,255,0.92)',
};

const FONTS = {
  display: 'ShareTechMono-Regular',
  displayBlack: 'Orbitron-Black',
  mono: 'ShareTechMono-Regular',
};

type HUDMode = 'minimal' | 'drive' | 'tech';
const MODES: HUDMode[] = ['minimal', 'drive', 'tech'];
const CHART_SAMPLES = 30;
const MAX_CHART_WH = 500; // Wh/mi ceiling for bar chart normalisation
const MAX_POWER_KW = 450;

// ---------------------------------------------------------------------------
// Help content — shown when user taps a ? badge in Tech mode
// ---------------------------------------------------------------------------
const HELP: Record<string, { title: string; desc: string }> = {
  POWER:   { title: 'Motor Power',      desc: 'Instantaneous motor output in kilowatts (kW). Negative values mean regenerative braking — the motor is recovering energy back into the battery instead of consuming it.' },
  EFFIC:   { title: 'Efficiency',       desc: 'Instantaneous energy use in Watt-hours per mile (Wh/mi). Lower = more efficient. Typical highway driving is 250–350 Wh/mi.' },
  MOTOR:   { title: 'Motor Load',       desc: 'Percentage of peak motor output (450 kW) currently in use. High during hard acceleration; shows as negative power during regen.' },
  GEAR:    { title: 'Gear / Shift State', desc: 'Current drive mode selected by the stalk. P = Park, D = Drive, R = Reverse, N = Neutral.' },
  HDG:     { title: 'Heading',          desc: 'Compass bearing in degrees. 0° = North, 90° = East, 180° = South, 270° = West.' },
  RATED:   { title: 'Rated Range',      desc: 'EPA-rated range in miles at a full charge under standard test conditions. A consistent reference point, not a real-world prediction.' },
  EST:     { title: 'Estimated Range',  desc: 'Projected real-world range based on your recent energy consumption patterns. More accurate than rated range for your driving style.' },
  USABLE:  { title: 'Usable Battery',   desc: 'Battery percentage available for driving. Excludes a small reserve Tesla keeps to protect long-term battery health.' },
  LIMIT:   { title: 'Charge Limit',     desc: 'Maximum charge percentage you\'ve set. Tesla recommends 80–90% for daily use to preserve battery longevity. Only charge to 100% before long trips.' },
  STATE:   { title: 'Charge State',     desc: 'Current charging status. Charging = actively charging. Complete = reached your limit. Stopped = manually stopped. Disconnected = not plugged in.' },
  RATE:    { title: 'Charge Rate',      desc: 'How fast range is being added, in miles per hour. Much higher on DC Superchargers than Level 1/2 AC chargers.' },
  'AC/DC': { title: 'Charger Power',    desc: 'Power delivered in kilowatts. AC = Level 1 (~1.4 kW) or Level 2 (up to 11.5 kW). DC = Supercharger (up to 250 kW).' },
  ETA:     { title: 'Time to Charge Limit', desc: 'Estimated time remaining until the battery reaches your set charge limit.' },
  OUT:     { title: 'Outside Temp',     desc: 'Exterior ambient temperature read by the vehicle\'s outside temperature sensor.' },
  CAB:     { title: 'Cabin Temp',       desc: 'Current interior cabin air temperature.' },
  SET:     { title: 'Temp Setting',     desc: 'Driver\'s target climate temperature. The HVAC system adjusts heating or cooling to reach this setpoint.' },
  'A/C':   { title: 'Climate Control',  desc: 'Whether the climate control system is actively running. ON = the car is heating or cooling the cabin right now.' },
  SHL:     { title: 'Left Seat Heater', desc: 'Driver seat heater level. ○○○ = Off, ●○○ = Low, ●●○ = Medium, ●●● = High.' },
  SHR:     { title: 'Right Seat Heater', desc: 'Passenger seat heater level. ○○○ = Off, ●○○ = Low, ●●○ = Medium, ●●● = High.' },
  LOCK:    { title: 'Door Lock',        desc: 'Whether the vehicle doors are currently locked (●) or unlocked (○).' },
  SNTRY:   { title: 'Sentry Mode',      desc: 'When on, cameras continuously monitor surroundings and clip suspicious activity while parked. Uses battery.' },
  CAM:     { title: 'Dashcam',          desc: 'Current dashcam recording state (e.g. Recording, Saved, Unavailable). Requires a USB drive in the car.' },
  FRUNK:   { title: 'Front Trunk',      desc: 'Open / closed status of the front trunk (frunk). OPEN means the front hood is not latched.' },
  TRUNK:   { title: 'Rear Trunk',       desc: 'Open / closed status of the rear trunk. OPEN means the tailgate is not latched.' },
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface Props {
  data: TeslaVehicleData | null;
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------
export default function HUDOverlay({ data }: Props) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<HUDMode>('minimal');
  const [livePulse, setLivePulse] = useState(true);

  // Rolling 30-sample efficiency history for the Tech chart
  const [chartSamples, setChartSamples] = useState<number[]>(
    Array(CHART_SAMPLES).fill(0),
  );

  // Blink the live indicator every 800 ms
  useEffect(() => {
    const t = setInterval(() => setLivePulse(v => !v), 800);
    return () => clearInterval(t);
  }, []);

  // Append new efficiency sample whenever data updates
  useEffect(() => {
    if (!data) return;
    setChartSamples(prev => [...prev.slice(1), Math.abs(data.efficiency)]);
  }, [data]);

  // Derived display values (safe defaults when data is null)
  const speed             = data?.speed             ?? 0;
  const battery           = data?.batteryLevel      ?? 0;
  const range             = data?.batteryRange      ?? 0;
  const power             = data?.power             ?? 0;
  const efficiency        = data?.efficiency        ?? 0;
  const outsideTemp       = data?.outsideTemp       ?? null;
  const cabinTemp         = data?.cabinTemp         ?? null;
  const isRegen           = data?.isRegen           ?? false;
  const motorPct          = data?.motorPct          ?? 0;
  const odometer          = data?.odometer          ?? 0;
  const tires             = data?.tirePressures     ?? { fl: 0, fr: 0, rl: 0, rr: 0 };
  const battColor         = battery < 20 ? C.red : C.green;
  // Extended fields for Tech mode
  const shiftState        = data?.shiftState        ?? null;
  const heading           = data?.heading           ?? 0;
  const estBatteryRange   = data?.estBatteryRange   ?? 0;
  const usableBatteryLevel= data?.usableBatteryLevel?? 0;
  const chargingState     = data?.chargingState     ?? null;
  const chargeRate        = data?.chargeRate        ?? 0;
  const chargerPower      = data?.chargerPower      ?? 0;
  const minutesToFull     = data?.minutesToFullCharge?? 0;
  const chargeLimitSoc    = data?.chargeLimitSoc    ?? 0;
  const driverTempSetting = data?.driverTempSetting ?? null;
  const isClimateOn       = data?.isClimateOn       ?? false;
  const seatHeaterLeft    = data?.seatHeaterLeft    ?? 0;
  const seatHeaterRight   = data?.seatHeaterRight   ?? 0;
  const steeringWheelHtr  = data?.steeringWheelHeater ?? false;
  const locked            = data?.locked            ?? false;
  const sentryMode        = data?.sentryMode        ?? false;
  const dashcamState      = data?.dashcamState      ?? null;
  const frunkOpen         = data?.frunkOpen         ?? false;
  const trunkOpen         = data?.trunkOpen         ?? false;

  return (
    <View
      style={[
        styles.root,
        {
          width:         W,
          height:        H,
          paddingLeft:   Math.max(insets.left,  sw(16)),
          paddingRight:  Math.max(insets.right, sw(16)),
          paddingTop:    Math.max(insets.top,   sh(20)),
          paddingBottom: Math.max(insets.bottom, sh(20)),
        },
      ]}
    >
      {/* ── Live indicator (minimal + drive only; tech has its own) ── */}
      {mode !== 'tech' && (
        <View style={[styles.liveRow, {
          top:  Math.max(insets.top  + sh(8),  sh(14)),
          left: Math.max(insets.left + sw(10), sw(20)),
        }]}>
          <View style={[styles.liveDot, { opacity: livePulse && !!data ? 1 : 0 }]} />
          <Text style={styles.liveLabel}>LIVE</Text>
        </View>
      )}

      {/* ── Mode tabs ──────────────────────────────────── */}
      <View style={[styles.modeSwitcher, {
        bottom: Math.max(insets.bottom + sh(8), sh(18)),
        left: sw(8),
        right: sw(8),
      }]}>
        {MODES.map((m, i) => (
          <TouchableOpacity
            key={m}
            activeOpacity={0.7}
            onPress={() => setMode(m)}
            style={[
              styles.modeTab,
              mode === m && styles.modeTabActive,
              { flex: i === 1 ? 1.05 : 1 },
            ]}
          >
            <Text style={[styles.modeTabLabel, mode === m && styles.modeTabLabelActive]}>
              {m.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Mode views ─────────────────────────────────────── */}
      {mode === 'minimal' && (
        <MinimalMode
          speed={speed}
          battery={battery}
          range={range}
          battColor={battColor}
        />
      )}

      {mode === 'drive' && (
        <DriveMode
          speed={speed}
          power={power}
          efficiency={efficiency}
          motorPct={motorPct}
          outsideTemp={outsideTemp}
          cabinTemp={cabinTemp}
          isRegen={isRegen}
          battery={battery}
          battColor={battColor}
        />
      )}

      {mode === 'tech' && (
        <TechMode
          livePulse={livePulse}
          hasData={!!data}
          speed={speed}
          power={power}
          battery={battery}
          battColor={battColor}
          odometer={odometer}
          tires={tires}
          chartSamples={chartSamples}
          motorPct={motorPct}
          efficiency={efficiency}
          isRegen={isRegen}
          shiftState={shiftState}
          heading={heading}
          range={range}
          estBatteryRange={estBatteryRange}
          usableBatteryLevel={usableBatteryLevel}
          chargingState={chargingState}
          chargeRate={chargeRate}
          chargerPower={chargerPower}
          minutesToFull={minutesToFull}
          chargeLimitSoc={chargeLimitSoc}
          outsideTemp={outsideTemp}
          cabinTemp={cabinTemp}
          driverTempSetting={driverTempSetting}
          isClimateOn={isClimateOn}
          seatHeaterLeft={seatHeaterLeft}
          seatHeaterRight={seatHeaterRight}
          steeringWheelHtr={steeringWheelHtr}
          locked={locked}
          sentryMode={sentryMode}
          dashcamState={dashcamState}
          frunkOpen={frunkOpen}
          trunkOpen={trunkOpen}
        />
      )}
    </View>
  );
}

// ===========================================================================
// MINIMAL MODE
// ===========================================================================
const MAX_SPEED_MPH = 160;

interface MinimalProps {
  speed: number;
  battery: number;
  range: number;
  battColor: string;
}

function MinimalMode({ speed, battery, range, battColor }: MinimalProps) {
  const speedPct = Math.min(100, (speed / MAX_SPEED_MPH) * 100);

  return (
    <View style={styles.minimalRoot}>
      {/* Speed card with shadow */}
      <View style={styles.minimalSpeedCard}>
        <Text style={styles.speedBig}>{Math.round(speed)}</Text>
        <Text style={styles.speedUnit}>MPH</Text>
        {/* Speed bar */}
        <View style={styles.minimalSpeedBarTrack}>
          <View
            style={[
              styles.minimalSpeedBarFill,
              { width: `${speedPct}%` as any },
            ]}
          />
        </View>
      </View>

      {/* Battery bar — full width below speed card */}
      <View style={styles.minimalBattSection}>
        <View style={styles.minimalBattRow}>
          <Text style={[styles.minimalBig, { color: battColor }]}>
            {battery}
            <Text style={styles.minimalUnit}>%</Text>
          </Text>
          <Text style={[styles.minimalBig, { color: C.cyan }]}>
            {Math.round(range)}
            <Text style={styles.minimalUnit}> mi</Text>
          </Text>
        </View>
        <View style={styles.minimalBattTrack}>
          <View
            style={[
              styles.minimalBattFill,
              { width: `${Math.min(100, battery)}%` as any, backgroundColor: battColor },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

// ===========================================================================
// DRIVE MODE
// ===========================================================================
interface DriveProps {
  speed: number;
  power: number;
  efficiency: number;
  motorPct: number;
  outsideTemp: number | null;
  cabinTemp: number | null;
  isRegen: boolean;
  battery: number;
  battColor: string;
}

function DriveMode({
  speed, power, efficiency, motorPct,
  outsideTemp, cabinTemp, isRegen,
  battery, battColor,
}: DriveProps) {
  const powerColor = isRegen ? C.green : power > 200 ? C.amber : C.cyan;

  return (
    <View style={styles.driveRoot}>
      {/* Top row: left stats | speed | right stats */}
      <View style={styles.driveTop}>

        {/* LEFT: power / efficiency / motor */}
        <Panel style={styles.driveSidePanel}>
          <DataRow label="POWER"  value={`${Math.abs(Math.round(power))} kW`} valueColor={powerColor} />
          <DataRow label="EFFIC"  value={`${efficiency} Wh/mi`} />
          <DataRow label="MOTOR"  value={`${motorPct}%`} />
          {isRegen && <Text style={styles.regenTag}>↓ REGEN</Text>}
        </Panel>

        {/* CENTER: speed + power bar */}
        <View style={styles.driveCenterBlock}>
          <Text style={styles.speedMed}>{Math.round(speed)}</Text>
          <Text style={styles.speedUnitSm}>MPH</Text>
          <PowerBar power={power} />
        </View>

        {/* RIGHT: temps */}
        <Panel style={styles.driveSidePanel}>
          <DataRow label="OUT"   value={outsideTemp != null ? `${outsideTemp}°F` : '--'} valueColor={C.amber} />
          <DataRow label="CAB"   value={cabinTemp   != null ? `${cabinTemp}°F`   : '--'} valueColor={C.amber} />
        </Panel>

      </View>

      {/* Battery bar */}
      <View style={styles.driveBattRow}>
        <Text style={[styles.label, { color: battColor, width: sw(40) }]}>
          {battery}%
        </Text>
        <BatteryBar pct={battery} color={battColor} width={sw(600)} height={sh(8)} />
        <Text style={[styles.label, { color: C.muted, width: sw(60), textAlign: 'right', fontSize: sf(16) }]}>
          ⚡
        </Text>
      </View>
    </View>
  );
}

// ===========================================================================
// TECH MODE
// ===========================================================================
interface TechProps {
  livePulse: boolean;
  hasData: boolean;
  // Drive
  speed: number;
  power: number;
  motorPct: number;
  efficiency: number;
  isRegen: boolean;
  shiftState: string | null;
  heading: number;
  // Battery
  battery: number;
  battColor: string;
  range: number;
  estBatteryRange: number;
  usableBatteryLevel: number;
  // Charging
  chargingState: string | null;
  chargeRate: number;
  chargerPower: number;
  minutesToFull: number;
  chargeLimitSoc: number;
  // Climate
  outsideTemp: number | null;
  cabinTemp: number | null;
  driverTempSetting: number | null;
  isClimateOn: boolean;
  seatHeaterLeft: number;
  seatHeaterRight: number;
  steeringWheelHtr: boolean;
  // Vehicle
  odometer: number;
  tires: { fl: number; fr: number; rl: number; rr: number };
  locked: boolean;
  sentryMode: boolean;
  dashcamState: string | null;
  frunkOpen: boolean;
  trunkOpen: boolean;
  // Chart
  chartSamples: number[];
}

function TechMode({
  livePulse, hasData,
  speed, power, motorPct, efficiency, isRegen, shiftState, heading,
  battery, battColor, range, estBatteryRange, usableBatteryLevel,
  chargingState, chargeRate, chargerPower, minutesToFull, chargeLimitSoc,
  outsideTemp, cabinTemp, driverTempSetting, isClimateOn,
  seatHeaterLeft, seatHeaterRight,
  odometer, tires, locked, sentryMode, dashcamState, frunkOpen, trunkOpen,
  chartSamples,
}: TechProps) {
  const [tooltipKey, setTooltipKey] = useState<string | null>(null);

  const cState     = chargingState ?? 'Disconnected';
  const cColor     = cState === 'Charging' ? C.green
                   : cState === 'Complete' ? C.cyan
                   : cState === 'Stopped'  ? C.amber : C.muted;
  const heatStr    = (n: number) => ['○○○', '●○○', '●●○', '●●●'][Math.min(3, n)];
  const fmtMin     = (m: number) => m === 0 ? '--' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
  const powerColor = isRegen ? C.green : power > 200 ? C.amber : C.cyan;
  const onHelp     = setTooltipKey;

  return (
    <View style={styles.techRoot}>

      {/* ── 3-column body ──────────────────────────────────────────── */}
      <View style={styles.techBody}>

        {/* ── LEFT: DRIVE ─────────────────────────────────────────── */}
        <Panel style={styles.techPanel}>
          <Text style={styles.techHdr}>◈  DRIVE</Text>

          <View style={{ alignItems: 'center', marginVertical: sh(2) }}>
            <Text style={styles.speedMed}>{Math.round(speed)}</Text>
            <Text style={styles.speedUnitSm}>MPH</Text>
            <PowerBar power={power} barWidth={sw(160)} />
          </View>

          <View style={styles.techDivider} />
          <DataRow label="POWER" value={`${Math.abs(Math.round(power))} kW`} valueColor={powerColor}            helpKey="POWER" onHelp={onHelp} />
          <DataRow label="EFFIC" value={efficiency > 0 ? `${efficiency} Wh/mi` : '--'}
                                 helpKey="EFFIC" onHelp={onHelp} />
          <DataRow label="MOTOR" value={`${motorPct}%`}  helpKey="MOTOR" onHelp={onHelp} />
          <DataRow label="GEAR"  value={shiftState ?? '--'} valueColor={C.amber}
                                 helpKey="GEAR"  onHelp={onHelp} />
          <DataRow label="HDG"   value={`${heading}°`}   helpKey="HDG"   onHelp={onHelp} />
        </Panel>

        {/* ── CENTER: STATUS — dual bars + car schematic ──────────── */}
        <Panel style={[styles.techPanel, { flex: 1.05, alignItems: 'center' }]}>
          <Text style={styles.techHdr}>◈  STATUS</Text>

          {/* Dual bars: drive power (top) + battery SOC (bottom) */}
          <DualBar
            power={power}
            battery={battery}
            battColor={battColor}
            isRegen={isRegen}
          />

          <View style={styles.techDivider} />

          {/* Car schematic with tire PSI + status overlays */}
          <CarSchematic
            tires={tires}
            locked={locked}
            frunkOpen={frunkOpen}
            trunkOpen={trunkOpen}
            sentryMode={sentryMode}
            isClimateOn={isClimateOn}
          />
        </Panel>

        {/* ── RIGHT: BATTERY / CLIMATE ────────────────────────────── */}
        <Panel style={styles.techPanel}>
          <Text style={styles.techHdr}>◈  BATTERY</Text>
          <DataRow label="RATED"  value={`${Math.round(range)} mi`}
                                  helpKey="RATED"  onHelp={onHelp} />
          <DataRow label="EST"    value={`${Math.round(estBatteryRange)} mi`}
                                  helpKey="EST"    onHelp={onHelp} />
          <DataRow label="USABLE" value={`${usableBatteryLevel}%`}
                                  helpKey="USABLE" onHelp={onHelp} />
          <DataRow label="LIMIT"  value={`${chargeLimitSoc}%`} valueColor={C.amber}
                                  helpKey="LIMIT"  onHelp={onHelp} />

          <View style={styles.techDivider} />
          <DataRow label="STATE"  value={cState}  valueColor={cColor}
                                  helpKey="STATE"  onHelp={onHelp} />
          <DataRow label="RATE"   value={chargeRate   > 0 ? `${chargeRate} mph` : '--'}
                                  valueColor={chargeRate   > 0 ? C.green : C.muted}
                                  helpKey="RATE"   onHelp={onHelp} />
          <DataRow label="AC/DC"  value={chargerPower > 0 ? `${chargerPower} kW` : '--'}
                                  valueColor={chargerPower > 0 ? C.green : C.muted}
                                  helpKey="AC/DC"  onHelp={onHelp} />
          <DataRow label="ETA"    value={fmtMin(minutesToFull)}
                                  helpKey="ETA"    onHelp={onHelp} />

          <View style={styles.techDivider} />
          <TwinRow
            l1="OUT" v1={outsideTemp       != null ? `${outsideTemp}°F`       : '--'} c1={C.amber} h1="OUT"
            l2="CAB" v2={cabinTemp         != null ? `${cabinTemp}°F`         : '--'} c2={C.amber} h2="CAB"
            onHelp={onHelp}
          />
          <TwinRow
            l1="SET" v1={driverTempSetting != null ? `${driverTempSetting}°F` : '--'} h1="SET"
            l2="A/C" v2={isClimateOn ? 'ON' : 'OFF'} c2={isClimateOn ? C.green : C.muted} h2="A/C"
            onHelp={onHelp}
          />
        </Panel>

      </View>

      {/* ── Bottom strip: live dot + odometer + efficiency chart ───── */}

      {/* ── Tooltip modal ────────────────────────────────────────────── */}
      <TooltipModal helpKey={tooltipKey} onClose={() => setTooltipKey(null)} />

    </View>
  );
}

// ===========================================================================
// SHARED SUB-COMPONENTS
// ===========================================================================

// ── Panel wrapper ──────────────────────────────────────────────────────────
function Panel({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[styles.panel, style]}>{children}</View>;
}

// ── Label + value row ──────────────────────────────────────────────────────
function DataRow({
  label,
  value,
  valueColor = C.dimWhite,
  helpKey,
  onHelp,
}: {
  label: string;
  value: string;
  valueColor?: string;
  helpKey?: string;
  onHelp?: (key: string) => void;
}) {
  return (
    <View style={styles.dataRow}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {helpKey && onHelp && (
          <TouchableOpacity
            onPress={() => onHelp(helpKey)}
            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
          >
            <View style={styles.helpBadge}>
              <Text style={styles.helpBadgeText}>?</Text>
            </View>
          </TouchableOpacity>
        )}
      </View>
      <Text style={[styles.value, { color: valueColor }]}>{value}</Text>
    </View>
  );
}

// ── Twin-value row (two label+value pairs on one line) ────────────────────
function TwinRow({
  l1, v1, c1, h1,
  l2, v2, c2, h2,
  onHelp,
}: {
  l1: string; v1: string; c1?: string; h1?: string;
  l2: string; v2: string; c2?: string; h2?: string;
  onHelp?: (key: string) => void;
}) {
  return (
    <View style={styles.twinRow}>
      <View style={styles.twinCell}>
        <Text style={styles.label}>{l1}</Text>
        {h1 && onHelp && (
          <TouchableOpacity onPress={() => onHelp(h1)} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
            <View style={styles.helpBadge}><Text style={styles.helpBadgeText}>?</Text></View>
          </TouchableOpacity>
        )}
        <Text style={[styles.value, { color: c1 ?? C.dimWhite, fontSize: sf(11) }]}>{v1}</Text>
      </View>
      <View style={[styles.twinCell, { justifyContent: 'flex-end' }]}>
        <Text style={styles.label}>{l2}</Text>
        {h2 && onHelp && (
          <TouchableOpacity onPress={() => onHelp(h2)} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
            <View style={styles.helpBadge}><Text style={styles.helpBadgeText}>?</Text></View>
          </TouchableOpacity>
        )}
        <Text style={[styles.value, { color: c2 ?? C.dimWhite, fontSize: sf(11) }]}>{v2}</Text>
      </View>
    </View>
  );
}

// ── Dual bars: drive power + battery SOC ──────────────────────────────────
function DualBar({
  power, battery, battColor, isRegen,
}: {
  power: number; battery: number; battColor: string; isRegen: boolean;
}) {
  const BAR_H      = sh(10);
  const BAR_R      = BAR_H / 2;
  const powerPct   = Math.min(100, (Math.abs(power) / MAX_POWER_KW) * 100);
  const driveColor = isRegen ? C.green : C.cyan;

  return (
    <View style={{ width: '100%', gap: sh(7) }}>

      {/* Drive power row */}
      <View style={{ gap: sh(3) }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={styles.label}>DRIVE</Text>
          <Text style={[styles.label, { color: driveColor }]}>
            {isRegen ? '↓ ' : ''}{Math.abs(Math.round(power))} kW
          </Text>
        </View>
        <View style={{
          height: BAR_H, backgroundColor: C.muted, borderRadius: BAR_R,
          overflow: 'hidden', opacity: 0.85,
        }}>
          <View style={{
            width: `${powerPct}%`, height: BAR_H,
            backgroundColor: driveColor, borderRadius: BAR_R,
          }} />
        </View>
      </View>

      {/* Battery SOC row */}
      <View style={{ gap: sh(3) }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={styles.label}>BATTERY</Text>
          <Text style={[styles.label, { color: battColor }]}>{battery}%</Text>
        </View>
        <View style={{
          height: BAR_H, backgroundColor: C.muted, borderRadius: BAR_R,
          overflow: 'hidden', opacity: 0.85,
        }}>
          <View style={{
            width: `${Math.min(100, battery)}%`, height: BAR_H,
            backgroundColor: battColor, borderRadius: BAR_R,
          }} />
        </View>
      </View>

    </View>
  );
}

// ── Car schematic — Tesla Model 3 top-down silhouette ────────────────────
// Shape key: pointed front (FR = BODY_W/2 semi-circle) + blunter rear (RR)
// overflow:'hidden' clips all glass sections to the asymmetric pill automatically
function CarSchematic({
  tires, locked, frunkOpen, trunkOpen, sentryMode, isClimateOn,
}: {
  tires: { fl: number; fr: number; rl: number; rr: number };
  locked: boolean;
  frunkOpen: boolean;
  trunkOpen: boolean;
  sentryMode: boolean;
  isClimateOn: boolean;
}) {
  const LINE = 'rgba(255,255,255,0.55)';
  const GLASS = 'rgba(255,255,255,0.12)';
  const FILL = 'rgba(255,255,255,0.04)';

  // Overall container
  const W = sw(130);
  const H = sh(180);

  // Body outline
  const BW = sw(52);
  const BH = sh(140);
  const BX = (W - BW) / 2;
  const BY = sh(20);

  // Nose and tail radii
  const NOSE_R = BW / 2;
  const TAIL_R = sw(18);

  // Section heights (top to bottom inside body)
  const HOOD = sh(20);
  const WSHIELD = sh(18);
  const ROOF = sh(52);
  const RGLASS = sh(16);
  // trunk = remainder

  // Tire dimensions
  const TW = sw(8);
  const TH = sh(22);
  const T_GAP = sw(3);

  // Axle Y positions
  const F_AXLE = BY + HOOD + WSHIELD * 0.4;
  const R_AXLE = BY + HOOD + WSHIELD + ROOF + RGLASS * 0.5;

  // Mirror
  const MIR_W = sw(10);
  const MIR_H = sh(5);
  const MIR_Y = BY + HOOD + sh(2);

  // Door line positions (Y inside body)
  const DOOR_FL_Y = HOOD + WSHIELD + sh(2);
  const DOOR_RL_Y = HOOD + WSHIELD + ROOF * 0.48;

  const tireColor = (p: number) =>
    p === 0 ? C.muted : p >= 30 && p <= 42 ? C.white : C.amber;

  return (
    <View style={{ width: W, height: H, alignSelf: 'center' }}>

      {/* ── BODY SHELL ─────────────────────────────────────── */}
      <View style={{
        position: 'absolute',
        left: BX, top: BY,
        width: BW, height: BH,
        borderTopLeftRadius: NOSE_R,
        borderTopRightRadius: NOSE_R,
        borderBottomLeftRadius: TAIL_R,
        borderBottomRightRadius: TAIL_R,
        backgroundColor: FILL,
        borderWidth: 1,
        borderColor: LINE,
        overflow: 'hidden',
      }}>

        {/* Hood line */}
        <View style={{ position: 'absolute', top: HOOD, left: sw(4), right: sw(4), height: 0.5, backgroundColor: LINE }} />

        {/* Windshield */}
        <View style={{
          position: 'absolute', top: HOOD, left: 0, right: 0,
          height: WSHIELD,
          backgroundColor: GLASS,
        }} />

        {/* Windshield bottom line */}
        <View style={{ position: 'absolute', top: HOOD + WSHIELD, left: sw(2), right: sw(2), height: 0.5, backgroundColor: LINE }} />

        {/* Roof glass panel */}
        <View style={{
          position: 'absolute',
          top: HOOD + WSHIELD + sh(4),
          left: sw(5), right: sw(5),
          height: ROOF - sh(8),
          borderWidth: 0.5,
          borderColor: 'rgba(255,255,255,0.25)',
          borderRadius: s(2),
          backgroundColor: 'rgba(255,255,255,0.03)',
        }} />

        {/* Centre roof spine */}
        <View style={{
          position: 'absolute',
          top: HOOD + WSHIELD + sh(4),
          left: BW / 2 - 0.25,
          width: 0.5,
          height: ROOF - sh(8),
          backgroundColor: 'rgba(255,255,255,0.18)',
        }} />

        {/* B-pillar line (door divider) */}
        <View style={{
          position: 'absolute',
          top: DOOR_RL_Y,
          left: 0, right: 0,
          height: 0.5,
          backgroundColor: 'rgba(255,255,255,0.20)',
        }} />

        {/* Left door lines */}
        <View style={{
          position: 'absolute',
          top: DOOR_FL_Y, left: 0,
          width: 0.5, height: DOOR_RL_Y - DOOR_FL_Y,
          backgroundColor: 'rgba(255,255,255,0.15)',
        }} />
        <View style={{
          position: 'absolute',
          top: DOOR_RL_Y, left: 0,
          width: 0.5, height: sh(22),
          backgroundColor: 'rgba(255,255,255,0.15)',
        }} />

        {/* Right door lines */}
        <View style={{
          position: 'absolute',
          top: DOOR_FL_Y, right: 0,
          width: 0.5, height: DOOR_RL_Y - DOOR_FL_Y,
          backgroundColor: 'rgba(255,255,255,0.15)',
        }} />
        <View style={{
          position: 'absolute',
          top: DOOR_RL_Y, right: 0,
          width: 0.5, height: sh(22),
          backgroundColor: 'rgba(255,255,255,0.15)',
        }} />

        {/* Rear glass */}
        <View style={{
          position: 'absolute',
          top: HOOD + WSHIELD + ROOF,
          left: 0, right: 0,
          height: RGLASS,
          backgroundColor: GLASS,
        }} />

        {/* Rear glass top line */}
        <View style={{ position: 'absolute', top: HOOD + WSHIELD + ROOF, left: sw(2), right: sw(2), height: 0.5, backgroundColor: LINE }} />

        {/* Trunk line */}
        <View style={{ position: 'absolute', top: HOOD + WSHIELD + ROOF + RGLASS, left: sw(4), right: sw(4), height: 0.5, backgroundColor: LINE }} />

        {/* Status overlay in center */}
        <View style={{
          position: 'absolute',
          top: HOOD + WSHIELD + sh(6),
          left: 0, right: 0,
          alignItems: 'center', gap: s(2),
        }}>
          <Text style={{ fontSize: sf(11) }}>{locked ? '🔒' : '🔓'}</Text>
          {sentryMode && (
            <Text style={{ fontFamily: FONTS.mono, fontSize: sf(6), color: C.amber, letterSpacing: 1 }}>SNTRY</Text>
          )}
          {isClimateOn && (
            <Text style={{ fontFamily: FONTS.mono, fontSize: sf(6), color: C.cyan, letterSpacing: 1 }}>A/C</Text>
          )}
        </View>
      </View>

      {/* ── SIDE MIRRORS ──────────────────────────────────── */}
      <View style={{
        position: 'absolute',
        top: MIR_Y, left: BX - MIR_W + sw(1),
        width: MIR_W, height: MIR_H,
        borderTopLeftRadius: MIR_H,
        borderBottomLeftRadius: s(1),
        borderTopRightRadius: s(1),
        borderBottomRightRadius: s(1),
        borderWidth: 0.5,
        borderColor: LINE,
        backgroundColor: FILL,
      }} />
      <View style={{
        position: 'absolute',
        top: MIR_Y, left: BX + BW - sw(1),
        width: MIR_W, height: MIR_H,
        borderTopRightRadius: MIR_H,
        borderBottomRightRadius: s(1),
        borderTopLeftRadius: s(1),
        borderBottomLeftRadius: s(1),
        borderWidth: 0.5,
        borderColor: LINE,
        backgroundColor: FILL,
      }} />

      {/* ── DOOR HANDLES (small ticks) ────────────────────── */}
      {[DOOR_FL_Y + sh(8), DOOR_RL_Y + sh(8)].map((dy, i) => (
        <React.Fragment key={`dh${i}`}>
          <View style={{
            position: 'absolute',
            top: BY + dy, left: BX - sw(1),
            width: sw(3), height: sh(2),
            backgroundColor: 'rgba(255,255,255,0.3)',
            borderRadius: 1,
          }} />
          <View style={{
            position: 'absolute',
            top: BY + dy, left: BX + BW - sw(2),
            width: sw(3), height: sh(2),
            backgroundColor: 'rgba(255,255,255,0.3)',
            borderRadius: 1,
          }} />
        </React.Fragment>
      ))}

      {/* ── TIRES + PSI LABELS ────────────────────────────── */}
      {(['fl', 'fr', 'rl', 'rr'] as const).map(key => {
        const isLeft = key[1] === 'l';
        const isFront = key[0] === 'f';
        const psi = tires[key];
        const axleY = isFront ? F_AXLE : R_AXLE;
        const tireX = isLeft ? BX - TW - T_GAP : BX + BW + T_GAP;
        const tireY = axleY - TH / 2;
        const col = tireColor(psi);

        return (
          <React.Fragment key={key}>
            {/* Tire rectangle */}
            <View style={{
              position: 'absolute',
              top: tireY, left: tireX,
              width: TW, height: TH,
              backgroundColor: psi === 0 ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.25)',
              borderRadius: s(2),
              borderWidth: 0.5,
              borderColor: psi === 0 ? 'rgba(255,255,255,0.15)' : LINE,
            }} />

            {/* PSI label — outside the tire */}
            <View style={{
              position: 'absolute',
              top: tireY + TH / 2 - sh(7),
              left: isLeft ? tireX - sw(42) : tireX + TW + sw(23),
              width: sw(20),
              alignItems: isLeft ? 'flex-end' as const : 'flex-start' as const,
            }}>
              <Text style={{
                fontFamily: FONTS.mono,
                fontSize: sf(11.25),
                color: col,
                fontWeight: '600',
              }}>
                {psi > 0 ? psi : '--'}
              </Text>
            </View>
          </React.Fragment>
        );
      })}

      {/* ── FRUNK badge ──────────────────────────────────── */}
      {frunkOpen && (
        <View style={[styles.schOpenBadge, { position: 'absolute', top: sh(4), left: W / 2 - sw(18) }]}>
          <Text style={styles.schOpenText}>▲ FRUNK</Text>
        </View>
      )}

      {/* ── TRUNK badge ──────────────────────────────────── */}
      {trunkOpen && (
        <View style={[styles.schOpenBadge, { position: 'absolute', bottom: sh(2), left: W / 2 - sw(18) }]}>
          <Text style={styles.schOpenText}>▼ TRUNK</Text>
        </View>
      )}
    </View>
  );
}

// ── Tooltip overlay — shown when user taps a ? badge ──────────────────────
function TooltipModal({
  helpKey,
  onClose,
}: {
  helpKey: string | null;
  onClose: () => void;
}) {
  const info = helpKey ? HELP[helpKey] : null;
  if (!info) return null;

  return (
    <TouchableOpacity
      style={styles.modalBackdrop}
      onPress={onClose}
      activeOpacity={1}
    >
      <View style={styles.modalCard}>
        <View style={styles.modalHeader}>
          <View style={styles.helpBadgeLg}>
            <Text style={styles.helpBadgeLgText}>?</Text>
          </View>
          <Text style={styles.modalTitle}>{info.title}</Text>
        </View>

        <View style={[styles.techDivider, { marginVertical: s(8) }]} />

        <Text style={styles.modalDesc}>{info.desc}</Text>

        <TouchableOpacity onPress={onClose} style={styles.modalDismiss}>
          <Text style={styles.modalDismissText}>DISMISS</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

// ── Power bar (Model 3-style acceleration / regen indicator) ───────────────
function PowerBar({ power, barWidth, maxKw }: { power: number; barWidth?: number; maxKw?: number }) {
  const BAR_W = barWidth ?? sw(220);
  const BAR_H = sh(6);
  const cap = maxKw ?? 150;
  const pct = Math.min(1, Math.abs(power) / cap);
  const fillW = BAR_W / 2 * pct;
  const isRegen = power < 0;
  const fillColor = isRegen ? C.green : C.cyan;

  return (
    <View style={{ width: BAR_W, height: BAR_H + s(16), alignItems: 'center', marginTop: sh(6) }}>
      {/* Track */}
      <View style={{
        width: BAR_W,
        height: BAR_H,
        backgroundColor: C.muted,
        borderRadius: BAR_H / 2,
        overflow: 'hidden',
        flexDirection: 'row',
      }}>
        {/* Regen fill (left half, grows from center leftward) */}
        <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end' }}>
          {isRegen && (
            <View style={{ width: fillW, height: BAR_H, backgroundColor: fillColor, borderRadius: BAR_H / 2 }} />
          )}
        </View>
        {/* Accel fill (right half, grows from center rightward) */}
        <View style={{ flex: 1 }}>
          {!isRegen && (
            <View style={{ width: fillW, height: BAR_H, backgroundColor: fillColor, borderRadius: BAR_H / 2 }} />
          )}
        </View>
      </View>
      {/* Center notch */}
      <View style={{
        position: 'absolute',
        top: -s(3),
        left: BAR_W / 2 - 1,
        width: 2,
        height: BAR_H + s(6),
        backgroundColor: C.white,
        opacity: 0.6,
      }} />
      {/* Labels */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: BAR_W, marginTop: s(3) }}>
        <Text style={{ fontFamily: FONTS.mono, fontSize: sf(8), color: C.green, letterSpacing: 1 }}>REGEN</Text>
        <Text style={{ fontFamily: FONTS.mono, fontSize: sf(8), color: C.cyan,  letterSpacing: 1 }}>ACCEL</Text>
      </View>
    </View>
  );
}

// ── Battery bar ────────────────────────────────────────────────────────────
function BatteryBar({
  pct,
  color,
  width = sw(200),
  height = sh(6),
}: {
  pct: number;
  color: string;
  width?: number;
  height?: number;
}) {
  return (
    <View style={[styles.battTrack, { width, height }]}>
      <View
        style={[
          styles.battFill,
          { width: `${Math.min(100, pct)}%` as any, backgroundColor: color, height },
        ]}
      />
    </View>
  );
}

// ── Power gauge (segmented bar arc illusion via stacked segments) ──────────
function PowerGauge({ pct, power }: { pct: number; power: number }) {
  const SEGMENTS = 16;
  const filled = Math.round((pct / 100) * SEGMENTS);
  const isRegen = power < 0;
  const fillColor = isRegen ? C.green : pct > 70 ? C.amber : C.cyan;

  return (
    <View style={styles.gaugeRow}>
      {Array.from({ length: SEGMENTS }).map((_, i) => {
        const active = i < filled;
        return (
          <View
            key={i}
            style={[
              styles.gaugeSegment,
              {
                backgroundColor: active ? fillColor : C.muted,
                opacity: active ? 1 : 0.25,
                // Taper height to simulate arc curvature
                height: sh(4 + Math.round(Math.sin(((i + 0.5) / SEGMENTS) * Math.PI) * 10)),
              },
            ]}
          />
        );
      })}
    </View>
  );
}

// ── Tire cell ──────────────────────────────────────────────────────────────
function TireCell({ label, psi }: { label: string; psi: number }) {
  const ok = psi >= 32 && psi <= 38;
  const color = psi === 0 ? C.muted : ok ? C.white : C.amber;
  return (
    <View style={styles.tireCell}>
      <Text style={[styles.tireLabel]}>{label}</Text>
      <Text style={[styles.tireValue, { color }]}>{psi || '--'}</Text>
    </View>
  );
}

// ── 30-sample efficiency chart ─────────────────────────────────────────────
function EfficiencyChart({ samples }: { samples: number[] }) {
  const max = Math.max(...samples, MAX_CHART_WH);
  const barWidth = sw(580) / CHART_SAMPLES - 2;

  return (
    <View style={styles.chart}>
      {samples.map((val, i) => {
        const fillPct = val / max;
        const isLast = i === samples.length - 1;
        return (
          <View
            key={i}
            style={[styles.chartBar, { width: barWidth }]}
          >
            <View
              style={{
                width: barWidth,
                height: sh(40) * fillPct,
                backgroundColor: isLast ? C.cyan : C.muted,
                opacity: isLast ? 1 : 0.5 + 0.5 * (i / CHART_SAMPLES),
                alignSelf: 'flex-end',
              }}
            />
          </View>
        );
      })}
    </View>
  );
}

// ===========================================================================
// STYLES
// ===========================================================================
const styles = StyleSheet.create({
  // ── Root ──────────────────────────────────────────────────────────────────
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: W,
    height: H,
  },

  // ── Live indicator ────────────────────────────────────────────────────────
  liveRow: {
    position: 'absolute',
    top: sh(14),
    left: sw(20),
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(5),
  },
  liveDot: {
    width: s(7),
    height: s(7),
    borderRadius: s(4),
    backgroundColor: C.green,
  },
  liveLabel: {
    fontFamily: FONTS.mono,
    fontSize: sf(10),
    color: C.muted,
    letterSpacing: 2,
  },

  // ── Mode switcher ─────────────────────────────────────────────────────────
  modeSwitcher: {
    position: 'absolute',
    bottom: sh(18),
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: sw(8),
    gap: sw(8),
    zIndex: 100,
  },
  modeTab: {
    alignItems: 'center',
    paddingVertical: sh(8),
    borderRadius: s(12),
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  modeTabActive: {
    backgroundColor: 'rgba(0, 212, 255, 0.12)',
    borderColor: 'rgba(0, 212, 255, 0.4)',
  },
  modeTabLabel: {
    fontFamily: FONTS.mono,
    fontSize: sf(11),
    color: C.muted,
    letterSpacing: 2,
  },
  modeTabLabelActive: {
    color: C.cyan,
  },

  // ── Panel ─────────────────────────────────────────────────────────────────
  panel: {
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: C.border,
    padding: s(10),
    gap: s(6),
  },

  // ── Shared text ───────────────────────────────────────────────────────────
  label: {
    fontFamily: FONTS.mono,
    fontSize: sf(10),
    color: C.muted,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  value: {
    fontFamily: FONTS.mono,
    fontSize: sf(13),
    color: C.dimWhite,
  },
  dataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: s(8),
  },
  regenTag: {
    fontFamily: FONTS.mono,
    fontSize: sf(10),
    color: C.green,
    marginTop: s(4),
    textAlign: 'center',
  },

  // ── Speed variants ────────────────────────────────────────────────────────
  speedBig: {
    fontFamily: FONTS.displayBlack,
    fontSize: sf(110),
    color: C.white,
    lineHeight: sf(110),
    includeFontPadding: false,
  },
  speedUnit: {
    fontFamily: FONTS.mono,
    fontSize: sf(18),
    color: C.muted,
    letterSpacing: 4,
    marginTop: sh(-6),
  },
  speedMed: {
    fontFamily: FONTS.displayBlack,
    fontSize: sf(72),
    color: C.white,
    lineHeight: sf(72),
    includeFontPadding: false,
  },
  speedUnitSm: {
    fontFamily: FONTS.mono,
    fontSize: sf(13),
    color: C.muted,
    letterSpacing: 3,
    marginTop: sh(-4),
  },

  // ── Battery bar ───────────────────────────────────────────────────────────
  battTrack: {
    backgroundColor: C.muted,
    overflow: 'hidden',
    opacity: 0.85,
  },
  battFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },

  // ── Gauge ─────────────────────────────────────────────────────────────────
  gaugeRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: s(3),
    paddingVertical: sh(6),
  },
  gaugeSegment: {
    flex: 1,
    borderRadius: s(1),
  },

  // ── Tire grid ─────────────────────────────────────────────────────────────
  tireGrid: {
    gap: s(6),
  },
  tireRow: {
    flexDirection: 'row',
    gap: s(10),
  },
  tireCell: {
    flex: 1,
    alignItems: 'center',
    gap: s(2),
  },
  tireLabel: {
    fontFamily: FONTS.mono,
    fontSize: sf(9),
    color: C.muted,
    letterSpacing: 1,
  },
  tireValue: {
    fontFamily: FONTS.display,
    fontSize: sf(16),
  },

  // ── Chart ─────────────────────────────────────────────────────────────────
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: sh(40),
    gap: 2,
    overflow: 'hidden',
  },
  chartBar: {
    justifyContent: 'flex-end',
  },

  // ── Minimal mode ──────────────────────────────────────────────────────────
  minimalRoot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: sh(10),
  },
  minimalSpeedCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: s(24),
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: sw(36),
    paddingTop: sh(18),
    paddingBottom: sh(14),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: s(10) },
    shadowOpacity: 0.5,
    shadowRadius: s(20),
    elevation: 12,
  },
  minimalSpeedBarTrack: {
    width: sw(180),
    height: sh(6),
    backgroundColor: 'rgba(46, 74, 100, 0.5)',
    borderRadius: sh(3),
    overflow: 'hidden',
    marginTop: sh(10),
  },
  minimalSpeedBarFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: C.cyan,
    borderRadius: sh(3),
  },
  minimalBattSection: {
    alignItems: 'center',
    marginTop: sh(20),
    width: sw(280),
  },
  minimalBattRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: sh(6),
  },
  minimalBattTrack: {
    width: '100%',
    height: sh(8),
    backgroundColor: 'rgba(46, 74, 100, 0.5)',
    borderRadius: sh(4),
    overflow: 'hidden',
  },
  minimalBattFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: sh(4),
  },
  minimalBig: {
    fontFamily: FONTS.display,
    fontSize: sf(27.5),
    color: C.white,
  },
  minimalUnit: {
    fontFamily: FONTS.mono,
    fontSize: sf(13),
    color: C.muted,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(14),
  },

  // ── Drive mode ────────────────────────────────────────────────────────────
  driveRoot: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: sw(8),
    gap: sh(10),
  },
  driveTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: sw(10),
  },
  driveSidePanel: {
    width: sw(170),
  },
  driveCenterBlock: {
    alignItems: 'center',
    flex: 1,
  },
  driveBattRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    paddingHorizontal: sw(4),
  },

  // ── Tech mode ─────────────────────────────────────────────────────────────
  techRoot: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: sw(8),
    paddingBottom: sh(65),
    gap: sh(6),
  },
  techBody: {
    flexDirection: 'row',
    flex: 1,
    gap: sw(8),
  },
  techPanel: {
    flex: 1,
    overflow: 'visible',
    paddingBottom: sh(10),
  },
  techHdr: {
    fontFamily: FONTS.mono,
    fontSize: sf(9),
    color: C.cyan,
    letterSpacing: 2,
    marginBottom: sh(2),
  },
  techDivider: {
    height: 1,
    backgroundColor: C.border,
    marginVertical: sh(3),
  },
  // ── Twin row ──────────────────────────────────────────────────────────────
  twinRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  twinCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(4),
  },
  // ── Help badge (? superscript) ────────────────────────────────────────────
  helpBadge: {
    width: s(13),
    height: s(13),
    borderRadius: s(7),
    borderWidth: 1,
    borderColor: C.muted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: s(2), // superscript offset
  },
  helpBadgeText: {
    fontFamily: FONTS.mono,
    fontSize: sf(7),
    color: C.muted,
    lineHeight: sf(9),
  },
  helpBadgeLg: {
    width: s(22),
    height: s(22),
    borderRadius: s(11),
    borderWidth: 1,
    borderColor: C.cyan,
    alignItems: 'center',
    justifyContent: 'center',
  },
  helpBadgeLgText: {
    fontFamily: FONTS.mono,
    fontSize: sf(11),
    color: C.cyan,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(3),
  },

  // ── Tooltip modal ─────────────────────────────────────────────────────────
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 200,
  },
  modalCard: {
    backgroundColor: 'rgba(20, 25, 40, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    padding: s(24),
    width: sw(320),
    borderRadius: s(20),
    gap: s(10),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: s(12) },
    shadowOpacity: 0.5,
    shadowRadius: s(24),
    elevation: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(12),
  },
  modalTitle: {
    fontFamily: FONTS.mono,
    fontSize: sf(15),
    color: C.white,
    letterSpacing: 1,
    flex: 1,
  },
  modalDesc: {
    fontFamily: FONTS.mono,
    fontSize: sf(12),
    color: C.dimWhite,
    lineHeight: sf(19),
  },
  modalDismiss: {
    alignSelf: 'center',
    marginTop: s(8),
    paddingVertical: sh(8),
    paddingHorizontal: sw(28),
    borderRadius: s(10),
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  modalDismissText: {
    fontFamily: FONTS.mono,
    fontSize: sf(11),
    color: C.white,
    letterSpacing: 2,
  },

  // ── Car schematic ─────────────────────────────────────────────────────────
  schBody: {
    position: 'absolute',
    backgroundColor: 'rgba(0,212,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(0,212,255,0.30)',
    borderRadius: s(8),
    overflow: 'hidden',
  },
  schWindshieldFront: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '28%',
    backgroundColor: 'rgba(0,212,255,0.09)',
    borderBottomWidth: 1,
    borderColor: 'rgba(0,212,255,0.22)',
  },
  schWindshieldRear: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '20%',
    backgroundColor: 'rgba(0,212,255,0.06)',
    borderTopWidth: 1,
    borderColor: 'rgba(0,212,255,0.18)',
  },
  schCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(4),
  },
  schLockIcon: {
    fontSize: sf(16),
  },
  schSentryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(3),
  },
  schSentryDot: {
    width: s(5),
    height: s(5),
    borderRadius: s(3),
    backgroundColor: C.amber,
  },
  schSentryText: {
    fontFamily: FONTS.mono,
    fontSize: sf(7),
    color: C.amber,
    letterSpacing: 1,
  },
  schClimateText: {
    fontFamily: FONTS.mono,
    fontSize: sf(7),
    color: C.cyan,
    letterSpacing: 1,
  },
  schTire: {
    position: 'absolute',
    borderRadius: s(3),
    alignItems: 'center',
    justifyContent: 'center',
  },
  schTireText: {
    fontFamily: FONTS.mono,
    fontSize: sf(8),
    color: '#000',
    fontWeight: '700' as const,
  },
  schOpenBadge: {
    position: 'absolute',
    backgroundColor: C.amber,
    paddingHorizontal: sw(3),
    paddingVertical: sh(1),
    borderRadius: s(2),
  },
  schOpenText: {
    fontFamily: FONTS.mono,
    fontSize: sf(6),
    color: '#000',
    letterSpacing: 0.5,
    fontWeight: '700' as const,
  },

  // ── Legacy tech layout (kept for style safety) ────────────────────────────
  techTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: sw(10),
  },
  techSidePanel: {
    width: sw(160),
  },
  techCenter: {
    alignItems: 'center',
    flex: 1,
  },
  chartSection: {
    paddingHorizontal: sw(4),
  },
  techBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    paddingHorizontal: sw(4),
  },
});
