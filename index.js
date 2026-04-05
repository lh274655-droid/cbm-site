const {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
} = require("discord.js");

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const CANAL_ENTRADA_ID = process.env.CANAL_ENTRADA_ID || "";
const CANAL_SAIDA_ID = process.env.CANAL_SAIDA_ID || "";
const CATEGORIA_TICKETS_ID = process.env.CATEGORIA_TICKETS_ID || "";
const CARGO_ATENDIMENTO_ID = process.env.CARGO_ATENDIMENTO_ID || "";
const CARGO_MEMBRO_ID = process.env.CARGO_MEMBRO_ID || "";

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("Faltam variáveis obrigatórias: TOKEN, CLIENT_ID e GUILD_ID");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
  partials: [Partials.Channel],
});

const ticketsEmCriacao = new Set();

const commands = [
  new SlashCommandBuilder()
    .setName("painel")
    .setDescription("Envia o painel de tickets"),

  new SlashCommandBuilder()
    .setName("fechar")
    .setDescription("Fecha o ticket atual"),
].map(cmd => cmd.toJSON());

async function registrarComandos() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log("Comandos registrados com sucesso.");
}

function criarEmbedPainel() {
  return new EmbedBuilder()
    .setTitle("🎫 Central de Atendimento")
    .setDescription("Clique no botão abaixo para abrir seu ticket.")
    .setColor(0xff2b2b)
    .setFooter({ text: "CBM BOT" })
    .setTimestamp();
}

function criarBotoesPainel() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("abrir_ticket")
      .setLabel("Abrir Ticket")
      .setEmoji("🎫")
      .setStyle(ButtonStyle.Danger)
  );
}

function criarBotaoFechar() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("fechar_ticket")
      .setLabel("Fechar Ticket")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Secondary)
  );
}

function nomeTicket(user) {
  return `ticket-${user.id}`;
}

async function procurarTicketAberto(guild, userId) {
  const channels = await guild.channels.fetch();
  return channels.find(channel =>
    channel &&
    channel.type === ChannelType.GuildText &&
    channel.name === `ticket-${userId}`
  );
}

async function criarTicket(interaction) {
  const { guild, user } = interaction;

  if (ticketsEmCriacao.has(user.id)) {
    return interaction.reply({
      content: "⏳ Seu ticket já está sendo criado, aguarde...",
      ephemeral: true,
    });
  }

  ticketsEmCriacao.add(user.id);

  try {
    const ticketExistente = await procurarTicketAberto(guild, user.id);

    if (ticketExistente) {
      return interaction.reply({
        content: `❌ Você já possui um ticket aberto: ${ticketExistente}`,
        ephemeral: true,
      });
    }

    const permissionOverwrites = [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionsBitField.Flags.ViewChannel],
      },
      {
        id: user.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
      },
    ];

    if (CARGO_ATENDIMENTO_ID) {
      permissionOverwrites.push({
        id: CARGO_ATENDIMENTO_ID,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.ManageChannels,
        ],
      });
    }

    const channel = await guild.channels.create({
      name: nomeTicket(user),
      type: ChannelType.GuildText,
      parent: CATEGORIA_TICKETS_ID || null,
      permissionOverwrites,
    });

    const embed = new EmbedBuilder()
      .setTitle("🎫 Ticket Aberto")
      .setDescription(
        [
          `Olá ${user}, seu ticket foi criado com sucesso.`,
          "",
          "Explique aqui o que você precisa.",
          CARGO_ATENDIMENTO_ID
            ? `<@&${CARGO_ATENDIMENTO_ID}> foi avisado.`
            : "Equipe avisada."
        ].join("\n")
      )
      .setColor(0xff2b2b)
      .setTimestamp();

    await channel.send({
      content: `${user}`,
      embeds: [embed],
      components: [criarBotaoFechar()],
    });

    return interaction.reply({
      content: `✅ Ticket criado com sucesso: ${channel}`,
      ephemeral: true,
    });
  } catch (error) {
    console.error("Erro ao criar ticket:", error);

    if (!interaction.replied && !interaction.deferred) {
      return interaction.reply({
        content: "❌ Erro ao criar o ticket.",
        ephemeral: true,
      });
    }
  } finally {
    ticketsEmCriacao.delete(user.id);
  }
}

client.once("ready", async () => {
  console.log(`Bot online como ${client.user.tag}`);

  try {
    await registrarComandos();
  } catch (error) {
    console.error("Erro ao registrar comandos:", error);
  }
});

client.on("guildMemberAdd", async (member) => {
  try {
    if (CARGO_MEMBRO_ID) {
      await member.roles.add(CARGO_MEMBRO_ID).catch(() => null);
    }

    if (!CANAL_ENTRADA_ID) return;

    const channel = await member.guild.channels.fetch(CANAL_ENTRADA_ID).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setTitle("✅ Entrada Automática")
      .setDescription(`${member} entrou no servidor.`)
      .setThumbnail(member.user.displayAvatarURL())
      .setColor(0x57f287)
      .setTimestamp();

    await channel.send({ embeds: [embed] }).catch(() => null);
  } catch (error) {
    console.error("Erro em guildMemberAdd:", error);
  }
});

client.on("guildMemberRemove", async (member) => {
  try {
    if (!CANAL_SAIDA_ID) return;

    const channel = await member.guild.channels.fetch(CANAL_SAIDA_ID).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setTitle("📤 Saída Automática")
      .setDescription(`**${member.user.tag}** saiu do servidor.`)
      .setThumbnail(member.user.displayAvatarURL())
      .setColor(0xed4245)
      .setTimestamp();

    await channel.send({ embeds: [embed] }).catch(() => null);
  } catch (error) {
    console.error("Erro em guildMemberRemove:", error);
  }
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "painel") {
        await interaction.reply({
          embeds: [criarEmbedPainel()],
          components: [criarBotoesPainel()],
        });
        return;
      }

      if (interaction.commandName === "fechar") {
        const nome = interaction.channel?.name || "";

        if (!nome.startsWith("ticket-")) {
          return interaction.reply({
            content: "❌ Esse comando só pode ser usado dentro de ticket.",
            ephemeral: true,
          });
        }

        await interaction.reply("🔒 Fechando ticket em 3 segundos...");
        setTimeout(async () => {
          await interaction.channel.delete().catch(() => null);
        }, 3000);
        return;
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === "abrir_ticket") {
        await criarTicket(interaction);
        return;
      }

      if (interaction.customId === "fechar_ticket") {
        const nome = interaction.channel?.name || "";

        if (!nome.startsWith("ticket-")) {
          return interaction.reply({
            content: "❌ Esse botão só funciona em tickets.",
            ephemeral: true,
          });
        }

        await interaction.reply({
          content: "🔒 Fechando ticket em 3 segundos...",
          ephemeral: false,
        });

        setTimeout(async () => {
          await interaction.channel.delete().catch(() => null);
        }, 3000);

        return;
      }
    }
  } catch (error) {
    console.error("Erro em interactionCreate:", error);

    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "❌ Ocorreu um erro ao executar essa ação.",
        ephemeral: true,
      }).catch(() => null);
    }
  }
});

client.login(TOKEN);
