const {
  SlashCommandBuilder,
  PermissionsBitField,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");

/** -------------------------
 *  Permissions: Admin OR above bot role
 * ------------------------- */
function canRunSetupRefresh(interaction) {
  const member = interaction.member; // GuildMember (provided by discord.js)
  const botMember = interaction.guild.members.me;

  // Admin permission always allowed
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;

  // "Above bot role" allowed: user's top role must be strictly higher than bot's top role
  if (
    botMember?.roles?.highest &&
    member.roles?.highest &&
    member.roles.highest.position > botMember.roles.highest.position
  ) {
    return true;
  }

  return false;
}

function norm(s) {
  return String(s || "").trim().toLowerCase();
}

/** -------------------------
 *  Ensure Roles (case-insensitive, reuse if exists)
 * ------------------------- */
async function ensureRoles(guild) {
  const want = [
    { key: "builder", name: "Builder" },
    { key: "striker", name: "Striker" },
    { key: "pinkcleaner", name: "PinkCleaner" },
    { key: "player", name: "Player" },
  ];

  const roles = await guild.roles.fetch();
  const found = {};

  // Find by name (case-insensitive)
  for (const w of want) {
    const match = roles.find(r => norm(r.name) === norm(w.name));
    if (match) found[w.key] = match;
  }

  // Create missing
  for (const w of want) {
    if (!found[w.key]) {
      found[w.key] = await guild.roles.create({
        name: w.name,
        reason: "Bot setup: create role picker roles",
      });
    }
  }

  return {
    builder: found.builder.id,
    striker: found.striker.id,
    pinkcleaner: found.pinkcleaner.id,
    player: found.player.id,
  };
}

/** -------------------------
 *  Ensure Roles Channel
 *  Priority:
 *    1) DB channel id (if exists and valid)
 *    2) find #roles by name
 *    3) create #roles
 * ------------------------- */
async function ensureRolesChannel(guild, rolesChannelIdFromDb) {
  // 1) Try DB channel id
  if (rolesChannelIdFromDb) {
    const byId = await guild.channels.fetch(rolesChannelIdFromDb).catch(() => null);
    if (byId && byId.type === ChannelType.GuildText) return byId;
  }

  // 2) Find by name
  const channels = await guild.channels.fetch();
  let rolesChan = channels.find(
    ch => ch && ch.type === ChannelType.GuildText && norm(ch.name) === "roles"
  );
  if (rolesChan) return rolesChan;

  // 3) Create
  rolesChan = await guild.channels.create({
    name: "roles",
    type: ChannelType.GuildText,
    reason: "Bot setup: create roles channel",
  });

  return rolesChan;
}

function buildRolePickerMessage() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("rolepick:builder")
      .setLabel("Builder")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("rolepick:striker")
      .setLabel("Striker")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("rolepick:pinkcleaner")
      .setLabel("PinkCleaner")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("rolepick:player")
      .setLabel("Player")
      .setStyle(ButtonStyle.Success)
  );

  return {
    content:
      "Pick your role by clicking a button below.\n" +
      "You can change it anytime by clicking again.",
    components: [row],
  };
}

/** -------------------------
 *  Repost pinned picker message safely
 *  - If old message exists: unpin + delete
 *  - Post new message: pin
 * ------------------------- */
async function repostPinnedPicker(channel, oldMessageId) {
  if (oldMessageId) {
    const old = await channel.messages.fetch(oldMessageId).catch(() => null);
    if (old) {
      await old.unpin().catch(() => {});
      await old.delete().catch(() => {});
    }
  }

  const msg = await channel.send(buildRolePickerMessage());
  await msg.pin().catch(() => {});
  return msg.id;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Setup roles channel + pinned role picker (restricted)")
    .addSubcommand(sc =>
      sc.setName("refresh").setDescription("Repair/refresh roles + channel + pinned picker message")
    ),

  async execute(interaction, client) {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // ✅ Permission check: Admin OR above bot role
    if (!canRunSetupRefresh(interaction)) {
      await interaction.reply({
        content:
          "You must be **Administrator** OR have a **highest role above the bot** to run `/setup refresh`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Bot permission checks
    const me = guild.members.me;
    if (!me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      await interaction.reply({
        content: "I need the **Manage Roles** permission.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!me?.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
      await interaction.reply({
        content: "I need the **Manage Channels** permission.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Ensure guild exists in DB
    client.db.ensureGuild(guild.id);

    // Load settings early (for channel recovery + old pinned msg)
    const settings = client.db.getGuildSettings(guild.id) || {};

    // 1) Ensure roles (case-insensitive)
    const roleIds = await ensureRoles(guild);

    // 2) Ensure roles channel (recover if deleted)
    const channel = await ensureRolesChannel(guild, settings.roles_channel_id);

    // 3) Repost pinned picker message (in that channel)
    const oldMsgId = settings?.roles_message_id || null;
    const newMsgId = await repostPinnedPicker(channel, oldMsgId);

    // Save settings in DB
    client.db.saveGuildSettings({
  guild_id: guild.id,
  roles_channel_id: channel.id,
  roles_message_id: newMsgId,
  role_builder_id: roleIds.builder,
  role_striker_id: roleIds.striker,
  role_pinkcleaner_id: roleIds.pinkcleaner,
  role_player_id: roleIds.player,
});

    await interaction.editReply(
      "✅ Setup refreshed.\n" +
        `• Roles channel: <#${channel.id}>\n` +
        "• Pinned role picker message updated.\n" +
        "Users can pick roles by clicking buttons."
    );
  },
};