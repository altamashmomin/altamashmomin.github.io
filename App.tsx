/**
 * TeslaHUD — entry point
 */

import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ARScreen from './src/screens/ARScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <ARScreen />
    </SafeAreaProvider>
  );
}
