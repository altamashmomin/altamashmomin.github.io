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
  Modal,
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
  cyan:     '#00d4ff',
  amber:    '#ff9d00',
  green:    '#00ff88',
  red:      '#ff3b30',
  muted:    '#2e4a64',
  white:    '#ffffff',
  dimWhite: 'rgba(255,255,255,0.75)',
};

const FONTS = {
  display: 'Orbitron-Bold',
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
          paddingTop:    Math.max(insets.top,   sh(10)),
          paddingBottom: Math.max(insets.bottom, sh(10)),
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

      {/* ── Mode switcher ──────────────────────────────────── */}
      <View style={[styles.modeSwitcher, {
        bottom: Math.max(insets.bottom + sh(8),  sh(18)),
        right:  Math.max(insets.right  + sw(10), sw(20)),
      }]}>
        {MODES.map(m => (
          <TouchableOpacity
            key={m}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            onPress={() => setMode(m)}
            style={styles.modeBtnOuter}
          >
            <View style={[styles.modeDot, mode === m && styles.modeDotActive]} />
            <Text style={[styles.modeLabel, mode === m && styles.modeLabelActive]}>
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
interface MinimalProps {
  speed: number;
  battery: number;
  range: number;
  battColor: string;
}

function MinimalMode({ speed, battery, range, battColor }: MinimalProps) {
  return (
    <View style={styles.minimalRoot}>
      {/* Big speed */}
      <View style={styles.minimalCenter}>
        <Text style={styles.speedBig}>{Math.round(speed)}</Text>
        <Text style={styles.speedUnit}>MPH</Text>
      </View>

      {/* Battery + range strip */}
      <View style={styles.minimalBottom}>
        <View style={styles.row}>
          <Text style={[styles.minimalBig, { color: battColor }]}>
            {battery}
            <Text style={styles.minimalUnit}>%</Text>
          </Text>
          <BatteryBar pct={battery} color={battColor} width={sw(180)} />
          <Text style={[styles.minimalBig, { color: C.cyan }]}>
            {Math.round(range)}
            <Text style={styles.minimalUnit}> mi</Text>
          </Text>
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
          <TwinRow
            l1="SHL" v1={heatStr(seatHeaterLeft)}  c1={seatHeaterLeft  > 0 ? C.amber : C.muted} h1="SHL"
            l2="SHR" v2={heatStr(seatHeaterRight)} c2={seatHeaterRight > 0 ? C.amber : C.muted} h2="SHR"
            onHelp={onHelp}
          />
          <DataRow label="CAM"    value={dashcamState ?? '--'}
                                  helpKey="CAM"    onHelp={onHelp} />
        </Panel>

      </View>

      {/* ── Bottom strip: live dot + odometer + efficiency chart ───── */}
      <View style={styles.techBottom}>
        <View style={[styles.liveDot, { opacity: livePulse && hasData ? 1 : 0, marginRight: s(2) }]} />
        <Text style={styles.liveLabel}>LIVE</Text>
        <Text style={[styles.label, { color: C.muted, flex: 1, marginLeft: s(12) }]}>
          ODO {odometer.toLocaleString()} mi
        </Text>
        <EfficiencyChart samples={chartSamples} />
      </View>

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
  // ── Body dimensions ───────────────────────────────────────────
  const BODY_W = sw(76);
  const BODY_H = sh(124);
  const FR     = BODY_W / 2;   // front corner radius = full semi-circle → pointed nose
  const RR     = sw(22);       // rear corner radius  = wider/blunter tail
  const TIRE_W = sw(13);
  const TIRE_H = sh(28);
  const OVL    = sw(4);        // tire overlaps body edge
  const MIR_W  = sw(12);      // mirror width — larger, like real M3
  const MIR_H  = sh(8);
  const BX     = TIRE_W - OVL;
  const TOTAL_W = BX + BODY_W + BX;
  const BY     = sh(14);
  const TOTAL_H = BY + BODY_H + sh(14);

  // ── Glass zones (inside body, top = front) ────────────────────
  const HOOD_H = sh(16);   // hood / frunk cap — clipped to pointed nose by FR
  const FG_H   = sh(21);   // windshield — brighter tint
  const RF_H   = sh(50);   // panoramic glass roof
  const RG_H   = sh(15);   // rear fastback glass
  // trunk = remainder, clipped to blunter tail by RR

  // ── Axle Y positions in CONTAINER coords ─────────────────────
  const TIRE_FY = BY + HOOD_H + Math.round(FG_H * 0.50) - Math.round(TIRE_H / 2);
  const TIRE_RY = BY + HOOD_H + FG_H + RF_H + Math.round(RG_H * 0.38) - Math.round(TIRE_H / 2);

  // ── Side mirror Y: sits at A-pillar (junction of windshield) ──
  const MIR_Y = BY + HOOD_H + sh(5);

  // ── B-pillar Y within the panoramic roof zone (% down the roof) ─
  const BPIL_Y = HOOD_H + FG_H + Math.round(RF_H * 0.46);

  const tireColor = (p: number): string =>
    p === 0 ? 'rgba(46,74,100,0.22)' : p >= 32 && p <= 38 ? 'rgba(200,200,200,0.92)' : C.amber;
  const tireTxtColor = (p: number): string =>
    p === 0 ? C.muted : '#111';

  // Thin section divider line (in local body coords)
  const divider = (top: number, inset = sw(8)) => (
    <View style={{
      position: 'absolute',
      top, left: inset, right: inset,
      height: 1,
      backgroundColor: 'rgba(0,212,255,0.42)',
    }} />
  );

  return (
    <View style={{ width: TOTAL_W, height: TOTAL_H, alignSelf: 'center' }}>

      {/* ── FRUNK OPEN badge ──────────────────────────────────── */}
      {frunkOpen && (
        <View style={[styles.schOpenBadge, { position: 'absolute', top: 0, left: TOTAL_W / 2 - sw(22) }]}>
          <Text style={styles.schOpenText}>▲ FRUNK</Text>
        </View>
      )}

      {/* ── BODY ─────────────────────────────────────────────────
          Asymmetric pill: pointed nose (FR = BODY_W/2) at top,
          blunter tail (RR = sw(22)) at bottom.
          overflow:'hidden' clips every child to this silhouette. */}
      <View style={{
        position: 'absolute',
        left: BX, top: BY,
        width: BODY_W, height: BODY_H,
        borderTopLeftRadius: FR,
        borderTopRightRadius: FR,
        borderBottomLeftRadius: RR,
        borderBottomRightRadius: RR,
        backgroundColor: 'rgba(0,212,255,0.07)',
        borderWidth: 1.5,
        borderColor: 'rgba(0,212,255,0.50)',
        overflow: 'hidden',
      }}>

        {/* HOOD / FRUNK CAP */}
        <View style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          height: HOOD_H,
          backgroundColor: 'rgba(0,212,255,0.16)',
        }} />
        {divider(HOOD_H)}

        {/* WINDSHIELD — bright tint, wide pane */}
        <View style={{
          position: 'absolute', top: HOOD_H + 1, left: 0, right: 0,
          height: FG_H,
          backgroundColor: 'rgba(0,212,255,0.34)',
        }} />
        {divider(HOOD_H + FG_H)}

        {/* PANORAMIC GLASS ROOF */}
        <View style={{
          position: 'absolute',
          top: HOOD_H + FG_H + 1, left: 0, right: 0,
          height: RF_H - 2,
          backgroundColor: 'rgba(0,212,255,0.04)',
        }}>
          {/* Glass pane inset border — shows the actual glass opening */}
          <View style={{
            position: 'absolute',
            top: sh(5), bottom: sh(5),
            left: sw(7), right: sw(7),
            borderWidth: 1,
            borderColor: 'rgba(0,212,255,0.28)',
            borderRadius: s(3),
          }} />

          {/* Centre roof rail (structural bar down the spine) */}
          <View style={{
            position: 'absolute', top: 0, bottom: 0,
            left: BODY_W / 2 - 1,
            width: 2,
            backgroundColor: 'rgba(0,212,255,0.22)',
          }} />

          {/* B-pillar — divides front door from rear door zone */}
          <View style={{
            position: 'absolute',
            top: Math.round(RF_H * 0.46),
            left: 0, right: 0,
            height: 1,
            backgroundColor: 'rgba(0,212,255,0.24)',
          }} />

          {/* Status items centred in roof pane */}
          <View style={{
            position: 'absolute', top: sh(5), bottom: sh(5),
            left: sw(7), right: sw(7),
            alignItems: 'center', justifyContent: 'center', gap: s(3),
          }}>
            <Text style={{ fontSize: sf(13) }}>{locked ? '🔒' : '🔓'}</Text>
            {sentryMode && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: s(3) }}>
                <View style={{ width: s(4), height: s(4), borderRadius: s(2), backgroundColor: C.amber }} />
                <Text style={{ fontFamily: FONTS.mono, fontSize: sf(7), color: C.amber, letterSpacing: 1 }}>SNTRY</Text>
              </View>
            )}
            {isClimateOn && (
              <Text style={{ fontFamily: FONTS.mono, fontSize: sf(7), color: C.cyan, letterSpacing: 1 }}>A/C ON</Text>
            )}
          </View>
        </View>
        {divider(HOOD_H + FG_H + RF_H)}

        {/* REAR FASTBACK GLASS */}
        <View style={{
          position: 'absolute',
          top: HOOD_H + FG_H + RF_H + 1, left: 0, right: 0,
          height: RG_H,
          backgroundColor: 'rgba(0,212,255,0.28)',
        }} />
        {divider(HOOD_H + FG_H + RF_H + RG_H)}

        {/* TRUNK / rear cap — clips naturally to RR corner radius */}
        <View style={{
          position: 'absolute',
          top: HOOD_H + FG_H + RF_H + RG_H + 1,
          left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,212,255,0.14)',
        }} />

      </View>

      {/* ── SIDE MIRRORS ──────────────────────────────────────────
          Positioned at A-pillar, swept outward away from body.
          Larger than before — Model 3 mirrors are quite prominent. */}
      {/* Left mirror */}
      <View style={{
        position: 'absolute',
        top: MIR_Y,
        left: BX - MIR_W + sw(2),
        width: MIR_W, height: MIR_H,
        backgroundColor: 'rgba(0,212,255,0.38)',
        borderTopLeftRadius: MIR_H / 2,
        borderBottomLeftRadius: s(2),
        borderTopRightRadius: s(2),
        borderBottomRightRadius: s(2),
      }} />
      {/* Right mirror */}
      <View style={{
        position: 'absolute',
        top: MIR_Y,
        left: BX + BODY_W - sw(2),
        width: MIR_W, height: MIR_H,
        backgroundColor: 'rgba(0,212,255,0.38)',
        borderTopRightRadius: MIR_H / 2,
        borderBottomRightRadius: s(2),
        borderTopLeftRadius: s(2),
        borderBottomLeftRadius: s(2),
      }} />

      {/* ── TIRES ─────────────────────────────────────────────── */}
      {(['fl', 'fr', 'rl', 'rr'] as const).map(key => {
        const isLeft  = key[1] === 'l';
        const isFront = key[0] === 'f';
        const psi     = tires[key];
        return (
          <View
            key={key}
            style={{
              position: 'absolute',
              top:   isFront ? TIRE_FY : TIRE_RY,
              left:  isLeft  ? 0 : undefined,
              right: isLeft  ? undefined : 0,
              width: TIRE_W, height: TIRE_H,
              backgroundColor: tireColor(psi),
              borderRadius: s(4),
              alignItems: 'center', justifyContent: 'center',
              opacity: psi === 0 ? 0.28 : 1,
            }}
          >
            <Text style={{
              fontFamily: FONTS.mono,
              fontSize: sf(9),
              color: tireTxtColor(psi),
              fontWeight: '700',
            }}>
              {psi > 0 ? psi : '--'}
            </Text>
          </View>
        );
      })}

      {/* ── TRUNK OPEN badge ──────────────────────────────────── */}
      {trunkOpen && (
        <View style={[styles.schOpenBadge, {
          position: 'absolute',
          bottom: 0,
          left: TOTAL_W / 2 - sw(22),
        }]}>
          <Text style={styles.schOpenText}>▼ TRUNK</Text>
        </View>
      )}

    </View>
  );
}

// ── Tooltip modal — shown when user taps a ? badge ────────────────────────
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
    <Modal
      transparent
      animationType="fade"
      visible={!!info}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <TouchableOpacity
        style={styles.modalBackdrop}
        onPress={onClose}
        activeOpacity={1}
      >
        <View style={styles.modalCard}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <View style={styles.helpBadgeLg}>
              <Text style={styles.helpBadgeLgText}>?</Text>
            </View>
            <Text style={styles.modalTitle}>{info.title}</Text>
          </View>

          {/* Divider */}
          <View style={[styles.techDivider, { marginVertical: s(8) }]} />

          {/* Description */}
          <Text style={styles.modalDesc}>{info.desc}</Text>

          {/* Dismiss */}
          <TouchableOpacity onPress={onClose} style={styles.modalDismiss}>
            <Text style={styles.modalDismissText}>DISMISS</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

// ── Power bar (Model 3-style acceleration / regen indicator) ───────────────
function PowerBar({ power, barWidth }: { power: number; barWidth?: number }) {
  const BAR_W = barWidth ?? sw(220);
  const BAR_H = sh(6);
  const pct = Math.min(1, Math.abs(power) / MAX_POWER_KW);
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
    right: sw(20),
    flexDirection: 'row',
    gap: s(10),
    alignItems: 'center',
  },
  modeBtnOuter: {
    alignItems: 'center',
    gap: s(3),
  },
  modeDot: {
    width: s(6),
    height: s(6),
    borderRadius: s(3),
    backgroundColor: C.muted,
  },
  modeDotActive: {
    backgroundColor: C.cyan,
  },
  modeLabel: {
    fontFamily: FONTS.mono,
    fontSize: sf(8),
    color: C.muted,
    letterSpacing: 1,
  },
  modeLabelActive: {
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
  },
  minimalCenter: {
    alignItems: 'center',
    marginBottom: sh(16),
  },
  minimalBottom: {
    alignItems: 'center',
    gap: s(8),
  },
  minimalBig: {
    fontFamily: FONTS.display,
    fontSize: sf(22),
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
    gap: sh(6),
  },
  techBody: {
    flexDirection: 'row',
    flex: 1,
    gap: sw(8),
  },
  techPanel: {
    flex: 1,
    overflow: 'hidden',
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
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCard: {
    backgroundColor: 'rgba(5,8,15,0.97)',
    borderWidth: 1,
    borderColor: C.cyan,
    padding: s(18),
    width: sw(300),
    borderRadius: s(4),
    gap: s(8),
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
  },
  modalTitle: {
    fontFamily: FONTS.display,
    fontSize: sf(13),
    color: C.cyan,
    letterSpacing: 1,
    flex: 1,
  },
  modalDesc: {
    fontFamily: FONTS.mono,
    fontSize: sf(11),
    color: C.dimWhite,
    lineHeight: sf(17),
  },
  modalDismiss: {
    alignSelf: 'flex-end',
    paddingTop: s(4),
  },
  modalDismissText: {
    fontFamily: FONTS.mono,
    fontSize: sf(9),
    color: C.muted,
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
