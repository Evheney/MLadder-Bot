require("dotenv").config();

const fs = require("fs");
const path = require("path");

const {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  Partials
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMessages,
    // MessageContent is NOT needed for slash commands or reactions,
    // but you can keep it if you later read text messages.
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

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

// THIS PART HANDLES COMMANDS
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    console.error(`No command found: ${interaction.commandName}`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: "Error executing command.", ephemeral: true });
    } else {
      await interaction.reply({ content: "Error executing command.", ephemeral: true });
    }
  }
});

// THIS PART HANDLES reactions
const registerReactionAddHandler = require("./handlers/reactionAdd");
registerReactionAddHandler(client);

client.login(process.env.DISCORD_TOKEN);
