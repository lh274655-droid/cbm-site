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

const commands = [
  new SlashCommandBuilder()
    .setName("painel")
    .setDescription("Envia o painel com ticket, entrada e saída"),

  new SlashCommandBuilder()
    .setName("fechar")
    .setDescription("Fecha o ticket atual"),

  new SlashCommandBuilder()
    .setName("entrada")
    .setDescription("Registra entrada manualmente")
    .addUserOption((option) =>
      option
        .setName("usuario")
        .setDescription("Usuário para registrar entrada")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("saida")
    .setDescription("Registra saída manualmente")
    .addUserOption((option) =>
      option
        .setName("usuario")
        .setDescription("Usuário para registrar saída")
        .setRequired(true)
    ),
].map((cmd) => cmd.toJSON());

async function registrarComandos() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
    body: commands,
  });

  console.log("Comandos registrados com sucesso.");
}

function criarEmbedPainel() {
  return new EmbedBuilder()
    .setTitle("📋 Painel de Atendimento")
    .setDescription(
      [
        "Selecione uma opção abaixo:",
        "",
        "🎫 **Abrir Ticket**",
        "✅ **Registrar Entrada**",
        "📤 **Registrar Saída**",
      ].join("\n")
    )
    .setColor(0x2b2d31)
    .setTimestamp()
    .setFooter({ text: "CBM BOT" });
}

function criarBotoesPainel() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("abrir_ticket")
      .setLabel("Abrir Ticket")
      .setEmoji("🎫")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("registrar_entrada")
      .setLabel("Entrada")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("registrar_saida")
      .setLabel("Saída")
      .setEmoji("📤")
      .setStyle(ButtonStyle.Secondary)
  );
}

function criarBotaoFechar() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("fechar_ticket")
      .setLabel("Fechar Ticket")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger)
  );
}

async function procurarTicketAberto(guild, userId) {
  const channels = await guild.channels.fetch();

  return channels.find((channel) => {
    return (
      channel &&
      channel.type === ChannelType.GuildText &&
      channel.name.endsWith(userId)
    );
  });
}

function normalizarNomeCanal(user) {
  const base = `ticket-${user.username}-${user.id}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 90);

  return base;
}

async function criarTicket(interaction) {
  const { guild, user } = interaction;

  const ticketExistente = await procurarTicketAberto(guild, user.id);
  if (ticketExistente) {
    await interaction.reply({
      content: `❌ Você já tem um ticket aberto: ${ticketExistente}`,
      ephemeral: true,
    });
    return;
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
    name: normalizarNomeCanal(user),
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
          : "A equipe foi avisada.",
      ].join("\n")
    )
    .setColor(0x5865f2)
    .setTimestamp();

  await channel.send({
    content: `${user}`,
    embeds: [embed],
    components: [criarBotaoFechar()],
  });

  await interaction.reply({
    content: `✅ Ticket criado com sucesso: ${channel}`,
    ephemeral: true,
  });
}

async function registrarEntrada(interaction, alvo = null) {
  const user = alvo || interaction.user;
  const guild = interaction.guild;

  const channel = CANAL_ENTRADA_ID
    ? await guild.channels.fetch(CANAL_ENTRADA_ID).catch(() => null)
    : interaction.channel;

  if (CARGO_MEMBRO_ID) {
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (member && !member.roles.cache.has(CARGO_MEMBRO_ID)) {
      await member.roles.add(CARGO_MEMBRO_ID).catch(() => null);
    }
  }

  const embed = new EmbedBuilder()
    .setTitle("✅ Registro de Entrada")
    .setDescription(`${user} registrou entrada.`)
    .setThumbnail(user.displayAvatarURL())
    .setColor(0x57f287)
    .setTimestamp();

  if (channel && channel.isTextBased()) {
    await channel.send({ embeds: [embed] });
  }

  if (!interaction.replied && !interaction.deferred) {
    await interaction.reply({
      content: "✅ Entrada registrada com sucesso.",
      ephemeral: true,
    });
  }
}

async function registrarSaida(interaction, alvo = null) {
  const user = alvo || interaction.user;
  const guild = interaction.guild;

  const channel = CANAL_SAIDA_ID
    ? await guild.channels.fetch(CANAL_SAIDA_ID).catch(() => null)
    : interaction.channel;

  const embed = new EmbedBuilder()
    .setTitle("📤 Registro de Saída")
    .setDescription(`${user} registrou saída.`)
    .setThumbnail(user.displayAvatarURL())
    .setColor(0xed4245)
    .setTimestamp();

  if (channel && channel.isTextBased()) {
    await channel.send({ embeds: [embed] });
  }

  if (!interaction.replied && !interaction.deferred) {
    await interaction.reply({
      content: "📤 Saída registrada com sucesso.",
      ephemeral: true,
    });
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
  if (!CANAL_ENTRADA_ID) return;

  const channel = await member.guild.channels
    .fetch(CANAL_ENTRADA_ID)
    .catch(() => null);

  if (!channel || !channel.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setTitle("👋 Bem-vindo(a)")
    .setDescription(`${member} entrou no servidor.`)
    .setThumbnail(member.user.displayAvatarURL())
    .setColor(0x57f287)
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => null);

  if (CARGO_MEMBRO_ID) {
    await member.roles.add(CARGO_MEMBRO_ID).catch(() => null);
  }
});

client.on("guildMemberRemove", async (member) => {
  if (!CANAL_SAIDA_ID) return;

  const channel = await member.guild.channels
    .fetch(CANAL_SAIDA_ID)
    .catch(() => null);

  if (!channel || !channel.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setTitle("📤 Membro saiu")
    .setDescription(`**${member.user.tag}** saiu do servidor.`)
    .setThumbnail(member.user.displayAvatarURL())
    .setColor(0xed4245)
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => null);
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
        const name = interaction.channel?.name || "";

        if (!name.startsWith("ticket-")) {
          await interaction.reply({
            content: "❌ Esse comando só pode ser usado dentro de um ticket.",
            ephemeral: true,
          });
          return;
        }

        await interaction.reply("🔒 Fechando ticket em 3 segundos...");
        setTimeout(async () => {
          await interaction.channel.delete().catch(() => null);
        }, 3000);
        return;
      }

      if (interaction.commandName === "entrada") {
        const usuario = interaction.options.getUser("usuario");
        await registrarEntrada(interaction, usuario);
        return;
      }

      if (interaction.commandName === "saida") {
        const usuario = interaction.options.getUser("usuario");
        await registrarSaida(interaction, usuario);
        return;
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === "abrir_ticket") {
        await criarTicket(interaction);
        return;
      }

      if (interaction.customId === "registrar_entrada") {
        await registrarEntrada(interaction);
        return;
      }

      if (interaction.customId === "registrar_saida") {
        await registrarSaida(interaction);
        return;
      }

      if (interaction.customId === "fechar_ticket") {
        const name = interaction.channel?.name || "";

        if (!name.startsWith("ticket-")) {
          await interaction.reply({
            content: "❌ Esse botão só funciona em tickets.",
            ephemeral: true,
          });
          return;
        }

        await interaction.reply({
          content: "🔒 Fechando ticket em 3 segundos...",
          ephemeral: false,
        });

        setTimeout(async () => {
          await interaction.channel.delete().catch(() => null);
        }, 3000);
      }
    }
  } catch (error) {
    console.error("Erro na interaction:", error);

    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "❌ Ocorreu um erro ao executar essa ação.",
        ephemeral: true,
      }).catch(() => null);
    }
  }
});

client.login(TOKEN);
