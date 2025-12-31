# Tutorial 2: Gasless Transactions in React Native

This tutorial covers implementing gasless SOL transfers using LazorKit and Kora paymaster. Users can send transactions without holding SOL for fees.

## Prerequisites

- Completed Tutorial 1 (passkey wallet setup)
- Connected wallet session
- Understanding of Solana transactions

## What You'll Build

A transfer screen where users can send SOL to any address without paying transaction fees themselves. The Kora paymaster sponsors the fees.

## How Gasless Works

Traditional Solana flow:
```
User → Pays fee in SOL → Transaction executes
```

Gasless flow with Kora:
```
User → Creates transaction → Paymaster pays fee → Transaction executes
```

The paymaster is a service that signs as the fee payer for your transaction. Users don't need any SOL to interact with the blockchain.

## Step 1: Understanding the API

LazorKit's `signAndSendTransaction` accepts:

```typescript
interface SignAndSendTransactionPayload {
  instructions: TransactionInstruction[];
  transactionOptions: {
    feeToken?: string;           // Token to pay fees (omit for gasless)
    clusterSimulation: 'devnet' | 'mainnet';
    computeUnitLimit?: number;
  };
}

interface SignOptions {
  redirectUrl: string;           // Callback URL for passkey signing
  onSuccess?: () => void;
  onFail?: (error: Error) => void;
}
```

## Step 2: Create the Transfer Screen

Create `src/screens/WalletScreen.tsx`:

```typescript
import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { useWallet } from '@lazorkit/wallet-mobile-adapter';
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as Linking from 'expo-linking';

export function WalletScreen() {
  const { smartWalletPubkey, signAndSendTransaction, isSigning } = useWallet();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [isSending, setIsSending] = useState(false);

  const handleSend = async () => {
    if (!smartWalletPubkey || !recipient || !amount) {
      Alert.alert('Missing fields', 'Enter recipient and amount');
      return;
    }

    setIsSending(true);
    try {
      // Validate recipient address
      const recipientPubkey = new PublicKey(recipient);
      const lamports = parseFloat(amount) * LAMPORTS_PER_SOL;

      // Create SOL transfer instruction
      const transferInstruction = SystemProgram.transfer({
        fromPubkey: smartWalletPubkey,
        toPubkey: recipientPubkey,
        lamports,
      });

      // Create callback URL for passkey signing
      const redirectUrl = Linking.createURL('sign-callback');

      // Send gasless transaction
      const signature = await signAndSendTransaction(
        {
          instructions: [transferInstruction],
          transactionOptions: {
            clusterSimulation: 'mainnet',
            // feeToken omitted = gasless (paymaster sponsors)
          },
        },
        {
          redirectUrl,
          onSuccess: () => {
            Alert.alert('Success', 'Transaction confirmed');
          },
          onFail: (error) => {
            Alert.alert('Failed', error.message);
          },
        }
      );

      console.log('Transaction signature:', signature);
      setRecipient('');
      setAmount('');
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Send SOL</Text>

      <View style={styles.badge}>
        <View style={styles.dot} />
        <Text style={styles.badgeText}>Gasless mode</Text>
      </View>

      <Text style={styles.label}>To</Text>
      <TextInput
        style={styles.input}
        placeholder="Recipient address"
        value={recipient}
        onChangeText={setRecipient}
        autoCapitalize="none"
      />

      <Text style={styles.label}>Amount (SOL)</Text>
      <TextInput
        style={styles.input}
        placeholder="0.00"
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
      />

      <TouchableOpacity
        style={styles.button}
        onPress={handleSend}
        disabled={isSending || isSigning}
      >
        {isSending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Send</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 24,
    marginTop: 60,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 24,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22c55e',
    marginRight: 8,
  },
  badgeText: {
    fontSize: 14,
    color: '#333',
  },
  label: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    padding: 16,
    fontSize: 16,
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#000',
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
```

## Step 3: Transaction Flow

When user taps "Send":

1. **Build instruction**: Create a `SystemProgram.transfer` instruction
2. **Create payload**: Package instructions with transaction options
3. **Request signature**: Opens LazorKit portal for passkey signing
4. **User authenticates**: Biometric prompt appears
5. **Paymaster processes**: Kora wraps transaction and pays fees
6. **Broadcast**: Signed transaction is sent to Solana
7. **Confirmation**: App receives success callback

## Paying Fees in USDC (Optional)

If you want users to pay fees in USDC instead of gasless:

```typescript
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const signature = await signAndSendTransaction(
  {
    instructions: [transferInstruction],
    transactionOptions: {
      clusterSimulation: 'mainnet',
      feeToken: USDC_MINT,  // User pays in USDC
    },
  },
  { redirectUrl }
);
```

## Multiple Instructions

You can batch multiple instructions in one gasless transaction:

```typescript
const instructions = [
  // Transfer SOL
  SystemProgram.transfer({
    fromPubkey: smartWalletPubkey,
    toPubkey: recipient1,
    lamports: amount1,
  }),
  // Another transfer
  SystemProgram.transfer({
    fromPubkey: smartWalletPubkey,
    toPubkey: recipient2,
    lamports: amount2,
  }),
];

await signAndSendTransaction(
  { instructions, transactionOptions: { clusterSimulation: 'mainnet' } },
  { redirectUrl }
);
```

## Error Handling

Common errors and solutions:

| Error | Cause | Solution |
|-------|-------|----------|
| "Insufficient funds" | Wallet has no SOL to transfer | Fund the wallet first |
| "Invalid address" | Malformed recipient address | Validate with `new PublicKey()` |
| "Paymaster error" | Paymaster rate limit or unavailable | Retry or check Kora status |
| "Signing cancelled" | User cancelled biometric prompt | Show retry option |

## Testing on Devnet

1. Get devnet SOL from faucet: https://faucet.solana.com
2. Use devnet RPC: `https://api.devnet.solana.com`
3. Set `clusterSimulation: 'devnet'` in transaction options

## Best Practices

1. **Always validate addresses** before creating transactions
2. **Show loading states** during signing and confirmation
3. **Handle deep link callbacks** properly for reliability
4. **Use appropriate compute limits** for complex transactions

## Next Steps

- Add token transfers (SPL tokens)
- Implement transaction history
- Add address book functionality
