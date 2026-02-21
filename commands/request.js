const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");

// Optional fallback ping if builder role not configured in guild_settings
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

function buildRequestComponents(messageId, status = "open") {
  const s = String(status || "").toLowerCase();

  const claimEnabled = s === "open";
  const completeEnabled = s === "claimed";
  const cancelEnabled = s === "open" || s === "claimed";

  // If messageId not known yet, disable everything (we will edit after send)
  const hasId = !!messageId;

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(hasId ? `req:claim:${messageId}` : "req:claim:pending")
        .setLabel("Claim")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!hasId || !claimEnabled),

      new ButtonBuilder()
        .setCustomId(hasId ? `req:complete:${messageId}` : "req:complete:pending")
        .setLabel("Complete")
        .setStyle(ButtonStyle.Success)
        .setDisabled(!hasId || !completeEnabled),

      new ButtonBuilder()
        .setCustomId(hasId ? `req:cancel:${messageId}` : "req:cancel:pending")
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!hasId || !cancelEnabled)
    ),
  ];
}

async function cacheMemberFromInteraction({ interaction, client, guildId }) {
  const user = interaction.user;

  // Try to get nickname (guild-specific)
  const member = interaction.member ?? (await interaction.guild?.members.fetch(user.id).catch(() => null));

  client.db.upsertMember({
    guildId,
    userId: user.id,
    botRole: null, // do NOT override role here
    username: user.username ?? null,
    globalName: user.globalName ?? null,
    nickname: member?.nickname ?? null,
  });
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

  async execute(interaction, client) {
    const guildId = interaction.guildId;
    if (!guildId) {
      return interaction.reply({
        content: "❌ Use this command inside a server, not in DMs.",
        flags: MessageFlags.Ephemeral,
      });
    }

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
    // ✅ keep members cache fresh for exports/charts
    await cacheMemberFromInteraction({ interaction, client, guildId }).catch(() => {});

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
        `Status: **OPEN**\n` +
        `Claimed by: **—**\n\n` +
        `Buttons:\n` +
        `• **Claim** = builder takes it\n` +
        `• **Complete** = claimer finishes it\n` +
        `• **Cancel** = requester (if OPEN) / claimer (if CLAIMED) / admin`
      );

    // 1) Send message first (buttons disabled until we know msg.id)
    const msg = await channel.send({
      content: pingText,
      embeds: [embed],
      components: buildRequestComponents(null, "open"),
      allowedMentions,
    });

    // 2) Edit message with proper customIds containing msg.id
    await msg.edit({
      components: buildRequestComponents(msg.id, "open"),
    }).catch(() => {});

    // Store in SQLite
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