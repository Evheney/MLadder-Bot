const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionsBitField,
} = require("discord.js");

// Optional: ping a specific user if you really want.
// Better: ping the Builder role from guild_settings.
const PLO_KOON_ID = "426881818764115968"; // replace or leave as-is

function parseLevels(input) {
  const parts = input.split(/[\s,]+/).filter(Boolean);
  if (parts.length === 0) throw new Error("No levels provided.");

  const levels = parts.map(x => Number(x));
  if (levels.some(n => !Number.isInteger(n) || n < 1 || n > 200)) {
    throw new Error("Levels must be integers between 1 and 200. Example: `145 144 143`");
  }

  for (let i = 1; i < levels.length; i++) {
    if (levels[i] > levels[i - 1]) {
      throw new Error("Levels must be non-increasing (first highest). Example: `145 144 143`");
    }
  }

  if (levels.length > 4) throw new Error("Max 4 levels per request.");
  return levels;
}

function buildRequestComponents(status = "open") {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("request:claim")
        .setLabel("Claim")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(status !== "open"),
      new ButtonBuilder()
        .setCustomId("request:complete")
        .setLabel("Complete")
        .setStyle(ButtonStyle.Success)
        .setDisabled(status !== "claimed")
    ),
  ];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("request")
    .setDescription("Request builder to build one or more cities (max 4).")
    .addStringOption(opt =>
      opt
        .setName("levels")
        .setDescription("City levels, e.g. 145 144 143 (max 4, first highest)")
        .setRequired(true)
    ),

  // NOTE: we need client here
  async execute(interaction, client) {
    const guildId = interaction.guildId;
    if (!guildId) {
      return interaction.reply({
        content: "❌ Use this command inside a server, not in DMs.",
        flags: MessageFlags.Ephemeral,
      });
    }

    // Basic bot permission: must be able to send messages where command used
    const channel = interaction.channel;
    if (!channel) {
      return interaction.reply({
        content: "❌ Could not resolve the channel.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const raw = interaction.options.getString("levels", true);
    const user = interaction.user;

    let levels;
    try {
      levels = parseLevels(raw);
    } catch (e) {
      return interaction.reply({
        content: `❌ ${e.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Ensure DB + active season
    client.db.ensureGuild(guildId);
    const seasonId = client.db.getOrCreateSeason(guildId);

    // Get builder role from settings (preferred ping)
    const settings = client.db.getGuildSettings(guildId);
    const builderRoleId = settings?.role_builder_id || null;

    const pingText = builderRoleId
      ? `<@&${builderRoleId}> you have a city to build`
      : `<@${PLO_KOON_ID}> you have a city to build`;

    const allowedMentions = builderRoleId
      ? { roles: [builderRoleId] }
      : { users: [PLO_KOON_ID] };

    const embed = new EmbedBuilder()
      .setTitle("City Build Request")
      .setDescription(
        `Player: <@${user.id}>\n` +
        `Requested: **${levels.join(", ")}**\n\n` +
        `Status: **open**\n` +
        `Claimed by: **—**`
      );

    // Post the request message (this gives us a real message id immediately)
    const msg = await channel.send({
      content: pingText,
      embeds: [embed],
      components: buildRequestComponents("open"),
      allowedMentions,
    });

    // Store request in SQLite
    client.db.createRequest({
      guildId,
      seasonId,
      messageId: msg.id,
      requesterId: user.id,
      levels,
    });

    return interaction.editReply(`✅ Request created: ${msg.url}`);
  },
};

