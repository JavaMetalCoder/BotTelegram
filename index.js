// ================================
//   FinanzaZen - index.js
//   Assistente finanziario Telegram
//   Powered by MetalCoderDev
//   Ottimizzato con cluster per prestazioni
// ================================

import cluster from 'cluster';
import os from 'os';
import { Telegraf, Markup, Scenes, session } from 'telegraf';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs/promises';
import cron from 'node-cron';
import fetch from 'node-fetch';

import frasi from './frasi.json' assert { type: 'json' };
import libri from './libri.json' assert { type: 'json' };
dotenv.config();

const PORT = process.env.PORT || 3000;

if (cluster.isPrimary) {
  const cpuCount = os.cpus().length;
  console.log(`🔧 Master process - fork ${cpuCount} workers`);
  for (let i = 0; i < cpuCount; i++) {
    cluster.fork();
  }
  cluster.on('exit', (worker) => {
    console.warn(`⚠️ Worker ${worker.process.pid} morto, avvio nuovo`);
    cluster.fork();
  });
} else {
  // ================================
  //   Memoria in-app
  // ================================
  let utenti = [];
  let alerts = [];

  async function loadStores() {
    try { utenti = JSON.parse(await fs.readFile('./utenti.json', 'utf-8')); } catch { utenti = []; }
    try { alerts = JSON.parse(await fs.readFile('./alert.json', 'utf-8')); } catch { alerts = []; }
  }
  async function saveUsers() { await fs.writeFile('./utenti.json', JSON.stringify(utenti, null, 2)); }
  async function saveAlerts() { await fs.writeFile('./alert.json', JSON.stringify(alerts, null, 2)); }
  async function addUser(id) {
    if (!utenti.includes(id)) { utenti.push(id); await saveUsers(); }
  }

  // ================================
  //   Utility
  // ================================
  function escapeMarkdownV2(text) {
    return text.replace(/([_*[\]()~`>#+=|{}.!\\-])/g, '\\$1');
  }

  const priceCache = new Map();
  const TTL = 60_000;
  async function fetchPrice(symbol) {
    const asset = symbol.toUpperCase();
    const now = Date.now();
    if (priceCache.has(asset) && now - priceCache.get(asset).ts < TTL) {
      return priceCache.get(asset).value;
    }
    let value = null;
    const cg = { BTC: 'bitcoin', ETH: 'ethereum', DOT: 'polkadot' };

    if (cg[asset]) {
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${cg[asset]}&vs_currencies=eur`
      );
      value = (await res.json())[cg[asset]].eur;
    } else if (asset === 'USD' || asset === 'EUR') {
      const fx = await (await fetch('https://api.exchangerate.host/latest?base=EUR')).json();
      value = asset === 'USD' ? fx.rates.USD : 1;
    } else {
      const data = await (await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${asset}&token=${process.env.FINNHUB_API_KEY}`
      )).json();
      value = data.c;
    }

    priceCache.set(asset, { value, ts: now });
    return value;
  }

  // Carica store
  await loadStores();

  // ================================
  //   Express + Telegraf
  // ================================
  const app = express();
  app.use(express.json());

  const bot = new Telegraf(process.env.BOT_TOKEN);
  bot.use(session());
  app.use(`/${process.env.BOT_TOKEN}`, (req, res) => bot.handleUpdate(req.body, res));

  // ================================
  //   Wizard alert
  // ================================
  const { WizardScene, Stage } = Scenes;
  const alertWizard = new WizardScene(
    'alert-wizard',
    (ctx) => { ctx.reply('📋 Quale asset monitorare? (es: BTC)'); return ctx.wizard.next(); },
    (ctx) => { ctx.session.asset = ctx.message.text.trim().toUpperCase(); ctx.reply(`💬 Livello target per ${ctx.session.asset}?`); return ctx.wizard.next(); },
    async (ctx) => {
      const t = parseFloat(ctx.message.text.trim());
      if (isNaN(t)) return ctx.reply('❗ Inserisci un numero valido.');
      alerts.push({ userId: ctx.chat.id, asset: ctx.session.asset, target: t });
      await saveAlerts();
      ctx.reply(`✅ Alert creato: ${ctx.session.asset} ≥ ${t}`);
      return ctx.scene.leave();
    }
  );
  const stage = new Stage([alertWizard]);
  bot.use(stage.middleware());

  // ================================
  //   Helpers
  // ================================
  function sendInfo(ctx) {
    const info =
      '📊 *FinanzaZen* – Assistente finanziario\n' +
      '• /giorno – Frase motivazionale\n' +
      '• /libri – Consiglio di lettura\n' +
      '• /notizie [q] – News IT/EN\n' +
      '• /pinotizie – News su Pi Network\n' +
      '• /prezzo [asset] – Prezzo asset\n' +
      '• /cambio USD – EUR→USD\n' +
      '• /alert – Crea alert\n' +
      '• /myalerts – I tuoi alert\n' +
      '• /removealert – Rimuovi alert\n' +
      '• /donami – Supporto progetto\n' +
      'Powered by MetalCoderDev\n' +
      't.me/MetalCoderDev';
    return ctx.reply(escapeMarkdownV2(info), { parse_mode: 'MarkdownV2' });
  }

  async function sendPinews(ctx) {
    // Notizie Pi Network filtrate da NewsData.io
    const url = `https://newsdata.io/api/1/news?apikey=${process.env.NEWSDATA_API_KEY}`
              + `&q=pi network&category=crypto&language=it,en`;
    try {
      const res = await fetch(url);
      const json = await res.json();
      const items = (json.results || [])
        .filter(a => a.link.includes('medium.com/pi-network'))
        .slice(0, 3);
      if (!items.length) {
        return ctx.reply('❌ Nessuna notizia Pi Network trovata.');
      }
      for (const art of items) {
        await ctx.reply(
          `🪙 *${escapeMarkdownV2(art.title)}*\n🔗 ${escapeMarkdownV2(art.link)}`,
          { parse_mode: 'MarkdownV2' }
        );
      }
    } catch (err) {
      console.error('Errore recupero Pi news:', err);
      ctx.reply('❌ Errore nel recupero delle notizie Pi Network.');
    }
  }

  // ================================
  //   Comandi & Menu
  // ================================
  bot.start(async (ctx) => {
    await addUser(ctx.chat.id);
    const user = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    return ctx.reply(
      escapeMarkdownV2(`👋 Ciao ${user}, benvenuto in *FinanzaZen*! Usa /menu`),
      { parse_mode: 'MarkdownV2' }
    );
  });

  bot.command('menu', (ctx) => {
    ctx.reply('📋 *Menu Principale*', {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('💡 Giorno', 'giorno')],
        [Markup.button.callback('📚 Libri', 'libri')],
        [Markup.button.callback('🗞️ Notizie', 'news_menu')],
        [Markup.button.callback('🪙 Pi News', 'pinotizie')],
        [Markup.button.callback('💰 Prezzo Asset', 'prezzo_menu')],
        [Markup.button.callback('💱 Cambio EUR→USD', 'cambio_usd')],
        [Markup.button.callback('🔔 Crea Alert', 'alert_menu')],
        [Markup.button.callback('📊 I miei Alert', 'myalerts')],
        [Markup.button.callback('🗑️ Rimuovi Alert', 'removealert_menu')],
        [Markup.button.callback('ℹ️ Info', 'info')],
        [Markup.button.callback('🙏 Supporto', 'support')],
      ])
    });
  });

  bot.on('callback_query', async (ctx) => {
    const c = ctx.callbackQuery.data;
    await ctx.answerCbQuery();

    switch (c) {
      case 'giorno': {
        const { testo, link } = frasi[Math.floor(Math.random() * frasi.length)];
        return ctx.editMessageText(
          `💡 *Frase del giorno:*\n${escapeMarkdownV2(testo)}\n🔗 ${escapeMarkdownV2(link)}`,
          { parse_mode: 'MarkdownV2' }
        );
      }
      case 'libri': {
        const l = libri[Math.floor(Math.random() * libri.length)];
        return ctx.editMessageText(
          `📚 *Consiglio di lettura:*\n${escapeMarkdownV2(l)}`,
          { parse_mode: 'MarkdownV2' }
        );
      }
      case 'news_menu':
        return ctx.editMessageText(
          '➡️ Scegli argomento:',
          Markup.inlineKeyboard([
            [Markup.button.callback('Crypto', 'news_crypto'), Markup.button.callback('Geopolitica', 'news_geopolitica')],
            [Markup.button.callback('Finanza', 'news_finanza'), Markup.button.callback('BTC', 'news_btc')],
          ])
        );
      case 'news_crypto':
        ctx.deleteMessage();
        return ctx.telegram.sendMessage(ctx.chat.id, '/notizie crypto');
      case 'news_geopolitica':
        ctx.deleteMessage();
        return ctx.telegram.sendMessage(ctx.chat.id, '/notizie geopolitica');
      case 'news_finanza':
        ctx.deleteMessage();
        return ctx.telegram.sendMessage(ctx.chat.id, '/notizie finanza');
      case 'news_btc':
        ctx.deleteMessage();
        return ctx.telegram.sendMessage(ctx.chat.id, '/notizie btc');
      case 'pinotizie':
        return sendPinews(ctx);
      case 'prezzo_menu':
        return ctx.editMessageText(
          '➡️ Scegli asset:',
          Markup.inlineKeyboard([
            [Markup.button.callback('BTC', 'price_BTC'), Markup.button.callback('ETH', 'price_ETH')],
            [Markup.button.callback('EUR', 'price_EUR'), Markup.button.callback('USD', 'price_USD')],
            [Markup.button.callback('PI', 'price_PI')],
          ])
        );
      case 'price_BTC': case 'price_ETH': case 'price_EUR': case 'price_USD': case 'price_PI': {
        const sym = c.split('_')[1];
        const p = await fetchPrice(sym);
        const unit = sym === 'USD' ? 'USD' : '€';
        return ctx.editMessageText(`💰 *${sym}*: *${unit}${p}*`, { parse_mode: 'MarkdownV2' });
      }
      case 'cambio_usd': {
        const r = await fetchPrice('USD');
        return ctx.editMessageText(`💱 1 EUR = ${r} USD`);
      }
      case 'alert_menu':
        return ctx.scene.enter('alert-wizard');
      case 'myalerts': {
        const mine = alerts.filter(a => a.userId === ctx.chat.id);
        if (!mine.length) return ctx.editMessageText('🔕 Nessun alert.');
        const txt = mine.map(a => `- ${a.asset} ≥ €${a.target}`).join('\n');
        return ctx.editMessageText(`🔔 I tuoi alert:\n${txt}`, { parse_mode: 'MarkdownV2' });
      }
      case 'removealert_menu':
        return ctx.editMessageText('➡️ Digita /removealert [asset]');
      case 'info':
        return sendInfo(ctx);
      case 'support':
        return ctx.reply(
          '🙏 Supporta il progetto MetalCoderDev: [PayPal](https://paypal.me/MetalCoderDev)',
          { parse_mode: 'MarkdownV2' }
        );
      default:
        return;
    }
  });

  // ================================
  //   Cron paralleli
  // ================================
  cron.schedule('0 7 * * *', async () => {
    const { testo, link } = frasi[Math.floor(Math.random() * frasi.length)];
    await Promise.all(
      utenti.map(id =>
        bot.telegram.sendMessage(
          id,
          `💡 ${escapeMarkdownV2(testo)}\n🔗 ${escapeMarkdownV2(link)}`,
          { parse_mode: 'MarkdownV2' }
        )
      )
    );
  });

  cron.schedule('*/5 * * * *', async () => {
    await Promise.all(
      alerts.map(async (a) => {
        const v = await fetchPrice(a.asset);
        if (v >= a.target) {
          await bot.telegram.sendMessage(a.userId, `🔔 ALERT: ${a.asset} ≥ €${v}`);
        }
      })
    );
  });

  // ================================
  //   Avvio
  // ================================
  bot.launch();
  app.listen(PORT, () => console.log(`✅ Worker ${process.pid} attivo su porta ${PORT}`));
}
