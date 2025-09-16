# Cashu Address

This is a concept demo based on bitcoin's silent payments ([BIP-352](https://en.bitcoin.it/wiki/BIP_0352)) for silent nuts where a sender (Alice) can natively send payments to Bob with just his mint url and public keys.

> [!WARNING]
> Still a work in progess and the crypto has not been verified.

## Basic Usage

> NOTE: You must be using a mint that returns all spent secrets from it's `/v1/spent-secrets` endpoint. This will require future optimizations to work well.

### Installation

Optionally, you can use the Nix flake to enter a development shell:

```bash
nix develop
```

Install using Bun:

```bash
bun install
```

### Getting Started

1. **Load your wallet** by minting tokens from a Lightning invoice:

   ```bash
   bun run cli mint-bolt11 <bolt11_invoice>
   ```

2. **Generate a Cashu address** to receive silent payments:

   ```bash
   bun run cli generate-address
   ```

3. **Make a payment** to a Cashu address:

   ```bash
   bun run cli pay <cashu_address> <amount>
   ```

4. **Scan for incoming payments** by checking spent secrets:
   ```bash
   bun run cli scan
   ```

This allows you to test the silent payment functionality where payments can be sent to your public address without revealing the connection between sender and receiver.

## Protocol Specification

Alice will use an ephemeral keypair along with Bob's public keys to compute a shared secret from which Bob can find his received outputs. The trick is that Alice must use her ephemeral public key as the secret for the single input proof to this silent payment. When Alice pays Bob, her public key will be revealed in the mint's spent secrets.

### 1. Bob's Setup (Key Generation)

Bob generates two key pairs for silent payments:

- **Scan Key Pair**: `(scan_privkey, scan_pubkey)` - Used to detect incoming payments
- **Spend Key Pair**: `(spend_privkey, spend_pubkey)` - Used to spend received payments

Bob publishes his **Cashu Address** in the format: `{mintUrl}:{scan_pubkey}:{spend_pubkey}`

Both public keys are compressed secp256k1 points (33 bytes, 66 hex characters) with 02/03 prefix.

### 2. Alice's Payment Construction

When Alice wants to send `amount` to Bob's Cashu Address:

1. **Parse Cashu Address**: Alice extracts `mintUrl`, `scan_pubkey`, and `spend_pubkey` from Bob's address

2. **Generate Ephemeral Key**: Alice creates a random ephemeral key pair `(ephemeral_privkey, ephemeral_pubkey)`

3. **Create Special Proof**: Alice first creates a "special proof" using her ephemeral public key as the secret:

   ```python
   special_secret = hex_encode(ephemeral_pubkey_compressed)
   special_proof = wallet.send(total_input_amount, input_proofs, outputData(special_secret))
   ```

   The special proof consumes all input proofs and creates a single output with the ephemeral pubkey as its secret.

4. **Compute Shared Secret**: Alice performs ECDH with Bob's scan key:

   ```python
   shared_secret = ECDH(ephemeral_privkey, bob_scan_pubkey)
   ```

5. **Generate Silent Outputs**: Alice creates outputs for Bob using the shared secret:

   ```python
   for k = 0, 1, 2, ... (one per output denomination):
     tweak = SHA256("silent_output" || shared_secret || [k])
     tweak_point = tweak * G
     output_pubkey = bob_spend_pubkey + tweak_point
     output_secret = hex_encode(SHA256("output" || output_pubkey_compressed))
     blinding_factor = SHA256("blinder" || output_secret_bytes || [k])
   ```

6. **Create Final Transaction**: Alice spends the special proof to create outputs for Bob:

   ```python
   {bob_proofs, alice_change} = wallet.send(amount, [special_proof], silent_output_factory)
   ```

7. **Signal Broadcast**: Alice's ephemeral public key becomes a "spent secret" that Bob can scan for

### 3. Bob's Payment Discovery

Bob scans for payments by monitoring spent secrets on his mint:

1. **Fetch Spent Secrets**: Bob queries the mint's `/v1/spent-secrets` endpoint

2. **Filter Ephemeral Keys**: Bob filters for exactly 66 hex character secrets (33-byte compressed pubkeys)

3. **Test Each Potential Payment**: For each ephemeral key candidate:

   ```python
   try:
     ephemeral_pubkey = secp256k1.Point.fromHex(spent_secret)
     shared_secret = ECDH(bob_scan_privkey, ephemeral_pubkey)
   except:
     continue  // Skip invalid points
   ```

4. **Generate Potential Outputs**: Bob recreates the same derivation Alice used:

   ```python
   for k = 0, 1, 2, ..., MAX_OUTPUTS_TO_SCAN (typically 8):
     tweak = SHA256("silent_output" || shared_secret || [k])
     tweak_point = tweak * G
     output_pubkey = bob_spend_pubkey + tweak_point
     output_secret = hex_encode(SHA256("output" || output_pubkey_compressed))
     blinding_factor = SHA256("blinder" || output_secret_bytes || [k])

     # Create OutputData with amount=0 (amount will be filled by restore)
     output_data[k] = OutputData(amount=0, output_secret, blinding_factor, keyset_id)
   ```

5. **Restore Proofs**: Bob attempts to restore proofs using the derived output data:

   ```python
   potential_proofs = wallet.restoreFromOutputData({send: output_data, keep: []}, keyset_id)
   ```

   The mint's `/v1/restore` endpoint returns blinded signatures for any outputs that exist.

6. **Verify Unspent**: Bob checks which restored proofs are still unspent:

   ```python
   proof_states = wallet.checkProofsStates(potential_proofs.send)
   unspent_proofs = filter(potential_proofs.send, state == "UNSPENT")
   ```

7. Bob should now swap any discovered outputs to claim them while taking into account potential linkability.

## Future improvements

- We should use 32-byte x-only public keys for the input proofs so that the secrets blend in with the rest.
- Allow wallets to "sync" a mint's spent secrets so that it doesn't have to fetch all for every scan
- Analyze privacy concerns around claiming all discovered outputs at once. Should they all be claimed at once? Should we try to correlate outputs to a single transaction and only claim those at once? Any timing considerations?
- Allow Alice to use multiple inputs
- Encode the address... bech32?
