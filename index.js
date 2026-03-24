const admin = require("firebase-admin");
const fetch = require("node-fetch");

const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const WEBHOOK = process.env.DISCORD_WEBHOOK;

async function enviarLogs() {
  const snapshot = await db.collection("logs")
    .orderBy("data", "desc")
    .limit(5)
    .get();

  for (const doc of snapshot.docs) {
    const log = doc.data();

    await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: "🚨 Nova Log",
          color: 15158332,
          fields: [
            { name: "Usuário", value: log.usuario || "N/A", inline: true },
            { name: "Ação", value: log.acao || "N/A", inline: true },
            { name: "Módulo", value: log.modulo || "N/A", inline: true },
            { name: "Data", value: log.data || "N/A" }
          ]
        }]
      })
    });
  }
}

enviarLogs();
