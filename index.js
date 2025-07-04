
// ================================
//   FinanzaZen - index.js
//   Assistente finanziario Telegram
//   Powered by MetalCoderDev
//   Versione production-ready
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

const REQUIRED_ENV = ['BOT_TOKEN', 'FINNHUB_API_KEY', 'NEWSDATA_API_KEY'];
REQUIRED_ENV.forEach((key) => {
  if (!process.env[key]) {
    console.error(`❌ Variabile ambiente mancante: ${key}`);
    process.exit(1);
  }
});

process.on('unhandledRejection', err => {
  console.error('❌ Unhandled Rejection:', err);
});
process.on('uncaughtException', err => {
  console.error('❌ Uncaught Exception:', err);
});

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
  let utenti = [];
  let alerts = [];

  async function loadJSON(file) {
    try {
      return JSON.parse(await fs.readFile(file, 'utf-8'));
    } catch {
      return [];
    }
  }
  async function saveJSON(file, data) {
    try {
      await fs.writeFile(file, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error(`Errore salvataggio ${file}:`, err.message);
    }
  }

  async function loadStores() {
    utenti = await loadJSON('./utenti.json');
    alerts = await loadJSON('./alert.json');
  }
  async function saveUsers() {
    await saveJSON('./utenti.json', utenti);
  }
  async function saveAlerts() {
    await saveJSON('./alert.json', alerts);
  }
  async function addUser(id) {
    if (!utenti.includes(id)) {
      utenti.push(id);
      await saveUsers();
    }
  }

  function escapeMarkdownV2(text) {
    return text.replace(/([_*[\]()~`>#+=|{}.!-])/g, '\$1');
  }

  const priceCache = new Map();
  const TTL = 60_000;
  async function fetchPrice(symbol) {
    const asset = symbol.toUpperCase();
    const now = Date.now();
    if (priceCache.has(asset) && now - priceCache.get(asset).ts < TTL) {
      return priceCache.get(asset).value;
    }

    try {
      let value = null;
      const cg = { BTC: 'bitcoin', ETH: 'ethereum', DOT: 'polkadot' };
      if (cg[asset]) {
        const res = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${cg[asset]}&vs_currencies=eur`
        );
        const data = await res.json();
        value = data[cg[asset]]?.eur;
      } else if (asset === 'USD' || asset === 'EUR') {
        const fx = await (await fetch('https://api.exchangerate.host/latest?base=EUR')).json();
        value = asset === 'USD' ? fx.rates.USD : 1;
      } else {
        const data = await (await fetch(
          `https://finnhub.io/api/v1/quote?symbol=${asset}&token=${process.env.FINNHUB_API_KEY}`
        )).json();
        value = data.c;
      }

      if (!value) throw new Error("Valore non disponibile");
      priceCache.set(asset, { value, ts: now });
      return value;
    } catch (err) {
      console.error(`Errore fetch prezzo per ${symbol}:`, err.message);
      return null;
    }
  }

  await loadStores();

  const app = express();
  app.use(express.json());

  const bot = new Telegraf(process.env.BOT_TOKEN);
  bot.use(session());
  app.post(`/${process.env.BOT_TOKEN}`, (req, res) => {
    bot.handleUpdate(req.body, res);
  });

  bot.launch().then(() => {
    console.log(`🤖 Bot FinanzaZen avviato in Worker ${process.pid}`);
  });

  app.listen(PORT, () => {
    console.log(`🌐 Express attivo su porta ${PORT} in Worker ${process.pid}`);
  });
}
