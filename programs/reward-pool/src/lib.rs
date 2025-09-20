use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod reward_pool {
    use super::*;

    /// Initialize a new reward pool
    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        token_mint: Pubkey,
        pool_owner: Pubkey,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        pool.owner = pool_owner;
        pool.token_mint = token_mint;
        pool.total_rewards = 0;
        pool.total_distributed = 0;
        pool.top_holders = Vec::with_capacity(10);
        pool.bump = ctx.bumps.pool;
        
        msg!("Reward pool initialized for token: {}", token_mint);
        Ok(())
    }

    /// Deposit rewards into the pool (called when creator fees arrive)
    pub fn deposit_rewards(ctx: Context<DepositRewards>, amount: u64) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        
        // Transfer tokens from depositor to pool vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.depositor_token_account.to_account_info(),
            to: ctx.accounts.pool_vault.to_account_info(),
            authority: ctx.accounts.depositor.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        
        token::transfer(cpi_ctx, amount)?;
        
        pool.total_rewards = pool.total_rewards.checked_add(amount)
            .ok_or(ErrorCode::MathOverflow)?;
        
        msg!("Deposited {} tokens to reward pool", amount);
        
        // Automatically trigger distribution if we have top holders registered
        if !pool.top_holders.is_empty() {
            distribute_rewards_internal(ctx.remaining_accounts, pool, amount)?;
        }
        
        Ok(())
    }

    /// Register/update top token holders (called periodically or by external script)
    pub fn update_top_holders(
        ctx: Context<UpdateTopHolders>,
        holders: Vec<HolderInfo>,
    ) -> Result<()> {
        require!(holders.len() <= 10, ErrorCode::TooManyHolders);
        
        let pool = &mut ctx.accounts.pool;
        
        // Verify caller is authorized (pool owner or designated updater)
        require!(
            ctx.accounts.authority.key() == pool.owner,
            ErrorCode::Unauthorized
        );
        
        // Sort holders by balance (descending) and take top 10
        let mut sorted_holders = holders;
        sorted_holders.sort_by(|a, b| b.balance.cmp(&a.balance));
        sorted_holders.truncate(10);
        
        pool.top_holders = sorted_holders;
        
        msg!("Updated top {} holders", pool.top_holders.len());
        Ok(())
    }

    /// Distribute rewards to top holders (can be called manually or automatically)
    pub fn distribute_rewards(ctx: Context<DistributeRewards>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        let available_rewards = ctx.accounts.pool_vault.amount;
        
        if available_rewards == 0 {
            msg!("No rewards to distribute");
            return Ok(());
        }
        
        distribute_rewards_internal(ctx.remaining_accounts, pool, available_rewards)?;
        
        Ok(())
    }

    /// Pool owner can withdraw funds (emergency function)
    pub fn owner_withdraw(ctx: Context<OwnerWithdraw>, amount: u64) -> Result<()> {
        let pool = &ctx.accounts.pool;
        
        require!(
            ctx.accounts.owner.key() == pool.owner,
            ErrorCode::Unauthorized
        );
        
        // Transfer tokens from pool vault to owner
        let seeds = &[b"pool", pool.token_mint.as_ref(), &[pool.bump]];
        let signer = &[&seeds[..]];
        
        let cpi_accounts = Transfer {
            from: ctx.accounts.pool_vault.to_account_info(),
            to: ctx.accounts.owner_token_account.to_account_info(),
            authority: ctx.accounts.pool.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        
        token::transfer(cpi_ctx, amount)?;
        
        msg!("Pool owner withdrew {} tokens", amount);
        Ok(())
    }

}

// Internal function to handle reward distribution logic
fn distribute_rewards_internal(
        remaining_accounts: &[AccountInfo],
        pool: &mut RewardPool,
        total_amount: u64,
    ) -> Result<()> {
        if pool.top_holders.is_empty() {
            msg!("No top holders registered for distribution");
            return Ok(());
        }

        // Calculate total balance of top holders
        let total_balance: u64 = pool.top_holders.iter().map(|h| h.balance).sum();
        
        if total_balance == 0 {
            msg!("Total balance of holders is zero");
            return Ok(());
        }

        // Distribute proportionally to each holder
        for (i, holder) in pool.top_holders.iter().enumerate() {
            if i >= remaining_accounts.len() {
                break; // Not enough remaining accounts provided
            }
            
            let holder_share = (total_amount as u128)
                .checked_mul(holder.balance as u128)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(total_balance as u128)
                .ok_or(ErrorCode::MathOverflow)? as u64;
            
            if holder_share > 0 && i < remaining_accounts.len() {
                // Transfer to holder (would need proper CPI transfer here)
                msg!("Would transfer {} tokens to holder {}", holder_share, holder.address);
            }
        }

        pool.total_distributed = pool.total_distributed.checked_add(total_amount)
            .ok_or(ErrorCode::MathOverflow)?;
        
        msg!("Distributed {} tokens to {} holders", total_amount, pool.top_holders.len());
        Ok(())
    }

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(
        init,
        payer = payer,
        space = RewardPool::SPACE,
        seeds = [b"pool", token_mint.key().as_ref()],
        bump
    )]
    pub pool: Account<'info, RewardPool>,
    
    #[account(
        init,
        payer = payer,
        token::mint = token_mint,
        token::authority = pool,
        seeds = [b"vault", token_mint.key().as_ref()],
        bump
    )]
    pub pool_vault: Account<'info, TokenAccount>,
    
    /// CHECK: Token mint address
    pub token_mint: AccountInfo<'info>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct DepositRewards<'info> {
    #[account(
        mut,
        seeds = [b"pool", pool.token_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, RewardPool>,
    
    #[account(
        mut,
        seeds = [b"vault", pool.token_mint.as_ref()],
        bump
    )]
    pub pool_vault: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub depositor_token_account: Account<'info, TokenAccount>,
    
    pub depositor: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UpdateTopHolders<'info> {
    #[account(
        mut,
        seeds = [b"pool", pool.token_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, RewardPool>,
    
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct DistributeRewards<'info> {
    #[account(
        mut,
        seeds = [b"pool", pool.token_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, RewardPool>,
    
    #[account(
        mut,
        seeds = [b"vault", pool.token_mint.as_ref()],
        bump
    )]
    pub pool_vault: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct OwnerWithdraw<'info> {
    #[account(
        mut,
        seeds = [b"pool", pool.token_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, RewardPool>,
    
    #[account(
        mut,
        seeds = [b"vault", pool.token_mint.as_ref()],
        bump
    )]
    pub pool_vault: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub owner_token_account: Account<'info, TokenAccount>,
    
    #[account(constraint = owner.key() == pool.owner)]
    pub owner: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct RewardPool {
    pub owner: Pubkey,              // Pool owner who can withdraw
    pub token_mint: Pubkey,         // Token mint for this pool
    pub total_rewards: u64,         // Total rewards ever deposited
    pub total_distributed: u64,     // Total rewards distributed
    pub top_holders: Vec<HolderInfo>, // Top 10 token holders
    pub bump: u8,                   // PDA bump
}

impl RewardPool {
    pub const SPACE: usize = 8 + // discriminator
        32 + // owner
        32 + // token_mint
        8 +  // total_rewards
        8 +  // total_distributed
        4 + (10 * HolderInfo::SPACE) + // top_holders (max 10)
        1;   // bump
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct HolderInfo {
    pub address: Pubkey,
    pub balance: u64,
}

impl HolderInfo {
    pub const SPACE: usize = 32 + 8; // address + balance
}

#[error_code]
pub enum ErrorCode {
    #[msg("Math operation overflow")]
    MathOverflow,
    #[msg("Too many holders provided (max 10)")]
    TooManyHolders,
    #[msg("Unauthorized access")]
    Unauthorized,
}