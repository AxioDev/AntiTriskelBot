require('dotenv').config();
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');
const { Client } = require('discord.js-selfbot-v13');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const KICK_CHANNEL_SLUG = process.env.KICK_CHANNEL_SLUG ?? 'triskel';
const TARGET_GUILD_ID = process.env.TARGET_GUILD_ID ?? '261939673662750721';
const TARGET_VOICE_CHANNEL_ID = process.env.TARGET_VOICE_CHANNEL_ID ?? '1000397725231235205';
const TARGET_USER_ID = process.env.TARGET_USER_ID ?? '997805984732958740';
const CHECK_INTERVAL_MS = Number(process.env.CHECK_INTERVAL_MS ?? '30000');
const KICK_TIMEOUT_MS = Number(process.env.KICK_TIMEOUT_MS ?? '10000');
const AUDIO_DIRECTORY = path.resolve(__dirname, '..', 'audios');

if (!DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN environment variable.');
  process.exit(1);
}

if (Number.isNaN(CHECK_INTERVAL_MS) || CHECK_INTERVAL_MS <= 0) {
  throw new Error('CHECK_INTERVAL_MS must be a positive number of milliseconds.');
}

if (!fs.existsSync(AUDIO_DIRECTORY)) {
  fs.mkdirSync(AUDIO_DIRECTORY, { recursive: true });
}

const client = new Client();

let voiceConnection = null;
let conditionsMet = false;
let checkInProgress = false;
let audioPlaylist = [];
let audioIndex = 0;

const audioPlayer = createAudioPlayer();

audioPlayer.on(AudioPlayerStatus.Idle, () => {
  if (!conditionsMet || !voiceConnection) {
    return;
  }

  if (audioPlaylist.length === 0) {
    console.warn('Audio playlist is empty. Disconnecting from voice channel.');
    disconnectFromVoice();
    return;
  }

  playNextTrack();
});

audioPlayer.on('error', (error) => {
  console.error('Audio player error:', error);
});

async function isKickLive() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), KICK_TIMEOUT_MS);

  try {
    const response = await fetch(`https://kick.com/api/v1/channels/${encodeURIComponent(KICK_CHANNEL_SLUG)}`, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'AntiTriskelBot/1.0 (+https://github.com/AxioDev/libre-antenne-bot)',
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`Kick API request failed with status ${response.status}`);
      return false;
    }

    const data = await response.json();
    const livestream = data?.livestream ?? null;

    return Boolean(livestream && (livestream.is_live ?? true));
  } catch (error) {
    if (error.name === 'AbortError') {
      console.warn('Kick API request timed out.');
    } else {
      console.error('Failed to check Kick live status:', error);
    }
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function getGuild() {
  const cached = client.guilds.cache.get(TARGET_GUILD_ID);
  if (cached) {
    return cached;
  }

  try {
    return await client.guilds.fetch(TARGET_GUILD_ID);
  } catch (error) {
    console.error('Unable to fetch target guild:', error);
    return null;
  }
}

async function isTargetUserInVoice(guild) {
  try {
    const member = await guild.members.fetch(TARGET_USER_ID);
    return member?.voice?.channelId === TARGET_VOICE_CHANNEL_ID;
  } catch (error) {
    console.error('Unable to fetch target member:', error);
    return false;
  }
}

function refreshAudioPlaylist() {
  try {
    const files = fs
      .readdirSync(AUDIO_DIRECTORY, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.mp3'))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    audioPlaylist = files.map((file) => path.join(AUDIO_DIRECTORY, file));
    audioIndex = 0;

    if (audioPlaylist.length === 0) {
      console.warn('No MP3 files found in audios/. The bot will not play anything.');
    }
  } catch (error) {
    console.error('Failed to read audio directory:', error);
    audioPlaylist = [];
    audioIndex = 0;
  }
}

function playNextTrack() {
  if (audioPlaylist.length === 0) {
    return;
  }

  const track = audioPlaylist[audioIndex];
  audioIndex = (audioIndex + 1) % audioPlaylist.length;

  try {
    const resource = createAudioResource(fs.createReadStream(track));
    audioPlayer.play(resource);
    console.log(`Now playing: ${path.basename(track)}`);
  } catch (error) {
    console.error(`Failed to play track ${track}:`, error);

    if (audioIndex === 0) {
      // Prevent tight loop if the only track fails repeatedly.
      setTimeout(() => {
        if (conditionsMet && voiceConnection) {
          playNextTrack();
        }
      }, 1000);
    } else if (conditionsMet && voiceConnection) {
      playNextTrack();
    }
  }
}

async function connectToVoice(guild) {
  const channel =
    guild.channels.cache.get(TARGET_VOICE_CHANNEL_ID) ??
    (await guild.channels.fetch(TARGET_VOICE_CHANNEL_ID).catch((error) => {
      console.error('Unable to fetch target voice channel:', error);
      return null;
    }));

  if (!channel) {
    console.error('Target voice channel not found.');
    return;
  }

  if (channel.type !== 'GUILD_VOICE' && channel.type !== 'GUILD_STAGE_VOICE') {
    console.error('Target channel is not a voice-capable channel.');
    return;
  }

  refreshAudioPlaylist();

  if (audioPlaylist.length === 0) {
    console.warn('Skipping voice connection because the playlist is empty.');
    return;
  }

  voiceConnection = joinVoiceChannel({
    channelId: TARGET_VOICE_CHANNEL_ID,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  });

  voiceConnection.on('error', (error) => {
    console.error('Voice connection error:', error);
  });

  voiceConnection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(voiceConnection, VoiceConnectionStatus.Signalling, 5000),
        entersState(voiceConnection, VoiceConnectionStatus.Connecting, 5000),
      ]);
    } catch (error) {
      console.warn('Voice connection disconnected and could not automatically recover.');
      disconnectFromVoice();
    }
  });

  try {
    await entersState(voiceConnection, VoiceConnectionStatus.Ready, 20_000);
    voiceConnection.subscribe(audioPlayer);
    console.log('Connected to voice channel. Starting playback.');

    if (audioPlayer.state.status === AudioPlayerStatus.Idle) {
      playNextTrack();
    }
  } catch (error) {
    console.error('Failed to establish voice connection:', error);
    disconnectFromVoice();
  }
}

function disconnectFromVoice() {
  if (voiceConnection) {
    try {
      voiceConnection.destroy();
    } catch (error) {
      console.error('Error destroying voice connection:', error);
    }
    voiceConnection = null;
  }

  audioPlayer.stop(true);
  audioIndex = 0;
}

async function evaluateConditions() {
  if (checkInProgress) {
    return;
  }

  checkInProgress = true;

  try {
    const [guild, live] = await Promise.all([getGuild(), isKickLive()]);

    if (!guild) {
      console.warn('Target guild unavailable.');
      conditionsMet = false;
      disconnectFromVoice();
      return;
    }

    const userInVoice = await isTargetUserInVoice(guild);
    const shouldConnect = live && userInVoice;

    if (shouldConnect) {
      conditionsMet = true;

      if (!voiceConnection || voiceConnection.state.status === VoiceConnectionStatus.Destroyed) {
        await connectToVoice(guild);
      } else if (audioPlayer.state.status === AudioPlayerStatus.Idle && audioPlaylist.length > 0) {
        playNextTrack();
      }
    } else {
      if (conditionsMet) {
        console.log('Conditions not met. Leaving voice channel if connected.');
      }

      conditionsMet = false;
      disconnectFromVoice();
    }
  } catch (error) {
    console.error('Failed to evaluate conditions:', error);
  } finally {
    checkInProgress = false;
  }
}

client.on('ready', async () => {
  console.log(`Logged in as ${client.user.tag}.`);
  await evaluateConditions();
  setInterval(() => {
    evaluateConditions().catch((error) => console.error('Condition evaluation error:', error));
  }, CHECK_INTERVAL_MS);
});

client.on('error', (error) => {
  console.error('Discord client error:', error);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT. Cleaning up.');
  conditionsMet = false;
  disconnectFromVoice();
  client.destroy();
  process.exit(0);
});

client.on('shardDisconnect', (event, shardId) => {
  console.warn(`Shard ${shardId} disconnected:`, event?.reason ?? 'No reason provided');
});

client.login(DISCORD_TOKEN).catch((error) => {
  console.error('Failed to login to Discord:', error);
  process.exit(1);
});
