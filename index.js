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

const CANAL_PAINEL_ID = process.env.CANAL_PAINEL_ID || "";
const CATEGORIA_TICKETS_ID = process.env.CATEGORIA_TICKETS_ID || "";
const CARGO_ATENDIMENTO_ID = process.env.CARGO_ATENDIMENTO_ID || "";

// Se quiser fixar manualmente o ID da mensagem do painel, coloque no Render:
// MENSAGEM_PAINEL_ID=123456789012345678
let MENSAGEM_PAINEL_ID = process.env.MENSAGEM_PAINEL_ID || "";

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !CANAL_PAINEL_ID) {
  console.error("Faltam variáveis obrigatórias:");
  console.error("TOKEN, CLIENT_ID, GUILD_ID, CANAL_PAINEL_ID");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
  partials: [Partials.Channel],
});

const ticketsEmCriacao = new Set();

const commands = [
  new SlashCommandBuilder()
    .setName("painel")
    .setDescription("Cria ou atualiza o painel fixo de ticket"),

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
    .setDescription(
      [
        "Clique no botão abaixo para abrir seu ticket.",
        "",
        "• Um ticket por usuário",
        "• Atendimento privado",
        "• Use apenas quando realmente precisar"
      ].join("\n")
    )
    .setColor(0xff2b2b)
    .setFooter({ text: "CBM BOT • Painel Fixo" })
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

function nomeTicket(userId) {
  return `ticket-${userId}`;
}

async function procurarTicketAberto(guild, userId) {
  const channels = await guild.channels.fetch();

  return channels.find(channel =>
    channel &&
    channel.type === ChannelType.GuildText &&
    channel.name === nomeTicket(userId)
  );
}

async function obterCanalPainel(guild) {
  const channel = await guild.channels.fetch(CANAL_PAINEL_ID).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    throw new Error("CANAL_PAINEL_ID inválido ou canal não é de texto.");
  }

  return channel;
}

async function criarOuAtualizarPainelFixo(guild) {
  const canalPainel = await obterCanalPainel(guild);
  const embed = criarEmbedPainel();
  const components = [criarBotoesPainel()];

  // 1) Se tiver ID salvo, tenta editar a mensagem existente
  if (MENSAGEM_PAINEL_ID) {
    const mensagemExistente = await canalPainel.messages.fetch(MENSAGEM_PAINEL_ID).catch(() => null);

    if (mensagemExistente) {
      await mensagemExistente.edit({
        embeds: [embed],
        components,
      });

      return {
        type: "updated",
        message: mensagemExistente,
      };
    }
  }

  // 2) Procura um painel antigo enviado pelo bot nesse canal
  const mensagens = await canalPainel.messages.fetch({ limit: 30 }).catch(() => null);

  if (mensagens) {
    const painelAntigo = mensagens.find(msg =>
      msg.author.id === client.user.id &&
      msg.embeds.length > 0 &&
      msg.embeds[0].title === "🎫 Central de Atendimento"
    );

    if (painelAntigo) {
      await painelAntigo.edit({
        embeds: [embed],
        components,
      });

      MENSAGEM_PAINEL_ID = painelAntigo.id;
      console.log(`Painel fixo atualizado. ID da mensagem: ${MENSAGEM_PAINEL_ID}`);

      return {
        type: "updated",
        message: painelAntigo,
      };
    }
  }

  // 3) Se não existir, cria novo
  const novaMensagem = await canalPainel.send({
    embeds: [embed],
    components,
  });

  MENSAGEM_PAINEL_ID = novaMensagem.id;
  console.log(`Painel fixo criado. ID da mensagem: ${MENSAGEM_PAINEL_ID}`);

  return {
    type: "created",
    message: novaMensagem,
  };
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
      name: nomeTicket(user.id),
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
    const guild = await client.guilds.fetch(GUILD_ID);
    await criarOuAtualizarPainelFixo(guild);
  } catch (error) {
    console.error("Erro no ready:", error);
  }
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "painel") {
        await interaction.deferReply({ ephemeral: true });

        const resultado = await criarOuAtualizarPainelFixo(interaction.guild);

        await interaction.editReply({
          content:
            resultado.type === "created"
              ? `✅ Painel fixo criado com sucesso: ${resultado.message.url}`
              : `✅ Painel fixo atualizado com sucesso: ${resultado.message.url}`,
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
