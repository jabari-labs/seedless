# Tutorial 4: Privacy Features

This tutorial covers implementing privacy-preserving payment flows using stealth addresses and burner wallets. Users can receive payments and transact without linking to their main wallet.

## Prerequisites

- Completed Tutorial 1 (passkey wallet setup)
- Connected wallet session
- Understanding of Solana keypairs

## What You'll Build

Two privacy features:

1. **Stealth Addresses** - Generate one-time receiving addresses with QR codes for payment requests
2. **Burner Wallets** - Create disposable identities for isolated transactions

## Install Dependencies

```bash
npx expo install expo-secure-store expo-crypto react-native-svg
npm install react-native-qrcode-svg
```

---

# Part 1: Stealth Addresses

## How Stealth Addresses Work

Traditional receiving flow:
```
Sender → Your main wallet address → Everyone sees you received funds
```

Stealth address flow:
```
Sender → One-time stealth address → Later sweep to main wallet
```

Each stealth address is derived deterministically from a master seed, so you can always regenerate the keypair to access funds.

## Step 1: Create Stealth Utilities

Create `src/utils/stealth.ts`:

```typescript
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { Keypair } from '@solana/web3.js';

const MASTER_SEED_KEY = 'lazor_stealth_master_seed';
const STEALTH_INDEX_KEY = 'lazor_stealth_index';

export async function getOrCreateMasterSeed(): Promise<string> {
  let seed = await SecureStore.getItemAsync(MASTER_SEED_KEY);

  if (!seed) {
    const randomBytes = await Crypto.getRandomBytesAsync(32);
    seed = Buffer.from(randomBytes).toString('hex');

    await SecureStore.setItemAsync(MASTER_SEED_KEY, seed, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }

  return seed;
}
```

## Step 2: Derive Stealth Keypairs

```typescript
export async function deriveStealthKeypairForIndex(
  masterSeed: string,
  index: number
): Promise<Keypair> {
  const seedBuffer = Buffer.from(masterSeed, 'hex');

  const input = Buffer.concat([
    seedBuffer,
    Buffer.from('stealth'),
    Buffer.from(index.toString()),
  ]);
  const hash = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, input);

  return Keypair.fromSeed(new Uint8Array(hash));
}
```

**Why deterministic?** You can always regenerate any address from `master seed + index`. No need to backup individual keys.

## Step 3: Generate New Address

```typescript
export interface StealthAddress {
  index: number;
  address: string;
  createdAt: number;
  label?: string;
}

export async function generateStealthAddress(label?: string): Promise<StealthAddress> {
  const masterSeed = await getOrCreateMasterSeed();

  const indexStr = await SecureStore.getItemAsync(STEALTH_INDEX_KEY);
  const index = indexStr ? parseInt(indexStr, 10) : 0;

  await SecureStore.setItemAsync(STEALTH_INDEX_KEY, (index + 1).toString());

  const keypair = await deriveStealthKeypairForIndex(masterSeed, index);

  return {
    index,
    address: keypair.publicKey.toBase58(),
    createdAt: Date.now(),
    label,
  };
}
```

## Step 4: Create Solana Pay URLs

Create `src/utils/paymentRequest.ts`:

```typescript
import { PublicKey } from '@solana/web3.js';

export interface PaymentRequestConfig {
  recipient: string;
  amount?: number;
  token?: 'SOL' | 'USDC';
  label?: string;
}

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export function createSolanaPayUrl(config: PaymentRequestConfig): string {
  const { recipient, amount, token, label } = config;

  let url = `solana:${recipient}`;
  const params: string[] = [];

  if (amount && amount > 0) {
    params.push(`amount=${amount}`);
  }

  if (token === 'USDC') {
    params.push(`spl-token=${USDC_MINT}`);
  }

  if (label) {
    params.push(`label=${encodeURIComponent(label)}`);
  }

  if (params.length > 0) {
    url += '?' + params.join('&');
  }

  return url;
}
```

## Step 5: Display QR Code

```typescript
import QRCode from 'react-native-qrcode-svg';
import { View, Text } from 'react-native';

function PaymentQRCode({ stealthAddress, amount }: { stealthAddress: string; amount?: number }) {
  const url = createSolanaPayUrl({
    recipient: stealthAddress,
    amount,
    label: 'Lazor Wallet',
  });

  return (
    <View style={{ padding: 20, backgroundColor: '#fff', alignItems: 'center' }}>
      <QRCode value={url} size={200} />
      <Text style={{ marginTop: 12, color: '#666' }}>Scan with Solana Pay wallet</Text>
    </View>
  );
}
```

## Step 6: Sweep Funds to Main Wallet

```typescript
import { Connection, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';

async function sweepToMainWallet(
  stealthAddress: StealthAddress,
  mainWalletPubkey: PublicKey,
  connection: Connection
): Promise<string> {
  const keypair = await getStealthKeypair(stealthAddress.address, stealthAddress.index);
  if (!keypair) throw new Error('Could not derive keypair');

  const balance = await connection.getBalance(keypair.publicKey);
  const fee = 5000; // approx fee
  const sendAmount = balance - fee;

  if (sendAmount <= 0) throw new Error('Insufficient balance for fee');

  const { blockhash } = await connection.getLatestBlockhash();
  const transaction = new Transaction({
    recentBlockhash: blockhash,
    feePayer: keypair.publicKey,
  }).add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: mainWalletPubkey,
      lamports: sendAmount,
    })
  );

  transaction.sign(keypair);
  const signature = await connection.sendRawTransaction(transaction.serialize());
  await connection.confirmTransaction(signature, 'confirmed');

  return signature;
}
```

**Note:** Stealth addresses sign locally (not with passkey). Sweeping requires SOL for fees.

---

# Part 2: Burner Wallets

## How Burner Wallets Work

```
Main LazorKit Wallet ←→ PDA controlled by passkey
Burner Wallet ←→ Random keypair (no connection)
```

Burners are completely isolated. Destroy them when done - the private key is deleted forever.

## Step 1: Create Burner Utilities

Create `src/utils/burner.ts`:

```typescript
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL, SystemProgram, Transaction } from '@solana/web3.js';

const BURNER_LIST_KEY = 'lazor_burner_list';
const BURNER_KEY_PREFIX = 'lazor_burner_';

export interface BurnerWallet {
  id: string;
  label: string;
  publicKey: string;
  createdAt: number;
}
```

## Step 2: Create Burner

```typescript
async function generateBurnerId(): Promise<string> {
  const randomBytes = await Crypto.getRandomBytesAsync(8);
  return Buffer.from(randomBytes).toString('hex');
}

export async function createBurner(label: string): Promise<BurnerWallet> {
  const keypair = Keypair.generate();
  const id = await generateBurnerId();

  // Store secret key encrypted
  const secretKeyBase64 = Buffer.from(keypair.secretKey).toString('base64');
  await SecureStore.setItemAsync(`${BURNER_KEY_PREFIX}${id}`, secretKeyBase64, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });

  const burner: BurnerWallet = {
    id,
    label,
    publicKey: keypair.publicKey.toBase58(),
    createdAt: Date.now(),
  };

  // Add to list
  const burners = await listBurners();
  burners.push(burner);
  await SecureStore.setItemAsync(BURNER_LIST_KEY, JSON.stringify(burners));

  return burner;
}
```

## Step 3: Send from Burner

```typescript
export async function sendFromBurner(
  burnerId: string,
  recipient: string,
  amount: number,
  connection: Connection
): Promise<string> {
  const keypair = await getBurnerKeypair(burnerId);
  if (!keypair) throw new Error('Burner not found');

  const recipientPubkey = new PublicKey(recipient);
  const lamports = Math.floor(amount * LAMPORTS_PER_SOL);

  const { blockhash } = await connection.getLatestBlockhash();
  const transaction = new Transaction({
    recentBlockhash: blockhash,
    feePayer: keypair.publicKey,
  }).add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: recipientPubkey,
      lamports,
    })
  );

  transaction.sign(keypair);
  const signature = await connection.sendRawTransaction(transaction.serialize());
  await connection.confirmTransaction(signature, 'confirmed');

  return signature;
}
```

## Step 4: Destroy Burner

```typescript
export async function destroyBurner(burnerId: string, sweepTo?: string): Promise<void> {
  const keypair = await getBurnerKeypair(burnerId);

  // Optionally sweep remaining funds first
  if (keypair && sweepTo) {
    const balance = await connection.getBalance(keypair.publicKey);
    if (balance > 5000) {
      // Send all minus fee
      const { blockhash } = await connection.getLatestBlockhash();
      const tx = new Transaction({
        recentBlockhash: blockhash,
        feePayer: keypair.publicKey,
      }).add(
        SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey: new PublicKey(sweepTo),
          lamports: balance - 5000,
        })
      );
      tx.sign(keypair);
      await connection.sendRawTransaction(tx.serialize());
    }
  }

  // Delete private key permanently
  await SecureStore.deleteItemAsync(`${BURNER_KEY_PREFIX}${burnerId}`);

  // Remove from list
  const burners = await listBurners();
  const updated = burners.filter(b => b.id !== burnerId);
  await SecureStore.setItemAsync(BURNER_LIST_KEY, JSON.stringify(updated));
}
```

---

## Privacy Comparison

| Feature | Stealth Addresses | Burner Wallets |
|---------|-------------------|----------------|
| Keys | Derived from master seed | Random keypair |
| Recovery | Master seed recovers all | Lost if destroyed |
| On-chain link | None until swept | Never |
| Use case | Receiving payments | Separate identity |

## Security Notes

1. **Master seed** is stored encrypted, but not in Secure Enclave like passkeys
2. **Sweeping** creates an on-chain link from stealth to main wallet
3. **Burner funding** from main wallet creates a link - fund from exchange for true isolation
4. Both features require SOL for gas (not gasless like main wallet)

## Error Handling

| Error | Cause | Solution |
|-------|-------|----------|
| "Could not derive keypair" | Wrong index | Verify address matches derivation |
| "Insufficient balance" | Not enough for fee | Need ~0.000005 SOL minimum |
| "Burner not found" | ID mismatch or deleted | Check burner still exists |

## Testing Limits

For mainnet safety during testing:

```typescript
MAX_SWEEP_SOL: 0.1
MAX_REQUEST_SOL: 0.05
MAX_BURNER_SEND_SOL: 0.02
```

## Next Steps

- [Tutorial 1: Creating a Passkey Wallet](./tutorial-1-passkey-wallet.md)
- [Tutorial 2: Gasless Transactions](./tutorial-2-gasless-transactions.md)
- [Tutorial 3: Jupiter Gasless Swaps](./tutorial-3-jupiter-gasless-swaps.md)
