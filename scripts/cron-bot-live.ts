import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import * as anchor from '@coral-xyz/anchor';
import type { Idl } from '@coral-xyz/anchor';
import {
  Commitment,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import { AccountLayout } from '@solana/spl-token';
import { PumpSdk } from '@pump-fun/pump-sdk';

const commitment: Commitment = 'confirmed';

const RPC_URL = process.env.SOLANA_RPC_URL;
const TOKEN_MINT = process.env.TOKEN_MINT;
const PUMPFUN_CREATOR = process.env.PUMPFUN_CREATOR;
const PUMPFUN_API_KEY = process.env.PUMPFUN_API_KEY;
const REWARD_THRESHOLD_SOL = Number(process.env.REWARD_THRESHOLD_SOL ?? '0');

if (!RPC_URL) throw new Error('Missing SOLANA_RPC_URL');
if (!TOKEN_MINT) throw new Error('Missing TOKEN_MINT');
if (!PUMPFUN_CREATOR) throw new Error('Missing PUMPFUN_CREATOR');

if (PUMPFUN_API_KEY) {
  process.env.PUMP_FUN_API_KEY = PUMPFUN_API_KEY;
}

const connection = new Connection(RPC_URL, commitment);
const wallet = anchor.Wallet.local();
const provider = new anchor.AnchorProvider(connection, wallet, { commitment });
anchor.setProvider(provider);

const idlPath = path.join(__dirname, '../target/idl/reward_pool.json');
const rawIdl = JSON.parse(fs.readFileSync(idlPath, 'utf8')) as Idl & { address: string };
const program = new anchor.Program(rawIdl as Idl, provider);
const programId = program.programId;
const pumpSdk = new PumpSdk(connection);

const mintPubkey = new PublicKey(TOKEN_MINT);
const creatorPubkey = new PublicKey(PUMPFUN_CREATOR);
const [poolPDA] = PublicKey.findProgramAddressSync([Buffer.from('pool')], programId);
const [vaultPDA] = PublicKey.findProgramAddressSync([Buffer.from('vault')], programId);
const { BN } = anchor;

type HolderInfo = {
  address: PublicKey;
  balance: anchor.BN;
};

async function getPendingCreatorRewards(): Promise<number> {
  const lamports = await pumpSdk.getCreatorVaultBalanceBothPrograms(creatorPubkey);
  return Number(lamports.toString()) / anchor.web3.LAMPORTS_PER_SOL;
}

async function collectCreatorFees(): Promise<string> {
  const { instructions, signers } = await pumpSdk.collectCoinCreatorFeeInstructions(creatorPubkey);

  const tx = new Transaction();
  instructions.forEach((ix) => tx.add(ix));

  const allSigners: Keypair[] = [provider.wallet.payer, ...signers];
  const signature = await provider.sendAndConfirm(tx, allSigners);
  return signature;
}

type HolderMap = Map<string, anchor.BN>;

async function fetchTopHolders(limit: number): Promise<HolderInfo[]> {
  const largest = await connection.getTokenLargestAccounts(mintPubkey, commitment);
  if (!largest.value || largest.value.length === 0) {
    return [];
  }

  const upperBound = Math.min(largest.value.length, limit * 2);
  const tokenAccountPubkeys = largest.value
    .slice(0, upperBound)
    .map((item) => new PublicKey(item.address));

  const accountInfos = await connection.getMultipleAccountsInfo(tokenAccountPubkeys, commitment);
  const holderMap: HolderMap = new Map();

  accountInfos.forEach((info, idx) => {
    if (!info) {
      return;
    }

    try {
      const decoded = AccountLayout.decode(info.data);
      const owner = new PublicKey(decoded.owner as Buffer);
      const isOnCurve = PublicKey.isOnCurve(owner.toBuffer());

      if (!isOnCurve) {
        console.log(
          `   ↳ Skipping off-curve owner ${owner.toBase58()} for token account ${
            tokenAccountPubkeys[idx]?.toBase58() ?? 'unknown'
          }`,
        );
        return;
      }

      let amount: anchor.BN;

      if (typeof decoded.amount === 'bigint') {
        amount = new BN(decoded.amount.toString());
      } else {
        const amountBuffer = Buffer.from(decoded.amount as Buffer);
        amount = new BN(amountBuffer, undefined, 'le');
      }

      if (amount.isZero()) {
        return;
      }

      const key = owner.toBase58();
      const existing = holderMap.get(key) ?? new BN(0);
      holderMap.set(key, existing.add(amount));
    } catch (error) {
      console.warn(`⚠️  Failed to decode token account ${tokenAccountPubkeys[idx]?.toBase58()}:`, error);
    }
  });

  return Array.from(holderMap.entries())
    .sort((a, b) => b[1].cmp(a[1]))
    .slice(0, limit)
    .map(([address, balance]) => ({
      address: new PublicKey(address),
      balance,
    }));
}

async function distributeRewards(holders: HolderInfo[]): Promise<string> {
  if (holders.length === 0) {
    throw new Error('No holders available for distribution');
  }

  const ix = await program.methods
    .distributeRewards(holders)
    .accounts({
      pool: poolPDA,
      poolVault: vaultPDA,
      authority: provider.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(
      holders.map(({ address }) => ({
        pubkey: address,
        isWritable: true,
        isSigner: false,
      })),
    )
    .instruction();

  const tx = new Transaction().add(ix);
  return provider.sendAndConfirm(tx, []);
}

async function main(): Promise<void> {
  console.log('🚀 Cron bot (live) started');
  console.log(`RPC endpoint: ${RPC_URL}`);
  console.log(`Pool PDA: ${poolPDA.toBase58()}`);
  console.log(`Vault PDA: ${vaultPDA.toBase58()}`);

  const pendingRewards = await getPendingCreatorRewards();
  console.log(`💰 Pending creator rewards: ${pendingRewards.toFixed(6)} SOL`);

  if (pendingRewards < REWARD_THRESHOLD_SOL) {
    console.log(`ℹ️  Threshold (${REWARD_THRESHOLD_SOL} SOL) not met. Exiting.`);
    return;
  }

  console.log('⚙️  Threshold met. Collecting Pump.fun fees...');
  const claimSignature = await collectCreatorFees();
  console.log(`✅ Creator fees collected. Signature: ${claimSignature}`);

  const holders = await fetchTopHolders(20);
  console.log(`👥 Retrieved ${holders.length} holder entries.`);

  if (holders.length === 0) {
    console.log('⚠️  No holders returned; aborting distribution.');
    return;
  }

  const signature = await distributeRewards(holders);
  console.log(`✅ Distribution submitted. Signature: ${signature}`);
}

main()
  .then(() => {
    console.log('✨ Cron bot finished successfully.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Cron bot failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
