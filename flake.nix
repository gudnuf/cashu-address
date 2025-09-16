{
  description = "Cashu Address development environment with multi-wallet support";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        
        # Create the multi-wallet wrapper script
        wallet = pkgs.writeScriptBin "wallet" ''
          #!${pkgs.bash}/bin/bash
          
          # Cashu Multi-Wallet Manager
          # Manages multiple wallet instances by username
          
          set -euo pipefail
          
          # Configuration
          WALLET_DIR="''${HOME}/.cashu-wallets"
          SCRIPT_DIR="''${CASHU_PROJECT_ROOT:-$(pwd)}"
          
          # Colors for output
          RED='\033[0;31m'
          GREEN='\033[0;32m'
          YELLOW='\033[1;33m'
          BLUE='\033[0;34m'
          NC='\033[0m' # No Color
          
          # Helper functions
          log_info() {
              echo -e "''${GREEN}[INFO]''${NC} $1"
          }
          
          log_warn() {
              echo -e "''${YELLOW}[WARN]''${NC} $1"
          }
          
          log_error() {
              echo -e "''${RED}[ERROR]''${NC} $1"
          }
          
          log_debug() {
              echo -e "''${BLUE}[DEBUG]''${NC} $1"
          }
          
          # Usage information
          show_usage() {
              cat << EOF
          Cashu Multi-Wallet Manager
          
          Usage: wallet [USERNAME] [COMMAND] [ARGS...]
          
          COMMANDS:
              balance                     - Show wallet balance
              mint-bolt11 <amount>       - Mint tokens from Lightning invoice
              address                    - Get your cashu address
              pay <address> <amount>     - Pay to a cashu address
              scan                       - Scan for incoming payments
              
          MANAGEMENT:
              list                       - List all wallet usernames
              info [USERNAME]           - Show wallet info (or current if no username)
              clean [USERNAME]          - Remove wallet database (or current if no username)
              
          EXAMPLES:
              wallet alice balance
              wallet bob mint-bolt11 1000
              wallet charlie pay <address> 500
              wallet list
              wallet info alice
          
          EOF
          }
          
          # Validate username
          validate_username() {
              local username="$1"
              if [[ ! "$username" =~ ^[a-zA-Z0-9_-]+$ ]]; then
                  log_error "Invalid username: '$username'. Only alphanumeric characters, hyphens, and underscores are allowed."
                  exit 1
              fi
          }
          
          # Get wallet database path for username
          get_wallet_db_path() {
              local username="$1"
              echo "''${WALLET_DIR}/''${username}/cashu-wallet.db"
          }
          
          # Get wallet directory for username
          get_wallet_dir() {
              local username="$1"
              echo "''${WALLET_DIR}/''${username}"
          }
          
          # Initialize wallet directory
          init_wallet_dir() {
              local username="$1"
              local wallet_dir
              wallet_dir=$(get_wallet_dir "$username")
              
              if [[ ! -d "$wallet_dir" ]]; then
                  log_info "Creating wallet directory for user: $username"
                  mkdir -p "$wallet_dir"
              fi
          }
          
          # List all wallets
          list_wallets() {
              log_info "Available wallets:"
              if [[ ! -d "$WALLET_DIR" ]]; then
                  log_warn "No wallets directory found at $WALLET_DIR"
                  return 0
              fi
              
              local count=0
              for wallet_dir in "$WALLET_DIR"/*; do
                  if [[ -d "$wallet_dir" ]]; then
                      local username
                      username=$(basename "$wallet_dir")
                      local db_path
                      db_path=$(get_wallet_db_path "$username")
                      
                      if [[ -f "$db_path" ]]; then
                          echo "  • $username"
                          count=$((count + 1))
                      else
                          echo "  • $username (no database)"
                      fi
                  fi
              done
              
              if [[ $count -eq 0 ]]; then
                  log_warn "No wallet databases found"
              else
                  log_info "Found $count wallet(s)"
              fi
          }
          
          # Show wallet info
          show_wallet_info() {
              local username="$1"
              local wallet_dir
              wallet_dir=$(get_wallet_dir "$username")
              local db_path
              db_path=$(get_wallet_db_path "$username")
              
              echo "Wallet Info for: $username"
              echo "  Directory: $wallet_dir"
              echo "  Database: $db_path"
              echo "  Database exists: $(if [[ -f "$db_path" ]]; then echo "Yes"; else echo "No"; fi)"
              
              if [[ -f "$db_path" ]]; then
                  local db_size
                  db_size=$(${pkgs.coreutils}/bin/du -h "$db_path" | cut -f1)
                  echo "  Database size: $db_size"
              fi
          }
          
          # Clean wallet
          clean_wallet() {
              local username="$1"
              local db_path
              db_path=$(get_wallet_db_path "$username")
              
              if [[ -f "$db_path" ]]; then
                  log_warn "Removing database for user: $username"
                  rm "$db_path"
                  log_info "Database removed successfully"
              else
                  log_warn "No database found for user: $username"
              fi
          }
          
          # Run wallet command
          run_wallet_command() {
              local username="$1"
              shift
              local command="$1"
              shift
              
              validate_username "$username"
              init_wallet_dir "$username"
              
              local db_path
              db_path=$(get_wallet_db_path "$username")
              
              log_debug "Running command '$command' for user '$username'"
              log_debug "Database path: $db_path"
              
              # Set environment variable for the wallet to use the specific database
              export CASHU_WALLET_DB="$db_path"
              
              # Change to the script directory to run the CLI
              cd "$SCRIPT_DIR"
              
              # Run the original CLI with the command
              case "$command" in
                  "balance")
                      ${pkgs.bun}/bin/bun run src/cli.ts balance
                      ;;
                  "mint-bolt11")
                      if [[ $# -lt 1 ]]; then
                          log_error "mint-bolt11 requires an amount argument"
                          exit 1
                      fi
                      ${pkgs.bun}/bin/bun run src/cli.ts mint-bolt11 "$1"
                      ;;
                  "address")
                      ${pkgs.bun}/bin/bun run src/cli.ts address
                      ;;
                  "pay")
                      if [[ $# -lt 2 ]]; then
                          log_error "pay requires address and amount arguments"
                          exit 1
                      fi
                      ${pkgs.bun}/bin/bun run src/cli.ts pay "$1" "$2"
                      ;;
                  "scan")
                      ${pkgs.bun}/bin/bun run src/cli.ts scan
                      ;;
                  *)
                      log_error "Unknown command: $command"
                      show_usage
                      exit 1
                      ;;
              esac
          }
          
          # Main script logic
          main() {
              # Create wallets directory if it doesn't exist
              mkdir -p "$WALLET_DIR"
              
              if [[ $# -eq 0 ]]; then
                  show_usage
                  exit 0
              fi
              
              case "$1" in
                  "list")
                      list_wallets
                      ;;
                  "info")
                      if [[ $# -lt 2 ]]; then
                          log_error "info command requires a username"
                          exit 1
                      fi
                      show_wallet_info "$2"
                      ;;
                  "clean")
                      if [[ $# -lt 2 ]]; then
                          log_error "clean command requires a username"
                          exit 1
                      fi
                      clean_wallet "$2"
                      ;;
                  "help" | "--help" | "-h")
                      show_usage
                      ;;
                  *)
                      # Assume first argument is username, rest are command
                      if [[ $# -lt 2 ]]; then
                          log_error "Please provide a username and command"
                          show_usage
                          exit 1
                      fi
                      run_wallet_command "$@"
                      ;;
              esac
          }
          
          # Run main function
          main "$@"
        '';
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            bun
            wallet
          ];
          
          shellHook = ''
            echo "🚀 Cashu Address Multi-Wallet Environment"
            echo "📁 Project: $(pwd)"
            echo ""
            echo "Available commands:"
            echo "  wallet list                    - List all wallets"
            echo "  wallet alice balance          - Check Alice's balance"  
            echo "  wallet bob mint-bolt11 1000   - Mint 1000 sats for Bob"
            echo "  wallet charlie address        - Get Charlie's address"
            echo ""
            echo "💡 Use 'wallet --help' for full usage information"
            echo ""
            
            # Set environment variable so the script knows where the project is
            export CASHU_PROJECT_ROOT="$(pwd)"
          '';
        };
        
        packages.default = wallet;
      });
}
