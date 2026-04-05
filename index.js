const {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  AttachmentBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const PDFDocument = require("pdfkit");
const express = require("express");

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const CANAL_PAINEL_ID = process.env.CANAL_PAINEL_ID;
const CATEGORIA_TICKETS_ID = process.env.CATEGORIA_TICKETS_ID || "";
const CARGO_ATENDIMENTO_ID = process.env.CARGO_ATENDIMENTO_ID || "";
const CANAL_TRANSCRIPT_ID = process.env.CANAL_TRANSCRIPT_ID || "";
const PAINEL_IMAGEM_URL = process.env.PAINEL_IMAGEM_URL || "";
const PAINEL_TITULO = process.env.PAINEL_TITULO || "🎫 CENTRAL DE ATENDIMENTO";
const PAINEL_TEXTO =
  process.env.PAINEL_TEXTO ||
  "Clique no botão abaixo para iniciar seu atendimento.\n\n• Um ticket por usuário\n• Atendimento privado\n• Selecione o tipo e preencha o formulário";
const MENSAGEM_PAINEL_ID_ENV = process.env.MENSAGEM_PAINEL_ID || "";

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !CANAL_PAINEL_ID) {
  console.error("Faltam variáveis obrigatórias:");
  console.error("TOKEN, CLIENT_ID, GUILD_ID, CANAL_PAINEL_ID");
  process.exit(1);
}

let mensagemPainelId = MENSAGEM_PAINEL_ID_ENV;

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
    .setDescription("Cria ou atualiza o painel fixo"),
  new SlashCommandBuilder()
    .setName("assumir")
    .setDescription("Assume o ticket atual"),
  new SlashCommandBuilder()
    .setName("fechar")
    .setDescription("Fecha o ticket atual com motivo"),
].map((c) => c.toJSON());

function limparTexto(texto) {
  return String(texto || "")
    .replace(/\r/g, "")
    .replace(/\t/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function nomeTicket(tipo, userId) {
  const baseTipo = String(tipo || "ticket")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]/g, "-");

  return `${baseTipo}-${userId}`.slice(0, 90);
}

function extrairCampo(topic, nome) {
  const regex = new RegExp(`${nome}:([^;]+)`, "i");
  const match = String(topic || "").match(regex);
  return match ? match[1] : null;
}

function staffTemPermissao(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  if (!CARGO_ATENDIMENTO_ID) return false;
  return member.roles.cache.has(CARGO_ATENDIMENTO_ID);
}

function criarEmbedPainel() {
  const embed = new EmbedBuilder()
    .setTitle(PAINEL_TITULO)
    .setDescription(PAINEL_TEXTO)
    .setColor(0xff2b2b)
    .setFooter({ text: "CBM BOT • Painel Fixo" })
    .setTimestamp();

  if (PAINEL_IMAGEM_URL) embed.setImage(PAINEL_IMAGEM_URL);

  return embed;
}

function criarBotaoPainel() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("iniciar_ticket")
      .setLabel("Abrir Atendimento")
      .setEmoji("🎫")
      .setStyle(ButtonStyle.Danger)
  );
}

function criarMenuTipo() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("selecionar_tipo_ticket")
      .setPlaceholder("Selecione o tipo do atendimento")
      .addOptions([
        {
          label: "Denúncia",
          value: "denuncia",
          emoji: "🚨",
          description: "Abrir ticket de denúncia",
        },
        {
          label: "Suporte",
          value: "suporte",
          emoji: "🛠️",
          description: "Abrir ticket de suporte",
        },
        {
          label: "Recrutamento",
          value: "recrutamento",
          emoji: "📋",
          description: "Abrir ticket de recrutamento",
        },
      ])
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
      .setCustomId("fechar_ticket_modal")
      .setLabel("Fechar Ticket")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger)
  );
}

function criarBotaoReabrir(ticketUserId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`reabrir_ticket:${ticketUserId}`)
      .setLabel("Reabrir Ticket")
      .setEmoji("🔓")
      .setStyle(ButtonStyle.Success)
  );
}

function criarModalAbertura(tipo) {
  const tituloMap = {
    denuncia: "Abrir Ticket - Denúncia",
    suporte: "Abrir Ticket - Suporte",
    recrutamento: "Abrir Ticket - Recrutamento",
  };

  const modal = new ModalBuilder()
    .setCustomId(`modal_abrir_ticket:${tipo}`)
    .setTitle(tituloMap[tipo] || "Abrir Ticket");

  const nomeInput = new TextInputBuilder()
    .setCustomId("nome")
    .setLabel("Seu nome")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(60)
    .setPlaceholder("Ex: Luiz Henrique");

  const idInput = new TextInputBuilder()
    .setCustomId("id_jogo")
    .setLabel("Seu ID")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(30)
    .setPlaceholder("Ex: 101");

  const descricaoInput = new TextInputBuilder()
    .setCustomId("descricao")
    .setLabel("Descrição")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000)
    .setPlaceholder("Explique detalhadamente o atendimento");

  const extraLabel =
    tipo === "recrutamento"
      ? "Experiência / Observação"
      : tipo === "denuncia"
      ? "Envolvidos / Provas"
      : "Informação adicional";

  const extraInput = new TextInputBuilder()
    .setCustomId("extra")
    .setLabel(extraLabel)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1000)
    .setPlaceholder("Opcional");

  modal.addComponents(
    new ActionRowBuilder().addComponents(nomeInput),
    new ActionRowBuilder().addComponents(idInput),
    new ActionRowBuilder().addComponents(descricaoInput),
    new ActionRowBuilder().addComponents(extraInput)
  );

  return modal;
}

function criarModalFechamento() {
  const modal = new ModalBuilder()
    .setCustomId("modal_fechar_ticket")
    .setTitle("Fechar Ticket");

  const motivoInput = new TextInputBuilder()
    .setCustomId("motivo")
    .setLabel("Qual o motivo do fechamento?")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000)
    .setPlaceholder("Ex: problema resolvido, atendimento finalizado...");

  modal.addComponents(new ActionRowBuilder().addComponents(motivoInput));
  return modal;
}

async function registrarComandos() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
    body: commands,
  });
  console.log("✅ Comandos registrados.");
}

async function procurarTicketAberto(guild, userId) {
  const channels = await guild.channels.fetch();
  return channels.find(
    (ch) =>
      ch &&
      ch.type === ChannelType.GuildText &&
      ch.name.endsWith(`-${userId}`)
  );
}

async function obterCanalPainel(guild) {
  const canal = await guild.channels.fetch(CANAL_PAINEL_ID).catch(() => null);
  if (!canal || !canal.isTextBased()) throw new Error("CANAL_PAINEL_ID inválido.");
  return canal;
}

async function criarOuAtualizarPainelFixo(guild) {
  const canal = await obterCanalPainel(guild);
  const embed = criarEmbedPainel();
  const components = [criarBotaoPainel()];

  if (mensagemPainelId) {
    const msg = await canal.messages.fetch(mensagemPainelId).catch(() => null);
    if (msg) {
      await msg.edit({ embeds: [embed], components });
      return { type: "updated", message: msg };
    }
  }

  const ultimas = await canal.messages.fetch({ limit: 30 }).catch(() => null);

  if (ultimas) {
    const painel = ultimas.find(
      (m) =>
        m.author.id === client.user.id &&
        m.embeds.length > 0 &&
        m.embeds[0].title === PAINEL_TITULO
    );

    if (painel) {
      await painel.edit({ embeds: [embed], components });
      mensagemPainelId = painel.id;
      return { type: "updated", message: painel };
    }
  }

  const nova = await canal.send({ embeds: [embed], components });
  mensagemPainelId = nova.id;
  console.log(`✅ Painel criado. ID: ${nova.id}`);
  return { type: "created", message: nova };
}

async function criarTicketComFormulario(interaction, dados, userId = null) {
  const guild = interaction.guild;
  const targetUserId = userId || interaction.user.id;
  const userObj = userId
    ? await client.users.fetch(userId).catch(() => null)
    : interaction.user;

  if (!userObj) {
    return interaction.reply({
      content: "❌ Não consegui localizar o usuário.",
      ephemeral: true,
    });
  }

  if (ticketsEmCriacao.has(targetUserId)) {
    return interaction.reply({
      content: "⏳ O ticket já está sendo criado, aguarde...",
      ephemeral: true,
    });
  }

  ticketsEmCriacao.add(targetUserId);

  try {
    const ticketExistente = await procurarTicketAberto(guild, targetUserId);
    if (ticketExistente) {
      return interaction.reply({
        content: `❌ Já existe um ticket aberto: ${ticketExistente}`,
        ephemeral: true,
      });
    }

    const overwrites = [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionsBitField.Flags.ViewChannel],
      },
      {
        id: targetUserId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
      },
    ];

    if (CARGO_ATENDIMENTO_ID) {
      overwrites.push({
        id: CARGO_ATENDIMENTO_ID,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.ManageChannels,
        ],
      });
    }

    const topicParts = [
      `ticketUser:${targetUserId}`,
      `tipo:${dados.tipo}`,
      `nome:${encodeURIComponent(dados.nome)}`,
      `idjogo:${encodeURIComponent(dados.idJogo)}`,
      `descricao:${encodeURIComponent(dados.descricao.slice(0, 150))}`,
      `assumidoPor:nenhum`,
    ];

    const canal = await guild.channels.create({
      name: nomeTicket(dados.tipo, targetUserId),
      type: ChannelType.GuildText,
      parent: CATEGORIA_TICKETS_ID || null,
      topic: topicParts.join(";"),
      permissionOverwrites: overwrites,
    });

    const tipoBonito = {
      denuncia: "Denúncia",
      suporte: "Suporte",
      recrutamento: "Recrutamento",
      reabertura: "Reabertura",
    }[dados.tipo] || dados.tipo;

    const corTipo = {
      denuncia: 0xed4245,
      suporte: 0x5865f2,
      recrutamento: 0x57f287,
      reabertura: 0xfaa61a,
    }[dados.tipo] || 0xff2b2b;

    const embed = new EmbedBuilder()
      .setTitle(userId ? "🔓 Ticket Reaberto" : "🎫 Ticket Aberto")
      .setColor(corTipo)
      .addFields(
        { name: "Tipo", value: tipoBonito, inline: true },
        { name: "Nome", value: limparTexto(dados.nome), inline: true },
        { name: "ID", value: limparTexto(dados.idJogo), inline: true },
        { name: "Descrição", value: limparTexto(dados.descricao).slice(0, 1024) }
      )
      .setTimestamp();

    if (dados.extra && limparTexto(dados.extra)) {
      embed.addFields({
        name: "Informação adicional",
        value: limparTexto(dados.extra).slice(0, 1024),
      });
    }

    await canal.send({
      content: `${userObj}${CARGO_ATENDIMENTO_ID ? ` <@&${CARGO_ATENDIMENTO_ID}>` : ""}`,
      embeds: [embed],
      components: [criarBotoesTicket()],
    });

    return interaction.reply({
      content: `✅ Ticket criado com sucesso: ${canal}`,
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
    ticketsEmCriacao.delete(targetUserId);
  }
}

async function assumirTicket(interaction) {
  const canal = interaction.channel;
  const member = interaction.member;

  if (!canal || !canal.name.includes("-")) {
    return interaction.reply({
      content: "❌ Isso só funciona em ticket.",
      ephemeral: true,
    });
  }

  if (!staffTemPermissao(member)) {
    return interaction.reply({
      content: "❌ Você não tem permissão para assumir ticket.",
      ephemeral: true,
    });
  }

  const topico = canal.topic || "";

  if (topico.includes(`assumidoPor:${interaction.user.id}`)) {
    return interaction.reply({
      content: "ℹ️ Você já assumiu este ticket.",
      ephemeral: true,
    });
  }

  const novoTopico = topico.replace(/assumidoPor:[^;]+/i, `assumidoPor:${interaction.user.id}`);
  await canal.setTopic(novoTopico).catch(() => null);

  const tipo = extrairCampo(canal.topic, "tipo") || "ticket";
  const novoNome = nomeTicket(tipo, extrairCampo(canal.topic, "ticketUser") || "user");
  await canal.setName(novoNome).catch(() => null);

  await canal.send({
    embeds: [
      new EmbedBuilder()
        .setTitle("👮 Ticket Assumido")
        .setDescription(`${interaction.user} assumiu este ticket.`)
        .setColor(0x57f287)
        .setTimestamp(),
    ],
  });

  return interaction.reply({
    content: "✅ Ticket assumido com sucesso.",
    ephemeral: true,
  });
}

async function buscarMensagens(channel) {
  let before;
  const todas = [];

  while (true) {
    const lote = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!lote || lote.size === 0) break;
    todas.push(...lote.values());
    before = lote.last().id;
    if (lote.size < 100) break;
    if (todas.length >= 1000) break;
  }

  return todas.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

async function gerarPDF(channel, fechadoPor, motivo) {
  const mensagens = await buscarMensagens(channel);

  const tipo = extrairCampo(channel.topic, "tipo") || "não informado";
  const nome = decodeURIComponent(extrairCampo(channel.topic, "nome") || "não informado");
  const idJogo = decodeURIComponent(extrairCampo(channel.topic, "idjogo") || "não informado");
  const descricao = decodeURIComponent(extrairCampo(channel.topic, "descricao") || "não informado");

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 35, size: "A4" });
    const chunks = [];

    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).text("Transcript do Ticket", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Canal: #${channel.name}`);
    doc.text(`Fechado por: ${fechadoPor.tag}`);
    doc.text(`Data: ${new Date().toLocaleString("pt-BR")}`);
    doc.moveDown(0.5);

    doc.fontSize(11).text(`Tipo: ${tipo}`);
    doc.text(`Nome: ${nome}`);
    doc.text(`ID: ${idJogo}`);
    doc.text(`Descrição inicial: ${descricao}`);
    doc.text(`Motivo do fechamento: ${limparTexto(motivo) || "Não informado"}`);
    doc.moveDown();

    if (mensagens.length === 0) {
      doc.fontSize(10).text("Nenhuma mensagem encontrada.");
    } else {
      for (const msg of mensagens) {
        const data = new Date(msg.createdTimestamp).toLocaleString("pt-BR");
        const autor = msg.author ? msg.author.tag : "Desconhecido";
        const texto = limparTexto(msg.content || "[sem texto]");
        const anexos =
          msg.attachments.size > 0
            ? ` | anexos: ${[...msg.attachments.values()].map((a) => a.url).join(", ")}`
            : "";

        doc.fontSize(9).text(`[${data}] ${autor}: ${texto}${anexos}`, {
          width: 520,
          align: "left",
        });
        doc.moveDown(0.25);
      }
    }

    doc.end();
  });
}

async function fecharTicketComTranscriptComMotivo(channel, user, motivo) {
  const ticketUserId = extrairCampo(channel.topic, "ticketUser");

  const pdf = await gerarPDF(channel, user, motivo);
  const arquivo = new AttachmentBuilder(pdf, {
    name: `transcript-${channel.name}.pdf`,
  });

  const tipo = extrairCampo(channel.topic, "tipo") || "não informado";
  const nome = decodeURIComponent(extrairCampo(channel.topic, "nome") || "não informado");
  const idJogo = decodeURIComponent(extrairCampo(channel.topic, "idjogo") || "não informado");

  const embed = new EmbedBuilder()
    .setTitle("📄 Ticket Finalizado")
    .setDescription(
      [
        `Canal: **#${channel.name}**`,
        `Fechado por: ${user}`,
        "",
        `**Tipo:** ${tipo}`,
        `**Nome:** ${nome}`,
        `**ID:** ${idJogo}`,
        "",
        `**Motivo do fechamento:**`,
        motivo,
      ].join("\n")
    )
    .setColor(0xff2b2b)
    .setTimestamp();

  if (CANAL_TRANSCRIPT_ID) {
    const canalTranscript = await channel.guild.channels.fetch(CANAL_TRANSCRIPT_ID).catch(() => null);
    if (canalTranscript && canalTranscript.isTextBased()) {
      const payload = {
        embeds: [embed],
        files: [arquivo],
      };

      if (ticketUserId) payload.components = [criarBotaoReabrir(ticketUserId)];

      await canalTranscript.send(payload).catch(console.error);
    }
  }

  await channel.send(`🔒 Ticket fechado por ${user}\n📌 Motivo: ${motivo}`);

  setTimeout(() => {
    channel.delete().catch(() => null);
  }, 3000);
}

client.once("ready", async () => {
  console.log(`✅ Bot online como ${client.user.tag}`);

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
        const nomeCanal = interaction.channel?.name || "";
        if (!nomeCanal.includes("-")) {
          return interaction.reply({
            content: "❌ Esse comando só pode ser usado em ticket.",
            ephemeral: true,
          });
        }

        await interaction.showModal(criarModalFechamento());
        return;
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === "iniciar_ticket") {
        return interaction.reply({
          content: "Selecione abaixo o tipo do atendimento.",
          components: [criarMenuTipo()],
          ephemeral: true,
        });
      }

      if (interaction.customId === "assumir_ticket") {
        await assumirTicket(interaction);
        return;
      }

      if (interaction.customId === "fechar_ticket_modal") {
        const nomeCanal = interaction.channel?.name || "";
        if (!nomeCanal.includes("-")) {
          return interaction.reply({
            content: "❌ Esse botão só funciona em ticket.",
            ephemeral: true,
          });
        }

        await interaction.showModal(criarModalFechamento());
        return;
      }

      if (interaction.customId.startsWith("reabrir_ticket:")) {
        if (!staffTemPermissao(interaction.member)) {
          return interaction.reply({
            content: "❌ Você não tem permissão para reabrir tickets.",
            ephemeral: true,
          });
        }

        const [, ticketUserId] = interaction.customId.split(":");
        const ticketExistente = await procurarTicketAberto(interaction.guild, ticketUserId);

        if (ticketExistente) {
          return interaction.reply({
            content: `❌ Já existe um ticket aberto para esse usuário: ${ticketExistente}`,
            ephemeral: true,
          });
        }

        const dadosReabertura = {
          tipo: "reabertura",
          nome: "Reaberto pela equipe",
          idJogo: "N/A",
          descricao: "Ticket reaberto manualmente pela equipe.",
          extra: "",
        };

        await criarTicketComFormulario(interaction, dadosReabertura, ticketUserId);
        return;
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "selecionar_tipo_ticket") {
        const tipo = interaction.values[0];
        await interaction.showModal(criarModalAbertura(tipo));
        return;
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith("modal_abrir_ticket:")) {
        const [, tipo] = interaction.customId.split(":");

        const nome = interaction.fields.getTextInputValue("nome");
        const idJogo = interaction.fields.getTextInputValue("id_jogo");
        const descricao = interaction.fields.getTextInputValue("descricao");
        let extra = "";

        try {
          extra = interaction.fields.getTextInputValue("extra") || "";
        } catch {
          extra = "";
        }

        const dados = {
          tipo,
          nome,
          idJogo,
          descricao,
          extra,
        };

        await criarTicketComFormulario(interaction, dados);
        return;
      }

      if (interaction.customId === "modal_fechar_ticket") {
        const nomeCanal = interaction.channel?.name || "";
        if (!nomeCanal.includes("-")) {
          return interaction.reply({
            content: "❌ Isso só funciona em ticket.",
            ephemeral: true,
          });
        }

        const motivo = interaction.fields.getTextInputValue("motivo");

        await interaction.reply({
          content: "📄 Gerando transcript e fechando ticket...",
          ephemeral: true,
        });

        await fecharTicketComTranscriptComMotivo(interaction.channel, interaction.user, motivo);
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

// Web server para Render/UptimeRobot
const app = express();
app.get("/", (_req, res) => {
  res.status(200).send("CBM BOT ONLINE 🔥");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Servidor web ativo na porta ${PORT}`);
});

// Anti crash básico
process.on("unhandledRejection", (err) => {
  console.error("❌ Unhandled Rejection:", err);
});

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
});
