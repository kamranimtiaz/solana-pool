import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import * as anchor from '@coral-xyz/anchor';
import type { Idl } from '@coral-xyz/anchor';
import {
  Commitment,
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from '@solana/web3.js';

const RPC_URL = process.env.SOLANA_RPC_URL;
const RAW_AMOUNT_SOL = process.env.WITHDRAW_SOL_AMOUNT;

if (!RPC_URL) {
  throw new Error('SOLANA_RPC_URL environment variable is required');
}

if (!RAW_AMOUNT_SOL) {
  throw new Error('WITHDRAW_SOL_AMOUNT environment variable is required');
}

const amountLamports = Math.floor(Number(RAW_AMOUNT_SOL) * LAMPORTS_PER_SOL);

if (Number.isNaN(amountLamports) || amountLamports <= 0) {
  throw new Error('WITHDRAW_SOL_AMOUNT must be a positive number');
}

const commitment: Commitment = 'confirmed';

async function main(): Promise<void> {
  const connection = new Connection(RPC_URL, commitment);
  const wallet = anchor.Wallet.local();
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment });
  anchor.setProvider(provider);

  const idlPath = path.join(__dirname, '../target/idl/reward_pool.json');
  const rawIdl = JSON.parse(fs.readFileSync(idlPath, 'utf8')) as Idl & { address: string };
  const program = new anchor.Program(rawIdl as Idl, provider);
  const programId = program.programId;

  const [poolPDA] = PublicKey.findProgramAddressSync([Buffer.from('pool')], programId);
  const [vaultPDA] = PublicKey.findProgramAddressSync([Buffer.from('vault')], programId);

  console.log('🔐 Owner wallet:', provider.wallet.publicKey.toBase58());
  console.log('📍 Pool PDA:', poolPDA.toBase58());
  console.log('🏦 Vault PDA:', vaultPDA.toBase58());
  console.log(`💸 Attempting withdrawal: ${Number(RAW_AMOUNT_SOL).toFixed(9)} SOL (${amountLamports} lamports)`);

  const signature = await program.methods
    .ownerWithdraw(new anchor.BN(amountLamports))
    .accounts({
      pool: poolPDA,
      poolVault: vaultPDA,
      owner: provider.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log('✅ Withdrawal transaction signature:', signature);
}

main()
  .then(() => {
    console.log('✨ Withdrawal completed successfully.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Withdrawal failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
