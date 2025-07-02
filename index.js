import { Telegraf } from "telegraf";
import dotenv from "dotenv";
import frasi from "./frasi.json" assert { type: "json" };
import libri from "./libri.json" assert { type: "json" };
import fs from "fs";
import cron from "node-cron";
import fetch from "node-fetch";

dotenv.config();
const bot = new Telegraf(process.env.BOT_TOKEN);

// --- Utility Functions ---
const escapeMarkdownV2 = (text) => text.replace(/([_\*\[\]()~`>#+=|{}.!\\-])/g, "\\$1");

const readJSON = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file));
  } catch {
    return [];
  }
};

const writeJSON = (file, data) => {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
};

const getUtenti = () => readJSON("./utenti.json");
const salvaUtente = (id) => {
  const utenti = getUtenti();
  if (!utenti.includes(id)) {
    utenti.push(id);
    writeJSON("./utenti.json", utenti);
    console.log(`👤 Nuovo utente loggato: ${id}`);
  }
};

const getAlertList = () => readJSON("./alert.json");
const saveAlerts = (alerts) => writeJSON("./alert.json", alerts);

const fetchPrice = async (asset) => {
  const simbolo = asset.toUpperCase();
  const coingeckoIds = { BTC: "bitcoin", ETH: "ethereum", DOT: "polkadot" };

  if (coingeckoIds[simbolo]) {
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoIds[simbolo]}&vs_currencies=eur`);
    const data = await res.json();
    return data[coingeckoIds[simbolo]]?.eur;
  }

  const finnhubKey = process.env.FINNHUB_KEY;
  const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${simbolo}&token=${finnhubKey}`);
  const data = await res.json();
  return data.c || null;
};

// --- Bot Commands ---
bot.start((ctx) => {
  salvaUtente(ctx.chat.id);
  const msg = `👋 *Benvenuto su FinanzaBot!*\n\nUsa i seguenti comandi:\n/giorno – frase ispirazionale + link\n/libri – consiglio di lettura\n/ai – consiglio finanziario casuale\n/donami – supporta il bot`;
  ctx.reply(escapeMarkdownV2(msg), { parse_mode: "MarkdownV2" });
});

bot.command("giorno", (ctx) => {
  const { testo, link } = frasi[Math.floor(Math.random() * frasi.length)];
  const msg = `💡 *Frase del giorno:*\n\"${escapeMarkdownV2(testo)}\"\n\n🔗 ${escapeMarkdownV2(link)}`;
  ctx.reply(msg, { parse_mode: "MarkdownV2" });
});

bot.command("libri", (ctx) => {
  const libro = escapeMarkdownV2(libri[Math.floor(Math.random() * libri.length)]);
  ctx.reply(`📘 *Consiglio di lettura:*\n${libro}`, { parse_mode: "MarkdownV2" });
});

bot.command("ai", (ctx) => {
  const messaggi = [
    "Investi prima su te stesso, poi su ciò che capisci.",
    "Evita le mode: segui la strategia, non l’isteria.",
    "Costruisci prima un fondo di emergenza.",
    "Diversifica sempre. Anche quando pensi di non doverlo fare.",
    "L'interesse composto è l'ottava meraviglia del mondo \\(A\\.Einstein\\)"
  ];
  const msg = escapeMarkdownV2(messaggi[Math.floor(Math.random() * messaggi.length)]);
  ctx.reply(`🤖 *Consiglio AI:*\n${msg}`, { parse_mode: "MarkdownV2" });
});

bot.command("donami", (ctx) => {
  const msg = `💸 *Supporta il progetto*\n\n☕  [PayPal](https://paypal.me/zagariafabio)\n\nOgni aiuto è apprezzato 🙏`;
  ctx.reply(msg, { parse_mode: "MarkdownV2" });
});

bot.command("notizie", async (ctx) => {
  const apiKey = process.env.NEWSDATA_KEY;
  const url = `https://newsdata.io/api/1/news?apikey=${apiKey}&category=business&language=it`;

  try {
    const res = await fetch(url);
    const { results } = await res.json();
    results.slice(0, 3).forEach(({ title, link }) => {
      ctx.reply(`🗞️ *${escapeMarkdownV2(title)}*\n🔗 ${escapeMarkdownV2(link)}`, {
        parse_mode: "MarkdownV2"
      });
    });
  } catch {
    ctx.reply("❌ Errore durante il recupero delle notizie.");
  }
});

bot.command("prezzo", async (ctx) => {
  const asset = ctx.message.text.split(" ")[1]?.toUpperCase();
  if (!asset) return ctx.reply("📈 Usa: `/prezzo BTC`", { parse_mode: "MarkdownV2" });
  const prezzo = await fetchPrice(asset);
  prezzo
    ? ctx.reply(`💹 Prezzo attuale di *${asset}*: *€${prezzo}*`, { parse_mode: "MarkdownV2" })
    : ctx.reply("❌ Asset non trovato o errore nella richiesta.");
});

bot.command("alert", (ctx) => {
  const [asset, value] = ctx.message.text.split(" ").slice(1);
  if (!asset || !value || isNaN(value))
    return ctx.reply("❗ Usa: `/alert BTC 65000`", { parse_mode: "MarkdownV2" });

  const alerts = getAlertList();
  alerts.push({ userId: ctx.chat.id, asset: asset.toUpperCase(), target: parseFloat(value) });
  saveAlerts(alerts);
  ctx.reply(`✅ Alert salvato: *${asset.toUpperCase()} ≥ €${value}*`, { parse_mode: "MarkdownV2" });
});

bot.command("myalerts", (ctx) => {
  const userId = ctx.chat.id;
  const alerts = getAlertList().filter(alert => alert.userId === userId);

  if (alerts.length === 0) {
    return ctx.reply("📭 Non hai alert attivi.", { parse_mode: "MarkdownV2" });
  }

  const msg = alerts.map(a => `• *${a.asset}* ≥ €${a.target}`).join("\n");
  ctx.reply(`📌 *I tuoi alert attivi:*\n${msg}`, { parse_mode: "MarkdownV2" });
});

bot.command("removealert", (ctx) => {
  const asset = ctx.message.text.split(" ")[1]?.toUpperCase();
  if (!asset) return ctx.reply("❗ Usa: `/removealert BTC`", { parse_mode: "MarkdownV2" });

  const userId = ctx.chat.id;
  let alerts = getAlertList();
  const initialLength = alerts.length;
  alerts = alerts.filter(a => !(a.userId === userId && a.asset === asset));

  if (alerts.length === initialLength) {
    return ctx.reply("❌ Nessun alert trovato per questo asset.", { parse_mode: "MarkdownV2" });
  }

  saveAlerts(alerts);
  ctx.reply(`🗑️ Alert per *${asset}* rimosso.`, { parse_mode: "MarkdownV2" });
});

// --- Schedulers ---
cron.schedule("0 7 * * *", () => {
  const frase = frasi[Math.floor(Math.random() * frasi.length)];
  const msg = `💡 *Frase del giorno:*\n\"${escapeMarkdownV2(frase.testo)}\"\n\n🔗 ${escapeMarkdownV2(frase.link)}`;
  getUtenti().forEach((id) => {
    bot.telegram.sendMessage(id, msg, { parse_mode: "MarkdownV2" }).catch((e) => console.error(e));
  });
});

cron.schedule("*/5 * * * *", async () => {
  const alerts = getAlertList();
  const prices = {};

  for (let { userId, asset, target } of alerts) {
    if (!prices[asset]) prices[asset] = await fetchPrice(asset);
    if (prices[asset] >= target) {
      bot.telegram.sendMessage(userId, `🔔 *ALERT: ${asset} ha raggiunto €${prices[asset]}*`, {
        parse_mode: "MarkdownV2"
      }).catch((err) => console.error(err.message));
    }
  }
});

bot.launch();
console.log("🤖 Bot avviato con successo e schedulazioni attive!");
