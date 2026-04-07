import { Horizon, Keypair } from "@stellar/stellar-sdk";
import dotenv from "dotenv";

dotenv.config();

// USDC issuer on Stellar testnet
const USDC_ISSUER_TESTNET = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const USDC_ASSET_CODE = "USDC";

export async function checkWalletBalance(): Promise<number> {
  const secretKey = process.env.STELLAR_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STELLAR_SECRET_KEY not set in environment");
  }

  const keypair = Keypair.fromSecret(secretKey);
  const publicKey = keypair.publicKey();

  const server = new Horizon.Server("https://horizon-testnet.stellar.org");

  const account = await server.loadAccount(publicKey);

  const usdcBalance = account.balances.find(
    (b) =>
      b.asset_type === "credit_alphanum4" &&
      (b as Horizon.HorizonApi.BalanceLine<"credit_alphanum4">).asset_code === USDC_ASSET_CODE &&
      (b as Horizon.HorizonApi.BalanceLine<"credit_alphanum4">).asset_issuer === USDC_ISSUER_TESTNET
  );

  if (!usdcBalance) {
    return 0;
  }

  return parseFloat(usdcBalance.balance);
}

// Run directly if this is the entry point
if (require.main === module) {
  checkWalletBalance()
    .then((balance) => {
      console.log(`USDC Balance: $${balance.toFixed(2)}`);
    })
    .catch((err) => {
      console.error("Error checking balance:", err.message);
      process.exit(1);
    });
}
