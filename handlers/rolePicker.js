const { PermissionsBitField, MessageFlags } = require("discord.js");

const ROLE_CUSTOM_IDS = new Set([
  "rolepick:builder",
  "rolepick:striker",
  "rolepick:pinkcleaner",
  "rolepick:player",
]);

function pickRoleKey(customId) {
  if (customId === "rolepick:builder") return "builder";
  if (customId === "rolepick:striker") return "striker";
  if (customId === "rolepick:pinkcleaner") return "pinkcleaner";
  if (customId === "rolepick:player") return "player";
  return null;
}

async function handleRolePickerButton(interaction, client) {
  if (!ROLE_CUSTOM_IDS.has(interaction.customId)) return;

  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "This can only be used in a server.", flags: MessageFlags.Ephemeral });
    return;
  }

  const settings = client.db.getGuildSettings(guild.id);
  if (!settings?.role_builder_id || !settings?.role_striker_id || !settings?.role_pinkcleaner_id || !settings?.role_player_id) {
    await interaction.reply({
      content: "Roles are not set up yet. Ask an admin to run `/setup`.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const me = guild.members.me;
  if (!me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    await interaction.reply({
      content: "I need the **Manage Roles** permission to assign roles.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    await interaction.reply({ content: "Could not fetch your member profile.", flags: MessageFlags.Ephemeral });
    return;
  }

  const roleMap = {
    builder: settings.role_builder_id,
    striker: settings.role_striker_id,
    pinkcleaner: settings.role_pinkcleaner_id,
    player: settings.role_player_id,
  };

  const picked = pickRoleKey(interaction.customId);
  const pickedRoleId = roleMap[picked];
  if (!pickedRoleId) return;

  // Remove other bot roles so user has exactly one
  const toRemove = Object.values(roleMap).filter(id => id && id !== pickedRoleId);
  await member.roles.remove(toRemove).catch(() => {});
  await member.roles.add(pickedRoleId);

  // Cache selection in DB
  client.db.upsertMember({
    guildId: guild.id,
    userId: interaction.user.id,
    botRole: picked,
    username: interaction.user.username || null,
    globalName: interaction.user.globalName || null,
    nickname: member.nickname || null,
  });

  await interaction.reply({
    content: `✅ Role selected: **${picked}**`,
    flags: MessageFlags.Ephemeral
  });
}

module.exports = { handleRolePickerButton };