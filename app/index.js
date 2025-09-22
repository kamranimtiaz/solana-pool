const anchor = require('@coral-xyz/anchor');
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');
const os = require('os');

const IDL_PATH = path.join(__dirname, '../target/idl/reward_pool.json');
const DEFAULT_RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const PROGRAM_ID_OVERRIDE = process.env.PROGRAM_ID || null;
const HOLDER_COUNT = parseInt(process.env.FAKE_HOLDER_COUNT || '5', 10);
const HOLDER_FUND_SOL = parseFloat(process.env.HOLDER_FUND_SOL || process.env.HOLDER_AIRDROP_SOL || '0.01');
const VAULT_TOP_UP_SOL = parseFloat(process.env.VAULT_TOP_UP_SOL || '0.2');
const COMMITMENT = 'confirmed';

function formatSol(lamports) {
  return (lamports / LAMPORTS_PER_SOL).toFixed(6);
}

function loadIdl() {
  const idlRaw = fs.readFileSync(IDL_PATH, 'utf8');
  const idl = JSON.parse(idlRaw);
  if (PROGRAM_ID_OVERRIDE) {
    idl.address = PROGRAM_ID_OVERRIDE;
  }
  if (!idl.address) {
    throw new Error('Program ID not found in IDL. Set PROGRAM_ID env var.');
  }
  return idl;
}

function loadKeypairFromFile(filePath) {
  const rawBytes = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(rawBytes));
}

function resolveWalletPath() {
  if (process.env.ANCHOR_WALLET) {
    return process.env.ANCHOR_WALLET;
  }
  const defaultPath = path.join(os.homedir(), '.config/solana/devnet-keypair.json');
  if (fs.existsSync(defaultPath)) {
    return defaultPath;
  }
  const legacyPath = path.join(os.homedir(), '.config/solana/id.json');
  if (fs.existsSync(legacyPath)) {
    return legacyPath;
  }
  throw new Error('No wallet found. Set ANCHOR_WALLET env var pointing to a keypair file.');
}

async function ensurePool(program, poolPDA, vaultPDA, ownerPubkey) {
  try {
    return await program.account.rewardPool.fetch(poolPDA);
  } catch (error) {
    if (!`${error.message}`.includes('Account does not exist')) {
      throw error;
    }
    console.log('ℹ️  Pool not found on-chain. Attempting to initialize...');
    await program.methods
      .initializePool(ownerPubkey)
      .accounts({
        pool: poolPDA,
        poolVault: vaultPDA,
        payer: ownerPubkey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log('✅ Pool initialized');
    return program.account.rewardPool.fetch(poolPDA);
  }
}

async function seedVaultIfNeeded(provider, vaultPDA) {
  const connection = provider.connection;
  const currentLamports = await connection.getBalance(vaultPDA, COMMITMENT);
  const requiredLamports = Math.floor(VAULT_TOP_UP_SOL * LAMPORTS_PER_SOL);
  if (requiredLamports === 0 || currentLamports >= requiredLamports) {
    return;
  }
  const lamportsToSend = requiredLamports - currentLamports;
  const tx = new anchor.web3.Transaction().add(
    SystemProgram.transfer({
      fromPubkey: provider.wallet.publicKey,
      toPubkey: vaultPDA,
      lamports: lamportsToSend,
    })
  );
  await provider.sendAndConfirm(tx, []);
  console.log(`✅ Vault funded (+${formatSol(lamportsToSend)} SOL)`);
}

function buildHolderInfos(fakeHolders) {
  return fakeHolders.map((kp, index) => ({
    address: kp.publicKey,
    balance: new anchor.BN(1_000 - index * 50),
  }));
}

async function fundAccount(provider, recipient, lamports) {
  if (lamports <= 0) {
    throw new Error('HOLDER_FUND_SOL must be greater than 0.');
  }
  const tx = new anchor.web3.Transaction().add(
    SystemProgram.transfer({
      fromPubkey: provider.wallet.publicKey,
      toPubkey: recipient,
      lamports,
    })
  );
  await provider.sendAndConfirm(tx, []);
}

async function createFakeHolders(connection, provider) {
  const holders = [];
  const lamportsPerHolder = Math.floor(HOLDER_FUND_SOL * LAMPORTS_PER_SOL);
  const feeBuffer = HOLDER_COUNT * 5_000; // rough fee cushion
  const totalLamportsNeeded = lamportsPerHolder * HOLDER_COUNT + feeBuffer;
  const providerBalance = await connection.getBalance(provider.wallet.publicKey, COMMITMENT);

  if (lamportsPerHolder === 0) {
    throw new Error('Set HOLDER_FUND_SOL to the amount of SOL each fake holder should receive.');
  }

  if (providerBalance < totalLamportsNeeded) {
    throw new Error(
      `Provider wallet ${provider.wallet.publicKey.toBase58()} needs at least ${formatSol(totalLamportsNeeded)} SOL to fund holders. ` +
        'Top up the wallet (e.g. `solana airdrop 2` or using https://faucet.solana.com) and rerun.'
    );
  }

  for (let i = 0; i < HOLDER_COUNT; i += 1) {
    const kp = Keypair.generate();
    holders.push(kp);
    await fundAccount(provider, kp.publicKey, lamportsPerHolder);
    const balance = await connection.getBalance(kp.publicKey, COMMITMENT);
    console.log(`   → Holder ${i + 1}: ${kp.publicKey.toBase58()} (${formatSol(balance)} SOL)`);
  }

  return holders;
}

async function main() {
  console.log('🚀 Starting reward distribution demo');
  const idl = loadIdl();
  const connection = new Connection(DEFAULT_RPC, COMMITMENT);
  const walletPath = resolveWalletPath();
  const walletKeypair = loadKeypairFromFile(walletPath);
  const wallet = new anchor.Wallet(walletKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: COMMITMENT,
    preflightCommitment: COMMITMENT,
  });
  anchor.setProvider(provider);

  const programId = new PublicKey(idl.address);
  const program = new anchor.Program(idl, provider);

  const [poolPDA] = PublicKey.findProgramAddressSync([Buffer.from('pool')], programId);
  const [vaultPDA] = PublicKey.findProgramAddressSync([Buffer.from('vault')], programId);

  console.log('📍 Pool PDA:', poolPDA.toBase58());
  console.log('🏦 Vault PDA:', vaultPDA.toBase58());

  const poolAccount = await ensurePool(program, poolPDA, vaultPDA, provider.wallet.publicKey);

  if (!poolAccount.owner.equals(provider.wallet.publicKey)) {
    throw new Error('The local wallet is not the pool owner. Use the pool owner keypair to run this demo.');
  }

  console.log('\n👤 Pool owner:', poolAccount.owner.toBase58());

  console.log('\n📝 Creating fake holder wallets and funding them from the local wallet...');
  const fakeHolders = await createFakeHolders(connection, provider);
  const holderInfos = buildHolderInfos(fakeHolders);

  console.log('\n📊 Updating top holders on-chain...');
  await program.methods
    .updateTopHolders(holderInfos)
    .accounts({
      pool: poolPDA,
      authority: provider.wallet.publicKey,
    })
    .rpc();
  console.log('✅ Top holders updated');

  console.log('\n💰 Ensuring vault has SOL for distribution...');
  await seedVaultIfNeeded(provider, vaultPDA);

  console.log('\n🎁 Calling distribute_rewards...');
  await program.methods
    .distributeRewards()
    .accounts({
      pool: poolPDA,
      poolVault: vaultPDA,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(
      holderInfos.map(({ address }) => ({
        pubkey: address,
        isWritable: true,
        isSigner: false,
      }))
    )
    .rpc();
  console.log('✅ Distribution transaction submitted');

  const updatedPool = await program.account.rewardPool.fetch(poolPDA);
  console.log('\n📈 Pool stats after distribution:');
  console.log('   Total rewards:', updatedPool.totalRewards.toString());
  console.log('   Total distributed:', updatedPool.totalDistributed.toString());
  console.log('   Holder count:', updatedPool.topHolders.length);

  console.log('\n💳 Holder balances (lamports):');
  for (let i = 0; i < fakeHolders.length; i += 1) {
    const pubkey = fakeHolders[i].publicKey;
    const balance = await connection.getBalance(pubkey, COMMITMENT);
    console.log(`   Holder ${i + 1}: ${pubkey.toBase58()} → ${formatSol(balance)} SOL`);
  }

  console.log('\n✨ Demo completed!');
}

if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Demo failed:', error.message ?? error);
    process.exit(1);
  });
}

module.exports = { main };
