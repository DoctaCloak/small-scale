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

      // Check if interaction has already been acknowledged
      if (interaction.replied) {
        console.log("Interaction already replied to, skipping error response");
        // Don't try to respond again if already replied
        return;
      }

      if (interaction.deferred) {
        await interaction.followUp({
          content: "An error occurred while processing your request.",
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: "An error occurred while processing your request.",
          ephemeral: true,
        });
      }
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

  try {
    // Check if user is already clocked in
    const existingEntry = await rosterCollection.findOne({
      userId: user.id,
      guildId: interaction.guild.id,
      clockOutTime: { $gt: currentTime },
    });

    if (existingEntry) {
      const existingClockOutTime = new Date(existingEntry.clockOutTime);
      const timeLeftMs = existingClockOutTime.getTime() - currentTime.getTime();
      const hoursLeft = Math.floor(timeLeftMs / (1000 * 60 * 60));
      const minutesLeft = Math.floor(
        (timeLeftMs % (1000 * 60 * 60)) / (1000 * 60)
      );

      // Calculate local time for better user experience
      const localClockOutTime = new Date(currentTime.getTime() + timeLeftMs);

      return await interaction.reply({
        content: `You're already clocked in! You have ${hoursLeft}h ${minutesLeft}m remaining.\n\nYou'll be automatically clocked out at approximately ${localClockOutTime.toLocaleTimeString(
          [],
          { hour: "2-digit", minute: "2-digit" }
        )} (your local time).`,
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
      const { updateRosterMessage } = await import("./onReady.js");
      await updateRosterMessage(partyFinderChannel, database);
    }

    // Update clock buttons to reflect new state
    if (clockChannel) {
      const { updateClockButtonsForUser } = await import("./onReady.js");
      await updateClockButtonsForUser(clockChannel, user.id, database);
    }

    // Calculate local time for display
    const localClockOutTime = new Date(clockOutTime.getTime());

    await interaction.reply({
      content: `✅ You've been clocked in for ${AUTO_CLOCK_OUT_HOURS} hours! \n\nYou'll be automatically clocked out at approximately ${localClockOutTime.toLocaleTimeString(
        [],
        { hour: "2-digit", minute: "2-digit" }
      )} (your local time).\n\nYou now have access to the party-finder channel!`,
      ephemeral: true,
    });

    console.log(`${user.tag} clocked in at ${currentTime.toISOString()}`);
  } catch (error) {
    console.error("Error in handleClockIn:", error);
    throw error; // Re-throw to be handled by the main error handler
  }
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

  try {
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
      const { updateRosterMessage } = await import("./onReady.js");
      await updateRosterMessage(partyFinderChannel, database);
    }

    // Update clock buttons to reflect new state
    if (clockChannel) {
      const { updateClockButtonsForUser } = await import("./onReady.js");
      await updateClockButtonsForUser(clockChannel, user.id, database);
    }

    await interaction.reply({
      content: "👋 You have been clocked out successfully!",
      ephemeral: true,
    });

    console.log(`${user.tag} clocked out at ${currentTime.toISOString()}`);
  } catch (error) {
    console.error("Error in handleClockOut:", error);
    throw error; // Re-throw to be handled by the main error handler
  }
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

  console.log(`[Content Selection] Handling ${customId} for ${user.tag}`);

  // Check if user has the Clocked In role
  if (!member.roles.cache.has(clockedInRole.id)) {
    console.log(
      `[Content Selection] ${user.tag} not clocked in, denying access`
    );
    return await interaction.reply({
      content:
        "❌ You must be clocked in to select content types. Use the buttons in #clock-station first.",
      ephemeral: true,
    });
  }

  try {
    await interaction.deferReply({ ephemeral: true });

    const contentType = customId.replace("content_", "").toUpperCase();
    console.log(`[Content Selection] Processing content type: ${contentType}`);
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
        console.log(
          `[Content Selection] Cleared ${contentRolesToRemove.length} roles for ${user.tag}`
        );
      } else {
        actionMessage = "ℹ️ No content types were selected to clear.";
        console.log(`[Content Selection] No roles to clear for ${user.tag}`);
      }
    } else {
      // Toggle specific content type role
      const roleName = CONTENT_TYPES[contentType];
      if (!roleName) {
        actionMessage = "❌ Unknown content type.";
        console.log(`[Content Selection] Unknown content type: ${contentType}`);
      } else {
        const role = guild.roles.cache.find((r) => r.name === roleName);
        if (!role) {
          actionMessage =
            "❌ Content type role not found. Please contact an administrator.";
          console.log(`[Content Selection] Role not found: ${roleName}`);
        } else {
          if (member.roles.cache.has(role.id)) {
            // Remove role
            await member.roles.remove(role);
            actionMessage = `➖ Removed **${roleName}** from your content preferences`;
            roleChanged = true;
            console.log(
              `[Content Selection] Removed role ${roleName} for ${user.tag}`
            );
          } else {
            // Add role
            await member.roles.add(role);
            actionMessage = `➕ Added **${roleName}** to your content preferences`;
            roleChanged = true;
            console.log(
              `[Content Selection] Added role ${roleName} for ${user.tag}`
            );
          }
        }
      }
    }

    // Update roster display if roles were changed
    if (roleChanged && partyFinderChannel) {
      console.log(
        `[Content Selection] Updating roster display for ${user.tag}`
      );
      const { updateRosterMessage } = await import("./onReady.js");
      await updateRosterMessage(partyFinderChannel, database);
    }

    await interaction.editReply({
      content: actionMessage,
    });

    console.log(
      `[Content Selection] Completed: ${user.tag} - ${actionMessage}`
    );
  } catch (error) {
    console.error("Error handling content selection:", error);
    if (interaction.replied) {
      console.log(
        "Content selection interaction already replied to, skipping error response"
      );
      return;
    }
    if (!interaction.deferred) {
      await interaction.reply({
        content:
          "❌ An error occurred while updating your content preferences.",
        ephemeral: true,
      });
    } else {
      await interaction.followUp({
        content:
          "❌ An error occurred while updating your content preferences.",
        ephemeral: true,
      });
    }
  }
}
