import { describe, it, expect, afterAll } from "bun:test";
import { getWallet, type Wallet } from "./wallet";
import { sumProofs } from "./utils";

describe("Payment and Discovery Integration Test", () => {
  const testAmount = 100;

  // Helper function to initialize wallet like CLI does
  async function initializeWallet(dbPath?: string): Promise<Wallet> {
    return await getWallet({
      dbPath: dbPath || "./cashu-wallet.db",
      mintUrl: "http://localhost:8085",
    });
  }

  afterAll(async () => {
    // Clean up test databases
    try {
      await import("fs").then(fs => {
        try { fs.unlinkSync("./test-alice-wallet.db"); } catch {}
        try { fs.unlinkSync("./test-bob-wallet.db"); } catch {}
      });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it("should demonstrate complete payment and discovery flow", async () => {
    const aliceWallet = await initializeWallet("./test-alice-wallet.db");
    const bobWallet = await initializeWallet("./test-bob-wallet.db");

    const bobAddress = await bobWallet.getCashuAddress();
    const initialAliceBalance = await aliceWallet.getBalance();

    // If Alice doesn't have enough balance, mint some tokens first
    if (initialAliceBalance < testAmount) {
      try {
        const mintAmount = testAmount + 100;
        const mintQuote = await aliceWallet.createMintQuote(mintAmount);
        
        let paymentCompleted = false;
        const pollInterval = 2000;
        const maxAttempts = 10;
        let attempts = 0;

        while (!paymentCompleted && attempts < maxAttempts) {
          try {
            const updatedQuote = await aliceWallet.checkMintQuote(mintQuote.quote);

            if (updatedQuote.state === "PAID") {
              paymentCompleted = true;
              const proofs = await aliceWallet.mintProofs(mintQuote.amount, mintQuote.quote);
              await aliceWallet.addProofs(proofs);
              break;
            }

            attempts++;
            await new Promise((resolve) => setTimeout(resolve, pollInterval));
          } catch (pollError) {
            attempts++;
            await new Promise((resolve) => setTimeout(resolve, pollInterval));
          }
        }

        if (!paymentCompleted) {
          return; // Skip test if payment timeout
        }
        
      } catch (error) {
        return; // Skip test if mint unavailable
      }
    }

    const balance = await aliceWallet.getBalance();
    if (balance < testAmount) {
      throw new Error("Insufficient balance");
    }

    const result = await aliceWallet.payCashuAddress(bobAddress, testAmount);    
    
    const initialBobBalance = await bobWallet.getBalance();

    await bobWallet.scanForPayments();
    
    const bobBalanceAfterScan = await bobWallet.getBalance();
    const balanceIncrease = bobBalanceAfterScan - initialBobBalance;
    const bobProofsAmount = sumProofs(result.bobProofs);

    console.log("initialBobBalance", initialBobBalance);
    console.log("bobBalanceAfterScan", bobBalanceAfterScan);
    console.log("balanceIncrease", balanceIncrease);
    console.log("bobProofsAmount", bobProofsAmount);
    
    expect(balanceIncrease).toBeGreaterThan(0);
    expect(balanceIncrease).toBe(bobProofsAmount);
    
    aliceWallet.closeDatabase();
    bobWallet.closeDatabase();
  }, 60000); // 60 second timeout

  it("should handle scanning when no payments are available", async () => {
    const freshWallet = await initializeWallet("./test-fresh-wallet.db");

    const initialBalance = await freshWallet.getBalance();    
    await freshWallet.scanForPayments();
    const finalBalance = await freshWallet.getBalance();
    freshWallet.closeDatabase();
    try {
      await import("fs").then(fs => fs.promises.unlink("./test-fresh-wallet.db"));
    } catch (error) {      
    }

    expect(finalBalance).toBe(initialBalance);
  });
});