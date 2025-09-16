import winston from "winston";
import chalk from "chalk";
import { Proof } from "@cashu/cashu-ts";
import { bytesToHex, PublicKey, secp256k1 } from "./crypto";
import { sha256 } from "@noble/hashes/sha256";

export const sumProofs = (arr: Proof[]): number =>
  arr.reduce((a, b) => a + b.amount, 0);

export const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      const ts = new Date(timestamp as string).toLocaleTimeString();
      const levelColor =
        level === "error"
          ? chalk.red
          : level === "warn"
            ? chalk.yellow
            : chalk.green;
      return `${chalk.gray(ts)} ${levelColor(level.toUpperCase())} ${message}`;
    }),
  ),
  transports: [new winston.transports.Console()],
});

/**
 * Parse the mint url and public keys from a cashu address
 * with the format: `mintUrl:scanPubkey:spendPubkey`
 */
export const parseCashuAddress = (
  address: string,
): { mintUrl: string; scanPubkey: PublicKey; spendPubkey: PublicKey } => {
  const lastColonIndex = address.lastIndexOf(":");
  const secondLastColonIndex = address.lastIndexOf(":", lastColonIndex - 1);

  if (secondLastColonIndex === -1 || lastColonIndex === -1) {
    throw new Error(
      "Invalid cashu address format. Expected: mintUrl:scanPubkey:spendPubkey",
    );
  }

  const mintUrl = address.substring(0, secondLastColonIndex);
  const scanHex = address.substring(secondLastColonIndex + 1, lastColonIndex);
  const spendHex = address.substring(lastColonIndex + 1);

  if (!scanHex || !spendHex) {
    throw new Error("Invalid cashu address: missing public keys");
  }

  if (scanHex.length !== 66 || spendHex.length !== 66) {
    throw new Error(
      `Invalid cashu address: compressed public keys must be 66 hex characters (33 bytes with prefix). Got scanHex: ${scanHex.length}, spendHex: ${spendHex.length}`,
    );
  }

  if (
    (!scanHex.startsWith("02") && !scanHex.startsWith("03")) ||
    (!spendHex.startsWith("02") && !spendHex.startsWith("03"))
  ) {
    throw new Error(
      "Invalid cashu address: public keys must have 02 or 03 prefix for compressed format",
    );
  }

  return {
    mintUrl,
    scanPubkey: secp256k1.Point.fromHex(scanHex),
    spendPubkey: secp256k1.Point.fromHex(spendHex),
  };
};

function hashToCurve(secret: Uint8Array): PublicKey {
  const prefix = new TextEncoder().encode("Secp256k1_HashToCurve_Cashu_");
  const secret_hash = sha256(new Uint8Array([...prefix, ...secret]));

  const counter = new Uint32Array(1);

  for (let i = 0; i < 2 ** 16; i++) {
    const counter_bytes = new Uint8Array(counter.buffer);
    const hash = sha256(new Uint8Array([...secret_hash, ...counter_bytes]));

    try {
      const point = secp256k1.Point.fromHex("02" + bytesToHex(hash));
      return point;
    } catch (e) {
      counter[0]++;
    }
  }
  throw new Error("No valid point found");
}

export const proofToY = (proof: Proof): string => {
  return hashToCurve(new TextEncoder().encode(proof.secret)).toHex(true);
};

// const networkLogger = winston.createLogger({
//   level: "info",
//   format: winston.format.combine(
//     winston.format.timestamp(),
//     winston.format.printf(({ timestamp, message }) => {
//       const ts = new Date(timestamp as string).toLocaleTimeString();
//       return `${chalk.gray(ts)} ${chalk.blue("NET")} ${message}`;
//     })
//   ),
//   transports: [new winston.transports.Console()],
// });

// // Monkey patch fetch to log network requests
// const originalFetch = globalThis.fetch;
// const patchedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
//   const url =
//     typeof input === "string"
//       ? input
//       : input instanceof URL
//       ? input.toString()
//       : input.url;
//   const method = init?.method || "GET";

//   networkLogger.info(`${chalk.cyan(method)} ${url}`);

//   if (init?.body) {
//     try {
//       const body =
//         typeof init.body === "string" ? init.body : JSON.stringify(init.body);
//       if (body.length < 200) {
//         networkLogger.info(`Request body: ${chalk.dim(body)}`);
//       } else {
//         networkLogger.info(
//           `Request body: ${chalk.dim(body.substring(0, 200) + "...")}`
//         );
//       }
//     } catch (e) {
//       networkLogger.info(
//         `Request body: ${chalk.dim("[Binary or unparseable data]")}`
//       );
//     }
//   }

//   try {
//     const response = await originalFetch(input, init);
//     const statusColor = response.ok ? chalk.green : chalk.red;
//     networkLogger.info(
//       `Response: ${statusColor(response.status)} ${response.statusText}`
//     );

//     const clonedResponse = response.clone();
//     try {
//       const responseText = await clonedResponse.text();
//       if (responseText && responseText.length < 200) {
//         networkLogger.info(`Response body: ${chalk.dim(responseText)}`);
//       } else if (responseText) {
//         networkLogger.info(
//           `Response body: ${chalk.dim(responseText.substring(0, 200) + "...")}`
//         );
//       }
//     } catch (e) {
//       networkLogger.info(
//         `Response body: ${chalk.dim("[Could not read response body]")}`
//       );
//     }

//     return response;
//   } catch (error) {
//     networkLogger.error(`Request failed: ${chalk.red(error)}`);
//     throw error;
//   }
// };

// // Add preconnect property to match fetch type
// (patchedFetch as any).preconnect = originalFetch.preconnect;
// globalThis.fetch = patchedFetch as typeof fetch;
