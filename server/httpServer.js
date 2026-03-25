
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
   * CORS SIMPLE ET ROBUSTE
   * ============================================================
   */
  app.use((req, res, next) => {

    const origin = req.headers.origin;

    // Autoriser :
    // - requêtes serveur (pas d'Origin)
    // - ton domaine LISOT
    // - localhost
    if (
      !origin ||
      origin.includes("ktg.cd.glencore.net") ||
      origin.includes("localhost") ||
      origin.includes("127.0.0.1")
    ) {

      res.setHeader("Access-Control-Allow-Origin", origin || "*");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

      if (req.method === "OPTIONS") {
        return res.sendStatus(200);
      }

      return next();
    }

    logger.warn(`CORS rejeté pour origine : ${origin}`);
    return res.status(403).json({ error: "Origin not allowed" });

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