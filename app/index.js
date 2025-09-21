/**
 * SOL Reward Pool Solana Program - Demo Application
 * 
 * This application demonstrates the SOL reward pool functionality for automatically
 * distributing Pump.fun creator rewards (in SOL) equally to top 20 token holders.
 */

const { Connection, PublicKey, clusterApiUrl, LAMPORTS_PER_SOL } = require('@solana/web3.js');

// Configuration
const PROGRAM_ID = new PublicKey('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');
const NETWORK = 'devnet'; // Use devnet for testing

class RewardPoolManager {
    constructor() {
        this.connection = new Connection(clusterApiUrl(NETWORK));
        console.log(`Connected to Solana ${NETWORK}`);
    }

    /**
     * Initialize a new SOL reward pool
     * @param {PublicKey} owner - Pool owner public key
     */
    async initializePool(owner) {
        console.log(`\n🚀 Initializing SOL reward pool`);
        console.log(`Pool owner: ${owner.toString()}`);
        
        // Calculate pool PDA (Program Derived Address)
        const [poolPDA] = await PublicKey.findProgramAddressSync(
            [Buffer.from('pool')],
            PROGRAM_ID
        );
        
        // Calculate vault PDA (this will receive SOL automatically from Pump.fun)
        const [vaultPDA] = await PublicKey.findProgramAddressSync(
            [Buffer.from('vault')],
            PROGRAM_ID
        );
        
        console.log(`📍 Pool PDA: ${poolPDA.toString()}`);
        console.log(`🏦 Vault PDA: ${vaultPDA.toString()}`);
        console.log(`💡 Set this vault address as your Pump.fun creator wallet!`);
        
        return {
            poolPDA,
            vaultPDA,
            owner
        };
    }

    /**
     * Simulate Pump.fun automatically depositing SOL rewards into the vault
     * @param {Object} poolInfo - Pool information
     * @param {number} solAmount - Amount in SOL to simulate
     */
    async simulateSOLDeposit(poolInfo, solAmount) {
        console.log(`\n💰 Pump.fun automatically deposited ${solAmount} SOL to vault`);
        console.log(`Vault: ${poolInfo.vaultPDA.toString()}`);
        
        // In reality, Pump.fun would send SOL directly to the vault PDA
        // No instruction call needed - it's automatic!
        console.log('✅ SOL rewards received automatically');
        
        console.log(`💡 Call distribute_rewards to send rewards to top holders`);
    }

    /**
     * Update the top 20 token holders
     * @param {Array} holders - Array of holder information
     */
    async updateTopHolders(holders) {
        console.log(`\n👥 Updating top 20 token holders:`);
        
        // Sort holders by balance (descending) and take top 20
        const topHolders = holders
            .sort((a, b) => b.balance - a.balance)
            .slice(0, 20);
        
        console.log(`First 10 of ${topHolders.length} holders:`);
        topHolders.slice(0, 10).forEach((holder, index) => {
            console.log(`${index + 1}. ${holder.address} - ${holder.balance} tokens`);
        });
        if (topHolders.length > 10) {
            console.log(`... and ${topHolders.length - 10} more holders`);
        }
        
        console.log('✅ Top 20 holders updated successfully');
        return topHolders;
    }

    /**
     * Simulate SOL reward distribution to top 20 holders (equal distribution)
     * @param {number} totalSOL - Total SOL amount to distribute
     */
    async simulateDistribution(totalSOL) {
        console.log(`\n🎁 Distributing ${totalSOL} SOL equally among top 20 holders:`);
        
        // Mock top 20 holders for demonstration
        const mockHolders = [
            { address: 'H1LD3R1...abc123', balance: 1000000 },
            { address: 'H1LD3R2...def456', balance: 800000 },
            { address: 'H1LD3R3...ghi789', balance: 600000 },
            { address: 'H1LD3R4...jkl012', balance: 400000 },
            { address: 'H1LD3R5...mno345', balance: 350000 },
            { address: 'H1LD3R6...pqr678', balance: 300000 },
            { address: 'H1LD3R7...stu901', balance: 250000 },
            { address: 'H1LD3R8...vwx234', balance: 200000 },
            { address: 'H1LD3R9...yza567', balance: 180000 },
            { address: 'H1LD3R10...bcd890', balance: 160000 },
            { address: 'H1LD3R11...efg123', balance: 140000 },
            { address: 'H1LD3R12...hij456', balance: 120000 },
            { address: 'H1LD3R13...klm789', balance: 100000 },
            { address: 'H1LD3R14...nop012', balance: 90000 },
            { address: 'H1LD3R15...qrs345', balance: 80000 },
            { address: 'H1LD3R16...tuv678', balance: 70000 },
            { address: 'H1LD3R17...wxy901', balance: 60000 },
            { address: 'H1LD3R18...zab234', balance: 50000 },
            { address: 'H1LD3R19...cde567', balance: 40000 },
            { address: 'H1LD3R20...fgh890', balance: 30000 },
        ];
        
        // Equal distribution calculation
        const equalShare = totalSOL / mockHolders.length;
        
        console.log('Equal distribution breakdown:');
        console.log(`Each holder receives: ${equalShare.toFixed(4)} SOL`);
        console.log('Top 10 examples:');
        mockHolders.slice(0, 10).forEach((holder, index) => {
            console.log(`${index + 1}. ${holder.address}: ${equalShare.toFixed(4)} SOL (equal share)`);
        });
        console.log(`... and 10 more holders receive ${equalShare.toFixed(4)} SOL each`);
        
        console.log('✅ Equal SOL distribution completed successfully');
    }

    /**
     * Demonstrate pool owner SOL withdrawal
     * @param {Object} poolInfo - Pool information
     * @param {number} solAmount - Amount in SOL to withdraw
     */
    async ownerWithdraw(poolInfo, solAmount) {
        console.log(`\n🏧 Pool owner withdrawing ${solAmount} SOL`);
        console.log(`Owner: ${poolInfo.owner.toString()}`);
        console.log('✅ SOL withdrawal completed successfully');
    }

    /**
     * Display pool statistics
     * @param {Object} poolInfo - Pool information
     */
    async displayPoolStats(poolInfo) {
        console.log(`\n📊 SOL Pool Statistics:`);
        console.log(`Pool Address: ${poolInfo.poolPDA.toString()}`);
        console.log(`Vault Address: ${poolInfo.vaultPDA.toString()}`);
        console.log(`Owner: ${poolInfo.owner.toString()}`);
        console.log(`Total SOL Rewards Received: 5.0 SOL (simulated)`);
        console.log(`Total SOL Distributed: 3.0 SOL (simulated)`);
        console.log(`Available SOL Balance: 2.0 SOL (simulated)`);
    }
}

// Demo function to showcase the SOL reward pool functionality
async function runDemo() {
    console.log('🎯 Pump.fun SOL Reward Pool Demo');
    console.log('='.repeat(50));
    
    const manager = new RewardPoolManager();
    
    // Mock pool owner address
    const poolOwner = new PublicKey('11111111111111111111111111111112'); // System program as example
    
    try {
        // 1. Initialize the SOL reward pool
        const poolInfo = await manager.initializePool(poolOwner);
        
        // 2. Update top 20 holders (normally done by external monitoring script)
        const holders = [
            { address: 'H1LD3R1...abc123', balance: 1000000 },
            { address: 'H1LD3R2...def456', balance: 800000 },
            { address: 'H1LD3R3...ghi789', balance: 600000 },
            { address: 'H1LD3R4...jkl012', balance: 400000 },
            { address: 'H1LD3R5...mno345', balance: 350000 },
            { address: 'H1LD3R6...pqr678', balance: 300000 },
            { address: 'H1LD3R7...stu901', balance: 250000 },
            { address: 'H1LD3R8...vwx234', balance: 200000 },
            { address: 'H1LD3R9...yza567', balance: 180000 },
            { address: 'H1LD3R10...bcd890', balance: 160000 },
            { address: 'H1LD3R11...efg123', balance: 140000 },
            { address: 'H1LD3R12...hij456', balance: 120000 },
            { address: 'H1LD3R13...klm789', balance: 100000 },
            { address: 'H1LD3R14...nop012', balance: 90000 },
            { address: 'H1LD3R15...qrs345', balance: 80000 },
            { address: 'H1LD3R16...tuv678', balance: 70000 },
            { address: 'H1LD3R17...wxy901', balance: 60000 },
            { address: 'H1LD3R18...zab234', balance: 50000 },
            { address: 'H1LD3R19...cde567', balance: 40000 },
            { address: 'H1LD3R20...fgh890', balance: 30000 },
        ];
        
        await manager.updateTopHolders(holders);
        
        // 3. Simulate Pump.fun automatically depositing SOL rewards to vault
        await manager.simulateSOLDeposit(poolInfo, 1.0); // 1 SOL
        
        // 4. Simulate distribution to top holders  
        await manager.simulateDistribution(1.0); // 1 SOL
        
        // 5. Show pool statistics
        await manager.displayPoolStats(poolInfo);
        
        // 6. Demonstrate owner withdrawal capability
        await manager.ownerWithdraw(poolInfo, 0.5); // 0.5 SOL
        
        console.log(`\n✨ Demo completed successfully!`);
        console.log('\n📝 Next Steps:');
        console.log('1. Deploy the Solana program to devnet/mainnet');
        console.log('2. Set up monitoring for token holder balances');
        console.log('3. Configure Pump.fun creator wallet to point to vault PDA');
        console.log('4. Test with real token holders and SOL rewards');
        console.log('5. Call distribute_rewards periodically to send rewards to holders');
        
    } catch (error) {
        console.error('❌ Demo failed:', error.message);
    }
}

// Export for potential testing
module.exports = { RewardPoolManager };

// Run demo if this file is executed directly
if (require.main === module) {
    runDemo();
}