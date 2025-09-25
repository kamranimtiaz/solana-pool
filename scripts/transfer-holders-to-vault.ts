import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import {
  Commitment,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';

type IdlWithAddress = {
  address?: string;
};

const commitment: Commitment = 'confirmed';
const rpcUrl =
  process.env.SOLANA_RPC_URL ??
  process.env.SOLANA_DEVNET_RPC_URL ??
  process.env.SOLANA_MAINNET_RPC_URL;

if (!rpcUrl) {
  throw new Error('Set SOLANA_RPC_URL (or SOLANA_DEVNET_RPC_URL / SOLANA_MAINNET_RPC_URL)');
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

const rawFeeBuffer = process.env.HOLDER_FEE_BUFFER_LAMPORTS ?? '5000';
const feeBufferLamports = Number(rawFeeBuffer);

if (!Number.isFinite(feeBufferLamports) || feeBufferLamports < 0) {
  throw new Error('HOLDER_FEE_BUFFER_LAMPORTS must be a non-negative number');
}

function deriveVaultAddress(): PublicKey {
  if (process.env.VAULT_ADDRESS) {
    return new PublicKey(process.env.VAULT_ADDRESS);
  }

  const idlPath = path.join(__dirname, '../target/idl/reward_pool.json');
  if (!fs.existsSync(idlPath)) {
    throw new Error(`IDL not found at ${idlPath}; set VAULT_ADDRESS env var instead`);
  }

  const rawIdl = JSON.parse(fs.readFileSync(idlPath, 'utf8')) as IdlWithAddress;
  if (!rawIdl.address) {
    throw new Error('Program address missing from reward_pool IDL; set VAULT_ADDRESS env var');
  }

  const programId = new PublicKey(rawIdl.address);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from('vault')], programId);
  return vault;
}

function loadKeypair(filePath: string): Keypair {
  const secret = JSON.parse(fs.readFileSync(filePath, 'utf8')) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function main(): Promise<void> {
  const vaultPubkey = deriveVaultAddress();
  const connection = new Connection(rpcUrl, commitment);

  console.log('⚙️  RPC endpoint:', rpcUrl);
  console.log('🏦 Vault address:', vaultPubkey.toBase58());
  console.log(`📂 Holder directory: ${holderDir}`);
  console.log(`🗂️  Matching holder files: ${holderFiles.join(', ')}`);
  console.log(`⛽ Fee buffer reserved per wallet: ${feeBufferLamports} lamports`);

  let totalTransferredLamports = 0;

  for (const holderFile of holderFiles) {
    const absolutePath = path.join(holderDir, holderFile);
    console.log(`\n➡️  Processing ${holderFile}`);

    try {
      const keypair = loadKeypair(absolutePath);
      const balance = await connection.getBalance(keypair.publicKey, commitment);
      console.log(`   ↳ Current balance: ${balance} lamports (${(balance / LAMPORTS_PER_SOL).toFixed(9)} SOL)`);

      if (balance <= feeBufferLamports) {
        console.log('   ↳ Skipping: balance below or equal to reserved fee buffer');
        continue;
      }

      const transferLamports = balance - feeBufferLamports;
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(commitment);

      const transaction = new Transaction({
        feePayer: keypair.publicKey,
        recentBlockhash: blockhash,
      }).add(
        SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey: vaultPubkey,
          lamports: transferLamports,
        }),
      );

      const signature = await connection.sendTransaction(transaction, [keypair]);
      await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        commitment,
      );

      totalTransferredLamports += transferLamports;

      console.log(
        `   ↳ ✅ Sent ${transferLamports} lamports (${(transferLamports / LAMPORTS_PER_SOL).toFixed(9)} SOL)` +
          ` | signature: ${signature}`,
      );
    } catch (error) {
      console.error(
        '   ↳ ❌ Transfer failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  console.log('\n📊 Transfer summary');
  console.log(`   • Total lamports sent: ${totalTransferredLamports}`);
  console.log(`   • Total SOL sent: ${(totalTransferredLamports / LAMPORTS_PER_SOL).toFixed(9)}`);
}

main()
  .then(() => {
    console.log('\n🎉 Holder transfers complete.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Unhandled error during holder transfers:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
