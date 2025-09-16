# Cashu Multi-Wallet Manager

The Cashu Multi-Wallet Manager allows you to manage multiple separate wallet instances, each identified by a username. Each wallet has its own database, keys, and balance, providing complete isolation between different users or use cases.

## Quick Start

1. Enter the Nix development environment:
   ```bash
   nix develop
   ```

2. The `wallet` command is now available with helpful examples shown in the shell startup.

## Usage

### Basic Commands

```bash
# List all wallets
wallet list

# Get wallet address for a user
wallet alice address
wallet bob address

# Check balance for a user
wallet alice balance
wallet bob balance

# Mint tokens for a user
wallet alice mint-bolt11 1000

# Pay from one user to another
wallet alice pay <bob-address> 500

# Scan for payments
wallet alice scan
```

### Management Commands

```bash
# Show wallet information
wallet info alice

# Remove a wallet database (careful!)
wallet clean alice

# Show help
wallet --help
```

## How It Works

- **Isolated Wallets**: Each username gets its own wallet database stored in `~/.cashu-wallets/<username>/cashu-wallet.db`
- **Separate Keys**: Each wallet generates its own mnemonic and silent payment keys
- **Independent Balances**: Wallets don't share funds or state
- **Same Mint**: All wallets currently use the same mint URL (configurable)

## Directory Structure

```
~/.cashu-wallets/
├── alice/
│   └── cashu-wallet.db
├── bob/
│   └── cashu-wallet.db
└── charlie/
    └── cashu-wallet.db
```

## Examples

### Setting up two users and transferring funds

```bash
# Create addresses for both users
wallet alice address
wallet bob address

# Mint some tokens for Alice
wallet alice mint-bolt11 2000

# Check Alice's balance
wallet alice balance

# Alice pays Bob 500 sats
wallet alice pay <bob-address> 500

# Bob scans for payments
wallet bob scan

# Check both balances
wallet alice balance
wallet bob balance
```

### Managing wallets

```bash
# See all wallets
wallet list

# Get detailed info about a wallet
wallet info alice

# Clean up a test wallet
wallet clean test-user
```

## Technical Details

- The wrapper script sets the `CASHU_WALLET_DB` environment variable to point to the user-specific database
- Each wallet instance uses the same underlying cashu-ts library but with isolated storage
- Wallets are created on-demand when first accessed
- The original CLI commands (`bun run src/cli.ts`) still work for single-user scenarios

## Development

The multi-wallet functionality is implemented through:

1. **Wrapper Script**: `wallet` bash script that manages user contexts
2. **Environment Variable**: `CASHU_WALLET_DB` to specify database path
3. **Wallet Modification**: Updated wallet creation to respect the environment variable
4. **Nix Integration**: Flake provides the wrapper script and development environment

All original functionality remains intact while adding the multi-user layer on top.
