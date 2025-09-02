import { Client, GatewayIntentBits } from "discord.js";
import { config } from "dotenv";

// Load environment variables
config();
const { DISCORD_TOKEN } = process.env;

if (!DISCORD_TOKEN) {
  console.error("❌ DISCORD_TOKEN not found in .env file");
  console.error("   Please set your Discord bot token in the .env file");
  process.exit(1);
}

if (
  DISCORD_TOKEN === "YOUR_ACTUAL_DISCORD_BOT_TOKEN_HERE" ||
  DISCORD_TOKEN === "your_discord_bot_token_here"
) {
  console.error("❌ DISCORD_TOKEN is still set to placeholder value");
  console.error(
    "   Please replace it with your actual Discord bot token from https://discord.com/developers/applications"
  );
  process.exit(1);
}

console.log("🔍 Testing Discord bot token...");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once("ready", () => {
  console.log("✅ Discord token is valid!");
  console.log(`🤖 Bot logged in as: ${client.user.tag}`);
  console.log(`📊 Connected to ${client.guilds.cache.size} server(s)`);
  client.destroy();
  process.exit(0);
});

client.once("error", (error) => {
  console.error("❌ Discord login failed:");
  console.error(`   Error: ${error.message}`);
  process.exit(1);
});

// Set a timeout in case the login hangs
setTimeout(() => {
  console.error("❌ Login timeout - token might be invalid");
  client.destroy();
  process.exit(1);
}, 10000);

client.login(DISCORD_TOKEN).catch((error) => {
  console.error("❌ Failed to login:");
  console.error(`   Error: ${error.message}`);
  process.exit(1);
});
