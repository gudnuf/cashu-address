#!/usr/bin/env bun

import { Command } from "commander";
import { logger, sumProofs } from "./utils";
import chalk from "chalk";
import { getWallet, type Wallet } from "./wallet/index";

type WalletState = {
  wallet: any;
  initialized: boolean;
};

let walletState: WalletState = {
  wallet: null,
  initialized: false,
};

async function initializeWallet(): Promise<Wallet> {
  if (walletState.initialized) {
    return walletState.wallet;
  }

  logger.info("Initializing wallet...");
  try {
    walletState.wallet = await getWallet();
    walletState.initialized = true;
    logger.info(chalk.green("✓ Wallet initialized successfully"));
    return walletState.wallet;
  } catch (error) {
    logger.error(`Failed to initialize wallet: ${error}`);
    throw error;
  }
}

// CLI Commands

async function showBalance() {
  const wallet = await initializeWallet();
  try {
    const balance = await wallet.getBalance();
    logger.info(`Current balance: ${chalk.bold.green(balance)} sats`);
  } catch (error) {
    logger.error(`Failed to get balance: ${error}`);
  }
}

async function mintBolt11(amount: number) {
  const wallet = await initializeWallet();
  try {
    logger.info(`Creating mint quote for ${amount} sats...`);
    const quote = await wallet.createMintQuote(amount);
    logger.info(chalk.bold("Mint Quote Created:"));
    logger.info(`Quote ID: ${quote.quote}`);
    logger.info(`Amount: ${quote.amount} sats`);
    logger.info(`Invoice: ${chalk.cyan(quote.request)}`);
    logger.info(`Expiry: ${new Date(quote.expiry * 1000).toLocaleString()}`);
    logger.info(
      "\n" + chalk.yellow("⚡ Please pay this invoice to mint tokens..."),
    );
    logger.info(chalk.dim("Waiting for payment..."));

    let paymentCompleted = false;
    const pollInterval = 2000;
    const maxAttempts = 10;
    let attempts = 0;

    while (!paymentCompleted && attempts < maxAttempts) {
      try {
        const updatedQuote = await wallet.checkMintQuote(quote.quote);

        if (updatedQuote.state === "PAID") {
          paymentCompleted = true;
          logger.info(chalk.green("✓ Payment received! Minting tokens..."));

          // Mint the tokens
          const proofs = await wallet.mintProofs(quote.amount, quote.quote);
          const mintedAmount = sumProofs(proofs);

          // Store proofs in database
          await wallet.addProofs(proofs);

          logger.info(
            chalk.green(`✓ Successfully minted ${mintedAmount} sats!`),
          );
          logger.info(`Received ${proofs.length} proofs`);
          return;
        }

        // Show progress indicator
        if (attempts % 15 === 0 && attempts > 0) {
          // Every 30 seconds
          logger.info(
            chalk.dim(
              `Still waiting for payment... (${Math.floor((attempts * pollInterval) / 1000)}s)`,
            ),
          );
        }

        attempts++;
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      } catch (pollError) {
        logger.error(`Error checking payment status: ${pollError}`);
        attempts++;
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }
    }

    if (!paymentCompleted) {
      logger.error(
        chalk.red(
          "⚠️  Payment timeout reached. The invoice may still be valid.",
        ),
      );
      logger.info(`You can manually check and mint with: mint ${quote.quote}`);
    }
  } catch (error) {
    logger.error(`Failed to create mint quote: ${error}`);
  }
}

// CLI Setup
const program = new Command();

program
  .name("cashu-wallet")
  .description("A simple CLI for interacting with your Cashu wallet")
  .version("1.0.0");

program
  .command("balance")
  .description("Show current wallet balance")
  .action(showBalance);

program
  .command("mint-bolt11 <amount>")
  .description(
    "Create mint quote and wait for payment to complete automatically",
  )
  .action((amount) => mintBolt11(parseInt(amount)));

program
  .command("address")
  .description("Get your cashu address for receiving silent payments")
  .action(async () => {
    try {
      const wallet = await initializeWallet();
      const address = await wallet.getCashuAddress();
      logger.info(chalk.green("Your Cashu Address:"));
      logger.info(chalk.bold(address));
    } catch (error) {
      logger.error("Error getting cashu address:", error);
      process.exit(1);
    }
  });

program
  .command("pay")
  .description("Pay to a cashu address")
  .argument("<address>", "Cashu address to pay to")
  .argument("<amount>", "Amount to pay in sats")
  .action(async (address: string, amountStr: string) => {
    try {
      const amount = parseInt(amountStr);
      if (isNaN(amount) || amount <= 0) {
        logger.error("Invalid amount. Must be a positive number.");
        process.exit(1);
      }

      const wallet = await initializeWallet();
      const balance = await wallet.getBalance();

      if (balance < amount) {
        logger.error(
          `Insufficient balance. You have ${balance} sats but need ${amount} sats.`,
        );
        process.exit(1);
      }

      logger.info(`Paying ${amount} sats to ${address}...`);

      const result = await wallet.payCashuAddress(address, amount);

      logger.info(chalk.green("Payment successful!"));
      logger.info(`Bob will receive ${sumProofs(result.bobProofs)} sats`);
      logger.info(`Your change: ${sumProofs(result.aliceChange)} sats`);
      logger.info(`Spent secret for Bob to scan: ${result.spentSecret}`);

      const newBalance = await wallet.getBalance();
      logger.info(`New balance: ${newBalance} sats`);
    } catch (error) {
      logger.error("Error making payment:", error);
      process.exit(1);
    }
  });

program
  .command("scan")
  .description("Scan for payments to your cashu address")
  .action(async () => {
    try {
      const wallet = await initializeWallet();
      logger.info("Scanning for payments...");

      await wallet.scanForPayments();
    } catch (error) {
      logger.error("Error scanning for payments:", error);
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse();
