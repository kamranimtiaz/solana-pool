# Pump.fun Reward Pool - Solana Program

## Overview
This project implements a Solana program using the Anchor framework that automatically distributes Pump.fun creator rewards to the top 10 token holders proportionally based on their holdings.

## Recent Changes (2025-09-20)
- Created complete Anchor program structure with proper account management
- Implemented real SPL token transfers with comprehensive validation
- Added security constraints for mint verification and account ownership
- Removed unstable auto-distribution trigger for better reliability
- Strengthened recipient validation with token program ownership checks
- Fixed InitializePool parameter consistency

## Project Architecture

### Core Program (`programs/reward-pool/src/lib.rs`)
- **RewardPool**: Main account storing pool state, owner, token mint, and top 10 holders
- **Instructions**:
  - `initialize_pool`: Creates new reward pool for a specific token
  - `deposit_rewards`: Deposits creator fees into pool vault
  - `update_top_holders`: Updates the list of top 10 token holders
  - `distribute_rewards`: Distributes rewards proportionally to top holders
  - `owner_withdraw`: Emergency withdrawal function for pool owner

### Key Features
- **Automatic Distribution**: Rewards are distributed proportionally based on token holdings
- **Security**: Comprehensive validation of recipient accounts, mint verification, and ownership checks
- **PDA Management**: Uses Program Derived Addresses for secure vault management
- **Owner Controls**: Pool owner can withdraw funds if needed

### Account Structure
- Pool PDA: `["pool", token_mint]`
- Vault PDA: `["vault", token_mint]`
- Maximum 10 holders tracked per pool
- Proper SPL token account constraints

## Usage Flow
1. **Initialize Pool**: Create pool for specific token mint with designated owner
2. **Configure Creator Rewards**: Set Pump.fun creator wallet to pool vault address
3. **Monitor Holdings**: External script updates top 10 holders periodically
4. **Automatic Distribution**: Call `distribute_rewards` to distribute accumulated rewards
5. **Emergency Controls**: Pool owner can withdraw if needed

## Demo Application (`app/index.js`)
- Demonstrates pool initialization and management
- Shows proportional reward calculation
- Simulates the complete flow from deposit to distribution
- Uses Solana Web3.js for blockchain interaction

## Security Features
- Mint validation for all token accounts
- Recipient ownership verification before transfers
- Token program ownership checks
- PDA-based authority management
- Math overflow protection
- Comprehensive error handling

## Next Steps
1. Deploy program to devnet/mainnet
2. Set up off-chain monitoring for token holder balances
3. Configure Pump.fun creator rewards destination
4. Add comprehensive test suite
5. Implement governance mechanisms if needed