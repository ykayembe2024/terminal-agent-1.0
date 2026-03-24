/**
 * ==============================================================
 * syncService.js - Service de synchronisation avec le serveur central
 * app/core/syncService.js
 *
 * Gestion locale pour synchroniser les poids entre la queue et la base de donnée
 * ==============================================================
 */

const {createRequire} = require("module");
const requireFile = createRequire(__filename);
const axios = require('axios');
const https = require('https');
const os = require('os');
const config = requireFile('../config');
const logger = requireFile('./logger');
const QueueManager = requireFile('./queueManager');

/**
 * Service de synchronisation des poids avec le serveur central
 * Gère l'envoi des données, les heartbeats et la file d'attente
 * @class SyncService
 */
class SyncService {

  /**
   * Crée une instance du service de synchronisation
   * @constructor
   */
  constructor() {
    /**
     * Code du terminal identifié
     * @type {string|null}
     */
    this.terminalCode = null;

    /**
     * Nom d'hôte de la machine
     * @type {string}
     */
    this.hostname = os.hostname();

    /**
     * Gestionnaire de file d'attente pour les poids non envoyés
     * @type {QueueManager}
     */
    this.queue = new QueueManager();

    /**
     * Flag pour éviter les flush simultanés
     * @type {boolean}
     */
    this.isFlushing = false;

    /**
     * État de connexion du port série
     * @type {boolean}
     */
    this.serialConnected = false;

    /**
     * Dernier état série loggé pour éviter les logs dupliqués
     * @type {boolean|null}
     */
    this.lastLoggedSerialState = null;

    /**
     * Timer du heartbeat (null quand arrêté)
     * @type {NodeJS.Timeout|null}
     */
    this.heartbeatTimer = null;

    /**
     * Intervalle heartbeat en millisecondes
     * @type {number}
     */
    this.heartbeatIntervalMs = 5000;

    /**
     * Agent HTTPS pour ignorer la vérification SSL
     * @type {https.Agent}
     */
    this.httpsAgent = new https.Agent({
      rejectUnauthorized: false
    });
  }

  /**
   * Configure le code du terminal
   * @param {string} code - Code unique du terminal (ex: "C150168653")
   */
  setTerminal(code) {
    this.terminalCode = code;
    logger.info(`Terminal configuré : ${code}`);

    // Si la balance est déjà connectée, on peut activer immédiatement le heartbeat.
    if (this.serialConnected) {
      this.startHeartbeat();
    }
  }

  /**
   * Met à jour l'état de connexion du port série
   * @param {boolean} connected - true si connecté, false si déconnecté
   */
  setSerialConnectionStatus(connected) {
    const previous = this.serialConnected;
    this.serialConnected = connected;

    if (this.lastLoggedSerialState !== connected) {
      logger.info(`État connexion série : ${connected ? 'CONNECTÉ' : 'DÉCONNECTÉ'}`);
      this.lastLoggedSerialState = connected;
    }

    // Le heartbeat doit s'arrêter tant que la balance n'est pas atteinte.
    if (connected) {
      this.startHeartbeat();
    } else {
      this.stopHeartbeat();
    }

    if (previous !== connected && !connected) {
      logger.warn('Heartbeat suspendu : balance indisponible');
    }
  }

  /**
   * Démarre le heartbeat périodique si les prérequis sont réunis.
   * Conditions: terminal configuré + connexion série active.
   * @returns {void}
   */
  startHeartbeat() {
    if (this.heartbeatTimer) return;
    if (!this.serialConnected || !this.terminalCode) return;

    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.heartbeatIntervalMs);

    // Envoi immédiat pour signaler rapidement l'état "connecté".
    this.sendHeartbeat();
  }

  /**
   * Arrête le heartbeat périodique.
   * @returns {void}
   */
  stopHeartbeat() {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  /**
   * Envoie un poids au serveur central
   * En cas d'échec, stocke dans la file d'attente
   * @async
   * @param {number} weight - Poids en kg à envoyer
   * @returns {Promise<void>}
   */
  /**
   * Envoie un poids au serveur central
   * En cas d'échec, stocke dans la file d'attente
   * @async
   * @param {number} weight - Poids en kg à envoyer
   * @returns {Promise<void>}
   */
  async send(weight) {

    if (!this.terminalCode) return;

    const payload = {
      terminal_code: this.terminalCode,
      weight_kg: Math.round(weight),
      reading_datetime: new Date().toISOString(),
      source_device: this.hostname
    };

    try {

      await axios.post(config.API.url, payload, {
        headers: {
          Authorization: `Bearer ${config.API.token}`,
          'Content-Type': 'application/json'
        },
        httpsAgent: this.httpsAgent
      });

      this.flushQueue().catch((err) => {
        logger.error(`Erreur flush queue asynchrone : ${err.message}`);
      });

    } catch (err) {
      try {
        this.queue.push(payload);
        logger.warn(`Poids mis en queue (${this.queue.size()} éléments)`);
      } catch (queueErr) {
        logger.error(`Échec stockage queue : ${queueErr.message}`);
      }
    }
  }

  /**
   * Envoie un heartbeat au serveur central
   * Signale l'état de santé de l'agent et la connexion série
   * @async
   * @returns {Promise<void>}
   */
  async sendHeartbeat() {

    // Heartbeat désactivé si terminal non connu ou balance indisponible.
    if (!this.terminalCode || !this.serialConnected) {
      return;
    }

    const payload = {
      terminal_code: this.terminalCode,
      hostname: this.hostname,
      serial_connected: this.serialConnected
    };

    try {

      const response = await axios.post(config.API.heartbeatUrl, payload, {
        headers: {
          Authorization: `Bearer ${config.API.token}`,
          'Content-Type': 'application/json'
        },
        httpsAgent: this.httpsAgent,
        timeout: 5000
      });

      // Log discret uniquement si statut inattendu.
      if (response.status < 200 || response.status >= 300) {
        logger.warn(`Heartbeat statut inattendu (${response.status})`);
      }

    } catch (err) {

      if (err.response) {
        // Le serveur a répondu avec une erreur HTTP
        logger.error(`Heartbeat HTTP ${err.response.status}`);
        logger.error(`Réponse serveur: ${JSON.stringify(err.response.data)}`);
      }
      else if (err.request) {
        // La requête est partie mais aucune réponse
        logger.error("Heartbeat : aucune réponse du serveur");
      }
      else {
        // Erreur interne Axios
        logger.error(`Heartbeat erreur: ${err.message}`);
      }
    }
  }


  async flushQueue() {

    if (this.isFlushing) return;
    this.isFlushing = true;

    try {
      const items = this.queue.getAll();
      if (items.length === 0) {
        return;
      }

      const remaining = [];

      for (const payload of items) {
        try {
          await axios.post(config.API.url, payload, {
            headers: {
              Authorization: `Bearer ${config.API.token}`,
              'Content-Type': 'application/json'
            },
            httpsAgent: this.httpsAgent
          });
        } catch (err) {
          logger.warn(`Flush interrompu: échec envoi queue (${err.message})`);
          remaining.push(payload);
          break; // Arrêt au premier échec
        }
      }

      this.queue.replaceAll(remaining);
      if (remaining.length < items.length) {
        logger.info(`Flush partiel: ${items.length - remaining.length} éléments envoyés`);
      }
    } catch (err) {
      logger.error(`Erreur flush queue : ${err.message}`);
    } finally {
      this.isFlushing = false;
    }
  }
}

module.exports = SyncService;
