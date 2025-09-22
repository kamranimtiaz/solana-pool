use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("5XdQS3UCAB1qiAjRC6eu1U5K5FH2KQ1Ak6C61SCfXAjw");

#[program]
pub mod reward_pool {
    use super::*;

    /// Initialize a new reward pool for SOL rewards
    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        pool_owner: Pubkey,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        pool.owner = pool_owner;
        pool.total_rewards = 0;
        pool.total_distributed = 0;
        pool.top_holders = Vec::with_capacity(20);
        pool.bump = ctx.bumps.pool;
        pool.vault_bump = ctx.bumps.pool_vault;
        
        msg!("SOL reward pool initialized with owner: {}", pool_owner);
        Ok(())
    }


    /// Register/update top token holders (called periodically or by external script)
    pub fn update_top_holders(
        ctx: Context<UpdateTopHolders>,
        holders: Vec<HolderInfo>,
    ) -> Result<()> {
        require!(holders.len() <= 20, ErrorCode::TooManyHolders);
        
        let pool = &mut ctx.accounts.pool;
        
        // Verify caller is authorized (pool owner or designated updater)
        require!(
            ctx.accounts.authority.key() == pool.owner,
            ErrorCode::Unauthorized
        );
        
        // Sort holders by balance (descending) and take top 10
        let mut sorted_holders = holders;
        sorted_holders.sort_by(|a, b| b.balance.cmp(&a.balance));
        sorted_holders.truncate(20);
        
        pool.top_holders = sorted_holders;
        
        msg!("Updated top {} holders", pool.top_holders.len());
        Ok(())
    }

    /// Distribute SOL rewards to top holders (must provide holder wallet addresses)
    pub fn distribute_rewards(ctx: Context<DistributeRewards>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        let available_rewards = ctx.accounts.pool_vault.lamports();
        
        if available_rewards == 0 {
            msg!("No SOL rewards to distribute");
            return Ok(());
        }
        
        if pool.top_holders.is_empty() {
            msg!("No top holders registered for distribution");
            return Ok(());
        }
        
        // Verify we have enough remaining accounts (must match top holders count)
        require!(
            ctx.remaining_accounts.len() >= pool.top_holders.len(),
            ErrorCode::InsufficientAccounts
        );
        
        // Update total_rewards to current vault balance + already distributed
        pool.total_rewards = available_rewards.checked_add(pool.total_distributed)
            .ok_or(ErrorCode::MathOverflow)?;
        
        // Calculate equal share for all holders
        let equal_share = available_rewards / (pool.top_holders.len() as u64);
        
        if equal_share == 0 {
            msg!("Equal share amount is too small to distribute");
            return Ok(());
        }

        let seeds = &[b"vault".as_ref(), &[pool.vault_bump]];
        let signer = &[&seeds[..]];
        
        let mut total_distributed = 0u64;

        // Distribute equally to each holder
        for (i, holder) in pool.top_holders.iter().enumerate() {
            if i < ctx.remaining_accounts.len() {
                let recipient_account = &ctx.remaining_accounts[i];
                
                // Verify the recipient is the expected holder address
                require!(
                    recipient_account.key() == holder.address,
                    ErrorCode::InvalidRecipient
                );
                
                // Transfer SOL from pool vault to holder
                let transfer_instruction = system_program::Transfer {
                    from: ctx.accounts.pool_vault.to_account_info(),
                    to: recipient_account.clone(),
                };
                
                let cpi_ctx = CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    transfer_instruction,
                    signer,
                );
                
                system_program::transfer(cpi_ctx, equal_share)?;
                
                total_distributed = total_distributed.checked_add(equal_share)
                    .ok_or(ErrorCode::MathOverflow)?;
                
                msg!("Transferred {} lamports equally to holder {}", equal_share, holder.address);
            }
        }

        pool.total_distributed = pool.total_distributed.checked_add(total_distributed)
            .ok_or(ErrorCode::MathOverflow)?;
        
        msg!("Distributed {} lamports to {} holders", total_distributed, pool.top_holders.len());
        Ok(())
    }

    /// Pool owner can withdraw SOL funds (emergency function)
    pub fn owner_withdraw(ctx: Context<OwnerWithdraw>, amount: u64) -> Result<()> {
        let pool = &ctx.accounts.pool;
        
        require!(
            ctx.accounts.owner.key() == pool.owner,
            ErrorCode::Unauthorized
        );
        
        // Check sufficient balance
        require!(
            amount <= ctx.accounts.pool_vault.lamports(),
            ErrorCode::InsufficientBalance
        );
        
        // Transfer SOL from pool vault to owner
        let seeds = &[b"vault".as_ref(), &[pool.vault_bump]];
        let signer = &[&seeds[..]];
        
        let transfer_instruction = system_program::Transfer {
            from: ctx.accounts.pool_vault.to_account_info(),
            to: ctx.accounts.owner.to_account_info(),
        };
        
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            transfer_instruction,
            signer,
        );
        
        system_program::transfer(cpi_ctx, amount)?;
        
        msg!("Pool owner withdrew {} lamports", amount);
        Ok(())
    }

}


#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(
        init,
        payer = payer,
        space = RewardPool::SPACE,
        seeds = [b"pool"],
        bump
    )]
    pub pool: Account<'info, RewardPool>,
    
    /// CHECK: This PDA will receive SOL rewards automatically from Pump.fun
    #[account(
        init,
        payer = payer,
        seeds = [b"vault"],
        bump,
        space = 0
    )]
    pub pool_vault: SystemAccount<'info>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}


#[derive(Accounts)]
pub struct UpdateTopHolders<'info> {
    #[account(
        mut,
        seeds = [b"pool"],
        bump = pool.bump
    )]
    pub pool: Account<'info, RewardPool>,
    
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct DistributeRewards<'info> {
    #[account(
        mut,
        seeds = [b"pool"],
        bump = pool.bump
    )]
    pub pool: Account<'info, RewardPool>,
    
    /// CHECK: This PDA holds SOL rewards
    #[account(
        mut,
        seeds = [b"vault"],
        bump = pool.vault_bump
    )]
    pub pool_vault: SystemAccount<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OwnerWithdraw<'info> {
    #[account(
        mut,
        seeds = [b"pool"],
        bump = pool.bump
    )]
    pub pool: Account<'info, RewardPool>,
    
    /// CHECK: This PDA holds SOL rewards
    #[account(
        mut,
        seeds = [b"vault"],
        bump = pool.vault_bump
    )]
    pub pool_vault: SystemAccount<'info>,
    
    #[account(constraint = owner.key() == pool.owner)]
    pub owner: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[account]
pub struct RewardPool {
    pub owner: Pubkey,              // Pool owner who can withdraw
    pub total_rewards: u64,         // Total rewards ever deposited
    pub total_distributed: u64,     // Total rewards distributed
    pub top_holders: Vec<HolderInfo>, // Top 20 token holders
    pub bump: u8,                   // Pool PDA bump
    pub vault_bump: u8,             // Vault PDA bump
}

impl RewardPool {
    pub const SPACE: usize = 8 + // discriminator
        32 + // owner
        8 +  // total_rewards
        8 +  // total_distributed
        4 + (20 * HolderInfo::SPACE) + // top_holders (max 20)
        1 +  // bump
        1;   // vault_bump
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
    #[msg("Too many holders provided (max 20)")]
    TooManyHolders,
    #[msg("Unauthorized access")]
    Unauthorized,
    #[msg("Insufficient accounts provided for distribution")]
    InsufficientAccounts,
    #[msg("Invalid recipient account")]
    InvalidRecipient,
    #[msg("Insufficient balance for withdrawal")]
    InsufficientBalance,
}