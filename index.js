require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { DB } = require("./db");

const { handleRequestButtons } = require("./handlers/requestButtons");
const { handleRolePickerButton } = require("./handlers/rolePicker");

const {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  Partials,
  MessageFlags,
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.db = new DB();
client.commands = new Collection();

// ----------------------------
// Load Commands
// ----------------------------
const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith(".js"));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ----------------------------
// Interaction Handler
// ----------------------------
client.on(Events.InteractionCreate, async interaction => {
  try {
    // ==========================
    // SLASH COMMANDS
    // ==========================
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);

      if (!command) {
        console.error(`No command found: ${interaction.commandName}`);
        return;
      }

      await command.execute(interaction, client);
      return;
    }

    // ==========================
    // BUTTONS
    // ==========================
    if (interaction.isButton()) {
      let handled = false;

      // 1️⃣ Role Picker Handler
      try {
        handled = await handleRolePickerButton(interaction, client);
      } catch (err) {
        console.error("RolePicker button error:", err);

        // If it was a rolepick button, don't allow other handlers to reply
        if (
          interaction.customId &&
          String(interaction.customId).startsWith("rolepick:")
        ) {
          handled = true;
        }
      }

      if (handled) return;

      // 2️⃣ Request Buttons Handler
      try {
        const requestHandled = await handleRequestButtons(interaction, client);
        if (requestHandled) return;
      } catch (err) {
        console.error("RequestButtons error:", err);
      }

      return;
    }

  } catch (error) {
    console.error("Interaction handler error:", error);

    const msg = "Error handling interaction.";

    if (interaction.isRepliable()) {
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({
            content: msg,
            flags: MessageFlags.Ephemeral,
          });
        } else {
          await interaction.reply({
            content: msg,
            flags: MessageFlags.Ephemeral,
          });
        }
      } catch (_) {}
    }
  }
});

// ----------------------------
// Graceful Shutdown
// ----------------------------
function shutdown(signal) {
  console.log(`Received ${signal}, flushing queued actions...`);
  try { client.db.flushActionQueue(); } catch (e) { console.error(e); }
  try { client.db.close(); } catch (e) { console.error(e); }
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ----------------------------
// Global Error Logging
// ----------------------------
process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

// ----------------------------
// Login
// ----------------------------
client.login(process.env.DISCORD_TOKEN);