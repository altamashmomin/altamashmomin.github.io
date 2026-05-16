import { Dimensions } from 'react-native';

// Baseline: iPhone 14 in landscape (844 × 390 pts)
const BASE_WIDTH = 844;
const BASE_HEIGHT = 390;

const { width: rawW, height: rawH } = Dimensions.get('window');

// Always treat the larger dimension as width (landscape)
export const W = Math.max(rawW, rawH);
export const H = Math.min(rawW, rawH);

const scaleW = W / BASE_WIDTH;
const scaleH = H / BASE_HEIGHT;
const scaleUniform = Math.min(scaleW, scaleH);

/** Scale a font size */
export const sf = (size: number): number => Math.round(size * scaleUniform);

/** Scale a horizontal measurement */
export const sw = (size: number): number => Math.round(size * scaleW);

/** Scale a vertical measurement */
export const sh = (size: number): number => Math.round(size * scaleH);

/** Scale a general gap / padding */
export const s = (size: number): number => Math.round(size * scaleUniform);

/** Hook that exposes all helpers plus screen dimensions */
export const useResponsive = () => ({
  sf,
  sw,
  sh,
  s,
  W,
  H,
  scaleW,
  scaleH,
  scaleUniform,
});
