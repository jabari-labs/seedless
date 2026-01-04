
// Stealth address utilities using deterministic key derivation
// Master seed is stored encrypted in SecureStore, separate from passkey auth

import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { Keypair, PublicKey } from '@solana/web3.js';

const MASTER_SEED_KEY = 'lazor_stealth_master_seed';
const STEALTH_INDEX_KEY = 'lazor_stealth_index';

// Testing limits for mainnet
export const STEALTH_LIMITS = {
  MAX_SWEEP_SOL: 0.1,
  MAX_SWEEP_USDC: 10,
  MAX_REQUEST_SOL: 0.05,
  MAX_REQUEST_USDC: 5,
} as const;

export interface StealthMetaAddress {
  scanPubkey: string;
  spendPubkey: string;
}

export interface StealthAddress {
  index: number;
  address: string;
  createdAt: number;
  label?: string;
}

// Get or create the master seed (stored encrypted)
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

export async function isStealthInitialized(): Promise<boolean> {
  const seed = await SecureStore.getItemAsync(MASTER_SEED_KEY);
  return seed !== null;
}

// Derive scan/spend keypairs from master seed
export async function deriveStealthKeypairs(masterSeed: string): Promise<{
  scanKeypair: Keypair;
  spendKeypair: Keypair;
}> {
  const seedBuffer = Buffer.from(masterSeed, 'hex');

  // scan key = hash(seed + "scan")
  const scanInput = Buffer.concat([seedBuffer, Buffer.from('scan')]);
  const scanHash = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, scanInput);
  const scanKeypair = Keypair.fromSeed(new Uint8Array(scanHash));

  // spend key = hash(seed + "spend")
  const spendInput = Buffer.concat([seedBuffer, Buffer.from('spend')]);
  const spendHash = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, spendInput);
  const spendKeypair = Keypair.fromSeed(new Uint8Array(spendHash));

  return { scanKeypair, spendKeypair };
}

// Public meta-address for sharing with payers
export async function getStealthMetaAddress(): Promise<StealthMetaAddress> {
  const masterSeed = await getOrCreateMasterSeed();
  const { scanKeypair, spendKeypair } = await deriveStealthKeypairs(masterSeed);

  return {
    scanPubkey: scanKeypair.publicKey.toBase58(),
    spendPubkey: spendKeypair.publicKey.toBase58(),
  };
}

// Create a new one-time receiving address
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

// Derive keypair for a specific index (for sweeping)
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

// Get keypair for sweeping funds from a stealth address
export async function getStealthKeypair(
  address: string,
  index: number
): Promise<Keypair | null> {
  const masterSeed = await getOrCreateMasterSeed();
  const keypair = await deriveStealthKeypairForIndex(masterSeed, index);

  if (keypair.publicKey.toBase58() !== address) {
    return null;
  }

  return keypair;
}

// Get all previously generated stealth addresses
export async function getAllStealthAddresses(): Promise<StealthAddress[]> {
  const masterSeed = await getOrCreateMasterSeed();
  const indexStr = await SecureStore.getItemAsync(STEALTH_INDEX_KEY);
  const maxIndex = indexStr ? parseInt(indexStr, 10) : 0;

  const addresses: StealthAddress[] = [];

  for (let i = 0; i < maxIndex; i++) {
    const keypair = await deriveStealthKeypairForIndex(masterSeed, i);
    addresses.push({
      index: i,
      address: keypair.publicKey.toBase58(),
      createdAt: 0,
    });
  }

  return addresses;
}

// Reset index counter (testing only)
export async function resetStealthIndex(): Promise<void> {
  await SecureStore.deleteItemAsync(STEALTH_INDEX_KEY);
}

export function formatMetaAddress(metaAddress: StealthMetaAddress): string {
  const scanShort = `${metaAddress.scanPubkey.slice(0, 4)}...${metaAddress.scanPubkey.slice(-4)}`;
  const spendShort = `${metaAddress.spendPubkey.slice(0, 4)}...${metaAddress.spendPubkey.slice(-4)}`;
  return `${scanShort}:${spendShort}`;
}

export function isValidAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}
