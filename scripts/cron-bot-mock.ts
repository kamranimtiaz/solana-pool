import "dotenv/config";
import fs from "fs";
import path from "path";
import * as anchor from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import {
  Commitment,
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { AccountLayout } from "@solana/spl-token";

const commitment: Commitment = "confirmed";

const DEVNET_RPC_URL = process.env.SOLANA_DEVNET_RPC_URL;
const MAINNET_RPC_URL = process.env.SOLANA_MAINNET_RPC_URL ?? DEVNET_RPC_URL;
const TOKEN_MINT = process.env.TOKEN_MINT;
const PUMPFUN_CREATOR = process.env.PUMPFUN_CREATOR;
const REWARD_THRESHOLD_SOL = Number(process.env.REWARD_THRESHOLD_SOL ?? "0");
const FAKE_HOLDER_ADDRESSES = (process.env.FAKE_HOLDER_ADDRESSES ?? "")
  .split(",")
  .map((addr) => addr.trim())
  .filter((addr) => addr.length > 0);

if (!DEVNET_RPC_URL) {
  throw new Error("Environment variable SOLANA_DEVNET_RPC_URL is required");
}
if (!TOKEN_MINT) {
  throw new Error("Environment variable TOKEN_MINT is required");
}
if (!PUMPFUN_CREATOR) {
  throw new Error("Environment variable PUMPFUN_CREATOR is required");
}
if (FAKE_HOLDER_ADDRESSES.length === 0) {
  throw new Error(
    "Environment variable FAKE_HOLDER_ADDRESSES must include at least one pubkey"
  );
}

const devnetConnection = new Connection(DEVNET_RPC_URL, commitment);
const mainnetConnection = new Connection(MAINNET_RPC_URL, commitment);
const wallet = anchor.Wallet.local();
const provider = new anchor.AnchorProvider(devnetConnection, wallet, {
  commitment,
});
anchor.setProvider(provider);

const idlPath = path.join(__dirname, "../target/idl/reward_pool.json");
const rawIdl = JSON.parse(fs.readFileSync(idlPath, "utf8")) as Idl & {
  address: string;
};
const program = new anchor.Program(rawIdl as Idl, provider);
const programId = program.programId;

const mintPubkey = new PublicKey(TOKEN_MINT);
const creatorPubkey = new PublicKey(PUMPFUN_CREATOR);
const [poolPDA] = PublicKey.findProgramAddressSync(
  [Buffer.from("pool")],
  programId
);
const [vaultPDA] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault")],
  programId
);
const { BN } = anchor;

type HolderInfo = {
  address: PublicKey;
  balance: anchor.BN;
};

type HolderMap = Map<string, anchor.BN>;

async function fetchPendingCreatorRewards(): Promise<number> {
  const lamports = await devnetConnection.getBalance(vaultPDA, commitment);
  return lamports / LAMPORTS_PER_SOL;
}

async function fetchRealHolderBalances(limit: number): Promise<HolderInfo[]> {
  const largest = await mainnetConnection.getTokenLargestAccounts(
    mintPubkey,
    commitment
  );
  if (!largest.value || largest.value.length === 0) {
    return [];
  }

  const upperBound = Math.min(largest.value.length, limit * 2);
  const tokenAccountPubkeys = largest.value
    .slice(0, upperBound)
    .map((item) => new PublicKey(item.address));

  const accountInfos = await mainnetConnection.getMultipleAccountsInfo(
    tokenAccountPubkeys,
    commitment
  );
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
            tokenAccountPubkeys[idx]?.toBase58() ?? "unknown"
          }`,
        );
        return;
      }

      let amount: anchor.BN;

      if (typeof decoded.amount === "bigint") {
        amount = new BN(decoded.amount.toString());
      } else {
        const amountBuffer = Buffer.from(decoded.amount as Buffer);
        amount = new BN(amountBuffer, undefined, "le");
      }

      if (amount.isZero()) {
        return;
      }

      const key = owner.toBase58();
      const existing = holderMap.get(key) ?? new BN(0);
      holderMap.set(key, existing.add(amount));
    } catch (error) {
      console.warn(
        `⚠️  Unable to decode token account ${tokenAccountPubkeys[
          idx
        ]?.toBase58()}:`,
        error
      );
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

function substituteFakeAddresses(realHolders: HolderInfo[]): HolderInfo[] {
  const count = Math.min(realHolders.length, FAKE_HOLDER_ADDRESSES.length);
  const substituted: HolderInfo[] = [];

  for (let i = 0; i < count; i += 1) {
    substituted.push({
      address: new PublicKey(FAKE_HOLDER_ADDRESSES[i]),
      balance: realHolders[i].balance,
    });
  }

  return substituted;
}

async function distributeRewards(holders: HolderInfo[]): Promise<string> {
  if (holders.length === 0) {
    throw new Error("No holders available for distribution");
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
      }))
    )
    .instruction();

  const tx = new anchor.web3.Transaction().add(ix);
  return provider.sendAndConfirm(tx, []);
}

async function main(): Promise<void> {
  console.log("🚀 Cron bot (mock) started");
  console.log(`Program RPC (devnet): ${DEVNET_RPC_URL}`);
  console.log(`Holder RPC (mainnet): ${MAINNET_RPC_URL}`);
  console.log(`Pool PDA: ${poolPDA.toBase58()}`);
  console.log(`Vault PDA: ${vaultPDA.toBase58()}`);
  console.log(`Fake recipients: ${FAKE_HOLDER_ADDRESSES.join(", ")}`);

  const pendingRewards = await fetchPendingCreatorRewards();
  console.log(`💰 Pending creator rewards: ${pendingRewards.toFixed(6)} SOL`);

  if (pendingRewards < REWARD_THRESHOLD_SOL) {
    console.log(
      `ℹ️  Threshold (${REWARD_THRESHOLD_SOL} SOL) not met. Exiting.`
    );
    return;
  }

  console.log(
    "⚙️  Threshold met. Pump.fun claim would be executed here (mock only)."
  );

  const realHolders = await fetchRealHolderBalances(20);
  console.log(`👥 Retrieved ${realHolders.length} holder entries from Helius.`);
  realHolders.forEach((holder, index) => {
    const isHuman = PublicKey.isOnCurve(holder.address.toBuffer());
    console.log(
      `   ${
        index + 1
      }. ${holder.address.toBase58()} — ${holder.balance.toString()} lamports — onCurve=${isHuman}`
    );
  });

  if (realHolders.length === 0) {
    console.log("⚠️  No holder data returned; aborting distribution.");
    return;
  }

  console.log(
    "ℹ️  Skipping getTokenLargestAccounts call; using fake holder data."
  );
  const mockHolders = FAKE_HOLDER_ADDRESSES.slice(0, 20).map((addr, index) => ({
    address: new PublicKey(addr),
    balance: new BN(index + 1),
  }));

  const holdersForDistribution = substituteFakeAddresses(mockHolders);
  console.log(
    `🎯 Using ${holdersForDistribution.length} fake holders for distribution.`
  );

  const signature = await distributeRewards(holdersForDistribution);
  console.log(`✅ Distribution submitted. Signature: ${signature}`);
}

main()
  .then(() => {
    console.log("✨ Cron bot finished successfully.");
    process.exit(0);
  })
  .catch((error) => {
    console.error(
      "❌ Cron bot failed:",
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  });
