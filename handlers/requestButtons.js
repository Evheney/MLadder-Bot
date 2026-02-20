const {
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

function buildComponents(status) {
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

function buildEmbed({ requesterId, levels, status, claimedBy }) {
  return new EmbedBuilder()
    .setTitle("City Build Request")
    .setDescription(
      `Player: <@${requesterId}>\n` +
      `Requested: **${levels.join(", ")}**\n\n` +
      `Status: **${status}**\n` +
      `Claimed by: ${claimedBy ? `<@${claimedBy}>` : "**—**"}`
    );
}

async function updateRequestMessage(interaction, reqRow) {
  const levels = JSON.parse(reqRow.levels_json);

  const embed = buildEmbed({
    requesterId: reqRow.requester_id,
    levels,
    status: reqRow.status,
    claimedBy: reqRow.claimed_by,
  });

  await interaction.message.edit({
    embeds: [embed],
    components: buildComponents(reqRow.status),
  }).catch(() => {});
}

async function handleRequestButtons(interaction, client) {
  if (!interaction.isButton()) return;
  if (interaction.customId !== "request:claim" && interaction.customId !== "request:complete") return;
  if (!interaction.inGuild()) return;

  // Silent ack so Discord doesn't show "interaction failed"
  await interaction.deferUpdate().catch(() => {});

  const guild = interaction.guild;
  const guildId = guild.id;
  const seasonId = client.db.getOrCreateSeason(guildId);
  const messageId = interaction.message.id;

  const settings = client.db.getGuildSettings(guildId);
  const builderRoleId = settings?.role_builder_id;

  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return;

  const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
  const isBuilder = builderRoleId ? member.roles.cache.has(builderRoleId) : false;

  // Load request
  let req = client.db.getRequest({ guildId, seasonId, messageId });
  if (!req) return;

  // -------------------------
  // CLAIM
  // -------------------------
  if (interaction.customId === "request:claim") {
    if (!isBuilder && !isAdmin) return;
    if (req.status !== "open") return;

    const ok = client.db.claimRequest({
      guildId,
      seasonId,
      messageId,
      builderId: interaction.user.id,
    });
    if (!ok) return;

    req = client.db.getRequest({ guildId, seasonId, messageId });
    await updateRequestMessage(interaction, req);
    return;
  }

  // -------------------------
  // COMPLETE
  // -------------------------
  if (interaction.customId === "request:complete") {
    if (!isBuilder && !isAdmin) return;
    if (req.status !== "claimed") return;

    const isClaimer = req.claimed_by === interaction.user.id;

    // Only claimer, unless Admin override
    if (!isClaimer && !isAdmin) return;

    const levels = JSON.parse(req.levels_json);
    const creditedBuilderId = req.claimed_by; // credit claimer even if Admin presses

    const ok = client.db.completeRequest({
      guildId,
      seasonId,
      messageId,
      builderId: creditedBuilderId,
      levels,
    });
    if (!ok) return;

    req = client.db.getRequest({ guildId, seasonId, messageId });
    await updateRequestMessage(interaction, req);
    return;
  }
}

module.exports = { handleRequestButtons };