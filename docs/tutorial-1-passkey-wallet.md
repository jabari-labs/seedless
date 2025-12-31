# Tutorial 1: Creating a Passkey Wallet in React Native

This tutorial walks through implementing passkey-based wallet authentication using LazorKit SDK in a React Native (Expo) application.

## Prerequisites

- Node.js 20+
- Expo CLI
- Basic React Native knowledge
- iOS Simulator or Android Emulator (passkeys require native environment)

## What You'll Build

A mobile app where users can create and access a Solana smart wallet using only their device's biometrics (FaceID, TouchID, or fingerprint). No seed phrases, no wallet extensions.

## Step 1: Project Setup

Create a new Expo project with TypeScript:

```bash
npx create-expo-app@latest my-lazor-app --template blank-typescript
cd my-lazor-app
```

## Step 2: Install Dependencies

Install LazorKit and required packages:

```bash
npm install @lazorkit/wallet-mobile-adapter @coral-xyz/anchor @solana/web3.js
npm install react-native-get-random-values react-native-url-polyfill buffer
npx expo install expo-crypto expo-web-browser expo-linking
```

## Step 3: Configure Polyfills

React Native doesn't include Node.js globals that Solana libraries need. Add polyfills at the top of your entry file (`index.ts`):

```typescript
// index.ts - MUST be at the very top
import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';
import { Buffer } from 'buffer';
global.Buffer = global.Buffer || Buffer;

import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
```

**Why polyfills?** React Native is neither Node.js nor a browser. Solana's `@solana/web3.js` expects `Buffer`, `crypto.getRandomValues()`, and `URL` APIs that React Native doesn't provide by default.

## Step 4: Configure Deep Linking

Update `app.json` to add a URL scheme for passkey callbacks:

```json
{
  "expo": {
    "scheme": "myapp",
    "ios": {
      "bundleIdentifier": "com.myapp.wallet"
    },
    "android": {
      "package": "com.myapp.wallet"
    },
    "plugins": [
      "expo-web-browser",
      "expo-linking"
    ]
  }
}
```

## Step 5: Create the Provider

Create `src/providers/LazorProvider.tsx`:

```typescript
import React from 'react';
import { LazorKitProvider } from '@lazorkit/wallet-mobile-adapter';

interface LazorProviderProps {
  children: React.JSX.Element | React.JSX.Element[];
}

export function LazorProvider({ children }: LazorProviderProps) {
  return (
    <LazorKitProvider
      rpcUrl="https://api.devnet.solana.com"
      portalUrl="https://portal.lazor.sh"
      configPaymaster={{
        paymasterUrl: "https://kora.devnet.lazorkit.com",
      }}
    >
      {children}
    </LazorKitProvider>
  );
}
```

**Configuration explained:**
- `rpcUrl`: Solana RPC endpoint
- `portalUrl`: LazorKit portal for passkey operations
- `configPaymaster`: Kora paymaster for gasless transactions

## Step 6: Build the Connect Screen

Create `src/screens/HomeScreen.tsx`:

```typescript
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useWallet } from '@lazorkit/wallet-mobile-adapter';
import * as Linking from 'expo-linking';

interface HomeScreenProps {
  onConnected: () => void;
}

export function HomeScreen({ onConnected }: HomeScreenProps) {
  const { connect, isConnecting } = useWallet();

  const handleConnect = async () => {
    try {
      // Create callback URL for passkey flow
      const redirectUrl = Linking.createURL('callback');

      await connect({
        redirectUrl,
        onSuccess: () => {
          onConnected();
        },
        onFail: (error) => {
          Alert.alert('Connection Failed', error.message);
        },
      });
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>My Wallet</Text>

      <TouchableOpacity
        style={styles.button}
        onPress={handleConnect}
        disabled={isConnecting}
      >
        {isConnecting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Connect with Passkey</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 48,
  },
  button: {
    backgroundColor: '#000',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
```

## Step 7: Wire Up the App

Update `App.tsx`:

```typescript
import React, { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { LazorProvider } from './src/providers/LazorProvider';
import { HomeScreen } from './src/screens/HomeScreen';

export default function App() {
  const [isConnected, setIsConnected] = useState(false);

  return (
    <LazorProvider>
      <StatusBar style="dark" />
      {isConnected ? (
        <Text>Connected!</Text>
      ) : (
        <HomeScreen onConnected={() => setIsConnected(true)} />
      )}
    </LazorProvider>
  );
}
```

## How the Passkey Flow Works

1. User taps "Connect with Passkey"
2. App opens LazorKit portal in browser
3. User authenticates with biometrics (FaceID/TouchID)
4. Portal creates or retrieves smart wallet PDA
5. App receives callback with wallet session
6. User is connected without ever seeing a seed phrase

## Key Concepts

**Smart Wallet**: A Program Derived Address (PDA) controlled by your passkey. It's not a traditional keypair wallet.

**Passkey**: WebAuthn credential stored in your device's Secure Enclave. The private key never leaves the device.

**Session**: After connecting, LazorKit maintains a session so users don't need to re-authenticate for every action.

## Testing

```bash
npx expo start
```

Use the Expo Go app or build a development client. Note that passkeys require a native environment - they won't work in web mode.

## Next Steps

See Tutorial 2 for implementing gasless transactions with the connected wallet.
