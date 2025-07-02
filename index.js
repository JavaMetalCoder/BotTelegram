import { Telegraf } from "telegraf";
import dotenv from "dotenv";
import frasi from "./frasi.json" assert { type: "json" };
import libri from "./libri.json" assert { type: "json" };
import fs from "fs";
import cron from "node-cron"; // MANCAVA!

dotenv.config();
const bot = new Telegraf(process.env.BOT_TOKEN);

// Markdown Escape
function escapeMarkdownV2(text) {
  return text.replace(/([_*\[\]()~`>#+=|{}.!\\-])/g, "\\$1");
}

// Carica utenti dal file
function getUtenti() {
  try {
    const data = fs.readFileSync("./utenti.json");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

// Salva nuovo utente
function salvaUtente(id) {
  const utenti = getUtenti();
  if (!utenti.includes(id)) {
    utenti.push(id);
    fs.writeFileSync("./utenti.json", JSON.stringify(utenti, null, 2));
    console.log(`👤 Nuovo utente loggato: ${id}`);
  }
}

// /start
bot.start((ctx) => {
  salvaUtente(ctx.chat.id); // CORRETTO QUI

  const msg = `👋 *Benvenuto su FinanzaBot!*\n\nUsa i seguenti comandi:\n/giorno – frase ispirazionale + link\n/libri – consiglio di lettura\n/ai – consiglio finanziario casuale\n/donami – supporta il bot`;
  ctx.reply(escapeMarkdownV2(msg), { parse_mode: "MarkdownV2" });
});

// /giorno
bot.command("giorno", (ctx) => {
  const random = frasi[Math.floor(Math.random() * frasi.length)];
  const frase = escapeMarkdownV2(random.testo);
  const link = escapeMarkdownV2(random.link);
  const msg = `💡 *Frase del giorno:*\n"${frase}"\n\n🔗 ${link}`;
  ctx.reply(msg, { parse_mode: "MarkdownV2" });
});

// /libri
bot.command("libri", (ctx) => {
  const libro = escapeMarkdownV2(libri[Math.floor(Math.random() * libri.length)]);
  const msg = `📘 *Consiglio di lettura:*\n${libro}`;
  ctx.reply(msg, { parse_mode: "MarkdownV2" });
});

// /ai
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

// /donami
bot.command("donami", (ctx) => {
  const msg = `💸 *Supporta il progetto*\n\n☕ [Ko\\-fi](https://ko-fi.com/tuonome)\n💰 [PayPal](https://paypal.me/tuonome)\n\nOgni aiuto è apprezzato 🙏`;
  ctx.reply(msg, { parse_mode: "MarkdownV2" });
});

// CRON: invio automatico ogni giorno ore 7:00
cron.schedule("0 7 * * *", async () => {
  const frase = frasi[Math.floor(Math.random() * frasi.length)];
  const msg = `💡 *Frase del giorno:*\n"${escapeMarkdownV2(frase.testo)}"\n\n🔗 ${escapeMarkdownV2(frase.link)}`;

  const utenti = getUtenti();
  for (const id of utenti) {
    try {
      await bot.telegram.sendMessage(id, msg, { parse_mode: "MarkdownV2" });
    } catch (err) {
      console.error(`Errore invio a ${id}:`, err.description);
    }
  }
});

bot.launch();
console.log("🤖 Bot avviato con MarkdownV2, logging utenti e cron giornaliero!");
