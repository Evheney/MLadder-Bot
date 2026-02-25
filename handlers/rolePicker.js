// handlers/rolePicker.js
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

// Safe responder: reply if possible, otherwise followUp.
// Prevents DiscordAPIError[40060] (already acknowledged).
async function safeReply(interaction, payload) {
  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.followUp(payload);
    }
    return await interaction.reply(payload);
  } catch (e) {
    // If even followUp fails (rare), swallow so bot doesn't crash.
    return null;
  }
}

/**
 * Handles role picker button interactions.
 * Returns:
 *  - true  => this handler recognized + handled the interaction
 *  - false => not a role picker button, let other handlers try
 */
async function handleRolePickerButton(interaction, client) {
  if (!interaction.isButton()) return false;
  if (!ROLE_CUSTOM_IDS.has(interaction.customId)) return false;

  const guild = interaction.guild;
  if (!guild) {
    await safeReply(interaction, {
      content: "This can only be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const settings = client.db.getGuildSettings(guild.id);
  if (
    !settings?.role_builder_id ||
    !settings?.role_striker_id ||
    !settings?.role_pinkcleaner_id ||
    !settings?.role_player_id
  ) {
    await safeReply(interaction, {
      content: "Roles are not set up yet. Ask an admin to run `/setup refresh`.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const me = guild.members.me;
  if (!me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    await safeReply(interaction, {
      content: "I need the **Manage Roles** permission to assign roles.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    await safeReply(interaction, {
      content: "Could not fetch your member profile.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const roleMap = {
    builder: settings.role_builder_id,
    striker: settings.role_striker_id,
    pinkcleaner: settings.role_pinkcleaner_id,
    player: settings.role_player_id,
  };

  const picked = pickRoleKey(interaction.customId);
  const pickedRoleId = roleMap[picked];
  if (!picked || !pickedRoleId) {
    // Shouldn't happen, but we handled the button id set, so mark handled.
    await safeReply(interaction, {
      content: "Unknown role button.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  // Remove other bot roles so user has exactly one
  const toRemove = Object.values(roleMap).filter((id) => id && id !== pickedRoleId);

  // Note: Add/remove can fail if bot role is below the target role in server role list.
  await member.roles.remove(toRemove).catch(() => {});
  await member.roles.add(pickedRoleId).catch(() => {});

  // Cache selection in DB
  client.db.upsertMember({
    guildId: guild.id,
    userId: interaction.user.id,
    botRole: picked,
    username: interaction.user.username || null,
    globalName: interaction.user.globalName || null,
    nickname: member.nickname || null,
  });

  await safeReply(interaction, {
    content: `✅ Role selected: **${picked}**`,
    flags: MessageFlags.Ephemeral,
  });

  return true;
}

module.exports = { handleRolePickerButton };