/**
 * One-time setup: adds USDC trustline to the agent wallet on testnet.
 * Run once before the agent can hold USDC.
 */
import { Horizon, Keypair, TransactionBuilder, Asset, Operation, Networks, BASE_FEE } from "@stellar/stellar-sdk";
import dotenv from "dotenv";

dotenv.config();

const USDC_ISSUER_TESTNET = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const USDC = new Asset("USDC", USDC_ISSUER_TESTNET);

async function setupUsdcTrustline() {
  const secretKey = process.env.STELLAR_SECRET_KEY;
  if (!secretKey) throw new Error("STELLAR_SECRET_KEY not set");

  const keypair = Keypair.fromSecret(secretKey);
  const server = new Horizon.Server("https://horizon-testnet.stellar.org");

  const account = await server.loadAccount(keypair.publicKey());

  // Check if trustline already exists
  const hasTrustline = account.balances.some(
    (b) =>
      b.asset_type === "credit_alphanum4" &&
      (b as Horizon.HorizonApi.BalanceLine<"credit_alphanum4">).asset_code === "USDC" &&
      (b as Horizon.HorizonApi.BalanceLine<"credit_alphanum4">).asset_issuer === USDC_ISSUER_TESTNET
  );

  if (hasTrustline) {
    console.log("USDC trustline already exists.");
    return;
  }

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.changeTrust({
        asset: USDC,
        limit: "100000",
      })
    )
    .setTimeout(30)
    .build();

  tx.sign(keypair);
  const result = await server.submitTransaction(tx);
  console.log("USDC trustline added!");
  console.log(`Tx hash: ${result.hash}`);
  console.log("");
  console.log("Now get testnet USDC from the faucet:");
  console.log("Go to: https://stellar.expert/explorer/testnet — search your public key");
  console.log("Or request from the Circle testnet USDC faucet if available.");
  console.log(`Your public key: ${keypair.publicKey()}`);
}

setupUsdcTrustline().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
