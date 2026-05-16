// BACKUP — original HUDOverlay.tsx before dimension debug session
// All lines commented out for reference. Active file: HUDOverlay.tsx
//
// /**
//  * HUDOverlay.tsx
//  * Three switchable HUD modes rendered over the AR camera feed.
//  *
//  * Modes:
//  *   minimal — speed, battery %, range
//  *   drive   — speed, power, efficiency, motor %, temps, regen, battery bar
//  *   tech    — everything + power gauge, 30-sample efficiency chart, tire PSI, odometer
//  */
//
// import React, { useEffect, useRef, useState } from 'react';
// import {
//   StyleSheet,
//   Text,
//   TouchableOpacity,
//   View,
// } from 'react-native';
// import { useSafeAreaInsets } from 'react-native-safe-area-context';
//
// import type { TeslaVehicleData } from '../services/TeslaAPI';
// import { s, sf, sh, sw, W, H } from '../utils/responsive';
//
// // ---------------------------------------------------------------------------
// // Design tokens
// // ---------------------------------------------------------------------------
// const C = {
//   bg:       'rgba(5, 8, 15, 0.60)',
//   panel:    'rgba(5, 8, 15, 0.72)',
//   border:   'rgba(0, 212, 255, 0.18)',
//   cyan:     '#00d4ff',
//   amber:    '#ff9d00',
//   green:    '#00ff88',
//   red:      '#ff3b30',
//   muted:    '#2e4a64',
//   white:    '#ffffff',
//   dimWhite: 'rgba(255,255,255,0.75)',
// };
//
// const FONTS = {
//   display: 'Orbitron-Bold',
//   displayBlack: 'Orbitron-Black',
//   mono: 'ShareTechMono-Regular',
// };
//
// type HUDMode = 'minimal' | 'drive' | 'tech';
// const MODES: HUDMode[] = ['minimal', 'drive', 'tech'];
// const CHART_SAMPLES = 30;
// const MAX_CHART_WH = 500; // Wh/mi ceiling for bar chart normalisation
// const MAX_POWER_KW = 450;
//
// // ---------------------------------------------------------------------------
// // Props
// // ---------------------------------------------------------------------------
// interface Props {
//   data: TeslaVehicleData | null;
// }
//
// // ---------------------------------------------------------------------------
// // Root component
// // ---------------------------------------------------------------------------
// export default function HUDOverlay({ data }: Props) {
//   const insets = useSafeAreaInsets();
//   const [mode, setMode] = useState<HUDMode>('minimal');
//   const [livePulse, setLivePulse] = useState(true);
//
//   // Rolling 30-sample efficiency history for the Tech chart
//   const [chartSamples, setChartSamples] = useState<number[]>(
//     Array(CHART_SAMPLES).fill(0),
//   );
//
//   // Blink the live indicator every 800 ms
//   useEffect(() => {
//     const t = setInterval(() => setLivePulse(v => !v), 800);
//     return () => clearInterval(t);
//   }, []);
//
//   // Append new efficiency sample whenever data updates
//   useEffect(() => {
//     if (!data) return;
//     setChartSamples(prev => [...prev.slice(1), Math.abs(data.efficiency)]);
//   }, [data]);
//
//   // Derived display values (safe defaults when data is null)
//   const speed       = data?.speed        ?? 0;
//   const battery     = data?.batteryLevel ?? 0;
//   const range       = data?.batteryRange ?? 0;
//   const power       = data?.power        ?? 0;
//   const efficiency  = data?.efficiency   ?? 0;
//   const outsideTemp = data?.outsideTemp  ?? 0;
//   const cabinTemp   = data?.cabinTemp    ?? 0;
//   const isRegen     = data?.isRegen      ?? false;
//   const motorPct    = data?.motorPct     ?? 0;
//   const odometer    = data?.odometer     ?? 0;
//   const tires       = data?.tirePressures ?? { fl: 0, fr: 0, rl: 0, rr: 0 };
//   const battColor   = battery < 20 ? C.red : C.green;
//
//   console.log('[HUDOverlay] insets:', JSON.stringify(insets), 'W:', W, 'H:', H);
//
//   return (
//     <View
//       style={[
//         styles.root,
//         {
//           paddingLeft:   Math.max(insets.left,  sw(16)),
//           paddingRight:  Math.max(insets.right, sw(16)),
//           paddingTop:    Math.max(insets.top,   sh(10)),
//           paddingBottom: Math.max(insets.bottom, sh(10)),
//         },
//       ]}
//     >
//       {/* ── Live indicator ─────────────────────────────────── */}
//       <View style={[styles.liveRow, {
//         top:  Math.max(insets.top  + sh(8),  sh(14)),
//         left: Math.max(insets.left + sw(10), sw(20)),
//       }]}>
//         <View style={[styles.liveDot, { opacity: livePulse && !!data ? 1 : 0 }]} />
//         <Text style={styles.liveLabel}>LIVE</Text>
//       </View>
//
//       {/* ── Mode switcher ──────────────────────────────────── */}
//       <View style={[styles.modeSwitcher, {
//         bottom: Math.max(insets.bottom + sh(8),  sh(18)),
//         right:  Math.max(insets.right  + sw(10), sw(20)),
//       }]}>
//         {MODES.map(m => (
//           <TouchableOpacity
//             key={m}
//             hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
//             onPress={() => setMode(m)}
//             style={styles.modeBtnOuter}
//           >
//             <View style={[styles.modeDot, mode === m && styles.modeDotActive]} />
//             <Text style={[styles.modeLabel, mode === m && styles.modeLabelActive]}>
//               {m.toUpperCase()}
//             </Text>
//           </TouchableOpacity>
//         ))}
//       </View>
//
//       {/* ── Mode views ─────────────────────────────────────── */}
//       {mode === 'minimal' && (
//         <MinimalMode
//           speed={speed}
//           battery={battery}
//           range={range}
//           battColor={battColor}
//         />
//       )}
//
//       {mode === 'drive' && (
//         <DriveMode
//           speed={speed}
//           power={power}
//           efficiency={efficiency}
//           motorPct={motorPct}
//           outsideTemp={outsideTemp}
//           cabinTemp={cabinTemp}
//           isRegen={isRegen}
//           battery={battery}
//           battColor={battColor}
//         />
//       )}
//
//       {mode === 'tech' && (
//         <TechMode
//           speed={speed}
//           power={power}
//           battery={battery}
//           battColor={battColor}
//           odometer={odometer}
//           tires={tires}
//           chartSamples={chartSamples}
//           motorPct={motorPct}
//         />
//       )}
//     </View>
//   );
// }
//
// // ===========================================================================
// // MINIMAL MODE
// // ===========================================================================
// interface MinimalProps {
//   speed: number;
//   battery: number;
//   range: number;
//   battColor: string;
// }
//
// function MinimalMode({ speed, battery, range, battColor }: MinimalProps) {
//   return (
//     <View style={styles.minimalRoot}>
//       {/* Big speed */}
//       <View style={styles.minimalCenter}>
//         <Text style={styles.speedBig}>{Math.round(speed)}</Text>
//         <Text style={styles.speedUnit}>MPH</Text>
//       </View>
//
//       {/* Battery + range strip */}
//       <View style={styles.minimalBottom}>
//         <View style={styles.row}>
//           <Text style={[styles.minimalBig, { color: battColor }]}>
//             {battery}
//             <Text style={styles.minimalUnit}>%</Text>
//           </Text>
//           <BatteryBar pct={battery} color={battColor} width={sw(180)} />
//           <Text style={[styles.minimalBig, { color: C.cyan }]}>
//             {Math.round(range)}
//             <Text style={styles.minimalUnit}> mi</Text>
//           </Text>
//         </View>
//       </View>
//     </View>
//   );
// }
//
// // ===========================================================================
// // DRIVE MODE
// // ===========================================================================
// interface DriveProps {
//   speed: number;
//   power: number;
//   efficiency: number;
//   motorPct: number;
//   outsideTemp: number;
//   cabinTemp: number;
//   isRegen: boolean;
//   battery: number;
//   battColor: string;
// }
//
// function DriveMode({
//   speed, power, efficiency, motorPct,
//   outsideTemp, cabinTemp, isRegen,
//   battery, battColor,
// }: DriveProps) {
//   const powerColor = isRegen ? C.green : power > 200 ? C.amber : C.cyan;
//
//   return (
//     <View style={styles.driveRoot}>
//       {/* Top row: left stats | speed | right stats */}
//       <View style={styles.driveTop}>
//
//         {/* LEFT: power / efficiency / motor */}
//         <Panel style={styles.driveSidePanel}>
//           <DataRow label="POWER"  value={`${Math.abs(Math.round(power))} kW`} valueColor={powerColor} />
//           <DataRow label="EFFIC"  value={`${efficiency} Wh/mi`} />
//           <DataRow label="MOTOR"  value={`${motorPct}%`} />
//           {isRegen && <Text style={styles.regenTag}>↓ REGEN</Text>}
//         </Panel>
//
//         {/* CENTER: speed */}
//         <View style={styles.driveCenterBlock}>
//           <Text style={styles.speedMed}>{Math.round(speed)}</Text>
//           <Text style={styles.speedUnitSm}>MPH</Text>
//         </View>
//
//         {/* RIGHT: temps */}
//         <Panel style={styles.driveSidePanel}>
//           <DataRow label="OUT"   value={`${outsideTemp}°F`} valueColor={C.amber} />
//           <DataRow label="CAB"   value={`${cabinTemp}°F`}   valueColor={C.amber} />
//         </Panel>
//
//       </View>
//
//       {/* Battery bar */}
//       <View style={styles.driveBattRow}>
//         <Text style={[styles.label, { color: battColor, width: sw(40) }]}>
//           {battery}%
//         </Text>
//         <BatteryBar pct={battery} color={battColor} width={sw(600)} height={sh(8)} />
//         <Text style={[styles.label, { color: C.muted, width: sw(60), textAlign: 'right' }]}>
//           BATT
//         </Text>
//       </View>
//     </View>
//   );
// }
//
// // ===========================================================================
// // TECH MODE
// // ===========================================================================
// interface TechProps {
//   speed: number;
//   power: number;
//   battery: number;
//   battColor: string;
//   odometer: number;
//   tires: { fl: number; fr: number; rl: number; rr: number };
//   chartSamples: number[];
//   motorPct: number;
// }
//
// function TechMode({
//   speed, power, battery, battColor,
//   odometer, tires, chartSamples, motorPct,
// }: TechProps) {
//   return (
//     <View style={styles.techRoot}>
//
//       {/* Top row: gauge | speed | tires */}
//       <View style={styles.techTop}>
//
//         {/* Power arc gauge */}
//         <Panel style={styles.techSidePanel}>
//           <Text style={styles.label}>POWER</Text>
//           <PowerGauge pct={motorPct} power={power} />
//           <Text style={[styles.value, { textAlign: 'center' }]}>
//             {Math.abs(Math.round(power))} kW
//           </Text>
//         </Panel>
//
//         {/* CENTER: speed */}
//         <View style={styles.techCenter}>
//           <Text style={styles.speedMed}>{Math.round(speed)}</Text>
//           <Text style={styles.speedUnitSm}>MPH</Text>
//         </View>
//
//         {/* Tire pressures */}
//         <Panel style={styles.techSidePanel}>
//           <Text style={styles.label}>TIRES PSI</Text>
//           <View style={styles.tireGrid}>
//             <View style={styles.tireRow}>
//               <TireCell label="FL" psi={tires.fl} />
//               <TireCell label="FR" psi={tires.fr} />
//             </View>
//             <View style={styles.tireRow}>
//               <TireCell label="RL" psi={tires.rl} />
//               <TireCell label="RR" psi={tires.rr} />
//             </View>
//           </View>
//         </Panel>
//
//       </View>
//
//       {/* Energy efficiency bar chart */}
//       <View style={styles.chartSection}>
//         <Text style={[styles.label, { marginBottom: sh(4) }]}>
//           EFFICIENCY  <Text style={{ color: C.muted }}>Wh/mi · 30 samples</Text>
//         </Text>
//         <EfficiencyChart samples={chartSamples} />
//       </View>
//
//       {/* Bottom: battery bar + odometer */}
//       <View style={styles.techBottom}>
//         <Text style={[styles.label, { color: battColor, width: sw(44) }]}>
//           {battery}%
//         </Text>
//         <BatteryBar pct={battery} color={battColor} width={sw(480)} height={sh(7)} />
//         <Text style={[styles.label, { color: C.muted, marginLeft: sw(16) }]}>
//           ODO {odometer.toLocaleString()} mi
//         </Text>
//       </View>
//
//     </View>
//   );
// }
//
// // ===========================================================================
// // SHARED SUB-COMPONENTS
// // ===========================================================================
//
// // ── Panel wrapper ──────────────────────────────────────────────────────────
// function Panel({ children, style }: { children: React.ReactNode; style?: object }) {
//   return <View style={[styles.panel, style]}>{children}</View>;
// }
//
// // ── Label + value row ──────────────────────────────────────────────────────
// function DataRow({
//   label,
//   value,
//   valueColor = C.dimWhite,
// }: {
//   label: string;
//   value: string;
//   valueColor?: string;
// }) {
//   return (
//     <View style={styles.dataRow}>
//       <Text style={styles.label}>{label}</Text>
//       <Text style={[styles.value, { color: valueColor }]}>{value}</Text>
//     </View>
//   );
// }
//
// // ── Battery bar ────────────────────────────────────────────────────────────
// function BatteryBar({
//   pct,
//   color,
//   width = sw(200),
//   height = sh(6),
// }: {
//   pct: number;
//   color: string;
//   width?: number;
//   height?: number;
// }) {
//   return (
//     <View style={[styles.battTrack, { width, height }]}>
//       <View
//         style={[
//           styles.battFill,
//           { width: `${Math.min(100, pct)}%` as any, backgroundColor: color, height },
//         ]}
//       />
//     </View>
//   );
// }
//
// // ── Power gauge (segmented bar arc illusion via stacked segments) ──────────
// function PowerGauge({ pct, power }: { pct: number; power: number }) {
//   const SEGMENTS = 16;
//   const filled = Math.round((pct / 100) * SEGMENTS);
//   const isRegen = power < 0;
//   const fillColor = isRegen ? C.green : pct > 70 ? C.amber : C.cyan;
//
//   return (
//     <View style={styles.gaugeRow}>
//       {Array.from({ length: SEGMENTS }).map((_, i) => {
//         const active = i < filled;
//         return (
//           <View
//             key={i}
//             style={[
//               styles.gaugeSegment,
//               {
//                 backgroundColor: active ? fillColor : C.muted,
//                 opacity: active ? 1 : 0.25,
//                 height: sh(4 + Math.round(Math.sin(((i + 0.5) / SEGMENTS) * Math.PI) * 10)),
//               },
//             ]}
//           />
//         );
//       })}
//     </View>
//   );
// }
//
// // ── Tire cell ──────────────────────────────────────────────────────────────
// function TireCell({ label, psi }: { label: string; psi: number }) {
//   const ok = psi >= 32 && psi <= 38;
//   const color = psi === 0 ? C.muted : ok ? C.white : C.amber;
//   return (
//     <View style={styles.tireCell}>
//       <Text style={[styles.tireLabel]}>{label}</Text>
//       <Text style={[styles.tireValue, { color }]}>{psi || '--'}</Text>
//     </View>
//   );
// }
//
// // ── 30-sample efficiency chart ─────────────────────────────────────────────
// function EfficiencyChart({ samples }: { samples: number[] }) {
//   const max = Math.max(...samples, MAX_CHART_WH);
//   const barWidth = sw(580) / CHART_SAMPLES - 2;
//
//   return (
//     <View style={styles.chart}>
//       {samples.map((val, i) => {
//         const fillPct = val / max;
//         const isLast = i === samples.length - 1;
//         return (
//           <View
//             key={i}
//             style={[styles.chartBar, { width: barWidth }]}
//           >
//             <View
//               style={{
//                 width: barWidth,
//                 height: sh(40) * fillPct,
//                 backgroundColor: isLast ? C.cyan : C.muted,
//                 opacity: isLast ? 1 : 0.5 + 0.5 * (i / CHART_SAMPLES),
//                 alignSelf: 'flex-end',
//               }}
//             />
//           </View>
//         );
//       })}
//     </View>
//   );
// }
//
// // ===========================================================================
// // STYLES
// // ===========================================================================
// const styles = StyleSheet.create({
//   // ── Root ──────────────────────────────────────────────────────────────────
//   root: {
//     ...StyleSheet.absoluteFillObject,
//   },
//
//   // ── Live indicator ────────────────────────────────────────────────────────
//   liveRow: {
//     position: 'absolute',
//     top: sh(14),
//     left: sw(20),
//     flexDirection: 'row',
//     alignItems: 'center',
//     gap: s(5),
//   },
//   liveDot: {
//     width: s(7),
//     height: s(7),
//     borderRadius: s(4),
//     backgroundColor: C.green,
//   },
//   liveLabel: {
//     fontFamily: FONTS.mono,
//     fontSize: sf(10),
//     color: C.muted,
//     letterSpacing: 2,
//   },
//
//   // ── Mode switcher ─────────────────────────────────────────────────────────
//   modeSwitcher: {
//     position: 'absolute',
//     bottom: sh(18),
//     right: sw(20),
//     flexDirection: 'row',
//     gap: s(10),
//     alignItems: 'center',
//   },
//   modeBtnOuter: {
//     alignItems: 'center',
//     gap: s(3),
//   },
//   modeDot: {
//     width: s(6),
//     height: s(6),
//     borderRadius: s(3),
//     backgroundColor: C.muted,
//   },
//   modeDotActive: {
//     backgroundColor: C.cyan,
//   },
//   modeLabel: {
//     fontFamily: FONTS.mono,
//     fontSize: sf(8),
//     color: C.muted,
//     letterSpacing: 1,
//   },
//   modeLabelActive: {
//     color: C.cyan,
//   },
//
//   // ── Panel ─────────────────────────────────────────────────────────────────
//   panel: {
//     backgroundColor: C.panel,
//     borderWidth: 1,
//     borderColor: C.border,
//     padding: s(10),
//     gap: s(6),
//   },
//
//   // ── Shared text ───────────────────────────────────────────────────────────
//   label: {
//     fontFamily: FONTS.mono,
//     fontSize: sf(10),
//     color: C.muted,
//     letterSpacing: 1,
//     textTransform: 'uppercase',
//   },
//   value: {
//     fontFamily: FONTS.mono,
//     fontSize: sf(13),
//     color: C.dimWhite,
//   },
//   dataRow: {
//     flexDirection: 'row',
//     justifyContent: 'space-between',
//     alignItems: 'center',
//     gap: s(8),
//   },
//   regenTag: {
//     fontFamily: FONTS.mono,
//     fontSize: sf(10),
//     color: C.green,
//     marginTop: s(4),
//     textAlign: 'center',
//   },
//
//   // ── Speed variants ────────────────────────────────────────────────────────
//   speedBig: {
//     fontFamily: FONTS.displayBlack,
//     fontSize: sf(110),
//     color: C.white,
//     lineHeight: sf(110),
//     includeFontPadding: false,
//   },
//   speedUnit: {
//     fontFamily: FONTS.mono,
//     fontSize: sf(18),
//     color: C.muted,
//     letterSpacing: 4,
//     marginTop: sh(-6),
//   },
//   speedMed: {
//     fontFamily: FONTS.displayBlack,
//     fontSize: sf(72),
//     color: C.white,
//     lineHeight: sf(72),
//     includeFontPadding: false,
//   },
//   speedUnitSm: {
//     fontFamily: FONTS.mono,
//     fontSize: sf(13),
//     color: C.muted,
//     letterSpacing: 3,
//     marginTop: sh(-4),
//   },
//
//   // ── Battery bar ───────────────────────────────────────────────────────────
//   battTrack: {
//     backgroundColor: C.muted,
//     overflow: 'hidden',
//     opacity: 0.85,
//   },
//   battFill: {
//     position: 'absolute',
//     left: 0,
//     top: 0,
//     bottom: 0,
//   },
//
//   // ── Gauge ─────────────────────────────────────────────────────────────────
//   gaugeRow: {
//     flexDirection: 'row',
//     alignItems: 'flex-end',
//     gap: s(3),
//     paddingVertical: sh(6),
//   },
//   gaugeSegment: {
//     flex: 1,
//     borderRadius: s(1),
//   },
//
//   // ── Tire grid ─────────────────────────────────────────────────────────────
//   tireGrid: {
//     gap: s(6),
//   },
//   tireRow: {
//     flexDirection: 'row',
//     gap: s(10),
//   },
//   tireCell: {
//     flex: 1,
//     alignItems: 'center',
//     gap: s(2),
//   },
//   tireLabel: {
//     fontFamily: FONTS.mono,
//     fontSize: sf(9),
//     color: C.muted,
//     letterSpacing: 1,
//   },
//   tireValue: {
//     fontFamily: FONTS.display,
//     fontSize: sf(16),
//   },
//
//   // ── Chart ─────────────────────────────────────────────────────────────────
//   chart: {
//     flexDirection: 'row',
//     alignItems: 'flex-end',
//     height: sh(40),
//     gap: 2,
//     overflow: 'hidden',
//   },
//   chartBar: {
//     justifyContent: 'flex-end',
//   },
//
//   // ── Minimal mode ──────────────────────────────────────────────────────────
//   minimalRoot: {
//     flex: 1,
//     justifyContent: 'center',
//     alignItems: 'center',
//     backgroundColor: 'rgba(255, 0, 0, 0.25)',
//   },
//   minimalCenter: {
//     alignItems: 'center',
//     marginBottom: sh(16),
//     backgroundColor: 'rgba(0, 0, 255, 0.25)',
//   },
//   minimalBottom: {
//     alignItems: 'center',
//     gap: s(8),
//   },
//   minimalBig: {
//     fontFamily: FONTS.display,
//     fontSize: sf(22),
//     color: C.white,
//   },
//   minimalUnit: {
//     fontFamily: FONTS.mono,
//     fontSize: sf(13),
//     color: C.muted,
//   },
//   row: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     gap: s(14),
//   },
//
//   // ── Drive mode ────────────────────────────────────────────────────────────
//   driveRoot: {
//     flex: 1,
//     justifyContent: 'center',
//     paddingHorizontal: sw(8),
//     gap: sh(10),
//   },
//   driveTop: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     justifyContent: 'space-between',
//     gap: sw(10),
//   },
//   driveSidePanel: {
//     width: sw(170),
//   },
//   driveCenterBlock: {
//     alignItems: 'center',
//     flex: 1,
//   },
//   driveBattRow: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     gap: s(10),
//     paddingHorizontal: sw(4),
//   },
//
//   // ── Tech mode ─────────────────────────────────────────────────────────────
//   techRoot: {
//     flex: 1,
//     justifyContent: 'center',
//     paddingHorizontal: sw(8),
//     gap: sh(8),
//   },
//   techTop: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     justifyContent: 'space-between',
//     gap: sw(10),
//   },
//   techSidePanel: {
//     width: sw(160),
//   },
//   techCenter: {
//     alignItems: 'center',
//     flex: 1,
//   },
//   chartSection: {
//     paddingHorizontal: sw(4),
//   },
//   techBottom: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     gap: s(10),
//     paddingHorizontal: sw(4),
//   },
// });
