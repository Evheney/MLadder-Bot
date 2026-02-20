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
    // Reactions not needed once we move requests to buttons,
    // but can stay for now if your old reaction handler is still enabled.
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.db = new DB();
client.commands = new Collection();

// Load commands
const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith(".js"));
for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// Interactions (slash + buttons)
client.on(Events.InteractionCreate, async interaction => {
  try {
    // Slash commands
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) {
        console.error(`No command found: ${interaction.commandName}`);
        return;
      }
      await command.execute(interaction, client);
      return;
    }

    // Buttons (role picker + requests)
    if (interaction.isButton()) {
      // IMPORTANT: do NOT return after role picker.
      await handleRolePickerButton(interaction, client);
      await handleRequestButtons(interaction, client);
      return;
    }
  } catch (error) {
    console.error(error);

    const msg = "Error handling interaction.";
    if (interaction.isRepliable()) {
      if (interaction.replied || interaction.deferred) {
        await interaction
          .followUp({ content: msg, flags: MessageFlags.Ephemeral })
          .catch(() => {});
      } else {
        await interaction
          .reply({ content: msg, flags: MessageFlags.Ephemeral })
          .catch(() => {});
      }
    }
  }
});

// ✅ TEMPORARY: disable old reaction handler while migrating to buttons
// If you still need reactions for something else, keep it, but your old requests.json system must be OFF.
//// const registerReactionAddHandler = require("./handlers/reactionAdd");
//// registerReactionAddHandler(client);

client.login(process.env.DISCORD_TOKEN);