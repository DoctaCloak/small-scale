import { ChannelType, PermissionsBitField } from "discord.js";
import fs from "fs";
import path from "path";

// Load configuration
const configPath = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../config.json"
);
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

const CLOCK_CHANNEL_NAME = config.CHANNELS.CLOCK_CHANNEL;
const PARTY_FINDER_CHANNEL_NAME = config.CHANNELS.PARTY_FINDER;
const CLOCKED_IN_ROLE_NAME = config.ROLES.CLOCKED_IN;
const CONTENT_TYPES = config.ROLES.CONTENT_TYPES;
const AUTO_CLOCK_OUT_HOURS = config.TIMERS.AUTO_CLOCK_OUT_HOURS;

export default async function onInteractionCreate(client, database) {
  client.on("interactionCreate", async (interaction) => {
    // Handle slash commands
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        // Pass both interaction and context to the command
        await command.execute(interaction, { db: database, client });
      } catch (error) {
        console.error(
          `Error executing command ${interaction.commandName}:`,
          error
        );

        const errorMessage = {
          content: "There was an error while executing this command!",
          ephemeral: true,
        };

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorMessage);
        } else {
          await interaction.reply(errorMessage);
        }
      }
      return;
    }

    // Handle button interactions
    if (!interaction.isButton()) return;

    const { customId } = interaction;
    const guild = interaction.guild;
    const user = interaction.user;
    const member = interaction.member;

    if (!guild || !member) return;

    // Ensure we're in either the clock-station or party-finder channel
    const clockChannel = guild.channels.cache.find(
      (ch) =>
        ch.name === CLOCK_CHANNEL_NAME && ch.type === ChannelType.GuildText
    );

    const partyFinderChannel = guild.channels.cache.find(
      (ch) =>
        ch.name === PARTY_FINDER_CHANNEL_NAME &&
        ch.type === ChannelType.GuildText
    );

    const isValidChannel =
      (clockChannel && interaction.channel.id === clockChannel.id) ||
      (partyFinderChannel && interaction.channel.id === partyFinderChannel.id);

    if (!isValidChannel) {
      return await interaction.reply({
        content:
          "This button can only be used in the clock-station or party-finder channels.",
        ephemeral: true,
      });
    }

    const rosterCollection = database.collection(
      config.DATABASE.COLLECTION_NAME
    );
    const clockedInRole = guild.roles.cache.find(
      (role) => role.name === CLOCKED_IN_ROLE_NAME
    );

    if (!clockedInRole) {
      return await interaction.reply({
        content:
          "Error: Clocked In role not found. Please contact an administrator.",
        ephemeral: true,
      });
    }

    try {
      if (customId === "clock_in") {
        await handleClockIn(
          interaction,
          rosterCollection,
          clockedInRole,
          partyFinderChannel,
          database,
          clockChannel
        );
      } else if (customId === "clock_out") {
        await handleClockOut(
          interaction,
          rosterCollection,
          clockedInRole,
          partyFinderChannel,
          database,
          clockChannel
        );
      } else if (customId.startsWith("content_")) {
        await handleContentSelection(
          interaction,
          customId,
          clockedInRole,
          partyFinderChannel,
          database
        );
      }
    } catch (error) {
      console.error("Error handling button interaction:", error);
      await interaction.reply({
        content: "An error occurred while processing your request.",
        ephemeral: true,
      });
    }
  });
}

async function handleClockIn(
  interaction,
  rosterCollection,
  clockedInRole,
  partyFinderChannel,
  database,
  clockChannel
) {
  const user = interaction.user;
  const member = interaction.member;
  const currentTime = new Date();
  const clockOutTime = new Date(
    currentTime.getTime() + AUTO_CLOCK_OUT_HOURS * 60 * 60 * 1000
  );

  // Check if user is already clocked in
  const existingEntry = await rosterCollection.findOne({
    userId: user.id,
    guildId: interaction.guild.id,
    clockOutTime: { $gt: currentTime },
  });

  if (existingEntry) {
    return await interaction.reply({
      content: `You're already clocked in! You'll be automatically clocked out at ${clockOutTime.toLocaleString()}.`,
      ephemeral: true,
    });
  }

  // Add user to roster in database
  await rosterCollection.insertOne({
    userId: user.id,
    guildId: interaction.guild.id,
    displayName: member.displayName,
    clockInTime: currentTime,
    clockOutTime: clockOutTime,
    createdAt: currentTime,
  });

  // Add role to user
  if (!member.roles.cache.has(clockedInRole.id)) {
    await member.roles.add(clockedInRole);
  }

  // Update the roster message in party-finder channel if it exists
  if (partyFinderChannel) {
    await updateRosterMessage(partyFinderChannel, database);
  }

  await interaction.reply({
    content: `✅ You've been clocked in! You'll be automatically clocked out after ${AUTO_CLOCK_OUT_HOURS} hours.\n\nYou now have access to the party-finder channel!`,
    ephemeral: true,
  });

  console.log(`${user.tag} clocked in at ${currentTime.toISOString()}`);
}

async function handleClockOut(
  interaction,
  rosterCollection,
  clockedInRole,
  partyFinderChannel,
  database,
  clockChannel
) {
  const user = interaction.user;
  const member = interaction.member;
  const currentTime = new Date();

  // Remove user from roster in database
  const deleteResult = await rosterCollection.deleteMany({
    userId: user.id,
    guildId: interaction.guild.id,
    clockOutTime: { $gt: currentTime },
  });

  if (deleteResult.deletedCount === 0) {
    return await interaction.reply({
      content: "You're not currently clocked in.",
      ephemeral: true,
    });
  }

  // Remove role from user
  if (member.roles.cache.has(clockedInRole.id)) {
    await member.roles.remove(clockedInRole);
  }

  // Update the roster message in party-finder channel if it exists
  if (partyFinderChannel) {
    await updateRosterMessage(partyFinderChannel, database);
  }

  await interaction.reply({
    content: "👋 You have been clocked out successfully!",
    ephemeral: true,
  });

  console.log(`${user.tag} clocked out at ${currentTime.toISOString()}`);
}

async function handleContentSelection(
  interaction,
  customId,
  clockedInRole,
  partyFinderChannel,
  database
) {
  const user = interaction.user;
  const member = interaction.member;
  const guild = interaction.guild;

  // Check if user has the Clocked In role
  if (!member.roles.cache.has(clockedInRole.id)) {
    return await interaction.reply({
      content:
        "❌ You must be clocked in to select content types. Use the buttons in #clock-station first.",
      ephemeral: true,
    });
  }

  try {
    await interaction.deferReply({ ephemeral: true });

    const contentType = customId.replace("content_", "").toUpperCase();
    let actionMessage = "";
    let roleChanged = false;

    if (contentType === "CLEAR") {
      // Remove all content type roles
      const contentRolesToRemove = [];
      for (const [key, roleName] of Object.entries(CONTENT_TYPES)) {
        const role = guild.roles.cache.find((r) => r.name === roleName);
        if (role && member.roles.cache.has(role.id)) {
          contentRolesToRemove.push(role);
        }
      }

      if (contentRolesToRemove.length > 0) {
        await member.roles.remove(contentRolesToRemove);
        actionMessage = `🗑️ Cleared all content type selections (${contentRolesToRemove.length} roles removed)`;
        roleChanged = true;
      } else {
        actionMessage = "ℹ️ No content types were selected to clear.";
      }
    } else {
      // Toggle specific content type role
      const roleName = CONTENT_TYPES[contentType];
      if (!roleName) {
        actionMessage = "❌ Unknown content type.";
      } else {
        const role = guild.roles.cache.find((r) => r.name === roleName);
        if (!role) {
          actionMessage =
            "❌ Content type role not found. Please contact an administrator.";
        } else {
          if (member.roles.cache.has(role.id)) {
            // Remove role
            await member.roles.remove(role);
            actionMessage = `➖ Removed **${roleName}** from your content preferences`;
            roleChanged = true;
          } else {
            // Add role
            await member.roles.add(role);
            actionMessage = `➕ Added **${roleName}** to your content preferences`;
            roleChanged = true;
          }
        }
      }
    }

    // Update roster display if roles were changed
    if (roleChanged && partyFinderChannel) {
      const { updateRosterMessage } = await import("./onReady.js");
      await updateRosterMessage(partyFinderChannel, database);
    }

    await interaction.editReply({
      content: actionMessage,
    });

    console.log(`[Content Selection] ${user.tag} - ${actionMessage}`);
  } catch (error) {
    console.error("Error handling content selection:", error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content:
          "❌ An error occurred while updating your content preferences.",
        ephemeral: true,
      });
    } else {
      await interaction.editReply({
        content:
          "❌ An error occurred while updating your content preferences.",
      });
    }
  }
}
