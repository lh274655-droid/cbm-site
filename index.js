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
  AttachmentBuilder,
} = require("discord.js");

const PDFDocument = require("pdfkit");

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const CANAL_PAINEL_ID = process.env.CANAL_PAINEL_ID || "";
const CATEGORIA_TICKETS_ID = process.env.CATEGORIA_TICKETS_ID || "";
const CARGO_ATENDIMENTO_ID = process.env.CARGO_ATENDIMENTO_ID || "";
const CANAL_TRANSCRIPT_ID = process.env.CANAL_TRANSCRIPT_ID || "";
const PAINEL_IMAGEM_URL = process.env.PAINEL_IMAGEM_URL || "";
const PAINEL_TITULO = process.env.PAINEL_TITULO || "🎫 CENTRAL DE ATENDIMENTO";
const PAINEL_TEXTO =
  process.env.PAINEL_TEXTO ||
  "Clique no botão abaixo para abrir seu ticket.\n\n• Um ticket por usuário\n• Atendimento privado\n• Aguarde a equipe assumir";
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
    GatewayIntentBits.MessageContent,
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

  new SlashCommandBuilder()
    .setName("assumir")
    .setDescription("Assume o ticket atual"),
].map((cmd) => cmd.toJSON());

async function registrarComandos() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
    body: commands,
  });
  console.log("Comandos registrados com sucesso.");
}

function criarEmbedPainel() {
  const embed = new EmbedBuilder()
    .setTitle(PAINEL_TITULO)
    .setDescription(PAINEL_TEXTO)
    .setColor(0x0b5ed7)
    .setFooter({ text: "CBM BOT • Painel Fixo" })
    .setTimestamp();

  if (PAINEL_IMAGEM_URL) {
    embed.setImage(PAINEL_IMAGEM_URL);
  }

  return embed;
}

function criarBotoesPainel() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("abrir_ticket")
      .setLabel("Abrir Ticket")
      .setEmoji("🎫")
      .setStyle(ButtonStyle.Primary)
  );
}

function criarBotoesTicket() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("assumir_ticket")
      .setLabel("Assumir Ticket")
      .setEmoji("👮")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("fechar_ticket")
      .setLabel("Fechar Ticket")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger)
  );
}

function nomeTicket(userId) {
  return `ticket-${userId}`;
}

function escaparTexto(texto) {
  return String(texto || "")
    .replace(/\r/g, "")
    .replace(/\t/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function procurarTicketAberto(guild, userId) {
  const channels = await guild.channels.fetch();

  return channels.find(
    (channel) =>
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

  if (MENSAGEM_PAINEL_ID) {
    const mensagemExistente = await canalPainel.messages
      .fetch(MENSAGEM_PAINEL_ID)
      .catch(() => null);

    if (mensagemExistente) {
      await mensagemExistente.edit({
        embeds: [embed],
        components,
      });

      return { type: "updated", message: mensagemExistente };
    }
  }

  const mensagens = await canalPainel.messages.fetch({ limit: 50 }).catch(() => null);

  if (mensagens) {
    const painelAntigo = mensagens.find(
      (msg) =>
        msg.author.id === client.user.id &&
        msg.embeds.length > 0 &&
        msg.embeds[0].title === PAINEL_TITULO
    );

    if (painelAntigo) {
      await painelAntigo.edit({
        embeds: [embed],
        components,
      });

      MENSAGEM_PAINEL_ID = painelAntigo.id;
      console.log(`Painel fixo atualizado. ID: ${MENSAGEM_PAINEL_ID}`);
      return { type: "updated", message: painelAntigo };
    }
  }

  const novaMensagem = await canalPainel.send({
    embeds: [embed],
    components,
  });

  MENSAGEM_PAINEL_ID = novaMensagem.id;
  console.log(`Painel fixo criado. ID: ${MENSAGEM_PAINEL_ID}`);
  return { type: "created", message: novaMensagem };
}

function staffTemPermissao(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  if (!CARGO_ATENDIMENTO_ID) return false;
  return member.roles.cache.has(CARGO_ATENDIMENTO_ID);
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
      topic: `ticketUser:${user.id} | assumidoPor:ninguem`,
      permissionOverwrites,
    });

    const embed = new EmbedBuilder()
      .setTitle("🎫 Ticket Aberto")
      .setDescription(
        [
          `Olá ${user}, seu ticket foi criado com sucesso.`,
          "",
          "Explique aqui o que você precisa.",
          "",
          CARGO_ATENDIMENTO_ID
            ? `Equipe avisada: <@&${CARGO_ATENDIMENTO_ID}>`
            : "Equipe avisada.",
        ].join("\n")
      )
      .setColor(0x0b5ed7)
      .setTimestamp();

    await channel.send({
      content: `${user}`,
      embeds: [embed],
      components: [criarBotoesTicket()],
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

async function assumirTicket(interaction) {
  const channel = interaction.channel;
  const member = interaction.member;

  if (!channel || !channel.name.startsWith("ticket-")) {
    return interaction.reply({
      content: "❌ Isso só pode ser usado dentro de ticket.",
      ephemeral: true,
    });
  }

  if (!staffTemPermissao(member)) {
    return interaction.reply({
      content: "❌ Você não tem permissão para assumir tickets.",
      ephemeral: true,
    });
  }

  const topicoAtual = channel.topic || "";
  if (topicoAtual.includes(`assumidoPor:${interaction.user.id}`)) {
    return interaction.reply({
      content: "ℹ️ Você já assumiu este ticket.",
      ephemeral: true,
    });
  }

  const novoTopico = topicoAtual.replace(/assumidoPor:[^|]+/i, `assumidoPor:${interaction.user.id}`);

  await channel.setTopic(novoTopico).catch(() => null);

  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle("👮 Ticket Assumido")
        .setDescription(`${interaction.user} assumiu este ticket.`)
        .setColor(0x57f287)
        .setTimestamp(),
    ],
  });

  if (interaction.isButton()) {
    return interaction.reply({
      content: "✅ Ticket assumido com sucesso.",
      ephemeral: true,
    });
  }

  return interaction.reply({
    content: "✅ Ticket assumido com sucesso.",
    ephemeral: true,
  });
}

async function buscarMensagensDoCanal(channel) {
  let ultimaId = null;
  const todas = [];

  while (true) {
    const options = { limit: 100 };
    if (ultimaId) options.before = ultimaId;

    const batch = await channel.messages.fetch(options).catch(() => null);
    if (!batch || batch.size === 0) break;

    todas.push(...batch.values());
    ultimaId = batch.last().id;

    if (batch.size < 100) break;
    if (todas.length >= 1000) break;
  }

  return todas.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

async function gerarTranscriptPDF(channel, closedByTag) {
  const mensagens = await buscarMensagensDoCanal(channel);

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margin: 40,
        size: "A4",
      });

      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      doc.fontSize(18).text("Transcript do Ticket", { align: "center" });
      doc.moveDown(0.5);
      doc.fontSize(10).text(`Canal: #${channel.name}`);
      doc.text(`Fechado por: ${closedByTag}`);
      doc.text(`Data: ${new Date().toLocaleString("pt-BR")}`);
      doc.moveDown();

      doc.fontSize(12).text("Mensagens:", { underline: true });
      doc.moveDown(0.5);

      if (mensagens.length === 0) {
        doc.fontSize(10).text("Nenhuma mensagem encontrada.");
      } else {
        for (const msg of mensagens) {
          const autor = `${msg.author?.tag || "Usuário desconhecido"}`;
          const data = new Date(msg.createdTimestamp).toLocaleString("pt-BR");
          const conteudo = escaparTexto(msg.content) || "[sem texto]";
          const anexos =
            msg.attachments?.size > 0
              ? ` | anexos: ${[...msg.attachments.values()].map((a) => a.url).join(", ")}`
              : "";

          const linha = `[${data}] ${autor}: ${conteudo}${anexos}`;

          doc.fontSize(9).text(linha, {
            width: 515,
            align: "left",
          });

          doc.moveDown(0.25);
        }
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

async function enviarTranscriptEFechar(channel, closedByUser) {
  const guild = channel.guild;
  const transcriptChannel = CANAL_TRANSCRIPT_ID
    ? await guild.channels.fetch(CANAL_TRANSCRIPT_ID).catch(() => null)
    : null;

  const pdfBuffer = await gerarTranscriptPDF(channel, closedByUser.tag);
  const attachment = new AttachmentBuilder(pdfBuffer, {
    name: `transcript-${channel.name}.pdf`,
  });

  const infoEmbed = new EmbedBuilder()
    .setTitle("📄 Transcript do Ticket")
    .setDescription(
      [
        `Canal: **#${channel.name}**`,
        `Fechado por: ${closedByUser}`,
      ].join("\n")
    )
    .setColor(0x0b5ed7)
    .setTimestamp();

  if (transcriptChannel && transcriptChannel.isTextBased()) {
    await transcriptChannel.send({
      embeds: [infoEmbed],
      files: [attachment],
    }).catch(console.error);
  }

  await channel.send("🔒 Fechando ticket em 3 segundos...");
  setTimeout(async () => {
    await channel.delete().catch(() => null);
  }, 3000);
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
              ? `✅ Painel fixo criado: ${resultado.message.url}`
              : `✅ Painel fixo atualizado: ${resultado.message.url}`,
        });
        return;
      }

      if (interaction.commandName === "assumir") {
        await assumirTicket(interaction);
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

        await interaction.deferReply({ ephemeral: true });
        await interaction.editReply("📄 Gerando transcript e fechando ticket...");
        await enviarTranscriptEFechar(interaction.channel, interaction.user);
        return;
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === "abrir_ticket") {
        await criarTicket(interaction);
        return;
      }

      if (interaction.customId === "assumir_ticket") {
        await assumirTicket(interaction);
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
          content: "📄 Gerando transcript e fechando ticket...",
          ephemeral: true,
        });

        await enviarTranscriptEFechar(interaction.channel, interaction.user);
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
