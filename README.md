# AntiTriskelBot

This project is a Discord self-bot powered by [`discord.js-selfbot-v13`](https://www.npmjs.com/package/discord.js-selfbot-v13). It monitors the Kick channel [`https://kick.com/triskel`](https://kick.com/triskel) and a specific voice channel on Discord. Whenever the Kick stream is live **and** the target Discord user is connected to the configured voice channel, the self-bot joins the same voice channel and loops through every MP3 file found in the `audios/` directory. Playback stops and the bot disconnects automatically once any of the conditions are no longer fulfilled.

> ⚠️ **Self-bots are against the Discord Terms of Service.** Use this code at your own risk.

## Prerequisites

- Node.js 20.x
- A Discord account token with access to the target guild and voice channel
- FFmpeg (required by `@discordjs/voice` to play MP3 files)
- MP3 audio files stored in `audios/`

## Configuration

Create a `.env` file based on the provided `.env.example`:

```bash
cp .env.example .env
```

Fill in the variables:

- `DISCORD_TOKEN`: Discord user token used by the self-bot.
- `KICK_CHANNEL_SLUG`: Kick channel slug (defaults to `triskel`).
- `TARGET_GUILD_ID`: Discord guild (server) ID to monitor.
- `TARGET_VOICE_CHANNEL_ID`: Voice channel ID where playback should occur.
- `TARGET_USER_ID`: Discord user ID that must be present in the voice channel.
- `CHECK_INTERVAL_MS`: Interval in milliseconds between condition checks (defaults to 30000).
- `KICK_TIMEOUT_MS`: Timeout in milliseconds for Kick API calls (defaults to 10000).

Add at least one MP3 file to the `audios/` directory. Files are played alphabetically and loop continuously while the conditions remain satisfied.

## Usage

Install dependencies and start the bot:

```bash
npm install
npm start
```

The bot will automatically join and leave the configured voice channel based on the stream and presence checks. Press `Ctrl+C` to stop the process gracefully.
