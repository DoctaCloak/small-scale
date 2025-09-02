# Small Scale Bot

A Discord bot for managing small-scale party finding in gaming communities. Users can clock in/out to show their availability and find others to play with.

## Features

- **Clock In/Out System**: Users can clock in to show they're available to play
- **Role Management**: Automatic assignment/removal of "Clocked In" role
- **Auto Clock-Out**: Users are automatically clocked out after 4 hours
- **Persistent Roster**: Roster data is stored in MongoDB for reliability
- **Party Finder Channel**: Dedicated channel with interactive buttons
- **Admin Commands**: Clear roster functionality for administrators

## Setup

1. **Clone and Install Dependencies**

   ```bash
   cd small-scale
   npm install
   ```

2. **Environment Configuration**

   - Copy `env-template.txt` to `.env`
   - Fill in your Discord bot credentials:
     - `DISCORD_TOKEN`: Your bot's token from Discord Developer Portal
     - `PUBLIC_KEY`: Your bot's public key
     - `APP_ID`: Your bot's application ID
     - `GUILD_ID`: Your Discord server ID
   - Configure MongoDB:
     - `MONGO_URI`: Your MongoDB connection string
   - Optional: Set custom port (default: 3001)

3. **Bot Permissions**
   Your bot needs the following Discord permissions:

   - Send Messages
   - Use Slash Commands
   - Manage Roles
   - Read Message History
   - Manage Messages (for pinning/unpinning)
   - View Channels

4. **Gateway Intents**
   The bot uses these intents (configured in code):

   - Guilds
   - Guild Members
   - Guild Messages
   - Message Content

5. **Deploy Commands**

   ```bash
   npm run register
   ```

6. **Start the Bot**
   ```bash
   npm start
   ```

## How It Works

### For Users:

1. **Clock In**: Click the "Clock In ✅" button in the party-finder channel

   - You'll get the "Clocked In" role
   - Your name appears in the "Now Playing" list
   - You'll be automatically clocked out after 4 hours

2. **Clock Out**: Click the "Clock Out 👋" button
   - The "Clocked In" role is removed
   - Your name is removed from the roster

### For Admins:

- **Clear Roster**: Use `/clear-roster` command to manually clear all users from the roster
- **Monitor**: The bot automatically manages the roster and cleans up expired entries

## Database Schema

The bot uses MongoDB with a collection named `roster` (configurable in `config.json`):

```javascript
{
  userId: String,        // Discord user ID
  guildId: String,       // Discord guild ID
  displayName: String,    // User's display name
  clockInTime: Date,      // When user clocked in
  clockOutTime: Date,     // When user will be auto clocked out
  createdAt: Date         // Record creation timestamp
}
```

## Configuration

Edit `config.json` to customize:

- Channel names
- Role names
- Timer settings
- Database collection name

## Deployment

### Docker (Recommended)

```bash
docker build -t small-scale-bot .
docker run -d --env-file .env small-scale-bot
```

### Railway

1. Connect your GitHub repository
2. Set environment variables in Railway dashboard
3. Deploy

## Troubleshooting

### Bot Not Responding to Buttons

- Ensure the bot has proper permissions in the channel
- Check that the party-finder channel exists and is configured correctly
- Verify Gateway Intents are enabled in Discord Developer Portal

### Database Connection Issues

- Check your MongoDB URI
- Ensure database user has proper permissions
- Verify network connectivity to MongoDB

### Commands Not Registering

- Run `npm run register` after making command changes
- Check Discord Developer Portal for bot permissions
- Verify APP_ID and GUILD_ID are correct

## Support

For issues or questions, please check the bot logs and ensure all configuration is correct.
