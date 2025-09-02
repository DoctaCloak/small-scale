import { SlashCommandBuilder, PermissionsBitField } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("clear-roster")
    .setDescription("Clear all users from the roster (Admin only)")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages),
  async execute(interaction) {
    // This will be handled by the roster system
    // For now, just acknowledge the command
    await interaction.reply({
      content:
        "Roster clear command received. This will be implemented in the roster system.",
      ephemeral: true,
    });
  },
};
