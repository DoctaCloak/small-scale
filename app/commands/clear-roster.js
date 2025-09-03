import { SlashCommandBuilder, PermissionsBitField } from "discord.js";
import fs from "fs";
import path from "path";

// Load configuration
const configPath = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../config.json"
);
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

export default {
  data: new SlashCommandBuilder()
    .setName("clear-roster")
    .setDescription("Clear all users from the roster (Admin only)")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages),
  async execute(interaction, context) {
    try {
      // Acknowledge the interaction immediately to prevent timeout
      await interaction.deferReply({ ephemeral: true });

      const { db, client } = context;
      const guild = interaction.guild;
      const rosterCollection = db.collection(config.DATABASE.COLLECTION_NAME);

      // Get current roster count before clearing
      const rosterEntries = await rosterCollection
        .find({ guildId: guild.id })
        .toArray();

      const userCount = rosterEntries.length;

      if (userCount === 0) {
        return await interaction.editReply({
          content: "🧹 The roster is already empty. No users to clear.",
        });
      }

      // Clear all roster entries for this guild
      await rosterCollection.deleteMany({ guildId: guild.id });

      // Remove "Clocked In" role from all users who had it
      const clockedInRole = guild.roles.cache.find(
        (role) => role.name === config.ROLES.CLOCKED_IN
      );

      let rolesRemoved = 0;
      if (clockedInRole) {
        for (const entry of rosterEntries) {
          try {
            const member = await guild.members.fetch(entry.userId);
            if (member.roles.cache.has(clockedInRole.id)) {
              await member.roles.remove(clockedInRole);
              rolesRemoved++;
            }
          } catch (error) {
            console.error(
              `Failed to remove role from user ${entry.userId}:`,
              error
            );
          }
        }
      }

      // Update the roster message if it exists
      const partyFinderChannel = guild.channels.cache.find(
        (ch) => ch.name === config.CHANNELS.PARTY_FINDER && ch.type === 0 // GUILD_TEXT
      );

      if (partyFinderChannel) {
        try {
          // Find and update the pinned roster message
          const pins = await partyFinderChannel.messages.fetchPinned();
          const rosterMessage = pins.find(
            (msg) => msg.author.id === guild.members.me.id
          );

          if (rosterMessage) {
            const content = "**✅ Now Playing:**\nNobody is clocked in.";

            const { ActionRowBuilder, ButtonBuilder, ButtonStyle } =
              await import("discord.js");
            const row = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId("clock_in")
                .setLabel("Clock In ✅")
                .setStyle(ButtonStyle.Success),
              new ButtonBuilder()
                .setCustomId("clock_out")
                .setLabel("Clock Out 👋")
                .setStyle(ButtonStyle.Danger)
            );

            await rosterMessage.edit({ content, components: [row] });
          }
        } catch (error) {
          console.error("Failed to update roster message:", error);
        }
      }

      // Send success message
      await interaction.editReply({
        content:
          `🧹 **Roster Cleared Successfully!**\n\n` +
          `• **Users removed:** ${userCount}\n` +
          `• **Roles removed:** ${rolesRemoved}\n` +
          `• **Channel updated:** ${partyFinderChannel ? "✅" : "❌"}`,
      });

      console.log(
        `[Clear Roster] Cleared ${userCount} users from roster in ${guild.name}`
      );
    } catch (error) {
      console.error("[Clear Roster] Error:", error);

      // If we haven't replied yet, send an error message
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "❌ An error occurred while clearing the roster.",
          ephemeral: true,
        });
      } else {
        await interaction.editReply({
          content: "❌ An error occurred while clearing the roster.",
        });
      }
    }
  },
};
