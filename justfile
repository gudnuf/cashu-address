# Justfile for common project tasks

# Default recipe - show available commands
default:
    @just --list

# Development environment setup
setup:
    @echo "🚀 Setting up development environment..."
    cd typescript && bun install
    @echo "✅ Setup complete!"

# TypeScript commands
ts-run:
    @echo "🎯 Running TypeScript algorithm..."
    cd typescript && bun run index.ts

ts-build:
    @echo "🔨 Building TypeScript..."
    cd typescript && bun run build

ts-clean:
    @echo "🧹 Cleaning TypeScript build artifacts..."
    cd typescript && bun run clean

# Rust commands  
rust-run:
    @echo "🦀 Running Rust algorithm..."
    cd rust && cargo run

rust-build:
    @echo "🔨 Building Rust..."
    cd rust && cargo build

rust-build-release:
    @echo "🚀 Building Rust (release)..."
    cd rust && cargo build --release

rust-test:
    @echo "🧪 Testing Rust..."
    cd rust && cargo test

rust-clean:
    @echo "🧹 Cleaning Rust build artifacts..."
    cd rust && cargo clean

# Run both implementations
run-all:
    @echo "🎯 Running both implementations..."
    @echo "\n📦 TypeScript:"
    just ts-run
    @echo "\n🦀 Rust:"
    just rust-run

# Clean everything
clean-all:
    @echo "🧹 Cleaning all build artifacts..."
    just ts-clean
    just rust-clean

# Development helpers
dev-ts:
    @echo "🔄 Starting TypeScript development mode..."
    cd typescript && bun --watch run index.ts

check:
    @echo "🔍 Checking project health..."
    @echo "TypeScript:"
    cd typescript && bun --version
    @echo "Rust:"
    cd rust && cargo --version
    @echo "✅ All tools available!"
