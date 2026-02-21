const {
  SlashCommandBuilder,
  PermissionsBitField,
  MessageFlags,
} = require("discord.js");

function canRunSetTimezone(interaction) {
  const member = interaction.member; // GuildMember
  const botMember = interaction.guild?.members?.me;

  if (!member || !interaction.guild) return false;

  // Admin always allowed
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;

  // Allow if user's top role is strictly higher than bot's top role
  if (botMember?.roles?.highest && member.roles.highest.position > botMember.roles.highest.position) {
    return true;
  }

  return false;
}

function validateOffsetMinutes(mins) {
  if (!Number.isInteger(mins)) return "Offset must be an integer number of minutes.";
  // Hard safety bounds: UTC-12..UTC+14 in minutes
  if (mins < -720 || mins > 840) return "Offset out of range. Use between -720 and +840 minutes (UTC-12 to UTC+14).";
  return null;
}

function fmt(mins) {
  const sign = mins >= 0 ? "+" : "-";
  const abs = Math.abs(mins);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `UTC${sign}${hh}:${mm} (${mins} minutes)`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("settimezone")
    .setDescription("Set this server's timezone offset (affects daily stats/charts)")
    .addIntegerOption(opt =>
      opt
        .setName("offset_minutes")
        .setDescription("Timezone offset in minutes (example: -360 for UTC-6)")
        .setRequired(true)
    ),

  async execute(interaction, client) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: "❌ Use this command inside a server (not in DMs).",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!canRunSetTimezone(interaction)) {
      return interaction.reply({
        content:
          "❌ You don't have permission to change timezone.\n" +
          "Allowed: **Administrator** OR your highest role must be **above the bot's highest role**.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const offsetMinutes = interaction.options.getInteger("offset_minutes", true);
    const err = validateOffsetMinutes(offsetMinutes);
    if (err) {
      return interaction.reply({ content: `❌ ${err}`, flags: MessageFlags.Ephemeral });
    }

    const guildId = interaction.guildId;

    // Ensure guild exists + save timezone (preserves other settings)
    client.db.ensureGuild(guildId);
    client.db.saveGuildSettings({
      guildId,
      timezoneOffsetMinutes: offsetMinutes,
    });

    const current = fmt(offsetMinutes);

    return interaction.reply({
      flags: MessageFlags.Ephemeral,
      content:
        `✅ Timezone updated for this server: **${current}**\n\n` +
        `**What this changes**\n` +
        `• Defines when "Today" and "Yesterday" start/end for:\n` +
        `  - \`/activity\` comparisons\n` +
        `  - daily leaderboards\n` +
        `  - PNG charts (per-day bars)\n\n` +
        `**What data is expected**\n` +
        `• An **integer** offset in **minutes** relative to UTC.\n\n` +
        `**Examples**\n` +
        `• Regina / CST (UTC-6): \`/settimezone offset_minutes:-360\`\n` +
        `• UTC: \`/settimezone offset_minutes:0\`\n` +
        `• Cairo (UTC+2): \`/settimezone offset_minutes:120\`\n` +
        `• India (UTC+5:30): \`/settimezone offset_minutes:330\`\n\n` +
        `Tip: If your time is ahead of UTC, use **positive** minutes. If behind, use **negative** minutes.`
    });
  },
};