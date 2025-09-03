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

export default async function onReady(client, database) {
  console.log(`🔄 onReady event triggered!`);

  // Log guild information
  client.guilds.cache.forEach((guild) => {
    console.log(
      `   - ${guild.name} (${guild.id}) - ${guild.memberCount} members`
    );
  });

  // Initialize roster system when bot starts
  for (const guild of client.guilds.cache.values()) {
    try {
      await initializeRosterSystem(guild, database);
    } catch (error) {
      console.error(
        `Failed to initialize roster system for guild ${guild.name}:`,
        error
      );
    }
  }

  // Set up periodic cleanup task
  setInterval(async () => {
    console.log("Running periodic roster cleanup...");
    for (const guild of client.guilds.cache.values()) {
      try {
        await cleanupExpiredRosterEntries(guild, database);
      } catch (error) {
        console.error(
          `Failed to cleanup roster for guild ${guild.name}:`,
          error
        );
      }
    }
  }, config.TIMERS.CLEANUP_INTERVAL_MINUTES * 60 * 1000);
}

async function initializeRosterSystem(guild, database) {
  console.log(
    `🔧 Initializing roster system for guild: ${guild.name} (${guild.id})`
  );

  // Check bot permissions
  const botMember = guild.members.me;
  console.log(`🤖 Bot permissions in ${guild.name}:`);
  console.log(
    `   - Manage Channels: ${botMember.permissions.has("ManageChannels")}`
  );
  console.log(`   - Manage Roles: ${botMember.permissions.has("ManageRoles")}`);
  console.log(
    `   - View Channels: ${botMember.permissions.has("ViewChannel")}`
  );

  // Scan existing channels to avoid unnecessary creation attempts
  console.log(`🔍 Scanning existing channels in ${guild.name}...`);
  const existingChannels = guild.channels.cache.filter(
    (ch) => ch.type === ChannelType.GuildText
  );

  const requiredChannels = [
    { name: CLOCK_CHANNEL_NAME, type: "clock-station" },
    { name: PARTY_FINDER_CHANNEL_NAME, type: "party-finder" },
  ];

  requiredChannels.forEach(({ name, type }) => {
    const exists = existingChannels.some((ch) => ch.name === name);
    console.log(
      `   - ${name} (${type}): ${exists ? "✅ EXISTS" : "❌ MISSING"}`
    );
  });

  // Ensure the Clocked In role exists
  let clockedInRole = guild.roles.cache.find(
    (role) => role.name === CLOCKED_IN_ROLE_NAME
  );
  if (!clockedInRole) {
    console.log(`📝 Creating ${CLOCKED_IN_ROLE_NAME} role...`);
    try {
      clockedInRole = await guild.roles.create({
        name: CLOCKED_IN_ROLE_NAME,
        color: 0x00ff00,
        mentionable: false,
      });
      console.log(
        `✅ Created ${CLOCKED_IN_ROLE_NAME} role with ID: ${clockedInRole.id}`
      );
    } catch (error) {
      console.error(`❌ Failed to create role:`, error);
      return;
    }
  } else {
    console.log(
      `✅ Found existing ${CLOCKED_IN_ROLE_NAME} role with ID: ${clockedInRole.id}`
    );
  }

  // Ensure the clock-station channel exists (visible to everyone, read-only except for bot)
  let clockChannel = guild.channels.cache.find(
    (ch) => ch.name === CLOCK_CHANNEL_NAME && ch.type === ChannelType.GuildText
  );

  if (!clockChannel) {
    console.log(`📝 Creating ${CLOCK_CHANNEL_NAME} channel...`);
    try {
      clockChannel = await guild.channels.create({
        name: CLOCK_CHANNEL_NAME,
        type: ChannelType.GuildText,
        topic:
          "Clock in/out station - Use the buttons below to manage your status",
        permissionOverwrites: [
          {
            id: guild.id, // @everyone
            deny: [PermissionsBitField.Flags.SendMessages],
            allow: [
              PermissionsBitField.Flags.ReadMessageHistory,
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.UseExternalEmojis,
            ],
          },
          {
            id: guild.roles.everyone.id,
            deny: [PermissionsBitField.Flags.SendMessages],
            allow: [PermissionsBitField.Flags.ViewChannel],
          },
        ],
      });
      console.log(
        `✅ Created ${CLOCK_CHANNEL_NAME} channel with ID: ${clockChannel.id}`
      );
    } catch (error) {
      console.error(
        `❌ Failed to create ${CLOCK_CHANNEL_NAME} channel:`,
        error
      );
      return;
    }
  } else {
    console.log(
      `✅ Found existing ${CLOCK_CHANNEL_NAME} channel with ID: ${clockChannel.id}`
    );
  }

  // Ensure the party-finder channel exists (only visible to clocked-in users)
  let partyFinderChannel = guild.channels.cache.find(
    (ch) =>
      ch.name === PARTY_FINDER_CHANNEL_NAME && ch.type === ChannelType.GuildText
  );

  if (!partyFinderChannel) {
    console.log(`📝 Creating ${PARTY_FINDER_CHANNEL_NAME} channel...`);
    try {
      partyFinderChannel = await guild.channels.create({
        name: PARTY_FINDER_CHANNEL_NAME,
        type: ChannelType.GuildText,
        topic:
          "🎯 Party Finder - Real-time roster of available players (Read-only)",
        permissionOverwrites: [
          {
            id: guild.id, // @everyone
            deny: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.AddReactions,
            ],
          },
          {
            id: clockedInRole.id, // Clocked In role
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.ReadMessageHistory,
            ],
            deny: [
              PermissionsBitField.Flags.SendMessages, // Explicitly deny sending messages
              PermissionsBitField.Flags.AddReactions,
            ],
          },
          {
            id: botMember.id, // Bot can send messages to update roster
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory,
              PermissionsBitField.Flags.UseExternalEmojis,
            ],
          },
        ],
      });
      console.log(
        `✅ Created ${PARTY_FINDER_CHANNEL_NAME} channel with ID: ${partyFinderChannel.id}`
      );
    } catch (error) {
      console.error(
        `❌ Failed to create ${PARTY_FINDER_CHANNEL_NAME} channel:`,
        error
      );
      return;
    }
  } else {
    console.log(
      `✅ Found existing ${PARTY_FINDER_CHANNEL_NAME} channel with ID: ${partyFinderChannel.id}`
    );
  }

  // Create clock buttons in the clock-station channel
  if (clockChannel) {
    await createClockButtons(clockChannel, database);
  }

  // Create roster display in the party-finder channel
  if (partyFinderChannel) {
    await updateRosterMessage(partyFinderChannel, database);
  }

  // Final status summary
  console.log(`\n🎉 Roster system initialization complete for ${guild.name}:`);
  console.log(`   📊 Guild: ${guild.name} (${guild.id})`);
  console.log(`   👥 Members: ${guild.memberCount}`);
  console.log(
    `   🏷️  Role: ${CLOCKED_IN_ROLE_NAME} ${clockedInRole ? "✅" : "❌"}`
  );
  console.log(
    `   🕐 Clock Channel: ${CLOCK_CHANNEL_NAME} ${clockChannel ? "✅" : "❌"}`
  );
  console.log(
    `   🎯 Party Finder: ${PARTY_FINDER_CHANNEL_NAME} ${
      partyFinderChannel ? "✅" : "❌"
    }`
  );
  console.log(
    `   🔧 Status: ${
      clockChannel && partyFinderChannel ? "✅ READY" : "⚠️  PARTIAL"
    }`
  );
  console.log(`   🤖 Bot: ${botMember.user.tag} (${botMember.id})`);

  if (!clockChannel || !partyFinderChannel) {
    console.log(
      `\n⚠️  WARNING: Some channels are missing. The bot will attempt to create them on next restart.`
    );
    console.log(
      `💡 To manually trigger channel creation, restart the bot or use admin commands.`
    );
  }

  // Set up periodic roster updates (every 10 minutes)
  setInterval(async () => {
    try {
      console.log(`🔄 Periodic roster update for ${guild.name}`);
      const partyFinderChannel = guild.channels.cache.find(
        (ch) =>
          ch.name === PARTY_FINDER_CHANNEL_NAME &&
          ch.type === ChannelType.GuildText
      );

      if (partyFinderChannel) {
        await updateRosterMessage(partyFinderChannel, database);
      }
    } catch (error) {
      console.error(`❌ Error during periodic roster update:`, error);
    }
  }, 10 * 60 * 1000); // 10 minutes

  // Set up periodic channel verification (every 30 minutes)
  setInterval(async () => {
    try {
      await verifyAndCreateMissingChannels(guild, database, clockedInRole);
    } catch (error) {
      console.error(`❌ Error during periodic channel verification:`, error);
    }
  }, 30 * 60 * 1000); // 30 minutes
}

export async function verifyAndCreateMissingChannels(
  guild,
  database,
  clockedInRole
) {
  console.log(`🔄 Verifying channels for ${guild.name}...`);

  let channelsUpdated = false;

  // Check clock-station channel
  let clockChannel = guild.channels.cache.find(
    (ch) => ch.name === CLOCK_CHANNEL_NAME && ch.type === ChannelType.GuildText
  );

  if (!clockChannel) {
    console.log(`📝 Creating missing ${CLOCK_CHANNEL_NAME} channel...`);
    try {
      clockChannel = await guild.channels.create({
        name: CLOCK_CHANNEL_NAME,
        type: ChannelType.GuildText,
        topic:
          "Clock in/out station - Use the buttons below to manage your status",
        permissionOverwrites: [
          {
            id: guild.id,
            deny: [PermissionsBitField.Flags.SendMessages],
            allow: [
              PermissionsBitField.Flags.ReadMessageHistory,
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.UseExternalEmojis,
            ],
          },
          {
            id: guild.roles.everyone.id,
            deny: [PermissionsBitField.Flags.SendMessages],
            allow: [PermissionsBitField.Flags.ViewChannel],
          },
        ],
      });
      console.log(`✅ Created missing ${CLOCK_CHANNEL_NAME} channel`);
      channelsUpdated = true;
    } catch (error) {
      console.error(
        `❌ Failed to create missing ${CLOCK_CHANNEL_NAME} channel:`,
        error
      );
    }
  }

  // Check party-finder channel
  let partyFinderChannel = guild.channels.cache.find(
    (ch) =>
      ch.name === PARTY_FINDER_CHANNEL_NAME && ch.type === ChannelType.GuildText
  );

  if (!partyFinderChannel) {
    console.log(`📝 Creating missing ${PARTY_FINDER_CHANNEL_NAME} channel...`);
    try {
      partyFinderChannel = await guild.channels.create({
        name: PARTY_FINDER_CHANNEL_NAME,
        type: ChannelType.GuildText,
        topic: "Party finder - Only visible to clocked-in users",
        permissionOverwrites: [
          {
            id: guild.id,
            deny: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
            ],
          },
          {
            id: clockedInRole.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory,
              PermissionsBitField.Flags.UseExternalEmojis,
            ],
          },
        ],
      });
      console.log(`✅ Created missing ${PARTY_FINDER_CHANNEL_NAME} channel`);
      channelsUpdated = true;
    } catch (error) {
      console.error(
        `❌ Failed to create missing ${PARTY_FINDER_CHANNEL_NAME} channel:`,
        error
      );
    }
  }

  // If channels were created, set them up
  if (channelsUpdated) {
    console.log(`🔧 Setting up newly created channels...`);

    if (clockChannel) {
      await createClockButtons(clockChannel, database);
    }

    if (partyFinderChannel) {
      await updateRosterMessage(partyFinderChannel, database);
    }

    console.log(
      `✅ Channel verification complete - all required channels now exist`
    );
  } else {
    console.log(`✅ All channels verified - no action needed`);
  }
}

async function createClockButtons(channel, database) {
  console.log(`🎯 Setting up clock buttons in #${channel.name}`);

  // Find existing clock button message
  const pins = await channel.messages.fetchPinned();
  let clockMessage = pins.find(
    (msg) => msg.author.id === channel.guild.members.me.id
  );

  const content =
    "**⏰ Clock Station**\n\n" +
    "Use the buttons below to clock in or out. Clocking in will give you access to the party-finder channel!\n\n" +
    "• **Clock In**: Get the Clocked In role and access to party-finder\n" +
    "• **Clock Out**: Remove the role and lose access to party-finder\n\n" +
    "*You'll be automatically clocked out after 4 hours.*";

  try {
    if (clockMessage) {
      console.log(`📝 Updating existing clock message`);
      await clockMessage.edit({ content });
      console.log(`✅ Updated clock message`);
    } else {
      console.log(`📝 Creating new clock message`);
      clockMessage = await channel.send({ content });
      await clockMessage.pin();
      console.log(
        `✅ Created and pinned clock message with ID: ${clockMessage.id}`
      );
    }

    // Add buttons to the message
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import(
      "discord.js"
    );
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("clock_in")
        .setLabel("🕐 Clock In")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("clock_out")
        .setLabel("🕒 Clock Out")
        .setStyle(ButtonStyle.Danger)
    );

    await clockMessage.edit({ content, components: [row] });
    console.log(`✅ Clock buttons set up successfully`);
  } catch (error) {
    console.error(`❌ Failed to set up clock buttons:`, error);
  }
}

export async function updateRosterMessage(channel, database) {
  const rosterCollection = database.collection(config.DATABASE.COLLECTION_NAME);

  // Get current roster from database
  const currentTime = new Date();
  const rosterEntries = await rosterCollection
    .find({
      guildId: channel.guild.id,
      clockOutTime: { $gt: currentTime },
    })
    .toArray();

  // Build enhanced roster display with roles/classes
  let rosterContent = "";
  let roleStats = {};

  if (rosterEntries.length > 0) {
    const rosterLines = await Promise.all(
      rosterEntries.map(async (entry) => {
        const member = channel.guild.members.cache.get(entry.userId);
        if (!member) return null;

        // Try to detect roles/classes from member roles
        const memberRoles = member.roles.cache
          .filter(
            (role) => role.name !== "@everyone" && role.name !== "Clocked In"
          )
          .map((role) => role.name);

        // Common class/role patterns to look for
        const classPatterns = [
          /rdps|rdmg|ranged/i,
          /mdps|mdmg|melee/i,
          /tank|mt/i,
          /healer|heal|support/i,
          /caster|magic/i,
          /rogue|assassin/i,
          /warrior|fighter/i,
          /mage|wizard/i,
          /cleric|priest/i,
          /ranger|hunter/i,
        ];

        let detectedClass = null;
        for (const pattern of classPatterns) {
          const matchingRole = memberRoles.find((role) => pattern.test(role));
          if (matchingRole) {
            detectedClass = matchingRole;
            break;
          }
        }

        // Count roles for statistics
        if (detectedClass) {
          roleStats[detectedClass] = (roleStats[detectedClass] || 0) + 1;
        }

        const classInfo = detectedClass ? ` - ${detectedClass}` : "";

        // Calculate remaining time more precisely
        const timeLeftMs = Math.max(0, entry.clockOutTime - currentTime);
        const hoursLeft = Math.floor(timeLeftMs / (1000 * 60 * 60));
        const minutesLeft = Math.floor(
          (timeLeftMs % (1000 * 60 * 60)) / (1000 * 60)
        );

        let timeInfo = "";
        if (hoursLeft > 0) {
          timeInfo = ` (${hoursLeft}h ${minutesLeft}m)`;
        } else if (minutesLeft > 0) {
          timeInfo = ` (${minutesLeft}m)`;
        } else if (timeLeftMs > 0) {
          timeInfo = " (<1m)";
        }

        return `• ${member.displayName}${classInfo}${timeInfo}`;
      })
    );

    const validLines = rosterLines.filter((line) => line !== null);
    rosterContent = `**🎯 Active Players (${
      validLines.length
    }):**\n${validLines.join("\n")}`;
  } else {
    rosterContent = "**🎯 Active Players:**\n*No players currently clocked in*";
  }

  // Add role statistics if available
  let statsContent = "";
  if (Object.keys(roleStats).length > 0) {
    const sortedStats = Object.entries(roleStats)
      .sort(([, a], [, b]) => b - a)
      .map(([role, count]) => `${role}: ${count}`)
      .join(" • ");

    statsContent = `\n\n**📊 Role Breakdown:** ${sortedStats}`;
  }

  // Add helpful information
  const helpContent = `

**💡 How to Use:**
• Clock in/out using the buttons in #clock-station
• Find players by their roles/classes above
• Auto clock-out after 4 hours
• Use this roster to coordinate parties!

**🎮 Tips:**
• Look for complementary roles for balanced parties
• Check remaining time to plan your session
• Message players directly if you need specific roles`;

  const fullContent = rosterContent + statsContent + helpContent;

  // Find existing pinned message
  const pins = await channel.messages.fetchPinned();
  let rosterMessage = pins.find(
    (msg) => msg.author.id === channel.guild.members.me.id
  );

  if (rosterMessage) {
    // Update existing message
    await rosterMessage.edit({ content: fullContent });
  } else {
    // Create new message and pin it
    rosterMessage = await channel.send({ content: fullContent });
    await rosterMessage.pin();
  }

  // Party-finder channel should NOT have buttons - only display roster
  await rosterMessage.edit({ content: fullContent });
}

async function cleanupExpiredRosterEntries(guild, database) {
  const rosterCollection = database.collection(config.DATABASE.COLLECTION_NAME);
  const currentTime = new Date();

  // Find expired entries
  const expiredEntries = await rosterCollection
    .find({
      guildId: guild.id,
      clockOutTime: { $lte: currentTime },
    })
    .toArray();

  if (expiredEntries.length > 0) {
    console.log(
      `Cleaning up ${expiredEntries.length} expired roster entries for guild ${guild.name}`
    );

    // Remove expired entries
    await rosterCollection.deleteMany({
      guildId: guild.id,
      clockOutTime: { $lte: currentTime },
    });

    // Remove role from expired users
    for (const entry of expiredEntries) {
      try {
        const member = await guild.members.fetch(entry.userId);
        const clockedInRole = guild.roles.cache.find(
          (role) => role.name === CLOCKED_IN_ROLE_NAME
        );
        if (clockedInRole && member.roles.cache.has(clockedInRole.id)) {
          await member.roles.remove(clockedInRole);
          console.log(
            `Removed ${CLOCKED_IN_ROLE_NAME} role from ${member.displayName}`
          );

          // Try to DM the user
          try {
            await member.send(
              `👋 You were automatically clocked out after ${config.TIMERS.AUTO_CLOCK_OUT_HOURS} hours.`
            );
          } catch (dmError) {
            console.log(
              `Could not DM ${member.displayName} about auto clock-out`
            );
          }
        }
      } catch (error) {
        console.error(
          `Failed to remove role from user ${entry.userId}:`,
          error
        );
      }
    }

    // Update the roster message
    const partyFinderChannel = guild.channels.cache.find(
      (ch) =>
        ch.name === PARTY_FINDER_CHANNEL_NAME &&
        ch.type === ChannelType.GuildText
    );
    if (partyFinderChannel) {
      await updateRosterMessage(partyFinderChannel, database);
    }
  }
}
