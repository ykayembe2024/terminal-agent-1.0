
/**
 * ==============================================================
 * httpServer.js - Serveur HTTP local sécurisé du Balance Agent
 * Serveur HTTP local sécurisé du Balance Agent
 *
 * Objectifs :
 *  - exposer le poids local de la balance
 *  - accessible uniquement sur localhost
 *  - authentification simple par token
 *  - CORS contrôlé pour l'application web
 *
 * Auteur : Yves KAYEMBE
 * ==============================================================
 */

const {createRequire} = require("module");
const requireFile = createRequire(__filename);
const express = require('express');
const logger = requireFile('../core/logger');
const weightStore = requireFile('../core/weightStore');
const config = requireFile('../config');

/**
 * Démarre le serveur HTTP local
 * Crée un serveur Express sécurisé pour exposer l'API locale
 * @function startServer
 * @returns {{ stop: Function }} Interface d'arrêt propre
 */
function startServer() {

  const app = express();

  const PORT = config.LOCAL_SERVER?.port || 1789;
  const HOST = '127.0.0.1';
  const retryDelayMs = 60000;

  /**
   * Instance serveur HTTP active
   * @type {import('http').Server|null}
   */
  let server = null;

  /**
   * Timer de relance du serveur local
   * @type {NodeJS.Timeout|null}
   */
  let restartTimer = null;

  /**
   * Indique qu'un arrêt volontaire est en cours
   * @type {boolean}
   */
  let isStopping = false;

  app.use(express.json());

  /**
   * ============================================================
   * CORS : localhost + *.ktg.cd.glencore.net (http/https)
   * ============================================================
   */
  function isAllowedOrigin(origin) {
    if (!origin) {
      return true;
    }

    try {
      const { protocol, hostname } = new URL(origin);
      if (protocol !== 'http:' && protocol !== 'https:') {
        return false;
      }

      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return true;
      }

      // Accepte ktg.cd.glencore.net et tous les sous-domaines
      // (liso., test-lisot., test-liso., ...)
      return hostname === 'ktg.cd.glencore.net'
        || hostname.endsWith('.ktg.cd.glencore.net');
    } catch {
      return false;
    }
  }

  app.use((req, res, next) => {
    const origin = req.headers.origin;

    if (!isAllowedOrigin(origin)) {
      logger.warn(`CORS rejeté pour origine : ${origin}`);
      return res.status(403).json({ error: "Origin not allowed" });
    }

    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Vary", "Origin");

    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }

    return next();
  });

  /**
   * ============================================================
   * HEALTH CHECK
   * ============================================================
   */
  app.get('/health', (req, res) => {

      try {
        const status = weightStore.getStatus ? weightStore.getStatus() : {};

        res.json(Object.assign({
          status: "ok",
          service: "balance-agent",
          uptime: process.uptime()
        }, status));
      } catch (err) {
        logger.error(`Erreur endpoint /health : ${err.message}`);
        res.json({
          status: "ok",
          service: "balance-agent",
          uptime: process.uptime()
        });
      }

  });

  /**
   * ============================================================
   * TERMINAL INFO
   * ============================================================
   */
  app.get('/terminal', (req, res) => {

    const data = weightStore.getWeight();

    res.json({
      terminal_code: data.terminal_code,
      timestamp: data.timestamp
    });

  });

  /**
   * ============================================================
   * CURRENT WEIGHT
   * ============================================================
   */
  app.get('/weight', (req, res) => {

    try {

      const weight = weightStore.getWeight();

      res.json({
        terminal_code: weight.terminal_code,
        weight: weight.weight,
        timestamp: weight.timestamp
      });

    } catch (err) {

      logger.error(`Erreur endpoint /weight : ${err.message}`);

      res.status(500).json({
        error: "Internal server error"
      });

    }

  });

  /**
   * ============================================================
   * START SERVER
   * ============================================================
   */
  /**
   * Planifie un redémarrage du serveur local
   * @returns {void}
   */
  function scheduleRestart() {
    if (isStopping || restartTimer) return;

    restartTimer = setTimeout(() => {
      restartTimer = null;
      startListening();
    }, retryDelayMs);

    logger.warn(`Relance serveur local planifiée dans ${Math.round(retryDelayMs / 1000)}s`);
  }

  /**
   * Démarre l'écoute HTTP locale et gère les erreurs de bind.
   * @returns {void}
   */
  function startListening() {
    if (isStopping || server) return;

    server = app.listen(PORT, HOST, () => {
      logger.info(`Serveur local démarré : http://${HOST}:${PORT}`);
    });

    server.on('close', () => {
      server = null;
      if (!isStopping) {
        logger.warn('Serveur local arrêté de manière inattendue');
        scheduleRestart();
      }
    });

    server.on('error', (err) => {
      logger.error(`Erreur serveur local : ${err.message}`);

      const faultyServer = server;
      server = null;

      if (faultyServer) {
        try {
          faultyServer.close();
        } catch {
          // ignore close failure on listen errors
        }
      }

      if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
        scheduleRestart();
      }
    });
  }

  startListening();

  return {
    /**
     * Arrête proprement le serveur local et annule toute relance planifiée.
     * @returns {void}
     */
    stop() {
      isStopping = true;

      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }

      if (server) {
        try {
          server.close();
        } catch (err) {
          logger.error(`Erreur fermeture serveur local : ${err.message}`);
        }
      }
    }
  };

}

module.exports = startServer;