import { ChannelType, PermissionsBitField } from "discord.js";
import fs from "fs";
import path from "path";

// Load configuration
const configPath = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../config.json"
);
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

const PARTY_FINDER_CHANNEL_NAME = config.CHANNELS.PARTY_FINDER;
const CLOCKED_IN_ROLE_NAME = config.ROLES.CLOCKED_IN;

export default async function onReady(client, database) {
  console.log(`Small Scale Bot is online as ${client.user.tag}!`);

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
  console.log(`Initializing roster system for guild: ${guild.name}`);

  // Ensure the party-finder channel exists
  let partyFinderChannel = guild.channels.cache.find(
    (ch) =>
      ch.name === PARTY_FINDER_CHANNEL_NAME && ch.type === ChannelType.GuildText
  );

  if (!partyFinderChannel) {
    console.log(`Creating ${PARTY_FINDER_CHANNEL_NAME} channel...`);
    partyFinderChannel = await guild.channels.create({
      name: PARTY_FINDER_CHANNEL_NAME,
      type: ChannelType.GuildText,
      topic: "Small-scale party finder - Clock in to find others playing!",
      permissionOverwrites: [
        {
          id: guild.id, // @everyone
          deny: [PermissionsBitField.Flags.SendMessages],
          allow: [
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.UseExternalEmojis,
          ],
        },
        {
          id: guild.roles.everyone.id,
          deny: [PermissionsBitField.Flags.SendMessages],
        },
      ],
    });
    console.log(`Created ${PARTY_FINDER_CHANNEL_NAME} channel`);
  }

  // Ensure the Clocked In role exists
  let clockedInRole = guild.roles.cache.find(
    (role) => role.name === CLOCKED_IN_ROLE_NAME
  );
  if (!clockedInRole) {
    console.log(`Creating ${CLOCKED_IN_ROLE_NAME} role...`);
    clockedInRole = await guild.roles.create({
      name: CLOCKED_IN_ROLE_NAME,
      color: 0x00ff00,
      mentionable: false,
    });
    console.log(`Created ${CLOCKED_IN_ROLE_NAME} role`);
  }

  // Create or update the roster message
  await updateRosterMessage(partyFinderChannel, database);

  console.log(`Roster system initialized for guild: ${guild.name}`);
}

async function updateRosterMessage(channel, database) {
  const rosterCollection = database.collection(config.DATABASE.COLLECTION_NAME);

  // Get current roster from database
  const currentTime = new Date();
  const rosterEntries = await rosterCollection
    .find({
      guildId: channel.guild.id,
      clockOutTime: { $gt: currentTime },
    })
    .toArray();

  const rosterUsers = rosterEntries.map((entry) => {
    const member = channel.guild.members.cache.get(entry.userId);
    return member ? member.displayName : `User ${entry.userId}`;
  });

  const content =
    rosterUsers.length > 0
      ? `**✅ Now Playing (${rosterUsers.length}):**\n${rosterUsers
          .map((name) => `- ${name}`)
          .join("\n")}`
      : "**✅ Now Playing:**\nNobody is clocked in.";

  // Find existing pinned message
  const pins = await channel.messages.fetchPinned();
  let rosterMessage = pins.find(
    (msg) => msg.author.id === channel.guild.members.me.id
  );

  if (rosterMessage) {
    // Update existing message
    await rosterMessage.edit({ content });
  } else {
    // Create new message and pin it
    rosterMessage = await channel.send({ content });
    await rosterMessage.pin();
  }

  // Add buttons to the message
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import(
    "discord.js"
  );
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
