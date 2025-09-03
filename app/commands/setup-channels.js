import { SlashCommandBuilder, PermissionsBitField } from "discord.js";
import fs from "fs";
import path from "path";

// Load configuration
const configPath = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../config.json"
);
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

// Import verification function (will be passed from main)
let verifyAndCreateMissingChannels = null;

export function setChannelVerificationFunction(func) {
  verifyAndCreateMissingChannels = func;
}

export default {
  data: new SlashCommandBuilder()
    .setName("setup-channels")
    .setDescription(
      "Manage party finder channels and roster display (Admin only)"
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("verify")
        .setDescription("Check and create missing channels")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("refresh")
        .setDescription("Refresh the roster display in party-finder channel")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("update-times")
        .setDescription("Force immediate update of remaining time displays")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("refresh-content")
        .setDescription("Refresh the content selection buttons in party-finder")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("reset-buttons")
        .setDescription("Reset clock buttons to default state (both enabled)")
    ),
  async execute(interaction, context) {
    try {
      // Acknowledge the interaction immediately to prevent timeout
      await interaction.deferReply({ ephemeral: true });

      const { db, client } = context;
      const guild = interaction.guild;
      const subcommand = interaction.options.getSubcommand();

      if (subcommand === "verify") {
        if (!verifyAndCreateMissingChannels) {
          return await interaction.editReply({
            content:
              "❌ Channel verification function not available. Please restart the bot.",
          });
        }

        // Get the Clocked In role
        const clockedInRole = guild.roles.cache.find(
          (role) => role.name === config.ROLES.CLOCKED_IN
        );

        if (!clockedInRole) {
          return await interaction.editReply({
            content:
              "❌ Clocked In role not found. Please restart the bot to create it.",
          });
        }

        // Check current roster count from database
        const rosterCollection = db.collection(config.DATABASE.COLLECTION_NAME);
        const currentTime = new Date();
        const rosterCount = await rosterCollection.countDocuments({
          guildId: guild.id,
          clockOutTime: { $gt: currentTime },
        });

        // Run channel verification
        await interaction.editReply({
          content: "🔍 Scanning and creating missing channels...",
        });

        await verifyAndCreateMissingChannels(guild, db, clockedInRole);

        // Get final status
        const clockChannel = guild.channels.cache.find(
          (ch) => ch.name === config.CHANNELS.CLOCK_CHANNEL && ch.type === 0
        );
        const partyFinderChannel = guild.channels.cache.find(
          (ch) => ch.name === config.CHANNELS.PARTY_FINDER && ch.type === 0
        );

        const statusMessage =
          `🎉 **Channel Verification Complete!**\n\n` +
          `• **Clock Station** (#${config.CHANNELS.CLOCK_CHANNEL}): ${
            clockChannel ? "✅ Created/Verified" : "❌ Failed"
          }\n` +
          `• **Party Finder** (#${config.CHANNELS.PARTY_FINDER}): ${
            partyFinderChannel ? "✅ Created/Verified" : "❌ Failed"
          }\n` +
          `• **Current Roster**: ${rosterCount} active players\n\n` +
          `The party finder system is now ready to use!`;

        await interaction.editReply({
          content: statusMessage,
        });
      } else if (subcommand === "refresh") {
        // Import the updateRosterMessage function
        const { updateRosterMessage } = await import(
          "../../app/events/onReady.js"
        );

        // Refresh the roster display
        const partyFinderChannel = guild.channels.cache.find(
          (ch) => ch.name === config.CHANNELS.PARTY_FINDER && ch.type === 0
        );

        if (!partyFinderChannel) {
          return await interaction.editReply({
            content:
              "❌ Party finder channel not found. Run `/setup-channels verify` first.",
          });
        }

        await interaction.editReply({
          content: "🔄 Refreshing roster display...",
        });

        if (updateRosterMessage) {
          await updateRosterMessage(partyFinderChannel, db);
        }

        await interaction.editReply({
          content:
            "✅ **Roster display refreshed!**\n\nThe party-finder channel now shows the latest information including player roles and helpful tips.",
        });
      } else if (subcommand === "update-times") {
        await interaction.editReply({
          content: "⏰ Forcing time display updates...",
        });

        await updateRosterMessage(partyFinderChannel, db);
        await interaction.editReply({
          content: "✅ Time displays updated successfully!",
        });
      } else if (subcommand === "refresh-content") {
        await interaction.editReply({
          content: "🎮 Refreshing content selection buttons...",
        });

        // Force recreation of content selection buttons
        const { createContentSelectionButtons } = await import(
          "../../app/events/onReady.js"
        );

        // Get content roles from config
        const config = JSON.parse(
          fs.readFileSync(path.join(process.cwd(), "config.json"), "utf-8")
        );
        const contentRoles = {};
        for (const [key, roleName] of Object.entries(
          config.ROLES.CONTENT_TYPES
        )) {
          const role = guild.roles.cache.find((r) => r.name === roleName);
          if (role) contentRoles[key] = role;
        }

        await createContentSelectionButtons(
          partyFinderChannel,
          db,
          contentRoles
        );
        await interaction.editReply({
          content: "✅ Content selection buttons refreshed successfully!",
        });
      } else if (subcommand === "reset-buttons") {
        await interaction.editReply({
          content: "🔄 Resetting clock buttons to default state...",
        });

        // Reset clock buttons to both enabled state
        const clockChannel = guild.channels.cache.find(
          (ch) => ch.name === config.CHANNELS.CLOCK_CHANNEL && ch.type === 0
        );

        if (clockChannel) {
          const { createClockButtons } = await import(
            "../../app/events/onReady.js"
          );
          await createClockButtons(clockChannel, db);
        }

        await interaction.editReply({
          content: "✅ Clock buttons reset to default state (both enabled)!",
        });

        // Update roster in party-finder channel
        const partyFinderChannel = guild.channels.cache.find(
          (ch) => ch.name === config.CHANNELS.PARTY_FINDER && ch.type === 0
        );

        if (!partyFinderChannel) {
          return await interaction.editReply({
            content:
              "❌ Party finder channel not found. Run `/setup-channels verify` first.",
          });
        }

        await interaction.editReply({
          content: "⏰ Updating time displays...",
        });

        if (updateRosterMessage) {
          await updateRosterMessage(partyFinderChannel, db);
        }

        await interaction.editReply({
          content:
            "✅ **Time displays updated!**\n\nAll remaining time counters in the party-finder channel have been refreshed with the latest calculations.",
        });
      }

      console.log(
        `[Setup Channels] Admin ${interaction.user.tag} ran ${subcommand} command in ${guild.name}`
      );
    } catch (error) {
      console.error("[Setup Channels] Error:", error);

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "❌ An error occurred while managing channels.",
          ephemeral: true,
        });
      } else {
        await interaction.editReply({
          content: "❌ An error occurred while managing channels.",
        });
      }
    }
  },
};
