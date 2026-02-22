"use strict";

const {
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");

// =========================================================
// Helpers: permission
// =========================================================
function canAdminOrAboveBot(interaction) {
  const member = interaction.member;
  const botMember = interaction.guild?.members?.me;
  if (!member || !interaction.guild) return false;

  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;

  if (botMember?.roles?.highest && member.roles.highest.position > botMember.roles.highest.position) {
    return true;
  }
  return false;
}

// =========================================================
// Helpers: parsing + UI builders
// =========================================================
function parseCustomId(customId) {
  // req:claim:<messageId> | req:complete:<messageId> | req:cancel:<messageId>
  const parts = String(customId || "").split(":");
  if (parts.length !== 3) return null;
  if (parts[0] !== "req") return null;
  if (!["claim", "complete", "cancel"].includes(parts[1])) return null;
  return { action: parts[1], messageId: parts[2] };
}

function buildComponents(messageId, status) {
  const s = String(status || "").toLowerCase();
  const isOpen = s === "open";
  const isClaimed = s === "claimed";
  const isFinal = s === "completed" || s === "cancelled";

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`req:claim:${messageId}`)
        .setLabel("Claim")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!isOpen || isFinal),

      new ButtonBuilder()
        .setCustomId(`req:complete:${messageId}`)
        .setLabel("Complete")
        .setStyle(ButtonStyle.Success)
        .setDisabled(!isClaimed || isFinal),

      new ButtonBuilder()
        .setCustomId(`req:cancel:${messageId}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!(isOpen || isClaimed) || isFinal)
    ),
  ];
}

function buildEmbed({ requesterId, levels, status, claimedBy, cancelledBy }) {
  const s = String(status || "").toUpperCase();
  const claimedLine = claimedBy ? `<@${claimedBy}>` : "**—**";
  const cancelledLine = cancelledBy ? `\nCancelled by: <@${cancelledBy}>` : "";

  return new EmbedBuilder()
    .setTitle("City Build Request")
    .setDescription(
      `Player: <@${requesterId}>\n` +
      `Requested: **${levels.join(", ")}**\n\n` +
      `Status: **${s}**\n` +
      `Claimed by: ${claimedLine}` +
      cancelledLine
    );
}

async function updateRequestMessage(interaction, reqRow, messageId) {
  let levels = [];
  try {
    levels = JSON.parse(reqRow.levels_json || "[]");
  } catch {
    levels = [];
  }

  let cancelledBy = null;
  try {
    const meta = reqRow.meta_json ? JSON.parse(reqRow.meta_json) : null;
    cancelledBy = meta?.cancelledBy || null;
  } catch {}

  const embed = buildEmbed({
    requesterId: reqRow.requester_id,
    levels,
    status: reqRow.status,
    claimedBy: reqRow.claimed_by,
    cancelledBy,
  });

  await interaction.message
    .edit({
      embeds: [embed],
      components: buildComponents(messageId, reqRow.status),
    })
    .catch(() => {});
}

// =========================================================
// Helpers: cache member names into DB
// =========================================================
async function cacheMember({ guild, client, guildId, userId, botRole = null }) {
  // Best effort fetch (only if not in cache)
  let member = guild.members.cache.get(userId) || null;
  if (!member) {
    member = await guild.members.fetch(userId).catch(() => null);
  }

  // user object may exist even if member fetch fails
  const user = member?.user || null;

  client.db.upsertMember({
    guildId,
    userId,
    botRole, // pass null to not override existing
    username: user?.username ?? null,
    globalName: user?.globalName ?? null,
    nickname: member?.nickname ?? null,
  });
}

// =========================================================
// NEW: Notify requester (replace previous notify for THIS request)
// - deletes old notify message stored in meta_json.notifyMessageId
// - sends new notify reply in same channel
// - stores new notify message id back to meta_json
// ========================================================
async function notifyRequesterReplaceForThisRequest({
  interaction,
  client,
  guildId,
  seasonId,
  messageId,
  req,
  levels,
}) {
  const requesterId = req.requester_id;
  const builderId = req.claimed_by;

  // Parse meta_json
  let meta = {};
  try {
    meta = req.meta_json ? JSON.parse(req.meta_json) : {};
  } catch {
    meta = {};
  }

  // Delete old notify if exists
  const oldNotifyId = meta?.notifyMessageId || null;
  if (oldNotifyId) {
    try {
      const ch = interaction.channel;
      if (ch) {
        const oldMsg = await ch.messages.fetch(oldNotifyId);
        await oldMsg.delete();
      }
    } catch {
      // ignore
    }
  }

  // Build clean mention list (no duplicates)
const mentionUsers = [...new Set([requesterId, builderId].filter(Boolean))];

// Clean text if same person completed their own request
const who =
  requesterId === builderId
    ? `<@${requesterId}> completed their request`
    : `<@${requesterId}> completed by <@${builderId}>`;

const content =
  `✅ ${who}` +
  (Array.isArray(levels) && levels.length ? ` | **${levels.join(", ")}**` : "");

let newMsg;
try {
  const ch = interaction.channel;
  if (!ch) throw new Error("No channel context.");
  newMsg = await ch.send({
    content,
    allowedMentions: { users: mentionUsers, roles: [], parse: [] },
  });
  } catch (e) {
    // show the builder/admin WHY it failed (only they see this)
    await interaction.followUp({
      content: `❌ Notify failed: ${e?.message || e}`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return;
  }

  // Save new notify id into meta_json
  meta.notifyMessageId = newMsg.id;

  // Persist (so we can delete/replace next time)
  try {
    client.db.setRequestMeta({
      guildId,
      seasonId,
      messageId,
      metaJson: JSON.stringify(meta),
    });
  } catch {
    // ignore (notify still worked)
  }
}

// =========================================================
// Main handler
// =========================================================
async function handleRequestButtons(interaction, client) {
  if (!interaction.isButton()) return;
  if (!interaction.inGuild()) return;

  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return;

  // Silent ack so Discord doesn't show "interaction failed"
  await interaction.deferUpdate().catch(() => {});

  const guild = interaction.guild;
  const guildId = guild.id;
  const seasonId = client.db.getOrCreateSeason(guildId);

  // Trust the ID in customId (supports multiple requests)
  const messageId = parsed.messageId;

  // If the clicked message doesn't match the request id, ignore (safety)
  if (interaction.message.id !== messageId) return;

  const settings = client.db.getGuildSettings(guildId);
  const builderRoleId = settings?.role_builder_id;

  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return;

  const isAdmin = canAdminOrAboveBot(interaction);
  const isBuilder = builderRoleId ? member.roles.cache.has(builderRoleId) : false;

  // ✅ Cache the clicker's name every time
  await cacheMember({ guild, client, guildId, userId: interaction.user.id, botRole: null }).catch(() => {});

  // Load request row
  let req = client.db.getRequest({ guildId, seasonId, messageId });
  if (!req) return;

  // -------------------------
  // CLAIM
  // -------------------------
  if (parsed.action === "claim") {
    if (!isBuilder && !isAdmin) return;
    if (req.status !== "open") return;

    const ok = client.db.claimRequest({
      guildId,
      seasonId,
      messageId,
      builderId: interaction.user.id,
    });
    if (!ok) return;

    // cache claimer
    await cacheMember({ guild, client, guildId, userId: interaction.user.id, botRole: "builder" }).catch(() => {});

    req = client.db.getRequest({ guildId, seasonId, messageId });
    await updateRequestMessage(interaction, req, messageId);
    return;
  }

  // -------------------------
  // COMPLETE
  // -------------------------
  if (parsed.action === "complete") {
    if (!isBuilder && !isAdmin) return;
    if (req.status !== "claimed") return;

    const isClaimer = req.claimed_by === interaction.user.id;

    // Only claimer, unless Admin override
    if (!isClaimer && !isAdmin) return;

    let levels = [];
    try {
      levels = JSON.parse(req.levels_json || "[]");
    } catch {
      levels = [];
    }

    const creditedBuilderId = req.claimed_by; // credit claimer even if Admin presses

    const ok = client.db.completeRequest({
      guildId,
      seasonId,
      messageId,
      builderId: creditedBuilderId,
      levels,
    });
    if (!ok) return;

    // cache credited builder (claimer)
    await cacheMember({ guild, client, guildId, userId: creditedBuilderId, botRole: "builder" }).catch(() => {});

    req = client.db.getRequest({ guildId, seasonId, messageId });
    await updateRequestMessage(interaction, req, messageId);

    // ✅ notify requester in same channel (replace previous notify for THIS request)
    await notifyRequesterReplaceForThisRequest({
      interaction,
      client,
      guildId,
      seasonId,
      messageId,
      req,
      levels,
    }).catch(() => {});

    return;
  }

  // -------------------------
  // CANCEL
  // -------------------------
  if (parsed.action === "cancel") {
    if (req.status !== "open" && req.status !== "claimed") return;

    const isRequester = req.requester_id === interaction.user.id;
    const isClaimer = req.claimed_by === interaction.user.id;

    // Permission:
    // OPEN => requester or admin
    // CLAIMED => claimer or admin
    let allowed = false;
    if (isAdmin) allowed = true;
    else if (req.status === "open" && isRequester) allowed = true;
    else if (req.status === "claimed" && isClaimer) allowed = true;

    if (!allowed) {
      await interaction
        .followUp({
          content:
            "❌ You can't cancel this request.\n" +
            "Allowed:\n" +
            "• If OPEN: requester or admin\n" +
            "• If CLAIMED: claimer or admin",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }

    const ok = client.db.cancelRequest({
      guildId,
      seasonId,
      messageId,
      cancelledBy: interaction.user.id,
    });
    if (!ok) return;

    req = client.db.getRequest({ guildId, seasonId, messageId });
    if (!req) return;

    await updateRequestMessage(interaction, req, messageId);
    return;
  }
}

module.exports = { handleRequestButtons };