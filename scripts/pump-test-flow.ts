import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import * as anchor from '@coral-xyz/anchor';
import type { Idl } from '@coral-xyz/anchor';
import {
  Commitment,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import { PumpSdk, getBuyTokenAmountFromSolAmount } from '@pump-fun/pump-sdk';

const commitment: Commitment = 'confirmed';

const RPC_URL =
  process.env.SOLANA_RPC_URL ??
  process.env.SOLANA_MAINNET_RPC_URL ??
  process.env.SOLANA_DEVNET_RPC_URL;

if (!RPC_URL) {
  throw new Error('Set SOLANA_RPC_URL or SOLANA_MAINNET_RPC_URL before running');
}

const providerWalletPath = process.env.ANCHOR_WALLET;
if (!providerWalletPath || !fs.existsSync(providerWalletPath)) {
  throw new Error('ANCHOR_WALLET must point to the creator keypair used to launch the token');
}

const connection = new Connection(RPC_URL, commitment);
const wallet = anchor.Wallet.local();
const provider = new anchor.AnchorProvider(connection, wallet, { commitment });
anchor.setProvider(provider);

const sdk = new PumpSdk(connection);
const global = await sdk.fetchGlobal();

const existingMint = process.env.PUMP_EXISTING_MINT;
const tokenName = process.env.PUMP_TEST_NAME ?? 'Test Token';
const tokenSymbol = process.env.PUMP_TEST_SYMBOL ?? 'TEST';
const tokenUri = process.env.PUMP_TEST_URI ?? 'https://pump.fun';
const launchSol = Number(process.env.PUMP_LAUNCH_SOL ?? '0.1');
const holderBuySol = Number(process.env.PUMP_HOLDER_BUY_SOL ?? '0.05');
const minHolderBalanceLamports = Number(process.env.PUMP_MIN_HOLDER_BALANCE ?? '5000');
const slippagePercent = Number(process.env.PUMP_HOLDER_SLIPPAGE_PERCENT ?? '1');

if (!Number.isFinite(holderBuySol) || holderBuySol <= 0) {
  throw new Error('PUMP_HOLDER_BUY_SOL must be a positive number');
}
if (!Number.isFinite(slippagePercent) || slippagePercent < 0) {
  throw new Error('PUMP_HOLDER_SLIPPAGE_PERCENT must be >= 0');
}

const holderDir = process.env.HOLDER_KEYPAIR_DIR
  ? path.resolve(process.cwd(), process.env.HOLDER_KEYPAIR_DIR)
  : path.resolve(__dirname, '..');
const holderPrefix = process.env.HOLDER_FILE_PREFIX ?? 'holder';
const holderPattern = new RegExp(`^${holderPrefix}\\d*\\.json$`, 'i');
const holderFiles = fs
  .readdirSync(holderDir)
  .filter((file) => holderPattern.test(file))
  .sort();

if (holderFiles.length === 0) {
  throw new Error(`No holder keypairs found with prefix "${holderPrefix}" in ${holderDir}`);
}

const holderSolLamports = new anchor.BN(Math.floor(holderBuySol * LAMPORTS_PER_SOL));

function loadKeypair(filePath: string): Keypair {
  const secret = JSON.parse(fs.readFileSync(filePath, 'utf8')) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function launchToken(): Promise<PublicKey> {
  if (existingMint) {
    const mint = new PublicKey(existingMint);
    console.log('🪙 Using existing mint:', mint.toBase58());
    return mint;
  }

  if (!Number.isFinite(launchSol) || launchSol <= 0) {
    throw new Error('PUMP_LAUNCH_SOL must be set to a positive number when creating a token');
  }

  const launchLamports = new anchor.BN(Math.floor(launchSol * LAMPORTS_PER_SOL));
  const mintKeypair = Keypair.generate();

  console.log('🪙 Launching new Pump token');
  console.log('   Name:', tokenName);
  console.log('   Symbol:', tokenSymbol);
  console.log('   URI:', tokenUri);
  console.log('   Initial SOL buy:', launchSol);

  const amountOut = getBuyTokenAmountFromSolAmount(global, null, launchLamports);
  const instructions = await sdk.createAndBuyInstructions({
    global,
    mint: mintKeypair.publicKey,
    name: tokenName,
    symbol: tokenSymbol,
    uri: tokenUri,
    creator: wallet.publicKey,
    user: wallet.publicKey,
    amount: amountOut,
    solAmount: launchLamports,
  });

  const tx = new Transaction({ feePayer: wallet.publicKey });
  instructions.forEach((ix) => tx.add(ix));
  const signature = await provider.sendAndConfirm(tx, [mintKeypair]);

  console.log('✅ Token created. Mint:', mintKeypair.publicKey.toBase58());
  console.log('   Creation signature:', signature);
  return mintKeypair.publicKey;
}

async function ensureOnCurve(pubkey: PublicKey): Promise<boolean> {
  const isOnCurve = PublicKey.isOnCurve(pubkey.toBuffer());
  if (!isOnCurve) {
    console.log(`   ↳ Skipping off-curve owner ${pubkey.toBase58()}`);
    return false;
  }
  return true;
}

async function runHolderBuys(mint: PublicKey): Promise<void> {
  console.log('\n🛒 Executing holder buys for mint:', mint.toBase58());

  for (const holderFile of holderFiles) {
    const holderPath = path.join(holderDir, holderFile);
    const holderKeypair = loadKeypair(holderPath);

    console.log(`\n➡️  Holder: ${holderFile}`);
    if (!(await ensureOnCurve(holderKeypair.publicKey))) {
      continue;
    }

    const balanceLamports = await connection.getBalance(holderKeypair.publicKey, commitment);
    console.log(
      `   ↳ Current balance: ${balanceLamports} lamports (${(
        balanceLamports / LAMPORTS_PER_SOL
      ).toFixed(9)} SOL)`,
    );

    const requiredLamports = holderSolLamports.toNumber() + minHolderBalanceLamports;
    if (balanceLamports < requiredLamports) {
      console.log(
        `   ↳ Skipping: balance below required minimum (${requiredLamports} lamports including buffer)`,
      );
      continue;
    }

    const buyState = await sdk.fetchBuyState(mint, holderKeypair.publicKey);
    const tokensOut = getBuyTokenAmountFromSolAmount(
      global,
      buyState.bondingCurve,
      holderSolLamports,
    );

    if (tokensOut.isZero()) {
      console.log('   ↳ Skipping: buy amount too small for current bonding curve');
      continue;
    }

    const buyInstructions = await sdk.buyInstructions({
      global,
      bondingCurveAccountInfo: buyState.bondingCurveAccountInfo,
      bondingCurve: buyState.bondingCurve,
      associatedUserAccountInfo: buyState.associatedUserAccountInfo,
      mint,
      user: holderKeypair.publicKey,
      amount: tokensOut,
      solAmount: holderSolLamports,
      slippage: slippagePercent,
    });

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(commitment);
    const tx = new Transaction({
      feePayer: holderKeypair.publicKey,
      recentBlockhash: blockhash,
    });
    buyInstructions.forEach((ix) => tx.add(ix));

    tx.sign(holderKeypair);
    const signature = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      commitment,
    );

    console.log(
      `   ↳ ✅ Bought ${tokensOut.toString()} tokens | signature: ${signature}`,
    );
  }
}

async function main(): Promise<void> {
  console.log('⚙️  Pump test flow starting');
  console.log('RPC endpoint:', RPC_URL);
  console.log('Provider wallet:', wallet.publicKey.toBase58());
  console.log('Holder files:', holderFiles.join(', '));

  const mint = await launchToken();
  await runHolderBuys(mint);

  console.log('\n🎉 Pump test flow complete');
}

main().catch((error) => {
  console.error('❌ Pump test flow failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
