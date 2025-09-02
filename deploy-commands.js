import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v10";
import { config } from "dotenv";
import fs from "fs";
import path from "path";

// Load environment variables
config();
const { DISCORD_TOKEN, PUBLIC_KEY, APP_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !PUBLIC_KEY || !APP_ID || !GUILD_ID) {
  console.error("DISCORD_TOKEN, PUBLIC_KEY, APP_ID, and GUILD_ID are required");
  process.exit(1);
}

// Root directory
const ROOT_DIR = process.cwd();

const commands = [];
const commandsPath = path.join(ROOT_DIR, "app/commands");
const commandFiles = fs
  .readdirSync(commandsPath)
  .filter((file) => file.endsWith(".js"));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  try {
    const command = (await import(`file://${filePath}`)).default;
    if (command?.data) {
      commands.push(command.data.toJSON());
      console.log(`Loaded command: ${command.data.name}`);
    } else {
      console.warn(
        `[WARNING] The command at ${filePath} is missing a required "data" property.`
      );
    }
  } catch (error) {
    console.error(`[ERROR] Failed to load command at ${filePath}:`, error);
  }
}

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

(async () => {
  try {
    console.log("Started refreshing application (/) commands.");

    await rest.put(Routes.applicationGuildCommands(APP_ID, GUILD_ID), {
      body: commands,
    });

    console.log("Successfully reloaded application (/) commands.");
  } catch (error) {
    console.error(error);
  }
})();
