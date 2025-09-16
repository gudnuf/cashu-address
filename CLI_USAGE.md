# Cashu Wallet CLI

A simple command-line interface for interacting with your Cashu wallet with built-in network request logging.

## Features

- 🏦 Full wallet functionality (mint, send, receive, pay)
- 🔍 Network request logging to see all HTTP traffic
- 🎨 Colored output for better readability
- 💬 Interactive REPL mode
- ⚡ Lightning invoice support

## Usage

### Quick Start

Run the CLI in interactive mode:

```bash
bun run cli
# or
bun run wallet
# or
bun run src/cli.ts
```

### Available Commands

#### Wallet Operations

- `balance` - Show current wallet balance
- `info` - Show mint information
- `proofs` - List all proofs in the wallet

#### Minting Tokens

- `mint-quote <amount>` - Create a mint quote for the specified amount
- `mint <quoteId>` - Mint tokens using a quote ID after paying the invoice

#### Sending & Receiving

- `send <amount>` - Create a token to send the specified amount
- `receive <token>` - Receive a Cashu token

#### Lightning Payments

- `melt-quote <invoice>` - Create a melt quote for a Lightning invoice
- `pay <invoice>` - Pay a Lightning invoice directly

#### Cache Management

- `refresh-cache` - Refresh the mint cache
- `clear-cache` - Clear the mint cache

### Examples

#### Interactive Mode

```bash
bun run cli

# Once in interactive mode:
cashu> balance
cashu> info
cashu> mint-quote 1000
cashu> send 500
cashu> exit
```

#### Single Commands

```bash
# Check balance
bun run cli balance

# Get mint info
bun run cli info

# Create a mint quote for 1000 sats
bun run cli mint-quote 1000

# Send 500 sats
bun run cli send 500
```

### Network Logging

The CLI automatically logs all network requests made by the wallet, showing:

- HTTP method and URL
- Request/response bodies (truncated if large)
- Response status codes
- Timestamps

Example output:

```
15:30:45 NET GET https://mint.example.com/v1/info
15:30:45 NET Response: 200 OK
15:30:45 NET Response body: {"name":"Example Mint","version":"0.15.0"...}
```

### Wallet Initialization

The wallet is automatically initialized when you first run any command. It will:

1. Create a SQLite database for storage
2. Generate a BIP39 mnemonic if one doesn't exist
3. Connect to the default mint (http://localhost:8085)
4. Cache mint information for faster subsequent operations

### Configuration

The CLI uses the same wallet configuration as the main application:

- Database: `./cashu-wallet.db`
- Default mint: `http://localhost:8085`

These can be customized by modifying the `getWallet()` call in the CLI code.
